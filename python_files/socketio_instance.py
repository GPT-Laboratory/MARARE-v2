"""
Shared Socket.IO instance for the MARARE backend.

Imported by api.py and initialized with the Flask app. All real-time meeting
events (join room, WebRTC, transcripts, agents) are registered on this object.
"""

from flask_socketio import SocketIO

socketio = SocketIO(async_mode="threading", cors_allowed_origins="*")
