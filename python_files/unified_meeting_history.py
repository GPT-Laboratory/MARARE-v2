"""
Build unified meeting history lists from Notion and Google Drive.

Supabase history comes from supabase_store.build_project_meeting_history.
This module normalizes external documents into the same shape the frontend expects,
including storage_source tags (notion / google_drive).
"""

from __future__ import annotations

from typing import Any, Optional

from python_files.document_storage import (
    STORAGE_GOOGLE_DRIVE,
    STORAGE_NOTION,
    _is_drive_ready,
    _is_notion_ready,
)
from python_files.google_drive_documents import (
    GoogleDriveDocumentError,
    list_project_meeting_documents_from_drive,
    retrieve_project_document_from_drive,
)
from python_files.notion_meeting_storage import (
    NotionMeetingStorageError,
    notion_storage_context,
    query_documents as notion_query_documents,
)
from python_files.project_mcp import get_project_notion_config


def _resolve_meeting_agenda(document: Optional[dict[str, Any]]) -> Optional[str]:
    if not document:
        return None
    for key in ("meeting_agenda", "meetingAgenda", "agenda"):
        value = document.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_transcript_from_payload(payload: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Build a transcript object for meeting history from embedded document payload."""
    if not isinstance(payload, dict):
        return None

    entries = payload.get("transcriptEntries") or payload.get("transcript_entries") or []
    if not isinstance(entries, list):
        entries = []

    full_text = (
        payload.get("transcriptFullText")
        or payload.get("transcript_full_text")
        or payload.get("fullText")
        or payload.get("full_text")
        or ""
    )

    if not entries and not str(full_text).strip():
        return None

    speaker_names = sorted(
        {
            str(entry.get("speaker_name") or entry.get("speakerName") or "Unknown")
            for entry in entries
            if isinstance(entry, dict)
        }
    )

    meeting_id = str(payload.get("meetingId") or payload.get("meeting_id") or "")
    return {
        "meeting_id": meeting_id,
        "project_id": payload.get("projectId") or payload.get("project_id"),
        "entries": entries,
        "full_text": full_text,
        "entry_count": len(entries),
        "speaker_names": speaker_names,
        "has_transcript": bool(entries or str(full_text).strip()),
        "meeting_agenda": _resolve_meeting_agenda(payload),
        "created_at": payload.get("updatedAt") or payload.get("updated_at"),
    }


def _extract_transcript_from_mcp_document(document: dict[str, Any]) -> Optional[dict[str, Any]]:
    entries = document.get("transcript_entries") or document.get("transcriptEntries") or []
    if not isinstance(entries, list):
        entries = []
    full_text = (
        document.get("transcript_full_text")
        or document.get("transcriptFullText")
        or ""
    )
    if not entries and not str(full_text).strip():
        return None

    speaker_names = sorted(
        {
            str(entry.get("speaker_name") or entry.get("speakerName") or "Unknown")
            for entry in entries
            if isinstance(entry, dict)
        }
    )
    return {
        "meeting_id": document.get("meeting_id"),
        "project_id": document.get("project_id"),
        "entries": entries,
        "full_text": full_text,
        "entry_count": len(entries),
        "speaker_names": speaker_names,
        "has_transcript": True,
        "meeting_agenda": _resolve_meeting_agenda(document),
        "created_at": document.get("created_at") or document.get("updated_at"),
    }


def _mcp_document_to_summary(document: dict[str, Any]) -> dict[str, Any]:
    page_id = str(document.get("_id") or document.get("id") or "")
    meeting_id = str(document.get("meeting_id") or page_id or "")
    generated_sections = document.get("generated_sections") or document.get("generatedSections") or {}
    return {
        "_id": f"notion-{page_id}" if page_id else f"notion-{meeting_id}",
        "id": f"notion-{page_id}" if page_id else f"notion-{meeting_id}",
        "source": "notion",
        "meeting_id": meeting_id,
        "project_id": document.get("project_id"),
        "project_name": document.get("project_name"),
        "meeting_agenda": _resolve_meeting_agenda(document),
        "meeting_phase": document.get("meeting_phase"),
        "version": document.get("version", 1),
        "created_at": document.get("created_at") or document.get("updated_at"),
        "updated_at": document.get("updated_at"),
        "version_created_at": document.get("version_created_at") or document.get("versionCreatedAt"),
        "version_history": document.get("version_history") or document.get("versionHistory") or [],
        "template": document.get("template"),
        "generated_sections": generated_sections,
        "notionPageId": page_id,
    }


def _drive_payload_to_summary(
    payload: dict[str, Any],
    *,
    project_id: str,
    project_name: str,
    file_meta: dict[str, Any],
) -> dict[str, Any]:
    meeting_id = str(
        payload.get("meetingId")
        or payload.get("meeting_id")
        or f"marare-document-{project_id}"
    )
    sections_json = payload.get("sectionsJson") or payload.get("sections_json") or "[]"
    generated_sections: dict[str, str] = {}
    template_sections: list[dict[str, Any]] = []
    categories: dict[str, Any] = {}

    try:
        import json

        parsed_sections = json.loads(sections_json) if isinstance(sections_json, str) else sections_json
        if isinstance(parsed_sections, list):
            for index, section in enumerate(parsed_sections):
                if not isinstance(section, dict):
                    continue
                section_id = str(section.get("id") or f"google_drive_section_{index + 1}")
                category = str(section.get("category") or "google_drive")
                generated_sections[section_id] = str(section.get("content") or "")
                if category not in categories:
                    categories[category] = {
                        "title": section.get("categoryTitle") or category.replace("_", " ").title(),
                    }
                template_sections.append(
                    {
                        "id": section_id,
                        "title": section.get("title") or section_id,
                        "category": category,
                    }
                )
    except Exception:
        parsed_sections = []

    version_history = payload.get("version_history") or payload.get("versionHistory") or []
    created_at = (
        file_meta.get("modifiedTime")
        or payload.get("updatedAt")
        or payload.get("updated_at")
    )

    return {
        "_id": f"google-drive-{meeting_id}",
        "id": f"google-drive-{meeting_id}",
        "source": "google_drive",
        "meeting_id": meeting_id,
        "project_id": project_id,
        "project_name": payload.get("projectName") or project_name,
        "meeting_agenda": _resolve_meeting_agenda(payload),
        "version": payload.get("version", 1),
        "created_at": created_at,
        "updated_at": payload.get("updatedAt") or payload.get("updated_at"),
        "version_created_at": payload.get("versionCreatedAt") or payload.get("version_created_at"),
        "version_history": version_history,
        "template": {
            "categories": categories,
            "sections": template_sections,
        },
        "generated_sections": generated_sections,
        "driveFileId": file_meta.get("fileId"),
        "webViewLink": file_meta.get("webViewLink"),
        "rawDriveDocument": payload,
    }


def _meeting_entry(
    *,
    meeting_id: str,
    created_at: Optional[str],
    document: Optional[dict[str, Any]],
    storage_source: str,
    meeting_agenda: Optional[str] = None,
    based_on_meeting_id: Optional[str] = None,
    transcript: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return {
        "meeting_id": meeting_id,
        "created_at": created_at,
        "meeting_agenda": meeting_agenda or _resolve_meeting_agenda(document),
        "based_on_meeting_id": based_on_meeting_id,
        "document": document,
        "transcript": transcript,
        "storage_source": storage_source,
        "is_external": storage_source != "supabase",
    }


def build_notion_project_meeting_history(
    project_id: str,
    user_id: str,
    *,
    project_name: str = "",
) -> list[dict[str, Any]]:
    if not _is_notion_ready(project_id, user_id):
        return []

    config = get_project_notion_config(project_id, user_id=user_id, include_token=False) or {}
    database_id = config.get("notion_meeting_database_id")
    if not database_id:
        return []

    try:
        ctx = notion_storage_context(
            project_id,
            user_id,
            str(database_id),
            data_source_id=config.get("notion_meeting_data_source_id"),
            data_source_url=config.get("notion_meeting_data_source_url"),
        )
        documents = notion_query_documents(
            project_id,
            user_id,
            ctx["database_id"],
            data_source_id=ctx.get("data_source_id"),
            data_source_url=ctx.get("data_source_url"),
            filter_project_id=str(project_id),
            filter_user_id=str(user_id),
        )
    except NotionMeetingStorageError:
        return []

    latest_by_meeting: dict[str, dict[str, Any]] = {}
    for document in documents:
        if not isinstance(document, dict):
            continue
        meeting_id = str(document.get("meeting_id") or document.get("_id") or "")
        if not meeting_id:
            continue
        existing = latest_by_meeting.get(meeting_id)
        if not existing or int(document.get("version") or 0) >= int(existing.get("version") or 0):
            latest_by_meeting[meeting_id] = document

    meetings: list[dict[str, Any]] = []
    for meeting_id, document in latest_by_meeting.items():
        summary = _mcp_document_to_summary(document)
        meetings.append(
            _meeting_entry(
                meeting_id=meeting_id,
                created_at=summary.get("created_at"),
                document=summary,
                storage_source=STORAGE_NOTION,
                meeting_agenda=summary.get("meeting_agenda"),
                based_on_meeting_id=document.get("based_on_meeting_id"),
                transcript=_extract_transcript_from_mcp_document(document),
            )
        )

    meetings.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return meetings


def build_google_drive_project_meeting_history(
    project_id: str,
    user_id: str,
    *,
    project_name: str = "",
) -> list[dict[str, Any]]:
    if not _is_drive_ready(project_id, user_id):
        return []

    if not project_name:
        return []

    try:
        stored_documents = list_project_meeting_documents_from_drive(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
        )
    except GoogleDriveDocumentError:
        return []

    if not stored_documents:
        # Backward compatibility: single legacy project document only.
        try:
            result = retrieve_project_document_from_drive(
                project_id=project_id,
                user_id=user_id,
                project_name=project_name,
            )
        except GoogleDriveDocumentError:
            return []

        if not result.get("found"):
            return []

        payload = result.get("document")
        if not isinstance(payload, dict):
            return []

        stored_documents = [
            {
                "document": payload,
                "fileId": result.get("fileId"),
                "webViewLink": result.get("webViewLink"),
                "modifiedTime": result.get("modifiedTime"),
            }
        ]

    latest_by_meeting: dict[str, dict[str, Any]] = {}
    for item in stored_documents:
        payload = item.get("document")
        if not isinstance(payload, dict):
            continue

        meeting_id = str(
            payload.get("meetingId")
            or payload.get("meeting_id")
            or f"marare-document-{project_id}"
        )
        existing = latest_by_meeting.get(meeting_id)
        existing_time = str((existing or {}).get("modifiedTime") or "")
        current_time = str(item.get("modifiedTime") or "")
        if not existing or current_time >= existing_time:
            latest_by_meeting[meeting_id] = item

    meetings: list[dict[str, Any]] = []
    for meeting_id, item in latest_by_meeting.items():
        payload = item["document"]
        summary = _drive_payload_to_summary(
            payload,
            project_id=str(project_id),
            project_name=project_name,
            file_meta={
                "fileId": item.get("fileId"),
                "webViewLink": item.get("webViewLink"),
                "modifiedTime": item.get("modifiedTime"),
            },
        )
        meetings.append(
            _meeting_entry(
                meeting_id=meeting_id,
                created_at=summary.get("created_at"),
                document=summary,
                storage_source=STORAGE_GOOGLE_DRIVE,
                meeting_agenda=summary.get("meeting_agenda"),
                transcript=_extract_transcript_from_payload(payload),
            )
        )

    meetings.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return meetings
