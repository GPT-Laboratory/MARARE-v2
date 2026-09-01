/**
 * Reusable loading spinner used in meeting flows.
 * File: src/components/meeting/GradientRotatingSpinner.jsx
 */
import React from 'react';

const GradientRotatingSpinner = () => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    background: 'transparent',
  }}>
    <div style={{
      width: '64px',
      height: '64px',
      border: '8px solid #e0e0e0',
      borderTop: '8px solid #007bff',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
    }} />
    <style>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

export default GradientRotatingSpinner;
