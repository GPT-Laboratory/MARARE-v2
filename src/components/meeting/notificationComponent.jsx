/**
 * Toast-style in-meeting notification UI.
 * File: src/components/meeting/notificationComponent.jsx
 */

import React from 'react';
import { useSnackbar } from 'notistack';

export const useSuccessNotification = () => {
  const { enqueueSnackbar } = useSnackbar();
  return (message, onClose) => {
    enqueueSnackbar(message, {
      variant: 'success',
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
      hideIconVariant: false,
      preventDuplicate: true,
      action: (key) => (
        <button onClick={() => { onClose && onClose(); enqueueSnackbar.closeSnackbar(key); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, marginLeft: 8 }}>
          ×
        </button>
      ),
      onClose: (event, reason, key) => {
        if (onClose) onClose(event, reason, key);
      },
    });
  };
};

export const useWarnNotification = () => {
  const { enqueueSnackbar } = useSnackbar();
  return (message, onClose) => {
    enqueueSnackbar(message, {
      variant: 'warning',
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
      hideIconVariant: false,
      preventDuplicate: true,
      action: (key) => (
        <button onClick={() => { onClose && onClose(); enqueueSnackbar.closeSnackbar(key); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, marginLeft: 8 }}>
          ×
        </button>
      ),
      onClose: (event, reason, key) => {
        if (onClose) onClose(event, reason, key);
      },
    });
  };
};

export const useErrorNotification = () => {
  const { enqueueSnackbar } = useSnackbar();
  return (message, onClose) => {
    enqueueSnackbar(message, {
      variant: 'error',
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
      hideIconVariant: false,
      preventDuplicate: true,
      action: (key) => (
        <button onClick={() => { onClose && onClose(); enqueueSnackbar.closeSnackbar(key); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, marginLeft: 8 }}>
          ×
        </button>
      ),
      onClose: (event, reason, key) => {
        if (onClose) onClose(event, reason, key);
      },
    });
  };
};

export const useSimpleNotification = () => {
  const { enqueueSnackbar } = useSnackbar();
  return (message, onClose) => {
    enqueueSnackbar(message, {
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      autoHideDuration: 2000,
      hideIconVariant: false,
      preventDuplicate: true,
      action: (key) => (
        <button onClick={() => { onClose && onClose(); enqueueSnackbar.closeSnackbar(key); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, marginLeft: 8 }}>
          ×
        </button>
      ),
      onClose: (event, reason, key) => {
        if (onClose) onClose(event, reason, key);
      },
    });
  };
};
// Usage: import and call showInfoNotification(message) from anywhere in your app
export const useInfoNotification = () => {
  const { enqueueSnackbar } = useSnackbar();
  return (message, onClose) => {
    enqueueSnackbar(message, {
      variant: 'info',
      anchorOrigin: { vertical: 'top', horizontal: 'center' },
      autoHideDuration: 2000,
      hideIconVariant: false,
      preventDuplicate: true,
      action: (key) => (
        <button onClick={() => { onClose && onClose(); enqueueSnackbar.closeSnackbar(key); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, marginLeft: 8 }}>
          ×
        </button>
      ),
      onClose: (event, reason, key) => {
        if (onClose) onClose(event, reason, key);
      },
    });
  };
};

// If you want a component for context, you can keep this as a placeholder
const NotificationComponent = () => null;
export default NotificationComponent;