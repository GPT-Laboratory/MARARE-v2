/**
 * Team MVP and Vision statements saved after meetings.
 * File: src/features/mainStates/MvpVision_Slice.jsx
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import { socketURL } from "../../services/meeting/socketInstance";
import { getUserId } from '../../services/auth/GetLoginUserId';

export const saveMeetingMvpVision = createAsyncThunk(
  "mvpvisions/saveMeetingMvpVision",
  async (mvpvisionData, { rejectWithValue }) => {
    try {
      const response = await axios.post(
        `${socketURL}/save-meeting-mvpvision`,
        mvpvisionData
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to save MVP+Vision"
      );
    }
  }
);

export const getMvpVisionByProject = createAsyncThunk(
  "mvpvisions/getMvpVisionByProject",
  async (projectId, { rejectWithValue }) => {
    const userId = getUserId();
    try {
      const response = await axios.get(
        `${socketURL}/get-mvpvision-by-project/${projectId}`,
        { params: { userId } }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to fetch MVP+Vision"
      );
    }
  }
);

export const updateMeetingMvpVision = createAsyncThunk(
  "mvpvisions/updateMeetingMvpVision",
  async ({ mvpvisionId, updateData }, { rejectWithValue }) => {
    const userId = getUserId();
    try {
      const response = await axios.put(
        `${socketURL}/update-meeting-mvpvision/${mvpvisionId}`,
        {
          userId,
          mvp: updateData.mvp,
          vision: updateData.vision,
          version: updateData.version,
        }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || "Failed to update MVP+Vision"
      );
    }
  }
);

const MvpVision_Slice = createSlice({
  name: "mvpvisions",
  initialState: {
    mvpvisions: [],
    currentMvpVision: null,
    loading: false,
    error: null,
  },
  reducers: {
    clearMvpVisionError: (state) => {
      state.error = null;
    },
    setCurrentMvpVision: (state, action) => {
      state.currentMvpVision = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(saveMeetingMvpVision.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveMeetingMvpVision.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload?.mvpvision) {
          state.mvpvisions = [action.payload.mvpvision, ...(state.mvpvisions || [])];
          state.currentMvpVision = action.payload.mvpvision;
        }
      })
      .addCase(saveMeetingMvpVision.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(getMvpVisionByProject.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getMvpVisionByProject.fulfilled, (state, action) => {
        state.loading = false;
        state.mvpvisions = action.payload?.mvpvisions || [];
      })
      .addCase(getMvpVisionByProject.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(updateMeetingMvpVision.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateMeetingMvpVision.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload?.mvpvision) {
          state.currentMvpVision = action.payload.mvpvision;
        }
      })
      .addCase(updateMeetingMvpVision.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearMvpVisionError, setCurrentMvpVision } = MvpVision_Slice.actions;
export default MvpVision_Slice.reducer;
