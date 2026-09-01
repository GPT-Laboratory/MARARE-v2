/**
 * Meeting helpers — Azure STT, remote stream processing, agent audio.
 * File: src/helpers/Helper.jsx
 */
import axios from "axios";
import { getSocket, socketURL } from "../services/meeting/socketInstance.jsx";
import { APP_URLS } from "../config/baseUrls.js";
// import { writeFileSync } from "fs";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import {
  setMVP,
  setVision,
  setAgentShouldRespond,
  setAgentMode,
} from "../features/mainStates/MainStates_Slice.jsx";
import store from "../store/store.jsx";
import OpenAISession from "../components/meeting/OpenAISession.jsx";
import { Fetch } from "socket.io-client";

let isProcessing = false;
let processingTimeout = null;
let azureSTTRecognizer = null;

const azureConfig = {
  key: import.meta.env.VITE_KEY,
  region: import.meta.env.VITE_REGION,
};
let isSpeaking = false;

let isSTTSessionActive = false;
let localSTTContext = null;
let localRestartTimer = null;
let localHealthCheckTimer = null;
let localAudioMonitor = null;
let lastLocalRecognitionAt = 0;
let localRecognizerStartedAt = 0;

const azureSTTRecognizers = {};
const remoteSTTContexts = {};
const remoteRestartTimers = {};
const remoteHealthTimers = {};
const remoteAudioMonitors = {};
const remoteLastRecognitionAt = {};
const remoteRecognizerStartedAt = {};
const processedRemotePeers = new Set();
const remoteTranscriptTracking = {};

let lastLocalTranscript = "";
let lastLocalTimestamp = 0;
const DUPLICATE_THRESHOLD_MS = 200;
const STT_SILENCE_TIMEOUT_MS = 3600000; // 1 hour - keep Azure session alive during quiet moments
const STT_RESTART_DELAY_MS = 0; // Restart immediately on failure
const STT_RETRY_DELAY_MS = 800;
const STT_HEALTH_POLL_MS = 3000;
const STT_SPEECH_RMS_THRESHOLD = 0.018;
const STT_SPEECH_MIN_MS = 1200; // speech must be present this long before stale check
const STT_STALE_WHILE_SPEECH_MS = 4000; // restart if speaking but STT silent this long
const STT_PROACTIVE_REFRESH_MS = 8 * 60 * 1000; // refresh before Azure ~10 min connection limit

let isLocalSTTRestarting = false;
const isRemoteSTTRestarting = {};

const toMediaStream = (audioStream) => {
  if (!audioStream) return null;
  return audioStream instanceof MediaStream
    ? audioStream
    : new MediaStream([audioStream]);
};

const buildSpeechConfig = () => {
  const speechConfig = sdk.SpeechConfig.fromSubscription(
    azureConfig.key,
    azureConfig.region
  );
  speechConfig.speechRecognitionLanguage = "en-US";
  // Dictation mode keeps Azure listening for long meeting speech instead of stopping after phrases
  speechConfig.enableDictation();
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
    String(STT_SILENCE_TIMEOUT_MS)
  );
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
    String(STT_SILENCE_TIMEOUT_MS)
  );
  speechConfig.setProperty(
    sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
    "2000"
  );
  return speechConfig;
};

const startContinuousRecognition = (recognizer) =>
  new Promise((resolve, reject) => {
    recognizer.startContinuousRecognitionAsync(resolve, reject);
  });

const closeRecognizerSafely = (recognizer, fast = false) => {
  if (!recognizer) return Promise.resolve();

  if (fast) {
    try {
      recognizer.close();
    } catch (e) {
      console.warn("Error fast-closing recognizer:", e);
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      recognizer.stopContinuousRecognitionAsync(
        () => {
          try {
            recognizer.close();
          } catch (e) {
            console.warn("Error closing recognizer:", e);
          }
          resolve();
        },
        () => {
          try {
            recognizer.close();
          } catch (e) {
            console.warn("Error closing recognizer after stop failure:", e);
          }
          resolve();
        }
      );
    } catch (e) {
      console.warn("Error stopping recognizer:", e);
      resolve();
    }
  });
};

