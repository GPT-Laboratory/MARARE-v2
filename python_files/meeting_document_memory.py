"""
In-memory + Supabase snapshot of an active document-generation session.

Tracks template sections, generated content, and transcript batches per meeting
while LangGraph agents run. Persisted to meeting_document_sessions in Supabase
so a refresh or reconnect can restore state.
"""

from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, Optional

from python_files.supabase_store import (
    delete_meeting_document_session,
    get_meeting_document_session as fetch_meeting_document_session,
    upsert_meeting_document_session,
)


def _utc_now() -> datetime:
    return datetime.utcnow()


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_transcripts_payload(transcripts: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    transcripts = transcripts or {}

    remote_users = transcripts.get("remoteUsers", {})
    if not isinstance(remote_users, dict):
        remote_users = {}

    normalized_remote_users = {}
    for speaker_id, value in remote_users.items():
        text = _safe_text(value)
        if text:
            normalized_remote_users[str(speaker_id)] = text

    local_user = _safe_text(transcripts.get("localUser"))
    agent_user = _safe_text(transcripts.get("agentUser"))

    remote_user = _safe_text(transcripts.get("remoteUser"))
    if not remote_user and normalized_remote_users:
        remote_user = " ".join(normalized_remote_users.values()).strip()

    return {
        "localUser": local_user,
        "remoteUser": remote_user,
        "remoteUsers": normalized_remote_users,
        "agentUser": agent_user,
    }


def flatten_transcript_chunk(transcripts: Optional[Dict[str, Any]]) -> str:
    normalized = normalize_transcripts_payload(transcripts)
    lines = []

    if normalized["localUser"]:
        lines.append(f"[Local User]: {normalized['localUser']}")

    remote_users = normalized.get("remoteUsers", {})
    if remote_users:
        for speaker_id, text in remote_users.items():
            short_id = str(speaker_id)[-6:]
            lines.append(f"[Remote User {short_id}]: {text}")
    elif normalized["remoteUser"]:
        lines.append(f"[Remote User]: {normalized['remoteUser']}")

    if normalized["agentUser"]:
        lines.append(f"[AI Agent]: {normalized['agentUser']}")

    return "\n".join(lines)


def get_document_session(meeting_id: str) -> Dict[str, Any]:
    return fetch_meeting_document_session(meeting_id)


def upsert_document_template_context(
    meeting_id: str,
    template: Optional[Dict[str, Any]],
    previous_sections: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    meeting_id = str(meeting_id)
    previous_sections = previous_sections or {}
    metadata = metadata or {}

    session = get_document_session(meeting_id)
    update_data = {
        "meeting_id": meeting_id,
        "template": template or session.get("template"),
        "previous_sections": previous_sections or session.get("previous_sections", {}),
        "metadata": {**session.get("metadata", {}), **metadata},
        "updated_at": _utc_now().isoformat(),
    }

    if not session:
        update_data.update({
            "created_at": _utc_now().isoformat(),
            "generated_sections": previous_sections or {},
            "undiscussed_topics": [],
            "meeting_status": {
                "phase": "ongoing",
                "transcript_count": 0,
                "last_activity": 0,
            },
            "transcript_history": [],
            "cumulative_transcript": "",
            "questions_sent": False,
        })

    return upsert_meeting_document_session(meeting_id, update_data)


def hydrate_hierarchy_runtime(meeting_id: str) -> Dict[str, Any]:
    session = get_document_session(meeting_id)
    if not session:
        return {}

    from python_files import langraph_agents_hierarchy as hierarchy

    template = session.get("template")
    previous_sections = session.get("previous_sections", {})

    if template:
        hierarchy.save_document_template(meeting_id, template, previous_sections)

    with hierarchy.STORAGE_LOCK:
        stored_generated_sections = session.get("generated_sections", {})
        if stored_generated_sections:
            merged_generated_sections = deepcopy(
                hierarchy.GENERATED_DOCUMENTS_STORAGE.get(meeting_id, {})
            )
            merged_generated_sections.update(deepcopy(stored_generated_sections))
            hierarchy.GENERATED_DOCUMENTS_STORAGE[meeting_id] = merged_generated_sections
        if "undiscussed_topics" in session:
            hierarchy.UNDISCUSSED_TOPICS_STORAGE[meeting_id] = deepcopy(
                session.get("undiscussed_topics", [])
            )
        if "meeting_status" in session:
            hierarchy.MEETING_STATUS_STORAGE[meeting_id] = deepcopy(
                session.get("meeting_status", {})
            )
        if "transcript_history" in session:
            hierarchy.TRANSCRIPTS_HISTORY_STORAGE[meeting_id] = deepcopy(
                session.get("transcript_history", [])
            )
        hierarchy.ALL_TRANSCRIPTS_TEXT[meeting_id] = session.get(
            "cumulative_transcript", ""
        )
        hierarchy.QUESTIONS_SENT_FLAG[meeting_id] = bool(
            session.get("questions_sent", False)
        )

    return session


def persist_runtime_snapshot(meeting_id: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meeting_id = str(meeting_id)
    metadata = metadata or {}

    from python_files import langraph_agents_hierarchy as hierarchy

    with hierarchy.STORAGE_LOCK:
        template_entry = deepcopy(hierarchy.DOCUMENT_TEMPLATES_STORAGE.get(meeting_id, {}))
        generated_sections = deepcopy(
            hierarchy.GENERATED_DOCUMENTS_STORAGE.get(meeting_id, {})
        )
        undiscussed_topics = deepcopy(
            hierarchy.UNDISCUSSED_TOPICS_STORAGE.get(meeting_id, [])
        )
        meeting_status = deepcopy(hierarchy.MEETING_STATUS_STORAGE.get(meeting_id, {}))
        transcript_history = deepcopy(
            hierarchy.TRANSCRIPTS_HISTORY_STORAGE.get(meeting_id, [])
        )
        cumulative_transcript = hierarchy.ALL_TRANSCRIPTS_TEXT.get(meeting_id, "")
        questions_sent = bool(hierarchy.QUESTIONS_SENT_FLAG.get(meeting_id, False))

    session = get_document_session(meeting_id)
    template = template_entry.get("template") or session.get("template")

    return upsert_meeting_document_session(
        meeting_id,
        {
            "meeting_id": meeting_id,
            "template": template,
            "generated_sections": generated_sections,
            "undiscussed_topics": undiscussed_topics,
            "meeting_status": meeting_status,
            "transcript_history": transcript_history,
            "cumulative_transcript": cumulative_transcript,
            "questions_sent": questions_sent,
            "metadata": {**session.get("metadata", {}), **metadata},
            "updated_at": _utc_now().isoformat(),
        },
    )


def reset_document_session(meeting_id: str) -> None:
    delete_meeting_document_session(str(meeting_id))
