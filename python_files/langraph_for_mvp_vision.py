"""
LangGraph agent for single-meeting MVP + Vision extraction.

Lighter variant used when the meeting focuses on one MVP/Vision pair instead of
multi-team output. State is keyed by meeting_id in MEETINGS_STORAGE.
"""

from dotenv import load_dotenv
from langgraph.graph import StateGraph
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
import os
import time
import threading
from functools import lru_cache
from python_files.base_urls import OLLAMA_BASE_URL

# ---------------- Load Environment ----------------
load_dotenv()
ollama_base_url = OLLAMA_BASE_URL
openai_api_key = os.getenv("OPENAI_API_KEY")

# ---------------- Global Storage for Meetings ----------------
MEETINGS_STORAGE = {}
STORAGE_LOCK = threading.Lock()


def get_or_create_meeting_storage(meeting_id):
    """Get or create storage for a specific meeting"""
    with STORAGE_LOCK:
        if meeting_id not in MEETINGS_STORAGE:
            MEETINGS_STORAGE[meeting_id] = {
                "mvp": "",
                "vision": "",
                "all_transcripts": [],
                "processing_history": []
            }
        return MEETINGS_STORAGE[meeting_id]


# ---------------- Global LLM Cache ----------------
_llm_cache = {}
_cache_lock = threading.Lock()


@lru_cache(maxsize=10)
def get_cached_llm(model_name, model_type):
    """Cache LLM instances to avoid recreation overhead"""
    cache_key = f"{model_name}_{model_type}"

    with _cache_lock:
        if cache_key not in _llm_cache:
            if model_name.startswith('gpt'):
                _llm_cache[cache_key] = ChatOpenAI(
                    model=model_name,
                    api_key=openai_api_key,
                    temperature=0.3,
                )
            else:
                _llm_cache[cache_key] = ChatOllama(
                    model=model_name,
                    base_url=ollama_base_url,
                    temperature=0.3,
                )
        return _llm_cache[cache_key]


# ---------------- Helper Functions ----------------
def flatten_transcripts(transcripts_dict):
    """Enhanced transcript flattening"""
    if not transcripts_dict:
        return []

    lines = []
    if isinstance(transcripts_dict, list):
        return transcripts_dict

    if isinstance(transcripts_dict, dict):
        local = transcripts_dict.get("localUser", "")
        if local and isinstance(local, str):
            lines.append(f"Local User: {local}")
        elif isinstance(local, list):
            lines.extend([f"Local User: {line}" for line in local if line])

        remote = transcripts_dict.get("remoteUser", "")
        if remote and isinstance(remote, str):
            lines.append(f"Remote User: {remote}")
        elif isinstance(remote, dict):
            for user_id, user_lines in remote.items():
                if isinstance(user_lines, list):
                    lines.extend([f"Remote User {user_id}: {line}" for line in user_lines if line])
                elif user_lines:
                    lines.append(f"Remote User {user_id}: {user_lines}")

        agent = transcripts_dict.get("agentUser", "")
        if agent and isinstance(agent, str):
            lines.append(f"Agent User: {agent}")
        elif isinstance(agent, list):
            lines.extend([f"Agent User: {line}" for line in agent if line])

    return lines


