"""
Hierarchical Multi-Agent LangGraph System for Document Template Generation
============================================================================
This module implements a supervisor-worker architecture where:
- Supervisor Agent: Manages document template, distributes work, detects undiscussed topics
- Worker Agents: Generate document sections STRICTLY based on template and meeting transcripts
- All agents use OpenAI models only
"""

import os
import sys
import threading
import time
import json
from typing import TypedDict, List, Dict, Any, Optional
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# Load environment variables
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ================== GLOBAL STORAGE ==================
DOCUMENT_TEMPLATES_STORAGE = {}  # {meeting_id: template_data}
GENERATED_DOCUMENTS_STORAGE = {}  # {meeting_id: generated_sections}
MEETING_STATUS_STORAGE = {}  # {meeting_id: status_info}
UNDISCUSSED_TOPICS_STORAGE = {}  # {meeting_id: [undiscussed_sections]}
TRANSCRIPTS_HISTORY_STORAGE = {}  # {meeting_id: [all_transcripts]}
ALL_TRANSCRIPTS_TEXT = {}  # {meeting_id: cumulative_transcript_text}
QUESTIONS_SENT_FLAG = {}  # {meeting_id: bool} - Track if questions have been sent

STORAGE_LOCK = threading.Lock()


# ================== STATE DEFINITION ==================
class DocumentAgentState(TypedDict):
    """State for the hierarchical document generation system"""
    meeting_id: str
    transcripts: Dict[str, Any]  # New transcripts from frontend
    document_template: Optional[Dict]  # Template with categories and sections
    generated_sections: Dict[str, str]  # {section_id: generated_content}
    undiscussed_topics: List[Dict]  # List of undiscussed sections
    meeting_phase: str  # "ongoing", "ending", "ended"
    supervisor_instructions: str  # Instructions for workers
    worker_assignments: Dict[str, List[Dict]]  # {worker_id: [section_details]}
    questions_for_users: List[str]  # Questions about undiscussed topics
    processing_status: str  # "processing", "completed", "error"
    error_message: Optional[str]
    last_update_time: float
    emit_updates: bool  # Whether to emit updates to frontend
    template_sections_map: Dict[str, Dict]  # {section_id: section_details}
    should_send_questions: bool  # Whether to send questions to realtime agent (SMART TIMING)


# ================== OPENAI LLM SETUP ==================
_llm_cache = {}
_cache_lock = threading.Lock()


def get_openai_llm(model: str = "gpt-5.4-2026-03-05", temperature: float = 0.3) -> ChatOpenAI:
    """Get cached OpenAI LLM instance"""
    cache_key = f"{model}_{temperature}"
    
    with _cache_lock:
        if cache_key not in _llm_cache:
            _llm_cache[cache_key] = ChatOpenAI(
                model=model,
                api_key=OPENAI_API_KEY,
                temperature=temperature,
            )
        return _llm_cache[cache_key]


def get_research_llm() -> ChatOpenAI:
    """Get OpenAI LLM configured for research/web knowledge"""
    return get_openai_llm("gpt-5.4-2026-03-05", 0.2)


# ================== STORAGE FUNCTIONS ==================
def _normalize_section_key(value: str) -> str:
    """Normalize section ids/titles the same way the frontend does."""
    import re
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")


def _lookup_previous_section_content(previous_sections: Dict, section: Dict) -> str:
    """Resolve previous content by exact id, string id, normalized id, or title slug."""
    if not previous_sections:
        return ""

    section_id = section.get("id")
    section_title = section.get("title")
    title_snake = str(section_title or "").lower().replace(" ", "_")
    candidate_keys = [
        section_id,
        str(section_id) if section_id is not None else "",
        _normalize_section_key(section_id),
        title_snake,
        _normalize_section_key(section_title),
    ]

    for key in candidate_keys:
        if key in previous_sections and str(previous_sections.get(key) or "").strip():
            return str(previous_sections.get(key) or "").strip()

    normalized_candidates = {
        _normalize_section_key(key): value
        for key, value in previous_sections.items()
        if str(value or "").strip()
    }
    for key in candidate_keys:
        normalized_key = _normalize_section_key(key)
        if normalized_key in normalized_candidates:
            return str(normalized_candidates[normalized_key] or "").strip()

    return ""


def save_document_template(meeting_id: str, template: Dict, previous_sections: Dict = None):
    """
    Save document template for a meeting.

    previous_sections: dict of {section_id: content_string} from the most recent
    saved document for this project.  Sections that already have content are
    pre-populated so agents focus only on the brand-new (empty) sections added
    since the last meeting.
    """
    previous_sections = previous_sections or {}

    with STORAGE_LOCK:
        # Build section map for quick lookup
        sections_map = {}
        for section in template.get("sections", []):
            sections_map[section.get("id")] = {
                "id": section.get("id"),
                "title": section.get("title"),
                "category": section.get("category"),
                "content": section.get("content", ""),
                "icon": section.get("icon", "")
            }
        
        DOCUMENT_TEMPLATES_STORAGE[meeting_id] = {
            "template": template,
            "created_at": time.time(),
            "categories": template.get("categories", {}),
            "sections": template.get("sections", []),
            "sections_map": sections_map
        }
        
        # Always start with a fresh storage for this new meeting
        GENERATED_DOCUMENTS_STORAGE[meeting_id] = {}

        # Pre-populate sections that already have content from a previous meeting.
        # This prevents agents from re-generating content for sections that were
        # already fully discussed — they will only target sections with no content.
        old_count = 0
        new_count = 0
        for section in template.get("sections", []):
            section_id = section.get("id")
            prior_content = _lookup_previous_section_content(previous_sections, section)
            if prior_content:
                GENERATED_DOCUMENTS_STORAGE[meeting_id][section_id] = prior_content
                old_count += 1
            else:
                new_count += 1

        # Initialize meeting status
        MEETING_STATUS_STORAGE[meeting_id] = {
            "phase": "ongoing",
            "transcript_count": 0,
            "last_activity": time.time()
        }
        
        # Mark carried-over sections as already discussed so the supervisor
        # only assigns workers to the new/empty sections.
        UNDISCUSSED_TOPICS_STORAGE[meeting_id] = []
        for section in template.get("sections", []):
            section_id = section.get("id")
            prior_content = _lookup_previous_section_content(previous_sections, section)
            UNDISCUSSED_TOPICS_STORAGE[meeting_id].append({
                "section_id": section_id,
                "title": section.get("title"),
                "category": section.get("category"),
                "discussed": bool(prior_content),  # True = already has content
            })
        
        # Initialize transcripts history
        if meeting_id not in TRANSCRIPTS_HISTORY_STORAGE:
            TRANSCRIPTS_HISTORY_STORAGE[meeting_id] = []
        
        # Initialize cumulative transcript
        if meeting_id not in ALL_TRANSCRIPTS_TEXT:
            ALL_TRANSCRIPTS_TEXT[meeting_id] = ""
    
    print(f"✅ Document template saved for meeting {meeting_id}")
    print(f"📋 Categories: {len(template.get('categories', {}))}")
    print(f"📄 Total sections: {len(template.get('sections', []))} "
          f"(carried over: {old_count}, new/empty: {new_count})")


