"""
Shared application URLs — loaded from config/appUrls.json with .env overrides.

Secrets (Supabase keys, OAuth client ids) stay in environment variables only.
Other modules import constants from here instead of hard-coding external URLs.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "appUrls.json"


@lru_cache(maxsize=1)
def _load_url_config() -> dict:
    with _CONFIG_PATH.open(encoding="utf-8") as config_file:
        return json.load(config_file)


def _strip_trailing_slash(value: str) -> str:
    return value.strip().rstrip("/")


_URLS = _load_url_config()
_LOCAL = _URLS["local"]
_NOTION = _URLS["notion"]
_GOOGLE = _URLS["google"]
_OPENAI = _URLS["openai"]

# ---------------------------------------------------------------------------
# Local / internal services
# ---------------------------------------------------------------------------

API_HOST = os.getenv("API_HOST", _LOCAL["apiHost"])
API_PORT = os.getenv("API_PORT", _LOCAL["apiPort"])
BACKEND_BASE_URL = _strip_trailing_slash(
    os.getenv("BACKEND_BASE_URL", _LOCAL["backendBaseUrl"])
)

MCP_NOTION_LOCAL_URL = _strip_trailing_slash(
    os.getenv("MCP_NOTION_LOCAL_URL", _LOCAL["mcpNotionLocalUrl"])
)
MCP_SERVERS = {
    "notion": MCP_NOTION_LOCAL_URL,
}

A2A_DOCUMENT_AGENT_URL = _strip_trailing_slash(
    os.getenv("A2A_DOCUMENT_AGENT_URL", _LOCAL["a2aDocumentAgentUrl"])
)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "").strip()

# ---------------------------------------------------------------------------
# Supabase (credentials stay in .env)
# ---------------------------------------------------------------------------


def get_supabase_url() -> str:
    return (os.getenv("VITE_SUPABASE_URL") or "").strip()


# ---------------------------------------------------------------------------
# Notion
# ---------------------------------------------------------------------------

NOTION_API_BASE = _NOTION["apiBase"]
NOTION_MCP_URL = _NOTION["mcpUrl"]
NOTION_OAUTH_PROTECTED_RESOURCE_URL = _NOTION["oauthProtectedResourceUrl"]

# ---------------------------------------------------------------------------
# Google Drive / OAuth
# ---------------------------------------------------------------------------

DRIVE_API_BASE = _GOOGLE["driveApiBase"]
DRIVE_UPLOAD_BASE = _GOOGLE["driveUploadBase"]

GOOGLE_OAUTH_AUTH_URL = _GOOGLE["oauthAuthUrl"]
GOOGLE_OAUTH_TOKEN_URL = _GOOGLE["oauthTokenUrl"]
GOOGLE_USERINFO_URL = _GOOGLE["userinfoUrl"]
GOOGLE_TOKENINFO_URL = _GOOGLE["tokeninfoUrl"]
GOOGLE_DRIVE_SCOPES = _GOOGLE["driveScopes"]
GOOGLE_DRIVE_REQUIRED_SCOPES = {
    GOOGLE_DRIVE_SCOPES,
}

# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------

OPENAI_CHAT_COMPLETIONS_URL = _OPENAI["chatCompletions"]
OPENAI_REALTIME_CLIENT_SECRETS_URL = _OPENAI["realtimeClientSecrets"]
