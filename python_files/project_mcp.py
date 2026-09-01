"""
Project-scoped MCP integration (Notion, Google Drive, GitHub).

Responsibilities:
  - Store encrypted OAuth tokens per project in Supabase
  - Start / complete OAuth flows for Notion and Google Drive
  - List and invoke MCP tools on behalf of a project
  - Expose connector configuration to the frontend
"""

import asyncio
import base64
import hashlib
import logging
import os
import secrets
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from python_files.base_urls import (
    GOOGLE_DRIVE_REQUIRED_SCOPES,
    GOOGLE_DRIVE_SCOPES,
    GOOGLE_OAUTH_AUTH_URL,
    GOOGLE_OAUTH_TOKEN_URL,
    GOOGLE_TOKENINFO_URL,
    GOOGLE_USERINFO_URL,
    NOTION_MCP_URL,
    NOTION_OAUTH_PROTECTED_RESOURCE_URL,
)
from python_files.supabase_client import SupabaseConfigError, is_supabase_configured
from python_files.supabase_store import (
    consume_oauth_state,
    delete_mcp_configurations,
    find_mcp_configuration,
    insert_oauth_state,
    update_mcp_configuration_fields,
    upsert_mcp_configuration,
)

try:
    from mcp import ClientSession
except ImportError:  # pragma: no cover - handled at runtime with a clear API error
    ClientSession = None

try:
    from mcp.client.stdio import StdioServerParameters, stdio_client
except ImportError:  # pragma: no cover - handled at runtime with a clear API error
    StdioServerParameters = None
    stdio_client = None

try:
    from mcp.client.streamable_http import streamablehttp_client
except ImportError:  # pragma: no cover - handled at runtime with a clear API error
    streamablehttp_client = None


logger = logging.getLogger(__name__)
load_dotenv()

GITHUB_PROVIDER = "github"
NOTION_PROVIDER = "notion"
GOOGLE_DRIVE_PROVIDER = "google_drive"
SUPPORTED_PROVIDERS = {GITHUB_PROVIDER, NOTION_PROVIDER, GOOGLE_DRIVE_PROVIDER}
GOOGLE_DRIVE_MCP_PACKAGE = os.getenv("GOOGLE_DRIVE_MCP_PACKAGE", "@us-all/google-drive-mcp")
GOOGLE_DRIVE_MCP_SERVER = "us-all-google-drive-mcp"
NOTION_USER_AGENT = "MARARE-MCP-Agent/1.0"
GOOGLE_DRIVE_MCP_TOOL_CATEGORIES = os.getenv("GOOGLE_DRIVE_MCP_TOOL_CATEGORIES", "sheets, drive")
GOOGLE_USERINFO_SCOPES = "openid email profile"
MCP_STDIO_FILTER_PATH = os.path.join(os.path.dirname(__file__), "mcp_stdio_filter.py")
_TOOL_CACHE: Dict[str, Dict[str, Any]] = {}
_TOOL_CACHE_TTL_SECONDS = 300


class ProjectMCPError(RuntimeError):
    """Raised when project MCP configuration or execution fails."""