def get_document_template(meeting_id: str) -> Optional[Dict]:
    """Get document template for a meeting"""
    with STORAGE_LOCK:
        return DOCUMENT_TEMPLATES_STORAGE.get(meeting_id, {}).get("template")


def get_template_sections_map(meeting_id: str) -> Dict[str, Dict]:
    """Get sections map for quick lookup"""
    with STORAGE_LOCK:
        return DOCUMENT_TEMPLATES_STORAGE.get(meeting_id, {}).get("sections_map", {})


def get_generated_sections(meeting_id: str) -> Dict[str, str]:
    """Get all generated sections for a meeting"""
    with STORAGE_LOCK:
        return GENERATED_DOCUMENTS_STORAGE.get(meeting_id, {}).copy()


def update_generated_section(meeting_id: str, section_id: str, content: str, replace: bool = False):
    """Update a generated section"""
    with STORAGE_LOCK:
        if meeting_id not in GENERATED_DOCUMENTS_STORAGE:
            GENERATED_DOCUMENTS_STORAGE[meeting_id] = {}
        
        if replace or section_id not in GENERATED_DOCUMENTS_STORAGE[meeting_id]:
            GENERATED_DOCUMENTS_STORAGE[meeting_id][section_id] = content
        else:
            # Append new content intelligently
            existing = GENERATED_DOCUMENTS_STORAGE[meeting_id][section_id]
            GENERATED_DOCUMENTS_STORAGE[meeting_id][section_id] = f"{existing}\n\n{content}"
        
        # Mark section as discussed
        if meeting_id in UNDISCUSSED_TOPICS_STORAGE:
            for topic in UNDISCUSSED_TOPICS_STORAGE[meeting_id]:
                if topic["section_id"] == section_id:
                    topic["discussed"] = True
                    break


def get_undiscussed_topics(meeting_id: str) -> List[Dict]:
    """Get list of undiscussed topics"""
    with STORAGE_LOCK:
        if meeting_id not in UNDISCUSSED_TOPICS_STORAGE:
            return []
        return [t.copy() for t in UNDISCUSSED_TOPICS_STORAGE[meeting_id] if not t["discussed"]]


def add_transcript_to_history(meeting_id: str, transcript_text: str):
    """Add transcript to meeting history and cumulative text"""
    with STORAGE_LOCK:
        if meeting_id not in TRANSCRIPTS_HISTORY_STORAGE:
            TRANSCRIPTS_HISTORY_STORAGE[meeting_id] = []
        
        TRANSCRIPTS_HISTORY_STORAGE[meeting_id].append({
            "content": transcript_text,
            "timestamp": time.time()
        })
        
        # Update cumulative transcript
        if meeting_id not in ALL_TRANSCRIPTS_TEXT:
            ALL_TRANSCRIPTS_TEXT[meeting_id] = ""
        ALL_TRANSCRIPTS_TEXT[meeting_id] += f"\n{transcript_text}"
        
        if meeting_id in MEETING_STATUS_STORAGE:
            MEETING_STATUS_STORAGE[meeting_id]["transcript_count"] += 1
            MEETING_STATUS_STORAGE[meeting_id]["last_activity"] = time.time()


def get_cumulative_transcript(meeting_id: str) -> str:
    """Get all transcripts combined"""
    with STORAGE_LOCK:
        return ALL_TRANSCRIPTS_TEXT.get(meeting_id, "")


def get_meeting_status(meeting_id: str) -> Dict:
    """Get meeting status"""
    with STORAGE_LOCK:
        return MEETING_STATUS_STORAGE.get(meeting_id, {"phase": "unknown"}).copy()


def update_meeting_phase(meeting_id: str, phase: str):
    """Update meeting phase"""
    with STORAGE_LOCK:
        if meeting_id in MEETING_STATUS_STORAGE:
            MEETING_STATUS_STORAGE[meeting_id]["phase"] = phase


def reset_meeting_document_storage(meeting_id: str):
    """Reset all storage for a meeting"""
    with STORAGE_LOCK:
        for storage in [DOCUMENT_TEMPLATES_STORAGE, GENERATED_DOCUMENTS_STORAGE, 
                        MEETING_STATUS_STORAGE, UNDISCUSSED_TOPICS_STORAGE, 
                        TRANSCRIPTS_HISTORY_STORAGE, ALL_TRANSCRIPTS_TEXT, QUESTIONS_SENT_FLAG]:
            if meeting_id in storage:
                del storage[meeting_id]
    print(f"🔄 Meeting {meeting_id} document storage reset")


def mark_questions_sent(meeting_id: str):
    """Mark that questions have been sent for this meeting"""
    with STORAGE_LOCK:
        QUESTIONS_SENT_FLAG[meeting_id] = True
    print(f"✅ Questions marked as sent for meeting {meeting_id}")


def were_questions_sent(meeting_id: str) -> bool:
    """Check if questions have already been sent"""
    with STORAGE_LOCK:
        return QUESTIONS_SENT_FLAG.get(meeting_id, False)


def get_discussion_progress(meeting_id: str) -> float:
    """Calculate percentage of topics that have been discussed"""
    with STORAGE_LOCK:
        if meeting_id not in UNDISCUSSED_TOPICS_STORAGE:
            return 0.0
        
        topics = UNDISCUSSED_TOPICS_STORAGE[meeting_id]
        if not topics:
            return 100.0
        
        discussed_count = sum(1 for t in topics if t.get("discussed", False))
        return (discussed_count / len(topics)) * 100