const clearLocalSTTTimers = () => {
  if (localRestartTimer) {
    clearTimeout(localRestartTimer);
    localRestartTimer = null;
  }
  if (localHealthCheckTimer) {
    clearInterval(localHealthCheckTimer);
    localHealthCheckTimer = null;
  }
  stopLocalAudioMonitor();
};

const stopLocalAudioMonitor = () => {
  if (localAudioMonitor?.intervalId) {
    clearInterval(localAudioMonitor.intervalId);
    localAudioMonitor.audioContext?.close?.().catch(() => {});
    localAudioMonitor = null;
  }
};

const stopRemoteAudioMonitor = (userId) => {
  const monitor = remoteAudioMonitors[userId];
  if (monitor?.intervalId) {
    clearInterval(monitor.intervalId);
    monitor.audioContext?.close?.().catch(() => {});
    delete remoteAudioMonitors[userId];
  }
};

const clearRemoteRestartTimer = (userId) => {
  if (remoteRestartTimers[userId]) {
    clearTimeout(remoteRestartTimers[userId]);
    delete remoteRestartTimers[userId];
  }
};

const clearRemoteHealthTimer = (userId) => {
  if (remoteHealthTimers[userId]) {
    clearInterval(remoteHealthTimers[userId]);
    delete remoteHealthTimers[userId];
  }
  stopRemoteAudioMonitor(userId);
};

const measureSpeechRms = (analyser, buffer) => {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = (buffer[i] - 128) / 128;
    sum += sample * sample;
  }
  return Math.sqrt(sum / buffer.length);
};

const startAudioActivityMonitor = ({
  stream,
  onSpeechWithoutStt,
  getLastRecognitionAt,
  getRecognizerStartedAt,
  onProactiveRefresh,
}) => {
  try {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.fftSize);
    let speechActiveSince = 0;

    const intervalId = setInterval(() => {
      if (!isSTTSessionActive) return;

      const recognizerAge = Date.now() - getRecognizerStartedAt();
      if (recognizerAge > STT_PROACTIVE_REFRESH_MS) {
        onProactiveRefresh();
        speechActiveSince = 0;
        return;
      }

      const rms = measureSpeechRms(analyser, buffer);
      if (rms > STT_SPEECH_RMS_THRESHOLD) {
        if (!speechActiveSince) speechActiveSince = Date.now();

        const speechMs = Date.now() - speechActiveSince;
        const sttIdleMs = Date.now() - getLastRecognitionAt();
        if (speechMs >= STT_SPEECH_MIN_MS && sttIdleMs >= STT_STALE_WHILE_SPEECH_MS) {
          onSpeechWithoutStt();
          speechActiveSince = 0;
        }
      } else {
        speechActiveSince = 0;
      }
    }, 400);

    return { intervalId, audioContext };
  } catch (error) {
    console.warn("Could not start audio activity monitor:", error);
    return null;
  }
};

const scheduleLocalSTTRestart = (reason, delay = STT_RESTART_DELAY_MS) => {
  if (!isSTTSessionActive || localRestartTimer) return;
  console.warn(`Scheduling local STT restart (${reason}) in ${delay}ms`);
  localRestartTimer = setTimeout(async () => {
    localRestartTimer = null;
    if (!isSTTSessionActive || !localSTTContext) return;
    try {
      await createAndStartLocalRecognizer();
    } catch (error) {
      console.error("Local STT restart failed:", error);
      scheduleLocalSTTRestart("retry after failure", STT_RETRY_DELAY_MS);
    }
  }, delay);
};

const scheduleRemoteSTTRestart = (userId, reason, delay = STT_RESTART_DELAY_MS) => {
  if (!isSTTSessionActive || remoteRestartTimers[userId]) return;
  console.warn(`Scheduling remote STT restart for ${userId} (${reason}) in ${delay}ms`);
  remoteRestartTimers[userId] = setTimeout(async () => {
    delete remoteRestartTimers[userId];
    const ctx = remoteSTTContexts[userId];
    if (!isSTTSessionActive || !ctx) return;
    try {
      await createAndStartRemoteRecognizer(userId, ctx);
    } catch (error) {
      console.error(`Remote STT restart failed for ${userId}:`, error);
      scheduleRemoteSTTRestart(userId, "retry after failure", STT_RETRY_DELAY_MS);
    }
  }, delay);
};

