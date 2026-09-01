/**
 * Fetch/build documents stored in Google Drive via MCP.
 * File: src/utils/googleDriveMcpDocuments.js
 */
import { socketURL } from "../services/meeting/socketInstance";
import { getUserId } from "../services/auth/GetLoginUserId";
import {
  getDocumentVersion,
  parseStoredDocumentVersionHistory,
} from "./projectDocumentStorage";

export const DRIVE_DOCUMENT_TITLE_PREFIX = "MARARE Project Document";
export const MEETING_DOCUMENT_TITLE_PREFIX = "MARARE Meeting";
const driveDocumentCache = new Map();

export const getCacheKey = (projectId, projectName = "") => `${projectId}:${projectName || ""}`;

export const getDriveDocumentTitle = (projectId) =>
  `${DRIVE_DOCUMENT_TITLE_PREFIX} - ${projectId}`;

export const getDriveMeetingDocumentTitle = (meetingId) =>
  `${MEETING_DOCUMENT_TITLE_PREFIX} - ${meetingId}`;

export const normalizeDriveStoredDocument = (raw, { projectId, projectName } = {}) => {
  if (!raw || typeof raw !== "object") return null;
  if (raw.found === false) return null;

  const payload =
    raw.document && typeof raw.document === "object" && raw.found !== undefined
      ? raw.document
      : raw.document || raw;

  if (!payload || typeof payload !== "object") return null;

  return {
    ...raw,
    document: payload,
    fileName:
      raw.fileName ||
      payload.title ||
      (projectId ? getDriveDocumentTitle(projectId) : ""),
    fileId: raw.fileId,
    modifiedTime: raw.modifiedTime || payload.updatedAt,
    webViewLink: raw.webViewLink,
    source: raw.source || payload.source || "google_drive_rest",
    projectId: payload.projectId || projectId,
    projectName: payload.projectName || projectName,
  };
};

export const getCachedDriveDocument = ({ projectId, projectName }) => {
  if (!projectId) return null;
  const key = getCacheKey(projectId, projectName);
  if (driveDocumentCache.has(key)) return driveDocumentCache.get(key);

  try {
    const cached = sessionStorage.getItem(`marare_drive_document:${key}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

export const setCachedDriveDocument = ({ projectId, projectName, document }) => {
  if (!projectId || !document) return;
  const key = getCacheKey(projectId, projectName);
  driveDocumentCache.set(key, document);
  try {
    sessionStorage.setItem(`marare_drive_document:${key}`, JSON.stringify(document));
  } catch {
    // Ignore storage quota/private mode failures; in-memory cache still works.
  }
};

export const clearCachedDriveDocument = ({ projectId, projectName }) => {
  if (!projectId) return;
  const key = getCacheKey(projectId, projectName);
  driveDocumentCache.delete(key);
  try {
    sessionStorage.removeItem(`marare_drive_document:${key}`);
  } catch {
    // Ignore storage failures.
  }
};

export const saveMeetingDocumentToDrive = async ({
  projectId,
  projectName,
  userId = getUserId(),
  documentPayload,
  title,
}) => {
  if (!projectId || !userId) {
    throw new Error("project_id and user_id are required.");
  }
  if (!projectName) {
    throw new Error("project_name is required.");
  }
  if (!documentPayload || typeof documentPayload !== "object") {
    throw new Error("document payload is required.");
  }

  const response = await fetch(`${socketURL}/sendmcpmessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "drive_save_document",
      project_id: projectId,
      project_name: projectName,
      user_id: userId,
      title: title || getDriveDocumentTitle(projectId),
      document: documentPayload,
    }),
  });

  const result = await response.json();
  if (!response.ok || result.success === false) {
    throw new Error(result.error || result.details || "Failed to save document to Google Drive.");
  }

  clearCachedDriveDocument({ projectId, projectName });

  const meetingId = documentPayload?.meetingId || documentPayload?.meeting_id;
  const retrievedDocument = await retrieveDriveDocumentFromMcp({
    projectId,
    projectName,
    userId,
    meetingId: meetingId ? String(meetingId) : undefined,
    forceRefresh: true,
  });

  if (!retrievedDocument) {
    throw new Error("Document saved but could not be retrieved from Google Drive.");
  }

  return retrievedDocument;
};

