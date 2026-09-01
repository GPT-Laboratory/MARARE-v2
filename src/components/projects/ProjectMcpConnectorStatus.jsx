import React from "react";
import { Tag, Tooltip } from "antd";
import { ApiOutlined, GithubOutlined, GoogleOutlined } from "@ant-design/icons";
import { SiNotion } from "react-icons/si";
import { useNavigate } from "react-router-dom";

const PROVIDERS = {
  github: {
    label: "GitHub",
    icon: GithubOutlined,
  },
  notion: {
    label: "Notion",
    icon: SiNotion,
  },
  google_drive: {
    label: "Google Drive",
    icon: GoogleOutlined,
  },
};

const ProjectMcpConnectorStatus = ({ project }) => {
  const navigate = useNavigate();
  const connectedProviders = project?.connectedProviders ?? [];

  if (connectedProviders.length === 0) {
    return null;
  }

  const handleClick = () => {
    if (!project?.project_name || !project?.id) return;
    navigate(`/${project.project_name}/${project.id}/connectors`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-2 flex w-full items-center gap-2 rounded-md px-0 py-1 text-left transition-opacity hover:opacity-80"
      aria-label="Open MCP connectors"
      style={{ color: "var(--app-text-soft)" }}
    >
      <ApiOutlined style={{ fontSize: 12, color: "var(--app-text-soft)" }} />

      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {connectedProviders.map((providerId) => {
          const provider = PROVIDERS[providerId];
          if (!provider) return null;

          const Icon = provider.icon;

          return (
            <Tooltip key={providerId} title={`${provider.label} connected`}>
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                style={{
                  background: "var(--app-surface-muted)",
                  color: "var(--app-text-color)",
                  border: "1px solid var(--app-border-color)",
                }}
              >
                <Icon style={{ fontSize: 12 }} />
              </span>
            </Tooltip>
          );
        })}
      </div>
    </button>
  );
};

export default ProjectMcpConnectorStatus;