def parse_comprehensive_response(response_text, existing_mvp, existing_vision):
    """Enhanced response parsing - Updated for bullet points and direct vision"""
    result = {
        'mvp': existing_mvp or '',
        'vision': existing_vision or '',
        'summary': response_text[:200] if len(response_text) > 200 else response_text
    }

    print(f"🔍 Raw response preview: {response_text[:300]}...")

    lines = response_text.split('\n')
    current_section = None
    mvp_content = []
    vision_content = []

    for line in lines:
        line = line.strip()
        if not line:
            continue

        line_lower = line.lower()

        if 'mvp' in line_lower and ('mvp:' in line_lower or line_lower.startswith('mvp')):
            current_section = 'mvp'
            mvp_start = line_lower.find('mvp')
            content = line[mvp_start + 3:].lstrip(':').strip()
            if content and ('•' in content or content.startswith('-')):
                mvp_content.append(content)
        elif 'vision' in line_lower and ('vision:' in line_lower or line_lower.startswith('vision')):
            current_section = 'vision'
            vision_start = line_lower.find('vision')
            content = line[vision_start + 6:].lstrip(':').strip()
            if content:
                vision_content.append(content)
        elif current_section == 'mvp' and line and 'vision' not in line_lower:
            if line.startswith('•') or line.startswith('-') or line.startswith('*'):
                mvp_content.append(line)
        elif current_section == 'vision' and line:
            vision_content.append(line)

    # Process MVP content - ensure bullet format
    new_mvp_lines = []
    for line in mvp_content:
        if line.startswith('•') or line.startswith('-') or line.startswith('*'):
            clean_line = line.lstrip('•-*').strip()
            new_mvp_lines.append(f"• {clean_line}")

    if new_mvp_lines:
        new_mvp_text = '\n'.join(new_mvp_lines)
        result['mvp'] = f"{existing_mvp}\n{new_mvp_text}" if existing_mvp else new_mvp_text

    # Process Vision content
    new_vision_text = ' '.join(vision_content).strip()
    if new_vision_text:
        result['vision'] = f"{existing_vision} {new_vision_text}" if existing_vision else new_vision_text

    # Enhanced fallback
    if not mvp_content and not vision_content and response_text:
        import re

        vision_match = re.search(r'vision\s*:', response_text, re.IGNORECASE)
        if vision_match:
            mvp_part = response_text[:vision_match.start()].strip()
            vision_part = response_text[vision_match.end():].strip()

            mvp_part = re.sub(r'^mvp\s*:', '', mvp_part, flags=re.IGNORECASE).strip()
            if mvp_part:
                mvp_lines = [line.strip() for line in mvp_part.split('\n') if line.strip()]
                bullet_lines = []
                for line in mvp_lines:
                    if not (line.startswith('•') or line.startswith('-') or line.startswith('*')):
                        bullet_lines.append(f"• {line}")
                    else:
                        clean_line = line.lstrip('•-*').strip()
                        bullet_lines.append(f"• {clean_line}")

                new_mvp = '\n'.join(bullet_lines)
                result['mvp'] = f"{existing_mvp}\n{new_mvp}" if existing_mvp else new_mvp

            if vision_part:
                result['vision'] = f"{existing_vision} {vision_part}" if existing_vision else vision_part

    # Fallback for missing vision
    if not result['vision'] or result['vision'] == existing_vision:
        print(f"⚠️ Vision section missing, creating from transcript content...")
        if response_text:
            summary_text = response_text.replace("MVP:", "").replace("VISION:", "")
            words = summary_text.split()
            if len(words) > 20:
                summary = ' '.join(words[:50])
                result['vision'] = f"{existing_vision} {summary}" if existing_vision else summary

    print(f"🔍 Final - MVP length: {len(result['mvp'])}, Vision length: {len(result['vision'])}")

    return result


def update_meeting_storage(meeting_id, new_transcripts, mvp, vision):
    """Thread-safe update of meeting storage"""
    meeting_storage = get_or_create_meeting_storage(meeting_id)

    with STORAGE_LOCK:
        if new_transcripts:
            meeting_storage["all_transcripts"].extend(new_transcripts)

        meeting_storage["mvp"] = mvp
        meeting_storage["vision"] = vision
        meeting_storage["processing_history"].append({
            "timestamp": time.time(),
            "transcript_count": len(new_transcripts) if new_transcripts else 0
        })


def get_meeting_storage(meeting_id):
    """Thread-safe retrieval of meeting storage"""
    meeting_storage = get_or_create_meeting_storage(meeting_id)
    with STORAGE_LOCK:
        return meeting_storage.copy()


DEFAULT_MVP_PROMPT = """You are an expert product strategist analyzing a live meeting discussion.
Your task is to extract ONLY functional requirements and MVP features discussed in the meeting.

CRITICAL FILTERING RULES - IGNORE THE FOLLOWING:
❌ Personal conversations (greetings, small talk, casual chat)
❌ Off-topic discussions (personal life, jokes)
❌ Technical issues or meeting logistics (audio problems, connection issues)
❌ Informal banter or social interactions

✅ ONLY EXTRACT:
✅ Product features and functionality discussed
✅ Technical requirements and specifications
✅ User needs and pain points
✅ Implementation approaches"""

DEFAULT_VISION_PROMPT = """You are an expert product strategist analyzing a live meeting discussion.
Your task is to extract ONLY strategic vision, business goals, and long-term direction discussed in the meeting.

CRITICAL FILTERING RULES - IGNORE THE FOLLOWING:
❌ Personal conversations (greetings, small talk, casual chat)
❌ Off-topic discussions (personal life, jokes)
❌ Technical issues or meeting logistics

✅ ONLY EXTRACT:
✅ Business goals and objectives
✅ Strategic decisions and planning
✅ Market analysis and competitive insights
✅ Long-term product direction
✅ Resource allocation and team planning"""


