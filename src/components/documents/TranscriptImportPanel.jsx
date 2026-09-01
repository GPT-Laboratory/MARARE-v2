/**
 * Upload or paste meeting transcripts to import into a project.
 * File: src/components/documents/TranscriptImportPanel.jsx
 */
import React, { useState } from "react";
import {
  Button,
  Card,
  Progress,
  Typography,
  Upload,
  message,
  Alert,
  Tag,
} from "antd";
import {
  InboxOutlined,
  FileTextOutlined,
  CloudUploadOutlined,
  VideoCameraOutlined,
  FileWordOutlined,
  CloseOutlined,
  PictureOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import { useDispatch } from "react-redux";
import {
  importMultiSourceDocument,
  importPregeneratedDocument,
  importTranscriptAndGenerateDocument,
} from '../../features/mainStates/Template_Slice';
import { getUserId } from "../../services/auth/GetLoginUserId";
import { useTheme } from "../../context/ThemeContext.jsx";

const { Text } = Typography;

const SINGLE_FILE_TYPES = ".txt,.pdf,.docx";
const MULTI_FILE_TYPES = ".txt,.pdf,.docx,.jpg,.jpeg,.png,.webp,.gif";
const MAX_FILE_SIZE_MB = 15;
const MAX_MULTI_FILES = 15;
const MAX_MULTI_TOTAL_MB = 30;

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const cardSurface = (isDarkMode) =>
  isDarkMode
    ? "bg-slate-900/60 border-slate-700/80"
    : "bg-white border-gray-200";

const accentSurfaces = {
  blue: (isDarkMode) =>
    isDarkMode
      ? "from-blue-950/50 to-slate-900/80 border-blue-800/40"
      : "from-blue-50/90 to-white border-blue-100",
  emerald: (isDarkMode) =>
    isDarkMode
      ? "from-emerald-950/50 to-slate-900/80 border-emerald-800/40"
      : "from-emerald-50/90 to-white border-emerald-100",
  violet: (isDarkMode) =>
    isDarkMode
      ? "from-violet-950/50 to-slate-900/80 border-violet-800/40"
      : "from-violet-50/90 to-white border-violet-100",
  amber: (isDarkMode) =>
    isDarkMode
      ? "from-amber-950/50 to-slate-900/80 border-amber-800/40"
      : "from-amber-50/90 to-white border-amber-100",
};

const OptionHeader = ({ icon, iconClass, title, hint, isDarkMode }) => (
  <div className="flex items-center gap-2.5 mb-3">
    <div
      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <Text
        strong
        className={`block text-sm leading-tight ${
          isDarkMode ? "text-slate-100" : "text-gray-900"
        }`}
      >
        {title}
      </Text>
      <Text
        className={`text-xs leading-snug ${
          isDarkMode ? "text-slate-400" : "text-gray-500"
        }`}
      >
        {hint}
      </Text>
    </div>
  </div>
);

const FileRow = ({ file, onRemove, disabled, isDarkMode, accentText, isImage }) => (
  <div
    className={`flex items-center gap-2 px-2 py-1 rounded-md border text-xs ${
      isDarkMode
        ? "bg-slate-800/80 border-slate-600 text-slate-200"
        : "bg-gray-50 border-gray-200 text-gray-700"
    }`}
  >
    {isImage ? (
      <PictureOutlined className={`shrink-0 ${accentText}`} />
    ) : (
      <FileTextOutlined className={`shrink-0 ${accentText}`} />
    )}
    <span className="truncate flex-1 min-w-0">{file.name}</span>
    <span className={`shrink-0 ${isDarkMode ? "text-slate-500" : "text-gray-400"}`}>
      {formatFileSize(file.size)}
    </span>
    <Button
      type="text"
      size="small"
      icon={<CloseOutlined />}
      onClick={() => onRemove(file)}
      disabled={disabled}
      className="!min-w-0 !w-6 !h-6 shrink-0"
    />
  </div>
);

const ImportUploadCard = ({
  title,
  hint,
  icon,
  iconClass,
  accent,
  accentText,
  draggerBorder,
  buttonColor,
  buttonLabel,
  selectedFile,
  onFileSelect,
  onFileRemove,
  importing,
  importProgress,
  importStep,
  onSubmit,
  hasTemplate,
  disabled,
  isDarkMode,
}) => {
  const handleBeforeUpload = (file) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["txt", "pdf", "docx"].includes(extension)) {
      message.error("Only .txt, .pdf, and .docx files are supported");
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      message.error(`File must be smaller than ${MAX_FILE_SIZE_MB} MB`);
      return Upload.LIST_IGNORE;
    }
    onFileSelect(file);
    return false;
  };

  const draggerClass = isDarkMode
    ? `[&_.ant-upload-drag]:!bg-slate-800/50 [&_.ant-upload-drag]:!border-slate-600 [&_.ant-upload-drag]:hover:!border-slate-500 [&_.ant-upload-text]:!text-slate-200 [&_.ant-upload-hint]:!text-slate-500`
    : `[&_.ant-upload-drag]:!bg-white/80 ${draggerBorder}`;

  return (
    <div
      className={`rounded-lg border p-4 h-full flex flex-col bg-gradient-to-br ${accentSurfaces[accent](isDarkMode)}`}
    >
      <OptionHeader
        icon={icon}
        iconClass={iconClass}
        title={title}
        hint={hint}
        isDarkMode={isDarkMode}
      />

      <Upload.Dragger
        accept={SINGLE_FILE_TYPES}
        multiple={false}
        showUploadList={false}
        beforeUpload={handleBeforeUpload}
        disabled={disabled || importing || !hasTemplate}
        className={`!mb-0 ${draggerClass}`}
        style={{ padding: 0 }}
      >
        <div className="py-3 px-2">
          <InboxOutlined className={`text-lg mb-1 ${accentText}`} />
          <p className="ant-upload-text !text-xs !mb-0 font-medium">
            Drop file or click to browse
          </p>
          <p className="ant-upload-hint !text-[11px] !mt-0.5">
            txt · pdf · docx · {MAX_FILE_SIZE_MB}MB max
          </p>
        </div>
      </Upload.Dragger>

      {selectedFile && (
        <div className="mt-2">
          <FileRow
            file={selectedFile}
            onRemove={onFileRemove}
            disabled={importing}
            isDarkMode={isDarkMode}
            accentText={accentText}
          />
        </div>
      )}

      {importing && (
        <div className="mt-2.5 space-y-1">
          <Progress
            percent={importProgress}
            size="small"
            status="active"
            strokeColor={buttonColor.stroke}
            showInfo={false}
          />
          <Text
            className={`text-[11px] block ${
              isDarkMode ? "text-slate-400" : "text-gray-500"
            }`}
          >
            {importStep}
          </Text>
        </div>
      )}

      <Button
        type="primary"
        size="middle"
        block
        icon={<CloudUploadOutlined />}
        onClick={onSubmit}
        loading={importing}
        disabled={!selectedFile || !hasTemplate}
        className="mt-3"
        style={{
          backgroundColor: selectedFile ? buttonColor.bg : undefined,
          borderColor: selectedFile ? buttonColor.bg : undefined,
        }}
      >
        {buttonLabel}
      </Button>
    </div>
  );
};

