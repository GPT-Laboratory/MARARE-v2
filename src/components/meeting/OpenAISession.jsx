/**
 * OpenAI Realtime API — voice agent and document updates.
 * File: src/components/meeting/OpenAISession.jsx
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { handleAiAudioStream } from "./HandleAiAudioStream";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { socketURL } from '../../services/meeting/socketInstance';
import { APP_URLS } from '../../config/baseUrls.js';
import {
  getDocumentAgentTools,
  getDocumentFocusedTools,
  getSessionInstructions,
} from '../../helpers/tools_format';

import { useRefs } from '../../providers/RefProvider';
import { setAgentReady, setEphemeralKey, setAgentShouldRespond, setAgentMode } from '../../features/mainStates/MainStates_Slice';
import {
  buildDocumentSaveResponseCreate,
  logDocumentSave,
  persistDocumentSectionUpdate,
} from '../../helpers/documentSectionService';
import { configuration, getIceConfiguration } from '../../helpers/PeerConnection';
import store from '../../store/store';
import { useAuth } from '../../pages/auth/authcontext';
import {
  buildTranscriptFullText,
  buildTranscriptEntriesWithFallback,
  searchTranscriptEntries,
  serializeTranscriptEntriesForTool,
} from '../../utils/meetingTranscriptUtils';

function stringifyForRealtimeLog(value, maxChars = 2600) {
  try {
    const s =
      typeof value === "string" ? value : JSON.stringify(value ?? null);
    return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
  } catch {
    return String(value).slice(0, maxChars);
  }
}

/**
 * GA Realtime / WebRTC: only one output modality per request/session — not ["text","audio"].
 * Voice UI uses spoken audio plus transcript deltas (e.g. output_audio_transcript).
 */
const REALTIME_VOICE_OUTPUT_MODALITIES = ["audio"];

/** GA Realtime requires transcription.model when transcription is set on session.update */
const REALTIME_INPUT_TRANSCRIPTION = {
  model: "gpt-4o-mini-transcribe",
  language: "en",
};

function extractTranscriptText(transcript) {
  if (!transcript) return "";
  if (Array.isArray(transcript)) {
    return transcript
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          return entry.text || entry.content || "";
        }
        return String(entry || "");
      })
      .filter(Boolean)
      .join(" ");
  }
  return String(transcript);
}

function getLatestLocalUtterance(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return extractTranscriptText(transcript).trim();
  }
  const last = transcript[transcript.length - 1];
  if (typeof last === "string") return last.trim();
  if (last && typeof last === "object") {
    return String(last.text || last.content || "").trim();
  }
  return "";
}

function detectDocumentSaveIntent(text = "") {
  const normalized = String(text).toLowerCase();
  if (!normalized.trim()) return false;
  const hasAction =
    /\b(add|write|fill|save|update|edit|append|put|insert|include|change)\b/.test(
      normalized,
    );
  const hasTarget =
    /\b(section|document|template|purpose|feature|overview|persona|scope|requirement|stakeholder|glossary)\b/.test(
      normalized,
    );
  return (hasAction && hasTarget) || /\b(add|put|write).{0,40}persona/.test(normalized);
}

function stripAgentWakePhrase(utterance, agentName) {
  let text = String(utterance || "").trim();
  if (!text) return "";

  if (agentName) {
    const escaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), " ");
  }

  return text
    .replace(/\b(hey|hi|hello|ok|okay|please|thanks|thank you)\b/gi, " ")
    .replace(/[,.!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasActivationFollowUp(utterance, agentName) {
  return stripAgentWakePhrase(utterance, agentName).length >= 3;
}

function triggerActivationResponse(dataChannel, utterance, reason = "activation") {
  if (!dataChannel || dataChannel.readyState !== "open") return false;
  const text = String(utterance || "").trim();
  if (!text) return false;

  dataChannel.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }),
  );

  setTimeout(() => {
    if (!dataChannel || dataChannel.readyState !== "open") return;
    dataChannel.send(
      JSON.stringify({
        type: "response.create",
        response: { output_modalities: REALTIME_VOICE_OUTPUT_MODALITIES },
      }),
    );
    console.log(`✅ Triggered activation response (${reason})`);
  }, 150);

  return true;
}

function nudgeDocumentSaveResponse(
  dataChannel,
  utterance,
  documentTemplate,
  reason,
  isResponseActive,
) {
  if (!dataChannel || dataChannel.readyState !== "open") return false;
  if (!utterance || !detectDocumentSaveIntent(utterance)) return false;
  if (typeof isResponseActive === "function" && isResponseActive()) {
    logDocumentSave("nudge_skipped_active_response", { reason });
    return false;
  }
  const event = buildDocumentSaveResponseCreate(utterance, documentTemplate, reason);
  dataChannel.send(JSON.stringify(event));
  logDocumentSave("nudge_response_create", {
    reason,
    utterancePreview: String(utterance).slice(0, 120),
  });
  return true;
}

// MCP Bridge class to handle tool calls
class MCPBridge {
  constructor(serverUrl = socketURL) {
    this.serverUrl = serverUrl;
    this.connected = false;
    this.projectId = null;
    this.userId = null;
  }

  setContext({ projectId, userId }) {
    this.projectId = projectId || null;
    this.userId = userId || null;
  }

  async connect() {
    try {
      const query = new URLSearchParams();
      if (this.projectId) query.set("project_id", this.projectId);
      if (this.userId) query.set("user_id", this.userId);
      const response = await fetch(`${this.serverUrl}/mcp/tools?${query.toString()}`);
      if (response.ok) {
        this.connected = true;
        console.log("✅ MCP Bridge connected");
        return true;
      }
    } catch (error) {
      console.error("❌ MCP Bridge connection failed:", error);
    }
    return false;
  }

