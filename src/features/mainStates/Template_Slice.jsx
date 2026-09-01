/**
 * Document templates, generated docs, and meeting history caches.
 * File: src/features/mainStates/Template_Slice.jsx
 */
// Add this import at the top if not already there
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';
import { socketURL } from '../../services/meeting/socketInstance';
import { getUserId } from '../../services/auth/GetLoginUserId';
import { isSupabaseDocumentId } from '../../utils/documentStorageRecords';

const sanitizeSupabaseDocumentPayload = (documentData = {}) => {
  const payload = { ...documentData };
  if (
    payload.basedOnDocumentId &&
    !isSupabaseDocumentId(payload.basedOnDocumentId)
  ) {
    delete payload.basedOnDocumentId;
  }
  return payload;
};

export const MEETING_HISTORY_STALE_MS = 5 * 60 * 1000;
const EMPTY_MEETINGS = [];

const normalizeProjectMeetingHistoryArg = (arg) => {
  if (typeof arg === 'string') {
    return { projectId: arg, summary: true, forceRefresh: false };
  }

  return {
    projectId: arg?.projectId,
    summary: arg?.summary !== false,
    forceRefresh: Boolean(arg?.forceRefresh),
  };
};

export const selectProjectMeetingHistory = (state, projectId) =>
  state.documents.meetingHistoryByProject?.[projectId]?.meetings ?? EMPTY_MEETINGS;

export const selectProjectMeetingHistoryMeta = (state, projectId) =>
  state.documents.meetingHistoryByProject?.[projectId] ?? null;

export const selectProjectMeetingHistoryStatus = (state, projectId) =>
  state.documents.meetingHistoryStatusByProject?.[projectId] ?? 'idle';

export const selectNotionMeetingHistory = (state, projectId) =>
  state.documents.notionMeetingHistoryByProject?.[projectId]?.meetings ?? EMPTY_MEETINGS;

export const selectNotionMeetingHistoryMeta = (state, projectId) =>
  state.documents.notionMeetingHistoryByProject?.[projectId] ?? null;

export const selectNotionMeetingHistoryStatus = (state, projectId) =>
  state.documents.notionMeetingHistoryStatusByProject?.[projectId] ?? 'idle';

export const selectGoogleDriveMeetingHistory = (state, projectId) =>
  state.documents.googleDriveMeetingHistoryByProject?.[projectId]?.meetings ?? EMPTY_MEETINGS;

export const selectGoogleDriveMeetingHistoryMeta = (state, projectId) =>
  state.documents.googleDriveMeetingHistoryByProject?.[projectId] ?? null;

export const selectGoogleDriveMeetingHistoryStatus = (state, projectId) =>
  state.documents.googleDriveMeetingHistoryStatusByProject?.[projectId] ?? 'idle';

export const isMeetingHistoryCacheFresh = (meta, { summary = true } = {}) => {
  if (!meta?.fetchedAt) return false;
  if (Boolean(meta.summary) !== Boolean(summary)) return false;
  return Date.now() - meta.fetchedAt < MEETING_HISTORY_STALE_MS;
};

const normalizeExternalMeetingHistoryArg = (arg) => {
  if (typeof arg === 'string') {
    return {
      projectId: arg,
      projectName: '',
      summary: true,
      forceRefresh: false,
    };
  }

  return {
    projectId: arg?.projectId,
    projectName: arg?.projectName || '',
    summary: arg?.summary !== false,
    forceRefresh: Boolean(arg?.forceRefresh),
  };
};

const clearAllMeetingHistoryForProject = (state, projectId) => {
  if (!projectId) return;
  delete state.meetingHistoryByProject[projectId];
  delete state.meetingHistoryStatusByProject[projectId];
  delete state.notionMeetingHistoryByProject[projectId];
  delete state.notionMeetingHistoryStatusByProject[projectId];
  delete state.googleDriveMeetingHistoryByProject[projectId];
  delete state.googleDriveMeetingHistoryStatusByProject[projectId];
};

// const socketURL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

