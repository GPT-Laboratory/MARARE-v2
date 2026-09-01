/**
 * Fetch/build documents stored in Notion via MCP.
 * File: src/utils/notionMcpDocuments.js
 */
import { socketURL } from "../services/meeting/socketInstance";
import { getUserId } from "../services/auth/GetLoginUserId";
import {
  getDocumentVersion,
  parseStoredDocumentVersionHistory,
} from "./projectDocumentStorage";
import {
  buildGeneratedDocumentFromDriveDocument,
  getDriveDocumentTitle,
  MEETING_DOCUMENT_TITLE_PREFIX,
} from "./googleDriveMcpDocuments";

export const NOTION_DOCUMENT_TITLE_PREFIX = "MARARE Project Document";
const notionDocumentCache = new Map();

const getCacheKey = (projectId, projectName = "") => `${projectId}:${projectName || ""}`;

export const getNotionDocumentTitle = (projectId) =>
  `${NOTION_DOCUMENT_TITLE_PREFIX} - ${projectId}`;

export const normalizeNotionStoredDocument = (raw, { projectId, projectName } = {}) => {
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
    pageId: raw.pageId,
    url: raw.url,
    source: raw.source || payload.source || "notion_mcp",
    projectId: payload.projectId || projectId,
    projectName: payload.projectName || projectName,
  };
};

export const getCachedNotionDocument = ({ projectId, projectName }) => {
  if (!projectId) return null;
  const key = getCacheKey(projectId, projectName);
  if (notionDocumentCache.has(key)) return notionDocumentCache.get(key);

  try {
    const cached = sessionStorage.getItem(`marare_notion_document:${key}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

export const setCachedNotionDocument = ({ projectId, projectName, document }) => {
  if (!projectId || !document) return;
  const key = getCacheKey(projectId, projectName);
  notionDocumentCache.set(key, document);
  try {
    sessionStorage.setItem(`marare_notion_document:${key}`, JSON.stringify(document));
  } catch {
    // Ignore storage failures.
  }
};

export const clearCachedNotionDocument = ({ projectId, projectName }) => {
  if (!projectId) return;
  const key = getCacheKey(projectId, projectName);
  notionDocumentCache.delete(key);
  try {
    sessionStorage.removeItem(`marare_notion_document:${key}`);
  } catch {
    // Ignore storage failures.
  }
};

export const saveMeetingDocumentToNotion = async ({
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
      task: "notion_save_document",
      project_id: projectId,
      project_name: projectName,
      user_id: userId,
      title: title || getNotionDocumentTitle(projectId),
      document: documentPayload,
    }),
  });

  const result = await response.json();
  if (!response.ok || result.success === false) {
    throw new Error(result.error || result.details || "Failed to save document to Notion.");
  }

  clearCachedNotionDocument({ projectId, projectName });

  const meetingId = documentPayload?.meetingId || documentPayload?.meeting_id;
  const retrievedDocument = await retrieveNotionDocumentFromApi({
    projectId,
    projectName,
    userId,
    meetingId: meetingId ? String(meetingId) : undefined,
    forceRefresh: true,
  });

  if (!retrievedDocument) {
    throw new Error("Document saved but could not be retrieved from Notion.");
  }

  return retrievedDocument;
};

export const retrieveNotionDocumentFromApi = async ({
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
        const cached = sessionStorage.getItem(`marare_notion_meeting_document:${cacheKey}`);
        if (cached) return JSON.parse(cached);
      } catch {
        // Ignore cache read failures.
      }
    } else {
      const cached = getCachedNotionDocument({ projectId, projectName });
      if (cached) return cached;
    }
  }

  const response = await fetch(`${socketURL}/sendmcpmessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "notion_retrieve_document",
      project_id: projectId,
      project_name: projectName,
      user_id: userId,
      meeting_id: meetingId ? String(meetingId) : undefined,
    }),
  });

  const result = await response.json();
  if (!response.ok || result.success === false) {
    throw new Error(result.error || result.details || "Failed to retrieve Notion document.");
  }

  const normalizedDocument = normalizeNotionStoredDocument(result.document, {
    projectId,
    projectName,
  });
  if (!normalizedDocument) return null;

  if (meetingId) {
    try {
      sessionStorage.setItem(
        `marare_notion_meeting_document:${cacheKey}`,
        JSON.stringify(normalizedDocument),
      );
    } catch {
      // Ignore storage failures.
    }
  } else {
    setCachedNotionDocument({ projectId, projectName, document: normalizedDocument });
  }
  return normalizedDocument;
};

