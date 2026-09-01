"""
MARARE backend API (Flask + Socket.IO).

This is the main server entry point. It serves the built React app, exposes REST
endpoints for projects/documents/meetings/MCP, and handles real-time meeting
events (WebRTC signaling, transcripts, AI agents) over Socket.IO.

Module layout (see python_files/):
  - supabase_store.py      — database reads/writes (Supabase)
  - project_mcp.py         — Notion / Google Drive OAuth and MCP tools
  - document_storage.py    — which backend stores meeting documents
  - meeting_transcript.py  — transcript + meeting history HTTP handlers
  - langraph_*             — LangGraph agents for documents, MVP, summaries
"""

import asyncio
import datetime
from multiprocessing.connection import Client
import threading
from flask import Flask, jsonify, redirect, request, send_from_directory
from python_files.socketio_instance import socketio
from flask_socketio import emit, join_room, leave_room
from python_files.project_meeting_storage import MeetingStorageError, export_document_to_notion, update_notion_meeting_storage_settings

from flask_cors import CORS
import os
import json
import base64
import io
import uuid
import time
from dotenv import load_dotenv
from pathlib import Path




# MCP imports
# from python_files.mcp_server import GLOBAL_CONFIG, async_list_tools, call_tool_func, run_mcp_server
# from slack_sdk import WebClient
# from slack_sdk.errors import SlackApiError

from python_files.langraph_agents_for_bussiness_meeting import  STORAGE_LOCK, get_or_create_meeting_storage, graph, reset_meeting_storage
from python_files.langraph_for_mvp_vision import graph as mvpvision_graph, reset_meeting_storage as reset_mvpvision_storage

# Import hierarchical document agent system
from python_files.langraph_agents_hierarchy import (
    save_document_template,
    process_meeting_transcripts,
    get_meeting_document_status,
    force_end_meeting,
    get_generated_sections,
    get_undiscussed_topics,
    reset_meeting_document_storage
)

# Import summary agent system
from python_files.langraph_summary_agent import (
    process_summary_transcripts,
    reset_summary_storage,
    get_full_summary
)


from gtts import gTTS
import requests
from python_files.mcp_functions import run_async
from python_files.project_mcp_chat_agent import (
    ProjectMCPChatAgentError,
    export_meeting_document_via_agent,
    retrieve_meeting_document_via_agent,
)
from python_files.google_drive_documents import (
    GoogleDriveDocumentError,
    retrieve_project_document_from_drive,
    retrieve_meeting_document_from_drive,
    save_project_document_to_drive,
)
from python_files.notion_documents import (
    NotionDocumentError,
    retrieve_project_document_from_notion,
    save_project_document_to_notion,
)
from python_files.document_storage import (
    document_storage_status,
    update_document_storage_preference,
)
# from python_files.mcp_agent import IntelligentMCPAgent
from python_files.meeting_files import create_project
from python_files.meeting_files.end_call import leave_call
from python_files.meeting_files.create_project import delete_project, fetch_projects, creating_project, update_project
from python_files.template_document import delete_generated_document, get_document_by_id, get_documents_by_project, get_generated_documents, save_generated_document, update_generated_document
from python_files.import_transcript import import_transcript_and_generate_document
from python_files.import_pregenerated_document import import_pregenerated_document
from python_files.import_multi_source_document import import_multi_source_document
from python_files.meeting_summary import delete_meeting_summary, get_meeting_summaries, get_summaries_by_project, save_meeting_summary, update_meeting_summary, get_summary
from python_files.meeting_mvpvision import save_meeting_mvpvision, get_mvpvision_by_project, update_meeting_mvpvision
from python_files.meeting_transcript import (
    delete_project_meeting,
    get_meeting_transcript_by_id,
    get_project_google_drive_meeting_history,
    get_project_meeting_history,
    get_project_notion_meeting_history,
    save_meeting_transcript,
)
from python_files.turn_stun_servers import webrtc_config_view
from python_files.project_mcp import (
    ProjectMCPError,
    available_connectors,
    call_project_mcp_tool,
    complete_google_drive_oauth,
    complete_notion_oauth,
    delete_project_provider_config,
    get_public_project_configuration,
    list_project_mcp_tools,
    save_project_github_config,
    save_project_notion_config,
    start_google_drive_oauth,
    start_notion_oauth,
)
from python_files.document_context_orchestrator import process_document_transcripts_with_orchestrator
from python_files.meeting_document_memory import (
    hydrate_hierarchy_runtime,
    persist_runtime_snapshot,
    reset_document_session,
    upsert_document_template_context,
)
from python_files.supabase_store import find_meeting_admin, insert_meeting_admin
from python_files.base_urls import MCP_SERVERS, OPENAI_REALTIME_CLIENT_SECRETS_URL

# Load environment variables
load_dotenv()


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, 'dist')

# ---------------------------------------------------------------------------
# Flask app + static frontend (Vite build in dist/)
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder=DIST_DIR, static_url_path='')

transcript_history = []


# MCP Server Setup — see config/appUrls.json

# Initialize MCP


# Global dynamic state for MCP
ACTIVE_TOOLS = []
DYNAMIC_TOKENS = {}

# Environment variables for MCP
NOTION_API_KEY = os.getenv("NOTION_API_KEY")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")
# SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN")
JIRA_URL = os.getenv("JIRA_URL")  
JIRA_EMAIL = os.getenv("JIRA_EMAIL")
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN")

print("notin key in api ", NOTION_API_KEY)
# AUTH_TOKENS = {
#     "notion": NOTION_API_KEY,
# }


# OpenAI API key
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

import mimetypes
mimetypes.add_type('application/javascript', '.js')

from python_files.socketio_instance import socketio
socketio.init_app(app, async_mode='threading', cors_allowed_origins='*')


@app.route('/')
def serve_root():
    return send_from_directory(DIST_DIR, 'index.html')

@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(os.path.join(DIST_DIR, 'assets'), filename)

@app.route('/<path:path>')
def serve_react_app(path):
    file_path = os.path.join(DIST_DIR, path)
    if os.path.exists(file_path):
        return send_from_directory(DIST_DIR, path)
    else:
        # fallback for React Router
        return send_from_directory(DIST_DIR, 'index.html')

# app = Flask(__name__, static_folder='dist', static_url_path='')
# app = Flask(__name__)
CORS(app)


import mimetypes
mimetypes.add_type('application/javascript', '.js')

from python_files.socketio_instance import socketio



# socketio = socketio(app, async_mode='threading', cors_allowed_origins='*')

socketio.init_app(app, async_mode='threading', cors_allowed_origins='*')


# print("Using async_mode:", socketio.async_mode)

# In-memory meeting room state (per server process; not persisted)
rooms = {}
screen_sharers = {}  # { roomId: userId }
room_admins = {}
pending_join_requests = {}
active_reactions = {}
# Store active socket connections
active_connections = set()
raised_users_by_room = {}
users={}

# Store active agent offers per meeting
active_agents = {}  # { meeting_id: { "offer": offer_sdp, "agentId": "openai-agent" } }


# OpenAI API key from environment
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")


# @app.route('/api1/ephemeral-key', methods=['POST'])
# def get_ephemeral_key():
#     url = "https://api.openai.com/v1/realtime/sessions"
#     headers = {
#         "Authorization": f"Bearer {OPENAI_API_KEY}",
#         "Content-Type": "application/json"
#     }
#     payload = {
#         "model": "gpt-realtime-2025-08-28",
#         "voice": "echo"
#         # "voice": "ash"
#     }

#     response = requests.post(url, headers=headers, json=payload)

#     if response.ok:
#         return jsonify(response.json())
#     else:
#         return jsonify({"error": response.text}), response.status_code



# ---------------------------------------------------------------------------
# OpenAI Realtime — ephemeral client key for browser WebRTC sessions
# ---------------------------------------------------------------------------

@app.route('/api1/ephemeral-key', methods=['POST'])
def get_ephemeral_key():
    url = OPENAI_REALTIME_CLIENT_SECRETS_URL

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "session": {
            "type": "realtime",
            "model": "gpt-realtime-2025-08-28",
            "audio": {
                "output": {
                    "voice": "echo"
                }
            }
        }
    }

    response = requests.post(url, headers=headers, json=payload)

    if response.ok:
        return jsonify(response.json())
    else:
        return jsonify({"error": response.text}), response.status_code

@app.route('/<project_id>/<meeting_id>')
def serve_meeting_page_with_meeting(project_id, meeting_id):
    return send_from_directory(app.static_folder, 'index.html')

# ---------------------------------------------------------------------------
# Socket.IO — meeting rooms, WebRTC signaling, AI agents, live documents
# ---------------------------------------------------------------------------

@socketio.on('connect')
def handle_connect():
    print(f"A user connected: {request.sid}")
    active_connections.add(request.sid)
    print(f"Active connections: {len(active_connections)}")
    # print_room_state()
    
    # Send user ID to client
    emit('user-ID', request.sid)