// Save generated document
export const saveGeneratedDocument = createAsyncThunk(
  "documents/saveGeneratedDocument",
  async (documentData, { rejectWithValue }) => {
    try {
      const response = await axios.post(
        `${socketURL}/save-generated-document`,
        sanitizeSupabaseDocumentPayload(documentData)
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to save document"
      );
    }
  }
);

// Get generated documents by meeting ID
export const getGeneratedDocuments = createAsyncThunk(
  "documents/getGeneratedDocuments",
  async (meetingId, { rejectWithValue }) => {
    try {
      const response = await axios.get(
        `${socketURL}/get-generated-documents/${meetingId}`
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch documents"
      );
    }
  }
);



export const getDocumentsByProject = createAsyncThunk(
  "documents/getDocumentsByProject",
  async ( id , { rejectWithValue }) => {
    const userId = getUserId();
    console.log("id", id);
    
    try {
      const response = await axios.get(
        `${socketURL}/get-documents-by-project/${id}`,
        {
          params: { userId },
        }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch project documents"
      );
    }
  }
);


// Update generated document
export const updateGeneratedDocument = createAsyncThunk(
  "documents/updateGeneratedDocument",
  async ({ documentId, updateData }, { rejectWithValue }) => {
    const userId = getUserId();
    if (!isSupabaseDocumentId(documentId)) {
      return rejectWithValue({
        message: 'Invalid Supabase document id',
        error:
          'External document ids (Google Drive / Notion) cannot be updated in Supabase.',
      });
    }
    try {
      const response = await axios.put(
        `${socketURL}/update-generated-document/${documentId}`,
        {
          userId,
          meetingId: updateData.meetingId,
          projectId: updateData.projectId,
          projectName: updateData.projectName,
          template: updateData.template,
          generatedSections: updateData.generatedSections,
          removedKeys: updateData.removedKeys,
          undiscussedTopics: updateData.undiscussedTopics,
          meetingPhase: updateData.meetingPhase,
          progress: updateData.progress,
          timestamp: updateData.timestamp,
          version: updateData.version,   // ✅ IMPORTANT
          versionCreatedAt: updateData.versionCreatedAt,
          versionHistory: updateData.versionHistory,
        }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to update document"
      );
    }
  }
);

// Import transcript file and generate document (txt, pdf, docx)
export const importTranscriptAndGenerateDocument = createAsyncThunk(
  "documents/importTranscriptAndGenerateDocument",
  async (
    { file, userId, projectId, projectName, documentTemplate, previousSections, usePreviousDocument, existingDocumentId },
    { rejectWithValue }
  ) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);
      formData.append("projectId", projectId);
      formData.append("projectName", projectName || "");
      formData.append("documentTemplate", JSON.stringify(documentTemplate || {}));
      formData.append("previousSections", JSON.stringify(previousSections || {}));
      formData.append("usePreviousDocument", String(usePreviousDocument !== false));
      if (existingDocumentId) {
        formData.append("existingDocumentId", existingDocumentId);
      }

      const response = await axios.post(
        `${socketURL}/import-transcript-generate-document`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to import transcript" }
      );
    }
  }
);

// Import pre-generated document and map into template (txt, pdf, docx)
export const importPregeneratedDocument = createAsyncThunk(
  "documents/importPregeneratedDocument",
  async (
    { file, userId, projectId, projectName, documentTemplate, previousSections, usePreviousDocument, existingDocumentId },
    { rejectWithValue }
  ) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);
      formData.append("projectId", projectId);
      formData.append("projectName", projectName || "");
      formData.append("documentTemplate", JSON.stringify(documentTemplate || {}));
      formData.append("previousSections", JSON.stringify(previousSections || {}));
      formData.append("usePreviousDocument", String(usePreviousDocument !== false));
      if (existingDocumentId) {
        formData.append("existingDocumentId", existingDocumentId);
      }

      const response = await axios.post(
        `${socketURL}/import-pregenerated-document`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to import document" }
      );
    }
  }
);

