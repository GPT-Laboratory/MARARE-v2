/**
 * Live meeting room — WebRTC, Socket.IO, and AI agent integration.
 * Route: /:project_id/:id
 */
import React, { useState, useRef, useEffect } from "react";
// import { io } from "socket.io-client";

import "../../public/mixkit-long-pop-2358.mp3";

import VideoPlayer from '../../components/meeting/VideoPlayer';
import RoomChat from '../../components/meeting/RoomChat';
import BottomBar from '../../components/meeting/BottomBar';
import Header from '../../components/meeting/Header';
import { useRefs } from '../../providers/RefProvider';
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  setActivateAgent,
  setEnableAudio,
  setEnableVideo,
  setIsAdmin,
  setAgent,
  setAgentName,
  setEnableCaptions,
  setAgentReady
} from '../../features/mainStates/MainStates_Slice';
import { getSocket, socketURL } from '../../services/meeting/socketInstance.jsx';
import { initializeAzureSTT, processRemoteStream, stopAllSTTRecognizers } from '../../helpers/Helper.jsx';
import MeetingAction from '../../components/meeting/MeetingAction.jsx';
import "../../styles/meeting/Content.css";
import { Switch } from "antd";
import { UserOutlined } from "@ant-design/icons";
import {
  FaVideo,
  FaVideoSlash,
  FaMicrophone,
  FaMicrophoneSlash,
  FaRobot,
} from "react-icons/fa";
import { useAuth } from '../../pages/auth/authcontext.jsx';
import AdminApprovalPanel from '../../components/meeting/AdminApprovalPanel.jsx';

import Spinner from '../../components/meeting/GradientRotatingSpinner.jsx';
import { playNotificationSound } from '../../helpers/notification.jsx';
import { Shrink } from "lucide-react";
import ConfigurationSideBar from '../../components/meeting/ConfigurationSideBar.jsx';
import AddConnectorModal from '../../components/mcp/AddConnectorModal.jsx';
import { setTeamAmvp, setTeamAvision, setTeamBmvp, setTeamBvision, setTeamCmvp, setTeamCvision, stopAutoSend, clearDocumentData } from '../../features/ReportSlice.jsx';
import { hasMeaningfulMeetingDocumentContent } from '../../utils/meetingDocumentContentUtils';
import { useSnackbar } from 'notistack'
import UserNameRequest from '../../helpers/UserNameRequest.jsx';

