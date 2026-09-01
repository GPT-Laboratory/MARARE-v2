"""Project-scoped MCP chat agent for orchestrating connected provider tools."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from openai import AsyncOpenAI

from python_files.project_mcp import (
    ProjectMCPError,
    call_project_mcp_tool,
    get_project_google_drive_config,
    list_project_mcp_tools,
)

DRIVE_CREATE_TOOL_PATTERN = re.compile(r"create[-_]?file", re.IGNORECASE)
DRIVE_RETRIEVE_TOOL_PATTERN = re.compile(
    r"(search|find|list|get|read|export|download).*(file|document|drive)?|"
    r"(file|document|drive).*(search|find|list|get|read|export|download)",
    re.IGNORECASE,
)
SHEETS_TOOL_PATTERN = re.compile(r"^sheets-", re.IGNORECASE)
DRIVE_FOLDER_TOOL_PATTERN = re.compile(r"(search-files|list-files|create-folder|move-file)", re.IGNORECASE)
DEFAULT_MODEL = os.getenv("MCP_AGENT_MODEL", "gpt-4o")
MAX_TOOL_RESULT_CHARS = 60000
DRIVE_DOCUMENT_TITLE_PREFIX = "MARARE Project Document"
DRIVE_ROOT_FOLDER_NAME = "MARARE MCP Documents"
SHEETS_DOCUMENT_SPREADSHEET_NAME = "Project Documents Sheet"
SHEETS_DOCUMENT_TAB_NAME = "Documents"


class ProjectMCPChatAgentError(RuntimeError):
    """Raised when the project MCP chat agent cannot complete a task."""


def _tools_to_openai_format(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for tool in tools:
        name = tool.get("name")
        if not name:
            continue
        formatted.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": tool.get("description") or "",
                    "parameters": tool.get("parameters")
                    or {"type": "object", "properties": {}},
                },
            }
        )
    return formatted


def _filter_drive_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    create_file_tools = [
        tool
        for tool in tools
        if str(tool.get("name", "")).lower() == "create-file"
    ]
    if create_file_tools:
        return create_file_tools

    drive_tools = [
        tool
        for tool in tools
        if DRIVE_CREATE_TOOL_PATTERN.search(str(tool.get("name", "")))
    ]
    if drive_tools:
        return drive_tools

    return [
        tool
        for tool in tools
        if "drive" in str(tool.get("name", "")).lower()
        or "google" in str(tool.get("description", "")).lower()
    ]


def _filter_drive_retrieval_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    safe_tools = []
    for tool in tools:
        name = str(tool.get("name", ""))
        description = str(tool.get("description", ""))
        searchable = f"{name} {description}"
        if not DRIVE_RETRIEVE_TOOL_PATTERN.search(searchable):
            continue
        if re.search(r"(create|upload|delete|remove|trash|update|write)", searchable, re.IGNORECASE):
            continue
        safe_tools.append(tool)
    return safe_tools


def _filter_sheets_document_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = []
    allowed_names = {
        "search-files",
        "list-files",
        "create-folder",
        "move-file",
        "sheets-create-spreadsheet",
        "sheets-get-spreadsheet",
        "sheets-get-values",
        "sheets-update-values",
        "sheets-append-values",
        "sheets-manage-sheets",
    }
    for tool in tools:
        name = str(tool.get("name", ""))
        if name in allowed_names or SHEETS_TOOL_PATTERN.search(name) or DRIVE_FOLDER_TOOL_PATTERN.search(name):
            allowed.append(tool)
    return allowed


def drive_document_title(project_id: str) -> str:
    return f"{DRIVE_DOCUMENT_TITLE_PREFIX} - {project_id}"


def _minified_json(data: dict[str, Any]) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def _truncate_tool_result(result: Any) -> str:
    content = json.dumps(result) if result is not None else json.dumps({"error": "No result"})
    if len(content) <= MAX_TOOL_RESULT_CHARS:
        return content
    if isinstance(result, dict):
        trimmed = dict(result)
        if "data" in trimmed:
            trimmed["data"] = str(trimmed["data"])[:3000] + "... [truncated]"
        return json.dumps(trimmed)
    return json.dumps({"preview": str(result)[:3000], "truncated": True})


def _json_from_model_text(text: str) -> dict[str, Any]:
    if not text:
        raise ProjectMCPChatAgentError("Drive retrieval agent returned an empty response.")

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    raise ProjectMCPChatAgentError("Drive retrieval agent did not return valid JSON.")




class ProjectMCPChatAgent:
    def __init__(self, openai_api_key: Optional[str] = None):
        api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ProjectMCPChatAgentError("OPENAI_API_KEY is not configured.")
        self.client = AsyncOpenAI(api_key=api_key)
        self.export_payload: dict[str, Any] = {}
        self.sheets_payload: dict[str, Any] = {}

    def _enrich_drive_tool_arguments(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if not self.export_payload:
            return arguments

        if not DRIVE_CREATE_TOOL_PATTERN.search(tool_name):
            return arguments

        payload = self.export_payload
        enriched = dict(arguments or {})
        export_format = payload.get("format")
        title = payload.get("title") or enriched.get("name") or enriched.get("title") or "Meeting Document"
        enriched["name"] = title
        enriched.pop("title", None)

        if export_format == "google_doc":
            enriched["mimeType"] = "application/vnd.google-apps.document"
            if payload.get("text_content"):
                enriched["content"] = payload["text_content"]
            elif payload.get("html_content"):
                enriched["content"] = payload["html_content"]

        enriched.pop("contentMimeType", None)
        enriched.pop("base64Content", None)
        enriched.pop("textContent", None)
        enriched.setdefault("parentId", "root")

        return enriched

    def _drive_export_system_prompt(self, tools: list[dict[str, Any]]) -> str:
        tool_names = ", ".join(tool.get("name", "") for tool in tools if tool.get("name"))
        return f"""