@socketio.on('join-room')
def handle_join_room(data):
    print(f"Received join-room data: {data}")  # Debug log
    user_id = request.sid
    meeting_id = data.get('meetingId')
    mic_enabled = data.get('micEnabled', False)
    video_enabled = data.get('videoEnabled', False)
    agent = data.get('agent', False)
    agent_name = data.get('agentName', '')  # Use a default value if not present
    remote_name = data.get('userName', '')
    aid = data.get('aid', None)  # Get aid from data if available

    print(f"{remote_name} {aid} is name in backend")

    
    # Validation
    if meeting_id is None:
        print("Error: No meetingId provided")
        return
    
        
    
    
    # Initialize room if it doesn't exist
    if meeting_id not in rooms:
        rooms[meeting_id] = []
        room_admins[meeting_id] = {
            'userId': user_id,
            "aid": aid,
        }

        # Save admin status in db with expiry time and user id
        from datetime import datetime, timedelta, timezone
        expiry_time = datetime.now(timezone.utc) + timedelta(hours=1)
        admin_doc = {
            'meeting_id': meeting_id,
            'user_id': aid,
            'is_admin': True,
            'is_agent': agent,
            'agent_Name': agent_name,
            'exp': expiry_time.isoformat()
        }
        try:
            insert_meeting_admin(admin_doc)
            print(f"Admin status saved in db for meeting {meeting_id}, user {aid}, expires at {expiry_time}")
        except Exception as e:
            print(f"Error saving admin status in db: {e}")
        
    print(f"Room Admin for room {meeting_id}: {room_admins[meeting_id]}")

    # if len(rooms[meeting_id]) == 0:
    #     # If the room is empty, set the user as the admin
    #     room_admins[meeting_id] = request.sid
    #     print(f"User {request.sid} is the admin of room {meeting_id}")
    #     emit('admin-status', {'isAdmin': True}, to=user_id)


    # Add user to the room with Socket.IO room
    join_room(meeting_id)

    # Check if user is already in the room
    user_exists = False
    for user in rooms[meeting_id]:
        if user['userId'] == request.sid:
            user['micEnabled'] = mic_enabled
            user['isAgent'] = agent
            user['agentName'] = agent_name
            user['remoteName'] = remote_name
            user['videoEnabled'] = video_enabled
            user_exists = True
            break

    # Add this check for OpenAI agent
    # is_openai_agent = data.get('isOpenAIAgent', False)
    # openai_session_id = data.get('openaiSessionId', None)
    
    # If user doesn't exist in the room, add them
    if not user_exists:
        # if is_openai_agent:
        #     rooms[meeting_id].append({
        #          'userId': request.sid,
        #         'micEnabled': mic_enabled,
        #         'isAgent': agent,
        #         'agentName': agent_name,
        #         'remoteName': remote_name,
        #         'videoEnabled': video_enabled,
        #         'isOpenAIAgent': is_openai_agent,  # Add this flag
        #         'openaiSessionId': openai_session_id,  # Link to OpenAI session
        #     })
        #     print(f"OpenAI Agent {request.sid} added to room {meeting_id}")
        # else:
            rooms[meeting_id].append({
                'userId': request.sid,
                'micEnabled': mic_enabled,
                'isAgent': agent,
                'agentName': agent_name,
                'remoteName': remote_name,
                'videoEnabled': video_enabled,
            })

    print(f"User {request.sid} joined room {meeting_id} with mic {mic_enabled} and agent {agent} named {agent_name} videoEnabled {video_enabled}")
    
    # Print all users in the room for debugging
    print(f"All users in room {meeting_id}:")
    for i, user in enumerate(rooms[meeting_id]):
        print(f"  User {i+1}: {user['userId']}")
    
    # Broadcast to others in the room that a new user connected
    emit('user-connected', {
        'userId': request.sid,
        'micEnabled': mic_enabled,
        'isAgent': agent,
        'agentName': agent_name,
        'remoteName': remote_name,
        'videoEnabled': video_enabled,
        # 'isOpenAIAgent': is_openai_agent,
    }, to=meeting_id, skip_sid=request.sid)
    # }, to=meeting_id,)

    
    # Get latest user joined
    latest_user = next((user for user in rooms[meeting_id] if user['userId'] == request.sid), None)
    
    if latest_user:
        data = remote_name or request.sid[:4]
        welcome_text = f"Welcome {data} in the room"
        
        try:
            # Generate welcome audio
            tts = gTTS(text=welcome_text, lang='en')
            audio_buffer = io.BytesIO()
            tts.write_to_fp(audio_buffer)
            audio_buffer.seek(0)
            audio_base64 = base64.b64encode(audio_buffer.read()).decode('utf-8')
            
            # Send audio to the new user
            # emit('welcome-audio', {'audio': audio_base64}, to=request.sid)
            print(f"Welcome audio sent to user {request.sid}")
        except Exception as e:
            print(f"Error generating audio: {e}")
    
    print(f"Total users in the room after new user joined: {len(rooms[meeting_id])}")
    # print_room_state()


    # Check if someone is sharing screen in this room
    is_screen_sharing = False
    sharing_user_id = None
    
    if meeting_id in screen_sharers:
        is_screen_sharing = True
        sharing_user_id = screen_sharers[meeting_id]
    
    # Notify the new user about screen sharing status
    emit('screen-sharing-status', {
        'isSharing': is_screen_sharing,
        'userId': sharing_user_id
    })
    
    # If someone is sharing screen, notify them about the new user
    if is_screen_sharing:
        emit('new-user-for-screen', {
            'newUserId': request.sid,
            'roomId': meeting_id,
            'screenSharing': True
        }, to=sharing_user_id)
    for user in rooms[meeting_id]:
            userId= user['userId']
            micEnabled= user['micEnabled']
            isAgent= user.get('isAgent', False)
            agentName= user.get('agentName', '')
            remoteName=user.get('remoteName','')
            videoEnabled= user.get('videoEnabled','')
            print(f"Data for users: {userId},  {videoEnabled}, {remoteName}")
    # Send the list of existing peers to the newly joined user
    emit('existing-peers', [
        {
            'userId': user['userId'],
            'micEnabled': user['micEnabled'],
            'isAgent': user.get('isAgent', False),
            'agentName': user.get('agentName', ''),
            'remoteName': user.get('remoteName',''),
            'videoEnabled': user.get('videoEnabled','')
        } for user in rooms[meeting_id]
    ],
    room=meeting_id
    )


        # After notifying peers...
    captions_enabled = room_admins[meeting_id].get("captions", False)
    if captions_enabled:
        emit("captions-status", {
            "enableCaptions": True,
            "message": "Transcription activated by admin"
        }, to=request.sid)


    screen_sharer_id = screen_sharers.get(meeting_id)
    if screen_sharer_id:
        print(f"Notifying screen sharer {screen_sharer_id} to send screen to new user {request.sid}")
        emit('new-user-for-screen', {
            'newUserId': request.sid,
            'roomId': meeting_id,
            'screenSharing': True
        }, to=screen_sharer_id)


@socketio.on('openai-agent-audio')
def handle_openai_agent_audio(data):
    meeting_id = data.get('meetingId')
    audio_data = data.get('audioData')
    agent_id = data.get('agentId')
    
    if meeting_id in rooms:
        # Broadcast OpenAI agent audio to all peers in the room except the creator
        emit('openai-agent-audio-stream', {
            'agentId': agent_id,
            'audioData': audio_data,
            'agentName': 'OpenAI Assistant'
        }, to=meeting_id, skip_sid=request.sid)


@socketio.on('openai-agent-value')
def handle_active_agent(data):
    meeting_id = data.get('meetingId')
    activeAgent = data.get('activeAgent')
    user_id = request.sid
   
    if meeting_id in rooms:
        # Broadcast OpenAI agent audio to all peers in the room except the creator
        print(f'openai-agent-value in backend {activeAgent}')
        emit('openai-agent-value', {
            'activeAgent': activeAgent,
        }, to=meeting_id,  skip_sid=request.sid)


@socketio.on('openai-agent-ready')
def handle_agent_ready(data):
    meeting_id = data.get('meetingId')
    ready = data.get('ready')
   
    if meeting_id in rooms:
        print(f'openai-agent-ready in backend {ready}')
        emit('openai-agent-ready', {
            'ready': ready,
        }, to=meeting_id, skip_sid=request.sid)

# handle request to join 
@socketio.on('request-to-join')
def handle_request_to_join(data):
    meeting_id = data.get('meetingId')
    user_id = request.sid
    s_id = data.get('s_id', None)  # Get aid from data if available
    print(f"User {user_id} requested to join meeting {meeting_id}")

    if meeting_id not in rooms:
        emit('join-error', {'message': 'Meeting does not exist'}, to=user_id)
        return
    
    # Get admin for this room
    ids = room_admins.get(meeting_id)
    admin_id = ids.get('userId') 
    print(f"Admin for room {meeting_id}: {admin_id}")
    
    if not admin_id:
        emit('join-error', {'message': 'No admin available'}, to=user_id)
        return
    
    # Store the request
    if meeting_id not in pending_join_requests:
        pending_join_requests[meeting_id] = {}
    
    pending_join_requests[meeting_id][user_id] = {
        'userId': user_id,
        'name': data.get('name'),
        'micEnabled': data.get('micEnabled', False),
        'videoEnabled': data.get('videoEnabled', False),
        's_id': data.get('s_id', None)  # Store aid if available
    }

    print(f"Pending join requests for meeting {meeting_id}: {pending_join_requests[meeting_id]}")
    
    # Notify admin
    emit('join-request', {
        'userId': user_id,
        'userData': pending_join_requests[meeting_id][user_id],
        'meetingId': meeting_id
    }, to=admin_id)


# --- Agent sends Offer ---
# --- Agent sends Offer ---
@socketio.on('agent-peer-offer')
def handle_agent_offer(data):
    meeting_id = data.get('meetingId')
    agent_id = data.get('fromUserId')
    offer = data.get('offer')
    to_user_id = data.get('toUserId')
    
    if meeting_id not in active_agents:
        active_agents[meeting_id] = {}
    active_agents[meeting_id]["agentId"] = agent_id
    print(f"🤖 Received agent offer for meeting {meeting_id} (target: {to_user_id})")
    
    payload = {
        'offer': offer,
        'fromUserId': agent_id,
        'remoteName': data.get('remoteName', 'AI Assistant'),
        'is_openai_agent': data.get('is_openai_agent', True)
    }
    
    if to_user_id:
        emit('agent-offer', payload, to=to_user_id)
    else:
        emit('agent-offer', payload, to=meeting_id, include_self=False)
    
    print(f"📤 Broadcasted agent offer to meeting {meeting_id}")

# --- Peer sends Answer back to Agent ---
@socketio.on('peer-agent-answer')
def handle_peer_answer(data):
    meeting_id = data.get('meetingId')
    print(f"📥 Peer sent answer for meeting {meeting_id}")
    emit('agent-peer-answer', data, to=meeting_id)

# --- Agent ICE → Peers ---
@socketio.on('agent-ice')
def handle_agent_ice(data):
    meeting_id = data.get('meetingId')
    to_user_id = data.get('toUserId')
    data['fromUserId'] = data.get('fromUserId') or request.sid
    print(f"🧊 Forwarding agent ICE to meeting {meeting_id} target={to_user_id}")  # Add this log
    if to_user_id:
        emit('agent-ice-candidate', data, to=to_user_id)
    else:
        emit('agent-ice-candidate', data, to=meeting_id, include_self=False)

# --- Peer ICE → Agent ---
@socketio.on('peer-agent-ice')
def handle_peer_ice(data):
    meeting_id = data.get('meetingId')
    data['fromUserId'] = request.sid
    target_agent = data.get('toUserId') or active_agents.get(meeting_id, {}).get("agentId")
    print(f"📤 Forwarding peer ICE to agent in {meeting_id} target={target_agent}")  # Add this log
    if target_agent:
        emit('peer-agent-ice', data, to=target_agent)
    else:
        emit('peer-agent-ice', data, to=meeting_id)




@socketio.on('captions-toggled')
def handle_captions_toggled(data):
    meeting_id = data.get('meetingId')
    user_id = data.get('userId')
    enable_captions = data.get('enableCaptions', False)

    print(f"Captions toggled in room {meeting_id} by {user_id}: {enable_captions}")

    # Store captions state for this meeting
    if meeting_id not in rooms:
        print(f"Error: Room {meeting_id} does not exist")
        return
    
    # Save captions state
    if "captions" not in room_admins[meeting_id]:
        room_admins[meeting_id]["captions"] = False
    room_admins[meeting_id]["captions"] = enable_captions

    # Broadcast the state to all users in the room
    if enable_captions:
        message = "Transcription activated by admin"
    else:
        message = "Transcription deactivated by admin"

    emit("captions-status", {
        "enableCaptions": enable_captions,
        "message": message
    }, room=meeting_id)
  