const Content = ({ joined, setJoined }) => {
  // const { toggleState, setToggleState } = useToggleHook();
  const roomId = useSelector((state) => state.MainStates_Slice.roomId);
  const mvpVisionRef = useRef(null);

  // console.log("roomId", roomId);
  const agent = useSelector((state) => state.MainStates_Slice.agent);
  const wantDocumentTemplate = useSelector(
    (state) => state.MainStates_Slice.wantDocumentTemplate
  );
  const reduxGeneratedDocumentSections = useSelector(
    (state) => state.reports?.generatedDocumentSections || {}
  );
  const projects = useSelector((state) => state.main.projects);
  const [showMeetingPrompt, setShowMeetingPrompt] = useState(false);
  const agentName = useSelector((state) => state.MainStates_Slice.agentName);
  const ephemeralKey = useSelector((state) => state.MainStates_Slice.ephemeralKey);
  const activeAgent = useSelector(
    (state) => state.MainStates_Slice.activateAgent
  );

  const { joinStatus, setJoinStatus, remotePeers } = useRefs();
  const [jointrequest, setJointrequest] = useState(false);
  const { user } = useAuth();
  const userName = user?.user_metadata?.full_name || "User";
  const roomId1 = window.location.pathname.split("/")[2];
  // console.log("roomId1", roomId1);
  const [toggleBarState, setToggleBarState] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [previewStream, setPreviewStream] = useState(null);
  const [isInitializingStream, setIsInitializingStream] = useState(false);
  const previewVideoRef = useRef(null);
  const { enqueueSnackbar } = useSnackbar()


  // const userId = useSelector((state) => state.MainStates_Slice.userId);
  // const remotePeers = useSelector(
  //   (state) => state.MainStates_Slice.remotePeers
  // );
  const socket = getSocket();
  // console.log("socket in the content", socket);

  // console.log(userId);

  // const socket = useSelector((state) => state.MainStates_Slice.socket);
  const enableAudio = useSelector(
    (state) => state.MainStates_Slice.enableAudio
  );
  const enableVideo = useSelector(
    (state) => state.MainStates_Slice.enableVideo
  );
  const enableCaptions = useSelector(
    (state) => state.MainStates_Slice.enableCaptions
  );
  const activateAgent = useSelector(
    (state) => state.MainStates_Slice.activateAgent
  );

  const agentReady = useSelector(
    (state) => state.MainStates_Slice.agentReady
  );
  const agentMode = useSelector(
    (state) => state.MainStates_Slice.agentMode
  );

  // console.log("agentready", agentReady);

  const {
    localVideoRef,
    localStream,
    peerConnections,
    jointPeers,
    userId,
    localTranscript,
    remoteTranscript,
    removeUserFromJointPeers,
    removeAllPeers,
    removeRemotePeer,
    remoteVideoRefs,
    setLocalTranscript,
    setRemoteTranscript,
    setRemotetranscriptView,
    setLocaltranscriptView,
    formattedTime, startTiming, stopTiming,
  } = useRefs();
  const dispatch = useDispatch();

  const { project_id, id } = useParams(); // Extract 'id' from the route
  const currentProject = projects.find(
    (project) => String(project.id) === String(project_id)
  );
  // console.log("Project ID:", project_id); // Log the project ID
  // console.log("Meeting ID:", id);
  const [messages, setMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [enableChat, setenableChat] = useState(false);
  // const [enableCaptions, setEnableCaptions] = useState(false);
  const roomId2 = useParams() // Extract roomId from the URL params
  // const remoteVideoRefs = useRef({});
  const navigate = useNavigate();
  const location = useLocation();
  // const messageSound = new Audio(
  //   "https://res.cloudinary.com/duqzgojyp/video/upload/v1737207753/tpnevoboszj1rnsdsto1.mp3"
  // ); // Add an MP3 file to your public folder
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(false);
  



  useEffect(() => {
    if (agent && enableCaptions) {
      console.log("remote peers changed", remotePeers)
      processRemoteStream(
        remotePeers,
        remoteVideoRefs,
        setRemoteTranscript,
        setRemotetranscriptView,
        remoteTranscript
      );
    }
  }, [remotePeers])

  useEffect(() => {
    console.log("Room ID in Content:", id);
    // if (!roomId) return; // Only run if roomId is available

    const getAdmin = async () => {
      try {
        const res = await fetch(`${socketURL}/get-admin/${id}`,);
        const data = await res.json();
        console.log("Admin data:", data);
        dispatch(setAgentReady(data.isAgent));
        if (data.success && data.user_id === user.id) {
          console.log("Admin user found, setting isAdmin to true");
          if (data.isAgent) {
            dispatch(setAgent(data.isAgent))
            dispatch(setAgentName(data.agentName))

          }
          dispatch(setIsAdmin(true));


          // Automatically approve admin and set join status
          if (joinStatus === "pending") {
            console.log("Auto-approving admin user");
            setJoinStatus("approved");
          }
        }
      } catch (error) {
        console.error("Error fetching admin user:", error);
      }
    };

    getAdmin();
  }, [roomId2, joinStatus, dispatch]);
  const Admin = useSelector((state) => state.MainStates_Slice.isAdmin);

  // console.log("Admin", Admin);
  const giveSuccessNotification = (message) => {
    enqueueSnackbar(message, {
      variant: 'success',
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
    })
  }
  const giveWarnNotification = (message) => {
    enqueueSnackbar(message, {
      variant: "warning",
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
    })
  }
  const giveErrorNotification = (message) => {
    enqueueSnackbar(message, {
      variant: "error",
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
    })
  }
  const giveSimpleNotification = (message) => {
    enqueueSnackbar(message, {
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
    })

  }

  const [raisedUsers, setRaisedUsers] = useState([]);
  const { isRaised } = useRefs();


  useEffect(() => {
    console.log("toogle state in content", toggleBarState);
  }, [toggleBarState]);

  useEffect(() => {
    if (enableChat) {
      // Reset unread messages flag when chat is opened
      setHasUnreadMessages(false);
    }
  }, [enableChat]);

  useEffect(() => {
    if (joinStatus === "pending" && hasPermissions && !previewStream && !isInitializingStream) {
      initializePreviewStream();
    }
  }, [joinStatus, hasPermissions, previewStream, isInitializingStream]);


  // --- Socket listeners: captions, OpenAI agent ready/active state ---
  useEffect(() => {
    if (!agent) {
      socket.on("captions-status", (data) => {
        dispatch(setEnableCaptions(data.enableCaptions));
        if (data.enableCaptions) {
          startTiming();
        } else {
          stopTiming();
        }
        // if (data.enableCaptions) {
        //   giveSuccessNotification(data.message); // "Your voice is recording"
        // } else {
        //   giveSuccessNotification(data.message); // "Recording voice stopped"
        // }
      });
    }

    socket.on('openai-agent-value', (data) => {
      console.log("new agent value", data);
      if (data.activeAgent) {
        console.log("new agent value", data.activeAgent);

        dispatch(setActivateAgent(true))
      } else {
        dispatch(setActivateAgent(false))
      }

    })

    socket.on('openai-agent-ready', ({ ready }) => {
      dispatch(setAgentReady(ready));
    });

    return () => {
      socket.off("captions-status");
      socket.off('openai-agent-ready');
      socket.off('openai-agent-value');

    };
  }, [socket]);



  // console.log("joinStatus", joinStatus);

  const handlemessage = (message) => {
    giveSuccessNotification(message)
  };

  // handle ask to join button click
  const handleAskToJoin = () => {
    if (!previewStream) {
      alert("Please initialize your camera and microphone first.");
      return;
    }
    // const email = user?.email || user?.user_metadata.email || ''
    setJointrequest(true);

    // Transfer the preview stream to main stream
    transferStreamToMain();

    if (Admin) {
      // simple_notify("You were the Admin");
      giveSuccessNotification("You were the Admin")
      setJoinStatus("approved");
      return;
    }

    console.log("audio state", enableAudio);
    console.log("video state", enableVideo);

    giveSuccessNotification("Join request sent to host!");
    socket.emit("request-to-join", {
      meetingId: roomId1,
      name: userName,
      micEnabled: enableAudio,
      videoEnabled: enableVideo,
      s_id: user.id,
    });
  };

  // Toggle functions for preview stream
  const togglePreviewVideo = () => {
    const newVideoState = !enableVideo;
    dispatch(setEnableVideo(newVideoState));

    if (previewStream) {
      const videoTrack = previewStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = newVideoState;
      }
    }
  };

  const togglePreviewAudio = () => {
    const newAudioState = !enableAudio;
    dispatch(setEnableAudio(newAudioState));

    if (previewStream) {
      const audioTrack = previewStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = newAudioState;
      }
    }
  };

  // Cleanup on unmount or when leaving
  useEffect(() => {
    return () => {
      cleanupPreviewStream();
    };
  }, []);

  // add code for broadcasting activateAgent
  // Add this useEffect to watch for activateAgent state changes
  useEffect(() => {
    // Emit to all peers when activateAgent state changes
    // if (socket ) {
    socket.emit("agent-state-changed", {
      // meetingId: meetingId,
      userId: socket.id, // or your user ID
      activateAgent: activateAgent,
    });
    console.log("Agent state changed, emitting to peers:", activateAgent);
    // }
  }, [activateAgent, socket]);

  // Add this useEffect to handle incoming agent state changes from other peers
  useEffect(() => {
    // if (socket) {
    socket.on("agent-state-update", (data) => {
      console.log("Received agent state update:", data);

      // Update the Redux state with the new agent state
      dispatch(setActivateAgent(data.activateAgent));

      // Optional: Show notification about who changed the agent state
      if (data.userId !== socket.id) {
        // notify(
        //   `Agent ${
        //     data.activateAgent ? "activated" : "deactivated"
        //   `Agent ${
        //     data.activateAgent ? "activated" : "deactivated"
        //   } by another user`
        // );
      }
    });

    return () => {
      socket.off("agent-state-update");
    };
    // }
  }, []);

  // --- Join approval: host receives requests; guests wait for approve/reject ---
  useEffect(() => {
    if (joinStatus === "pending") {
      console.log("is this working for creator");

      socket.on("join-approved", () => {
        giveSuccessNotification("Join request approved by host.");
        console.log("Join approved");
        setJoinStatus("approved");
      });

      socket.on("join-rejected", () => {
        giveWarnNotification("Join request denied by host.");
        setJoinStatus("rejected");
      });

      socket.on("join-error", (data) => {
        giveErrorNotification(data.message);
        console.error("Join error:", data.message);
        setJoinStatus("rejected");
      });

      socket.on("join-request", (data) => {
        console.log("Join request received:", data);
      });

      return () => {
        socket.off("join-approved");
        socket.off("join-rejected");
        socket.off("join-request");
        socket.off("join-error");
      };
    }
  }, []);

  useEffect(() => {
    socket.on("update_hands", (data) => {
      console.log("handrise by ", data);

      setRaisedUsers(data.raisedUsers);
      const Raised = data.isRaised;
      if (Raised) {
        playNotificationSound();
        giveSimpleNotification(`Hand is raised by ${data.userName}`);
      }
    });

    return () => {
      socket.off("update_hands");
    };
  }, [isRaised]);

  const toggleCaptions = async () => {
    console.log("toggled");

    const newCaptionsState = !enableCaptions;

    dispatch(setEnableCaptions(newCaptionsState));
    socket.emit("captions-toggled", {
      meetingId: id,
      userId: socket.id,
      enableCaptions: newCaptionsState,
    });

    if (newCaptionsState) {
      startTiming()
      console.log("Starting captions...");
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        console.log("Initializing Azure STT for agent:", agentName);
        await initializeAzureSTT(
          audioTrack,
          id,
          agentName,
          setLocalTranscript,
          setLocaltranscriptView,
          localTranscript,
          jointPeers,
          remoteVideoRefs,
          setRemoteTranscript,
          remoteTranscript,
          ephemeralKey,
          activeAgent,
          dispatch,
          agent,
        );
      }

      await processRemoteStream(
        remotePeers,
        remoteVideoRefs,
        setRemoteTranscript,
        setRemotetranscriptView,
        remoteTranscript
      );


      // handleStartAgain();

      console.log("Captions started successfully");
    } else {
      stopTiming()
      console.log("Stopping captions...");
      await stopAllSTTRecognizers();
      console.log("Captions stopped successfully");
    }
  };

  const toggleChat = () => {
    setenableChat(!enableChat);
    setHasUnreadMessages(false); // Clear notification when opening chat
  };
  const toggleBar = () => {
    setToggleBarState(!toggleBarState);
    console.log("Toggle bar state clicked:", toggleBarState);
  };

  // useEffect(() => {
  //   console.log("remote peers IN Main", remotePeers);
  // }, [remotePeers]);

  // --- Agent MVP/Vision updates from backend → Redux + rebroadcast to peers ---
  useEffect(() => {
    console.log("🔧 Setting up socket listener...");

    const handleAgentUpdates = (data) => {
      console.log("📨 Received agent updates:", data);


      // setIsGenerating(false);
      // setWaitingForResponse(false);

      // Update Redux for team data
      if (data.team_a_mvp) dispatch(setTeamAmvp(data.team_a_mvp));
      if (data.team_a_vision) dispatch(setTeamAvision(data.team_a_vision));
      if (data.team_b_mvp) dispatch(setTeamBmvp(data.team_b_mvp));
      if (data.team_b_vision) dispatch(setTeamBvision(data.team_b_vision));
      if (data.team_c_mvp) dispatch(setTeamCmvp(data.team_c_mvp));
      if (data.team_c_vision) dispatch(setTeamCvision(data.team_c_vision));





      socket.emit("mvpvision-updates", {
        meetingId: id,
        team_a_mvp: data.team_a_mvp,
        team_a_vision: data.team_a_vision,
        team_b_mvp: data.team_b_mvp,
        team_b_vision: data.team_b_vision,
        team_c_mvp: data.team_c_mvp,
        team_c_vision: data.team_c_vision,
      });

      // NO RESTART LOGIC HERE - the interval continues running automatically
      console.log("✅ Response processed - interval continues running");
      // setIsStop(false);

    };

    socket.on("agent_updates", handleAgentUpdates);

    return () => {
      console.log("🧹 Cleaning up socket listener...");
      socket.off("agent_updates", handleAgentUpdates);
    };
  }, [socket]);

  const leaveRoom = async (userID) => {
    if (agent) {
      stopTiming()
      setShowMeetingPrompt(true); // Show the MeetingAction component
      return; // Stop further execution until the user decides
    }

    // Call the complete leave logic directly if agent is not available
    leaveMeeting(userID);
  };

  /** Tear down media, socket room, and peer connections when user leaves. */
  const leaveMeeting = async (userID) => {
    console.log("working before !room");
    await stopAllSTTRecognizers();
    dispatch(stopAutoSend());

    navigate("/");

    peerConnections.current = {}; // Clear peer connections

    // Remove all remote video elements
    Object.keys(remoteVideoRefs.current).forEach((userID) => {
      const videoElement = remoteVideoRefs.current[userID];
      if (videoElement && videoElement.parentNode) {
        videoElement.parentNode.remove();
      }
    });
    remoteVideoRefs.current = {};
    // Stop local stream
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        track.stop(); // Stop each track (audio/video)
      });
      delete localStream.current;
    }
    // Inform the server that the user has left the room
    socket.emit("leave-room", roomId);
    console.log(`Emitted leave-room for roomId: ${roomId}`);
    // Leave the room on the client side
    socket.off("user-connected"); // Unsubscribe from room-specific events
    socket.off("user-disconnected");
    console.log("Left the room successfully.");
    console.log(userID);

    console.log(jointPeers);
    // Disconnect from the socket server
    socket.disconnect(); // <-- This ensures the user disconnects from the socket server
    console.log("Socket disconnected.");


    removeRemotePeer(userID);
    // console.log("remote peers after leave", remotePeers.length);
    removeUserFromJointPeers(userID);
    removeAllPeers();
    console.log("update peer after dispatch", remotePeers);

    // window.location.reload();
    navigate("/");
    if (agent) {
      navigate(`/endmeeting/${project_id}`, {
        state: { from: location.pathname },
      });
    } else {
      navigate("/");
    }
  };

  const endMeeting = async (roomId, userId) => {
    await stopAllSTTRecognizers();
    dispatch(stopAutoSend());

    const documentTemplate = currentProject?.template_document;
    const hasDocumentContent = hasMeaningfulMeetingDocumentContent({
      generatedSections: reduxGeneratedDocumentSections,
      template: documentTemplate,
    });
    const shouldSkipEndMeetingPage =
      wantDocumentTemplate && !hasDocumentContent;

    if (agent) {
      if (shouldSkipEndMeetingPage) {
        dispatch(clearDocumentData());
        navigate("/");
      } else {
        navigate(`/endmeeting/${project_id}`, {
          state: {
            from: location.pathname,
            meetingId: roomId,
            freshEndMeeting: true,
          },
        });
      }
    }

    peerConnections.current = {};

    // Remove all remote video elements
    Object.keys(remoteVideoRefs.current).forEach((userId) => {
      const videoElement = remoteVideoRefs.current[userId];
      if (videoElement && videoElement.parentNode) {
        videoElement.parentNode.remove();
      }
    });
    remoteVideoRefs.current = {};
    // Stop local stream
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        track.stop(); // Stop each track (audio/video)
      });
      delete localStream.current;
    }
    // Inform the server that the user has left the room

    console.log(`Emitted leave-room for roomId: ${roomId}`);
    socket.emit("end-meeting", roomId);
    // Leave the room on the client side
    socket.off("user-connected"); // Unsubscribe from room-specific events
    socket.off("user-disconnected");
    console.log("Delete the room successfully.");

    console.log(userId);

    console.log(jointPeers);
    // Disconnect from the socket server
    socket.disconnect(); // <-- This ensures the user disconnects from the socket server
    console.log("Socket disconnected.");

    removeRemotePeer(userId);
    removeUserFromJointPeers(userId);
    removeAllPeers();

    if (!agent) {
      navigate("/");
    }
  };
  const initializePreviewStream = async () => {
    if (previewStream) return; // Already initialized

    setIsInitializingStream(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: enableVideo,
        audio: enableAudio,
      });

      setPreviewStream(stream);

      // Set preview video element
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        previewVideoRef.current.play().catch((err) => {
          console.error("Error trying to play video:", err);
        });
      }

      console.log("Preview stream initialized:", stream);
    } catch (error) {
      console.error("Error accessing media devices:", error);
      // Handle errors similar to your existing error handling
      if (error.name === "NotAllowedError") {
        alert("Please allow access to your camera and microphone.");
      } else if (error.name === "NotFoundError") {
        alert("No camera or microphone found. Please connect a device.");
      } else {
        alert("An unexpected error occurred: " + error.message);
      }
    } finally {
      setIsInitializingStream(false);
    }
  };

  useEffect(() => {
    if (previewStream && previewVideoRef.current) {
      previewVideoRef.current.srcObject = previewStream;
      previewVideoRef.current.play().catch((err) =>
        console.error("Autoplay failed:", err)
      );
    }
  }, [previewStream]);

  // Transfer preview stream to main localStream
  const transferStreamToMain = () => {
    if (previewStream && localStream) {
      localStream.current = previewStream;

      // Set main video element
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = previewStream;
      }
      console.log("Stream transferred to main localStream");
    }
  };

  // Cleanup preview stream
  const cleanupPreviewStream = () => {
    if (previewStream) {
      previewStream.getTracks().forEach((track) => track.stop());
      setPreviewStream(null);
    }
  };

  const toggleVideo = async () => {
    console.log("in the toggle video ", enableVideo)
    const newVideoState = !enableVideo;

    // Update Redux state
    dispatch(setEnableVideo(newVideoState));

    // Update local jointPeers state
    const selfPeerIndex = jointPeers.current.findIndex(
      (peer) => peer.userId === userId
    );
    if (selfPeerIndex !== -1) {
      jointPeers.current[selfPeerIndex] = {
        ...jointPeers.current[selfPeerIndex],
        videoEnabled: newVideoState,
      };
    }

    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0];

      if (videoTrack) {
        // Simply toggle the existing video track
        videoTrack.enabled = newVideoState;
      } else if (newVideoState) {
        // Fixed: was !enableVideo, now newVideoState
        // Need to add video track when turning video ON
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false, // Don't include audio to avoid conflicts
          });
          const newVideoTrack = stream.getVideoTracks()[0];

          // Add the new video track to existing stream
          localStream.current.addTrack(newVideoTrack);

          // Update peer connections with the new video track
          // Update peer connections with the new video track
          Object.values(peerConnections.current).forEach((peerConnection) => {
            const senders = peerConnection.getSenders();
            const videoSender = senders.find(
              (s) => s.track && s.track.kind === "video"
            );

            if (videoSender) {
              videoSender.replaceTrack(newVideoTrack);
            } else {
              peerConnection.addTrack(newVideoTrack, localStream.current);
            }
          });

          // Update the local video element
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream.current;
          }
        } catch (error) {
          console.error("Error accessing camera:", error);
          dispatch(setEnableVideo(false));
          return; // Don't emit if video couldn't be enabled
        }
      }
    }

    // Small delay to ensure all changes are processed
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log("New video state in toogle:", newVideoState);

    // Emit to backend AFTER all local changes are complete
    socket.emit("video-toggle", {
      userId,
      enabled: newVideoState,
    });
  };

  const toggleAudio = () => {
    const newAudioState = !enableAudio; // Compute the new state
    dispatch(setEnableAudio(newAudioState));
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
      }
    }
    socket.emit("audio-toggle", {
      userId,
      enabled: newAudioState, // Send the new state
    });
    console.log("works socket:", socket);

    if (socket && socket.connected) {
      console.log("works in enabling:", socket.connected);

      socket.emit("audio-toggle", {
        userId,
        enabled: newAudioState,
      });
    }
  };

  // Function to send a message via the peer connection
  const sendMessage = (userId, message) => {
    const connection = peerConnections.current[userId];
    if (!connection || !connection.dataChannel) {
      console.error(`No data channel found for user: ${userId}`);
      return;
    }

    if (connection.dataChannel.readyState === "open") {
      const payload = JSON.stringify({ text: message });
      connection.dataChannel.send(payload);
    } else {
      console.error(
        `Data channel is not open for user: ${userId}, current state: ${connection.dataChannel.readyState}`
      );
    }
  };
  // Function to add messages to the chat UI
  const addMessageToChat = (sender, text) => {
    setMessages((prev) => [...prev, { sender, text }]);
    // Play sound if message is from others
    console.log("sendser of message", sender);
    if (sender !== "You" && text.trim() !== "") {
      // messageSound
      //   .play()
      //   .catch((err) => console.log("Error playing sound:", err));

      // Set unread messages flag if chat is not open
      if (!enableChat) {
        setHasUnreadMessages(true);
      }
    }
  };
  // Function to handle sending a message
  const handleSendMessage = () => {
    if (currentMessage.trim() === "") return;

    // Add the message to the local chat
    addMessageToChat("You", currentMessage);

    // Send the message to all connected peers
    Object.keys(peerConnections.current).forEach((peerId) => {
      sendMessage(peerId, currentMessage);
    });

    // Clear the input field
    setCurrentMessage("");
  };

  const handleLeaveMeeting = (userID) => {
    setShowMeetingPrompt(false); // Hide the modal
    leaveMeeting(userID);
  };

  const handleEndMeeting = (roomId, userId) => {
    setShowMeetingPrompt(false); // Hide the modal

    endMeeting(roomId, userId);
  };
  
  const [permissionStatus, setPermissionStatus] = useState({
    camera: "prompt",
    microphone: "prompt",
  });

  // Check permissions on component mount
  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      // Check camera permission
      const cameraPermission = await navigator.permissions.query({
        name: "camera",
      });
      // Check microphone permission
      const microphonePermission = await navigator.permissions.query({
        name: "microphone",
      });

      const newPermissionStatus = {
        camera: cameraPermission.state,
        microphone: microphonePermission.state,
      };

      setPermissionStatus(newPermissionStatus);

      // Update hasPermissions based on both permissions being granted
      const bothGranted =
        cameraPermission.state === "granted" &&
        microphonePermission.state === "granted";
      setHasPermissions(bothGranted);

      // Listen for permission changes
      cameraPermission.onchange = () => {
        checkPermissions();
      };

      microphonePermission.onchange = () => {
        checkPermissions();
      };
    } catch (error) {
      console.error("Error checking permissions:", error);
      alert("Error checking permission");
      // Fallback: try to access media to trigger permission prompt
    }
  };

  const setPermissions = async () => {
    try {
      // Ask for camera + microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // Update permission status
      setPermissionStatus({
        camera: "granted",
        microphone: "granted",
      });
      setHasPermissions(true);

      // Stop tracks so it doesn't keep camera/mic on
      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.error("Permission denied:", err);

      setPermissionStatus({
        camera: "denied",
        microphone: "denied",
      });
      setHasPermissions(false);
    }
  };


  const getPermissionText = () => {
    if (
      permissionStatus.camera === "denied" ||
      permissionStatus.microphone === "denied"
    ) {
      return "Camera and microphone access denied. Please enable permissions in your browser settings.";
    } else if (!hasPermissions) {
      return "Please allow camera and microphone access to join the meeting.";
    }
    return "";
  };

  /** UI switches by joinStatus: pending preview → waiting → active meeting layout */
  const renderStream = () => {
    switch (joinStatus) {
      case "pending":

        return (
          <div className="content-meeting-page flex flex-col lg:flex-row gap-8 lg:gap-12 items-center justify-center min-h-screen p-4 lg:p-8 bg-black text-white">
            {/* Video Preview Section */}
            <div className="w-full max-w-sm lg:max-w-2xl order-1 lg:order-1">
              <div className="w-full aspect-video rounded-lg overflow-hidden relative shadow-lg bg-gray-900">
                {previewStream ? (
                  <>
                    <video
                      ref={previewVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${enableVideo ? "opacity-100" : "opacity-0"
                        }`}
                    />
                    {!enableVideo && (
                      <div className="absolute inset-0 bg-gradient-to-b from-blue-500 to-blue-700 flex items-center justify-center">
                        <div className="w-16 h-16 lg:w-20 lg:h-20 bg-white bg-opacity-20 rounded-full flex items-center justify-center border-2 border-white border-opacity-30">
                          <UserOutlined className="text-white text-2xl lg:text-3xl" />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-900">
                    <div className="text-center">
                      <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-full flex items-center justify-center mx-auto mb-2 bg-gray-800">
                        <UserOutlined className="text-2xl lg:text-3xl text-gray-300" />
                      </div>
                      <p className="text-sm lg:text-base text-gray-300">
                        {isInitializingStream ? "Initializing camera..." : "Camera not initialized"}
                      </p>
                    </div>
                  </div>
                )}

                {/* Preview Controls */}
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-4">
                  <button
                    onClick={togglePreviewVideo}
                    disabled={!previewStream}
                    className={`p-3 rounded-full transition-all duration-200 ${enableVideo
                      ? "bg-gray-700 hover:bg-gray-600"
                      : "bg-red-600 hover:bg-red-700"
                      } ${!previewStream ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {enableVideo ? (
                      <FaVideo className="text-white" />
                    ) : (
                      <FaVideoSlash className="text-white" />
                    )}
                  </button>

                  <button
                    onClick={togglePreviewAudio}
                    disabled={!previewStream}
                    className={`p-3 rounded-full transition-all duration-200 ${enableAudio
                      ? "bg-gray-700 hover:bg-gray-600"
                      : "bg-red-600 hover:bg-red-700"
                      } ${!previewStream ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {enableAudio ? (
                      <FaMicrophone className="text-white" />
                    ) : (
                      <FaMicrophoneSlash className="text-white" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Controls Section */}
            <div className="w-full max-w-md order-2 lg:order-2 text-center lg:text-left">
              <h2 className="text-2xl lg:text-3xl font-bold mb-6">
                Ready to join?
              </h2>

              {jointrequest && (
                <p className="text-yellow-400 mb-4">
                  Waiting for host approval...
                </p>
              )}

              {/* Permission and Join Section */}
              {jointrequest ? (
                <div className="flex justify-center lg:justify-start">
                  <Spinner />
                </div>
              ) : (
                <div className="flex flex-col items-center lg:items-start space-y-4">
                  {/* Removed the manual "Start Camera & Microphone" button */}
                  {isInitializingStream && (
                    <div className="w-full text-center lg:text-left">
                      <p className="text-blue-400 text-sm">
                        Initializing camera and microphone...
                      </p>
                    </div>
                  )}

                  <button
                    onClick={handleAskToJoin}
                    disabled={!previewStream || !hasPermissions}
                    className={`w-full lg:w-auto font-bold py-3 px-6 lg:px-8 rounded-lg transition-all duration-300 ${previewStream && hasPermissions
                      ? "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                      : "bg-gray-800 text-gray-400 cursor-not-allowed opacity-50"
                      }`}
                  >
                    Ask to Join
                  </button>

                  {!hasPermissions && (
                    <div className="w-full text-center lg:text-left">
                      <p className="text-yellow-400 text-sm max-w-md mx-auto lg:mx-0 mb-3">
                        {getPermissionText()}
                      </p>
                      <button
                        onClick={setPermissions}
                        className="w-full lg:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm shadow-md hover:shadow-lg"
                      >
                        Set Permissions
                      </button>
                      <div className="mt-3 text-xs text-gray-400">
                        <p>
                          Status: Camera - {permissionStatus.camera}, Microphone - {permissionStatus.microphone}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      case "rejected":
        return (
          <div className="content-meeting-page flex flex-col items-center justify-center h-screen bg-black text-white">
            <h2 className="text-2xl font-bold mb-4">Join Request Denied</h2>
            <p className="mb-6">The host has declined your request to join.</p>
            <button
              onClick={() => {
                cleanupPreviewStream();
                navigate("/");
              }}
              className="text-white font-bold py-2 px-4 rounded bg-gray-700 hover:bg-gray-600"
            >
              Return Home
            </button>
          </div>
        );
      case "approved":
        if (previewStream && !localStream.current) {
          transferStreamToMain();
        }
        return (
          <>
            <div
              className={`content-meeting-page w-full h-screen overflow-visible transition-all duration-300 bg-black text-white ${enableChat && "flex justify-between"
                } `}
            >
              {activateAgent && !agentReady && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-[1000]">
                  {/* // <div className="absolute top-0 right-0  bg-opacity-60 flex items-center justify-center z-[1000]" > */}
                  <div className="p-5 rounded-2xl shadow-xl w-full max-w-sm flex flex-col items-center animate-fade-in bg-gray-900 text-white border border-gray-700">

                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>

                    <h2 className="text-lg font-semibold text-white">Preparing AI Agent…</h2>
                    <p className="text-sm text-gray-400 mt-1">
                      Initializing secure connection, please wait.
                    </p>
                  </div>
                </div>
              )}


              {/* Agent Status Indicator */}
              {agentReady && (
                <div className="absolute top-0 right-0 bg-opacity-60 flex items-center justify-center z-[1000]">
                  {agentMode === "active" ? (
                    // ACTIVE MODE - Agent is responding
                    <div className="p-3 px-10 rounded-2xl shadow-xl w-full max-w-sm flex flex-col items-center animate-fade-in border-2 border-blue-400 bg-gray-900 text-white">
                      <div className="relative">
                        <svg className="w-10 h-10 text-blue-600 animate-pulse mb-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                        </svg>
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping"></span>
                      </div>
                      <h2 className="text-lg font-semibold text-blue-700">🎤 Agent Active</h2>
                      <p className="text-sm text-blue-600 mt-1 text-center">
                        Agent is responding to you. Say <span className="font-bold ">"stop"</span> to pause.
                      </p>
                    </div>
                  ) : (
                    // LISTENING MODE - Agent is silently listening
                    <div className="p-3 px-10 rounded-2xl shadow-xl w-full max-w-sm flex flex-col items-center animate-fade-in border-2 border-green-300 bg-gray-900 text-white">
                      <div className="relative">
                        <svg className="w-10 h-10 text-green-600 mb-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93h2c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V19h4v2H8v-2h4v-3.07z" />
                        </svg>
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                      </div>
                      <h2 className="text-lg font-semibold text-green-700">{agent ? "🎧 Agent Listening" : " Agent is Ready"}</h2>
                      {agent && (
                        <p className="text-sm text-green-600 mt-1 text-center">
                          Say <span className="font-bold">"{agentName}"</span> to ask questions.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}


              <div
                className={`flex w-full h-full  gap-4 transition-all duration-300 ${toggleBarState ? "blur-sm" : ""
                  }`}
              >
                {/* <Header /> */}
                <div
                  className={`   h-[92%]  w-full flex flex-col justify-between flex-grow min-w-0 ${enableChat || toggleBarState ? "shrink-3" : "shrink-0"
                    } `}
                >

                  <VideoPlayer
                    joined={joined}
                    setJoined={setJoined}
                    addMessageToChat={addMessageToChat}
                    handleSendMessage={handleSendMessage}
                    toggleChat={toggleChat}
                    enableChat={enableChat}
                    enableCaptions={enableCaptions}
                    setenableChat={setenableChat}
                    setEnableCaptions={setEnableCaptions}
                    raisedUsers={raisedUsers}
                  />
                  {/* {console.log("socket inner: ", socket)} */}
                  <BottomBar
                    enableVideo={enableVideo}
                    toggleVideo={toggleVideo}
                    enableAudio={enableAudio}
                    toggleAudio={toggleAudio}
                    enableCaptions={enableCaptions}
                    toggleCaptions={toggleCaptions}
                    enableChat={enableChat}
                    toggleChat={toggleChat}
                    leaveRoom={leaveRoom}
                    userId1={userId}
                    hasUnreadMessages={hasUnreadMessages}
                    messages={messages}
                    socket={socket}
                    meetingId={id}
                    toggleBar={toggleBar}
                    toggleBarState={toggleBarState}
                    isPopupOpen={isPopupOpen}
                    setIsPopupOpen={setIsPopupOpen}
                    mvpVisionRef={mvpVisionRef}
                  />
                </div>

                {enableChat && !toggleBarState && (
                  <div className="w-[15vw] shrink-0 h-full relative top-4 right-2">
                    <RoomChat
                      messages={messages}
                      currentMessage={currentMessage}
                      setCurrentMessage={setCurrentMessage}
                      handleSendMessage={handleSendMessage}
                      onClose={() => setenableChat(false)} // Close chat without sending message
                    />
                  </div>
                )}
              </div>

              {toggleBarState && (
                <ConfigurationSideBar
                  toggleBarState={toggleBarState}
                  toggleBar={toggleBar}
                />
              )}

              {enableCaptions && (
                <div className="absolute top-0 left-1/2 transform z-[1000] -translate-x-1/2 bg-blue-700 bg-opacity-60 text-white px-2 py-2 rounded-lg max-w-xl w-11/12 text-center">
                  <p className="text-sm lg:text-base">
                    Meeting is in recording mode
                    (
                      <span>⏱ Time: {formattedTime}</span>
                    )
                  </p>
                </div>
              )}
              <AddConnectorModal
                open={isPopupOpen}
                onClose={() => setIsPopupOpen(false)}
              />

              {showMeetingPrompt && (
                <MeetingAction
                  onEndMeeting={handleEndMeeting}
                  onLeaveMeeting={handleLeaveMeeting}
                  onClose={() => setShowMeetingPrompt(false)} // Close without any action
                />
              )}
              {Admin && (
                <AdminApprovalPanel
                  socket={socket}
                  roomId={roomId}
                  handlemessage={handlemessage}
                />
              )}

              {userName == "User" && (
                <UserNameRequest />
              )}
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <>

      {renderStream()}
    </>
  );
};
// }
export default Content;
