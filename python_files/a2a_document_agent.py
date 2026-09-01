"""
Optional standalone A2A document agent (Starlette server).

Runs the hierarchical document LangGraph pipeline as a remote agent. Enable via
A2A_DOCUMENT_AGENT_ENABLED and point A2A_DOCUMENT_AGENT_URL from document_context_orchestrator.
"""

import json
import os
import uuid
from typing import Any, Dict

import uvicorn
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
    Message,
    Part,
    Role,
)
from starlette.applications import Starlette

from python_files.langraph_agents_hierarchy import process_meeting_transcripts
from python_files.meeting_document_memory import (
    hydrate_hierarchy_runtime,
    persist_runtime_snapshot,
    upsert_document_template_context,
)


from python_files.base_urls import A2A_DOCUMENT_AGENT_URL


def execute_document_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Core document-generation entry point used by both the local fallback path
    and the A2A server executor.
    """
    meeting_id = str(payload.get("meeting_id") or payload.get("meetingId") or "")
    if not meeting_id:
        return {"success": False, "error": "meeting_id is required"}

    transcripts = payload.get("transcripts") or {}
    document_template = payload.get("document_template")
    previous_sections = payload.get("previous_sections", {})

    if document_template:
        upsert_document_template_context(
            meeting_id,
            document_template,
            previous_sections=previous_sections,
            metadata={"template_source": "a2a_request"},
        )

    hydrate_hierarchy_runtime(meeting_id)

    result = process_meeting_transcripts(
        meeting_id=meeting_id,
        transcripts=transcripts,
        document_template=document_template,
        previous_sections=previous_sections,
    )

    session = persist_runtime_snapshot(
        meeting_id,
        metadata={"last_transport": payload.get("transport", "a2a")},
    )

    result["context_state"] = {
        "stored_transcript_chunks": len(session.get("transcript_history", [])),
        "cumulative_transcript_chars": len(session.get("cumulative_transcript", "")),
        "questions_sent": bool(session.get("questions_sent", False)),
    }
    return result


class DocumentAgentExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        raw_payload = context.get_user_input()
        try:
            payload = json.loads(raw_payload) if raw_payload else {}
        except json.JSONDecodeError as exc:
            response = {"success": False, "error": f"Invalid JSON payload: {exc}"}
        else:
            response = execute_document_request(payload)

        message = Message(
            message_id=str(uuid.uuid4()),
            context_id=context.context_id or "",
            task_id=context.task_id or "",
            role=Role.ROLE_AGENT,
            parts=[Part(text=json.dumps(response))],
        )
        await event_queue.enqueue_event(message)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise Exception("cancel not supported")


def build_agent_card(base_url: str = A2A_DOCUMENT_AGENT_URL) -> AgentCard:
    skill = AgentSkill(
        id="document_orchestration",
        name="Meeting document orchestration",
        description=(
            "Generates and updates project documents from live meeting transcripts "
            "using durable meeting context and document memory."
        ),
        tags=["document", "meeting", "transcript", "context", "orchestration"],
        examples=[
            "Update the project document from the latest meeting transcript.",
            "Generate missing sections from the meeting discussion.",
        ],
    )

    return AgentCard(
        name="MARARE Document Agent",
        description="Document orchestration agent for meeting-driven project documentation.",
        version="0.1.0",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        capabilities=AgentCapabilities(streaming=True),
        supported_interfaces=[
            AgentInterface(protocol_binding="JSONRPC", url=base_url)
        ],
        skills=[skill],
    )


def build_starlette_app(base_url: str = A2A_DOCUMENT_AGENT_URL) -> Starlette:
    agent_card = build_agent_card(base_url)
    request_handler = DefaultRequestHandler(
        agent_executor=DocumentAgentExecutor(),
        task_store=InMemoryTaskStore(),
        agent_card=agent_card,
    )

    routes = []
    routes.extend(create_agent_card_routes(agent_card))
    routes.extend(create_jsonrpc_routes(request_handler, "/"))
    return Starlette(routes=routes)


if __name__ == "__main__":
    url = A2A_DOCUMENT_AGENT_URL
    host_port = url.replace("http://", "").replace("https://", "")
    host, port = host_port.split(":", 1)
    uvicorn.run(build_starlette_app(url), host=host, port=int(port))
