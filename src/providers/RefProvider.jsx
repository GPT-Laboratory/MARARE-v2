/**
 * React context for WebRTC refs, transcripts, and peer state.
 * File: src/providers/RefProvider.jsx
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const RefContext = createContext();

export const RefProvider = ({ children }) => {
  const localVideoRef = useRef(null);
  const localStream = useRef(null);
  const peerConnections = useRef({});
  let jointPeers = useRef([]);
  const [userId, setUserId] = useState("");
  const [localTranscript, setLocalTranscript] = useState([]);
  const [remoteTranscript, setRemoteTranscript] = useState([]);
  const [localtranscriptView, setLocaltranscriptView] = useState([]);
  const [remotetranscriptView, setRemotetranscriptView] = useState([]);
  const [agentTranscriptView, setAgentTranscriptView] = useState([]);
  const [agentTranscript, setAgentTranscript] = useState([]);

  const [remotePeers, setRemotePeers] = useState([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [joinStatus, setJoinStatus] = useState("pending");
  const [isRaised, setIsRaised] = useState(false);
  let existingPeers = useRef([]);
  let remoteName = useRef([]);
  const remoteVideoRefs = useRef({}); // For video elements
  const remoteAudioRefs = useRef({}); // For audio elements - ADD THIS
  const [elapsedTime, setElapsedTime] = useState(0); // total elapsed time in ms
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const localTranscriptRef = useRef([]);
  const remoteTranscriptRef = useRef({});
  const agentTranscriptRef = useRef([]);
  const lastSentPositionsRef = useRef({ local: 0, remote: {}, agent: 0 });

  const formattedTime = new Date(elapsedTime).toISOString().substr(11, 8); // hh:mm:ss

  // cleanup on unmount
  useEffect(() => {
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    console.log("LocalTranscript updated", localTranscript);
  }, [localTranscript]);




  // Update refs whenever state changes
  React.useEffect(() => {
    localTranscriptRef.current = localTranscript;
  }, [localTranscript]);

  React.useEffect(() => {
    remoteTranscriptRef.current = remoteTranscript;
  }, [remoteTranscript]);

  React.useEffect(() => {
    agentTranscriptRef.current = agentTranscript;
  }, [agentTranscript]);

  

  const startTiming = () => {
    if (isRunning) return; // already running

    setIsRunning(true);
    startTimeRef.current = Date.now() - elapsedTime;

    timerRef.current = setInterval(() => {
      setElapsedTime(Date.now() - startTimeRef.current);
    }, 1000);
  };

  const stopTiming = () => {
    if (!isRunning) return; // already stopped

    setIsRunning(false);
    clearInterval(timerRef.current);
  };



  const getNewTranscripts = useCallback(() => {
    console.log("Getting new transcripts...");
    console.log("Current positions:", lastSentPositionsRef.current);
    console.log("Current localTranscript:", localTranscriptRef.current);

    const newLocalTranscript = localTranscriptRef.current.slice(lastSentPositionsRef.current.local);

    const newAgentTranscript = agentTranscriptRef.current.slice(
      lastSentPositionsRef.current.agent
    );

    const newRemoteTranscript = {};
    Object.keys(remoteTranscriptRef.current).forEach(userId => {
      const lastPos = lastSentPositionsRef.current.remote[userId] || 0;
      const userTranscripts = remoteTranscriptRef.current[userId] || [];
      if (userTranscripts.length > lastPos) {
        newRemoteTranscript[userId] = userTranscripts.slice(lastPos);
      }
    });

    console.log("Extracted new transcripts:", { newLocalTranscript, newRemoteTranscript, newAgentTranscript, });

    return { newLocalTranscript, newRemoteTranscript, newAgentTranscript };
  }, []); // No dependencies needed since we use refs

  const updateLastSentPositions = useCallback(() => {
    const newRemotePositions = {};
    Object.keys(remoteTranscriptRef.current).forEach(userId => {
      newRemotePositions[userId] = remoteTranscriptRef.current[userId]?.length || 0;
    });

    const newPositions = {
      local: localTranscriptRef.current.length,
      remote: newRemotePositions,
      agent: agentTranscriptRef.current.length,
    };

    console.log("Current transcript lengths:", {
      localLength: localTranscriptRef.current.length,
      remoteLength: Object.keys(remoteTranscriptRef.current).map(id => ({ [id]: remoteTranscriptRef.current[id]?.length }))
    });
    console.log("Updating positions from:", lastSentPositionsRef.current);
    console.log("Updating positions to:", newPositions);

    lastSentPositionsRef.current = newPositions;
  }, []);

  const resetLastSentPositions = useCallback(() => {
    lastSentPositionsRef.current = { local: 0, remote: {}, agent: 0 };
    console.log("Reset positions to:", lastSentPositionsRef.current);
  }, []);




  // add or update remote peer when new user joins or existing user joins
  const addOrUpdateRemotePeer = ({
    userId,
    pc,
    stream,
    isAgent,
    micEnabled,
    agentName,
    remoteName,
    videoEnabled,
  }) => {
    console.log("🔹 Updating/adding peer with data:", {
      userId,
      isAgent,
      agentName,
      remoteName,
      micEnabled,
      videoEnabled,
    });

    // check if peer already exists
    setRemotePeers((prevPeers) => {
      const existingPeerIndex = prevPeers.findIndex(
        (peer) => peer.userId === userId
      );

      // if peer exists, update it
      if (existingPeerIndex > -1) {
        // Update existing peer with new data
        const updatedPeers = [...prevPeers];
        updatedPeers[existingPeerIndex] = {
          ...updatedPeers[existingPeerIndex],
          pc,
          stream,
          isAgent,
          agentName,
          remoteName,
          micEnabled,   // ✅ always from parameters
          videoEnabled, // ✅ always from parameters
        };
        return updatedPeers;
      } else {
        // Add new peer with new data
        return [
          ...prevPeers,
          {
            userId,
            pc,
            stream,
            isAgent,
            agentName,
            remoteName,
            micEnabled,   // ✅ always from parameters
            videoEnabled, // ✅ always from parameters
          },
        ];
      }
    });
  };




  const removeRemotePeer = (userId) => {
    console.log("calling remove peer");

    // Clean up refs when removing peer
    if (remoteVideoRefs.current[userId]) {
      delete remoteVideoRefs.current[userId];
    }
    if (remoteAudioRefs.current[userId]) {
      delete remoteAudioRefs.current[userId];
    }

    setRemotePeers((prevPeers) =>
      prevPeers.filter((peer) => peer.userId !== userId)
    );
    console.log("remote array in deletion", remotePeers)
  };

  const removeUserFromJointPeers = (userId) => {
    console.log("Removing user from joint peers:", userId);
    jointPeers.current = jointPeers.current.filter(
      (peer) => peer.user !== userId
    );
    console.log("Updated joint peers:", jointPeers.current);
  };

  const removeAllPeers = () => {
    jointPeers.current = [];
    remoteVideoRefs.current = {};
    remoteAudioRefs.current = {};
  };



  const updateVideoState = useCallback((userId, enabled) => {
    console.log("video state", enabled, userId);
    setRemotePeers((prevPeers) => {
      const updatedPeers = prevPeers.map((peer) =>
        peer.userId === userId ? { ...peer, videoEnabled: enabled } : peer
      );
      console.log("remote peers update for video", updatedPeers);
      return updatedPeers;
    });
  }, []);

  const updateMicState = (userId, enabled) => {
    console.log("mic state", enabled, userId);
    setRemotePeers((prevPeers) => {
      const updatedPeers = prevPeers.map((peer) =>
        peer.userId === userId ? { ...peer, micEnabled: enabled } : peer
      );
      console.log("remote peers update for mic", updatedPeers);
      return updatedPeers;
    });
  };

  const updateRemoteName = (user) => {
    const peer = remotePeers.find((p) => p.userId == user.userId)
    if (peer) {
      peer.remoteName = user.remoteName;
    }
  }

  return (
    <RefContext.Provider
      value={{
        localVideoRef,
        localStream,
        peerConnections,
        jointPeers,
        remotePeers,
        addOrUpdateRemotePeer,
        removeRemotePeer,
        removeUserFromJointPeers,
        userId,
        setUserId,
        localTranscript,
        setLocalTranscript,
        remoteTranscript,
        setRemoteTranscript,
        removeAllPeers,
        isScreenSharing,
        setIsScreenSharing,
        isAdmin,
        setIsAdmin,
        joinStatus,
        setJoinStatus,
        isRaised,
        setIsRaised,
        updateVideoState,
        existingPeers,
        remoteName,
        setRemotePeers,
        updateMicState,
        updateRemoteName,
        remoteVideoRefs, // ADD THIS
        remoteAudioRefs, // ADD THIS
        agentTranscript,
        setAgentTranscript,
        agentTranscriptView,
        setAgentTranscriptView,

        getNewTranscripts,
        updateLastSentPositions,
        resetLastSentPositions,

        // Add these for debugging
        localTranscriptRef,
        remoteTranscriptRef,
        lastSentPositionsRef,

        localtranscriptView,
        setLocaltranscriptView,
        remotetranscriptView,
        setRemotetranscriptView,

        elapsedTime,
        formattedTime,
        isRunning,
        startTiming,
        stopTiming,
      }}
    >
      {children}
    </RefContext.Provider>
  );
};

export const useRefs = () => useContext(RefContext);