const attachLocalRecoveryHandlers = (recognizer) => {
  recognizer.canceled = (_s, e) => {
    console.warn("Local STT canceled:", e.reason, e.errorDetails || "");
    if (!isSTTSessionActive) return;
    if (
      e.reason === sdk.CancellationReason.Error ||
      e.reason === sdk.CancellationReason.EndOfStream
    ) {
      scheduleLocalSTTRestart(`canceled:${e.reason}`);
    }
  };

  recognizer.sessionStopped = () => {
    console.warn("Local STT session stopped");
    if (isSTTSessionActive && !isLocalSTTRestarting) {
      scheduleLocalSTTRestart("sessionStopped");
    }
  };

  recognizer.recognizing = () => {
    lastLocalRecognitionAt = Date.now();
  };
};

const attachRemoteRecoveryHandlers = (recognizer, userId) => {
  recognizer.canceled = (_s, e) => {
    console.warn(`Remote STT canceled for ${userId}:`, e.reason, e.errorDetails || "");
    if (azureSTTRecognizers[userId] === recognizer) {
      delete azureSTTRecognizers[userId];
    }
    if (!isSTTSessionActive) return;
    if (
      e.reason === sdk.CancellationReason.Error ||
      e.reason === sdk.CancellationReason.EndOfStream
    ) {
      scheduleRemoteSTTRestart(userId, `canceled:${e.reason}`);
    }
  };

  recognizer.sessionStopped = () => {
    console.warn(`Remote STT session stopped for ${userId}`);
    if (azureSTTRecognizers[userId] === recognizer) {
      delete azureSTTRecognizers[userId];
    }
    if (isSTTSessionActive && remoteSTTContexts[userId] && !isRemoteSTTRestarting[userId]) {
      scheduleRemoteSTTRestart(userId, "sessionStopped");
    }
  };
};

const handleLocalRecognized = async (recognizedText) => {
  const ctx = localSTTContext;
  if (!ctx || !recognizedText) return;

  const {
    agentName,
    setLocalTranscript,
    setLocaltranscriptView,
    dispatch,
  } = ctx;

  // Read live Redux flags — STT context can be stale after RealtimeMvpVisionDisplay
  // re-inits speech recognition during document generation.
  const mainState = store.getState().MainStates_Slice;
  const isMeetingHost = Boolean(ctx.isMeetingHost || mainState.agent);
  const activeAgent = Boolean(mainState.activateAgent);

  const socket = getSocket();
  const currentTime = Date.now();
  lastLocalRecognitionAt = currentTime;

  console.log("recognized text:", recognizedText);

  if (
    recognizedText === lastLocalTranscript &&
    currentTime - lastLocalTimestamp < DUPLICATE_THRESHOLD_MS
  ) {
    console.log("Duplicate local transcript detected, skipping:", recognizedText);
    return;
  }

  lastLocalTranscript = recognizedText;
  lastLocalTimestamp = currentTime;

  console.log(`Local Peer: in  ${recognizedText}`);
  socket.emit("localtranscript in helper", { text: recognizedText });

  setLocalTranscript((prevTranscript) => {
    if (prevTranscript[prevTranscript.length - 1] === recognizedText) {
      return prevTranscript;
    }
    return [...prevTranscript, recognizedText];
  });

  setLocaltranscriptView((prevTranscript) => {
    const newTranscript = { text: recognizedText, timestamp: currentTime };
    if (
      prevTranscript.length > 0 &&
      prevTranscript[prevTranscript.length - 1].text === recognizedText
    ) {
      return prevTranscript;
    }
    return [...prevTranscript, newTranscript];
  });

  const lowerText = recognizedText.toLowerCase();
  const includesStopCommand = /\bstop\b/i.test(recognizedText);
  const includesAgentName = lowerText.includes(agentName.toLowerCase());

  if (includesStopCommand) {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    isSpeaking = false;
  }

  if (includesStopCommand && isMeetingHost) {
    console.log("Stop command detected - switching agent to LISTENING mode");
    dispatch(setAgentMode("listening"));
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
  }

  if (includesAgentName && !includesStopCommand && isMeetingHost && activeAgent) {
    console.log(`Agent "${agentName}" was called - switching to ACTIVE mode!`);
    dispatch(setAgentShouldRespond(true));
  }
};