export const exportDocumentToNotion = createAsyncThunk(
  "documents/exportDocumentToNotion",
  async ({ projectId, projectName, document }, { rejectWithValue }) => {
    const userId = getUserId();
    try {
      const response = await axios.post(`${socketURL}/mcp/notion/export-document`, {
        project_id: projectId,
        user_id: userId,
        projectName,
        document,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || "Failed to export document to Notion");
    }
  }
);

// Import multiple files (docs, transcripts, images) and synthesize document
export const importMultiSourceDocument = createAsyncThunk(
  "documents/importMultiSourceDocument",
  async (
    { files, userId, projectId, projectName, documentTemplate, previousSections, usePreviousDocument, existingDocumentId },
    { rejectWithValue }
  ) => {
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("userId", userId);
      formData.append("projectId", projectId);
      formData.append("projectName", projectName || "");
      formData.append("documentTemplate", JSON.stringify(documentTemplate || {}));
      formData.append("previousSections", JSON.stringify(previousSections || {}));
      formData.append("usePreviousDocument", String(usePreviousDocument !== false));
      if (existingDocumentId) {
        formData.append("existingDocumentId", existingDocumentId);
      }

      const response = await axios.post(
        `${socketURL}/import-multi-source-document`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to import files" }
      );
    }
  }
);

// Delete generated document
const deleteGeneratedDocument = createAsyncThunk(
  "documents/deleteGeneratedDocument",
  async ({ documentId, userId }, { rejectWithValue }) => {
    try {
      await axios.delete(
        `${socketURL}/delete-generated-document/${documentId}`,
        { params: { userId } }
      );
      return documentId;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to delete document"
      );
    }
  }
);

export const saveMeetingTranscript = createAsyncThunk(
  "documents/saveMeetingTranscript",
  async (transcriptData, { rejectWithValue }) => {
    try {
      const response = await axios.post(
        `${socketURL}/save-meeting-transcript`,
        transcriptData
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to save meeting transcript"
      );
    }
  }
);

export const getProjectMeetingHistory = createAsyncThunk(
  "documents/getProjectMeetingHistory",
  async (arg, { rejectWithValue }) => {
    const { projectId, summary } = normalizeProjectMeetingHistoryArg(arg);
    const userId = getUserId();
    try {
      const response = await axios.get(
        `${socketURL}/get-project-meeting-history/${projectId}`,
        { params: { userId, summary: summary ? "true" : "false" } }
      );
      return {
        projectId,
        summary,
        meetings: response.data?.meetings || [],
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch meeting history"
      );
    }
  },
  {
    condition: (arg, { getState }) => {
      const { projectId, summary, forceRefresh } =
        normalizeProjectMeetingHistoryArg(arg);
      if (!projectId || forceRefresh) return true;
      const meta = selectProjectMeetingHistoryMeta(getState(), projectId);
      return !isMeetingHistoryCacheFresh(meta, { summary });
    },
  }
);

export const getProjectNotionMeetingHistory = createAsyncThunk(
  "documents/getProjectNotionMeetingHistory",
  async (arg, { rejectWithValue }) => {
    const { projectId, projectName, summary } =
      normalizeExternalMeetingHistoryArg(arg);
    const userId = getUserId();
    try {
      const params = { userId };
      if (projectName) {
        params.projectName = projectName;
      }
      const response = await axios.get(
        `${socketURL}/get-project-meeting-history/notion/${projectId}`,
        { params }
      );
      return {
        projectId,
        summary,
        meetings: response.data?.meetings || [],
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch Notion meeting history"
      );
    }
  },
  {
    condition: (arg, { getState }) => {
      const { projectId, summary, forceRefresh } =
        normalizeExternalMeetingHistoryArg(arg);
      if (!projectId || forceRefresh) return true;
      const meta = selectNotionMeetingHistoryMeta(getState(), projectId);
      return !isMeetingHistoryCacheFresh(meta, { summary });
    },
  }
);

export const getProjectGoogleDriveMeetingHistory = createAsyncThunk(
  "documents/getProjectGoogleDriveMeetingHistory",
  async (arg, { rejectWithValue }) => {
    const { projectId, projectName, summary } =
      normalizeExternalMeetingHistoryArg(arg);
    const userId = getUserId();
    try {
      const params = { userId };
      if (projectName) {
        params.projectName = projectName;
      }
      const response = await axios.get(
        `${socketURL}/get-project-meeting-history/google-drive/${projectId}`,
        { params }
      );
      return {
        projectId,
        summary,
        meetings: response.data?.meetings || [],
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch Google Drive meeting history"
      );
    }
  },
  {
    condition: (arg, { getState }) => {
      const { projectId, summary, forceRefresh } =
        normalizeExternalMeetingHistoryArg(arg);
      if (!projectId || forceRefresh) return true;
      const meta = selectGoogleDriveMeetingHistoryMeta(getState(), projectId);
      return !isMeetingHistoryCacheFresh(meta, { summary });
    },
  }
);

