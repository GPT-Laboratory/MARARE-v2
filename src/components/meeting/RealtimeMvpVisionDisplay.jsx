/**
 * Live-updating MVP and Vision text from agent updates.
 * File: src/components/meeting/RealtimeMvpVisionDisplay.jsx
 */

import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useMemo, useLayoutEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Card, Typography, Drawer, Spin, List, Collapse, Badge, Tabs, Tag, Progress, Tooltip, Empty, Modal, Space, Input } from 'antd';
import {
  EyeOutlined,
  RocketOutlined,
  CloseOutlined,
  ThunderboltOutlined,
  LoadingOutlined,
  FileTextOutlined,
  DownOutlined,
  UpOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  BookOutlined,
  FolderOpenOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  DownloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph as DocxParagraph, TextRun, HeadingLevel } from 'docx';
import { Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, WidthType } from 'docx';
import { saveAs } from 'file-saver';



import { GiArtificialHive } from 'react-icons/gi';
import { getSocket } from '../../services/meeting/socketInstance';
import { setEnableCaptions, setFunctionalRequirements, setMeetingNotes, setMVP, setNonFunctionalRequirements, setVision } from '../../features/mainStates/MainStates_Slice';
import { useRefs } from '../../providers/RefProvider';
import { startAutoSend, stopAutoSend, setTeamAmvp, setTeamAvision, setTeamBmvp, setTeamBvision, setTeamCmvp, setTeamCvision, setGeneratedDocumentSections, setReceivedDocumentTemplate as setReduxReceivedTemplate } from '../../features/ReportSlice';
import {
  computeNextDocumentVersion,
  buildTranscriptEntriesWithFallback,
  buildTranscriptFullText,
} from '../../utils/meetingTranscriptUtils';
import { buildDefaultRevisionHistoryRows, buildRevisionHistoryTableRows, parseStoredDocumentVersionHistory } from '../../utils/projectDocumentStorage';
import { Sparkles } from 'lucide-react';
import { initializeAzureSTT, processRemoteStream, stopAllSTTRecognizers } from '../../helpers/Helper';
import { AGENT_DOCUMENT_SECTION_SAVED_EVENT } from '../../helpers/documentSectionSync';
import { DOC_LOG } from '../../helpers/documentSectionService';
import store from '../../store/store';

// import { useDispatch } from 'react-redux';
// import { saveGeneratedDocument } from './path-to-your-slice';
import { message } from 'antd';

// Add these imports at the top
import { SettingOutlined } from '@ant-design/icons';
// import { updateTeamAgent } from './path-to-your-teamConfigSlice'; // Update path
import ConfigurationDrawer from '../../components/meeting/TeamsConfiguration';
import TeamSectionData from '../../components/meeting/TeamSection';
import { teamColors } from '../../components/meeting/TeamsColors';
import { useParams } from 'react-router-dom';
import { saveGeneratedDocument, updateGeneratedDocument, getDocumentsByProject } from '../../features/mainStates/Template_Slice';
import { saveMeetingSummary, updateMeetingSummary } from '../../features/mainStates/Summary_Slice';
import { saveMeetingMvpVision } from '../../features/mainStates/MvpVision_Slice';
import { getUserId } from '../../services/auth/GetLoginUserId';
import {
  resolveMeetingContinuationPayload,
} from '../../utils/meetingContinuationUtils';
import { getMeetingStorageSource } from '../../utils/unifiedMeetingHistory';
import {
  getDriveDocumentTitle,
  saveMeetingDocumentToDrive,
} from '../../utils/googleDriveMcpDocuments';
import {
  buildExternalDocumentPayload,
  saveMeetingDocumentToNotion,
} from '../../utils/notionMcpDocuments';
import {
  fetchProjectDocumentStorage,
  resolveDocumentStorageBackend,
  STORAGE_BACKEND,
} from '../../utils/projectDocumentStorage';
import {
  filterSupabaseProjectDocuments,
  isExternalDocumentRecord,
  isSupabaseDocumentId,
  resolveSupabaseContinuationDocumentId,
  resolveSupabaseDocumentForMeeting,
} from '../../utils/documentStorageRecords';
// import { constants } from 'fs/promises';



const { Title, Paragraph, Text } = Typography;
// const { Title, Text } = Typography;

const normalizeSectionKey = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();

/** Non-empty trimmed string from stored section values */
function pickFilledContent(raw) {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  const t = s.trim();
  return t;
}

/**
 * Resolve saved content for a template section regardless of whether the agent
 * stored it under canonical id, stringified id, title slug, or normalized keys.
 */
function resolveStoredSectionContent(section, sectionsMap) {
  if (!section || !sectionsMap || typeof sectionsMap !== 'object') return '';

  const titleSnake =
    typeof section.title === 'string'
      ? section.title.toLowerCase().replace(/\s+/g, '_')
      : '';

  const tryKeys = [
    section.id,
    section.id != null && section.id !== '' ? String(section.id) : '',
    normalizeSectionKey(section.id),
    titleSnake,
    normalizeSectionKey(section.title),
  ].filter((key, idx, arr) => key !== '' && key != null && arr.indexOf(key) === idx);

  for (const key of tryKeys) {
    const c = pickFilledContent(sectionsMap[key]);
    if (c) return sectionsMap[key];
  }

  const idNorm = normalizeSectionKey(section.id);
  const titleNorm = normalizeSectionKey(section.title);
  for (const [storedKey, raw] of Object.entries(sectionsMap)) {
    const c = pickFilledContent(raw);
    if (!c) continue;
    const kn = normalizeSectionKey(storedKey);
    if (idNorm && kn === idNorm) return raw;
    if (titleNorm && kn === titleNorm) return raw;
    // Fuzzy alias: plural/slug drift (e.g. user_persona vs user_personas) vs exact equality above
    const MIN_SUB = 6;
    if (idNorm.length >= MIN_SUB && kn.length >= MIN_SUB) {
      if (kn.includes(idNorm) || idNorm.includes(kn)) return raw;
    }
    if (titleNorm.length >= MIN_SUB && kn.length >= MIN_SUB) {
      if (kn.includes(titleNorm) || titleNorm.includes(kn)) return raw;
    }
    if (titleSnake.length >= 4 && kn.length >= MIN_SUB) {
      const tsNorm = normalizeSectionKey(titleSnake);
      if (tsNorm.length >= MIN_SUB || kn.length >= MIN_SUB) {
        if (kn.includes(tsNorm) || tsNorm.includes(kn)) return raw;
      }
    }
  }

  return '';
}

function templateSectionMatchesId(section, sectionId) {
  if (!section || sectionId == null || sectionId === "") return false;
  const key = String(sectionId);
  const titleSnake =
    typeof section.title === "string"
      ? section.title.toLowerCase().replace(/\s+/g, "_")
      : "";
  return (
    section.id === sectionId ||
    (section.id != null && String(section.id) === key) ||
    titleSnake === key ||
    normalizeSectionKey(section.id) === normalizeSectionKey(key) ||
    normalizeSectionKey(section.title) === normalizeSectionKey(key)
  );
}

/** Filter DevTools console by: AgentDocument (same tag as OpenAISession) */
const DOC_LOG_UI = DOC_LOG;
function logDocumentPanel(stage, payload) {
  console.info(DOC_LOG_UI, `[UI:${stage}]`, payload !== undefined ? payload : "");
}