def build_mvp_prompt(mvp_prompt, new_transcripts, existing_mvp):
    """Build the MVP-specific prompt sent to the LLM."""
    existing_mvp = existing_mvp or ""
    new_content = '\n'.join(new_transcripts) if new_transcripts else 'No new content available'
    instruction_block = mvp_prompt.strip() if mvp_prompt and mvp_prompt.strip() else DEFAULT_MVP_PROMPT

    context_section = f"\nEXISTING MVP FROM PREVIOUS DISCUSSIONS:\n{existing_mvp}\n" if existing_mvp else ""

    return f"""{instruction_block}
{context_section}
NEW MEETING CONTENT TO ANALYZE:
{new_content}

INSTRUCTIONS:
1. If the content has NO project/product-related information, respond with exactly: NO_RELEVANT_CONTENT
2. If there IS relevant content, extract ONLY the MVP functional requirements
3. BUILD UPON existing MVP if it exists — do not repeat what's already there, only add new points
4. Do NOT make up features that weren't discussed

REQUIRED OUTPUT FORMAT (MUST FOLLOW EXACTLY):
MVP:
- [Functional requirement 1]
- [Functional requirement 2]
- [Functional requirement 3]

IMPORTANT: Only bullet points. No extra text outside this format."""


def build_vision_prompt(vision_prompt, new_transcripts, existing_vision):
    """Build the Vision-specific prompt sent to the LLM."""
    existing_vision = existing_vision or ""
    new_content = '\n'.join(new_transcripts) if new_transcripts else 'No new content available'
    instruction_block = vision_prompt.strip() if vision_prompt and vision_prompt.strip() else DEFAULT_VISION_PROMPT

    context_section = f"\nEXISTING VISION FROM PREVIOUS DISCUSSIONS:\n{existing_vision}\n" if existing_vision else ""

    return f"""{instruction_block}
{context_section}
NEW MEETING CONTENT TO ANALYZE:
{new_content}

INSTRUCTIONS:
1. If the content has NO strategic/business-related information, respond with exactly: NO_RELEVANT_CONTENT
2. If there IS relevant content, extract ONLY the strategic vision and business direction
3. BUILD UPON existing vision if it exists — extend and enrich it, do not repeat verbatim
4. Be direct and concise — no fluff

REQUIRED OUTPUT FORMAT (MUST FOLLOW EXACTLY):
VISION:
[Your direct, to-the-point vision summary here]

IMPORTANT: Only the vision paragraph. No extra text outside this format."""


def parse_mvp_response(response_text, existing_mvp):
    """Parse MVP-only LLM response and merge with existing."""
    existing_mvp = existing_mvp or ""

    if "NO_RELEVANT_CONTENT" in response_text or not response_text.strip():
        return existing_mvp

    print(f"🔍 MVP raw response preview: {response_text[:200]}...")

    mvp_lines = []
    in_mvp = False

    for line in response_text.split('\n'):
        line = line.strip()
        if not line:
            continue
        line_lower = line.lower()

        if 'mvp' in line_lower and ('mvp:' in line_lower or line_lower.startswith('mvp')):
            in_mvp = True
            continue

        if in_mvp:
            if line.startswith('•') or line.startswith('-') or line.startswith('*'):
                clean = line.lstrip('•-*').strip()
                mvp_lines.append(f"• {clean}")

    # Fallback: treat all bullet lines as MVP if section header not found
    if not mvp_lines:
        for line in response_text.split('\n'):
            line = line.strip()
            if line.startswith('•') or line.startswith('-') or line.startswith('*'):
                clean = line.lstrip('•-*').strip()
                mvp_lines.append(f"• {clean}")

    if not mvp_lines:
        return existing_mvp

    new_mvp_text = '\n'.join(mvp_lines)
    return f"{existing_mvp}\n{new_mvp_text}".strip() if existing_mvp else new_mvp_text


def parse_vision_response(response_text, existing_vision):
    """Parse Vision-only LLM response and merge with existing."""
    existing_vision = existing_vision or ""

    if "NO_RELEVANT_CONTENT" in response_text or not response_text.strip():
        return existing_vision

    print(f"🔍 Vision raw response preview: {response_text[:200]}...")

    vision_lines = []
    in_vision = False

    for line in response_text.split('\n'):
        line = line.strip()
        if not line:
            continue
        line_lower = line.lower()

        if 'vision' in line_lower and ('vision:' in line_lower or line_lower.startswith('vision')):
            in_vision = True
            content_after = line[line_lower.find('vision') + 6:].lstrip(':').strip()
            if content_after:
                vision_lines.append(content_after)
            continue

        if in_vision:
            vision_lines.append(line)

    # Fallback: use full response if no VISION header found
    if not vision_lines:
        cleaned = response_text.replace("VISION:", "").strip()
        if cleaned:
            vision_lines = [cleaned]

    if not vision_lines:
        return existing_vision

    new_vision_text = ' '.join(vision_lines).strip()
    return f"{existing_vision} {new_vision_text}".strip() if existing_vision else new_vision_text


