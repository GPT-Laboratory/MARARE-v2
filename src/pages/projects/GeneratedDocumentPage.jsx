/**
 * View/edit a single generated document.
 * File: src/pages/projects/GeneratedDocumentPage.jsx
 */
import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  HomeFilled,
  LoadingOutlined,
  PlusOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  getDocumentsByProject,
  getMeetingTranscript,
  updateGeneratedDocument,
} from '../../features/mainStates/Template_Slice';
import { useTheme } from '../../context/ThemeContext.jsx';
import MeetingTranscriptPanel from '../../components/documents/MeetingTranscriptPanel';
import {
  buildDocumentSections,
  buildSavePayload,
  downloadDocPDF,
} from '../../utils/documentUtils';
import { socketURL } from '../../services/meeting/socketInstance';
import { getUserId } from '../../services/auth/GetLoginUserId';
import {
  buildGeneratedDocumentFromDriveDocument,
  retrieveDriveDocumentFromMcp,
  setCachedDriveDocument,
} from '../../utils/googleDriveMcpDocuments';
import {
  extractEmbeddedMeetingTranscript,
  parseDriveDocumentMeetingId,
  parseNotionDocumentMeetingId,
} from '../../utils/meetingTranscriptUtils';
import {
  buildGeneratedDocumentFromNotionDocument,
  retrieveNotionDocumentFromApi,
  saveMeetingDocumentToNotion,
  setCachedNotionDocument,
} from '../../utils/notionMcpDocuments';

const { Title, Text } = Typography;
const { TextArea } = Input;

const formatContent = (content) => {
  if (!content) return null;
  const clean = content.replace(/\*\*([^*]+)\*\*/g, "$1");
  return clean.split("\n").map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} style={{ height: 8 }} />;
    if (t.startsWith("- "))
      return (
        <div
          key={i}
          style={{ paddingLeft: 20, marginBottom: 4, display: "flex" }}
        >
          <span style={{ marginRight: 8, color: "#1890ff" }}>•</span>
          <span>{t.slice(2)}</span>
        </div>
      );
    const num = t.match(/^(\d+)\.\s+(.*)$/);
    if (num)
      return (
        <div
          key={i}
          style={{ paddingLeft: 20, marginBottom: 4, display: "flex" }}
        >
          <span
            style={{
              marginRight: 8,
              fontWeight: "bold",
              color: "#1890ff",
              minWidth: 20,
            }}
          >
            {num[1]}.
          </span>
          <span>{num[2]}</span>
        </div>
      );
    return (
      <div key={i} style={{ marginBottom: 8 }}>
        {t}
      </div>
    );
  });
};

