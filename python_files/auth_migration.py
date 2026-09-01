"""Migrate real Supabase Auth users (auth.users + auth.identities) between projects.

Unlike python_files/user_migration.py (which only maps ids by email via the
Admin REST API), this talks directly to Postgres so it can carry over
encrypted_password and preserve the original user id. Users migrated this way
keep their existing password and their existing id, so app data keyed on the
old user_id lines up with no extra linking step.
"""

from __future__ import annotations

from typing import Any


class AuthMigrationError(RuntimeError):
    pass


def _connect(db_url: str):
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise AuthMigrationError('Install psycopg: pip install "psycopg[binary]"') from exc

    return psycopg.connect(db_url, connect_timeout=30, row_factory=dict_row)


def fetch_auth_table_rows(db_url: str, table: str) -> tuple[list[dict[str, Any]], list[str]]:
    with _connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(f"select * from auth.{table}")  # noqa: S608 - table is a fixed literal, not user input
            rows = cur.fetchall()
            columns = [desc.name for desc in cur.description]
    return rows, columns


def preview_auth_migration(old_db_url: str, new_db_url: str) -> dict[str, Any]:
    old_users, old_user_columns = fetch_auth_table_rows(old_db_url, "users")
    new_users, _ = fetch_auth_table_rows(new_db_url, "users")

    new_by_email: dict[str, dict[str, Any]] = {
        str(row["email"]).strip().lower(): row for row in new_users if row.get("email")
    }
    new_ids = {str(row["id"]) for row in new_users}

    to_migrate: list[dict[str, Any]] = []
    already_present: list[dict[str, Any]] = []
    email_conflicts: list[dict[str, Any]] = []

    for row in old_users:
        old_id = str(row["id"])
        email = str(row.get("email") or "").strip().lower()

        if old_id in new_ids:
            already_present.append(row)
            continue

        existing = new_by_email.get(email) if email else None
        if existing is not None:
            email_conflicts.append(
                {
                    "email": email,
                    "old_user_id": old_id,
                    "new_user_id": str(existing["id"]),
                }
            )
            continue

        to_migrate.append(row)

    return {
        "old_users_total": len(old_users),
        "new_users_total": len(new_users),
        "to_migrate": to_migrate,
        "already_present": already_present,
        "email_conflicts": email_conflicts,
        "user_columns": old_user_columns,
    }


def _insert_rows(conn, table: str, rows: list[dict[str, Any]], columns: list[str]) -> int:
    if not rows:
        return 0

    from psycopg import sql

    column_list = sql.SQL(", ").join(sql.Identifier(col) for col in columns)
    placeholders = sql.SQL(", ").join(sql.Placeholder() * len(columns))
    query = sql.SQL(
        "insert into auth.{table} ({columns}) values ({values}) on conflict (id) do nothing"
    ).format(table=sql.Identifier(table), columns=column_list, values=placeholders)

    inserted = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(query, [row.get(col) for col in columns])
            inserted += cur.rowcount
    return inserted


def migrate_auth_users(old_db_url: str, new_db_url: str, *, dry_run: bool = True) -> dict[str, Any]:
    preview = preview_auth_migration(old_db_url, new_db_url)
    to_migrate = preview["to_migrate"]
    migrated_ids = {str(row["id"]) for row in to_migrate}

    result: dict[str, Any] = {
        "dry_run": dry_run,
        "old_users_total": preview["old_users_total"],
        "new_users_total": preview["new_users_total"],
        "users_to_migrate": len(to_migrate),
        "users_already_present": len(preview["already_present"]),
        "email_conflicts": preview["email_conflicts"],
        "users_migrated": 0,
        "identities_migrated": 0,
    }

    if dry_run or not to_migrate:
        return result

    old_identities, identity_columns = fetch_auth_table_rows(old_db_url, "identities")
    identities_to_migrate = [
        row for row in old_identities if str(row.get("user_id")) in migrated_ids
    ]
    user_columns = preview["user_columns"]

    with _connect(new_db_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("alter table auth.users disable trigger all")
                cur.execute("alter table auth.identities disable trigger all")
            try:
                result["users_migrated"] = _insert_rows(conn, "users", to_migrate, user_columns)
                result["identities_migrated"] = _insert_rows(
                    conn, "identities", identities_to_migrate, identity_columns
                )
            finally:
                with conn.cursor() as cur:
                    cur.execute("alter table auth.users enable trigger all")
                    cur.execute("alter table auth.identities enable trigger all")

    return result
