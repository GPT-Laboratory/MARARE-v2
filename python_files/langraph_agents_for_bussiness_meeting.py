"""
LangGraph agent for per-team MVP and Vision during business meetings.

Maintains in-memory state per meeting_id (team A/B/C MVP + vision strings).
Socket event process_mvpvision_transcripts in api.py drives this graph.
"""


from dotenv import load_dotenv
from langgraph.graph import StateGraph
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from functools import lru_cache
from python_files.base_urls import OLLAMA_BASE_URL

# ---------------- Load Environment ----------------
load_dotenv()
ollama_base_url = OLLAMA_BASE_URL
openai_api_key = os.getenv("OPENAI_API_KEY")
# ---------------- Updated Global Storage for Teams Data ----------------
MEETINGS_STORAGE = {}  # Changed from TEAMS_STORAGE to MEETINGS_STORAGE

# Thread-safe storage lock
STORAGE_LOCK = threading.Lock()

def get_or_create_meeting_storage(meeting_id):
    """Get or create storage for a specific meeting"""
    with STORAGE_LOCK:
        if meeting_id not in MEETINGS_STORAGE:
            MEETINGS_STORAGE[meeting_id] = {
                "team_a": {
                    "mvp": "",
                    "vision": "",
                    "all_transcripts": [],
                    "processing_history": []
                },
                "team_b": {
                    "mvp": "",
                    "vision": "", 
                    "all_transcripts": [],
                    "processing_history": []
                },
                "team_c": {
                    "mvp": "",
                    "vision": "",
                    "all_transcripts": [],
                    "processing_history": []
                }
            }
        return MEETINGS_STORAGE[meeting_id]