const startLocalHealthMonitor = () => {
  clearLocalSTTTimers();
  lastLocalRecognitionAt = Date.now();
  localRecognizerStartedAt = Date.now();

  const mediaStream = toMediaStream(localSTTContext?.audioStream);
  if (mediaStream) {
    const monitor = startAudioActivityMonitor({
      stream: mediaStream,
      getLastRecognitionAt: () => lastLocalRecognitionAt,
      getRecognizerStartedAt: () => localRecognizerStartedAt,
      onSpeechWithoutStt: () => {
        console.warn("Speech detected but local STT is stale - immediate restart");
        scheduleLocalSTTRestart("speech-without-stt", 0);
      },
      onProactiveRefresh: () => {
        console.log("Proactive local STT refresh before Azure session limit");
        scheduleLocalSTTRestart("proactive-refresh", 0);
      },
    });
    if (monitor) localAudioMonitor = monitor;
  }

  localHealthCheckTimer = setInterval(() => {
    if (!isSTTSessionActive || !localSTTContext) return;

    const mediaStream = toMediaStream(localSTTContext.audioStream);
    const audioTrack = mediaStream?.getAudioTracks?.()[0];
    const micEnabled = audioTrack?.enabled && audioTrack?.readyState === "live";
    if (!micEnabled) return;

    if (!azureSTTRecognizer?.recognizer) {
      scheduleLocalSTTRestart("missing-recognizer", 0);
    }
  }, STT_HEALTH_POLL_MS);
};

const startRemoteHealthMonitor = (userId, track) => {
  clearRemoteHealthTimer(userId);
  remoteLastRecognitionAt[userId] = Date.now();
  remoteRecognizerStartedAt[userId] = Date.now();

  const stream = new MediaStream([track]);
  const monitor = startAudioActivityMonitor({
    stream,
    getLastRecognitionAt: () => remoteLastRecognitionAt[userId] || 0,
    getRecognizerStartedAt: () => remoteRecognizerStartedAt[userId] || 0,
    onSpeechWithoutStt: () => {
      console.warn(`Speech detected but remote STT stale for ${userId} - immediate restart`);
      scheduleRemoteSTTRestart(userId, "speech-without-stt", 0);
    },
    onProactiveRefresh: () => {
      console.log(`Proactive remote STT refresh for ${userId}`);
      scheduleRemoteSTTRestart(userId, "proactive-refresh", 0);
    },
  });

  if (monitor) remoteAudioMonitors[userId] = monitor;

  remoteHealthTimers[userId] = setInterval(() => {
    if (!isSTTSessionActive || !remoteSTTContexts[userId]) return;
    if (!track.enabled || track.readyState !== "live") return;
    if (!azureSTTRecognizers[userId]) {
      scheduleRemoteSTTRestart(userId, "missing-recognizer", 0);
    }
  }, STT_HEALTH_POLL_MS);
};

const createAndStartLocalRecognizer = async () => {
  const ctx = localSTTContext;
  if (!ctx || !isSTTSessionActive) return;

  isLocalSTTRestarting = true;
  try {
    if (azureSTTRecognizer?.recognizer) {
      await closeRecognizerSafely(azureSTTRecognizer.recognizer, true);
      azureSTTRecognizer = null;
    }

    const mediaStream = toMediaStream(ctx.audioStream);
    if (!mediaStream?.getAudioTracks()?.length) {
      throw new Error("No audio track available for transcription");
    }

    const speechConfig = buildSpeechConfig();
    const audioConfig = sdk.AudioConfig.fromStreamInput(mediaStream);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    recognizer.recognized = async (_s, e) => {
      if (e.result.text) {
        await handleLocalRecognized(e.result.text);
      }
    };

    attachLocalRecoveryHandlers(recognizer);

    const audioTrack = mediaStream.getAudioTracks()[0];
    if (audioTrack && !audioTrack._sttTrackListenerAttached) {
      audioTrack._sttTrackListenerAttached = true;
      audioTrack.addEventListener("ended", () => {
        if (isSTTSessionActive) scheduleLocalSTTRestart("audio track ended", 0);
      });
      audioTrack.addEventListener("mute", () => {
        lastLocalRecognitionAt = Date.now();
      });
      audioTrack.addEventListener("unmute", () => {
        if (isSTTSessionActive) scheduleLocalSTTRestart("audio track unmuted", 0);
      });
    }

    azureSTTRecognizer = { recognizer, speechConfig };
    await startContinuousRecognition(recognizer);
    lastLocalRecognitionAt = Date.now();
    localRecognizerStartedAt = Date.now();
    console.log("Azure Speech-to-Text listening on meeting audio stream");
  } finally {
    isLocalSTTRestarting = false;
  }
};

