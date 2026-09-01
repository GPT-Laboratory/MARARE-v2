/**
 * WebRTC video grid — local/remote streams and screen share.
 * File: src/components/meeting/VideoPlayer.jsx
 */
import React, { use, useEffect, useRef, useState } from "react";
import {
  FaVideo,
  FaVideoSlash,
  FaMicrophone,
  FaMicrophoneSlash,
  FaRobot,
} from "react-icons/fa";

import { UserOutlined } from "@ant-design/icons";

// Ant Design Components
import { Button, Avatar } from "antd";
import { FaHand } from "react-icons/fa6";
import MeetingTranscript from "./MeetingTranscript";

import RoomChat from '../../components/meeting/RoomChat';
import BottomBar from '../../components/meeting/BottomBar';
import { useRefs } from '../../providers/RefProvider';
import { useDispatch, useSelector } from "react-redux";
import {
  deleteAgent,
  // removeRemotePeer,
  setAgentAccess,
  setActivateAgent,
  setEnableAudio,
  setEnableVideo,
  setEphemeralKey,
  setExistingAgents,
  setFunctionalRequirements,
  setMeetingNotes,
  setMVP,
  setNonFunctionalRequirements,
  setRoomId,
  setSocket,
  setVision,
  setAgentReady,
  // updateMicState,
} from '../../features/mainStates/MainStates_Slice';
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import SpeechRecognition, {
  useSpeechRecognition,
} from "react-speech-recognition";