# ---------------- Core Agent Executor ----------------
def agent_executor(state):
    """
    Single agent executor with memory.
    Makes TWO separate LLM calls:
      1. MVP call  — uses state['mvp_prompt'] from frontend
      2. Vision call — uses state['vision_prompt'] from frontend
    """
    start_time = time.time()
    meeting_id = state.get("meeting_id")

    try:
        # Get transcripts
        transcripts_data = state.get("transcripts", {}) or {}
        new_transcripts = flatten_transcripts(transcripts_data) or []

        # Get existing memory
        meeting_data = get_meeting_storage(meeting_id)
        existing_mvp = meeting_data.get("mvp", "") or ""
        existing_vision = meeting_data.get("vision", "") or ""

        # Agent config from frontend
        agent_config = state.get("agent_config", {
            'model': 'llama3.1:latest',
            'modelType': 'reasoning'
        })

        # ---- Two separate prompts from frontend ----
        mvp_prompt = state.get("mvp_prompt", "") or ""
        vision_prompt = state.get("vision_prompt", "") or ""

        llm = get_cached_llm(agent_config['model'], agent_config['modelType'])

        print(f"🤖 Agent processing with {agent_config['model']}...")
        if mvp_prompt:
            print(f"📝 MVP prompt from frontend: {mvp_prompt[:80]}...")
        if vision_prompt:
            print(f"📝 Vision prompt from frontend: {vision_prompt[:80]}...")

        # ---- MVP LLM Call ----
        print("🔧 Running MVP extraction...")
        mvp_full_prompt = build_mvp_prompt(mvp_prompt, new_transcripts, existing_mvp)
        print(f"🔍 MVP prompt length: {len(mvp_full_prompt)} characters")

        mvp_response = llm.invoke(mvp_full_prompt)
        mvp_response_text = mvp_response.content if hasattr(mvp_response, 'content') else str(mvp_response)
        final_mvp = parse_mvp_response(mvp_response_text, existing_mvp)

        if not final_mvp:
            final_mvp = existing_mvp or "• Waiting for project-related discussion..."

        # ---- Vision LLM Call ----
        print("🔭 Running Vision extraction...")
        vision_full_prompt = build_vision_prompt(vision_prompt, new_transcripts, existing_vision)
        print(f"🔍 Vision prompt length: {len(vision_full_prompt)} characters")

        vision_response = llm.invoke(vision_full_prompt)
        vision_response_text = vision_response.content if hasattr(vision_response, 'content') else str(vision_response)
        final_vision = parse_vision_response(vision_response_text, existing_vision)

        if not final_vision:
            final_vision = existing_vision or "Waiting for project-related discussion..."

        # ---- Persist to storage ----
        update_meeting_storage(meeting_id, new_transcripts, final_mvp, final_vision)

        # ---- Write results to state ----
        state["mvp"] = final_mvp
        state["vision"] = final_vision
        state["status"] = "completed"
        state["processing_time"] = round(time.time() - start_time, 2)

        print(f"✅ Agent completed in {time.time() - start_time:.2f}s")
        print(f"📊 MVP length: {len(final_mvp)} chars")
        print(f"📊 Vision length: {len(final_vision)} chars")

    except Exception as e:
        print(f"❌ Agent failed: {str(e)}")
        meeting_data = get_meeting_storage(meeting_id)
        state["mvp"] = meeting_data.get("mvp", "") or "• Error processing functional requirements"
        state["vision"] = meeting_data.get("vision", "") or "Error processing vision content"
        state["status"] = "failed"
        state["error"] = str(e)
        state["processing_time"] = round(time.time() - start_time, 2)

    return state


# ---------------- Storage Utilities ----------------
def reset_meeting_storage(meeting_id):
    """Reset specific meeting storage"""
    with STORAGE_LOCK:
        if meeting_id in MEETINGS_STORAGE:
            del MEETINGS_STORAGE[meeting_id]
    print(f"🔄 Meeting {meeting_id} storage reset")


# ---------------- Build Pipeline ----------------
builder = StateGraph(dict)
builder.add_node("AgentNode", agent_executor)
builder.set_entry_point("AgentNode")
graph = builder.compile()

print("🧠 LangGraph pipeline ready!")
print("✨ Features:")
print("  - Single agent: one MVP + one Vision output")
print("  - TWO separate LLM calls: one for MVP, one for Vision")
print("  - state['mvp_prompt']    → custom MVP instructions from frontend")
print("  - state['vision_prompt'] → custom Vision instructions from frontend")
print("  - Persistent per-meeting memory (MVP + Vision + transcripts)")
print("  - Thread-safe storage")
print("  - Incremental content building across rounds")
print("  - Failure recovery with existing data")