"""
Route document generation to the local LangGraph agent or an optional A2A remote agent.

When A2A_DOCUMENT_AGENT_ENABLED=true, transcript batches are sent to a separate
document agent service. Otherwise the in-process hierarchy agent is used.
"""

import asyncio
import json
import os
from typing import Any, Dict

from a2a.client import ClientConfig, create_client
from a2a.helpers.proto_helpers import get_message_text
from a2a.types import Message, Part, Role, SendMessageRequest

from python_files.a2a_document_agent import execute_document_request


from python_files.base_urls import A2A_DOCUMENT_AGENT_URL
A2A_DOCUMENT_AGENT_ENABLED = os.getenv("A2A_DOCUMENT_AGENT_ENABLED", "false").lower() in {
    "1",
    "true",
    "yes",
}


async def _call_remote_document_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    client = await create_client(
        agent=A2A_DOCUMENT_AGENT_URL,
        client_config=ClientConfig(streaming=True),
    )
    try:
        request = SendMessageRequest(
            message=Message(
                role=Role.ROLE_USER,
                parts=[Part(text=json.dumps(payload))],
            )
        )

        async for chunk in client.send_message(request):
            if chunk.HasField("message"):
                response_text = get_message_text(chunk.message)
                if response_text:
                    return json.loads(response_text)
    finally:
        await client.close()

    raise RuntimeError("A2A document agent returned no message payload")


def process_document_transcripts_with_orchestrator(
    meeting_id: str,
    transcripts: Dict[str, Any],
    document_template: Dict[str, Any] | None = None,
    previous_sections: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    payload = {
        "meeting_id": str(meeting_id),
        "transcripts": transcripts or {},
        "document_template": document_template,
        "previous_sections": previous_sections or {},
        "transport": "a2a-remote" if A2A_DOCUMENT_AGENT_ENABLED and A2A_DOCUMENT_AGENT_URL else "local",
    }

    if A2A_DOCUMENT_AGENT_ENABLED and A2A_DOCUMENT_AGENT_URL:
        try:
            return asyncio.run(_call_remote_document_agent(payload))
        except Exception as exc:
            print(f"⚠️ Remote A2A document agent failed, falling back locally: {exc}")

    payload["transport"] = "a2a-local"
    return execute_document_request(payload)
