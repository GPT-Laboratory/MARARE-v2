/**
 * Helpers for Supabase document ID validation and filtering.
 * File: src/utils/documentStorageRecords.js
 */
const EXTERNAL_DOCUMENT_ID_PREFIXES = ["google-drive-", "notion-"];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isSupabaseDocumentId = (value) => {
  const id = String(value || "").trim();
  if (!id) return false;
  if (EXTERNAL_DOCUMENT_ID_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return false;
  }
  return UUID_PATTERN.test(id);
};

export const isExternalDocumentRecord = (doc) => {
  if (!doc || typeof doc !== "object") return false;

  const source = String(doc.source || doc.storage_source || doc.storageSource || "")
    .trim()
    .toLowerCase();

  if (
    source === "google_drive" ||
    source === "google_drive_rest" ||
    source === "notion" ||
    source === "notion_mcp"
  ) {
    return true;
  }

  const id = String(doc._id || doc.id || "");
  return EXTERNAL_DOCUMENT_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
};

export const filterSupabaseProjectDocuments = (docs = []) =>
  (docs || []).filter((doc) => !isExternalDocumentRecord(doc));

export const resolveSupabaseDocumentForMeeting = (docs = [], meetingId) => {
  if (!meetingId) return null;

  return (
    filterSupabaseProjectDocuments(docs).find(
      (doc) =>
        String(doc.meeting_id || doc.meetingId || "") === String(meetingId),
    ) || null
  );
};

export const resolveSupabaseExistingDocument = (doc, meetingId) => {
  if (!doc || isExternalDocumentRecord(doc)) return null;
  if (!isSupabaseDocumentId(doc._id || doc.id)) return null;

  if (!meetingId) return doc;

  const docMeetingId = String(doc.meeting_id || doc.meetingId || "");
  if (docMeetingId && docMeetingId !== String(meetingId)) return null;

  return doc;
};

export const resolveSupabaseContinuationDocumentId = (documentId) =>
  isSupabaseDocumentId(documentId) ? String(documentId) : undefined;
