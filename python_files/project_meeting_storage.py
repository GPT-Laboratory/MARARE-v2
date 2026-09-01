"""
Save meeting documents to Supabase and optionally export a copy to Notion MCP.

Bridges generated_documents in Supabase with external Notion meeting databases
when the project has Notion configured.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from python_files.notion_meeting_storage import (
    NotionMeetingStorageError,
    notion_storage_context,
    provision_meeting_database,
    save_document as notion_save_document,
)
from python_files.project_mcp import ProjectMCPError, get_project_notion_config
from python_files.supabase_client import serialize_record
from python_files.supabase_store import (
    delete_generated_document as delete_generated_document_row,
    get_generated_document,
    insert_generated_document,
    list_generated_documents_by_meeting,
    list_generated_documents_by_project,
    update_generated_document as update_generated_document_row,
)


class MeetingStorageError(RuntimeError):
    pass


def _serialize_doc(doc: Optional[dict]) -> Optional[dict]:
    return serialize_record(doc)


def is_notion_export_enabled(project_id: Optional[str], user_id: Optional[str]) -> bool:
    if not project_id or not user_id:
        return False
    config = get_project_notion_config(str(project_id), user_id=str(user_id), include_token=False)
    if not config or not config.get("enabled", True) or not config.get("token_encrypted"):
        return False
    return bool(config.get("store_meeting_data_in_notion"))


def notion_export_status(project_id: str, user_id: str) -> dict[str, Any]:
    config = get_project_notion_config(project_id, user_id=user_id, include_token=False) or {}
    enabled = is_notion_export_enabled(project_id, user_id)
    return {
        "notionExportEnabled": enabled,
        "storeMeetingDataInNotion": enabled,
        "notionMeetingDatabaseReady": bool(config.get("notion_meeting_database_id")),
        "notionMeetingDatabaseId": config.get("notion_meeting_database_id"),
    }


def _ensure_notion_export_database(
    project_id: str,
    user_id: str,
    project_name: str = "",
) -> dict[str, str]:
    from python_files.project_mcp import NOTION_PROVIDER, _clear_project_tool_cache
    from python_files.supabase_store import update_mcp_configuration_fields

    config = get_project_notion_config(project_id, user_id=user_id, include_token=True)
    if not config or not config.get("token_encrypted"):
        raise ProjectMCPError("Connect Notion MCP for this project before exporting to Notion.")

    database_id = config.get("notion_meeting_database_id")
    if database_id:
        return notion_storage_context(
            project_id,
            user_id,
            database_id,
            data_source_id=config.get("notion_meeting_data_source_id"),
            data_source_url=config.get("notion_meeting_data_source_url"),
        )

    provisioned = provision_meeting_database(
        str(project_id),
        str(user_id),
        project_name or str(project_id),
    )
    updates = {
        "notion_meeting_database_id": provisioned["database_id"],
        "notion_meeting_data_source_id": provisioned.get("data_source_id"),
        "notion_meeting_data_source_url": provisioned.get("data_source_url"),
        "updated_at": datetime.utcnow().isoformat(),
    }
    update_mcp_configuration_fields(
        str(project_id),
        str(user_id),
        NOTION_PROVIDER,
        updates,
    )
    _clear_project_tool_cache(str(project_id))
    return notion_storage_context(
        project_id,
        user_id,
        provisioned["database_id"],
        data_source_id=provisioned.get("data_source_id"),
        data_source_url=provisioned.get("data_source_url"),
    )


def update_notion_meeting_storage_settings(
    project_id: str,
    user_id: str,
    *,
    store_meeting_data_in_notion: bool,
    project_name: str = "",
) -> dict[str, Any]:
    from python_files.project_mcp import NOTION_PROVIDER, _clear_project_tool_cache
    from python_files.supabase_store import update_mcp_configuration_fields

    config = get_project_notion_config(project_id, user_id=user_id, include_token=True)
    if not config or not config.get("token_encrypted"):
        raise ProjectMCPError("Connect Notion MCP for this project before enabling Notion export.")

    updates: dict[str, Any] = {
        "store_meeting_data_in_notion": bool(store_meeting_data_in_notion),
        "updated_at": datetime.utcnow().isoformat(),
    }

    if store_meeting_data_in_notion:
        database_id = config.get("notion_meeting_database_id")
        if not database_id:
            provisioned = provision_meeting_database(
                str(project_id),
                str(user_id),
                project_name or str(project_id),
            )
            updates["notion_meeting_database_id"] = provisioned["database_id"]
            updates["notion_meeting_data_source_id"] = provisioned.get("data_source_id")
            updates["notion_meeting_data_source_url"] = provisioned.get("data_source_url")
    else:
        updates["store_meeting_data_in_notion"] = False

    update_mcp_configuration_fields(
        str(project_id),
        str(user_id),
        NOTION_PROVIDER,
        updates,
    )
    _clear_project_tool_cache(str(project_id))
    return notion_export_status(project_id, user_id)


def _normalize_export_document(raw: dict[str, Any], project_id: str, user_id: str) -> dict[str, Any]:
    return {
        "user_id": str(raw.get("user_id") or raw.get("userId") or user_id),
        "meeting_id": raw.get("meeting_id") or raw.get("meetingId"),
        "project_id": str(raw.get("project_id") or raw.get("projectId") or project_id),
        "project_name": raw.get("project_name") or raw.get("projectName"),
        "template": raw.get("template"),
        "generated_sections": raw.get("generated_sections") or raw.get("generatedSections"),
        "undiscussed_topics": raw.get("undiscussed_topics") or raw.get("undiscussedTopics") or [],
        "meeting_phase": raw.get("meeting_phase") or raw.get("meetingPhase"),
        "progress": raw.get("progress", 0),
        "timestamp": raw.get("timestamp"),
        "team_data": raw.get("team_data") or raw.get("teamData"),
        "created_at": raw.get("created_at") or raw.get("createdAt") or datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "version": raw.get("version", 1),
        "version_created_at": raw.get("version_created_at") or raw.get("versionCreatedAt"),
        "version_history": raw.get("version_history") or raw.get("versionHistory") or [],
    }


def export_document_to_notion(
    project_id: str,
    user_id: str,
    document: dict[str, Any],
    *,
    project_name: str = "",
) -> dict[str, Any]:
    if not is_notion_export_enabled(project_id, user_id):
        raise MeetingStorageError(
            "Notion export is not enabled for this project. Enable it in Project MCP Configuration."
        )

    ctx = _ensure_notion_export_database(project_id, user_id, project_name=project_name)
    payload = _normalize_export_document(document, project_id, user_id)
    try:
        saved = notion_save_document(
            ctx["project_id"],
            ctx["user_id"],
            ctx["database_id"],
            payload,
        )
    except NotionMeetingStorageError as exc:
        raise MeetingStorageError(str(exc)) from exc

    return {
        "success": True,
        "notionPageId": saved.get("_id"),
        "storageBackend": "notion",
    }


def save_generated_document_record(document: dict[str, Any]) -> dict[str, Any]:
    return _serialize_doc(insert_generated_document(document)) or document


def get_documents_for_meeting(meeting_id: str, user_id: str, project_id: Optional[str] = None) -> list[dict]:
    return list_generated_documents_by_meeting(meeting_id, user_id)


def get_documents_for_project(project_id: str, user_id: str) -> list[dict]:
    return list_generated_documents_by_project(project_id, user_id)


def get_document_by_id(document_id: str, user_id: str, project_id: Optional[str] = None) -> Optional[dict]:
    return get_generated_document(document_id, user_id)


def update_generated_document_record(
    document_id: str,
    user_id: str,
    updates: dict[str, Any],
    project_id: Optional[str] = None,
) -> Optional[dict]:
    append_history = None
    new_version = updates.get("version")
    new_version_at = updates.get("version_created_at")
    if new_version is not None and new_version_at is not None:
        append_history = {"version": new_version, "createdAt": new_version_at}
    return update_generated_document_row(
        document_id,
        user_id,
        updates,
        append_version_history=append_history,
    )


def delete_generated_document_record(document_id: str, user_id: str, project_id: Optional[str] = None) -> bool:
    return delete_generated_document_row(document_id, user_id)