def _ensure_storage_configured() -> None:
    if not is_supabase_configured():
        raise ProjectMCPError(
            "Supabase is not configured. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        )


def _run_async_task(coro):
    """Run async MCP work from sync Flask handlers or nested async agents."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, coro).result()


def _cache_key(project_id: str, user_id: Optional[str] = None) -> str:
    return f"{project_id}:{user_id or 'any'}"


def _clear_project_tool_cache(project_id: str):
    prefix = f"{project_id}:"
    for key in list(_TOOL_CACHE.keys()):
        if key.startswith(prefix):
            _TOOL_CACHE.pop(key, None)


def available_connectors() -> list[dict]:
    return [
        {
            "id": GITHUB_PROVIDER,
            "name": "GitHub",
            "description": "Connect this project to GitHub repositories, issues, pull requests, and code search.",
            "status": "available",
            "configFields": [
                {
                    "name": "githubUsername",
                    "label": "GitHub Username",
                    "type": "text",
                    "required": True,
                    "placeholder": "octocat",
                },
                {
                    "name": "githubToken",
                    "label": "GitHub Personal Access Token",
                    "type": "password",
                    "required": True,
                    "placeholder": "ghp_...",
                },
            ],
        },
        {
            "id": NOTION_PROVIDER,
            "name": "Notion",
            "description": "Connect this project to Notion pages, databases, search, and workspace knowledge.",
            "status": "available",
            "authType": "oauth",
            "configFields": [
                {
                    "name": "workspaceName",
                    "label": "Workspace Name",
                    "type": "text",
                    "required": False,
                    "placeholder": "Product Team",
                },
            ],
        },
        {
            "id": GOOGLE_DRIVE_PROVIDER,
            "name": "Google Drive",
            "description": "Connect this project to Google Drive files through the community Drive MCP server and standard Google Drive API OAuth.",
            "status": "available",
            "authType": "oauth",
            "configFields": [
                {
                    "name": "accountLabel",
                    "label": "Account Label",
                    "type": "text",
                    "required": False,
                    "placeholder": "Work Drive",
                },
            ],
        }
    ]


def _fernet() -> Fernet:
    configured_key = os.getenv("MCP_CONFIG_ENCRYPTION_KEY")
    if configured_key:
        try:
            return Fernet(configured_key.encode())
        except Exception as exc:
            raise ProjectMCPError("MCP_CONFIG_ENCRYPTION_KEY is not a valid Fernet key.") from exc

    seed = (
        os.getenv("SECRET_KEY")
        or os.getenv("MCP_CONFIG_SECRET")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_KEY")
        or "marare-local-development-key"
    )
    derived = base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest())
    return Fernet(derived)


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt_token(value: str, provider: str = "MCP") -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise ProjectMCPError(f"Stored {provider} token could not be decrypted.") from exc


def _normalize_github_config(config: dict) -> dict:
    username = (
        config.get("githubUsername")
        or config.get("github_username")
        or config.get("username")
        or config.get("userName")
        or ""
    )
    token = (
        config.get("githubToken")
        or config.get("github_token")
        or config.get("token")
        or config.get("personalAccessToken")
        or ""
    )
    return {
        "github_username": str(username).strip(),
        "github_token": str(token).strip(),
    }


def _normalize_notion_config(config: dict) -> dict:
    token = (
        config.get("notionToken")
        or config.get("notion_token")
        or config.get("token")
        or config.get("accessToken")
        or ""
    )
    workspace_name = (
        config.get("workspaceName")
        or config.get("workspace_name")
        or config.get("workspace")
        or ""
    )
    return {
        "notion_token": str(token).strip(),
        "workspace_name": str(workspace_name).strip(),
    }


def _normalize_google_drive_config(config: dict) -> dict:
    account_label = (
        config.get("accountLabel")
        or config.get("account_label")
        or config.get("driveName")
        or config.get("drive_name")
        or ""
    )
    return {
        "account_label": str(account_label).strip(),
    }


def _mask_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    if len(token) <= 8:
        return "********"
    return f"{token[:4]}...{token[-4:]}"


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _generate_pkce() -> tuple[str, str]:
    verifier = _base64url(secrets.token_bytes(32))
    challenge = _base64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


async def _oauth_get_json(url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": NOTION_USER_AGENT}) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


async def _oauth_post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": NOTION_USER_AGENT}) as client:
        response = await client.post(
            url,
            json=payload,
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        return response.json()


async def _oauth_post_form(url: str, payload: dict[str, str]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": NOTION_USER_AGENT}) as client:
        response = await client.post(
            url,
            data=payload,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        if response.status_code >= 400:
            raise ProjectMCPError(f"OAuth token request failed: HTTP {response.status_code} - {response.text}")
        return response.json()


async def _discover_notion_oauth_metadata() -> dict[str, Any]:
    protected_resource = await _oauth_get_json(
        NOTION_OAUTH_PROTECTED_RESOURCE_URL
    )
    auth_servers = protected_resource.get("authorization_servers")
    if not auth_servers:
        raise ProjectMCPError("Notion OAuth discovery did not return an authorization server.")

    auth_server = auth_servers[0].rstrip("/")
    metadata = await _oauth_get_json(f"{auth_server}/.well-known/oauth-authorization-server")
    if not metadata.get("authorization_endpoint") or not metadata.get("token_endpoint"):
        raise ProjectMCPError("Notion OAuth metadata is missing required endpoints.")
    if not metadata.get("registration_endpoint"):
        raise ProjectMCPError("Notion OAuth metadata does not include a registration endpoint.")
    return metadata


async def _register_notion_oauth_client(metadata: dict[str, Any], redirect_uri: str) -> dict[str, Any]:
    return await _oauth_post_json(
        metadata["registration_endpoint"],
        {
            "client_name": "MARARE Project MCP",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        },
    )


def _google_oauth_client() -> dict[str, str]:
    client_id = (
        os.getenv("GOOGLE_DRIVE_CLIENT_ID")
        or os.getenv("GDRIVE_CLIENT_ID")
        or os.getenv("GOOGLE_OAUTH_CLIENT_ID")
        or ""
    )
    client_secret = (
        os.getenv("GOOGLE_DRIVE_CLIENT_SECRET")
        or os.getenv("GDRIVE_CLIENT_SECRET")
        or os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
        or ""
    )
    if not client_id or not client_secret:
        raise ProjectMCPError(
            "Google Drive OAuth requires GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in the backend environment."
        )
    return {"client_id": client_id, "client_secret": client_secret}


async def _fetch_google_account_email(access_token: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=20, headers={"Authorization": f"Bearer {access_token}"}) as client:
            response = await client.get(GOOGLE_USERINFO_URL)
            response.raise_for_status()
            return str(response.json().get("email") or "")
    except Exception as exc:
        logger.warning("Could not fetch Google account email: %s", exc)
        return ""


async def _fetch_google_token_scopes(access_token: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(GOOGLE_TOKENINFO_URL, params={"access_token": access_token})
            response.raise_for_status()
            return str(response.json().get("scope") or "")
    except Exception as exc:
        logger.warning("Could not fetch Google token scopes: %s", exc)
        return ""


def _missing_google_drive_scopes(scope_string: str) -> set[str]:
    granted = set(str(scope_string or "").split())
    return GOOGLE_DRIVE_REQUIRED_SCOPES.difference(granted)


def _google_drive_needs_reconnect(config: dict) -> bool:
    if not config:
        return False
    if config.get("mcp_server") != GOOGLE_DRIVE_MCP_SERVER:
        return True
    if not config.get("refresh_token_encrypted"):
        return True
    return bool(_missing_google_drive_scopes(config.get("scope", "")))


def _google_oauth_client_credentials(config: dict) -> dict[str, str]:
    client = config.get("oauth_client") or {}
    client_id = client.get("client_id") or _google_oauth_client()["client_id"]
    client_secret = client.get("client_secret")
    if not client_secret and client.get("client_secret_encrypted"):
        client_secret = decrypt_token(client["client_secret_encrypted"], provider=GOOGLE_DRIVE_PROVIDER)
    if not client_secret:
        client_secret = _google_oauth_client()["client_secret"]
    return {"client_id": client_id, "client_secret": client_secret}


def _google_drive_server_env(config: dict) -> dict[str, str]:
    refresh_token = config.get("google_drive_refresh_token")
    if not refresh_token:
        raise ProjectMCPError(
            "Google Drive OAuth refresh token is not available. Disconnect and reconnect Google Drive MCP."
        )

    client = _google_oauth_client_credentials(config)
    env = os.environ.copy()
    env["GOOGLE_CLIENT_ID"] = client["client_id"]
    env["GOOGLE_CLIENT_SECRET"] = client["client_secret"]
    env["GOOGLE_REFRESH_TOKEN"] = refresh_token
    env["GOOGLE_DRIVE_ALLOW_WRITE"] = os.getenv("GOOGLE_DRIVE_ALLOW_WRITE", "true")
    env["GD_TOOLS"] = GOOGLE_DRIVE_MCP_TOOL_CATEGORIES
    # MCP stdio requires stdout to contain only JSON-RPC messages. Some Google
    # MCP packages load dotenvx/vestauth and print startup logs to stdout unless
    # these quiet flags are set, which breaks the Python MCP parser.
    env["DOTENV_CONFIG_QUIET"] = "true"
    env["DOTENVX_QUIET"] = "true"
    env["VESTAUTH_QUIET"] = "true"
    env["NO_COLOR"] = "1"
    env.pop("DOTENV_CONFIG_DEBUG", None)
    return env


def _google_drive_stdio_params(config: dict):
    return StdioServerParameters(
        command=sys.executable,
        args=[MCP_STDIO_FILTER_PATH, "npx", "-y", GOOGLE_DRIVE_MCP_PACKAGE],
        env=_google_drive_server_env(config),
    )


def _get_project_provider_config(
    project_id: str,
    provider: str,
    user_id: Optional[str] = None,
    include_token: bool = False,
) -> Optional[dict]:
    if not project_id:
        return None
    if provider not in SUPPORTED_PROVIDERS:
        return None

    _ensure_storage_configured()
    row = find_mcp_configuration(str(project_id), provider, user_id=str(user_id) if user_id else None)
    if not row:
        return None

    if include_token and row.get("token_encrypted"):
        row["token"] = decrypt_token(row["token_encrypted"], provider=provider)
        if provider == GITHUB_PROVIDER:
            row["github_token"] = row["token"]
        elif provider == NOTION_PROVIDER:
            row["notion_token"] = row["token"]
            if row.get("refresh_token_encrypted"):
                row["notion_refresh_token"] = decrypt_token(
                    row["refresh_token_encrypted"],
                    provider=provider,
                )
        elif provider == GOOGLE_DRIVE_PROVIDER:
            row["google_drive_token"] = row["token"]
            if row.get("refresh_token_encrypted"):
                row["google_drive_refresh_token"] = decrypt_token(
                    row["refresh_token_encrypted"],
                    provider=provider,
                )
    return row


def get_project_github_config(
    project_id: str,
    user_id: Optional[str] = None,
    include_token: bool = False,
) -> Optional[dict]:
    return _get_project_provider_config(
        project_id=project_id,
        provider=GITHUB_PROVIDER,
        user_id=user_id,
        include_token=include_token,
    )


def get_project_notion_config(
    project_id: str,
    user_id: Optional[str] = None,
    include_token: bool = False,
) -> Optional[dict]:
    return _get_project_provider_config(
        project_id=project_id,
        provider=NOTION_PROVIDER,
        user_id=user_id,
        include_token=include_token,
    )


def get_project_google_drive_config(
    project_id: str,
    user_id: Optional[str] = None,
    include_token: bool = False,
) -> Optional[dict]:
    return _get_project_provider_config(
        project_id=project_id,
        provider=GOOGLE_DRIVE_PROVIDER,
        user_id=user_id,
        include_token=include_token,
    )


def get_public_project_configuration(project_id: str, user_id: Optional[str] = None) -> dict:
    configurations = {}
    active_tools = []

    github_config = get_project_github_config(project_id, user_id=user_id, include_token=True)
    if github_config:
        token = github_config.get("github_token")
        configurations[GITHUB_PROVIDER] = {
            "githubUsername": github_config.get("github_username"),
            "enabled": bool(github_config.get("enabled", True)),
            "tokenConfigured": bool(token),
            "tokenPreview": _mask_token(token),
            "updatedAt": github_config.get("updated_at"),
        }
        if github_config.get("enabled", True):
            active_tools.append(GITHUB_PROVIDER)

    notion_config = get_project_notion_config(project_id, user_id=user_id, include_token=True)
    if notion_config:
        token = notion_config.get("notion_token")
        configurations[NOTION_PROVIDER] = {
            "workspaceName": notion_config.get("workspace_name"),
            "enabled": bool(notion_config.get("enabled", True)),
            "tokenConfigured": bool(token),
            "tokenPreview": _mask_token(token),
            "authType": notion_config.get("auth_type") or "token",
            "updatedAt": notion_config.get("updated_at"),
            "notionExportEnabled": bool(notion_config.get("store_meeting_data_in_notion")),
            "storeMeetingDataInNotion": bool(notion_config.get("store_meeting_data_in_notion")),
            "notionMeetingDatabaseId": notion_config.get("notion_meeting_database_id"),
            "notionMeetingDatabaseReady": bool(notion_config.get("notion_meeting_database_id")),
            "documentStoragePreference": notion_config.get("document_storage_preference"),
        }
        if notion_config.get("enabled", True):
            active_tools.append(NOTION_PROVIDER)

    google_drive_config = get_project_google_drive_config(project_id, user_id=user_id, include_token=True)
    if google_drive_config:
        token = google_drive_config.get("google_drive_token")
        configurations[GOOGLE_DRIVE_PROVIDER] = {
            "accountLabel": google_drive_config.get("account_label"),
            "accountEmail": google_drive_config.get("account_email"),
            "enabled": bool(google_drive_config.get("enabled", True)),
            "tokenConfigured": bool(token),
            "tokenPreview": _mask_token(token),
            "authType": google_drive_config.get("auth_type") or "oauth",
            "grantedScopes": google_drive_config.get("scope", ""),
            "missingScopes": sorted(_missing_google_drive_scopes(google_drive_config.get("scope", ""))),
            "needsReconnect": _google_drive_needs_reconnect(google_drive_config),
            "updatedAt": google_drive_config.get("updated_at"),
            "documentStoragePreference": google_drive_config.get("document_storage_preference"),
        }
        if google_drive_config.get("enabled", True):
            active_tools.append(GOOGLE_DRIVE_PROVIDER)

    from python_files.document_storage import document_storage_status

    storage_status = document_storage_status(str(project_id), str(user_id)) if user_id else {
        "backend": "supabase",
        "preference": "supabase",
        "availableBackends": ["supabase"],
        "notionReady": False,
        "googleDriveReady": False,
        "supabaseFallback": True,
    }

    return {
        "success": True,
        "configurations": configurations,
        "active_tools": active_tools,
        "documentStorage": storage_status,
    }


def save_project_github_config(project_id: str, user_id: str, raw_config: dict) -> dict:
    if not project_id:
        raise ProjectMCPError("project_id is required.")
    if not user_id:
        raise ProjectMCPError("user_id is required.")

    normalized = _normalize_github_config(raw_config or {})
    username = normalized["github_username"]
    token = normalized["github_token"]

    existing = get_project_github_config(project_id, user_id=user_id, include_token=True)
    if not username and existing:
        username = existing.get("github_username", "")
    if not username:
        raise ProjectMCPError("GitHub username is required.")

    if token:
        token_encrypted = encrypt_token(token)
    elif existing and existing.get("token_encrypted"):
        token_encrypted = existing["token_encrypted"]
    else:
        raise ProjectMCPError("GitHub token is required.")

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "project_id": str(project_id),
        "user_id": str(user_id),
        "provider": GITHUB_PROVIDER,
        "github_username": username,
        "token_encrypted": token_encrypted,
        "enabled": bool(raw_config.get("enabled", True)),
        "updated_at": now,
    }
    _clear_project_tool_cache(str(project_id))
    saved = upsert_mcp_configuration(row)
    return {
        "success": True,
        "configuration": {
            "githubUsername": saved.get("github_username", username),
            "enabled": saved.get("enabled", True),
            "tokenConfigured": True,
            "tokenPreview": _mask_token(token) if token else "********",
            "updatedAt": saved.get("updated_at", now),
        },
    }


def save_project_notion_config(project_id: str, user_id: str, raw_config: dict) -> dict:
    if not project_id:
        raise ProjectMCPError("project_id is required.")
    if not user_id:
        raise ProjectMCPError("user_id is required.")

    normalized = _normalize_notion_config(raw_config or {})
    token = normalized["notion_token"]
    workspace_name = normalized["workspace_name"]

    existing = get_project_notion_config(project_id, user_id=user_id, include_token=True)
    if not workspace_name and existing:
        workspace_name = existing.get("workspace_name", "")

    if token:
        token_encrypted = encrypt_token(token)
    elif existing and existing.get("token_encrypted"):
        token_encrypted = existing["token_encrypted"]
    else:
        raise ProjectMCPError("Notion token is required.")

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "project_id": str(project_id),
        "user_id": str(user_id),
        "provider": NOTION_PROVIDER,
        "workspace_name": workspace_name,
        "token_encrypted": token_encrypted,
        "enabled": bool(raw_config.get("enabled", True)),
        "updated_at": now,
    }
    _clear_project_tool_cache(str(project_id))
    saved = upsert_mcp_configuration(row)
    return {
        "success": True,
        "configuration": {
            "workspaceName": saved.get("workspace_name", workspace_name),
            "enabled": saved.get("enabled", True),
            "tokenConfigured": True,
            "tokenPreview": _mask_token(token) if token else "********",
            "authType": saved.get("auth_type") or "token",
            "updatedAt": saved.get("updated_at", now),
        },
    }


def _store_project_notion_oauth_tokens(
    project_id: str,
    user_id: str,
    workspace_name: str,
    tokens: dict[str, Any],
    client: dict[str, Any],
    token_endpoint: str,
) -> dict:
    access_token = tokens.get("access_token")
    if not access_token:
        raise ProjectMCPError("Notion OAuth token response did not include an access token.")

    existing = get_project_notion_config(project_id, user_id=user_id, include_token=True) or {}
    refresh_token = tokens.get("refresh_token") or existing.get("notion_refresh_token")
    expires_in = int(tokens.get("expires_in") or 3600)
    expires_at = int(time.time()) + expires_in
    now = datetime.now(timezone.utc).isoformat()

    row = {
        "project_id": str(project_id),
        "user_id": str(user_id),
        "provider": NOTION_PROVIDER,
        "workspace_name": workspace_name or existing.get("workspace_name", ""),
        "token_encrypted": encrypt_token(access_token),
        "enabled": True,
        "auth_type": "oauth",
        "oauth_client": {
            "client_id": client.get("client_id"),
        },
        "token_endpoint": token_endpoint,
        "expires_at": expires_at,
        "updated_at": now,
    }
    if client.get("client_secret"):
        row["oauth_client"]["client_secret_encrypted"] = encrypt_token(client["client_secret"])
    if refresh_token:
        row["refresh_token_encrypted"] = encrypt_token(refresh_token)

    _clear_project_tool_cache(str(project_id))
    upsert_mcp_configuration(row)
    return {
        "success": True,
        "configuration": {
            "workspaceName": row["workspace_name"],
            "enabled": True,
            "tokenConfigured": True,
            "tokenPreview": _mask_token(access_token),
            "authType": "oauth",
            "updatedAt": now,
        },
    }


def start_notion_oauth(
    project_id: str,
    user_id: str,
    redirect_uri: str,
    workspace_name: str = "",
) -> dict:
    if not project_id:
        raise ProjectMCPError("project_id is required.")
    if not user_id:
        raise ProjectMCPError("user_id is required.")
    if not redirect_uri:
        raise ProjectMCPError("redirect_uri is required.")

    metadata = _run_async_task(_discover_notion_oauth_metadata())
    client = _run_async_task(_register_notion_oauth_client(metadata, redirect_uri))
    client_id = client.get("client_id")
    if not client_id:
        raise ProjectMCPError("Notion OAuth registration did not return a client_id.")

    code_verifier, code_challenge = _generate_pkce()
    state = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    insert_oauth_state(
        {
            "state": state,
            "provider": NOTION_PROVIDER,
            "project_id": str(project_id),
            "user_id": str(user_id),
            "workspace_name": str(workspace_name or "").strip(),
            "code_verifier": code_verifier,
            "redirect_uri": redirect_uri,
            "client": {
                "client_id": client_id,
                "client_secret": client.get("client_secret"),
            },
            "token_endpoint": metadata["token_endpoint"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at.isoformat(),
        }
    )

    authorization_url = (
        f"{metadata['authorization_endpoint']}?"
        + urlencode(
            {
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "prompt": "consent",
            }
        )
    )
    return {
        "success": True,
        "authorizationUrl": authorization_url,
        "state": state,
        "expiresAt": expires_at.isoformat(),
    }


def complete_notion_oauth(code: str, state: str) -> dict:
    if not code:
        raise ProjectMCPError("Notion OAuth callback did not include a code.")
    if not state:
        raise ProjectMCPError("Notion OAuth callback did not include state.")

    state_doc = consume_oauth_state(state)
    if not state_doc or state_doc.get("provider") not in (None, NOTION_PROVIDER):
        raise ProjectMCPError("Notion OAuth state is invalid or expired.")

    client = state_doc.get("client") or {}
    token_payload = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client.get("client_id", ""),
        "redirect_uri": state_doc["redirect_uri"],
        "code_verifier": state_doc["code_verifier"],
    }
    if client.get("client_secret"):
        token_payload["client_secret"] = client["client_secret"]

    tokens = _run_async_task(_oauth_post_form(state_doc["token_endpoint"], token_payload))
    return _store_project_notion_oauth_tokens(
        project_id=state_doc["project_id"],
        user_id=state_doc["user_id"],
        workspace_name=state_doc.get("workspace_name", ""),
        tokens=tokens,
        client=client,
        token_endpoint=state_doc["token_endpoint"],
    )


def _refresh_project_notion_token(config: dict) -> str:
    refresh_token = config.get("notion_refresh_token")
    if not refresh_token:
        token = config.get("notion_token")
        if token:
            return token
        raise ProjectMCPError("Notion OAuth refresh token is not available. Reconnect Notion MCP.")

    client = config.get("oauth_client") or {}
    token_endpoint = config.get("token_endpoint")
    if not token_endpoint or not client.get("client_id"):
        raise ProjectMCPError("Stored Notion OAuth client metadata is incomplete. Reconnect Notion MCP.")
    client_secret = client.get("client_secret")
    if not client_secret and client.get("client_secret_encrypted"):
        client_secret = decrypt_token(client["client_secret_encrypted"], provider=NOTION_PROVIDER)

    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client["client_id"],
    }
    if client_secret:
        payload["client_secret"] = client_secret

    tokens = _run_async_task(_oauth_post_form(token_endpoint, payload))
    saved = _store_project_notion_oauth_tokens(
        project_id=config["project_id"],
        user_id=config["user_id"],
        workspace_name=config.get("workspace_name", ""),
        tokens=tokens,
        client=client,
        token_endpoint=token_endpoint,
    )
    logger.info("Refreshed Notion MCP OAuth token for project %s", config["project_id"])
    return tokens.get("access_token") or saved.get("configuration", {}).get("token")


def get_valid_project_notion_access_token(project_id: str, user_id: Optional[str] = None) -> str:
    config = get_project_notion_config(project_id, user_id=user_id, include_token=True)
    if not config or not config.get("enabled", True):
        raise ProjectMCPError("Notion MCP is not configured for this project.")

    token = config.get("notion_token")
    if config.get("auth_type") != "oauth":
        if token:
            return token
        raise ProjectMCPError("Notion MCP token is not configured for this project.")

    if token and int(config.get("expires_at") or 0) > int(time.time()) + 300:
        return token
    return _refresh_project_notion_token(config)


def _store_project_google_drive_oauth_tokens(
    project_id: str,
    user_id: str,
    account_label: str,
    tokens: dict[str, Any],
    client: dict[str, str],
) -> dict:
    access_token = tokens.get("access_token")
    if not access_token:
        raise ProjectMCPError("Google Drive OAuth token response did not include an access token.")

    existing = get_project_google_drive_config(project_id, user_id=user_id, include_token=True) or {}
    refresh_token = tokens.get("refresh_token") or existing.get("google_drive_refresh_token")
    expires_in = int(tokens.get("expires_in") or 3600)
    expires_at = int(time.time()) + expires_in
    account_email = _run_async_task(_fetch_google_account_email(access_token)) or existing.get("account_email", "")
    granted_scope = _run_async_task(_fetch_google_token_scopes(access_token)) or tokens.get("scope") or ""
    now = datetime.now(timezone.utc).isoformat()

    row = {
        "project_id": str(project_id),
        "user_id": str(user_id),
        "provider": GOOGLE_DRIVE_PROVIDER,
        "account_label": account_label or existing.get("account_label", ""),
        "account_email": account_email,
        "token_encrypted": encrypt_token(access_token),
        "enabled": True,
        "auth_type": "oauth",
        "oauth_client": {
            "client_id": client["client_id"],
            "client_secret_encrypted": encrypt_token(client["client_secret"]),
        },
        "token_endpoint": GOOGLE_OAUTH_TOKEN_URL,
        "mcp_server": GOOGLE_DRIVE_MCP_SERVER,
        "scope": granted_scope or f"{GOOGLE_DRIVE_SCOPES} {GOOGLE_USERINFO_SCOPES}",
        "token_type": tokens.get("token_type") or "Bearer",
        "expires_at": expires_at,
        "updated_at": now,
    }
    if refresh_token:
        row["refresh_token_encrypted"] = encrypt_token(refresh_token)

    _clear_project_tool_cache(str(project_id))
    upsert_mcp_configuration(row)
    return {
        "success": True,
        "configuration": {
            "accountLabel": row["account_label"],
            "accountEmail": account_email,
            "enabled": True,
            "tokenConfigured": True,
            "tokenPreview": _mask_token(access_token),
            "authType": "oauth",
            "grantedScopes": granted_scope,
            "updatedAt": now,
        },
    }


def start_google_drive_oauth(
    project_id: str,
    user_id: str,
    redirect_uri: str,
    account_label: str = "",
) -> dict:
    if not project_id:
        raise ProjectMCPError("project_id is required.")
    if not user_id:
        raise ProjectMCPError("user_id is required.")
    if not redirect_uri:
        raise ProjectMCPError("redirect_uri is required.")

    client = _google_oauth_client()
    code_verifier, code_challenge = _generate_pkce()
    state = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    insert_oauth_state(
        {
            "state": state,
            "provider": GOOGLE_DRIVE_PROVIDER,
            "project_id": str(project_id),
            "user_id": str(user_id),
            "account_label": str(account_label or "").strip(),
            "code_verifier": code_verifier,
            "redirect_uri": redirect_uri,
            "client": client,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at.isoformat(),
        }
    )

    authorization_url = (
        f"{GOOGLE_OAUTH_AUTH_URL}?"
        + urlencode(
            {
                "response_type": "code",
                "client_id": client["client_id"],
                "redirect_uri": redirect_uri,
                "state": state,
                "scope": f"{GOOGLE_DRIVE_SCOPES} {GOOGLE_USERINFO_SCOPES}",
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true",
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )
    )
    return {
        "success": True,
        "authorizationUrl": authorization_url,
        "state": state,
        "expiresAt": expires_at.isoformat(),
    }


def complete_google_drive_oauth(code: str, state: str) -> dict:
    if not code:
        raise ProjectMCPError("Google Drive OAuth callback did not include a code.")
    if not state:
        raise ProjectMCPError("Google Drive OAuth callback did not include state.")

    state_doc = consume_oauth_state(state)
    if not state_doc or state_doc.get("provider") != GOOGLE_DRIVE_PROVIDER:
        raise ProjectMCPError("Google Drive OAuth state is invalid or expired.")

    client = state_doc.get("client") or {}
    token_payload = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client.get("client_id", ""),
        "client_secret": client.get("client_secret", ""),
        "redirect_uri": state_doc["redirect_uri"],
        "code_verifier": state_doc["code_verifier"],
    }

    tokens = _run_async_task(_oauth_post_form(GOOGLE_OAUTH_TOKEN_URL, token_payload))
    return _store_project_google_drive_oauth_tokens(
        project_id=state_doc["project_id"],
        user_id=state_doc["user_id"],
        account_label=state_doc.get("account_label", ""),
        tokens=tokens,
        client=client,
    )


def _refresh_project_google_drive_token(config: dict) -> str:
    refresh_token = config.get("google_drive_refresh_token")
    if not refresh_token:
        token = config.get("google_drive_token")
        if token:
            return token
        raise ProjectMCPError("Google Drive OAuth refresh token is not available. Reconnect Google Drive MCP.")

    client = config.get("oauth_client") or {}
    client_secret = client.get("client_secret")
    if not client_secret and client.get("client_secret_encrypted"):
        client_secret = decrypt_token(client["client_secret_encrypted"], provider=GOOGLE_DRIVE_PROVIDER)
    if not client.get("client_id") or not client_secret:
        raise ProjectMCPError("Stored Google Drive OAuth client metadata is incomplete. Reconnect Google Drive MCP.")

    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client["client_id"],
        "client_secret": client_secret,
    }
    tokens = _run_async_task(_oauth_post_form(config.get("token_endpoint") or GOOGLE_OAUTH_TOKEN_URL, payload))
    _store_project_google_drive_oauth_tokens(
        project_id=config["project_id"],
        user_id=config["user_id"],
        account_label=config.get("account_label", ""),
        tokens=tokens,
        client={"client_id": client["client_id"], "client_secret": client_secret},
    )
    logger.info("Refreshed Google Drive MCP OAuth token for project %s", config["project_id"])
    return tokens["access_token"]


def get_valid_project_google_drive_config(project_id: str, user_id: Optional[str] = None) -> dict:
    config = get_project_google_drive_config(project_id, user_id=user_id, include_token=True)
    if not config or not config.get("enabled", True):
        raise ProjectMCPError("Google Drive MCP is not configured for this project.")

    if _google_drive_needs_reconnect(config):
        if config.get("mcp_server") != GOOGLE_DRIVE_MCP_SERVER:
            raise ProjectMCPError(
                "Google Drive is connected with the previous official MCP integration. "
                "Disconnect and reconnect Google Drive for this project."
            )
        missing_scopes = _missing_google_drive_scopes(config.get("scope", ""))
        if missing_scopes:
            raise ProjectMCPError(
                "Google Drive is connected, but the saved OAuth grant is missing required scopes: "
                f"{', '.join(sorted(missing_scopes))}. Disconnect and reconnect Google Drive MCP, "
                "then approve Drive access on the Google consent screen."
            )
        raise ProjectMCPError(
            "Google Drive OAuth refresh token is not available. Disconnect and reconnect Google Drive MCP."
        )

    token = config.get("google_drive_token")
    if token and int(config.get("expires_at") or 0) > int(time.time()) + 300:
        return config
    _refresh_project_google_drive_token(config)
    refreshed = get_project_google_drive_config(project_id, user_id=user_id, include_token=True)
    if not refreshed:
        raise ProjectMCPError("Google Drive MCP is not configured for this project.")
    return refreshed


def get_valid_project_google_drive_access_token(project_id: str, user_id: Optional[str] = None) -> str:
    config = get_valid_project_google_drive_config(project_id, user_id=user_id)
    token = config.get("google_drive_token")
    if not token:
        raise ProjectMCPError("Google Drive MCP access token is not available. Reconnect Google Drive MCP.")
    return token


def delete_project_provider_config(
    project_id: str,
    provider: str,
    user_id: Optional[str] = None,
) -> dict:
    if provider not in SUPPORTED_PROVIDERS:
        raise ProjectMCPError(f"Unsupported MCP provider: {provider}")
    delete_mcp_configurations(str(project_id), provider, user_id=str(user_id) if user_id else None)
    _clear_project_tool_cache(str(project_id))
    return {"success": True}


def _ensure_mcp_runtime_available():
    if ClientSession is None:
        raise ProjectMCPError("Python package 'mcp' is not installed. Install backend requirements first.")
    if stdio_client is None or StdioServerParameters is None:
        raise ProjectMCPError("Python MCP stdio client is not available. Upgrade the 'mcp' package.")
    if not shutil.which("npx"):
        raise ProjectMCPError("npx is required to run MCP servers for GitHub and Google Drive.")


def _ensure_notion_mcp_runtime_available():
    if ClientSession is None:
        raise ProjectMCPError("Python package 'mcp' is not installed. Install backend requirements first.")
    if streamablehttp_client is None:
        raise ProjectMCPError("Python MCP streamable HTTP client is not available. Upgrade the 'mcp' package.")

def call_project_notion_mcp_tool(
    project_id: str,
    tool_name: str,
    arguments: dict,
    user_id: Optional[str] = None,
) -> str:
    config = get_project_notion_config(project_id, user_id=user_id, include_token=False)
    if not config or not config.get("enabled", True):
        raise ProjectMCPError("Notion MCP is not configured for this project.")
    notion_token = get_valid_project_notion_access_token(project_id, user_id=user_id)
    return _run_async_task(_call_notion_tool(notion_token, tool_name, arguments or {}))

def _github_server_env(token: str) -> dict:
    env = os.environ.copy()
    env["GITHUB_PERSONAL_ACCESS_TOKEN"] = token
    env["GITHUB_TOKEN"] = token
    return env


def _realtime_tool_schema(tool: Any) -> dict:
    input_schema = getattr(tool, "inputSchema", None) or {"type": "object", "properties": {}}
    return {
        "type": "function",
        "name": getattr(tool, "name", ""),
        "description": getattr(tool, "description", "") or "",
        "parameters": input_schema,
    }


def _mcp_result_to_text(result: Any) -> str:
    parts = []
    for block in getattr(result, "content", []) or []:
        if hasattr(block, "text"):
            parts.append(block.text)
        else:
            parts.append(str(block))
    return "\n".join(parts)


def _raise_if_mcp_error(result: Any, provider: str, tool_name: str):
    output = _mcp_result_to_text(result)
    is_error = bool(getattr(result, "isError", False) or getattr(result, "is_error", False))
    permission_denied = "does not have permission" in output.lower() or "permission denied" in output.lower()
    if not is_error and not permission_denied:
        return

    if provider == GOOGLE_DRIVE_PROVIDER and permission_denied:
        raise ProjectMCPError(
            f"Google Drive MCP tool '{tool_name}' was denied by Google: {output}. "
            "Verify that Google Drive API is enabled in your Google Cloud project, the OAuth consent "
            "screen includes drive.file scope, and the connected account approved access."
        )
    raise ProjectMCPError(f"{provider} MCP tool '{tool_name}' failed: {output or 'Unknown MCP error'}")


async def _list_github_tools(token: str) -> list[dict]:
    _ensure_mcp_runtime_available()
    params = StdioServerParameters(
        command="npx",
        args=["-y", "@modelcontextprotocol/server-github"],
        env=_github_server_env(token),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            return [_realtime_tool_schema(tool) for tool in result.tools]


async def _list_notion_tools(token: str) -> list[dict]:
    _ensure_notion_mcp_runtime_available()
    headers = {"Authorization": f"Bearer {token}"}
    async with streamablehttp_client(NOTION_MCP_URL, headers=headers) as transport:
        read, write, _ = transport
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            return [_realtime_tool_schema(tool) for tool in result.tools]


async def _list_google_drive_tools(config: dict) -> list[dict]:
    _ensure_mcp_runtime_available()
    params = _google_drive_stdio_params(config)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            return [_realtime_tool_schema(tool) for tool in result.tools]


async def _call_github_tool(token: str, tool_name: str, arguments: dict) -> str:
    _ensure_mcp_runtime_available()
    params = StdioServerParameters(
        command="npx",
        args=["-y", "@modelcontextprotocol/server-github"],
        env=_github_server_env(token),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments or {})

    _raise_if_mcp_error(result, GITHUB_PROVIDER, tool_name)
    return _mcp_result_to_text(result)


async def _call_notion_tool(token: str, tool_name: str, arguments: dict) -> str:
    _ensure_notion_mcp_runtime_available()
    headers = {"Authorization": f"Bearer {token}"}
    async with streamablehttp_client(NOTION_MCP_URL, headers=headers) as transport:
        read, write, _ = transport
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments or {})

    _raise_if_mcp_error(result, NOTION_PROVIDER, tool_name)
    return _mcp_result_to_text(result)


async def _call_google_drive_tool(config: dict, tool_name: str, arguments: dict) -> str:
    _ensure_mcp_runtime_available()
    params = _google_drive_stdio_params(config)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments or {})

    _raise_if_mcp_error(result, GOOGLE_DRIVE_PROVIDER, tool_name)
    return _mcp_result_to_text(result)


def list_project_mcp_tools(project_id: str, user_id: Optional[str] = None) -> list[dict]:
    cache_key = _cache_key(str(project_id), user_id)
    cached = _TOOL_CACHE.get(cache_key)
    if cached and time.time() - cached["created_at"] < _TOOL_CACHE_TTL_SECONDS:
        return cached["tools"]

    tools = []
    tool_provider_map = {}

    github_config = get_project_github_config(project_id, user_id=user_id, include_token=True)
    if github_config and github_config.get("enabled", True):
        github_tools = _run_async_task(_list_github_tools(github_config["github_token"]))
        tools.extend(github_tools)
        for tool in github_tools:
            if tool.get("name"):
                tool_provider_map[tool["name"]] = GITHUB_PROVIDER

    notion_config = get_project_notion_config(project_id, user_id=user_id, include_token=True)
    if notion_config and notion_config.get("enabled", True):
        notion_token = get_valid_project_notion_access_token(project_id, user_id=user_id)
        notion_tools = _run_async_task(_list_notion_tools(notion_token))
        tools.extend(notion_tools)
        for tool in notion_tools:
            if tool.get("name"):
                tool_provider_map[tool["name"]] = NOTION_PROVIDER

    google_drive_config = get_project_google_drive_config(project_id, user_id=user_id, include_token=False)
    if google_drive_config and google_drive_config.get("enabled", True):
        google_drive_runtime = get_valid_project_google_drive_config(project_id, user_id=user_id)
        google_drive_tools = _run_async_task(_list_google_drive_tools(google_drive_runtime))
        tools.extend(google_drive_tools)
        for tool in google_drive_tools:
            if tool.get("name"):
                tool_provider_map[tool["name"]] = GOOGLE_DRIVE_PROVIDER

    _TOOL_CACHE[cache_key] = {
        "created_at": time.time(),
        "tools": tools,
        "tool_provider_map": tool_provider_map,
    }
    return tools


def call_project_mcp_tool(
    project_id: str,
    tool_name: str,
    arguments: dict,
    user_id: Optional[str] = None,
) -> dict:
    cache_key = _cache_key(str(project_id), user_id)
    cached = _TOOL_CACHE.get(cache_key)
    if not cached or time.time() - cached["created_at"] >= _TOOL_CACHE_TTL_SECONDS:
        list_project_mcp_tools(project_id, user_id=user_id)
        cached = _TOOL_CACHE.get(cache_key, {})

    provider = cached.get("tool_provider_map", {}).get(tool_name)
    if provider == GITHUB_PROVIDER:
        config = get_project_github_config(project_id, user_id=user_id, include_token=True)
        if not config or not config.get("enabled", True):
            raise ProjectMCPError("GitHub MCP is not configured for this project.")
        result = _run_async_task(_call_github_tool(config["github_token"], tool_name, arguments or {}))
    elif provider == NOTION_PROVIDER:
        config = get_project_notion_config(project_id, user_id=user_id, include_token=False)
        if not config or not config.get("enabled", True):
            raise ProjectMCPError("Notion MCP is not configured for this project.")
        notion_token = get_valid_project_notion_access_token(project_id, user_id=user_id)
        result = _run_async_task(_call_notion_tool(notion_token, tool_name, arguments or {}))
    elif provider == GOOGLE_DRIVE_PROVIDER:
        config = get_project_google_drive_config(project_id, user_id=user_id, include_token=False)
        if not config or not config.get("enabled", True):
            raise ProjectMCPError("Google Drive MCP is not configured for this project.")
        google_drive_runtime = get_valid_project_google_drive_config(project_id, user_id=user_id)
        result = _run_async_task(_call_google_drive_tool(google_drive_runtime, tool_name, arguments or {}))
    else:
        raise ProjectMCPError(f"Tool '{tool_name}' is not available for this project's configured MCP servers.")

    return {
        "success": True,
        "provider": provider,
        "tool": tool_name,
        "data": result,
    }
