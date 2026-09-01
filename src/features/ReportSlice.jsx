/**
 * Document sections, team MVP/vision, and meeting continuation state.
 * File: src/features/ReportSlice.jsx
 */
import { createSlice } from "@reduxjs/toolkit";

const ReportSlice = createSlice({
    name: "reports",
    initialState: {
        reports: [],
        allReports: [],
        loading: false,
        error: null,
        docxFiles: [], // Array to store multiple DOCX files if needed
        intervalId: null, // will store setInterval id
        isActive: false,
        teamA: { vision: "", mvp: "" },
        teamB: { vision: "", mvp: "" },
        teamC: { vision: "", mvp: "" },
        // Hierarchical Document Agent System State
        generatedDocumentSections: {}, // {section_id: content}
        undiscussedTopics: [], // [{section_id, title, category, discussed}]
        meetingPhase: 'ongoing', // 'ongoing', 'ending', 'ended'
        // Template received via socket/saved-doc (non-host users or returning meetings)
        receivedDocumentTemplate: null,
        // Whether to load & continue from the previous meeting's document
        usePreviousDocument: false,
        // Selected parent meeting when starting a new meeting
        meetingContinuation: {
            mode: "fresh",
            parentMeetingId: null,
            parentDocumentId: null,
            parentDocument: null,
            parentTranscript: null,
            parentStorageSource: null,
        },
    },
    reducers: {
        startAutoSend: (state, action) => {
            // Clear existing interval first if any
            if (state.intervalId) {
                clearInterval(state.intervalId);
            }
            state.intervalId = action.payload; // store new setInterval id
            state.isActive = true;
            console.log("Redux: Auto-send started with interval:", action.payload);
        },
        stopAutoSend: (state) => {
            console.log("Redux: Stopping auto-send, current interval:", state.intervalId);

            if (state.intervalId) {
                clearInterval(state.intervalId);
                console.log("Redux: Interval cleared");
            }

            state.intervalId = null;
            state.isActive = false;
            console.log("Redux: Auto-send stopped");
        },
        // Add this if you want to force-clear from outside
        forceStopAutoSend: (state) => {
            console.log("Redux: Force stopping auto-send");

            if (state.intervalId) {
                clearInterval(state.intervalId);
            }

            state.intervalId = null;
            state.isActive = false;
        },
        setTeamAmvp: (state, action) => {
            state.teamA.mvp = action.payload;
        },
        setTeamAvision: (state, action) => {
            state.teamA.vision = action.payload;
        },
        setTeamBmvp: (state, action) => {
            state.teamB.mvp = action.payload;
        },
        setTeamBvision: (state, action) => {
            state.teamB.vision = action.payload;
        },
        setTeamCmvp: (state, action) => {
            state.teamC.mvp = action.payload;
        },
        setTeamCvision: (state, action) => {
            state.teamC.vision = action.payload;
        },
        // Hierarchical Document Agent System Reducers
        setGeneratedDocumentSections: (state, action) => {
            state.generatedDocumentSections = action.payload;
        },
        updateDocumentSection: (state, action) => {
            const { sectionId, content } = action.payload;
            state.generatedDocumentSections[sectionId] = content;
        },
        setUndiscussedTopics: (state, action) => {
            state.undiscussedTopics = action.payload;
        },
        setMeetingPhase: (state, action) => {
            state.meetingPhase = action.payload;
        },
        setReceivedDocumentTemplate: (state, action) => {
            state.receivedDocumentTemplate = action.payload;
        },
        setUsePreviousDocument: (state, action) => {
            state.usePreviousDocument = action.payload;
            if (!action.payload) {
                state.meetingContinuation = {
                    mode: "fresh",
                    parentMeetingId: null,
                    parentDocumentId: null,
                    parentDocument: null,
                    parentTranscript: null,
                };
            }
        },
        setMeetingContinuation: (state, action) => {
            state.meetingContinuation = {
                ...state.meetingContinuation,
                ...action.payload,
            };
            state.usePreviousDocument = state.meetingContinuation.mode === "continue"
                && Boolean(state.meetingContinuation.parentDocument);
        },
        clearMeetingContinuation: (state) => {
            state.meetingContinuation = {
                mode: "fresh",
                parentMeetingId: null,
                parentDocumentId: null,
                parentDocument: null,
                parentTranscript: null,
            };
            state.usePreviousDocument = false;
        },
        clearDocumentData: (state) => {
            state.generatedDocumentSections = {};
            state.undiscussedTopics = [];
            state.meetingPhase = 'ongoing';
            state.receivedDocumentTemplate = null;
        },
        clearReports: (state) => {
            state.reports = [];
            state.error = null;
        },
        setReports: (state, action) => {
            state.reports = action.payload;
            console.log("reports set", state.reports);

            state.error = null;
        },
        setDocxFile: (state, action) => {
            // If file with same ID exists, replace it; otherwise, add new
            const existingIndex = state.docxFiles.findIndex(file => file.id === action.payload.id);
            if (existingIndex !== -1) {
                state.docxFiles[existingIndex] = action.payload;
            } else {
                state.docxFiles.push(action.payload);
            }
        },
        removeDocxFile: (state, action) => {
            // Remove file by ID
            state.docxFiles = state.docxFiles.filter(file => file.id !== action.payload);
        },
        clearDocxFiles: (state) => {
            state.docxFiles = [];
        }
    },
});

export const { 
    clearReports, 
    setReports, 
    setDocxFile, 
    removeDocxFile, 
    clearDocxFiles, 
    startAutoSend, 
    stopAutoSend,
    setTeamAmvp,
    setTeamAvision,
    setTeamBmvp,
    setTeamBvision,
    setTeamCmvp,
    setTeamCvision,
    // Hierarchical Document Agent System Actions
    setGeneratedDocumentSections,
    updateDocumentSection,
    setUndiscussedTopics,
    setMeetingPhase,
    clearDocumentData,
    setReceivedDocumentTemplate,
    setUsePreviousDocument,
    setMeetingContinuation,
    clearMeetingContinuation,
} = ReportSlice.actions;
export default ReportSlice.reducer;