def should_ask_undiscussed_questions(meeting_id: str, meeting_phase: str) -> bool:
    """
    Determine if it's the right time to ask about undiscussed topics.
    
    Returns True only when:
    1. Questions haven't been sent already
    2. Meeting is in 'ending' phase OR 90%+ topics are discussed
    3. There are actually undiscussed topics remaining
    """
    # Don't send if already sent
    if were_questions_sent(meeting_id):
        print(f"ℹ️ Questions already sent for meeting {meeting_id}, skipping")
        return False
    
    # Get progress
    progress = get_discussion_progress(meeting_id)
    
    # Get undiscussed topics
    undiscussed = get_undiscussed_topics(meeting_id)
    
    # No undiscussed topics = nothing to ask
    if not undiscussed:
        print(f"ℹ️ No undiscussed topics for meeting {meeting_id}")
        return False
    
    # Check conditions - trigger at 90% instead of 90%
    is_ending = meeting_phase == "ending"
    high_progress = progress >= 90.0  # Changed from 90% to 90%
    
    print(f"📊 Question timing check: phase={meeting_phase}, progress={progress:.1f}%, undiscussed={len(undiscussed)}")
    
    # Send questions if meeting is ending OR if 90%+ discussed
    if is_ending or high_progress:
        print(f"✅ Time to ask questions! (ending={is_ending}, high_progress={high_progress})")
        return True
    
    print(f"⏳ Not yet time to ask (need 90% or ending phase)")
    return False


# ================== HELPER FUNCTIONS ==================
def flatten_transcripts(transcripts_dict: Dict) -> str:
    """Convert transcripts dict to readable string"""
    if not transcripts_dict:
        return ""
    
    lines = []
    if isinstance(transcripts_dict, dict):
        local = transcripts_dict.get("localUser", "")
        if local and local.strip():
            lines.append(f"[Local User]: {local}")

        remote_users = transcripts_dict.get("remoteUsers", {})
        if isinstance(remote_users, dict) and remote_users:
            for speaker_id, speaker_text in remote_users.items():
                text = str(speaker_text or "").strip()
                if text:
                    speaker_label = str(speaker_id)[-6:]
                    lines.append(f"[Remote User {speaker_label}]: {text}")
        else:
            remote = transcripts_dict.get("remoteUser", "")
            if remote and remote.strip():
                lines.append(f"[Remote User]: {remote}")
        
        agent = transcripts_dict.get("agentUser", "")
        if agent and agent.strip():
            lines.append(f"[AI Agent]: {agent}")
    
    return "\n".join(lines)


def detect_meeting_phase(transcripts: str, transcript_count: int) -> str:
    """Detect if meeting is ending based on transcripts content"""
    ending_phrases = [
        "thank you everyone", "thanks everyone", "goodbye", "bye bye",
        "end the meeting", "wrap up", "that's all", "closing remarks",
        "final thoughts", "let's conclude", "meeting adjourned",
        "see you next time", "have a good day", "take care everyone",
        "that concludes", "any final questions", "before we end"
    ]
    
    transcripts_lower = transcripts.lower()
    
    for phrase in ending_phrases:
        if phrase in transcripts_lower:
            return "ending"
    
    return "ongoing"


# ================== OPENAI RESEARCH FUNCTION ==================
def research_with_openai(query: str, context: str = "") -> str:
    """
    Use OpenAI's knowledge to research a topic.
    OpenAI models have extensive training data that can provide industry knowledge.
    """
    try:
        llm = get_research_llm()
        
        prompt = f"""You are a knowledgeable research assistant. Based on your training data and knowledge, 
provide accurate and relevant information about the following topic.

RESEARCH QUERY: {query}

{f"CONTEXT: {context}" if context else ""}

Provide factual, professional information that would be useful for business documentation.
Focus on:
- Industry best practices
- Standard definitions and terminology
- Common approaches and methodologies
- Relevant considerations and factors

Keep the response small  and factual. 
Be direct and to-the-point
If you're not confident about specific details, indicate that clearly.

RESEARCH FINDINGS:"""
        
        response = llm.invoke([HumanMessage(content=prompt)])
        result = response.content if hasattr(response, 'content') else str(response)
        
        return result.strip()
        
    except Exception as e:
        print(f"❌ Research error: {e}")
        return ""


# ================== SUPERVISOR AGENT ==================
def supervisor_agent(state: DocumentAgentState) -> DocumentAgentState:
    """
    Supervisor Agent: Analyzes transcript and assigns ONLY template-defined sections to workers
    """
    print("\n🎯 ========== SUPERVISOR AGENT ==========")
    
    meeting_id = state["meeting_id"]
    transcripts = state.get("transcripts", {})
    
    # Get document template
    template = state.get("document_template") or get_document_template(meeting_id)
    
    if not template:
        print("⚠️ No document template found for this meeting")
        state["processing_status"] = "error"
        state["error_message"] = "No document template found"
        return state
    
    # Flatten new transcripts
    new_transcript_text = flatten_transcripts(transcripts)
    
    if not new_transcript_text.strip():
        print("⚠️ No transcript content to process")
        state["processing_status"] = "no_content"
        return state
    
    # Add to cumulative transcript
    add_transcript_to_history(meeting_id, new_transcript_text)
    cumulative_transcript = get_cumulative_transcript(meeting_id)
    
    # Get meeting status
    status = get_meeting_status(meeting_id)
    
    # Detect meeting phase
    meeting_phase = detect_meeting_phase(cumulative_transcript, status.get("transcript_count", 0))
    state["meeting_phase"] = meeting_phase
    update_meeting_phase(meeting_id, meeting_phase)
    
    print(f"📊 Meeting phase: {meeting_phase}")
    print(f"📝 New transcript length: {len(new_transcript_text)} chars")
    print(f"📚 Cumulative transcript length: {len(cumulative_transcript)} chars")
    
    # Get template sections
    template_sections = template.get("sections", [])
    sections_map = get_template_sections_map(meeting_id)
    
    # Debug: print sections map keys
    print(f"📂 Template has {len(template_sections)} sections")
    print(f"🗂️ Sections map has {len(sections_map)} entries")
    if sections_map:
        print(f"🔑 Section IDs available: {list(sections_map.keys())[:5]}...")
    
    if not template_sections:
        print("⚠️ No sections defined in template")
        state["processing_status"] = "error"
        state["error_message"] = "No sections in template"
        return state
    
    # Use OpenAI to analyze which template sections are relevant to the transcript
    llm = get_openai_llm("gpt-5.4-2026-03-05", 0.3)
    
    # Build sections list — include a short description so the LLM understands
    # what each section expects, especially for sections with empty content fields.
    NFR_DESCRIPTIONS = {
        "Usability":            "How easy and intuitive the system is to use; user-friendliness, learnability, no training needed.",
        "Reliability":          "System uptime, availability, fault tolerance, disaster recovery, no data loss.",
        "Performance":          "Speed, response time, throughput, latency, load time requirements.",
        "Supportability":       "Maintainability, ease of updates, extensibility, modularity, logging.",
        "Other_Requirements":   "Any other non-functional constraints not covered by the above categories.",
    }
    sections_list = "\n".join([
        "- ID: {id} | Title: {title} | Category: {cat} | About: {desc}".format(
            id=s.get('id'),
            title=s.get('title'),
            cat=s.get('category'),
            desc=(
                NFR_DESCRIPTIONS.get(s.get('id'), '')
                or (s.get('content') or '')[:120].replace('\n', ' ').strip()
                or s.get('title')
            ),
        )
        for s in template_sections
    ])
    
    # Case-insensitive lookup: lowercase(id) → exact template id
    # The LLM sometimes returns IDs in wrong case; this normalizes them back.
    section_id_ci_map = {s.get('id', '').lower(): s.get('id') for s in template_sections}
    
