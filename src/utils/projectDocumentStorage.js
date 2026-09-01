/**
 * Resolves where project documents are stored (Supabase/Drive/Notion).
 * File: src/utils/projectDocumentStorage.js
 */
import { socketURL } from "../services/meeting/socketInstance";
import { getUserId } from "../services/auth/GetLoginUserId";

export const STORAGE_BACKEND = {
  GOOGLE_DRIVE: "google_drive",
  NOTION: "notion",
  SUPABASE: "supabase",
  /** @deprecated use STORAGE_BACKEND.SUPABASE */
  MONGODB: "supabase",
};

const defaultDocumentStorage = {
  backend: STORAGE_BACKEND.SUPABASE,
  preference: STORAGE_BACKEND.SUPABASE,
  availableBackends: [STORAGE_BACKEND.SUPABASE],
  notionReady: false,
  googleDriveReady: false,
  supabaseFallback: true,
};

const STORAGE_CACHE_TTL_MS = 60 * 1000;
const storageCache = new Map();

export const fetchProjectDocumentStorage = async (
  projectId,
  userId = getUserId(),
  { forceRefresh = false } = {},
) => {
  if (!projectId || !userId) return defaultDocumentStorage;

  const cacheKey = `${projectId}:${userId}`;
  const cached = storageCache.get(cacheKey);
  const cacheIsFresh =
    cached?.result &&
    !forceRefresh &&
    Date.now() - (cached.fetchedAt || 0) < STORAGE_CACHE_TTL_MS;

  if (cacheIsFresh) {
    return cached.result;
  }

  if (cached?.promise && !forceRefresh) {
    return cached.promise;
  }

  const promise = (async () => {
    try {
      const response = await fetch(
        `${socketURL}/mcp/configurations/${projectId}?user_id=${encodeURIComponent(userId)}`,
      );
      const data = await response.json();
      return data?.documentStorage || defaultDocumentStorage;
    } catch {
      return defaultDocumentStorage;
    }
  })();

  storageCache.set(cacheKey, {
    promise,
    result: cached?.result || null,
    fetchedAt: cached?.fetchedAt || 0,
  });

  const result = await promise;
  storageCache.set(cacheKey, {
    promise: null,
    result,
    fetchedAt: Date.now(),
  });
  return result;
};

export const resolveDocumentStorageBackend = async (
  projectId,
  userId = getUserId(),
) => {
  const storage = await fetchProjectDocumentStorage(projectId, userId);
  return storage.backend || STORAGE_BACKEND.SUPABASE;
};

/** @deprecated use resolveDocumentStorageBackend */
export const fetchGoogleDriveEnabledForProject = async (projectId, userId = getUserId()) => {
  const storage = await fetchProjectDocumentStorage(projectId, userId);
  return storage.backend === STORAGE_BACKEND.GOOGLE_DRIVE;
};

export const updateDocumentStoragePreference = async ({
  projectId,
  userId = getUserId(),
  preference,
}) => {
  const response = await fetch(`${socketURL}/mcp/document-storage-preference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      user_id: userId,
      preference,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Failed to update document storage preference.");
  }
  return data.documentStorage;
};

export const parseStoredDocumentVersionHistory = (storedDocument) => {
  if (!storedDocument || typeof storedDocument !== "object") return [];

  const versionHistory =
    storedDocument.version_history || storedDocument.versionHistory || [];
  if (Array.isArray(versionHistory) && versionHistory.length > 0) {
    return versionHistory.filter((entry) => entry && typeof entry === "object");
  }

  const revisionJson =
    storedDocument.revisionHistoryJson || storedDocument.revision_history_json;
  if (!revisionJson) {
    if (storedDocument.version) {
      return [
        {
          version: storedDocument.version,
          createdAt:
            storedDocument.versionCreatedAt ||
            storedDocument.version_created_at ||
            storedDocument.updatedAt ||
            storedDocument.updated_at,
        },
      ];
    }
    return [];
  }

  try {
    const rows =
      typeof revisionJson === "string" ? JSON.parse(revisionJson) : revisionJson;
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        const revision = String(row?.revision || "");
        const digits = revision.replace(/\D/g, "");
        if (!digits) return null;
        return {
          version: Number.parseInt(digits, 10),
          createdAt: row?.date || row?.createdAt || "",
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const buildRevisionHistoryTableRows = (versionHistory = []) =>
  versionHistory.map((entry) => ({
    date: entry?.createdAt
      ? new Date(entry.createdAt).toLocaleDateString()
      : new Date().toLocaleDateString(),
    revision: `v${entry?.version || 1}`,
  }));

/** Default revision row for a new document (first meeting / v1). */
export const buildDefaultRevisionHistoryRows = (version = 1) =>
  buildRevisionHistoryTableRows([
    { version, createdAt: new Date().toISOString() },
  ]);

export const getDocumentVersion = (storedDocument, fallback = 1) => {
  const version = storedDocument?.version;
  if (version == null || Number.isNaN(Number(version))) return fallback;
  return Number(version);
};
