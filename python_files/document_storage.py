"""
Resolve where meeting documents are stored for a project.

Supabase is always available. Notion and Google Drive are offered when the
project has a valid OAuth connection. The user's preference is saved in
mcp_configurations and falls back to Supabase when external storage is unavailable.
"""

from __future__ import annotations

from typing import Any

from python_files.project_mcp import (
    GOOGLE_DRIVE_PROVIDER,
    NOTION_PROVIDER,
    ProjectMCPError,
    get_project_google_drive_config,
    get_project_notion_config,
)
from python_files.supabase_store import update_mcp_configuration_fields

STORAGE_GOOGLE_DRIVE = "google_drive"
STORAGE_NOTION = "notion"
STORAGE_SUPABASE = "supabase"
VALID_PREFERENCES = {STORAGE_GOOGLE_DRIVE, STORAGE_NOTION, STORAGE_SUPABASE}


def _is_notion_ready(project_id: str, user_id: str) -> bool:
    config = get_project_notion_config(project_id, user_id=user_id, include_token=False)
    if not config or not config.get("enabled", True):
        return False
    return bool(config.get("token_encrypted"))


def _is_drive_ready(project_id: str, user_id: str) -> bool:
    config = get_project_google_drive_config(project_id, user_id=user_id, include_token=False)
    if not config or not config.get("enabled", True):
        return False
    return bool(config.get("token_encrypted"))


def _read_preference(project_id: str, user_id: str) -> str:
    notion_config = get_project_notion_config(project_id, user_id=user_id, include_token=False) or {}
    drive_config = get_project_google_drive_config(project_id, user_id=user_id, include_token=False) or {}
    preference = (
        drive_config.get("document_storage_preference")
        or notion_config.get("document_storage_preference")
        or STORAGE_SUPABASE
    )
    if preference not in VALID_PREFERENCES:
        return STORAGE_SUPABASE
    return str(preference)


def _resolve_backend_from_preference(
    preference: str,
    *,
    notion_ready: bool,
    drive_ready: bool,
) -> str:
    if preference == STORAGE_GOOGLE_DRIVE and drive_ready:
        return STORAGE_GOOGLE_DRIVE
    if preference == STORAGE_NOTION and notion_ready:
        return STORAGE_NOTION
    return STORAGE_SUPABASE


def resolve_document_storage_backend(project_id: str, user_id: str) -> str:
    notion_ready = _is_notion_ready(project_id, user_id)
    drive_ready = _is_drive_ready(project_id, user_id)
    preference = _read_preference(project_id, user_id)
    return _resolve_backend_from_preference(
        preference,
        notion_ready=notion_ready,
        drive_ready=drive_ready,
    )


def document_storage_status(project_id: str, user_id: str) -> dict[str, Any]:
    notion_ready = _is_notion_ready(project_id, user_id)
    drive_ready = _is_drive_ready(project_id, user_id)
    available: list[str] = [STORAGE_SUPABASE]
    if drive_ready:
        available.append(STORAGE_GOOGLE_DRIVE)
    if notion_ready:
        available.append(STORAGE_NOTION)

    preference = _read_preference(project_id, user_id)
    backend = _resolve_backend_from_preference(
        preference,
        notion_ready=notion_ready,
        drive_ready=drive_ready,
    )

    return {
        "backend": backend,
        "preference": preference,
        "availableBackends": available,
        "notionReady": notion_ready,
        "googleDriveReady": drive_ready,
        "supabaseFallback": backend == STORAGE_SUPABASE,
    }


def update_document_storage_preference(
    project_id: str,
    user_id: str,
    preference: str,
) -> dict[str, Any]:
    if not project_id or not user_id:
        raise ProjectMCPError("project_id and user_id are required.")
    if preference not in VALID_PREFERENCES:
        raise ProjectMCPError("preference must be 'supabase', 'google_drive', or 'notion'.")

    notion_ready = _is_notion_ready(project_id, user_id)
    drive_ready = _is_drive_ready(project_id, user_id)

    if preference == STORAGE_GOOGLE_DRIVE and not drive_ready:
        raise ProjectMCPError("Google Drive must be connected before selecting it as document storage.")
    if preference == STORAGE_NOTION and not notion_ready:
        raise ProjectMCPError("Notion must be connected before selecting it as document storage.")

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    updates = {"document_storage_preference": preference, "updated_at": now}

    if notion_ready:
        update_mcp_configuration_fields(project_id, user_id, NOTION_PROVIDER, updates)
    if drive_ready:
        update_mcp_configuration_fields(project_id, user_id, GOOGLE_DRIVE_PROVIDER, updates)

    return document_storage_status(project_id, user_id)