#     # Use CUMULATIVE transcript for better context (not just new transcript)
#     transcript_for_analysis = cumulative_transcript if len(cumulative_transcript) > 100 else new_transcript_text
    
#     print(f"🔍 Analyzing transcript ({len(transcript_for_analysis)} chars) against {len(template_sections)} sections...")
#     print(f"📜 Transcript preview: {transcript_for_analysis[:300]}...")
    
#     analysis_prompt = f"""You are a document analysis expert. Your job is to identify which document sections can be filled based on meeting discussions.

# AVAILABLE DOCUMENT SECTIONS (from template):
# {sections_list}

# MEETING TRANSCRIPT (full conversation so far):
# {transcript_for_analysis}

# TASK:
# Analyze the transcript and identify ALL sections that have ANY relevant information discussed.
# Be GENEROUS in matching - if there's even partial or indirect information about a topic, include it.

# MATCHING GUIDELINES:
# - If someone mentions a product, project, or solution → include "purpose", "solution_overview", "Product_Overview"
# - If users, customers, or stakeholders are mentioned → include user-related sections
# - If features, functionality, or requirements are discussed → include feature/requirement sections
# - If problems, needs, or goals are mentioned → include relevant sections
# - General introductions or overviews → include "Introduction" sections

# RESPONSE FORMAT:
# Return ONLY a JSON array of section IDs. Example: ["purpose", "solution_overview", "user_personas"]

# If no relevant content found at all, return: []

# IDENTIFIED SECTION IDs:

# If no sections are relevant, return: []

# RELEVANT SECTION IDs:"""


    # Always use full cumulative transcript for section analysis
    transcript_for_analysis = cumulative_transcript
    
    print(f"🔍 Analyzing transcript ({len(transcript_for_analysis)} chars) against {len(template_sections)} sections...")
    print(f"📜 Transcript preview: {transcript_for_analysis[:300]}...")
    
    # Evidence-based analysis: the LLM must return a quote proving each section match.
    # Related sections (e.g. overview-type) can all receive the same evidence quote.
    # NFR sections are matched by intent even if technical terms were not spoken.
    analysis_prompt = f"""You are a precise document analyst. Your task is to match meeting transcript passages to document sections.

DOCUMENT SECTIONS (id | title | category | description of what belongs here):
{sections_list}

FULL MEETING TRANSCRIPT:
{transcript_for_analysis}

═══════════════════════════════════════
MATCHING RULES
═══════════════════════════════════════
1. Read the "About" description of each section to understand what belongs there, not just the title.
2. Each section you include MUST have a supporting quote from the transcript as evidence.

3. OVERVIEW GROUP RULE — When the product/system is described, include ALL of these section types
   if they exist in the template:
   - Purpose / Introduction → what is the product and why it exists
   - Solution Overview → what the product does at a high level
   - Product Overview → high-level view of capabilities
   - Product Perspective → how product fits in the market/environment
   - Product Position Statement → unique value, who it's for, differentiation
   - Summary of Capabilities → list of major features and benefits
   All of these should get the SAME evidence quote from the product description.

4. USER GROUP RULE — When users/customers are described, include ALL relevant user sections:
   - User Personas → who the users are
   - User/Market Demographics → market size, target segment, trends
   - User Environment → where/how users work, devices, other apps they use
   - Key User Needs → problems users face, what they want solved
   Use the same quote for all that apply.

5. NFR INTENT RULE — People rarely use technical NFR terms. Detect intent from everyday language:
   - "real-time", "fast", "instant", "quick", "slow", "response time" → Performance
   - "always available", "no downtime", "24/7", "must not crash" → Reliability
   - "easy to use", "simple", "no training", "intuitive", "user-friendly" → Usability
   - "scale", "handle many users", "high traffic", "concurrent" → Supportability / Performance
   - "secure", "login required", "privacy", "GDPR", "HIPAA", "encrypted" → Licensing_Security_and_Installation
   - "works on mobile/desktop", "cross-platform", "browser" → System_Requirements
   - "standards", "compliance", "regulations" → Applicable_Standards
   Also fill the parent "Nonfunctional_Requirements" section whenever ANY NFR is detected.

6. FEATURES RULE — Any mention of specific features, screens, or functionality →
   fill both Product_Features and Exemplary_Use_Cases (if template has them).

7. Do NOT invent — every included section must trace back to an actual statement in the transcript.

═══════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════
Return a JSON object where:
- Each key is a section ID (from the list above — use EXACT IDs, copy spelling/case precisely)
- Each value is a SHORT verbatim quote (1-2 sentences) from the transcript proving this section applies

Example for a transcript describing a book-trading app for students with real-time chat:
{{
  "purpose": "We want to create a book buddy application where users can buy and sell their old books.",
  "solution_overview": "We want to create a book buddy application where users can buy and sell their old books.",
  "Product_Overview": "We want to create a book buddy application where users can buy and sell their old books.",
  "Product_Perspective": "We want to create a book buddy application where users can buy and sell their old books.",
  "Product_Position_Statement": "We want to create a book buddy application where users can buy and sell their old books.",
  "Summary_of_Capabilities": "We will provide a real-time chat interface where they can share voice messages and videos.",
  "user_personas": "Basically the university and college students will use this application.",
  "User/Market_Demographics": "Basically the university and college students will use this application.",
  "Product_Features": "We will provide a real-time chat interface where they can share voice messages and videos.",
  "Nonfunctional_Requirements": "We will provide a real-time chat interface where they can interact in real time.",
  "Performance": "We will provide a real-time chat interface where they can interact in real time.",
  "Cost_and_Pricing": "The cost of this product will be $10,000 to $15,000."
}}

If NO section has any supporting evidence in the transcript, return: {{}}

CRITICAL: Use the EXACT section IDs from the list above as JSON keys — copy them character-for-character.
Return ONLY the JSON object. No explanation. No markdown code blocks.

SECTION EVIDENCE MAP:"""

    try:
        import re
        response = llm.invoke([HumanMessage(content=analysis_prompt)])
        response_text = response.content if hasattr(response, 'content') else str(response)
        
        print(f"🤖 AI Response: {response_text[:800]}...")
        
        response_text = response_text.strip()
        
        # Strip markdown code fences if present
        if "```" in response_text:
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            response_text = json_match.group() if json_match else "{}"
        
        # Extract JSON object from response
        if not response_text.startswith("{"):
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            response_text = json_match.group() if json_match else "{}"
        
        response_text = response_text.strip()
        
        section_evidence_map = json.loads(response_text) if response_text and response_text.startswith("{") else {}
        
        # Validate and normalize section IDs — case-insensitive so "User_Environment"
        # and "user_environment" both resolve to the exact template ID.
        valid_section_evidence = {}
        for sid, evidence in section_evidence_map.items():
            if not isinstance(evidence, str) or not evidence.strip():
                continue
            # Try exact match first, then case-insensitive fallback
            canonical_id = sid if sid in sections_map else section_id_ci_map.get(sid.lower())
            if canonical_id:
                valid_section_evidence[canonical_id] = evidence.strip()
        
        valid_section_ids = list(valid_section_evidence.keys())
        
        print(f"📋 Sections with evidence: {len(valid_section_ids)} - {valid_section_ids[:5]}")
        
        if len(valid_section_ids) == 0:
            print("⚠️ No sections matched with evidence — skipping this transcript batch")
        
    except Exception as e:
        print(f"❌ Error parsing AI response: {e}")
        import traceback
        traceback.print_exc()
        valid_section_ids = []
        valid_section_evidence = {}
    
    # Build worker assignments — each section carries its transcript evidence quote
    worker_assignments = {"worker_1": [], "worker_2": [], "worker_3": []}
    
    for i, section_id in enumerate(valid_section_ids):
        section_details = sections_map.get(section_id, {})
        if section_details:
            worker_key = f"worker_{(i % 3) + 1}"
            worker_assignments[worker_key].append({
                "section_id": section_id,
                "title": section_details.get("title", ""),
                "category": section_details.get("category", ""),
                "template_content": section_details.get("content", ""),
                "transcript_evidence": valid_section_evidence.get(section_id, ""),
            })
    
    state["worker_assignments"] = worker_assignments
    state["document_template"] = template
    state["template_sections_map"] = sections_map
    
    # Check for undiscussed topics if meeting is ending
    if meeting_phase == "ending":
        undiscussed = get_undiscussed_topics(meeting_id)
        state["undiscussed_topics"] = undiscussed
        
        if undiscussed:
            questions = generate_questions_for_undiscussed(undiscussed[:5])
            state["questions_for_users"] = questions
            print(f"❓ Generated {len(questions)} questions for undiscussed topics")
    
    total_assignments = sum(len(v) for v in worker_assignments.values())
    state["processing_status"] = "assigned" if total_assignments > 0 else "no_relevant_content"
    
    print(f"✅ Supervisor assigned {total_assignments} sections to workers")
    
    return state


