/**
 * Merges meeting records from Supabase, Notion, and Google Drive.
 * File: src/utils/unifiedMeetingHistory.js
 */
import axios from "axios";
import { socketURL } from "../services/meeting/socketInstance";
import { getUserId } from "../services/auth/GetLoginUserId";
import { STORAGE_BACKEND } from "./projectDocumentStorage";
import {
  filterSupabaseProjectDocuments,
  isExternalDocumentRecord,
} from "./documentStorageRecords";

export const MEETING_SOURCE = {
  SUPABASE: STORAGE_BACKEND.SUPABASE,
  NOTION: STORAGE_BACKEND.NOTION,
  GOOGLE_DRIVE: STORAGE_BACKEND.GOOGLE_DRIVE,
};

export const MEETING_SOURCE_LABELS = {
  [MEETING_SOURCE.SUPABASE]: "Supabase",
  [MEETING_SOURCE.NOTION]: "Notion",
  [MEETING_SOURCE.GOOGLE_DRIVE]: "Google Drive",
};

export const MEETING_SOURCE_COLORS = {
  [MEETING_SOURCE.SUPABASE]: "green",
  [MEETING_SOURCE.NOTION]: "default",
  [MEETING_SOURCE.GOOGLE_DRIVE]: "blue",
};

export const getMeetingStorageSource = (meeting) => {
  if (meeting?.storage_source || meeting?.storageSource) {
    return meeting.storage_source || meeting.storageSource;
  }

  const docSource = meeting?.document?.source;
  if (docSource === "notion" || docSource === "notion_mcp") {
    return MEETING_SOURCE.NOTION;
  }
  if (docSource === "google_drive" || docSource === "google_drive_rest") {
    return MEETING_SOURCE.GOOGLE_DRIVE;
  }

  return MEETING_SOURCE.SUPABASE;
};

export const getMeetingListKey = (meeting) => {
  const source = getMeetingStorageSource(meeting);
  const meetingId = meeting?.meeting_id || meeting?.document?._id || "unknown";
  return `${source}:${meetingId}`;
};

export const normalizeMeetingRecord = (meeting, storageSource) => ({
  ...meeting,
  storage_source: getMeetingStorageSource(meeting) || storageSource,
  is_external: (getMeetingStorageSource(meeting) || storageSource) !== MEETING_SOURCE.SUPABASE,
});

export const sortMeetingsByDateDesc = (meetings = []) =>
  [...meetings].sort(
    (a, b) =>
      new Date(b.created_at || b.document?.created_at || 0).getTime() -
      new Date(a.created_at || a.document?.created_at || 0).getTime()
  );

export const mergeMeetingLists = (...lists) => {
  const merged = lists.flat().filter(Boolean);
  return sortMeetingsByDateDesc(merged);
};

export const toSupabaseMeetingDocumentSummary = (doc) => {
  if (!doc) return null;

  return {
    _id: doc._id || doc.id,
    id: doc.id || doc._id,
    meeting_id: doc.meeting_id || doc.meetingId,
    project_id: doc.project_id || doc.projectId,
    project_name: doc.project_name || doc.projectName,
    meeting_agenda: doc.meeting_agenda || doc.meetingAgenda,
    version: doc.version || 1,
    created_at: doc.created_at || doc.createdAt,
    updated_at: doc.updated_at || doc.updatedAt,
    source: doc.source || MEETING_SOURCE.SUPABASE,
    storage_source: MEETING_SOURCE.SUPABASE,
  };
};

export const enrichSupabaseMeetingsWithDocuments = (
  meetings = [],
  documents = [],
) => {
  const supabaseDocuments = filterSupabaseProjectDocuments(documents);
  if (!supabaseDocuments.length) return meetings;

  return meetings.map((meeting) => {
    if (meeting.document || meeting.is_import || !meeting.meeting_id) {
      return meeting;
    }

    const doc = supabaseDocuments.find(
      (row) =>
        String(row.meeting_id || row.meetingId || "") ===
        String(meeting.meeting_id),
    );

    if (!doc || isExternalDocumentRecord(doc)) return meeting;

    return {
      ...meeting,
      document: toSupabaseMeetingDocumentSummary(doc),
    };
  });
};

const fetchMeetingsBySource = async ({
  projectId,
  userId,
  projectName,
  source,
  summary = true,
}) => {
  if (!projectId || !userId) return [];

  if (source === MEETING_SOURCE.SUPABASE) {
    const response = await axios.get(
      `${socketURL}/get-project-meeting-history/${projectId}`,
      { params: { userId, summary: summary ? "true" : "false" } }
    );
    return (response.data?.meetings || []).map((meeting) =>
      normalizeMeetingRecord(meeting, MEETING_SOURCE.SUPABASE)
    );
  }

  if (source === MEETING_SOURCE.NOTION) {
    const response = await axios.get(
      `${socketURL}/get-project-meeting-history/notion/${projectId}`,
      { params: { userId, projectName } }
    );
    return (response.data?.meetings || []).map((meeting) =>
      normalizeMeetingRecord(meeting, MEETING_SOURCE.NOTION)
    );
  }

  if (source === MEETING_SOURCE.GOOGLE_DRIVE) {
    const params = { userId };
    if (projectName) {
      params.projectName = projectName;
    }
    const response = await axios.get(
      `${socketURL}/get-project-meeting-history/google-drive/${projectId}`,
      { params }
    );
    return (response.data?.meetings || []).map((meeting) =>
      normalizeMeetingRecord(meeting, MEETING_SOURCE.GOOGLE_DRIVE)
    );
  }

  return [];
};

export const fetchSupabaseMeetingHistory = (projectId, options = {}) =>
  fetchMeetingsBySource({
    projectId,
    userId: options.userId || getUserId(),
    projectName: options.projectName,
    source: MEETING_SOURCE.SUPABASE,
    summary: options.summary !== false,
  });

export const fetchNotionMeetingHistory = (projectId, options = {}) =>
  fetchMeetingsBySource({
    projectId,
    userId: options.userId || getUserId(),
    projectName: options.projectName,
    source: MEETING_SOURCE.NOTION,
    summary: options.summary !== false,
  });

export const fetchGoogleDriveMeetingHistory = (projectId, options = {}) =>
  fetchMeetingsBySource({
    projectId,
    userId: options.userId || getUserId(),
    projectName: options.projectName,
    source: MEETING_SOURCE.GOOGLE_DRIVE,
    summary: options.summary !== false,
  });

export const isSupabaseMeeting = (meeting) =>
  getMeetingStorageSource(meeting) === MEETING_SOURCE.SUPABASE;

export const getMeetingSourceLabel = (meeting) =>
  MEETING_SOURCE_LABELS[getMeetingStorageSource(meeting)] || "Unknown";

export const getMeetingSourceColor = (meeting) =>
  MEETING_SOURCE_COLORS[getMeetingStorageSource(meeting)] || "default";
