/**
 * Fetches ICE/TURN server config from backend for WebRTC.
 * File: src/helpers/PeerConnection.jsx
 */
import { socketURL } from "../services/meeting/socketInstance";

// Cache for the fetched configuration
let cachedConfiguration = null;

// Fallback configuration with only public STUN servers (no credentials exposed)
const fallbackConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 10,
};

/**
 * Fetch ICE server configuration from backend
 * This keeps TURN credentials secure on the server side
 */
export const getIceConfiguration = async () => {
  // Return cached config if available
  if (cachedConfiguration) {
    return cachedConfiguration;
  }

  try {
    const response = await fetch(`${socketURL}/api/webrtc/config`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ICE config: ${response.status}`);
    }
    
    const config = await response.json();
    console.log("✅ ICE configuration fetched from backend");
    
    // Cache the configuration
    cachedConfiguration = config;
    return config;
  } catch (error) {
    console.error("❌ Error fetching ICE configuration:", error);
    console.log("⚠️ Using fallback STUN-only configuration");
    return fallbackConfiguration;
  }
};

/**
 * Clear the cached configuration (useful for refreshing credentials)
 */
export const clearIceConfigCache = () => {
  cachedConfiguration = null;
};


/**
 * Default configuration export for backward compatibility
 * This only includes public STUN servers - no credentials exposed!
 * 
 * ⚠️ IMPORTANT: For full TURN server support, use getIceConfiguration() instead
 * which fetches secure credentials from the backend.
 */
export const configuration = {
  iceServers: [
    // Public STUN servers only (no credentials needed)
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 10,
};