/**
 * MVP/Vision template editor before meetings.
 * File: src/pages/templates/MVPVISIONTemplate.jsx
 */
import React, { useEffect, useState } from "react";
import {
  Input,
  Typography,
  Button,
  Breadcrumb,
  message,
  Card,
} from "antd";
import {
  CheckCircleOutlined,
  SaveOutlined,
  HomeFilled,
} from "@ant-design/icons";
import { useDispatch, useSelector } from "react-redux";
import { Link, useParams } from "react-router-dom";
import { updateProject, fetchProjects } from '../../features/MainSlice';

const { TextArea } = Input;
const { Text, Title } = Typography;

const MVPVISIONTemplate = () => {
  const { id, project_name } = useParams();
  const dispatch = useDispatch();

  const projects = useSelector((state) => state.main.projects);
  const project = projects.find((p) => String(p.id) === id);

  const [mvpContent, setMvpContent] = useState("");
  const [visionContent, setVisionContent] = useState("");

  useEffect(() => {
    if (project?.mvpVisiontemplate) {
      const mvp = project.mvpVisiontemplate.find((t) => t.id === "mvp");
      const vision = project.mvpVisiontemplate.find((t) => t.id === "vision");
      setMvpContent(mvp?.content || "");
      setVisionContent(vision?.content || "");
    }
  }, [project]);

  const handleSave = () => {
    const updatedTemplate = [
      { id: "mvp", title: "MVP", category: "MVP", content: mvpContent },
      { id: "vision", title: "Vision", category: "Vision", content: visionContent },
    ];

    dispatch(
      updateProject({
        id: project.id,
        project_name: project.project_name,
        mvpVisiontemplate: updatedTemplate,
      })
    )
      .unwrap()
      .then(() => {
        message.success("Saved successfully");
        dispatch(fetchProjects());
      })
      .catch(() => message.error("Failed to save"));
  };

  const bothFilled = mvpContent.trim() && visionContent.trim();

  return (
    <div style={{ paddingBottom: 100, background: "#f0f2f5", minHeight: "100vh" }}>

      {/* Header */}
      <div
        style={{
          background: "#fff",
          padding: "20px 32px",
          borderBottom: "1px solid #e8e8e8",
          marginBottom: 24,
        }}
      >
        <Breadcrumb style={{ marginBottom: 16 }}>
          <Breadcrumb.Item>
            <Link to="/" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <HomeFilled />
              <span>Home</span>
            </Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>{project_name}</Breadcrumb.Item>
          <Breadcrumb.Item>MVP & Vision Template</Breadcrumb.Item>
        </Breadcrumb>

        <Title level={3} style={{ margin: 0 }}>
          MVP & Vision Document
        </Title>
      </div>

      {/* Main Content */}
      <div style={{ margin: "0 32px" }}>

        {/* MVP Card */}
        <Card
          style={{
            marginBottom: 24,
            borderRadius: 10,
            border: "1px solid #91caff",
            overflow: "hidden",
          }}
          bodyStyle={{ padding: 0 }}
        >
          {/* MVP Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              background: "#e6f4ff",
              borderBottom: "1px solid #91caff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 8,
                  height: 28,
                  background: "#1677ff",
                  borderRadius: 4,
                  display: "inline-block",
                }}
              />
              <Title level={4} style={{ margin: 0, color: "#1677ff" }}>
                MVP
              </Title>
            </div>
            {mvpContent.trim() && (
              <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 18 }} />
            )}
          </div>

          {/* MVP Content */}
          <div style={{ padding: 20 }}>
            <TextArea
              value={mvpContent}
              onChange={(e) => setMvpContent(e.target.value)}
              autoSize={{ minRows: 6, maxRows: 16 }}
              placeholder="Enter MVP content here..."
              style={{
                background: "#fff",
                borderRadius: 6,
                fontSize: 14,
                lineHeight: 1.7,
              }}
            />
          </div>
        </Card>

        {/* Vision Card */}
        <Card
          style={{
            marginBottom: 24,
            borderRadius: 10,
            border: "1px solid #d3adf7",
            overflow: "hidden",
          }}
          bodyStyle={{ padding: 0 }}
        >
          {/* Vision Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              background: "#f9f0ff",
              borderBottom: "1px solid #d3adf7",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 8,
                  height: 28,
                  background: "#722ed1",
                  borderRadius: 4,
                  display: "inline-block",
                }}
              />
              <Title level={4} style={{ margin: 0, color: "#722ed1" }}>
                Vision
              </Title>
            </div>
            {visionContent.trim() && (
              <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 18 }} />
            )}
          </div>

          {/* Vision Content */}
          <div style={{ padding: 20 }}>
            <TextArea
              value={visionContent}
              onChange={(e) => setVisionContent(e.target.value)}
              autoSize={{ minRows: 6, maxRows: 16 }}
              placeholder="Enter Vision content here..."
              style={{
                background: "#fff",
                borderRadius: 6,
                fontSize: 14,
                lineHeight: 1.7,
              }}
            />
          </div>
        </Card>
      </div>

      {/* Fixed Save Bar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          width: "100%",
          background: "#fff",
          borderTop: "1px solid #e8e8e8",
          padding: "16px 32px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 1000,
          boxShadow: "0 -2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <Text type="secondary">
          <CheckCircleOutlined
            style={{
              color: bothFilled ? "#52c41a" : "#d9d9d9",
              marginRight: 8,
            }}
          />
          {bothFilled ? "Both sections completed" : "Fill in both sections to complete"}
        </Text>
        <Button
          type="primary"
          size="large"
          icon={<SaveOutlined />}
          onClick={handleSave}
        >
          Save Template
        </Button>
      </div>
    </div>
  );
};

export default MVPVISIONTemplate;