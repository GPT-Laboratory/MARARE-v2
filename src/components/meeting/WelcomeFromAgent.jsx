/**
 * Initial greeting message when AI agent joins.
 * File: src/components/meeting/WelcomeFromAgent.jsx
 */

import { enqueueSnackbar } from "notistack";

export const handleWelcomeFromAgent = () => {
  enqueueSnackbar("You are interacting with an AI Agent", {
    variant: "info", // like toast.info
    anchorOrigin: { vertical: "top", horizontal: "center" },
    autoHideDuration: 2000,
    hideIconVariant: false,
    preventDuplicate: true,
  });
};
