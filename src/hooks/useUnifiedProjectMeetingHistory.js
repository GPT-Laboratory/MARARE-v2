/**
 * Merges meeting history from Supabase, Notion, and Drive.
 * File: src/hooks/useUnifiedProjectMeetingHistory.js
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  getProjectGoogleDriveMeetingHistory,
  getProjectMeetingHistory,
  getProjectNotionMeetingHistory,
  getDocumentsByProject,
  isMeetingHistoryCacheFresh,
  selectGoogleDriveMeetingHistory,
  selectGoogleDriveMeetingHistoryMeta,
  selectGoogleDriveMeetingHistoryStatus,
  selectNotionMeetingHistory,
  selectNotionMeetingHistoryMeta,
  selectNotionMeetingHistoryStatus,
  selectProjectMeetingHistory,
  selectProjectMeetingHistoryMeta,
  selectProjectMeetingHistoryStatus,
} from "../features/mainStates/Template_Slice";
import { fetchProjectDocumentStorage } from "../utils/projectDocumentStorage";
import {
  getMeetingStorageSource,
  mergeMeetingLists,
  MEETING_SOURCE,
  normalizeMeetingRecord,
  enrichSupabaseMeetingsWithDocuments,
} from "../utils/unifiedMeetingHistory";
import { filterSupabaseProjectDocuments } from "../utils/documentStorageRecords";

export const useUnifiedProjectMeetingHistory = (
  projectId,
  {
    enabled = true,
    summary = true,
    projectName = "",
  } = {}
) => {
  const dispatch = useDispatch();

  const supabaseMeetings = useSelector((state) =>
    selectProjectMeetingHistory(state, projectId)
  );
  const supabaseMeta = useSelector((state) =>
    selectProjectMeetingHistoryMeta(state, projectId)
  );
  const supabaseStatus = useSelector((state) =>
    selectProjectMeetingHistoryStatus(state, projectId)
  );

  const notionMeetings = useSelector((state) =>
    selectNotionMeetingHistory(state, projectId)
  );
  const notionMeta = useSelector((state) =>
    selectNotionMeetingHistoryMeta(state, projectId)
  );
  const notionStatus = useSelector((state) =>
    selectNotionMeetingHistoryStatus(state, projectId)
  );

  const driveMeetings = useSelector((state) =>
    selectGoogleDriveMeetingHistory(state, projectId)
  );
  const driveMeta = useSelector((state) =>
    selectGoogleDriveMeetingHistoryMeta(state, projectId)
  );
  const driveStatus = useSelector((state) =>
    selectGoogleDriveMeetingHistoryStatus(state, projectId)
  );

  const [storageReady, setStorageReady] = useState({
    notionReady: false,
    googleDriveReady: false,
  });
  const [supabaseProjectDocuments, setSupabaseProjectDocuments] = useState([]);

  useEffect(() => {
    if (!projectId || !enabled) return;

    let active = true;

    fetchProjectDocumentStorage(projectId).then((storage) => {
      if (!active) return;
      setStorageReady({
        notionReady: Boolean(storage?.notionReady),
        googleDriveReady: Boolean(storage?.googleDriveReady),
      });
    });

    return () => {
      active = false;
    };
  }, [enabled, projectId]);

  useEffect(() => {
    if (!projectId || !enabled) return;
    if (isMeetingHistoryCacheFresh(supabaseMeta, { summary })) return;

    dispatch(
      getProjectMeetingHistory({
        projectId,
        summary,
        forceRefresh: false,
      })
    );
  }, [dispatch, enabled, projectId, summary, supabaseMeta]);

  useEffect(() => {
    if (!projectId || !enabled) return;

    const needsDocumentLink = (supabaseMeetings || []).some(
      (meeting) =>
        meeting?.meeting_id &&
        !meeting?.document &&
        !meeting?.is_import,
    );

    if (!needsDocumentLink) {
      setSupabaseProjectDocuments((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    let active = true;

    dispatch(getDocumentsByProject(projectId))
      .unwrap()
      .then((result) => {
        if (!active) return;
        setSupabaseProjectDocuments(
          filterSupabaseProjectDocuments(result?.documents || []),
        );
      })
      .catch(() => {
        if (!active) return;
        setSupabaseProjectDocuments([]);
      });

    return () => {
      active = false;
    };
  }, [dispatch, enabled, projectId, supabaseMeetings]);

  useEffect(() => {
    if (!projectId || !enabled || !storageReady.notionReady) return;
    if (isMeetingHistoryCacheFresh(notionMeta, { summary })) return;

    dispatch(
      getProjectNotionMeetingHistory({
        projectId,
        projectName,
        summary,
        forceRefresh: false,
      })
    );
  }, [
    dispatch,
    enabled,
    notionMeta,
    projectId,
    projectName,
    storageReady.notionReady,
    summary,
  ]);

  useEffect(() => {
    if (!projectId || !enabled || !storageReady.googleDriveReady) return;
    if (isMeetingHistoryCacheFresh(driveMeta, { summary })) return;

    dispatch(
      getProjectGoogleDriveMeetingHistory({
        projectId,
        projectName,
        summary,
        forceRefresh: false,
      })
    );
  }, [
    dispatch,
    driveMeta,
    enabled,
    projectId,
    projectName,
    storageReady.googleDriveReady,
    summary,
  ]);

  const reload = useCallback(
    async (options = {}) => {
      if (!projectId || !enabled) return [];

      const forceRefresh = options.forceRefresh !== false;
      const storage = await fetchProjectDocumentStorage(projectId, undefined, {
        forceRefresh,
      });

      const notionReady = Boolean(storage?.notionReady);
      const googleDriveReady = Boolean(storage?.googleDriveReady);
      setStorageReady({ notionReady, googleDriveReady });

      const tasks = [
        dispatch(
          getProjectMeetingHistory({
            projectId,
            summary,
            forceRefresh,
          })
        ).unwrap(),
      ];

      if (notionReady) {
        tasks.push(
          dispatch(
            getProjectNotionMeetingHistory({
              projectId,
              projectName,
              summary,
              forceRefresh,
            })
          ).unwrap()
        );
      }

      if (googleDriveReady) {
        tasks.push(
          dispatch(
            getProjectGoogleDriveMeetingHistory({
              projectId,
              projectName,
              summary,
              forceRefresh,
            })
          ).unwrap()
        );
      }

      await Promise.allSettled(tasks);
      return [];
    },
    [dispatch, enabled, projectId, projectName, summary]
  );

  const normalizedSupabaseMeetings = useMemo(() => {
    const enriched = enrichSupabaseMeetingsWithDocuments(
      supabaseMeetings || [],
      supabaseProjectDocuments,
    );

    return enriched.map((meeting) =>
      normalizeMeetingRecord(meeting, MEETING_SOURCE.SUPABASE),
    );
  }, [supabaseMeetings, supabaseProjectDocuments]);

  const normalizedNotionMeetings = useMemo(
    () =>
      (notionMeetings || []).map((meeting) =>
        normalizeMeetingRecord(meeting, MEETING_SOURCE.NOTION)
      ),
    [notionMeetings]
  );

  const normalizedDriveMeetings = useMemo(
    () =>
      (driveMeetings || []).map((meeting) =>
        normalizeMeetingRecord(meeting, MEETING_SOURCE.GOOGLE_DRIVE)
      ),
    [driveMeetings]
  );

  const meetings = useMemo(
    () =>
      mergeMeetingLists(
        normalizedSupabaseMeetings,
        normalizedNotionMeetings,
        normalizedDriveMeetings
      ),
    [normalizedDriveMeetings, normalizedNotionMeetings, normalizedSupabaseMeetings]
  );

  const loadingSupabase = enabled && supabaseStatus === "loading";
  const loadingNotion =
    enabled && storageReady.notionReady && notionStatus === "loading";
  const loadingDrive =
    enabled && storageReady.googleDriveReady && driveStatus === "loading";
  const loadingExternal = loadingNotion || loadingDrive;

  const loading =
    enabled &&
    meetings.length === 0 &&
    (loadingSupabase || loadingExternal);

  const refreshing =
    enabled &&
    (supabaseStatus === "refreshing" ||
      notionStatus === "refreshing" ||
      driveStatus === "refreshing");

  const loadingSources = useMemo(
    () => ({
      supabase: supabaseStatus === "loading" || supabaseStatus === "refreshing",
      notion:
        storageReady.notionReady &&
        (notionStatus === "loading" || notionStatus === "refreshing"),
      googleDrive:
        storageReady.googleDriveReady &&
        (driveStatus === "loading" || driveStatus === "refreshing"),
    }),
    [
      driveStatus,
      notionStatus,
      storageReady.googleDriveReady,
      storageReady.notionReady,
      supabaseStatus,
    ]
  );

  const meetingsWithDocuments = useMemo(
    () => meetings.filter((meeting) => meeting.document),
    [meetings]
  );

  return {
    meetings,
    meetingsWithDocuments,
    loading,
    refreshing,
    loadingSources,
    loadingExternal,
    reload,
    storageReady,
    getMeetingStorageSource,
  };
};

export default useUnifiedProjectMeetingHistory;
