/**
 * Fetches Supabase-only meeting history for a project.
 * File: src/hooks/useProjectMeetingHistory.js
 */
import { useCallback, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  getProjectMeetingHistory,
  isMeetingHistoryCacheFresh,
  selectProjectMeetingHistory,
  selectProjectMeetingHistoryMeta,
  selectProjectMeetingHistoryStatus,
} from "../features/mainStates/Template_Slice";

export const useProjectMeetingHistory = (
  projectId,
  { enabled = true, summary = true } = {}
) => {
  const dispatch = useDispatch();
  const meetings = useSelector((state) => selectProjectMeetingHistory(state, projectId));
  const meta = useSelector((state) => selectProjectMeetingHistoryMeta(state, projectId));
  const status = useSelector((state) => selectProjectMeetingHistoryStatus(state, projectId));
  const requestRef = useRef(0);

  const reload = useCallback(
    (options = {}) => {
      if (!projectId || !enabled) {
        return Promise.resolve([]);
      }

      const requestId = ++requestRef.current;
      return dispatch(
        getProjectMeetingHistory({
          projectId,
          summary,
          forceRefresh: options.forceRefresh !== false,
        })
      )
        .unwrap()
        .then((result) => {
          if (requestId !== requestRef.current) {
            return meetings;
          }
          return result?.meetings || [];
        })
        .catch(() => meetings);
    },
    [dispatch, enabled, meetings, projectId, summary]
  );

  useEffect(() => {
    if (!projectId || !enabled) return;

    if (isMeetingHistoryCacheFresh(meta, { summary })) {
      return;
    }

    dispatch(getProjectMeetingHistory({ projectId, summary, forceRefresh: false }));
  }, [dispatch, enabled, meta, projectId, summary]);

  const loading = enabled && status === "loading";
  const refreshing = enabled && status === "refreshing";

  return {
    meetings,
    loading,
    refreshing,
    reload,
    meta,
  };
};

export default useProjectMeetingHistory;
