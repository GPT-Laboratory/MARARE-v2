"""Resolve direct Postgres connection strings for the OLD/NEW Supabase projects."""

from __future__ import annotations

import os
import re
from urllib.parse import quote_plus


class DbConnectionError(RuntimeError):
    pass


def _extract_project_ref(supabase_url: str) -> str:
    match = re.search(r"https?://([^.]+)\.supabase\.co", supabase_url.strip())
    if not match:
        raise DbConnectionError(
            f"Could not parse Supabase project ref from URL: {supabase_url}"
        )
    return match.group(1)


def _build_db_url(supabase_url: str, password: str) -> str:
    project_ref = _extract_project_ref(supabase_url)
    encoded_password = quote_plus(password)
    return (
        f"postgresql://postgres:{encoded_password}"
        f"@db.{project_ref}.supabase.co:5432/postgres"
    )


def resolve_db_url(*, target: str) -> str:
    if target == "old":
        direct = (os.getenv("OLD_SUPABASE_DB_URL") or "").strip()
        supabase_url = (
            os.getenv("OLD_VITE_SUPABASE_URL")
            or os.getenv("OLD_SUPABASE_URL")
            or ""
        ).strip()
        password = (os.getenv("OLD_SUPABASE_DB_PASSWORD") or "").strip()
    else:
        direct = (
            os.getenv("SUPABASE_DB_URL")
            or os.getenv("DATABASE_URL")
            or ""
        ).strip()
        supabase_url = (os.getenv("VITE_SUPABASE_URL") or "").strip()
        password = (os.getenv("SUPABASE_DB_PASSWORD") or "").strip()

    if direct:
        return direct
    if supabase_url and password:
        return _build_db_url(supabase_url, password)

    if target == "old":
        raise DbConnectionError(
            "Missing OLD database credentials. Set OLD_SUPABASE_DB_URL or "
            "OLD_SUPABASE_DB_PASSWORD + OLD_VITE_SUPABASE_URL in .env"
        )
    raise DbConnectionError(
        "Missing NEW database credentials. Set SUPABASE_DB_URL or "
        "SUPABASE_DB_PASSWORD + VITE_SUPABASE_URL in .env.\n"
        "Find the database password in Supabase Dashboard -> Project Settings -> Database."
    )
