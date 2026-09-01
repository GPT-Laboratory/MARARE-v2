/**
 * Past meetings list with links to documents.
 * File: src/components/documents/MeetingHistoryPanel.jsx
 */
import React, { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Modal,
  Tag,
  Typography,
  Empty,
} from "antd";
import {
  CalendarOutlined,
  DeleteOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
  FilePdfOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { downloadDocPDF } from "../../utils/documentUtils";
import {
  getMeetingDisplayTitle,
  getParentMeetingTitle,
} from "../../utils/meetingHistoryUtils";
import {
  getMeetingListKey,
  getMeetingSourceColor,
  getMeetingSourceLabel,
  isSupabaseMeeting,
} from "../../utils/unifiedMeetingHistory";

const { Text } = Typography;

const formatMeetingDate = (value) => {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleString();
};

const MeetingHistoryPanel = ({
  meetings = [],
  onOpenDocument,
  onDeleteMeeting,
  onDownloadPdf,
  loading = false,
  loadingSources = {},
  loadingExternal = false,
}) => {
  const { message } = App.useApp();
  const [deletingMeetingId, setDeletingMeetingId] = useState(null);
  const [downloadingDocId, setDownloadingDocId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmDeleteLoading, setConfirmDeleteLoading] = useState(false);

  const sortedMeetings = useMemo(
    () =>
      [...meetings].sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      ),
    [meetings]
  );

  const handleOpen = (meeting, doc) => {
    if (!doc) return;
    onOpenDocument?.(doc, {
      meetingId: meeting.is_import ? doc.meeting_id : meeting.meeting_id,
    });
  };

  const handleDownloadPdf = async (doc) => {
    if (!doc || !onDownloadPdf) return;

    const documentId = doc._id || doc.id;
    setDownloadingDocId(documentId);
    try {
      await onDownloadPdf(doc);
    } catch (error) {
      message.error(
        error?.message || error?.error || "Failed to download PDF."
      );
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !onDeleteMeeting) return;

    setConfirmDeleteLoading(true);
    setDeletingMeetingId(deleteTarget.meeting_id);
    try {
      await onDeleteMeeting(deleteTarget);
      message.success("Meeting deleted successfully.");
      setDeleteTarget(null);
    } catch (error) {
      message.error(
        error?.message || error?.error || "Failed to delete meeting."
      );
    } finally {
      setConfirmDeleteLoading(false);
      setDeletingMeetingId(null);
    }
  };

  if (!loading && !loadingExternal && sortedMeetings.length === 0) {
    return (
      <Card className="w-full shadow-sm mt-6" title={
        <div className="flex items-center gap-2">
          <CalendarOutlined className="text-blue-500" />
          <span className="font-semibold text-gray-800">Meeting History</span>
        </div>
      }>
        <Empty description="No meetings saved yet" />
      </Card>
    );
  }

  const deleteTitle = deleteTarget
    ? getMeetingDisplayTitle(deleteTarget, sortedMeetings)
    : "";

  return (
    <>
      <Card
        className="w-full shadow-sm mt-6"
        loading={loading && sortedMeetings.length === 0}
        title={
          <div className="flex items-center gap-2">
            <CalendarOutlined className="text-blue-500" />
            <span className="font-semibold text-gray-800">Meeting History</span>
            <Tag color="blue">{sortedMeetings.length}</Tag>
          </div>
        }
      >
        {sortedMeetings.length === 0 ? (
          <Empty description="No meetings saved yet" />
        ) : (
          <div className="space-y-3">
            {sortedMeetings.map((meeting) => {
              const doc = meeting.document;
              const transcript = meeting.transcript;
              const entries = transcript?.entries || [];
              const speakerNames =
                transcript?.speaker_names ||
                [
                  ...new Set(
                    entries.map(
                      (entry) =>
                        entry.speaker_name || entry.speakerName || "Unknown"
                    )
                  ),
                ];
              const hasTranscript =
                transcript?.has_transcript ||
                (transcript?.entry_count ?? entries.length) > 0;
              const meetingTitle = getMeetingDisplayTitle(
                meeting,
                sortedMeetings
              );
              const parentTitle = getParentMeetingTitle(
                meeting.based_on_meeting_id,
                sortedMeetings
              );
              const documentId = doc?._id || doc?.id;
              const isDeleting = deletingMeetingId === meeting.meeting_id;
              const isDownloading = downloadingDocId === documentId;
              const canDelete = isSupabaseMeeting(meeting) && onDeleteMeeting;
              const sourceLabel = getMeetingSourceLabel(meeting);
              const sourceColor = getMeetingSourceColor(meeting);

              return (
                <div
                  key={getMeetingListKey(meeting)}
                  className="p-4 rounded-lg border border-gray-200 bg-gray-50"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Tag color={sourceColor} className="!m-0">
                          {sourceLabel}
                        </Tag>
                      </div>
                      <div
                        className="font-medium text-gray-900 truncate"
                        title={meetingTitle}
                      >
                        {meetingTitle}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <CalendarOutlined />
                        {formatMeetingDate(meeting.created_at || doc?.created_at)}
                      </div>
                      {meeting.based_on_meeting_id && (
                        <Tag color="purple" className="mt-2">
                          Continued from {parentTitle}
                        </Tag>
                      )}
                      {hasTranscript && (
                        <Tag color="cyan" className="mt-2 ml-0 md:ml-1">
                          Transcript available
                        </Tag>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {doc && (
                        <>
                          <Tag color="geekblue">Document v{doc.version || 1}</Tag>
                          <Button
                            size="small"
                            type="primary"
                            icon={<EyeOutlined />}
                            onClick={() => handleOpen(meeting, doc)}
                            disabled={isDeleting || isDownloading}
                          >
                            Open
                          </Button>
                          <Button
                            size="small"
                            icon={<FilePdfOutlined />}
                            loading={isDownloading}
                            onClick={() => handleDownloadPdf(doc)}
                            disabled={isDeleting || !onDownloadPdf}
                          >
                            PDF
                          </Button>
                        </>
                      )}
                      {canDelete && (
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          loading={isDeleting}
                          onClick={() => setDeleteTarget(meeting)}
                          disabled={isDownloading}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  {hasTranscript && speakerNames.length > 0 && (
                    <div className="mt-3 text-xs text-gray-500">
                      Speakers: {speakerNames.join(", ")}
                    </div>
                  )}
                </div>
              );
            })}
            {loadingExternal && (
              <div className="flex items-center gap-2 text-xs text-gray-500 px-1 py-2">
                <LoadingOutlined spin />
                <span>
                  {[
                    loadingSources.notion ? "Notion" : null,
                    loadingSources.googleDrive ? "Google Drive" : null,
                  ]
                    .filter(Boolean)
                    .join(" and ") || "External storage"}
                  {" "}meetings are still loading...
                </span>
              </div>
            )}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(deleteTarget)}
        title="Delete this meeting?"
        centered
        okText="Delete meeting"
        okType="danger"
        cancelText="Cancel"
        confirmLoading={confirmDeleteLoading}
        onCancel={() => {
          if (!confirmDeleteLoading) {
            setDeleteTarget(null);
          }
        }}
        onOk={handleConfirmDelete}
      >
        <div className="space-y-2">
          <ExclamationCircleOutlined className="text-amber-500 mr-2" />
          <Text>
            You are about to permanently delete <Text strong>{deleteTitle}</Text>.
          </Text>
          <Text type="secondary" className="block mt-2">
            This removes the saved document, transcript, summaries, and related
            meeting data for this project. This action cannot be undone.
          </Text>
        </div>
      </Modal>
    </>
  );
};

export default MeetingHistoryPanel;