export const initializeAzureSTT = async (
  audioStream,
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
  isMeetingHost = false,
) => {
  try {
    console.log("Initializing Azure Speech-to-Text...");

    isSTTSessionActive = true;
    localSTTContext = {
      audioStream,
      agentName,
      setLocalTranscript,
      setLocaltranscriptView,
      activeAgent,
      dispatch,
      isMeetingHost,
    };

    await createAndStartLocalRecognizer();
    startLocalHealthMonitor();
  } catch (error) {
    console.error("Error initializing Azure STT:", error);
    throw error;
  }
};

const createAndStartRemoteRecognizer = async (userId, ctx) => {
  const { remoteName, track, setRemoteTranscript, setRemotetranscriptView } = ctx;

  if (!isSTTSessionActive || !track || track.readyState === "ended") {
    return;
  }

  isRemoteSTTRestarting[userId] = true;
  try {
    if (azureSTTRecognizers[userId]) {
      await closeRecognizerSafely(azureSTTRecognizers[userId], true);
      if (azureSTTRecognizers[userId]) {
        delete azureSTTRecognizers[userId];
      }
    }

    if (!isSTTSessionActive) return;

    if (!azureSTTRecognizer?.speechConfig) {
      throw new Error("Azure STT not initialized. Call initializeAzureSTT() first.");
    }

    const remoteMediaStream = new MediaStream([track]);
    const audioConfig = sdk.AudioConfig.fromStreamInput(remoteMediaStream);
    const recognizer = new sdk.SpeechRecognizer(
      azureSTTRecognizer.speechConfig,
      audioConfig
    );

    if (!isSTTSessionActive) {
      closeRecognizerSafely(recognizer, true);
      return;
    }

    azureSTTRecognizers[userId] = recognizer;

    if (!remoteTranscriptTracking[userId]) {
      remoteTranscriptTracking[userId] = { lastText: "", lastTimestamp: 0 };
    }

    recognizer.recognizing = () => {
      remoteLastRecognitionAt[userId] = Date.now();
    };

    recognizer.recognized = (_s, e) => {
      if (!isSTTSessionActive) return;
      if (e.result.text) {
        const recognizedText = e.result.text.trim();
        if (!recognizedText) return;

        const currentTime = Date.now();
        remoteLastRecognitionAt[userId] = currentTime;
        const userTracking = remoteTranscriptTracking[userId];
        if (!userTracking) return;

        if (
          recognizedText === userTracking.lastText &&
          currentTime - userTracking.lastTimestamp < DUPLICATE_THRESHOLD_MS
        ) {
          return;
        }

        userTracking.lastText = recognizedText;
        userTracking.lastTimestamp = currentTime;

        console.log(`Remote Voice (${remoteName}): ${recognizedText}`);

        setRemoteTranscript((prev) => {
          const prevArr = prev[remoteName] || [];
          if (prevArr[prevArr.length - 1] === recognizedText) return prev;
          return { ...prev, [remoteName]: [...prevArr, recognizedText] };
        });

        setRemotetranscriptView((prev) => {
          const prevArr = prev[remoteName] || [];
          const newTranscript = { text: recognizedText, timestamp: currentTime };
          if (prevArr.length > 0 && prevArr[prevArr.length - 1].text === recognizedText) {
            return prev;
          }
          return { ...prev, [remoteName]: [...prevArr, newTranscript] };
        });
      }
    };

    attachRemoteRecoveryHandlers(recognizer, userId);

    if (!track._sttRemoteTrackListenerAttached) {
      track._sttRemoteTrackListenerAttached = true;
      track.addEventListener("ended", () => {
        if (azureSTTRecognizers[userId]) {
          delete azureSTTRecognizers[userId];
        }
        if (isSTTSessionActive && remoteSTTContexts[userId]) {
          scheduleRemoteSTTRestart(userId, "remote track ended", 0);
        }
      });
    }

    await startContinuousRecognition(recognizer);

    if (!isSTTSessionActive) {
      await closeRecognizerSafely(recognizer, true);
      if (azureSTTRecognizers[userId] === recognizer) {
        delete azureSTTRecognizers[userId];
      }
      return;
    }

    remoteLastRecognitionAt[userId] = Date.now();
    remoteRecognizerStartedAt[userId] = Date.now();
    startRemoteHealthMonitor(userId, track);
    console.log(`Continuous Recognition Started for remote voice (${remoteName})`);
  } finally {
    isRemoteSTTRestarting[userId] = false;
  }
};

