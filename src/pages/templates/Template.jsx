/**
 * Document template editor before meetings.
 * File: src/pages/templates/Template.jsx
 */
import React, { useEffect, useState } from "react";
import {
  Collapse,
  Input,
  Typography,
  Space,
  Button,
  Divider,
  Breadcrumb,
  message,
  Card,
  Badge,
  Progress,
  Popconfirm,
  Modal
} from "antd";
import {
  CheckCircleOutlined,
  EditOutlined,
  SaveOutlined,
  HomeFilled,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { useDispatch, useSelector } from "react-redux";
import { Link, useLocation, useParams } from "react-router-dom";
import { updateProject, fetchProjects } from '../../features/MainSlice';


const { Panel } = Collapse;
const { TextArea } = Input;
const { Text, Title } = Typography;

const Template = () => {
  const { id, project_name } = useParams();
  const dispatch = useDispatch();

  const projects = useSelector(state => state.main.projects);
  const project = projects.find(p => String(p.id) === id);

  const [sections, setSections] = useState([]);
  const [categories, setCategories] = useState({});
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingSection, setEditingSection] = useState(null);

  const location = useLocation();

  const from = location.state?.from;

  console.log("from :", from);


  useEffect(() => {
    if (project?.template_document) {
      setSections(project.template_document.sections || []);
      setCategories(project.template_document.categories || {});
    }
  }, [project]);

  /* ------------------ HANDLERS ------------------ */

  const updateSection = (id, key, value) => {
    setSections(prev =>
      prev.map(s => (s.id === id ? { ...s, [key]: value } : s))
    );
  };

  const updateCategoryTitle = (key, value) => {
    setCategories(prev => ({
      ...prev,
      [key]: { ...prev[key], title: value }
    }));
  };

  // Delete a section and save to database
  const deleteSection = (sectionId) => {
    const updatedSections = sections.filter(s => s.id !== sectionId);
    setSections(updatedSections);
    
    // Immediately save to database
    dispatch(
      updateProject({
        id: project.id,
        project_name: project.project_name,
        template_document: {
          categories,
          sections: updatedSections
        }
      })
    )
      .unwrap()
      .then(() => {
        message.success("Section deleted successfully");
        dispatch(fetchProjects());
      })
      .catch(() => message.error("Failed to delete section"));
  };

  // Add a new section to a category and save to database
  const addSection = (categoryKey) => {
    const newSection = {
      id: `section_${Date.now()}`,
      category: categoryKey,
      title: "New Section",
      content: ""
    };
    const updatedSections = [...sections, newSection];
    setSections(updatedSections);
    
    // Immediately save to database
    dispatch(
      updateProject({
        id: project.id,
        project_name: project.project_name,
        template_document: {
          categories,
          sections: updatedSections
        }
      })
    )
      .unwrap()
      .then(() => {
        message.success("New section added");
        dispatch(fetchProjects());
      })
      .catch(() => message.error("Failed to add section"));
  };

  // Delete a category and all its sections, then save to database
  const deleteCategory = (categoryKey) => {
    const updatedCategories = { ...categories };
    delete updatedCategories[categoryKey];
    const updatedSections = sections.filter(s => s.category !== categoryKey);
    
    setCategories(updatedCategories);
    setSections(updatedSections);
    
    // Immediately save to database
    dispatch(
      updateProject({
        id: project.id,
        project_name: project.project_name,
        template_document: {
          categories: updatedCategories,
          sections: updatedSections
        }
      })
    )
      .unwrap()
      .then(() => {
        message.success("Category deleted successfully");
        dispatch(fetchProjects());
      })
      .catch(() => message.error("Failed to delete category"));
  };

  // Add a new category
  const [isAddCategoryModalVisible, setIsAddCategoryModalVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const addCategory = () => {
    if (!newCategoryName.trim()) {
      message.error("Please enter a category name");
      return;
    }
    
    const categoryKey = newCategoryName.trim().replace(/\s+/g, "_");
    
    if (categories[categoryKey]) {
      message.error("Category already exists");
      return;
    }

    const colors = ["#1890ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#13c2c2", "#fa541c", "#2f54eb"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const updatedCategories = {
      ...categories,
      [categoryKey]: {
        title: newCategoryName.trim(),
        color: randomColor
      }
    };

    setCategories(updatedCategories);
    setNewCategoryName("");
    setIsAddCategoryModalVisible(false);

    // Immediately save to database
    dispatch(
      updateProject({
        id: project.id,
        project_name: project.project_name,
        template_document: {
          categories: updatedCategories,
          sections
        }
      })
    )
      .unwrap()
      .then(() => {
        message.success("Category added successfully");
        dispatch(fetchProjects());
      })
      .catch(() => message.error("Failed to add category"));
  };

  const categoryOrder = [
    "Introduction",
    "User_Description",
    "Stakeholders",
    "Product_Overview",
    "Product_Features",
    "Exemplary_Use_Cases",
    "Nonfunctional_Requirements",
    "Documentation_Requirements",
  ];


  const handleSave = () => {
    dispatch(
      updateProject({
        id: project.id,
        project_name: project.project_name,
        template_document: {
          categories,
          sections
        }
      })
    )
      .unwrap()
      .then(() => {
        message.success("Template saved successfully");
        dispatch(fetchProjects());
      })
      .catch(() => message.error("Failed to save template"));
  };

  /* ------------------ HELPERS ------------------ */

  const groupedSections = sections.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {});

  const completedCount = sections.filter(s => s.content?.trim()).length;
  const completionPercentage = sections.length > 0
    ? Math.round((completedCount / sections.length) * 100)
    : 0;

  /* ------------------ UI ------------------ */


  const [activeKeys, setActiveKeys] = useState([]);

  useEffect(() => {
    setActiveKeys(Object.keys(categories));
  }, [categories]);


  return (
    <div style={{ paddingBottom: 100, background: "#f0f2f5", minHeight: "100vh" }}>
      {/* Header Section */}
      <div style={{
        background: "#fff",
        padding: "20px 32px",
        borderBottom: "1px solid #e8e8e8",
        marginBottom: 24
      }}>
        <Breadcrumb style={{ marginBottom: 16 }}>
          <Breadcrumb.Item>
            <Link to="/" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <HomeFilled />
              <span>Home</span>
            </Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>{project_name}</Breadcrumb.Item>
        </Breadcrumb>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>Template Document</Title>
            {/* <Text type="secondary">Complete all sections to finish your template</Text> */}
          </div>

        </div>
      </div>

      {/* Main Content */}
      <div style={{ margin: "0 32px" }}>
        <Collapse
          activeKey={activeKeys}
          onChange={setActiveKeys}
          style={{
            background: "transparent",
            border: "none"
          }}
        >

          {/* Render categories - first from categoryOrder, then any additional ones */}
          {[
            ...categoryOrder.filter(key => categories[key]),
            ...Object.keys(categories).filter(key => !categoryOrder.includes(key))
          ].map(key => {
            const category = categories[key];
            if (!category) return null;
            const items = groupedSections[key] || [];

            return (
              <Panel
                key={key}
                header={
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    paddingRight: 40
                  }}>
                    <Space align="center" size={12}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          background: category.color,
                          flexShrink: 0
                        }}
                      />

                      {editingCategory === key ? (
                        <Space.Compact>
                          <Input
                            value={category.title}
                            onChange={e => updateCategoryTitle(key, e.target.value)}
                            onPressEnter={() => setEditingCategory(null)}
                            autoFocus
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                              width: 250
                            }}
                            onClick={e => e.stopPropagation()}
                          />
                          <Button
                            type="primary"
                            icon={<CheckOutlined />}
                            onClick={e => {
                              e.stopPropagation();
                              setEditingCategory(null);
                            }}
                          />
                          <Button
                            icon={<CloseOutlined />}
                            onClick={e => {
                              e.stopPropagation();
                              setEditingCategory(null);
                            }}
                          />
                        </Space.Compact>
                      ) : (
                        <>
                          <Text strong style={{ fontSize: 16 }}>
                            {category.title}
                          </Text>
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={e => {
                              e.stopPropagation();
                              setEditingCategory(key);
                            }}
                            style={{ marginLeft: 8 }}
                          />
                        </>
                      )}
                    </Space>

                    <Popconfirm
                      title="Delete Category"
                      description="This will delete the category and all its sections. Are you sure?"
                      onConfirm={(e) => {
                        e.stopPropagation();
                        deleteCategory(key);
                      }}
                      onCancel={(e) => e.stopPropagation()}
                      okText="Yes"
                      cancelText="No"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={e => e.stopPropagation()}
                        style={{ marginRight: 16 }}
                      />
                    </Popconfirm>
                  </div>
                }
                style={{
                  marginBottom: 16,
                  background: "#fff",
                  borderRadius: 8,
                  border: "1px solid #e8e8e8",
                  overflow: "hidden"
                }}
              >
                <Space direction="vertical" style={{ width: "100%" }} size={12}>
                  {items.map(item => (
                    <Card
                      key={item.id}
                      size="small"
                      style={{
                        background: item.content?.trim() ? "#f6ffed" : "#fafafa",
                        border: item.content?.trim()
                          ? "1px solid #b7eb8f"
                          : "1px solid #e8e8e8",
                        borderRadius: 8,
                        boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
                      }}
                    >
                      <Space
                        align="center"
                        style={{
                          width: "100%",
                          marginBottom: 8,
                          justifyContent: "space-between"
                        }}
                      >
                        <Space align="center">
                          {editingSection === item.id ? (
                            <Space.Compact>
                              <Input
                                value={item.title}
                                onChange={e =>
                                  updateSection(item.id, "title", e.target.value)
                                }
                                onPressEnter={() => setEditingSection(null)}
                                autoFocus
                                size="small"
                                style={{
                                  fontWeight: 600,
                                  width: 300
                                }}
                              />
                              <Button
                                type="primary"
                                size="small"
                                icon={<CheckOutlined />}
                                onClick={() => setEditingSection(null)}
                              />
                              <Button
                                size="small"
                                icon={<CloseOutlined />}
                                onClick={() => setEditingSection(null)}
                              />
                            </Space.Compact>
                          ) : (
                          <>
                              <Text strong style={{ fontSize: 14 }}>
                                {item.title}
                              </Text>
                              <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => setEditingSection(item.id)}
                              />
                            </>
                          )}
                        </Space>

                        <Space>
                          {item.content?.trim() && (
                            <CheckCircleOutlined
                              style={{
                                color: "#52c41a",
                                fontSize: 18
                              }}
                            />
                          )}
                          <Popconfirm
                            title="Delete Section"
                            description="Are you sure you want to delete this section?"
                            onConfirm={() => deleteSection(item.id)}
                            okText="Yes"
                            cancelText="No"
                            okButtonProps={{ danger: true }}
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                            />
                          </Popconfirm>
                        </Space>
                      </Space>

                      <TextArea
                        value={item.content}
                        onChange={e =>
                          updateSection(item.id, "content", e.target.value)
                        }
                        autoSize={{ minRows: 3, maxRows: 8 }}
                        placeholder="Enter content here..."
                        style={{
                          background: "#fff",
                          borderRadius: 6
                        }}
                      />
                    </Card>
                  ))}

                  {/* Add Section Button */}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => addSection(key)}
                    style={{
                      width: "100%",
                      height: 48,
                      borderRadius: 8,
                      color: "#1890ff",
                      borderColor: "#1890ff"
                    }}
                  >
                    Add New Section
                  </Button>
                </Space>
              </Panel>
            );
          })}
        </Collapse>

        {/* Add Category Button */}
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => setIsAddCategoryModalVisible(true)}
          style={{
            width: "100%",
            height: 56,
            marginTop: 16,
            borderRadius: 8,
            fontSize: 16,
            color: "#722ed1",
            borderColor: "#722ed1"
          }}
        >
          Add New Category
        </Button>
      </div>

      {/* Add Category Modal */}
      <Modal
        title="Add New Category"
        open={isAddCategoryModalVisible}
        onOk={addCategory}
        onCancel={() => {
          setIsAddCategoryModalVisible(false);
          setNewCategoryName("");
        }}
        okText="Add Category"
        cancelText="Cancel"
      >
        <Input
          placeholder="Enter category name"
          value={newCategoryName}
          onChange={e => setNewCategoryName(e.target.value)}
          onPressEnter={addCategory}
          style={{ marginTop: 16 }}
          size="large"
        />
      </Modal>

      {/* ---------- FIXED SAVE BAR ---------- */}
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
          boxShadow: "0 -2px 8px rgba(0,0,0,0.08)"
        }}
      >
        <Text type="secondary">
          <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 8 }} />
          {completedCount} of {sections.length} sections completed ({completionPercentage}%)
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

export default Template;