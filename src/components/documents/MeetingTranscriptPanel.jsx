/**
 * Displays stored transcript text for a selected meeting.
 * File: src/components/documents/MeetingTranscriptPanel.jsx
 */
import React from "react";
import { Button, Card, Empty, Tag, Timeline, Typography, message } from "antd";
import { FilePdfOutlined, MessageOutlined } from "@ant-design/icons";
import { downloadTranscriptEntriesAsPdf } from "../../utils/meetingTranscriptUtils";

const { Text } = Typography;

const formatMeetingDate = (value) => {
  if (!value) return "";
  return new Date(value).toLocaleString();
};

const MeetingTranscriptPanel = ({
  transcript,
  meetingId,
  projectName,
  loading = false,
  isDarkMode = false,
  className = "",
}) => {
  const entries = transcript?.entries || [];

  const downloadTranscript = () => {
    const result = downloadTranscriptEntriesAsPdf({
      entries,
      projectName,
      meetingId,
    });
    if (result.success) {
      message.success("Transcript PDF downloaded");
    } else {
      message.warning(result.message || "No transcript to download");
    }
  };

  return (
    <Card
      className={`shadow-sm h-full flex flex-col ${className}`}
      loading={loading}
      title={
        <div className="flex items-center gap-2 min-w-0">
          <MessageOutlined className="text-purple-500 shrink-0" />
          <span className="font-semibold truncate">Meeting Transcript</span>
        </div>
      }
      extra={
        entries.length > 0 ? (
          <Button
            size="small"
            icon={<FilePdfOutlined />}
            onClick={downloadTranscript}
          >
            Download PDF
          </Button>
        ) : null
      }
      styles={{
        body: {
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          padding: "12px 16px",
        },
      }}
    >
      {meetingId && (
        <Text type="secondary" className="text-xs block mb-3 truncate">
          {meetingId}
        </Text>
      )}

      {entries.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No transcript for this meeting"
          className="my-auto"
        />
      ) : (
        <div
          className="flex-1 overflow-y-auto pr-1"
          style={{ maxHeight: "calc(100vh - 220px)", minHeight: 280 }}
        >
          <Timeline
            items={entries.map((entry, index) => ({
              key: `${entry.timestamp || index}-${entry.speaker_name || index}`,
              color:
                entry.speaker_role === "agent"
                  ? "purple"
                  : entry.speaker_role === "host"
                    ? "blue"
                    : "gray",
              children: (
                <div className="pb-2">
                  <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    <span>{entry.speaker_name || entry.speakerName || "Unknown"}</span>
                    {entry.speaker_role === "agent" && (
                      <Tag color="purple" className="!text-xs !m-0">
                        Agent
                      </Tag>
                    )}
                    {entry.speaker_role === "host" && (
                      <Tag color="blue" className="!text-xs !m-0">
                        Host
                      </Tag>
                    )}
                  </div>
                  <Text
                    className="text-sm block mt-1"
                    style={{ color: isDarkMode ? "#e5e7eb" : "#374151" }}
                  >
                    {entry.text}
                  </Text>
                  {entry.timestamp && (
                    <div className="text-xs text-gray-400 mt-1">
                      {formatMeetingDate(entry.timestamp)}
                    </div>
                  )}
                </div>
              ),
            }))}
          />
        </div>
      )}
    </Card>
  );
};

export default MeetingTranscriptPanel;
