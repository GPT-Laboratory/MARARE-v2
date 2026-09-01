/**
 * First-login modal prompting acceptance of terms.
 * File: src/pages/legal/TermsPopup.jsx
 */
import React from 'react';
import { Modal, Button } from 'antd';
import TermsAndConditions from './TermsAndConditions';
import { CloseOutlined } from '@ant-design/icons';
import './TermsPopup.css';

const TermsPopup = ({ visible, onClose }) => {
  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={900}
      closeIcon={<CloseOutlined />}
      centered
      className="terms-popup-modal"
      styles={{
        body: {
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: 0
        }
      }}
    >
      <TermsAndConditions />
      <div className="terms-popup-footer">
        <Button 
          type="primary" 
          size="large" 
          onClick={onClose}
          className="terms-close-button"
        >
          Done
        </Button>
      </div>
    </Modal>
  );
};

export default TermsPopup;