def generate_questions_for_undiscussed(undiscussed: List[Dict]) -> List[str]:
    """Generate natural questions for undiscussed topics"""
    questions = []
    
    for topic in undiscussed:
        title = topic.get("title", "")
        category = topic.get("category", "").replace("_", " ")
        
        question = f"I noticed we haven't discussed '{title}' yet. Could you share your thoughts on this?"
        questions.append(question)
    
    return questions


# ================== WORKER AGENT ==================
def create_strict_section_prompt(
    section: Dict,
    transcript: str,
    cumulative_transcript: str,
    existing_content: str = "",
    transcript_evidence: str = "",
) -> str:
    """Create a strict prompt that writes ONLY for the assigned section using evidence-isolated source material."""
    
    section_title = section.get("title", "Unknown Section")
    section_category = section.get("category", "").replace("_", " ")
    template_guidance = section.get("template_content", "")
    
    # Primary source: supervisor-extracted evidence quote.
    # Fallback: full cumulative transcript (for backward compatibility).
    primary_source = transcript_evidence.strip() if transcript_evidence and transcript_evidence.strip() else ""
    fallback_source = cumulative_transcript if cumulative_transcript else transcript
    
    if primary_source:
        source_block = f"""═══════════════════════════════════════════════════════════════
MEETING DISCUSSION RELEVANT TO THIS SECTION (PRIMARY SOURCE)
═══════════════════════════════════════════════════════════════
{primary_source}

═══════════════════════════════════════════════════════════════
FULL MEETING TRANSCRIPT (BACKGROUND CONTEXT — use only if the above is insufficient)
═══════════════════════════════════════════════════════════════
{fallback_source}"""
    else:
        source_block = f"""═══════════════════════════════════════════════════════════════
FULL MEETING TRANSCRIPT (SOURCE OF TRUTH)
═══════════════════════════════════════════════════════════════
{fallback_source}"""
    
    prompt = f"""You are a professional technical writer filling ONE specific section of a document.

═══════════════════════════════════════════════════════════════
TARGET SECTION
═══════════════════════════════════════════════════════════════
Section Title: {section_title}
Category: {section_category}

Template Guidance (follow this structure):
{template_guidance if template_guidance else "No specific guidance — write clear, professional content."}

{source_block}

═══════════════════════════════════════════════════════════════
EXISTING CONTENT (build upon this if present)
═══════════════════════════════════════════════════════════════
{existing_content if existing_content else "None — this is a new section."}

═══════════════════════════════════════════════════════════════
STRICT RULES
═══════════════════════════════════════════════════════════════
1. Write ONLY content that belongs specifically in the "{section_title}" section.
2. Do NOT pull in content that belongs in other sections — even if the transcript mentions it.
3. Use ONLY approved source material: the EXISTING CONTENT plus information explicitly stated in the transcript — no assumptions, no invented details.
4. Do NOT add industry best practices, filler, or general knowledge unless it was discussed.
5. If the transcript contains nothing specifically about this section → respond exactly: NO_RELEVANT_CONTENT
6. If existing content is present, preserve it and refine or expand it with new meeting details; do not duplicate already-covered points.
7. LENGTH & FORMAT — STRICTLY ENFORCED:
   - Write only as much as the meeting discussion actually covered. Short discussion = short output.
   - Use bullet points ONLY when listing multiple distinct items (e.g. features, steps, requirements).
   - Use plain sentences/paragraphs when the discussion was conversational or descriptive.
   - Do NOT force bullet points on content that flows naturally as prose.
   - Never pad with filler, generic statements, or context that was not spoken in the meeting.
8. New sentences must be traceable to a specific statement in the transcript.
   Existing content may remain as prior approved document context, but do not invent new details.

═══════════════════════════════════════════════════════════════
GENERATED CONTENT FOR "{section_title}" (FROM TRANSCRIPT ONLY):
═══════════════════════════════════════════════════════════════
"""
    return prompt