export const buildGeneratedDocumentFromNotionDocument = ({
  notionDocument,
  projectId,
  projectName,
}) => {
  const driveShaped = {
    ...notionDocument,
    fileId: notionDocument?.pageId,
    webViewLink: notionDocument?.url,
    modifiedTime: notionDocument?.document?.updatedAt || notionDocument?.updatedAt,
  };

  const generated = buildGeneratedDocumentFromDriveDocument({
    driveDocument: driveShaped,
    projectId,
    projectName,
  });

  if (!generated) return null;

  const meetingId = String(
    generated.meeting_id ||
      generated.meetingId ||
      notionDocument?.document?.meetingId ||
      notionDocument?.document?.meeting_id ||
      "",
  ).trim();

  return {
    ...generated,
    _id: meetingId ? `notion-${meetingId}` : `notion-${projectId}`,
    meeting_id: meetingId || undefined,
    meetingId: meetingId || undefined,
    notionPageId: notionDocument?.pageId,
    notionUrl: notionDocument?.url,
    source: "notion",
    document_id: notionDocument?.document?.documentId || getNotionDocumentTitle(projectId),
    title: notionDocument?.document?.title || getNotionDocumentTitle(projectId),
    rawNotionDocument: notionDocument?.document || notionDocument,
  };
};

export const buildExternalDocumentPayload = ({
  projectId,
  projectName,
  syncedTemplate,
  cleanedGeneratedSections,
  meetingId,
  meetingAgenda,
  transcriptEntries,
  transcriptFullText,
  summaryContent,
  mvpContent,
  visionContent,
  version,
  versionCreatedAt,
  revisionHistory,
}) => {
  const templateCategories = syncedTemplate?.categories || {};
  const templateSections = syncedTemplate?.sections || [];

  const normalizedSections = templateSections
    .map((section, index) => ({
      id: section.id || `section_${index + 1}`,
      title: section.title || `Section ${index + 1}`,
      category: section.category || "general",
      categoryTitle:
        templateCategories?.[section.category]?.title || section.category || "General",
      content:
        cleanedGeneratedSections[section.id] ||
        cleanedGeneratedSections[section.title?.toLowerCase().replace(/\s+/g, "_")] ||
        section.content ||
        "",
    }))
    .filter((section) => String(section.content || "").trim());

  const now = new Date().toISOString();
  const resolvedMeetingId = meetingId ? String(meetingId) : "";
  const documentTitle = resolvedMeetingId
    ? `${MEETING_DOCUMENT_TITLE_PREFIX} - ${resolvedMeetingId}`
    : getDriveDocumentTitle(projectId);

  return {
    schemaVersion: 1,
    documentId: documentTitle,
    type: "meeting_document",
    title: documentTitle,
    projectId,
    projectName: projectName || "",
    meetingId: resolvedMeetingId || undefined,
    meetingAgenda: meetingAgenda || "",
    agenda: meetingAgenda || "",
    updatedAt: now,
    sectionsJson: JSON.stringify(normalizedSections),
    transcriptEntries: Array.isArray(transcriptEntries) ? transcriptEntries : [],
    transcriptFullText: transcriptFullText || "",
    summaryContent: summaryContent || "",
    mvpContent: mvpContent || "",
    visionContent: visionContent || "",
    version: version || 1,
    versionCreatedAt: versionCreatedAt || now,
    revisionHistoryJson: JSON.stringify(revisionHistory || []),
  };
};

export { getDocumentVersion, parseStoredDocumentVersionHistory };