const RealtimeMvpVisionDisplay = forwardRef(({ meetingId }, ref) => {
  const isDarkMode = true;
  const { mvp, vision, meeting_notes, functional_requirements, non_functional_requirements, agenda } = useSelector(
    (state) => state.MainStates_Slice
  );
  // const teamData = useSelector((state) => state.ReportSlice);
  const teamA = useSelector((state) => state.reports.teamA);
  const teamB = useSelector((state) => state.reports.teamB);
  const teamC = useSelector((state) => state.reports.teamC);


  const { project_id, id } = useParams();
  const dispatch = useDispatch();

  const [version, setVersion] = useState(1);
  const [revisionHistory, setRevisionHistory] = useState(() =>
    buildDefaultRevisionHistoryRows(1)
  );



  // Add new state for received template data
  const [receivedDocumentTemplate, setReceivedDocumentTemplate] = useState(null);
  const [receivedProjectName, setReceivedProjectName] = useState(null);

  const agent = useSelector((state) => state.MainStates_Slice.agent);
  const isAdmin = useSelector((state) => state.MainStates_Slice.isAdmin);
  const enableCaptions = useSelector(
    (state) => state.MainStates_Slice.enableCaptions
  );
  const agentName = useSelector((state) => state.MainStates_Slice.agentName);
  const activeAgent = useSelector(
    (state) => state.MainStates_Slice.activateAgent
  );
  const ephemeralKey = useSelector((state) => state.MainStates_Slice.ephemeralKey);

  // Add this state inside your component
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const teamConfig = useSelector((state) => state.teamConfig);

  const generatedDocuments = useSelector((state) => state.documents.generatedDocuments);
  const meetingContinuation = useSelector((state) => state.reports?.meetingContinuation);
  const usePreviousDocument =
    meetingContinuation?.mode === "continue" && Boolean(meetingContinuation?.parentDocument);

  // Watch Redux generatedDocumentSections (written by OpenAISession on immediate save)
  // and merge into local state so the UI updates without waiting for the backend round-trip.
  const reduxGeneratedSections = useSelector((state) => state.reports?.generatedDocumentSections || {});
  const projects = useSelector((state) => state.main.projects);
  const currentProject = projects.find((project) => String(project.id) === project_id);
  const documentTemplate = currentProject?.template_document;
  const templateToUse = documentTemplate || receivedDocumentTemplate;

  // console.log("generatedDocuments:", generatedDocuments);

  useEffect(() => {
    if (!project_id || !currentProject?.project_name) return;

    let cancelled = false;
    const loadPreviousDocument = async () => {
      if (!usePreviousDocument) {
        console.log("🆕 usePreviousDocument=false — skipping previous document load, starting fresh");
        setGeneratedDocSections({});
        dispatch(setGeneratedDocumentSections({}));
        return;
      }

      if (
        meetingContinuation?.mode !== "continue" ||
        !meetingContinuation?.parentDocument
      ) {
        return;
      }

      try {
        const selectedMeeting = {
          meeting_id: meetingContinuation.parentMeetingId,
          document: meetingContinuation.parentDocument,
          transcript: meetingContinuation.parentTranscript,
          storage_source:
            meetingContinuation.parentStorageSource ||
            getMeetingStorageSource({ document: meetingContinuation.parentDocument }),
        };

        const { document: latestDoc } = await resolveMeetingContinuationPayload(
          selectedMeeting,
          dispatch
        );

        if (cancelled || !latestDoc) return;

        setIsDocumentGenerated(true);
        setIsStop(true);

        console.log("📄 Loading selected previous document:", {
          parentDocumentId: meetingContinuation.parentDocumentId,
          parentMeetingId: meetingContinuation.parentMeetingId,
          storageSource: selectedMeeting.storage_source,
        });

        setVersion(latestDoc.version || 1);

        const docVersionHistory = parseStoredDocumentVersionHistory(latestDoc);
        if (docVersionHistory.length > 0) {
          setRevisionHistory(buildRevisionHistoryTableRows(docVersionHistory));
        } else {
          setRevisionHistory(buildDefaultRevisionHistoryRows(latestDoc.version || 1));
        }

        const generatedSections =
          latestDoc.generated_sections || latestDoc.generatedSections || {};

        setGeneratedDocSections(generatedSections);
        dispatch(setGeneratedDocumentSections(generatedSections));

        if (latestDoc.undiscussed_topics || latestDoc.undiscussedTopics) {
          setUndiscussedTopics(latestDoc.undiscussed_topics || latestDoc.undiscussedTopics);
        } else {
          setUndiscussedTopics([]);
        }

        if (latestDoc.meeting_phase || latestDoc.meetingPhase) {
          setMeetingPhase(latestDoc.meeting_phase || latestDoc.meetingPhase);
        }

        if (latestDoc.template && !documentTemplate) {
          setReceivedDocumentTemplate(latestDoc.template);
          dispatch(setReduxReceivedTemplate(latestDoc.template));
        }

        if (latestDoc.project_name && !currentProject?.project_name) {
          setReceivedProjectName(latestDoc.project_name);
        }
      } catch (error) {
        console.warn("No previous project document loaded for realtime display:", error);
      }
    };

    loadPreviousDocument();
    return () => {
      cancelled = true;
    };
  }, [
    project_id,
    currentProject?.project_name,
    usePreviousDocument,
    meetingContinuation?.mode,
    meetingContinuation?.parentDocumentId,
    meetingContinuation?.parentMeetingId,
    meetingContinuation?.parentDocument,
    meetingContinuation?.parentStorageSource,
    documentTemplate,
    dispatch,
  ]);

















  // COMPLETELY REWRITTEN - Single useEffect approach for proper cleanup

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDocumentGenerated, setIsDocumentGenerated] = useState(false);
  const [isLoopActive, setIsLoopActive] = useState(false);
  const [isStop, setIsStop] = useState(true); // Renamed from isStop to shouldStop for clarity
  const [shouldStop, setShouldStop] = useState(false); // Changed from isStop
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [shouldStart, setShouldStart] = useState(false); // New trigger for starting
  const [generatedDocSections, setGeneratedDocSections] = useState({});
  const [undiscussedTopics, setUndiscussedTopics] = useState([]);
  const [meetingPhase, setMeetingPhase] = useState('ongoing');
  const socket = getSocket();
  const sectionScrollPositionsRef = useRef({});
  const sectionContentRefs = useRef({});
  // console.log("currentProject :", currentProject);

  /** Redux is source of truth — always wins over stale local state */
  const mergedGeneratedSectionsForDisplay = useMemo(
    () => ({
      ...(generatedDocSections && typeof generatedDocSections === 'object'
        ? generatedDocSections
        : {}),
      ...(reduxGeneratedSections && typeof reduxGeneratedSections === 'object'
        ? reduxGeneratedSections
        : {}),
    }),
    [reduxGeneratedSections, generatedDocSections],
  );

  useLayoutEffect(() => {
    Object.entries(sectionContentRefs.current).forEach(([sectionId, element]) => {
      if (!element) return;
      const savedTop = sectionScrollPositionsRef.current[sectionId];
      if (typeof savedTop === 'number') {
        element.scrollTop = savedTop;
      }
    });
  }, [mergedGeneratedSectionsForDisplay]);

  // When OpenAISession saves a section it immediately writes to Redux.
  // Always merge Redux into local state (never bail early): partial socket
  // payloads can make "changed keys" detection miss updates or leave local
  // state out of sync across breakpoints/remounts.
  useEffect(() => {
    if (!reduxGeneratedSections || typeof reduxGeneratedSections !== "object") return;
    if (Object.keys(reduxGeneratedSections).length === 0) return;

    const keysWithContent = Object.keys(reduxGeneratedSections).filter((k) =>
      pickFilledContent(reduxGeneratedSections[k]),
    );
    logDocumentPanel("redux_to_local_merge", {
      incomingKeysCount: keysWithContent.length,
      incomingKeysSample: keysWithContent.slice(0, 24),
      templateSectionCount: Array.isArray(templateToUse?.sections)
        ? templateToUse.sections.length
        : 0,
    });

    setGeneratedDocSections((prev) => {
      const newlyFilledKeys = Object.keys(reduxGeneratedSections).filter(
        (key) =>
          pickFilledContent(reduxGeneratedSections[key]) &&
          pickFilledContent(prev[key]) !== pickFilledContent(reduxGeneratedSections[key]),
      );

      if (templateToUse?.sections && newlyFilledKeys.length > 0) {
        const categoriesToExpand = newlyFilledKeys
          .map((key) =>
            templateToUse.sections.find((s) => templateSectionMatchesId(s, key))?.category ||
            templateToUse.sections.find(
              (s) => normalizeSectionKey(s.id) === normalizeSectionKey(key),
            )?.category ||
            templateToUse.sections.find(
              (s) => s.title?.toLowerCase?.().replace(/\s+/g, '_') === key,
            )?.category,
          )
          .filter(Boolean);

        if (categoriesToExpand.length > 0) {
          setExpandedCategories((prevCats) => {
            const next = [...new Set([...prevCats, ...categoriesToExpand])];
            return next.length !== prevCats.length ? next : prevCats;
          });
        }
      }

      if (newlyFilledKeys.length > 0) {
        const firstKey = newlyFilledKeys[0];
        const matchedSection = templateToUse?.sections?.find(
          (s) =>
            templateSectionMatchesId(s, firstKey) ||
            normalizeSectionKey(s.id) === normalizeSectionKey(firstKey) ||
            s.title?.toLowerCase?.().replace(/\s+/g, "_") === firstKey,
        );
        const sectionLabel =
          matchedSection?.title ||
          firstKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

        message.success({
          content: `📝 "${sectionLabel}" updated in the document`,
          duration: 3,
          style: { marginTop: "60px" },
        });
      }

      return { ...prev, ...reduxGeneratedSections };
    });
  }, [reduxGeneratedSections, templateToUse]);

  // ── PDF Preview Modal state ──────────────────────────────────────────────
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false);
  const [previewViewMode, setPreviewViewMode] = useState('pdf');
  const [previewTocVisible, setPreviewTocVisible] = useState(true);
  const [previewAccordionKeys, setPreviewAccordionKeys] = useState([]);

  // ── Helpers shared between preview and download ─────────────────────────
  const removeMarkdownFormatting = (text) => {
    if (!text) return text;
    return text.replace(/\*\*([^*]+)\*\*/g, '$1');
  };

  const formatContent = (content) => {
    if (!content) return null;
    const cleanContent = removeMarkdownFormatting(content);
    const lines = cleanContent.split('\n');
    return lines.map((line, index) => {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('- ')) {
        return (
          <div key={index} style={{ paddingLeft: '20px', marginBottom: '4px', display: 'flex', alignItems: 'flex-start' }}>
            <span style={{ marginRight: '8px', color: '#1890ff' }}>•</span>
            <span>{trimmedLine.substring(2)}</span>
          </div>
        );
      }
      const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/);
      if (numberedMatch) {
        return (
          <div key={index} style={{ paddingLeft: '20px', marginBottom: '4px', display: 'flex', alignItems: 'flex-start' }}>
            <span style={{ marginRight: '8px', fontWeight: 'bold', color: '#1890ff', minWidth: '20px' }}>{numberedMatch[1]}.</span>
            <span>{numberedMatch[2]}</span>
          </div>
        );
      }
      if (trimmedLine) return <div key={index} style={{ marginBottom: '8px' }}>{trimmedLine}</div>;
      return <div key={index} style={{ height: '8px' }} />;
    });
  };

  const generatePreviewTOC = (sections) => {
    if (!sections || !sections.length) return [];
    const tocItems = [];
    let categoryIndex = 0;
    let currentCategory = null;
    let subIndex = 0;
    sections.forEach((section) => {
      if (section.category !== currentCategory) {
        categoryIndex++;
        subIndex = 0;
        currentCategory = section.category;
        tocItems.push({
          id: `cat-${section.category}`,
          number: `${categoryIndex}`,
          title: section.categoryTitle || section.category?.replace(/_/g, ' '),
          isCategory: true,
          sectionId: section.id,
        });
      }
      subIndex++;
      tocItems.push({
        id: section.id,
        number: `${categoryIndex}.${subIndex}`,
        title: section.title,
        isCategory: false,
        sectionId: section.id,
      });
    });
    return tocItems;
  };

  const scrollToPreviewSection = (sectionId) => {
    if (!previewAccordionKeys.includes(sectionId)) {
      setPreviewAccordionKeys(prev => [...prev, sectionId]);
    }
    setTimeout(() => {
      const element = document.querySelector(`.preview-section-panel-${sectionId}`);
      if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };


  // Get wantDocumentTemplate from Redux
  const wantDocumentTemplate = useSelector((state) => state.MainStates_Slice.wantDocumentTemplate);
  const mvpVisionTemplate = useSelector((state) => state.MainStates_Slice.mvpVisionTemplate);

  // Use received template if local template is not available

  const projectNameToUse = currentProject?.project_name || receivedProjectName;

  // State for document template view
  const [activeDocTab, setActiveDocTab] = useState('document'); // 'teams' or 'document'
  const [expandedCategories, setExpandedCategories] = useState([]);

  // State for meeting summary (when wantDocumentTemplate is false)
  const [meetingSummary, setMeetingSummary] = useState('');
  const [isSummaryStarted, setIsSummaryStarted] = useState(false);
  const [isSummaryGenerating, setIsSummaryGenerating] = useState(false);

  // State for MVP+Vision realtime updates (when mvpVisionTemplate is true)
  const [isMvpVisionProcessing, setIsMvpVisionProcessing] = useState(false);

  // Which content to show based on last broadcast (for remote users: document | summary | mvpvision)
  const [activeBroadcastType, setActiveBroadcastType] = useState(null);

  // Meeting id string for guarding socket payloads (prop may be room id object or plain string).
  const resolvedMeetingKey = useMemo(() => {
    if (
      meetingId &&
      typeof meetingId === 'object' &&
      meetingId !== null &&
      'meetingId' in meetingId &&
      meetingId.meetingId != null
    ) {
      return String(meetingId.meetingId);
    }
    if (meetingId != null && meetingId !== '') return String(meetingId);
    return id != null && id !== '' ? String(id) : '';
  }, [meetingId, id]);

  // Direct bridge from OpenAISession when agent saves a section (bypasses Redux timing issues)
  useEffect(() => {
    const handleAgentSectionSaved = (event) => {
      const detail = event?.detail || {};
      const eventMeeting = detail.meetingId != null ? String(detail.meetingId) : "";
      if (
        eventMeeting &&
        resolvedMeetingKey &&
        eventMeeting !== resolvedMeetingKey
      ) {
        logDocumentPanel("agent_section_saved_ignored_meeting", {
          eventMeeting,
          resolvedMeetingKey,
          sectionId: detail.sectionId,
        });
        return;
      }

      const incoming = detail.generatedSections || {};
      const contentFromDetail = detail.content != null ? String(detail.content) : "";
      const hasIncomingMap =
        incoming &&
        typeof incoming === "object" &&
        Object.keys(incoming).length > 0;
      const hasDirectContent = Boolean(contentFromDetail.trim());

      if (!hasIncomingMap && !hasDirectContent) {
        logDocumentPanel("agent_section_saved_empty_payload", detail);
        return;
      }

      const sectionsToMerge = hasIncomingMap
        ? incoming
        : detail.sectionId
          ? { [detail.sectionId]: contentFromDetail }
          : {};

      logDocumentPanel("agent_section_saved_event", {
        sectionId: detail.sectionId,
        sectionTitle: detail.sectionTitle,
        keys: Object.keys(sectionsToMerge).filter((k) => pickFilledContent(sectionsToMerge[k])),
      });

      setIsDocumentGenerated(true);
      setActiveBroadcastType("document");

      setGeneratedDocSections((prev) => ({ ...prev, ...sectionsToMerge }));
      dispatch(setGeneratedDocumentSections({
        ...(store.getState().reports?.generatedDocumentSections || {}),
        ...sectionsToMerge,
      }));

      if (detail.documentTemplate) {
        setReceivedDocumentTemplate(detail.documentTemplate);
        dispatch(setReduxReceivedTemplate(detail.documentTemplate));
      }

      const label =
        detail.sectionTitle ||
        detail.sectionId ||
        "Document section";
      message.success({
        content: `📝 "${label}" saved to the document`,
        duration: 3,
        style: { marginTop: "60px" },
      });
    };

    window.addEventListener(AGENT_DOCUMENT_SECTION_SAVED_EVENT, handleAgentSectionSaved);
    return () => {
      window.removeEventListener(AGENT_DOCUMENT_SECTION_SAVED_EVENT, handleAgentSectionSaved);
    };
  }, [dispatch, resolvedMeetingKey]);

  const hasFilledDocContent = useMemo(() => {
    const nonempty = (m) =>
      m &&
      typeof m === 'object' &&
      Object.values(m).some((v) => Boolean(pickFilledContent(v)));
    return nonempty(generatedDocSections) || nonempty(reduxGeneratedSections);
  }, [generatedDocSections, reduxGeneratedSections]);

  // Show live document boards whenever we actually have sections to render or synced content —
  // not only after a "generated document" record exists or a broadcast flipped a flag (that hid agent fills).
  const canShowLiveDocumentPanels =
    isDocumentGenerated ||
    activeBroadcastType === 'document' ||
    Boolean(templateToUse?.sections?.length) ||
    hasFilledDocContent;

  const showLiveDocumentDrawer =
    activeBroadcastType === 'document' ||
    (activeDocTab === 'document' && (wantDocumentTemplate || canShowLiveDocumentPanels));

  // Add these new states after your existing states
  // const [lastSentPositions, setLastSentPositions] = useState({
  //   local: 0,
  //   remote: {}
  // });

  const {
    localStream,
    jointPeers,
    localTranscript,
    remoteTranscript,
    localtranscriptView,
    remotetranscriptView,
    agentTranscriptView,
    agentTranscript,
    remoteVideoRefs,
    setLocalTranscript,
    setLocaltranscriptView,
    setRemoteTranscript,
    setRemotetranscriptView,
    remotePeers,
    getNewTranscripts,
    updateLastSentPositions,
    resetLastSentPositions,
    formattedTime, startTiming, stopTiming, isRunning,
  } = useRefs();

  const toggleMobileDrawer = () => {
    setMobileDrawerOpen(!mobileDrawerOpen);
  };

  const isContentEmpty = !mvp && !vision && !meeting_notes && !functional_requirements && !non_functional_requirements && !teamA.mvp && !teamA.vision && !teamB.mvp && !teamB.vision;






  // Update sendTranscripts function


  // ✅ NEW: Save summary to database
  const handleSaveSummary = async () => {
    const userId = getUserId();

    // Guard: nothing to save
    if (!meetingSummary || meetingSummary.trim().length === 0) {
      message.warning('No summary content to save!');
      return;
    }

    try {
      const storageConfig = await fetchProjectDocumentStorage(project_id);
      const storageBackend = resolveDocumentStorageBackend(storageConfig);
      if (storageBackend !== STORAGE_BACKEND.SUPABASE) {
        // Summary is stored inside the Drive/Notion meeting document payload.
        return { skipped: true, backend: storageBackend };
      }
    } catch (error) {
      console.warn("Could not resolve storage backend for summary save:", error);
    }

    const summaryData = {
      userId,
      meetingId: meetingId?.meetingId || meetingId,
      projectId: project_id,
      projectName: currentProject?.project_name,
      summaryContent: meetingSummary,
      timestamp: new Date().toISOString(),
      teamData: {
        teamA,
        teamB,
        teamC
      },
      version: 1
    };

    try {
      const result = await dispatch(saveMeetingSummary(summaryData)).unwrap();
      message.success("Summary saved successfully!");
      console.log("✅ Summary saved:", result);
      return result;
    } catch (error) {
      message.error('Failed to save summary');
      console.error('Save summary error:', error);
      throw error;
    }
  };

  // ✅ Save MVP+Vision to database (when mvpVisionTemplate is enabled)
  const handleSaveMvpVision = async () => {
    const userId = getUserId();
    if (!mvp && !vision) {
      message.warning('No MVP or Vision content to save!');
      return;
    }
    try {
      const storageConfig = await fetchProjectDocumentStorage(project_id);
      const storageBackend = resolveDocumentStorageBackend(storageConfig);
      if (storageBackend !== STORAGE_BACKEND.SUPABASE) {
        return { skipped: true, backend: storageBackend };
      }
    } catch (error) {
      console.warn("Could not resolve storage backend for MVP/Vision save:", error);
    }

    const mvpvisionData = {
      userId,
      meetingId: meetingId?.meetingId || meetingId,
      projectId: project_id,
      projectName: currentProject?.project_name,
      mvp: mvp || '',
      vision: vision || '',
      timestamp: new Date().toISOString(),
      version: 1,
    };
    try {
      const result = await dispatch(saveMeetingMvpVision(mvpvisionData)).unwrap();
      message.success('MVP+Vision saved successfully!');
      console.log('✅ MVP+Vision saved:', result);
      return result;
    } catch (error) {
      message.error('Failed to save MVP+Vision');
      console.error('Save MVP+Vision error:', error);
      throw error;
    }
  };

  const prepareSyncedMeetingDocument = () => {
    const cleanedGeneratedSections = Object.fromEntries(
      Object.entries(generatedDocSections).filter(
        ([key, value]) => value && value.trim().length > 0
      )
    );

    const cleanedUndiscussedTopics = undiscussedTopics.filter((topic) => {
      const titleKey = topic.title?.toLowerCase().replace(/\s+/g, '_');
      const directMatch = cleanedGeneratedSections[topic.section_id];
      const titleMatch = cleanedGeneratedSections[titleKey];
      const content = directMatch || titleMatch;
      return !(content && content.trim().length > 0);
    });

    const templateSource = documentTemplate || receivedDocumentTemplate;
    let syncedTemplate = templateSource ? { ...templateSource } : { sections: [], categories: {} };

    if (syncedTemplate) {
      let syncedSections = (syncedTemplate.sections || [])
        .map((section) => {
          let newContent = cleanedGeneratedSections[section.id];
          if (!newContent) {
            const titleKey = section.title?.toLowerCase().replace(/\s+/g, '_');
            newContent = cleanedGeneratedSections[titleKey];
          }
          if (newContent && newContent.trim().length > 0) {
            return { ...section, content: newContent };
          }
          return null;
        })
        .filter(Boolean);

      const existingIds = new Set(syncedSections.map((section) => section.id));
      const existingTitleKeys = new Set(
        syncedSections.map((section) => section.title?.toLowerCase().replace(/\s+/g, '_'))
      );

      Object.entries(cleanedGeneratedSections).forEach(([key, content]) => {
        if (!content || !content.trim()) return;

        const isTimestampId = /^section_\d+$/.test(key);
        const alreadyExists = isTimestampId
          ? existingIds.has(key)
          : existingIds.has(key) || existingTitleKeys.has(key);

        if (!alreadyExists) {
          const originalSection = (templateSource?.sections || []).find((section) => section.id === key);
          syncedSections.push({
            id: key,
            title:
              originalSection?.title ||
              key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
            content,
            category: originalSection?.category || 'functional_requirements',
            icon: originalSection?.icon || 'FileTextOutlined',
          });
          existingIds.add(key);
          existingTitleKeys.add(key);
        }
      });

      const uiSectionIds = new Set((templateToUse?.sections || []).map((section) => section.id));
      const uiTitleKeys = new Set(
        (templateToUse?.sections || []).map((section) =>
          section.title?.toLowerCase().replace(/\s+/g, '_')
        )
      );

      syncedSections = syncedSections.filter(
        (section) =>
          uiSectionIds.has(section.id) ||
          uiTitleKeys.has(section.title?.toLowerCase().replace(/\s+/g, '_'))
      );

      const activeCategoryKeys = new Set(syncedSections.map((section) => section.category).filter(Boolean));
      const syncedCategories = Object.fromEntries(
        Object.entries(syncedTemplate.categories || {}).filter(([catKey]) =>
          activeCategoryKeys.has(catKey)
        )
      );

      syncedSections.forEach((section) => {
        const category = section.category;
        if (category && !syncedCategories[category]) {
          syncedCategories[category] = {
            title: category.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
            icon: 'FolderOutlined',
          };
        }
      });

      syncedTemplate = {
        ...syncedTemplate,
        sections: syncedSections,
        categories: syncedCategories,
      };
    }

    return {
      syncedTemplate,
      cleanedGeneratedSections,
      cleanedUndiscussedTopics,
    };
  };

  const buildTranscriptPayloadForDocument = () => {
    const userId = getUserId();
    const entries = buildTranscriptEntriesWithFallback({
      localTranscriptView: localtranscriptView,
      remoteTranscriptView: remotetranscriptView,
      agentTranscriptView,
      localTranscript,
      remoteTranscript,
      agentTranscript,
      localUserName: "User",
      localUserId: userId || "local",
      isHost: Boolean(isAdmin),
      agentName: agentName || "Agent",
    });
    return {
      transcriptEntries: entries,
      transcriptFullText: buildTranscriptFullText(entries),
    };
  };

  const buildDriveDocumentPayload = (syncedTemplate, cleanedGeneratedSections, extra = {}) => {
    const currentMeetingId = String(meetingId?.meetingId || meetingId || "");
    const transcriptPayload = buildTranscriptPayloadForDocument();
    const versionHistoryRows = (revisionHistory || []).map((row) => ({
      version: String(row.revision || row.version || "").replace(/^v/i, "") || extra.version || version || 1,
      createdAt: row.date || row.createdAt || new Date().toISOString(),
    }));

    return buildExternalDocumentPayload({
      projectId: project_id,
      projectName: currentProject?.project_name || "",
      syncedTemplate,
      cleanedGeneratedSections,
      meetingId: currentMeetingId || undefined,
      meetingAgenda: agenda?.trim() || "",
      summaryContent: meetingSummary || "",
      mvpContent: mvp || "",
      visionContent: vision || "",
      version: extra.version || version || 1,
      versionCreatedAt: extra.versionCreatedAt || new Date().toISOString(),
      revisionHistory: versionHistoryRows,
      ...transcriptPayload,
    });
  };

  const handleSaveDocumentToDrive = async () => {
    const userId = getUserId();
    const projectName = currentProject?.project_name;

    if (!project_id || !userId || !projectName) {
      message.warning('Missing project details for Google Drive save.');
      return null;
    }

    const { syncedTemplate, cleanedGeneratedSections, cleanedUndiscussedTopics } =
      prepareSyncedMeetingDocument();

    if (Object.keys(cleanedGeneratedSections).length === 0) {
      message.warning('No sections with content to save!');
      return null;
    }

    setUndiscussedTopics(cleanedUndiscussedTopics);

    try {
      const documentPayload = buildDriveDocumentPayload(syncedTemplate, cleanedGeneratedSections, {
        version: version || 1,
      });
      const retrievedDocument = await saveMeetingDocumentToDrive({
        projectId: project_id,
        projectName,
        userId,
        documentPayload,
      });
      console.log('✅ Document saved and retrieved from Google Drive');
      return retrievedDocument;
    } catch (error) {
      message.error(error.message || 'Failed to save document to Google Drive');
      console.error('Google Drive save error:', error);
      return null;
    }
  };

  const handleSaveDocumentToNotion = async () => {
    const userId = getUserId();
    const projectName = currentProject?.project_name;

    if (!project_id || !userId || !projectName) {
      message.warning('Missing project details for Notion save.');
      return null;
    }

    const { syncedTemplate, cleanedGeneratedSections, cleanedUndiscussedTopics } =
      prepareSyncedMeetingDocument();

    if (Object.keys(cleanedGeneratedSections).length === 0) {
      message.warning('No sections with content to save!');
      return null;
    }

    setUndiscussedTopics(cleanedUndiscussedTopics);

    try {
      const documentPayload = buildDriveDocumentPayload(syncedTemplate, cleanedGeneratedSections, {
        version: version || 1,
      });
      const retrievedDocument = await saveMeetingDocumentToNotion({
        projectId: project_id,
        projectName,
        userId,
        documentPayload,
      });
      console.log('✅ Document saved and retrieved from Notion');
      return retrievedDocument;
    } catch (error) {
      message.error(error.message || 'Failed to save document to Notion');
      console.error('Notion save error:', error);
      return null;
    }
  };

  // const handleSaveDocument = async () => {
  //   const userId = getUserId();

  //   // ✅ Filter only sections that have actual content
  //   const cleanedGeneratedSections = Object.fromEntries(
  //     Object.entries(generatedDocSections).filter(
  //       ([key, value]) => value && value.trim().length > 0
  //     )
  //   );

  //   // ✅ Remove from undiscussed if their content exists in cleanedGeneratedSections
  //   const cleanedUndiscussedTopics = undiscussedTopics.filter(topic => {
  //     const titleKey = topic.title?.toLowerCase().replace(/\s+/g, '_');
  //     const directMatch = cleanedGeneratedSections[topic.section_id];
  //     const titleMatch = cleanedGeneratedSections[titleKey];
  //     const content = directMatch || titleMatch;
  //     return !(content && content.trim().length > 0);
  //   });

  //   // ✅ Also update state to reflect cleanup
  //   setUndiscussedTopics(cleanedUndiscussedTopics);

  //   // ✅ Guard: nothing to save
  //   if (Object.keys(cleanedGeneratedSections).length === 0) {
  //     message.warning('No sections with content to save!');
  //     return;
  //   }

  //   const documentData = {
  //     userId,
  //     meetingId: meetingId?.meetingId || meetingId,
  //     projectId: project_id,
  //     projectName: currentProject?.project_name,
  //     template: documentTemplate,
  //     generatedSections: cleanedGeneratedSections,        // ✅ cleaned
  //     undiscussedTopics: cleanedUndiscussedTopics,        // ✅ cleaned
  //     meetingPhase: meetingPhase,
  //     progress: getOverallProgress(),
  //     timestamp: new Date().toISOString(),
  //     version: version + 1,
  //   };

  //   try {
  //     let result;

  //     if (version > 0) {
  //       const numberId = version + 1;
  //       result = await dispatch(
  //         updateGeneratedDocument({
  //           documentId: generatedDocuments?.documents?.[0]?._id,
  //           updateData: {
  //             ...documentData,
  //             version: numberId,
  //           }
  //         })
  //       ).unwrap();
  //       message.success("Document updated successfully!");
  //     } else {
  //       result = await dispatch(saveGeneratedDocument(documentData)).unwrap();
  //       message.success("Document saved successfully!");
  //     }

  //     console.log("Result:", result);
  //   } catch (error) {
  //     message.error('Failed to save document');
  //     console.error('Save error:', error);
  //   }
  // };


  const handleSaveDocument = async () => {
    const userId = getUserId();
    const { syncedTemplate, cleanedGeneratedSections, cleanedUndiscussedTopics } =
      prepareSyncedMeetingDocument();

    console.log("cleanedGeneratedSections :", cleanedGeneratedSections);

    setUndiscussedTopics(cleanedUndiscussedTopics);

    // Guard: nothing to save
    if (Object.keys(cleanedGeneratedSections).length === 0) {
      message.warning('No sections with content to save!');
      return;
    }

    try {
      const storageConfig = await fetchProjectDocumentStorage(project_id);
      const storageBackend = resolveDocumentStorageBackend(storageConfig);
      if (storageBackend === STORAGE_BACKEND.GOOGLE_DRIVE) {
        return handleSaveDocumentToDrive();
      }
      if (storageBackend === STORAGE_BACKEND.NOTION) {
        return handleSaveDocumentToNotion();
      }
    } catch (error) {
      console.warn("Could not resolve document storage backend, using Supabase:", error);
    }

    console.log("syncedTemplate :", syncedTemplate);


    // ✅ ADD THIS - update local state so UI reflects the synced template
    // setReceivedDocumentTemplate(syncedTemplate);
    // dispatch(setReduxReceivedTemplate(syncedTemplate));

    const versionCreatedAt = new Date().toISOString();
    const currentMeetingId = String(meetingId?.meetingId || meetingId || "");
    const continuation = store.getState().reports?.meetingContinuation;

    let projectDocs = filterSupabaseProjectDocuments(
      generatedDocuments?.documents || [],
    );
    try {
      const projectResult = await dispatch(getDocumentsByProject(project_id)).unwrap();
      projectDocs = filterSupabaseProjectDocuments(
        projectResult?.documents || projectDocs,
      );
    } catch (error) {
      console.warn("Could not refresh project documents before save:", error);
    }

    const existingForMeeting = resolveSupabaseDocumentForMeeting(
      projectDocs,
      currentMeetingId,
    );

    const continueFromPrevious =
      continuation?.mode === "continue" &&
      Boolean(continuation?.parentDocument) &&
      !isExternalDocumentRecord(continuation?.parentDocument);

    let nextVersion;
    if (existingForMeeting) {
      nextVersion = (existingForMeeting.version || 1) + 1;
    } else {
      nextVersion = computeNextDocumentVersion({
        documents: projectDocs,
        sourceDocument: continueFromPrevious ? continuation.parentDocument : null,
        continueFromPrevious,
      });
    }

    const versionHistoryEntry = { version: nextVersion, createdAt: versionCreatedAt };

    const documentData = {
      userId,
      meetingId: currentMeetingId,
      projectId: project_id,
      projectName: currentProject?.project_name,
      template: syncedTemplate,
      generatedSections: cleanedGeneratedSections,
      undiscussedTopics: cleanedUndiscussedTopics,
      meetingPhase: meetingPhase,
      progress: getOverallProgress(),
      timestamp: new Date().toISOString(),
      version: nextVersion,
      versionCreatedAt,
      versionHistory: [versionHistoryEntry],
      meetingAgenda: agenda?.trim() || undefined,
      basedOnMeetingId: continueFromPrevious ? continuation.parentMeetingId : undefined,
      basedOnDocumentId: continueFromPrevious
        ? resolveSupabaseContinuationDocumentId(
            continuation.parentDocumentId ||
              continuation.parentDocument?._id ||
              continuation.parentDocument?.id,
          )
        : undefined,
    };

    try {
      let result;

      if (existingForMeeting?._id && isSupabaseDocumentId(existingForMeeting._id)) {
        const previousHistory =
          existingForMeeting.version_history || existingForMeeting.versionHistory || [];
        result = await dispatch(
          updateGeneratedDocument({
            documentId: existingForMeeting._id,
            updateData: {
              userId,
              meetingId: currentMeetingId,
              projectId: project_id,
              projectName: currentProject?.project_name,
              template: syncedTemplate,
              generatedSections: cleanedGeneratedSections,
              undiscussedTopics: cleanedUndiscussedTopics,
              meetingPhase: meetingPhase,
              progress: getOverallProgress(),
              timestamp: new Date().toISOString(),
              version: nextVersion,
              versionCreatedAt,
              versionHistory: [...previousHistory, versionHistoryEntry],
            },
          })
        ).unwrap();
        message.success("Document updated successfully!");
      } else {
        result = await dispatch(saveGeneratedDocument(documentData)).unwrap();
        message.success("Document saved successfully!");
      }

      setVersion(nextVersion);
      const savedDoc = result?.document || result;
      const savedHistory = parseStoredDocumentVersionHistory(savedDoc);
      if (savedHistory.length > 0) {
        setRevisionHistory(buildRevisionHistoryTableRows(savedHistory));
      } else {
        const historyForState = existingForMeeting?._id
          ? [
              ...(existingForMeeting.version_history || existingForMeeting.versionHistory || []),
              versionHistoryEntry,
            ]
          : [versionHistoryEntry];
        setRevisionHistory(buildRevisionHistoryTableRows(historyForState));
      }

      console.log("Result:", result);
      return result?.document || {
        ...documentData,
        version: nextVersion,
        generated_sections: cleanedGeneratedSections,
        generatedSections: cleanedGeneratedSections,
        template: syncedTemplate,
        project_id,
        project_name: currentProject?.project_name,
      };
    } catch (error) {
      message.error('Failed to save document');
      console.error('Save error:', error);
      return null;
    }
  };

  useImperativeHandle(ref, () => ({
    saveDocument: handleSaveDocument,
    saveDocumentToDrive: handleSaveDocumentToDrive,
    saveDocumentToNotion: handleSaveDocumentToNotion,
    saveSummary: handleSaveSummary,
    saveMvpVision: handleSaveMvpVision,
  }));

  const sendTranscripts = () => {
    const { newLocalTranscript, newRemoteTranscript, newAgentTranscript } = getNewTranscripts();

    // Check if there's any new content
    const hasNewLocal = newLocalTranscript.length > 0;
    console.log("New remote length:", newLocalTranscript);
    const hasNewRemote = Object.keys(newRemoteTranscript).some(
      userId => newRemoteTranscript[userId].length > 0
    );
    const hasNewAgent = newAgentTranscript.length > 0;

    if (!hasNewLocal && !hasNewRemote && !hasNewAgent) {
      console.log("No new transcripts to send");
      return;
    }

    console.log("=== SENDING NEW TRANSCRIPTS ===");
    console.log("New LocalTranscript:", newLocalTranscript);
    console.log("New RemoteTranscript:", newRemoteTranscript);
    console.log("New AgentTranscript:", newAgentTranscript);

    // Convert arrays to strings for backend
    const remoteUsers = Object.fromEntries(
      Object.entries(newRemoteTranscript)
        .map(([userId, chunks]) => [userId, chunks.join(' ').trim()])
        .filter(([, text]) => text)
    );

    const transcripts = {
      localUser: newLocalTranscript.join(' '),
      remoteUser: Object.values(remoteUsers).join(' ').trim(),
      remoteUsers,
      agentUser: newAgentTranscript.filter(Boolean).join(" ")
    };

    setWaitingForResponse(true);
    socket.emit("transcripts", {
      meetingId: meetingId?.meetingId || meetingId,
      transcripts,
      teamConfig
    });

    // Send for document generation if document template is enabled
    if (wantDocumentTemplate) {
      const previousSectionsForAgents = {
        ...(generatedDocSections && typeof generatedDocSections === 'object'
          ? generatedDocSections
          : {}),
        ...(reduxGeneratedSections && typeof reduxGeneratedSections === 'object'
          ? reduxGeneratedSections
          : {}),
      };

      socket.emit("process_document_transcripts", {
        meetingId: meetingId?.meetingId || meetingId,
        transcripts,
        documentTemplate: templateToUseRef.current || receivedDocumentTemplate || documentTemplate,
        previousSections: previousSectionsForAgents,
      });
      console.log("📄 Transcripts sent for document generation", {
        previousSectionsCount: Object.values(previousSectionsForAgents).filter((value) =>
          pickFilledContent(value),
        ).length,
      });
    }

    if (mvpVisionTemplate) {
      socket.emit("process_mvpvision_transcripts", {
        meetingId: meetingId?.meetingId || meetingId,
        transcripts,
        model: "gpt-5.4-2026-03-05",
        mvp_prompt: currentProject?.mvpVisiontemplate[0].content,
        vision_prompt: currentProject?.mvpVisiontemplate[1].content,
      });
      console.log("📄 Transcripts sent for mvpvision generation");
    }

    // Send for summary generation if document template is NOT enabled AND summary is started
    if (!mvpVisionTemplate && !wantDocumentTemplate && isSummaryStarted) {
      setIsSummaryGenerating(true);
      socket.emit("process_summary_transcripts", {
        meetingId: meetingId?.meetingId || meetingId,
        transcripts
      });
      console.log("📝 Transcripts sent for summary generation");
    }

    // Update positions after sending
    updateLastSentPositions();

    console.log("New transcripts sent successfully");
  };

  useEffect(() => {
    let intervalId = null;
    let timeoutId = null;

    console.log("🔧 Main effect triggered. shouldStart:", shouldStart, "shouldStop:", shouldStop);

    if (shouldStart && !shouldStop) {
      console.log("🚀 Starting auto-send loop...");

      // Send first transcript immediately
      sendTranscripts();

      // Start interval for recurring sends
      intervalId = setInterval(() => {
        console.log("⏰ Interval triggered - checking stop status");
        console.log("shouldStop:", shouldStop);

        if (!shouldStop) {
          console.log("📤 Auto-sending transcripts...");
          sendTranscripts();
        } else {
          console.log("🛑 Stop detected - interval will be cleared");
        }
      }, 30000); // 15 seconds

      console.log("✅ Interval started with ID:", intervalId);
      setIsLoopActive(true);

      // Store in Redux
      dispatch(startAutoSend(intervalId));
    }

    // Cleanup function
    return () => {
      console.log("🧹 Cleaning up intervals and timeouts...");

      if (intervalId) {
        clearInterval(intervalId);
        console.log("✅ Interval cleared:", intervalId);
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
        console.log("✅ Timeout cleared:", timeoutId);
      }

      dispatch(stopAutoSend());
    };
  }, [shouldStart, shouldStop]); // Only depend on these two flags

  // ✅ Simple start function
  const handleGenerate = async () => {
    startTiming()

    socket.emit("captions-toggled", {
      meetingId: id,
      userId: socket.id,
      enableCaptions: true,
    });
    console.log("🎯 Generate clicked");


    setIsGenerating(true);
    setWaitingForResponse(true);
    setShouldStop(false); // Reset stop flag
    setShouldStart(true); // Trigger start


    dispatch(setEnableCaptions(true));

    const audioTrack = localStream.current.getAudioTracks()[0];
    if (audioTrack) {
      console.log("Initializing Azure STT for agent:", agentName);
      await initializeAzureSTT(
        audioTrack,
        shouldStop,
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
        agent
      );
    }

    await processRemoteStream(
      remotePeers,
      remoteVideoRefs,
      setRemoteTranscript,
      setRemotetranscriptView,
      remoteTranscript
    );
  };

  // ✅ Simple start again function
  const handleStartAgain = async () => {
    startTiming()
    console.log("🔄 Start Again clicked");
    dispatch(setEnableCaptions(true));
    socket.emit("captions-toggled", {
      meetingId: id,
      userId: socket.id,
      enableCaptions: true,
    });
    console.log("🎯 Generate clicked");

    sendTranscripts(); // Send immediately on start again


    setIsGenerating(true);
    setShouldStop(false); // Reset stop flag
    setShouldStart(true); // Trigger start






    const audioTrack = localStream.current.getAudioTracks()[0];
    if (audioTrack) {
      console.log("Initializing Azure STT for agent:", agentName);
      await initializeAzureSTT(
        audioTrack,
        shouldStop,
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
        agent
      );
    }

    await processRemoteStream(
      remotePeers,
      remoteVideoRefs,
      setRemoteTranscript,
      setRemotetranscriptView,
      remoteTranscript
    );
  };

  // ✅ SIMPLE stop function
  const handleStopLoop = async () => {
    stopTiming();
    console.log("🛑 STOP BUTTON CLICKED");
    dispatch(setEnableCaptions(false));
    socket.emit("captions-toggled", {
      meetingId: id,
      userId: socket.id,
      enableCaptions: false,
    });
    console.log("🎯 Generate clicked");


    // Just set the flags - useEffect will handle cleanup
    setShouldStop(true);
    setShouldStart(false);
    setIsStop(true);
    setIsLoopActive(false);
    setIsGenerating(false);
    setWaitingForResponse(false);


    // Reset positions when stopping
    resetLastSentPositions();


    await stopAllSTTRecognizers();



    console.log("✅ Stop flags set - useEffect will clean up");
  };

  // ✅ Socket listener - SIMPLIFIED
  useEffect(() => {
    console.log("🔧 Setting up socket listener...");

    const handleAgentUpdates = (data) => {
      console.log("📨 Received agent updates:", data);
      console.log("shouldStop at response:", shouldStop);

      setIsGenerating(false);
      setWaitingForResponse(false);

      // Update Redux for team data
      if (data.team_a_mvp) dispatch(setTeamAmvp(data.team_a_mvp));
      if (data.team_a_vision) dispatch(setTeamAvision(data.team_a_vision));
      if (data.team_b_mvp) dispatch(setTeamBmvp(data.team_b_mvp));
      if (data.team_b_vision) dispatch(setTeamBvision(data.team_b_vision));
      if (data.team_c_mvp) dispatch(setTeamCmvp(data.team_c_mvp));
      if (data.team_c_vision) dispatch(setTeamCvision(data.team_c_vision));



      if (data.meeting_notes && data.meeting_notes !== meeting_notes)
        dispatch(setMeetingNotes(data.meeting_notes));
      if (data.functional_requirements && data.functional_requirements !== functional_requirements)
        dispatch(setFunctionalRequirements(data.functional_requirements));
      if (data.non_functional_requirements && data.non_functional_requirements !== non_functional_requirements)
        dispatch(setNonFunctionalRequirements(data.non_functional_requirements));

      socket.emit("mvpvision-updates", {
        meetingId: meetingId?.meetingId || meetingId,
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
      setIsLoopActive(true);
    };

    // Handle document sections update from hierarchical agent system
    const handleDocumentSectionsUpdate = (data) => {
      const eventMeeting =
        data?.meeting_id != null ? String(data.meeting_id) : '';
      if (
        eventMeeting &&
        resolvedMeetingKey &&
        eventMeeting !== resolvedMeetingKey
      ) {
        logDocumentPanel("document_sections_update_ignored_wrong_meeting", {
          payloadMeetingId: eventMeeting,
          localMeetingKey: resolvedMeetingKey,
        });
        return;
      }

      logDocumentPanel("socket_document_sections_update", {
        meeting_id: data?.meeting_id,
        progress: data?.discussion_progress,
        sectionKeysIncoming: data.generated_sections
          ? Object.keys(data.generated_sections).filter((k) =>
              pickFilledContent(data.generated_sections[k]),
            )
          : [],
      });

      setIsGenerating(false);
      setIsDocumentGenerated(true);
      console.log("📄 Received document sections update:", data);
      console.log(`📈 Discussion progress: ${data.discussion_progress?.toFixed(1) || 0}%`);

      // Keep listening after the document is complete so later discussion can
      // update existing sections instead of freezing the document at 90%+.
      if (data.discussion_progress >= 90) {
        console.log("🎉 Progress reached 90%+ - auto-send remains active for future updates");
        setWaitingForResponse(false);
        message.success({
          content: '🎉 Document is 90%+ complete! Auto-update will continue for new discussion.',
          duration: 5,
          style: { marginTop: '60px' },
        });
      }

      if (data.generated_sections) {
        const reduxMerged = {
          ...(store.getState().reports?.generatedDocumentSections || {}),
          ...data.generated_sections,
        };

        setGeneratedDocSections(prev => {
          const merged = { ...prev, ...data.generated_sections };

          // ✅ Use ref instead of stale closure value
          const templateSections = templateToUseRef.current?.sections || [];
          if (templateSections.length > 0) {
            const newlyFilledKeys = Object.keys(data.generated_sections).filter(
              key => pickFilledContent(data.generated_sections[key]) &&
                pickFilledContent(prev[key]) !== pickFilledContent(data.generated_sections[key])
            );
            const categoriesToExpand = newlyFilledKeys
              .map(sectionId =>
                templateSections.find(s => templateSectionMatchesId(s, sectionId))?.category
              )
              .filter(Boolean);

            if (categoriesToExpand.length > 0) {
              setExpandedCategories(prevCats => [
                ...new Set([...prevCats, ...categoriesToExpand])
              ]);
            }
          }

          return merged;
        });

        // ✅ Remove filled sections from undiscussedTopics
        setUndiscussedTopics(prev =>
          prev.filter(topic => {
            const titleKey = topic.title?.toLowerCase().replace(/\s+/g, '_');
            const directMatch = reduxMerged[topic.section_id] ?? reduxMerged[String(topic.section_id)];
            const titleMatch = titleKey ? reduxMerged[titleKey] : '';

            const content = directMatch || titleMatch;

            // Remove if content exists AND is not empty
            return !(content && content.trim().length > 0);
          })
        );
        dispatch(setGeneratedDocumentSections(reduxMerged));
      }

      if (data.undiscussed_topics) {
        setUndiscussedTopics(data.undiscussed_topics);
      }

      if (data.meeting_phase) {
        setMeetingPhase(data.meeting_phase);
      }

      // ✅ NEW: Show notification when a section is updated from user answer
      if (data.updated_section) {
        const sectionTitle = data.updated_section.section_title || data.updated_section.section_id;
        message.success({
          content: `📝 "${sectionTitle}" section updated from your response!`,
          duration: 3,
          style: {
            marginTop: '60px',
          },
        });
        console.log(`✅ Section "${sectionTitle}" updated from user answer`);
      }

      // ✅ Update template sections - add missing ones + update existing content
      setReceivedDocumentTemplate(prevTemplate => {
        const templateSource = prevTemplate || documentTemplate;
        if (!templateSource?.sections) return prevTemplate;

        // Update existing sections content
        const updatedSections = templateSource.sections.map(section => {
          const newContent =
            resolveStoredSectionContent(section, data.generated_sections) ||
            '';

          if (newContent.trim().length > 0) {
            return { ...section, content: newContent };
          }
          return section;
        });

        // ✅ Find sections in generated_sections that don't exist in template at all
        const existingIds = new Set(templateSource.sections.map(s => s.id));
        const existingTitleKeys = new Set(
          templateSource.sections.map(s => s.title?.toLowerCase().replace(/\s+/g, '_'))
        );

        Object.entries(data.generated_sections).forEach(([key, content]) => {
          if (!content || !content.trim()) return; // skip empty

          const alreadyExists = existingIds.has(key) || existingTitleKeys.has(key);

          if (!alreadyExists) {
            // ✅ New section — add it dynamically to template
            updatedSections.push({
              id: key,
              title: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), // "business_rules" → "Business Rules"
              content: content,
              category: 'functional_requirements', // default category, adjust if needed
              icon: 'FileTextOutlined',
            });

            // Also track the new id/titleKey so we don't duplicate
            existingIds.add(key);
            existingTitleKeys.add(key);
          }
        });

        return { ...templateSource, sections: updatedSections };
      });

      // ✅ BROADCAST to all users in meeting with full template data
      socket.emit("broadcast_document_data", {
        meetingId: meetingId?.meetingId || meetingId,
        documentTemplate: templateToUseRef.current || receivedDocumentTemplate || documentTemplate,
        generatedSections: data.generated_sections,
        undiscussedTopics: data.undiscussed_topics,
        meetingPhase: data.meeting_phase,
        discussionProgress: data.discussion_progress,
        projectName: currentProject?.project_name
      });
      console.log("📡 Broadcasted full document data to all users");
    };

    // ✅ NEW: Receive broadcasted document data (all users get this)
    const handleBroadcastedDocumentData = (data) => {
      console.log("📥 Received broadcasted document data:", data);

      const eventMeeting =
        data?.meeting_id != null ? String(data.meeting_id) : '';
      if (
        eventMeeting &&
        resolvedMeetingKey &&
        eventMeeting !== resolvedMeetingKey
      ) {
        logDocumentPanel("broadcast_document_ignored_wrong_meeting", {
          payloadMeetingId: eventMeeting,
          localMeetingKey: resolvedMeetingKey,
        });
        return;
      }

      logDocumentPanel("broadcast_document_applied", {
        meeting_id: data?.meeting_id,
        hasTemplateSections: Boolean(data.documentTemplate?.sections?.length),
        generatedSectionKeys: data.generatedSections
          ? Object.keys(data.generatedSections).filter((k) =>
              pickFilledContent(data.generatedSections[k]),
            )
          : [],
      });

      setActiveBroadcastType('document');
      setIsDocumentGenerated(true);

      // Update local state with received data
      if (data.documentTemplate) {
        // Store template in local state AND Redux so OpenAISession can access it too
        setReceivedDocumentTemplate(data.documentTemplate);
        dispatch(setReduxReceivedTemplate(data.documentTemplate));
      }
      if (data.generatedSections) {
        // Merge so carried-over section content from previous meetings is preserved
        setGeneratedDocSections(prev => ({ ...prev, ...data.generatedSections }));
        const mergedBroadcast = {
          ...(store.getState().reports?.generatedDocumentSections || {}),
          ...data.generatedSections,
        };
        dispatch(setGeneratedDocumentSections(mergedBroadcast));
      }
      if (data.undiscussedTopics) {
        setUndiscussedTopics(data.undiscussedTopics);
      }
      if (data.meetingPhase) {
        setMeetingPhase(data.meetingPhase);
      }
      if (data.projectName) {
        setReceivedProjectName(data.projectName);
      }

      if (data.updatedSection?.section_title || data.updatedSection?.section_id) {
        const sectionTitle =
          data.updatedSection.section_title ||
          data.updatedSection.section_id?.replace(/_/g, " ");
        message.success({
          content: `📝 "${sectionTitle}" updated in the document`,
          duration: 3,
          style: { marginTop: "60px" },
        });
      }
    };


    // Handle undiscussed questions - will be sent to OpenAI agent
    const handleUndiscussedQuestions = (data) => {
      console.log("❓ [RealtimeMvpVisionDisplay] Received undiscussed questions:", data);
      console.log("❓ Questions count:", data?.questions?.length || 0);
      // This will be handled by the OpenAI agent component
      // The questions are broadcast to the meeting room

      // ✅ NEW: Show notification that agent is about to ask questions
      if (data?.questions?.length > 0) {
        message.info({
          content: `🤖 AI Agent will ask about ${data.questions.length} undiscussed topics...`,
          duration: 4,
          style: {
            marginTop: '60px',
          },
        });
      }
    };

    // ✅ NEW: Handle errors from user answer processing
    const handleUserAnswerError = (data) => {
      console.error("❌ Error processing user answer:", data);
      message.error({
        content: `Failed to save answer: ${data.error || 'Unknown error'}`,
        duration: 3,
      });
    };

    // ✅ NEW: Handle meeting summary delta updates
    const handleMeetingSummaryDelta = (data) => {
      console.log("📝 Received meeting summary delta:", data);

      // APPEND the new delta to existing summary
      setMeetingSummary(prevSummary => {
        const separator = prevSummary ? '\n\n' : '';
        return prevSummary + separator + data.summary_delta;
      });

      // Set generating to false after receiving update
      setIsSummaryGenerating(false);
    };

    // ✅ NEW: Handle summary generation errors
    const handleSummaryError = (data) => {
      console.error("❌ Error generating summary:", data);
      setIsSummaryGenerating(false);
      message.error({
        content: `Summary generation failed: ${data.error || 'Unknown error'}`,
        duration: 3,
      });
    };

    // ✅ NEW: Handle broadcasted summary data
    const handleBroadcastedSummaryData = (data) => {
      console.log("📡 Received broadcasted summary data:", data);
      setActiveBroadcastType('summary');
      setMeetingSummary(data.summaryContent || '');
    };

    // ✅ Handle broadcasted MVP+Vision data (same pattern as document/summary - for remote users)
    const handleBroadcastedMvpVisionData = (data) => {
      console.log("📡 Received broadcasted MVP+Vision data:", data);
      setActiveBroadcastType('mvpvision');
      if (data.mvp) dispatch(setMVP(data.mvp));
      if (data.vision) dispatch(setVision(data.vision));
    };

    // ✅ MVP+Vision pipeline listeners (broadcast to all users in meeting including remote)
    const handleMvpVisionStatus = (data) => {
      if (data.meetingId === (meetingId?.meetingId || meetingId)) {
        setIsMvpVisionProcessing(data.status === 'processing');
      }
    };
    const handleMvpVisionUpdate = (data) => {
      if (data.meetingId === (meetingId?.meetingId || meetingId)) {
        setActiveBroadcastType('mvpvision');
        setIsMvpVisionProcessing(false);
        setWaitingForResponse(false);
        if (data.mvp) dispatch(setMVP(data.mvp));
        if (data.vision) dispatch(setVision(data.vision));
        setIsLoopActive(true);
        console.log("📥 MVP+Vision updated from backend (local or broadcasted)", data.processingTime);
        // Broadcast to all connected users (same pattern as document - host re-broadcasts via backend)
        socket.emit("broadcast_mvpvision_data", {
          meetingId: meetingId?.meetingId || meetingId,
          mvp: data.mvp,
          vision: data.vision,
          projectName: currentProject?.project_name,
          timestamp: Date.now()
        });
      }
    };
    const handleMvpVisionNoUpdate = (data) => {
      if (data.meetingId === (meetingId?.meetingId || meetingId)) {
        setIsMvpVisionProcessing(false);
        setWaitingForResponse(false);
      }
    };
    const handleMvpVisionError = (data) => {
      if (data.meetingId === (meetingId?.meetingId || meetingId)) {
        setIsMvpVisionProcessing(false);
        setWaitingForResponse(false);
        message.error({ content: `MVP/Vision: ${data.error || 'Unknown error'}`, duration: 4 });
        console.error("❌ MVP/Vision pipeline error:", data.error);
      }
    };

    socket.on("agent_updates", handleAgentUpdates);
    socket.on("document_sections_update", handleDocumentSectionsUpdate);
    socket.on("broadcasted_document_data", handleBroadcastedDocumentData);  // ✅ NEW
    socket.on("ask_undiscussed_questions", handleUndiscussedQuestions);
    socket.on("user_answer_error", handleUserAnswerError);  // ✅ NEW
    socket.on("meeting_summary_delta", handleMeetingSummaryDelta);  // ✅ NEW
    socket.on("summary_generation_error", handleSummaryError);  // ✅ NEW
    socket.on("broadcasted_summary_data", handleBroadcastedSummaryData);  // ✅ NEW
    socket.on("broadcasted_mvpvision_data", handleBroadcastedMvpVisionData);  // ✅ MVP+Vision broadcast (remote users)
    socket.on("mvpvision_status", handleMvpVisionStatus);
    socket.on("mvpvision_update", handleMvpVisionUpdate);
    socket.on("mvpvision_no_update", handleMvpVisionNoUpdate);
    socket.on("mvpvision_error", handleMvpVisionError);

    return () => {
      console.log("🧹 Cleaning up socket listener...");
      socket.off("agent_updates", handleAgentUpdates);
      socket.off("document_sections_update", handleDocumentSectionsUpdate);
      socket.off("broadcasted_document_data", handleBroadcastedDocumentData);  // ✅ NEW
      socket.off("ask_undiscussed_questions", handleUndiscussedQuestions);
      socket.off("user_answer_error", handleUserAnswerError);  // ✅ NEW
      socket.off("meeting_summary_delta", handleMeetingSummaryDelta);  // ✅ NEW
      socket.off("summary_generation_error", handleSummaryError);  // ✅ NEW
      socket.off("broadcasted_summary_data", handleBroadcastedSummaryData);  // ✅ NEW
      socket.off("broadcasted_mvpvision_data", handleBroadcastedMvpVisionData);  // ✅ MVP+Vision broadcast
      socket.off("mvpvision_status", handleMvpVisionStatus);
      socket.off("mvpvision_update", handleMvpVisionUpdate);
      socket.off("mvpvision_no_update", handleMvpVisionNoUpdate);
      socket.off("mvpvision_error", handleMvpVisionError);
    };
    // }, [socket, dispatch, shouldStop]); // Include shouldStop in dependencies
  }, [socket, dispatch, shouldStop, documentTemplate, receivedDocumentTemplate, resolvedMeetingKey]);


  const templateToUseRef = useRef(templateToUse);
  useEffect(() => {
    templateToUseRef.current = templateToUse;
  }, [templateToUse]);


  // ✅ NEW: Reset summary when meeting changes or wantDocumentTemplate changes
  useEffect(() => {
    setMeetingSummary('');
    setIsSummaryStarted(false);
    setIsSummaryGenerating(false);
    console.log("🔄 Meeting summary reset");
  }, [meetingId, wantDocumentTemplate]);



  // ================== DOCUMENT TEMPLATE DISPLAY ==================

  // Group sections by category
  // const groupSectionsByCategory = () => {
  //   // if (!documentTemplate?.sections) return {};
  //   // ✅ ADD SAFETY CHECK
  // if (!templateToUse || !templateToUse.sections) {
  //   return {};
  // }


  //   const grouped = {};
  //   documentTemplate.sections.forEach(section => {
  //     const category = section.category || 'Uncategorized';
  //     if (!grouped[category]) {
  //       grouped[category] = [];
  //     }
  //     grouped[category].push(section);
  //   });
  //   return grouped;
  // };

  // Also update the groupSectionsByCategory to use templateToUse
  const groupSectionsByCategory = () => {
    const templateToUse = documentTemplate || receivedDocumentTemplate;

    // Safety check
    if (!templateToUse || !templateToUse.sections) {
      return {};
    }

    const grouped = {};
    templateToUse.sections.forEach(section => {
      const category = section.category || 'Uncategorized';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(section);
    });
    return grouped;
  };

  // Check if a section is discussed
  // const isSectionDiscussed = (sectionId) => {
  //   return generatedDocSections[sectionId] && generatedDocSections[sectionId].trim().length > 0;
  // };

  const isSectionDiscussed = (sectionId) => {
    const disp = mergedGeneratedSectionsForDisplay;
    const section = templateToUse?.sections?.find((s) => templateSectionMatchesId(s, sectionId));
    if (section) {
      return Boolean(pickFilledContent(resolveStoredSectionContent(section, disp)));
    }
    // Fallback when template lacks this id (dynamic keys)
    if (pickFilledContent(disp[sectionId])) return true;
    const idNorm = normalizeSectionKey(sectionId);
    if (idNorm && pickFilledContent(disp[idNorm])) return true;

    return false;
  };

  // // Calculate progress for a category
  // const getCategoryProgress = (sections) => {
  //   if (!sections || sections.length === 0) return 0;
  //   const discussedCount = sections.filter(s => isSectionDiscussed(s.id)).length;
  //   return Math.round((discussedCount / sections.length) * 100);
  // };

  // // Get overall document progress
  // const getOverallProgress = () => {
  //   if (!documentTemplate?.sections || documentTemplate.sections.length === 0) return 0;
  //   const discussedCount = documentTemplate.sections.filter(s => isSectionDiscussed(s.id)).length;
  //   return Math.round((discussedCount / documentTemplate.sections.length) * 100);
  // };

  // Also update getOverallProgress with safety check
  const getOverallProgress = () => {
    const templateToUse = documentTemplate || receivedDocumentTemplate;

    if (!templateToUse || !templateToUse.sections || templateToUse.sections.length === 0) {
      return 0;
    }

    const discussedCount = templateToUse.sections.filter(s => isSectionDiscussed(s.id)).length;
    return Math.round((discussedCount / templateToUse.sections.length) * 100);
  };

  // Update getCategoryProgress
  const getCategoryProgress = (sections) => {
    if (!sections || sections.length === 0) return 0;
    const discussedCount = sections.filter(s => isSectionDiscussed(s.id)).length;
    return Math.round((discussedCount / sections.length) * 100);
  };

  // Document Section Card Component - Always Expanded
  const DocumentSectionCard = ({ section }) => {
    const generatedContent = resolveStoredSectionContent(
      section,
      mergedGeneratedSectionsForDisplay,
    );
    const hasContent = Boolean(pickFilledContent(generatedContent));
    const sectionScrollKey = String(section.id ?? section.title ?? '');

    return (
      <div
        className={`${isDarkMode ? 'bg-gray-900' : 'bg-white'} border rounded-lg mb-3 overflow-hidden ${hasContent ? 'border-l-4 border-l-emerald-500 border-gray-200' : 'border-gray-200'
          }`}
        style={isDarkMode ? { borderColor: '#334155' } : undefined}
      >
        {/* Section Header */}
        <div
          className={`flex items-center justify-between p-4 border-b ${
            isDarkMode ? 'border-gray-700' : 'border-gray-100'
          }`}
        >
          <div className="flex items-center flex-1 min-w-0">
            {/* Status dot */}
            <div className={`w-2.5 h-2.5 rounded-full mr-3 flex-shrink-0 ${hasContent ? 'bg-emerald-500' : 'bg-gray-300'
              }`} />

            {/* Title */}
            <span className={`font-medium ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>{section.title}</span>
          </div>

          {/* Status Badge */}
          {hasContent ? (
            <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded font-medium">
              Complete
            </span>
          ) : (
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${isDarkMode ? 'text-gray-300 bg-gray-800' : 'text-gray-500 bg-gray-100'}`}>
              Pending
            </span>
          )}
        </div>

        {/* Section Content - Always Visible */}
        <div className="p-4">
          {hasContent ? (
            <div className={`p-3 rounded-md border ${isDarkMode ? 'bg-emerald-950/40 border-emerald-900' : 'bg-emerald-50 border-emerald-100'}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircleOutlined className="text-emerald-600 text-xs" />
              </div>
              <div
                className={`text-sm leading-relaxed whitespace-pre-wrap ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}
                ref={(element) => {
                  if (element) {
                    sectionContentRefs.current[sectionScrollKey] = element;
                    const savedTop = sectionScrollPositionsRef.current[sectionScrollKey];
                    if (typeof savedTop === 'number') {
                      element.scrollTop = savedTop;
                    }
                  } else {
                    delete sectionContentRefs.current[sectionScrollKey];
                  }
                }}
                onScroll={(event) => {
                  sectionScrollPositionsRef.current[sectionScrollKey] = event.currentTarget.scrollTop;
                }}
                style={{
                  maxHeight: '120px',
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  paddingRight: 6,
                  touchAction: 'pan-y',
                }}
              >
                {generatedContent}
              </div>
            </div>
          ) : (
            <div className={`p-3 rounded-md border border-dashed text-center ${isDarkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
              <ClockCircleOutlined className={`text-lg mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
              <p className={`text-xs m-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Ask the agent to add content for this section
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const liveDocumentSections = useMemo(() => {
    const templateSections = templateToUse?.sections || [];
    const map = mergedGeneratedSectionsForDisplay;

    const fromTemplate = templateSections
      .map((section) => {
        const resolvedContent = resolveStoredSectionContent(section, map);
        return {
          id: section.id,
          title: section.title,
          category: section.category,
          categoryTitle: templateToUse?.categories?.[section.category]?.title || section.category,
          content: resolvedContent,
          hasGeneratedContent: Boolean(pickFilledContent(resolvedContent)),
        };
      })
      .filter((s) => s.hasGeneratedContent);

    const accountedKeys = new Set();
    templateSections.forEach((section) => {
      [
        section.id,
        section.id != null ? String(section.id) : '',
        normalizeSectionKey(section.id),
        typeof section.title === 'string'
          ? section.title.toLowerCase().replace(/\s+/g, '_')
          : '',
        normalizeSectionKey(section.title),
      ]
        .filter(Boolean)
        .forEach((k) => accountedKeys.add(String(k)));
    });

    const orphans = [];
    for (const [key, raw] of Object.entries(map)) {
      if (!pickFilledContent(raw)) continue;
      if (accountedKeys.has(String(key))) continue;
      if (accountedKeys.has(normalizeSectionKey(key))) continue;

      const rawNorm = pickFilledContent(raw);
      if (
        fromTemplate.some((row) => pickFilledContent(row.content) === rawNorm)
      ) {
        continue;
      }

      orphans.push({
        id: key,
        title: String(key)
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        category: 'agent_generated',
        categoryTitle: 'Agent generated',
        content: raw,
        hasGeneratedContent: true,
      });
    }

    return [...fromTemplate, ...orphans];
  }, [templateToUse, mergedGeneratedSectionsForDisplay]);

  // ── Download as PDF ──────────────────────────────────────────────────────
  const downloadPreviewAsPDF = () => {
    if (liveDocumentSections.length === 0) {
      message.warning('No document sections to download');
      return;
    }
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const maxWidth = pageWidth - margin * 2;
      let yPosition = 30;
      let currentPage = 1;

      const addPageNumber = (pageNum) => {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text(`Page ${pageNum}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
      };

      const checkNewPage = (neededSpace = 30) => {
        if (yPosition > pageHeight - neededSpace) {
          addPageNumber(currentPage);
          doc.addPage();
          currentPage++;
          yPosition = 30;
          return true;
        }
        return false;
      };

      // Title page
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(`${currentProject?.project_name || 'DOCUMENT'} TEMPLATE`, pageWidth / 2, 60, { align: 'center' });

      // Date
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 80, { align: 'center' });
      addPageNumber(currentPage);

      // TOC page
      doc.addPage();
      currentPage++;
      yPosition = 30;
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Table of Contents', margin, yPosition);
      yPosition += 15;

      const tocItems = generatePreviewTOC(liveDocumentSections);
      doc.setFontSize(11);
      tocItems.forEach((item) => {
        checkNewPage(15);
        if (item.isCategory) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(`${item.number}   ${item.title}`, margin, yPosition + 10);
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(80, 80, 80);
          const tocText = `${item.number}   ${item.title}`;
          doc.text(tocText, margin + 10, yPosition + 10);
          const textWidth = doc.getTextWidth(tocText);
          const dotsStart = margin + 10 + textWidth + 5;
          const dotsEnd = pageWidth - margin - 15;
          if (dotsEnd > dotsStart) {
            let x = dotsStart;
            while (x < dotsEnd) { doc.text('.', x, yPosition + 5); x += 3; }
          }
        }
        yPosition += 10;
      });
      addPageNumber(currentPage);

      // Content pages
      doc.addPage();
      currentPage++;
      yPosition = 30;
      const tocForContent = generatePreviewTOC(liveDocumentSections);
      let lastCategory = null;

      liveDocumentSections.forEach((section, index) => {
        const tocItem = tocForContent.find(t => t.sectionId === section.id && !t.isCategory);
        const sectionNumber = tocItem ? tocItem.number : `${index + 1}`;
        if (section.category !== lastCategory) {
          const categoryToc = tocForContent.find(t => t.isCategory && t.sectionId === section.id);
          if (categoryToc) {
            checkNewPage(40);
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(24, 144, 255);
            doc.text(`${categoryToc.number}. ${categoryToc.title}`, margin, yPosition);
            yPosition += 12;
            doc.setDrawColor(24, 144, 255);
            doc.setLineWidth(0.5);
            doc.line(margin, yPosition, pageWidth - margin, yPosition);
            yPosition += 15;
          }
          lastCategory = section.category;
        }
        checkNewPage(40);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        const titleLines = doc.splitTextToSize(`${sectionNumber} ${section.title}`, maxWidth);
        doc.text(titleLines, margin, yPosition);
        yPosition += titleLines.length * 6 + 8;

        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
        if (section.content) {
          const cleanContent = removeMarkdownFormatting(section.content);
          const contentLines = doc.splitTextToSize(cleanContent, maxWidth);
          contentLines.forEach((line) => {
            checkNewPage(15);
            doc.text(line, margin, yPosition);
            yPosition += 6;
          });
        }
        yPosition += 15;
      });
      addPageNumber(currentPage);
      doc.save(`${currentProject?.project_name || 'document'}.pdf`);
      message.success('PDF downloaded successfully');
    } catch (error) {
      console.error('Error generating PDF:', error);
      message.error('Failed to generate PDF');
    }
  };

  // ── Download as Word ─────────────────────────────────────────────────────
  const downloadPreviewAsWord = async () => {
    if (liveDocumentSections.length === 0) {
      message.warning('No document sections to download');
      return;
    }
    try {
      const children = [];
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: `${currentProject?.project_name || 'DOCUMENT'} TEMPLATE`, bold: true, size: 48 })],
          alignment: 'center',
          spacing: { before: 2000, after: 600 },
        })
      );
      children.push(new DocxParagraph({ children: [], pageBreakBefore: true }));
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: 'Table of Contents', bold: true, size: 36 })],
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 400 },
        })
      );
      const tocItems = generatePreviewTOC(liveDocumentSections);
      tocItems.forEach((item) => {
        children.push(
          new DocxParagraph({
            children: [
              new TextRun({
                text: item.isCategory ? `${item.number}   ${item.title}` : `     ${item.number}   ${item.title}`,
                bold: item.isCategory,
                size: item.isCategory ? 24 : 22,
                color: item.isCategory ? '000000' : '555555',
              }),
            ],
            spacing: { after: item.isCategory ? 100 : 60 },
          })
        );
      });
      children.push(new DocxParagraph({ children: [], pageBreakBefore: true }));
      let lastCategory = null;
      const tocForContent = generatePreviewTOC(liveDocumentSections);
      liveDocumentSections.forEach((section, index) => {
        const tocItem = tocForContent.find(t => t.sectionId === section.id && !t.isCategory);
        const sectionNumber = tocItem ? tocItem.number : `${index + 1}`;
        if (section.category !== lastCategory) {
          const categoryToc = tocForContent.find(t => t.isCategory && t.sectionId === section.id);
          if (categoryToc) {
            children.push(
              new DocxParagraph({
                children: [new TextRun({ text: `${categoryToc.number}. ${categoryToc.title}`, bold: true, size: 32, color: '1890FF' })],
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 400, after: 200 },
              })
            );
          }
          lastCategory = section.category;
        }
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: `${sectionNumber} ${section.title}`, bold: true, size: 26 })],
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 300, after: 150 },
          })
        );
        if (section.content) {
          const cleanContent = removeMarkdownFormatting(section.content);
          cleanContent.split('\n').filter(p => p.trim()).forEach((para) => {
            children.push(
              new DocxParagraph({ children: [new TextRun({ text: para, size: 22 })], spacing: { after: 120 } })
            );
          });
        }
        children.push(new DocxParagraph({ children: [], spacing: { after: 200 } }));
      });
      const docFile = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(docFile);
      saveAs(blob, `${currentProject?.project_name || 'document'}.docx`);
      message.success('Word document downloaded successfully');
    } catch (error) {
      console.error('Error generating Word document:', error);
      message.error('Failed to generate Word document');
    }
  };

  const handlePreviewDownload = () => {
    if (previewViewMode === 'pdf') downloadPreviewAsPDF();
    else downloadPreviewAsWord();
  };

  // Document Template Display Component - Clean Professional Design
  const DocumentTemplateDisplay = () => {
    // if (!wantDocumentTemplate || !documentTemplate) {
    //   return null;
    // }

    // const templateToUse = documentTemplate || receivedDocumentTemplate;
    // const projectNameToUse = currentProject?.project_name || receivedProjectName;

    // ✅ EARLY RETURN BEFORE ANY FUNCTION CALLS
    if (!templateToUse || !templateToUse.sections) {
      return (
        <div className="flex items-center justify-center py-8">
          <Spin tip="Waiting for document template..." />
        </div>
      );
    }

    // ✅ NOW SAFE TO CALL - after we confirmed template exists
    const groupedSections = groupSectionsByCategory();
    const categories = Object.keys(groupedSections);
    const overallProgress = getOverallProgress();
    const totalSections = templateToUse.sections?.length || 0;
    const completedSections = templateToUse.sections?.filter(s => isSectionDiscussed(s.id)).length || 0;
    const pendingCount = undiscussedTopics.filter(t => !t.discussed).length;


    return (
      <div className="mb-6">

        {(isLoopActive || isStop) && (
          <div className="mb-2 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {isLoopActive ? (
                  <>
                    <div className="animate-pulse w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-green-800 font-medium">Document auto-updating every 30 seconds</span>
                    {/* <span className="text-green-600 text-sm ml-2">(Real-time sync active)</span> */}

                  </>
                ) : (
                  <>
                    <div className="w-3 h-3 bg-gray-900 rounded-full mr-3"></div>
                    <span className={`${isDarkMode ? 'text-gray-900' : 'text-gray-900'} text-gray-900 font-medium`}>Auto-update stopped</span>

                  </>
                )}
              </div>
              <div className="flex gap-2">
                {/* Configuration Button */}
                {/* <Button
                  type="default"
                  size="small"
                  onClick={() => setConfigDrawerOpen(true)}
                  className="shadow-sm border font-medium"
                  style={{
                    borderRadius: '8px',
                  }}
                  icon={<SettingOutlined />}
                >
                  Config
                </Button> */}

                {isLoopActive ? (
                  <Button
                    type="text"
                    size="small"
                    onClick={handleStopLoop}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 font-medium"
                    icon={<CloseOutlined />}
                    disabled={waitingForResponse}
                  >
                    {waitingForResponse ? 'please wait your response is generating' : 'Stop Auto-Update'}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="small"
                    loading={isGenerating}
                    onClick={handleStartAgain}
                    className="shadow-sm border-0 font-medium"
                    style={{
                      backgroundColor: '#16a34a',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)'
                    }}
                    icon={!isGenerating && <ThunderboltOutlined />}
                  >
                    {isGenerating ? 'Starting...' : 'Start Again'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}


        {/* Document Header - Clean White Card */}
        <div className="mb-5 rounded-xl border shadow-sm overflow-hidden bg-black border-gray-700">
          {/* Header */}
          <div className={`p-5 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${isDarkMode ? 'bg-gray-800' : 'bg-slate-100'}`}>
                  <FileTextOutlined className={`${isDarkMode ? 'text-gray-200' : 'text-slate-600'} text-lg`} />
                </div>
                <div>
                  <h2 className={`text-lg font-semibold m-0 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                    {currentProject?.project_name || 'Requirements Document'}
                  </h2>
                  <p className={`text-sm m-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {totalSections} sections • {categories.length} categories
                  </p>
                </div>
              </div>

              {/* Progress Circle */}
              <div className="flex items-center gap-4">
                <div className="text-right hidden sm:block">
                  <div className={`text-xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>{completedSections}/{totalSections}</div>
                  <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Completed</div>
                </div>
                <Progress
                  type="circle"
                  percent={overallProgress}
                  size={52}
                  strokeWidth={8}
                  strokeColor="#10b981"
                  trailColor={isDarkMode ? "#334155" : "#e5e7eb"}
                  format={percent => <span className={`text-sm font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>{percent}%</span>}
                />
              </div>
            </div>
          </div>

          {/* Status Bar */}
          <div className={`px-5 py-3 flex items-center justify-between ${isDarkMode ? 'bg-gray-800' : 'bg-slate-50'}`}>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${meetingPhase === 'ongoing' ? 'bg-emerald-500 animate-pulse' :
                  meetingPhase === 'ending' ? 'bg-amber-500' : 'bg-gray-400'
                  }`} />
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {meetingPhase === 'ongoing' ? 'Meeting Active' :
                    meetingPhase === 'ending' ? 'Meeting Ending' : 'Meeting Ended'}
                </span>
              </div>
              <span className={`${isDarkMode ? 'text-gray-600' : 'text-gray-300'}`}>|</span>
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{pendingCount} topics pending</span>
            </div>

            {/* Preview Document button — only shown when at least one section is filled */}
            {liveDocumentSections.length > 0 && (
              <Button
                size="small"
                icon={<FilePdfOutlined />}
                onClick={() => {
                  setPreviewAccordionKeys(liveDocumentSections.slice(0, 3).map(s => s.id));
                  setShowPdfPreviewModal(true);
                }}
                style={{
                  backgroundColor: '#ff4d4f',
                  borderColor: '#ff4d4f',
                  color: '#fff',
                  borderRadius: '6px',
                  fontWeight: 500,
                }}
              >
                Preview Document
              </Button>
            )}
          </div>
        </div>

        {/* Categories - Clean Accordion Style */}


        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(templateToUse?.sections || []).map((section) => (
            <DocumentSectionCard
              key={section.id}
              section={section}
            />
          ))}
        </div>

        <div className={`p-4 border-t flex justify-end ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-100'}`}>
         {/* <Button
            type="primary"
            icon={<FileTextOutlined />}
            // loading={isSavingDocument}
            onClick={handleSaveDocument}
            className="shadow-sm"
            style={{
              backgroundColor: '#2B7FFF',
              borderRadius: '8px',
            }}
          >
            Save Document to Database
            
          </Button>*/}
        </div>

        {/* Pending Topics Notice */}
        {pendingCount > 0 && meetingPhase === 'ending' && (
          <div className={`mt-5 p-4 rounded-xl border ${isDarkMode ? 'bg-amber-950/30 border-amber-900' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <ClockCircleOutlined className="text-amber-600" />
              </div>
              <div>
                <h4 className="font-medium text-amber-900 m-0 mb-2">Topics Not Yet Discussed</h4>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {undiscussedTopics.filter(t => !t.discussed).slice(0, 6).map((topic, idx) => (
                    <span
                      key={idx}
                      className="text-xs bg-white border border-amber-200 text-amber-700 px-2 py-1 rounded"
                    >
                      {topic.title}
                    </span>
                  ))}
                  {pendingCount > 6 && (
                    <span className="text-xs text-amber-600 px-2 py-1">+{pendingCount - 6} more</span>
                  )}
                </div>
                <p className="text-sm text-amber-700 m-0">
                  AI Agent will prompt for these topics before the meeting ends.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const GenerateButton = () => (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className={`mb-8 p-6 rounded-2xl shadow-sm ${isDarkMode ? 'bg-gradient-to-br from-slate-800 to-slate-900' : 'bg-gradient-to-br from-blue-50 to-indigo-50'}`}>
        <ThunderboltOutlined style={{ fontSize: '56px', color: '#2B7FFF' }} />
      </div>
      <Title level={2} className={`mb-4 font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
        Generate Meeting Summary
      </Title>
      <Paragraph className={`mb-8 max-w-lg text-lg leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
        Transform your meeting transcripts into actionable insights with AI-powered analysis
      </Paragraph>

      {/* Configuration and Generate buttons */}

      <div className="flex gap-4 items-center">
        {agent && (
          <Button
            type="default"
            size="large"
            onClick={() => setConfigDrawerOpen(true)}
            className="shadow-lg border-0 px-8 py-3 h-auto font-semibold"
            style={{
              borderRadius: '12px',
              fontSize: '16px',
              border: '2px solid #e5e7eb',
              color: '#374151'
            }}
            icon={<SettingOutlined />}
          >
            Configuration
          </Button>
        )}

        {agent && (
          <Button
            type="primary"
            size="large"
            loading={isGenerating}
            onClick={handleGenerate}
            className="shadow-lg border-0 px-10 py-3 h-auto font-semibold"
            style={{
              backgroundColor: '#2B7FFF',
              borderRadius: '12px',
              fontSize: '16px',
              background: 'linear-gradient(135deg, #2B7FFF 0%, #1e40af 100%)'
            }}
            icon={!isGenerating && <ThunderboltOutlined />}
          >
            {isGenerating ? 'Generating Summary...' : 'Generate Now'}
          </Button>
        )}
      </div>
    </div>
  );


  const TeamSection = ({ teamName, teamColor, visionContent, mvpContent }) => {
    const mvpPoints = mvpContent
      ? mvpContent.split("•").map((item) => item.trim()).filter(Boolean)
      : [];

    return (
      <div className="md:w-[32%] mb-8">
        {/* Team Header */}
        <div className="flex items-center mb-4">
          <div
            className="p-3 rounded-xl mr-4 shadow-sm"
            style={{ backgroundColor: teamColor.iconBg, color: teamColor.text }}
          >
            <GiArtificialHive style={{ fontSize: "24px" }} />
          </div>
          <Title level={3} className={`mb-0 font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
            {teamName}
          </Title>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {/* MVP Card */}
          <Card
            className="shadow-md border-0 transition-all duration-300 hover:shadow-xl"
            style={{
              borderRadius: "16px",
              background: isDarkMode ? "#111827" : "linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)",
              border: `1px solid ${teamColor.border}`,
              height: "400px",
              overflow: 'hidden',
            }}
            bodyStyle={{ padding: "0", height: "100%" }}
          >
            <div
              className="p-4"
              style={{

                background: `linear-gradient(135deg, ${teamColor.bg} 0%, ${teamColor.bgSecondary} 100%)`,
                borderBottom: `1px solid ${teamColor.border}`,
              }}
            >
              <div className="flex items-center">
                <RocketOutlined
                  style={{ fontSize: "18px", color: teamColor.text, marginRight: "8px" }}
                />
                <Title level={5} className={`mb-0 font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  MVP Strategy
                </Title>
              </div>
            </div>
            <div className="p-4 overflow-y-auto" style={{ height: "calc(100% - 60px)" }}>
              {mvpPoints.length > 0 ? (
                <List
                  dataSource={mvpPoints}
                  renderItem={(item) => (
                    <List.Item style={{ padding: "4px 0" }}>
                      <Text className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>{item}</Text>
                    </List.Item>
                  )}
                />
              ) : (
                <Text className={`italic text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  No MVP available yet
                </Text>
              )}
            </div>
          </Card>

          {/* Vision Card */}
          <Card
            className="shadow-md border-0 transition-all duration-300 hover:shadow-xl"
            style={{
              borderRadius: "16px",
              background: isDarkMode ? "#111827" : "linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)",
              border: `1px solid ${teamColor.border}`,
              height: "300px",
            }}
            bodyStyle={{ padding: "0", height: "100%" }}
          >
            <div
              className="p-4"
              style={{
                background: `linear-gradient(135deg, ${teamColor.bg} 0%, ${teamColor.bgSecondary} 100%)`,
                borderBottom: `1px solid ${teamColor.border}`,
              }}
            >
              <div className="flex items-center">
                <EyeOutlined
                  style={{ fontSize: "18px", color: teamColor.text, marginRight: "8px" }}
                />
                <Title level={5} className={`mb-0 font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  Vision Statement
                </Title>
              </div>
            </div>
            <div className="p-4 overflow-y-auto" style={{ height: "calc(100% - 60px)" }}>
              <div className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} leading-relaxed text-sm`}>
                {visionContent || (
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'} italic`}>No vision available yet</span>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  };

  const MainContent = () => {
    // if (isContentEmpty) return <GenerateButton />;

    return (
      <div className="">

        {/* // Update the section with the stop loop button */}
        {(isLoopActive || isStop) && (
          <div className={`mb-2 p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-gradient-to-r from-emerald-950/40 to-green-950/40 border-emerald-900' : 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {isLoopActive ? (
                  <>
                    <div className="animate-pulse w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-green-800 font-medium">Auto-updating every 30 seconds</span>
                    <span className="text-green-600 text-sm ml-2">(Real-time sync active)</span>

                  </>
                ) : (
                  <>
                    <div className={`w-3 h-3 rounded-full mr-3 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-600'}`}></div>
                    <span className={`${isDarkMode ? 'text-gray-900' : 'text-gray-900'} text-gray-900 font-medium`}>Auto-update stopped</span>

                  </>
                )}
              </div>
              <div className="flex gap-2">
                {/* Configuration Button */}
                <Button
                  type="default"
                  size="small"
                  onClick={() => setConfigDrawerOpen(true)}
                  className="shadow-sm border font-medium"
                  style={{
                    borderRadius: '8px',
                  }}
                  icon={<SettingOutlined />}
                >
                  Config
                </Button>

                {isLoopActive ? (
                  <Button
                    type="text"
                    size="small"
                    onClick={handleStopLoop}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 font-medium"
                    icon={<CloseOutlined />}
                    disabled={waitingForResponse}
                  >
                    {waitingForResponse ? 'please wait your response is generating' : 'Stop Auto-Update'}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="small"
                    loading={isGenerating}
                    onClick={handleStartAgain}
                    className="shadow-sm border-0 font-medium"
                    style={{
                      backgroundColor: '#16a34a',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)'
                    }}
                    icon={!isGenerating && <ThunderboltOutlined />}
                  >
                    {isGenerating ? 'Starting...' : 'Start Now'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}



        <div className='md:flex md:justify-between  '>


          <TeamSection
            teamName="Team A (OpenAI Models)"
            teamColor={{
              bg: '#f0f9ff',
              bgSecondary: '#e0f2fe',
              iconBg: '#ffffff',
              text: '#0284c7',
              border: '#7dd3fc'
            }}
            visionContent={teamC.vision}
            mvpContent={teamC.mvp}
          />

          <TeamSection
            teamName="Team B (Mistrail Models)"
            teamColor={{
              bg: '#f0fdf4',
              bgSecondary: '#dcfce7',
              iconBg: '#ffffff',
              text: '#16a34a',
              border: '#86efac'
            }}
            visionContent={teamB.vision}
            mvpContent={teamB.mvp}
          />

          <TeamSection
            teamName="Team C (Ollama Models)"
            teamColor={{
              bg: '#fef3f2',
              bgSecondary: '#fee2e2',
              iconBg: '#ffffff',
              text: '#dc2626',
              border: '#fca5a5'
            }}
            visionContent={teamA.vision}
            mvpContent={teamA.mvp}
          />



        </div>
      </div>
    );
  };

  return (
    <>
      <Button
        type="primary"
        shape="circle"
        size="large"
        icon={<Sparkles />}
        onClick={toggleMobileDrawer}
        className="shadow-xl border-0 flex items-center justify-center transition-all duration-300 hover:scale-105"
        style={{
          background: 'linear-gradient(135deg, #2B7FFF 0%, #1e40af 100%)',
          width: '42px',
          height: '42px'
        }}
      />

      <Drawer
        title={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center">
              <div className={`p-2 rounded-xl mr-4 shadow-sm ${isDarkMode ? 'bg-gradient-to-br from-slate-800 to-slate-900' : 'bg-gradient-to-br from-blue-50 to-indigo-50'}`}>
                <RocketOutlined style={{ color: '#2B7FFF', fontSize: '22px' }} />
              </div>
              <div>
                <span style={{ color: isDarkMode ? '#e5e7eb' : '#1f2937', fontSize: '16px', fontWeight: '600' }}>
                  {currentProject?.project_name || 'Company Overview'}
                </span>
                <div className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  AI-Generated Meeting Analysis
                </div>
              </div>
            </div>
            {/* Tab Switcher in Header */}
            {/* {wantDocumentTemplate && documentTemplate && (
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setActiveDocTab('teams')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeDocTab === 'teams' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <GiArtificialHive />
                  Teams
                </button>
                <button
                  onClick={() => setActiveDocTab('document')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeDocTab === 'document' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <FileTextOutlined />
                  Document
                </button>
              </div>
            )} */}
          </div>
        }
        placement="right"
        onClose={toggleMobileDrawer}
        open={mobileDrawerOpen}
        width={1600}
        headerStyle={{
          borderBottom: `2px solid ${isDarkMode ? '#334155' : '#e5e7eb'}`,
          padding: '20px 24px',
          background: isDarkMode
            ? 'linear-gradient(135deg, #111827 0%, #0f172a 100%)'
            : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'
        }}
        bodyStyle={{
          padding: '0',
          backgroundColor: isDarkMode ? '#0f172a' : '#fafbfc',
          background: isDarkMode
            ? 'linear-gradient(180deg, #0f172a 0%, #111827 100%)'
            : 'linear-gradient(180deg, #fafbfc 0%, #f1f5f9 100%)'
        }}
        closeIcon={<CloseOutlined style={{ fontSize: '18px', color: isDarkMode ? '#94a3b8' : '#6b7280' }} />}
        className="professional-drawer"
      >
        <div className="p-6">
          {/* Content based on active broadcast type (document | summary | mvpvision) - ensures remote users see what was broadcast */}
          {/* Document panel: always show template + live fills when relevant (fixes hidden agent saves). */}
          {showLiveDocumentDrawer ? (
            <>
              {canShowLiveDocumentPanels ? (
                <DocumentTemplateDisplay />
              ) : (
                agent && <GenerateButton />
              )}
            </>
          ) : null}

          {/* MVP + Vision section: show when mvpvision broadcast received OR mvpVisionTemplate enabled */}
          {(activeBroadcastType === 'mvpvision' || mvpVisionTemplate) && (
            <div className="mb-8">
              {agent && !isLoopActive && !isStop && (
                <div className={`mb-6 p-6 rounded-xl border ${isDarkMode ? 'bg-gradient-to-r from-indigo-950/40 to-violet-950/40 border-indigo-900' : 'bg-gradient-to-r from-indigo-50 to-violet-50 border-indigo-200'}`}>
                  <div className="text-center">
                    <RocketOutlined style={{ fontSize: 40, color: '#4f46e5', marginBottom: 16 }} />
                    <p className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} font-medium mb-4`}>Generate MVP & Vision from your meeting</p>
                    <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'} text-sm mb-6`}>AI will analyze the conversation and extract functional requirements and vision in real-time</p>
                    <Button
                      type="primary"
                      size="large"
                      icon={<ThunderboltOutlined />}
                      onClick={handleGenerate}
                      style={{
                        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                        border: 'none',
                        height: '44px',
                        borderRadius: '12px'
                      }}
                    >
                      Generate MVP & Vision
                    </Button>
                  </div>
                </div>
              )}
              {(isLoopActive || isStop) && (
                <div className={`mb-4 p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-gradient-to-r from-indigo-950/40 to-blue-950/40 border-indigo-900' : 'bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isMvpVisionProcessing ? (
                        <>
                          <LoadingOutlined style={{ fontSize: 18, color: '#4f46e5' }} />
                          <span className={`${isDarkMode ? 'text-indigo-200' : 'text-indigo-800'} font-medium`}>Analyzing transcripts...</span>
                          <span className={`${isDarkMode ? 'text-indigo-300' : 'text-indigo-600'} text-sm`}>(synced to all participants)</span>
                        </>
                      ) : (
                        <>
                          <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
                          <span className={`${isDarkMode ? 'text-indigo-200' : 'text-indigo-800'} font-medium`}>Auto-updating every 30 seconds</span>
                          <span className={`${isDarkMode ? 'text-indigo-300' : 'text-indigo-600'} text-sm`}>Real-time MVP & Vision</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* MVP Card */}
                <Card
                  className="shadow-lg border-0 overflow-hidden transition-all duration-300 hover:shadow-xl"
                  style={{
                    borderRadius: '16px',
                    background: isDarkMode ? '#111827' : 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)',
                    border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`
                  }}
                  bodyStyle={{ padding: 0, height: '100%' }}
                >
                  <div
                    className="px-5 py-4 flex items-center gap-3"
                    style={{
                      background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
                      borderBottom: '1px solid #c7d2fe'
                    }}
                  >
                    <RocketOutlined style={{ fontSize: 20, color: '#4f46e5' }} />
                    <Title level={5} className="mb-0 font-semibold" style={{ color: isDarkMode ? '#e5e7eb' : '#1e1b4b' }}>
                      MVP &amp; Functional Requirements
                    </Title>
                  </div>
                  <div className="p-5 overflow-y-auto" style={{ minHeight: 320, maxHeight: 420 }}>
                    {mvp ? (
                      <List
                        size="small"
                        dataSource={mvp.split(/[•\n]/).map((s) => s.trim()).filter(Boolean)}
                        renderItem={(item) => (
                          <List.Item className="!border-0 !px-0" style={{ padding: '6px 0' }}>
                            <Text className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} flex items-start gap-2`}>
                              <span className="text-indigo-500 mt-1">•</span>
                              <span>{item}</span>
                            </Text>
                          </List.Item>
                        )}
                      />
                    ) : (
                      <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {isMvpVisionProcessing ? (
                          <span className="italic">Extracting requirements from meeting...</span>
                        ) : (
                          <span className="italic">MVP will appear as the meeting progresses</span>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
                {/* Vision Card */}
                <Card
                  className="shadow-lg border-0 overflow-hidden transition-all duration-300 hover:shadow-xl"
                  style={{
                    borderRadius: '16px',
                    background: isDarkMode ? '#111827' : 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)',
                    border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`
                  }}
                  bodyStyle={{ padding: 0, height: '100%' }}
                >
                  <div
                    className="px-5 py-4 flex items-center gap-3"
                    style={{
                      background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                      borderBottom: '1px solid #a7f3d0'
                    }}
                  >
                    <EyeOutlined style={{ fontSize: 20, color: '#059669' }} />
                    <Title level={5} className="mb-0 font-semibold" style={{ color: isDarkMode ? '#e5e7eb' : '#064e3b' }}>
                      Vision Statement
                    </Title>
                  </div>
                  <div className="p-5 overflow-y-auto" style={{ minHeight: 320, maxHeight: 420 }}>
                    {vision ? (
                      <Paragraph className={`${isDarkMode ? 'text-gray-200' : 'text-gray-700'} leading-relaxed mb-0`} style={{ lineHeight: 1.7 }}>
                        {vision}
                      </Paragraph>
                    ) : (
                      <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {isMvpVisionProcessing ? (
                          <span className="italic">Generating vision from discussion...</span>
                        ) : (
                          <span className="italic">Vision will appear as the meeting progresses</span>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* Summary section: when not already showing live document drawer content */}
          {(activeBroadcastType === 'summary' || (activeDocTab === 'document' && wantDocumentTemplate === false && !mvpVisionTemplate && !showLiveDocumentDrawer)) && (
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">

                <div className="flex items-center gap-2">
                  <FileTextOutlined className="text-blue-500 text-lg" />
                  <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                    Meeting Summary
                  </h3>
                </div>
                {isSummaryStarted && meetingSummary && (
                  <span className={`text-xs flex items-center gap-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {isSummaryGenerating && <LoadingOutlined />}
                    Auto-updating every 30 seconds...
                  </span>
                )}
              </div>

              {!isSummaryStarted ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    {isAdmin ? (
                      <>
                        <FileTextOutlined
                          style={{ fontSize: '48px', color: '#94a3b8', marginBottom: '16px' }}
                        />
                        <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'} text-base font-medium mb-4`}>
                          Generate a high-level summary of your meeting
                        </p>
                        <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'} text-sm mb-6`}>
                          AI will analyze the conversation and create an incremental summary updated every 30 seconds
                        </p>
                        <Button
                          type="primary"
                          size="large"
                          icon={<RocketOutlined />}
                          onClick={() => {
                            setIsSummaryStarted(true);
                            handleGenerate();
                            message.success('Summary generation started!');
                            console.log("🚀 Summary generation started");
                          }}
                          style={{
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            border: 'none',
                            height: '44px',
                            padding: '0 32px',
                            fontSize: '15px',
                            fontWeight: '500',
                            boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
                          }}
                        >
                          Start Generating Summary
                        </Button>
                      </>
                    ) : meetingSummary ? (
                      <div className={`${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'} rounded-lg border p-4 max-h-[600px] overflow-y-auto text-left`}>
                        <div className={`prose prose-sm max-w-none ${isDarkMode ? 'text-gray-200' : 'text-gray-700'} whitespace-pre-wrap`} style={{ lineHeight: '1.6' }}>
                          {meetingSummary}
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* <FileTextOutlined 
                          style={{ fontSize: '48px', color: '#94a3b8', marginBottom: '16px' }} 
                        /> */}

                        <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'} text-base font-medium mb-4`}>
                          Waiting for host to start summary generation or document data
                        </p>
                        <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'} text-sm`}>
                          The meeting summary or document data will appear here once the host starts
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ) : meetingSummary ? (
                <div className={`${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'} rounded-lg border p-4 max-h-[600px] overflow-y-auto`}>
                  <div
                    className={`prose prose-sm max-w-none ${isDarkMode ? 'text-gray-200' : 'text-gray-700'} whitespace-pre-wrap`}
                    style={{ lineHeight: '1.6' }}
                  >
                    {meetingSummary}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <Spin size="large" />
                    <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'} text-sm font-medium mt-4`}>
                      Analyzing meeting transcripts...
                    </p>
                    <p className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'} text-xs mt-2`}>
                      Your first summary will appear shortly
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </Drawer>


      {/* // Add the configuration drawer to your return statement (after the main drawer) */}
      <ConfigurationDrawer
        open={configDrawerOpen}
        onClose={() => setConfigDrawerOpen(false)}
      />

      {/* ── PDF / Word Preview Modal ─────────────────────────────────────── */}
      <Modal
        open={showPdfPreviewModal}
        onCancel={() => setShowPdfPreviewModal(false)}
        footer={null}
        width="90vw"
        style={{ top: 16 }}
        styles={{ body: { padding: 0, maxHeight: '90vh', overflowY: 'auto' } }}
        title={
          <Space>
            <FileTextOutlined style={{ color: '#1890ff' }} />
            <span>{currentProject?.project_name || 'Document Preview'}</span>
          </Space>
        }
        destroyOnClose
      >
        {liveDocumentSections.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Empty description="No completed sections yet. Start the meeting recording to generate content." />
          </div>
        ) : (
          <div style={{ padding: '0 24px 24px' }}>

            {/* ── Header: view toggle + download ──────────────────────── */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 0',
              borderBottom: '1px solid #f0f0f0',
              marginBottom: 16,
              flexWrap: 'wrap',
              gap: 12,
            }}>
              <Space size="middle" wrap>
                {/* View Mode Toggle */}
                <Space.Compact>
                  <Button
                    type={previewViewMode === 'pdf' ? 'primary' : 'default'}
                    icon={<FilePdfOutlined />}
                    onClick={() => setPreviewViewMode('pdf')}
                    style={previewViewMode === 'pdf' ? { backgroundColor: '#ff4d4f', borderColor: '#ff4d4f' } : {}}
                  >
                    PDF View
                  </Button>
                  <Button
                    type={previewViewMode === 'word' ? 'primary' : 'default'}
                    icon={<FileWordOutlined />}
                    onClick={() => setPreviewViewMode('word')}
                    style={previewViewMode === 'word' ? { backgroundColor: '#1890ff', borderColor: '#1890ff' } : {}}
                  >
                    Word View
                  </Button>
                </Space.Compact>

                {/* Download Button */}
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handlePreviewDownload}
                  style={{
                    backgroundColor: previewViewMode === 'pdf' ? '#ff4d4f' : '#1890ff',
                    borderColor: previewViewMode === 'pdf' ? '#ff4d4f' : '#1890ff',
                  }}
                >
                  Download as {previewViewMode === 'pdf' ? 'PDF' : 'Word'}
                </Button>
              </Space>

              <span style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#999' }}>
                {liveDocumentSections.length} sections completed
              </span>
            </div>

            {/* ── Document Viewer ──────────────────────────────────────── */}
            <div style={{
              backgroundColor: previewViewMode === 'pdf'
                ? (isDarkMode ? '#0f172a' : '#525659')
                : (isDarkMode ? '#0b1220' : '#f5f5f5'),
              borderRadius: 8,
              padding: 20,
              minHeight: 500,
              boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.1)',
              transition: 'background-color 0.3s ease',
            }}>
              {/* Document Paper */}
              <div style={{
                backgroundColor: isDarkMode ? '#111827' : '#fff',
                maxWidth: 900,
                margin: '0 auto',
                padding: previewViewMode === 'pdf' ? '60px 50px' : '40px 50px',
                borderRadius: 4,
                boxShadow: previewViewMode === 'pdf' ? '0 4px 20px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.1)',
                minHeight: 600,
                fontFamily: previewViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                color: isDarkMode ? '#f8fafc' : '#333',
              }}>

                {/* Document Title */}
                <div style={{ textAlign: 'center', marginBottom: 40, paddingBottom: 20, borderBottom: previewViewMode === 'pdf' ? 'none' : '2px solid #1890ff' }}>
                  <h1 style={{
                    fontSize: previewViewMode === 'pdf' ? 24 : 28,
                    fontWeight: 'bold',
                    color: previewViewMode === 'pdf'
                      ? (isDarkMode ? '#f8fafc' : '#333')
                      : (isDarkMode ? '#60a5fa' : '#1890ff'),
                    margin: 0,
                    fontFamily: previewViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                  }}>
                    {currentProject?.project_name || 'Requirements Document'}
                  </h1>
                  <p style={{ color: isDarkMode ? '#94a3b8' : '#999', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                    {new Date().toLocaleDateString()} · {liveDocumentSections.length} sections
                  </p>
                </div>

                {/* Revision History */}
                <div style={{ marginBottom: 40 }}>
                  <h2 style={{
                    fontSize: 18,
                    fontWeight: 'bold',
                    margin: '0 0 12px',
                    fontFamily: 'Georgia, serif',
                    color: isDarkMode ? '#f8fafc' : '#333',
                  }}>
                    Revision History
                  </h2>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Georgia, serif' }}>
                    <thead>
                      <tr style={{ backgroundColor: isDarkMode ? '#334155' : '#D3D3D3' }}>
                        <th style={{ border: `1px solid ${isDarkMode ? '#64748b' : '#999'}`, color: isDarkMode ? '#f8fafc' : '#333', padding: '8px 12px', textAlign: 'center', width: '50%' }}>Date</th>
                        <th style={{ border: `1px solid ${isDarkMode ? '#64748b' : '#999'}`, color: isDarkMode ? '#f8fafc' : '#333', padding: '8px 12px', textAlign: 'center', width: '50%' }}>Revision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisionHistory.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ border: `1px solid ${isDarkMode ? '#475569' : '#ccc'}`, color: isDarkMode ? '#f8fafc' : '#333', padding: '8px 12px', textAlign: 'center' }}>
                            {row.date}
                          </td>
                          <td style={{ border: `1px solid ${isDarkMode ? '#475569' : '#ccc'}`, color: isDarkMode ? '#f8fafc' : '#333', padding: '8px 12px', textAlign: 'center' }}>
                            {row.revision || `v${version || 1}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Table of Contents */}
                <div style={{ marginBottom: 40, padding: 24, backgroundColor: isDarkMode ? '#0b1220' : '#fafafa', borderRadius: 8, border: `1px solid ${isDarkMode ? '#334155' : '#e8e8e8'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: `2px solid ${isDarkMode ? '#f8fafc' : '#333'}`, paddingBottom: 12 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 'bold', color: isDarkMode ? '#f8fafc' : '#333', margin: 0, fontFamily: 'Georgia, serif' }}>
                      Table of Contents
                    </h2>
                    <Button type="text" size="small" onClick={() => setPreviewTocVisible(v => !v)} style={{ color: isDarkMode ? '#60a5fa' : '#1890ff' }}>
                      {previewTocVisible ? 'Hide' : 'Show'}
                    </Button>
                  </div>

                  {previewTocVisible && (
                    <div style={{ maxHeight: 400, overflowY: 'auto', paddingRight: 8 }}>
                      {generatePreviewTOC(liveDocumentSections).map((item, idx) => (
                        <div
                          key={item.id}
                          onClick={() => !item.isCategory && scrollToPreviewSection(item.sectionId)}
                          style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            padding: item.isCategory ? '8px 0 4px 0' : '4px 0 4px 20px',
                            cursor: item.isCategory ? 'default' : 'pointer',
                            borderRadius: 4,
                            marginBottom: item.isCategory ? 4 : 2,
                            transition: 'background-color 0.2s',
                          }}
                          onMouseEnter={(e) => { if (!item.isCategory) e.currentTarget.style.backgroundColor = 'rgba(24,144,255,0.1)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <span style={{ minWidth: item.isCategory ? 24 : 40, fontWeight: item.isCategory ? 'bold' : 'normal', fontSize: item.isCategory ? 14 : 13, color: item.isCategory ? (isDarkMode ? '#f8fafc' : '#333') : (isDarkMode ? '#cbd5e1' : '#555'), fontFamily: 'Georgia, serif' }}>
                            {item.number}
                          </span>
                          <span style={{ flex: 1, fontWeight: item.isCategory ? 'bold' : 'normal', fontSize: item.isCategory ? 14 : 13, color: item.isCategory ? (isDarkMode ? '#f8fafc' : '#333') : (isDarkMode ? '#cbd5e1' : '#555'), fontFamily: 'Georgia, serif', borderBottom: `1px dotted ${isDarkMode ? '#475569' : '#ccc'}`, marginRight: 8, paddingBottom: 2 }}>
                            {item.title}
                          </span>
                          {!item.isCategory && (
                            <span style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#999', fontFamily: 'Georgia, serif' }}>{idx}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Document Sections — Accordion */}
                <Collapse
                  activeKey={previewAccordionKeys}
                  onChange={(keys) => setPreviewAccordionKeys(keys)}
                  style={{ backgroundColor: 'transparent', border: 'none' }}
                  expandIconPosition="end"
                >
                  {liveDocumentSections.map((section, index) => (
                    <Collapse.Panel
                      key={section.id}
                      forceRender
                      className={`preview-section-panel-${section.id}`}
                      header={
                        <span style={{
                          fontSize: previewViewMode === 'pdf' ? 15 : 16,
                          fontWeight: 'bold',
                          color: previewViewMode === 'pdf'
                            ? (isDarkMode ? '#f8fafc' : '#333')
                            : (isDarkMode ? '#60a5fa' : '#1890ff'),
                          fontFamily: previewViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          {index + 1}. {section.title}
                        </span>
                      }
                      style={{
                        marginBottom: 12,
                        borderRadius: 8,
                        border: `1px solid ${isDarkMode ? '#334155' : '#e8e8e8'}`,
                        backgroundColor: isDarkMode ? '#0b1220' : '#fafafa',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{
                        fontSize: previewViewMode === 'pdf' ? 13 : 14,
                        lineHeight: previewViewMode === 'pdf' ? 1.8 : 1.6,
                        color: isDarkMode ? '#f8fafc' : '#333',
                        textAlign: previewViewMode === 'pdf' ? 'justify' : 'left',
                        fontFamily: previewViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                        padding: 8,
                        backgroundColor: isDarkMode ? '#111827' : '#fff',
                        borderRadius: 4,
                      }}>
                        {section.content ? formatContent(section.content) : (
                          <span style={{ color: isDarkMode ? '#94a3b8' : '#999', fontStyle: 'italic' }}>No content yet</span>
                        )}
                      </div>
                    </Collapse.Panel>
                  ))}
                </Collapse>

                {/* Footer */}
                {previewViewMode === 'pdf' && (
                  <div style={{ marginTop: 60, paddingTop: 20, borderTop: `1px solid ${isDarkMode ? '#475569' : '#ddd'}`, textAlign: 'center', fontSize: 10, color: isDarkMode ? '#94a3b8' : '#999' }}>
                    Generated during meeting · {new Date().toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <style jsx>{`
        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        .animate-fade-in {
          animation: fadeIn 0.5s ease-in-out;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .professional-drawer .ant-drawer-content {
          box-shadow: -4px 0 20px rgba(0, 0, 0, 0.08);
          width: 75vw !important;
        }
        
        .group:hover {
          transform: translateY(-2px);
        }
        
        @media (max-width: 800px) {
          .professional-drawer .ant-drawer-content {
            width: 100vw !important;
          }
        }
      `}</style>
    </>
  );
});

export default RealtimeMvpVisionDisplay;