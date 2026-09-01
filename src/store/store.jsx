/**
 * Redux store — central client-side state for MARARE.
 *
 * Slices: MainStates_Slice, main, reports, documents, summaries, mvpvisions
 */
import { configureStore } from "@reduxjs/toolkit";
import MainStates_Slice from "../features/mainStates/MainStates_Slice";
import MainSlice from "../features/MainSlice.jsx";
import reportsReducer from "../features/ReportSlice.jsx";
import Template_Slice from "../features/mainStates/Template_Slice.jsx";
import Summary_Slice from "../features/mainStates/Summary_Slice.jsx";
import MvpVision_Slice from "../features/mainStates/MvpVision_Slice.jsx";

export const store = configureStore({
  reducer: {
    MainStates_Slice: MainStates_Slice,
    main: MainSlice,
    reports: reportsReducer,
    documents: Template_Slice,
    summaries: Summary_Slice,
    mvpvisions: MvpVision_Slice,
  },
});

export default store;
