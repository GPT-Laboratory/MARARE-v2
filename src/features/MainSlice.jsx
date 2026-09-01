/**
 * Project list and CRUD via backend API async thunks.
 * File: src/features/MainSlice.jsx
 */
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import { getUserId } from "../services/auth/GetLoginUserId.jsx";
import { socketURL } from "../services/meeting/socketInstance.jsx";

// Async thunks for API interactions
export const fetchProjects = createAsyncThunk(
  "main/fetchProjects",
  async (_, { rejectWithValue }) => {
    const userId = getUserId();
    if (!userId) {
      return rejectWithValue("User not logged in");
    }
    try {
      // const response = await axios.get(`/api/projects?user_id=${userId}`);
      const response = await axios.get(`${socketURL}/projects?user_id=${userId}`);
      console.log("response.data", response.data);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || "Failed to fetch projects");
    }
  }
);

export const createProject = createAsyncThunk(
  "main/createProject",
  async ({projectName, template_document, mvpVisiontemplate}, { rejectWithValue }) => {
    const userId = getUserId();
    if (!userId) {
      return rejectWithValue("User not logged in");
    }
    try {
      // const response = await axios.post("/api/create-project", {
      const response = await axios.post(`${socketURL}/create-project`, {
        project_name: projectName,
        user_id: userId,
        template_document,
        mvpVisiontemplate
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || "Failed to create project");
    }
  }
);

export const deleteProject = createAsyncThunk(
  "main/deleteProject",
  async (projectId, { rejectWithValue }) => {
    try {
      await axios.delete(`${socketURL}/delete-project/${projectId}`);
      return projectId;
    } catch (error) {
      return rejectWithValue(error.response?.data || "Failed to delete project");
    }
  }
);

export const updateProject = createAsyncThunk(
  "main/updateProject",
  async ({ id, project_name, template_document, mvpVisiontemplate }, { rejectWithValue }) => {
    const userId = getUserId();
    if (!userId) {
      return rejectWithValue("User not logged in");
    }
    try {
      const response = await axios.put(`${socketURL}/update-project/${id}`, {
        project_name: project_name,
        user_id: userId,
        template_document,
        mvpVisiontemplate
      });
        return response.data;
      } catch (error) {
        return rejectWithValue(error.response?.data || "Failed to update project");
      }
    }
  );

const initialState = {
  counter: 0,
  projects: [],
  loading: false,
  error: null,
};

const MainSlice = createSlice({
  name: "main",
  initialState,
  reducers: {
    increment: (state) => {
      state.counter += 1;
    },
    decrement: (state) => {
      state.counter -= 1;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch Projects
      .addCase(fetchProjects.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchProjects.fulfilled, (state, action) => {
        state.loading = false;
        state.projects = action.payload;
        state.error = null;
      })
      .addCase(fetchProjects.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Create Project
      .addCase(createProject.pending, (state) => {
        state.loading = true;
      })
      .addCase(createProject.fulfilled, (state, action) => {
        state.loading = false;
        state.projects.push(action.payload);
        state.error = null;
      })
      .addCase(createProject.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Delete Project
      .addCase(deleteProject.pending, (state) => {
        state.loading = true;
      })
      .addCase(deleteProject.fulfilled, (state, action) => {
        state.loading = false;
        const deletedProjectId = action.payload;
        state.projects = state.projects.filter(
          (project) => project.id !== deletedProjectId
        );
        state.error = null;
      })
      .addCase(deleteProject.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })


      // Update Project
      .addCase(updateProject.pending, (state) => {
        state.loading = true;
      })
      .addCase(updateProject.fulfilled, (state, action) => {
        state.loading = false;
        state.error = null;

        // Find project by _id and update it
        const updatedProject = action.payload;
        const index = state.projects.findIndex(proj => proj._id === updatedProject._id);

        if (index !== -1) {
          state.projects[index] = updatedProject;
        }
      })
      .addCase(updateProject.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      ;
  },
});

export const { increment, decrement } = MainSlice.actions;
export default MainSlice.reducer;