export const processRemoteStream = async (
  remotePeers,
  remoteVideoRefs,
  setRemoteTranscript,
  setRemotetranscriptView,
  remoteTranscript
) => {
  try {
    console.log("Processing remote audio streams...", remotePeers);

    if (!azureSTTRecognizer) {
      throw new Error(
        "Azure STT not initialized. Call initializeAzureSTT() first."
      );
    }

    const handleRemoteStream = async (userId, remoteName, stream, track) => {
      console.log("stream comes for", userId, remoteName, stream);

      const videoEl = remoteVideoRefs?.current?.[userId];
      if (videoEl && !videoEl.srcObject) {
        videoEl.srcObject = stream;
        console.log(`Attached remote stream to video for ${userId}`);
      }

      if (track.kind !== "audio" || !track.enabled) {
        if (track.kind === "audio" && !track.enabled) {
          console.warn(`Audio track is disabled for user: ${remoteName}`);
        }
        return;
      }

      remoteSTTContexts[userId] = {
        remoteName,
        track,
        setRemoteTranscript,
        setRemotetranscriptView,
      };

      if (azureSTTRecognizers[userId]) {
        console.log(`Recognizer already exists for ${userId}, skipping...`);
        return;
      }

      await createAndStartRemoteRecognizer(userId, remoteSTTContexts[userId]);
    };

    // Loop through all peers
    Object.entries(remotePeers).forEach(([userId, peer]) => {
      const pc = peer?.pc;
      console.log("pc comes", pc);

      const remoteName = peer?.remoteName || "remote user";

      if (!pc) {
        console.warn(`No RTCPeerConnection found for user: ${userId}`);
        return;
      }

      // Check if we've already processed this peer
      const peerId = `${userId}-${remoteName}`;
      // if (processedRemotePeers.has(peerId)) {
      //   console.log(`Peer ${peerId} already processed, skipping...`);
      //   return;
      // }

      processedRemotePeers.add(peerId);

      // 🔴 Handle future tracks - Only set once
      if (!pc.ontrackSet) {
        pc.ontrack = async (event) => {
          const stream = event.streams[0];
          await handleRemoteStream(userId, remoteName, stream, event.track);
        };
        pc.ontrackSet = true; // Mark that we've set the handler
      }

      // 🔴 Handle already existing tracks
      pc.getReceivers().forEach((receiver) => {
        if (receiver.track) {
          const stream = new MediaStream([receiver.track]);
          handleRemoteStream(userId, remoteName, stream, receiver.track);
        }
      });
    });
  } catch (error) {
    console.error("Error processing remote streams:", error);
  }
};



export const stopAllSTTRecognizers = async () => {
  try {
    isSTTSessionActive = false;
    localSTTContext = null;
    clearLocalSTTTimers();

    Object.keys(remoteRestartTimers).forEach(clearRemoteRestartTimer);
    Object.keys(remoteHealthTimers).forEach(clearRemoteHealthTimer);

    const closeJobs = [];

    if (azureSTTRecognizer?.recognizer) {
      closeJobs.push(closeRecognizerSafely(azureSTTRecognizer.recognizer, true));
      azureSTTRecognizer = null;
    }

    Object.entries(azureSTTRecognizers).forEach(([userId, recognizer]) => {
      if (recognizer) {
        closeJobs.push(closeRecognizerSafely(recognizer, true));
      }
      clearRemoteRestartTimer(userId);
      clearRemoteHealthTimer(userId);
      delete isRemoteSTTRestarting[userId];
    });

    await Promise.all(closeJobs);

    Object.keys(azureSTTRecognizers).forEach((key) => {
      delete azureSTTRecognizers[key];
    });
    Object.keys(remoteSTTContexts).forEach((key) => {
      delete remoteSTTContexts[key];
    });
    Object.keys(remoteLastRecognitionAt).forEach((key) => {
      delete remoteLastRecognitionAt[key];
    });
    Object.keys(remoteRecognizerStartedAt).forEach((key) => {
      delete remoteRecognizerStartedAt[key];
    });
    Object.keys(remoteTranscriptTracking).forEach((key) => {
      delete remoteTranscriptTracking[key];
    });
    Object.keys(isRemoteSTTRestarting).forEach((key) => {
      delete isRemoteSTTRestarting[key];
    });
    processedRemotePeers.clear();

    console.log("All STT recognizers stopped and cleaned up");
  } catch (error) {
    console.error("Error stopping STT recognizers:", error);
  }
};