export const deleteProjectMeeting = createAsyncThunk(
  "documents/deleteProjectMeeting",
  async ({ projectId, meetingId, documentId, isImport = false }, { rejectWithValue }) => {
    const userId = getUserId();
    try {
      const response = await axios.delete(
        `${socketURL}/delete-project-meeting/${projectId}/${encodeURIComponent(meetingId)}`,
        {
          params: {
            userId,
            documentId,
            isImport: isImport ? "true" : "false",
          },
        }
      );
      return {
        projectId,
        meetingId,
        ...response.data,
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to delete meeting"
      );
    }
  }
);

export const getGeneratedDocumentById = createAsyncThunk(
  "documents/getGeneratedDocumentById",
  async (documentId, { rejectWithValue }) => {
    const userId = getUserId();
    try {
      const response = await axios.get(
        `${socketURL}/get-generated-document/${documentId}`,
        { params: { userId } }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch document"
      );
    }
  }
);

export const getMeetingTranscript = createAsyncThunk(
  "documents/getMeetingTranscript",
  async (meetingId, { rejectWithValue }) => {
    const userId = getUserId();
    try {
      const response = await axios.get(
        `${socketURL}/get-meeting-transcript/${meetingId}`,
        { params: { userId } }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch meeting transcript"
      );
    }
  }
);