import { useAuth } from '../../pages/auth/authcontext.jsx';
import { getSocket, socketURL } from '../../services/meeting/socketInstance.jsx';
import { APP_URLS } from '../../config/baseUrls.js';
import axios from "axios";
import {
  sendTranscriptsToBackend,
  // convertTextToSpeech,
  initializeAzureSTT,
  processRemoteStream,
} from '../../helpers/Helper.jsx';
import { handleWelcomeAudio } from '../../helpers/WelcomeMessage.jsx';
import { configuration, getIceConfiguration } from '../../helpers/PeerConnection.jsx';
import { initializeLocalStream } from '../../helpers/InitializeStream.jsx';
import { handleWelcomeFromAgent } from "./WelcomeFromAgent.jsx";
import OpenAISession from '../../components/meeting/OpenAISession.jsx';
import OpenAISharedSession from '../../components/meeting/OpenAISession.jsx';
import RealtimeMvpVisionDisplay from '../../components/meeting/RealtimeMvpVisionDisplay.jsx';
import { useSnackbar } from "notistack";
import store from '../../store/store.jsx';
import {
  setTeamAmvp,
  setTeamAvision,
  setTeamBmvp,
  setTeamBvision,
  setTeamCmvp,
  setTeamCvision,
} from '../../features/ReportSlice.jsx';
import CopyMeetingLink from '../../helpers/CopyMeetingLink.jsx';
const VideoPlayer = ({
  joined,
  setJoined,
  addMessageToChat,
  handleSendMessage,
  enableChat,
  toggleChat,
  enableCaptions,
  setEnableCaptions,
  // remoteVideoRefs,
  setenableChat,
  setAgenda,
  agenda,
  raisedUsers,
}) => {
  // Route is `/:project_id/:id` — `id` is the meeting room, `project_id` is the project row id.
  const { id, project_id } = useParams();
  const { transcript, resetTranscript, listening } = useSpeechRecognition();
  const agent = useSelector((state) => state.MainStates_Slice.agent);
  const agentName = useSelector((state) => state.MainStates_Slice.agentName);
  const Admin = useSelector((state) => state.MainStates_Slice.isAdmin);
  const existingAgents = useSelector(
    (state) => state.MainStates_Slice.existingAgents
  );

  const isAgent = existingAgents.some((agent) => agent.isAgent);
  // console.log("Is agent:", isAgent);
  const activeAgent = useSelector(
    (state) => state.MainStates_Slice.activateAgent
  );
  const ephemeralKey = useSelector(
    (state) => state.MainStates_Slice.ephemeralKey
  );

  // Read document template for the current project so the OpenAI agent has full template access.
  // Also fall back to receivedDocumentTemplate (from socket/saved-doc) so returning meetings
  // and non-host users get the same template access.
  const projects = useSelector((state) => state.main.projects);
  const reduxReceivedTemplate = useSelector((state) => state.reports?.receivedDocumentTemplate || null);
  const documentTemplate =
    projects?.find((p) => String(p.id) === String(project_id))?.template_document ||
    reduxReceivedTemplate ||
    null;

  const [question, setQuestion] = useState("");
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [speakingAgents, setSpeakingAgents] = useState(new Set());
  const { user } = useAuth();
  const { enqueueSnackbar } = useSnackbar();

  const navigate = useNavigate();
  const enableAudio = useSelector(
    (state) => state.MainStates_Slice.enableAudio
  );
  const enableVideo = useSelector(
    (state) => state.MainStates_Slice.enableVideo
  );

  const {
    localVideoRef,
    localStream,
    peerConnections,
    jointPeers,
    setUserId,
    localTranscript,
    setLocalTranscript,
    agentTranscript,
    remoteTranscript,
    setRemoteTranscript,
    setRemotetranscriptView,
    updateVideoState,
    addOrUpdateRemotePeer,
    updateMicState,
    remotePeers,
    existingPeers,
    remoteName,
    removeRemotePeer,
    remoteVideoRefs, // ADD THIS
    remoteAudioRefs, // ADD THIS
  } = useRefs();



  const [screenStream, setScreenStream] = useState(null);
  const { isScreenSharing, setIsScreenSharing } = useRefs();
  const screenvidRef = useRef(null);
  const peerConnections1 = useRef({});
  const screenStreamRef = useRef(null); // Add a ref to keep track of the screen stream for new users
  // At the top of your component/file where you have other useRefs
  const agentPeerConnectionRef = useRef(null);
  const [screenSharing, setScreenSharing] = useState(false);
  // ICE configuration ref - fetched from backend for security
  const iceConfigRef = useRef(configuration); // Start with fallback
  const [originalLocalStream, setOriginalLocalStream] = useState(null);
  const roomId = window.location.pathname.split("/")[2];

  // console.log("remote-peers:", remotePeers);
  const dispatch = useDispatch();
  
  // console.log("peerConnections", jointPeers);
  const socket = getSocket();
  const audioRef = useRef(null);
  const userName = user?.user_metadata?.full_name || "User";

  const { existingRemotePeers, setExistingRemotePeers } = useRefs();

  useEffect(() => {
    if (!SpeechRecognition.browserSupportsSpeechRecognition()) {
      alert("Your browser doesn't support speech recognition.");
    }

  }, []);

  // Fetch ICE configuration from backend on mount
  useEffect(() => {
    const fetchIceConfig = async () => {
      try {
        const config = await getIceConfiguration();
        iceConfigRef.current = config;
        console.log("🔧 ICE configuration loaded from backend");
      } catch (error) {
        console.error("Failed to fetch ICE config, using fallback:", error);
      }
    };
    fetchIceConfig();
  }, []);

  const [speakingUsers, setSpeakingUsers] = useState(new Set());


  // Detect agent speaking from the dedicated agent-audio element (remote side)

// Detect local user speaking
// useEffect(() => {
//   let animationFrameId;
//   let analyser;

//   const detectLocalSpeaking = async () => {
//     if (!localStream.current) return;

//     const audioContext = new AudioContext();
//     const source = audioContext.createMediaStreamSource(localStream.current);
//     analyser = audioContext.createAnalyser();
//     analyser.fftSize = 512;
//     analyser.smoothingTimeConstant = 0.3;
//     source.connect(analyser);

//     const dataArray = new Uint8Array(analyser.frequencyBinCount);

//     const check = () => {
//       analyser.getByteFrequencyData(dataArray);
//       const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      
//       setSpeakingUsers(prev => {
//         const next = new Set(prev);
//         if (avg > 15) {
//           next.add('local');
//         } else {
//           next.delete('local');
//         }
//         return next;
//       });

//       animationFrameId = requestAnimationFrame(check);
//     };
//     check();
//   };

//   if (enableAudio) {
//     detectLocalSpeaking();
//   }

//   return () => {
//     cancelAnimationFrame(animationFrameId);
//     analyser?.disconnect();
//   };
// }, [enableAudio, localStream.current]);

// Detect remote users and remote agents speaking
// useEffect(() => {
//   const audioContexts = {};
//   const animationFrameIds = {};

//   remotePeers.forEach((peer) => {
//     if (!peer.stream) return;

//     const audioTracks = peer.stream.getAudioTracks();
//     if (!audioTracks.length) return;

//     const audioContext = new AudioContext();
//     const source = audioContext.createMediaStreamSource(peer.stream);
//     const analyser = audioContext.createAnalyser();
//     analyser.fftSize = 512;
//     analyser.smoothingTimeConstant = 0.3;
//     source.connect(analyser);

//     audioContexts[peer.userId] = { audioContext, analyser };

//     const dataArray = new Uint8Array(analyser.frequencyBinCount);

//     const check = () => {
//       analyser.getByteFrequencyData(dataArray);
//       const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

//       if (peer.isAgent && peer.agentName) {
//         // Remote agent peer — update speakingAgents
//         setSpeakingAgents(prev => {
//           const next = new Set(prev);
//           if (avg > 10) {
//             next.add(peer.agentName);
//           } else {
//             next.delete(peer.agentName);
//           }
//           return next;
//         });
//       } else {
//         // Regular human remote peer — update speakingUsers
//         setSpeakingUsers(prev => {
//           const next = new Set(prev);
//           if (avg > 15) {
//             next.add(peer.userId);
//           } else {
//             next.delete(peer.userId);
//           }
//           return next;
//         });
//       }

//       animationFrameIds[peer.userId] = requestAnimationFrame(check);
//     };
//     check();
//   });

//   return () => {
//     Object.values(animationFrameIds).forEach(cancelAnimationFrame);
//     Object.values(audioContexts).forEach(({ audioContext }) => audioContext.close());
//   };
// }, [remotePeers]);

// Detect remote users and remote agents speaking
// useEffect(() => {
//   const audioContexts = {};
//   const animationFrameIds = {};

//   remotePeers.forEach((peer) => {
//     if (!peer.stream) return;

//     const audioTracks = peer.stream.getAudioTracks();
//     if (!audioTracks.length) return;

//     // ✅ Clone the track so analysis never touches the playback stream
//     const clonedTrack = audioTracks[0].clone();
//     const analysisStream = new MediaStream([clonedTrack]);

//     const audioContext = new AudioContext();
//     const source = audioContext.createMediaStreamSource(analysisStream);
//     const analyser = audioContext.createAnalyser();
//     analyser.fftSize = 512;
//     analyser.smoothingTimeConstant = 0.3;
//     source.connect(analyser);

//     audioContexts[peer.userId] = { audioContext, analyser, clonedTrack };

//     const dataArray = new Uint8Array(analyser.frequencyBinCount);

//     const check = () => {
//       analyser.getByteFrequencyData(dataArray);
//       const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

//       if (peer.isAgent && peer.agentName) {
//         setSpeakingAgents(prev => {
//           const next = new Set(prev);
//           if (avg > 10) next.add(peer.agentName);
//           else next.delete(peer.agentName);
//           return next;
//         });
//       } else {
//         setSpeakingUsers(prev => {
//           const next = new Set(prev);
//           if (avg > 15) next.add(peer.userId);
//           else next.delete(peer.userId);
//           return next;
//         });
//       }

//       animationFrameIds[peer.userId] = requestAnimationFrame(check);
//     };
//     check();
//   });

//   return () => {
//     Object.values(animationFrameIds).forEach(cancelAnimationFrame);
//     // ✅ Stop cloned tracks and close contexts properly
//     Object.values(audioContexts).forEach(({ audioContext, clonedTrack }) => {
//       clonedTrack.stop();
//       audioContext.close();
//     });
//   };
// }, [remotePeers]);


  const [showCopyBox, setShowCopyBox] = useState(true);
  const meetingLink = window.location.href;
  // console.log("meeting link:", meetingLink);

  // console.log("Joint peers now", jointPeers.current.length);
  // console.log("user", user);
  useEffect(() => {
    console.log("Environment variables:", {
      apiKey: import.meta.env.VITE_OPENAI_API_KEY ? "Present" : "Missing",
    });
  }, []);

  // Auto-activate agent when meeting starts with agent enabled
  // Agent will listen by default, only respond when called by name
  useEffect(() => {
    if (agent && ephemeralKey) {
      console.log("🤖 Auto-activating agent - will listen by default");
      dispatch(setActivateAgent(true));
    }
  }, [agent, ephemeralKey, dispatch]);

  useEffect(() => {
    if (!agent) {
      socket.on("mvpvision-updates", (data) => {
        console.log("Received mvpvision updates:", data);
        dispatch(setTeamAmvp(data.team_a_mvp));
        dispatch(setTeamAvision(data.team_a_vision));
        dispatch(setTeamBmvp(data.team_b_mvp));
        dispatch(setTeamBvision(data.team_b_vision));
        dispatch(setTeamCmvp(data.team_c_mvp));
        dispatch(setTeamCvision(data.team_c_vision));
      });
    }

    return () => {
      socket.disconnect();
    };
  }, []);


  useEffect(() => {
    console.log("broadcasting transcripts:");
    const transcripts = {
      localUser: localTranscript,
      remoteUser: remoteTranscript,
    };
    if (agent) {
      socket.emit("broadcast_transcripts", {
        meetingId: id,
        transcripts,
      });
    }
  }, []);

  useEffect(() => {
    if (agent) {
      // console.log("agent transcript updated:", agentTranscript);
    }
  }, [agentTranscript]);

  useEffect(() => {
    if (!agent) {
      socket.on("transcripts_shared", (data) => {
        console.log("Received shared transcripts:", data);
        dispatch(setLocalTranscript(data.transcripts.localUser));
        dispatch(setRemoteTranscript(data.transcripts.remoteUser));
      });
    }
    return () => {
      socket.off("transcripts_shared");
    };
  }, []);

  useEffect(() => {
    console.log("remote Transcript:", remoteTranscript);
    // socket.emit("remote-transcript", { remoteUser: remoteTranscript });
  }, [remoteTranscript]);

  useEffect(() => {
    setQuestion((prevTranscripts) => [...prevTranscripts, transcript]);
  }, [transcript]);

  useEffect(() => {
    console.log("remotePeers in VideoPlayer:", remotePeers.length);
  }, [remotePeers]);
  useEffect(() => {
    console.log("Remote Name:", remoteName);
    console.log("user", user);
  }, [remoteName]);
  useEffect(() => {
    const send_id = async () => {
      try {
        const res = await fetch(`${APP_URLS.backend}/set-admin/${id}`, {
          method: "POST",
          headers: {
            "Content-type": "application/json",
          },
          body: JSON.stringify({
            userId: socket.id,
            aid: user.id,
          }),
        });
        const data = await res.json();
        console.log("data", data);
      } catch (err) {
        console.log("error occur from the set admin", err);
      }
    };
    send_id();
  }, [socket.id]);

  useEffect(() => {
    console.log("initializing socket:", socket);

    // Create a function to handle all the socket connection setup
    const setupSocketHandlers = async () => {
      // console.log("Setting up socket with ID:", socket.id);
      // console.log("user id ", user.id);
      // console.log("on joinig the video enable", enableVideo);

      dispatch(setRoomId(id));
      console.log("local current", localStream.current);
      const existingStream = localStream.current;
      console.log("existing stream", existingStream);
      if (agent) {
        const key = getEphemeralKey(); // Wait and get actual key
        // if (!key) return; // Handle failure

        await initializeLocalStream(
          socket.id,
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
          key,
          activeAgent,
          dispatch,
          existingStream
        );
      }
      try {
        // Wait for initializeLocalStream to complete
        if (!agent) {
          await initializeLocalStream(
            socket.id,
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
            existingStream
          );
        }
        setUserId(socket.id);
        if (agent) {
          // await getEphemeralKey();
          console.log("user name in connected", userName);
          socket.emit("join-room", {
            meetingId: id,
            micEnabled: enableAudio,
            agent,
            agentName,
            userName,
            videoEnabled: enableVideo,
            aid: user.id,
          });
          createPeerConnection(
            socket.id,
            agent,
            agentName,
            userName,
            enableVideo,
            enableAudio,
            peerConnections,
            addMessageToChat,
            localStream,
            remoteVideoRefs,
            setRemoteTranscript,
            // setRemotePeers,
            processRemoteStream,
            jointPeers,
            socket
          );
        } else {
          createPeerConnection(
            socket.id,
            agent,
            agentName,
            userName,
            enableVideo,
            enableAudio,
            peerConnections,
            addMessageToChat,
            localStream,
            remoteVideoRefs,
            setRemoteTranscript,
            // setRemotePeers,
            processRemoteStream,
            jointPeers,
            socket
          );
          // console.log("user name in connected", userName)
          socket.emit("join-room", {
            meetingId: id,
            micEnabled: enableAudio,
            agent,
            userName,
            videoEnabled: enableVideo,
            aid: user.id,
          });
          dispatch(setAgentAccess(false));
        }
      } catch (error) {
        console.error("Error initializing local stream:", error);
      }
    };

    // Set up event listeners regardless of connection state
    socket.on(
      "user-connected",
      ({
        userId,
        micEnabled,
        isAgent,
        agentName,
        remoteName,
        videoEnabled,
      }) => {
        console.log("okokok", userId, isAgent, agentName, remoteName);
        console.log(
          `User connected: ${userId} with micEnabled: ${micEnabled} and with ${isAgent} agent and finally with video${videoEnabled}`
        );
        console.log("user connected jani", remoteName);

        
        createOffer(
          userId,
          isAgent,
          agentName,
          remoteName,
          videoEnabled,
          micEnabled
        );
        console.log("video enabled value ", videoEnabled);
        const peer = {
          userId,
          micEnabled,
          isAgent,
          agentName,
          remoteName,
          videoEnabled,
        };
        setExistingRemotePeers(peer);


      }
    );



    socket.on("agent-offer", async ({ offer, fromUserId }) => {
      console.log("🤖 Received agent offer from:", fromUserId);
      console.log("Offer:", offer);

      try {
        // Close existing connection if any
        if (agentPeerConnectionRef.current) {
          try {
            agentPeerConnectionRef.current.close();
          } catch (e) {
            console.warn("Error closing existing agent connection:", e);
          }
        }

        const pc = new RTCPeerConnection(iceConfigRef.current);

        // 🔥 STORE IT so you can add ICE candidates later
        agentPeerConnectionRef.current = pc;

        // 🔥 Enhanced connection state monitoring
        pc.onconnectionstatechange = () => {
          console.log("🔌 Agent connection state:", pc.connectionState);
          
          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            console.warn("⚠️ Agent connection lost, attempting to reconnect...");
            // The agent will send a new offer if needed
          } else if (pc.connectionState === "connected") {
            console.log("✅ Agent connection established successfully");
          }
        };

        pc.oniceconnectionstatechange = () => {
          console.log("🧊 Agent ICE connection state:", pc.iceConnectionState);
          
          if (pc.iceConnectionState === "failed") {
            console.warn("⚠️ Agent ICE connection failed, attempting restart...");
            try {
              pc.restartIce();
            } catch (e) {
              console.error("Error restarting ICE:", e);
            }
          } else if (pc.iceConnectionState === "connected") {
            console.log("✅ Agent ICE connection established");
          }
        };

        // When agent audio comes
        pc.ontrack = (event) => {
          console.log("🎧 Received agent audio track");
          const [stream] = event.streams;

          // Create or get existing audio element
          let audio = document.getElementById("agent-audio");
          if (!audio) {
            audio = new Audio();
            audio.id = "agent-audio";
            audio.autoplay = true;
            audio.playsInline = true;
            document.body.appendChild(audio);
          }
          
          audio.srcObject = stream;
          
          // Ensure audio plays
          audio.play().catch((err) => {
            console.warn("Autoplay prevented, user interaction required:", err);
          });

          console.log("✅ Agent audio stream attached");
        };

        // Set remote description
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("✅ Set remote description for agent");

        // Create answer
        const answer = await pc.createAnswer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
        });
        await pc.setLocalDescription(answer);
        console.log("✅ Created and set local answer for agent");

        // Wait for ICE gathering to complete before sending answer
        const waitForIce = () => {
          return new Promise((resolve) => {
            if (pc.iceGatheringState === "complete") {
              resolve();
              return;
            }

            const checkState = () => {
              if (pc.iceGatheringState === "complete") {
                pc.removeEventListener("icegatheringstatechange", checkState);
                resolve();
              }
            };

            pc.addEventListener("icegatheringstatechange", checkState);
            setTimeout(() => {
              pc.removeEventListener("icegatheringstatechange", checkState);
              resolve();
            }, 5000);
          });
        };

        await waitForIce();
        const completeAnswer = pc.localDescription;

        // Send answer back to agent
        socket.emit("peer-agent-answer", {
          meetingId: id,
          fromUserId: socket.id,
          answer: completeAnswer,
        });

        console.log("📤 Sent complete answer to agent");

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit("peer-agent-ice", {
              meetingId: id,
              toUserId: fromUserId,
              candidate: event.candidate,
            });
          } else {
            console.log("✅ ICE gathering complete for agent peer");
          }
        };

      } catch (error) {
        console.error("❌ Error handling agent offer:", error);
        // Clean up on error
        if (agentPeerConnectionRef.current) {
          try {
            agentPeerConnectionRef.current.close();
            agentPeerConnectionRef.current = null;
          } catch (e) {
            console.warn("Error cleaning up agent connection:", e);
          }
        }
      }
    });

    // 🔥 NOW ADD THIS - Handle ICE candidates FROM agent
    socket.on("agent-ice-candidate", async ({ candidate }) => {
      console.log("🧊 Received ICE candidate from agent");

      if (agentPeerConnectionRef.current && candidate) {
        try {
          await agentPeerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
          console.log("✅ Added agent ICE candidate");
        } catch (error) {
          console.error("❌ Error adding ICE candidate:", error);
        }
      } else {
        console.warn("⚠️ No peer connection available for agent ICE candidate");
      }
    });





    socket.on("welcome-audio", (data) => handleWelcomeAudio(data, audioRef));

    // Receive agent speaking state broadcast from host
    socket.on("agent-speaking", ({ agentName: speakingAgent, isSpeaking }) => {
      setSpeakingAgents(prev => {
        const next = new Set(prev);
        if (isSpeaking) {
          next.add(speakingAgent);
        } else {
          next.delete(speakingAgent);
        }
        return next;
      });
    });

    socket.on("existing-peers", (peers) => {
      console.log("Existing peers inside", peers);

      peers.forEach((peer) => {
        const user = jointPeers.current.find((p) => p.userId == peer.userId);
        if (!(user.remoteName == peer.remoteName)) {
          user.remoteName = peer.remoteName;
        }
      });

      const newUniquePeers = peers.filter((newPeer) => {
        return !existingPeers.current.some(
          (existingPeer) => existingPeer.userId === newPeer.userId
        );
      });

      existingPeers.current = [...existingPeers.current, ...newUniquePeers];
      console.log("Existing peers array", existingPeers);

      console.log("Existing peers before update:", remotePeers);

      peers.forEach((peer) => {
        console.log(`Peer: ${peer.userId}, isAgent: ${peer.isAgent}`);
        const jp = jointPeers.current.find((p) => p.userId === peer.userId);
        if (jp) {
          jp.videoEnabled = peer.videoEnabled;
        }
      });

      const agents = peers.filter((peer) => peer.isAgent);
      console.log("Existing agents:", agents);
      if (agents.length >= 1) {
        handleWelcomeFromAgent();
      }
      dispatch(setExistingAgents(agents));
      
      // If you want to update remotePeers as well, do:
      // dispatch(setRemotePeers(normalizedPeers));
    });

    socket.on(
      "offer",
      async ({
        from,
        offer,
        isAgent,
        agentName,
        remoteName,
        videoEnabled,
        micEnabled,
      }) => {
        let obj = {};
        console.log(
          "data in offer:",
          from,
          offer,
          isAgent,
          agentName,
          remoteName,
          videoEnabled,
          micEnabled
        );
        const peerConnection = createPeerConnection(
          from,
          isAgent,
          agentName,
          remoteName,
          videoEnabled,
          micEnabled
        );
        obj.userId = from;
        obj.pc = peerConnection;
        let peercon = obj.pc;
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(offer)
        );
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log("offer hein", remoteName);

        // obj.pc = peercon
        // jointPeers.current.push(obj)
        socket.emit("answer", {
          to: from,
          answer,
          isAgent,
          agentName,
          remoteName,
          videoEnabled,
          micEnabled,
        });
      }
    );

    socket.on(
      "answer",
      ({
        from,
        answer,
        isAgent,
        agentName,
        remoteName,
        videoEnabled,
        micEnabled,
      }) => {


        const objPC = jointPeers.current.find((peer) => peer.userId === from);
        console.log("IN answer", objPC);

        const peerConnection = objPC.pc;
        if (objPC) {
          // Update peer info with received data
          objPC.isAgent = isAgent;
          objPC.agentName = agentName;
          objPC.remoteName = remoteName;
          objPC.videoEnabled = videoEnabled;
          objPC.micEnabled = micEnabled;
          // Set remote description
          peerConnection.setRemoteDescription(
            new RTCSessionDescription(answer)
          );
        }
        // if (peerConnection) {
        //   peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        // }
      }
    );

    socket.on("ice-candidate", ({ from, candidate }) => {
      setTimeout(() => {
        let jp = JSON.parse(JSON.stringify(jointPeers.current));
        // console.log("Received ICE candidate from:", from, jp);
        const objPC = jointPeers.current.find((peer) => peer.userId === from);
        console.log("candidate shift ho rahein ha");

        // console.log(objPC, jointPeers);
        const peerConnection = objPC.pc;
        if (peerConnection && candidate) {
          peerConnection
            .addIceCandidate(new RTCIceCandidate(candidate))
            .catch(console.error);
        }
      }, [100]);
    });

    socket.on("user-disconnected", (userId) => {
      console.log("User disconnected:", userId);
      dispatch(deleteAgent(userId));
      console.log(jointPeers);

      // dispatch(removeRemotePeer(userId));
      removeRemotePeer(userId);
      // const arr = remoteName.filter((peer)=> peer.userId == userId)
      // addOrUpdateRemotePeer(arr)
      if (peerConnections1.current[userId]) {
        console.log(
          "Disconnected user was screen sharing, cleaning up screen share"
        );

        // Clean up screen sharing peer connection
        peerConnections1.current[userId].close();
        delete peerConnections1.current[userId];

        // Clear the screen video element if it was showing this user's screen
        if (screenvidRef.current && screenvidRef.current.srcObject) {
          screenvidRef.current.srcObject = null;
        }

        // Reset screen sharing state
        setScreenSharing(false);

        // Notify other users that screen sharing has stopped
        socket.emit("screen-sharing-status", {
          roomId,
          isSharing: false,
          userId: userId,
        });
      }
      const objPC = jointPeers.current.filter(
        (peer) =>
          peer.userId === userId || peer.userId.startsWith(`agent-${userId}`)
      );
      console.log("obj in disconnected", objPC);
      objPC.forEach((pc) => {
        console.log(pc);
        if (pc) {
          if (pc && typeof pc.close === "function") {
            pc.close();
          }
          jointPeers.current = jointPeers.current.filter(
            (peer) =>
              peer.userId !== userId &&
              !peer.userId.startsWith(`agent-${userId}`)
          );
          console.log(jointPeers.current);
          delete remoteVideoRefs.current[userId];
          const agentElementId = `video-agent-${userId}`;
          const videoElementId = `video-${userId}`;
          const agentElement = document.getElementById(agentElementId);
          if (agentElement) {
            console.log("Agent element found:", agentElement.outerHTML);
            agentElement.closest(".relative")?.remove(); // Remove the agent container
          } else {
            console.log("No agent element found for userId:", userId);
          }

          enqueueSnackbar(`User ${pc.remoteName} has left the room`, {
            variant: "info",
            anchorOrigin: { vertical: "top", horizontal: "left" },
            autoHideDuration: 2000,
          });
        }
      });
    });

    socket.on("meeting-ended", (data) => {
      console.log(data.message); // You can log or display this message
      setMeetingEnded(true);
      navigate("/"); // Redirect to the main page
    });

    // Key part: Handle both already-connected and will-connect scenarios
    // 1. If already connected, run setup immediately
    if (socket.connected) {
      console.log("Socket already connected with ID:", socket.id);
      setupSocketHandlers();
    }

    // 2. Also set up connect handler for reconnection scenarios
    socket.on("connect", () => {
      console.log("Socket connected in Content with ID:", socket.id);
      setupSocketHandlers();
    });
    socket.on("screen-sharer-disconnected", ({ userId }) => {
      console.log("Screen sharer disconnected:", userId);

      // Clear the screen video element
      if (screenvidRef.current && screenvidRef.current.srcObject) {
        screenvidRef.current.srcObject = null;
      }

      // Reset screen sharing state for viewers
      setScreenSharing(false);

      // Clean up screen sharing peer connection if it exists
      if (peerConnections1.current[userId]) {
        peerConnections1.current[userId].close();
        delete peerConnections1.current[userId];
      }

      enqueueSnackbar("Screen sharing has ended", {
        variant: "info",
        anchorOrigin: { vertical: "top", horizontal: "left" },
        autoHideDuration: 2000,
      });
    });

    return () => {
      // Clean up all event listeners
      socket.off("connect");
      socket.off("user-ID");
      socket.off("user-connected");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("user-disconnected");
      socket.off("audio-toggle");
      socket.off("video-toggle");
      socket.off("welcome-audio");
      socket.off("meeting-ended");
      socket.off("existing-peers");
      socket.off("user-left");
      socket.off("video-toggle");
      socket.off("screen-sharer-disconnected");
      socket.off("agent-offer");
    };
  }, []);

  useEffect(() => {
    const handleVideoToggle = ({ userId, enabled }) => {
      console.log("Video toggle event received:", { userId, enabled });
      console.log("Updating video state for:", userId, enabled);
      console.log("toggle ", remotePeers); // This will always be up-to-date
      updateVideoState(userId, enabled);
    };

    const handleAudioToggle = ({ userId, enabled }) => {
      console.log("hahaha", { userId, enabled });
      // dispatch(updateMicState({ userId, enabled }));
      updateMicState(userId, enabled);
    };

    socket.on("video-toggle", handleVideoToggle);
    socket.on("audio-toggle", handleAudioToggle);

    // Cleanup to avoid duplicate handlers
    return () => {
      socket.off("video-toggle", handleVideoToggle);
      socket.off("audio-toggle", handleAudioToggle);
    };
  }, []);

  useEffect(() => {
    if (remotePeers.length) {
      remotePeers.forEach((peer) => {
        const element = document.getElementById(`video-${peer.userId}`);
        console.log("Checking element for peer:", peer.userId, element);
      });
    }
  }, [remotePeers]);

  useEffect(() => {
    console.log("existing peers in effect: ", existingRemotePeers);
    console.log("type of existingRemotePeers: ", typeof existingRemotePeers);
  }, [existingRemotePeers]);

  const dataChannels = {};
  const createPeerConnection = (
    userId,
    isAgent = false,
    agentName = "",
    remoteName,
    videoEnabled,
    micEnabled
  ) => {
    console.log("user name in create peer connection", remoteName);
    console.log(userId);
    console.log("connection setup is running");
    const peerConnection = new RTCPeerConnection(iceConfigRef.current);
    const dataChannel = peerConnection.createDataChannel("chat");
    peerConnections.current[userId] = {
      pc: peerConnection,
      dataChannel, // Store the data channel
    };
    dataChannels[userId] = dataChannel;
    dataChannel.onmessage = (event) => {
      try {
        const { text } = JSON.parse(event.data);
        const senderName =
          jointPeers.current.find((p) => p.userId === userId)?.remoteName ||
          remoteName;
        addMessageToChat(senderName, text);
      } catch (error) {
        console.error(`Failed to process message from ${userId}:`, error);
      }
    };
    peerConnection.ondatachannel = (event) => {
      const receivedDataChannel = event.channel;
      peerConnections.current[userId] = {
        ...peerConnections.current[userId],
        dataChannel: receivedDataChannel,
      };
      receivedDataChannel.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const senderName =
          jointPeers.current.find((p) => p.userId === userId)?.remoteName ||
          remoteName;
        addMessageToChat(senderName, msg.text);
      };
    };
    let obj = {
      userId: userId,
      isAgent,
      agentName,
      remoteName,
      videoEnabled,
      micEnabled,
      pc: peerConnection,
    };
    console.log("Object of peerConnection:", obj);
    localStream.current.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream.current); // Add local tracks to the peer connection
    });
    obj.pc.ontrack = async (event) => {
      console.log("ontrack event fired:", event);

      if (event.streams.length > 0) {
        const stream = event.streams[0];
        // dispatch(setRemotePeers({ userId, pc: peerConnection, stream, isAgent, micEnabled, agentName , remoteName, videoEnabled }));
        console.log("Adding remote peer:", {
          userId,
          peerConnection,
          stream,
          isAgent,
          micEnabled,
          agentName,
          remoteName,
          videoEnabled,
        });

        addOrUpdateRemotePeer({
          userId,
          pc: peerConnection,
          stream,
          isAgent,
          micEnabled,
          agentName,
          remoteName,
          videoEnabled,
        });
        // addOrUpdateRemotePeer({
        //   userId,
        //   pc: peerConnection,
        //   stream,
        //   isAgent,
        //   agentName,
        //   remoteName,
        //   // micEnabled and videoEnabled will be fetched internally
        // });

        const { enableCaptions } = store.getState().MainStates_Slice;

        console.log("enable captions value", enableCaptions);

        // if (enableCaptions) {
        //   console.log("Processing remote stream for transcription");
        //   await processRemoteStream(
        //     remotePeers,
        //     remoteVideoRefs,
        //     setRemoteTranscript,
        //     setRemotetranscriptView,
        //     remoteTranscript
        //   );
        // }

        if (remoteVideoRefs.current[userId]) {
          console.log(`Setting srcObject for user ${userId}`);
          remoteVideoRefs.current[userId].srcObject = stream;
        } else {
          console.warn(`No video ref found for user ${userId}`);
        }
        Object.entries(remoteVideoRefs.current).forEach(
          async ([userId, video]) => {
            try {
              console.log(`Processing video element for user ${userId}:`, {
                id: video.id,
                hasMediaStream: !!video.srcObject,
                readyState: video.readyState,
              });
              if (!video) {
                console.warn(`No video element found for user: ${userId}`);
                return;
              }
              if (!video.srcObject) {
                console.warn(
                  `No srcObject found for user: ${userId}. Make sure the MediaStream is properly set.`
                );
                return;
              }
              console.log(`MediaStream details for user ${userId}:`, {
                streamId: video.srcObject.id,
                tracks: video.srcObject.getTracks().map((track) => ({
                  kind: track.kind,
                  id: track.id,
                  enabled: track.enabled,
                  readyState: track.readyState,
                })),
              });
              const remoteAudioTracks = video.srcObject.getAudioTracks();
              // Debug: Log audio tracks
              console.log(`Audio tracks found for user ${userId}:`, {
                count: remoteAudioTracks.length,
                tracks: remoteAudioTracks.map((track) => ({
                  id: track.id,
                  enabled: track.enabled,
                  muted: track.muted,
                  readyState: track.readyState,
                })),
              });
              if (
                remoteAudioTracks.length > 0 &&
                remoteAudioTracks[0].enabled
              ) {
                const remoteMediaStream = new MediaStream([
                  remoteAudioTracks[0],
                ]);
                console.log(`Created new MediaStream for transcription:`, {
                  streamId: remoteMediaStream.id,
                  trackCount: remoteMediaStream.getTracks().length,
                });
                console.log("enable captions value", enableCaptions);
              } else {
                console.warn(`No valid audio track found for user: ${userId}`);
              }
            } catch (error) {
              console.error(
                `Error processing remote video for user ${userId}:`,
                error
              );
            }
          }
        );
      }
    };
    // Handle ICE candidates after local stream is ready
    obj.pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          to: userId,
          candidate: event.candidate,
        });
      }
    };

    console.log("Object for now", obj);
    peerConnections.current[userId] = peerConnection;
    jointPeers.current.push(obj);
    console.log("pushing obj into joint peer", jointPeers);

    return obj.pc;
  };



  const createOffer = async (
    userId,
    isAgenta,
    agentNamea,
    remoteNamea,
    videoEnableda,
    micEnableda
  ) => {
    const { enableVideo, enableAudio } = store.getState().MainStates_Slice;

    console.log(
      "values send for offer",
      agent,
      agentName,
      userName,
      enableVideo, // ✅ fresh value
      enableAudio // ✅ fresh value
    );

    const peerConnection = createPeerConnection(
      userId,
      isAgenta,
      agentNamea,
      remoteNamea,
      videoEnableda,
      micEnableda,
      peerConnections,
      addMessageToChat,
      localStream,
      remoteVideoRefs,
      setRemoteTranscript,
      processRemoteStream,
      jointPeers,
      socket
    );

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("offer", {
      to: userId,
      offer,
      agent,
      agentName,
      userName,
      enableVideo,
      enableAudio,
    });
  };

  const getEphemeralKey = async () => {
    try {
      const response = await fetch(`${socketURL}/api1/ephemeral-key`, {
        method: "POST",
      });

      const data = await response.json();
      console.log("ephemeralKey:", data.value);

      dispatch(setEphemeralKey(data.value));
    } catch (err) {
      console.error("Error getting ephemeral key:", err);
    }
  };



  // console.log("jointPeers", jointPeers);
  if (meetingEnded) {
    return (
      <div className="text-center text-xl font-bold text-white">
        The meeting has ended.
      </div>
    );
  }

  // console.log("Remote  name is ", remoteName);

  // console.log("roomID", roomId);

  useEffect(() => {
    if (isScreenSharing) {
      startScreenSharing();
    } else {
      stopScreenShare();
    }
  }, [isScreenSharing]);

  useEffect(() => {
    // Handle another user sharing their screen with us
    const handleScreenShare = async (data) => {
      console.log("Receiving screen share from:", data.userId);

      // Create a new RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      // Store the peer connection
      peerConnections1.current[data.userId] = pc;

      // Set up ICE candidate handling
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("Sending ICE candidate to sharer");
          socket.emit("screen-candidate", {
            to: data.userId,
            candidate: event.candidate,
          });
        }
      };

      // Set up track handling
      pc.ontrack = (event) => {
        console.log("Received track from screen sharer!");
        if (screenvidRef.current) {
          screenvidRef.current.srcObject = event.streams[0];
          // Use a small delay before playing the video
          setTimeout(() => {
            screenvidRef.current.play().catch((err) => {
              if (err.name !== "AbortError") {
                console.error("Video play error:", err);
              }
            });
          }, 100);
        }
      };

      // Set the remote description (offer)
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

        // Create an answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Send the answer back
        socket.emit("screen-answer", {
          to: data.userId,
          answer: pc.localDescription,
        });

        console.log("Answer sent to screen sharer");
      } catch (error) {
        console.error("Error handling screen share:", error);
      }
    };

    // Handle receiving an answer to our screen share offer
    const handleScreenAnswer = async (data) => {
      console.log("Received answer from viewer:", data.from);

      if (peerConnections1.current[data.from]) {
        try {
          await peerConnections1.current[data.from].setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
          console.log("Remote description set successfully for:", data.from);
        } catch (error) {
          console.error("Error setting remote description:", error);
        }
      }
    };

    // Handle ICE candidates
    const handleIceCandidate = async (data) => {
      console.log("Received ICE candidate from:", data.from);

      if (peerConnections1.current[data.from]) {
        try {
          await peerConnections1.current[data.from].addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
          console.log("Added ICE candidate for:", data.from);
        } catch (error) {
          console.error("Error adding ICE candidate:", error);
        }
      }
    };

    // Handle stop screen sharing
    const handleStopScreenShare = (data) => {
      console.log("User stopped sharing screen:", data.userId);

      if (data.userId !== socket.id && screenvidRef.current) {
        screenvidRef.current.srcObject = null;
      }

      // Clean up the peer connection
      if (peerConnections1.current[data.userId]) {
        peerConnections1.current[data.userId].close();
        delete peerConnections1.current[data.userId];
      }
    };

    // Handle new user joining room when we're already sharing screen
    const handleNewUserForScreen = async ({ newUserId, roomId }) => {
      console.log("New user joined room while sharing screen:", newUserId);

      // Only handle if we're actually sharing our screen
      if (screenStreamRef.current && isScreenSharing) {
        console.log("Sending screen share to new user:", newUserId);
        try {
          // Create a new peer connection for the new user
          const pc = await createSenderPeerConnection(
            newUserId,
            screenStreamRef.current
          );

          // No need to emit screen-share here as createSenderPeerConnection does that
        } catch (error) {
          console.error("Error sending screen to new user:", error);
        }
      } else {
        console.log(
          "Received new-user-for-screen but we're not sharing screen"
        );
      }
    };
    const handleScreenStatus = ({ isSharing, userId }) => {
      console.log(`User ${userId} screen sharing: ${isSharing}`);
      setScreenSharing(isSharing);
    };

    socket.on("screen-sharing-status", handleScreenStatus);
    // Register event handlers
    socket.on("screen-share", handleScreenShare);
    socket.on("screen-answer", handleScreenAnswer);
    socket.on("screen-candidate", handleIceCandidate);
    socket.on("stop-screen-share", handleStopScreenShare);
    socket.on("new-user-for-screen", handleNewUserForScreen);

    // Cleanup on unmount
    return () => {
      socket.off("screen-share", handleScreenShare);
      socket.off("screen-answer", handleScreenAnswer);
      socket.off("screen-candidate", handleIceCandidate);
      socket.off("stop-screen-share", handleStopScreenShare);
      socket.off("new-user-for-screen", handleNewUserForScreen);
      socket.off("screen-sharing-status", handleScreenStatus);

      if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isScreenSharing]);

  useEffect(() => {
    // This effect ensures the local video element always has the correct srcObject
    if (localVideoRef.current && localStream.current) {
      // Only set if it's different to avoid unnecessary updates
      if (localVideoRef.current.srcObject !== localStream.current) {
        console.log("Restoring local video srcObject");
        localVideoRef.current.srcObject = localStream.current;
      }
    }
  }, [screenSharing, enableVideo]);
  useEffect(() => {
    // When screen sharing starts or stops, ensure local video is preserved
    if (localVideoRef.current && localStream.current) {
      console.log(
        "Screen sharing state changed, ensuring local video is intact"
      );

      // Small delay to ensure DOM updates are complete
      setTimeout(() => {
        if (localVideoRef.current && localStream.current) {
          if (localVideoRef.current.srcObject !== localStream.current) {
            localVideoRef.current.srcObject = localStream.current;
            console.log(
              "Local video srcObject restored after screen sharing state change"
            );
          }
        }
      }, 100);
    }
  }, [screenSharing]);
  const startScreenSharing = async () => {
    try {
      console.log("Starting screen sharing...");

      // Store the original local stream before starting screen share
      if (localStream.current && !originalLocalStream) {
        setOriginalLocalStream(localStream.current);
        console.log("stream saved", localStream.current);
      }

      // Get screen stream
      const stream = await navigator.mediaDevices
        .getDisplayMedia({
          video: true,
          audio: true,
        })
        .catch((err) => {
          console.error("Error getting display media:", err);
          throw err;
        });

      setScreenStream(stream);
      screenStreamRef.current = stream;

      // Create a temporary video element to ensure the stream is actually playing
      const tempVideo = document.createElement("video");
      tempVideo.srcObject = stream;
      tempVideo.muted = true;

      // Promise that resolves when the stream is ready to play
      const streamReadyPromise = new Promise((resolve) => {
        tempVideo.onloadedmetadata = () => {
          tempVideo
            .play()
            .then(() => {
              console.log("Stream verified as playable");
              resolve();
            })
            .catch((err) => {
              console.error("Error in temp video play:", err);
              resolve(); // Resolve anyway to continue the process
            });
        };
      });

      // Wait for stream to be playable
      await streamReadyPromise;

      // NOW set the screenSharing to true to render the div
      setScreenSharing(true);

      // Small timeout to ensure div is rendered before attaching stream
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Set the stream to the actual video element
      if (screenvidRef.current) {
        screenvidRef.current.srcObject = stream;
        await screenvidRef.current
          .play()
          .catch((err) => console.error("Local video play error:", err));

        console.log("Stream now playing in video element");
      }
      setTimeout(() => {
        if (localVideoRef.current && localStream.current) {
          if (localVideoRef.current.srcObject !== localStream.current) {
            console.log(
              "Ensuring local video is preserved during screen share"
            );
            localVideoRef.current.srcObject = localStream.current;
          }
        }
      }, 200);
      // Now that stream is confirmed playing, notify others
      socket.emit("screen-sharing-status", {
        roomId,
        isSharing: true,
        userId: socket.id,
      });

      // Register as screen sharer in the server
      socket.emit("register-screen-sharer", { roomId });

      // Get users in the room
      socket.emit("get-room-users", { roomId }, async (roomUsers) => {
        console.log("Room users:", roomUsers);

        // For each user in the room (except self)
        for (const remoteUserId of roomUsers) {
          if (remoteUserId !== socket.id) {
            // Add a small delay between connections to avoid overwhelming the network
            await new Promise((resolve) => setTimeout(resolve, 100));
            await createSenderPeerConnection(remoteUserId, stream);
          }
        }
      });

      // Handle stream ending
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          console.log("Track ended, stopping screen share");
          setIsScreenSharing(false);
          setScreenSharing(false);
          stopScreenShare();
        };
      });
    } catch (error) {
      console.error("Error starting screen sharing:", error);
      setIsScreenSharing(false);
      setScreenSharing(false);
    }
  };

  // Create a peer connection to send screen to a specific user
  const createSenderPeerConnection = async (targetUserId, stream) => {
    console.log("Creating sender peer connection for:", targetUserId);

    // Close existing connection if any
    if (peerConnections1.current[targetUserId]) {
      peerConnections1.current[targetUserId].close();
    }

    // Create a new peer connection
    const pc = new RTCPeerConnection(iceConfigRef.current);

    // Store the connection
    peerConnections1.current[targetUserId] = pc;

    // Add tracks to the connection
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
      console.log("Added track to peer connection:", track.kind);
      track.onended = () => {
        console.log("Screen sharing stopped from browser UI");
        setIsScreenSharing(false);
        stopScreenShare();
      };
    });

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate to:", targetUserId);
        socket.emit("screen-candidate", {
          to: targetUserId,
          candidate: event.candidate,
        });
      }
    };

    // Create and send an offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log("Sending screen share offer to:", targetUserId);
      socket.emit("screen-share", {
        roomId,
        offer: pc.localDescription,
        to: targetUserId,
      });
    } catch (error) {
      console.error("Error creating offer:", error);
    }

    return pc;
  };

  const stopScreenShare = () => {
    console.log("Stopping screen sharing");

    if (screenStream) {
      // Stop all tracks
      screenStream.getTracks().forEach((track) => track.stop());

      socket.emit("screen-sharing-status", {
        roomId,
        isSharing: false,
        userId: socket.id,
      });

      setScreenSharing(false);

      if (originalLocalStream && localVideoRef.current) {
        localVideoRef.current.srcObject = originalLocalStream;

        localStream.current = originalLocalStream;
        console.log("setting the local stream agein ", originalLocalStream);
        setOriginalLocalStream(null);
      }

      // Clear video element
      if (screenvidRef.current) {
        screenvidRef.current.srcObject = null;
      }

      // Close all screen sharing peer connections (but NOT the main video connections)
      Object.keys(peerConnections1.current).forEach((peerId) => {
        if (peerConnections1.current[peerId]) {
          peerConnections1.current[peerId].close();
        }
      });

      // Reset screen sharing state
      peerConnections1.current = {};
      setScreenStream(null);
      screenStreamRef.current = null;

      // Restore original local stream if it exists

      // Notify others
      socket.emit("stop-screen-share", { roomId });
    }
  };
  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
      }
      if (originalLocalStream) {
        setOriginalLocalStream(null);
      }
    };
  }, []);

  const debugLocalVideo = () => {

    if (localVideoRef.current && localStream.current) {

      if (localVideoRef.current.srcObject !== localStream.current) {
        console.log("FIXING: Setting correct srcObject");
        localVideoRef.current.srcObject = localStream.current;
      }
    }
  };

  debugLocalVideo();


  const getVideoEnabled = (userId) => {
    const peer = jointPeers.current.find((peer) => peer.userId == userId);
    console.log("peer in get video enabled", peer);

    if (peer) {
      return peer.videoEnabled;
    }

    // return false;
  };

  const getRemoteName = (userId) => {
    const peer = jointPeers.current.find((peer) => peer.userId == userId);
    return peer?.remoteName || `Peer ${userId.slice(0, 6)}`;
  };

  return (
    <div
      className={`bg-black text-white p-4 flex item-center justify-center md:h-full ${(jointPeers.current.length - 1 > 1 && "overflow-y-scroll ") ||
        (jointPeers.current.length - 1 > 9 && "md:overflow-y-scroll")
        }`}
    >
      <audio id="ai-audio"

        autoPlay
        playsInline

      />
      <div className={`space-y-4 relative w-full h-full`}>
        <div
          className={`w-full h-full ${screenSharing
            ? "flex flex-col lg:flex-row gap-4 p-2"
            : // : jointPeers.current.length - 1 <= 1
            //   ? "grid grid-cols-1 gap-4 p-2"
            //   : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-2"
            jointPeers.current.length - 1 === 0 && isAgent
              ? "relative w-[80vw] h-[80vh]  p-4 rounded-2xl overflow-hidden top-4"
              : jointPeers.current.length - 1 == 0 && !isAgent
                ? "relative w-[80vw] h-[80vh]  p-4 rounded-2xl overflow-hidden top-4"
                : jointPeers.current.length - 1 === 1 && !isAgent
                  ? "relative w-[80vw] h-[80vh]  p-4 rounded-2xl overflow-hidden top-4"
                  : jointPeers.current.length - 1 === 1 && isAgent
                    ? " w-[80vw] h-[85vh] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 top-4 rounded-2xl "
                    : jointPeers.current.length - 1 === 2 && !isAgent
                      ? " w-[80vw] h-[85vh] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 top-4 rounded-2xl "
                      : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 rounded-2xl gap-4  relative top-5"
            }`}
        >
          {/* Screen sharing layout */}
          {screenSharing && (
            <>
              {/* Screen share view */}
              <div className="relative w-full lg:w-[70%] h-[60vh] lg:h-[85vh] rounded-2xl overflow-hidden bg-black">
                <video
                  ref={screenvidRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain bg-black"
                />
              </div>

              {/* Participants panel */}
              <div className="w-full lg:w-[30%] h-[30vh] lg:h-[85vh] rounded-2xl overflow-y-auto bg-black border border-gray-800">
                <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 p-3">
                  {/* Local video - CRITICAL: Ensure this uses the original localVideoRef and localStream */}
                  <div className="relative rounded-xl overflow-hidden bg-gray-800 aspect-video">
                    <video
                      ref={localVideoRef} // This should always point to the original local video ref
                      key="local-video"
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover rounded-xl transition-opacity duration-300 ${enableVideo ? "opacity-100 z-10" : "opacity-0 z-0"
                        }`}
                      style={{ display: enableVideo ? "block" : "none" }}
                    />

                    {!enableVideo && (
                      <div className="absolute inset-0 w-full h-full bg-gradient-to-b from-blue-500 to-blue-700 flex items-center justify-center rounded-xl z-10">
                        <div className="w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center border-2 border-white border-opacity-30">
                          <UserOutlined className="text-white text-lg" />
                          <div className="absolute top-1 right-1 bg-black bg-opacity-50 p-1 rounded">
                            <FaVideoSlash size={12} className="text-red-500 transition-all duration-300" />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="absolute bottom-1 right-1 flex items-center justify-center z-50">
                      {!enableAudio && (
                        <div className="bg-black bg-opacity-50 p-1 rounded z-40">
                          <FaMicrophoneSlash
                            size={12}
                            className="text-red-500 transition-all duration-300"
                          />
                        </div>
                      )}
                    </div>

                    <div className="absolute bottom-1 left-1 bg-black bg-opacity-50 px-2 py-1 rounded text-white text-xs z-40">
                      {user?.user_metadata?.full_name ?? `You`}
                    </div>

                    {raisedUsers.includes(user?.id) && (
                      <div className="absolute top-1 right-1 bg-yellow-500 bg-opacity-80 p-1 rounded-full z-40">
                        <FaHand
                          size={12}
                          className="text-white animate-pulse"
                        />
                      </div>
                    )}
                  </div>


                  {agent &&
                    <div
                      // className={`relative aspect-video flex flex-col items-center justify-center p-2 bg-gradient-to-b from-green-500 to-green-800 rounded-xl ${speakingAgents.has(agentName) ? "speaking-ring-agent" : ""}`}
                      className={`relative aspect-video flex flex-col items-center justify-center p-2 bg-gradient-to-b from-green-500 to-green-800 rounded-xl `}

                      id={`video-${agentName}`}
                    >
                      {/* Agent content */}
                      <div
                        className={
                          speakingAgents.has(agentName)
                            ? "agent-speaking"
                            : ""
                        }
                      >
                        <FaRobot
                          size={40}
                          className={`text-white agent-icon ${speakingAgents.has(agentName)
                            ? "speaking"
                            : ""
                            }`}
                        />
                        {speakingAgents.has(agentName) && (
                          <div className="speaking-indicator">
                            <div className="speaking-dot"></div>
                            <div className="speaking-dot"></div>
                            <div className="speaking-dot"></div>
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 bg-black bg-opacity-50 px-2 py-1 rounded-xl shadow text-white text-xs font-medium">
                        {agentName}
                      </div>
                    </div>
                  }

                  {remotePeers
                    .filter((peer) => peer.isAgent) // only agents
                    .map((peer, index) => (
                      <div
                        key={index}
                        // className={`relative aspect-video flex flex-col items-center justify-center p-2 bg-gradient-to-b from-green-500 to-green-800 rounded-xl ${speakingAgents.has(peer.agentName) ? "speaking-ring-agent" : ""}`}
                        className={`relative aspect-video flex flex-col items-center justify-center p-2 bg-gradient-to-b from-green-500 to-green-800 rounded-xl `}

                        id={`video-${peer.agentName}`}
                      >
                        {/* Agent content */}
                        <div
                          className={
                            speakingAgents.has(peer.agentName)
                              ? "agent-speaking"
                              : ""
                          }
                        >
                          <FaRobot
                            size={40}
                            className={`text-white agent-icon ${speakingAgents.has(peer.agentName)
                              ? "speaking"
                              : ""
                              }`}
                          />
                          {speakingAgents.has(peer.agentName) && (
                            <div className="speaking-indicator">
                              <div className="speaking-dot"></div>
                              <div className="speaking-dot"></div>
                              <div className="speaking-dot"></div>
                            </div>
                          )}
                        </div>
                        <div className="absolute bottom-0 left-0 bg-black bg-opacity-50 px-2 py-1 rounded-xl shadow text-white text-xs font-medium">
                          {peer.agentName}
                        </div>
                      </div>
                    ))}

                  {/* Remote Peers */}
                  {remotePeers.map((peer) => (
                    <div
                      key={peer.userId}
                      className="relative aspect-video rounded-xl overflow-hidden"
                    >
                      <audio
                        ref={(ref) => {
                          if (ref && peer.stream) {
                            ref.srcObject = peer.stream;
                            if (!remoteAudioRefs.current[peer.userId]) {
                              remoteAudioRefs.current[peer.userId] = ref;
                            }
                          }
                        }}
                        autoPlay
                        playsInline
                        style={{ display: "none" }}
                      />

                      {peer.videoEnabled === true ? (
                        <video
                          // ref={(ref) => {
                          //   if (ref && peer.stream) {
                          //     ref.srcObject = peer.stream;
                          //     remoteVideoRefs.current[peer.userId] = ref;
                          //   }
                          // }}
                          ref={(ref) => {
                            if (ref && peer.stream) {
                              // Only set if it's not already set or has changed
                              if (!remoteVideoRefs.current[peer.userId]) {
                                remoteVideoRefs.current[peer.userId] = ref;
                                ref.srcObject = peer.stream;
                              } else if (ref.srcObject !== peer.stream) {
                                ref.srcObject = peer.stream;
                              }
                            }
                          }}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover rounded-xl"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-b from-yellow-400 to-yellow-700 flex items-center justify-center rounded-xl">
                          <div className="w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center border-2 border-white border-opacity-30">
                            <UserOutlined className="text-white text-lg" />
                            <div className="absolute top-1 right-1 bg-black bg-opacity-50 p-1 rounded">
                              <FaVideoSlash
                                size={12}
                                className="text-red-500 transition-all duration-300"
                              />
                            </div>
                          </div>
                        </div>
                      )}


                      {peer.micEnabled === false &&
                      {
                        /*!peer.isAgent */
                      } && (
                          <div className="absolute bottom-1 right-1 bg-black bg-opacity-50 p-1 rounded">
                            <FaMicrophoneSlash
                              size={12}
                              className="text-red-500 transition-all duration-300"
                            />
                          </div>
                        )}

                      {peer && (
                        <div className="absolute bottom-1 left-1 bg-black bg-opacity-50 px-2 py-1 rounded text-white text-xs">
                          {peer.remoteName}
                        </div>
                      )}

                      {raisedUsers.includes(peer.userId) && (
                        <div className="absolute top-1 right-1 bg-yellow-500 bg-opacity-80 p-1 rounded-full">
                          <FaHand
                            size={12}
                            className="text-white animate-pulse"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Normal layout when NOT screen sharing */}
          {!screenSharing && (
            <>
              {/* Local video - full width when alone, otherwise responsive */}
              <div
                // className={`relative rounded-2xl md:overflow-hidden ${speakingUsers.has('local') ? 'speaking-ring' : ''} ${
                className={`relative rounded-2xl md:overflow-hidden ${

                  // jointPeers.current.length - 1 <= 0
                  //   ? "w-full  h-[100%] "
                  //   : "w-full aspect-video"
                  jointPeers.current.length - 1 == 0 && isAgent
                    ? "md:absolute md:top-0 md:left-0 w-full md:h-[85vh]   rounded-2xl md:overflow-hidden flex items-center justify-center"
                    : jointPeers.current.length - 1 == 0 && !isAgent
                      ? "md:absolute md:top-0 md:left-0 w-full md:h-[85vh]  rounded-2xl md:overflow-hidden  flex items-center justify-center"
                      : jointPeers.current.length - 1 == 1 && !isAgent
                        ? "md:absolute md:top-0 md:left-0 w-full md:h-[85vh]   rounded-2xl md:overflow-hidden  flex items-center justify-center"
                        : jointPeers.current.length - 1 == 1 && isAgent
                          ? " rounded-2xl flex flex-col items-center justify-center relative md:h-[85vh] "
                          : jointPeers.current.length - 1 == 2 && !isAgent
                            ? " rounded-2xl flex flex-col items-center justify-center relative md:h-[85vh]"
                            : " relative rounded-2xl md:overflow-hidden bg-gray-800 aspect-video"
                  }`}
              >
                <video
                  ref={localVideoRef}
                  key="local-video"
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover rounded-2xl transition-opacity duration-300 ${enableVideo ? "opacity-100 z-10" : "opacity-0 z-0"
                    }`}
                  style={{ display: enableVideo ? "block" : "none" }}
                />

                {!enableVideo && (
                  <div className="absolute inset-0 w-full h-full bg-gradient-to-b from-blue-500 to-blue-700 flex items-center justify-center rounded-2xl z-10">
                    <div
                      // className={` ${speakingUsers.has('local') ? 'speaking-ring   ' : ''}  ${jointPeers.current.length - 1 <= 1
                      className={` ${speakingUsers.has('local') ? 'speaking-ring   ' : ''}  ${jointPeers.current.length - 1 <= 1

                        ? "w-20 h-20"
                        : "w-12 h-12"
                        } bg-white bg-opacity-20 rounded-full flex items-center justify-center border-2 border-white border-opacity-30`}
                    >
                      <UserOutlined
                        className={`text-white ${jointPeers.current.length - 1 <= 1
                          ? "text-3xl"
                          : "text-lg"
                          }`}
                      />
                      <div
                        className={`absolute ${jointPeers.current.length - 1 <= 1
                          ? "top-2 right-2"
                          : "top-1 right-1"
                          } bg-black bg-opacity-50 p-1 rounded`}
                      >
                        <FaVideoSlash
                          size={jointPeers.current.length - 1 <= 1 ? 20 : 12}
                          className="text-red-500 transition-all duration-300"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div
                  className={`absolute ${jointPeers.current.length - 1 <= 1
                    ? "bottom-2 right-2 z-40"
                    : "bottom-1 right-1"
                    }`}
                >
                  {!enableAudio && (
                    <div className="bg-black bg-opacity-50 p-1 rounded z-40">
                      <FaMicrophoneSlash
                        size={jointPeers.current.length - 1 <= 1 ? 20 : 12}
                        className="text-red-500 transition-all duration-300"
                      />
                    </div>
                  )}
                </div>

                {!enableVideo && (
                  <div
                    className={`  transition-all duration-300 text-sm  aspect-video bg-black bg-opacity-50  h-28 px-2 py-1 rounded text-white`}
                  >
                    {user?.user_metadata?.full_name ?? `You`}
                  </div>
                )}

                <div
                  className={`absolute ${jointPeers.current.length - 1 <= 1
                    ? "bottom-2 left-2 text-sm"
                    : "bottom-1 left-1 text-xs"
                    } bg-black bg-opacity-50 px-2 py-1 rounded text-white z-40`}
                >
                  {user?.user_metadata?.full_name ?? `You`}
                </div>

                {raisedUsers.includes(user?.id) && (
                  <div
                    className={`absolute ${jointPeers.current.length - 1 <= 1
                      ? "top-2 right-2 p-2"
                      : "top-1 right-1 p-1"
                      } bg-yellow-500 bg-opacity-80 rounded-full z-40`}
                  >
                    <FaHand
                      size={jointPeers.current.length - 1 <= 1 ? 20 : 12}
                      className="text-white animate-pulse"
                    />
                  </div>
                )}
              </div>
              {agent &&
                <div
                  className={` ${
                    // jointPeers.current.length - 1 <= 1
                    //   ? "absolute bottom-4 right-4 w-80 h-36 rounded-2xl z-50 bg-gradient-to-r from-green-500 to-green-800 flex items-center justify-center"
                    //   : "w-full aspect-video" w-80 md:h-36

                    jointPeers.current.length - 1 === 0
                      ? "mt-3 md:absolute md:bottom-8 md:right-4  md:h-36  w-80 object-cover rounded-2xl z-50 bg-gradient-to-r from-green-500 to-green-800 flex items-center justify-center"
                      : jointPeers.current.length - 1 == 1
                        ? "bg-gradient-to-b from-green-500 to-green-800  rounded-2xl flex flex-col items-center justify-center relative  md:h-[85vh]"
                        : "relative flex flex-col items-center justify-center  p-2 bg-gradient-to-b from-green-500 to-green-800 rounded-2xl aspect-video "
                    } 
                bg-gradient-to-b from-green-500 to-green-800 flex items-center justify-center` }
                  id={`video-${agentName}`}
                >
                  {/* Agent content */}
                  <div
                    className={
                      speakingAgents.has(agentName)
                        ? "agent-speaking"
                        : ""
                    }
                  >
                    <FaRobot
                      size={40}
                      className={`text-white agent-icon ${speakingAgents.has(agentName)
                        ? "speaking"
                        : ""
                        }`}
                    />
                    {speakingAgents.has(agentName) && (
                      <div className="speaking-indicator">
                        <div className="speaking-dot"></div>
                        <div className="speaking-dot"></div>
                        <div className="speaking-dot"></div>
                      </div>
                    )}
                  </div>
                  <div className="absolute bottom-0 left-0 bg-black bg-opacity-50 px-2 py-1 rounded-xl shadow text-white text-xs font-medium">
                    {agentName}
                  </div>
                </div>
              }

              {remotePeers
                .filter((peer) => peer.isAgent) // only agents
                .map((peer, index) => (
                  <div
                    key={index}
                    className={` ${
                      // jointPeers.current.length - 1 <= 1
                      //   ? "absolute bottom-4 right-4 w-80 h-36 rounded-2xl z-50 bg-gradient-to-r from-green-500 to-green-800 flex items-center justify-center"
                      //   : "w-full aspect-video" w-80 md:h-36

                      jointPeers.current.length - 1 === 0
                        ? "mt-3 md:absolute md:bottom-8 md:right-4  md:h-36  w-80 object-cover rounded-2xl z-50 bg-gradient-to-r from-green-500 to-green-800 flex items-center justify-center"
                        : jointPeers.current.length - 1 == 1
                          ? "bg-gradient-to-b from-green-500 to-green-800  rounded-2xl flex flex-col items-center justify-center relative  md:h-[85vh]"
                          : "relative flex flex-col items-center justify-center  p-2 bg-gradient-to-b from-green-500 to-green-800 rounded-2xl aspect-video "
                      } 
                bg-gradient-to-b from-green-500 to-green-800 flex items-center justify-center `}
                    id={`video-${peer.agentName}`}
                  >
                    {/* Agent content */}
                    <div
                      className={
                        speakingAgents.has(peer.agentName)
                          ? "agent-speaking"
                          : ""
                      }
                    >
                      <FaRobot
                        size={40}
                        className={`text-white agent-icon ${speakingAgents.has(peer.agentName)
                          ? "speaking"
                          : ""
                          }`}
                      />
                      {speakingAgents.has(peer.agentName) && (
                        <div className="speaking-indicator">
                          <div className="speaking-dot"></div>
                          <div className="speaking-dot"></div>
                          <div className="speaking-dot"></div>
                        </div>
                      )}
                    </div>
                    <div className={`absolute ${jointPeers.current.length - 1 <= 1
                      ? "bottom-4 left-4 text-base"
                      : "bottom-2 left-2 text-xs"
                      } bg-black bg-opacity-50 px-3 py-1 rounded-xl shadow text-white font-medium`}>
                      {peer.agentName}
                    </div>
                  </div>
                ))}


              {/* Remote Peers */}
              {remotePeers.map((peer) => (
                <div
                  key={peer.userId}
                  // className={`relative rounded-2xl md:overflow-hidden transition  ${speakingUsers.has(peer.userId) ? 'speaking-ring   ' : ''}  bg-gray-800  ${
                  className={`relative rounded-2xl md:overflow-hidden transition bg-gray-900 border border-gray-800 ${

                    // jointPeers.current.length - 1 === 0 && !peer.isAgent
                    //   ? "md:absolute md:bottom-8 md:right-4  md:h-36  w-80 object-cover rounded-2xl z-50 bg-gradient-to-r from-green-500 to-green-800 flex items-center justify-center"
                    jointPeers.current.length - 1 <= 1 && isAgent
                      ? "w-full md:h-[85vh]"
                      : jointPeers.current.length - 1 <= 1 && !isAgent
                        ? "md:absolute md:bottom-8 md:right-4  md:h-36  md:w-80 md:object-cover rounded-2xl md:z-50  w-full  flex items-center justify-center aspect-video"
                        : jointPeers.current.length - 1 <= 2 && !isAgent
                          ? "w-full md:h-[85vh]"
                          : jointPeers.current.length - 1 <= 0 && isAgent
                            ? "w-full md:h-[85vh]"
                            : "w-full aspect-video"
                    }`}
                >
                  <audio
                    ref={(ref) => {
                      if (ref && peer.stream) {
                        ref.srcObject = peer.stream;
                        if (!remoteAudioRefs.current[peer.userId]) {
                          remoteAudioRefs.current[peer.userId] = ref;
                        }
                      }
                    }}
                    autoPlay
                    playsInline
                    style={{ display: "none" }}
                  />


                  {peer.videoEnabled === true ? (
                    <video


                      ref={(ref) => {
                        if (ref && peer.stream) {
                          // Only set if it's not already set or has changed
                          if (!remoteVideoRefs.current[peer.userId]) {
                            remoteVideoRefs.current[peer.userId] = ref;
                            ref.srcObject = peer.stream;
                          } else if (ref.srcObject !== peer.stream) {
                            ref.srcObject = peer.stream;
                          }
                        }
                      }}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover rounded-2xl"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-b from-yellow-400 to-yellow-700 flex items-center justify-center rounded-2xl">
                      <div
                        className={` ${speakingUsers.has(peer.userId) ? 'speaking-ring   ' : ''}  ${jointPeers.current.length - 1 <= 1
                        // className={`   ${jointPeers.current.length - 1 <= 1

                          ? "w-20 h-20"
                          : "w-12 h-12"
                          } bg-white bg-opacity-20 rounded-full flex items-center justify-center border-2 border-white border-opacity-30`}
                      >
                        <UserOutlined
                          className={`text-white transition-all duration-300 ${jointPeers.current.length - 1 <= 1
                            ? "text-3xl"
                            : "text-lg"
                            }`}
                        />
                        <div
                          className={`absolute ${jointPeers.current.length - 1 <= 1
                            ? "top-2 right-2"
                            : "top-1 right-1"
                            } bg-black bg-opacity-50 p-1 rounded`}
                        >
                          <FaVideoSlash
                            size={jointPeers.current.length - 1 <= 1 ? 20 : 12}
                            className="text-red-500 transition-all duration-300"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  {/* </>
                  )} */}

                  {peer.micEnabled === false &&
                  {
                    /*!peer.isAgent*/
                  } && (
                      <div
                        className={`absolute ${jointPeers.current.length - 1 <= 1
                          ? "bottom-2 right-2"
                          : "bottom-1 right-1"
                          } bg-black bg-opacity-50 p-1 rounded`}
                      >
                        <FaMicrophoneSlash
                          size={jointPeers.current.length - 1 <= 1 ? 20 : 12}
                          className="text-red-500 transition-all duration-300"
                        />
                      </div>
                    )}

                  {/* {!peer.isAgent && ( */}
                  <div
                    className={`absolute ${jointPeers.current.length - 1 <= 1
                      ? "bottom-2 left-2 text-sm"
                      : "bottom-1 left-1 text-xs"
                      } bg-black bg-opacity-50 px-2 py-1 rounded text-white transition-all duration-300 ease-in-out`}
                  >
                    {/*{getRemoteName(peer.userId)}*/}
                    {peer.remoteName}
                  </div>
                  {/* )}*/}

                  {raisedUsers.includes(peer.userId) && (
                    <div
                      className={`absolute ${jointPeers.current.length - 1 <= 1
                        ? "top-2 right-2 p-2"
                        : "top-1 right-1 p-1"
                        } bg-yellow-500 bg-opacity-80 rounded-full`}
                    >
                      <FaHand
                        size={jointPeers.current.length - 1 <= 1 ? 20 : 12}
                        className="text-white animate-pulse"
                      />
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Add MeetingTranscript component */}
      {joined && enableCaptions && (
        <MeetingTranscript
          localTranscript={localTranscript}
          remoteTranscript={remoteTranscript}
        />
      )}
      {/* {activeAgent && ephemeralKey && (

         <OpenAISharedSession
          ephemeralKey={ephemeralKey}
          jointPeers={jointPeers}
          isMeetingHost={agent}
        />

      )} */}

      {showCopyBox && agent && (
        <CopyMeetingLink
          meetingLink={meetingLink}
          onClose={() => setShowCopyBox(false)}
        />
      )}
      {ephemeralKey && agent && (
        <OpenAISharedSession
          // ephemeralKey={ephemeralKey}
          jointPeers={jointPeers}
          isMeetingHost={agent}
          localTranscript={localTranscript}
          remoteTranscript={remoteTranscript}
          meetingId={id}
          socket={socket}
          documentTemplate={documentTemplate}
          onSpeakingChange={(isSpeaking) => {
            // Update host's own UI immediately
            setSpeakingAgents(prev => {
              const next = new Set(prev);
              if (isSpeaking && agentName) {
                next.add(agentName);
              } else if (agentName) {
                next.delete(agentName);
              }
              return next;
            });
            // Broadcast to all remote users in the room
            if (socket && agentName && id) {
              socket.emit("agent-speaking", {
                meetingId: id,
                agentName,
                isSpeaking,
              });
            }
          }}
        />
      )}

      {/* <RealtimeMvpVisionDisplay meetingId={id} /> */}
      {/* Add OpenAISession component */}
    </div>
  );
};
export default VideoPlayer;