const cleanupAzureSTT = async () => {
  if (azureSTTRecognizer?.recognizer) {
    azureSTTRecognizer.recognizer.close();
    azureSTTRecognizer.recognizer = null;
  }
  azureSTTRecognizer = null;
  console.log("Azure STT cleaned up.");
};

const stopAzureSTT = (recognizer) => {
  if (recognizer) {
    recognizer.stopContinuousRecognitionAsync(
      () => console.log("Recognition stopped"),
      (err) => console.error("Error stopping recognition:", err)
    );
  }
};

const sendToOpenAI = async (text, recognizer) => {
  // If already processing, return early
  if (isProcessing) {
    console.log("Already processing a request, skipping...");
    return;
  }

  isProcessing = true;
  stopAzureSTT(recognizer);

  try {
    const response = await axios.post(
      APP_URLS.openai.chatCompletions,
      {
        model: "gpt-5.4-2026-03-05",
        messages: [
          {
            role: "system",
            content:
              "You are a real-time meeting assistant available during live calls. Your primary role is to respond accurately and concisely to questions or discussions related to the ongoing meeting. Use the context provided in the user's question to give relevant and actionable answers. You can use your general intelligence to provide clear, helpful, and well-informed responses, even for topics that may not be directly related to the meeting and response must be in 50 tokens  ",
          },
          { role: "user", content: text },
        ],
        max_tokens: 50,
      },
      {
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      "openai generated response : ",
      response.data.choices[0].message.content
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Error sending text to OpenAI:", error);
    throw error;
  } finally {
    // Reset the processing flag after a delay
    setTimeout(() => {
      isProcessing = false;
    }, 5000); // 5 second cooldown
  }
};

// Add this function to handle the recognition event
export const handleRecognition = (
  text,
  recognizer,
  audioStream,
  type,
  agentName,
  setLocalTranscript,
  localTranscript,
  jointPeers,
  remoteVideoRefs,
  setRemoteTranscript,
  remoteTranscript,
) => {
  // If already processing, return early
  if (isProcessing) {
    console.log("Already processing a request, skipping...");
    return;
  }

  // Clear any existing timeout
  if (processingTimeout) {
    clearTimeout(processingTimeout);
  }

  // Set a new timeout to process the recognition
  processingTimeout = setTimeout(async () => {
    const response = await sendToOpenAI(text, recognizer);
    if (response) {
      // convertTextToSpeech(
     
      //   remoteTranscript,
      // );
    }
  }, 100); // Wait 0.1 second before processing to avoid multiple calls
};

export const sendTranscriptsToBackend = async (
  localTranscript,
  remoteTranscript,
  agenda,
  meetingType,
  dispatch
) => {
  try {
    console.log("bla", localTranscript, remoteTranscript);

    const response = await axios.post(`${socketURL}/leaveCall`, {
      localTranscript,
      remoteTranscript,
      agenda,
      meetingType,
    });

    if (response.status === 200) {
      const { pdfContent, fileName, mvpDocument, visionDocument } =
        response.data;

      // 🔥 Dispatch to Redux
      dispatch(setMVP(mvpDocument));
      dispatch(setVision(visionDocument));

      // Decode the base64 content to create a downloadable PDF
      const blob = new Blob(
        [Uint8Array.from(atob(pdfContent), (c) => c.charCodeAt(0))],
        {
          type: "application/pdf",
        }
      );

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();

      console.log("PDF downloaded successfully.");
    } else {
      console.error("Failed to generate the PDF:", response.data.error);
    }
  } catch (error) {
    console.error("Error sending transcripts to backend:", error);
  }
};