@socketio.on('approve-join')
def handle_approve_join(data):
    meeting_id = data.get('meetingId')
    user_id = data.get('userId')
    admin_id = request.sid
    print(f"Admin {admin_id} approved join request for user {user_id} in meeting {meeting_id}")
    approved = data.get('approved', False)
    print("aproved", approved)
    # Verify admin status
    ids = room_admins.get(meeting_id)
    admin = ids.get('userId') 
    print("admin in approve", admin)
    if admin != admin_id:
        emit('error', {'message': 'Only admin can approve requests'}, to=admin_id)
        return
    
    if meeting_id not in pending_join_requests or user_id not in pending_join_requests[meeting_id]:
        emit('error', {'message': 'Invalid join request'}, to=admin_id)
        return
    
    if approved:
        # Add user to room (using your existing join-room logic)
        print("inside the approved")
        user_data = pending_join_requests[meeting_id][user_id]
        emit('join-approved', {
            'meetingId': meeting_id
        }, to=user_id)
        
        join_room(meeting_id)
        rooms[meeting_id].append({
            'userId': user_id,
            'micEnabled': user_data['micEnabled'],
            'isAdmin': False,
            'isAgent': False,
            'videoEnabled':user_data['videoEnabled']
        })
        
        # Notify all participants
        # emit('user-connected', {
        #     'userId': user_id,
        #     'micEnabled': user_data['micEnabled']
        # }, to=meeting_id,skip_sid=request.sid)
        
        
        # Send existing peers to new user
        emit('existing-peers', [
            {'userId': u['userId'], 'micEnabled': u['micEnabled'], 'videoEnabled': u['videoEnabled']} 
            for u in rooms[meeting_id] if u['userId'] != user_id
        ], to=user_id)
        
        # Notify requester
        # emit('join-approved', {
        #     'meetingId': meeting_id
        # }, to=user_id)
    else:
        # Notify requester
        emit('join-rejected', {
            'meetingId': meeting_id,
            'reason': data.get('reason', 'Request denied')
        }, to=user_id)
    
    # Clean up
    del pending_join_requests[meeting_id][user_id]


@socketio.on('send-reaction')
def handle_reaction(data):
    """
    Handle incoming reactions and broadcast to all other clients
    """
    try:
        # Validate incoming data
        if not all(key in data for key in ['userId', 'reaction']):
            raise ValueError("Invalid reaction data format")
        
        # Add timestamp
        reaction_data = {
            'userId': data['userId'],
            'reaction': data['reaction'],
            'timestamp': int(time.time() * 1000) 
             # Milliseconds for consistency with JS
        }
        
        # Store reaction (optional)
        if data['userId'] not in active_reactions:
            active_reactions[data['userId']] = []
        active_reactions[data['userId']].append(reaction_data)
        
        # Broadcast to all clients except sender
        emit('receive-reaction', 
             reaction_data,
             broadcast=True,
             include_self=False)
        
        # Log for debugging
        print(f"Reaction received from {data['userId']}: {data['reaction']}")
        
    except Exception as e:
        print(f"Error handling reaction: {str(e)}")
        emit('reaction-error', {'message': str(e)})

# Optional: Cleanup old reactions periodically
def cleanup_reactions():
    while True:
        current_time = int(time.time() * 1000)
        expired = current_time - 5000  # 5 second TTL for reactions
        
        for user_id in list(active_reactions.keys()):
            active_reactions[user_id] = [
                r for r in active_reactions[user_id]
                if r['timestamp'] > expired
            ]
            if not active_reactions[user_id]:
                del active_reactions[user_id]
        
        time.sleep(10)  # Run cleanup every 10 seconds

@socketio.on("hand_toggle")
def handle_hand_toggle(data):
    meeting_id = data.get("meetingId")
    user_id = data.get("userId")
    raised = data.get("raised")
    userName = data.get("userName")
    
    print(f"Hand toggle: User {user_id} in meeting {meeting_id}, raised: {raised}")
    
    # Initialize meeting room if not exists
    if meeting_id not in raised_users_by_room:
        raised_users_by_room[meeting_id] = []
    
    # Add or remove user from raised hands list
    if raised:
        # Add user to raised hands list if not already there
        if user_id not in raised_users_by_room[meeting_id]:
            raised_users_by_room[meeting_id].append(user_id)
    else:
        # Remove user from raised hands list
        if user_id in raised_users_by_room[meeting_id]:
            raised_users_by_room[meeting_id].remove(user_id)
    
    # Broadcast updated raised hands list to all participants in the meeting
    emit("update_hands", {
        "raisedUsers": raised_users_by_room[meeting_id],
        "userName": userName,
        "isRaised": raised
    }, room=meeting_id)



# WebRTC peer connection signaling (offer / answer / ICE)
@socketio.on('offer')
def handle_offer(data):
    to_sid = data.get('to')
    print(f"data in offer ${data}")
    offer = data.get('offer')
    if to_sid and offer:
        emit('offer', {
            'from': request.sid,
            'offer': offer,
            'isAgent': data.get('agent'),
            'agentName': data.get('agentName'),
            'remoteName': data.get('userName'),
            'videoEnabled': data.get('enableVideo'),
            'micEnabled': data.get('enableAudio'),
            # 'isOpenAIAgent': data.get('isOpenAIAgent', False),
        }, to=to_sid)

@socketio.on('answer')
def handle_answer(data):
    to_sid = data.get('to')
    answer = data.get('answer')
    if to_sid and answer:
        emit('answer', {
            'from': request.sid,
            'answer': answer,
            'isAgent': data.get('isAgent'),
            'agentName': data.get('agentName'),
            'remoteName': data.get('remoteName'),
            'videoEnabled': data.get('videoEnabled'),
            'micEnabled': data.get('micEnabled'),
            # 'isOpenAIAgent': data.get('isOpenAIAgent', False),
        }, to=to_sid)


@socketio.on('ice-candidate')
def handle_ice_candidate(data):
    to_sid = data.get('to')
    candidate = data.get('candidate')
    if to_sid and candidate:
        emit('ice-candidate', {'from': request.sid, 'candidate': candidate}, to=to_sid)

@socketio.on('register-screen-sharer')
def register_screen_sharer(data):
    """Register a user as the screen sharer for a room"""
    room_id = data.get('roomId')
    if room_id:
        screen_sharers[room_id] = request.sid
        print(f"User {request.sid} registered as screen sharer for room {room_id}")

@socketio.on('screen-share')
def handle_screen_share(data):
    room_id = data.get('roomId')
    offer = data.get('offer')
    to_user_id = data.get('to')
    
    if room_id and offer:
        # Register as screen sharer
        screen_sharers[room_id] = request.sid
        print(f"User {request.sid} sharing screen in meeting {room_id}")
        
        if to_user_id:
            # Direct to specific user
            emit('screen-share', {
                'userId': request.sid,
                'roomId': room_id,
                'offer': offer
            }, to=to_user_id)
        else:
            # Broadcast to the room (excluding sender)
            emit('screen-share', {
                'userId': request.sid,
                'roomId': room_id,
                'offer': offer
            }, to=room_id, skip_sid=request.sid)

@socketio.on('screen-answer')
def handle_screen_answer(data):
    to_user_id = data.get('to')
    answer = data.get('answer')
    
    if to_user_id and answer:
        print(f"Screen answer from {request.sid} to {to_user_id}")
        emit('screen-answer', {
            'from': request.sid,
            'answer': answer
        }, to=to_user_id)

@socketio.on('screen-candidate')
def handle_screen_candidate(data):
    to_user_id = data.get('to')
    candidate = data.get('candidate')
    
    if to_user_id and candidate:
        print(f"Screen ICE candidate from {request.sid} to {to_user_id}")
        emit('screen-candidate', {
            'from': request.sid,
            'candidate': candidate
        }, to=to_user_id)

@socketio.on('stop-screen-share')
def handle_stop_screen_share(data):
    room_id = data.get('roomId')
    
    if room_id:
        print(f"User {request.sid} stopped sharing screen in meeting {room_id}")
        emit('stop-screen-share', {
            'userId': request.sid,
            'roomId': room_id
        }, to=room_id, skip_sid=request.sid)
        
        # Remove from screen sharers
        if screen_sharers.get(room_id) == request.sid:
            del screen_sharers[room_id]

@socketio.on('screen-sharing-status')
def handle_screen_sharing_status(data):
    room_id = data.get('roomId')
    is_sharing = data.get('isSharing')
    user_id = data.get('userId')
    
    # Forward the screen sharing status to all other users in the room
    emit('screen-sharing-status', {
        'isSharing': is_sharing,
        'userId': user_id
    }, to=room_id, skip_sid=request.sid)

@socketio.on('get-room-users')
def get_room_users(data):
    room_id = data.get('roomId')
    if room_id and room_id in rooms:
        # Return list of user IDs in the room
        users = [user['userId'] for user in rooms[room_id]]
        print(f"Users in meeting {room_id}: {users}")
        return users
    return []

@socketio.on('video-toggle')
def handle_video_toggle(data):
    user_id = data.get('userId')
    enabled = data.get('enabled')
    if user_id is None or enabled is None:
        return
    print(f"Broadcasting video-toggle: {user_id}, {enabled}")

    meeting_id = None
    for room_id, room_users in rooms.items():
        for user in room_users:
            
            if user['userId'] == user_id:
                meeting_id = room_id
                user['videoEnabled'] = enabled
                print(f"video state updated  {user} ")
                break
        if meeting_id:
            break
    
    print(f"video toogle data {data}")
    if meeting_id:
        emit('video-toggle', {'userId': user_id, 'enabled': enabled}, 
             to=meeting_id, skip_sid=request.sid)


@socketio.on('audio-toggle')
def handle_audio_toggle(data):
    user_id = data.get('userId')
    enabled = data.get('enabled')
    if user_id is None or enabled is None:
        return
    
    print(f"Broadcasting audio-toggle: {user_id}, {enabled}")
    
    # Find room this user is in
    meeting_id = None
    for room_id, room_users in rooms.items():
        for user in room_users:
            if user['userId'] == user_id:
                meeting_id = room_id
                user['micEnabled'] = enabled
                print("Audio state updated")
                break
        if meeting_id:
            break
    
    if meeting_id:
        emit('audio-toggle', {'userId': user_id, 'enabled': enabled}, 
             to=meeting_id, skip_sid=request.sid)

