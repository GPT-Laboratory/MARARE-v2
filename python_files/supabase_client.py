"""Supabase client and serialization helpers for the MARARE backend."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv()

try:
    from supabase import Client, create_client
except ImportError:  # pragma: no cover - handled at runtime
    Client = Any  # type: ignore[misc,assignment]
    create_client = None  # type: ignore[assignment]

from python_files.base_urls import get_supabase_url

_SUPABASE_CLIENT: Optional[Client] = None


class SupabaseConfigError(RuntimeError):
    """Raised when Supabase is not configured."""


def _supabase_url() -> str:
    return get_supabase_url()


def _supabase_service_key() -> str:
    return (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()


def get_supabase() -> Client:
    global _SUPABASE_CLIENT
    if _SUPABASE_CLIENT is not None:
        return _SUPABASE_CLIENT

    if create_client is None:
        raise SupabaseConfigError(
            "Python package 'supabase' is not installed. Add it to requirements.txt."
        )

    url = _supabase_url()
    key = _supabase_service_key()
    if not url or not key:
        raise SupabaseConfigError(
            "VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for backend storage."
        )

    _SUPABASE_CLIENT = create_client(url, key)
    return _SUPABASE_CLIENT


def is_supabase_configured() -> bool:
    try:
        get_supabase()
        return True
    except SupabaseConfigError:
        return False


def _coerce_datetime(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def serialize_record(record: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not record:
        return record

    row = dict(record)
    if "id" in row and "_id" not in row:
        row["_id"] = str(row["id"])

    for key in (
        "created_at",
        "updated_at",
        "timestamp",
        "version_created_at",
        "exp",
    ):
        if key in row:
            row[key] = _coerce_datetime(row[key])

    return row


def serialize_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [serialize_record(record) or {} for record in records]


def utc_now_iso() -> str:
    return datetime.utcnow().isoformat()


def merge_configuration_row(row: dict[str, Any]) -> dict[str, Any]:
    """Flatten mcp_configurations table rows for legacy Mongo-shaped callers."""
    configuration = row.get("configuration") or {}
    merged = dict(configuration)
    merged["user_id"] = row.get("user_id")
    merged["project_id"] = row.get("project_id")
    merged["provider"] = row.get("provider")
    if row.get("created_at"):
        merged["created_at"] = row["created_at"]
    if row.get("updated_at"):
        merged["updated_at"] = row["updated_at"]
    return merged
