/**
 * Persist and load AI-generated meeting summaries.
 * File: src/features/mainStates/Summary_Slice.jsx
 */
// Redux slice for Meeting Summary management
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';
import { socketURL } from '../../services/meeting/socketInstance';
import { getUserId } from '../../services/auth/GetLoginUserId';

// Save meeting summary
export const saveMeetingSummary = createAsyncThunk(
  "summaries/saveMeetingSummary",
  async (summaryData, { rejectWithValue }) => {
    try {
      const response = await axios.post(
        `${socketURL}/save-meeting-summary`,
        summaryData
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to save summary"
      );
    }
  }
);

// Get meeting summaries by meeting ID
export const getMeetingSummaries = createAsyncThunk(
  "summaries/getMeetingSummaries",
  async (meetingId, { rejectWithValue }) => {
    try {
      const userId = getUserId();
      const response = await axios.get(
        `${socketURL}/get-meeting-summaries/${meetingId}`,
        {
          params: { userId }
        }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch summaries"
      );
    }
  }
);

// Get summaries by project ID
export const getSummariesByProject = createAsyncThunk(
  "summaries/getSummariesByProject",
  async (projectId, { rejectWithValue }) => {
    const userId = getUserId();
    try {
      const response = await axios.get(
        `${socketURL}/get-summaries-by-project/${projectId}`,
        {
          params: { userId }
        }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch project summaries"
      );
    }
  }
);

// Get specific summary by ID
export const getSummary = createAsyncThunk(
  "summaries/getSummary",
  async (summaryId, { rejectWithValue }) => {
    try {
      const userId = getUserId();
      const response = await axios.get(
        `${socketURL}/get-summary/${summaryId}`,
        {
          params: { userId }
        }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch summary"
      );
    }
  }
);

// Update meeting summary
export const updateMeetingSummary = createAsyncThunk(
  "summaries/updateMeetingSummary",
  async ({ summaryId, updateData }, { rejectWithValue }) => {
    const userId = getUserId();
    try {
      const response = await axios.put(
        `${socketURL}/update-meeting-summary/${summaryId}`,
        {
          userId,
          summaryContent: updateData.summaryContent,
          version: updateData.version
        }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to update summary"
      );
    }
  }
);

// Delete meeting summary
export const deleteMeetingSummary = createAsyncThunk(
  "summaries/deleteMeetingSummary",
  async (summaryId, { rejectWithValue }) => {
    try {
      const userId = getUserId();
      await axios.delete(
        `${socketURL}/delete-meeting-summary/${summaryId}`,
        {
          params: { userId }
        }
      );
      return summaryId;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to delete summary"
      );
    }
  }
);

// Summary slice
export const Summary_Slice = createSlice({
  name: 'summaries',
  initialState: {
    meetingSummaries: [],
    currentSummary: null,
    loading: false,
    error: null,
  },
  reducers: {
    clearSummaryError: (state) => {
      state.error = null;
    },
    setCurrentSummary: (state, action) => {
      state.currentSummary = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // Save summary
      .addCase(saveMeetingSummary.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveMeetingSummary.fulfilled, (state, action) => {
        state.loading = false;
        state.meetingSummaries.push(action.payload);
        state.currentSummary = action.payload;
      })
      .addCase(saveMeetingSummary.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      
      // Get summaries by meeting
      .addCase(getMeetingSummaries.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getMeetingSummaries.fulfilled, (state, action) => {
        state.loading = false;
        state.meetingSummaries = action.payload;
      })
      .addCase(getMeetingSummaries.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      
      // Get summaries by project
      .addCase(getSummariesByProject.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSummariesByProject.fulfilled, (state, action) => {
        state.loading = false;
        state.meetingSummaries = action.payload;
      })
      .addCase(getSummariesByProject.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      
      // Get specific summary
      .addCase(getSummary.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSummary.fulfilled, (state, action) => {
        state.loading = false;
        state.currentSummary = action.payload.summary;
      })
      .addCase(getSummary.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      
      // Update summary
      .addCase(updateMeetingSummary.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateMeetingSummary.fulfilled, (state, action) => {
        state.loading = false;
        // Update the summary in the array
        if (action.payload?.summary) {
          const index = state.meetingSummaries?.summaries?.findIndex(
            sum => sum._id === action.payload.summary._id
          );
          if (index !== -1 && state.meetingSummaries?.summaries) {
            state.meetingSummaries.summaries[index] = action.payload.summary;
          }
          state.currentSummary = action.payload.summary;
        }
      })
      .addCase(updateMeetingSummary.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      
      // Delete summary
      .addCase(deleteMeetingSummary.fulfilled, (state, action) => {
        state.meetingSummaries = state.meetingSummaries.filter(
          sum => sum.id !== action.payload
        );
        if (state.currentSummary?.id === action.payload) {
          state.currentSummary = null;
        }
      });
  },
});

export const { clearSummaryError, setCurrentSummary } = Summary_Slice.actions;

export default Summary_Slice.reducer;