You are a project assistant that saves meeting documents to Google Drive using MCP tools.

Rules:
1. Use ONLY the available Google Drive MCP tools: {tool_names or "create-file"}.
2. When asked to save a document, call create-file immediately.
3. Do not ask follow-up questions unless a required tool argument is truly missing.
4. The create-file tool expects name, content, mimeType, and optional parentId.
5. Use application/vnd.google-apps.document so Google Drive stores editable content.
6. Use the provided file title exactly as the name.
7. After the tool succeeds, confirm success with the file name.

The backend attaches file content automatically when you call create-file.
""".strip()

    def _drive_retrieval_system_prompt(self, tools: list[dict[str, Any]]) -> str:
        tool_names = ", ".join(tool.get("name", "") for tool in tools if tool.get("name"))
        return f"""
You are a project assistant that retrieves meeting documents from Google Drive using MCP tools.

Rules:
1. Use ONLY the available Google Drive MCP retrieval tools: {tool_names}.
2. Search for the exact provided file name first.
3. If multiple files match, choose the most recently modified Google Doc or document-like file.
4. After finding a file, use an MCP tool to read/export/download its text content if such a tool is available.
5. Do not call create, upload, update, delete, remove, or write tools.
6. Return ONLY valid JSON with this shape:
{{
  "found": true,
  "fileId": "string or null",
  "fileName": "string",
  "mimeType": "string or null",
  "modifiedTime": "string or null",
  "webViewLink": "string or null",
  "content": "full document text if available, otherwise a useful preview"
}}
7. If no matching file exists, return:
{{"found": false, "content": ""}}
""".strip()

    def _sheets_document_system_prompt(self, tools: list[dict[str, Any]], mode: str) -> str:
        tool_names = ", ".join(tool.get("name", "") for tool in tools if tool.get("name"))
        return f"""
You are a project document storage agent. You store and retrieve MARARE documents using Google Drive folder tools and Google Sheets MCP tools only.

Available tools: {tool_names}