const GeneratedDocumentPage = () => {
  const { isDarkMode } = useTheme();
  const { project_name, id, documentId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [documentSections, setDocumentSections] = useState([]);
  const [activeAccordionKeys, setActiveAccordionKeys] = useState([]);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editedContent, setEditedContent] = useState("");
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [meetingTranscript, setMeetingTranscript] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [activeMeetingId, setActiveMeetingId] = useState(null);

  const projectDetailsPath = `/project_details/${project_name}/${id}`;
  const endMeetingPath = `/endmeeting/${id}`;
  const returnPath =
    location.state?.from === endMeetingPath
      ? endMeetingPath
      : projectDetailsPath;

  const isDriveDocumentId = (value = "") =>
    String(value).startsWith("google-drive-") || String(value).startsWith("MARARE Project Document");

  const isNotionDocumentId = (value = "") => String(value).startsWith("notion-");

  const setDocumentForDisplay = (doc) => {
    setSelectedDoc(doc);
    const sections = buildDocumentSections(doc);
    setDocumentSections(sections);
    setActiveAccordionKeys(sections.slice(0, 3).map((s) => s.id));
    setHasUnsavedChanges(false);
  };

  const loadDocument = async () => {
    setLoading(true);
    try {
      const stateDriveDoc = location.state?.driveDocument;
      if (stateDriveDoc?.source === "google_drive") {
        setDocumentForDisplay(stateDriveDoc);
        return;
      }

      const stateNotionDoc = location.state?.notionDocument;
      if (stateNotionDoc?.source === "notion") {
        setDocumentForDisplay(stateNotionDoc);
        return;
      }

      if (isDriveDocumentId(documentId)) {
        const meetingId = parseDriveDocumentMeetingId(documentId, id);
        const driveDocument = await retrieveDriveDocumentFromMcp({
          projectId: id,
          projectName: project_name,
          meetingId: meetingId || undefined,
          forceRefresh: true,
        });
        const generatedDoc = buildGeneratedDocumentFromDriveDocument({
          driveDocument,
          projectId: id,
          projectName: project_name,
        });
        if (!generatedDoc) {
          message.error("Google Drive document not found");
          navigate(projectDetailsPath);
          return;
        }
        setDocumentForDisplay(generatedDoc);
        return;
      }

      if (isNotionDocumentId(documentId)) {
        const meetingId = parseNotionDocumentMeetingId(documentId);
        const notionDocument = await retrieveNotionDocumentFromApi({
          projectId: id,
          projectName: project_name,
          userId: getUserId(),
          meetingId: meetingId || undefined,
          forceRefresh: true,
        });
        const generatedDoc = buildGeneratedDocumentFromNotionDocument({
          notionDocument,
          projectId: id,
          projectName: project_name,
        });
        if (!generatedDoc) {
          message.error("Notion document not found");
          navigate(projectDetailsPath);
          return;
        }
        setDocumentForDisplay(generatedDoc);
        return;
      }

      const result = await dispatch(getDocumentsByProject(id)).unwrap();
      const docs = result?.documents || [];
      const doc = docs.find((d) => d._id === documentId);
      if (!doc) {
        message.error("Document not found");
        navigate(projectDetailsPath);
        return;
      }
      setDocumentForDisplay(doc);
    } catch {
      message.error("Failed to load document");
      navigate(projectDetailsPath);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id && documentId) {
      loadDocument();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, documentId]);

  useEffect(() => {
    const navTranscript = location.state?.meetingTranscript;
    const navMeetingId =
      location.state?.meetingId ||
      selectedDoc?.meeting_id ||
      selectedDoc?.meetingId ||
      parseDriveDocumentMeetingId(documentId, id) ||
      parseNotionDocumentMeetingId(documentId) ||
      null;

    setActiveMeetingId(navMeetingId);

    if (navTranscript?.entries?.length > 0) {
      setMeetingTranscript(navTranscript);
      setLoadingTranscript(false);
      return;
    }

    const embeddedTranscript = extractEmbeddedMeetingTranscript(selectedDoc);
    if (embeddedTranscript?.entries?.length > 0) {
      setMeetingTranscript(embeddedTranscript);
      setLoadingTranscript(false);
      return;
    }

    if (
      selectedDoc?.source === "google_drive" ||
      selectedDoc?.source === "notion"
    ) {
      setMeetingTranscript(null);
      setLoadingTranscript(false);
      return;
    }

    if (!navMeetingId || String(navMeetingId).startsWith("import-")) {
      setMeetingTranscript(null);
      setLoadingTranscript(false);
      return;
    }

    let cancelled = false;
    const loadTranscript = async () => {
      setLoadingTranscript(true);
      try {
        const result = await dispatch(getMeetingTranscript(navMeetingId)).unwrap();
        if (!cancelled) {
          setMeetingTranscript(result?.transcript || null);
        }
      } catch {
        if (!cancelled) {
          setMeetingTranscript(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingTranscript(false);
        }
      }
    };

    loadTranscript();
    return () => {
      cancelled = true;
    };
  }, [
    dispatch,
    location.state?.meetingTranscript,
    location.state?.meetingId,
    documentId,
    id,
    selectedDoc,
    selectedDoc?.meeting_id,
    selectedDoc?.meetingId,
  ]);

  const handleBack = () => {
    if (hasUnsavedChanges) {
      message.warning("Please save your changes before leaving this page");
      return;
    }
    navigate(returnPath);
  };

  const persistDocumentSections = async (sections, successMessage) => {
    if (selectedDoc?.source === "google_drive") {
      setIsSaving(true);
      try {
        const normalizedSections = sections.map((section, index) => ({
          id: section.id || `google_drive_section_${index + 1}`,
          title: section.title || `Section ${index + 1}`,
          category: section.category || "google_drive",
          categoryTitle: section.categoryTitle || section.category || "Google Drive",
          content: section.content || "",
        }));

        const documentPayload = {
          ...(selectedDoc.rawDriveDocument || {}),
          schemaVersion: 1,
          documentId: selectedDoc.document_id,
          type: "meeting_document",
          title: selectedDoc.title || selectedDoc.project_name || project_name,
          projectId: id,
          projectName: selectedDoc.project_name || project_name,
          updatedAt: new Date().toISOString(),
          sectionsJson: JSON.stringify(normalizedSections),
        };

        const response = await fetch(`${socketURL}/sendmcpmessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: "drive_save_document",
            project_id: id,
            project_name: selectedDoc.project_name || project_name,
            user_id: getUserId(),
            document: documentPayload,
          }),
        });
        const result = await response.json();
        if (!response.ok || result.success === false) {
          throw new Error(result.error || result.details || "Failed to save Google Drive document");
        }

        const updatedDoc = buildGeneratedDocumentFromDriveDocument({
          driveDocument: result.document,
          projectId: id,
          projectName: selectedDoc.project_name || project_name,
        });
        if (updatedDoc) {
          setCachedDriveDocument({
            projectId: id,
            projectName: selectedDoc.project_name || project_name,
            document: result.document,
          });
          setSelectedDoc(updatedDoc);
          setDocumentSections(buildDocumentSections(updatedDoc));
        }
        setHasUnsavedChanges(false);
        message.success(successMessage);
        return true;
      } catch (error) {
        console.error("Error saving Google Drive document:", error);
        message.error(error?.message || "Failed to save Google Drive document");
        return false;
      } finally {
        setIsSaving(false);
      }
    }

    if (selectedDoc?.source === "notion") {
      setIsSaving(true);
      try {
        const normalizedSections = sections.map((section, index) => ({
          id: section.id || `notion_section_${index + 1}`,
          title: section.title || `Section ${index + 1}`,
          category: section.category || "notion",
          categoryTitle: section.categoryTitle || section.category || "Notion",
          content: section.content || "",
        }));

        const documentPayload = {
          ...(selectedDoc.rawNotionDocument || {}),
          schemaVersion: 1,
          documentId: selectedDoc.document_id,
          type: "meeting_document",
          title: selectedDoc.title || selectedDoc.project_name || project_name,
          projectId: id,
          projectName: selectedDoc.project_name || project_name,
          updatedAt: new Date().toISOString(),
          sectionsJson: JSON.stringify(normalizedSections),
        };

        const retrievedDocument = await saveMeetingDocumentToNotion({
          projectId: id,
          projectName: selectedDoc.project_name || project_name,
          userId: getUserId(),
          documentPayload,
        });

        const updatedDoc = buildGeneratedDocumentFromNotionDocument({
          notionDocument: retrievedDocument,
          projectId: id,
          projectName: selectedDoc.project_name || project_name,
        });
        if (updatedDoc) {
          setCachedNotionDocument({
            projectId: id,
            projectName: selectedDoc.project_name || project_name,
            document: retrievedDocument,
          });
          setSelectedDoc(updatedDoc);
          setDocumentSections(buildDocumentSections(updatedDoc));
        }
        setHasUnsavedChanges(false);
        message.success(successMessage);
        return true;
      } catch (error) {
        console.error("Error saving Notion document:", error);
        message.error(error?.message || "Failed to save Notion document");
        return false;
      } finally {
        setIsSaving(false);
      }
    }

    const docId = selectedDoc?._id;
    if (!docId) {
      message.warning("No document found to save");
      return false;
    }

    setIsSaving(true);
    try {
      const { generatedSections, template, removedKeys } = buildSavePayload(
        sections,
        selectedDoc
      );

      const result = await dispatch(
        updateGeneratedDocument({
          documentId: docId,
          updateData: {
            generatedSections,
            template,
            removedKeys,
            projectName: selectedDoc.project_name || project_name,
          },
        })
      ).unwrap();

      const updatedDoc = result?.document || {
        ...selectedDoc,
        generated_sections: generatedSections,
        template,
      };

      setSelectedDoc(updatedDoc);
      setDocumentSections(buildDocumentSections(updatedDoc));
      setHasUnsavedChanges(false);
      message.success(successMessage);
      return true;
    } catch (error) {
      console.error("Error saving document:", error);
      message.error(
        error?.message || error?.error || "Failed to save document"
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSection = async (sectionId) => {
    const updatedSections = documentSections.map((section) =>
      section.id === sectionId
        ? { ...section, content: editedContent }
        : section
    );
    setDocumentSections(updatedSections);

    const saved = await persistDocumentSections(
      updatedSections,
      "Section saved successfully"
    );
    if (saved) {
      setEditingSectionId(null);
      setEditedContent("");
    }
  };

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
    const saved = await persistDocumentSections(
      sectionsToSave,
      "All changes saved successfully"
    );
    if (saved) {
      setEditingSectionId(null);
      setEditedContent("");
    }
  };

  const handleAddSection = (category, categoryTitle) => {
    const newSection = {
      id: `section_${Date.now()}`,
      title: "New Section",
      category,
      categoryTitle,
      content: "",
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
    setEditedContent("");
    setHasUnsavedChanges(true);
  };

  const handleDeleteSection = async (sectionId) => {
    const updatedSections = documentSections.filter(
      (section) => section.id !== sectionId
    );
    const saved = await persistDocumentSections(
      updatedSections,
      "Section deleted successfully"
    );
    if (!saved) return;

    if (editingSectionId === sectionId) {
      setEditingSectionId(null);
      setEditedContent("");
    }
    if (editingTitleId === sectionId) {
      setEditingTitleId(null);
      setEditedTitle("");
    }
    setActiveAccordionKeys((prev) => prev.filter((key) => key !== sectionId));
  };

  const handleDownloadPDF = () => {
    if (!selectedDoc) return;
    downloadDocPDF({
      ...selectedDoc,
      template: {
        ...(selectedDoc.template || {}),
        sections: documentSections.map((s) => ({
          id: s.id,
          title: s.title,
          category: s.category,
        })),
      },
      generated_sections: Object.fromEntries(
        documentSections.map((s) => [s.id, s.content || ""])
      ),
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spin size="large" />
      </div>
    );
  }

  if (!selectedDoc) return null;

  let lastCategory = null;

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 pb-16">
      <Breadcrumb className="mb-6">
        <Breadcrumb.Item>
          <HomeFilled />
          <Link to="/">Projects</Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <Link to={projectDetailsPath}>{project_name}</Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>Document</Breadcrumb.Item>
      </Breadcrumb>

      {/* Page header */}
      <div
        className={`sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-4 mb-6 backdrop-blur border-b ${
          isDarkMode
            ? "bg-gray-900/95 border-gray-700"
            : "bg-white/95 border-gray-200"
        }`}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={handleBack}
                className="shrink-0 mt-1"
              >
                Back
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileTextOutlined className="text-blue-500 text-lg" />
                  <Title level={3} className="!mb-0 !text-xl md:!text-2xl">
                    {selectedDoc.project_name || project_name}
                  </Title>
                  {selectedDoc.source === "google_drive" ? (
                    <Tag color="green">Google Drive</Tag>
                  ) : selectedDoc.source === "notion" ? (
                    <Tag color="purple">Notion</Tag>
                  ) : (
                    <Tag color="geekblue">v{selectedDoc.version || 1}</Tag>
                  )}
                  {hasUnsavedChanges && <Tag color="orange">Unsaved</Tag>}
                </div>
                {selectedDoc.created_at && (
                  <Text type="secondary" className="text-sm flex items-center gap-1 mt-1">
                    <CalendarOutlined />
                    {new Date(selectedDoc.created_at).toLocaleString()}
                  </Text>
                )}
              </div>
            </div>

            <Space wrap className="shrink-0">
              {hasUnsavedChanges && (
                <Button
                  type="primary"
                  icon={isSaving ? <LoadingOutlined /> : <SaveOutlined />}
                  onClick={handleSaveAllChanges}
                  loading={isSaving}
                  style={{ backgroundColor: "#52c41a", borderColor: "#52c41a" }}
                >
                  Save All
                </Button>
              )}
              <Button
                type="primary"
                danger
                icon={<FilePdfOutlined />}
                onClick={handleDownloadPDF}
              >
                Download PDF
              </Button>
            </Space>
          </div>

          {hasUnsavedChanges && (
            <Alert
              type="warning"
              showIcon
              message="You have unsaved changes"
              description="Save your edits before going back to the project."
              className="!mb-0"
            />
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">
      {/* Document sections */}
      <Card className="shadow-sm" bordered={false}>
        {documentSections.length === 0 ? (
          <Empty description="No sections yet. Add a section to get started." />
        ) : (
          <Collapse
            activeKey={activeAccordionKeys}
            onChange={(keys) => setActiveAccordionKeys(keys)}
            style={{ background: "transparent", border: "none" }}
            expandIconPosition="end"
          >
            {documentSections.map((section, index) => {
              const isNewCategory = section.category !== lastCategory;
              if (isNewCategory) lastCategory = section.category;
              const isEditing = editingSectionId === section.id;

              return (
                <React.Fragment key={section.id}>
                  {isNewCategory && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        marginTop: index === 0 ? 0 : 16,
                        marginBottom: 8,
                        background: isDarkMode ? "#172554" : "#e6f7ff",
                        borderRadius: 6,
                        borderLeft: "4px solid #1890ff",
                        fontWeight: 700,
                        fontSize: 13,
                        color: isDarkMode ? "#93c5fd" : "#1890ff",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      <span>
                        {section.categoryTitle ||
                          section.category?.replace(/_/g, " ")}
                      </span>
                      <Button
                        type="dashed"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() =>
                          handleAddSection(
                            section.category,
                            section.categoryTitle ||
                              section.category?.replace(/_/g, " ")
                          )
                        }
                        style={{
                          color: isDarkMode ? "#93c5fd" : "#1890ff",
                          borderColor: isDarkMode ? "#3b82f6" : "#91caff",
                        }}
                      >
                        Add Section
                      </Button>
                    </div>
                  )}
                  <Collapse.Panel
                    key={section.id}
                    header={
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          width: "100%",
                          paddingRight: 8,
                        }}
                      >
                        {editingTitleId === section.id ? (
                          <Space.Compact onClick={(e) => e.stopPropagation()}>
                            <Input
                              value={editedTitle}
                              onChange={(e) => setEditedTitle(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: 220 }}
                            />
                            <Button
                              size="small"
                              type="primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDocumentSections((prev) =>
                                  prev.map((s) =>
                                    s.id === section.id
                                      ? {
                                          ...s,
                                          title:
                                            editedTitle.trim() || s.title,
                                        }
                                      : s
                                  )
                                );
                                setEditingTitleId(null);
                                setEditedTitle("");
                                setHasUnsavedChanges(true);
                              }}
                            >
                              OK
                            </Button>
                          </Space.Compact>
                        ) : (
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: 14,
                              color: isDarkMode ? "#e5e7eb" : "#333",
                            }}
                          >
                            {index + 1}. {section.title}
                          </span>
                        )}
                        <Space size="small" onClick={(e) => e.stopPropagation()}>
                          {isEditing ? (
                            <>
                              <Button
                                type="primary"
                                size="small"
                                icon={
                                  isSaving ? (
                                    <LoadingOutlined />
                                  ) : (
                                    <SaveOutlined />
                                  )
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSaveSection(section.id);
                                }}
                                loading={isSaving}
                                style={{
                                  backgroundColor: "#52c41a",
                                  borderColor: "#52c41a",
                                }}
                              >
                                Save
                              </Button>
                              <Button
                                size="small"
                                icon={<CloseOutlined />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingSectionId(null);
                                  setEditedContent("");
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
                                  setEditingTitleId(section.id);
                                  setEditedTitle(section.title);
                                }}
                              >
                                Rename
                              </Button>
                              <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingSectionId(section.id);
                                  setEditedContent(section.content || "");
                                  if (
                                    !activeAccordionKeys.includes(section.id)
                                  ) {
                                    setActiveAccordionKeys([
                                      ...activeAccordionKeys,
                                      section.id,
                                    ]);
                                  }
                                }}
                                style={{
                                  color: isDarkMode ? "#60a5fa" : "#1890ff",
                                }}
                              >
                                Edit
                              </Button>
                              <Popconfirm
                                title="Delete this section?"
                                description="This action cannot be undone."
                                okText="Delete"
                                cancelText="Cancel"
                                okButtonProps={{ danger: true }}
                                onConfirm={() => handleDeleteSection(section.id)}
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Delete
                                </Button>
                              </Popconfirm>
                            </>
                          )}
                        </Space>
                      </div>
                    }
                    style={{
                      marginBottom: 8,
                      borderRadius: 8,
                      border: isEditing
                        ? "2px solid #1890ff"
                        : `1px solid ${isDarkMode ? "#334155" : "#e8e8e8"}`,
                      background: isEditing
                        ? isDarkMode
                          ? "#16351f"
                          : "#f6ffed"
                        : isDarkMode
                          ? "#111827"
                          : "#fafafa",
                      overflow: "hidden",
                    }}
                  >
                    {isEditing ? (
                      <TextArea
                        value={editedContent}
                        onChange={(e) => {
                          setEditedContent(e.target.value);
                          setHasUnsavedChanges(true);
                        }}
                        autoSize={{ minRows: 8, maxRows: 24 }}
                        style={{ fontSize: 14, lineHeight: 1.6, borderRadius: 6 }}
                        placeholder="Enter section content..."
                      />
                    ) : (
                      <div
                        style={{
                          fontSize: 14,
                          lineHeight: 1.8,
                          color: isDarkMode ? "#e5e7eb" : "#333",
                          padding: "8px 12px",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          setEditingSectionId(section.id);
                          setEditedContent(section.content || "");
                          if (!activeAccordionKeys.includes(section.id)) {
                            setActiveAccordionKeys([
                              ...activeAccordionKeys,
                              section.id,
                            ]);
                          }
                        }}
                        title="Click to edit"
                      >
                        {section.content ? (
                          formatContent(section.content)
                        ) : (
                          <span
                            style={{
                              color: isDarkMode ? "#94a3b8" : "#bbb",
                              fontStyle: "italic",
                            }}
                          >
                            Click to add content...
                          </span>
                        )}
                      </div>
                    )}
                  </Collapse.Panel>
                </React.Fragment>
              );
            })}
          </Collapse>
        )}
      </Card>
        </div>

        {(meetingTranscript?.entries || []).length > 0 && (
        <aside className="w-full lg:w-[380px] xl:w-[420px] shrink-0 lg:sticky lg:top-24 self-start">
          <MeetingTranscriptPanel
            transcript={meetingTranscript}
            meetingId={activeMeetingId}
            projectName={selectedDoc.project_name || project_name}
            loading={loadingTranscript}
            isDarkMode={isDarkMode}
          />
        </aside>
        )}
      </div>
    </div>
  );
};

export default GeneratedDocumentPage;
