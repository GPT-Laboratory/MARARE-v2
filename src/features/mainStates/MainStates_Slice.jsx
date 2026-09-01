/**
 * Redux state for the active meeting session (room, agent, A/V, admin).
 * File: src/features/mainStates/MainStates_Slice.jsx
 */
import { createSlice } from "@reduxjs/toolkit";
import { en } from "@supabase/auth-ui-shared";
// import { useRef } from "react";

const initialState = {
  //   Certificates: []
  roomId: "",
  userId: "",
  agenda: "",
  agent: false,
  wantDocumentTemplate: false,
  mvpVisionTemplate: false,
  agentName: "",
  meetingType: "Business Meeting",
  agentAccess: true,
  enableAudio: true,
  enableVideo: true,
  socket: null,
  // remotePeers: [],
  existingAgents: [],
  meetingStatus: null,
  agentResponse: false,
  mvp: "",
  vision: "",
  meeting_notes: "",
  functional_requirements: "",
  non_functional_requirements: "",
  activateAgent: false,
  agentShouldRespond: false, // Controls whether agent should speak (triggered by name call)
  agentMode: "listening", // "listening" = silent, "active" = realtime with VAD
  agentReady: false,
  ephemeralKey: null,
  currentConfiguration: {}, // Store the current config object
  isAdmin: false, // New state to track if the user is an admin
  enableCaptions: false, // New state to track if captions are enabled
  
};

