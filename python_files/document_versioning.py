"""Shared document version metadata helpers for external storage backends."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional


def parse_version_history(payload: dict[str, Any]) -> list[dict[str, Any]]:
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


def revision_rows_from_history(history: list[dict[str, Any]]) -> list[dict[str, str]]:
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


def apply_version_metadata(
    existing_payload: Optional[dict[str, Any]],
    document_payload: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    if existing_payload:
        current_version = int(existing_payload.get("version") or 1)
        new_version = current_version + 1
        history = parse_version_history(existing_payload)
    else:
        new_version = 1
        history = []

    version_created_at = (
        document_payload.get("versionCreatedAt")
        or document_payload.get("version_created_at")
        or now
    )
    history = [entry for entry in history if int(entry.get("version") or 0) != new_version]
    history.append({"version": new_version, "createdAt": version_created_at})

    merged = {
        **document_payload,
        "version": new_version,
        "versionCreatedAt": version_created_at,
        "version_history": history,
    }
    if not document_payload.get("revisionHistoryJson"):
        merged["revisionHistoryJson"] = json.dumps(
            revision_rows_from_history(history),
            separators=(",", ":"),
        )
    return merged
