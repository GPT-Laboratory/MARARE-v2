/**
 * MCP connector configuration for a project.
 * File: src/pages/projects/ProjectMcpConfigurationPage.jsx
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Form,
  Input,
  Popconfirm,
  Row,
  Space,
  Tag,
  Typography,
  Radio,
  message,
} from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  GithubOutlined,
  GoogleOutlined,
  HomeFilled,
  KeyOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { SiNotion } from "react-icons/si";
import { Link, useParams } from "react-router-dom";
import { socketURL } from '../../services/meeting/socketInstance';
import { useAuth } from '../../pages/auth/authcontext';
import {
  STORAGE_BACKEND,
  updateDocumentStoragePreference,
} from '../../utils/projectDocumentStorage';

const { Text, Title, Paragraph } = Typography;


const PROVIDERS = {
  github: {
    id: "github",
    name: "GitHub",
    icon: <GithubOutlined className="text-xl" />,
    title: "GitHub MCP",
    description:
      "Let the realtime meeting agent use GitHub MCP tools for repositories, issues, pull requests, commits, and code search.",
    tokenLabel: "GitHub Personal Access Token",
    tokenName: "githubToken",
    tokenPlaceholder: "ghp_...",
    usernameName: "githubUsername",
    usernameLabel: "GitHub Username",
    usernamePlaceholder: "octocat",
    tokenExtra: "Use a fine-grained GitHub token with only the repository access this project needs.",
  },
  notion: {
    id: "notion",
    name: "Notion",
    icon: <SiNotion className="text-xl" />,
    title: "Notion MCP",
    description:
      "Let the realtime meeting agent use Notion MCP tools for pages, databases, workspace search, and project knowledge.",
    oauthMessage: "Notion uses OAuth",
    oauthButton: "Connect Notion with OAuth",
    reconnectButton: "Reconnect Notion with OAuth",
    tokenExtra: "You will be redirected to Notion to approve access. Tokens are encrypted on the backend.",
  },
  google_drive: {
    id: "google_drive",
    name: "Google Drive",
    icon: <GoogleOutlined className="text-xl text-blue-500" />,
    title: "Google Drive MCP",
    description:
      "Let the realtime meeting agent search, read, and manage Google Drive files using OAuth. Works with personal Gmail and Google Workspace accounts.",
    usernameName: "accountLabel",
    usernameLabel: "Account Label",
    usernamePlaceholder: "My Drive",
    oauthMessage: "Google Drive uses OAuth",
    oauthButton: "Connect Google Drive with OAuth",
    reconnectButton: "Reconnect Google Drive with OAuth",
    tokenExtra:
      "You will be redirected to Google to approve Drive access. Enable Google Drive API in your Google Cloud OAuth app and add your account as a test user if the app is in testing mode. Tokens are encrypted on the backend.",
  },
};

const emptyConfigurations = {};

const ProjectMcpConfigurationPage = () => {
  const { project_id, project_name } = useParams();
  const { user } = useAuth();
  const [githubForm] = Form.useForm();
  const [notionForm] = Form.useForm();
  const [googleDriveForm] = Form.useForm();
  const forms = useMemo(
    () => ({
      github: githubForm,
      notion: notionForm,
      google_drive: googleDriveForm,
    }),
    [githubForm, notionForm, googleDriveForm],
  );
  const [loading, setLoading] = useState(false);
  const [savingProvider, setSavingProvider] = useState("");
  const [configurations, setConfigurations] = useState(emptyConfigurations);
  const [error, setError] = useState("");
  const [savingStoragePreference, setSavingStoragePreference] = useState(false);
  const [documentStorage, setDocumentStorage] = useState(null);

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    if (user?.id) query.set("user_id", user.id);
    return query.toString();
  }, [user?.id]);

  const fetchConfigurations = useCallback(async () => {
    if (!project_id) return;

    try {
      setLoading(true);
      setError("");
      const response = await fetch(
        `${socketURL}/mcp/configurations/${project_id}${queryString ? `?${queryString}` : ""}`,
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to load MCP configurations");
      }

      const nextConfigurations = data.configurations || {};
      setConfigurations(nextConfigurations);
      setDocumentStorage(data.documentStorage || null);

      Object.entries(PROVIDERS).forEach(([providerId, provider]) => {
        const config = nextConfigurations[providerId] || {};
        const fieldValues = {};
        if (provider.usernameName) {
          fieldValues[provider.usernameName] =
            providerId === "github"
              ? config.githubUsername || ""
              : providerId === "notion"
                ? config.workspaceName || ""
                : config.accountLabel || "";
        }
        if (provider.tokenName) {
          fieldValues[provider.tokenName] = "";
        }
        forms[providerId].setFieldsValue(fieldValues);
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [forms, project_id, queryString]);

  useEffect(() => {
    fetchConfigurations();
  }, [fetchConfigurations]);

  useEffect(() => {
    const handleOAuthMessage = (event) => {
      const messageType = event.data?.type;
      if (!["notion-mcp-connected", "google-drive-mcp-connected"].includes(messageType)) return;
      const providerName = messageType === "notion-mcp-connected" ? "Notion" : "Google Drive";
      setSavingProvider("");
      message.success(`${providerName} MCP connected for this project.`);
      fetchConfigurations();
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [fetchConfigurations]);

  const updateDocumentStoragePreferenceSelection = async (preference) => {
    if (!project_id || !user?.id) {
      message.error("Project and user are required.");
      return;
    }

    try {
      setSavingStoragePreference(true);
      setError("");
      const status = await updateDocumentStoragePreference({
        projectId: project_id,
        userId: user.id,
        preference,
      });
      setDocumentStorage(status);
      message.success(
        preference === STORAGE_BACKEND.NOTION
          ? "Notion is now the primary document storage for this project."
          : preference === STORAGE_BACKEND.GOOGLE_DRIVE
            ? "Google Drive is now the primary document storage for this project."
            : "Supabase is now the primary document storage for this project.",
      );
      await fetchConfigurations();
    } catch (err) {
      setError(err.message);
      message.error(err.message);
    } finally {
      setSavingStoragePreference(false);
    }
  };

  const saveProvider = async (providerId, values) => {
    if (!project_id) {
      message.error("Project id is missing.");
      return;
    }
    if (!user?.id) {
      message.error("You must be signed in to configure MCP.");
      return;
    }

    if (providerId === "notion" || providerId === "google_drive") {
      await startProviderOAuth(providerId, values);
      return;
    }

    const provider = PROVIDERS[providerId];
    const payload = {
      githubUsername: values[provider.usernameName],
      githubToken: values[provider.tokenName],
      enabled: true,
    };

    try {
      setSavingProvider(providerId);
      setError("");
      const response = await fetch(`${socketURL}/mcp/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id,
          user_id: user.id,
          configurations: {
            [providerId]: payload,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed to save ${provider.name} MCP configuration`);
      }

      message.success(`${provider.name} MCP connected for this project.`);
      await fetchConfigurations();
    } catch (err) {
      setError(err.message);
      message.error(err.message);
    } finally {
      setSavingProvider("");
    }
  };

  const startProviderOAuth = async (providerId, values) => {
    const provider = PROVIDERS[providerId];
    if (!project_id) {
      message.error("Project id is missing.");
      return;
    }
    if (!user?.id) {
      message.error(`You must be signed in to connect ${provider.name}.`);
      return;
    }

    try {
      setSavingProvider(providerId);
      setError("");
      const oauthSlug = providerId === "google_drive" ? "google-drive" : providerId;
      const response = await fetch(`${socketURL}/mcp/oauth/${oauthSlug}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id,
          user_id: user.id,
          workspaceName: values.workspaceName,
          accountLabel: values.accountLabel,
          redirect_uri: `${socketURL}/mcp/oauth/${oauthSlug}/callback`,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed to start ${provider.name} OAuth`);
      }

      const popup = window.open(
        data.authorizationUrl,
        `${oauthSlug}-mcp-oauth`,
        "width=720,height=820",
      );
      if (!popup) {
        throw new Error("Popup was blocked. Please allow popups and try again.");
      }

      message.info(`Complete the ${provider.name} authorization in the opened window.`);
      const poll = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(poll);
        setSavingProvider("");
        fetchConfigurations();
      }, 1000);
    } catch (err) {
      setError(err.message);
      message.error(err.message);
      setSavingProvider("");
    }
  };

  const disconnectProvider = async (providerId) => {
    const provider = PROVIDERS[providerId];
    try {
      setSavingProvider(providerId);
      setError("");
      const response = await fetch(
        `${socketURL}/mcp/configurations/${project_id}/${providerId}${queryString ? `?${queryString}` : ""}`,
        { method: "DELETE" },
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed to disconnect ${provider.name} MCP`);
      }

      forms[providerId].resetFields();
      message.success(`${provider.name} MCP disconnected from this project.`);
      await fetchConfigurations();
    } catch (err) {
      setError(err.message);
      message.error(err.message);
    } finally {
      setSavingProvider("");
    }
  };

  const renderProviderCard = (providerId) => {
    const provider = PROVIDERS[providerId];
    const config = configurations[providerId] || {};
    const isConfigured = Boolean(config.tokenConfigured);
    const isSaving = savingProvider === providerId;

    return (
      <Card
        key={providerId}
        loading={loading}
        className="shadow-sm h-full"
        title={
          <Space className="flex-wrap">
            {provider.icon}
            <span>{provider.title}</span>
            <Tag color={isConfigured ? "green" : "default"}>
              {isConfigured ? "Connected" : "Not connected"}
            </Tag>
          </Space>
        }
        extra={
          isConfigured ? (
            <Popconfirm
              title={`Disconnect ${provider.name}?`}
              description={`The realtime agent will stop using ${provider.name} MCP tools for this project.`}
              okText="Disconnect"
              cancelText="Cancel"
              onConfirm={() => disconnectProvider(providerId)}
            >
              <Button danger type="text" icon={<DeleteOutlined />} loading={isSaving}>
                Disconnect
              </Button>
            </Popconfirm>
          ) : null
        }
      >
        <Space direction="vertical" size="middle" className="w-full">
          <Paragraph type="secondary" className="mb-0">
            {provider.description}
          </Paragraph>

          <Space wrap>
            <Tag icon={<SafetyCertificateOutlined />} color="blue">
              Project scoped
            </Tag>
            <Tag icon={<KeyOutlined />} color="purple">
              Token encrypted
            </Tag>
            <Tag icon={<LinkOutlined />} color="geekblue">
              Uses official MCP tools
            </Tag>
          </Space>

          {isConfigured && (
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              message={`${provider.name} MCP is connected`}
              description={
                <Text type="secondary">
                  {providerId === "github" && config.githubUsername
                    ? `Username: ${config.githubUsername}. `
                    : ""}
                  {providerId === "notion" && config.workspaceName
                    ? `Workspace: ${config.workspaceName}. `
                    : ""}
                  {providerId === "google_drive" && config.accountEmail
                    ? `Account: ${config.accountEmail}. `
                    : ""}
                  {(providerId === "notion" || providerId === "google_drive") && config.authType === "oauth"
                    ? "Connected with OAuth. "
                    : `Token: ${config.tokenPreview || "configured"}. `}
                  {config.updatedAt
                    ? ` Last updated ${new Date(config.updatedAt).toLocaleString()}.`
                    : ""}
                </Text>
              }
            />
          )}

          {providerId === "google_drive" && (
            (Array.isArray(config.missingScopes) && config.missingScopes.length > 0) ||
            config.needsReconnect
          ) && (
              <Alert
                type="warning"
                showIcon
                message="Google Drive needs reconnection"
                description={
                  config.needsReconnect && !(Array.isArray(config.missingScopes) && config.missingScopes.length > 0)
                    ? "This project is still using the previous Google Drive integration or is missing a refresh token. Disconnect and reconnect Google Drive."
                    : `The saved OAuth grant is missing: ${config.missingScopes.join(", ")}. Disconnect and reconnect Google Drive, then approve Drive access on the Google consent screen.`
                }
              />
            )}

          {isConfigured && providerId === "google_drive" && documentStorage?.backend === STORAGE_BACKEND.GOOGLE_DRIVE && (
            <Alert
              type="success"
              showIcon
              message="Google Drive is the primary document storage for this project"
              description="Meeting documents are saved to and loaded from your connected Google Drive."
            />
          )}

          {isConfigured && providerId === "notion" && documentStorage?.backend === STORAGE_BACKEND.NOTION && (
            <Alert
              type="success"
              showIcon
              message="Notion is the primary document storage for this project"
              description={
                config.notionMeetingDatabaseReady
                  ? `Documents are saved to and loaded from your Notion database${config.notionMeetingDatabaseId ? ` (${config.notionMeetingDatabaseId.slice(0, 8)}…)` : ""}.`
                  : "The Notion document database will be created automatically on the first save."
              }
            />
          )}

          {isConfigured &&
            providerId === "notion" &&
            documentStorage?.notionReady &&
            documentStorage?.backend !== STORAGE_BACKEND.NOTION && (
            <Alert
              type="info"
              showIcon
              message="Notion is connected for MCP tools and optional document export"
              description="Choose where meeting documents are saved in the storage section below."
            />
          )}

          {isConfigured &&
            providerId === "google_drive" &&
            documentStorage?.googleDriveReady &&
            documentStorage?.backend !== STORAGE_BACKEND.GOOGLE_DRIVE && (
            <Alert
              type="info"
              showIcon
              message="Google Drive is connected for MCP tools and optional document export"
              description="Choose where meeting documents are saved in the storage section below."
            />
          )}

          <Form
            form={forms[providerId]}
            layout="vertical"
            onFinish={(values) => saveProvider(providerId, values)}
          >
            {provider.usernameName && <Form.Item
              label={provider.usernameLabel}
              name={provider.usernameName}
              rules={[
                {
                  required: providerId === "github",
                  message: `Enter ${provider.usernameLabel?.toLowerCase()}.`,
                },
              ]}
            >
              <Input
                size="large"
                prefix={provider.icon}
                placeholder={provider.usernamePlaceholder}
                autoComplete="off"
              />
            </Form.Item>}

            {providerId === "github" ? (
              <Form.Item
                label={isConfigured ? `${provider.tokenLabel} (leave blank to keep current token)` : provider.tokenLabel}
                name={provider.tokenName}
                rules={[
                  {
                    validator: (_, value) => {
                      if (isConfigured || value) return Promise.resolve();
                      return Promise.reject(new Error(`Enter ${provider.tokenLabel.toLowerCase()}.`));
                    },
                  },
                ]}
                extra={provider.tokenExtra}
              >
                <Input.Password
                  size="large"
                  prefix={<KeyOutlined className="text-gray-400" />}
                  placeholder={isConfigured ? "Keep existing token" : provider.tokenPlaceholder}
                  autoComplete="new-password"
                />
              </Form.Item>
            ) : (
              <Alert
                type="info"
                showIcon
                message={provider.oauthMessage}
                description={provider.tokenExtra}
              />
            )}

            <Button type="primary" htmlType="submit" size="large" loading={isSaving}>
              {providerId === "notion" || providerId === "google_drive"
                ? isConfigured
                  ? provider.reconnectButton
                  : provider.oauthButton
                : isConfigured
                  ? `Update ${provider.name} MCP`
                  : `Connect ${provider.name} MCP`}
            </Button>
          </Form>
        </Space>
      </Card>
    );
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-8">
      <Breadcrumb className="mb-6">
        <Breadcrumb.Item>
          <HomeFilled />
          <Link to="/">Projects</Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <Link to={`/project_details/${project_name}/${project_id}`}>
            {project_name || "Project"}
          </Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>MCP Configuration</Breadcrumb.Item>
      </Breadcrumb>

      <div className="mb-6">
        <Space align="start">
          <ApiOutlined className="text-3xl text-blue-500 mt-1" />
          <div>
            <Title level={2} className="mb-1">
              Project MCP Configuration
            </Title>
            <Text type="secondary">
              Connect external MCP servers for this project. Meetings created from this project only use these configured tools.
            </Text>
          </div>
        </Space>
      </div>

      {error && <Alert className="mb-6" type="error" showIcon message={error} />}

      {documentStorage?.availableBackends?.length >= 2 && (
        <Card
          className="mb-6 shadow-sm border border-slate-200"
          title={
            <Space>
              <DatabaseOutlined className="text-blue-500" />
              <span>Primary document storage</span>
            </Space>
          }
        >
          <Paragraph type="secondary" className="mb-4">
            Choose where meeting documents are saved and loaded by default. Supabase is the
            default unless you switch to a connected external storage provider.
          </Paragraph>
          <Radio.Group
            value={documentStorage.preference || STORAGE_BACKEND.SUPABASE}
            onChange={(event) => updateDocumentStoragePreferenceSelection(event.target.value)}
            disabled={savingStoragePreference}
          >
            <Space direction="vertical">
              <Radio value={STORAGE_BACKEND.SUPABASE}>
                Supabase (default)
              </Radio>
              {documentStorage?.googleDriveReady && (
                <Radio value={STORAGE_BACKEND.GOOGLE_DRIVE}>
                  Google Drive
                </Radio>
              )}
              {documentStorage?.notionReady && (
                <Radio value={STORAGE_BACKEND.NOTION}>
                  Notion database
                </Radio>
              )}
            </Space>
          </Radio.Group>
        </Card>
      )}

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={12}>
          {renderProviderCard("github")}
        </Col>
        <Col xs={24} lg={12}>
          {renderProviderCard("notion")}
        </Col>
        <Col xs={24} lg={12}>
          {renderProviderCard("google_drive")}
        </Col>
      </Row>
    </div>
  );
};

export default ProjectMcpConfigurationPage;
