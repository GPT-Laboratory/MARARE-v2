/**
 * Global app header — navigation, theme toggle, user menu, logout.
 */




/** Global app header — navigation, theme toggle, user menu, logout. Used inside App Layout. */
import React, { useState } from "react";
import { Button, Switch, Dropdown, Avatar, Typography, Modal } from "antd";
import {
  UserOutlined,
  MoonOutlined,
  SunOutlined,
  LogoutOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useAuth } from '../../pages/auth/authcontext.jsx';
import supabase from '../../services/supabase/supabaseclient.jsx';
import { useNavigate } from "react-router-dom";
import AddConnectorModel from '../../pages/projects/AddConnectorPage.jsx';
import { logoutUser } from '../../utils/authLogout';

const { Text } = Typography;

const Header = ({ isDarkMode, toggleTheme, handler }) => {
  const { user } = useAuth();
  const imgElement = user?.user_metadata.picture ?? null;
  const navigate = useNavigate();
  const [, setIsModalOpen] = useState(false);

  // Delete account states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleLogout = () => {
    logoutUser();
  };

  // const handleDeleteAccount = async () => {
  //   setDeleteLoading(true);
  //   setDeleteError("");
  //   try {
  //     const {
  //       data: { session },
  //     } = await supabase.auth.getSession();
  //     if (!session) throw new Error("No active session found.");

  //     const response = await fetch(
  //       `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`,
  //       {
  //         method: "DELETE",
  //         headers: {
  //           "Content-Type": "application/json",
  //           Authorization: `Bearer ${session.access_token}`,
  //         },
  //       }
  //     );

  //     if (!response.ok) {
  //       const errData = await response.json();
  //       throw new Error(errData.message || "Failed to delete account.");
  //     }

  //     await supabase.auth.signOut();
  //     localStorage.clear();
  //     setShowDeleteModal(false);
  //     window.location.href = "/";
  //   } catch (error) {
  //     console.error("Error deleting account:", error);
  //     setDeleteError(error.message || "Something went wrong. Please try again.");
  //   } finally {
  //     setDeleteLoading(false);
  //   }
  // };

  // Profile dropdown menu items
  
  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const { error } = await supabase.rpc("delete_current_user");
      if (error) throw error;
  
      await supabase.auth.signOut();
      localStorage.clear();
      setShowDeleteModal(false);
      window.location.href = "/";
    } catch (error) {
      console.error("Error deleting account:", error);
      setDeleteError(error.message || "Something went wrong. Please try again.");
    } finally {
      setDeleteLoading(false);
    }
  };
  
  const profileMenuItems = [
    {
      key: "user-info",
      label: (
        <div className="px-2 py-1">
          <Text strong className="block">
            {user?.user_metadata?.full_name || "User"}
          </Text>
          <Text type="secondary" className="text-sm">
            {user?.email}
          </Text>
        </div>
      ),
      disabled: true,
    },
    {
      key: "configurations",
      label: "Configurations",
      onClick: () => setIsModalOpen(true),
    },
    {
      type: "divider",
    },
    {
      key: "logout",
      label: "Logout",
      icon: <LogoutOutlined />,
      onClick: handleLogout,
      danger: true,
    },
    {
      type: "divider",
    },
    {
      key: "delete-account",
      label: "Delete Account",
      icon: <DeleteOutlined />,
      onClick: () => {
        setDeleteError("");
        setShowDeleteModal(true);
      },
      danger: true,
    },
  ];

  return (
    <>
      <header
        className={`px-6 py-4 relative z-50 border-b ${
          isDarkMode
            ? "bg-gray-900 border-gray-700"
            : "bg-white border-gray-200"
        }`}
      >
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          {/* Logo */}
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span
              className={`text-xl font-semibold ${
                isDarkMode ? "text-gray-100" : "text-gray-900"
              }`}
            >
              <button
                onClick={() => navigate("/")}
                style={{ cursor: "pointer" }}
              >
                MARARE
              </button>
            </span>
          </div>

          {/* Right side controls */}
          <div className="flex items-center space-x-3">
            {/* Theme Toggle */}
            <Switch
              checked={isDarkMode}
              onChange={toggleTheme}
              checkedChildren={<MoonOutlined />}
              unCheckedChildren={<SunOutlined />}
            />

            {/* Profile Section */}
            {user ? (
              <Dropdown
                menu={{ items: profileMenuItems }}
                placement="bottomRight"
                arrow
                trigger={["click"]}
              >
                <Button
                  type="text"
                  className={`flex items-center justify-center p-1 rounded-full ${
                    isDarkMode ? "hover:bg-gray-800" : "hover:bg-gray-100"
                  }`}
                >
                  {user.user_metadata?.avatar_url ? (
                    <Avatar src={imgElement} className="cursor-pointer" />
                  ) : (
                    <Avatar
                      icon={<UserOutlined />}
                      className="cursor-pointer bg-blue-500"
                    />
                  )}
                </Button>
              </Dropdown>
            ) : (
              <Button
                type="default"
                icon={<UserOutlined />}
                onClick={handler}
                className={`ml-2 hover:border-blue-500 hover:text-blue-500 ${
                  isDarkMode
                    ? "border-gray-600 text-gray-100 bg-gray-800"
                    : "border-gray-300 text-gray-700"
                }`}
              >
                Login
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* AddConnector Modal */}
      {/* <AddConnectorModel
        isModalOpen={isModalOpen}
        setIsModalOpen={setIsModalOpen}
      /> */}

      {/* Delete Account Confirmation Modal */}
      <Modal
        open={showDeleteModal}
        onCancel={() => !deleteLoading && setShowDeleteModal(false)}
        footer={null}
        centered
        closable={!deleteLoading}
        maskClosable={!deleteLoading}
        width={420}
      >
        <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
          {/* Icon */}
          <div style={{ fontSize: 48, marginBottom: 12 }}>🗑️</div>

          <Text
            strong
            style={{
              fontSize: 20,
              display: "block",
              marginBottom: 10,
              color: isDarkMode ? "#f8fafc" : "#1a202c",
            }}
          >
            Delete Account
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: isDarkMode ? "#cbd5e1" : "#4a5568",
              lineHeight: 1.7,
              display: "block",
              marginBottom: 20,
            }}
          >
            Are you sure you want to permanently delete your account?
            This action <strong>cannot be undone</strong> and all your data will be lost.
          </Text>

          {/* Error message */}
          {deleteError && (
            <div
              style={{
                background: isDarkMode ? "rgba(127, 29, 29, 0.25)" : "#fff5f5",
                border: `1px solid ${isDarkMode ? "#ef4444" : "#feb2b2"}`,
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 16,
                color: isDarkMode ? "#fecaca" : "#e53e3e",
                fontSize: 13,
              }}
            >
              {deleteError}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Button
              onClick={() => {
                setShowDeleteModal(false);
                setDeleteError("");
              }}
              disabled={deleteLoading}
              size="large"
            >
              Cancel
            </Button>
            <Button
              danger
              type="primary"
              size="large"
              loading={deleteLoading}
              onClick={handleDeleteAccount}
              icon={<DeleteOutlined />}
            >
              {deleteLoading ? "Deleting..." : "Yes, Delete My Account"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default Header;