const MultiSourceUploadCard = ({
  files,
  onFilesChange,
  importing,
  importProgress,
  importStep,
  onSubmit,
  hasTemplate,
  disabled,
  isDarkMode,
}) => {
  const isImageFile = (name) =>
    /\.(jpg|jpeg|png|webp|gif)$/i.test(name || "");

  const handleBeforeUpload = (file) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const allowed = ["txt", "pdf", "docx", "jpg", "jpeg", "png", "webp", "gif"];
    if (!allowed.includes(extension)) {
      message.error("Unsupported file type");
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      message.error(`Each file must be under ${MAX_FILE_SIZE_MB} MB`);
      return Upload.LIST_IGNORE;
    }
    if (files.length >= MAX_MULTI_FILES) {
      message.error(`Maximum ${MAX_MULTI_FILES} files allowed`);
      return Upload.LIST_IGNORE;
    }
    const totalSize = files.reduce((sum, f) => sum + f.size, 0) + file.size;
    if (totalSize > MAX_MULTI_TOTAL_MB * 1024 * 1024) {
      message.error(`Total size must be under ${MAX_MULTI_TOTAL_MB} MB`);
      return Upload.LIST_IGNORE;
    }
    onFilesChange([...files, file]);
    return false;
  };

  const draggerClass = isDarkMode
    ? `[&_.ant-upload-drag]:!bg-slate-800/50 [&_.ant-upload-drag]:!border-amber-700/60 [&_.ant-upload-drag]:hover:!border-amber-500 [&_.ant-upload-text]:!text-slate-200 [&_.ant-upload-hint]:!text-slate-500`
    : "[&_.ant-upload-drag]:!bg-white/80 [&_.ant-upload-drag]:!border-amber-300 hover:[&_.ant-upload-drag]:!border-amber-400";

  return (
    <div
      className={`rounded-lg border p-4 h-full flex flex-col bg-gradient-to-br ${accentSurfaces.amber(isDarkMode)}`}
    >
      <OptionHeader
        icon={<FolderOpenOutlined className="text-white text-base" />}
        iconClass="bg-amber-500"
        title="Import Multiple Sources"
        hint="Images + docs + transcripts together"
        isDarkMode={isDarkMode}
      />

      <Upload.Dragger
        accept={MULTI_FILE_TYPES}
        multiple
        showUploadList={false}
        beforeUpload={handleBeforeUpload}
        disabled={disabled || importing || !hasTemplate}
        className={`!mb-0 ${draggerClass}`}
        style={{ padding: 0 }}
      >
        <div className="py-3 px-2">
          <InboxOutlined className="text-lg mb-1 text-amber-500" />
          <p className="ant-upload-text !text-xs !mb-0 font-medium">
            Drop multiple files or click to browse
          </p>
          <p className="ant-upload-hint !text-[11px] !mt-0.5">
            docs · images · transcripts · max {MAX_MULTI_FILES} files · {MAX_MULTI_TOTAL_MB}MB total
          </p>
        </div>
      </Upload.Dragger>

      {files.length > 0 && (
        <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
          {files.map((file) => (
            <FileRow
              key={`${file.name}-${file.size}-${file.lastModified}`}
              file={file}
              onRemove={(f) =>
                onFilesChange(
                  files.filter(
                    (item) =>
                      item.name !== f.name ||
                      item.size !== f.size ||
                      item.lastModified !== f.lastModified
                  )
                )
              }
              disabled={importing}
              isDarkMode={isDarkMode}
              accentText="text-amber-500"
              isImage={isImageFile(file.name)}
            />
          ))}
        </div>
      )}

      {importing && (
        <div className="mt-2.5 space-y-1">
          <Progress
            percent={importProgress}
            size="small"
            status="active"
            strokeColor={{ from: "#f59e0b", to: "#d97706" }}
            showInfo={false}
          />
          <Text
            className={`text-[11px] block ${
              isDarkMode ? "text-slate-400" : "text-gray-500"
            }`}
          >
            {importStep}
          </Text>
        </div>
      )}

      <Button
        type="primary"
        size="middle"
        block
        icon={<CloudUploadOutlined />}
        onClick={onSubmit}
        loading={importing}
        disabled={files.length === 0 || !hasTemplate}
        className="mt-3"
        style={{
          backgroundColor: files.length ? "#d97706" : undefined,
          borderColor: files.length ? "#d97706" : undefined,
        }}
      >
        Generate from {files.length || "All"} Files
      </Button>
    </div>
  );
};

