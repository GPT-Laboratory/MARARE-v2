/**
 * Loading overlay while meeting document data syncs.
 * File: src/components/meeting/MeetingDataSyncLoader.jsx
 */
import React from "react";
import {
  CheckCircleFilled,
  CloudSyncOutlined,
  FileTextOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { Progress, Typography } from "antd";

const { Text, Title } = Typography;

const STEPS = [
  { key: "document", label: "Saving document", icon: FileTextOutlined },
  { key: "transcript", label: "Saving transcript", icon: CloudSyncOutlined },
  { key: "finalize", label: "Loading from database", icon: CheckCircleFilled },
];

const MeetingDataSyncLoader = ({
  visible = false,
  stage = "document",
  isDarkMode = false,
}) => {
  if (!visible) return null;

  const stageIndex = Math.max(
    0,
    STEPS.findIndex((step) => step.key === stage)
  );
  const progressPercent = Math.min(
    95,
    Math.round(((stageIndex + 1) / STEPS.length) * 100)
  );

  const cardBg = isDarkMode ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.98)";
  const borderColor = isDarkMode ? "rgba(51, 65, 85, 0.9)" : "rgba(226, 232, 240, 1)";
  const textColor = isDarkMode ? "#e2e8f0" : "#0f172a";
  const mutedColor = isDarkMode ? "#94a3b8" : "#64748b";

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center px-4"
      style={{
        background: isDarkMode
          ? "rgba(2, 6, 23, 0.72)"
          : "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{
          background: cardBg,
          border: `1px solid ${borderColor}`,
          color: textColor,
        }}
      >
        <div
          className="px-6 py-5"
          style={{
            background: isDarkMode
              ? "linear-gradient(135deg, rgba(30, 58, 138, 0.35), rgba(15, 23, 42, 0.2))"
              : "linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(255, 255, 255, 0.9))",
          }}
        >
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
              style={{
                background: isDarkMode
                  ? "rgba(59, 130, 246, 0.18)"
                  : "rgba(59, 130, 246, 0.12)",
              }}
            >
              <LoadingOutlined
                spin
                style={{ fontSize: 24, color: "#3b82f6" }}
              />
            </div>
            <div className="min-w-0">
              <Title level={4} style={{ margin: 0, color: textColor }}>
                Saving your meeting data
              </Title>
              <Text style={{ color: mutedColor }}>
                This may take a little time. Please keep this page open while
                we securely store and retrieve your meeting results.
              </Text>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          <Progress
            percent={progressPercent}
            showInfo={false}
            strokeColor={{ from: "#3b82f6", to: "#06b6d4" }}
            trailColor={isDarkMode ? "rgba(51, 65, 85, 0.8)" : "#e2e8f0"}
            size="small"
          />

          <div className="space-y-3">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isComplete = index < stageIndex;
              const isActive = index === stageIndex;

              return (
                <div
                  key={step.key}
                  className="flex items-center gap-3 rounded-xl px-3 py-2"
                  style={{
                    background: isActive
                      ? isDarkMode
                        ? "rgba(59, 130, 246, 0.12)"
                        : "rgba(59, 130, 246, 0.08)"
                      : "transparent",
                    border: isActive
                      ? `1px solid ${isDarkMode ? "rgba(59, 130, 246, 0.35)" : "rgba(59, 130, 246, 0.18)"}`
                      : "1px solid transparent",
                  }}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: isComplete
                        ? "rgba(34, 197, 94, 0.15)"
                        : isActive
                          ? "rgba(59, 130, 246, 0.15)"
                          : isDarkMode
                            ? "rgba(51, 65, 85, 0.7)"
                            : "#f1f5f9",
                      color: isComplete
                        ? "#22c55e"
                        : isActive
                          ? "#3b82f6"
                          : mutedColor,
                    }}
                  >
                    {isComplete ? (
                      <CheckCircleFilled />
                    ) : isActive ? (
                      <LoadingOutlined spin />
                    ) : (
                      <Icon />
                    )}
                  </div>
                  <div className="min-w-0">
                    <Text
                      strong={isActive}
                      style={{
                        color: isActive || isComplete ? textColor : mutedColor,
                      }}
                    >
                      {step.label}
                    </Text>
                    {isActive && (
                      <div>
                        <Text style={{ color: mutedColor, fontSize: 12 }}>
                          Working on it...
                        </Text>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeetingDataSyncLoader;