@socketio.on('end-meeting')
def handle_end_meeting(meeting_id):
    if meeting_id in rooms:
        # Notify all users in the room
        for user in rooms[meeting_id]:
            emit('meeting-ended', {'message': 'The meeting has ended.'}, to=user['userId'])
        
        # Clear the room
        del rooms[meeting_id]
        print(f"Room {meeting_id} has been ended and all users removed.")
        # print_room_state()

@socketio.on('leave-room')
def handle_leave_room(meeting_id):
    if meeting_id in rooms:
        # Find and remove the user
        user_index = -1
        for i, user in enumerate(rooms[meeting_id]):
            if user['userId'] == request.sid:
                user_index = i
                break
        
        if user_index != -1:
            user = rooms[meeting_id][user_index]
            rooms[meeting_id].pop(user_index)
            
            # Check if user created an agent and remove it
            if user.get('isAgentCreator'):
                rooms[meeting_id] = [u for u in rooms[meeting_id] 
                                    if u.get('agentCreatorId') != request.sid]
        
        # Leave the room
        leave_room(meeting_id)
        
        # Delete room if empty
        if not rooms[meeting_id]:
            del rooms[meeting_id]
            print(f"Room {meeting_id} is deleted because all users left.")
        else:
            # Notify other users in the room
            emit('user-disconnected', request.sid, to=meeting_id)
    
    print(f"{request.sid} left room {meeting_id}")
    # print_room_state()



@socketio.on('broadcast_transcripts')
def handle_broadcast_transcripts(data):
    """
    Handle incoming transcripts and broadcast to all participants in the meeting.
    """
    meeting_id = data.get('meetingId')
    transcripts = data.get('transcripts', [])
    
    # if not meeting_id or not transcripts:
    #     print("Invalid data received for broadcasting transcripts")
    #     return
    
    print(f"Broadcasting transcripts for meeting {meeting_id}: {transcripts}")
    
    # Store the transcripts in the history
    transcript_history.append({
        'meetingId': meeting_id,
        'transcripts': transcripts,
        'timestamp': datetime.datetime.now().isoformat()
    })
    
    # Broadcast to all users in the room
    if meeting_id in rooms:
        for user in rooms[meeting_id]:
            emit('transcripts_shared', {
                'meetingId': meeting_id,
                'transcripts': transcripts
            }, to=user['userId'])



@socketio.on('disconnect')
def handle_disconnect():
    print(f"User disconnected: {request.sid}")
    active_connections.discard(request.sid)
    
    # Check if the disconnected user was screen sharing in any room
    rooms_to_notify = []
    for room_id, sharer_id in list(screen_sharers.items()):
        if sharer_id == request.sid:
            print(f"Screen sharer {request.sid} disconnected from room {room_id}")
            rooms_to_notify.append(room_id)
            # Remove them from screen sharers
            del screen_sharers[room_id]
    
    # Remove user from all rooms they were part of
    for meeting_id in list(rooms.keys()):
        # Find and remove the user and their agent
        initial_count = len(rooms[meeting_id])
        rooms[meeting_id] = [user for user in rooms[meeting_id]
                             if user['userId'] != request.sid
                             and user.get('agentCreatorId') != request.sid]
                
        final_count = len(rooms[meeting_id])
        if initial_count != final_count:
            print(f"Removed user {request.sid} from room {meeting_id}. Users remaining: {final_count}")
            
            # Check if this room had screen sharing from the disconnected user
            if meeting_id in rooms_to_notify:
                # Notify other users that screen sharing has ended
                emit('screen-sharer-disconnected', {
                    'userId': request.sid,
                    'roomId': meeting_id
                }, to=meeting_id)
                
                # Also emit screen sharing status update
                emit('screen-sharing-status', {
                    'roomId': meeting_id,
                    'isSharing': False,
                    'userId': request.sid
                }, to=meeting_id)
                
                print(f"Notified room {meeting_id} that screen sharing ended due to user disconnect")
        
        # Delete room if empty
        if not rooms[meeting_id]:
            del rooms[meeting_id]
            # Also clean up screen sharers for this room if it exists
            if meeting_id in screen_sharers:
                del screen_sharers[meeting_id]
            print(f"Room {meeting_id} is deleted because all users left.")
        else:
            # Notify other users in the room about regular disconnect
            emit('user-disconnected', request.sid, to=meeting_id)
# add code for broadcasting activateAgent state to all users in the room
# Add this new socket handler to your backend

@socketio.on('agent-state-changed')
def handle_agent_state_change(data):
    """
    Handle agent state changes and broadcast to all participants in the meeting
    """
    try:
        meeting_id = data.get('meetingId')
        user_id = data.get('userId', request.sid)
        activate_agent = data.get('activateAgent', False)
        
        print(f"Agent state changed by user {user_id} in meeting {meeting_id}: {activate_agent}")
        
        # Validate meeting exists
        if meeting_id not in rooms:
            emit('error', {'message': 'Meeting does not exist'}, to=user_id)
            return
        
        # Verify user is in the meeting
        user_in_meeting = any(u['userId'] == user_id for u in rooms[meeting_id])
        if not user_in_meeting:
            emit('error', {'message': 'User not in meeting'}, to=user_id)
            return
        
        # Optional: Only allow admin to change agent state
        # Uncomment below if you want only admin control
        # admin_id = room_admins.get(meeting_id)
        # if user_id != admin_id:
        #     emit('error', {'message': 'Only admin can change agent state'}, to=user_id)
        #     return
        
        # Store the agent state for this meeting (optional)
        # You might want to add a meeting_agent_states dictionary
        if 'meeting_agent_states' not in globals():
            global meeting_agent_states
            meeting_agent_states = {}
        
        meeting_agent_states[meeting_id] = activate_agent
        
        # Broadcast to all participants in the meeting
        emit('agent-state-update', {
            # 'meetingId': meeting_id,
            'userId': user_id,
            'activateAgent': activate_agent,
            'timestamp': int(time.time() * 1000)
        }, to=meeting_id, skip_sid=request.sid)
        
        print(f"Agent state broadcasted to meeting {meeting_id}: {activate_agent}")
        
    except Exception as e:
        print(f"Error handling agent state change: {str(e)}")
        emit('error', {'message': f'Failed to update agent state: {str(e)}'}, to=request.sid)

# Optional: Add handler to get current agent state when joining
@socketio.on('get-agent-state')
def handle_get_agent_state(data):
    """
    Get current agent state for a meeting when user joins
    """
    try:
        meeting_id = data.get('meetingId')
        user_id = request.sid
        
        if meeting_id not in rooms:
            emit('error', {'message': 'Meeting does not exist'}, to=user_id)
            return
        
        # Get current agent state for the meeting
        current_state = meeting_agent_states.get(meeting_id, False)
        
        emit('agent-state-update', {
            # 'meetingId': meeting_id,
            'userId': 'system',
            'activateAgent': current_state,
            'timestamp': int(time.time() * 1000)
        }, to=user_id)
        
        print(f"Sent current agent state to user {user_id}: {current_state}")
        
    except Exception as e:
        print(f"Error getting agent state: {str(e)}")
        emit('error', {'message': f'Failed to get agent state: {str(e)}'}, to=request.sid)


# Relay agent speaking state to all other participants in the room
@socketio.on('agent-speaking')
def handle_agent_speaking(data):
    try:
        meeting_id = data.get('meetingId')
        agent_name = data.get('agentName', '')
        is_speaking = data.get('isSpeaking', False)

        if not meeting_id or meeting_id not in rooms:
            return

        emit('agent-speaking', {
            'agentName': agent_name,
            'isSpeaking': is_speaking,
        }, to=meeting_id, skip_sid=request.sid)

    except Exception as e:
        print(f"Error relaying agent-speaking: {str(e)}")


# LangGraph document agents — template sync, section generation, MVP/summary
@socketio.on('document_template')
def handle_document_template(data):
    """
    Handle document template creation and storage for hierarchical agent system.
    Accepts an optional 'previous_sections' dict ({section_id: content}) so that
    sections carried over from a prior meeting are pre-populated and marked as
    already discussed — agents will only fill brand-new empty sections.
    """
    print(f"Received document template creation request: {data}")
    user_id = data.get('user_id')
    meeting_id = data.get('meeting_id')
    template_document = data.get('template_document')
    previous_sections = data.get('previous_sections', {})
    
    if not meeting_id or not template_document:
        print("❌ Missing meeting_id or template_document")
        emit('document_template_error', {'error': 'Missing required data'})
        return
    
    try:
        # Save template; pass previous_sections so the backend pre-populates
        # content for old sections and focuses agents on new ones only.
        save_document_template(meeting_id, template_document, previous_sections)
        upsert_document_template_context(
            meeting_id,
            template_document,
            previous_sections=previous_sections,
            metadata={"user_id": user_id, "source": "socket_document_template"},
        )
        persist_runtime_snapshot(meeting_id, metadata={"source": "socket_document_template"})
        print(f"✅ Document template saved for meeting {meeting_id}")
        
        # Emit confirmation
        emit('document_template_saved', {
            'meeting_id': meeting_id,
            'success': True,
            'categories_count': len(template_document.get('categories', {})),
            'sections_count': len(template_document.get('sections', [])),
            'carried_over_sections': len([v for v in previous_sections.values() if v and str(v).strip()])
        })
        
    except Exception as e:
        print(f"❌ Error saving document template: {e}")
        emit('document_template_error', {'error': str(e)})