const TranscriptImportPanel = ({
  projectId,
  projectName,
  documentTemplate,
  existingDocument,
  onImportSuccess,
  onStartMeeting,
}) => {
  const { isDarkMode } = useTheme();
  const dispatch = useDispatch();
  const userId = getUserId();

  const [transcriptFile, setTranscriptFile] = useState(null);
  const [documentFile, setDocumentFile] = useState(null);
  const [multiFiles, setMultiFiles] = useState([]);

  const usePreviousOnImport = Boolean(existingDocument);

  const [transcriptImporting, setTranscriptImporting] = useState(false);
  const [documentImporting, setDocumentImporting] = useState(false);
  const [multiImporting, setMultiImporting] = useState(false);

  const [transcriptProgress, setTranscriptProgress] = useState(0);
  const [documentProgress, setDocumentProgress] = useState(0);
  const [multiProgress, setMultiProgress] = useState(0);
  const [transcriptStep, setTranscriptStep] = useState("");
  const [documentStep, setDocumentStep] = useState("");
  const [multiStep, setMultiStep] = useState("");

  const hasTemplate =
    Array.isArray(documentTemplate?.sections) &&
    documentTemplate.sections.length > 0;

  const runProgressSimulation = (setProgress, setStep, steps) => {
    setProgress(10);
    const timers = steps.map(({ at, value, step }) =>
      setTimeout(() => {
        setProgress(value);
        setStep(step);
      }, at)
    );
    return () => timers.forEach(clearTimeout);
  };

  const handleTranscriptImport = async () => {
    if (!transcriptFile) {
      message.warning("Please select a transcript file first");
      return;
    }
    if (!hasTemplate || !userId) {
      message.error(
        !userId ? "You must be logged in" : "No document template configured"
      );
      return;
    }

    setTranscriptImporting(true);
    setTranscriptProgress(5);
    setTranscriptStep("Processing…");

    const clearTimers = runProgressSimulation(setTranscriptProgress, setTranscriptStep, [
      { at: 800, value: 35, step: "Analyzing transcript…" },
      { at: 2500, value: 60, step: "Generating sections…" },
      { at: 5000, value: 85, step: "Saving document…" },
    ]);

    let succeeded = false;
    try {
      const result = await dispatch(
        importTranscriptAndGenerateDocument({
          file: transcriptFile,
          userId,
          projectId,
          projectName,
          documentTemplate,
          previousSections: usePreviousOnImport
            ? existingDocument?.generated_sections || {}
            : {},
          usePreviousDocument: usePreviousOnImport,
          existingDocumentId: usePreviousOnImport
            ? existingDocument?._id
            : undefined,
        })
      ).unwrap();

      succeeded = true;
      setTranscriptProgress(100);
      message.success("Document generated from transcript");
      setTranscriptFile(null);
      onImportSuccess?.(result.document);
    } catch (error) {
      message.error(
        error?.message || error?.error || "Failed to generate document"
      );
    } finally {
      clearTimers();
      setTimeout(() => {
        setTranscriptImporting(false);
        if (!succeeded) {
          setTranscriptProgress(0);
          setTranscriptStep("");
        }
      }, 800);
    }
  };

  const handleDocumentImport = async () => {
    if (!documentFile) {
      message.warning("Please select a document file first");
      return;
    }
    if (!hasTemplate || !userId) {
      message.error(
        !userId ? "You must be logged in" : "No document template configured"
      );
      return;
    }

    setDocumentImporting(true);
    setDocumentProgress(5);
    setDocumentStep("Processing…");

    const clearTimers = runProgressSimulation(setDocumentProgress, setDocumentStep, [
      { at: 700, value: 30, step: "Extracting text…" },
      { at: 2000, value: 55, step: "Mapping to template…" },
      { at: 5000, value: 85, step: "Saving document…" },
    ]);

    let succeeded = false;
    try {
      const result = await dispatch(
        importPregeneratedDocument({
          file: documentFile,
          userId,
          projectId,
          projectName,
          documentTemplate,
          previousSections: usePreviousOnImport
            ? existingDocument?.generated_sections || {}
            : {},
          usePreviousDocument: usePreviousOnImport,
          existingDocumentId: usePreviousOnImport
            ? existingDocument?._id
            : undefined,
        })
      ).unwrap();

      succeeded = true;
      setDocumentProgress(100);
      message.success("Document imported and mapped to template");
      setDocumentFile(null);
      onImportSuccess?.(result.document);
    } catch (error) {
      message.error(error?.message || error?.error || "Failed to import document");
    } finally {
      clearTimers();
      setTimeout(() => {
        setDocumentImporting(false);
        if (!succeeded) {
          setDocumentProgress(0);
          setDocumentStep("");
        }
      }, 800);
    }
  };

  const handleMultiSourceImport = async () => {
    if (multiFiles.length === 0) {
      message.warning("Please add at least one file");
      return;
    }
    if (!hasTemplate || !userId) {
      message.error(
        !userId ? "You must be logged in" : "No document template configured"
      );
      return;
    }

    setMultiImporting(true);
    setMultiProgress(5);
    setMultiStep(`Extracting ${multiFiles.length} files…`);

    const clearTimers = runProgressSimulation(setMultiProgress, setMultiStep, [
      { at: 1000, value: 25, step: "Reading documents & transcripts…" },
      { at: 3000, value: 45, step: "Analyzing images…" },
      { at: 6000, value: 70, step: "Synthesizing template sections…" },
      { at: 10000, value: 90, step: "Saving final document…" },
    ]);

    let succeeded = false;
    try {
      const result = await dispatch(
        importMultiSourceDocument({
          files: multiFiles,
          userId,
          projectId,
          projectName,
          documentTemplate,
          previousSections: usePreviousOnImport
            ? existingDocument?.generated_sections || {}
            : {},
          usePreviousDocument: usePreviousOnImport,
          existingDocumentId: usePreviousOnImport
            ? existingDocument?._id
            : undefined,
        })
      ).unwrap();

      succeeded = true;
      setMultiProgress(100);
      message.success(
        `Document created from ${result.fileCount} file(s)`
      );
      setMultiFiles([]);
      onImportSuccess?.(result.document);
    } catch (error) {
      message.error(error?.message || error?.error || "Failed to import files");
    } finally {
      clearTimers();
      setTimeout(() => {
        setMultiImporting(false);
        if (!succeeded) {
          setMultiProgress(0);
          setMultiStep("");
        }
      }, 800);
    }
  };

  const anyImporting =
    transcriptImporting || documentImporting || multiImporting;

  return (
    <Card
      className={`w-full mb-6 shadow-sm ${cardSurface(isDarkMode)}`}
      bordered
      styles={{ body: { padding: "16px 20px" } }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <Text
            strong
            className={`text-base ${isDarkMode ? "text-slate-100" : "text-gray-900"}`}
          >
            Create your document
          </Text>
          <Text
            className={`text-xs block mt-0.5 ${
              isDarkMode ? "text-slate-400" : "text-gray-500"
            }`}
          >
            Live meeting, transcript, single document, or multiple sources
          </Text>
        </div>
        {existingDocument && (
          <Tag color="geekblue" className="!text-xs">
            Current doc v{existingDocument.version || 1}
          </Tag>
        )}
      </div>

      {!hasTemplate && (
        <Alert
          type="warning"
          showIcon
          className="!mb-4 !py-2"
          message="Configure a document template for this project before importing."
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-stretch">
        <div
          className={`rounded-lg border p-4 h-full flex flex-col bg-gradient-to-br ${accentSurfaces.blue(isDarkMode)}`}
        >
          <OptionHeader
            icon={<VideoCameraOutlined className="text-white text-base" />}
            iconClass="bg-blue-500"
            title="Live Meeting"
            hint="AI builds the doc while you talk"
            isDarkMode={isDarkMode}
          />
          <Text
            className={`text-xs mb-3 flex-1 ${
              isDarkMode ? "text-slate-400" : "text-gray-500"
            }`}
          >
            Real-time capture and section generation.
          </Text>
          <Button
            type="primary"
            block
            icon={<VideoCameraOutlined />}
            onClick={onStartMeeting}
            disabled={anyImporting}
          >
            Start Meeting
          </Button>
        </div>

        <ImportUploadCard
          title="Import Transcript"
          hint="Conversation → AI writes sections"
          icon={<CloudUploadOutlined className="text-white text-base" />}
          iconClass="bg-emerald-500"
          accent="emerald"
          accentText="text-emerald-500"
          draggerBorder="[&_.ant-upload-drag]:!border-emerald-300 hover:[&_.ant-upload-drag]:!border-emerald-400"
          buttonColor={{ bg: "#059669", stroke: { from: "#10b981", to: "#059669" } }}
          buttonLabel="Generate from Transcript"
          selectedFile={transcriptFile}
          onFileSelect={setTranscriptFile}
          onFileRemove={() => setTranscriptFile(null)}
          importing={transcriptImporting}
          importProgress={transcriptProgress}
          importStep={transcriptStep}
          onSubmit={handleTranscriptImport}
          hasTemplate={hasTemplate}
          disabled={documentImporting || multiImporting}
          isDarkMode={isDarkMode}
        />

        <ImportUploadCard
          title="Import Document"
          hint="Finished doc → map to template"
          icon={<FileWordOutlined className="text-white text-base" />}
          iconClass="bg-violet-500"
          accent="violet"
          accentText="text-violet-500"
          draggerBorder="[&_.ant-upload-drag]:!border-violet-300 hover:[&_.ant-upload-drag]:!border-violet-400"
          buttonColor={{ bg: "#7c3aed", stroke: { from: "#8b5cf6", to: "#7c3aed" } }}
          buttonLabel="Import & Map"
          selectedFile={documentFile}
          onFileSelect={setDocumentFile}
          onFileRemove={() => setDocumentFile(null)}
          importing={documentImporting}
          importProgress={documentProgress}
          importStep={documentStep}
          onSubmit={handleDocumentImport}
          hasTemplate={hasTemplate}
          disabled={transcriptImporting || multiImporting}
          isDarkMode={isDarkMode}
        />

        <MultiSourceUploadCard
          files={multiFiles}
          onFilesChange={setMultiFiles}
          importing={multiImporting}
          importProgress={multiProgress}
          importStep={multiStep}
          onSubmit={handleMultiSourceImport}
          hasTemplate={hasTemplate}
          disabled={transcriptImporting || documentImporting}
          isDarkMode={isDarkMode}
        />
      </div>
    </Card>
  );
};

export default TranscriptImportPanel;