// Add to your slice's reducers
export const Template_Slice = createSlice({
  name: 'documents',
  initialState: {
    generatedDocuments: [],
    currentDocument: null,
    loading: false,
    error: null,
    meetingHistoryByProject: {},
    meetingHistoryStatusByProject: {},
    notionMeetingHistoryByProject: {},
    notionMeetingHistoryStatusByProject: {},
    googleDriveMeetingHistoryByProject: {},
    googleDriveMeetingHistoryStatusByProject: {},
  },
  reducers: {
    clearDocumentError: (state) => {
      state.error = null;
    },
    clearGeneratedDocuments: (state) => {
      state.generatedDocuments = [];
    },
    invalidateProjectMeetingHistory: (state, action) => {
      clearAllMeetingHistoryForProject(state, action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      // Save document
      .addCase(saveGeneratedDocument.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveGeneratedDocument.fulfilled, (state, action) => {
        state.loading = false;
        const newDoc = action.payload?.document || action.payload;
        if (state.generatedDocuments?.documents) {
          state.generatedDocuments.documents.unshift(newDoc);
        } else {
          state.generatedDocuments = { documents: [newDoc] };
        }
        state.currentDocument = newDoc;

        const projectId = newDoc?.project_id || action.payload?.projectId;
        if (projectId) {
          clearAllMeetingHistoryForProject(state, projectId);
        }
      })
      .addCase(saveGeneratedDocument.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      
      // Get documents
      .addCase(getDocumentsByProject.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getDocumentsByProject.fulfilled, (state, action) => {
        state.loading = false;
        state.generatedDocuments = action.payload;
      })
      .addCase(getDocumentsByProject.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      
      // Delete document
      .addCase(deleteGeneratedDocument.fulfilled, (state, action) => {
        if (state.generatedDocuments?.documents) {
          state.generatedDocuments.documents = state.generatedDocuments.documents.filter(
            doc => doc._id !== action.payload
          );
        }
      })
      
      // Update document
      .addCase(updateGeneratedDocument.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateGeneratedDocument.fulfilled, (state, action) => {
        state.loading = false;
        const updatedDoc = action.payload?.document;
        if (!updatedDoc) return;

        if (!state.generatedDocuments?.documents) {
          state.generatedDocuments = { documents: [updatedDoc] };
          return;
        }

        const index = state.generatedDocuments.documents.findIndex(
          (doc) => doc._id === updatedDoc._id
        );
        if (index !== -1) {
          state.generatedDocuments.documents[index] = updatedDoc;
        } else {
          state.generatedDocuments.documents.unshift(updatedDoc);
        }
      })
      .addCase(updateGeneratedDocument.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Import transcript and generate document
      .addCase(importTranscriptAndGenerateDocument.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(importTranscriptAndGenerateDocument.fulfilled, (state, action) => {
        state.loading = false;
        const newDoc = action.payload?.document;
        if (!newDoc) return;

        if (state.generatedDocuments?.documents) {
          const index = state.generatedDocuments.documents.findIndex(
            (doc) => doc._id === newDoc._id
          );
          if (index !== -1) {
            state.generatedDocuments.documents[index] = newDoc;
          } else {
            state.generatedDocuments.documents.unshift(newDoc);
          }
        } else {
          state.generatedDocuments = { documents: [newDoc] };
        }
        state.currentDocument = newDoc;

        if (newDoc?.project_id) {
          clearAllMeetingHistoryForProject(state, newDoc.project_id);
        }
      })
      .addCase(importTranscriptAndGenerateDocument.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Import pre-generated document
      .addCase(importPregeneratedDocument.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(importPregeneratedDocument.fulfilled, (state, action) => {
        state.loading = false;
        const newDoc = action.payload?.document;
        if (!newDoc) return;

        if (state.generatedDocuments?.documents) {
          const index = state.generatedDocuments.documents.findIndex(
            (doc) => doc._id === newDoc._id
          );
          if (index !== -1) {
            state.generatedDocuments.documents[index] = newDoc;
          } else {
            state.generatedDocuments.documents.unshift(newDoc);
          }
        } else {
          state.generatedDocuments = { documents: [newDoc] };
        }
        state.currentDocument = newDoc;

        if (newDoc?.project_id) {
          clearAllMeetingHistoryForProject(state, newDoc.project_id);
        }
      })
      .addCase(importPregeneratedDocument.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Import multi-source files
      .addCase(importMultiSourceDocument.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(importMultiSourceDocument.fulfilled, (state, action) => {
        state.loading = false;
        const newDoc = action.payload?.document;
        if (!newDoc) return;

        if (state.generatedDocuments?.documents) {
          const index = state.generatedDocuments.documents.findIndex(
            (doc) => doc._id === newDoc._id
          );
          if (index !== -1) {
            state.generatedDocuments.documents[index] = newDoc;
          } else {
            state.generatedDocuments.documents.unshift(newDoc);
          }
        } else {
          state.generatedDocuments = { documents: [newDoc] };
        }
        state.currentDocument = newDoc;

        if (newDoc?.project_id) {
          clearAllMeetingHistoryForProject(state, newDoc.project_id);
        }
      })
      .addCase(importMultiSourceDocument.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Meeting history cache
      .addCase(getProjectMeetingHistory.pending, (state, action) => {
        const { projectId } = normalizeProjectMeetingHistoryArg(action.meta.arg);
        const hasCache = Boolean(state.meetingHistoryByProject[projectId]?.fetchedAt);
        state.meetingHistoryStatusByProject[projectId] = hasCache ? "refreshing" : "loading";
      })
      .addCase(getProjectMeetingHistory.fulfilled, (state, action) => {
        const { projectId, summary, meetings } = action.payload || {};
        if (!projectId) return;

        state.meetingHistoryByProject[projectId] = {
          meetings: meetings || [],
          summary: Boolean(summary),
          fetchedAt: Date.now(),
        };
        state.meetingHistoryStatusByProject[projectId] = "succeeded";
      })
      .addCase(getProjectMeetingHistory.rejected, (state, action) => {
        const { projectId } = normalizeProjectMeetingHistoryArg(action.meta.arg);
        const hasCache = Boolean(state.meetingHistoryByProject[projectId]?.fetchedAt);
        state.meetingHistoryStatusByProject[projectId] = hasCache ? "succeeded" : "failed";
      })

      .addCase(saveMeetingTranscript.fulfilled, (state, action) => {
        const projectId =
          action.payload?.transcript?.project_id || action.payload?.projectId;
        if (projectId) {
          clearAllMeetingHistoryForProject(state, projectId);
        }
      })

      .addCase(deleteProjectMeeting.pending, (state, action) => {
        const { projectId, meetingId } = action.meta.arg || {};
        if (!projectId || !meetingId) return;
        state.meetingHistoryStatusByProject[projectId] = "refreshing";
        const cache = state.meetingHistoryByProject[projectId];
        if (cache?.meetings) {
          cache.meetings = cache.meetings.filter(
            (meeting) => meeting.meeting_id !== meetingId
          );
        }
      })
      .addCase(deleteProjectMeeting.fulfilled, (state, action) => {
        const projectId = action.payload?.projectId;
        const meetingId = action.payload?.meetingId;
        if (!projectId || !meetingId) return;

        const cache = state.meetingHistoryByProject[projectId];
        if (cache?.meetings) {
          cache.meetings = cache.meetings.filter(
            (meeting) => meeting.meeting_id !== meetingId
          );
          cache.fetchedAt = Date.now();
        }
        state.meetingHistoryStatusByProject[projectId] = "succeeded";
      })
      .addCase(deleteProjectMeeting.rejected, (state, action) => {
        const { projectId } = action.meta.arg || {};
        if (projectId) {
          clearAllMeetingHistoryForProject(state, projectId);
        }
      })

      .addCase(getProjectNotionMeetingHistory.pending, (state, action) => {
        const { projectId } = normalizeExternalMeetingHistoryArg(action.meta.arg);
        const hasCache = Boolean(
          state.notionMeetingHistoryByProject[projectId]?.fetchedAt
        );
        state.notionMeetingHistoryStatusByProject[projectId] = hasCache
          ? "refreshing"
          : "loading";
      })
      .addCase(getProjectNotionMeetingHistory.fulfilled, (state, action) => {
        const { projectId, summary, meetings } = action.payload || {};
        if (!projectId) return;

        state.notionMeetingHistoryByProject[projectId] = {
          meetings: meetings || [],
          summary: Boolean(summary),
          fetchedAt: Date.now(),
        };
        state.notionMeetingHistoryStatusByProject[projectId] = "succeeded";
      })
      .addCase(getProjectNotionMeetingHistory.rejected, (state, action) => {
        const { projectId } = normalizeExternalMeetingHistoryArg(action.meta.arg);
        const hasCache = Boolean(
          state.notionMeetingHistoryByProject[projectId]?.fetchedAt
        );
        state.notionMeetingHistoryStatusByProject[projectId] = hasCache
          ? "succeeded"
          : "failed";
      })

      .addCase(getProjectGoogleDriveMeetingHistory.pending, (state, action) => {
        const { projectId } = normalizeExternalMeetingHistoryArg(action.meta.arg);
        const hasCache = Boolean(
          state.googleDriveMeetingHistoryByProject[projectId]?.fetchedAt
        );
        state.googleDriveMeetingHistoryStatusByProject[projectId] = hasCache
          ? "refreshing"
          : "loading";
      })
      .addCase(getProjectGoogleDriveMeetingHistory.fulfilled, (state, action) => {
        const { projectId, summary, meetings } = action.payload || {};
        if (!projectId) return;

        state.googleDriveMeetingHistoryByProject[projectId] = {
          meetings: meetings || [],
          summary: Boolean(summary),
          fetchedAt: Date.now(),
        };
        state.googleDriveMeetingHistoryStatusByProject[projectId] = "succeeded";
      })
      .addCase(getProjectGoogleDriveMeetingHistory.rejected, (state, action) => {
        const { projectId } = normalizeExternalMeetingHistoryArg(action.meta.arg);
        const hasCache = Boolean(
          state.googleDriveMeetingHistoryByProject[projectId]?.fetchedAt
        );
        state.googleDriveMeetingHistoryStatusByProject[projectId] = hasCache
          ? "succeeded"
          : "failed";
      });
  },
});



export { deleteGeneratedDocument };
export const {
  clearGeneratedDocuments,
  invalidateProjectMeetingHistory,
} = Template_Slice.actions;
export default Template_Slice.reducer;