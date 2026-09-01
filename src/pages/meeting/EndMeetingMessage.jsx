/**
 * Post-meeting screen — summary, document, exports.
 * File: src/pages/meeting/EndMeetingMessage.jsx
 */
/**
 * Post-meeting screen — summary, generated document, MVP/Vision, and export options.
 * Route: /endmeeting/:id (shown when host/agent ends the meeting).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Row,
  Space,
  Typography,
  Tag,
  Timeline,
  Input,
  message,
  notification,
  Collapse,
  Modal,
  Spin,
} from 'antd';
import {
  CheckCircleFilled,
  FileTextOutlined,
  DashboardOutlined,
  BulbOutlined,
  RocketOutlined,
  TeamOutlined,
  EyeOutlined,
  CalendarOutlined,
  TrophyOutlined,
  CheckOutlined,
  EditOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  DownloadOutlined,
  SaveOutlined,
  CloseOutlined,
  LoadingOutlined,
  PlusOutlined,
  DeleteOutlined,
  GoogleOutlined,
} from '@ant-design/icons';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph as DocxParagraph, TextRun, HeadingLevel } from 'docx';
import { Table, TableRow, TableCell, WidthType } from 'docx';
import { saveAs } from 'file-saver';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useRefs } from '../../providers/RefProvider';
import { setTeamAmvp, setTeamAvision, setTeamBmvp, setTeamBvision, setTeamCmvp, setTeamCvision, clearDocumentData } from '../../features/ReportSlice';

import { text } from '@fortawesome/fontawesome-svg-core';

import DownloadPDFButtons from '../../components/documents/DownloadPDFButtons';
import { socketURL } from '../../services/meeting/socketInstance';
import { getUserId } from '../../services/auth/GetLoginUserId';
import MeetingDataSyncLoader from '../../components/meeting/MeetingDataSyncLoader.jsx';
import { getSummariesByProject, updateMeetingSummary } from '../../features/mainStates/Summary_Slice';
import { getMvpVisionByProject, saveMeetingMvpVision, updateMeetingMvpVision } from '../../features/mainStates/MvpVision_Slice';
import { useTheme } from '../../context/ThemeContext.jsx';
import { exportDocumentToNotion, getDocumentsByProject, saveGeneratedDocument, saveMeetingTranscript, updateGeneratedDocument } from '../../features/mainStates/Template_Slice';
import { SiNotion } from 'react-icons/si';
import {
  getDriveDocumentTitle,
  getDriveMeetingDocumentTitle,
  normalizeDriveStoredDocument,
  retrieveDriveDocumentFromMcp,
  setCachedDriveDocument,
  clearCachedDriveDocument,
} from '../../utils/googleDriveMcpDocuments';
import {
  retrieveNotionDocumentFromApi,
  saveMeetingDocumentToNotion,
} from '../../utils/notionMcpDocuments';
import {
  buildRevisionHistoryTableRows,
  buildDefaultRevisionHistoryRows,
  parseStoredDocumentVersionHistory,
  STORAGE_BACKEND,
} from '../../utils/projectDocumentStorage';
import {
  buildTranscriptEntries,
  buildTranscriptFullText,
  computeNextDocumentVersion,
} from '../../utils/meetingTranscriptUtils';
import {
  buildMeetingSectionsWithUserContent,
  hasMeaningfulMeetingDocumentContent,
} from '../../utils/meetingDocumentContentUtils';
import {
  filterSupabaseProjectDocuments,
  isExternalDocumentRecord,
  resolveSupabaseContinuationDocumentId,
  resolveSupabaseDocumentForMeeting,
  resolveSupabaseExistingDocument,
} from '../../utils/documentStorageRecords';
import useUnifiedProjectMeetingHistory from '../../hooks/useUnifiedProjectMeetingHistory';
import {
  getMeetingListKey,
  sortMeetingsByDateDesc,
} from '../../utils/unifiedMeetingHistory';
import supabase from '../../services/supabase/supabaseclient';
import store from '../../store/store';


const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;
const EMPTY_DOCUMENT_SECTIONS = {};
const EMPTY_MEETING_TEMPLATE = { sections: [], categories: {} };

const formatRevisionMeetingDate = (value) => {
  if (!value) return 'Unknown date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleString();
};

const EndMeetingMessage = () => {
  const { isDarkMode } = useTheme();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const userId = getUserId();
  const agenda = useSelector((state) => state.MainStates_Slice.agenda);
  const wantDocumentTemplate = useSelector((state) => state.MainStates_Slice.wantDocumentTemplate);
  const [activeTab, setActiveTab] = useState('teams');
  const [editingTeam, setEditingTeam] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [tempValues, setTempValues] = useState({});
  const [documentSyncComplete, setDocumentSyncComplete] = useState(
    () => !wantDocumentTemplate
  );
  const [transcriptSyncComplete, setTranscriptSyncComplete] = useState(
    () => !wantDocumentTemplate
  );
  const redirectedEmptyMeetingRef = useRef(false);
  const [meetingSyncStage, setMeetingSyncStage] = useState('document');
  const isSyncingMeetingData =
    wantDocumentTemplate &&
    Boolean(location.state?.freshEndMeeting) &&
    !(documentSyncComplete && transcriptSyncComplete);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const mvpVisionTemplate = useSelector((state) => state.MainStates_Slice.mvpVisionTemplate);
  const roomId = useSelector((state) => state.MainStates_Slice.roomId);
  const agentName = useSelector((state) => state.MainStates_Slice.agentName);
  const isAdmin = useSelector((state) => state.MainStates_Slice.isAdmin);
  const reduxGeneratedDocumentSections = useSelector(
    (state) => state.reports?.generatedDocumentSections || EMPTY_DOCUMENT_SECTIONS
  );
  const receivedDocumentTemplate = useSelector((state) => state.reports?.receivedDocumentTemplate);
  const meetingSummaries = useSelector((state) => state.summaries.meetingSummaries);
  const meetingMvpvisions = useSelector((state) => state.mvpvisions.mvpvisions);
  console.log("meetingSummaries:", meetingSummaries);
  const projects = useSelector((state) => state.main.projects);
  const currentProject = projects.find((project) => String(project.id) === id);

  const resolveProjectName = () =>
    currentProject?.project_name ||
    driveDocumentFromNavigation?.document?.projectName ||
    driveDocumentFromNavigation?.projectName ||
    notionDocumentFromNavigation?.document?.projectName ||
    notionDocumentFromNavigation?.projectName ||
    generatedDocumentFromNavigation?.project_name ||
    location.state?.projectName ||
    "";
  const driveDocumentFromNavigation = location.state?.driveDocument;
  const notionDocumentFromNavigation = location.state?.notionDocument;
  const generatedDocumentFromNavigation = location.state?.generatedDocument;
  const storageBackendFromNavigation = location.state?.storageBackend;
  const freshEndMeeting = Boolean(location.state?.freshEndMeeting);

  const {
    meetings: meetingHistory,
    loading: loadingMeetingHistory,
  } = useUnifiedProjectMeetingHistory(id, {
    enabled: Boolean(id),
    summary: true,
    projectName:
      currentProject?.project_name ||
      location.state?.projectName ||
      '',
  });

  const revisionMeetingHistory = useMemo(
    () =>
      sortMeetingsByDateDesc(meetingHistory).filter((meeting) => meeting.document),
    [meetingHistory]
  );

  const handleOpenRevisionDocument = (meeting) => {
    const doc = meeting?.document;
    const projectName = resolveProjectName();
    if (!doc?._id || !projectName || !id) {
      message.warning('Unable to open this document.');
      return;
    }

    const meetingMatch = meetingHistory.find(
      (item) =>
        item.document?._id === doc._id ||
        item.meeting_id === doc.meeting_id ||
        item.meeting_id === doc.meetingId
    );
    const mergedState = {
      meetingId:
        (meeting?.is_import ? doc.meeting_id : meeting?.meeting_id) ||
        doc.meeting_id ||
        doc.meetingId ||
        meetingMatch?.meeting_id ||
        null,
      meetingTranscript: meetingMatch?.transcript || meeting?.transcript || null,
      from: location.pathname,
    };

    if (doc.source === 'google_drive') {
      navigate(`/project_details/${projectName}/${id}/document/${doc._id}`, {
        state: { driveDocument: doc, ...mergedState },
      });
      return;
    }
    if (doc.source === 'notion') {
      navigate(`/project_details/${projectName}/${id}/document/${doc._id}`, {
        state: { notionDocument: doc, ...mergedState },
      });
      return;
    }

    navigate(`/project_details/${projectName}/${id}/document/${doc._id}`, {
      state: mergedState,
    });
  };
  // console.log("currentProject :", currentProject);
  const defaultTemplate = currentProject?.template_document;
  const activeMeetingTemplate =
    defaultTemplate || receivedDocumentTemplate || EMPTY_MEETING_TEMPLATE;

  const resolveMeaningfulMeetingContent = () =>
    hasMeaningfulMeetingDocumentContent({
      generatedSections: reduxGeneratedDocumentSections,
      template: activeMeetingTemplate,
    });

  const redirectEmptyFreshMeetingHome = () => {
    if (redirectedEmptyMeetingRef.current) return;
    redirectedEmptyMeetingRef.current = true;
    dispatch(clearDocumentData());
    setDocumentSyncComplete(true);
    setTranscriptSyncComplete(true);
    navigate("/", { replace: true });
  };

  useEffect(() => {
    if (!wantDocumentTemplate || !freshEndMeeting) return;
    if (!resolveMeaningfulMeetingContent()) {
      redirectEmptyFreshMeetingHome();
    }
  }, [
    wantDocumentTemplate,
    freshEndMeeting,
    reduxGeneratedDocumentSections,
    activeMeetingTemplate,
  ]);
  const [notionConnected, setNotionConnected] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [documentStorageBackend, setDocumentStorageBackend] = useState(STORAGE_BACKEND.SUPABASE);
  const [exportingToNotion, setExportingToNotion] = useState(false);
  const [exportingToDrive, setExportingToDrive] = useState(false);
  const [driveDocument, setDriveDocument] = useState(null);
  const [notionDocument, setNotionDocument] = useState(null);
  const [mongoDocument, setMongoDocument] = useState(null);
  const [documentStorageConfigLoaded, setDocumentStorageConfigLoaded] = useState(false);



  // Redux states
  const { mvp, vision } = useSelector((state) => state.MainStates_Slice);
  const teamA = useSelector((state) => state.reports.teamA);
  const teamB = useSelector((state) => state.reports.teamB);
  const teamC = useSelector((state) => state.reports.teamC);
  // const localTranscript = useSelector((state) => state.reports.localTranscript);
  // const remoteTranscripts = useSelector((state) => state.reports.remoteTranscripts);
  const {
    localtranscriptView,
    remotetranscriptView,
    formattedTime,
    agentTranscript,
    // setAgentTranscriptView,
    agentTranscriptView,
  } = useRefs();
  // Check if any team is approved (has both MVP and Vision set in main state)
  const isAnyTeamApproved = mvp && vision;

  // Add this new state at the top with other useState declarations
  const [documentSections, setDocumentSections] = useState([]);
  const [documentViewMode, setDocumentViewMode] = useState('pdf'); // 'pdf' or 'word'
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editedContent, setEditedContent] = useState('');
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editedSectionTitle, setEditedSectionTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [activeAccordionKeys, setActiveAccordionKeys] = useState([]);
  const [showTableOfContents, setShowTableOfContents] = useState(true);
  const skipSectionsSyncRef = useRef(false);
  const endMeetingDriveSyncedRef = useRef(false);
  const endMeetingNotionSyncedRef = useRef(false);
  const transcriptSavedRef = useRef(false);
  const [localUserName, setLocalUserName] = useState('User');

  const activeMeetingId = location.state?.meetingId || roomId || null;

  // ? NEW: Summary-related states
  const [summaryContent, setSummaryContent] = useState('');
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editedSummaryContent, setEditedSummaryContent] = useState('');
  const [isSavingSummary, setIsSavingSummary] = useState(false);

  // ? MVP+Vision states (when mvpVisionTemplate)
  const [mvpContent, setMvpContent] = useState('');
  const [visionContent, setVisionContent] = useState('');
  const [isEditingMvp, setIsEditingMvp] = useState(false);
  const [isEditingVision, setIsEditingVision] = useState(false);
  const [editedMvpContent, setEditedMvpContent] = useState('');
  const [editedVisionContent, setEditedVisionContent] = useState('');
  const [isSavingMvpVision, setIsSavingMvpVision] = useState(false);



  const [documentTitle, setDocumentTitle] = useState('VISION DOCUMENT TEMPLATE');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const pageBg = isDarkMode ? '#0f172a' : '#f5f5f5';
  const cardBg = isDarkMode ? '#111827' : '#ffffff';
  const subtleBg = isDarkMode ? '#0b1220' : '#fafafa';
  const borderColor = isDarkMode ? '#334155' : '#e8e8e8';
  const textColor = isDarkMode ? '#e5e7eb' : '#333333';
  const mutedText = isDarkMode ? '#94a3b8' : '#999999';
  const pdfTextColor = isDarkMode ? '#f8fafc' : '#333333';
  const pdfMutedText = isDarkMode ? '#cbd5e1' : '#555555';

  const [revisionHistory, setRevisionHistory] = useState(() =>
    buildDefaultRevisionHistoryRows(1)
  );
  const [companyName, setCompanyName] = useState('Company Name');
  const [isEditingCompanyName, setIsEditingCompanyName] = useState(false);
  const [editedCompanyName, setEditedCompanyName] = useState('');

  // Generate Table of Contents structure with proper numbering
  const generateTableOfContents = () => {
    if (!documentSections.length) return [];

    const tocItems = [];
    let categoryIndex = 0;
    let currentCategory = null;
    let subIndex = 0;

    documentSections.forEach((section) => {
      // Check if this is a new category
      if (section.category !== currentCategory) {
        categoryIndex++;
        subIndex = 0;
        currentCategory = section.category;

        // Add category as main heading
        tocItems.push({
          id: `cat-${section.category}`,
          number: `${categoryIndex}`,
          title: section.categoryTitle || section.category?.replace(/_/g, ' '),
          isCategory: true,
          sectionId: section.id, // Link to first section in category
        });
      }

      // Add section as sub-item
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

  // Scroll to section when TOC item is clicked
  const scrollToSection = (sectionId) => {
    // Open the accordion panel
    if (!activeAccordionKeys.includes(sectionId)) {
      setActiveAccordionKeys([...activeAccordionKeys, sectionId]);
    }

    // Scroll to the element after a short delay to allow accordion to open
    setTimeout(() => {
      const element = document.querySelector(`.section-panel-${sectionId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 150);
  };

  // Function to remove markdown formatting (** for bold)
  const removeMarkdownFormatting = (text) => {
    if (!text) return text;
    // Remove **text** bold formatting
    return text.replace(/\*\*([^*]+)\*\*/g, '$1');
  };

  // Function to format content for display (parse markdown-like syntax)
  const formatContent = (content) => {
    if (!content) return null;

    // Remove ** markdown and format the text
    const cleanContent = removeMarkdownFormatting(content);

    // Split by lines and format
    const lines = cleanContent.split('\n');

    return lines.map((line, index) => {
      const trimmedLine = line.trim();

      // Check if it's a bullet point
      if (trimmedLine.startsWith('- ')) {
        return (
          <div key={index} style={{
            paddingLeft: '20px',
            marginBottom: '4px',
            display: 'flex',
            alignItems: 'flex-start'
          }}>
            <span style={{ marginRight: '8px', color: '#1890ff' }}>?</span>
            <span>{trimmedLine.substring(2)}</span>
          </div>
        );
      }

      // Check if it's a numbered item (like "1. " or "2. ")
      const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/);
      if (numberedMatch) {
        return (
          <div key={index} style={{
            paddingLeft: '20px',
            marginBottom: '4px',
            display: 'flex',
            alignItems: 'flex-start'
          }}>
            <span style={{ marginRight: '8px', fontWeight: 'bold', color: '#1890ff', minWidth: '20px' }}>{numberedMatch[1]}.</span>
            <span>{numberedMatch[2]}</span>
          </div>
        );
      }

      // Regular line
      if (trimmedLine) {
        return <div key={index} style={{ marginBottom: '8px' }}>{trimmedLine}</div>;
      }

      // Empty line
      return <div key={index} style={{ height: '8px' }} />;
    });
  };


  const toSectionTitleKey = (title = '') =>
    title.toLowerCase().replace(/\s+/g, '_');

  const buildDocumentSectionsFromGeneratedDocument = (doc) => {
    if (!doc) return [];

    const template = doc.template || { sections: [], categories: {} };
    const templateSections = Array.isArray(template?.sections) ? template.sections : [];
    const templateCategories = template?.categories || {};
    const generatedSections = doc.generated_sections || doc.generatedSections || {};

    const sections = templateSections.map((section) => ({
      id: section.id,
      title: section.title,
      category: section.category || 'general',
      categoryTitle:
        templateCategories?.[section.category]?.title || section.category || 'General',
      content:
        generatedSections?.[section.id] ||
        generatedSections?.[toSectionTitleKey(section.title)] ||
        section.content ||
        '',
    }));

    const existingIds = new Set(sections.map((section) => section.id));
    const existingTitleKeys = new Set(
      templateSections.map((section) => toSectionTitleKey(section.title))
    );

    Object.entries(generatedSections).forEach(([key, content]) => {
      if (!content || existingIds.has(key) || existingTitleKeys.has(key)) return;
      sections.push({
        id: key,
        title: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        category: 'general',
        categoryTitle: 'General',
        content,
      });
      existingIds.add(key);
    });

    return sections;
  };

  const buildDocumentSectionsFromDriveDocument = (document) => {
    const storedDocument = document?.document || document;
    const sectionsJson = storedDocument?.sectionsJson || storedDocument?.sections_json;
    if (sectionsJson) {
      try {
        const sections = JSON.parse(sectionsJson);
        if (Array.isArray(sections)) {
          return sections.map((section, index) => ({
            id: section.id || `google_drive_section_${index}`,
            title: section.title || `Section ${index + 1}`,
            category: section.category || 'google_drive',
            categoryTitle: section.categoryTitle || 'Google Drive',
            content: section.content || '',
          }));
        }
      } catch (error) {
        console.warn('Failed to parse Google Drive document sections:', error);
      }
    }

    if (Array.isArray(storedDocument?.sections)) {
      return storedDocument.sections.map((section, index) => ({
        id: section.id || `google_drive_section_${index}`,
        title: section.title || `Section ${index + 1}`,
        category: section.category || 'google_drive',
        categoryTitle: section.categoryTitle || 'Google Drive',
        content: section.content || '',
      }));
    }

    const content = String(document?.content || '').trim();
    if (!content) return [];

    return [
      {
        id: 'google_drive_document',
        title: document?.fileName || getDriveDocumentTitle(id),
        category: 'google_drive',
        categoryTitle: 'Google Drive',
        content,
      },
    ];
  };

  const buildMongoDocumentPayload = (sections = documentSections) => {
    const generatedSections = Object.fromEntries(
      sections
        .map((section) => [section.id, section.content || ''])
        .filter(([, content]) => String(content || '').trim())
    );

    const template = {
      categories: sections.reduce((acc, section) => {
        if (!acc[section.category]) {
          acc[section.category] = {
            title: section.categoryTitle || section.category || 'General',
          };
        }
        return acc;
      }, {}),
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        category: section.category,
        icon: section.icon,
      })),
    };

    return { template, generatedSections };
  };

  const applyRevisionHistoryFromDocument = (doc) => {
    const history = parseStoredDocumentVersionHistory(doc);
    if (history.length > 0) {
      setRevisionHistory(buildRevisionHistoryTableRows(history));
      return;
    }
    const docVersion = doc?.version;
    if (docVersion != null && !Number.isNaN(Number(docVersion))) {
      setRevisionHistory(buildDefaultRevisionHistoryRows(Number(docVersion)));
    }
  };

  const applyMongoDocumentToView = (doc) => {
    if (!doc || isExternalDocumentRecord(doc)) return false;

    setMongoDocument(doc);
    const sections = buildDocumentSectionsFromGeneratedDocument(doc);
    if (sections.length > 0) {
      skipSectionsSyncRef.current = true;
      setDocumentSections(sections);
      setActiveAccordionKeys(sections.map((section) => section.id));
      setHasUnsavedChanges(false);
    }
    applyRevisionHistoryFromDocument(doc);
    return sections.length > 0;
  };

  const saveDocumentToMongo = async ({
    sections = documentSections,
    showSuccess = true,
  } = {}) => {
    if (sections.length === 0) {
      if (showSuccess) {
        message.warning('No document sections to save.');
      }
      return null;
    }

    const projectNameForSave = resolveProjectName();
    if (!id || !userId) {
      if (showSuccess) {
        message.warning('Missing project details for document save.');
      }
      return null;
    }

    const { template, generatedSections } = buildMongoDocumentPayload(sections);
    if (Object.keys(generatedSections).length === 0) {
      if (showSuccess) {
        message.warning('No document sections with content to save.');
      }
      return null;
    }

    const versionCreatedAt = new Date().toISOString();
    const existingDoc = resolveSupabaseExistingDocument(
      mongoDocument || generatedDocumentFromNavigation,
      activeMeetingId,
    );
    const currentMeetingId = activeMeetingId ? String(activeMeetingId) : "";
    const sameMeetingDoc = Boolean(existingDoc?._id && currentMeetingId);

    try {
      let savedDocument = null;

      if (sameMeetingDoc) {
        const previousHistory =
          existingDoc.version_history || existingDoc.versionHistory || [];
        const newVersion = (existingDoc.version || 1) + 1;
        const updatedHistory = [
          ...previousHistory,
          { version: newVersion, createdAt: versionCreatedAt },
        ];

        const result = await dispatch(
          updateGeneratedDocument({
            documentId: existingDoc._id,
            updateData: {
              userId,
              meetingId: currentMeetingId,
              projectId: id,
              projectName: projectNameForSave,
              template,
              generatedSections,
              timestamp: versionCreatedAt,
              version: newVersion,
              versionCreatedAt,
              versionHistory: updatedHistory,
            },
          })
        ).unwrap();

        savedDocument = result?.document || result;
      } else {
        let projectDocs = [];
        try {
          const docsResult = await dispatch(getDocumentsByProject(id)).unwrap();
          projectDocs = filterSupabaseProjectDocuments(
            docsResult?.documents || [],
          );
        } catch {
          projectDocs = [];
        }

        const existingForMeeting = resolveSupabaseDocumentForMeeting(
          projectDocs,
          currentMeetingId,
        );

        if (existingForMeeting?._id) {
          const previousHistory =
            existingForMeeting.version_history || existingForMeeting.versionHistory || [];
          const newVersion = (existingForMeeting.version || 1) + 1;
          const updatedHistory = [
            ...previousHistory,
            { version: newVersion, createdAt: versionCreatedAt },
          ];

          const result = await dispatch(
            updateGeneratedDocument({
              documentId: existingForMeeting._id,
              updateData: {
                userId,
                meetingId: currentMeetingId,
                projectId: id,
                projectName: projectNameForSave,
                template,
                generatedSections,
                timestamp: versionCreatedAt,
                version: newVersion,
                versionCreatedAt,
                versionHistory: updatedHistory,
              },
            })
          ).unwrap();
          savedDocument = result?.document || result;
        } else {
          const continuation = store.getState().reports?.meetingContinuation;
          const continueFromPrevious =
            continuation?.mode === "continue" &&
            Boolean(continuation?.parentDocument) &&
            !isExternalDocumentRecord(continuation?.parentDocument);
          const nextVersion = computeNextDocumentVersion({
            documents: projectDocs,
            sourceDocument: continueFromPrevious ? continuation.parentDocument : null,
            continueFromPrevious,
          });

          const result = await dispatch(
            saveGeneratedDocument({
              userId,
              meetingId: currentMeetingId || undefined,
              projectId: id,
              projectName: projectNameForSave,
              meetingAgenda: agenda?.trim() || undefined,
              template,
              generatedSections,
              timestamp: versionCreatedAt,
              version: nextVersion,
              versionCreatedAt,
              versionHistory: [{ version: nextVersion, createdAt: versionCreatedAt }],
              basedOnMeetingId: continueFromPrevious
                ? continuation.parentMeetingId
                : undefined,
              basedOnDocumentId: continueFromPrevious
                ? resolveSupabaseContinuationDocumentId(
                    continuation.parentDocumentId ||
                      continuation.parentDocument?._id ||
                      continuation.parentDocument?.id,
                  )
                : undefined,
            })
          ).unwrap();

          savedDocument = result?.document || result;
        }
      }

      if (savedDocument) {
        setMongoDocument(savedDocument);
        applyRevisionHistoryFromDocument(savedDocument);
        if (showSuccess) {
          message.success('Document saved successfully.');
        }
      }

      return savedDocument;
    } catch (error) {
      console.error('Supabase document save failed:', error);
      if (showSuccess) {
        message.error(error?.message || 'Failed to save document.');
      }
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const name = data?.session?.user?.user_metadata?.full_name;
      if (name && String(name).trim()) {
        setLocalUserName(String(name).trim());
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!wantDocumentTemplate) {
      setTranscriptSyncComplete(true);
      return;
    }

    if (freshEndMeeting && !resolveMeaningfulMeetingContent()) {
      setTranscriptSyncComplete(true);
      return;
    }

    if (!freshEndMeeting) {
      setTranscriptSyncComplete(true);
      return;
    }

    if (!documentStorageConfigLoaded) {
      return;
    }

    // Transcript is embedded in Drive/Notion meeting payloads ? not Supabase.
    if (documentStorageBackend !== STORAGE_BACKEND.SUPABASE) {
      setTranscriptSyncComplete(true);
      return;
    }

    if (!activeMeetingId || !userId || !id) {
      setTranscriptSyncComplete(true);
      return;
    }
    if (transcriptSavedRef.current) return;

    const entries = buildTranscriptEntries({
      localTranscriptView: localtranscriptView,
      remoteTranscriptView: remotetranscriptView,
      agentTranscriptView,
      localUserName,
      localUserId: userId,
      isHost: Boolean(isAdmin),
      agentName: agentName || 'Agent',
    });

    if (entries.length === 0) {
      setTranscriptSyncComplete(true);
      return;
    }

    transcriptSavedRef.current = true;
    setMeetingSyncStage('transcript');

    dispatch(
      saveMeetingTranscript({
        userId,
        meetingId: activeMeetingId,
        projectId: id,
        projectName: resolveProjectName() || undefined,
        meetingAgenda: agenda?.trim() || undefined,
        entries,
        fullText: buildTranscriptFullText(entries),
      })
    )
      .unwrap()
      .catch((error) => {
        transcriptSavedRef.current = false;
        console.warn('Failed to save meeting transcript:', error);
      })
      .finally(() => {
        setTranscriptSyncComplete(true);
      });
  }, [
    wantDocumentTemplate,
    documentStorageConfigLoaded,
    documentStorageBackend,
    activeMeetingId,
    userId,
    id,
    localUserName,
    localtranscriptView,
    remotetranscriptView,
    agentTranscriptView,
    agentName,
    isAdmin,
    currentProject?.project_name,
    agenda,
    dispatch,
    freshEndMeeting,
  ]);

  useEffect(() => {
    if (!id || !userId || !wantDocumentTemplate) {
      setNotionConnected(false);
      setDriveConnected(false);
      setDocumentStorageBackend(STORAGE_BACKEND.SUPABASE);
      setDocumentStorageConfigLoaded(true);
      return;
    }

    const loadDocumentStorageConfig = async () => {
      try {
        const response = await fetch(
          `${socketURL}/mcp/configurations/${id}?user_id=${encodeURIComponent(userId)}`,
        );
        const data = await response.json();
        const notionConfig = data?.configurations?.notion;
        const driveConfig = data?.configurations?.google_drive;
        const documentStorage = data?.documentStorage;
        setNotionConnected(Boolean(notionConfig?.tokenConfigured));
        setDriveConnected(Boolean(driveConfig?.tokenConfigured && driveConfig?.enabled !== false));
        setDocumentStorageBackend(
          documentStorage?.backend || STORAGE_BACKEND.SUPABASE,
        );
      } catch (error) {
        setNotionConnected(false);
        setDriveConnected(false);
        setDocumentStorageBackend(STORAGE_BACKEND.SUPABASE);
      } finally {
        setDocumentStorageConfigLoaded(true);
      }
    };

    loadDocumentStorageConfig();
  }, [id, userId, wantDocumentTemplate]);


  // ? NEW: Load summary content when summaries are fetched
  useEffect(() => {
    const summaries = meetingSummaries?.summaries;

    if (!Array.isArray(summaries) || summaries.length === 0) return;

    // Take the first (most recent) summary
    const latestSummary = summaries[0];
    setSummaryContent(latestSummary?.summary_content || '');

  }, [meetingSummaries?.summaries]);

  // ? Load MVP+Vision content when mvpvisions are fetched (or use Redux mvp/vision as fallback from meeting)
  useEffect(() => {
    const mvpvisions = meetingMvpvisions;
    if (Array.isArray(mvpvisions) && mvpvisions.length > 0) {
      const latest = mvpvisions[0];
      setMvpContent(latest?.mvp || '');
      setVisionContent(latest?.vision || '');
    } else if (mvp || vision) {
      setMvpContent(mvp || '');
      setVisionContent(vision || '');
    }
  }, [meetingMvpvisions, mvp, vision]);

  const handleExportToNotion = async () => {
    if (documentStorageBackend === STORAGE_BACKEND.NOTION) {
      await saveDocumentToNotion({ showSuccess: true });
      return;
    }

    if (!notionConnected) {
      message.warning(
        "Notion is not connected for this project. Connect Notion in Project MCP Configuration.",
      );
      return;
    }

    if (documentSections.length === 0) {
      message.warning("No document found to export to Notion.");
      return;
    }

    const generatedSections = Object.fromEntries(
      documentSections.map((section) => [section.id, section.content || ''])
    );
    const template = {
      categories: documentSections.reduce((acc, section) => {
        if (!acc[section.category]) {
          acc[section.category] = {
            title: section.categoryTitle || section.category || 'General',
          };
        }
        return acc;
      }, {}),
      sections: documentSections.map((section) => ({
        id: section.id,
        title: section.title,
        category: section.category,
        icon: section.icon,
      })),
    };
    const doc = {
      ...(driveDocument?.document || {}),
      _id: driveDocument?.fileId || getDriveDocumentTitle(id),
      project_id: id,
      project_name: currentProject?.project_name,
      generated_sections: generatedSections,
      template,
    };

    setExportingToNotion(true);
    try {
      const result = await dispatch(
        exportDocumentToNotion({
          projectId: id,
          projectName: currentProject?.project_name,
          document: {
            ...doc,
            user_id: userId,
            project_id: id,
            project_name: currentProject?.project_name,
            generated_sections: generatedSections,
            template,
          },
        }),
      ).unwrap();

      message.success(
        result?.notionPageId
          ? "Document saved to your connected Notion database."
          : "Document exported to Notion successfully.",
      );
    } catch (error) {
      message.error(error?.error || error?.message || "Failed to export document to Notion.");
    } finally {
      setExportingToNotion(false);
    }
  };

  const buildMeetingDocumentPlainText = () => {
    const tocItems = generateTableOfContents();
    const lines = [
      documentTitle,
      '='.repeat(documentTitle.length || 24),
      '',
      `Vision Document for ${agenda}`,
      companyName,
      '',
      'Revision History',
      '----------------',
      ...(revisionHistory.length
        ? revisionHistory.map((row) => `${row.date || ''} - ${row.revision || ''}`)
        : ['No revision history available.']),
      '',
      'Table of Contents',
      '-----------------',
      ...tocItems.map((item) =>
        item.isCategory
          ? `${item.number}. ${item.title}`
          : `  ${item.number} ${item.title}`,
      ),
      '',
    ];

    const tocForContent = generateTableOfContents();
    let lastCategory = null;
    documentSections.forEach((section) => {
      if (section.category !== lastCategory) {
        const categoryToc = tocForContent.find((t) => t.isCategory && t.sectionId === section.id);
        if (categoryToc) {
          lines.push('');
          lines.push(`${categoryToc.number}. ${categoryToc.title}`);
          lines.push('-'.repeat(`${categoryToc.number}. ${categoryToc.title}`.length));
        }
        lastCategory = section.category;
      }

      const tocItem = tocForContent.find((t) => t.sectionId === section.id && !t.isCategory);
      const sectionTitle = `${tocItem?.number || ''} ${section.title || 'Section'}`.trim();
      lines.push('');
      lines.push(sectionTitle);
      lines.push('-'.repeat(sectionTitle.length));
      lines.push(removeMarkdownFormatting(section.content || ''));
      lines.push('');
    });

    return lines.join('\n').trim();
  };

  const buildTranscriptPayloadForDocument = () => {
    const entries = buildTranscriptEntries({
      localTranscriptView: localtranscriptView,
      remoteTranscriptView: remotetranscriptView,
      agentTranscriptView,
      localUserName,
      localUserId: userId,
      isHost: Boolean(isAdmin),
      agentName: agentName || 'Agent',
    });

    return {
      transcriptEntries: entries,
      transcriptFullText: buildTranscriptFullText(entries),
    };
  };

  const buildMeetingDocumentPayload = (sections = documentSections) => {
    const normalizedSections = sections.map((section, index) => ({
      id: section.id || `section_${index + 1}`,
      title: section.title || `Section ${index + 1}`,
      category: section.category || 'general',
      categoryTitle: section.categoryTitle || section.category || 'General',
      content: section.content || '',
    }));

    const now = new Date().toISOString();
    const transcriptPayload = buildTranscriptPayloadForDocument();
    const meetingDocumentTitle = activeMeetingId
      ? getDriveMeetingDocumentTitle(activeMeetingId)
      : getDriveDocumentTitle(id);

    return {
      schemaVersion: 1,
      documentId: meetingDocumentTitle,
      type: 'meeting_document',
      title: documentTitle || meetingDocumentTitle,
      projectId: id,
      projectName:
        currentProject?.project_name ||
        driveDocumentFromNavigation?.document?.projectName ||
        driveDocumentFromNavigation?.projectName ||
        '',
      meetingId: activeMeetingId ? String(activeMeetingId) : undefined,
      meetingAgenda: agenda?.trim() || '',
      agenda: agenda || '',
      companyName,
      updatedAt: now,
      sectionsJson: JSON.stringify(normalizedSections),
      revisionHistoryJson: JSON.stringify(revisionHistory || []),
      summaryContent: summaryContent || '',
      mvpContent: mvpContent || '',
      visionContent: visionContent || '',
      ...transcriptPayload,
    };
  };

  const buildMeetingDocumentPdf = () => {
    if (documentSections.length === 0) {
      throw new Error('No document sections available');
    }

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
        currentPage += 1;
        yPosition = 30;
        return true;
      }
      return false;
    };

    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(documentTitle, pageWidth / 2, 60, { align: 'center' });

    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(`Vision Document for ${agenda}`, pageWidth / 2, 75, { align: 'center' });
    doc.text(companyName, pageWidth / 2, 88, { align: 'center' });

    yPosition = 120;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Revision History', margin, yPosition);
    yPosition += 15;

    doc.setFillColor(211, 211, 211);
    doc.rect(margin, yPosition, maxWidth / 2, 10, 'F');
    doc.rect(margin + maxWidth / 2, yPosition, maxWidth / 2, 10, 'F');

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Date', margin + (maxWidth / 4), yPosition + 7, { align: 'center' });
    doc.text('Revision', margin + (maxWidth * 3 / 4), yPosition + 7, { align: 'center' });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(margin, yPosition, maxWidth, 10);
    doc.line(margin + maxWidth / 2, yPosition, margin + maxWidth / 2, yPosition + 10);
    yPosition += 10;

    doc.setFont('helvetica', 'normal');
    revisionHistory.forEach((row) => {
      doc.text(row.date || '', margin + (maxWidth / 4), yPosition + 7, { align: 'center' });
      doc.text(row.revision || '', margin + (maxWidth * 3 / 4), yPosition + 7, { align: 'center' });
      doc.rect(margin, yPosition, maxWidth, 10);
      doc.line(margin + maxWidth / 2, yPosition, margin + maxWidth / 2, yPosition + 10);
      yPosition += 10;
    });

    doc.rect(margin, yPosition, maxWidth, 10);
    doc.line(margin + maxWidth / 2, yPosition, margin + maxWidth / 2, yPosition + 10);
    addPageNumber(currentPage);

    doc.addPage();
    currentPage += 1;
    yPosition = 15;

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Table of Contents', margin, yPosition + 15);
    yPosition += 15;

    const tocItems = generateTableOfContents();
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
          while (x < dotsEnd) {
            doc.text('.', x, yPosition + 5);
            x += 3;
          }
        }
      }
      yPosition += 10;
    });

    addPageNumber(currentPage);
    doc.addPage();
    currentPage += 1;
    yPosition = 30;

    const tocForContent = generateTableOfContents();
    let lastCategory = null;

    documentSections.forEach((section, index) => {
      const tocItem = tocForContent.find((t) => t.sectionId === section.id && !t.isCategory);
      const sectionNumber = tocItem ? tocItem.number : `${index + 1}`;

      if (section.category !== lastCategory) {
        const categoryToc = tocForContent.find((t) => t.isCategory && t.sectionId === section.id);
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
      const titleText = `${sectionNumber} ${section.title}`;
      const titleLines = doc.splitTextToSize(titleText, maxWidth);
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
    return doc;
  };

  const saveDocumentToDrive = async ({
    sections = documentSections,
    showSuccess = true,
  } = {}) => {
    if (sections.length === 0) {
      if (showSuccess) {
        message.warning('No document sections to save to Google Drive.');
      }
      return null;
    }

    const baseTitle = activeMeetingId
      ? getDriveMeetingDocumentTitle(activeMeetingId)
      : getDriveDocumentTitle(id);
    const projectNameForDrive =
      currentProject?.project_name ||
      driveDocumentFromNavigation?.document?.projectName ||
      driveDocumentFromNavigation?.projectName;

    setExportingToDrive(true);
    try {
      const payload = {
        task: 'drive_save_document',
        project_id: id,
        project_name: projectNameForDrive,
        user_id: userId,
        title: baseTitle,
        document: buildMeetingDocumentPayload(sections),
      };

      const response = await fetch(`${socketURL}/sendmcpmessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(
          result.error || result.details || 'Failed to save document to Google Drive.',
        );
      }

      if (showSuccess) {
        message.success(
          result.response || 'Document saved to Google Drive.',
        );
      }

      const savedDocument = normalizeDriveStoredDocument(result.document, {
        projectId: id,
        projectName: projectNameForDrive,
      });

      if (savedDocument) {
        setCachedDriveDocument({
          projectId: id,
          projectName: projectNameForDrive,
          document: savedDocument,
        });
        setDriveDocument(savedDocument);
        return savedDocument;
      }

      clearCachedDriveDocument({ projectId: id, projectName: projectNameForDrive });
      const retrievedDocument = await retrieveDriveDocumentFromMcp({
        projectId: id,
        projectName: projectNameForDrive,
        userId,
        meetingId: activeMeetingId ? String(activeMeetingId) : undefined,
        forceRefresh: true,
      });

      if (retrievedDocument) {
        setDriveDocument(retrievedDocument);
      }
      return retrievedDocument;
    } catch (error) {
      console.error('Google Drive document save failed:', error);
      if (showSuccess) {
        message.error(error.message || 'Failed to save document to Google Drive.');
      }
      return null;
    } finally {
      setExportingToDrive(false);
    }
  };

  const saveDocumentToNotion = async ({
    sections = documentSections,
    showSuccess = true,
  } = {}) => {
    if (sections.length === 0) {
      if (showSuccess) {
        message.warning('No document sections to save to Notion.');
      }
      return null;
    }

    const projectNameForNotion =
      currentProject?.project_name ||
      notionDocumentFromNavigation?.document?.projectName ||
      notionDocumentFromNavigation?.projectName;

    if (!id || !userId || !projectNameForNotion) {
      if (showSuccess) {
        message.warning('Missing project details for Notion save.');
      }
      return null;
    }

    setExportingToNotion(true);
    try {
      const retrievedDocument = await saveMeetingDocumentToNotion({
        projectId: id,
        projectName: projectNameForNotion,
        userId,
        documentPayload: buildMeetingDocumentPayload(sections),
      });

      if (showSuccess) {
        message.success('Document saved to Notion.');
      }

      if (retrievedDocument) {
        setNotionDocument(retrievedDocument);
      }
      return retrievedDocument;
    } catch (error) {
      console.error('Notion document save failed:', error);
      if (showSuccess) {
        message.error(error.message || 'Failed to save document to Notion.');
      }
      return null;
    } finally {
      setExportingToNotion(false);
    }
  };

  const handleSaveToDriveViaAgent = async () => {
    await saveDocumentToDrive({ showSuccess: true });
  };

  useEffect(() => {
    if (!wantDocumentTemplate) return;

    const projectNameForStorage =
      resolveProjectName();

    let cancelled = false;

    const applyDriveDocumentToView = (document) => {
      if (!document || cancelled) return false;

      setDriveDocument(document);
      const storedDocument = document?.document || document;
      applyRevisionHistoryFromDocument(storedDocument);
      const driveSections = buildDocumentSectionsFromDriveDocument(document);
      if (driveSections.length > 0) {
        skipSectionsSyncRef.current = true;
        setDocumentSections(driveSections);
        setActiveAccordionKeys(driveSections.map((section) => section.id));
        setHasUnsavedChanges(false);
        return true;
      }
      return false;
    };

    const applyNotionDocumentToView = (document) => {
      if (!document || cancelled) return false;

      setNotionDocument(document);
      const storedDocument = document?.document || document;
      applyRevisionHistoryFromDocument(storedDocument);
      const notionSections = buildDocumentSectionsFromDriveDocument(document);
      if (notionSections.length > 0) {
        skipSectionsSyncRef.current = true;
        setDocumentSections(notionSections);
        setActiveAccordionKeys(notionSections.map((section) => section.id));
        setHasUnsavedChanges(false);
        return true;
      }
      return false;
    };

    const syncEndMeetingDocument = async () => {
      setMeetingSyncStage('document');
      try {
        if (
          !freshEndMeeting &&
          storageBackendFromNavigation === STORAGE_BACKEND.GOOGLE_DRIVE &&
          driveDocumentFromNavigation
        ) {
          setMeetingSyncStage('finalize');
          applyDriveDocumentToView(driveDocumentFromNavigation);
          return;
        }

        if (
          !freshEndMeeting &&
          storageBackendFromNavigation === STORAGE_BACKEND.NOTION &&
          notionDocumentFromNavigation
        ) {
          setMeetingSyncStage('finalize');
          applyNotionDocumentToView(notionDocumentFromNavigation);
          return;
        }

        if (
          !freshEndMeeting &&
          (storageBackendFromNavigation === STORAGE_BACKEND.SUPABASE ||
            storageBackendFromNavigation === STORAGE_BACKEND.MONGODB) &&
          generatedDocumentFromNavigation
        ) {
          const navDoc = resolveSupabaseExistingDocument(
            generatedDocumentFromNavigation,
            activeMeetingId,
          );
          if (navDoc) {
            setMeetingSyncStage('finalize');
            applyMongoDocumentToView(navDoc);
            return;
          }
        }

        if (!documentStorageConfigLoaded) {
          return;
        }

        if (freshEndMeeting && !resolveMeaningfulMeetingContent()) {
          redirectEmptyFreshMeetingHome();
          return;
        }

        const meetingSections = buildMeetingSectionsWithUserContent({
          generatedSections: reduxGeneratedDocumentSections,
          template: activeMeetingTemplate,
        });
        const hasCurrentMeetingContent = meetingSections.length > 0;
        const shouldPersistEndMeetingDocument =
          freshEndMeeting && hasCurrentMeetingContent;

        if (documentStorageBackend === STORAGE_BACKEND.NOTION) {
          if (!id || !userId || !projectNameForStorage) return;

          if (shouldPersistEndMeetingDocument && !endMeetingNotionSyncedRef.current) {
            endMeetingNotionSyncedRef.current = true;
            await saveDocumentToNotion({
              sections: meetingSections,
              showSuccess: false,
            });
          }

          if (!hasCurrentMeetingContent && freshEndMeeting) {
            redirectEmptyFreshMeetingHome();
            return;
          }

          setMeetingSyncStage('finalize');
          const document = await retrieveNotionDocumentFromApi({
            projectId: id,
            projectName: projectNameForStorage,
            userId,
            meetingId: activeMeetingId ? String(activeMeetingId) : undefined,
            forceRefresh: true,
          });

          if (document && applyNotionDocumentToView(document)) {
            return;
          }

          if (hasCurrentMeetingContent) {
            skipSectionsSyncRef.current = true;
            setDocumentSections(meetingSections);
            setActiveAccordionKeys(meetingSections.map((section) => section.id));
            setHasUnsavedChanges(false);
            setRevisionHistory(buildDefaultRevisionHistoryRows(1));
          }
          return;
        }

        if (documentStorageBackend === STORAGE_BACKEND.GOOGLE_DRIVE) {
          if (!id || !userId || !projectNameForStorage) return;

          if (shouldPersistEndMeetingDocument && !endMeetingDriveSyncedRef.current) {
            endMeetingDriveSyncedRef.current = true;
            await saveDocumentToDrive({
              sections: meetingSections,
              showSuccess: false,
            });
          }

          if (!hasCurrentMeetingContent && freshEndMeeting) {
            redirectEmptyFreshMeetingHome();
            return;
          }

          setMeetingSyncStage('finalize');
          let document = null;
          if (activeMeetingId) {
            document = await retrieveDriveDocumentFromMcp({
              projectId: id,
              projectName: projectNameForStorage,
              userId,
              meetingId: String(activeMeetingId),
              forceRefresh: true,
            });
          }

          if (!document) {
            document = await retrieveDriveDocumentFromMcp({
              projectId: id,
              projectName: projectNameForStorage,
              userId,
              forceRefresh: true,
            });
          }

          if (document && applyDriveDocumentToView(document)) {
            return;
          }

          if (hasCurrentMeetingContent) {
            skipSectionsSyncRef.current = true;
            setDocumentSections(meetingSections);
            setActiveAccordionKeys(meetingSections.map((section) => section.id));
            setHasUnsavedChanges(false);
            setRevisionHistory(buildDefaultRevisionHistoryRows(1));
          }
          return;
        }

        if (shouldPersistEndMeetingDocument) {
          const savedDocument = await saveDocumentToMongo({
            sections: meetingSections,
            showSuccess: false,
          });
          setMeetingSyncStage('finalize');
          if (savedDocument) {
            applyMongoDocumentToView(savedDocument);
            return;
          }
        }

        if (freshEndMeeting && !hasCurrentMeetingContent) {
          redirectEmptyFreshMeetingHome();
          return;
        }

        const result = await dispatch(getDocumentsByProject(id)).unwrap();
        const docs = filterSupabaseProjectDocuments(result?.documents || []);
        const meetingDoc = activeMeetingId
          ? resolveSupabaseDocumentForMeeting(docs, activeMeetingId)
          : docs[0];

        if (meetingDoc) {
          setMeetingSyncStage('finalize');
          applyMongoDocumentToView(meetingDoc);
          return;
        }

        if (
          !cancelled &&
          hasCurrentMeetingContent
        ) {
          skipSectionsSyncRef.current = true;
          setDocumentSections(meetingSections);
          setActiveAccordionKeys(meetingSections.map((section) => section.id));
          setHasUnsavedChanges(false);
          setRevisionHistory(buildDefaultRevisionHistoryRows(1));
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to sync end-meeting document:', error);
          setDriveDocument(null);
          setNotionDocument(null);
          setMongoDocument(null);
        }
      } finally {
        if (
          !cancelled &&
          (driveDocumentFromNavigation ||
            notionDocumentFromNavigation ||
            generatedDocumentFromNavigation ||
            documentStorageConfigLoaded)
        ) {
          setDocumentSyncComplete(true);
        }
      }
    };

    syncEndMeetingDocument();
    return () => {
      cancelled = true;
    };
  }, [
    wantDocumentTemplate,
    documentStorageConfigLoaded,
    documentStorageBackend,
    id,
    userId,
    currentProject?.project_name,
    driveDocumentFromNavigation,
    notionDocumentFromNavigation,
    generatedDocumentFromNavigation,
    storageBackendFromNavigation,
    freshEndMeeting,
    activeMeetingId,
    defaultTemplate,
    receivedDocumentTemplate,
    reduxGeneratedDocumentSections,
  ]);

  // Handle accordion change
  const handleAccordionChange = (keys) => {
    setActiveAccordionKeys(keys);
  };

  useEffect(() => {


    if (id) {
      if (wantDocumentTemplate) {
        // Document content is now loaded/saved through Google Drive.
      } else if (mvpVisionTemplate) {
        dispatch(getMvpVisionByProject(id));
      } else {
        dispatch(getSummariesByProject(id));
      }
    }
  }, [id, wantDocumentTemplate, mvpVisionTemplate]);


  useEffect(() => {
    const storedDocument =
      driveDocument?.document ||
      driveDocument ||
      notionDocument?.document ||
      notionDocument ||
      mongoDocument;
    if (!storedDocument) return;
    applyRevisionHistoryFromDocument(storedDocument);
  }, [driveDocument, notionDocument, mongoDocument]);

  const teams = [
    {
      id: 'C',
      name: 'Team GPT',
      data: teamC,
      color: '#1890ff',
      bgColor: '#f0f8ff'
    },
    {
      id: 'B',
      name: 'Team Mistrial',
      data: teamB,
      color: '#52c41a',
      bgColor: '#f6ffed'
    },
    {
      id: 'A',
      name: 'Team Llama',
      data: teamA,
      color: '#fa8c16',
      bgColor: '#fff7e6'
    }

  ];



  function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }


  // Updated processRemoteTranscript function
  const processRemoteTranscript = (remoteTranscript) => {
    if (!remoteTranscript || typeof remoteTranscript !== 'object') {
      return [];
    }

    const remoteTranscripts = [];

    Object.keys(remoteTranscript).forEach(userName => {
      const userMessages = remoteTranscript[userName];

      if (Array.isArray(userMessages)) {
        userMessages.forEach(message => {
          remoteTranscripts.push({
            text: message.text,
            timestamp: message.timestamp,
            source: 'Remote',
            speaker: userName
          });
        });
      }
    });

    return remoteTranscripts;
  };



  console.log("remote transcript", remotetranscriptView, localtranscriptView);


  // Updated allTranscripts array with sorting ? uses real speaker names when available
  const normalizedTranscriptEntries = buildTranscriptEntries({
    localTranscriptView: localtranscriptView,
    remoteTranscriptView: remotetranscriptView,
    agentTranscriptView,
    localUserName,
    localUserId: userId,
    isHost: Boolean(isAdmin),
    agentName: agentName || 'Agent',
  });

  const allTranscripts = normalizedTranscriptEntries.map((entry) => ({
    text: entry.text,
    timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
    source: entry.speaker_role === 'agent' ? 'Agent' : entry.speaker_role === 'host' ? 'You' : 'Remote',
    speaker: entry.speaker_name,
    speakerRole: entry.speaker_role,
  }));

  console.log("allTranscripts:", allTranscripts);


  const handleEdit = (teamId, field) => {
    const team = teams.find(t => t.id === teamId);
    setEditingTeam(teamId);
    setEditingField(field);
    setTempValues({ [field]: team.data[field] || '' });
  };

  const handleSave = (teamId, field) => {

    console.log('Saving', teamId, field, tempValues[field]);

    const value = tempValues[field];

    // Update team data in Redux
    const updateAction = {
      type: `reports/updateTeam${teamId}`,
      payload: { [field]: tempValues[field] }
    };
    dispatch(updateAction);

    // Check teamId and field to dispatch specific actions
    if (teamId === "C" && field === "vision") {
      dispatch(setTeamCvision(value));
    } else if (teamId === "C" && field === "mvp") {
      dispatch(setTeamCmvp(value));
    } else if (teamId === "A" && field === "vision") {
      dispatch(setTeamAvision(value));
    } else if (teamId === "A" && field === "mvp") {
      dispatch(setTeamAmvp(value));
    } else if (teamId === "B" && field === "vision") {
      dispatch(setTeamBvision(value));
    } else if (teamId === "B" && field === "mvp") {
      dispatch(setTeamBmvp(value));
    }

    setEditingTeam(null);
    setEditingField(null);
    setTempValues({});
    message.success(`Team ${teamId} ${field} updated successfully`);
  };

  const handleApprove = (team) => {
    if (!team.data.vision || !team.data.mvp) {
      message.error('Please ensure both Vision and MVP are filled before approving');
      return;
    }

    // Set the approved team's data to main state
    dispatch({ type: 'MainStates_Slice/setVision', payload: team.data.vision });
    dispatch({ type: 'MainStates_Slice/setMVP', payload: team.data.mvp });

    setSelectedTeam(team.name);  // <-- save which team is selected

    message.success(`${team.name} approved successfully!`);
  };



  const renderEditableField = (team, field, label, icon) => {
    const isEditing = editingTeam === team.id && editingField === field;
    const value = team.data[field] || '';

    return (
      <div style={{ marginBottom: '12px' }}>
        {/* Label Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '6px',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          {icon}
          <span style={{ marginLeft: '4px' }}>{label}</span>
          {!isEditing && (
            <EditOutlined
              style={{
                marginLeft: 'auto',
                cursor: 'pointer',
                color: '#666',
                fontSize: '16px',
              }}
              onClick={() => handleEdit(team.id, field)}
            />
          )}
        </div>

        {/* Editable Mode */}
        {isEditing ? (
          <div>
            <TextArea
              value={tempValues[field]}
              onChange={(e) =>
                setTempValues({ ...tempValues, [field]: e.target.value })
              }
              autoSize={false} // disable autosize
              rows={5} // ~5 lines
              style={{
                fontSize: '14px',
                marginBottom: '6px',
                height: '16.5em', // force ~5 lines height
                lineHeight: '1.5em',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                textAlign: "left"
              }}
            />
            <Space size="small">
              <Button
                size="small"
                type="primary"
                onClick={() => handleSave(team.id, field)}
              >
                Save
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setEditingTeam(null);
                  setEditingField(null);
                  setTempValues({});
                }}
              >
                Cancel
              </Button>
            </Space>
          </div>
        ) : (
          // Read-only Mode
          <div
            style={{
              minHeight: '15.5em', // ~5 lines
              maxHeight: '15.5em',
              padding: '8px',
              backgroundColor: '#fafafa',
              borderRadius: '6px',
              border: '1px dashed #d9d9d9',
              fontSize: '14px',
              lineHeight: '1.5em',
              overflowY: 'auto', // enable vertical scrolling
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              textAlign: 'match-parent'
            }}
          >
            {value || (
              <Text type="secondary" style={{ fontSize: '12px' }}>
                Click edit to add {label.toLowerCase()}
              </Text>
            )}
          </div>
        )}
      </div>
    );
  };


  // Download document as PDF
  const downloadAsPDF = () => {
    if (documentSections.length === 0) {
      message.warning('No document sections to download');
      return;
    }

    try {
      buildMeetingDocumentPdf().save('document.pdf');
      message.success('PDF downloaded successfully');
    } catch (error) {
      console.error('Error generating PDF:', error);
      message.error('Failed to generate PDF');
    }
  };

  // Download document as Word
  const downloadAsWord = async () => {
    if (documentSections.length === 0) {
      message.warning('No document sections to download');
      return;
    }

    try {
      const children = [];

      // ============ TITLE PAGE ============
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({
              text: documentTitle,
              bold: true,
              size: 48,
              color: '000000'
            })
          ],
          alignment: 'center',
          spacing: { before: 2000, after: 600 }
        })
      );

      children.push(
        new DocxParagraph({
          children: [
            new TextRun({ text: `Vision Document for ${agenda}`, bold: true, size: 44, color: '555555' })
          ],
          alignment: 'center',
          spacing: { after: 100 }
        })
      );
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({ text: companyName, bold: true, size: 44, color: '555555' })
          ],
          alignment: 'center',
          spacing: { after: 600 }
        })
      );

      // children.push(
      //   new DocxParagraph({
      //     children: [
      //       new TextRun({
      //         text: `Vision Document for ${agenda}`,
      //         italic: true,
      //         size: 38,
      //         color: '333333'
      //       })
      //     ],
      //     alignment: 'center',
      //     spacing: { after: 800 }
      //   })
      // );



      // ============ REVISION HISTORY ============
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({
              text: 'Revision History',
              bold: true,
              size: 32,
              color: '000000'
            })
          ],
          spacing: { before: 400, after: 300 }
        })
      );



      children.push(
        new Table({
          // spacing: { after: 1000 },
          width: {
            size: 100,
            type: WidthType.PERCENTAGE
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [
                    new DocxParagraph({
                      children: [
                        new TextRun({
                          text: 'Date',
                          bold: true,
                          size: 22
                        })
                      ],
                      alignment: 'center'
                    })
                  ],
                  shading: { fill: 'D3D3D3' }
                }),
                new TableCell({
                  children: [
                    new DocxParagraph({
                      children: [
                        new TextRun({
                          text: 'Revision',
                          bold: true,
                          size: 22
                        })
                      ],
                      alignment: 'center'
                    })
                  ],
                  shading: { fill: 'D3D3D3' }
                })
              ]
            }),
            // new TableRow({
            //   children: [
            //     new TableCell({
            //       children: [
            //         new DocxParagraph({
            //           children: [
            //             new TextRun({
            //               text: new Date().toLocaleDateString(),
            //               size: 22
            //             })
            //           ],
            //           alignment: 'center'
            //         })
            //       ]
            //     }),
            //   ]
            // })
            ...revisionHistory.map(row =>
              new TableRow({
                children: [
                  new TableCell({
                    children: [new DocxParagraph({ children: [new TextRun({ text: row.date || '', size: 22 })], alignment: 'center' })]
                  }),
                  new TableCell({
                    children: [new DocxParagraph({ children: [new TextRun({ text: row.revision || '', size: 22 })], alignment: 'center' })]
                  })
                ]
              })
            )
          ]
        })
      );


      // Page break after revision history
      children.push(
        new DocxParagraph({
          children: [],
          pageBreakBefore: true
        })
      );

      // ============ TABLE OF CONTENTS ============
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({
              text: 'Table of Contents',
              bold: true,
              size: 36,
              color: '333333'
            })
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 400 },
          border: {
            bottom: {
              color: '333333',
              space: 1,
              size: 12,
              style: 'single'
            }
          }
        })
      );

      // Generate TOC entries
      const tocItems = generateTableOfContents();
      tocItems.forEach((item) => {
        if (item.isCategory) {
          // Category heading in TOC
          children.push(
            new DocxParagraph({
              children: [
                new TextRun({
                  text: `${item.number}   ${item.title}`,
                  bold: true,
                  size: 24
                })
              ],
              spacing: { before: 200, after: 100 }
            })
          );
        } else {
          // Section item in TOC
          children.push(
            new DocxParagraph({
              children: [
                new TextRun({
                  text: `     ${item.number}   ${item.title}`,
                  size: 22,
                  color: '555555'
                }),
                new TextRun({
                  text: ' .......................................................',
                  size: 22,
                  color: 'cccccc'
                })
              ],
              spacing: { after: 60 }
            })
          );
        }
      });

      // Page break after TOC
      children.push(
        new DocxParagraph({
          children: [],
          pageBreakBefore: true
        })
      );

      // ============ DOCUMENT CONTENT ============
      let lastCategory = null;
      const tocForContent = generateTableOfContents();

      documentSections.forEach((section, index) => {
        const tocItem = tocForContent.find(t => t.sectionId === section.id && !t.isCategory);
        const sectionNumber = tocItem ? tocItem.number : `${index + 1}`;

        // Check if we need category header
        if (section.category !== lastCategory) {
          const categoryToc = tocForContent.find(t => t.isCategory && t.sectionId === section.id);
          if (categoryToc) {
            // Category header
            children.push(
              new DocxParagraph({
                children: [
                  new TextRun({
                    text: `${categoryToc.number}. ${categoryToc.title}`,
                    bold: true,
                    size: 32,
                    color: '1890ff'
                  })
                ],
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 400, after: 200 },
                border: {
                  bottom: {
                    color: '1890ff',
                    space: 1,
                    size: 6,
                    style: 'single'
                  }
                }
              })
            );
          }
          lastCategory = section.category;
        }

        // Section title
        children.push(
          new DocxParagraph({
            children: [
              new TextRun({
                text: `${sectionNumber} ${section.title}`,
                bold: true,
                size: 26
              })
            ],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 150 }
          })
        );

        // Section content
        if (section.content) {
          const cleanContent = removeMarkdownFormatting(section.content);
          const paragraphs = cleanContent.split('\n').filter(p => p.trim());
          paragraphs.forEach((para) => {
            children.push(
              new DocxParagraph({
                children: [
                  new TextRun({
                    text: para,
                    size: 22
                  })
                ],
                spacing: { after: 120 }
              })
            );
          });
        }

        // Add spacing after each section
        children.push(
          new DocxParagraph({
            children: [],
            spacing: { after: 200 }
          })
        );
      });

      const doc = new Document({
        sections: [{
          properties: {},
          children: children
        }]
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, 'document.docx');
      message.success('Word document downloaded successfully');
    } catch (error) {
      console.error('Error generating Word document:', error);
      message.error('Failed to generate Word document');
    }
  };

  // Handle download based on current view mode
  const handleDownload = () => {
    if (documentViewMode === 'pdf') {
      downloadAsPDF();
    } else {
      downloadAsWord();
    }
  };

  const downloadTranscriptAsPDF = () => {
    if (!allTranscripts.length) {
      message.warning('No transcript to download');
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    let yPosition = margin;

    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Meeting Transcript', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;

    if (currentProject?.project_name) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text(`Project: ${currentProject.project_name}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 8;
    }

    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;

    doc.setLineWidth(0.5);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;

    // Entries
    allTranscripts.forEach((item) => {
      const speaker = item.speaker || item.source;
      const time = new Date(item.timestamp).toLocaleTimeString();
      const text = item.message || item.text || '';

      // Speaker + time header
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(
        item.source === 'You' ? 24 : item.source === 'Remote' ? 0 : 128,
        item.source === 'You' ? 144 : item.source === 'Remote' ? 128 : 0,
        item.source === 'You' ? 255 : item.source === 'Remote' ? 0 : 128
      );

      if (yPosition > pageHeight - margin) { doc.addPage(); yPosition = margin; }
      doc.text(`${speaker}  ?  ${time}`, margin, yPosition);
      yPosition += 6;

      // Message text
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach((line) => {
        if (yPosition > pageHeight - margin) { doc.addPage(); yPosition = margin; }
        doc.text(line, margin, yPosition);
        yPosition += 5;
      });

      yPosition += 5; // gap between entries
    });

    const fileName = `Transcript_${currentProject?.project_name || 'Meeting'}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
    message.success('Transcript PDF downloaded');
  };

  const downloadTranscriptAsWord = async () => {
    if (!allTranscripts.length) {
      message.warning('No transcript to download');
      return;
    }

    try {
      const children = [
        new DocxParagraph({
          text: 'Meeting Transcript',
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 },
        }),
        ...(currentProject?.project_name ? [
          new DocxParagraph({
            text: `Project: ${currentProject.project_name}`,
            spacing: { after: 100 },
          })
        ] : []),
        new DocxParagraph({
          text: `Generated: ${new Date().toLocaleDateString()}`,
          spacing: { after: 400 },
        }),
      ];

      allTranscripts.forEach((item) => {
        const speaker = item.speaker || item.source;
        const time = new Date(item.timestamp).toLocaleTimeString();
        const text = item.message || item.text || '';

        // Speaker header
        children.push(
          new DocxParagraph({
            children: [
              new TextRun({ text: `${speaker}  ?  ${time}`, bold: true, size: 20, color: '1890ff' })
            ],
            spacing: { before: 200, after: 60 },
          })
        );

        // Message
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text, size: 20 })],
            spacing: { after: 100 },
          })
        );
      });

      const doc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(doc);
      const fileName = `Transcript_${currentProject?.project_name || 'Meeting'}_${new Date().toISOString().split('T')[0]}.docx`;
      saveAs(blob, fileName);
      message.success('Transcript Word document downloaded');
    } catch (error) {
      console.error('Error generating transcript Word doc:', error);
      message.error('Failed to generate Word document');
    }
  };

  const persistDocumentSections = async (sections, successMessage) => {
    setIsSaving(true);
    try {
      if (documentStorageBackend === STORAGE_BACKEND.GOOGLE_DRIVE) {
        const savedDocument = await saveDocumentToDrive({
          sections,
          showSuccess: false,
        });
        if (savedDocument) {
          const driveSections = buildDocumentSectionsFromDriveDocument(savedDocument);
          skipSectionsSyncRef.current = true;
          setDocumentSections(driveSections.length > 0 ? driveSections : sections);
          applyRevisionHistoryFromDocument(savedDocument?.document || savedDocument);
          setHasUnsavedChanges(false);
          message.success(successMessage);
          return true;
        }
        return false;
      }

      if (documentStorageBackend === STORAGE_BACKEND.NOTION) {
        const savedDocument = await saveDocumentToNotion({
          sections,
          showSuccess: false,
        });
        if (savedDocument) {
          const notionSections = buildDocumentSectionsFromDriveDocument(savedDocument);
          skipSectionsSyncRef.current = true;
          setDocumentSections(notionSections.length > 0 ? notionSections : sections);
          applyRevisionHistoryFromDocument(savedDocument?.document || savedDocument);
          setHasUnsavedChanges(false);
          message.success(successMessage);
          return true;
        }
        return false;
      }

      const savedDocument = await saveDocumentToMongo({
        sections,
        showSuccess: false,
      });
      if (savedDocument) {
        applyMongoDocumentToView(savedDocument);
        message.success(successMessage);
        return true;
      }
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddSection = (category, categoryTitle) => {
    const newSection = {
      id: `section_${Date.now()}`,
      title: 'New Section',
      category,
      categoryTitle,
      content: '',
    };

    setDocumentSections((prev) => {
      const lastIndexInCategory = prev.reduce(
        (last, section, index) =>
          section.category === category ? index : last,
        -1
      );
      const insertIndex =
        lastIndexInCategory === -1 ? prev.length : lastIndexInCategory + 1;
      const updated = [...prev];
      updated.splice(insertIndex, 0, newSection);
      return updated;
    });
    setActiveAccordionKeys((prev) => [...prev, newSection.id]);
    setEditingSectionId(newSection.id);
    setEditedContent('');
    setHasUnsavedChanges(true);
  };

  const handleDeleteSection = (sectionId) => {
    Modal.confirm({
      title: 'Delete section',
      content: 'Are you sure you want to delete this section?',
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        const updatedSections = documentSections.filter(
          (section) => section.id !== sectionId
        );

        const saved = await persistDocumentSections(
          updatedSections,
          'Section deleted successfully'
        );

        if (!saved) {
          throw new Error('Failed to delete section');
        }

        if (editingSectionId === sectionId) {
          setEditingSectionId(null);
          setEditedContent('');
        }
        if (editingTitleId === sectionId) {
          setEditingTitleId(null);
          setEditedSectionTitle('');
        }
        setActiveAccordionKeys((prev) =>
          prev.filter((key) => key !== sectionId)
        );
      },
    });
  };

  const handleStartEditingTitle = (sectionId, title) => {
    setEditingTitleId(sectionId);
    setEditedSectionTitle(title || '');
  };

  const handleSaveTitle = (sectionId) => {
    setDocumentSections((prev) =>
      prev.map((section) =>
        section.id === sectionId
          ? { ...section, title: editedSectionTitle.trim() || section.title }
          : section
      )
    );
    setEditingTitleId(null);
    setEditedSectionTitle('');
    setHasUnsavedChanges(true);
  };

  // Handle section edit start
  const handleStartEditing = (sectionId, content) => {
    setEditingSectionId(sectionId);
    setEditedContent(content || '');
  };

  // Handle section edit cancel
  const handleCancelEditing = () => {
    setEditingSectionId(null);
    setEditedContent('');
  };

  // Handle content change
  const handleContentChange = (value) => {
    setEditedContent(value);
    setHasUnsavedChanges(true);
  };

  // Handle save section
  const handleSaveSection = async (sectionId) => {
    const updatedSections = documentSections.map((section) =>
      section.id === sectionId
        ? { ...section, content: editedContent }
        : section
    );
    setDocumentSections(updatedSections);

    const saved = await persistDocumentSections(
      updatedSections,
      'Section saved successfully'
    );

    if (saved) {
      setEditingSectionId(null);
      setEditedContent('');
    }
  };

  // ? NEW: Handle summary editing
  const handleStartEditingSummary = () => {
    setIsEditingSummary(true);
    setEditedSummaryContent(summaryContent || '');
  };

  const handleCancelEditingSummary = () => {
    setIsEditingSummary(false);
    setEditedSummaryContent('');
  };

  const handleSummaryContentChange = (value) => {
    setEditedSummaryContent(value);
  };

  const handleSaveSummary = async () => {
    const summaryId = meetingSummaries?.summaries?.[0]?._id;

    if (!summaryId) {
      message.warning('No summary found to save');
      return;
    }

    setIsSavingSummary(true);
    try {
      await dispatch(updateMeetingSummary({
        summaryId,
        updateData: {
          summaryContent: editedSummaryContent,
          version: 1
        }
      })).unwrap();

      setSummaryContent(editedSummaryContent);
      message.success('Summary saved successfully');
      setIsEditingSummary(false);
      setEditedSummaryContent('');
    } catch (error) {
      console.error('Error saving summary:', error);
      message.error('Failed to save summary');
    } finally {
      setIsSavingSummary(false);
    }
  };

  // ? MVP+Vision editing handlers
  const handleStartEditingMvp = () => {
    setIsEditingMvp(true);
    setEditedMvpContent(mvpContent || '');
  };
  const handleStartEditingVision = () => {
    setIsEditingVision(true);
    setEditedVisionContent(visionContent || '');
  };
  const handleCancelEditingMvp = () => {
    setIsEditingMvp(false);
    setEditedMvpContent('');
  };
  const handleCancelEditingVision = () => {
    setIsEditingVision(false);
    setEditedVisionContent('');
  };
  const handleSaveMvpVision = async () => {
    const mvpvisionId = meetingMvpvisions?.[0]?._id;
    const mvpToSave = isEditingMvp ? editedMvpContent : mvpContent;
    const visionToSave = isEditingVision ? editedVisionContent : visionContent;
    setIsSavingMvpVision(true);
    try {
      if (mvpvisionId) {
        await dispatch(updateMeetingMvpVision({
          mvpvisionId,
          updateData: {
            mvp: mvpToSave,
            vision: visionToSave,
            version: 1
          }
        })).unwrap();
      } else {
        await dispatch(saveMeetingMvpVision({
          userId: getUserId(),
          meetingId: id,
          projectId: id,
          projectName: currentProject?.project_name,
          mvp: mvpToSave,
          vision: visionToSave,
          timestamp: new Date().toISOString(),
          version: 1
        })).unwrap();
      }
      setMvpContent(mvpToSave);
      setVisionContent(visionToSave);
      message.success('MVP+Vision saved successfully');
      setIsEditingMvp(false);
      setIsEditingVision(false);
      setEditedMvpContent('');
      setEditedVisionContent('');
    } catch (error) {
      console.error('Error saving MVP+Vision:', error);
      message.error('Failed to save MVP+Vision');
    } finally {
      setIsSavingMvpVision(false);
    }
  };

  // Handle save all changes
  const handleSaveAllChanges = async () => {
    let sectionsToSave = documentSections;

    if (editingSectionId) {
      sectionsToSave = documentSections.map((section) =>
        section.id === editingSectionId
          ? { ...section, content: editedContent }
          : section
      );
      setDocumentSections(sectionsToSave);
    }

    await persistDocumentSections(
      sectionsToSave,
      'All changes saved successfully'
    );

    setEditingSectionId(null);
    setEditedContent('');
  };

  // ? NEW: Download summary as PDF
  const downloadSummaryAsPDF = () => {
    if (!summaryContent) {
      message.warning('No summary content to download');
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    let yPosition = margin;

    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Meeting Summary', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // Project name
    if (currentProject?.project_name) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text(`Project: ${currentProject.project_name}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 10;
    }

    // Date
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // Divider
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;

    // Summary content
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');

    const lines = doc.splitTextToSize(summaryContent, maxWidth);

    lines.forEach((line) => {
      if (yPosition > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
      }
      doc.text(line, margin, yPosition);
      yPosition += 7;
    });

    // Save PDF
    const fileName = `Meeting_Summary_${currentProject?.project_name || 'Document'}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
    message.success('PDF downloaded successfully');
  };

  // ? NEW: Download summary as Word
  const downloadSummaryAsWord = async () => {
    if (!summaryContent) {
      message.warning('No summary content to download');
      return;
    }

    try {
      // Create paragraphs from summary content
      const paragraphs = summaryContent.split('\n').map(line =>
        new DocxParagraph({
          text: line,
          spacing: {
            after: 200,
          },
        })
      );

      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            // Title
            new DocxParagraph({
              text: 'Meeting Summary',
              heading: HeadingLevel.HEADING_1,
              spacing: {
                after: 300,
              },
            }),
            // Project name
            ...(currentProject?.project_name ? [
              new DocxParagraph({
                text: `Project: ${currentProject.project_name}`,
                spacing: {
                  after: 200,
                },
              })
            ] : []),
            // Date
            new DocxParagraph({
              text: `Generated: ${new Date().toLocaleDateString()}`,
              spacing: {
                after: 400,
              },
            }),
            // Summary content
            ...paragraphs,
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      const fileName = `Meeting_Summary_${currentProject?.project_name || 'Document'}_${new Date().toISOString().split('T')[0]}.docx`;
      saveAs(blob, fileName);
      message.success('Word document downloaded successfully');
    } catch (error) {
      console.error('Error generating Word document:', error);
      message.error('Failed to generate Word document');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: pageBg,
      color: textColor,
      padding: '16px'
    }}>
      <MeetingDataSyncLoader
        visible={isSyncingMeetingData}
        stage={meetingSyncStage}
        isDarkMode={isDarkMode}
      />
      <div style={{ margin: '0 auto' }}>

        {/* Main Content */}
        <Row gutter={[16, 16]}>

          {/* Tab Navigation */}
          <Card
            style={{
              marginBottom: '16px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              backgroundColor: cardBg,
              border: `1px solid ${borderColor}`,
              // border: '2px solid red',
              width: '99%',
              margin: 'auto'
            }}
            bodyStyle={{ padding: '12px 20px' }}
          >
            <Space>
              <Button
                type={activeTab === 'teams' ? 'primary' : 'default'}
                onClick={() => setActiveTab('teams')}
                icon={<TeamOutlined />}
                size="small"
              >
                Generated Document
              </Button>
              <Button
                type={activeTab === 'transcript' ? 'primary' : 'default'}
                onClick={() => setActiveTab('transcript')}
                icon={<FileTextOutlined />}
                size="small"
              >
                Transcript
              </Button>
            </Space>
          </Card>


          <Col xs={24} lg={24}>
            {/* <DownloadPDFButtons allTranscripts={allTranscripts} teams={teams} documentSections={documentSections} /> */}
            <Card
              style={{
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                border: `1px solid ${borderColor}`,
                backgroundColor: cardBg,
                minHeight: '500px'
              }}
              bodyStyle={{ padding: '20px' }}
            >
              {activeTab === 'teams' && (
                <div>
                  {/* <Title level={4} style={{ marginBottom: '20px', fontSize: '16px' }}>
                    Select Team Proposal
                  </Title> */}

                  {/* <Col gutter={[16, 16]} >
                    {teams.map((team) => (
                      <Col xs={24} md={28} key={team.id} style={{ marginBottom: '16px' }}>
                        <Card
                          style={{
                            borderRadius: '8px',
                            border: `2px solid ${team.color}`,
                            backgroundColor: team.bgColor,
                            height: '100%',

                          }}
                          bodyStyle={{ padding: '16px' }}
                        >
                          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                            <Title level={5} style={{
                              margin: 0,
                              color: team.color,
                              fontSize: '18px'
                            }}>
                              {team.name}
                            </Title>
                          </div>

                          <div className='md:flex justify-between ' >
                           
                            <div style={{ marginBottom: '12px' }} className='md:w-[49%]'>
                              {renderEditableField(
                                team,
                                'mvp',
                                'MVP',
                                <TrophyOutlined style={{ color: team.color, fontSize: '12px' }} />,

                                {
                                  maxHeight: '6.5em',
                                  minHeight: '6.5em',
                                  lineHeight: '1.3em',
                                  overflowY: 'auto',
                                  paddingRight: '4px',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word'
                                }
                              )}
                            </div>
                            
                            <div style={{ marginBottom: '12px' }} className='md:w-[49%]'>
                              {renderEditableField(
                                team,
                                'vision',
                                'Vision',
                                <EyeOutlined style={{ color: team.color, fontSize: '12px' }} />,

                                {
                                  maxHeight: '6.5em',   // about 5?6 lines (depending on font-size/line-height)
                                  minHeight: '6.5em',   // keeps box fixed
                                  lineHeight: '1.3em',
                                  overflowY: 'auto',
                                  paddingRight: '4px',  // ensures scrollbar doesn?t overlap text
                                  whiteSpace: 'pre-wrap', // preserves line breaks
                                  wordBreak: 'break-word',
                                  fontSize: '39px'
                                }
                              )}
                            </div>


                          </div>

                      
                          <Button
                            type="primary"
                            icon={<CheckOutlined />}
                            onClick={() => handleApprove(team)}
                            disabled={!team.data.vision || !team.data.mvp}
                            block
                            size="small"
                            style={{
                              backgroundColor: team.color,
                              borderColor: team.color,
                              marginTop: '8px',

                            }}
                          >
                            Approve {team.name}
                          </Button>
                        </Card>
                      </Col>
                    ))}
                  </Col> */}

                  {/* NEW: Document / Summary / MVP+Vision Display */}
                  {(documentSections.length > 0 || summaryContent || mvpContent || visionContent) && (
                    <div style={{ marginTop: '24px' }}>
                      {/* ? CONDITIONAL: Show document, MVP+Vision, or summary based on template type */}
                      {wantDocumentTemplate ? (
                        <>
                          {/* ? EXISTING DOCUMENT SECTION */}
                          {/* Header with View Toggle and Download */}
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '16px',
                            flexWrap: 'wrap',
                            gap: '12px'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <Title level={4} style={{ margin: 0, fontSize: '16px' }}>
                                <FileTextOutlined style={{ marginRight: '8px' }} />
                                Generated Document
                              </Title>
                              {(mongoDocument?.version ||
                                driveDocument?.document?.version ||
                                driveDocument?.version) && (
                                <Tag color="geekblue">
                                  v
                                  {mongoDocument?.version ||
                                    driveDocument?.document?.version ||
                                    driveDocument?.version ||
                                    1}
                                </Tag>
                              )}
                              {hasUnsavedChanges && (
                                <Tag color="orange" style={{ marginLeft: '8px' }}>
                                  Unsaved changes
                                </Tag>
                              )}
                            </div>

                            <Space size="middle" wrap>
                              {hasUnsavedChanges && (
                                <Button
                                  type="primary"
                                  icon={isSaving ? <LoadingOutlined /> : <SaveOutlined />}
                                  onClick={handleSaveAllChanges}
                                  loading={isSaving}
                                  style={{
                                    backgroundColor: '#52c41a',
                                    borderColor: '#52c41a',
                                  }}
                                >
                                  Save All
                                </Button>
                              )}

                              {notionConnected && documentStorageBackend !== STORAGE_BACKEND.NOTION && (
                                <Button
                                  icon={exportingToNotion ? <LoadingOutlined /> : <SiNotion />}
                                  onClick={handleExportToNotion}
                                  loading={exportingToNotion}
                                  style={{ backgroundColor: "#000000", borderColor: "#000000", color: "#ffffff" }}
                                >
                                  Save to Notion
                                </Button>
                              )}

                              {driveConnected && documentStorageBackend !== STORAGE_BACKEND.GOOGLE_DRIVE && (
                                <Button
                                  icon={exportingToDrive ? <LoadingOutlined /> : <GoogleOutlined />}
                                  loading={exportingToDrive}
                                  onClick={handleSaveToDriveViaAgent}
                                  style={{
                                    backgroundColor: '#4285F4',
                                    borderColor: '#4285F4',
                                    color: '#ffffff',
                                  }}
                                >
                                  Save to Drive
                                </Button>
                              )}

                              {/* View Mode Toggle */}
                              <Space.Compact>
                                <Button
                                  type={documentViewMode === 'pdf' ? 'primary' : 'default'}
                                  icon={<FilePdfOutlined />}
                                  onClick={() => setDocumentViewMode('pdf')}
                                  style={{
                                    backgroundColor: documentViewMode === 'pdf' ? '#ff4d4f' : undefined,
                                    borderColor: documentViewMode === 'pdf' ? '#ff4d4f' : undefined,
                                  }}
                                >
                                  PDF View
                                </Button>
                                <Button
                                  type={documentViewMode === 'word' ? 'primary' : 'default'}
                                  icon={<FileWordOutlined />}
                                  onClick={() => setDocumentViewMode('word')}
                                  style={{
                                    backgroundColor: documentViewMode === 'word' ? '#1890ff' : undefined,
                                    borderColor: documentViewMode === 'word' ? '#1890ff' : undefined,
                                  }}
                                >
                                  Word View
                                </Button>
                              </Space.Compact>

                              {/* Download Button */}
                              <Button
                                type="primary"
                                icon={<DownloadOutlined />}
                                onClick={handleDownload}
                                style={{
                                  backgroundColor: documentViewMode === 'pdf' ? '#ff4d4f' : '#1890ff',
                                  borderColor: documentViewMode === 'pdf' ? '#ff4d4f' : '#1890ff',
                                }}
                              >
                                Download as {documentViewMode === 'pdf' ? 'PDF' : 'Word'}
                              </Button>
                            </Space>
                          </div>

                          {/* Document Viewer Container */}
                          <div style={{
                            backgroundColor:
                              documentViewMode === 'pdf'
                                ? (isDarkMode ? '#111827' : '#525659')
                                : (isDarkMode ? '#0b1220' : '#f5f5f5'),
                            borderRadius: '8px',
                            padding: '20px',
                            minHeight: '500px',
                            maxHeight: '700px',
                            overflowY: 'auto',
                            boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.1)',
                            transition: 'background-color 0.3s ease'
                          }}>
                            {/* Document Paper */}
                            <div style={{
                              backgroundColor: isDarkMode ? '#111827' : '#ffffff',
                              maxWidth: '1200px',
                              margin: '0 auto',
                              padding: documentViewMode === 'pdf' ? '60px 50px' : '40px 50px',
                              borderRadius: documentViewMode === 'pdf' ? '4px' : '4px',
                              boxShadow: documentViewMode === 'pdf'
                                ? '0 4px 20px rgba(0,0,0,0.3)'
                                : '0 2px 8px rgba(0,0,0,0.1)',
                              minHeight: '600px',
                              fontFamily: documentViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                              color: documentViewMode === 'pdf' ? pdfTextColor : textColor,
                            }}>
                              {/* Document Title */}
                              <div style={{
                                textAlign: 'center',
                                marginBottom: '40px',
                                paddingBottom: '20px',
                                borderBottom: documentViewMode === 'pdf' ? 'none' : '2px solid #1890ff'
                              }}>
                                {/* <h1 style={{
                              fontSize: documentViewMode === 'pdf' ? '24px' : '28px',
                              fontWeight: 'bold',
                              color: documentViewMode === 'pdf' ? '#333' : '#1890ff',
                              margin: 0,
                              fontFamily: documentViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                            }}>
                              Document
                            </h1> */}
                                {/* Document Title - Editable */}
                                <div style={{ textAlign: 'center', marginBottom: '40px', paddingBottom: '20px', borderBottom: documentViewMode === 'pdf' ? 'none' : '2px solid #1890ff' }}>
                                  {isEditingTitle ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                                      <Input
                                        value={editedTitle}
                                        onChange={e => setEditedTitle(e.target.value)}
                                        style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center', maxWidth: 400 }}
                                        autoFocus
                                      />
                                      <Button type="primary" size="small" icon={<SaveOutlined />}
                                        onClick={() => { setDocumentTitle(editedTitle); setIsEditingTitle(false); }}
                                        style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                                      >Save</Button>
                                      <Button size="small" icon={<CloseOutlined />}
                                        onClick={() => setIsEditingTitle(false)}
                                      >Cancel</Button>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                      onClick={() => { setEditedTitle(documentTitle); setIsEditingTitle(true); }}
                                      title="Click to edit title"
                                    >
                                      <h1 style={{
                                        fontSize: documentViewMode === 'pdf' ? '24px' : '28px',
                                        fontWeight: 'bold',
                                        color: documentViewMode === 'pdf' ? pdfTextColor : (isDarkMode ? '#60a5fa' : '#1890ff'),
                                        margin: 0,
                                        fontFamily: documentViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                                      }}>
                                        {documentTitle}
                                        <EditOutlined style={{ marginLeft: '8px', color: isDarkMode ? '#94a3b8' : '#aaa', fontSize: 16 }} />

                                      </h1>

                                      {/* Subtitle - Vision Document for agenda */}
                                      <div style={{
                                        fontSize: documentViewMode === 'pdf' ? '22px' : '23px',
                                        color: documentViewMode === 'pdf' ? pdfMutedText : (isDarkMode ? '#cbd5e1' : '#555'),
                                        marginTop: '8px',
                                        marginBottom: '4px',
                                        fontWeight: 'bold',
                                        // fontStyle: 'italic',
                                        fontFamily: documentViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                                      }}>
                                        Vision Document for {agenda}
                                      </div>

                                      {/* Company Name - Editable */}
                                      {isEditingCompanyName ? (
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                          <Input
                                            value={editedCompanyName}
                                            onChange={e => setEditedCompanyName(e.target.value)}
                                            style={{ fontSize: 13, textAlign: 'center', maxWidth: 250 }}
                                            autoFocus
                                          />
                                          <Button type="primary" size="small" icon={<SaveOutlined />}
                                            onClick={() => { setCompanyName(editedCompanyName); setIsEditingCompanyName(false); }}
                                            style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                                          />
                                          <Button size="small" icon={<CloseOutlined />} onClick={() => setIsEditingCompanyName(false)} />
                                        </div>
                                      ) : (
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, cursor: 'pointer' }}
                                          onClick={() => { setEditedCompanyName(companyName); setIsEditingCompanyName(true); }}
                                          title="Click to edit company name"
                                        >
                                          <p style={{
                                            fontSize: documentViewMode === 'pdf' ? '22px' : '22px',
                                            color: documentViewMode === 'pdf' ? pdfMutedText : (isDarkMode ? '#cbd5e1' : '#555'),
                                            margin: 0,
                                            fontWeight: 'bold',
                                            fontFamily: documentViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                                          }}>
                                            {companyName}
                                          </p>
                                          <EditOutlined style={{ color: isDarkMode ? '#94a3b8' : '#aaa', fontSize: 13 }} />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Revision History — previous meetings, latest first */}
                                <div style={{ marginBottom: '40px' }}>
                                  <h2 style={{ fontSize: 18, fontWeight: 'bold', margin: '0 0 12px 0', fontFamily: 'Georgia, serif', color: documentViewMode === 'pdf' ? pdfTextColor : textColor }}>Revision History</h2>
                                  {loadingMeetingHistory && revisionMeetingHistory.length === 0 ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
                                      <Spin size="small" />
                                    </div>
                                  ) : revisionMeetingHistory.length === 0 ? (
                                    <p style={{ margin: 0, color: mutedText, fontSize: 13 }}>No previous meetings yet.</p>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                      {revisionMeetingHistory.map((meeting) => {
                                        const doc = meeting.document;
                                        return (
                                          <div
                                            key={getMeetingListKey(meeting)}
                                            style={{
                                              display: 'flex',
                                              flexWrap: 'wrap',
                                              alignItems: 'center',
                                              justifyContent: 'space-between',
                                              gap: 12,
                                              padding: '12px 14px',
                                              borderRadius: 8,
                                              border: `1px solid ${isDarkMode ? '#475569' : '#ccc'}`,
                                              backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc',
                                            }}
                                          >
                                            <div style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 6,
                                              color: documentViewMode === 'pdf' ? pdfTextColor : textColor,
                                              fontSize: 13,
                                            }}>
                                              <CalendarOutlined style={{ color: mutedText }} />
                                              {formatRevisionMeetingDate(meeting.created_at || doc?.created_at)}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                              <Tag color="geekblue" style={{ margin: 0 }}>
                                                Document v{doc?.version || 1}
                                              </Tag>
                                              <Button
                                                size="small"
                                                type="primary"
                                                icon={<EyeOutlined />}
                                                onClick={() => handleOpenRevisionDocument(meeting)}
                                              >
                                                Open
                                              </Button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Table of Contents */}
                              <div style={{
                                marginBottom: '40px',
                                padding: '24px',
                                backgroundColor: isDarkMode ? subtleBg : '#fafafa',
                                borderRadius: '8px',
                                border: `1px solid ${borderColor}`,
                              }}>
                                <div style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  marginBottom: '20px',
                                  borderBottom: `2px solid ${documentViewMode === 'pdf' ? pdfTextColor : '#333'}`,
                                  paddingBottom: '12px',
                                }}>
                                  <h2 style={{
                                    fontSize: '20px',
                                    fontWeight: 'bold',
                                    color: isDarkMode ? textColor : '#333',
                                    margin: 0,
                                    fontFamily: 'Georgia, serif',
                                  }}>
                                    Table of Contents
                                  </h2>
                                  <Button
                                    type="text"
                                    size="small"
                                    onClick={() => setShowTableOfContents(!showTableOfContents)}
                                    style={{ color: isDarkMode ? '#60a5fa' : '#1890ff' }}
                                  >
                                    {showTableOfContents ? 'Hide' : 'Show'}
                                  </Button>
                                </div>

                                {showTableOfContents && (
                                  <div style={{
                                    maxHeight: '400px',
                                    overflowY: 'auto',
                                    paddingRight: '8px',
                                  }}>
                                    {generateTableOfContents().map((item, idx) => (
                                      <div
                                        key={item.id}
                                        onClick={() => !item.isCategory && scrollToSection(item.sectionId)}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'baseline',
                                          padding: item.isCategory ? '8px 0 4px 0' : '4px 0 4px 20px',
                                          cursor: item.isCategory ? 'default' : 'pointer',
                                          transition: 'background-color 0.2s',
                                          borderRadius: '4px',
                                          marginBottom: item.isCategory ? '4px' : '2px',
                                        }}
                                        onMouseEnter={(e) => {
                                          if (!item.isCategory) {
                                            e.currentTarget.style.backgroundColor = 'rgba(24, 144, 255, 0.1)';
                                          }
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                      >
                                        <span style={{
                                          minWidth: item.isCategory ? '24px' : '40px',
                                          fontWeight: item.isCategory ? 'bold' : 'normal',
                                          fontSize: item.isCategory ? '14px' : '13px',
                                          color: item.isCategory ? (isDarkMode ? textColor : '#333') : (isDarkMode ? '#cbd5e1' : '#555'),
                                          fontFamily: 'Georgia, serif',
                                        }}>
                                          {item.number}
                                        </span>
                                        <span style={{
                                          flex: 1,
                                          fontWeight: item.isCategory ? 'bold' : 'normal',
                                          fontSize: item.isCategory ? '14px' : '13px',
                                          color: item.isCategory ? (isDarkMode ? textColor : '#333') : (isDarkMode ? '#cbd5e1' : '#555'),
                                          fontFamily: 'Georgia, serif',
                                          borderBottom: `1px dotted ${isDarkMode ? '#475569' : '#ccc'}`,
                                          marginRight: '8px',
                                          paddingBottom: '2px',
                                        }}>
                                          {item.title}
                                        </span>
                                        {!item.isCategory && (
                                          <span style={{
                                            fontSize: '12px',
                                            color: mutedText,
                                            fontFamily: 'Georgia, serif',
                                          }}>
                                            {idx}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Document Sections - Accordion Style */}
                              <Collapse
                                activeKey={activeAccordionKeys}
                                onChange={handleAccordionChange}
                                style={{
                                  backgroundColor: 'transparent',
                                  border: 'none',
                                }}
                                expandIconPosition="end"
                              >
                                {(() => {
                                  let lastCategory = null;
                                  return documentSections.map((section, index) => {
                                    const isNewCategory = section.category !== lastCategory;
                                    if (isNewCategory) lastCategory = section.category;
                                    const isEditing = editingSectionId === section.id;

                                    return (
                                      <React.Fragment key={section.id}>
                                        {isNewCategory && (
                                          <div
                                            style={{
                                              display: 'flex',
                                              justifyContent: 'space-between',
                                              alignItems: 'center',
                                              gap: 8,
                                              padding: '8px 12px',
                                              marginTop: index === 0 ? 0 : 12,
                                              marginBottom: 4,
                                              background: isDarkMode ? '#172554' : '#e6f7ff',
                                              borderRadius: 6,
                                              borderLeft: '4px solid #1890ff',
                                              fontWeight: 700,
                                              fontSize: 13,
                                              color: isDarkMode ? '#93c5fd' : '#1890ff',
                                              textTransform: 'uppercase',
                                              letterSpacing: '0.5px',
                                            }}
                                          >
                                            <span>
                                              {section.categoryTitle ||
                                                section.category?.replace(/_/g, ' ')}
                                            </span>
                                            <Button
                                              type="dashed"
                                              size="small"
                                              icon={<PlusOutlined />}
                                              onClick={() =>
                                                handleAddSection(
                                                  section.category,
                                                  section.categoryTitle ||
                                                  section.category?.replace(/_/g, ' ')
                                                )
                                              }
                                              style={{
                                                color: isDarkMode ? '#93c5fd' : '#1890ff',
                                                borderColor: isDarkMode ? '#3b82f6' : '#91caff',
                                              }}
                                            >
                                              Add Section
                                            </Button>
                                          </div>
                                        )}
                                        <Collapse.Panel
                                          key={section.id}
                                          forceRender
                                          className={`section-panel-${section.id}`}
                                          header={
                                            <div style={{
                                              display: 'flex',
                                              justifyContent: 'space-between',
                                              alignItems: 'center',
                                              width: '100%',
                                              paddingRight: '8px',
                                            }}>
                                              {editingTitleId === section.id ? (
                                                <Space.Compact onClick={(e) => e.stopPropagation()}>
                                                  <Input
                                                    value={editedSectionTitle}
                                                    onChange={(e) => setEditedSectionTitle(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{ width: 220 }}
                                                  />
                                                  <Button
                                                    size="small"
                                                    type="primary"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleSaveTitle(section.id);
                                                    }}
                                                  >
                                                    OK
                                                  </Button>
                                                </Space.Compact>
                                              ) : (
                                                <span style={{
                                                  fontSize: documentViewMode === 'pdf' ? '15px' : '14px',
                                                  fontWeight: 600,
                                                  color: documentViewMode === 'pdf' ? pdfTextColor : (isDarkMode ? '#e5e7eb' : '#333'),
                                                  fontFamily: documentViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                                                }}>
                                                  {index + 1}. {section.title}
                                                </span>
                                              )}
                                              <Space size="small" onClick={(e) => e.stopPropagation()}>
                                                {isEditing ? (
                                                  <>
                                                    <Button
                                                      type="primary"
                                                      size="small"
                                                      icon={isSaving ? <LoadingOutlined /> : <SaveOutlined />}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSaveSection(section.id);
                                                      }}
                                                      loading={isSaving}
                                                      style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                                                    >
                                                      Save
                                                    </Button>
                                                    <Button
                                                      size="small"
                                                      icon={<CloseOutlined />}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCancelEditing();
                                                      }}
                                                    >
                                                      Cancel
                                                    </Button>
                                                  </>
                                                ) : (
                                                  <>
                                                    <Button
                                                      type="text"
                                                      size="small"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleStartEditingTitle(section.id, section.title);
                                                      }}
                                                      style={{ color: isDarkMode ? '#94a3b8' : '#666' }}
                                                    >
                                                      Rename
                                                    </Button>
                                                    <Button
                                                      type="text"
                                                      size="small"
                                                      icon={<EditOutlined />}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleStartEditing(section.id, section.content);
                                                        if (!activeAccordionKeys.includes(section.id)) {
                                                          setActiveAccordionKeys([...activeAccordionKeys, section.id]);
                                                        }
                                                      }}
                                                      style={{ color: isDarkMode ? '#60a5fa' : '#1890ff' }}
                                                    >
                                                      Edit
                                                    </Button>
                                                    <Button
                                                      type="text"
                                                      size="small"
                                                      danger
                                                      icon={<DeleteOutlined />}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteSection(section.id);
                                                      }}
                                                    >
                                                      Delete
                                                    </Button>
                                                  </>
                                                )}
                                              </Space>
                                            </div>
                                          }
                                          style={{
                                            marginBottom: '12px',
                                            borderRadius: '8px',
                                            border: isEditing ? '2px solid #1890ff' : `1px solid ${borderColor}`,
                                            backgroundColor: isEditing
                                              ? (isDarkMode ? '#16351f' : '#f6ffed')
                                              : (isDarkMode ? subtleBg : '#fafafa'),
                                            overflow: 'hidden',
                                          }}
                                        >
                                          {isEditing ? (
                                            <TextArea
                                              value={editedContent}
                                              onChange={(e) => handleContentChange(e.target.value)}
                                              autoSize={{ minRows: 6, maxRows: 20 }}
                                              style={{
                                                fontSize: '14px',
                                                lineHeight: '1.6',
                                                fontFamily: 'Calibri, Arial, sans-serif',
                                                borderRadius: '6px',
                                              }}
                                              placeholder="Enter section content..."
                                            />
                                          ) : (
                                            <div
                                              style={{
                                                fontSize: documentViewMode === 'pdf' ? '13px' : '14px',
                                                lineHeight: documentViewMode === 'pdf' ? '1.8' : '1.6',
                                                color: documentViewMode === 'pdf' ? pdfTextColor : textColor,
                                                textAlign: documentViewMode === 'pdf' ? 'justify' : 'left',
                                                fontFamily: documentViewMode === 'pdf' ? 'Georgia, serif' : 'Calibri, Arial, sans-serif',
                                                cursor: 'pointer',
                                                padding: '8px',
                                                borderRadius: '4px',
                                                transition: 'background-color 0.2s',
                                                backgroundColor: isDarkMode ? cardBg : '#fff',
                                              }}
                                              onClick={() => handleStartEditing(section.id, section.content)}
                                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = isDarkMode ? '#1e293b' : 'rgba(24, 144, 255, 0.05)'}
                                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isDarkMode ? cardBg : '#fff'}
                                              title="Click to edit"
                                            >
                                              {section.content ? (
                                                formatContent(section.content)
                                              ) : (
                                                <span style={{ color: mutedText, fontStyle: 'italic' }}>
                                                  Click to add content...
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </Collapse.Panel>
                                      </React.Fragment>
                                    );
                                  });
                                })()}
                              </Collapse>

                              {/* Footer for PDF view */}
                              {documentViewMode === 'pdf' && (
                                <div style={{
                                  marginTop: '60px',
                                  paddingTop: '20px',
                                  borderTop: `1px solid ${isDarkMode ? '#475569' : '#ddd'}`,
                                  textAlign: 'center',
                                  fontSize: '10px',
                                  color: mutedText
                                }}>
                                  Page 1 of 1 | Generated by MARARE
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Helper text */}
                          <div style={{
                            marginTop: '12px',
                            textAlign: 'center',
                            color: mutedText,
                            fontSize: '12px'
                          }}>
                            <EditOutlined style={{ marginRight: '4px' }} />
                            Click on any section to edit. Changes are auto-highlighted. Click "Save All Changes" to persist.
                          </div>
                        </>
                      ) : mvpVisionTemplate ? (
                        <>
                          {/* ? MVP+Vision SECTION (when mvpVisionTemplate === true) */}
                          <div>
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '24px',
                              paddingBottom: '16px',
                              borderBottom: `2px solid ${borderColor}`,
                              flexWrap: 'wrap',
                              gap: '12px'
                            }}>
                              <Title level={4} style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <RocketOutlined style={{ color: '#4f46e5' }} />
                                MVP &amp; Vision
                              </Title>
                              <Space size="middle" wrap>
                                {(!isEditingMvp && !isEditingVision) ? (
                                  <Button
                                    type="primary"
                                    icon={<EditOutlined />}
                                    onClick={() => { handleStartEditingMvp(); handleStartEditingVision(); }}
                                    disabled={!mvpContent && !visionContent}
                                  >
                                    Edit MVP &amp; Vision
                                  </Button>
                                ) : (
                                  <>
                                    <Button
                                      type="primary"
                                      icon={isSavingMvpVision ? <LoadingOutlined /> : <SaveOutlined />}
                                      onClick={handleSaveMvpVision}
                                      loading={isSavingMvpVision}
                                      style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      icon={<CloseOutlined />}
                                      onClick={() => { handleCancelEditingMvp(); handleCancelEditingVision(); }}
                                    >
                                      Cancel
                                    </Button>
                                  </>
                                )}
                              </Space>
                            </div>
                            <Row gutter={[24, 24]}>
                              <Col xs={24} lg={12}>
                                <Card
                                  title={<><RocketOutlined style={{ marginRight: 8, color: '#4f46e5' }} />MVP &amp; Functional Requirements</>}
                                  style={{ borderRadius: 8, border: isEditingMvp ? '2px solid #4f46e5' : `1px solid ${borderColor}`, backgroundColor: cardBg }}
                                >
                                  {mvpContent || editedMvpContent ? (
                                    isEditingMvp ? (
                                      <TextArea
                                        value={editedMvpContent}
                                        onChange={(e) => setEditedMvpContent(e.target.value)}
                                        autoSize={{ minRows: 10, maxRows: 25 }}
                                        style={{ fontSize: 14, lineHeight: 1.7 }}
                                        placeholder="Enter MVP requirements..."
                                      />
                                    ) : (
                                      <div
                                        style={{ fontSize: 14, lineHeight: 1.7, color: textColor, whiteSpace: 'pre-wrap' }}
                                        onClick={handleStartEditingMvp}
                                      >
                                        {mvpContent}
                                      </div>
                                    )
                                  ) : (
                                    <div style={{ textAlign: 'center', padding: 40, color: mutedText }}>No MVP content yet</div>
                                  )}
                                </Card>
                              </Col>
                              <Col xs={24} lg={12}>
                                <Card
                                  title={<><EyeOutlined style={{ marginRight: 8, color: '#059669' }} />Vision Statement</>}
                                  style={{ borderRadius: 8, border: isEditingVision ? '2px solid #059669' : `1px solid ${borderColor}`, backgroundColor: cardBg }}
                                >
                                  {visionContent || editedVisionContent ? (
                                    isEditingVision ? (
                                      <TextArea
                                        value={editedVisionContent}
                                        onChange={(e) => setEditedVisionContent(e.target.value)}
                                        autoSize={{ minRows: 10, maxRows: 25 }}
                                        style={{ fontSize: 14, lineHeight: 1.7 }}
                                        placeholder="Enter vision statement..."
                                      />
                                    ) : (
                                      <div
                                        style={{ fontSize: 14, lineHeight: 1.7, color: textColor, whiteSpace: 'pre-wrap' }}
                                        onClick={handleStartEditingVision}
                                      >
                                        {visionContent}
                                      </div>
                                    )
                                  ) : (
                                    <div style={{ textAlign: 'center', padding: 40, color: mutedText }}>No vision content yet</div>
                                  )}
                                </Card>
                              </Col>
                            </Row>
                            {(mvpContent || visionContent) && !isEditingMvp && !isEditingVision && (
                              <div style={{ marginTop: 12, textAlign: 'center', color: mutedText, fontSize: 12 }}>
                                <EditOutlined style={{ marginRight: 4 }} />
                                Click "Edit MVP &amp; Vision" to modify
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {/* ? SUMMARY SECTION (when wantDocumentTemplate === false && !mvpVisionTemplate) */}
                          <div>
                            {/* Header */}
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '24px',
                              paddingBottom: '16px',
                              borderBottom: `2px solid ${borderColor}`,
                              flexWrap: 'wrap',
                              gap: '12px'
                            }}>
                              <Title level={4} style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FileTextOutlined style={{ color: '#1890ff' }} />
                                Meeting Summary
                              </Title>

                              <Space size="middle" wrap>
                                {/* Download Buttons */}
                                {summaryContent && !isEditingSummary && (
                                  <>
                                    <Button
                                      icon={<FilePdfOutlined />}
                                      onClick={downloadSummaryAsPDF}
                                      style={{
                                        backgroundColor: '#ff4d4f',
                                        borderColor: '#ff4d4f',
                                        color: '#fff'
                                      }}
                                    >
                                      Download PDF
                                    </Button>
                                    <Button
                                      icon={<FileWordOutlined />}
                                      onClick={downloadSummaryAsWord}
                                      style={{
                                        backgroundColor: '#1890ff',
                                        borderColor: '#1890ff',
                                        color: '#fff'
                                      }}
                                    >
                                      Download Word
                                    </Button>
                                  </>
                                )}

                                {/* Edit/Save Buttons */}
                                {!isEditingSummary ? (
                                  <Button
                                    type="primary"
                                    icon={<EditOutlined />}
                                    onClick={handleStartEditingSummary}
                                    disabled={!summaryContent}
                                  >
                                    Edit Summary
                                  </Button>
                                ) : (
                                  <>
                                    <Button
                                      type="primary"
                                      icon={isSavingSummary ? <LoadingOutlined /> : <SaveOutlined />}
                                      onClick={handleSaveSummary}
                                      loading={isSavingSummary}
                                      style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      icon={<CloseOutlined />}
                                      onClick={handleCancelEditingSummary}
                                    >
                                      Cancel
                                    </Button>
                                  </>
                                )}
                              </Space>
                            </div>

                            {/* Summary Content */}
                            <div style={{
                              backgroundColor: cardBg,
                              borderRadius: '8px',
                              padding: '24px',
                              minHeight: '400px',
                              border: isEditingSummary ? '2px solid #1890ff' : `1px solid ${borderColor}`,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                            }}>
                              {summaryContent ? (
                                isEditingSummary ? (
                                  <TextArea
                                    value={editedSummaryContent}
                                    onChange={(e) => handleSummaryContentChange(e.target.value)}
                                    autoSize={{ minRows: 15, maxRows: 30 }}
                                    style={{
                                      fontSize: '14px',
                                      lineHeight: '1.8',
                                      fontFamily: 'Calibri, Arial, sans-serif',
                                    }}
                                    placeholder="Enter summary content..."
                                  />
                                ) : (
                                  <div
                                    style={{
                                      fontSize: '14px',
                                      lineHeight: '1.8',
                                      color: textColor,
                                      whiteSpace: 'pre-wrap',
                                      fontFamily: 'Calibri, Arial, sans-serif',
                                    }}
                                  >
                                    {summaryContent}
                                  </div>
                                )
                              ) : (
                                <div style={{
                                  textAlign: 'center',
                                  padding: '60px 20px',
                                  color: mutedText
                                }}>
                                  <FileTextOutlined style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }} />
                                  <p style={{ fontSize: '16px', margin: 0 }}>No summary available</p>
                                  <p style={{ fontSize: '14px', marginTop: '8px' }}>Summary will appear here after the meeting ends</p>
                                </div>
                              )}
                            </div>

                            {/* Helper text */}
                            {summaryContent && !isEditingSummary && (
                              <div style={{
                                marginTop: '12px',
                                textAlign: 'center',
                                color: mutedText,
                                fontSize: '12px'
                              }}>
                                <EditOutlined style={{ marginRight: '4px' }} />
                                Click "Edit Summary" to modify the content
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'transcript' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Title level={4} style={{ marginBottom: '16px', fontSize: '16px' }}>
                      Meeting Transcript
                    </Title>

                    {allTranscripts.length > 0 && (
                      <Space>
                        <Button
                          icon={<FilePdfOutlined />}
                          onClick={downloadTranscriptAsPDF}
                          style={{ backgroundColor: '#ff4d4f', borderColor: '#ff4d4f', color: '#fff' }}
                        >
                          Download PDF
                        </Button>
                        <Button
                          icon={<FileWordOutlined />}
                          onClick={downloadTranscriptAsWord}
                          style={{ backgroundColor: '#1890ff', borderColor: '#1890ff', color: '#fff' }}
                        >
                          Download Word
                        </Button>
                      </Space>
                    )}
                  </div>

                  {/* // Updated JSX for rendering */}
                  {allTranscripts.length > 0 ? (
                    <div style={{ maxHeight: '400px', overflow: 'auto', paddingRight: '8px' }}>
                      <Timeline size="small">
                        {allTranscripts.map((item, index) => (

                          <Timeline.Item
                            key={index}
                            dot={<TeamOutlined style={{ fontSize: '12px' }} />}
                          >
                            <div style={{ marginBottom: '6px', marginTop: '10px' }}>
                              <Space size="small">
                                <Tag
                                  color={
                                    item.source === 'You'
                                      ? 'blue'
                                      : item.source === 'Remote'
                                        ? 'green'
                                        : 'purple'
                                  }
                                  style={{ fontSize: '10px', padding: '0 6px' }}
                                >
                                  {item.speaker || item.source}
                                </Tag>
                                {/* Optional: Display timestamp */}
                                <Text type="secondary" style={{ fontSize: '10px' }}>
                                  {new Date(item.timestamp).toLocaleTimeString()}
                                </Text>
                              </Space>
                            </div>
                            <Paragraph style={{
                              margin: 0,
                              fontSize: '12px',
                              lineHeight: '1.4',
                              maxHeight: '5.5em',
                              overflowY: 'auto'
                            }}>
                              {item.message || item.text}
                            </Paragraph>
                          </Timeline.Item>
                        ))}
                      </Timeline>
                    </div>
                  ) : (
                    <div style={{
                      textAlign: 'center',
                      padding: '40px',
                      color: '#999'
                    }}>
                      <FileTextOutlined style={{ fontSize: '48px', marginBottom: '16px' }} />
                      <Text type="secondary">No transcript available</Text>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </Col>

          {/* Sidebar */}
          <Col xs={24} lg={24}>


            <Card
              style={{
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                border: `1px solid ${borderColor}`,
                backgroundColor: cardBg,
                marginBottom: '16px'
              }}
              bodyStyle={{ padding: '16px' }}
            >
              <Title level={5} style={{
                marginBottom: '12px',
                fontSize: '14px'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', margin: 'auto', textAlign: 'center' }}>
                  {selectedTeam && (
                    <Text style={{ fontSize: '13px' }}>
                      ? {selectedTeam} selected
                    </Text>
                  )}
                </span>
                <br />

                <RocketOutlined style={{ marginRight: '6px' }} />
                Next Steps
              </Title>




              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Button
                  icon={<DashboardOutlined />}
                  onClick={() => navigate("/")}
                  block
                  style={{
                    height: '40px',
                    borderRadius: '6px',
                    fontSize: '13px'
                  }}
                >
                  Go to Dashboard
                </Button>
              </Space>
            </Card>

          </Col>


       



        </Row>
      </div>
    </div>
  );
};

export default EndMeetingMessage;