/**
 * Prompts guest to enter display name before joining.
 * File: src/helpers/UserNameRequest.jsx
 */
import React, { useState, useEffect } from "react";
import { Modal, Input, Button } from "antd";
import supabase from "../services/supabase/supabaseclient";
import { useSnackbar } from "notistack";

export default function UserNameRequest({ userName, setUserName }) {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const { enqueueSnackbar } = useSnackbar();

  const giveSuccessNotification = (message) => {
    enqueueSnackbar(message, {
      variant: "success",
      anchorOrigin: { vertical: "top", horizontal: "left" },
      autoHideDuration: 2000,
    });
  };

  const giveWarnNotification = (message) => {
    enqueueSnackbar(message, {
      variant: "warning",
      anchorOrigin: { vertical: "top", horizontal: "left" },
      autoHideDuration: 2000,
    });
  };

  // show popup if userName is missing or default “User”
  useEffect(() => {
    if (!userName || userName === "User") {
      setIsModalVisible(true);
    }
  }, [userName]);

  const handleSave = async () => {
    if (!newName.trim()) {
      giveWarnNotification("Please enter a valid name!");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      data: { full_name: newName.trim() },
    });

    if (error) {
      giveWarnNotification("Error saving name, please try again.");
    } else {
      giveSuccessNotification("Name added successfully!");
      setUserName(newName.trim());
      setIsModalVisible(false);
    }
  };

  return (
    <Modal
      title="Add Your Name"
      open={isModalVisible}
      onCancel={() => setIsModalVisible(false)}
      footer={null}
      centered
    >
      <div className="space-y-4">
        <Input
          placeholder="Enter your full name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />

        <div className="flex justify-end gap-3 mt-4">
          <Button onClick={() => setIsModalVisible(false)}>Cancel</Button>
          <Button type="primary" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
