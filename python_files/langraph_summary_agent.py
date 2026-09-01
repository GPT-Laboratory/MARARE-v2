"""
LangGraph Agent for Incremental Meeting Summary Generation
===========================================================
Generates incremental summary chunks that get appended on frontend.
Maintains memory of what has already been summarized.
"""

import os
import threading
from typing import TypedDict, Dict, Any, Optional
from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# ================== STORAGE ==================
SUMMARY_STORAGE = {}  # {meeting_id: cumulative_summary_text}
PROCESSED_TRANSCRIPTS = {}  # {meeting_id: transcript_text_already_processed}
UNPROCESSED_TRANSCRIPTS = {}  # {meeting_id: new_transcript_text_to_process}
STORAGE_LOCK = threading.Lock()


# ================== STATE ==================
class SummaryAgentState(TypedDict):
    meeting_id: str
    transcripts: Dict[str, Any]
    previous_summary: str  # What we've summarized so far
    new_transcript_chunk: str  # Only new transcripts
    summary_delta: str  # Only the NEW summary to append
    error_message: Optional[str]


# ================== AGENT ==================
def accumulate_transcripts_node(state: SummaryAgentState) -> SummaryAgentState:
    """Accumulate new transcripts and separate what's new"""
    meeting_id = state["meeting_id"]
    transcripts = state["transcripts"]
    
    with STORAGE_LOCK:
        # Initialize if first time
        if meeting_id not in PROCESSED_TRANSCRIPTS:
            PROCESSED_TRANSCRIPTS[meeting_id] = ""
            UNPROCESSED_TRANSCRIPTS[meeting_id] = ""
        
        # Append new transcripts to unprocessed buffer
        for speaker, text in transcripts.items():
            UNPROCESSED_TRANSCRIPTS[meeting_id] += f"{speaker}: {text}\n"
        
        # Get the new chunk
        new_chunk = UNPROCESSED_TRANSCRIPTS[meeting_id]
        
        # Get previous summary for context
        previous_summary = SUMMARY_STORAGE.get(meeting_id, "")
    
    state["new_transcript_chunk"] = new_chunk
    state["previous_summary"] = previous_summary
    
    return state


def generate_summary_delta_node(state: SummaryAgentState) -> SummaryAgentState:
    """Generate ONLY new summary content based on new transcripts"""
    new_chunk = state["new_transcript_chunk"]
    previous_summary = state["previous_summary"]
    meeting_id = state["meeting_id"]
    
    if not new_chunk.strip():
        state["summary_delta"] = ""
        return state
    
    # Build prompt for incremental summary
    system_prompt = """You are an expert meeting summarizer generating INCREMENTAL summaries.

Your task:
- Read the new transcript chunk
- Generate ONLY NEW summary points based on this new information
- Do NOT repeat what's already in the previous summary
- Focus on: key decisions, topics discussed, action items, insights
- Format: Use bullet points, be concise and professional
- If the new transcript doesn't add significant information, return empty string

Output ONLY the new summary points to be APPENDED."""
    
    context = ""
    if previous_summary:
        context = f"Previous Summary (for context, DO NOT repeat):\n{previous_summary}\n\n"
    
    user_prompt = f"""{context}New Transcript Chunk:
{new_chunk[-3000:]}

Generate ONLY NEW summary points from this new transcript chunk:"""
    
    llm = ChatOpenAI(model="gpt-5.4-2026-03-05", api_key=OPENAI_API_KEY, temperature=0.3)
    
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt)
    ]
    
    response = llm.invoke(messages)
    summary_delta = response.content.strip()
    
    # Update storage: append delta to cumulative summary
    with STORAGE_LOCK:
        if summary_delta:
            if meeting_id not in SUMMARY_STORAGE:
                SUMMARY_STORAGE[meeting_id] = ""
            
            # Append with separator
            separator = "\n\n" if SUMMARY_STORAGE[meeting_id] else ""
            SUMMARY_STORAGE[meeting_id] += separator + summary_delta
        
        # Move unprocessed to processed
        PROCESSED_TRANSCRIPTS[meeting_id] += UNPROCESSED_TRANSCRIPTS[meeting_id]
        UNPROCESSED_TRANSCRIPTS[meeting_id] = ""
    
    state["summary_delta"] = summary_delta
    return state


# ================== GRAPH ==================
workflow = StateGraph(SummaryAgentState)
workflow.add_node("accumulate", accumulate_transcripts_node)
workflow.add_node("generate_delta", generate_summary_delta_node)

workflow.set_entry_point("accumulate")
workflow.add_edge("accumulate", "generate_delta")
workflow.add_edge("generate_delta", END)

summary_graph = workflow.compile()


# ================== PUBLIC API ==================
def process_summary_transcripts(meeting_id: str, transcripts: Dict) -> Dict:
    """Process transcripts and generate incremental summary"""
    
    state = {
        "meeting_id": meeting_id,
        "transcripts": transcripts,
        "previous_summary": "",
        "new_transcript_chunk": "",
        "summary_delta": "",
        "error_message": None
    }
    
    result = summary_graph.invoke(state)
    
    return {
        "summary_delta": result.get("summary_delta", ""),  # Only new content
        "meeting_id": meeting_id
    }


def reset_summary_storage(meeting_id: str):
    """Reset summary storage for a meeting"""
    with STORAGE_LOCK:
        if meeting_id in SUMMARY_STORAGE:
            del SUMMARY_STORAGE[meeting_id]
        if meeting_id in PROCESSED_TRANSCRIPTS:
            del PROCESSED_TRANSCRIPTS[meeting_id]
        if meeting_id in UNPROCESSED_TRANSCRIPTS:
            del UNPROCESSED_TRANSCRIPTS[meeting_id]


def get_full_summary(meeting_id: str) -> str:
    """Get the complete accumulated summary"""
    with STORAGE_LOCK:
        return SUMMARY_STORAGE.get(meeting_id, "")