def worker_agent(state: DocumentAgentState, worker_id: str) -> Dict[str, str]:
    """
    Worker Agent: Generates content STRICTLY for assigned template sections
    """
    print(f"\n🔧 ===== Worker {worker_id} =====")
    
    meeting_id = state["meeting_id"]
    assignments = state.get("worker_assignments", {}).get(worker_id, [])
    new_transcript = flatten_transcripts(state.get("transcripts", {}))
    cumulative_transcript = get_cumulative_transcript(meeting_id)
    source_transcript = cumulative_transcript if cumulative_transcript.strip() else new_transcript
    
    if not assignments:
        print(f"⏭️ Worker {worker_id}: No sections assigned")
        return {}
    
    print(f"📋 Worker {worker_id}: Processing {len(assignments)} sections")
    
    generated = {}
    llm = get_openai_llm("gpt-5.4-2026-03-05", 0.1)
    
    for section in assignments:
        section_id = section.get("section_id")
        section_title = section.get("title", "Unknown")
        
        print(f"  📝 Processing: '{section_title}'")
        
        try:
            # Get existing content for this section
            existing_content = get_generated_sections(meeting_id).get(section_id, "")
            
            # Use the evidence quote extracted by the supervisor for this specific section.
            # This anchors the worker to only the transcript passages that proved this
            # section was discussed, preventing cross-section content contamination.
            transcript_evidence = section.get("transcript_evidence", "")
            
            # Create strict prompt
            prompt = create_strict_section_prompt(
                section=section,
                transcript=new_transcript,
                cumulative_transcript=source_transcript,
                existing_content=existing_content,
                transcript_evidence=transcript_evidence,
            )
            
            # Generate content
            response = llm.invoke([HumanMessage(content=prompt)])
            content = response.content if hasattr(response, 'content') else str(response)
            content = content.strip()
            
            # Check if content is relevant
            if "NO_RELEVANT_CONTENT" in content or not content:
                print(f"  ⏭️ No relevant content for '{section_title}'")
                continue
            


            
            # Save generated content
            generated[section_id] = content
            update_generated_section(meeting_id, section_id, content, replace=True)
            
            print(f"  ✅ Generated {len(content)} chars for '{section_title}'")
            
        except Exception as e:
            print(f"  ❌ Error processing '{section_title}': {e}")
    
    return generated


def should_enhance_with_research(section_title: str, content: str) -> bool:
    """Determine if section should be enhanced with research"""
    research_keywords = [
        "standards", "compliance", "requirements", "market",
        "competition", "demographics", "industry", "regulations",
        "best practices", "methodology"
    ]
    
    title_lower = section_title.lower()
    
    for keyword in research_keywords:
        if keyword in title_lower:
            return True
    
    return False


def parallel_workers_processor(state: DocumentAgentState) -> DocumentAgentState:
    """Process all workers in parallel"""
    print("\n🚀 ===== PARALLEL WORKER PROCESSING =====")
    
    start_time = time.time()
    meeting_id = state["meeting_id"]
    all_generated = {}
    
    worker_ids = ["worker_1", "worker_2", "worker_3"]
    
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(worker_agent, state.copy(), worker_id): worker_id
            for worker_id in worker_ids
        }
        
        for future in as_completed(futures):
            worker_id = futures[future]
            try:
                result = future.result()
                all_generated.update(result)
            except Exception as e:
                print(f"❌ Worker {worker_id} failed: {e}")
    
    # Update state with all generated content
    state["generated_sections"] = get_generated_sections(meeting_id)
    state["processing_status"] = "completed"
    state["last_update_time"] = time.time()
    state["emit_updates"] = True
    
    total_time = time.time() - start_time
    print(f"\n✅ All workers completed in {total_time:.2f}s")
    print(f"📊 Total sections generated/updated: {len(all_generated)}")
    
    return state


# ================== AGGREGATOR AGENT ==================
def aggregator_agent(state: DocumentAgentState) -> DocumentAgentState:
    """
    Aggregator Agent: Validates output and prepares final response
    Uses smart timing to decide when to ask about undiscussed topics
    """
    print("\n📦 ===== AGGREGATOR AGENT =====")
    
    meeting_id = state["meeting_id"]
    meeting_phase = state.get("meeting_phase", "ongoing")
    
    # Get all generated sections
    generated_sections = get_generated_sections(meeting_id)
    state["generated_sections"] = generated_sections
    
    # Get template sections for validation
    template = state.get("document_template") or get_document_template(meeting_id)
    template_section_ids = set(s.get("id") for s in template.get("sections", [])) if template else set()
    
    # Validate that all generated sections are from template
    invalid_sections = set(generated_sections.keys()) - template_section_ids
    if invalid_sections:
        print(f"⚠️ Warning: Found sections not in template: {invalid_sections}")
        # Remove invalid sections
        for invalid_id in invalid_sections:
            del generated_sections[invalid_id]
        state["generated_sections"] = generated_sections
    
    # Get undiscussed topics
    undiscussed = get_undiscussed_topics(meeting_id)
    state["undiscussed_topics"] = undiscussed
    
    # Calculate progress
    progress = get_discussion_progress(meeting_id)
    print(f"📊 Discussion progress: {progress:.1f}%")
    
    # SMART TIMING: Only generate questions when appropriate
    # Questions are sent ONCE when either:
    # 1. Meeting is ending (detected from conversation)
    # 2. 90%+ of topics have been discussed
    if should_ask_undiscussed_questions(meeting_id, meeting_phase):
        questions = generate_questions_for_undiscussed(undiscussed[:5])
        state["questions_for_users"] = questions
        state["should_send_questions"] = True  # New flag for smart question sending
        
        # Mark questions as sent so we don't send again
        mark_questions_sent(meeting_id)
        
        print(f"🎯 Smart timing triggered: Sending {len(questions)} questions to realtime agent")
        print(f"   - Progress: {progress:.1f}%")
        print(f"   - Meeting phase: {meeting_phase}")
        print(f"   - Undiscussed topics: {len(undiscussed)}")
    else:
        state["questions_for_users"] = []
        state["should_send_questions"] = False
        
        # Log why questions aren't being sent
        if were_questions_sent(meeting_id):
            print(f"ℹ️ Questions already sent for this meeting")
        elif not undiscussed:
            print(f"ℹ️ All topics discussed - no questions needed")
        else:
            print(f"ℹ️ Not yet time to ask questions (progress: {progress:.1f}%, phase: {meeting_phase})")
    
    state["emit_updates"] = True
    state["processing_status"] = "aggregated"
    
    print(f"✅ Aggregation complete:")
    print(f"   - Generated sections: {len(generated_sections)}")
    print(f"   - Undiscussed topics: {len(undiscussed)}")
    print(f"   - Will send questions: {state.get('should_send_questions', False)}")
    
    return state