export const MainStates_Slice = createSlice({
  name: "MainStates_Slice",
  initialState,
  reducers: {
    // setAgentTranscript: (state, action) => {
    //   state.agent_transcript = action.payload; // Set the new agent transcript
    //   console.log("Updated agent transcript:", state.agent_transcript); // Log the updated state
    // },

  

    setMVPVisionTemplate: (state, action) => {
      state.mvpVisionTemplate = action.payload; // Set the new MVP and Vision template
      console.log("Updated mvpVisionTemplate state:", state.mvpVisionTemplate); // Log the updated state
    },
    setSocket: (state, action) => {
      state.socket = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.socket); // Log the updated state
    },
    setMVP: (state, action) => {
      state.mvp = action.payload; // Set the new Certificates array
      console.log("Updated mvp state:", state.mvp); // Log the updated state
    },
    setActivateAgent: (state, action) => {
      state.activateAgent = action.payload; // Set the new Certificates array
      console.log("Updated activateAgent state:", state.activateAgent); // Log the updated state
    },
    setAgentShouldRespond: (state, action) => {
      state.agentShouldRespond = action.payload;
      console.log("Updated agentShouldRespond state:", state.agentShouldRespond);
    },
    setAgentMode: (state, action) => {
      state.agentMode = action.payload; // "listening" or "active"
      console.log("Updated agentMode state:", state.agentMode);
    },
    setAgentReady: (state, action) => {
      state.agentReady = action.payload; // Set the new Certificates array
      console.log("Updated agentReady state:", state.agentReady); // Log the updated state
    },
    setVision: (state, action) => {
      state.vision = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.vision); // Log the updated state
    },
    setMeetingNotes: (state, action) => {
      state.meeting_notes = action.payload; // Set the new meeting notes    
      console.log("Updated meeting notes:", state.meeting_notes); // Log the updated state
    },
    setWantDocumentTemplate: (state, action) => {
      state.wantDocumentTemplate = action.payload; // Set the new want document template
      console.log("Updated want document template:", state.wantDocumentTemplate); // Log the updated state
    },
    setFunctionalRequirements: (state, action) => {
      state.functional_requirements = action.payload; // Set the new functional requirements    
      console.log("Updated functional requirements:", state.functional_requirements); // Log the updated state
    },
    setNonFunctionalRequirements: (state, action) => {
      state.non_functional_requirements = action.payload; // Set the new non-functional requirements
      console.log("Updated non-functional requirements:", state.non_functional_requirements); // Log the updated state
    },
    setMeetingStatus: (state, action) => {
      state.meetingStatus = action.payload;
    },
    setAgentResponse: (state, action) => {
      state.agentResponse = action.payload;
    },
    resetMeetingStatus: (state) => {
      state.meetingStatus = null;
    },
    setAgentName: (state, action) => {
      state.agentName = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.agentName); // Log the updated state
    },
    setMeetingType: (state, action) => {
      state.meetingType = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.meetingType); // Log the updated state
    },
    setExistingAgents: (state, action) => {
      state.existingAgents = action.payload; // Replace the entire list with the new one
    },
    deleteAgent: (state, action) => {
      state.existingAgents = state.existingAgents.filter(
        (agent) => agent.userId !== action.payload // Remove the agent with the matching userId
      );
    },
    setAgentAccess: (state, action) => {
      state.agentAccess = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.agentAccess); // Log the updated state
    },
    setAgenda: (state, action) => {
      state.agenda = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.agenda); // Log the updated state
    },
    setAgent: (state, action) => {
      state.agent = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.agent); // Log the updated state
    },
    setEnableCaptions: (state, action) => {
      state.enableCaptions = action.payload;
      console.log("Updated state:", state.enableCaptions); // Log the updated state
    },
    setRoomId: (state, action) => {
      state.roomId = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.roomId); // Log the updated state
    },
    setUserId: (state, action) => {
      state.userId = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.userId); // Log the updated state
    },
    setEnableVideo: (state, action) => {
      console.log("Action payload:", action.payload); // Log the data being dispatched
      state.enableVideo = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.enableVideo); // Log the updated state
    },
    setEnableAudio: (state, action) => {
      state.enableAudio = action.payload; // Set the new Certificates array
      console.log("Updated state:", state.enableAudio); // Log the updated state
    },
    setEphemeralKey: (state, action) => {
      state.ephemeralKey = action.payload; // Set the new ephemeral key
      console.log("Updated ephemeral key:", state.ephemeralKey); // Log the updated state
    },
    setCurrentConfiguration: (state, action) => {
      state.currentConfiguration = action.payload;
      console.log("Updated currentConfiguration:", state.currentConfiguration);
    },
    setIsAdmin: (state, action) => {
      state.isAdmin = action.payload; // Set the new isAdmin state
      console.log("Updated isAdmin state:", state.isAdmin); // Log the updated state
    },
    // for managing socket and webrtc connection
    setRemotePeers: (state, action) => {
      const {
        userId,
        pc,
        stream,
        isAgent,
        micEnabled,
        agentName,
        remoteName,
        videoEnabled,
      } = action.payload;
      const peerIndex = state.remotePeers.findIndex(
        (peer) => peer.userId === userId
      );
      if (peerIndex > -1) {
        // Update existing peer
        const currentPeer = state.remotePeers[peerIndex];
        if (currentPeer.stream === stream) {
          return; // No change, skip update
        }
        state.remotePeers[peerIndex] = { ...currentPeer, stream };
      } else {
        // Add new peer
        state.remotePeers.push({
          userId,
          pc,
          stream,
          micEnabled,
          isAgent,
          agentName,
          remoteName,
          videoEnabled,
        });
      }
    },
    // update mic and video states
    updateMicState: (state, action) => {
      const { userId, enabled } = action.payload;
      const peerIndex = state.remotePeers.findIndex(
        (peer) => peer.userId === userId
      );

      if (peerIndex > -1) {
        state.remotePeers[peerIndex].micEnabled = enabled;
      }
    },
    updateVideoState: (state, action) => {
      const { userId, enabled } = action.payload;
      console.log("video state", enabled, userId);

      const peerIndex = state.remotePeers.findIndex(
        (peer) => peer.userId === userId
      );

      if (peerIndex > -1) {
        state.remotePeers[peerIndex].videoEnabled = enabled;
      }
      console.log("remote peers update for video", state.remotePeers);
    },

    removeRemotePeer: (state, action) => {
      const userId = action.payload;
      console.log("User ID to remove:", userId);
      console.log("Current remotePeers:", state.remotePeers);

      const userExists = state.remotePeers.some(
        (peer) => peer.userId === userId
      );

      if (userExists) {
        state.remotePeers = state.remotePeers.filter(
          (peer) => peer.userId !== userId
        );
        console.log(`✅ User ${userId} removed from remotePeers.`);
        console.log("Updated remotePeers:", state.remotePeers);
        console.log(
          "Remote peers count after removal:",
          state.remotePeers.length
        );
      } else {
        console.log(`❌ User ${userId} not found in remotePeers.`);
      }
    },
  },
});

export const {
  setRoomId,
  setAgenda,
  setExistingAgents,
  setAgentAccess,
  setAgent,
  setUserId,
  setEnableVideo,
  setEnableAudio,
  setSocket,
  // setRemotePeers,
  // updateMicState,
  // updateVideoState,
  // removeRemotePeer,
  deleteAgent,
  setAgentName,
  setMeetingType,
  setMeetingStatus,
  resetMeetingStatus,
  setMVP,
  setVision,
  setMeetingNotes,
  setFunctionalRequirements,
  setNonFunctionalRequirements,
  setActivateAgent,
  setAgentShouldRespond,
  setAgentMode,
  setCurrentConfiguration,
  setEphemeralKey,
  setIsAdmin,
  setEnableCaptions,
  setAgentReady,
  setWantDocumentTemplate,
  setMVPVisionTemplate,
} = MainStates_Slice.actions;

export default MainStates_Slice.reducer;
