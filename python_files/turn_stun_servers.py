

"""
WebRTC ICE server configuration (STUN + TURN with time-limited credentials).

Returned by GET /api/webrtc/config. TURN_* env vars must be set in production
for reliable video across restrictive networks.
"""

import os, time, hmac, hashlib, base64
from flask import Flask, jsonify
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

def webrtc_config_view(user_id="user123", ttl=3600):
    secret = os.getenv("TURN_SECRET")
    servers = os.getenv("TURN_SERVERS", "").split(",")

    # Expiry timestamp (in seconds)
    expiry = int(time.time()) + ttl
    username = f"{expiry}:{user_id}"

    # HMAC-SHA1(username, secret)
    digest = hmac.new(
        secret.encode("utf-8"),
        username.encode("utf-8"),
        hashlib.sha1
    ).digest()

    # Base64 encode
    credential = base64.b64encode(digest).decode("utf-8")

    ice_servers = [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
        {"urls": "stun:stun2.l.google.com:19302"},
    ] + [
        {"urls": f"turn:{server.strip()}", "username": username, "credential": credential}
        for server in servers if server.strip()
    ]

    return {
        "iceServers": ice_servers,
        "iceCandidatePoolSize": 10
    }

