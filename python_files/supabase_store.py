"""Supabase-backed persistence (replaces legacy MongoDB collections).

All long-lived app data lives here: projects, generated documents, transcripts,
summaries, MCP configs, OAuth state, and meeting admin records. HTTP handlers in
other modules call these functions; they do not talk to Supabase directly.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from python_files.supabase_client import (
    SupabaseConfigError,
    get_supabase,
    merge_configuration_row,
    serialize_record,
    serialize_records,
    utc_now_iso,
)


class SupabaseStoreError(RuntimeError):
    pass


def _handle_response(response: Any, *, expect_data: bool = True) -> Any:
    if getattr(response, "data", None) is None and expect_data:
        return None
    return response.data


def _is_valid_uuid(value: str) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

def list_projects(user_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase()
        .table("projects")
        .select("*")
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return serialize_records(response.data or [])


def get_project(project_id: str, user_id: Optional[str] = None) -> Optional[dict[str, Any]]:
    if not _is_valid_uuid(project_id):
        return None
    query = get_supabase().table("projects").select("*").eq("id", project_id)
    if user_id:
        query = query.eq("user_id", str(user_id))
    response = query.limit(1).execute()
    rows = response.data or []
    return serialize_record(rows[0]) if rows else None


def insert_project(row: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "user_id": str(row["user_id"]),
        "name": row["name"],
        "template_document": row.get("template_document"),
        "mvp_vision_template": row.get("mvpVisiontemplate") or row.get("mvp_vision_template"),
        "created_at": row.get("created_at") or utc_now_iso(),
    }
    response = get_supabase().table("projects").insert(payload).execute()
    created = (response.data or [None])[0]
    if not created:
        raise SupabaseStoreError("Failed to create project.")
    return serialize_record(created) or {}


def update_project(project_id: str, user_id: str, updates: dict[str, Any]) -> bool:
    if not _is_valid_uuid(project_id):
        return False
    response = (
        get_supabase()
        .table("projects")
        .update(updates)
        .eq("id", project_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    return bool(response.data)


def delete_project(project_id: str) -> bool:
    if not _is_valid_uuid(project_id):
        return False
    response = get_supabase().table("projects").delete().eq("id", project_id).execute()
    return bool(response.data)


def delete_project_related_data(project_id: str) -> dict[str, int]:
    client = get_supabase()
    counts = {
        "documents_deleted": 0,
        "summaries_deleted": 0,
        "mvpvision_deleted": 0,
        "mcp_configurations_deleted": 0,
        "meeting_sessions_deleted": 0,
        "reports_deleted": 0,
        "meeting_transcripts_deleted": 0,
    }

    docs = client.table("generated_documents").delete().eq("project_id", str(project_id)).execute()
    counts["documents_deleted"] = len(docs.data or [])

    summaries = client.table("meeting_summaries").delete().eq("project_id", str(project_id)).execute()
    counts["summaries_deleted"] = len(summaries.data or [])

    mvp = client.table("meeting_mvpvisions").delete().eq("project_id", str(project_id)).execute()
    counts["mvpvision_deleted"] = len(mvp.data or [])

    mcp = client.table("mcp_configurations").delete().eq("project_id", str(project_id)).execute()
    counts["mcp_configurations_deleted"] = len(mcp.data or [])

    sessions = (
        client.table("meeting_document_sessions")
        .select("meeting_id, session_data")
        .execute()
    )
    deleted_sessions = 0
    for row in sessions.data or []:
        session_data = row.get("session_data") or {}
        metadata = session_data.get("metadata") or {}
        if str(metadata.get("project_id")) == str(project_id):
            client.table("meeting_document_sessions").delete().eq("meeting_id", row["meeting_id"]).execute()
            deleted_sessions += 1
    counts["meeting_sessions_deleted"] = deleted_sessions

    reports = client.table("project_reports").delete().eq("project_id", str(project_id)).execute()
    counts["reports_deleted"] = len(reports.data or [])

    transcripts = client.table("meeting_transcripts").delete().eq("project_id", str(project_id)).execute()
    counts["meeting_transcripts_deleted"] = len(transcripts.data or [])

    return counts


# ---------------------------------------------------------------------------
# Generated documents
# ---------------------------------------------------------------------------

def insert_generated_document(document: dict[str, Any]) -> dict[str, Any]:
    now = utc_now_iso()
    payload = {
        "user_id": str(document["user_id"]),
        "meeting_id": document.get("meeting_id"),
        "project_id": str(document.get("project_id")),
        "project_name": document.get("project_name"),
        "template": document.get("template"),
        "generated_sections": document.get("generated_sections"),
        "undiscussed_topics": document.get("undiscussed_topics") or [],
        "meeting_phase": document.get("meeting_phase"),
        "progress": document.get("progress", 0),
        "timestamp": document.get("timestamp") or now,
        "team_data": document.get("team_data"),
        "source": document.get("source"),
        "meeting_agenda": document.get("meeting_agenda") or document.get("meetingAgenda"),
        "version": document.get("version", 1),
        "version_created_at": document.get("version_created_at") or now,
        "version_history": document.get("version_history") or [],
        "created_at": document.get("created_at") or now,
        "updated_at": document.get("updated_at") or now,
    }
    if document.get("based_on_meeting_id") is not None:
        payload["based_on_meeting_id"] = document.get("based_on_meeting_id")
    if document.get("based_on_document_id") is not None:
        payload["based_on_document_id"] = document.get("based_on_document_id")
    response = get_supabase().table("generated_documents").insert(payload).execute()
    created = (response.data or [None])[0]
    if not created:
        raise SupabaseStoreError("Failed to save generated document.")
    return serialize_record(created) or {}


def list_generated_documents_by_meeting(meeting_id: str, user_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase()
        .table("generated_documents")
        .select("*")
        .eq("meeting_id", str(meeting_id))
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return serialize_records(response.data or [])


def list_generated_documents_by_project(project_id: str, user_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase()
        .table("generated_documents")
        .select("*")
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return serialize_records(response.data or [])


_MEETING_HISTORY_DOCUMENT_COLUMNS = (
    "id, user_id, meeting_id, project_id, project_name, source, version, "
    "version_created_at, created_at, updated_at, based_on_meeting_id, "
    "meeting_phase, progress, timestamp, meeting_agenda"
)

_MEETING_HISTORY_TRANSCRIPT_COLUMNS = (
    "id, user_id, meeting_id, project_id, project_name, based_on_meeting_id, "
    "created_at, entries, meeting_agenda"
)


def list_generated_document_summaries_by_project(
    project_id: str, user_id: str
) -> list[dict[str, Any]]:
    response = (
        get_supabase()
        .table("generated_documents")
        .select(_MEETING_HISTORY_DOCUMENT_COLUMNS)
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return serialize_records(response.data or [])


def _slim_transcript_for_history(row: dict[str, Any]) -> dict[str, Any]:
    entries = row.get("entries") or []
    if not isinstance(entries, list):
        entries = []

    speaker_names = sorted(
        {
            str(entry.get("speaker_name") or entry.get("speakerName") or "Unknown")
            for entry in entries
            if isinstance(entry, dict)
        }
    )

    return {
        "_id": row.get("_id") or row.get("id"),
        "id": row.get("id") or row.get("_id"),
        "user_id": row.get("user_id"),
        "meeting_id": row.get("meeting_id"),
        "project_id": row.get("project_id"),
        "project_name": row.get("project_name"),
        "based_on_meeting_id": row.get("based_on_meeting_id"),
        "created_at": row.get("created_at"),
        "entry_count": len(entries),
        "speaker_names": speaker_names,
        "has_transcript": len(entries) > 0,
        "meeting_agenda": row.get("meeting_agenda") or row.get("meetingAgenda"),
    }


def list_meeting_transcript_summaries_by_project(
    project_id: str, user_id: str,
) -> list[dict[str, Any]]:
    try:
        response = (
            get_supabase()
            .table("meeting_transcripts")
            .select(_MEETING_HISTORY_TRANSCRIPT_COLUMNS)
            .eq("project_id", str(project_id))
            .eq("user_id", str(user_id))
            .order("created_at", desc=True)
            .execute()
        )
        rows = serialize_records(response.data or [])
        return [_slim_transcript_for_history(row) for row in rows]
    except Exception as error:
        if _is_missing_meeting_transcripts_table(error):
            print(
                "Warning: meeting_transcripts table missing — run supabase/migrations/003_meeting_versioning.sql"
            )
            return []
        raise


def get_generated_document(document_id: str, user_id: str) -> Optional[dict[str, Any]]:
    if not _is_valid_uuid(document_id):
        return None
    response = (
        get_supabase()
        .table("generated_documents")
        .select("*")
        .eq("id", document_id)
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return serialize_record(rows[0]) if rows else None


def update_generated_document(
    document_id: str,
    user_id: str,
    updates: dict[str, Any],
    *,
    append_version_history: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    if not _is_valid_uuid(document_id):
        return None

    existing = get_generated_document(document_id, user_id)
    if not existing:
        return None

    update_payload = dict(updates)
    update_payload["updated_at"] = utc_now_iso()

    # Never reassign a document to a different meeting once it has a meeting_id.
    existing_meeting_id = existing.get("meeting_id")
    incoming_meeting_id = update_payload.get("meeting_id")
    if (
        existing_meeting_id
        and incoming_meeting_id
        and str(existing_meeting_id) != str(incoming_meeting_id)
    ):
        update_payload.pop("meeting_id", None)

    if append_version_history:
        history = list(existing.get("version_history") or [])
        history.append(append_version_history)
        update_payload["version_history"] = history

    response = (
        get_supabase()
        .table("generated_documents")
        .update(update_payload)
        .eq("id", document_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    updated = (response.data or [None])[0]
    return serialize_record(updated) if updated else get_generated_document(document_id, user_id)


def delete_generated_document(document_id: str, user_id: str) -> bool:
    if not _is_valid_uuid(document_id):
        return False
    response = (
        get_supabase()
        .table("generated_documents")
        .delete()
        .eq("id", document_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    return bool(response.data)


def list_generated_documents_by_user(user_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase()
        .table("generated_documents")
        .select("*")
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return serialize_records(response.data or [])


# ---------------------------------------------------------------------------
# Meeting summaries
# ---------------------------------------------------------------------------

def insert_meeting_summary(summary: dict[str, Any]) -> dict[str, Any]:
    now = utc_now_iso()
    payload = {
        "user_id": str(summary["user_id"]),
        "meeting_id": summary.get("meeting_id"),
        "project_id": summary.get("project_id"),
        "project_name": summary.get("project_name"),
        "summary_content": summary.get("summary_content"),
        "timestamp": summary.get("timestamp") or now,
        "team_data": summary.get("team_data"),
        "version": summary.get("version", 1),
        "created_at": summary.get("created_at") or now,
        "updated_at": summary.get("updated_at") or now,
    }
    response = get_supabase().table("meeting_summaries").insert(payload).execute()
    created = (response.data or [None])[0]
    return serialize_record(created) or {}


def list_meeting_summaries(meeting_id: str, user_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase()
        .table("meeting_summaries")
        .select("*")
        .eq("meeting_id", str(meeting_id))
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return serialize_records(response.data or [])


def list_summaries_by_project(project_id: str, user_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase()
        .table("meeting_summaries")
        .select("*")
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return serialize_records(response.data or [])


def get_meeting_summary(summary_id: str, user_id: str) -> Optional[dict[str, Any]]:
    if not _is_valid_uuid(summary_id):
        return None
    response = (
        get_supabase()
        .table("meeting_summaries")
        .select("*")
        .eq("id", summary_id)
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return serialize_record(rows[0]) if rows else None


def update_meeting_summary(summary_id: str, user_id: str, updates: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not _is_valid_uuid(summary_id):
        return None
    payload = {**updates, "updated_at": utc_now_iso()}
    response = (
        get_supabase()
        .table("meeting_summaries")
        .update(payload)
        .eq("id", summary_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    updated = (response.data or [None])[0]
    return serialize_record(updated) if updated else None


def delete_meeting_summary(summary_id: str, user_id: str) -> bool:
    if not _is_valid_uuid(summary_id):
        return False
    response = (
        get_supabase()
        .table("meeting_summaries")
        .delete()
        .eq("id", summary_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    return bool(response.data)


# ---------------------------------------------------------------------------
# Meeting MVP + Vision
# ---------------------------------------------------------------------------

def insert_meeting_mvpvision(record: dict[str, Any]) -> dict[str, Any]:
    now = utc_now_iso()
    payload = {
        "user_id": str(record["user_id"]),
        "meeting_id": record.get("meeting_id"),
        "project_id": record.get("project_id"),
        "project_name": record.get("project_name"),
        "mvp": record.get("mvp", ""),
        "vision": record.get("vision", ""),
        "timestamp": record.get("timestamp") or now,
        "version": record.get("version", 1),
        "created_at": record.get("created_at") or now,
        "updated_at": record.get("updated_at") or now,
    }
    response = get_supabase().table("meeting_mvpvisions").insert(payload).execute()
    created = (response.data or [None])[0]
    return serialize_record(created) or {}


def list_mvpvisions_by_project(project_id: str, user_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase()
        .table("meeting_mvpvisions")
        .select("*")
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return serialize_records(response.data or [])


def update_meeting_mvpvision(record_id: str, user_id: str, updates: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not _is_valid_uuid(record_id):
        return None
    payload = {**updates, "updated_at": utc_now_iso()}
    response = (
        get_supabase()
        .table("meeting_mvpvisions")
        .update(payload)
        .eq("id", record_id)
        .eq("user_id", str(user_id))
        .execute()
    )
    updated = (response.data or [None])[0]
    return serialize_record(updated) if updated else None


# ---------------------------------------------------------------------------
# MCP configurations
# ---------------------------------------------------------------------------

def find_mcp_configuration(
    project_id: str,
    provider: str,
    user_id: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    query = (
        get_supabase()
        .table("mcp_configurations")
        .select("*")
        .eq("project_id", str(project_id))
        .eq("provider", provider)
    )
    if user_id:
        query = query.eq("user_id", str(user_id))
    response = query.limit(1).execute()
    rows = response.data or []
    if rows:
        return merge_configuration_row(rows[0])

    if user_id:
        fallback = (
            get_supabase()
            .table("mcp_configurations")
            .select("*")
            .eq("project_id", str(project_id))
            .eq("provider", provider)
            .limit(1)
            .execute()
        )
        fallback_rows = fallback.data or []
        return merge_configuration_row(fallback_rows[0]) if fallback_rows else None
    return None

MCP_PROVIDER_ORDER = ("github", "notion", "google_drive")


def list_connected_mcp_providers_by_project(user_id: str) -> dict[str, list[str]]:
    response = (
        get_supabase()
        .table("mcp_configurations")
        .select("project_id, provider, configuration")
        .eq("user_id", str(user_id))
        .execute()
    )

    by_project: dict[str, list[str]] = {}

    for row in response.data or []:
        merged = merge_configuration_row(row)
        if not merged.get("token_encrypted"):
            continue

        project_id = str(row["project_id"])
        provider = str(row["provider"])
        by_project.setdefault(project_id, []).append(provider)

    for project_id, providers in by_project.items():
        by_project[project_id] = sorted(
            providers,
            key=lambda provider: MCP_PROVIDER_ORDER.index(provider)
            if provider in MCP_PROVIDER_ORDER
            else len(MCP_PROVIDER_ORDER),
        )

    return by_project


def upsert_mcp_configuration(configuration: dict[str, Any]) -> dict[str, Any]:
    now = utc_now_iso()
    user_id = str(configuration["user_id"])
    project_id = str(configuration["project_id"])
    provider = str(configuration["provider"])

    existing = find_mcp_configuration(project_id, provider, user_id=user_id) or {}
    merged_configuration = {**existing, **configuration}
    merged_configuration.pop("_id", None)

    payload = {
        "user_id": user_id,
        "project_id": project_id,
        "provider": provider,
        "configuration": merged_configuration,
        "updated_at": now,
        "created_at": existing.get("created_at") or now,
    }

    response = (
        get_supabase()
        .table("mcp_configurations")
        .upsert(payload, on_conflict="user_id,project_id,provider")
        .execute()
    )
    saved = (response.data or [None])[0]
    return merge_configuration_row(saved) if saved else merged_configuration


def update_mcp_configuration_fields(
    project_id: str,
    user_id: str,
    provider: str,
    updates: dict[str, Any],
) -> None:
    existing = find_mcp_configuration(project_id, provider, user_id=user_id) or {}
    merged = {**existing, **updates}
    upsert_mcp_configuration(
        {
            "user_id": str(user_id),
            "project_id": str(project_id),
            "provider": provider,
            **merged,
        }
    )


def delete_mcp_configurations(project_id: str, provider: str, user_id: Optional[str] = None) -> None:
    query = (
        get_supabase()
        .table("mcp_configurations")
        .delete()
        .eq("project_id", str(project_id))
        .eq("provider", provider)
    )
    if user_id:
        query = query.eq("user_id", str(user_id))
    query.execute()


# ---------------------------------------------------------------------------
# MCP OAuth states
# ---------------------------------------------------------------------------

def insert_oauth_state(state_doc: dict[str, Any]) -> None:
    payload = {
        "state": state_doc["state"],
        "provider": state_doc.get("provider"),
        "project_id": str(state_doc["project_id"]),
        "user_id": str(state_doc["user_id"]),
        "payload": {
            key: value
            for key, value in state_doc.items()
            if key not in {"state", "provider", "project_id", "user_id", "expires_at", "created_at"}
        },
        "expires_at": state_doc["expires_at"],
        "created_at": state_doc.get("created_at") or datetime.now(timezone.utc).isoformat(),
    }
    get_supabase().table("mcp_oauth_states").insert(payload).execute()


def consume_oauth_state(state: str) -> Optional[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    response = (
        get_supabase()
        .table("mcp_oauth_states")
        .select("*")
        .eq("state", state)
        .gt("expires_at", now)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        return None

    row = rows[0]
    get_supabase().table("mcp_oauth_states").delete().eq("state", state).execute()

    payload = row.get("payload") or {}
    merged = {
        **payload,
        "state": row["state"],
        "provider": row.get("provider"),
        "project_id": row.get("project_id"),
        "user_id": row.get("user_id"),
        "expires_at": row.get("expires_at"),
        "created_at": row.get("created_at"),
    }
    return merged


# ---------------------------------------------------------------------------
# Meeting document sessions
# ---------------------------------------------------------------------------

def get_meeting_document_session(meeting_id: str) -> dict[str, Any]:
    response = (
        get_supabase()
        .table("meeting_document_sessions")
        .select("*")
        .eq("meeting_id", str(meeting_id))
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        return {}
    row = rows[0]
    session_data = dict(row.get("session_data") or {})
    session_data["meeting_id"] = row["meeting_id"]
    if row.get("created_at"):
        session_data.setdefault("created_at", row["created_at"])
    if row.get("updated_at"):
        session_data["updated_at"] = row["updated_at"]
    return session_data


def upsert_meeting_document_session(meeting_id: str, session_updates: dict[str, Any]) -> dict[str, Any]:
    meeting_id = str(meeting_id)
    existing = get_meeting_document_session(meeting_id)
    merged = {**existing, **session_updates, "meeting_id": meeting_id}
    now = utc_now_iso()

    payload = {
        "meeting_id": meeting_id,
        "session_data": merged,
        "updated_at": now,
        "created_at": existing.get("created_at") or now,
    }
    response = (
        get_supabase()
        .table("meeting_document_sessions")
        .upsert(payload, on_conflict="meeting_id")
        .execute()
    )
    saved = (response.data or [None])[0]
    if saved:
        return get_meeting_document_session(meeting_id)
    return merged


def delete_meeting_document_session(meeting_id: str) -> None:
    get_supabase().table("meeting_document_sessions").delete().eq("meeting_id", str(meeting_id)).execute()


# ---------------------------------------------------------------------------
# Meeting admins
# ---------------------------------------------------------------------------

def insert_meeting_admin(admin_doc: dict[str, Any]) -> None:
    payload = {
        "meeting_id": str(admin_doc["meeting_id"]),
        "user_id": admin_doc.get("user_id"),
        "is_admin": bool(admin_doc.get("is_admin", True)),
        "is_agent": bool(admin_doc.get("is_agent", False)),
        "agent_name": admin_doc.get("agent_Name") or admin_doc.get("agent_name"),
        "exp": admin_doc.get("exp"),
        "created_at": utc_now_iso(),
    }
    get_supabase().table("meeting_admins").insert(payload).execute()


def find_meeting_admin(meeting_id: str) -> Optional[dict[str, Any]]:
    response = (
        get_supabase()
        .table("meeting_admins")
        .select("*")
        .eq("meeting_id", str(meeting_id))
        .eq("is_admin", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        return None
    row = rows[0]
    return {
        "meeting_id": row["meeting_id"],
        "user_id": row.get("user_id"),
        "is_admin": row.get("is_admin"),
        "is_agent": row.get("is_agent"),
        "agent_Name": row.get("agent_name"),
        "exp": row.get("exp"),
    }


# ---------------------------------------------------------------------------
# Meeting transcripts
# ---------------------------------------------------------------------------

def _build_transcript_full_text(entries: list[dict[str, Any]]) -> str:
    lines = []
    for entry in entries or []:
        text = str(entry.get("text") or "").strip()
        if not text:
            continue
        speaker = entry.get("speaker_name") or entry.get("speakerName") or "Unknown"
        lines.append(f"[{speaker}]: {text}")
    return "\n".join(lines)


def _is_missing_meeting_transcripts_table(error: Exception) -> bool:
    parts = [str(error)]
    if isinstance(error, dict):
        parts.append(str(error.get("message") or ""))
        parts.append(str(error.get("code") or ""))
    else:
        for attr in ("message", "code", "details", "hint"):
            value = getattr(error, attr, None)
            if value:
                parts.append(str(value))
        if getattr(error, "args", None):
            parts.extend(str(arg) for arg in error.args)

    lowered = " ".join(parts).lower()
    return "meeting_transcripts" in lowered and (
        "pgrst205" in lowered
        or "could not find the table" in lowered
        or "does not exist" in lowered
    )


def insert_meeting_transcript(transcript: dict[str, Any]) -> dict[str, Any]:
    now = utc_now_iso()
    entries = transcript.get("entries") or []
    if not isinstance(entries, list):
        entries = []

    full_text = transcript.get("full_text")
    if full_text is None:
        full_text = _build_transcript_full_text(entries)

    payload = {
        "user_id": str(transcript["user_id"]),
        "meeting_id": str(transcript["meeting_id"]),
        "project_id": str(transcript["project_id"]),
        "project_name": transcript.get("project_name"),
        "based_on_meeting_id": transcript.get("based_on_meeting_id"),
        "entries": entries,
        "full_text": full_text or "",
        "updated_at": now,
    }
    agenda = (transcript.get("meeting_agenda") or transcript.get("meetingAgenda") or "").strip()
    if agenda:
        payload["meeting_agenda"] = agenda

    existing = get_meeting_transcript(str(transcript["meeting_id"]), str(transcript["user_id"]))
    try:
        if existing:
            response = (
                get_supabase()
                .table("meeting_transcripts")
                .update(payload)
                .eq("user_id", str(transcript["user_id"]))
                .eq("meeting_id", str(transcript["meeting_id"]))
                .execute()
            )
            updated = (response.data or [None])[0]
            return serialize_record(updated) if updated else existing

        payload["created_at"] = now
        response = get_supabase().table("meeting_transcripts").insert(payload).execute()
        created = (response.data or [None])[0]
        if not created:
            raise SupabaseStoreError("Failed to save meeting transcript.")
        return serialize_record(created) or {}
    except Exception as error:
        if _is_missing_meeting_transcripts_table(error):
            raise SupabaseStoreError(
                "meeting_transcripts table is missing. Run supabase/migrations/003_meeting_versioning.sql"
            ) from error
        raise


def get_meeting_transcript(meeting_id: str, user_id: str) -> Optional[dict[str, Any]]:
    try:
        response = (
            get_supabase()
            .table("meeting_transcripts")
            .select("*")
            .eq("meeting_id", str(meeting_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return serialize_record(rows[0]) if rows else None
    except Exception as error:
        if _is_missing_meeting_transcripts_table(error):
            return None
        raise


def list_meeting_transcripts_by_project(project_id: str, user_id: str) -> list[dict[str, Any]]:
    try:
        response = (
            get_supabase()
            .table("meeting_transcripts")
            .select("*")
            .eq("project_id", str(project_id))
            .eq("user_id", str(user_id))
            .order("created_at", desc=True)
            .execute()
        )
        return serialize_records(response.data or [])
    except Exception as error:
        if _is_missing_meeting_transcripts_table(error):
            print(
                "Warning: meeting_transcripts table missing — run supabase/migrations/003_meeting_versioning.sql"
            )
            return []
        raise


def _resolve_meeting_agenda(
    doc: Optional[dict[str, Any]],
    transcript: Optional[dict[str, Any]],
) -> Optional[str]:
    for source in (doc, transcript):
        if not source:
            continue
        agenda = (source.get("meeting_agenda") or source.get("meetingAgenda") or "").strip()
        if agenda:
            return agenda
    return None


def build_project_meeting_history(
    project_id: str,
    user_id: str,
    *,
    summary: bool = True,
) -> list[dict[str, Any]]:
    if summary:
        documents = list_generated_document_summaries_by_project(project_id, user_id)
        transcripts = list_meeting_transcript_summaries_by_project(project_id, user_id)
    else:
        documents = list_generated_documents_by_project(project_id, user_id)
        transcripts = list_meeting_transcripts_by_project(project_id, user_id)

    doc_by_meeting: dict[str, dict[str, Any]] = {}
    for doc in documents:
        meeting_id = doc.get("meeting_id")
        if not meeting_id:
            continue
        meeting_key = str(meeting_id)
        existing = doc_by_meeting.get(meeting_key)
        if not existing or str(doc.get("created_at") or "") >= str(existing.get("created_at") or ""):
            doc_by_meeting[meeting_key] = doc

    transcript_by_meeting = {str(row["meeting_id"]): row for row in transcripts if row.get("meeting_id")}

    meetings: list[dict[str, Any]] = []
    seen_meeting_ids: set[str] = set()

    for meeting_id in set(doc_by_meeting.keys()) | set(transcript_by_meeting.keys()):
        doc = doc_by_meeting.get(meeting_id)
        transcript = transcript_by_meeting.get(meeting_id)
        if not doc and meeting_id in transcript_by_meeting:
            meeting_docs = list_generated_documents_by_meeting(meeting_id, user_id)
            if meeting_docs:
                doc = meeting_docs[0]
                doc_by_meeting[meeting_id] = doc
        created_at = None
        if doc and doc.get("created_at"):
            created_at = doc.get("created_at")
        elif transcript and transcript.get("created_at"):
            created_at = transcript.get("created_at")

        meetings.append(
            {
                "meeting_id": meeting_id,
                "created_at": created_at,
                "meeting_agenda": _resolve_meeting_agenda(doc, transcript),
                "based_on_meeting_id": (doc or {}).get("based_on_meeting_id")
                or (transcript or {}).get("based_on_meeting_id"),
                "document": doc,
                "transcript": transcript,
                "storage_source": "supabase",
            }
        )
        seen_meeting_ids.add(meeting_id)

    for doc in documents:
        if doc.get("meeting_id"):
            continue
        doc_id = str(doc.get("_id") or doc.get("id") or "")
        synthetic_id = f"import-{doc_id}" if doc_id else f"import-{len(meetings)}"
        meetings.append(
            {
                "meeting_id": synthetic_id,
                "created_at": doc.get("created_at"),
                "meeting_agenda": _resolve_meeting_agenda(doc, None),
                "based_on_meeting_id": doc.get("based_on_meeting_id"),
                "document": doc,
                "transcript": None,
                "is_import": True,
                "storage_source": "supabase",
            }
        )

    meetings.sort(
        key=lambda item: str(item.get("created_at") or ""),
        reverse=True,
    )
    return meetings


def delete_project_meeting_data(
    project_id: str,
    user_id: str,
    meeting_id: str,
    *,
    document_id: Optional[str] = None,
    is_import: bool = False,
) -> dict[str, int]:
    client = get_supabase()
    counts = {
        "documents_deleted": 0,
        "transcripts_deleted": 0,
        "summaries_deleted": 0,
        "mvpvisions_deleted": 0,
        "sessions_deleted": 0,
        "admins_deleted": 0,
    }

    if is_import:
        if not document_id or not _is_valid_uuid(document_id):
            raise SupabaseStoreError("A valid document ID is required to delete imported meetings.")
        deleted = delete_generated_document(document_id, user_id)
        if not deleted:
            raise SupabaseStoreError("Imported document not found or access denied.")
        counts["documents_deleted"] = 1
        return counts

    meeting_key = str(meeting_id)
    docs = (
        client.table("generated_documents")
        .delete()
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .eq("meeting_id", meeting_key)
        .execute()
    )
    counts["documents_deleted"] = len(docs.data or [])

    try:
        transcripts = (
            client.table("meeting_transcripts")
            .delete()
            .eq("project_id", str(project_id))
            .eq("user_id", str(user_id))
            .eq("meeting_id", meeting_key)
            .execute()
        )
        counts["transcripts_deleted"] = len(transcripts.data or [])
    except Exception as error:
        if not _is_missing_meeting_transcripts_table(error):
            raise

    summaries = (
        client.table("meeting_summaries")
        .delete()
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .eq("meeting_id", meeting_key)
        .execute()
    )
    counts["summaries_deleted"] = len(summaries.data or [])

    mvp = (
        client.table("meeting_mvpvisions")
        .delete()
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .eq("meeting_id", meeting_key)
        .execute()
    )
    counts["mvpvisions_deleted"] = len(mvp.data or [])

    try:
        client.table("meeting_document_sessions").delete().eq("meeting_id", meeting_key).execute()
        counts["sessions_deleted"] = 1
    except Exception:
        pass

    admins = (
        client.table("meeting_admins")
        .delete()
        .eq("meeting_id", meeting_key)
        .execute()
    )
    counts["admins_deleted"] = len(admins.data or [])

    if counts["documents_deleted"] == 0 and counts["transcripts_deleted"] == 0:
        raise SupabaseStoreError("Meeting not found or access denied.")

    return counts


__all__ = [
    "SupabaseStoreError",
    "SupabaseConfigError",
]