@socketio.on('process_mvpvision_transcripts')
def handle_mvpvision_transcripts(data):
    """
    Process meeting transcripts through agent pipeline for MVP + Vision generation.
    Called every 30s from frontend with new transcript chunk.
    Pipeline has memory — it builds cumulatively on previous rounds.
    """
    meeting_id = str(data.get("meetingId"))
    transcripts = data.get("transcripts", {})
    mvp_prompt = data.get("mvp_prompt", "")
    vision_prompt = data.get("vision_prompt", "")
    model = data.get("model", "gpt-5.4-2026-03-05")

    print(f"\n📥 Received transcripts for meeting: {meeting_id}")
    print(f"📝 MVP Prompt: {mvp_prompt[:80] if mvp_prompt else 'Using default'}...")
    print(f"📝 Vision Prompt: {vision_prompt[:80] if vision_prompt else 'Using default'}...")

    try:
        # Emit processing started — broadcast to all users in meeting (including remote)
        emit('mvpvision_status', {
            'meetingId': meeting_id,
            'status': 'processing'
        }, room=meeting_id)

        # Build state for the LangGraph pipeline
        pipeline_state = {
            "meeting_id": meeting_id,
            "transcripts": transcripts,
            "mvp_prompt": mvp_prompt,
            "vision_prompt": vision_prompt,
            "agent_config": {
                "model": model,
                "modelType": "reasoning"
            }
        }

        # Run the MVP+Vision pipeline — this handles memory internally
        result = mvpvision_graph.invoke(pipeline_state)

        status = result.get("status", "completed")
        mvp = result.get("mvp", "")
        vision = result.get("vision", "")
        processing_time = result.get("processing_time", 0)

        print(f"✅ Pipeline done | Status: {status} | Time: {processing_time}s")
        print(f"📊 MVP: {len(mvp)} chars | Vision: {len(vision)} chars")

        if status == "no_new_content":
            # No new relevant content — broadcast to all users in meeting
            emit('mvpvision_no_update', {
                'meetingId': meeting_id,
                'message': 'No new project-related content in this segment.',
                'processingTime': processing_time
            }, room=meeting_id)

        elif status == "failed":
            error = result.get("error", "Unknown error")
            print(f"❌ Pipeline failed: {error}")
            emit('mvpvision_error', {
                'meetingId': meeting_id,
                'error': error,
                'processingTime': processing_time
            }, room=meeting_id)

        else:
            # Success — broadcast MVP + Vision to all users in meeting (including remote)
            emit('mvpvision_update', {
                'meetingId': meeting_id,
                'mvp': mvp,
                'vision': vision,
                'status': status,
                'processingTime': processing_time
            }, room=meeting_id)

    except Exception as e:
        print(f"❌ Socket handler error for meeting {meeting_id}: {str(e)}")
        emit('mvpvision_error', {
            'meetingId': meeting_id,
            'error': str(e)
        }, room=meeting_id)


@socketio.on('reset_mvpvision')
def handle_reset_mvpvision(data):
    """
    Reset MVP/Vision memory for a specific meeting.
    Call this when a new meeting starts or user clicks 'Reset'.
    """
    meeting_id = str(data.get("meetingId"))
    reset_mvpvision_storage(meeting_id)
    emit('mvpvision_reset', {
        'meetingId': meeting_id,
        'message': f'MVP/Vision memory cleared for meeting {meeting_id}'
    }, room=meeting_id)
    print(f"🔄 Reset MVP/Vision for meeting: {meeting_id}")

@socketio.on('process_document_transcripts')
def handle_document_transcripts(data):
    """
    Process meeting transcripts through hierarchical agent system for document generation
    """
    meeting_id = str(data.get("meetingId"))
    transcripts = data.get("transcripts", {})
    document_template = (
        data.get("documentTemplate")
        or data.get("document_template")
        or data.get("template_document")
    )
    previous_sections = (
        data.get("previousSections")
        or data.get("previous_sections")
        or data.get("generatedSections")
        or data.get("generated_sections")
        or {}
    )
    if not isinstance(previous_sections, dict):
        previous_sections = {}
    
    print(f"📥 Received document transcripts for meeting {meeting_id}")
    print(
        "📚 Previous document context received: "
        f"{len([v for v in previous_sections.values() if v and str(v).strip()])} filled sections"
    )
    
    if not meeting_id:
        emit('document_generation_error', {'error': 'Missing meeting_id'})
        return
    
    try:
        # Keep the latest template + previous document context durable before
        # hydrating, because a new meeting's in-memory runtime can be empty.
        if document_template or previous_sections:
            upsert_document_template_context(
                meeting_id,
                document_template,
                previous_sections=previous_sections,
                metadata={"source": "process_document_transcripts"},
            )

        # Restore durable context first, then process through the A2A-aware orchestrator.
        hydrate_hierarchy_runtime(meeting_id)
        result = process_document_transcripts_with_orchestrator(
            meeting_id,
            transcripts,
            document_template=document_template,
            previous_sections=previous_sections,
        )
        
        # DEBUG: Print the full result to see what's returned
        print(f"🔎 LANGRAPH RESULT: should_send_questions={result.get('should_send_questions')}, questions_count={len(result.get('questions_for_users', []))}")
        
        if result.get("success"):
            payload = {
                'meeting_id': meeting_id,
                'generated_sections': result.get('generated_sections', {}),
                'undiscussed_topics': result.get('undiscussed_topics', []),
                'meeting_phase': result.get('meeting_phase', 'ongoing'),
                'discussion_progress': result.get('discussion_progress', 0)
            }
            # Emit generated sections to all users in the meeting.
            socketio.emit('document_sections_update', payload, room=meeting_id)

            
            # SMART TIMING: Only send questions when supervisor agent decides it's time
            # This happens when: meeting is ending OR 60%+ topics discussed (one-time only)
            print(f"🔍 Checking question conditions: should_send={result.get('should_send_questions')}, questions={len(result.get('questions_for_users', []))}")
            
            if result.get('should_send_questions') and result.get('questions_for_users'):
                questions_data = {
                    'meeting_id': meeting_id,
                    'questions': result.get('questions_for_users', []),
                    'undiscussed_topics': result.get('undiscussed_topics', []),
                    'auto_activate_agent': True  # Flag to auto-activate the realtime agent
                }
                print(f"📤 EMITTING ask_undiscussed_questions to room: {meeting_id}")
                print(f"   Data: {questions_data}")

                # Keep question prompts scoped to the meeting room to avoid cross-meeting leakage.
                socketio.emit('ask_undiscussed_questions', questions_data, room=meeting_id)

                print(f"✅ EMIT COMPLETE - sent to meeting room")
                print(f"🎯 SMART TIMING: Sent {len(result.get('questions_for_users', []))} questions to realtime agent")
                print(f"   Progress: {result.get('discussion_progress', 0):.1f}%")
            else:
                print(f"ℹ️ Questions not sent: should_send={result.get('should_send_questions')}, has_questions={bool(result.get('questions_for_users'))}")
            
            print(f"✅ Document generation complete for meeting {meeting_id}")
            print(f"📊 Generated {len(result.get('generated_sections', {}))} sections")
            print(f"📈 Discussion progress: {result.get('discussion_progress', 0):.1f}%")
        else:
            emit('document_generation_error', {
                'meeting_id': meeting_id,
                'error': result.get('error', 'Unknown error')
            })
            
    except Exception as e:
        print(f"❌ Error processing document transcripts: {e}")
        emit('document_generation_error', {
            'meeting_id': meeting_id,
            'error': str(e)
        })


@socketio.on('get_document_status')
def handle_get_document_status(data):
    """
    Get current document generation status for a meeting
    """
    meeting_id = str(data.get("meetingId"))
    
    if not meeting_id:
        emit('document_status_error', {'error': 'Missing meeting_id'})
        return
    
    try:
        hydrate_hierarchy_runtime(meeting_id)
        status = get_meeting_document_status(meeting_id)
        emit('document_status', status)
    except Exception as e:
        emit('document_status_error', {'error': str(e)})


@socketio.on('broadcast_document_data')
def handle_broadcast_document_data(data):
    """
    Broadcast document data to all users in the meeting
    """
    meeting_id = str(data.get("meetingId"))
    
    print(f"📡 Broadcasting document data to all users in meeting {meeting_id}")
    
    # Broadcast to entire meeting room
    emit('broadcasted_document_data', {
        'meeting_id': meeting_id,
        'documentTemplate': data.get('documentTemplate'),
        'generatedSections': data.get('generatedSections'),
        'undiscussedTopics': data.get('undiscussedTopics'),
        'meetingPhase': data.get('meetingPhase'),
        'discussionProgress': data.get('discussionProgress'),
        'projectName': data.get('projectName'),
        'updatedSection': data.get('updatedSection'),
    }, room=meeting_id)
    
    print(f"✅ Document data broadcasted to room {meeting_id}")

@socketio.on('force_meeting_end')
def handle_force_meeting_end(data):
    """
    Force meeting to ending phase and get questions for undiscussed topics
    This is an explicit user action, so we always send questions if available
    """
    from python_files.langraph_agents_hierarchy import mark_questions_sent
    
    meeting_id = str(data.get("meetingId"))
    
    if not meeting_id:
        emit('force_end_error', {'error': 'Missing meeting_id'})
        return
    
    try:
        hydrate_hierarchy_runtime(meeting_id)
        result = force_end_meeting(meeting_id)
        
        # Force end = explicit user action, send questions if available
        if result.get('questions_for_users'):
            emit('ask_undiscussed_questions', {
                'meeting_id': meeting_id,
                'questions': result.get('questions_for_users', []),
                'undiscussed_topics': result.get('undiscussed_topics', []),
                'auto_activate_agent': True  # Auto-activate the realtime agent
            }, room=meeting_id)
            
            # Mark as sent so auto-detection doesn't re-send
            mark_questions_sent(meeting_id)
            persist_runtime_snapshot(meeting_id, metadata={"source": "force_meeting_end"})
            print(f"🎯 Force end: Sent {len(result.get('questions_for_users', []))} questions")
        
        emit('meeting_end_processed', result, room=meeting_id)
        print(f"🏁 Meeting {meeting_id} forced to ending phase")
        
    except Exception as e:
        emit('force_end_error', {'error': str(e)})


@socketio.on('reset_document_session')
def handle_reset_document_session(data):
    """
    Reset document generation session for a meeting
    """
    meeting_id = str(data.get("meetingId"))
    
    if not meeting_id:
        return
    
    try:
        reset_meeting_document_storage(meeting_id)
        reset_document_session(meeting_id)
        emit('document_session_reset', {'meeting_id': meeting_id, 'success': True})
    except Exception as e:
        emit('document_session_reset_error', {'error': str(e)})


# ================== SUMMARY GENERATION HANDLERS ==================
@socketio.on('process_summary_transcripts')
def handle_summary_transcripts(data):
    """
    Process meeting transcripts to generate incremental high-level summary
    Sends only NEW summary chunks to be appended on frontend
    """
    meeting_id = str(data.get("meetingId"))
    transcripts = data.get("transcripts", {})
    
    print(f"📥 Received summary transcripts for meeting {meeting_id}")
    
    if not meeting_id:
        emit('summary_generation_error', {'error': 'Missing meeting_id'})
        return
    
    try:
        # Call summary agent - returns only new delta
        summary_result = process_summary_transcripts(meeting_id, transcripts)
        
        summary_delta = summary_result.get('summary_delta', '')
        
        # Only emit if there's new content
        if summary_delta:
            emit('meeting_summary_delta', {
                'meeting_id': meeting_id,
                'summary_delta': summary_delta,
                'timestamp': time.time()
            }, room=meeting_id)
            
            print(f"✅ Summary delta sent for meeting {meeting_id}: {len(summary_delta)} chars")
        else:
            print(f"ℹ️ No new summary content for meeting {meeting_id}")
        
    except Exception as e:
        print(f"❌ Error processing summary transcripts: {e}")
        emit('summary_generation_error', {
            'meeting_id': meeting_id,
            'error': str(e)
        })


