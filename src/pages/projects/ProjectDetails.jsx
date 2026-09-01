/**
 * Project hub — history, documents, transcript import, connectors.
 * File: src/pages/projects/ProjectDetails.jsx
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, Link, useLocation } from "react-router-dom";
import {
  Button,
  Card,
  Typography,
  message,
  Breadcrumb,
} from "antd";
import {
  HomeFilled,
  ApiOutlined,
} from "@ant-design/icons";
import { useDispatch, useSelector } from "react-redux";
import TranscriptImportPanel from '../../components/documents/TranscriptImportPanel';
import MeetingHistoryPanel from '../../components/documents/MeetingHistoryPanel';
import { getUserId } from '../../services/auth/GetLoginUserId';
import { deleteProjectMeeting, getGeneratedDocumentById } from '../../features/mainStates/Template_Slice';
import { downloadDocPDF } from '../../utils/documentUtils';
import {
  buildGeneratedDocumentFromDriveDocument,
  retrieveDriveDocumentFromMcp,
} from '../../utils/googleDriveMcpDocuments';
import {
  buildGeneratedDocumentFromNotionDocument,
  retrieveNotionDocumentFromApi,
} from '../../utils/notionMcpDocuments';
import {
  fetchProjectDocumentStorage,
  STORAGE_BACKEND,
} from '../../utils/projectDocumentStorage';
import useUnifiedProjectMeetingHistory from "../../hooks/useUnifiedProjectMeetingHistory";
import {
  isSupabaseMeeting,
} from '../../utils/unifiedMeetingHistory';

const { Title, Text } = Typography;

const ProjectDetails = () => {
  const { project_name, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const [driveDocument, setDriveDocument] = useState(null);
  const [notionDocument, setNotionDocument] = useState(null);
  const [storedDocuments, setStoredDocuments] = useState([]);
  const [documentStorageBackend, setDocumentStorageBackend] = useState(STORAGE_BACKEND.SUPABASE);
  const projects = useSelector((state) => state.main.projects);
  const project = projects.find((item) => item.id == id);

  const {
    meetings: meetingHistory,
    loading: loadingMeetingHistory,
    loadingSources,
    loadingExternal,
    reload: reloadMeetingHistory,
  } = useUnifiedProjectMeetingHistory(id, {
    enabled: Boolean(id),
    summary: true,
    projectName: project?.project_name || project_name,
  });

  const loadProjectDocuments = useCallback(async ({
    forceRefresh = false,
    backend = documentStorageBackend,
  } = {}) => {
    if (!id) return;

    try {
      const userId = getUserId();

      if (backend === STORAGE_BACKEND.GOOGLE_DRIVE) {
        const document = await retrieveDriveDocumentFromMcp({
          projectId: id,
          projectName: project?.project_name || project_name,
          forceRefresh,
        });
        setDriveDocument(document);
        setNotionDocument(null);
        setStoredDocuments([]);
      } else if (backend === STORAGE_BACKEND.NOTION) {
        const document = await retrieveNotionDocumentFromApi({
          projectId: id,
          projectName: project?.project_name || project_name,
          userId,
          forceRefresh,
        });
        setNotionDocument(document);
        setDriveDocument(null);
        setStoredDocuments([]);
      } else {
        setDriveDocument(null);
        setNotionDocument(null);
        setStoredDocuments([]);
      }
    } catch {
      setDriveDocument(null);
      setNotionDocument(null);
      setStoredDocuments([]);
    }
  }, [documentStorageBackend, id, project?.project_name, project_name]);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    const initializeProjectPage = async () => {
      const userId = getUserId();
      const documentStorage = await fetchProjectDocumentStorage(id, userId);
      if (cancelled) return;

      const backend = documentStorage.backend || STORAGE_BACKEND.SUPABASE;
      setDocumentStorageBackend(backend);

      try {
        if (backend === STORAGE_BACKEND.GOOGLE_DRIVE) {
          const document = await retrieveDriveDocumentFromMcp({
            projectId: id,
            projectName: project?.project_name || project_name,
          });
          if (cancelled) return;
          setDriveDocument(document);
          setNotionDocument(null);
          setStoredDocuments([]);
        } else if (backend === STORAGE_BACKEND.NOTION) {
          const document = await retrieveNotionDocumentFromApi({
            projectId: id,
            projectName: project?.project_name || project_name,
            userId,
          });
          if (cancelled) return;
          setNotionDocument(document);
          setDriveDocument(null);
          setStoredDocuments([]);
        } else {
          setDriveDocument(null);
          setNotionDocument(null);
          setStoredDocuments([]);
        }
      } catch {
        if (cancelled) return;
        setDriveDocument(null);
        setNotionDocument(null);
        setStoredDocuments([]);
      }
    };

    initializeProjectPage();

    return () => {
      cancelled = true;
    };
  }, [id, project?.project_name, project_name]);

  const handleImportSuccess = () => {
    loadProjectDocuments({ forceRefresh: true });
    reloadMeetingHistory({ forceRefresh: true });
  };

  const handleDeleteMeeting = async (meeting) => {
    if (!isSupabaseMeeting(meeting)) {
      throw new Error("Only Supabase meetings can be deleted from this page.");
    }

    const documentId = meeting.document?._id || meeting.document?.id;

    await dispatch(
      deleteProjectMeeting({
        projectId: id,
        meetingId: meeting.meeting_id,
        documentId,
        isImport: Boolean(meeting.is_import),
      })
    ).unwrap();
  };

  const handleDownloadMeetingPdf = async (doc) => {
    const documentId = doc?._id || doc?.id;
    if (!documentId) {
      throw new Error("Document not found.");
    }

    let fullDoc = doc;
    if (
      !fullDoc?.generated_sections &&
      !fullDoc?.generatedSections &&
      !String(documentId).startsWith("notion-") &&
      !String(documentId).startsWith("google-drive-")
    ) {
      const result = await dispatch(getGeneratedDocumentById(documentId)).unwrap();
      fullDoc = result?.document;
    }

    if (!fullDoc) {
      throw new Error("Document not found.");
    }

    const downloaded = downloadDocPDF(fullDoc);
    if (!downloaded) {
      throw new Error("No document content available to download.");
    }
  };

  const handleStartInstantMeeting = () => {
    message.info("Starting instant meeting...");
    navigate(`/create-meeting/${project_name}/${id}`, { state: { from: location.pathname } });
  };

  const openDocumentPage = (doc, state = undefined) => {
    navigate(`/project_details/${project_name}/${id}/document/${doc._id}`, { state });
  };

  const driveDocumentItem = driveDocument
    ? buildGeneratedDocumentFromDriveDocument({
        driveDocument,
        projectId: id,
        projectName: project?.project_name || project_name,
      })
    : null;

  const notionDocumentItem = notionDocument
    ? buildGeneratedDocumentFromNotionDocument({
        notionDocument,
        projectId: id,
        projectName: project?.project_name || project_name,
      })
    : null;

  const handleOpenDocument = (doc, extraState = {}) => {
    const meetingMatch = meetingHistory.find(
      (meeting) =>
        meeting.document?._id === doc._id ||
        meeting.meeting_id === doc.meeting_id ||
        meeting.meeting_id === doc.meetingId
    );
    const mergedState = {
      meetingId:
        doc.meeting_id ||
        doc.meetingId ||
        meetingMatch?.meeting_id ||
        null,
      meetingTranscript: meetingMatch?.transcript || null,
      ...extraState,
      from: location.pathname,
    };

    if (doc.source === "google_drive") {
      openDocumentPage(doc, { driveDocument: doc, ...mergedState });
      return;
    }
    if (doc.source === "notion") {
      openDocumentPage(doc, { notionDocument: doc, ...mergedState });
      return;
    }

    openDocumentPage(doc, mergedState);
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6">
      <div className="mb-2">
        <Breadcrumb
          style={{
            margin: "20px",
            marginLeft: "40px",
          }}
        >
          <Breadcrumb.Item>
            <HomeFilled />
            <Link to="/">Projects List</Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <Link>{project_name}</Link>
          </Breadcrumb.Item>
        </Breadcrumb>
      </div>

      <TranscriptImportPanel
        projectId={id}
        projectName={project_name}
        documentTemplate={project?.template_document}
        existingDocument={driveDocumentItem || notionDocumentItem || storedDocuments[0] || null}
        onStartMeeting={handleStartInstantMeeting}
        onImportSuccess={handleImportSuccess}
      />

      <Card className="w-full shadow-sm mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <ApiOutlined className="text-blue-500 text-lg" />
            </div>
            <div>
              <Title level={5} className="mb-1">
                MCP Configuration
              </Title>
              <Text type="secondary">
                Configure project-wise GitHub, Notion, and Google Drive MCP tools for realtime meetings.
              </Text>
            </div>
          </div>
          <Button
            type="primary"
            icon={<ApiOutlined />}
            onClick={() => navigate(`/${project_name}/${id}/connectors`)}
          >
            Configure MCP
          </Button>
        </div>
      </Card>

      <MeetingHistoryPanel
        meetings={meetingHistory}
        loading={loadingMeetingHistory}
        loadingSources={loadingSources}
        loadingExternal={loadingExternal}
        onOpenDocument={handleOpenDocument}
        onDeleteMeeting={handleDeleteMeeting}
        onDownloadPdf={handleDownloadMeetingPdf}
      />
    </div>
  );
};

export default ProjectDetails;
