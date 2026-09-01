"""
Notion REST storage for project meeting documents.

Creates or updates pages in a per-project Notion database. Can use direct REST
or the Notion MCP server depending on the code path (see notion_meeting_storage).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from python_files.document_versioning import apply_version_metadata
from python_files.notion_meeting_storage import (
    NotionMeetingStorageError,
    query_documents as notion_query_documents,
    save_document as notion_mcp_save_document,
    update_document as notion_mcp_update_document,
)
from python_files.project_mcp import (
    NOTION_PROVIDER,
    ProjectMCPError,
    _clear_project_tool_cache,
    get_project_notion_config,
    get_valid_project_notion_access_token,
)
from python_files.project_meeting_storage import _ensure_notion_export_database
from python_files.base_urls import NOTION_API_BASE
from python_files.supabase_store import update_mcp_configuration_fields
NOTION_VERSION = "2022-06-28"
DOCUMENT_TITLE_PREFIX = "MARARE Project Document"
DATABASE_TITLE_PREFIX = "MARARE MCP Documents"
PROP_TITLE = "Name"
PROP_PROJECT_ID = "Project ID"
PROP_VERSION = "Version"


class NotionDocumentError(RuntimeError):
    """Raised when Notion document storage fails."""


def notion_document_title(project_id: str) -> str:
    return f"{DOCUMENT_TITLE_PREFIX} - {project_id}"


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _raise_for_notion_response(response: httpx.Response, action: str) -> None:
    if response.status_code < 400:
        return
    try:
        payload = response.json()
        message = payload.get("message") or response.text
    except Exception:
        message = response.text
    raise NotionDocumentError(f"Notion {action} failed: {message}")


def _chunk_rich_text(text: str, max_len: int = 2000) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    value = text or ""
    for index in range(0, len(value), max_len):
        chunks.append({"type": "text", "text": {"content": value[index : index + max_len]}})
    return chunks or [{"type": "text", "text": {"content": ""}}]


def _json_payload_blocks(json_str: str) -> list[dict[str, Any]]:
    return [
        {
            "object": "block",
            "type": "code",
            "code": {
                "rich_text": _chunk_rich_text(json_str),
                "language": "json",
            },
        }
    ]


def _plain_text_from_rich_text(rich_text: list[dict[str, Any]]) -> str:
    return "".join(str(item.get("plain_text") or "") for item in rich_text or [])


def _search_parent_page(token: str) -> Optional[str]:
    response = httpx.post(
        f"{NOTION_API_BASE}/search",
        headers=_headers(token),
        json={
            "query": "MARARE",
            "filter": {"value": "page", "property": "object"},
            "page_size": 1,
        },
        timeout=30,
    )
    _raise_for_notion_response(response, "search")
    results = response.json().get("results") or []
    if results:
        return str(results[0]["id"])

    response = httpx.post(
        f"{NOTION_API_BASE}/search",
        headers=_headers(token),
        json={"filter": {"value": "page", "property": "object"}, "page_size": 1},
        timeout=30,
    )
    _raise_for_notion_response(response, "search")
    results = response.json().get("results") or []
    return str(results[0]["id"]) if results else None


def _create_database(token: str, parent_page_id: str, project_name: str) -> str:
    response = httpx.post(
        f"{NOTION_API_BASE}/databases",
        headers=_headers(token),
        json={
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [
                {
                    "type": "text",
                    "text": {"content": f"{DATABASE_TITLE_PREFIX} — {project_name}"[:2000]},
                }
            ],
            "properties": {
                PROP_TITLE: {"title": {}},
                PROP_PROJECT_ID: {"rich_text": {}},
                PROP_VERSION: {"number": {}},
            },
        },
        timeout=30,
    )
    _raise_for_notion_response(response, "database create")
    database_id = response.json().get("id")
    if not database_id:
        raise NotionDocumentError("Notion did not return a database id.")
    return str(database_id)


def _ensure_document_database(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    token: str,
) -> str:
    config = get_project_notion_config(project_id, user_id=user_id, include_token=False) or {}
    database_id = config.get("notion_meeting_database_id") or config.get("notion_document_database_id")
    if database_id:
        return str(database_id)

    parent_page_id = _search_parent_page(token)
    if not parent_page_id:
        raise NotionDocumentError(
            "No accessible Notion page found. Share at least one page with your Notion integration."
        )

    database_id = _create_database(token, parent_page_id, project_name or project_id)
    update_mcp_configuration_fields(
        project_id,
        user_id,
        NOTION_PROVIDER,
        {
            "notion_meeting_database_id": database_id,
            "notion_document_database_id": database_id,
            "store_meeting_data_in_notion": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    _clear_project_tool_cache(str(project_id))
    return database_id


def _query_document_page(token: str, database_id: str, project_id: str) -> Optional[dict[str, Any]]:
    response = httpx.post(
        f"{NOTION_API_BASE}/databases/{database_id}/query",
        headers=_headers(token),
        json={
            "filter": {
                "property": PROP_PROJECT_ID,
                "rich_text": {"equals": str(project_id)},
            },
            "sorts": [{"property": PROP_VERSION, "direction": "descending"}],
            "page_size": 1,
        },
        timeout=30,
    )
    _raise_for_notion_response(response, "database query")
    results = response.json().get("results") or []
    return results[0] if results else None


def _list_block_children(token: str, block_id: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    cursor: Optional[str] = None
    while True:
        params: dict[str, Any] = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        response = httpx.get(
            f"{NOTION_API_BASE}/blocks/{block_id}/children",
            headers=_headers(token),
            params=params,
            timeout=30,
        )
        _raise_for_notion_response(response, "block list")
        payload = response.json()
        blocks.extend(payload.get("results") or [])
        if not payload.get("has_more"):
            break
        cursor = payload.get("next_cursor")
    return blocks


def _replace_page_content(token: str, page_id: str, json_str: str) -> None:
    for block in _list_block_children(token, page_id):
        block_id = block.get("id")
        if not block_id:
            continue
        response = httpx.delete(
            f"{NOTION_API_BASE}/blocks/{block_id}",
            headers=_headers(token),
            timeout=30,
        )
        _raise_for_notion_response(response, "block delete")

    response = httpx.patch(
        f"{NOTION_API_BASE}/blocks/{page_id}/children",
        headers=_headers(token),
        json={"children": _json_payload_blocks(json_str)},
        timeout=60,
    )
    _raise_for_notion_response(response, "block append")


def _load_json_from_page(token: str, page_id: str) -> dict[str, Any]:
    for block in _list_block_children(token, page_id):
        if block.get("type") != "code":
            continue
        rich_text = block.get("code", {}).get("rich_text") or []
        text = _plain_text_from_rich_text(rich_text).strip()
        if not text:
            continue
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return {}


def _page_properties(project_id: str, version: int) -> dict[str, Any]:
    title = notion_document_title(project_id)
    return {
        PROP_TITLE: {"title": [{"type": "text", "text": {"content": title[:2000]}}]},
        PROP_PROJECT_ID: {"rich_text": [{"type": "text", "text": {"content": str(project_id)}}]},
        PROP_VERSION: {"number": version},
    }


def _canonical_meeting_id(project_id: str) -> str:
    return f"marare-document-{project_id}"


def _uses_notion_rest_api(project_id: str, user_id: str) -> bool:
    """MCP OAuth tokens are scoped to mcp.notion.com and cannot call api.notion.com."""
    config = get_project_notion_config(project_id, user_id=user_id, include_token=True) or {}
    token = str(config.get("notion_token") or "").strip()
    return token.startswith("ntn_") or token.startswith("secret_")


def _parse_sections_json(document_payload: dict[str, Any]) -> list[dict[str, Any]]:
    sections_json = document_payload.get("sectionsJson") or document_payload.get("sections_json")
    if not sections_json:
        return []
    try:
        parsed = json.loads(sections_json) if isinstance(sections_json, str) else sections_json
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _drive_payload_to_mcp_document(
    document_payload: dict[str, Any],
    *,
    project_id: str,
    user_id: str,
    project_name: str,
) -> dict[str, Any]:
    sections = _parse_sections_json(document_payload)
    generated_sections = {
        str(section.get("id")): str(section.get("content") or "")
        for section in sections
        if section.get("id") and str(section.get("content") or "").strip()
    }
    categories: dict[str, Any] = {}
    template_sections: list[dict[str, Any]] = []
    for section in sections:
        category = str(section.get("category") or "general")
        if category not in categories:
            categories[category] = {
                "title": section.get("categoryTitle") or category.replace("_", " ").title(),
            }
        template_sections.append(
            {
                "id": section.get("id"),
                "title": section.get("title"),
                "category": category,
            }
        )

    version_history = document_payload.get("version_history") or document_payload.get("versionHistory") or []
    meeting_id = str(
        document_payload.get("meetingId")
        or document_payload.get("meeting_id")
        or _canonical_meeting_id(project_id)
    ).strip()
    transcript_entries = (
        document_payload.get("transcriptEntries")
        or document_payload.get("transcript_entries")
        or []
    )
    if not isinstance(transcript_entries, list):
        transcript_entries = []
    transcript_full_text = (
        document_payload.get("transcriptFullText")
        or document_payload.get("transcript_full_text")
        or document_payload.get("fullText")
        or document_payload.get("full_text")
        or ""
    )
    return {
        "user_id": str(user_id),
        "project_id": str(project_id),
        "project_name": project_name,
        "meeting_id": meeting_id,
        "meeting_agenda": document_payload.get("meetingAgenda")
        or document_payload.get("meeting_agenda")
        or document_payload.get("agenda"),
        "template": {"categories": categories, "sections": template_sections},
        "generated_sections": generated_sections,
        "undiscussed_topics": document_payload.get("undiscussed_topics")
        or document_payload.get("undiscussedTopics")
        or [],
        "meeting_phase": document_payload.get("meetingPhase") or document_payload.get("meeting_phase"),
        "progress": document_payload.get("progress", 0),
        "timestamp": document_payload.get("timestamp") or document_payload.get("updatedAt"),
        "version": int(document_payload.get("version") or 1),
        "version_created_at": document_payload.get("versionCreatedAt")
        or document_payload.get("version_created_at"),
        "version_history": version_history,
        "updated_at": document_payload.get("updatedAt") or datetime.now(timezone.utc).isoformat(),
        "summary_content": document_payload.get("summaryContent") or document_payload.get("summary_content"),
        "mvp_content": document_payload.get("mvpContent") or document_payload.get("mvp_content"),
        "vision_content": document_payload.get("visionContent") or document_payload.get("vision_content"),
        "transcript_entries": transcript_entries,
        "transcript_full_text": transcript_full_text,
    }


def _mcp_document_to_drive_payload(mcp_document: dict[str, Any]) -> dict[str, Any]:
    template = mcp_document.get("template") or {}
    generated_sections = mcp_document.get("generated_sections") or {}
    sections: list[dict[str, Any]] = []
    for section in template.get("sections") or []:
        section_id = section.get("id")
        if not section_id:
            continue
        category = section.get("category") or "general"
        sections.append(
            {
                "id": section_id,
                "title": section.get("title") or section_id,
                "category": category,
                "categoryTitle": (template.get("categories") or {}).get(category, {}).get("title") or category,
                "content": generated_sections.get(section_id) or generated_sections.get(str(section_id)) or "",
            }
        )

    version_history = mcp_document.get("version_history") or []
    revision_rows = [
        {
            "date": str(entry.get("createdAt") or entry.get("created_at") or "")[:10],
            "revision": f"v{entry.get('version', 1)}",
        }
        for entry in version_history
        if isinstance(entry, dict)
    ]

    project_id = str(mcp_document.get("project_id") or "")
    return {
        "schemaVersion": 1,
        "documentId": notion_document_title(project_id),
        "type": "meeting_document",
        "title": notion_document_title(project_id),
        "projectId": project_id,
        "projectName": mcp_document.get("project_name") or "",
        "updatedAt": mcp_document.get("updated_at") or mcp_document.get("timestamp"),
        "sectionsJson": json.dumps(sections, separators=(",", ":"), ensure_ascii=False),
        "version": int(mcp_document.get("version") or 1),
        "versionCreatedAt": mcp_document.get("version_created_at"),
        "version_history": version_history,
        "versionHistory": version_history,
        "revisionHistoryJson": json.dumps(revision_rows, separators=(",", ":")),
        "source": "notion_mcp",
    }


def _find_project_document_via_mcp(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    meeting_id: Optional[str] = None,
) -> tuple[Optional[dict[str, Any]], dict[str, str]]:
    ctx = _ensure_notion_export_database(project_id, user_id, project_name=project_name)
    target_meeting_id = meeting_id or _canonical_meeting_id(project_id)
    documents = notion_query_documents(
        project_id,
        user_id,
        ctx["database_id"],
        data_source_id=ctx.get("data_source_id"),
        data_source_url=ctx.get("data_source_url"),
        filter_project_id=str(project_id),
        filter_meeting_id=target_meeting_id,
        filter_user_id=str(user_id),
    )
    if not documents:
        return None, ctx
    documents.sort(key=lambda doc: int(doc.get("version") or 0), reverse=True)
    return documents[0], ctx


def _save_project_document_via_mcp(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    document_payload: dict[str, Any],
) -> dict[str, Any]:
    try:
        target_meeting_id = str(
            document_payload.get("meetingId")
            or document_payload.get("meeting_id")
            or _canonical_meeting_id(project_id)
        ).strip()
        existing_doc, ctx = _find_project_document_via_mcp(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
            meeting_id=target_meeting_id,
        )
    except (ProjectMCPError, NotionMeetingStorageError) as exc:
        raise NotionDocumentError(str(exc)) from exc

    existing_drive_payload = _mcp_document_to_drive_payload(existing_doc) if existing_doc else None
    payload = _document_payload(project_id, project_name, document_payload)
    payload["source"] = "notion_mcp"
    payload = apply_version_metadata(existing_drive_payload, payload)
    mcp_document = _drive_payload_to_mcp_document(
        payload,
        project_id=project_id,
        user_id=user_id,
        project_name=project_name,
    )

    try:
        if existing_doc and existing_doc.get("_id"):
            saved = notion_mcp_update_document(
                project_id,
                user_id,
                str(existing_doc["_id"]),
                mcp_document,
            )
        else:
            saved = notion_mcp_save_document(
                project_id,
                user_id,
                ctx["database_id"],
                mcp_document,
            )
    except NotionMeetingStorageError as exc:
        raise NotionDocumentError(str(exc)) from exc

    drive_payload = _mcp_document_to_drive_payload(saved)
    page_id = str(saved.get("_id") or "")
    return {
        "success": True,
        "found": True,
        "document": drive_payload,
        "pageId": page_id,
        "databaseId": ctx["database_id"],
        "source": "notion_mcp",
        "message": "Document saved to Notion.",
    }


def _retrieve_project_document_via_mcp(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    meeting_id: Optional[str] = None,
) -> dict[str, Any]:
    config = get_project_notion_config(project_id, user_id=user_id, include_token=False) or {}
    if not config.get("notion_meeting_database_id"):
        return {"found": False, "content": "", "source": "notion_mcp"}

    try:
        existing_doc, ctx = _find_project_document_via_mcp(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
            meeting_id=meeting_id,
        )
    except (ProjectMCPError, NotionMeetingStorageError) as exc:
        raise NotionDocumentError(str(exc)) from exc

    if not existing_doc:
        return {"found": False, "content": "", "source": "notion_mcp"}

    payload = _mcp_document_to_drive_payload(existing_doc)
    return {
        "found": True,
        "document": payload,
        "pageId": existing_doc.get("_id"),
        "databaseId": ctx.get("database_id"),
        "source": "notion_mcp",
    }


def _document_payload(project_id: str, project_name: str, document_payload: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        **document_payload,
        "schemaVersion": document_payload.get("schemaVersion") or 1,
        "documentId": notion_document_title(project_id),
        "projectId": str(project_id),
        "projectName": project_name,
        "title": document_payload.get("title") or notion_document_title(project_id),
        "updatedAt": document_payload.get("updatedAt") or now,
        "source": "notion_rest",
    }


def save_project_document_to_notion(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    document_payload: dict[str, Any],
) -> dict[str, Any]:
    if not project_id or not user_id:
        raise NotionDocumentError("project_id and user_id are required.")
    if not project_name:
        raise NotionDocumentError("project_name is required.")
    if not isinstance(document_payload, dict) or not document_payload:
        raise NotionDocumentError("document payload is required.")

    if not _uses_notion_rest_api(project_id, user_id):
        return _save_project_document_via_mcp(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
            document_payload=document_payload,
        )

    try:
        token = get_valid_project_notion_access_token(project_id, user_id=user_id)
    except ProjectMCPError as exc:
        raise NotionDocumentError(str(exc)) from exc

    database_id = _ensure_document_database(
        project_id=project_id,
        user_id=user_id,
        project_name=project_name,
        token=token,
    )
    existing_page = _query_document_page(token, database_id, project_id)
    existing_payload: Optional[dict[str, Any]] = None
    if existing_page:
        existing_payload = _load_json_from_page(token, str(existing_page["id"]))

    payload = _document_payload(project_id, project_name, document_payload)
    payload = apply_version_metadata(existing_payload, payload)
    content = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    version = int(payload.get("version") or 1)

    if existing_page:
        page_id = str(existing_page["id"])
        response = httpx.patch(
            f"{NOTION_API_BASE}/pages/{page_id}",
            headers=_headers(token),
            json={"properties": _page_properties(project_id, version)},
            timeout=30,
        )
        _raise_for_notion_response(response, "page update")
        _replace_page_content(token, page_id, content)
        page = response.json()
    else:
        response = httpx.post(
            f"{NOTION_API_BASE}/pages",
            headers=_headers(token),
            json={
                "parent": {"type": "database_id", "database_id": database_id},
                "properties": _page_properties(project_id, version),
                "children": _json_payload_blocks(content),
            },
            timeout=60,
        )
        _raise_for_notion_response(response, "page create")
        page = response.json()
        page_id = str(page["id"])

    return {
        "success": True,
        "found": True,
        "document": payload,
        "pageId": page_id,
        "databaseId": database_id,
        "url": page.get("url"),
        "source": "notion_rest",
        "message": "Document saved to Notion.",
    }


def retrieve_project_document_from_notion(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    meeting_id: Optional[str] = None,
) -> dict[str, Any]:
    if not project_id or not user_id:
        raise NotionDocumentError("project_id and user_id are required.")
    if not project_name:
        raise NotionDocumentError("project_name is required.")

    if not _uses_notion_rest_api(project_id, user_id):
        return _retrieve_project_document_via_mcp(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
            meeting_id=meeting_id,
        )

    try:
        token = get_valid_project_notion_access_token(project_id, user_id=user_id)
    except ProjectMCPError as exc:
        raise NotionDocumentError(str(exc)) from exc

    config = get_project_notion_config(project_id, user_id=user_id, include_token=False) or {}
    database_id = config.get("notion_meeting_database_id") or config.get("notion_document_database_id")
    if not database_id:
        return {"found": False, "content": "", "source": "notion_rest"}

    page = _query_document_page(token, str(database_id), project_id)
    if not page:
        return {"found": False, "content": "", "source": "notion_rest"}

    page_id = str(page["id"])
    payload = _load_json_from_page(token, page_id)
    if not payload:
        raise NotionDocumentError("Stored Notion document is missing or invalid.")

    return {
        "found": True,
        "document": payload,
        "pageId": page_id,
        "databaseId": database_id,
        "url": page.get("url"),
        "source": "notion_rest",
    }