@socketio.on('reset_summary_session')
def handle_reset_summary_session(data):
    """
    Reset summary generation session for a meeting
    """
    meeting_id = str(data.get("meetingId"))
    
    if not meeting_id:
        return
    
    try:
        reset_summary_storage(meeting_id)
        emit('summary_session_reset', {'meeting_id': meeting_id, 'success': True})
        print(f"🔄 Summary storage reset for meeting {meeting_id}")
    except Exception as e:
        emit('summary_session_reset_error', {'error': str(e)})


@socketio.on('broadcast_summary_data')
def handle_broadcast_summary_data(data):
    """
    Broadcast meeting summary to all users in the meeting
    """
    meeting_id = str(data.get("meetingId"))
    
    print(f"📡 Broadcasting summary data to all users in meeting {meeting_id}")
    
    # Broadcast to entire meeting room
    emit('broadcasted_summary_data', {
        'meeting_id': meeting_id,
        'summaryContent': data.get('summaryContent'),
        'projectName': data.get('projectName'),
        'timestamp': data.get('timestamp')
    }, room=meeting_id)
    
    print(f"✅ Summary data broadcasted to room {meeting_id}")


@socketio.on('broadcast_mvpvision_data')
def handle_broadcast_mvpvision_data(data):
    """
    Broadcast MVP + Vision to all users in the meeting (same pattern as document/summary).
    Called by host when mvpvision_update is received, so remote users get the data.
    """
    meeting_id = str(data.get("meetingId"))
    
    print(f"📡 Broadcasting MVP+Vision data to all users in meeting {meeting_id}")
    
    emit('broadcasted_mvpvision_data', {
        'meetingId': meeting_id,
        'mvp': data.get('mvp', ''),
        'vision': data.get('vision', ''),
        'projectName': data.get('projectName'),
        'timestamp': data.get('timestamp')
    }, room=meeting_id)
    
    print(f"✅ MVP+Vision data broadcasted to room {meeting_id}")


@socketio.on('save_generated_content')
def handle_save_generated_content(data):
    """
    Save agent-generated content directly to a document section.
    The realtime agent generates the content itself, so no backend LLM processing needed.
    This is much faster than processing raw answers through the backend.
    """
    from python_files.langraph_agents_hierarchy import (
        update_generated_section, 
        get_generated_sections, 
        get_undiscussed_topics,
        get_discussion_progress,
        get_section_for_topic
    )
    
    meeting_id = str(data.get("meetingId"))
    section_id = data.get("sectionId")
    section_title = data.get("sectionTitle", "")
    generated_content = data.get("generatedContent", "")
    user_raw_answer = data.get("userRawAnswer", "")  # For reference/backup
    
    print(f"\n📥 Saving agent-generated content")
    print(f"   Meeting: {meeting_id}")
    print(f"   Section ID: {section_id}")
    print(f"   Section Title: {section_title}")
    print(f"   Content length: {len(generated_content)} chars")
    
    if not meeting_id:
        emit('user_answer_error', {'error': 'Missing meeting_id'})
        return
    
    if not generated_content or not generated_content.strip():
        emit('user_answer_error', {'error': 'Empty content'})
        return
    
    try:
        hydrate_hierarchy_runtime(meeting_id)
        # If section_id not provided, try to match by section_title
        if not section_id and section_title:
            matched_section = get_section_for_topic(meeting_id, section_title)
            if matched_section:
                section_id = matched_section['section_id']
                print(f"   ✅ Matched title to section: {section_id}")
        
        if not section_id:
            # Use section_title as fallback ID
            section_id = section_title.lower().replace(" ", "_") if section_title else "unknown"
            print(f"   ⚠️ Using generated section_id: {section_id}")
        
        # Save the content directly (no LLM processing needed!)
        update_generated_section(meeting_id, section_id, generated_content, replace=True)
        persist_runtime_snapshot(meeting_id, metadata={"source": "save_generated_content"})
        
        # Get updated state
        all_sections = get_generated_sections(meeting_id)
        undiscussed = get_undiscussed_topics(meeting_id)
        progress = get_discussion_progress(meeting_id)
        
        print(f"✅ Content saved directly for section: {section_id}")
        print(f"📊 New progress: {progress:.1f}%")
        
        # Emit updated sections to all users in the meeting
        emit('document_sections_update', {
            'meeting_id': meeting_id,
            'generated_sections': all_sections,
            'undiscussed_topics': undiscussed,
            'discussion_progress': progress,
            'updated_section': {
                'section_id': section_id,
                'section_title': section_title,
                'content': generated_content
            }
        })
        
        # Also broadcast to the room
        socketio.emit('document_sections_update', {
            'meeting_id': meeting_id,
            'generated_sections': all_sections,
            'undiscussed_topics': undiscussed,
            'discussion_progress': progress,
            'updated_section': {
                'section_id': section_id,
                'section_title': section_title,
                'content': generated_content
            }
        }, room=meeting_id)
            
    except Exception as e:
        print(f"❌ Error saving content: {e}")
        import traceback
        traceback.print_exc()
        emit('user_answer_error', {
            'meeting_id': meeting_id,
            'error': str(e)
        })


@socketio.on('process_user_answer')
def handle_process_user_answer(data):
    """
    Process a user's answer to an undiscussed question and add it to the document section.
    This is called when the realtime agent asks about undiscussed topics and the user responds.
    NOTE: This is the SLOWER path - prefer using save_generated_content where agent generates content directly.
    """
    from python_files.langraph_agents_hierarchy import process_user_answer_for_section, get_section_for_topic
    
    meeting_id = str(data.get("meetingId"))
    section_id = data.get("sectionId")
    section_title = data.get("sectionTitle", "")
    user_answer = data.get("userAnswer", "")
    topic_text = data.get("topicText", "")  # If section_id not known, we can match by topic
    
    print(f"\n📥 Received user answer for document section (backend processing)")
    print(f"   Meeting: {meeting_id}")
    print(f"   Section ID: {section_id}")
    print(f"   Section Title: {section_title}")
    print(f"   Answer length: {len(user_answer)} chars")
    
    if not meeting_id:
        emit('user_answer_error', {'error': 'Missing meeting_id'})
        return
    
    if not user_answer or not user_answer.strip():
        emit('user_answer_error', {'error': 'Empty user answer'})
        return
    
    try:
        hydrate_hierarchy_runtime(meeting_id)
        # If section_id not provided, try to match by topic text
        if not section_id and topic_text:
            matched_section = get_section_for_topic(meeting_id, topic_text)
            if matched_section:
                section_id = matched_section['section_id']
                section_title = matched_section['section_title']
                print(f"   ✅ Matched topic to section: {section_id} ({section_title})")
            else:
                emit('user_answer_error', {
                    'error': 'Could not match topic to any document section'
                })
                return
        
        if not section_id:
            emit('user_answer_error', {'error': 'Missing section_id and could not infer from topic'})
            return
        
        # Process the user's answer (uses backend LLM - slower)
        result = process_user_answer_for_section(
            meeting_id=meeting_id,
            section_id=section_id,
            user_answer=user_answer,
            section_title=section_title
        )
        
        if result.get("success"):
            persist_runtime_snapshot(meeting_id, metadata={"source": "process_user_answer"})
            # Emit updated sections to all users in the meeting
            emit('document_sections_update', {
                'meeting_id': meeting_id,
                'generated_sections': result.get('all_sections', {}),
                'undiscussed_topics': result.get('remaining_undiscussed', []),
                'discussion_progress': result.get('discussion_progress', 0),
                'updated_section': {
                    'section_id': section_id,
                    'section_title': result.get('section_title', ''),
                    'content': result.get('generated_content', '')
                }
            })
            
            # Also broadcast to the room
            socketio.emit('document_sections_update', {
                'meeting_id': meeting_id,
                'generated_sections': result.get('all_sections', {}),
                'undiscussed_topics': result.get('remaining_undiscussed', []),
                'discussion_progress': result.get('discussion_progress', 0),
                'updated_section': {
                    'section_id': section_id,
                    'section_title': result.get('section_title', ''),
                    'content': result.get('generated_content', '')
                }
            }, room=meeting_id)
            
            print(f"✅ User answer processed and section updated: {section_id}")
            print(f"📊 New progress: {result.get('discussion_progress', 0):.1f}%")
        else:
            emit('user_answer_error', {
                'meeting_id': meeting_id,
                'error': result.get('error', 'Unknown error processing answer')
            })
            
    except Exception as e:
        print(f"❌ Error processing user answer: {e}")
        import traceback
        traceback.print_exc()
        emit('user_answer_error', {
            'meeting_id': meeting_id,
            'error': str(e)
        })


@socketio.on('process_multiple_answers')
def handle_process_multiple_answers(data):
    """
    Process multiple user answers at once.
    Useful when the agent has collected answers for several topics.
    """
    from python_files.langraph_agents_hierarchy import process_multiple_answers
    
    meeting_id = str(data.get("meetingId"))
    answers = data.get("answers", [])  # List of {section_id, user_answer, section_title}
    
    print(f"\n📥 Received {len(answers)} user answers for meeting {meeting_id}")
    
    if not meeting_id:
        emit('user_answer_error', {'error': 'Missing meeting_id'})
        return
    
    if not answers:
        emit('user_answer_error', {'error': 'No answers provided'})
        return
    
    try:
        hydrate_hierarchy_runtime(meeting_id)
        result = process_multiple_answers(meeting_id, answers)
        
        if result.get("success"):
            persist_runtime_snapshot(meeting_id, metadata={"source": "process_multiple_answers"})
            # Emit updated sections
            emit('document_sections_update', {
                'meeting_id': meeting_id,
                'generated_sections': result.get('generated_sections', {}),
                'undiscussed_topics': result.get('undiscussed_topics', []),
                'discussion_progress': result.get('discussion_progress', 0),
                'processed_count': result.get('processed_count', 0)
            })
            
            # Also broadcast to room
            socketio.emit('document_sections_update', {
                'meeting_id': meeting_id,
                'generated_sections': result.get('generated_sections', {}),
                'undiscussed_topics': result.get('undiscussed_topics', []),
                'discussion_progress': result.get('discussion_progress', 0),
                'processed_count': result.get('processed_count', 0)
            }, room=meeting_id)
            
            print(f"✅ Processed {result.get('processed_count', 0)} answers successfully")
        else:
            emit('user_answer_error', {
                'meeting_id': meeting_id,
                'error': 'Failed to process answers'
            })
            
    except Exception as e:
        print(f"❌ Error processing multiple answers: {e}")
        emit('user_answer_error', {
            'meeting_id': meeting_id,
            'error': str(e)
        })


