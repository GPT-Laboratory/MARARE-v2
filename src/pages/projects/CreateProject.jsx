/**
 * Project dashboard — list/create/edit/delete projects.
 * File: src/pages/projects/CreateProject.jsx
 */
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchProjects,
  deleteProject,
  updateProject,
} from '../../features/MainSlice.jsx';
import {
  Button,
  message,
  Card,
  Spin,
  Typography,
  Empty,
  Row,
  Col,
  Dropdown,
} from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  DeleteOutlined,
  FolderOpenOutlined,
  ProjectOutlined,
  PlusOutlined,
  MoreOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { setReports } from '../../features/ReportSlice.jsx';
import CreateProjectModal from '../../components/projects/CreateProjectModal';
import { File, Pencil } from "lucide-react";
import { clearGeneratedDocuments } from '../../features/mainStates/Template_Slice.jsx';
import ProjectMcpConnectorStatus from '../../components/projects/ProjectMcpConnectorStatus';

const { Title, Text } = Typography;

const ProjectList = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState(null); // For edit mode
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // Get state from Redux
  const { projects, loading } = useSelector(
    (state) => state.main
  );

  const isDeleteNameMatched =
    deleteConfirmName === (projectToDelete?.project_name ?? "");

  useEffect(() => {
    dispatch(clearGeneratedDocuments());
  }, [dispatch]);


  const generatedDocuments = useSelector((state) => state.documents.generatedDocuments);

  console.log("generatedDocuments in create project", generatedDocuments);

  console.log("projects", projects);
  

  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  useEffect(() => {
    dispatch(setReports([]));
  }, [dispatch]);

  useEffect(() => {
    // Check if this is a fresh navigation or if we've already reloaded
    const hasReloaded = history.state && history.state.hasReloaded;

    if (!hasReloaded) {
      // Before reloading, update the history state
      const newState = { ...history.state, hasReloaded: true };
      history.replaceState(newState, "");

      // Perform the reload
      window.location.reload();
    }

    // No cleanup needed for this approach
  }, [location.pathname]);

  const openDeleteModal = (project) => {
    setProjectToDelete(project);
    setDeleteConfirmName("");
    setDeleteError("");
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    if (deleteLoading) return;
    setShowDeleteModal(false);
    setProjectToDelete(null);
    setDeleteConfirmName("");
    setDeleteError("");
  };

  const handleDeleteConfirmPaste = (e) => {
    e.preventDefault();
    message.warning("Please type the project name — copy/paste is not allowed.");
  };

  const handleDeleteProject = () => {
    if (!projectToDelete?.id || !isDeleteNameMatched) return;

    setDeleteLoading(true);
    setDeleteError("");

    dispatch(deleteProject(projectToDelete.id))
      .unwrap()
      .then(() => {
        dispatch(clearGeneratedDocuments());
        dispatch(setReports([]));
        message.success("Project and all related data deleted successfully!");
        setShowDeleteModal(false);
        setProjectToDelete(null);
        setDeleteConfirmName("");
      })
      .catch((error) => {
        const errorMessage =
          typeof error === "string" ? error : error?.message || "Unknown error";
        setDeleteError("Failed to delete project: " + errorMessage);
        message.error("Failed to delete project: " + errorMessage);
      })
      .finally(() => {
        setDeleteLoading(false);
      });
  };

  const handleUpdateProject = (projectId, projectName) => {
    console.log("Update projected working", projectId);

    dispatch(updateProject({ id: projectId, project_name: projectName }))
      .unwrap()
      .then(() => {
        message.success("Project updated successfully!");
        dispatch(fetchProjects()); // Refresh the projects list
      })
      .catch((error) => {
        message.error("Failed to update project: " + error);
      });
  };

  const handleProjectDetail = (project) => {
    navigate(`/project_details/${project.project_name}/${project.id}`);
  };

  const handleEditProject = (project) => {
    setEditingProject(project);
    setIsCreateModalVisible(true);
  };


  const getDropdownItems = (project) => [
    {
      key: "details",
      label: <span className="text-green-500 text-xs">Open</span>,
      icon: <File size={14} className="text-green-500" />,
      onClick: () => handleProjectDetail(project),
    },
    {
      key: "edit",
      label: <span className="text-blue-500 text-xs">Edit</span>,
      icon: <Pencil size={14} className="text-blue-500" />,
      onClick: () => handleEditProject(project),
    },
    {
      key: "configurations",
      label: <span className="text-yellow-500 text-xs">Configurations</span>,
      icon: <SettingOutlined size={14} className="text-yellow-500" />,
      onClick: () => {
        // setConnectorProject({ id: project.id, name: project.project_name });
        // setIsModalOpen(true);
       navigate(`/${project.project_name}/${project.id}/connectors`);
      },
    },
    {
      key: "delete",
      label: "Delete Project",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => openDeleteModal(project),
    },
  ];

  const handleModalCancel = () => {
    setIsCreateModalVisible(false);
    setEditingProject(null); // Reset edit mode
  };

  const handleModalSuccess = () => {
    setIsCreateModalVisible(false);
    setEditingProject(null); // Reset edit mode
    dispatch(fetchProjects());
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <Title level={2} className="text-blue-600 mb-2">
              <ProjectOutlined className="mr-2" />
              My Projects
            </Title>
            <Text type="secondary">Manage your projects, meetings, documents, and MCP connectors</Text>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => setIsCreateModalVisible(true)}
            className="bg-blue-500 hover:bg-blue-600 border-none shadow-md"
          >
            Create Project
          </Button>
        </div>

        {/* Projects Grid */}
        {projects.length === 0 ? (
          // Empty State
          <div className="flex flex-col items-center justify-center min-h-96 bg-white rounded-lg shadow-sm border border-gray-200">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div className="text-center">
                  <Text className="text-lg text-gray-500 block mb-2">
                    No Projects yet
                  </Text>
                  <Text type="secondary">
                    Create your first project to get started
                  </Text>
                </div>
              }
            >
              <Button
                type="primary"
                size="large"
                icon={<PlusOutlined />}
                onClick={() => setIsCreateModalVisible(true)}
                className="bg-blue-500 hover:bg-blue-600 border-none"
              >
                Create Project
              </Button>
            </Empty>
          </div>
        ) : (
          // Projects Grid
          <Row gutter={[24, 24]}>
            {projects.map((project) => {
              return (
                <>
                  <Col xs={24} sm={12} lg={8} xl={6} key={project.id} className="flex">
                    <Card
                      className="flex h-full w-full flex-col shadow-lg transition-shadow duration-300 border-0 rounded-lg"
                      // bodyStyle={{ padding: "20px" }}
                      classNames={{
                        body: "flex flex-1 flex-col",
                        actions: "!mt-0 border-t border-[var(--app-border-color)]",
                      }}
                      actions={[
                        <Button
                          type="text"
                          icon={<FolderOpenOutlined />}
                          onClick={() => handleProjectDetail(project)}
                          className="text-blue-500 hover:text-blue-600"
                        >
                          Open Project
                        </Button>,
                      ]}
                    >
                      {/* Card Header */}
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <ProjectOutlined className="text-blue-500 mr-2" />
                            <Text strong className="text-lg truncate">
                              {project.project_name}
                            </Text>
                          </div>
                          {project.template_document === null ? "" :
                          <div>
                            <Link to={`/document-template/${project.project_name}/${project.id}`}
                            state={{ from: location.pathname }}
                            >
                            <Button
                            className="p-0 "
                            type="text"
                            size="small"> <ProjectOutlined className="text-gray-400 mr-2" /> Template</Button>
                            </Link>
                          </div>
                          }
                          <ProjectMcpConnectorStatus project={project} />
                          
                        </div>
                        <Dropdown
                          menu={{ items: getDropdownItems(project) }}
                          trigger={["click"]}
                          placement="bottomRight"
                        >
                          <Button
                            type="text"
                            icon={<MoreOutlined />}
                            className="text-gray-400 hover:text-gray-600"
                          />
                        </Dropdown>
                      </div>
                    </Card>
                    
                  </Col>
                  
                </>
              );
            })}
          </Row>
        )}

        {/* Create/Edit Project Modal */}
        <CreateProjectModal
          visible={isCreateModalVisible}
          onCancel={handleModalCancel}
          onSuccess={handleModalSuccess}
          editingProject={editingProject}
          onUpdate={handleUpdateProject}
        />
      </div>

      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
          onClick={closeDeleteModal}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-4xl">🗑️</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              Delete Project
            </h2>
            <p className="mb-4 text-sm text-gray-600 leading-relaxed">
              Are you sure you want to permanently delete{" "}
              <strong>{projectToDelete?.project_name}</strong>?
              This action <strong>cannot be undone</strong> and related data will
              be lost.
            </p>

            <p className="mb-2 text-sm text-gray-600">
              Type <strong>{projectToDelete?.project_name}</strong> to confirm.
              Please type it — do not copy and paste.
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              onPaste={handleDeleteConfirmPaste}
              placeholder="Type project name"
              disabled={deleteLoading}
              autoComplete="off"
              spellCheck={false}
              className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-left focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
            />

            {deleteError && (
              <p className="mb-4 text-sm text-red-600">{deleteError}</p>
            )}

            <div className="flex justify-center gap-3">
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleDeleteProject}
                disabled={deleteLoading || !isDeleteNameMatched}
              >
                {deleteLoading ? "Deleting..." : "Yes, Delete Project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProjectList;