export const retrieveDriveDocumentFromMcp = async ({
  projectId,
  projectName,
  userId = getUserId(),
  meetingId,
  forceRefresh = false,
}) => {
  if (!projectId || !userId) return null;
  const cacheKey = meetingId
    ? `${getCacheKey(projectId, projectName)}:meeting:${meetingId}`
    : getCacheKey(projectId, projectName);

  if (!forceRefresh) {
    if (meetingId) {
      try {
        const cached = sessionStorage.getItem(`marare_drive_meeting_document:${cacheKey}`);
        if (cached) return JSON.parse(cached);
      } catch {
        // Ignore cache read failures.
      }
    } else {
      const cached = getCachedDriveDocument({ projectId, projectName });
      if (cached) return cached;
    }
  }

  const response = await fetch(`${socketURL}/sendmcpmessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "drive_retrieve_document",
      project_id: projectId,
      project_name: projectName,
      user_id: userId,
      meeting_id: meetingId ? String(meetingId) : undefined,
    }),
  });

  const result = await response.json();
  if (!response.ok || result.success === false) {
    throw new Error(result.error || result.details || "Failed to retrieve Google Drive document.");
  }

  const normalizedDocument = normalizeDriveStoredDocument(result.document, {
    projectId,
    projectName,
  });
  if (!normalizedDocument) return null;

  if (meetingId) {
    try {
      sessionStorage.setItem(
        `marare_drive_meeting_document:${cacheKey}`,
        JSON.stringify(normalizedDocument),
      );
    } catch {
      // Ignore storage failures.
    }
  } else {
    setCachedDriveDocument({ projectId, projectName, document: normalizedDocument });
  }
  return normalizedDocument;
};

export const buildGeneratedDocumentFromDriveDocument = ({
  driveDocument,
  projectId,
  projectName,
}) => {
  const storedDocument = driveDocument?.document || driveDocument;
  if (!storedDocument) return null;

  let sections = [];
  const sectionsJson = storedDocument.sectionsJson || storedDocument.sections_json;
  if (sectionsJson) {
    try {
      const parsed = JSON.parse(sectionsJson);
      if (Array.isArray(parsed)) sections = parsed;
    } catch {
      sections = [];
    }
  } else if (Array.isArray(storedDocument.sections)) {
    sections = storedDocument.sections;
  }

  const normalizedSections = sections.map((section, index) => ({
    id: section.id || `google_drive_section_${index + 1}`,
    title: section.title || `Section ${index + 1}`,
    category: section.category || "google_drive",
    categoryTitle: section.categoryTitle || section.category || "Google Drive",
    content: section.content || "",
  }));

  const categories = normalizedSections.reduce((acc, section) => {
    if (!acc[section.category]) {
      acc[section.category] = { title: section.categoryTitle || section.category };
    }
    return acc;
  }, {});

  const versionHistory = parseStoredDocumentVersionHistory(storedDocument);
  const version = getDocumentVersion(storedDocument, 1);
  const meetingId = String(
    storedDocument.meetingId || storedDocument.meeting_id || "",
  ).trim();

  return {
    _id: meetingId ? `google-drive-${meetingId}` : `google-drive-${projectId}`,
    meeting_id: meetingId || undefined,
    meetingId: meetingId || undefined,
    driveFileId: driveDocument.fileId,
    webViewLink: driveDocument.webViewLink,
    source: "google_drive",
    project_id: projectId,
    project_name: storedDocument.projectName || projectName,
    document_id: storedDocument.documentId || getDriveDocumentTitle(projectId),
    title: storedDocument.title || getDriveDocumentTitle(projectId),
    created_at: driveDocument.modifiedTime || storedDocument.updatedAt,
    updatedAt: storedDocument.updatedAt,
    version,
    version_history: versionHistory,
    versionHistory,
    version_created_at:
      storedDocument.versionCreatedAt ||
      storedDocument.version_created_at ||
      storedDocument.updatedAt,
    template: {
      categories,
      sections: normalizedSections.map((section) => ({
        id: section.id,
        title: section.title,
        category: section.category,
      })),
    },
    generated_sections: Object.fromEntries(
      normalizedSections.map((section) => [section.id, section.content || ""]),
    ),
    rawDriveDocument: storedDocument,
  };
};

export const getDriveDocumentPreview = (content = "", maxLength = 420) => {
  const text = String(content || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
};