# ---------------------------------------------------------------------------
# REST — WebRTC ICE servers
# ---------------------------------------------------------------------------

@app.route('/api/webrtc/config', methods=['GET'])
def webrtc_config():
    ice_config = {
        "iceServers": [
            # STUN servers
            {"urls": "stun:stun.l.google.com:19302"},
            {"urls": "stun:stun1.l.google.com:19302"},
            {"urls": "stun:stun2.l.google.com:19302"},

            # TURN servers
            {
                "urls": "turn:relay1.expressturn.com:80",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay1.expressturn.com:443",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay1.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay2.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay3.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay4.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay5.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay6.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay7.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay8.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay9.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:relay10.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
            {
                "urls": "turn:global.expressturn.com:3478",
                "username": os.environ.get("TURN_USERNAME"),
                "credential": os.environ.get("TURN_CREDENTIAL"),
            },
        ],
        "iceCandidatePoolSize": 10,
    }

    return jsonify(ice_config)




# ---------------------------------------------------------------------------
# REST — projects, documents, summaries, transcripts (handlers in python_files/)
# ---------------------------------------------------------------------------

app.add_url_rule('/leaveCall', view_func=leave_call, methods=['POST'])
app.add_url_rule('/projects', view_func=fetch_projects, methods=['GET'])

app.add_url_rule('/create-project', view_func=creating_project, methods=['POST'])
app.add_url_rule('/delete-project/<project_id>', view_func=delete_project, methods=['DELETE'])
app.add_url_rule('/update-project/<project_id>', view_func=update_project, methods=['PUT'])





# Register document routes
app.add_url_rule('/save-generated-document', view_func=save_generated_document, methods=['POST'])
app.add_url_rule('/get-generated-documents/<meeting_id>', view_func=get_generated_documents, methods=['GET'])
app.add_url_rule('/get-generated-document/<document_id>', view_func=get_document_by_id, methods=['GET'])
app.add_url_rule('/get-documents-by-project/<project_id>', view_func=get_documents_by_project, methods=['GET'])
app.add_url_rule('/delete-generated-document/<document_id>', view_func=delete_generated_document, methods=['DELETE'])
app.add_url_rule('/update-generated-document/<document_id>', view_func=update_generated_document, methods=['PUT'])
app.add_url_rule('/import-transcript-generate-document', view_func=import_transcript_and_generate_document, methods=['POST'])
app.add_url_rule('/import-pregenerated-document', view_func=import_pregenerated_document, methods=['POST'])
app.add_url_rule('/import-multi-source-document', view_func=import_multi_source_document, methods=['POST'])

# Register summary routes
app.add_url_rule('/save-meeting-summary', view_func=save_meeting_summary, methods=['POST'])
app.add_url_rule('/get-meeting-summaries/<meeting_id>', view_func=get_meeting_summaries, methods=['GET'])
app.add_url_rule('/get-summaries-by-project/<project_id>', view_func=get_summaries_by_project, methods=['GET'])
app.add_url_rule('/delete-meeting-summary/<summary_id>', view_func=delete_meeting_summary, methods=['DELETE'])
app.add_url_rule('/update-meeting-summary/<summary_id>', view_func=update_meeting_summary, methods=['PUT'])
app.add_url_rule('/get-summary/<summary_id>', view_func=get_summary, methods=['GET'])

# Register MVP+Vision routes
app.add_url_rule('/save-meeting-mvpvision', view_func=save_meeting_mvpvision, methods=['POST'])
app.add_url_rule('/get-mvpvision-by-project/<project_id>', view_func=get_mvpvision_by_project, methods=['GET'])
app.add_url_rule('/update-meeting-mvpvision/<mvpvision_id>', view_func=update_meeting_mvpvision, methods=['PUT'])

# Register meeting transcript + history routes
app.add_url_rule('/save-meeting-transcript', view_func=save_meeting_transcript, methods=['POST'])
app.add_url_rule('/get-meeting-transcript/<meeting_id>', view_func=get_meeting_transcript_by_id, methods=['GET'])
app.add_url_rule('/get-project-meeting-history/<project_id>', view_func=get_project_meeting_history, methods=['GET'])
app.add_url_rule(
    '/get-project-meeting-history/notion/<project_id>',
    view_func=get_project_notion_meeting_history,
    methods=['GET'],
)
app.add_url_rule(
    '/get-project-meeting-history/google-drive/<project_id>',
    view_func=get_project_google_drive_meeting_history,
    methods=['GET'],
)
app.add_url_rule(
    '/delete-project-meeting/<project_id>/<meeting_id>',
    view_func=delete_project_meeting,
    methods=['DELETE'],
)


# ---------------------------------------------------------------------------
# REST — MCP connectors (Notion, Google Drive), OAuth, tool execution
# ---------------------------------------------------------------------------

@app.route('/sendmcpmessage', methods=['POST'])
def send_mcp_message():
    """Endpoint for project-scoped MCP agent tasks."""
    try:
        data = request.get_json() or {}
        task = data.get("task")

        if task in {"drive_save_document", "drive_export"}:
            project_id = str(data.get("project_id") or data.get("projectId") or "")
            user_id = str(
                data.get("user_id")
                or data.get("userId")
                or data.get("user", {}).get("id")
                or ""
            )
            project_name = str(data.get("project_name") or data.get("projectName") or "")
            document_payload = data.get("document") or data.get("payload") or {}

            if document_payload:
                print(f"Drive REST document save task for project={project_id}")
                result = save_project_document_to_drive(
                    project_id=project_id,
                    user_id=user_id,
                    project_name=project_name,
                    document_payload=document_payload,
                )
                return jsonify({
                    "success": True,
                    "message": "Drive document save completed successfully.",
                    "document": result,
                    "response": result.get("message") or "Document saved to Google Drive.",
                }), 200

            export_format = str(data.get("format") or "pdf")
            title = str(
                data.get("title")
                or data.get("fileName")
                or data.get("file_name")
                or "Meeting Document"
            )

            print(f"Drive export agent task for project={project_id}, format={export_format}")
            response = run_async(
                export_meeting_document_via_agent(
                    project_id=project_id,
                    user_id=user_id,
                    export_format=export_format,
                    title=title,
                    pdf_base64=data.get("pdfBase64") or data.get("pdf_base64"),
                    text_content=data.get("textContent") or data.get("text_content"),
                    html_content=data.get("htmlContent") or data.get("html_content"),
                )
            )
            return jsonify({
                "success": True,
                "message": "Drive export completed successfully.",
                "response": response,
            }), 200

        if task == "drive_retrieve_document":
            project_id = str(data.get("project_id") or data.get("projectId") or "")
            user_id = str(
                data.get("user_id")
                or data.get("userId")
                or data.get("user", {}).get("id")
                or ""
            )
            project_name = str(data.get("project_name") or data.get("projectName") or "")
            meeting_id = str(data.get("meeting_id") or data.get("meetingId") or "").strip()

            if project_name:
                print(f"Drive REST document retrieve task for project={project_id}")
                if meeting_id:
                    document = retrieve_meeting_document_from_drive(
                        project_id=project_id,
                        user_id=user_id,
                        project_name=project_name,
                        meeting_id=meeting_id,
                    )
                else:
                    document = retrieve_project_document_from_drive(
                        project_id=project_id,
                        user_id=user_id,
                        project_name=project_name,
                    )
                return jsonify({
                    "success": True,
                    "message": "Drive retrieval completed successfully.",
                    "document": document,
                }), 200

            print(f"Drive retrieve agent task for project={project_id}")
            document = run_async(
                retrieve_meeting_document_via_agent(
                    project_id=project_id,
                    user_id=user_id,
                )
            )
            return jsonify({
                "success": True,
                "message": "Drive retrieval completed successfully.",
                "document": document,
            }), 200

        if task == "notion_save_document":
            project_id = str(data.get("project_id") or data.get("projectId") or "")
            user_id = str(
                data.get("user_id")
                or data.get("userId")
                or data.get("user", {}).get("id")
                or ""
            )
            project_name = str(data.get("project_name") or data.get("projectName") or "")
            document_payload = data.get("document") or data.get("payload") or {}

            print(f"Notion REST document save task for project={project_id}")
            result = save_project_document_to_notion(
                project_id=project_id,
                user_id=user_id,
                project_name=project_name,
                document_payload=document_payload,
            )
            return jsonify({
                "success": True,
                "message": "Notion document save completed successfully.",
                "document": result,
                "response": result.get("message") or "Document saved to Notion.",
            }), 200

        if task == "notion_retrieve_document":
            project_id = str(data.get("project_id") or data.get("projectId") or "")
            user_id = str(
                data.get("user_id")
                or data.get("userId")
                or data.get("user", {}).get("id")
                or ""
            )
            project_name = str(data.get("project_name") or data.get("projectName") or "")
            meeting_id = str(data.get("meeting_id") or data.get("meetingId") or "").strip()

            print(f"Notion REST document retrieve task for project={project_id}")
            document = retrieve_project_document_from_notion(
                project_id=project_id,
                user_id=user_id,
                project_name=project_name,
                meeting_id=meeting_id or None,
            )
            return jsonify({
                "success": True,
                "message": "Notion retrieval completed successfully.",
                "document": document,
            }), 200

        return jsonify({
            "success": False,
            "error": "Unsupported MCP task."
        }), 400

    except ProjectMCPChatAgentError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except GoogleDriveDocumentError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except NotionDocumentError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except ProjectMCPError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        print(f"Error processing MCP message: {str(e)}")
        return jsonify({
            'error': 'Failed to process MCP message.',
            'details': str(e)
        }), 500
    
# ============== PROJECT-SCOPED MCP ROUTES ==============
@app.route("/mcp/tools", methods=["GET"])
def list_tools_route():
    project_id = request.args.get("project_id")
    user_id = request.args.get("user_id")

    try:
        if not project_id:
            return jsonify({"success": True, "tools": available_connectors()})

        tools = list_project_mcp_tools(project_id=project_id, user_id=user_id)
        return jsonify({
            "success": True,
            "provider": "project",
            "configured": bool(tools),
            "tools": tools,
        })
    except ProjectMCPError as e:
        return jsonify({"success": False, "tools": [], "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "tools": [], "error": str(e)}), 500


@app.route("/mcp/configure", methods=["POST"])
def configure_tools():
    try:
        payload = request.get_json() or {}
        project_id = payload.get("project_id")
        user_id = payload.get("user_id") or payload.get("user", {}).get("id")
        configurations = payload.get("configurations") or payload.get("configuration") or {}
        provider_results = {}

        github_config = configurations.get("github") or payload.get("github")
        if github_config is not None:
            provider_results["github"] = save_project_github_config(
                project_id=str(project_id or ""),
                user_id=str(user_id or ""),
                raw_config=github_config,
            ).get("configuration")

        notion_config = configurations.get("notion") or payload.get("notion")
        if notion_config is not None:
            provider_results["notion"] = save_project_notion_config(
                project_id=str(project_id or ""),
                user_id=str(user_id or ""),
                raw_config=notion_config,
            ).get("configuration")

        if not provider_results:
            raise ProjectMCPError("No supported MCP provider configuration was provided.")

        return jsonify({"success": True, "configurations": provider_results})
    except ProjectMCPError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/mcp/oauth/notion/start", methods=["POST"])
def start_notion_oauth_route():
    try:
        payload = request.get_json() or {}
        project_id = payload.get("project_id")
        user_id = payload.get("user_id") or payload.get("user", {}).get("id")
        workspace_name = payload.get("workspaceName") or payload.get("workspace_name") or ""
        redirect_uri = payload.get("redirect_uri") or f"{request.host_url.rstrip('/')}/mcp/oauth/notion/callback"
        return jsonify(
            start_notion_oauth(
                project_id=str(project_id or ""),
                user_id=str(user_id or ""),
                workspace_name=str(workspace_name or ""),
                redirect_uri=redirect_uri,
            )
        )
    except ProjectMCPError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/mcp/oauth/notion/callback", methods=["GET"])
def complete_notion_oauth_route():
    try:
        error = request.args.get("error")
        if error:
            description = request.args.get("error_description") or ""
            raise ProjectMCPError(f"Notion OAuth error: {error} {description}".strip())

        result = complete_notion_oauth(
            code=request.args.get("code", ""),
            state=request.args.get("state", ""),
        )
        if request.args.get("json") == "1":
            return jsonify(result)
        return """
        <html>
          <body style="font-family: Arial, sans-serif; padding: 32px; text-align: center;">
            <h2>Notion MCP connected</h2>
            <p>You can close this tab and return to MARARE.</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: "notion-mcp-connected" }, "*");
              }
              setTimeout(() => window.close(), 1200);
            </script>
          </body>
        </html>
        """
    except ProjectMCPError as e:
        if request.args.get("json") == "1":
            return jsonify({"success": False, "error": str(e)}), 400
        return f"""
        <html>
          <body style="font-family: Arial, sans-serif; padding: 32px; text-align: center;">
            <h2>Notion MCP connection failed</h2>
            <p>{str(e)}</p>
          </body>
        </html>
        """, 400
    except Exception as e:
        if request.args.get("json") == "1":
            return jsonify({"success": False, "error": str(e)}), 500
        return f"""
        <html>
          <body style="font-family: Arial, sans-serif; padding: 32px; text-align: center;">
            <h2>Notion MCP connection failed</h2>
            <p>{str(e)}</p>
          </body>
        </html>
        """, 500


@app.route("/mcp/oauth/google-drive/start", methods=["POST"])
def start_google_drive_oauth_route():
    try:
        payload = request.get_json() or {}
        project_id = payload.get("project_id")
        user_id = payload.get("user_id") or payload.get("user", {}).get("id")
        account_label = payload.get("accountLabel") or payload.get("account_label") or ""
        redirect_uri = payload.get("redirect_uri") or f"{request.host_url.rstrip('/')}/mcp/oauth/google-drive/callback"
        return jsonify(
            start_google_drive_oauth(
                project_id=str(project_id or ""),
                user_id=str(user_id or ""),
                account_label=str(account_label or ""),
                redirect_uri=redirect_uri,
            )
        )
    except ProjectMCPError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/mcp/document-storage-preference", methods=["POST"])
def update_document_storage_preference_route():
    try:
        payload = request.get_json() or {}
        project_id = str(payload.get("project_id") or payload.get("projectId") or "")
        user_id = str(payload.get("user_id") or payload.get("userId") or payload.get("user", {}).get("id") or "")
        preference = str(payload.get("preference") or payload.get("documentStoragePreference") or "")
        status = update_document_storage_preference(project_id, user_id, preference)
        return jsonify({"success": True, "documentStorage": status})
    except ProjectMCPError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/migration/link-user", methods=["POST"])
def link_migrated_user_route():
    try:
        from python_files.user_migration import UserMigrationError, link_user_data_by_email

        payload = request.get_json() or {}
        email = str(payload.get("email") or "").strip()
        user_id = str(payload.get("user_id") or payload.get("userId") or "").strip()
        if not email or not user_id:
            return jsonify({"success": False, "error": "email and user_id are required."}), 400

        result = link_user_data_by_email(email=email, new_user_id=user_id, verify=True)
        return jsonify({"success": True, **result})
    except UserMigrationError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/mcp/notion/meeting-storage", methods=["POST"])
def update_notion_meeting_storage_route():
    try:
        payload = request.get_json() or {}
        project_id = payload.get("project_id")
        user_id = payload.get("user_id") or payload.get("user", {}).get("id")
        store_in_notion = bool(payload.get("storeMeetingDataInNotion"))
        project_name = payload.get("projectName") or payload.get("project_name") or ""
        configuration = update_notion_meeting_storage_settings(
            project_id=str(project_id or ""),
            user_id=str(user_id or ""),
            store_meeting_data_in_notion=store_in_notion,
            project_name=str(project_name),
        )
        configuration["storeMeetingDataInNotion"] = configuration.get("notionExportEnabled", store_in_notion)
        return jsonify({"success": True, "configuration": configuration})
    except (ProjectMCPError, MeetingStorageError) as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/mcp/notion/export-document", methods=["POST"])
def export_document_to_notion_route():
    try:
        payload = request.get_json() or {}
        project_id = str(payload.get("project_id") or payload.get("projectId") or "")
        user_id = str(payload.get("user_id") or payload.get("userId") or payload.get("user", {}).get("id") or "")
        document = payload.get("document") or payload
        project_name = str(payload.get("projectName") or payload.get("project_name") or "")
        result = export_document_to_notion(
            project_id=project_id,
            user_id=user_id,
            document=document,
            project_name=project_name,
        )
        return jsonify(result)
    except (ProjectMCPError, MeetingStorageError) as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/mcp/oauth/google-drive/callback", methods=["GET"])
def complete_google_drive_oauth_route():
    try:
        error = request.args.get("error")
        if error:
            description = request.args.get("error_description") or ""
            raise ProjectMCPError(f"Google Drive OAuth error: {error} {description}".strip())

        result = complete_google_drive_oauth(
            code=request.args.get("code", ""),
            state=request.args.get("state", ""),
        )
        if request.args.get("json") == "1":
            return jsonify(result)
        return """
        <html>
          <body style="font-family: Arial, sans-serif; padding: 32px; text-align: center;">
            <h2>Google Drive MCP connected</h2>
            <p>You can close this tab and return to MARARE.</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: "google-drive-mcp-connected" }, "*");
              }
              setTimeout(() => window.close(), 1200);
            </script>
          </body>
        </html>
        """
    except ProjectMCPError as e:
        if request.args.get("json") == "1":
            return jsonify({"success": False, "error": str(e)}), 400
        return f"""
        <html>
          <body style="font-family: Arial, sans-serif; padding: 32px; text-align: center;">
            <h2>Google Drive MCP connection failed</h2>
            <p>{str(e)}</p>
          </body>
        </html>
        """, 400
    except Exception as e:
        if request.args.get("json") == "1":
            return jsonify({"success": False, "error": str(e)}), 500
        return f"""
        <html>
          <body style="font-family: Arial, sans-serif; padding: 32px; text-align: center;">
            <h2>Google Drive MCP connection failed</h2>
            <p>{str(e)}</p>
          </body>
        </html>
        """, 500
@app.route('/set-admin/<meeting_id>', methods=['POST'])
def set_admin_id(meeting_id):
    try:
        data = request.get_json()
        user_id = data.get('userId')
        a_id = data.get('aid')
        admin_doc = find_meeting_admin(meeting_id)
        if user_id:
            # If room_admins already has an entry, update userId, else create new
            if meeting_id in room_admins and admin_doc and admin_doc.get('user_id') == a_id:
                room_admins[meeting_id]={
                    'userId': user_id,
                     'aid' : a_id
                }
            return jsonify({'success': True, 'message': f'Admin userId set for meeting {meeting_id}', 'userId': user_id})
        else:
            return jsonify({'success': False, 'error': 'No user_id provided'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/get-admin/<meeting_id>', methods=['GET'])
def get_admin_by_meeting_id(meeting_id):
    try:
        admin_doc = find_meeting_admin(meeting_id)
        print("admin_doc", admin_doc)
        if admin_doc:
        
            return jsonify({
                'success': True,
                'user_id': admin_doc.get('user_id'),
                'agentName': admin_doc.get('agent_Name'),
                'isAgent': admin_doc.get('is_agent'),
                'exp': admin_doc.get('exp'),
            })
        else:
            return jsonify({'success': False, 'error': 'No admin found for this meeting'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route("/mcp/tool/<tool_name>", methods=["POST"])
def call_tool(tool_name):
    payload = request.get_json() or {}
    project_id = payload.get("project_id") or request.args.get("project_id")
    user_id = payload.get("user_id") or request.args.get("user_id")
    arguments = payload.get("arguments")
    if arguments is None:
        arguments = {
            key: value
            for key, value in payload.items()
            if key not in {"project_id", "user_id"}
        }

    try:
        result = call_project_mcp_tool(
            project_id=str(project_id or ""),
            user_id=str(user_id or "") or None,
            tool_name=tool_name,
            arguments=arguments,
        )
        return jsonify(result)
    except ProjectMCPError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/mcp/configurations/<project_id>", methods=["GET"])
def get_project_configurations(project_id):
    try:
        user_id = request.args.get("user_id")
        return jsonify(get_public_project_configuration(project_id, user_id=user_id))
    except ProjectMCPError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/mcp/configurations/<project_id>/<provider>", methods=["DELETE"])
def delete_project_mcp_configuration(project_id, provider):
    try:
        payload = request.get_json(silent=True) or {}
        user_id = request.args.get("user_id") or payload.get("user_id")
        return jsonify(delete_project_provider_config(project_id, provider, user_id=user_id))
    except ProjectMCPError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.before_request
def startup():
    """Initialize services on startup"""
    # Only run once by checking if already initialized
    if not hasattr(startup, 'initialized'):
        print("🚀 Starting Flask application...")
        startup.initialized = True

# if __name__ == '__main__':
#     port = int(os.getenv('PORT', '5000'))
#     # Using eventlet as the async server
#     socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)  # For development only
    
if __name__ == '__main__':
    # Start main Flask application
    port = int(os.getenv('PORT', '5000'))
    print(f"🌐 Starting Flask application on port {port}...")
    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=False)