Storage contract:
- Root folder name: "{DRIVE_ROOT_FOLDER_NAME}"
- Project folder name: the exact provided projectName
- Spreadsheet name inside project folder: "{SHEETS_DOCUMENT_SPREADSHEET_NAME}"
- Sheet/tab name: "{SHEETS_DOCUMENT_TAB_NAME}"
- Columns:
  A = document_id
  B = updated_at
  C = payload_json

Rules:
1. Use only the provided MCP tools. Do not use Google REST APIs.
2. Use Drive folder tools only to search/create folders and move the spreadsheet into the project folder if needed.
3. Use Sheets tools for spreadsheet reads/writes.
4. Column C must contain a minified valid JSON string only. No markdown, no commentary, no pretty formatting.
5. document_id must exactly equal the provided documentId.
6. For save mode, update an existing row if document_id exists; otherwise append a new row.
7. If the sheet is empty, create the header row first: document_id, updated_at, payload_json.
8. For save mode, the backend injects the exact row values into Sheets write tool arguments. Do not rewrite, summarize, shorten, or manually copy payload JSON.
9. For retrieve mode, after finding the spreadsheet, call sheets-get-values for Documents!A:C. Do not repeat search more than twice.
10. For retrieve mode, read rows and return the parsed JSON payload for document_id.
11. For save mode, return exactly:
{{"success":true,"documentId":"...","spreadsheetId":"...","fileName":"Project Documents Sheet","source":"google_sheets_mcp","message":"Document saved to Google Sheets."}}
12. For retrieve mode, return exactly:
{{"found":true,"document":{{...parsed Column C payload...}},"spreadsheetId":"...","fileName":"Project Documents Sheet","source":"google_sheets_mcp"}}
13. If retrieve mode finds no matching row or no spreadsheet, return:
{{"found":false,"content":"","source":"google_sheets_mcp"}}
14. Return ONLY valid JSON.

