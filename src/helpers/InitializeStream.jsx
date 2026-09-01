/**
 * Requests getUserMedia and attaches stream to video ref.
 * File: src/helpers/InitializeStream.jsx
 */
export const initializeLocalStream = async (
  id, 
  enableVideo, 
  enableAudio, 
  localStream, 
  agent, 
  initializeAzureSTT, 
  agentName, 
  setLocalTranscript, 
  localTranscript, 
  jointPeers,   
  remoteVideoRefs, 
  setRemoteTranscript, 
  remoteTranscript, 
  localVideoRef, 
  ephemeralKey, 
  activeAgent,
  dispatch,
  existingStream = null // New parameter for pre-initialized stream
) => {       
  console.log("Initializing local stream with ID:", id);
  console.log("Ephemeral key:", ephemeralKey);
  console.log("Existing stream:", activeAgent);
          
  try {
    let stream;
    
    // Use existing stream if provided, otherwise create new one
    if (activeAgent) {
      console.log("Using pre-initialized stream");
      stream = activeAgent;
      
      // Ensure tracks are enabled according to current settings
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      
      if (videoTrack) {
        videoTrack.enabled = enableVideo;
      }
      if (audioTrack) {
        audioTrack.enabled = enableAudio;
      }
    } else {
      console.log("Creating new stream");
      // Request media access (fallback for cases where stream wasn't pre-initialized)
      stream = await navigator.mediaDevices.getUserMedia({
        video: enableVideo,
        audio: enableAudio,
      });
    }

    // Validate stream
    if (!stream) {
      console.error("Stream is not available.");
      return;
    }
    
    // Assign to localStream
    localStream.current = stream;
    console.log("Local stream initialized:", localStream.current);

    // Display local video
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream.current;
    } else {
      console.error("localVideoRef is not ready.");
      return;
    }

    // Initialize transcription for agents
    if (agent && enableAudio) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        console.log("Initializing Azure STT for agent:", agentName);
        // initializeAzureSTT(
        //   audioTrack, 
        //   id, 
        //   agentName, 
        //   setLocalTranscript, 
        //   localTranscript, 
        //   jointPeers,
        //   remoteVideoRefs, 
        //   setRemoteTranscript, 
        //   remoteTranscript, 
        //   ephemeralKey, 
        //   activeAgent, 
        //   dispatch
        // );
      }
    }

    // Additional audio processing if needed
    if (enableAudio) {
      try {
        const audioTracks = stream.getAudioTracks();
        console.log("Audio tracks from stream:", audioTracks);

        if (audioTracks && audioTracks.length > 0) {
          const audioTrack = audioTracks[0];
          const mediaStream = new MediaStream([audioTrack]);
          console.log("Created MediaStream for processing:", mediaStream);
          
          // Additional audio processing can be added here
        }
      } catch (error) {
        console.error("Error while processing audio tracks:", error);
      }
    }

    return stream; // Return the stream for further use
    
  } catch (error) {
    console.error("Error initializing stream:", error.message);
    
    // Enhanced error handling
    switch (error.name) {
      case "NotAllowedError":
        alert("Please allow access to your camera and microphone.");
        break;
      case "NotFoundError":
        alert("No camera or microphone found. Please connect a device.");
        break;
      case "NotReadableError":
        alert("Your camera or microphone is currently in use by another application.");
        break;
      case "OverconstrainedError":
        alert("The requested media constraints cannot be satisfied by your device.");
        break;
      case "SecurityError":
        alert("Media access was denied due to security restrictions.");
        break;
      case "AbortError":
        alert("Media access was aborted.");
        break;
      default:
        alert("An unexpected error occurred: " + error.message);
    }
    
    throw error; // Re-throw for higher-level error handling
  }
};