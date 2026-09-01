"""Link legacy MongoDB user ids to new Supabase Auth users by email."""

from __future__ import annotations

import csv
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

from python_files.supabase_client import get_supabase, utc_now_iso

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

TABLES_WITH_USER_ID = (
    "projects",
    "generated_documents",
    "meeting_summaries",
    "meeting_mvpvisions",
    "mcp_configurations",
    "project_reports",
    "meeting_admins",
)


class UserMigrationError(RuntimeError):
    pass


def _normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def _is_valid_uuid(value: str) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


def _serialize_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _serialize_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    if hasattr(value, "__str__") and type(value).__name__ == "ObjectId":
        return str(value)
    return value


def _coerce_int(value: Any, default: int = 1) -> int:
    """Return default when Mongo stores null/missing/invalid version values."""
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_float(value: Any, default: float = 0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def load_users_csv(path: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            email = _normalize_email(
                row.get("email") or row.get("Email") or row.get("user_email") or ""
            )
            legacy_id = str(
                row.get("legacy_user_id")
                or row.get("id")
                or row.get("user_id")
                or row.get("uid")
                or ""
            ).strip()
            if email and legacy_id:
                rows.append({"email": email, "legacy_user_id": legacy_id})
    return rows


def fetch_auth_users_from_supabase(url: str, service_key: str) -> list[dict[str, str]]:
    import httpx

    base = url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }
    rows: list[dict[str, str]] = []
    page = 1
    per_page = 200
    while True:
        response = httpx.get(
            f"{base}/auth/v1/admin/users",
            headers=headers,
            params={"page": page, "per_page": per_page},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        users = payload.get("users") if isinstance(payload, dict) else payload
        if not isinstance(users, list) or not users:
            break
        for user in users:
            email = _normalize_email(user.get("email") or "")
            user_id = str(user.get("id") or "").strip()
            if email and user_id:
                rows.append(
                    {
                        "email": email,
                        "legacy_user_id": user_id,
                        "new_user_id": user_id,
                    }
                )
        if len(users) < per_page:
            break
        page += 1
    return rows


def upsert_migration_user_map(rows: list[dict[str, str]]) -> int:
    client = get_supabase()
    count = 0
    for row in rows:
        email = _normalize_email(row["email"])
        legacy_user_id = str(row["legacy_user_id"]).strip()
        if not EMAIL_RE.match(email) or not legacy_user_id:
            continue
        payload: dict[str, Any] = {
            "email": email,
            "legacy_user_id": legacy_user_id,
        }
        new_user_id = row.get("new_user_id")
        if new_user_id:
            payload["new_user_id"] = str(new_user_id).strip()
        client.table("migration_user_map").upsert(payload, on_conflict="email").execute()
        count += 1
    return count


def get_migration_map_by_email(email: str) -> Optional[dict[str, Any]]:
    response = (
        get_supabase()
        .table("migration_user_map")
        .select("*")
        .eq("email", _normalize_email(email))
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def verify_auth_user(email: str, user_id: str) -> bool:
    import httpx

    base = (os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not base or not service_key:
        return True

    try:
        response = httpx.get(
            f"{base}/auth/v1/admin/users/{user_id}",
            headers={
                "Authorization": f"Bearer {service_key}",
                "apikey": service_key,
            },
            timeout=30,
        )
        if response.status_code >= 400:
            return False
        payload = response.json()
        auth_user = payload if isinstance(payload, dict) else {}
        auth_email = _normalize_email(auth_user.get("email") or "")
        return auth_email == _normalize_email(email)
    except Exception:
        return False


def _replace_user_id(client: Any, table: str, legacy_user_id: str, new_user_id: str) -> int:
    existing = client.table(table).select("id").eq("user_id", legacy_user_id).execute()
    rows = existing.data or []
    if not rows:
        return 0
    client.table(table).update({"user_id": new_user_id}).eq("user_id", legacy_user_id).execute()
    return len(rows)


def link_user_data_by_email(*, email: str, new_user_id: str, verify: bool = True) -> dict[str, Any]:
    normalized_email = _normalize_email(email)
    if not normalized_email or not new_user_id:
        raise UserMigrationError("email and new_user_id are required.")

    if verify and not verify_auth_user(normalized_email, new_user_id):
        raise UserMigrationError("Supabase auth user does not match the provided email.")

    mapping = get_migration_map_by_email(normalized_email)
    if not mapping:
        return {
            "linked": False,
            "reason": "no_migration_map",
            "email": normalized_email,
        }

    legacy_user_id = str(mapping.get("legacy_user_id") or "").strip()
    if not legacy_user_id:
        raise UserMigrationError("Migration map entry is missing legacy_user_id.")

    if legacy_user_id == new_user_id:
        now = utc_now_iso()
        get_supabase().table("migration_user_map").update(
            {"new_user_id": new_user_id, "linked_at": now}
        ).eq("email", normalized_email).execute()
        return {
            "linked": True,
            "already_same_id": True,
            "email": normalized_email,
            "legacy_user_id": legacy_user_id,
            "new_user_id": new_user_id,
            "updated_counts": {},
        }

    existing_new = mapping.get("new_user_id")
    if existing_new and str(existing_new) != str(new_user_id):
        if mapping.get("linked_at"):
            return {
                "linked": False,
                "reason": "already_linked_to_different_user",
                "email": normalized_email,
            }

    client = get_supabase()
    updated_counts: dict[str, int] = {}
    for table in TABLES_WITH_USER_ID:
        updated_counts[table] = _replace_user_id(client, table, legacy_user_id, new_user_id)

    now = utc_now_iso()
    client.table("migration_user_map").update(
        {"new_user_id": new_user_id, "linked_at": now}
    ).eq("email", normalized_email).execute()

    return {
        "linked": True,
        "email": normalized_email,
        "legacy_user_id": legacy_user_id,
        "new_user_id": new_user_id,
        "updated_counts": updated_counts,
    }


def save_project_map(legacy_project_id: str, new_project_id: str, legacy_user_id: str) -> None:
    get_supabase().table("migration_project_map").upsert(
        {
            "legacy_project_id": str(legacy_project_id),
            "new_project_id": str(new_project_id),
            "legacy_user_id": str(legacy_user_id),
        },
        on_conflict="legacy_project_id",
    ).execute()


def map_project_id(project_map: dict[str, str], raw_project_id: Any) -> Optional[str]:
    if raw_project_id is None:
        return None
    legacy = str(raw_project_id).strip()
    if not legacy:
        return None
    if _is_valid_uuid(legacy):
        return legacy
    return project_map.get(legacy)


def map_user_id(user_map: dict[str, str], raw_user_id: Any) -> Optional[str]:
    if raw_user_id is None:
        return None
    legacy = str(raw_user_id).strip()
    if not legacy:
        return None
    return user_map.get(legacy, legacy)


def build_user_id_map_from_db() -> dict[str, str]:
    response = get_supabase().table("migration_user_map").select("*").execute()
    mapping: dict[str, str] = {}
    for row in response.data or []:
        legacy = str(row.get("legacy_user_id") or "").strip()
        new_id = str(row.get("new_user_id") or row.get("legacy_user_id") or "").strip()
        if legacy and new_id:
            mapping[legacy] = new_id
    return mapping


def build_user_id_map_from_rows(user_rows: list[dict[str, str]]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for row in user_rows:
        legacy = str(row.get("legacy_user_id") or "").strip()
        new_id = str(row.get("new_user_id") or legacy).strip()
        if legacy and new_id:
            mapping[legacy] = new_id
    return mapping


def discover_legacy_users_from_mongo(db: Any, collections: list[str]) -> set[str]:
    legacy_ids: set[str] = set()
    for name in collections:
        collection = db[name]
        for field in ("user_id", "userId"):
            try:
                for doc in collection.find({field: {"$exists": True, "$ne": None}}, {field: 1}):
                    value = doc.get(field)
                    if value:
                        legacy_ids.add(str(value))
            except Exception:
                continue
    return legacy_ids


def import_mongo_database(
    db: Any,
    *,
    dry_run: bool = False,
    skip_existing: bool = True,
    user_id_map_override: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    user_id_map = user_id_map_override or build_user_id_map_from_db()
    if not user_id_map:
        raise UserMigrationError(
            "migration_user_map is empty. Load legacy auth users before importing Mongo data."
        )

    project_map: dict[str, str] = {}
    stats: dict[str, int] = {
        "projects": 0,
        "generated_documents": 0,
        "meeting_summaries": 0,
        "meeting_mvpvisions": 0,
        "mcp_configurations": 0,
        "project_reports": 0,
        "meeting_document_sessions": 0,
        "meeting_admins": 0,
        "skipped": 0,
        "errors": 0,
    }
    errors: list[dict[str, str]] = []

    client = get_supabase()

    existing_projects = set()
    if skip_existing:
        existing = (
            client.table("migration_project_map")
            .select("legacy_project_id,new_project_id")
            .execute()
        )
        for row in existing.data or []:
            legacy_project_id = str(row.get("legacy_project_id") or "").strip()
            new_project_id = str(row.get("new_project_id") or "").strip()
            if legacy_project_id and new_project_id:
                existing_projects.add(legacy_project_id)
                project_map[legacy_project_id] = new_project_id

    def _record_insert_error(table: str, doc: dict[str, Any], exc: Exception) -> None:
        stats["errors"] += 1
        if len(errors) < 25:
            errors.append(
                {
                    "table": table,
                    "mongo_id": str(doc.get("_id") or ""),
                    "error": str(exc),
                }
            )

    for doc in db["projects"].find({}):
        legacy_project_id = str(doc.get("_id") or "").strip()
        if skip_existing and legacy_project_id in existing_projects:
            stats["skipped"] += 1
            continue

        legacy_user = str(doc.get("user_id") or doc.get("userId") or "").strip()
        new_user_id = map_user_id(user_id_map, legacy_user)
        if not new_user_id:
            stats["skipped"] += 1
            continue

        new_project_id = str(uuid4())
        project_map[legacy_project_id] = new_project_id

        payload = {
            "id": new_project_id,
            "user_id": new_user_id,
            "name": doc.get("name") or doc.get("project_name") or "Untitled Project",
            "template_document": _serialize_value(doc.get("template_document")),
            "mvp_vision_template": _serialize_value(
                doc.get("mvpVisiontemplate") or doc.get("mvp_vision_template")
            ),
            "created_at": _serialize_value(doc.get("created_at")) or utc_now_iso(),
        }
        if not dry_run:
            client.table("projects").insert(payload).execute()
            save_project_map(legacy_project_id, new_project_id, legacy_user)
        stats["projects"] += 1

    def resolve_project(raw: Any) -> Optional[str]:
        mapped = map_project_id(project_map, raw)
        return mapped

    def resolve_user(raw: Any) -> Optional[str]:
        return map_user_id(user_id_map, raw)

    for doc in db["document_template"].find({}):
        legacy_user = doc.get("user_id") or doc.get("userId")
        new_user_id = resolve_user(legacy_user)
        project_id = resolve_project(doc.get("project_id") or doc.get("projectId"))
        if not new_user_id or not project_id:
            stats["skipped"] += 1
            continue
        now = utc_now_iso()
        payload = {
            "user_id": new_user_id,
            "meeting_id": str(doc.get("meeting_id") or doc.get("meetingId") or "") or None,
            "project_id": project_id,
            "project_name": doc.get("project_name") or doc.get("projectName"),
            "template": _serialize_value(doc.get("template")),
            "generated_sections": _serialize_value(
                doc.get("generated_sections") or doc.get("generatedSections")
            ),
            "undiscussed_topics": _serialize_value(
                doc.get("undiscussed_topics") or doc.get("undiscussedTopics") or []
            ),
            "meeting_phase": doc.get("meeting_phase") or doc.get("meetingPhase"),
            "progress": _coerce_float(doc.get("progress"), 0),
            "timestamp": _serialize_value(doc.get("timestamp")) or now,
            "team_data": _serialize_value(doc.get("team_data") or doc.get("teamData")),
            "source": doc.get("source"),
            "version": _coerce_int(doc.get("version"), 1),
            "version_created_at": _serialize_value(
                doc.get("version_created_at") or doc.get("versionCreatedAt")
            )
            or now,
            "version_history": _serialize_value(
                doc.get("version_history") or doc.get("versionHistory") or []
            )
            or [],
            "created_at": _serialize_value(doc.get("created_at")) or now,
            "updated_at": _serialize_value(doc.get("updated_at")) or now,
        }
        if not dry_run:
            try:
                client.table("generated_documents").insert(payload).execute()
            except Exception as exc:
                _record_insert_error("generated_documents", doc, exc)
                continue
        stats["generated_documents"] += 1

    for doc in db["meeting_summary"].find({}):
        new_user_id = resolve_user(doc.get("user_id") or doc.get("userId"))
        project_id = resolve_project(doc.get("project_id") or doc.get("projectId"))
        if not new_user_id:
            stats["skipped"] += 1
            continue
        now = utc_now_iso()
        payload = {
            "user_id": new_user_id,
            "meeting_id": str(doc.get("meeting_id") or doc.get("meetingId") or "") or None,
            "project_id": project_id,
            "project_name": doc.get("project_name") or doc.get("projectName"),
            "summary_content": doc.get("summary_content") or doc.get("summaryContent"),
            "timestamp": _serialize_value(doc.get("timestamp")) or now,
            "team_data": _serialize_value(doc.get("team_data") or doc.get("teamData")),
            "version": _coerce_int(doc.get("version"), 1),
            "created_at": _serialize_value(doc.get("created_at")) or now,
            "updated_at": _serialize_value(doc.get("updated_at")) or now,
        }
        if not dry_run:
            try:
                client.table("meeting_summaries").insert(payload).execute()
            except Exception as exc:
                _record_insert_error("meeting_summaries", doc, exc)
                continue
        stats["meeting_summaries"] += 1

    for doc in db["meeting_mvpvision"].find({}):
        new_user_id = resolve_user(doc.get("user_id") or doc.get("userId"))
        project_id = resolve_project(doc.get("project_id") or doc.get("projectId"))
        if not new_user_id:
            stats["skipped"] += 1
            continue
        now = utc_now_iso()
        payload = {
            "user_id": new_user_id,
            "meeting_id": str(doc.get("meeting_id") or doc.get("meetingId") or "") or None,
            "project_id": project_id,
            "project_name": doc.get("project_name") or doc.get("projectName"),
            "mvp": doc.get("mvp") or "",
            "vision": doc.get("vision") or "",
            "timestamp": _serialize_value(doc.get("timestamp")) or now,
            "version": _coerce_int(doc.get("version"), 1),
            "created_at": _serialize_value(doc.get("created_at")) or now,
            "updated_at": _serialize_value(doc.get("updated_at")) or now,
        }
        if not dry_run:
            try:
                client.table("meeting_mvpvisions").insert(payload).execute()
            except Exception as exc:
                _record_insert_error("meeting_mvpvisions", doc, exc)
                continue
        stats["meeting_mvpvisions"] += 1

    for doc in db["mcp_configurations"].find({}):
        new_user_id = resolve_user(doc.get("user_id") or doc.get("userId"))
        project_id = resolve_project(doc.get("project_id") or doc.get("projectId"))
        provider = doc.get("provider")
        if not new_user_id or not project_id or not provider:
            stats["skipped"] += 1
            continue
        configuration = _serialize_value(
            {k: v for k, v in doc.items() if k not in {"_id", "user_id", "project_id", "provider"}}
        )
        now = utc_now_iso()
        payload = {
            "user_id": new_user_id,
            "project_id": project_id,
            "provider": provider,
            "configuration": configuration if isinstance(configuration, dict) else {},
            "created_at": _serialize_value(doc.get("created_at")) or now,
            "updated_at": _serialize_value(doc.get("updated_at")) or now,
        }
        if not dry_run:
            client.table("mcp_configurations").upsert(
                payload, on_conflict="user_id,project_id,provider"
            ).execute()
        stats["mcp_configurations"] += 1

    for doc in db["project_reports"].find({}):
        new_user_id = resolve_user(doc.get("user_id") or doc.get("userId"))
        project_id = resolve_project(doc.get("project_id") or doc.get("projectId"))
        if not project_id:
            stats["skipped"] += 1
            continue
        payload = {
            "project_id": project_id,
            "user_id": new_user_id,
            "file_id": str(doc.get("file_id") or doc.get("fileId") or "") or None,
            "metadata": _serialize_value(
                {k: v for k, v in doc.items() if k not in {"_id", "user_id", "project_id", "file_id"}}
            ),
            "created_at": _serialize_value(doc.get("created_at")) or utc_now_iso(),
        }
        if not dry_run:
            client.table("project_reports").insert(payload).execute()
        stats["project_reports"] += 1

    for doc in db["meeting_document_sessions"].find({}):
        meeting_id = str(doc.get("meeting_id") or doc.get("_id") or "").strip()
        if not meeting_id:
            stats["skipped"] += 1
            continue
        session_data = _serialize_value(
            doc.get("session_data") if "session_data" in doc else {k: v for k, v in doc.items() if k != "_id"}
        )
        metadata = session_data.get("metadata") if isinstance(session_data, dict) else {}
        if isinstance(metadata, dict):
            raw_project = metadata.get("project_id")
            mapped_project = map_project_id(project_map, raw_project)
            if mapped_project:
                metadata["project_id"] = mapped_project
                session_data["metadata"] = metadata
        now = utc_now_iso()
        payload = {
            "meeting_id": meeting_id,
            "session_data": session_data if isinstance(session_data, dict) else {},
            "created_at": _serialize_value(doc.get("created_at")) or now,
            "updated_at": _serialize_value(doc.get("updated_at")) or now,
        }
        if not dry_run:
            client.table("meeting_document_sessions").upsert(
                payload, on_conflict="meeting_id"
            ).execute()
        stats["meeting_document_sessions"] += 1

    return {
        "dry_run": dry_run,
        "stats": stats,
        "project_map_size": len(project_map),
        "user_map_size": len(user_id_map),
        "errors": errors,
    }


def import_meeting_admins(
    admin_db: Any,
    *,
    dry_run: bool = False,
    user_id_map: Optional[dict[str, str]] = None,
) -> int:
    resolved_user_map = user_id_map or build_user_id_map_from_db()
    client = get_supabase()
    count = 0
    for doc in admin_db["admins"].find({}):
        legacy_user = doc.get("user_id") or doc.get("aid")
        new_user_id = map_user_id(resolved_user_map, legacy_user)
        meeting_id = str(doc.get("meeting_id") or "").strip()
        if not meeting_id:
            continue
        payload = {
            "meeting_id": meeting_id,
            "user_id": new_user_id,
            "is_admin": bool(doc.get("is_admin", True)),
            "is_agent": bool(doc.get("is_agent", False)),
            "agent_name": doc.get("agent_Name") or doc.get("agent_name"),
            "exp": _serialize_value(doc.get("exp")),
            "created_at": _serialize_value(doc.get("created_at")) or utc_now_iso(),
        }
        if not dry_run:
            client.table("meeting_admins").insert(payload).execute()
        count += 1
    return count


# ---------------------------------------------------------------------------
# Filtered Mongo import helpers
# ---------------------------------------------------------------------------

MONGO_IMPORT_COLLECTIONS = (
    "projects",
    "document_template",
    "meeting_summary",
    "meeting_mvpvision",
    "mcp_configurations",
    "project_reports",
    "meeting_document_sessions",
    "admins",
)


class _FakeCollection:
    def __init__(self, documents: list[dict[str, Any]]):
        self._documents = documents

    def find(self, _query: Any = None) -> list[dict[str, Any]]:
        return self._documents


class _FakeDatabase:
    def __init__(self, collections: dict[str, list[dict[str, Any]]]):
        self._collections = collections

    def __getitem__(self, name: str) -> _FakeCollection:
        return _FakeCollection(self._collections.get(name, []))


def prepare_single_user_migration_map(
    *,
    email: str,
    legacy_user_id: str,
    sync_new_auth_user: bool = True,
    dry_run: bool = False,
) -> dict[str, str]:
    row: dict[str, str] = {
        "email": _normalize_email(email),
        "legacy_user_id": str(legacy_user_id).strip(),
    }
    if sync_new_auth_user:
        new_url = os.getenv("VITE_SUPABASE_URL") or ""
        new_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
        if new_url and new_key:
            for auth_row in fetch_auth_users_from_supabase(new_url, new_key):
                if auth_row["email"] == row["email"]:
                    row["new_user_id"] = auth_row["legacy_user_id"]
                    break
    if not dry_run:
        upsert_migration_user_map([row])
    else:
        # Allow dry-run imports to resolve user ids without writing app data.
        row["_dry_run_only"] = True
    return row


def _build_user_id_map_for_import(map_row: dict[str, str]) -> dict[str, str]:
    legacy = str(map_row.get("legacy_user_id") or "").strip()
    new_id = str(map_row.get("new_user_id") or legacy).strip()
    if legacy and new_id:
        return {legacy: new_id}
    return build_user_id_map_from_db()


def find_auth_user_by_email(url: str, service_key: str, email: str) -> Optional[dict[str, str]]:
    normalized = _normalize_email(email)
    for row in fetch_auth_users_from_supabase(url, service_key):
        if row["email"] == normalized:
            return {"email": row["email"], "legacy_user_id": row["legacy_user_id"]}
    return None


def build_user_rows_from_old_supabase(
    old_url: str,
    old_key: str,
    *,
    sync_new_auth_user: bool = True,
) -> list[dict[str, str]]:
    rows = [
        {"email": item["email"], "legacy_user_id": item["legacy_user_id"]}
        for item in fetch_auth_users_from_supabase(old_url, old_key)
    ]
    if sync_new_auth_user:
        new_url = os.getenv("VITE_SUPABASE_URL") or ""
        new_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
        if new_url and new_key:
            email_to_new = {
                item["email"]: item["legacy_user_id"]
                for item in fetch_auth_users_from_supabase(new_url, new_key)
            }
            for row in rows:
                if row["email"] in email_to_new:
                    row["new_user_id"] = email_to_new[row["email"]]
    deduped: dict[str, dict[str, str]] = {}
    for row in rows:
        deduped[row["email"]] = row
    return list(deduped.values())


def _normalize_mongo_doc(doc: dict[str, Any]) -> dict[str, Any]:
    row = dict(doc)
    if "_id" in row:
        row["_id"] = str(row["_id"])
    return row


def build_filtered_mongo_database(db: Any, legacy_user_id: str) -> _FakeDatabase:
    uid = str(legacy_user_id).strip()
    user_query = {"$or": [{"user_id": uid}, {"userId": uid}]}

    user_projects = [_normalize_mongo_doc(doc) for doc in db["projects"].find(user_query)]
    user_project_ids = {str(doc.get("_id") or "").strip() for doc in user_projects}
    user_project_ids.discard("")

    collections: dict[str, list[dict[str, Any]]] = {"projects": user_projects}

    mongo_collections = [
        "document_template",
        "meeting_summary",
        "meeting_mvpvision",
        "mcp_configurations",
        "project_reports",
    ]
    for name in mongo_collections:
        seen_ids: set[str] = set()
        documents: list[dict[str, Any]] = []

        def _append_docs(raw_docs: Any) -> None:
            for doc in raw_docs:
                normalized = _normalize_mongo_doc(doc)
                doc_id = str(normalized.get("_id") or "")
                if doc_id and doc_id in seen_ids:
                    continue
                if doc_id:
                    seen_ids.add(doc_id)
                documents.append(normalized)

        _append_docs(db[name].find(user_query))
        if user_project_ids:
            project_query = {
                "$or": [
                    {"project_id": {"$in": list(user_project_ids)}},
                    {"projectId": {"$in": list(user_project_ids)}},
                ]
            }
            _append_docs(db[name].find(project_query))
        collections[name] = documents

    session_query: dict[str, Any] = {
        "$or": [
            {"metadata.user_id": uid},
            {"user_id": uid},
            {"userId": uid},
        ]
    }
    if user_project_ids:
        session_query["$or"].extend(
            [
                {"metadata.project_id": {"$in": list(user_project_ids)}},
                {"project_id": {"$in": list(user_project_ids)}},
            ]
        )
    collections["meeting_document_sessions"] = [
        _normalize_mongo_doc(doc) for doc in db["meeting_document_sessions"].find(session_query)
    ]

    admins: list[dict[str, Any]] = []
    try:
        admin_db = db.client["Admins"]
        admins = [
            _normalize_mongo_doc(doc)
            for doc in admin_db["admins"].find(
                {"$or": [{"user_id": uid}, {"aid": uid}, {"userId": uid}]}
            )
        ]
    except Exception:
        admins = []
    collections["admins"] = admins
    return _FakeDatabase(collections)


def import_user_data(
    db: _FakeDatabase,
    *,
    email: str,
    legacy_user_id: str,
    dry_run: bool = False,
    sync_new_auth_user: bool = True,
    include_admins: bool = True,
) -> dict[str, Any]:
    map_row = prepare_single_user_migration_map(
        email=email,
        legacy_user_id=legacy_user_id,
        sync_new_auth_user=sync_new_auth_user,
        dry_run=dry_run,
    )
    user_id_map = _build_user_id_map_for_import(map_row)
    preview = {
        name: len(db._collections.get(name, []))  # noqa: SLF001
        for name in MONGO_IMPORT_COLLECTIONS
    }

    result = import_mongo_database(
        db,
        dry_run=dry_run,
        skip_existing=not dry_run,
        user_id_map_override=user_id_map,
    )
    result["filtered_counts"] = preview
    result["migration_map"] = map_row

    if include_admins and db._collections.get("admins"):  # noqa: SLF001
        if dry_run:
            result["meeting_admins_imported"] = len(db._collections["admins"])  # noqa: SLF001
        else:
            admin_db = _FakeDatabase({"admins": db._collections["admins"]})  # noqa: SLF001
            result["meeting_admins_imported"] = import_meeting_admins(admin_db, dry_run=dry_run)
    else:
        result["meeting_admins_imported"] = 0

    new_user_id = map_row.get("new_user_id")
    if (
        not dry_run
        and new_user_id
        and str(new_user_id) != str(legacy_user_id)
        and map_row.get("email")
    ):
        result["link_result"] = link_user_data_by_email(
            email=map_row["email"],
            new_user_id=str(new_user_id),
            verify=True,
        )

    return result


def import_mongo_for_user(
    db: Any,
    *,
    email: str,
    legacy_user_id: str,
    dry_run: bool = False,
    sync_new_auth_user: bool = True,
    include_admins: bool = True,
) -> dict[str, Any]:
    filtered = build_filtered_mongo_database(db, legacy_user_id)
    return import_user_data(
        filtered,
        email=email,
        legacy_user_id=legacy_user_id,
        dry_run=dry_run,
        sync_new_auth_user=sync_new_auth_user,
        include_admins=include_admins,
    )


def link_all_mapped_users(*, dry_run: bool = False) -> list[dict[str, Any]]:
    if dry_run:
        return []
    response = get_supabase().table("migration_user_map").select("*").execute()
    results: list[dict[str, Any]] = []
    for row in response.data or []:
        email = row.get("email")
        legacy_user_id = row.get("legacy_user_id")
        new_user_id = row.get("new_user_id")
        if not email or not legacy_user_id or not new_user_id:
            continue
        if str(new_user_id) == str(legacy_user_id):
            continue
        try:
            results.append(
                link_user_data_by_email(
                    email=str(email),
                    new_user_id=str(new_user_id),
                    verify=True,
                )
            )
        except UserMigrationError as exc:
            results.append(
                {
                    "linked": False,
                    "email": email,
                    "error": str(exc),
                }
            )
    return results


def import_all_users_from_mongo(
    db: Any,
    user_rows: list[dict[str, str]],
    *,
    dry_run: bool = False,
    include_admins: bool = False,
) -> dict[str, Any]:
    if not dry_run:
        upsert_migration_user_map(user_rows)

    user_id_map = build_user_id_map_from_rows(user_rows) or build_user_id_map_from_db()
    if not user_id_map:
        raise UserMigrationError(
            "No user mappings available. Load legacy auth users before importing Mongo data."
        )

    result = import_mongo_database(
        db,
        dry_run=dry_run,
        skip_existing=not dry_run,
        user_id_map_override=user_id_map,
    )
    result["users_in_map"] = len(user_rows)

    if include_admins:
        try:
            admin_db = db.client["Admins"]
            result["meeting_admins_imported"] = import_meeting_admins(
                admin_db,
                dry_run=dry_run,
                user_id_map=user_id_map,
            )
        except Exception as exc:
            result["meeting_admins_error"] = str(exc)
    else:
        result["meeting_admins_imported"] = 0

    if not dry_run:
        result["link_results"] = link_all_mapped_users(dry_run=dry_run)
    return result