  async callTool(toolName, parsedArgs) {
    try {
      console.log(`🔧 Calling MCP tool: ${toolName}`, parsedArgs);

      const response = await fetch(`${this.serverUrl}/mcp/tool/${toolName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: this.projectId,
          user_id: this.userId,
          arguments: parsedArgs,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log("✅ MCP tool result:", result);
        return result;
      } else {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
    } catch (error) {
      console.error("❌ MCP tool call failed:", error);
      return { success: false, error: error.message };
    }
  }
}



const OpenAISession = ({
  // ephemeralKey,
  jointPeers,
  isMeetingHost,
  localTranscript,
  remoteTranscript,
  meetingId,
  socket,
  documentTemplate,         // full template object with sections array
  onSpeakingChange, // callback(isSpeaking: boolean)
}) => {
  const agentChunkBuffer = useRef([]); // temporary buffer for agent chunks
  const dispatch = useDispatch();
  const { project_id: routeProjectId } = useParams();
  const { user } = useAuth();

  // Helper function to get fresh key from Redux store each time
  const getCurrentKey = () => {
    return store.getState().MainStates_Slice.ephemeralKey;
  };

  // console.log("localTranscript in OpenAISession:", localTranscript);


  const cleanupRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const [ConnectionStatus, setConnectionStatus] = useState("disconnected");
  const activeAgent = useSelector(
    (state) => state.MainStates_Slice.activateAgent
  );
  const agentName = useSelector(
    (state) => state.MainStates_Slice.agentName
  ) || "Assistant";

  // Track when agent should respond (triggered when name is called)
  const agentShouldRespond = useSelector(
    (state) => state.MainStates_Slice.agentShouldRespond
  );

  // Agent mode: "listening" (silent) or "active" (realtime with VAD)
  const agentMode = useSelector(
    (state) => state.MainStates_Slice.agentMode
  );
  const agentModeRef = useRef(agentMode);
  const prevAgentModeRef = useRef(agentMode);

  useEffect(() => {
    agentModeRef.current = agentMode;
  }, [agentMode]);

  // Track which document sections have already been filled (from Redux)
  const generatedDocumentSections = useSelector(
    (state) => state.reports?.generatedDocumentSections || {}
  );
  const receivedDocumentTemplate = useSelector(
    (state) => state.reports?.receivedDocumentTemplate || null
  );

  // const socket = getSocket();
  // console.log("mcp tool length ", mcpTools.length)
  const sessionActiveRef = useRef(false);
  const sessionBootstrapDoneRef = useRef(false);
  const updateSessionRetryRef = useRef(null);
  const switchAgentModeRef = useRef(null);
  const mcpBridgeRef = useRef(new MCPBridge());
  const [projectMcpTools, setProjectMcpTools] = useState([]);
  const [projectMcpConfig, setProjectMcpConfig] = useState(null);
  const {
    setAgentTranscript,
    setAgentTranscriptView,
    remotePeers,
    localtranscriptView,
    remotetranscriptView,
    agentTranscriptView,
    agentTranscript,
    userId: refUserId,
    isAdmin,
  } = useRefs();

  // Store function calls that are being built up
  const pendingFunctionCalls = useRef(new Map());
  const handledFunctionCallsRef = useRef(new Set());
  const lastDocumentIntentUtteranceRef = useRef("");
  const localTranscriptRef = useRef(localTranscript);
  const pendingDocumentSaveUtteranceRef = useRef(null);
  const effectiveDocumentTemplateRef = useRef(null);
  const activeResponseInProgressRef = useRef(false);
  const documentSaveNudgeAttemptRef = useRef(0);
  const transcriptContextRef = useRef({});

  useEffect(() => {
    localTranscriptRef.current = localTranscript;
  }, [localTranscript]);

  useEffect(() => {
    transcriptContextRef.current = {
      localtranscriptView,
      remotetranscriptView,
      agentTranscriptView,
      localTranscript,
      remoteTranscript,
      agentTranscript,
      localUserName: user?.user_metadata?.full_name?.trim() || "User",
      localUserId: refUserId || user?.id || "local",
      isHost: Boolean(isAdmin ?? isMeetingHost),
      agentName,
    };
  }, [
    localtranscriptView,
    remotetranscriptView,
    agentTranscriptView,
    localTranscript,
    remoteTranscript,
    agentTranscript,
    user,
    refUserId,
    isAdmin,
    isMeetingHost,
    agentName,
  ]);

  // Store pending undiscussed questions to ask
  const pendingQuestionsRef = useRef([]);

  // ========== NEW: Track current question and user responses ==========
  // Store current topic being asked about
  const currentTopicRef = useRef(null);
  // Store all undiscussed topics for reference
  const undiscussedTopicsRef = useRef([]);
  // Track if agent is in "asking questions" mode
  const isAskingQuestionsRef = useRef(false);
  // Track the index of current question
  const currentQuestionIndexRef = useRef(0);
  const effectiveDocumentTemplate = documentTemplate || receivedDocumentTemplate;

  useEffect(() => {
    mcpBridgeRef.current.setContext({
      projectId: routeProjectId,
      userId: user?.id,
    });
  }, [routeProjectId, user?.id]);

  useEffect(() => {
    if (!routeProjectId) {
      setProjectMcpTools([]);
      return;
    }

    const controller = new AbortController();
    const fetchProjectMcpTools = async () => {
      try {
        const query = new URLSearchParams({ project_id: routeProjectId });
        if (user?.id) query.set("user_id", user.id);
        const response = await fetch(`${socketURL}/mcp/tools?${query.toString()}`, {
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          console.warn("Project MCP tools unavailable:", data.error || response.statusText);
          setProjectMcpTools([]);
          return;
        }

        const tools = Array.isArray(data.tools) ? data.tools : [];
        setProjectMcpTools(tools);
        if (tools.length > 0) {
          console.log(`✅ Loaded ${tools.length} project MCP tool(s) for realtime session`);
        }
        console.log("🐙 Project GitHub MCP tools loaded:", {
          projectId: routeProjectId,
          total: tools.length,
          tools: tools.map((tool) => tool?.name).filter(Boolean),
        });
      } catch (error) {
        if (error.name !== "AbortError") {
          console.warn("Failed to load project MCP tools:", error);
          setProjectMcpTools([]);
        }
      }
    };

    fetchProjectMcpTools();
    return () => controller.abort();
  }, [routeProjectId, user?.id]);

  useEffect(() => {
    if (!routeProjectId) {
      setProjectMcpConfig(null);
      return;
    }

    const controller = new AbortController();
    const fetchProjectMcpConfig = async () => {
      try {
        const query = new URLSearchParams();
        if (user?.id) query.set("user_id", user.id);

        const response = await fetch(
          `${socketURL}/mcp/configurations/${routeProjectId}${query.toString() ? `?${query}` : ""}`,
          { signal: controller.signal },
        );
        const data = await response.json();

        if (!response.ok || !data.success) {
          console.warn("Project MCP configuration unavailable:", data.error || response.statusText);
          setProjectMcpConfig(null);
          return;
        }

        const mcpConfigurations = data.configurations || {};
        setProjectMcpConfig(mcpConfigurations);
        console.log("🔐 Project MCP configuration available to realtime agent:", {
          projectId: routeProjectId,
          githubUsername: mcpConfigurations.github?.githubUsername || null,
          githubTokenConfigured: Boolean(mcpConfigurations.github?.tokenConfigured),
          notionWorkspace: mcpConfigurations.notion?.workspaceName || null,
          notionTokenConfigured: Boolean(mcpConfigurations.notion?.tokenConfigured),
          googleDriveAccount: mcpConfigurations.google_drive?.accountEmail || mcpConfigurations.google_drive?.accountLabel || null,
          googleDriveTokenConfigured: Boolean(mcpConfigurations.google_drive?.tokenConfigured),
          activeTools: data.active_tools || [],
          note: "Raw token is kept on backend and is not sent to OpenAI.",
        });
      } catch (error) {
        if (error.name !== "AbortError") {
          console.warn("Failed to load project MCP configuration:", error);
          setProjectMcpConfig(null);
        }
      }
    };

    fetchProjectMcpConfig();
    return () => controller.abort();
  }, [routeProjectId, user?.id]);

  const mergeSessionTools = useCallback((baseTools, externalTools) => {
    const seen = new Set();
    return [...baseTools, ...externalTools].filter((tool) => {
      const name = tool?.name || tool?.function?.name;
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }, []);

  const sessionTools = useMemo(() => {
    const documentTools = (
      Array.isArray(effectiveDocumentTemplate?.sections) &&
      effectiveDocumentTemplate.sections.length > 0
        ? getDocumentFocusedTools()
        : getDocumentAgentTools()
    );

    return mergeSessionTools(documentTools, projectMcpTools);
  }, [effectiveDocumentTemplate, mergeSessionTools, projectMcpTools]);

  const sessionToolNames = useMemo(
    () => new Set(sessionTools.map((tool) => tool?.name || tool?.function?.name).filter(Boolean)),
    [sessionTools],
  );
  const sessionToolNamesRef = useRef(sessionToolNames);

  useEffect(() => {
    sessionToolNamesRef.current = sessionToolNames;
  }, [sessionToolNames]);

  const sessionToolSignature = useMemo(
    () => Array.from(sessionToolNames).sort().join("|"),
    [sessionToolNames],
  );

  const projectMcpInstructionBlock = useMemo(() => {
    const githubConfig = projectMcpConfig?.github;
    const notionConfig = projectMcpConfig?.notion;
    const googleDriveConfig = projectMcpConfig?.google_drive;
    const providerInstructions = [];

    if (githubConfig?.githubUsername && githubConfig?.tokenConfigured) {
      providerInstructions.push(`**GitHub MCP**
- GitHub MCP is connected for this project.
- Configured GitHub username: ${githubConfig.githubUsername}
- Authentication is already handled by the backend using the saved project GitHub token.
- Do NOT ask the creator for their GitHub username or token when they ask about "my GitHub", "my repositories", repos, issues, pull requests, commits, or code.
- For requests like "list my GitHub repositories", use the configured username "${githubConfig.githubUsername}" and call the available GitHub MCP tool.
- Never reveal, request, repeat, or invent the GitHub token.`);
    }

    if (notionConfig?.tokenConfigured) {
      providerInstructions.push(`**Notion MCP**
- Notion MCP is connected for this project${notionConfig.workspaceName ? ` to workspace "${notionConfig.workspaceName}"` : ""}.
- Authentication is already handled by the backend using the saved project Notion token.
- Do NOT ask the creator for their Notion token when they ask about Notion pages, databases, workspace search, notes, tasks, docs, or project knowledge.
- For Notion-related requests, call the available Notion MCP tool.
- Never reveal, request, repeat, or invent the Notion token.`);
    }

    if (googleDriveConfig?.tokenConfigured) {
      providerInstructions.push(`**Google Drive MCP**
- Google Drive MCP is connected for this project${googleDriveConfig.accountEmail ? ` as ${googleDriveConfig.accountEmail}` : ""}.
- Authentication is already handled by the backend using the saved project Google OAuth token.
- Do NOT ask the creator for Google Drive credentials when they ask about Drive files, folders, documents, or project assets.
- For Google Drive-related requests, call the available Google Drive MCP tools such as GOOGLEDRIVE_FIND_FILE, GOOGLEDRIVE_DOWNLOAD_FILE, or search-files.
- Prefer GOOGLEDRIVE_FIND_FILE or search-files for file search, and GOOGLEDRIVE_DOWNLOAD_FILE or read-file-content for file contents.
- Never reveal, request, repeat, or invent Google OAuth tokens.`);
    }

    if (providerInstructions.length === 0) {
      return "";
    }

    return `

**PROJECT MCP CONFIGURATION:**
${providerInstructions.join("\n\n")}`;
  }, [projectMcpConfig]);

  const projectMcpConfigSignature = useMemo(
    () =>
      JSON.stringify({
        githubUsername: projectMcpConfig?.github?.githubUsername || "",
        githubConfigured: Boolean(projectMcpConfig?.github?.tokenConfigured),
        notionWorkspace: projectMcpConfig?.notion?.workspaceName || "",
        notionConfigured: Boolean(projectMcpConfig?.notion?.tokenConfigured),
        googleDriveAccount: projectMcpConfig?.google_drive?.accountEmail || projectMcpConfig?.google_drive?.accountLabel || "",
        googleDriveConfigured: Boolean(projectMcpConfig?.google_drive?.tokenConfigured),
      }),
    [projectMcpConfig],
  );



  useEffect(() => {
    effectiveDocumentTemplateRef.current = effectiveDocumentTemplate;
  }, [effectiveDocumentTemplate]);

  useEffect(() => {
    if (agentMode !== "active") return;
    const utterance = getLatestLocalUtterance(localTranscript);
    if (utterance && detectDocumentSaveIntent(utterance)) {
      pendingDocumentSaveUtteranceRef.current = utterance;
    }
  }, [localTranscript, agentMode]);

  // Fetch ICE configuration from backend on mount
  useEffect(() => {
    const fetchIceConfig = async () => {
      try {
        const config = await getIceConfiguration();
        iceConfigRef.current = config;
        console.log("🔧 ICE configuration loaded from backend (OpenAISession)");
      } catch (error) {
        console.error("Failed to fetch ICE config, using fallback:", error);
      }
    };
    fetchIceConfig();
  }, []);

  useEffect(() => {
    // Reduce tab resource usage when agent is active
    if (activeAgent && document.hidden === false) {
      console.log("Optimizing for active tab audio streaming...");

      // Request idle callback for non-critical work
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => {
          console.log("Running low-priority tasks during idle time");
        });
      }
    }
  }, [activeAgent]);


  useEffect(() => {
    console.log("activeAgent state changed:", activeAgent);

    if (activeAgent && !sessionActiveRef.current) {
      console.log("Starting session due to activeAgent becoming true");
      const startFn = startSessionRef.current;
      if (startFn) {
        startFn().catch((err) => {
          console.error("Failed to start OpenAI session:", err);
          setConnectionStatus("disconnected");
        });
      }
    }
    else if (!activeAgent && sessionActiveRef.current) {
      console.log("Stopping session due to activeAgent becoming false");
      stopSessionRef.current?.();
    }
  }, [activeAgent]);


  const buildCurrentMeetingEntries = useCallback(() => {
    const ctx = transcriptContextRef.current;
    return buildTranscriptEntriesWithFallback({
      localTranscriptView: ctx.localtranscriptView,
      remoteTranscriptView: ctx.remotetranscriptView,
      agentTranscriptView: ctx.agentTranscriptView,
      localTranscript: ctx.localTranscript,
      remoteTranscript: ctx.remoteTranscript,
      agentTranscript: ctx.agentTranscript,
      localUserName: ctx.localUserName,
      localUserId: ctx.localUserId,
      isHost: ctx.isHost,
      agentName: ctx.agentName,
    });
  }, []);

  const getPreviousMeetingEntries = useCallback(() => {
    const parentTranscript =
      store.getState().reports?.meetingContinuation?.parentTranscript;
    return Array.isArray(parentTranscript?.entries) ? parentTranscript.entries : [];
  }, []);

  const getPreviousMeetingMeta = useCallback(() => {
    const continuation = store.getState().reports?.meetingContinuation || {};
    return {
      parentMeetingId: continuation.parentMeetingId || null,
      hasPreviousTranscript: getPreviousMeetingEntries().length > 0,
    };
  }, [getPreviousMeetingEntries]);

  function handleMeetingContextTool(args) {
    const { query_type, search_keywords } = args;
    const currentEntries = buildCurrentMeetingEntries();
    const currentTranscriptText = buildTranscriptFullText(currentEntries);
    const previousEntries = getPreviousMeetingEntries();
    const previousTranscriptText = buildTranscriptFullText(previousEntries);
    const { parentMeetingId } = getPreviousMeetingMeta();

    switch (query_type) {
      case "full_transcript":
        return {
          success: true,
          data: {
            meeting_scope: "current",
            meetingId,
            format: "speaker_attributed_chronological",
            transcript: currentTranscriptText || "No conversation recorded yet in the current meeting.",
            entries: serializeTranscriptEntriesForTool(currentEntries),
            entry_count: currentEntries.length,
          },
        };

      case "summary":
        {
          const summarySource = currentTranscriptText || "No conversation yet";
          return {
            success: true,
            data: {
              meeting_scope: "current",
              summary: summarySource.length > 500
                ? `${summarySource.substring(0, 500)}...`
                : summarySource,
              wordCount: summarySource.split(/\s+/).filter(Boolean).length,
              entry_count: currentEntries.length,
              meetingId,
            },
          };
        }

      case "specific_topic":
        {
          const searchResult = searchTranscriptEntries(currentEntries, search_keywords, 5);
          return {
            success: true,
            data: {
              meeting_scope: "current",
              found: searchResult.found,
              context: searchResult.context,
              searchKeywords: search_keywords,
              relevantSections: searchResult.matches,
              matchCount: searchResult.matchCount,
            },
          };
        }

      case "previous_transcript":
        return {
          success: true,
          data: {
            meeting_scope: "previous",
            parentMeetingId,
            format: "speaker_attributed_chronological",
            transcript: previousTranscriptText || "No previous meeting transcript is available.",
            entries: serializeTranscriptEntriesForTool(previousEntries),
            entry_count: previousEntries.length,
          },
        };

      case "previous_summary":
        {
          const summarySource = previousTranscriptText || "No previous meeting transcript is available.";
          return {
            success: true,
            data: {
              meeting_scope: "previous",
              parentMeetingId,
              summary: summarySource.length > 500
                ? `${summarySource.substring(0, 500)}...`
                : summarySource,
              wordCount: summarySource.split(/\s+/).filter(Boolean).length,
              entry_count: previousEntries.length,
            },
          };
        }

      case "previous_topic":
        {
          const searchResult = searchTranscriptEntries(previousEntries, search_keywords, 5);
          return {
            success: true,
            data: {
              meeting_scope: "previous",
              parentMeetingId,
              found: searchResult.found,
              context: searchResult.context,
              searchKeywords: search_keywords,
              relevantSections: searchResult.matches,
              matchCount: searchResult.matchCount,
            },
          };
        }

      case "participants":
        {
          const speakersFromTranscript = [
            ...new Set(currentEntries.map((entry) => entry.speaker_name).filter(Boolean)),
          ];
          return {
            success: true,
            data: {
              meeting_scope: "current",
              participants: jointPeers?.map((p) => ({
                name: p.remoteName || "Unknown",
                userId: p.userId,
              })) || [],
              speakers_in_transcript: speakersFromTranscript,
              totalParticipants: jointPeers?.length || 0,
            },
          };
        }

      default:
        return {
          success: false,
          error: "Invalid query_type",
        };
    }
  }

  function normalizeSearchValue(value = "") {
    return String(value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  const normalizeSectionKey = useCallback((value = "") => {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .trim();
  }, []);

  const resolveStoredSectionContentForSave = useCallback((section, sectionsMap = {}) => {
    if (!section || !sectionsMap || typeof sectionsMap !== "object") return "";

    const titleSnake =
      typeof section.title === "string"
        ? section.title.toLowerCase().replace(/\s+/g, "_")
        : "";

    const tryKeys = [
      section.id,
      section.id != null && section.id !== "" ? String(section.id) : "",
      normalizeSectionKey(section.id),
      titleSnake,
      normalizeSectionKey(section.title),
    ].filter((key, idx, arr) => key !== "" && key != null && arr.indexOf(key) === idx);

    for (const key of tryKeys) {
      const raw = sectionsMap[key];
      if (typeof raw === "string" && raw.trim()) return raw;
    }

    return "";
  }, [normalizeSectionKey]);

  const getProjectSections = useCallback(() => {
    const templateSections = Array.isArray(effectiveDocumentTemplate?.sections)
      ? effectiveDocumentTemplate.sections
      : [];
    const templateSectionIds = new Set(templateSections.map((section) => section.id));

    const mappedTemplateSections = templateSections.map((section) => {
      const content = resolveStoredSectionContentForSave(
        { id: section.id, title: section.title },
        generatedDocumentSections || {},
      ).trim();

      return {
        section_id: section.id,
        section_title: section.title,
        category: section.category || null,
        status: content ? "filled" : "pending",
        content,
        hasContent: Boolean(content),
      };
    });

    const dynamicSections = Object.entries(generatedDocumentSections || {})
      .filter(([sectionId, content]) => !templateSectionIds.has(sectionId) && String(content || "").trim())
      .map(([sectionId, content]) => ({
        section_id: sectionId,
        section_title: sectionId.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        category: "generated",
        status: "filled",
        content: String(content).trim(),
        hasContent: true,
      }));

    return [...mappedTemplateSections, ...dynamicSections];
  }, [effectiveDocumentTemplate, generatedDocumentSections, resolveStoredSectionContentForSave]);

  function buildProjectMemoryText(sections, includeEmpty = false) {
    return sections
      .filter((section) => includeEmpty || section.hasContent)
      .map((section) => {
        if (section.hasContent) {
          return `SECTION: ${section.section_title}
SECTION_ID: ${section.section_id}
CATEGORY: ${section.category || "uncategorized"}
STATUS: FILLED
CONTENT:
${section.content}`;
        }

        return `SECTION: ${section.section_title}
SECTION_ID: ${section.section_id}
CATEGORY: ${section.category || "uncategorized"}
STATUS: PENDING`;
      })
      .join("\n\n");
  }

  function handleProjectContextTool(args = {}) {
    const {
      query_type = "overview",
      section_identifier = "",
      search_keywords = "",
      include_empty = false,
    } = args;

    const sections = getProjectSections();
    const filledSections = sections.filter((section) => section.hasContent);
    const totalSections = sections.length;
    const filledCount = filledSections.length;
    const pendingCount = totalSections - filledCount;

    const serializeSections = (items) =>
      items
        .filter((section) => include_empty || section.hasContent)
        .map((section) => ({
          section_id: section.section_id,
          section_title: section.section_title,
          category: section.category,
          status: section.status,
          content: section.content,
        }));

    if (query_type === "overview") {
      const overviewText = filledSections.length > 0
        ? filledSections
          .map((section) => `${section.section_title}: ${section.content}`)
          .join("\n\n")
        : "No saved project/document content yet.";

      return {
        success: true,
        data: {
          total_sections: totalSections,
          filled_count: filledCount,
          pending_count: pendingCount,
          has_saved_content: filledCount > 0,
          available_sections: sections.map((section) => ({
            section_id: section.section_id,
            section_title: section.section_title,
            category: section.category,
            status: section.status,
          })),
          overview: overviewText,
          sections: serializeSections(sections),
        },
      };
    }

    if (query_type === "full_document") {
      return {
        success: true,
        data: {
          total_sections: totalSections,
          filled_count: filledCount,
          pending_count: pendingCount,
          full_document: buildProjectMemoryText(sections, include_empty),
          sections: serializeSections(sections),
        },
      };
    }

    if (query_type === "specific_section") {
      const target = normalizeSearchValue(section_identifier);

      if (!target) {
        return {
          success: false,
          error: "section_identifier is required for specific_section",
        };
      }

      const matchedSection = sections.find((section) => {
        const id = normalizeSearchValue(section.section_id);
        const title = normalizeSearchValue(section.section_title);
        return (
          id === target ||
          title === target ||
          id.includes(target) ||
          title.includes(target) ||
          target.includes(id) ||
          target.includes(title)
        );
      });

      if (!matchedSection) {
        return {
          success: true,
          data: {
            found: false,
            section_identifier,
            message: "No matching section found in the saved project/document context.",
          },
        };
      }

      return {
        success: true,
        data: {
          found: true,
          section: {
            section_id: matchedSection.section_id,
            section_title: matchedSection.section_title,
            category: matchedSection.category,
            status: matchedSection.status,
            content: matchedSection.content,
          },
        },
      };
    }

    if (query_type === "search_sections") {
      const normalizedKeywords = normalizeSearchValue(search_keywords);
      const keywords = normalizedKeywords.split(/\s+/).filter((keyword) => keyword.length > 1);

      if (keywords.length === 0) {
        return {
          success: false,
          error: "search_keywords is required for search_sections",
        };
      }

      const matches = sections
        .map((section) => {
          const haystack = normalizeSearchValue(
            `${section.section_id} ${section.section_title} ${section.category || ""} ${section.content || ""}`
          );

          const score = keywords.reduce(
            (total, keyword) => (haystack.includes(keyword) ? total + 1 : total),
            0
          );

          return { section, score };
        })
        .filter(({ section, score }) => score > 0 && (include_empty || section.hasContent))
        .sort((a, b) => b.score - a.score);

      return {
        success: true,
        data: {
          found: matches.length > 0,
          search_keywords,
          matches: matches.map(({ section, score }) => ({
            section_id: section.section_id,
            section_title: section.section_title,
            category: section.category,
            status: section.status,
            match_score: score,
            content: section.content,
          })),
        },
      };
    }

    return {
      success: false,
      error: "Invalid query_type",
    };
  }

  async function processCompletedFunctionCall(completedItem = {}) {
    // Prefer call_id for dedupe: GA Realtime emits the same logical call via
    // response.function_call_arguments.done and/or response.done with different surface ids.
    const itemLookupKey =
      completedItem.item_id ??
      completedItem.id ??
      completedItem.call_id;
    const callId =
      completedItem.call_id ||
      pendingFunctionCalls.current.get(itemLookupKey)?.call_id ||
      null;
    const dedupeKey = callId || itemLookupKey;

    if (!dedupeKey || handledFunctionCallsRef.current.has(dedupeKey)) {
      return;
    }

    handledFunctionCallsRef.current.add(dedupeKey);

    try {
      const pendingCall =
        pendingFunctionCalls.current.get(itemLookupKey) ||
        (callId ? pendingFunctionCalls.current.get(callId) : undefined) ||
        (completedItem.item_id
          ? pendingFunctionCalls.current.get(completedItem.item_id)
          : undefined);

      let argsStr = "";
      if (typeof completedItem.arguments === "string") {
        argsStr = completedItem.arguments;
      } else if (
        completedItem.arguments != null &&
        typeof completedItem.arguments === "object"
      ) {
        try {
          argsStr = JSON.stringify(completedItem.arguments);
        } catch {
          argsStr = pendingCall?.arguments || "";
        }
      } else {
        argsStr = pendingCall?.arguments || "";
      }

      const functionCall = {
        id: itemLookupKey || callId,
        call_id: callId || pendingCall?.call_id || itemLookupKey,
        name: completedItem.name || pendingCall?.name,
        arguments: argsStr,
      };

      if (!functionCall.name) {
        console.warn("Skipping unnamed function call:", completedItem);
        handledFunctionCallsRef.current.delete(dedupeKey);
        return;
      }

      console.log("Final function call with arguments:", functionCall);
      await handleFunctionCall(functionCall);
    } catch (error) {
      handledFunctionCallsRef.current.delete(dedupeKey);
      throw error;
    } finally {
      if (itemLookupKey) pendingFunctionCalls.current.delete(itemLookupKey);
      if (callId) pendingFunctionCalls.current.delete(callId);
      if (completedItem.item_id) {
        pendingFunctionCalls.current.delete(completedItem.item_id);
      }
    }
  }

  const setAgentAudioPlaybackEnabled = useCallback((enabled) => {
    const audioElement = document.getElementById("ai-audio");
    if (!audioElement) return;

    audioElement.muted = !enabled;

    if (enabled) {
      const playPromise = audioElement.play?.();
      if (playPromise?.catch) {
        playPromise.catch((error) => {
          console.warn("Could not resume agent audio playback:", error);
        });
      }
    } else {
      audioElement.pause?.();
    }
  }, []);

  const setAgentRemoteAudioEnabled = useCallback((enabled) => {
    Object.values(agentPeerConnectionsRef.current).forEach((entry) => {
      if (entry?.track) {
        entry.track.enabled = enabled;
      }
    });
  }, []);

  const applyAgentOutputState = useCallback(
    (mode) => {
      const shouldOutput = mode === "active";
      setAgentAudioPlaybackEnabled(shouldOutput);
      setAgentRemoteAudioEnabled(shouldOutput);

      if (!shouldOutput) {
        agentChunkBuffer.current = [];
        onSpeakingChange?.(false);
        if (socket && meetingId && agentName) {
          socket.emit("agent-speaking", {
            meetingId,
            agentName,
            isSpeaking: false,
          });
        }
      }
    },
    [
      agentName,
      meetingId,
      onSpeakingChange,
      setAgentAudioPlaybackEnabled,
      setAgentRemoteAudioEnabled,
      socket,
    ]
  );

  const silenceAgentOutput = useCallback(() => {
    try {
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(JSON.stringify({ type: "response.cancel" }));
        dataChannelRef.current.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
      }
    } catch (error) {
      console.warn("Could not send cancel/clear events:", error);
    }

    applyAgentOutputState("listening");
  }, [applyAgentOutputState]);

  const agentAudioStreamRef = useRef(null);
  const agentPeerConnectionsRef = useRef({});
  const startSessionRef = useRef(null);
  const stopSessionRef = useRef(null);
  const speakingDetectionCleanupRef = useRef(null); // cleanup for agent speaking AudioContext
  // ICE configuration ref - fetched from backend for security
  const iceConfigRef = useRef(configuration); // Start with fallback

  const teardownAgentConnection = useCallback((targetUserId) => {
    const entry = agentPeerConnectionsRef.current[targetUserId];
    if (!entry) return;

    try {
      if (entry.track) {
        entry.track.stop();
      }
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.close();
    } catch (error) {
      console.warn("Error cleaning up agent peer connection:", error);
    }

    delete agentPeerConnectionsRef.current[targetUserId];
  }, []);

  // Helper function to wait for ICE gathering to complete
  const waitForIceGatheringComplete = (pc) => {
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
      // Timeout after 5 seconds to prevent hanging
      setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", checkState);
        resolve();
      }, 5000);
    });
  };

  const ensureAgentConnection = useCallback(
    async (targetUserId) => {
      if (!agentAudioStreamRef.current || agentPeerConnectionsRef.current[targetUserId]) {
        return;
      }

      const baseAudioTrack = agentAudioStreamRef.current.getAudioTracks()[0];
      if (!baseAudioTrack) {
        console.warn("No agent audio track available for peer streaming");
        return;
      }

      const outboundTrack = baseAudioTrack.clone();
      const outboundStream = new MediaStream([outboundTrack]);
      const pc = new RTCPeerConnection(iceConfigRef.current);

      // Keep WebRTC plumbing warm, but block audio to remotes until agent is active.
      outboundTrack.enabled = agentModeRef.current === "active";

      agentPeerConnectionsRef.current[targetUserId] = {
        pc,
        track: outboundTrack,
      };

      outboundStream.getTracks().forEach((track) => pc.addTrack(track, outboundStream));

      // Track ICE candidates and send them
      const pendingIceCandidates = [];
      let iceGatheringComplete = false;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          // Store candidate if gathering not complete yet
          if (!iceGatheringComplete) {
            pendingIceCandidates.push(event.candidate);
          }

          socket.emit("agent-ice", {
            meetingId,
            fromUserId: "openai-agent",
            toUserId: targetUserId,
            candidate: event.candidate,
          });
        } else {
          // null candidate means ICE gathering is complete
          iceGatheringComplete = true;
          console.log(`✅ ICE gathering complete for agent peer ${targetUserId}`);
        }
      };

      // Enhanced connection state monitoring
      let connectionRetryCount = 0;
      const MAX_RETRIES = 2;

      pc.oniceconnectionstatechange = () => {
        console.log(`🧊 Agent ICE connection state for ${targetUserId}:`, pc.iceConnectionState);

        if (pc.iceConnectionState === "failed") {
          console.warn(`⚠️ Agent ICE connection failed for ${targetUserId}`);

          if (connectionRetryCount < MAX_RETRIES) {
            connectionRetryCount++;
            console.log(`🔄 Attempting ICE restart (${connectionRetryCount}/${MAX_RETRIES})...`);
            try {
              pc.restartIce();
            } catch (e) {
              console.error("Error restarting ICE:", e);
            }
          } else {
            console.error(`❌ Max ICE retries reached for ${targetUserId}, cleaning up...`);
            teardownAgentConnection(targetUserId);
            // Retry connection after a delay
            setTimeout(() => {
              if (agentAudioStreamRef.current && activeAgent) {
                console.log(`🔄 Retrying agent connection for ${targetUserId}...`);
                ensureAgentConnection(targetUserId);
              }
            }, 3000);
          }
        } else if (pc.iceConnectionState === "connected") {
          console.log(`✅ Agent ICE connection established for ${targetUserId}`);
          connectionRetryCount = 0; // Reset on success
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`🔌 Agent connection state for ${targetUserId}:`, pc.connectionState);

        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          console.error(`❌ Agent connection lost for ${targetUserId}, cleaning up...`);
          teardownAgentConnection(targetUserId);

          // Retry connection if agent is still active
          if (agentAudioStreamRef.current && activeAgent) {
            setTimeout(() => {
              console.log(`🔄 Retrying agent connection for ${targetUserId}...`);
              ensureAgentConnection(targetUserId);
            }, 2000);
          }
        } else if (pc.connectionState === "connected") {
          console.log(`✅ Agent connection established for ${targetUserId}`);
          connectionRetryCount = 0; // Reset on success
        }
      };

      try {
        // Create offer
        const offer = await pc.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
        });

        // Set local description
        await pc.setLocalDescription(offer);
        console.log(`📤 Created agent offer for ${targetUserId}, waiting for ICE gathering...`);

        // 🔥 CRITICAL: Wait for ICE gathering to complete before sending offer
        await waitForIceGatheringComplete(pc);

        // Get the complete offer with all ICE candidates
        const completeOffer = pc.localDescription;
        console.log(`✅ ICE gathering complete for ${targetUserId}, sending offer...`);

        // Send offer with complete ICE candidates
        socket.emit("agent-peer-offer", {
          meetingId,
          fromUserId: "openai-agent",
          toUserId: targetUserId,
          offer: completeOffer,
          remoteName: "AI Assistant",
        });

        console.log(`📤 Sent complete agent offer to ${targetUserId}`);
      } catch (error) {
        console.error(`❌ Failed to create agent offer for ${targetUserId}:`, error);
        teardownAgentConnection(targetUserId);
      }
    },
    [meetingId, socket, teardownAgentConnection, activeAgent]
  );

  const teardownAllAgentConnections = useCallback(() => {
    Object.keys(agentPeerConnectionsRef.current).forEach(teardownAgentConnection);
  }, [teardownAgentConnection]);

  const syncAgentConnections = useCallback(() => {
    if (!activeAgent || !agentAudioStreamRef.current) return;

    remotePeers
      ?.filter((peer) => peer.userId && !peer.isAgent)
      .forEach((peer) => ensureAgentConnection(peer.userId));

    Object.keys(agentPeerConnectionsRef.current).forEach((peerId) => {
      const stillPresent = remotePeers?.some((peer) => peer.userId === peerId);
      if (!stillPresent) {
        teardownAgentConnection(peerId);
      }
    });

    setAgentRemoteAudioEnabled(agentModeRef.current === "active");
  }, [
    activeAgent,
    remotePeers,
    ensureAgentConnection,
    teardownAgentConnection,
    setAgentRemoteAudioEnabled,
  ]);

  useEffect(() => {
    syncAgentConnections();
  }, [syncAgentConnections]);


  useEffect(() => {
    if (!activeAgent) return;

    const handlePeerAgentIce = async ({ candidate, fromUserId }) => {
      if (!candidate || !fromUserId) return;
      const entry = agentPeerConnectionsRef.current[fromUserId];
      if (entry?.pc) {
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("Error adding ICE candidate for agent peer:", err);
        }
      }
    };

    const handleAgentPeerAnswer = async ({ answer, fromUserId }) => {
      if (!answer || !fromUserId) {
        return;
      }
      const entry = agentPeerConnectionsRef.current[fromUserId];
      if (!entry?.pc) return;
      try {
        if (
          entry.pc.signalingState === "have-local-offer" ||
          entry.pc.signalingState === "have-remote-offer"
        ) {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log(`✅ Agent set remote description for ${fromUserId}`);
        }
      } catch (err) {
        console.error("Error setting remote description for agent peer:", err);
      }
    };

    socket.on("peer-agent-ice", handlePeerAgentIce);
    socket.on("agent-peer-answer", handleAgentPeerAnswer);

    return () => {
      socket.off("peer-agent-ice", handlePeerAgentIce);
      socket.off("agent-peer-answer", handleAgentPeerAnswer);
    };
  }, [activeAgent, meetingId, socket]);

  useEffect(() => {
    console.log("jointPeers", jointPeers);

    const currentKey = getCurrentKey();
    if (!currentKey || !isMeetingHost) return;

    const handleStop = () => {
      if (stopSessionRef.current) {
        stopSessionRef.current();
      }
    };

    const audioElement = document.createElement("audio");
    audioElement.autoplay = true;
    document.body.appendChild(audioElement);

    const button = document.createElement("button");
    button.innerText = "Close Session";
    button.onclick = handleStop;
    document.body.appendChild(button);
    button.style.position = "fixed";
    button.style.bottom = "10px";
    button.style.right = "10px";
    button.style.zIndex = "1000";
    button.style.display = "none";
    button.style.padding = "10px 20px";
    button.style.backgroundColor = "#007bff";
    button.style.color = "#fff";
    button.style.border = "none";
    button.style.borderRadius = "5px";
    button.style.cursor = "pointer";
    button.style.fontSize = "16px";
    button.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.3)";

    return () => {
      handleStop();
      audioElement.remove();
      button.remove();
    };
  }, [isMeetingHost, jointPeers]);



  // Add this new function before startSession
  const handleKeyExpiration = async () => {
    console.log("🔑 Handling ephemeral key expiration...");

    // Stop current session
    await stopSession();

    // Get new key
    try {
      const response = await fetch(`${socketURL}/api1/ephemeral-key`, {
        method: "POST",
      });

      const data = await response.json();
      const newKey = data.value;
      console.log("✅ Got new ephemeral key from backend");

      // Dispatch the new key to Redux
      dispatch(setEphemeralKey(newKey));

      // ✅ Wait for Redux state to propagate and verify it's set
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify the key was actually set in Redux
      const verifiedKey = getCurrentKey();
      if (verifiedKey && verifiedKey === newKey) {
        console.log("✅ Verified new key is set in Redux correctly");
      } else if (!verifiedKey) {
        console.error("❌ New key not found in Redux store!");
      } else {
        console.warn("⚠️ Key mismatch - Redux key doesn't match new key");
      }

      // ✅ Reset flag and restart if still active
      sessionActiveRef.current = false;

      if (activeAgent) {
        console.log("🔄 Restarting session with new key...");
        await startSession();
      }

    } catch (err) {
      console.error("❌ Error getting new ephemeral key:", err);
      setConnectionStatus("disconnected");
    }
  };

  let connectionAttempts = 0;
  const MAX_ATTEMPTS = 5;

  async function startSession() {
    try {
      if (sessionActiveRef.current) {
        console.log("Session already active, not starting a new one");
        return;
      }

      socket.emit('openai-agent-value', {
        meetingId: meetingId,
        activeAgent: true
      });

      sessionActiveRef.current = true;
      pendingFunctionCalls.current.clear();
      handledFunctionCallsRef.current.clear();
      agentChunkBuffer.current = [];
      await mcpBridgeRef.current.connect();
      setConnectionStatus("connecting");
      connectionAttempts++;
      console.log(`Connection attempt ${connectionAttempts}/${MAX_ATTEMPTS}`);

      if (peerConnectionRef.current) {
        await stopConnection();
      }

      peerConnectionRef.current = new RTCPeerConnection(iceConfigRef.current);

      peerConnectionRef.current.addEventListener("connectionstatechange", () => {
        console.log("Connection state changed:", peerConnectionRef.current.connectionState);
        if (peerConnectionRef.current.connectionState === "connected") {
          setConnectionStatus("connected");
          console.log("ready to talk");
          dispatch(setAgentReady(true));

          socket.emit('openai-agent-ready', {
            meetingId: meetingId,
            ready: true
          });
        } else if (
          peerConnectionRef.current.connectionState === "failed" ||
          peerConnectionRef.current.connectionState === "disconnected"
        ) {
          setConnectionStatus("disconnected");
        }
      });

      peerConnectionRef.current.addEventListener("signalingstatechange", () => {
        console.log("Signaling state changed:", peerConnectionRef.current.signalingState);
      });


      // After receiving OpenAI audio track, capture and broadcast it
      peerConnectionRef.current.ontrack = async (event) => {
        console.log("Received track from OpenAI");
        const remoteStream = event.streams[0];

        const audioElement = document.getElementById("ai-audio");
        if (audioElement) {
          audioElement.srcObject = remoteStream;
        }
        agentAudioStreamRef.current = remoteStream;
        applyAgentOutputState(agentModeRef.current);
        syncAgentConnections();

        // ── Speaking detection ──────────────────────────────────────────
        // Tear down any previous analyser before creating a new one
        if (speakingDetectionCleanupRef.current) {
          speakingDetectionCleanupRef.current();
          speakingDetectionCleanupRef.current = null;
        }

        const audioTracks = remoteStream.getAudioTracks();
        if (audioTracks.length > 0 && onSpeakingChange) {
          try {
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(remoteStream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.3;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let rafId;
            let lastSpeaking = false; // only fire callback on state change

            const check = () => {
              if (agentModeRef.current !== "active") {
                if (lastSpeaking) {
                  lastSpeaking = false;
                  onSpeakingChange(false);
                }
                rafId = requestAnimationFrame(check);
                return;
              }

              analyser.getByteFrequencyData(dataArray);
              const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
              const isSpeaking = avg > 10;
              if (isSpeaking !== lastSpeaking) {
                lastSpeaking = isSpeaking;
                onSpeakingChange(isSpeaking);
              }
              rafId = requestAnimationFrame(check);
            };
            check();

            speakingDetectionCleanupRef.current = () => {
              cancelAnimationFrame(rafId);
              source.disconnect();
              analyser.disconnect();
              audioCtx.close();
              if (lastSpeaking) onSpeakingChange(false);
            };
          } catch (err) {
            console.warn("Agent speaking detection failed:", err);
          }
        }
        // ───────────────────────────────────────────────────────────────
      };





      dataChannelRef.current = peerConnectionRef.current.createDataChannel(
        "oai-events",
        { ordered: true }
      );

      dataChannelRef.current.addEventListener("open", () => {
        console.log("Data channel is open");
        setTimeout(() => {
          updateSession();
        }, 100);
      });



      dataChannelRef.current.addEventListener("message", async (event) => {
        try {
          const msg = JSON.parse(event.data);
          // console.log("Received message from OpenAI:", msg.type);

          if (msg.type === "error") {
            const serialized = stringifyForRealtimeLog(msg.error ?? msg);
            const benignCodes = new Set([
              "conversation_already_has_active_response",
              "input_audio_buffer_commit_empty",
            ]);
            if (benignCodes.has(msg.error?.code)) {
              logDocumentSave("openai_benign_error", {
                code: msg.error?.code,
                message: msg.error?.message,
              });
            } else {
              console.error("OpenAI error (detail):", serialized);
            }

            if (msg.error?.code === "session_expired" ||
              msg.error?.code === "invalid_api_key" ||
              msg.error?.message?.includes("expired")) {
              console.log("🔄 Session expired, refreshing key...");
              await handleKeyExpiration();
              return;
            }
          }

          if (msg.type === "response.created") {
            activeResponseInProgressRef.current = true;
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            if (agentModeRef.current === "active") {
              const utterance = getLatestLocalUtterance(localTranscriptRef.current);
              if (utterance && detectDocumentSaveIntent(utterance)) {
                pendingDocumentSaveUtteranceRef.current = utterance;
                documentSaveNudgeAttemptRef.current = 0;
                logDocumentSave("speech_stopped_document_intent", {
                  utterancePreview: utterance.slice(0, 100),
                });
              }
            }
          }

          const filterEnglish = (text) => {
            return text.replace(/[^A-Za-z0-9\s+\-=%.(),]/g, '').trim();
          };

          // if (msg.delta && typeof msg.delta === "string") {
          if (
            (msg.type === "response.output_audio_transcript.delta" ||
              msg.type === "response.audio_transcript.delta") &&
            msg.delta &&
            typeof msg.delta === "string"
          ) {
            // Only capture agent transcript after the creator fully activates the agent.
            if (agentModeRef.current === "active") {
              const cleanText = filterEnglish(msg.delta);
              if (cleanText) {
                setAgentTranscript((prev) => [...prev, cleanText]);
                // const handleAgentChunk = (chunkText) => {
                //   agentChunkBuffer.current.push(chunkText);

                //   if (agentChunkBuffer.current.length >= 40) {
                //     const combinedText = agentChunkBuffer.current.join(" ");
                //     setAgentTranscriptView((prev) => [
                //       ...prev,
                //       { text: combinedText, timestamp: Date.now() },
                //     ]);
                //     agentChunkBuffer.current = [];
                //   }
                // };

                // console.log("cleanText", cleanText);
                const handleAgentChunk = (chunkText) => {
                  agentChunkBuffer.current.push(chunkText);

                  const combinedText = agentChunkBuffer.current.join(" ");

                  if (combinedText.endsWith(".") || combinedText.endsWith("?")) {
                    setAgentTranscriptView((prev) => [
                      ...prev,
                      { text: combinedText.trim(), timestamp: Date.now() },
                    ]);
                    agentChunkBuffer.current = [];
                  }
                };

                handleAgentChunk(cleanText);
              }
            }


          }



          // Handle function call arguments streaming
          if (msg.type === "response.function_call_arguments.delta") {
            const itemId = msg.item_id || msg.item?.id || msg.call_id;

            if (itemId && typeof msg.delta === "string") {
              const functionCall = pendingFunctionCalls.current.get(itemId) || {
                id: itemId,
                call_id: msg.call_id || msg.item?.call_id || itemId,
                name: msg.name || msg.item?.name,
                arguments: ""
              };

              functionCall.arguments += msg.delta;

              if ((msg.name || msg.item?.name) && !functionCall.name) {
                functionCall.name = msg.name || msg.item?.name;
              }

              if ((msg.call_id || msg.item?.call_id) && !functionCall.call_id) {
                functionCall.call_id = msg.call_id || msg.item?.call_id;
              }

              pendingFunctionCalls.current.set(itemId, functionCall);
              if (functionCall.call_id && functionCall.call_id !== itemId) {
                pendingFunctionCalls.current.set(functionCall.call_id, functionCall);
              }
            }
          } else if (
            msg.type === "response.output_item.added" &&
            msg.item?.type === "function_call"
          ) {
            const itemId = msg.item.id || msg.item.call_id;
            if (itemId) {
              const functionCall = {
                id: itemId,
                call_id: msg.item.call_id || itemId,
                name: msg.item.name,
                arguments: msg.item.arguments || "",
              };
              pendingFunctionCalls.current.set(itemId, functionCall);
              if (functionCall.call_id && functionCall.call_id !== itemId) {
                pendingFunctionCalls.current.set(functionCall.call_id, functionCall);
              }
              console.log("Function call output item added:", functionCall);
            }
          } else if (msg.type === "response.output_item.delta" &&
            msg.item?.type === "function_call") {

            if (msg.delta?.arguments) {
              console.log("Function call arguments delta:", msg.delta.arguments);
              const functionCall = pendingFunctionCalls.current.get(msg.item.id) || {
                id: msg.item.id,
                call_id: msg.item.call_id || msg.item.id,
                name: msg.item.name,
                arguments: ""
              };

              functionCall.arguments += msg.delta.arguments;
              pendingFunctionCalls.current.set(msg.item.id, functionCall);
            }
          }

          // GA Realtime may send either a nested msg.item or top-level fields
          // (call_id, item_id, name, arguments). Handle both.
          if (msg.type === "response.function_call_arguments.done") {
            const nested = msg.item?.type === "function_call" ? msg.item : null;
            const itemId = msg.item_id || nested?.id || msg.call_id;
            const pending = itemId ? pendingFunctionCalls.current.get(itemId) : null;
            const flat =
              !nested && msg.call_id
                ? {
                    id: itemId || msg.call_id,
                    item_id: msg.item_id,
                    type: "function_call",
                    name: msg.name || pending?.name,
                    call_id: msg.call_id,
                    arguments: msg.arguments ?? pending?.arguments,
                  }
                : null;
            const toProcess = nested || flat;
            if (toProcess) {
              console.log("Function call arguments done:", toProcess);
              await processCompletedFunctionCall(toProcess);
            }
          }

          // Backward-compatible fallback for older event shapes
          if (msg.type === "response.output_item.done" &&
            msg.item?.type === "function_call") {
            console.log("Function call done:", msg.item);
            await processCompletedFunctionCall(msg.item);
          }

          if (
            msg.type === "conversation.item.done" &&
            msg.item?.type === "function_call"
          ) {
            console.log("Conversation function call done:", msg.item);
            await processCompletedFunctionCall(msg.item);
          }

          if (msg.type === "response.done" || msg.type === "response.cancelled") {
            activeResponseInProgressRef.current = false;

            let hadSaveDocumentCall = false;
            const output = msg.response?.output;
            if (Array.isArray(output)) {
              for (const item of output) {
                if (item?.type === "function_call") {
                  if (item.name === "save_document_section") {
                    hadSaveDocumentCall = true;
                  }
                  logDocumentSave("response_done_function_call", {
                    name: item.name,
                    call_id: item.call_id,
                    argumentsPreview: String(item.arguments || "").slice(0, 200),
                  });
                  await processCompletedFunctionCall(item);
                }
              }
            }

            const pendingUtterance = pendingDocumentSaveUtteranceRef.current;
            if (pendingUtterance && !hadSaveDocumentCall) {
              if (documentSaveNudgeAttemptRef.current >= 3) {
                logDocumentSave("nudge_gave_up", {
                  attempts: documentSaveNudgeAttemptRef.current,
                  utterancePreview: pendingUtterance.slice(0, 80),
                });
              } else {
                setTimeout(() => {
                  if (activeResponseInProgressRef.current) {
                    logDocumentSave("nudge_deferred_still_active", {});
                    return;
                  }
                  documentSaveNudgeAttemptRef.current += 1;
                  const sent = nudgeDocumentSaveResponse(
                    dataChannelRef.current,
                    pendingUtterance,
                    effectiveDocumentTemplateRef.current,
                    "after_vad_response",
                    () => activeResponseInProgressRef.current,
                  );
                  if (sent) {
                    pendingDocumentSaveUtteranceRef.current = null;
                  }
                }, 500);
              }
            } else if (hadSaveDocumentCall && pendingUtterance) {
              pendingDocumentSaveUtteranceRef.current = null;
              documentSaveNudgeAttemptRef.current = 0;
              lastDocumentIntentUtteranceRef.current = pendingUtterance;
            }
          }

        } catch (error) {
          console.error("Error processing message:", error);
        }
      });



      dataChannelRef.current.addEventListener("close", () => {
        console.log("Data channel is closed");

        // 🔥 Check if it closed unexpectedly (possible key expiration)
        if (sessionActiveRef.current && activeAgent) {
          console.log("⚠️ Data channel closed unexpectedly, may be key expiration");
          setTimeout(() => {
            if (activeAgent) {
              handleKeyExpiration();
            }
          }, 1000);
        }

        setConnectionStatus((prev) => prev !== "connecting" ? "disconnected" : prev);
      });

      dataChannelRef.current.addEventListener("error", (error) => {
        console.error("Data channel error:", error);
      });

      const clientMedia = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (peerConnectionRef.current && clientMedia.getAudioTracks().length > 0) {
        const audioTrack = clientMedia.getAudioTracks()[0];
        console.log("Adding audio track to peer connection");
        peerConnectionRef.current.addTrack(audioTrack, clientMedia);

        const offerOptions = {
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
        };

        const offer = await peerConnectionRef.current.createOffer(offerOptions);
        console.log("Offer SDP created:", offer.sdp.substring(0, 100) + "...");

        await peerConnectionRef.current.setLocalDescription(offer);
        console.log("Local description set successfully");

        await waitForIceGatheringComplete(peerConnectionRef.current);

        const completeOffer = peerConnectionRef.current.localDescription;
        console.log("Complete offer with ICE candidates ready");

        const realtimeCallsUrl = APP_URLS.openai.realtimeCalls;
        try {
          // ✅ Get fresh key from store each time (important for key refresh)
          const currentKey = getCurrentKey();
          if (!currentKey) {
            throw new Error("No ephemeral key available");
          }

          console.log("Sending offer to OpenAI API...");
          const sdpResponse = await fetch(realtimeCallsUrl, {
            method: "POST",
            body: completeOffer.sdp,
            headers: {
              Authorization: `Bearer ${currentKey}`,
              "Content-Type": "application/sdp",
            },
          });

          if (!sdpResponse.ok) {
            const errorText = await sdpResponse.text();
            console.error(`OpenAI API returned ${sdpResponse.status}: ${errorText}`);

            // 🔥 Check if it's an authentication error (expired key)
            if (sdpResponse.status === 401 || sdpResponse.status === 403) {
              console.log("🔄 Ephemeral key expired, getting new key...");
              await handleKeyExpiration();
              return; // Exit, new session will start automatically
            }
            throw new Error(`OpenAI API returned ${sdpResponse.status}: ${errorText}`);
          }

          const answerSdp = await sdpResponse.text();
          console.log("Received answer SDP:", answerSdp.substring(0, 100) + "...");

          if (peerConnectionRef.current &&
            (peerConnectionRef.current.signalingState === "have-local-offer" ||
              peerConnectionRef.current.signalingState === "stable")) {

            const answer = {
              type: "answer",
              sdp: answerSdp,
            };

            console.log("Setting remote description...");
            await peerConnectionRef.current.setRemoteDescription(answer);
            console.log("Successfully set remote description");

            setConnectionStatus("connected");
          } else {
            console.error("Cannot set remote description - peer connection is null or in wrong state:",
              peerConnectionRef.current ? peerConnectionRef.current.signalingState : "null");

            if (connectionAttempts < MAX_ATTEMPTS) {
              console.log("Retrying connection...");
              await new Promise((resolve) => setTimeout(resolve, 1000));
              await startSession();
            } else {
              throw new Error("Peer connection in wrong state for setting remote description");
            }
          }
        } catch (error) {
          console.error("Error setting up WebRTC connection:", error);

          // 🔥 Check if error is related to authentication
          if (error.message.includes('401') || error.message.includes('403')) {
            console.log("🔄 Detected auth error, refreshing key...");
            await handleKeyExpiration();
            return;
          }

          if (connectionAttempts < MAX_ATTEMPTS) {
            console.log("Retrying connection after error...");
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await startSession();
          } else {
            throw error;
          }
        }
      } else {
        console.error("No audio tracks available or peer connection is null");
        setConnectionStatus("disconnected");
        sessionActiveRef.current = false;
      }
    } catch (error) {
      console.error("Error starting OpenAI session:", error);
      setConnectionStatus("disconnected");
      sessionActiveRef.current = false;
      await stopSession();
    }
  }

  // Function to handle tool calls from OpenAI
  async function handleFunctionCall(functionCallItem) {
    try {
      const { name: toolName, call_id, arguments: toolArgs } = functionCallItem;
      logDocumentSave("function_call_received", { name: toolName, call_id });
      console.log("🔧 function call item", functionCallItem);
      console.log(`🔧 OpenAI requested tool call: ${toolName}`, toolArgs);

      // Parse arguments if they're a string
      let parsedArgs = toolArgs;
      if (typeof toolArgs === 'string' && toolArgs.trim() !== '') {
        try {
          parsedArgs = JSON.parse(toolArgs);
        } catch (e) {
          console.error("Failed to parse tool arguments:", e);
          parsedArgs = {};
        }
      } else if (!toolArgs || toolArgs === '') {
        console.log("No arguments provided, using empty object");
        parsedArgs = {};
      }

      console.log("📤 Parsed arguments:", parsedArgs);

      let result;

      // Handle meeting context tool locally (no need to call backend)
      if (toolName === 'get_meeting_context') {
        result = handleMeetingContextTool(parsedArgs);
      }
      else if (toolName === "get_project_context") {
        result = handleProjectContextTool(parsedArgs);
      }
      else if (toolName === "web_search") {
        try {
          console.log("🌐 Performing web search with query:", parsedArgs.query);

          // ✅ Use CORS-safe proxy (all frontend)
          const searchUrl = `${APP_URLS.allOrigins}?url=${encodeURIComponent(
            `${APP_URLS.serpApi}?q=${encodeURIComponent(parsedArgs.query)}&api_key=a2dde1c83cca374ad0fc5d9e3f60861b5788e55116fa7b00a4ee14a196294405`
          )}`;

          const response = await fetch(searchUrl);
          const data = await response.json();

          const results =
            data.organic_results?.slice(0, 3)?.map((r) => ({
              title: r.title,
              link: r.link,
              snippet: r.snippet,
            })) || [];

          result = {
            success: true,
            source: "Google (via SerpAPI)",
            query: parsedArgs.query,
            summary:
              results.map((r) => `${r.title}: ${r.snippet}`).join("\n\n") ||
              "No summary found.",
            topResults: results,
          };

          console.log("✅ Web search results:", result);
        } catch (error) {
          console.error("❌ Web search error:", error);
          result = { success: false, error: error.message };
        }
      }

      else if (toolName === "get_weather") {
        const city = parsedArgs.location || "Rawalpindi";
        console.log("🌤️ Fetching weather for:", city);

        try {
          const apiKey = "2750d9853b472574b870f0a5e1fd505e"; // Get one free from openweathermap.org
          const response = await fetch(
            `${APP_URLS.openWeather}?q=${city}&units=metric&appid=${apiKey}`
          );
          const data = await response.json();

          if (data?.main) {
            result = {
              success: true,
              city: data.name,
              temperature: data.main.temp,
              condition: data.weather[0].description,
            };

            console.log("✅ Weather data:", result);
          } else {
            result = { success: false, error: "No weather data found" };
          }
        } catch (err) {
          console.error("❌ Weather fetch error:", err);
          result = { success: false, error: err.message };
        }
      }

      else if (toolName === "save_document_section") {
        logDocumentSave("tool_handler_invoked", { call_id, keys: Object.keys(parsedArgs || {}) });
        result = persistDocumentSectionUpdate({
          parsedArgs,
          documentTemplate: effectiveDocumentTemplate,
          existingSections:
            store.getState().reports?.generatedDocumentSections || {},
          dispatch,
          meetingId,
          socket,
          undiscussedTopics: undiscussedTopicsRef.current,
          onBackendSave: ({ sectionId, sectionTitle, content, userRawAnswer }) => {
            saveGeneratedContentToBackend(
              sectionId,
              sectionTitle,
              content,
              userRawAnswer || "",
            );
            moveToNextQuestion();
          },
        });
        if (!result?.success) {
          logDocumentSave("tool_handler_failed", result);
        } else {
          documentSaveNudgeAttemptRef.current = 0;
          pendingDocumentSaveUtteranceRef.current = null;
        }
      }

      // ========== NEW: Handle get_remaining_topics tool ==========
      else if (toolName === "get_remaining_topics") {
        console.log("📋 Getting remaining undiscussed topics...");

        const remainingTopics = undiscussedTopicsRef.current.slice(currentQuestionIndexRef.current);

        result = {
          success: true,
          remaining_count: remainingTopics.length,
          current_topic: currentTopicRef.current?.title || null,
          remaining_topics: remainingTopics.map(t => ({
            section_id: t.section_id,
            title: t.title,
            category: t.category
          })),
          is_asking_questions: isAskingQuestionsRef.current
        };

        console.log("📋 Remaining topics:", result);
      }

      else if (sessionToolNamesRef.current.has(toolName)) {
        // Call backend MCP tools exposed as realtime function tools.
        result = await mcpBridgeRef.current.callTool(toolName, parsedArgs);
      }
      else {
        console.warn("⚠️ Tool unavailable in latest realtime tool set:", {
          requestedTool: toolName,
          availableTools: Array.from(sessionToolNamesRef.current),
        });
        result = {
          success: false,
          error: `Unknown or unavailable tool: ${toolName}`,
        };
      }




      // Call your MCP tool
      // const result = await mcpBridgeRef.current.callTool(toolName, parsedArgs);

      // Send the result back to OpenAI
      const functionResult = {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call_id,
          output: JSON.stringify(result)
        }
      };



      if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
        dataChannelRef.current.send(JSON.stringify(functionResult));
        console.log("✅ Sent tool result back to OpenAI");

        // Only speak after tool calls when the agent was explicitly activated.
        if (agentModeRef.current !== "active") {
          console.log("Skipping response.create after tool call — agent is in LISTENING mode");
          return;
        }

        setTimeout(() => {
          if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
            return;
          }
          const responseEvent = {
            type: "response.create",
            response: {
              output_modalities: REALTIME_VOICE_OUTPUT_MODALITIES,
              instructions:
                toolName === "save_document_section"
                  ? "You just saved content to the live document panel. Briefly confirm that to the creator in one short sentence, then stop."
                  : undefined,
            },
          };
          dataChannelRef.current.send(JSON.stringify(responseEvent));
        }, 100);
      }

    } catch (error) {
      console.error("❌ Error handling function call:", error);

      // Send error back to OpenAI
      const errorResult = {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: functionCallItem.call_id,
          output: JSON.stringify({
            success: false,
            error: error.message
          })
        }
      };

      if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
        dataChannelRef.current.send(JSON.stringify(errorResult));
      }
    }
  }


  // Switch agent to a specific mode (listening or active)
  const switchAgentMode = useCallback((mode) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      console.warn("⚠️ Cannot switch mode - data channel not open");
      return;
    }

    // Pass the best available template so the system prompt includes the latest section list
    const dynamicInstructions = getSessionInstructions(agentName, effectiveDocumentTemplate);
    const englishOnlyInstructions = `${dynamicInstructions}${projectMcpInstructionBlock}

REMINDER: Respond ONLY in English. Never use any other language in speech or text.
REMINDER: Behave like a human teammate. Only do exactly what the creator asked. Do not volunteer extra actions.`;

    let sessionConfig;

    if (mode === "active") {
      // ACTIVE MODE: Full realtime with VAD enabled - agent can be interrupted
      console.log(`🎤 Agent "${agentName}" switching to ACTIVE mode (realtime)`);
      sessionConfig = {
        type: "session.update",
        session: {
          type: "realtime",
          instructions: englishOnlyInstructions,
          output_modalities: REALTIME_VOICE_OUTPUT_MODALITIES,
          audio: {
            input: {
              // GA Realtime uses nested audio.input.turn_detection
              turn_detection: {
                type: "semantic_vad",
              },
              transcription: REALTIME_INPUT_TRANSCRIPTION,
            },
          },
          tools: sessionTools,
          tool_choice: "auto",
          parallel_tool_calls: false,
        },
      };
    } else {
      // LISTENING MODE: VAD disabled - agent only listens
      console.log(`🎧 Agent "${agentName}" switching to LISTENING mode (silent)`);
      sessionConfig = {
        type: "session.update",
        session: {
          type: "realtime",
          instructions: `${englishOnlyInstructions}

LISTENING MODE: Stay completely silent. Do not speak, respond, or generate audio until the creator calls your name "${agentName}".`,
          output_modalities: REALTIME_VOICE_OUTPUT_MODALITIES,
          audio: {
            input: {
              // Listening mode keeps the session connected but disables auto-response VAD
              turn_detection: null,
              transcription: REALTIME_INPUT_TRANSCRIPTION,
            },
          },
          tools: sessionTools,
          tool_choice: "auto",
          parallel_tool_calls: false,
        },
      };
    }

    try {
      const toolNames = sessionTools
        .map((tool) => tool?.name || tool?.function?.name)
        .filter(Boolean);
      console.log("🧰 Sending realtime session.update with tools:", {
        mode,
        projectId: routeProjectId,
        total: toolNames.length,
        tools: toolNames,
      });
      dataChannelRef.current.send(JSON.stringify(sessionConfig));
      console.log(`✅ Agent mode switched to: ${mode.toUpperCase()}`);
    } catch (error) {
      console.error("❌ Error switching agent mode:", error);
    }
  }, [agentName, effectiveDocumentTemplate, projectMcpInstructionBlock, routeProjectId, sessionTools]);

  useEffect(() => {
    switchAgentModeRef.current = switchAgentMode;
  }, [switchAgentMode]);

  useEffect(() => {
    if (!sessionActiveRef.current) return;
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") return;

    const mode = agentModeRef.current || "listening";
    console.log("🔄 Resyncing realtime tools after MCP/tool list change", {
      mode,
      projectId: routeProjectId,
      toolSignature: sessionToolSignature,
      mcpConfigSignature: projectMcpConfigSignature,
    });
    switchAgentMode(mode);
  }, [
    projectMcpConfigSignature,
    routeProjectId,
    sessionToolSignature,
    switchAgentMode,
  ]);

  // Function to ask undiscussed questions through OpenAI agent
  // This is called by SMART TIMING when ~60% of topics are discussed or meeting is ending
  const askUndiscussedQuestions = useCallback((questions, undiscussedTopics) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      console.warn("⚠️ Cannot ask questions - data channel not open");
      return;
    }

    console.log("🎤 Agent asking about undiscussed topics naturally...");

    // ========== NEW: Store topics for response tracking ==========
    undiscussedTopicsRef.current = undiscussedTopics;
    isAskingQuestionsRef.current = true;
    currentQuestionIndexRef.current = 0;

    // Set the first topic as current
    if (undiscussedTopics.length > 0) {
      currentTopicRef.current = undiscussedTopics[0];
      console.log("📝 Current topic set:", currentTopicRef.current);
    }
    // ========== END NEW ==========

    // Create a natural, conversational prompt
    const topicsList = undiscussedTopics.slice(0, 3).map(t => t.title).join(", ");
    const firstTopic = undiscussedTopics[0]?.title || questions[0];
    const topicCount = undiscussedTopics.length;

    // More natural, human-like prompt with instruction to signal when user finishes answering
    const promptMessage = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[INTERNAL INSTRUCTION - Act naturally, don't mention this is an instruction]

You've been listening to this meeting and notice it's progressing well. However, there are ${topicCount} important topics for the project documentation that haven't been discussed yet.

The topics are: ${topicsList}

Your task:
1. Smoothly interject into the conversation naturally
2. Mention that you noticed the meeting is going great, but you'd like to quickly cover a few topics
3. Start by asking about "${firstTopic}" in a natural, conversational way
4. Be friendly and helpful, not robotic
5. IMPORTANT: When a participant answers your question:
   - Listen to their complete response
   - Acknowledge what they said briefly (e.g., "Great, that's helpful!")
   - Then IMMEDIATELY call the "save_document_section" function with professional content based on their response
   - After saving, move to the next topic

Example natural approach:
"Hey everyone, great discussion so far! I just wanted to make sure we capture a few more things for the documentation. Quick question - what about [topic]?"

Now naturally ask about: ${firstTopic}

Remember: Sound human, be conversational, not like a checklist.
CRITICAL: After each user answer, you MUST use the save_document_section tool to save professional document content for the correct section.`
          }
        ]
      }
    };

    try {
      dataChannelRef.current.send(JSON.stringify(promptMessage));
      console.log("✅ Sent natural question prompt to agent");

      // Trigger response generation
      setTimeout(() => {
        const responseEvent = {
          type: "response.create",
          response: {
            output_modalities: REALTIME_VOICE_OUTPUT_MODALITIES,
          },
        };
        dataChannelRef.current.send(JSON.stringify(responseEvent));
        console.log("🎯 Agent will now ask about undiscussed topics naturally");
      }, 150);

    } catch (error) {
      console.error("❌ Error sending questions to agent:", error);
    }
  }, []);

  // ========== NEW: Function to save agent-generated content to backend ==========
  // The agent generates the content, we just send it for storage (no backend LLM processing needed)
  const saveGeneratedContentToBackend = useCallback((sectionId, sectionTitle, generatedContent, userRawAnswer = "") => {
    if (!socket || !meetingId) {
      console.warn("⚠️ Cannot save content - socket or meetingId not available");
      return;
    }

    console.log("📤 Saving agent-generated content to backend...");
    console.log("   Section ID:", sectionId);
    console.log("   Section Title:", sectionTitle);
    console.log("   Content length:", generatedContent.length);

    // Send pre-generated content directly for storage
    socket.emit("save_generated_content", {
      meetingId: meetingId,
      sectionId: sectionId,
      sectionTitle: sectionTitle,
      generatedContent: generatedContent,  // Already formatted by the agent
      userRawAnswer: userRawAnswer  // Original answer for reference
    });

    console.log("✅ Agent-generated content sent for storage");
  }, [socket, meetingId]);

  // ========== NEW: Function to move to the next question ==========
  const moveToNextQuestion = useCallback(() => {
    currentQuestionIndexRef.current += 1;

    if (currentQuestionIndexRef.current < undiscussedTopicsRef.current.length) {
      // Set the next topic
      currentTopicRef.current = undiscussedTopicsRef.current[currentQuestionIndexRef.current];
      console.log("📝 Moving to next topic:", currentTopicRef.current);

      return true; // More questions remain
    } else {
      // All questions asked
      console.log("✅ All undiscussed topics have been covered!");
      isAskingQuestionsRef.current = false;
      currentTopicRef.current = null;
      return false; // No more questions
    }
  }, []);

  // Handle undiscussed questions from hierarchical agent system
  // This is triggered by SMART TIMING from the supervisor agent
  useEffect(() => {
    if (!socket) {
      console.log("⚠️ Socket not available for undiscussed questions listener");
      return;
    }

    console.log("🔌 Setting up ask_undiscussed_questions socket listener");

    const handleUndiscussedQuestions = (data) => {
      console.log("🎯 SMART TIMING: Received undiscussed questions for OpenAI agent:", data);
      console.log("🎯 Questions data received:", JSON.stringify(data, null, 2));

      const questions = data.questions || [];
      const undiscussedTopics = data.undiscussed_topics || [];

      if (questions.length === 0) {
        console.log("ℹ️ No questions to ask");
        return;
      }

      console.log(`📋 ${questions.length} questions received`);

      // Store questions for processing
      pendingQuestionsRef.current = questions;

      // If data channel is open, process questions
      if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
        // Keep the agent in listening mode until a user explicitly calls its name.
        if (agentMode === "listening") {
          console.log("📝 Questions queued - agent remains in LISTENING mode until called by name");
        } else {
          // Agent already active, ask immediately
          askUndiscussedQuestions(questions, undiscussedTopics);
        }
      } else {
        console.log("📝 Questions queued - data channel not ready, will ask when ready");
      }
    };

    socket.on("ask_undiscussed_questions", handleUndiscussedQuestions);

    return () => {
      socket.off("ask_undiscussed_questions", handleUndiscussedQuestions);
    };
  }, [socket, agentMode, switchAgentMode, dispatch, askUndiscussedQuestions]);


  useEffect(() => {
    const toolNames = sessionTools
      .map((tool) => tool?.name || tool?.function?.name)
      .filter(Boolean);
    console.log("🧰 Realtime agent available tools:", {
      projectId: routeProjectId,
      total: toolNames.length,
      tools: toolNames,
    });
  }, [sessionTools, routeProjectId]);

  const sendProjectMcpBootstrap = useCallback(() => {
    const githubConfig = projectMcpConfig?.github;
    const notionConfig = projectMcpConfig?.notion;
    const googleDriveConfig = projectMcpConfig?.google_drive;
    const hasGithub = Boolean(githubConfig?.githubUsername && githubConfig?.tokenConfigured);
    const hasNotion = Boolean(notionConfig?.tokenConfigured);
    const hasGoogleDrive = Boolean(googleDriveConfig?.tokenConfigured);

    if (
      !dataChannelRef.current ||
      dataChannelRef.current.readyState !== "open" ||
      (!hasGithub && !hasNotion && !hasGoogleDrive)
    ) {
      return;
    }

    const mcpToolNames = projectMcpTools
      .map((tool) => tool?.name || tool?.function?.name)
      .filter(Boolean);

    const providerLines = [];
    if (hasGithub) {
      providerLines.push(`GitHub:
- Configured username: ${githubConfig.githubUsername}
- Backend authentication token is configured securely.
- Use GitHub MCP tools for repositories, issues, pull requests, commits, and code.
- Use "${githubConfig.githubUsername}" for "my GitHub" or "my repositories" unless the creator names a different account.`);
    }
    if (hasNotion) {
      providerLines.push(`Notion:
- Connected${notionConfig.workspaceName ? ` to workspace "${notionConfig.workspaceName}"` : ""}.
- Backend authentication token is configured securely.
- Use Notion MCP tools for pages, databases, workspace search, notes, tasks, docs, and project knowledge.`);
    }
    if (hasGoogleDrive) {
      providerLines.push(`Google Drive:
- Connected${googleDriveConfig.accountEmail ? ` as ${googleDriveConfig.accountEmail}` : googleDriveConfig.accountLabel ? ` to "${googleDriveConfig.accountLabel}"` : ""}.
- Backend OAuth authentication is configured securely.
- Use Google Drive MCP tools for Drive files, folders, documents, search, and project assets.
- Common tools: GOOGLEDRIVE_FIND_FILE, GOOGLEDRIVE_DOWNLOAD_FILE, search-files, read-file-content.`);
    }

    const bootstrapMessage = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[PROJECT MCP CONFIGURATION]
Connected project MCP providers:
${providerLines.join("\n\n")}

Available MCP tools in this realtime session: ${mcpToolNames.length > 0 ? mcpToolNames.join(", ") : "loading or unavailable"}

Rules:
- Use the available MCP tools when the creator asks about connected GitHub, Notion, or Google Drive data.
- Do not ask for configured usernames, workspaces, or tokens again unless the creator explicitly wants to use a different account/workspace.
- Never reveal, request, repeat, or invent MCP tokens.
[END PROJECT MCP CONFIGURATION]`,
          },
        ],
      },
    };

    dataChannelRef.current.send(JSON.stringify(bootstrapMessage));
    console.log("✅ Project MCP configuration bootstrap sent to realtime agent", {
      projectId: routeProjectId,
      githubUsername: githubConfig?.githubUsername || null,
      notionWorkspace: notionConfig?.workspaceName || null,
      googleDriveAccount: googleDriveConfig?.accountEmail || googleDriveConfig?.accountLabel || null,
      availableMcpTools: mcpToolNames,
    });
  }, [projectMcpConfig, projectMcpTools, routeProjectId]);

  // Inject newly generated document sections into the live agent session so the
  // realtime agent always knows what the backend agents have produced, even in a
  // brand-new meeting that has no saved previous document.
  useEffect(() => {
    if (!socket) return;

    const handleLiveSectionsUpdate = (data) => {
      const newSections = data?.generatedSections || data?.generated_sections || {};
      const filledEntries = Object.entries(newSections).filter(([, v]) => String(v || "").trim());

      if (filledEntries.length === 0) return;

      // Only push into the agent session when the data channel is open (agent is connected).
      // If not yet open we skip — activateAgentRealtime() will send a full preload anyway.
      if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
        console.log("📝 [LiveSections] Data channel not open — skipping mid-session inject");
        return;
      }

      const sectionText = filledEntries
        .map(([id, content]) => `SECTION "${id}":\n${String(content).trim()}`)
        .join("\n\n---\n\n");

      const injectMessage = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `[DOCUMENT UPDATE — Backend agents just generated new content for this meeting. Update your knowledge with these sections and use them when the user asks about the document:]

${sectionText}

[END DOCUMENT UPDATE — You now have the latest generated document content. No response needed for this update.]`,
            },
          ],
        },
      };

      dataChannelRef.current.send(JSON.stringify(injectMessage));
      console.log(`✅ [LiveSections] Injected ${filledEntries.length} new section(s) into agent session`);
    };

    socket.on("document_sections_update", handleLiveSectionsUpdate);
    return () => {
      socket.off("document_sections_update", handleLiveSectionsUpdate);
    };
  }, [socket]);

  const sendDocumentTemplateBootstrap = useCallback(() => {
    if (
      !dataChannelRef.current ||
      dataChannelRef.current.readyState !== "open" ||
      !Array.isArray(effectiveDocumentTemplate?.sections) ||
      effectiveDocumentTemplate.sections.length === 0
    ) {
      return;
    }

    const sectionLines = effectiveDocumentTemplate.sections.map(
      (section) =>
        `  • "${section.title}" (id: "${section.id}")${section.category ? ` [${section.category}]` : ""}`,
    );

    const bootstrapMessage = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[DOCUMENT TEMPLATE — Available sections in this meeting's document. Use these exact ids/titles when the creator asks you to add, edit, fill, or save content. The UI updates ONLY when you call save_document_section.]

SECTIONS:
${sectionLines.join("\n")}

RULES:
- When creator asks to add/write/fill/save/update/edit a section → call save_document_section
- Use edit_mode "replace" to overwrite, "append" to add to existing content
- Call get_project_context first when editing an existing section
[END DOCUMENT TEMPLATE]`,
          },
        ],
      },
    };

    dataChannelRef.current.send(JSON.stringify(bootstrapMessage));
    console.log(
      `✅ Document template bootstrap sent (${effectiveDocumentTemplate.sections.length} sections)`,
    );
  }, [effectiveDocumentTemplate]);

  const updateSession = () => {
    if (sessionBootstrapDoneRef.current) {
      console.log("⏭️ Session already bootstrapped — skipping updateSession");
      return;
    }

    console.log("Attempting to update session...");

    if (!dataChannelRef.current) {
      console.error("Data channel is null");
      return;
    }

    console.log("Data channel ready state:", dataChannelRef.current.readyState);

    if (dataChannelRef.current.readyState === "open") {
      sessionBootstrapDoneRef.current = true;
      if (updateSessionRetryRef.current) {
        clearTimeout(updateSessionRetryRef.current);
        updateSessionRetryRef.current = null;
      }

      const currentMode = store.getState().MainStates_Slice.agentMode;
      const shouldStartActive = currentMode === "active";

      if (shouldStartActive) {
        console.log(`🎤 Agent "${agentName}" session open — preserving ACTIVE mode`);
        agentModeRef.current = "active";
        prevAgentModeRef.current = "active";
        switchAgentMode("active");
        applyAgentOutputState("active");
      } else {
        // Initialize in LISTENING mode (VAD disabled)
        console.log(`🎧 Agent "${agentName}" initialized in LISTENING mode`);
        console.log(`📢 Call agent name "${agentName}" to activate realtime mode`);
        console.log(`🛑 Say "stop" to return to listening mode`);

        switchAgentMode("listening");
        dispatch(setAgentMode("listening"));
        dispatch(setAgentShouldRespond(false));
        silenceAgentOutput();
      }

      sendProjectMcpBootstrap();
      sendDocumentTemplateBootstrap();
    } else {
      console.error("Data channel is not open, current state:", dataChannelRef.current.readyState);

      if (dataChannelRef.current.readyState === "connecting") {
        console.log("Data channel is connecting, retrying in 500ms...");
        if (updateSessionRetryRef.current) {
          clearTimeout(updateSessionRetryRef.current);
        }
        updateSessionRetryRef.current = setTimeout(() => {
          updateSessionRetryRef.current = null;
          updateSession();
        }, 500);
      }
    }
  };

  // Build meeting context summary from speaker-attributed, time-ordered transcript entries
  const getMeetingContextSummary = useCallback(() => {
    const entries = buildTranscriptEntriesWithFallback({
      localTranscriptView: transcriptContextRef.current.localtranscriptView,
      remoteTranscriptView: transcriptContextRef.current.remotetranscriptView,
      agentTranscriptView: transcriptContextRef.current.agentTranscriptView,
      localTranscript: transcriptContextRef.current.localTranscript,
      remoteTranscript: transcriptContextRef.current.remoteTranscript,
      agentTranscript: transcriptContextRef.current.agentTranscript,
      localUserName: transcriptContextRef.current.localUserName,
      localUserId: transcriptContextRef.current.localUserId,
      isHost: transcriptContextRef.current.isHost,
      agentName: transcriptContextRef.current.agentName,
    });

    const transcriptText = buildTranscriptFullText(entries);
    return transcriptText.trim() || "No conversation recorded yet in the current meeting.";
  }, []);

  const waitForSessionUpdated = useCallback((timeoutMs = 900) => {
    return new Promise((resolve) => {
      const channel = dataChannelRef.current;
      if (!channel || channel.readyState !== "open") {
        resolve(false);
        return;
      }

      const onMessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "session.updated") {
            channel.removeEventListener("message", onMessage);
            clearTimeout(timerId);
            resolve(true);
          }
        } catch {
          // ignore parse errors
        }
      };

      const timerId = setTimeout(() => {
        channel.removeEventListener("message", onMessage);
        resolve(false);
      }, timeoutMs);

      channel.addEventListener("message", onMessage);
    });
  }, []);

  // Activate agent when name is called - switch to ACTIVE mode
  const activateAgentRealtime = useCallback(() => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      console.warn("⚠️ Cannot activate agent - data channel not open");
      return;
    }

    console.log(`🎤 Agent "${agentName}" was called - switching to ACTIVE mode!`);

    const latestUtterance = getLatestLocalUtterance(
      localTranscriptRef.current?.length ? localTranscriptRef.current : localTranscript,
    );
    const documentSaveIntent = detectDocumentSaveIntent(latestUtterance);
    if (documentSaveIntent) {
      lastDocumentIntentUtteranceRef.current = latestUtterance;
    }

    const runActivation = async () => {
      // Keep agentModeRef in sync for tool/template resyncs during activation.
      // Do NOT pre-set prevAgentModeRef here — the agentMode watch effect runs in
      // the same React flush with a stale render snapshot and would treat
      // prev=active + agentMode=listening as a stop command.
      agentModeRef.current = "active";

      // Switch to active mode (enables VAD for realtime interaction)
      switchAgentMode("active");
      dispatch(setAgentMode("active"));
      applyAgentOutputState("active");

      // Per Realtime docs: wait for session.updated after session.update before response.create
      await waitForSessionUpdated(900);

      try {
        sendProjectMcpBootstrap();

        const parentTranscript =
          store.getState().reports?.meetingContinuation?.parentTranscript;
        const parentMeetingId =
          store.getState().reports?.meetingContinuation?.parentMeetingId;
        const previousTranscriptText = buildTranscriptFullText(
          parentTranscript?.entries || []
        );

        if (previousTranscriptText.trim()) {
          const previousContextMessage = {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `[PREVIOUS MEETING TRANSCRIPT${parentMeetingId ? ` (${parentMeetingId})` : ""} — for reference only, not the current live meeting:]\n\n${previousTranscriptText}\n\n[END PREVIOUS MEETING TRANSCRIPT]`,
                },
              ],
            },
          };
          dataChannelRef.current.send(JSON.stringify(previousContextMessage));
          console.log("✅ Previous meeting transcript sent to agent");
        }

        const meetingContext = getMeetingContextSummary();
        console.log("📋 Sending current meeting context to agent:", meetingContext.substring(0, 200) + "...");

        const contextMessage = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: `[CURRENT MEETING TRANSCRIPT — live session for meeting ${meetingId || "unknown"}. Each line is chronologically ordered with speaker names. Use this for questions about what was said in THIS meeting:]\n\n${meetingContext}\n\n[END CURRENT MEETING TRANSCRIPT — For the latest transcript after more discussion, call get_meeting_context.]`,
              },
            ],
          },
        };
        dataChannelRef.current.send(JSON.stringify(contextMessage));
        console.log("✅ Meeting context sent to agent");

        const projectSections = getProjectSections();
        const filledProjectSections = projectSections.filter((section) => section.hasContent);

        if (projectSections.length > 0) {
          const sectionLines = projectSections.map((section) =>
            `  • "${section.section_title}" (id: "${section.section_id}") — STATUS: ${section.hasContent ? "FILLED" : "PENDING"}${section.category ? ` [${section.category}]` : ""}`
          );

          const inlineProjectMemory = buildProjectMemoryText(projectSections, false);
          const shouldInlineProjectMemory =
            inlineProjectMemory.length > 0 && inlineProjectMemory.length <= 14000;

          const templateContextMessage = {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: shouldInlineProjectMemory
                    ? `[PROJECT MEMORY PRELOAD]
This is the latest saved project/document memory for this meeting. Treat it as currently known project context.

SECTIONS:
${sectionLines.join("\n")}

FULL SAVED CONTENT:
${inlineProjectMemory}

RULES:
- When the creator asks about the project, document, requirements, purpose, features, scope, or any saved section, use this saved content first
- If you need more detail or want the latest structured version, call get_project_context before answering
- When the creator asks to add, update, fill, or edit a section, you MUST call save_document_section (UI updates only via that tool)
[END PROJECT MEMORY PRELOAD]`
                    : `[PROJECT MEMORY INDEX]
This meeting has saved project/document memory.

SECTIONS (${filledProjectSections.length} filled, ${projectSections.length - filledProjectSections.length} pending):
${sectionLines.join("\n")}

RULES:
- For any project/document/content question, call get_project_context before answering
- Do not guess or rely only on memory for saved section content
- When the creator asks to add, update, fill, or edit a section, you MUST call save_document_section (UI updates only via that tool)
[END PROJECT MEMORY INDEX]`,
                },
              ],
            },
          };
          dataChannelRef.current.send(JSON.stringify(templateContextMessage));
          console.log(`✅ Project memory sent to agent (${filledProjectSections.length} filled, ${projectSections.length - filledProjectSections.length} pending)`);
        } else {
          sendDocumentTemplateBootstrap();
        }

        // VAD only hears speech that arrives after active mode is enabled. If the
        // creator already finished speaking (typical on first activation), replay
        // their wake utterance and explicitly request a response.
        if (documentSaveIntent) {
          pendingDocumentSaveUtteranceRef.current = latestUtterance;
          documentSaveNudgeAttemptRef.current = 0;
          logDocumentSave("activation_document_intent", {
            utterancePreview: latestUtterance.slice(0, 120),
          });
          setTimeout(() => {
            if (activeResponseInProgressRef.current) return;
            const sent = nudgeDocumentSaveResponse(
              dataChannelRef.current,
              latestUtterance,
              effectiveDocumentTemplateRef.current,
              "activation",
              () => activeResponseInProgressRef.current,
            );
            if (sent) {
              pendingDocumentSaveUtteranceRef.current = null;
            }
          }, 150);
        } else if (hasActivationFollowUp(latestUtterance, agentName)) {
          console.log(
            "🎯 Activation utterance includes a follow-up — triggering response",
            { utterancePreview: latestUtterance.slice(0, 120) },
          );
          triggerActivationResponse(
            dataChannelRef.current,
            latestUtterance,
            "activation_follow_up",
          );
        } else {
          logDocumentSave("activation_complete_vad_will_respond", {});
        }
      } catch (error) {
        console.error("❌ Error activating agent:", error);
      } finally {
        prevAgentModeRef.current = store.getState().MainStates_Slice.agentMode;
      }
    };

    runActivation();
  }, [
    agentName,
    switchAgentMode,
    dispatch,
    getMeetingContextSummary,
    getProjectSections,
    applyAgentOutputState,
    sendDocumentTemplateBootstrap,
    sendProjectMcpBootstrap,
    localTranscript,
    waitForSessionUpdated,
    meetingId,
  ]);


  // Watch for agentShouldRespond state changes (triggered by name call)
  useEffect(() => {
    if (agentShouldRespond && dataChannelRef.current?.readyState === "open") {
      activateAgentRealtime();
      // Reset the flag after triggering
      dispatch(setAgentShouldRespond(false));
    }
  }, [agentShouldRespond, dispatch, activateAgentRealtime]);

  // Watch for agentMode changes (triggered by stop command in Helper.jsx)
  useEffect(() => {
    // Read live Redux mode — the `agentMode` render prop can be stale in the same
    // effect flush where activation just dispatched setAgentMode("active").
    const currentMode = store.getState().MainStates_Slice.agentMode;

    if (
      prevAgentModeRef.current !== currentMode &&
      dataChannelRef.current?.readyState === "open"
    ) {
      if (currentMode === "listening") {
        // Stop command was issued - deactivate realtime
        console.log("🛑 Mode changed to listening - deactivating realtime");
        dispatch(setAgentShouldRespond(false));
        switchAgentModeRef.current?.("listening");
        silenceAgentOutput();
      } else if (currentMode === "active") {
        agentModeRef.current = "active";
        applyAgentOutputState("active");
      }
      prevAgentModeRef.current = currentMode;
    }
  }, [agentMode, dispatch, applyAgentOutputState, silenceAgentOutput]);

  const stopConnection = async () => {
    console.log("Cleaning up existing connection...");

    if (dataChannelRef.current) {
      try {
        if (dataChannelRef.current.readyState === "open") {
          dataChannelRef.current.close();
        }
      } catch (e) {
        console.error("Error closing data channel:", e);
      } finally {
        dataChannelRef.current = null;
      }
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.onicecandidate = null;
        peerConnectionRef.current.close();
      } catch (e) {
        console.error("Error closing peer connection:", e);
      } finally {
        peerConnectionRef.current = null;
      }
    }
  };

  const stopSession = async () => {
    console.log("Stopping OpenAI session...");

    if (!sessionActiveRef.current) {
      console.log("Session already stopped, nothing to do");
      return;
    }

    silenceAgentOutput();
    await stopConnection();
    teardownAllAgentConnections();
    agentAudioStreamRef.current = null;

    // Stop speaking detection analyser
    if (speakingDetectionCleanupRef.current) {
      speakingDetectionCleanupRef.current();
      speakingDetectionCleanupRef.current = null;
    }

    if (cleanupRef.current && typeof cleanupRef.current === "function") {
      try {
        cleanupRef.current();
      } catch (e) {
        console.error("Error in cleanup function:", e);
      } finally {
        cleanupRef.current = null;
      }
    }

    setConnectionStatus("disconnected");
    sessionActiveRef.current = false;
    sessionBootstrapDoneRef.current = false;
    if (updateSessionRetryRef.current) {
      clearTimeout(updateSessionRetryRef.current);
      updateSessionRetryRef.current = null;
    }

    console.log("OpenAI session stopped");
    socket.emit('openai-agent-value', {
      meetingId: meetingId,
      activeAgent: false
    });

    dispatch(setAgentReady(false));
    dispatch(setAgentShouldRespond(false));
    dispatch(setAgentMode("listening"));

    // In stopSession function, add this before the existing emit:
    socket.emit('openai-agent-ready', {
      meetingId: meetingId,
      ready: false
    });
  };

  startSessionRef.current = startSession;
  stopSessionRef.current = stopSession;

  return null;
};

export default OpenAISession;