Mode: {mode}
""".strip()

    def _enrich_sheets_tool_arguments(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if not self.sheets_payload:
            return arguments

        if not re.search(r"sheets-(update-values|append-values|batch-update-values)", tool_name):
            return arguments

        enriched = dict(arguments or {})
        header_row = [["document_id", "updated_at", "payload_json"]]
        data_row = [[
            self.sheets_payload["document_id"],
            self.sheets_payload["updated_at"],
            self.sheets_payload["payload_json"],
        ]]

        def row_for_range(range_name: str) -> list[list[str]]:
            normalized = str(range_name or "").lower().replace("'", "")
            if re.search(r"(^|!)a1(?::c1)?$", normalized):
                return header_row
            return data_row

        if tool_name == "sheets-batch-update-values":
            data_items = enriched.get("data") or enriched.get("valueRanges") or enriched.get("value_ranges")
            if isinstance(data_items, list):
                updated_items = []
                for item in data_items:
                    if not isinstance(item, dict):
                        updated_items.append(item)
                        continue
                    item_copy = dict(item)
                    range_name = item_copy.get("range") or item_copy.get("rangeName") or item_copy.get("range_name")
                    item_copy["values"] = row_for_range(range_name)
                    updated_items.append(item_copy)
                if "data" in enriched:
                    enriched["data"] = updated_items
                elif "valueRanges" in enriched:
                    enriched["valueRanges"] = updated_items
                else:
                    enriched["value_ranges"] = updated_items
            elif "values" in enriched:
                enriched["values"] = data_row
            return enriched

        range_name = enriched.get("range") or enriched.get("rangeName") or enriched.get("range_name")
        enriched["values"] = row_for_range(range_name)
        return enriched

    async def export_meeting_document_to_drive(
        self,
        *,
        project_id: str,
        user_id: str,
        export_format: str,
        title: str,
        pdf_base64: Optional[str] = None,
        text_content: Optional[str] = None,
        html_content: Optional[str] = None,
    ) -> str:
        if not project_id or not user_id:
            raise ProjectMCPChatAgentError("project_id and user_id are required.")

        drive_config = get_project_google_drive_config(project_id, user_id=user_id, include_token=False)
        if not drive_config or not drive_config.get("token_encrypted"):
            raise ProjectMCPChatAgentError(
                "Google Drive MCP is not connected for this project. Connect it in Project MCP Configuration."
            )
        if not drive_config.get("enabled", True):
            raise ProjectMCPChatAgentError("Google Drive MCP is disabled for this project.")

        normalized_format = (export_format or "google_doc").lower()
        if normalized_format != "google_doc":
            raise ProjectMCPChatAgentError("Google Drive export only supports Google Docs.")

        if not (text_content or html_content):
            raise ProjectMCPChatAgentError("Google Doc export requires document text content.")

        all_tools = list_project_mcp_tools(project_id, user_id=user_id)
        drive_tools = _filter_drive_tools(all_tools)
        if not drive_tools:
            raise ProjectMCPChatAgentError(
                "No Google Drive create/upload MCP tools are available for this project."
            )

        openai_tools = _tools_to_openai_format(drive_tools)
        file_title = drive_document_title(project_id)
        self.export_payload = {
            "format": normalized_format,
            "title": file_title,
            "pdf_base64": pdf_base64,
            "text_content": text_content,
            "html_content": html_content,
        }

        user_message = (
            f"Save the meeting document '{file_title}' to the connected Google Drive for this project.\n"
            "Preferred format: Google Doc.\n"
            "Use create-file with name, content, mimeType, and parentId."
        )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._drive_export_system_prompt(drive_tools)},
            {"role": "user", "content": user_message},
        ]

        response = await self.client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=messages,
            tools=openai_tools,
            tool_choice="auto",
        )
        assistant_message = response.choices[0].message

        if not assistant_message.tool_calls:
            text = assistant_message.content or "The agent could not select a Google Drive tool."
            raise ProjectMCPChatAgentError(text)

        messages.append(
            {
                "role": "assistant",
                "content": assistant_message.content or "",
                "tool_calls": assistant_message.tool_calls,
            }
        )

        last_tool_result: dict[str, Any] | None = None
        for tool_call in assistant_message.tool_calls:
            tool_name = tool_call.function.name
            try:
                arguments = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError:
                arguments = {}

            arguments = self._enrich_drive_tool_arguments(tool_name, arguments)
            try:
                tool_result = call_project_mcp_tool(
                    project_id=str(project_id),
                    user_id=str(user_id),
                    tool_name=tool_name,
                    arguments=arguments,
                )
                last_tool_result = tool_result
            except ProjectMCPError as exc:
                tool_result = {"success": False, "error": str(exc)}
                last_tool_result = tool_result

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": _truncate_tool_result(tool_result),
                }
            )

        if isinstance(last_tool_result, dict) and last_tool_result.get("success") is False:
            error = last_tool_result.get("error") or "Google Drive MCP tool failed."
            raise ProjectMCPChatAgentError(str(error))

        final_response = await self.client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Summarize the Google Drive save result in one or two concise sentences. "
                        "Mention the file title and confirm success."
                    ),
                },
                *messages,
            ],
        )
        return final_response.choices[0].message.content or f"Document '{file_title}' saved to Google Drive."

    async def retrieve_meeting_document_from_drive(
        self,
        *,
        project_id: str,
        user_id: str,
    ) -> dict[str, Any]:
        if not project_id or not user_id:
            raise ProjectMCPChatAgentError("project_id and user_id are required.")

        drive_config = get_project_google_drive_config(project_id, user_id=user_id, include_token=False)
        if not drive_config or not drive_config.get("token_encrypted"):
            raise ProjectMCPChatAgentError(
                "Google Drive MCP is not connected for this project. Connect it in Project MCP Configuration."
            )
        if not drive_config.get("enabled", True):
            raise ProjectMCPChatAgentError("Google Drive MCP is disabled for this project.")

        all_tools = list_project_mcp_tools(project_id, user_id=user_id)
        drive_tools = _filter_drive_retrieval_tools(all_tools)
        if not drive_tools:
            raise ProjectMCPChatAgentError(
                "No Google Drive search/read MCP tools are available for this project."
            )

        file_title = drive_document_title(project_id)
        openai_tools = _tools_to_openai_format(drive_tools)
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._drive_retrieval_system_prompt(drive_tools)},
            {
                "role": "user",
                "content": (
                    "Retrieve the existing project document from Google Drive.\n"
                    f"Exact file name: {file_title}\n"
                    f"Project id: {project_id}\n"
                    "Use the Drive MCP tools to search and read/export the matching document."
                ),
            },
        ]

        for _ in range(4):
            response = await self.client.chat.completions.create(
                model=DEFAULT_MODEL,
                messages=messages,
                tools=openai_tools,
                tool_choice="auto",
            )
            assistant_message = response.choices[0].message

            if not assistant_message.tool_calls:
                payload = _json_from_model_text(assistant_message.content or "")
                payload.setdefault("fileName", file_title)
                payload.setdefault("source", "google_drive_mcp")
                return payload

            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_message.content or "",
                    "tool_calls": assistant_message.tool_calls,
                }
            )

            for tool_call in assistant_message.tool_calls:
                tool_name = tool_call.function.name
                try:
                    arguments = json.loads(tool_call.function.arguments or "{}")
                except json.JSONDecodeError:
                    arguments = {}

                arguments = self._enrich_sheets_tool_arguments(tool_name, arguments)
                try:
                    tool_result = call_project_mcp_tool(
                        project_id=str(project_id),
                        user_id=str(user_id),
                        tool_name=tool_name,
                        arguments=arguments,
                    )
                except ProjectMCPError as exc:
                    tool_result = {"success": False, "error": str(exc)}

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": _truncate_tool_result(tool_result),
                    }
                )

        final_response = await self.client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Return ONLY the required JSON object based on the MCP tool results.",
                },
                *messages,
            ],
        )
        payload = _json_from_model_text(final_response.choices[0].message.content or "")
        payload.setdefault("fileName", file_title)
        payload.setdefault("source", "google_drive_mcp")
        return payload

    async def save_meeting_document_to_sheets(
        self,
        *,
        project_id: str,
        user_id: str,
        project_name: str,
        document_payload: dict[str, Any],
    ) -> dict[str, Any]:
        if not project_id or not user_id:
            raise ProjectMCPChatAgentError("project_id and user_id are required.")
        if not project_name:
            raise ProjectMCPChatAgentError("project_name is required.")

        drive_config = get_project_google_drive_config(project_id, user_id=user_id, include_token=False)
        if not drive_config or not drive_config.get("token_encrypted"):
            raise ProjectMCPChatAgentError(
                "Google Drive MCP is not connected for this project. Connect it in Project MCP Configuration."
            )
        if not drive_config.get("enabled", True):
            raise ProjectMCPChatAgentError("Google Drive MCP is disabled for this project.")

        all_tools = list_project_mcp_tools(project_id, user_id=user_id)
        sheets_tools = _filter_sheets_document_tools(all_tools)
        if not sheets_tools:
            raise ProjectMCPChatAgentError(
                "No Google Sheets MCP tools are available for this project."
            )

        document_id = drive_document_title(project_id)
        now_iso = str(document_payload.get("updatedAt") or datetime.now(timezone.utc).isoformat())
        payload = {
            **document_payload,
            "projectId": project_id,
            "projectName": project_name,
            "documentId": document_id,
            "title": document_payload.get("title") or document_id,
            "updatedAt": now_iso,
        }
        payload_json = _minified_json(payload)
        self.sheets_payload = {
            "document_id": document_id,
            "updated_at": payload["updatedAt"],
            "payload_json": payload_json,
        }

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._sheets_document_system_prompt(sheets_tools, "save")},
            {
                "role": "user",
                "content": (
                    f"Save this project document.\n"
                    f"rootFolderName: {DRIVE_ROOT_FOLDER_NAME}\n"
                    f"projectFolderName: {project_name}\n"
                    f"spreadsheetName: {SHEETS_DOCUMENT_SPREADSHEET_NAME}\n"
                    f"sheetName: {SHEETS_DOCUMENT_TAB_NAME}\n"
                    f"documentId: {document_id}\n"
                    f"updatedAt: {payload['updatedAt']}\n"
                    f"payloadJsonLength: {len(payload_json)}\n\n"
                    "Ensure folders/spreadsheet/sheet exist, then upsert row A:C. "
                    "When calling Sheets write tools, provide the target spreadsheet/range; "
                    "the backend will inject the exact row values."
                ),
            },
        ]

        openai_tools = _tools_to_openai_format(sheets_tools)
        called_tools: list[str] = []
        write_tool_succeeded = False
        last_tool_error: str | None = None
        for _ in range(8):
            response = await self.client.chat.completions.create(
                model=DEFAULT_MODEL,
                messages=messages,
                tools=openai_tools,
                tool_choice="auto",
            )
            assistant_message = response.choices[0].message

            if not assistant_message.tool_calls:
                if not called_tools:
                    raise ProjectMCPChatAgentError(
                        "Google Sheets save agent returned without calling any MCP tool."
                    )
                if last_tool_error:
                    raise ProjectMCPChatAgentError(last_tool_error)
                if not write_tool_succeeded:
                    raise ProjectMCPChatAgentError(
                        "Google Sheets save agent did not run a successful update, append, or batch-update Sheets MCP tool."
                    )
                result = _json_from_model_text(assistant_message.content or "")
                result.setdefault("success", True)
                result.setdefault("documentId", document_id)
                result.setdefault("fileName", SHEETS_DOCUMENT_SPREADSHEET_NAME)
                result.setdefault("source", "google_sheets_mcp")
                return result

            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_message.content or "",
                    "tool_calls": assistant_message.tool_calls,
                }
            )

            for tool_call in assistant_message.tool_calls:
                tool_name = tool_call.function.name
                called_tools.append(tool_name)
                try:
                    arguments = json.loads(tool_call.function.arguments or "{}")
                except json.JSONDecodeError:
                    arguments = {}

                try:
                    tool_result = call_project_mcp_tool(
                        project_id=str(project_id),
                        user_id=str(user_id),
                        tool_name=tool_name,
                        arguments=arguments,
                    )
                except ProjectMCPError as exc:
                    tool_result = {"success": False, "error": str(exc)}

                if isinstance(tool_result, dict) and tool_result.get("success") is False:
                    last_tool_error = str(tool_result.get("error") or "Google Sheets MCP tool failed.")
                elif re.search(r"(sheets-update-values|sheets-append-values|sheets-batch-update-values)", tool_name):
                    write_tool_succeeded = True
                    last_tool_error = None

                print(f"Sheets save MCP tool called: {tool_name}")

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": _truncate_tool_result(tool_result),
                    }
                )

        raise ProjectMCPChatAgentError("Google Sheets save agent did not complete within the tool-call limit.")

    async def retrieve_meeting_document_from_sheets(
        self,
        *,
        project_id: str,
        user_id: str,
        project_name: str,
    ) -> dict[str, Any]:
        if not project_id or not user_id:
            raise ProjectMCPChatAgentError("project_id and user_id are required.")
        if not project_name:
            raise ProjectMCPChatAgentError("project_name is required.")

        drive_config = get_project_google_drive_config(project_id, user_id=user_id, include_token=False)
        if not drive_config or not drive_config.get("token_encrypted"):
            raise ProjectMCPChatAgentError(
                "Google Drive MCP is not connected for this project. Connect it in Project MCP Configuration."
            )
        if not drive_config.get("enabled", True):
            raise ProjectMCPChatAgentError("Google Drive MCP is disabled for this project.")

        all_tools = list_project_mcp_tools(project_id, user_id=user_id)
        sheets_tools = _filter_sheets_document_tools(all_tools)
        if not sheets_tools:
            raise ProjectMCPChatAgentError(
                "No Google Sheets MCP tools are available for this project."
            )

        document_id = drive_document_title(project_id)
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._sheets_document_system_prompt(sheets_tools, "retrieve")},
            {
                "role": "user",
                "content": (
                    f"Retrieve this project document.\n"
                    f"rootFolderName: {DRIVE_ROOT_FOLDER_NAME}\n"
                    f"projectFolderName: {project_name}\n"
                    f"spreadsheetName: {SHEETS_DOCUMENT_SPREADSHEET_NAME}\n"
                    f"sheetName: {SHEETS_DOCUMENT_TAB_NAME}\n"
                    f"documentId: {document_id}\n\n"
                    "Find the project folder and spreadsheet, read Documents!A:C, parse Column C JSON for documentId, and return it."
                ),
            },
        ]

        openai_tools = _tools_to_openai_format(sheets_tools)
        called_tools: list[str] = []
        last_tool_error: str | None = None
        for _ in range(8):
            response = await self.client.chat.completions.create(
                model=DEFAULT_MODEL,
                messages=messages,
                tools=openai_tools,
                tool_choice="auto",
            )
            assistant_message = response.choices[0].message

            if not assistant_message.tool_calls:
                if last_tool_error:
                    raise ProjectMCPChatAgentError(last_tool_error)
                if not called_tools:
                    raise ProjectMCPChatAgentError(
                        "Google Sheets retrieval agent returned without calling any MCP tool."
                    )
                result = _json_from_model_text(assistant_message.content or "")
                if not result.get("found"):
                    return {"found": False, "content": "", "source": "google_sheets_mcp"}
                document = result.get("document") or result.get("payload") or result
                return {
                    "found": True,
                    "document": document,
                    "fileName": document.get("title") if isinstance(document, dict) else document_id,
                    "source": "google_sheets_mcp",
                }

            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_message.content or "",
                    "tool_calls": assistant_message.tool_calls,
                }
            )

            for tool_call in assistant_message.tool_calls:
                tool_name = tool_call.function.name
                called_tools.append(tool_name)
                try:
                    arguments = json.loads(tool_call.function.arguments or "{}")
                except json.JSONDecodeError:
                    arguments = {}

                try:
                    tool_result = call_project_mcp_tool(
                        project_id=str(project_id),
                        user_id=str(user_id),
                        tool_name=tool_name,
                        arguments=arguments,
                    )
                except ProjectMCPError as exc:
                    tool_result = {"success": False, "error": str(exc)}

                if isinstance(tool_result, dict) and tool_result.get("success") is False:
                    last_tool_error = str(tool_result.get("error") or "Google Sheets MCP tool failed.")

                print(f"Sheets retrieve MCP tool called: {tool_name}")

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": _truncate_tool_result(tool_result),
                    }
                )

        raise ProjectMCPChatAgentError("Google Sheets retrieval agent did not complete within the tool-call limit.")


async def export_meeting_document_via_agent(
    *,
    project_id: str,
    user_id: str,
    export_format: str,
    title: str,
    pdf_base64: Optional[str] = None,
    text_content: Optional[str] = None,
    html_content: Optional[str] = None,
) -> str:
    agent = ProjectMCPChatAgent()
    try:
        return await agent.export_meeting_document_to_drive(
            project_id=project_id,
            user_id=user_id,
            export_format=export_format,
            title=title,
            pdf_base64=pdf_base64,
            text_content=text_content,
            html_content=html_content,
        )
    finally:
        await agent.client.close()


async def retrieve_meeting_document_via_agent(
    *,
    project_id: str,
    user_id: str,
) -> dict[str, Any]:
    agent = ProjectMCPChatAgent()
    try:
        return await agent.retrieve_meeting_document_from_drive(
            project_id=project_id,
            user_id=user_id,
        )
    finally:
        await agent.client.close()


async def save_meeting_document_to_sheets_via_agent(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    document_payload: dict[str, Any],
) -> dict[str, Any]:
    agent = ProjectMCPChatAgent()
    try:
        return await agent.save_meeting_document_to_sheets(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
            document_payload=document_payload,
        )
    finally:
        await agent.client.close()


async def retrieve_meeting_document_from_sheets_via_agent(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
) -> dict[str, Any]:
    agent = ProjectMCPChatAgent()
    try:
        return await agent.retrieve_meeting_document_from_sheets(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
        )
    finally:
        await agent.client.close()