# ================== ROUTING LOGIC ==================
def should_process_workers(state: DocumentAgentState) -> str:
    """Determine routing after supervisor"""
    status = state.get("processing_status", "")
    assignments = state.get("worker_assignments", {})
    
    has_work = any(len(sections) > 0 for sections in assignments.values())
    
    if status == "assigned" and has_work:
        return "process_workers"
    elif status in ["no_content", "no_relevant_content"]:
        return "skip_to_aggregator"
    else:
        return "end"


# ================== BUILD THE GRAPH ==================
def build_document_agent_graph():
    """Build the hierarchical document agent graph"""
    
    graph = StateGraph(DocumentAgentState)
    
    # Add nodes
    graph.add_node("supervisor", supervisor_agent)
    graph.add_node("workers", parallel_workers_processor)
    graph.add_node("aggregator", aggregator_agent)
    
    # Set entry point
    graph.set_entry_point("supervisor")
    
    # Add conditional edges from supervisor
    graph.add_conditional_edges(
        "supervisor",
        should_process_workers,
        {
            "process_workers": "workers",
            "skip_to_aggregator": "aggregator",
            "end": END
        }
    )
    
    # Add edge from workers to aggregator
    graph.add_edge("workers", "aggregator")
    
    # Add edge from aggregator to end
    graph.add_edge("aggregator", END)
    
    return graph.compile()


# Build the graph
document_graph = build_document_agent_graph()

print("\n" + "="*30)
print("🧠 Hierarchical Document Agent Graph Ready!")
print("="*30)
print("✨ Features:")
print("   ✅ OpenAI-only models (gpt-5.4-2026-03-05, gpt-5.4)")
print("   ✅ Strict template adherence - only generates template sections")
print("   ✅ OpenAI-powered research for industry knowledge")
print("   ✅ Supervisor-Worker-Aggregator architecture")
print("   ✅ Parallel processing for efficiency")
print("   ✅ Undiscussed topic detection")
print("   ✅ Meeting phase detection")
print("="*30 + "\n")


# ================== PUBLIC API ==================
def process_meeting_transcripts(
    meeting_id: str,
    transcripts: Dict,
    document_template: Dict = None,
    previous_sections: Dict = None,
) -> Dict:
    """
    Main entry point for processing meeting transcripts
    
    Args:
        meeting_id: Unique meeting identifier
        transcripts: Dict with localUser, remoteUser, agentUser
        document_template: Optional template (will use stored if not provided)
        previous_sections: Previously generated sections from a prior/current document
    
    Returns:
        Dict with generated_sections, undiscussed_topics, questions_for_users
    """
    print(f"\n{'='*30}")
    print(f"📋 Processing transcripts for meeting: {meeting_id}")
    print(f"{'='*30}")
    
    # Store template if provided
    if document_template:
        previous_sections = previous_sections or get_generated_sections(meeting_id)
        save_document_template(meeting_id, document_template, previous_sections)
    
    # Get template sections map
    sections_map = get_template_sections_map(meeting_id)
    
    # Create initial state
    initial_state: DocumentAgentState = {
        "meeting_id": meeting_id,
        "transcripts": transcripts,
        "document_template": get_document_template(meeting_id),
        "generated_sections": get_generated_sections(meeting_id),
        "undiscussed_topics": [],
        "meeting_phase": "ongoing",
        "supervisor_instructions": "",
        "worker_assignments": {},
        "questions_for_users": [],
        "processing_status": "starting",
        "error_message": None,
        "last_update_time": time.time(),
        "emit_updates": False,
        "template_sections_map": sections_map,
        "should_send_questions": False  # Will be set by aggregator when it's time
    }
    
    # Run the graph
    try:
        final_state = document_graph.invoke(initial_state)
        
        # Get progress for response
        progress = get_discussion_progress(meeting_id)
        
        # Debug: Print the should_send_questions value from final state
        should_send = final_state.get("should_send_questions", False)
        print(f"📦 Final state should_send_questions: {should_send}")
        print(f"📦 Final state questions_for_users count: {len(final_state.get('questions_for_users', []))}")
        
        return {
            "success": True,
            "meeting_id": meeting_id,
            "generated_sections": final_state.get("generated_sections", {}),
            "undiscussed_topics": final_state.get("undiscussed_topics", []),
            "questions_for_users": final_state.get("questions_for_users", []),
            "meeting_phase": final_state.get("meeting_phase", "ongoing"),
            "emit_updates": final_state.get("emit_updates", False),
            "should_send_questions": should_send,
            "discussion_progress": progress
        }
        
    except Exception as e:
        print(f"❌ Error processing transcripts: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "meeting_id": meeting_id,
            "error": str(e),
            "generated_sections": get_generated_sections(meeting_id),
            "undiscussed_topics": get_undiscussed_topics(meeting_id)
        }


def get_meeting_document_status(meeting_id: str) -> Dict:
    """Get current status of document generation for a meeting"""
    return {
        "meeting_id": meeting_id,
        "template_exists": meeting_id in DOCUMENT_TEMPLATES_STORAGE,
        "generated_sections": get_generated_sections(meeting_id),
        "undiscussed_topics": get_undiscussed_topics(meeting_id),
        "meeting_status": get_meeting_status(meeting_id)
    }


def force_end_meeting(meeting_id: str) -> Dict:
    """Force meeting to ending phase and generate final questions"""
    update_meeting_phase(meeting_id, "ending")
    
    undiscussed = get_undiscussed_topics(meeting_id)
    questions = generate_questions_for_undiscussed(undiscussed[:5])
    
    return {
        "meeting_id": meeting_id,
        "undiscussed_topics": undiscussed,
        "questions_for_users": questions
    }


