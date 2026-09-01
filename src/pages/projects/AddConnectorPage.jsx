/**
 * Standalone page for managing MCP connectors.
 * File: src/pages/projects/AddConnectorPage.jsx
 */
import React, { useState, useEffect, use } from "react";
import { Spin } from "antd";
import {
  Button,
  Card,
  Form,
  Input,
  Typography,
  Space,
  Divider,
  Row,
  Col,
  Tag,
  Popconfirm,
  message,
  Switch,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SaveOutlined,
  EyeInvisibleOutlined,
  EyeTwoTone,
} from "@ant-design/icons";
import {
  RefreshCw,
} from "lucide-react";

import { useAuth } from '../../pages/auth/authcontext';
import { useParams } from "react-router-dom";

import { socketURL } from '../../services/meeting/socketInstance';

const { Title, Text, Paragraph } = Typography;


const AddConnectorPage = ({
  onBack,
}) => {
  const [configuredTools, setConfiguredTools] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [editingTool, setEditingTool] = useState(null);
  const [form] = Form.useForm();
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [configuration, setConfiguration] = useState({});
  const { project_id, project_name } = useParams();
  console.log("Project ID: in page", project_id);
  console.log("Project Name: in page", project_name);
  const { user } = useAuth();

  const [lastModifiedTool, setLastModifiedTool] = useState(null);



  // Add this state
  const [loadingConfigurations, setLoadingConfigurations] = useState(false);

  // Add this function
  const fetchExistingConfigurations = async () => {
    if (!project_id) return;

    try {
      setLoadingConfigurations(true);
      const response = await fetch(`${socketURL}/mcp/configurations/${project_id}`);
      const data = await response.json();

      if (data.success && data.configurations) {
        // Transform the data to match your configuredTools format
        const existingTools = Object.entries(data.configurations).map(([toolId, config]) => ({
          id: toolId,
          config: config,
          configuredAt: new Date().toISOString(), // You could store this in DB if needed
          // Add other tool properties if needed
          configFields: tools.find(t => t.id === toolId)?.configFields || []
        }));

        setConfiguredTools(existingTools);
        console.log("Loaded existing configurations:", existingTools);
      }
    } catch (error) {
      console.error("Error fetching existing configurations:", error);
      message.error("Failed to load existing configurations");
    } finally {
      setLoadingConfigurations(false);
    }
  };

  // Update your existing useEffect to call this function
  useEffect(() => {
    fetchTools();
    fetchExistingConfigurations(); // Add this line
  }, [project_id]);


  useEffect(() => {
    if (!lastModifiedTool) return;

    const sendConfiguredTool = async () => {
      try {
        const toolsConfig = {
          [lastModifiedTool.id]: {
            ...lastModifiedTool.config,
          }
        };

        const res = await fetch(`${socketURL}/mcp/configure`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ project_id, configurations: toolsConfig, user_id: user.id }),
        });

        if (!res.ok) {
          throw new Error("Failed to set configured tools");
        }

        const data = await res.json();
        console.log("Configured tools set successfully:", data);
        message.success("Configured tools set successfully");
      } catch (err) {
        console.error("Error setting configured tools:", err);
        message.error("Failed to set configured tools");
      }
    };

    sendConfiguredTool();
    setLastModifiedTool(null); // Reset after sending
  }, [lastModifiedTool]);



  // Add this useEffect after the existing ones
  useEffect(() => {
    const fetchProjectConfigurations = async () => {
      if (!project_id) return;

      try {
        setLoading(true);
        const response = await fetch(`${socketURL}/mcp/configurations/${project_id}`);
        const data = await response.json();

        if (data.success && data.configurations) {
          // Transform the configurations to match your component's expected format
          const transformedConfigs = Object.entries(data.configurations).map(([toolId, config]) => ({
            id: toolId,
            config: config,
            configuredAt: new Date().toISOString() // You might want to store this in DB too
          }));

          setConfiguredTools(transformedConfigs);
          console.log("Loaded existing configurations:", transformedConfigs);
        }
      } catch (error) {
        console.error("Error fetching project configurations:", error);
        message.error("Failed to load existing configurations");
      } finally {
        setLoading(false);
      }
    };

    fetchProjectConfigurations();
  }, [project_id]); // Only run when project_id changes





  const fetchTools = async () => {
  try {
    setLoading(true);
    const response = await fetch(`${socketURL}/mcp/tools`);
    const data = await response.json();
    console.log("data of tools", data)

    if (data.success) {
      // Group tools by ID
      const grouped = data.tools.reduce((acc, tool) => {
        if (!acc[tool.id]) {
          acc[tool.id] = { ...tool, instances: [] };
        }
        acc[tool.id].instances.push(tool); // keep original in case multiple tools share same id
        return acc;
      }, {});

      // Convert object back to array
      const groupedArray = Object.values(grouped);

      setTools(groupedArray);
      console.log("Grouped tools:", groupedArray);
    } else {
      console.error("Error fetching tools:", data.error);
    }
  } catch (err) {
    console.error("Error fetching tools:", err);
  } finally {
    setLoading(false);
  }
};

  // Manual refresh function
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTools();
    setRefreshing(false);
  };

  // Fetch tools on component mount and when sidebar opens
  useEffect(() => {
    fetchTools();
  }, []);

  // Group tools by ID
  const groupedTools = tools.reduce((acc, tool) => {
    if (!acc[tool.id]) {
      acc[tool.id] = tool;
    }
    return acc;
  }, {});

  const availableTools = Object.values(groupedTools);

  // Reset states when project changes
  useEffect(() => {
    setSelectedTool(null);
    setEditingTool(null);
    form.resetFields();
  }, [project_id, form]);

  const handleToolToggle = (tool) => {
    const isConfigured = configuredTools.some((ct) => ct.id === tool.id);

    if (isConfigured) {
      // Remove tool and send new state to /mcp/configure
      setConfiguredTools((prev) => {
        const updated = prev.filter((ct) => ct.id !== tool.id);
        // Send updated config to backend
        const toolsConfig = {};
        updated.forEach((t) => {
          toolsConfig[t.id] = { ...t.config };
        });
        fetch(`${socketURL}/mcp/configure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id, configuration: toolsConfig, user }),
        })
          .then((res) => {
            if (!res.ok) throw new Error("Failed to update configured tools");
            return res.json();
          })
          .then(() => {
            message.success(`${tool.id} connector removed`);
          })
          .catch(() => {
            message.error("Failed to update configured tools");
          });
        if (selectedTool?.id === tool.id) {
          setSelectedTool(null);
          form.resetFields();
        }
        return updated;
      });
    } else {
      // Add tool for configuration
      setSelectedTool(tool);
      form.resetFields();
    }
  };

  // const handleSaveConfiguration = async () => {
  //   if (!selectedTool) return;

  //   try {
  //     const values = await form.validateFields();

  //     const configuredTool = {
  //       ...selectedTool,
  //       config: values,
  //       configuredAt: new Date().toISOString(),
  //     };

  //     if (editingTool) {
  //       // Update existing tool
  //       setConfiguredTools((prev) =>
  //         prev.map((ct) => (ct.id === editingTool.id ? configuredTool : ct))
  //       );
  //       setEditingTool(null);
  //       message.success(`${selectedTool.id} configuration updated`);
  //     } else {
  //       // Add new tool
  //       setConfiguredTools((prev) => [...prev, configuredTool]);
  //       message.success(`${selectedTool.id} connector configured successfully`);
  //     }

  //     setSelectedTool(null);
  //     form.resetFields();
  //   } catch (error) {
  //     message.error("Please fill in all required fields");
  //   }
  // };




  // Then in handleSaveConfiguration, set the last modified tool:
  const handleSaveConfiguration = async () => {
    if (!selectedTool) return;

    try {
      const values = await form.validateFields();

      const configuredTool = {
        ...selectedTool,
        config: values,
        configuredAt: new Date().toISOString(),
      };

      if (editingTool) {
        setConfiguredTools((prev) =>
          prev.map((ct) => (ct.id === editingTool.id ? configuredTool : ct))
        );
        setEditingTool(null);
        message.success(`${selectedTool.id} configuration updated`);
      } else {
        setConfiguredTools((prev) => [...prev, configuredTool]);
        message.success(`${selectedTool.id} connector configured successfully`);
      }

      // Set the last modified tool to trigger the API call
      setLastModifiedTool(configuredTool);

      setSelectedTool(null);
      form.resetFields();
    } catch (error) {
      message.error("Please fill in all required fields");
    }
  };



  const handleEditTool = (tool) => {
    setEditingTool(tool);
    setSelectedTool(tool);
    form.setFieldsValue(tool.config || {});
  };

  const handleDeleteTool = (toolId) => {
    setConfiguredTools((prev) => prev.filter((ct) => ct.id !== toolId));
    message.success("Connector configuration deleted");
  };

  const renderConfigForm = () => {
    if (!selectedTool) return null;

    return (
      <>
        <Divider />
        <div style={{ marginBottom: 16 }}>
          <Title level={4}>
            Configure{" "}
            {selectedTool.id.charAt(0).toUpperCase() + selectedTool.id.slice(1)}
          </Title>
        </div>

        <Form form={form} layout="vertical">
          {selectedTool.configFields.map((field) => (
            <Form.Item
              key={field.name}
              name={field.name}
              label={field.label}
              rules={[
                {
                  required: field.required,
                  message: `Please input ${field.label.toLowerCase()}`,
                },
                field.type === "email" && {
                  type: "email",
                  message: "Please enter a valid email address",
                },
              ].filter(Boolean)}
            >
              {field.type === "password" ? (
                <Input.Password
                  placeholder={
                    field.placeholder || `Enter ${field.label.toLowerCase()}`
                  }
                  size="large"
                  iconRender={(visible) =>
                    visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
                  }
                />
              ) : (
                <Input
                  type={field.type}
                  placeholder={
                    field.placeholder || `Enter ${field.label.toLowerCase()}`
                  }
                  size="large"
                />
              )}
            </Form.Item>
          ))}

          <Form.Item>
            <Button
              type="primary"
              onClick={handleSaveConfiguration}
              icon={<SaveOutlined />}
              size="large"
              block
            >
              {editingTool ? "Update Configuration" : "Save Configuration"}
            </Button>
          </Form.Item>
        </Form>
      </>
    );
  };

  return (
    <div style={{ maxWidth: 900, margin: "32px auto", padding: 24, background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px #f0f1f2" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>Add Connector {project_name && `- ${project_name}`}</Title>
        {onBack && (
          <Button onClick={onBack} type="default">Back</Button>
        )}
      </div>
      {/* Available Connectors */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Title level={4}>Available Connectors</Title>
          <Button
            type="default"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-full p-2 transition-all duration-200 cursor-pointer disabled:opacity-50 cursor-pointer"
            style={{ marginBottom: 20, marginRight: 3 }}
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
        {loading || refreshing ? (
          <div style={{ textAlign: "center", margin: "24px 0" }}>
            <Spin
              tip={refreshing ? "Refreshing..." : "Loading connectors..."}
              size="large"
            />
          </div>
        ) : (
          <Row gutter={[16, 16]}>
            {availableTools.map((tool) => {
              const isConfigured = configuredTools.some(
                (ct) => ct.id === tool.id
              );
              const isSelected = selectedTool?.id === tool.id;
              return (
                <Col span={24} key={tool.id}>
                  <Card
                    size="small"
                    style={{
                      border: isSelected
                        ? "2px solid #1890ff"
                        : "1px solid #d9d9d9",
                      backgroundColor: isSelected ? "#f0f8ff" : "white",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <Title
                          level={5}
                          style={{ margin: 0, textTransform: "capitalize" }}
                        >
                          {tool.id}
                        </Title>
                        {/* <Paragraph
                          style={{ margin: "4px 0 0 0", color: "#666" }}
                        >
                          {tool.description}
                        </Paragraph> */}
                      </div>
                      <Space>
                        {isConfigured && <Tag color="success">Configured</Tag>}
                        <Button
                          type={
                            isConfigured
                              ? "default"
                              : isSelected
                                ? "default"
                                : "primary"
                          }
                          danger={isConfigured}
                          onClick={() => handleToolToggle(tool)}
                          size="small"
                        >
                          {isConfigured
                            ? "Remove"
                            : isSelected
                              ? "Cancel"
                              : "Add"}
                        </Button>
                      </Space>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </div>

      {/* Configuration Form */}
      {renderConfigForm()}

      {/* Configured Tools */}
      {configuredTools.length > 0 && (
        <>
          <Divider />
          <div>
            <Title level={4}>Configured Tools</Title>
            <Row gutter={[16, 16]}>
              {configuredTools.map((tool) => (
                <Col span={24} key={tool.id}>
                  <Card
                    size="small"
                    style={{
                      border: "1px solid #52c41a",
                      backgroundColor: "#f6ffed",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <Title
                          level={5}
                          style={{ margin: 0, textTransform: "capitalize" }}
                        >
                          {tool.id}
                        </Title>
                        <Text type="secondary">
                          Configured on{" "}
                          {new Date(tool.configuredAt).toLocaleDateString()}
                        </Text>
                      </div>
                      <Space>
                        <Button
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => handleEditTool(tool)}
                          title="Edit configuration"
                        />
                        <Popconfirm
                          title="Delete Configuration"
                          description="Are you sure you want to delete this connector configuration?"
                          onConfirm={() => handleDeleteTool(tool.id)}
                          okText="Yes"
                          cancelText="No"
                        >
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            title="Delete configuration"
                          />
                        </Popconfirm>
                      </Space>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        </>
      )}
    </div>
  );
};

export default AddConnectorPage;
