#!/usr/bin/env python3
"""
Migrate real Supabase Auth users (passwords + identities) from an OLD project
to the NEW project, preserving the original user id.

Unlike migrate_mongo_to_supabase.py --export-users-csv (which only reads
emails/ids via the Admin REST API), this connects directly to Postgres on
both projects so it can copy auth.users.encrypted_password and auth.identities
verbatim. Migrated users can log in on the NEW project with their existing
password, and their id is unchanged, so app data keyed on the old user_id
lines up automatically.

Requires a direct Postgres connection (not the pooler) to both projects. Set:

  OLD_SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.OLD_PROJECT_REF.supabase.co:5432/postgres
  SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.NEW_PROJECT_REF.supabase.co:5432/postgres

  -- or, per project --
  OLD_SUPABASE_DB_PASSWORD=... + OLD_VITE_SUPABASE_URL=...
  SUPABASE_DB_PASSWORD=...     + VITE_SUPABASE_URL=...

Find the database password in Supabase Dashboard -> Project Settings -> Database
-> Connection string -> Direct connection.

Usage:
  python scripts/migrate_auth_users.py --dry-run
  python scripts/migrate_auth_users.py --apply
"""

from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

load_dotenv()

from python_files.auth_migration import AuthMigrationError, migrate_auth_users  # noqa: E402
from python_files.db_connection import DbConnectionError, resolve_db_url  # noqa: E402


def _prompt_yes_no(message: str, *, default: bool = False) -> bool:
    default_label = "Y/n" if default else "y/N"
    value = input(f"{message} ({default_label}): ").strip().lower()
    if not value:
        return default
    return value in {"y", "yes", "1"}


def _print_report(result: dict) -> None:
    print()
    print("=== Auth migration report ===")
    print(f"OLD auth.users total: {result['old_users_total']}")
    print(f"NEW auth.users total: {result['new_users_total']}")
    print(f"Users to migrate:     {result['users_to_migrate']}")
    print(f"Already present:      {result['users_already_present']}")
    print(f"Email conflicts:      {len(result['email_conflicts'])}")
    if result["email_conflicts"]:
        print()
        print("Email conflicts (already signed up on NEW with a different id — SKIPPED):")
        for conflict in result["email_conflicts"]:
            print(
                f"  {conflict['email']}  old={conflict['old_user_id']}  "
                f"new={conflict['new_user_id']}"
            )
    if not result["dry_run"]:
        print()
        print(f"Users migrated:      {result['users_migrated']}")
        print(f"Identities migrated: {result['identities_migrated']}")
    print()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate auth.users + auth.identities from OLD to NEW Supabase project."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes (default is dry-run preview only).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only, no writes. This is the default; kept for explicitness.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()

    try:
        old_db_url = resolve_db_url(target="old")
        new_db_url = resolve_db_url(target="new")
    except DbConnectionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    dry_run = not args.apply

    try:
        if not dry_run:
            preview_result = migrate_auth_users(old_db_url, new_db_url, dry_run=True)
            _print_report(preview_result)
            if not _prompt_yes_no(
                "This will WRITE auth.users/auth.identities rows to the NEW project. Continue?",
                default=False,
            ):
                print("Cancelled.")
                return 0

        result = migrate_auth_users(old_db_url, new_db_url, dry_run=dry_run)
        _print_report(result)

        if dry_run:
            print("Dry run complete — no data was written. Re-run with --apply to migrate.")
        else:
            print("Auth migration complete.")
            print("Migrated users can log in on the NEW project with their existing password.")
            print("Next: python scripts/migrate_interactive.py to import Mongo/app data.")
        return 0
    except AuthMigrationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nCancelled.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