# Thread-safe storage lock
STORAGE_LOCK = threading.Lock()

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
                    # max_tokens=00,  # Increased for longer responses
                    # timeout=30
                )
            else:
                _llm_cache[cache_key] = ChatOllama(
                    model=model_name,
                    base_url=ollama_base_url,
                    temperature=0.3,
                    # num_predict=800,  # Increased for longer responses
                    # timeout=30
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
        
        # Handle agentUser (NEW)
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
    
    # Debug print to see what's being returned
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
        
        # Check for MVP/Vision sections
        if 'mvp' in line_lower and ('mvp:' in line_lower or line_lower.startswith('mvp')):
            current_section = 'mvp'
            # Extract content after MVP indicator
            mvp_start = line_lower.find('mvp')
            content = line[mvp_start + 3:].lstrip(':').strip()
            if content and ('•' in content or content.startswith('-')):
                mvp_content.append(content)
        elif 'vision' in line_lower and ('vision:' in line_lower or line_lower.startswith('vision')):
            current_section = 'vision'
            # Extract content after VISION indicator
            vision_start = line_lower.find('vision')
            content = line[vision_start + 6:].lstrip(':').strip()
            if content:
                vision_content.append(content)
        elif current_section == 'mvp' and line and 'vision' not in line_lower:
            # Only add bullet points for MVP
            if line.startswith('•') or line.startswith('-') or line.startswith('*'):
                mvp_content.append(line)
        elif current_section == 'vision' and line:
            vision_content.append(line)
    
    # Process MVP content - ensure bullet format
    new_mvp_lines = []
    for line in mvp_content:
        if line.startswith('•') or line.startswith('-') or line.startswith('*'):
            # Convert all to bullet points
            clean_line = line.lstrip('•-*').strip()
            new_mvp_lines.append(f"• {clean_line}")
    
    if new_mvp_lines:
        new_mvp_text = '\n'.join(new_mvp_lines)
        if existing_mvp:
            result['mvp'] = f"{existing_mvp}\n{new_mvp_text}"
        else:
            result['mvp'] = new_mvp_text
    
    # Process Vision content - direct summary
    new_vision_text = ' '.join(vision_content).strip()
    if new_vision_text:
        if existing_vision:
            result['vision'] = f"{existing_vision} {new_vision_text}"
        else:
            result['vision'] = new_vision_text
    
    # Enhanced fallback
    if not mvp_content and not vision_content and response_text:
        import re
        
        # Split by VISION (case insensitive)
        vision_match = re.search(r'vision\s*:', response_text, re.IGNORECASE)
        if vision_match:
            mvp_part = response_text[:vision_match.start()].strip()
            vision_part = response_text[vision_match.end():].strip()
            
            # Clean MVP part and convert to bullets
            mvp_part = re.sub(r'^mvp\s*:', '', mvp_part, flags=re.IGNORECASE).strip()
            if mvp_part:
                # Convert to bullet points if not already
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
    
    # Fallback for missing vision - use transcript summary
    if not result['vision'] or result['vision'] == existing_vision:
        print(f"⚠️ Vision section missing, creating from transcript content...")
        if response_text:
            # Create direct summary from available content
            summary_text = response_text.replace("MVP:", "").replace("VISION:", "")
            # Take meaningful content, not generic statements
            words = summary_text.split()
            if len(words) > 20:
                summary = ' '.join(words[:50])  # First 50 words as summary
                result['vision'] = f"{existing_vision} {summary}" if existing_vision else summary
    
    print(f"🔍 Final - MVP length: {len(result['mvp'])}, Vision length: {len(result['vision'])}")
    
    return result

def update_team_storage(meeting_id, team_key, new_transcripts, mvp, vision):
    """Thread-safe update of team storage for specific meeting"""
    meeting_storage = get_or_create_meeting_storage(meeting_id)
    
    with STORAGE_LOCK:
        if new_transcripts:
            meeting_storage[team_key]["all_transcripts"].extend(new_transcripts)
        
        meeting_storage[team_key]["mvp"] = mvp
        meeting_storage[team_key]["vision"] = vision
        meeting_storage[team_key]["processing_history"].append({
            "timestamp": time.time(),
            "transcript_count": len(new_transcripts) if new_transcripts else 0
        })

def get_team_storage(meeting_id, team_key):
    """Thread-safe retrieval of team storage for specific meeting"""
    meeting_storage = get_or_create_meeting_storage(meeting_id)
    with STORAGE_LOCK:
        return meeting_storage[team_key].copy()
    

def create_comprehensive_prompt(team_key, new_transcripts, existing_mvp, existing_vision):
    """Create prompt with memory context and irrelevant content filtering"""
    
    # Ensure we have valid inputs
    if new_transcripts is None:
        new_transcripts = []
    if existing_mvp is None:
        existing_mvp = ""
    if existing_vision is None:
        existing_vision = ""
    
    # Combine all context
    context_section = ""
    if existing_mvp or existing_vision:
        context_section = f"""
    EXISTING CONTEXT FROM PREVIOUS DISCUSSIONS:
    Current MVP Elements: {existing_mvp if existing_mvp else 'None yet'}
    Current Vision Elements: {existing_vision if existing_vision else 'None yet'}
    """

    new_content = '\n'.join(new_transcripts) if new_transcripts else 'No new content available'
    
    prompt = f"""You are an expert product strategist analyzing a live meeting discussion. Your task is to extract ONLY project-related, product-related, and business-related information.

    {context_section}

    NEW MEETING CONTENT TO ANALYZE:
    {new_content}

    CRITICAL FILTERING RULES - IGNORE THE FOLLOWING:
    ❌ Personal conversations (greetings, small talk, casual chat)
    ❌ Off-topic discussions (personal life, jokes)
    ❌ Technical issues or meeting logistics (audio problems, connection issues)
    ❌ Informal banter or social interactions
    ❌ Any discussion NOT related to the project, product, business strategy, or work objectives

    ✅ ONLY EXTRACT AND ANALYZE:
    ✅ Product features and functionality discussions
    ✅ Technical requirements and specifications
    ✅ Business goals and objectives
    ✅ User needs and pain points
    ✅ Project timeline and milestones
    ✅ Strategic decisions and planning
    ✅ Market analysis and competitive insights
    ✅ Implementation approaches and architecture
    ✅ Resource allocation and team planning

    INSTRUCTIONS:
    1. First, identify if the new content contains ANY project/product-related information
    2. If the content is purely casual conversation, respond with "NO_RELEVANT_CONTENT"
    3. If there IS relevant content, extract ONLY the project-related parts
    4. Analyze the relevant content in context of any existing MVP/Vision elements
    5. Generate responses for BOTH MVP and VISION sections based ONLY on relevant content
    6. If this is the first analysis, create complete MVP and Vision from scratch
    7. If previous MVP/Vision exists, BUILD UPON and ENHANCE ONLY with new project-related insights

    REQUIRED OUTPUT FORMAT (MUST FOLLOW EXACTLY):

    MVP:
    - [Functional requirement 1 - ONLY if discussed in project context]
    - [Functional requirement 2 - ONLY if discussed in project context]
    - [Functional requirement 3 - ONLY if discussed in project context]


    VISION:
    [Provide a direct, to-the-point summary of ONLY the project/product-related discussion - no fluff, just the key business points and technical ideas mentioned]

    IMPORTANT: 
    - If NO project-related content is found, return "NO_RELEVANT_CONTENT" instead of generating generic points
    - MVP must be ONLY functional requirements in bullet points from PROJECT discussions
    - VISION must be direct summary of PROJECT/PRODUCT content only, not casual conversation
    - Do NOT make up features or requirements that weren't discussed
    - Do NOT include casual conversation topics disguised as business requirements"""

    return prompt if prompt and prompt.strip() else "Analyze the meeting content and provide MVP functional requirements and vision summary."


def enhanced_team_executor(state, team_key, team_config, meeting_id):
    """Enhanced executor with memory and analysis - Fixed error handling"""
    start_time = time.time()
    
    try:
        # Safely get transcripts with null checks
        transcripts_data = state.get("transcripts", {})
        if transcripts_data is None:
            transcripts_data = {}
            
        new_transcripts = flatten_transcripts(transcripts_data)
        if new_transcripts is None:
            new_transcripts = []
            
        team_data = get_team_storage(meeting_id, team_key)
        existing_mvp = team_data.get("mvp", "") or ""
        existing_vision = team_data.get("vision", "") or ""
        all_previous_transcripts = team_data.get("all_transcripts", []) or []
        
        agent_config = team_config.get('agent1', {
            'model': 'llama3.1:latest',
            'modelType': 'reasoning'
        })
        
        llm = get_cached_llm(agent_config['model'], agent_config['modelType'])
        
        prompt = create_comprehensive_prompt(
            team_key, 
            new_transcripts, 
            existing_mvp, 
            existing_vision,
        )
        
        if not prompt or not prompt.strip():
            prompt = f"Analyze meeting content for {team_key} and provide MVP functional requirements in bullet points and vision summary."
        
        print(f"🤖 {team_key} processing with {agent_config['model']}...")
        print(f"🔍 Prompt length: {len(prompt)} characters")
        
        # Invoke LLM with validated prompt
        response = llm.invoke(prompt)
        response_content = response.content if hasattr(response, 'content') else str(response)
        
        # Check if content is irrelevant
        if "NO_RELEVANT_CONTENT" in response_content or not response_content:
            print(f"⏭️ {team_key}: No relevant project content found in this segment, keeping existing data")
            # Keep existing data, don't update
            state[f"{team_key}_mvp"] = existing_mvp or "• Waiting for project-related discussion..."
            state[f"{team_key}_vision"] = existing_vision or "Waiting for project-related discussion..."
            state[f"{team_key}_status"] = "no_new_content"
            state[f"{team_key}_time"] = round(time.time() - start_time, 2)
            return state
        
        # Parse response with memory integration
        parsed = parse_comprehensive_response(response_content, existing_mvp, existing_vision)
        
        # Ensure parsed results are not None
        if not parsed.get('mvp'):
            parsed['mvp'] = existing_mvp or "• Waiting for project-related discussion..."
        if not parsed.get('vision'):
            parsed['vision'] = existing_vision or "Waiting for project-related discussion..."
        
        # Special retry for Team A if Vision is still missing
        if team_key == "team_a" and (not parsed['vision'] or len(parsed['vision']) < 50):
            print(f"🔄 {team_key} retrying for Vision section...")
            
            vision_prompt = f"""Based on this MVP content, create a comprehensive strategic vision:

        MVP CONTENT:
        {parsed['mvp']}

        Generate ONLY a detailed VISION statement (minimum 100 words) that includes:
        - Long-term strategic goals
        - Market positioning objectives  
        - Technology evolution roadmap
        - Competitive advantages
        - Business impact projections

        VISION:"""
            
            try:
                vision_response = llm.invoke(vision_prompt)
                vision_content = vision_response.content if hasattr(vision_response, 'content') else str(vision_response)
                if vision_content and len(vision_content.strip()) > 20:
                    clean_vision = vision_content.replace("VISION:", "").strip()
                    parsed['vision'] = f"{existing_vision}\n\n[GENERATED VISION]: {clean_vision}" if existing_vision else clean_vision
            except Exception as ve:
                print(f"⚠️ Vision retry failed: {ve}")
        
        # Update storage with validated data
        update_team_storage(meeting_id, team_key, new_transcripts, parsed['mvp'], parsed['vision'])
        
        # Update state with final results
        state[f"{team_key}_mvp"] = parsed['mvp']
        state[f"{team_key}_vision"] = parsed['vision']
        state[f"{team_key}_status"] = "completed"
        state[f"{team_key}_time"] = round(time.time() - start_time, 2)
        
        print(f"✅ {team_key} completed in {time.time() - start_time:.2f}s")
        print(f"📊 {team_key} MVP length: {len(parsed['mvp'])} chars")
        print(f"📊 {team_key} Vision length: {len(parsed['vision'])} chars")
        
    except Exception as e:
        print(f"❌ {team_key} failed: {str(e)}")
        team_data = get_team_storage(meeting_id, team_key)
        state[f"{team_key}_mvp"] = team_data.get("mvp", "") or "• Error processing functional requirements"
        state[f"{team_key}_vision"] = team_data.get("vision", "") or "Error processing vision content"
        state[f"{team_key}_status"] = "failed"
        state[f"{team_key}_error"] = str(e)
        state[f"{team_key}_time"] = round(time.time() - start_time, 2)
    
    return state

# ---------------- Updated Team Processing Functions ----------------
def process_team_a_enhanced(state):
    """Enhanced Team A processing with memory"""
    meeting_id = state.get("meeting_id")  # Get meeting_id from state
    team_config = state.get("team_config", {}).get("teamA", {
        'agent1': {'model': 'llama3.1:latest', 'modelType': 'reasoning'}
    })
    return enhanced_team_executor(state, "team_a", team_config, meeting_id)

def process_team_b_enhanced(state):
    """Enhanced Team B processing with memory"""
    meeting_id = state.get("meeting_id")  # Get meeting_id from state
    team_config = state.get("team_config", {}).get("teamB", {
        'agent1': {'model': 'gpt-5.4-2026-03-05', 'modelType': 'reasoning'}
    })
    return enhanced_team_executor(state, "team_b", team_config, meeting_id)

def process_team_c_enhanced(state):
    """Enhanced Team C processing with memory"""
    meeting_id = state.get("meeting_id")  # Get meeting_id from state
    team_config = state.get("team_config", {}).get("teamC", {
        'agent1': {'model': 'gpt-5.4-2026-03-05', 'modelType': 'reasoning'}
    })
    return enhanced_team_executor(state, "team_c", team_config, meeting_id)


# ---------------- Parallel Processor with Memory ----------------
def parallel_teams_enhanced(state):
    """Enhanced parallel processing with memory system"""
    print("🚀 Starting enhanced parallel processing with memory...")
    start_time = time.time()
    meeting_id = state.get("meeting_id")
    
    # Thread-safe state updates
    state_lock = threading.Lock()
    
    def process_team_thread(team_processor, team_name):
        """Thread worker for team processing"""
        try:
            # Work on state copy
            with state_lock:
                thread_state = state.copy()
            
            # Process team
            result_state = team_processor(thread_state)
            
            # Merge results back
            with state_lock:
                for key, value in result_state.items():
                    if team_name.lower() in key:
                        state[key] = value
                        
        except Exception as e:
            print(f"❌ {team_name} thread failed: {str(e)}")
            with state_lock:
                state[f"{team_name.lower()}_error"] = str(e)
                # Return existing data on failure
                team_data = get_team_storage(meeting_id, team_name.lower())
                state[f"{team_name.lower()}_mvp"] = team_data["mvp"]
                state[f"{team_name.lower()}_vision"] = team_data["vision"]
    
    # Execute teams in parallel
    team_processors = [
        (process_team_a_enhanced, "team_a"),
        (process_team_b_enhanced, "team_b"), 
        (process_team_c_enhanced, "team_c")
    ]
    
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(process_team_thread, processor, team_name)
            for processor, team_name in team_processors
        ]
        
        # Wait for all to complete
        for future in as_completed(futures):
            future.result()
    
    # Add metadata
    total_time = time.time() - start_time
    state["total_processing_time"] = round(total_time, 2)
    state["processing_status"] = "completed"
    
    print(f"✅ All teams completed in {total_time:.2f}s")
    
    # Print storage statistics - Updated with meeting_id
    meeting_storage = get_or_create_meeting_storage(meeting_id)
    with STORAGE_LOCK:
        for team_key, data in meeting_storage.items():
            print(f"📈 {team_key} (Meeting {meeting_id}): {len(data['all_transcripts'])} total transcripts, "
                  f"{len(data['processing_history'])} processing rounds")
    
    return state

def reset_meeting_storage(meeting_id):
    """Reset specific meeting storage"""
    with STORAGE_LOCK:
        if meeting_id in MEETINGS_STORAGE:
            del MEETINGS_STORAGE[meeting_id]
    print(f"🔄 Meeting {meeting_id} storage reset")



# ---------------- Build Enhanced Pipeline ----------------
builder = StateGraph(dict)
builder.add_node("EnhancedParallelTeams", parallel_teams_enhanced)
builder.set_entry_point("EnhancedParallelTeams")
graph = builder.compile()

print("🧠 Enhanced LangGraph pipeline with memory system ready!")
print("✨ New Features:")
print("  - Persistent storage for each team's MVP and Vision")
print("  - Memory system that builds upon previous transcripts")
print("  - Comprehensive, responses (150-200+ words)")
print("  - Dynamic team configuration from frontend")
print("  - Thread-safe storage operations")
print("  - Incremental content building")
print("  - Failure recovery with existing data")
print("📊 Teams will now build comprehensive, evolving strategies!")