# ================== USER ANSWER PROCESSING ==================
def process_user_answer_for_section(meeting_id: str, section_id: str, user_answer: str, section_title: str = "") -> Dict:
    """
    Process a user's answer to an undiscussed question and add it to the document section.
    
    This is called when the realtime agent asks about undiscussed topics and the user responds.
    The user's answer is processed by the LLM to generate proper document content.
    
    Args:
        meeting_id: Unique meeting identifier
        section_id: The section ID to fill
        user_answer: The user's verbal response/answer
        section_title: Optional title for context
    
    Returns:
        Dict with success status and generated content
    """
    print(f"\n{'='*30}")
    print(f"📝 Processing user answer for section: {section_id}")
    print(f"💬 User answer: {user_answer[:200]}...")
    print(f"{'='*30}")
    
    try:
        # Get template sections map for context
        sections_map = get_template_sections_map(meeting_id)
        section_details = sections_map.get(section_id, {})
        
        if not section_details and not section_title:
            print(f"⚠️ Section {section_id} not found in template")
            return {
                "success": False,
                "error": f"Section {section_id} not found in template"
            }
        
        # Use provided title or get from template
        title = section_title or section_details.get("title", section_id)
        category = section_details.get("category", "").replace("_", " ")
        template_content = section_details.get("content", "")
        
        # Get existing content if any
        existing_content = get_generated_sections(meeting_id).get(section_id, "")
        
        # Use LLM to process the user's answer into proper document content
        llm = get_openai_llm("gpt-5.4-2026-03-05", 0.3)
        
        prompt = f"""You are a professional technical writer. Convert a user's verbal answer into well-structured document content.

═══════════════════════════════════════════════════════════════
DOCUMENT SECTION
═══════════════════════════════════════════════════════════════
Section Title: {title}
Category: {category}

Template Guidance:
{template_content if template_content else "No specific guidance - write clear, professional content."}

═══════════════════════════════════════════════════════════════
USER'S VERBAL ANSWER
═══════════════════════════════════════════════════════════════
{user_answer}

═══════════════════════════════════════════════════════════════
EXISTING CONTENT (if any)
═══════════════════════════════════════════════════════════════
{existing_content if existing_content else "None - this is a new section."}

═══════════════════════════════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════════════════════════════
1. Convert the user's verbal answer into professional document content
2. Follow the template guidance structure if provided
3. Write in clear, professional language suitable for business documentation
4. Organize the content logically with proper formatting
5. If existing content exists, integrate the new information appropriately
6. Do NOT add information the user didn't mention
7. Keep the tone professional but capture the essence of what the user said

═══════════════════════════════════════════════════════════════
GENERATED CONTENT FOR "{title}":
═══════════════════════════════════════════════════════════════
"""
        
        response = llm.invoke([HumanMessage(content=prompt)])
        generated_content = response.content if hasattr(response, 'content') else str(response)
        generated_content = generated_content.strip()
        
        if not generated_content:
            return {
                "success": False,
                "error": "Failed to generate content from user answer"
            }
        
        # Update the document section
        update_generated_section(meeting_id, section_id, generated_content, replace=True)
        
        print(f"✅ Generated {len(generated_content)} chars for '{title}'")
        print(f"📄 Content preview: {generated_content[:200]}...")
        
        # Get updated progress
        progress = get_discussion_progress(meeting_id)
        
        return {
            "success": True,
            "meeting_id": meeting_id,
            "section_id": section_id,
            "section_title": title,
            "generated_content": generated_content,
            "discussion_progress": progress,
            "all_sections": get_generated_sections(meeting_id),
            "remaining_undiscussed": get_undiscussed_topics(meeting_id)
        }
        
    except Exception as e:
        print(f"❌ Error processing user answer: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


def process_multiple_answers(meeting_id: str, answers: List[Dict]) -> Dict:
    """
    Process multiple user answers at once.
    
    Args:
        meeting_id: Unique meeting identifier
        answers: List of dicts with {section_id, user_answer, section_title}
    
    Returns:
        Dict with results for all processed answers
    """
    print(f"\n{'='*30}")
    print(f"📝 Processing {len(answers)} user answers for meeting: {meeting_id}")
    print(f"{'='*30}")
    
    results = []
    
    for answer in answers:
        section_id = answer.get("section_id", "")
        user_answer = answer.get("user_answer", "")
        section_title = answer.get("section_title", "")
        
        if not section_id or not user_answer:
            results.append({
                "section_id": section_id,
                "success": False,
                "error": "Missing section_id or user_answer"
            })
            continue
        
        result = process_user_answer_for_section(
            meeting_id=meeting_id,
            section_id=section_id,
            user_answer=user_answer,
            section_title=section_title
        )
        results.append(result)
    
    # Get final state
    all_sections = get_generated_sections(meeting_id)
    undiscussed = get_undiscussed_topics(meeting_id)
    progress = get_discussion_progress(meeting_id)
    
    return {
        "success": True,
        "meeting_id": meeting_id,
        "processed_count": len([r for r in results if r.get("success")]),
        "results": results,
        "generated_sections": all_sections,
        "undiscussed_topics": undiscussed,
        "discussion_progress": progress
    }


def get_section_for_topic(meeting_id: str, topic_text: str) -> Optional[Dict]:
    """
    Find the most relevant section for a given topic/question text.
    Uses LLM to match the topic to the best section.
    
    Args:
        meeting_id: Unique meeting identifier
        topic_text: The topic or question text to match
    
    Returns:
        Dict with section_id and section_title, or None if no match
    """
    try:
        sections_map = get_template_sections_map(meeting_id)
        if not sections_map:
            return None
        
        # Get undiscussed topics
        undiscussed = get_undiscussed_topics(meeting_id)
        if not undiscussed:
            return None
        
        # Create sections list for matching
        sections_list = "\n".join([
            f"- ID: {t['section_id']} | Title: {t['title']}"
            for t in undiscussed
        ])
        
        llm = get_openai_llm("gpt-5.4-2026-03-05", 0.2)
        
        prompt = f"""Match the following topic/question to the most relevant document section.

TOPIC/QUESTION:
{topic_text}

AVAILABLE SECTIONS (only undiscussed ones):
{sections_list}

Return ONLY the section ID that best matches. If no match, return "NONE".

MATCHED SECTION ID:"""
        
        response = llm.invoke([HumanMessage(content=prompt)])
        matched_id = response.content.strip() if hasattr(response, 'content') else str(response).strip()
        
        # Clean up response
        matched_id = matched_id.replace('"', '').replace("'", "").strip()
        
        if matched_id == "NONE" or matched_id not in sections_map:
            return None
        
        section = sections_map[matched_id]
        return {
            "section_id": matched_id,
            "section_title": section.get("title", matched_id)
        }
        
    except Exception as e:
        print(f"❌ Error matching topic to section: {e}")
        return None
