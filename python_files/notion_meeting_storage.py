"""Persist and load MARARE meeting documents via the official Notion MCP server."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Optional

from python_files.project_mcp import (
    ProjectMCPError,
    call_project_notion_mcp_tool,
    list_project_mcp_tools,
)

logger = logging.getLogger(__name__)

PAYLOAD_MARKER = "MARARE_MEETING_PAYLOAD"
NOTION_ID_RE = re.compile(
    r"[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}",
    re.IGNORECASE,
)

PROP_TITLE = "Title"
PROP_PROJECT_ID = "Project ID"
PROP_MEETING_ID = "Meeting ID"
PROP_USER_ID = "User ID"
PROP_VERSION = "Version"
PROP_MEETING_PHASE = "Meeting Phase"
PROP_PROGRESS = "Progress"

TOOL_ALIASES: dict[str, list[str]] = {
    "search": ["notion-search", "search", "search_pages"],
    "create_database": ["notion-create-database", "create_database", "create-a-data-source"],
    "create_pages": ["notion-create-pages", "create_page", "notion-create-page"],
    "query_data_sources": ["notion-query-data-sources", "query-data-sources"],
    "fetch": ["notion-fetch", "get_page", "retrieve-a-page", "get_page_markdown"],
    "update_page": [
        "notion-update-page",
        "update_page",
        "set_page_properties",
        "update-page-markdown",
        "update_page_markdown",
    ],
}


class NotionMeetingStorageError(RuntimeError):
    pass


def _normalize_notion_id(value: Optional[str]) -> str:
    if not value:
        return ""
    return str(value).replace("-", "").lower()


def _format_notion_id(value: str) -> str:
    raw = _normalize_notion_id(value)
    if len(raw) != 32:
        return str(value)
    return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"


def _parse_json_from_text(text: str) -> Any:
    cleaned = (text or "").strip()
    if not cleaned:
        return None
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    for match in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.IGNORECASE):
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            continue

    start = cleaned.find("{")
    while start != -1:
        depth = 0
        for index in range(start, len(cleaned)):
            char = cleaned[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    candidate = cleaned[start : index + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        break
        start = cleaned.find("{", start + 1)
    return None


def _extract_id(text: str, keys: tuple[str, ...] = ("id", "database_id", "page_id", "data_source_id")) -> Optional[str]:
    parsed = _parse_json_from_text(text)
    if isinstance(parsed, dict):
        for key in keys:
            value = parsed.get(key)
            if value:
                return _format_notion_id(str(value))
        for value in parsed.values():
            if isinstance(value, dict):
                nested = _extract_id(json.dumps(value), keys)
                if nested:
                    return nested
        results = parsed.get("results")
        if isinstance(results, list) and results:
            first = results[0]
            if isinstance(first, dict) and first.get("id"):
                return _format_notion_id(str(first["id"]))
        pages = parsed.get("pages")
        if isinstance(pages, list) and pages:
            first = pages[0]
            if isinstance(first, dict) and first.get("id"):
                return _format_notion_id(str(first["id"]))
    match = NOTION_ID_RE.search(text or "")
    return _format_notion_id(match.group(0)) if match else None


def _serialize_datetime(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _parse_datetime(value: Any) -> Any:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return value


def _meeting_database_schema_ddl() -> str:
    return (
        'CREATE TABLE "MARARE Meetings" (\n'
        '  "Title" TITLE,\n'
        '  "Project ID" RICH_TEXT,\n'
        '  "Meeting ID" RICH_TEXT,\n'
        '  "User ID" RICH_TEXT,\n'
        '  "Version" NUMBER,\n'
        '  "Meeting Phase" RICH_TEXT,\n'
        '  "Progress" NUMBER\n'
        ")"
    )


def _parse_mcp_response(text: str) -> Any:
    parsed = _parse_json_from_text(text)
    if isinstance(parsed, dict) and "result" in parsed and len(parsed) == 1:
        nested = _parse_json_from_text(str(parsed["result"]))
        return nested if nested is not None else parsed["result"]
    return parsed


def _parse_collection_url(text: str) -> Optional[str]:
    match = re.search(r"collection://[0-9a-f-]+", text or "", re.IGNORECASE)
    return match.group(0) if match else None


def _parse_database_id_from_text(text: str) -> Optional[str]:
    match = re.search(r"notion\.com/p/([0-9a-f]+)", text or "", re.IGNORECASE)
    return _format_notion_id(match.group(1)) if match else None


def _parse_fetch_response(text: str) -> tuple[dict[str, Any], str]:
    outer = _parse_json_from_text(text)
    body = text
    if isinstance(outer, dict):
        body = str(outer.get("text") or text)

    properties: dict[str, Any] = {}
    prop_match = re.search(r"<properties>\s*(\{.*?\})\s*</properties>", body, re.DOTALL)
    if prop_match:
        try:
            properties = json.loads(prop_match.group(1))
        except json.JSONDecodeError:
            properties = {}

    content = ""
    content_match = re.search(r"<content>\s*(.*?)\s*</content>", body, re.DOTALL)
    if content_match:
        content = content_match.group(1).strip()

    return properties, content


def _parse_search_results(text: str) -> list[dict[str, Any]]:
    parsed = _parse_mcp_response(text)
    if isinstance(parsed, dict):
        results = parsed.get("results")
        if isinstance(results, list):
            return [item for item in results if isinstance(item, dict)]
    return []


def _parse_created_pages(text: str) -> list[dict[str, Any]]:
    parsed = _parse_mcp_response(text)
    if isinstance(parsed, dict):
        pages = parsed.get("pages")
        if isinstance(pages, list):
            return [item for item in pages if isinstance(item, dict)]
    page_id = _extract_id(text, ("page_id", "id"))
    return [{"id": page_id}] if page_id else []


def _provision_result(text: str) -> dict[str, str]:
    collection_urls = re.findall(r"collection://[0-9a-f-]+", text or "", re.IGNORECASE)
    collection_url = collection_urls[-1] if collection_urls else None
    database_id = _parse_database_id_from_text(text) or _extract_id(text, ("database_id", "id"))
    data_source_id = ""
    if collection_url:
        data_source_id = _format_notion_id(collection_url.replace("collection://", ""))
    return {
        "database_id": database_id or "",
        "data_source_id": data_source_id or database_id or "",
        "data_source_url": collection_url or "",
    }


def _document_payload(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "generated_sections": document.get("generated_sections"),
        "undiscussed_topics": document.get("undiscussed_topics", []),
        "template": document.get("template"),
        "team_data": document.get("team_data"),
        "timestamp": document.get("timestamp"),
        "version_created_at": document.get("version_created_at"),
        "version_history": document.get("version_history", []),
        "project_name": document.get("project_name"),
        "user_id": document.get("user_id"),
        "meeting_id": document.get("meeting_id"),
        "project_id": document.get("project_id"),
        "meeting_phase": document.get("meeting_phase"),
        "progress": document.get("progress", 0),
        "version": document.get("version", 1),
        "created_at": _serialize_datetime(document.get("created_at")),
        "updated_at": _serialize_datetime(document.get("updated_at")),
    }


def _payload_markdown(document: dict[str, Any]) -> str:
    encoded = json.dumps(_document_payload(document), default=str)
    return f"## {PAYLOAD_MARKER}\n\n```json\n{encoded}\n```"


def _extract_payload_from_markdown(text: str) -> dict[str, Any]:
    if PAYLOAD_MARKER not in (text or ""):
        return {}
    match = re.search(
        rf"{re.escape(PAYLOAD_MARKER)}[\s\S]*?```(?:json)?\s*([\s\S]*?)```",
        text,
        re.IGNORECASE,
    )
    if not match:
        return {}
    try:
        return json.loads(match.group(1).strip())
    except json.JSONDecodeError:
        return {}


def _page_properties(document: dict[str, Any]) -> dict[str, Any]:
    title = document.get("project_name") or "Meeting document"
    meeting_id = str(document.get("meeting_id") or "unknown")
    version = int(document.get("version") or 1)
    return {
        PROP_TITLE: f"{title} — {meeting_id} (v{version})",
        PROP_PROJECT_ID: str(document.get("project_id") or ""),
        PROP_MEETING_ID: meeting_id,
        PROP_USER_ID: str(document.get("user_id") or ""),
        PROP_VERSION: version,
        PROP_MEETING_PHASE: str(document.get("meeting_phase") or ""),
        PROP_PROGRESS: float(document.get("progress") or 0),
    }


def _page_to_document(page_id: str, properties: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    version = properties.get(PROP_VERSION)
    if version is None:
        version = payload.get("version") or 1
    progress = properties.get(PROP_PROGRESS)
    if progress is None:
        progress = payload.get("progress", 0)

    return {
        "_id": _format_notion_id(page_id),
        "user_id": properties.get(PROP_USER_ID) or payload.get("user_id"),
        "meeting_id": properties.get(PROP_MEETING_ID) or payload.get("meeting_id"),
        "project_id": properties.get(PROP_PROJECT_ID) or payload.get("project_id"),
        "project_name": payload.get("project_name"),
        "template": payload.get("template"),
        "generated_sections": payload.get("generated_sections"),
        "undiscussed_topics": payload.get("undiscussed_topics", []),
        "meeting_phase": properties.get(PROP_MEETING_PHASE) or payload.get("meeting_phase"),
        "progress": progress,
        "timestamp": payload.get("timestamp"),
        "team_data": payload.get("team_data"),
        "created_at": _parse_datetime(payload.get("created_at")),
        "updated_at": _parse_datetime(payload.get("updated_at")),
        "version": version,
        "version_created_at": payload.get("version_created_at"),
        "version_history": payload.get("version_history", []),
        "storage_backend": "notion",
    }


class NotionMcpStorageClient:
    def __init__(self, project_id: str, user_id: str):
        self.project_id = str(project_id)
        self.user_id = str(user_id)
        self._tool_map: Optional[dict[str, str]] = None

    def _available_tools(self) -> dict[str, str]:
        if self._tool_map is not None:
            return self._tool_map

        tools = list_project_mcp_tools(self.project_id, user_id=self.user_id)
        normalized = {str(tool.get("name", "")).lower(): tool.get("name", "") for tool in tools if tool.get("name")}
        resolved: dict[str, str] = {}
        for operation, aliases in TOOL_ALIASES.items():
            for alias in aliases:
                actual = normalized.get(alias.lower())
                if actual:
                    resolved[operation] = actual
                    break
        self._tool_map = resolved
        return resolved

    def _require_tool(self, operation: str) -> str:
        tool_name = self._available_tools().get(operation)
        if not tool_name:
            aliases = ", ".join(TOOL_ALIASES.get(operation, []))
            raise NotionMeetingStorageError(
                f"Notion MCP tool for '{operation}' is unavailable. Expected one of: {aliases}. "
                "Reconnect Notion MCP for this project and try again."
            )
        return tool_name

    def _call(self, operation: str, arguments: dict[str, Any]) -> str:
        tool_name = self._require_tool(operation)
        try:
            return call_project_notion_mcp_tool(
                self.project_id,
                tool_name,
                arguments,
                user_id=self.user_id,
            )
        except ProjectMCPError as exc:
            raise NotionMeetingStorageError(str(exc)) from exc

    def verify_connection(self) -> None:
        self._available_tools()
        if "search" not in self._available_tools():
            raise NotionMeetingStorageError(
                "Connected Notion MCP session does not expose search tools required for meeting storage."
            )

    def find_parent_page(self, parent_page_id: Optional[str] = None) -> str:
        if parent_page_id:
            return _format_notion_id(parent_page_id)

        for query in (f"MARARE {self.project_id}", "MARARE", "project"):
            response = self._call(
                "search",
                {
                    "query": query,
                    "page_size": 10,
                },
            )
            for item in _parse_search_results(response):
                if item.get("type") == "page" and item.get("id"):
                    return _format_notion_id(str(item["id"]))
            page_id = _extract_id(response)
            if page_id:
                return page_id

        raise NotionMeetingStorageError(
            "No accessible Notion page found via MCP. Ensure your Notion MCP connection can access at least one page."
        )

    def provision_meeting_database(
        self,
        project_name: str,
        parent_page_id: Optional[str] = None,
    ) -> dict[str, str]:
        self.verify_connection()
        parent_id = self.find_parent_page(parent_page_id)
        title = f"MARARE Meetings — {project_name or self.project_id}"
        response = self._call(
            "create_database",
            {
                "schema": _meeting_database_schema_ddl(),
                "parent": {
                    "page_id": _normalize_notion_id(parent_id),
                    "type": "page_id",
                },
                "title": title[:2000],
                "description": "MARARE per-project meeting document storage",
            },
        )
        provisioned = _provision_result(response)
        if provisioned.get("database_id"):
            try:
                fetched = self._call("fetch", {"id": provisioned["database_id"]})
                fetched_collection = _parse_collection_url(fetched)
                if fetched_collection:
                    provisioned["data_source_url"] = fetched_collection
                    provisioned["data_source_id"] = _format_notion_id(
                        fetched_collection.replace("collection://", "")
                    )
            except NotionMeetingStorageError:
                pass
        if not provisioned.get("database_id"):
            raise NotionMeetingStorageError(
                "Notion MCP did not return a database id while provisioning meeting storage."
            )
        logger.info(
            "Provisioned Notion meeting database %s for project %s via MCP",
            provisioned["database_id"],
            self.project_id,
        )
        return provisioned

    def _fetch_page_content(self, page_id: str) -> tuple[dict[str, Any], str]:
        page_ref = _format_notion_id(page_id)
        response = self._call("fetch", {"id": page_ref})
        return _parse_fetch_response(response)

    def _create_page(self, database_id: str, document: dict[str, Any]) -> str:
        properties = _page_properties(document)
        content = _payload_markdown(document)
        response = self._call(
            "create_pages",
            {
                "parent": {
                    "database_id": _normalize_notion_id(database_id),
                    "type": "database_id",
                },
                "pages": [
                    {
                        "properties": properties,
                        "content": content,
                    }
                ],
            },
        )
        pages = _parse_created_pages(response)
        if pages and pages[0].get("id"):
            return _format_notion_id(str(pages[0]["id"]))
        page_id = _extract_id(response, ("page_id", "id"))
        if page_id:
            return page_id
        raise NotionMeetingStorageError("Notion MCP failed to create a meeting document page.")

    def save_document(self, database_id: str, document: dict[str, Any]) -> dict[str, Any]:
        page_id = self._create_page(database_id, document)
        payload = _document_payload(document)
        return _page_to_document(page_id, _page_properties(document), payload)

    def _query_pages(
        self,
        database_id: str,
        data_source_url: Optional[str],
        filters: dict[str, str],
    ) -> list[str]:
        page_ids = self._search_pages(data_source_url, filters)
        if page_ids:
            return page_ids

        if data_source_url and "query_data_sources" in self._available_tools():
            clauses = []
            params: list[str] = []
            for key, value in filters.items():
                clauses.append(f'"{key}" = ?')
                params.append(value)
            where_sql = " AND ".join(clauses) if clauses else "1=1"
            try:
                response = self._call(
                    "query_data_sources",
                    {
                        "data": {
                            "mode": "sql",
                            "data_source_urls": [data_source_url],
                            "query": (
                                f'SELECT url FROM "{data_source_url}" '
                                f'WHERE {where_sql} ORDER BY "Version" DESC'
                            ),
                            "params": params,
                        }
                    },
                )
                parsed = _parse_mcp_response(response)
                if isinstance(parsed, dict):
                    rows = parsed.get("results") or parsed.get("rows") or []
                    sql_page_ids = []
                    for row in rows:
                        if not isinstance(row, dict):
                            continue
                        page_id = row.get("url") or row.get("id")
                        if page_id:
                            extracted = _extract_id(str(page_id), ("id", "page_id", "url"))
                            if extracted:
                                sql_page_ids.append(extracted)
                    if sql_page_ids:
                        return sql_page_ids
            except NotionMeetingStorageError as exc:
                logger.info("Notion SQL query unavailable, using search results: %s", exc)

        return page_ids

    def _search_pages(self, data_source_url: Optional[str], filters: dict[str, str]) -> list[str]:
        search_query = " ".join(
            part
            for part in (
                "MARARE",
                filters.get(PROP_PROJECT_ID),
                filters.get(PROP_MEETING_ID),
                filters.get(PROP_USER_ID),
            )
            if part
        )
        search_args: dict[str, Any] = {
            "query": search_query.strip() or "MARARE meeting document",
            "page_size": 25,
        }
        if data_source_url:
            search_args["data_source_url"] = data_source_url
        response = self._call("search", search_args)
        page_ids: list[str] = []
        for item in _parse_search_results(response):
            page_id = item.get("id")
            if page_id:
                page_ids.append(_format_notion_id(str(page_id)))
        return page_ids

    def _matches_filters(self, properties: dict[str, Any], filters: dict[str, str]) -> bool:
        for key, expected in filters.items():
            actual = properties.get(key)
            if actual is None:
                return False
            if str(actual) != str(expected):
                return False
        return True

    def query_documents(
        self,
        database_id: str,
        *,
        data_source_id: Optional[str] = None,
        data_source_url: Optional[str] = None,
        project_id: Optional[str] = None,
        meeting_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        filters = {
            PROP_PROJECT_ID: str(project_id or ""),
            PROP_MEETING_ID: str(meeting_id or ""),
            PROP_USER_ID: str(user_id or ""),
        }
        filters = {key: value for key, value in filters.items() if value}
        resolved_source_url = data_source_url
        if not resolved_source_url and data_source_id:
            resolved_source_url = f"collection://{_normalize_notion_id(data_source_id)}"

        page_ids = self._query_pages(database_id, resolved_source_url, filters)
        documents: list[dict[str, Any]] = []
        for page_id in page_ids:
            doc = self.get_document(page_id, user_id or "")
            if not doc:
                continue
            if filters and not self._matches_filters(
                {
                    PROP_PROJECT_ID: doc.get("project_id", ""),
                    PROP_MEETING_ID: doc.get("meeting_id", ""),
                    PROP_USER_ID: doc.get("user_id", ""),
                },
                filters,
            ):
                continue
            documents.append(doc)
        documents.sort(key=lambda doc: _parse_datetime(doc.get("created_at")) or datetime.min, reverse=True)
        return documents

    def get_document(self, page_id: str, user_id: str) -> Optional[dict[str, Any]]:
        properties, content = self._fetch_page_content(page_id)
        payload = _extract_payload_from_markdown(content)
        document = _page_to_document(page_id, properties, payload)
        if user_id and str(document.get("user_id")) != str(user_id):
            return None
        return document

    def update_document(self, page_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        existing = self.get_document(page_id, str(updates.get("user_id") or "")) or {"_id": page_id}
        merged = {**existing, **{k: v for k, v in updates.items() if v is not None}, "_id": page_id}
        merged["updated_at"] = datetime.utcnow()

        version_history = list(merged.get("version_history") or [])
        new_version = updates.get("version")
        new_version_at = updates.get("version_created_at")
        if new_version is not None and new_version_at is not None:
            version_history.append({"version": new_version, "createdAt": new_version_at})
        merged["version_history"] = version_history

        page_ref = _format_notion_id(page_id)
        self._call(
            "update_page",
            {
                "page_id": page_ref,
                "command": "update_properties",
                "properties": _page_properties(merged),
            },
        )
        self._call(
            "update_page",
            {
                "page_id": page_ref,
                "command": "replace_content",
                "new_str": _payload_markdown(merged),
            },
        )
        return merged

    def delete_document(self, page_id: str) -> None:
        page_ref = _format_notion_id(page_id)
        properties, _ = self._fetch_page_content(page_ref)
        title = str(properties.get(PROP_TITLE) or properties.get("Title") or "Meeting document")
        if not title.startswith("[ARCHIVED]"):
            title = f"[ARCHIVED] {title}"
        self._call(
            "update_page",
            {
                "page_id": page_ref,
                "command": "update_properties",
                "properties": {PROP_TITLE: title},
            },
        )


def notion_storage_context(
    project_id: str,
    user_id: str,
    database_id: str,
    data_source_id: Optional[str] = None,
    data_source_url: Optional[str] = None,
) -> dict[str, str]:
    if not database_id:
        raise NotionMeetingStorageError("Notion meeting database is not configured for this project.")
    resolved_source_id = _format_notion_id(data_source_id or database_id)
    resolved_source_url = data_source_url or f"collection://{_normalize_notion_id(resolved_source_id)}"
    return {
        "project_id": str(project_id),
        "user_id": str(user_id),
        "database_id": _format_notion_id(database_id),
        "data_source_id": resolved_source_id,
        "data_source_url": resolved_source_url,
    }


def provision_meeting_database(
    project_id: str,
    user_id: str,
    project_name: str,
    parent_page_id: Optional[str] = None,
) -> dict[str, str]:
    client = NotionMcpStorageClient(project_id, user_id)
    return client.provision_meeting_database(project_name, parent_page_id=parent_page_id)


def save_document(
    project_id: str,
    user_id: str,
    database_id: str,
    document: dict[str, Any],
    *,
    data_source_id: Optional[str] = None,
) -> dict[str, Any]:
    client = NotionMcpStorageClient(project_id, user_id)
    return client.save_document(database_id, document)


def query_documents(
    project_id: str,
    user_id: str,
    database_id: str,
    *,
    data_source_id: Optional[str] = None,
    data_source_url: Optional[str] = None,
    filter_project_id: Optional[str] = None,
    filter_meeting_id: Optional[str] = None,
    filter_user_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    client = NotionMcpStorageClient(project_id, user_id)
    return client.query_documents(
        database_id,
        data_source_id=data_source_id,
        data_source_url=data_source_url,
        project_id=filter_project_id,
        meeting_id=filter_meeting_id,
        user_id=filter_user_id,
    )


def update_document(
    project_id: str,
    user_id: str,
    page_id: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    client = NotionMcpStorageClient(project_id, user_id)
    return client.update_document(page_id, updates)


def delete_document(project_id: str, user_id: str, page_id: str) -> None:
    client = NotionMcpStorageClient(project_id, user_id)
    client.delete_document(page_id)


def get_document(project_id: str, user_id: str, page_id: str, owner_user_id: str) -> Optional[dict[str, Any]]:
    client = NotionMcpStorageClient(project_id, user_id)
    return client.get_document(page_id, owner_user_id)