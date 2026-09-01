"""
Google Drive REST storage for project meeting documents.

Each project gets a JSON file in a MARARE root folder on the user's Drive.
Used when document_storage resolves to google_drive for that project.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from python_files.base_urls import DRIVE_API_BASE, DRIVE_UPLOAD_BASE
from python_files.project_mcp import (
    ProjectMCPError,
    get_valid_project_google_drive_access_token,
)
ROOT_FOLDER_NAME = "MARARE MCP Documents"
DOCUMENT_TITLE_PREFIX = "MARARE Project Document"
MEETING_DOCUMENT_TITLE_PREFIX = "MARARE Meeting"
DOCUMENT_MIME_TYPE = "application/json"


class GoogleDriveDocumentError(RuntimeError):
    """Raised when Drive document storage fails."""


def drive_document_title(project_id: str) -> str:
    return f"{DOCUMENT_TITLE_PREFIX} - {project_id}.json"


def drive_meeting_document_title(meeting_id: str) -> str:
    """One JSON file per meeting when the project uses Google Drive as primary storage."""
    return f"{MEETING_DOCUMENT_TITLE_PREFIX} - {meeting_id}.json"


def _resolve_meeting_id(document_payload: dict[str, Any]) -> Optional[str]:
    meeting_id = str(
        document_payload.get("meetingId")
        or document_payload.get("meeting_id")
        or ""
    ).strip()
    return meeting_id or None


def _headers(token: str, *, content_type: Optional[str] = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _query_literal(value: str) -> str:
    escaped = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


def _raise_for_drive_response(response: httpx.Response, action: str) -> None:
    if response.status_code < 400:
        return
    try:
        payload = response.json()
        message = payload.get("error", {}).get("message") or response.text
    except Exception:
        message = response.text
    raise GoogleDriveDocumentError(f"Google Drive {action} failed: {message}")


def _list_files(token: str, query: str, *, page_size: int = 10) -> list[dict[str, Any]]:
    response = httpx.get(
        f"{DRIVE_API_BASE}/files",
        headers=_headers(token),
        params={
            "q": query,
            "spaces": "drive",
            "pageSize": page_size,
            "fields": "files(id,name,mimeType,parents,createdTime,modifiedTime,webViewLink)",
            "orderBy": "modifiedTime desc",
        },
        timeout=30,
    )
    _raise_for_drive_response(response, "search")
    return response.json().get("files", [])


def _find_folder(token: str, name: str, parent_id: Optional[str] = None) -> Optional[dict[str, Any]]:
    query = (
        f"name={_query_literal(name)} "
        "and mimeType='application/vnd.google-apps.folder' "
        "and trashed=false"
    )
    if parent_id:
        query += f" and {_query_literal(parent_id)} in parents"
    folders = _list_files(token, query, page_size=1)
    return folders[0] if folders else None


def _create_folder(token: str, name: str, parent_id: Optional[str] = None) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    if parent_id:
        metadata["parents"] = [parent_id]
    response = httpx.post(
        f"{DRIVE_API_BASE}/files",
        headers=_headers(token, content_type="application/json"),
        json=metadata,
        params={"fields": "id,name,mimeType,parents,createdTime,modifiedTime,webViewLink"},
        timeout=30,
    )
    _raise_for_drive_response(response, "folder create")
    return response.json()


def _ensure_folder(token: str, name: str, parent_id: Optional[str] = None) -> dict[str, Any]:
    return _find_folder(token, name, parent_id=parent_id) or _create_folder(token, name, parent_id=parent_id)


def _find_document_file(token: str, file_name: str, parent_id: str) -> Optional[dict[str, Any]]:
    query = (
        f"name={_query_literal(file_name)} "
        f"and {_query_literal(parent_id)} in parents "
        "and trashed=false"
    )
    files = _list_files(token, query, page_size=1)
    return files[0] if files else None


def _list_meeting_document_files(token: str, parent_id: str) -> list[dict[str, Any]]:
    """List per-meeting JSON files stored under the project folder."""
    query = (
        f"name contains {_query_literal(MEETING_DOCUMENT_TITLE_PREFIX)} "
        f"and {_query_literal(parent_id)} in parents "
        f"and mimeType={_query_literal(DOCUMENT_MIME_TYPE)} "
        "and trashed=false"
    )
    return _list_files(token, query, page_size=100)


def _create_json_file(token: str, file_name: str, parent_id: str, content: str) -> dict[str, Any]:
    metadata = {"name": file_name, "mimeType": DOCUMENT_MIME_TYPE, "parents": [parent_id]}
    boundary = "marare_drive_json_boundary"
    body = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{json.dumps(metadata)}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: {DOCUMENT_MIME_TYPE}; charset=UTF-8\r\n\r\n"
        f"{content}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    response = httpx.post(
        f"{DRIVE_UPLOAD_BASE}/files",
        headers=_headers(token, content_type=f"multipart/related; boundary={boundary}"),
        params={"uploadType": "multipart", "fields": "id,name,mimeType,parents,createdTime,modifiedTime,webViewLink"},
        content=body,
        timeout=60,
    )
    _raise_for_drive_response(response, "file create")
    return response.json()


def _update_json_file(token: str, file_id: str, content: str) -> dict[str, Any]:
    response = httpx.patch(
        f"{DRIVE_UPLOAD_BASE}/files/{file_id}",
        headers=_headers(token, content_type=DOCUMENT_MIME_TYPE),
        params={"uploadType": "media", "fields": "id,name,mimeType,parents,createdTime,modifiedTime,webViewLink"},
        content=content.encode("utf-8"),
        timeout=60,
    )
    _raise_for_drive_response(response, "file update")
    return response.json()


def _download_file(token: str, file_id: str) -> str:
    response = httpx.get(
        f"{DRIVE_API_BASE}/files/{file_id}",
        headers=_headers(token),
        params={"alt": "media"},
        timeout=60,
    )
    _raise_for_drive_response(response, "file download")
    return response.text


def _document_payload(project_id: str, project_name: str, document_payload: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        **document_payload,
        "schemaVersion": document_payload.get("schemaVersion") or 1,
        "documentId": f"{DOCUMENT_TITLE_PREFIX} - {project_id}",
        "projectId": str(project_id),
        "projectName": project_name,
        "title": document_payload.get("title") or f"{DOCUMENT_TITLE_PREFIX} - {project_id}",
        "updatedAt": document_payload.get("updatedAt") or now,
        "source": "google_drive_rest",
    }


def _parse_version_history(payload: dict[str, Any]) -> list[dict[str, Any]]:
    history = payload.get("version_history") or payload.get("versionHistory") or []
    if isinstance(history, list) and history:
        return [entry for entry in history if isinstance(entry, dict)]

    revision_json = payload.get("revisionHistoryJson") or payload.get("revision_history_json")
    if not revision_json:
        return []

    try:
        rows = json.loads(revision_json) if isinstance(revision_json, str) else revision_json
    except (TypeError, json.JSONDecodeError):
        return []

    if not isinstance(rows, list):
        return []

    parsed: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        revision = str(row.get("revision") or "")
        digits = "".join(char for char in revision if char.isdigit())
        if not digits:
            continue
        parsed.append(
            {
                "version": int(digits),
                "createdAt": row.get("date") or row.get("createdAt") or "",
            }
        )
    return parsed


def _revision_rows_from_history(history: list[dict[str, Any]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for entry in history:
        created = entry.get("createdAt") or entry.get("created_at") or ""
        date_str = str(created)[:10]
        if created:
            try:
                date_str = datetime.fromisoformat(str(created).replace("Z", "+00:00")).strftime("%m/%d/%Y")
            except ValueError:
                date_str = str(created)[:10]
        rows.append(
            {
                "date": date_str,
                "revision": f"v{entry.get('version', 1)}",
            }
        )
    return rows


def _apply_version_metadata(
    existing_payload: Optional[dict[str, Any]],
    document_payload: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    if existing_payload:
        current_version = int(existing_payload.get("version") or 1)
        new_version = current_version + 1
        history = _parse_version_history(existing_payload)
    else:
        new_version = 1
        history = []

    version_created_at = (
        document_payload.get("versionCreatedAt")
        or document_payload.get("version_created_at")
        or now
    )
    history = [
        entry
        for entry in history
        if int(entry.get("version") or 0) != new_version
    ]
    history.append({"version": new_version, "createdAt": version_created_at})

    merged = {
        **document_payload,
        "version": new_version,
        "versionCreatedAt": version_created_at,
        "version_history": history,
    }
    if not document_payload.get("revisionHistoryJson"):
        merged["revisionHistoryJson"] = json.dumps(
            _revision_rows_from_history(history),
            separators=(",", ":"),
        )
    return merged


def save_project_document_to_drive(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    document_payload: dict[str, Any],
) -> dict[str, Any]:
    if not project_id or not user_id:
        raise GoogleDriveDocumentError("project_id and user_id are required.")
    if not project_name:
        raise GoogleDriveDocumentError("project_name is required.")
    if not isinstance(document_payload, dict) or not document_payload:
        raise GoogleDriveDocumentError("document payload is required.")

    try:
        token = get_valid_project_google_drive_access_token(project_id, user_id=user_id)
    except ProjectMCPError as exc:
        raise GoogleDriveDocumentError(str(exc)) from exc

    root_folder = _ensure_folder(token, ROOT_FOLDER_NAME)
    project_folder = _ensure_folder(token, project_name, parent_id=root_folder["id"])
    meeting_id = _resolve_meeting_id(document_payload)
    file_name = (
        drive_meeting_document_title(meeting_id)
        if meeting_id
        else drive_document_title(project_id)
    )
    existing = _find_document_file(token, file_name, project_folder["id"])
    existing_payload: Optional[dict[str, Any]] = None
    if existing:
        try:
            existing_payload = json.loads(_download_file(token, existing["id"]))
        except (json.JSONDecodeError, GoogleDriveDocumentError):
            existing_payload = None

    payload = _document_payload(project_id, project_name, document_payload)
    payload = _apply_version_metadata(existing_payload, payload)
    content = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)

    file_data = (
        _update_json_file(token, existing["id"], content)
        if existing
        else _create_json_file(token, file_name, project_folder["id"], content)
    )

    return {
        "success": True,
        "found": True,
        "document": payload,
        "fileId": file_data.get("id"),
        "fileName": file_data.get("name") or file_name,
        "mimeType": file_data.get("mimeType"),
        "modifiedTime": file_data.get("modifiedTime"),
        "webViewLink": file_data.get("webViewLink"),
        "folderId": project_folder["id"],
        "source": "google_drive_rest",
        "message": "Document saved to Google Drive.",
    }


def _retrieve_document_file_from_project_folder(
    *,
    token: str,
    project_id: str,
    project_name: str,
    file_name: str,
) -> dict[str, Any]:
    root_folder = _find_folder(token, ROOT_FOLDER_NAME)
    if not root_folder:
        return {"found": False, "content": "", "source": "google_drive_rest"}

    project_folder = _find_folder(token, project_name, parent_id=root_folder["id"])
    if not project_folder:
        return {"found": False, "content": "", "source": "google_drive_rest"}

    file_data = _find_document_file(token, file_name, project_folder["id"])
    if not file_data:
        return {"found": False, "content": "", "source": "google_drive_rest"}

    content = _download_file(token, file_data["id"])
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise GoogleDriveDocumentError("Stored Google Drive document is not valid JSON.") from exc

    return {
        "found": True,
        "document": payload,
        "fileId": file_data.get("id"),
        "fileName": file_data.get("name") or file_name,
        "mimeType": file_data.get("mimeType"),
        "modifiedTime": file_data.get("modifiedTime"),
        "webViewLink": file_data.get("webViewLink"),
        "folderId": project_folder["id"],
        "source": "google_drive_rest",
    }


def retrieve_meeting_document_from_drive(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    meeting_id: str,
) -> dict[str, Any]:
    if not project_id or not user_id:
        raise GoogleDriveDocumentError("project_id and user_id are required.")
    if not project_name:
        raise GoogleDriveDocumentError("project_name is required.")
    if not meeting_id:
        raise GoogleDriveDocumentError("meeting_id is required.")

    try:
        token = get_valid_project_google_drive_access_token(project_id, user_id=user_id)
    except ProjectMCPError as exc:
        raise GoogleDriveDocumentError(str(exc)) from exc

    return _retrieve_document_file_from_project_folder(
        token=token,
        project_id=project_id,
        project_name=project_name,
        file_name=drive_meeting_document_title(str(meeting_id)),
    )


def retrieve_project_document_from_drive(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
) -> dict[str, Any]:
    if not project_id or not user_id:
        raise GoogleDriveDocumentError("project_id and user_id are required.")
    if not project_name:
        raise GoogleDriveDocumentError("project_name is required.")

    try:
        token = get_valid_project_google_drive_access_token(project_id, user_id=user_id)
    except ProjectMCPError as exc:
        raise GoogleDriveDocumentError(str(exc)) from exc

    return _retrieve_document_file_from_project_folder(
        token=token,
        project_id=project_id,
        project_name=project_name,
        file_name=drive_document_title(project_id),
    )


def list_project_meeting_documents_from_drive(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
) -> list[dict[str, Any]]:
    """
    Return every meeting document JSON for a project folder.

    Includes per-meeting files (MARARE Meeting - {meeting_id}.json) and, for
    backward compatibility, a legacy single project document if present.
    """
    if not project_id or not user_id or not project_name:
        return []

    try:
        token = get_valid_project_google_drive_access_token(project_id, user_id=user_id)
    except ProjectMCPError:
        return []

    root_folder = _find_folder(token, ROOT_FOLDER_NAME)
    if not root_folder:
        return []

    project_folder = _find_folder(token, project_name, parent_id=root_folder["id"])
    if not project_folder:
        return []

    folder_id = str(project_folder["id"])
    results: list[dict[str, Any]] = []
    seen_meeting_ids: set[str] = set()

    for file_data in _list_meeting_document_files(token, folder_id):
        file_id = file_data.get("id")
        if not file_id:
            continue
        try:
            payload = json.loads(_download_file(token, str(file_id)))
        except (json.JSONDecodeError, GoogleDriveDocumentError):
            continue
        if not isinstance(payload, dict):
            continue

        meeting_id = _resolve_meeting_id(payload) or str(file_data.get("name") or "")
        if meeting_id:
            seen_meeting_ids.add(meeting_id)

        results.append(
            {
                "document": payload,
                "fileId": file_id,
                "fileName": file_data.get("name"),
                "modifiedTime": file_data.get("modifiedTime"),
                "webViewLink": file_data.get("webViewLink"),
            }
        )

    legacy_name = drive_document_title(project_id)
    legacy_file = _find_document_file(token, legacy_name, folder_id)
    if legacy_file and legacy_file.get("id"):
        try:
            legacy_payload = json.loads(_download_file(token, str(legacy_file["id"])))
        except (json.JSONDecodeError, GoogleDriveDocumentError):
            legacy_payload = None

        if isinstance(legacy_payload, dict):
            legacy_meeting_id = _resolve_meeting_id(legacy_payload) or f"marare-document-{project_id}"
            if legacy_meeting_id not in seen_meeting_ids:
                results.append(
                    {
                        "document": legacy_payload,
                        "fileId": legacy_file.get("id"),
                        "fileName": legacy_file.get("name"),
                        "modifiedTime": legacy_file.get("modifiedTime"),
                        "webViewLink": legacy_file.get("webViewLink"),
                    }
                )

    results.sort(
        key=lambda item: str(item.get("modifiedTime") or ""),
        reverse=True,
    )
    return results
