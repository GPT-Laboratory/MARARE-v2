/**
 * Static terms and conditions page.
 * File: src/pages/legal/TermsAndConditions.jsx
 */
// import React, { useState } from 'react';
// import { Checkbox } from 'antd';
// import './TermsAndConditions.css';

// const TermsAndConditions = () => {
//   const [checkboxes, setCheckboxes] = useState({
//     read: false,
//     consent: false,
//     understand: false
//   });

//   const handleCheckboxChange = (key) => {
//     setCheckboxes(prev => ({
//       ...prev,
//       [key]: !prev[key]
//     }));
//   };

//   return (
//     <div className="terms-container">
//       <div className="terms-content">

//         <h1 className="terms-title">MARARE — Informed Consent & Terms of Use</h1>
//         {/* <p className="terms-subtitle">Version 1.0 — Effective Date: March 14, 2026</p> */}

//         {/* 1. INTRODUCTION */}
//         <section className="terms-section">
//           <h2 className="section-title">1. Introduction and Purpose</h2>
//           <p className="terms-description">
//             MARARE (Multi-Agent RAG Requirement Engineering) is a research prototype developed at Tampere University.
//             It enables users to create projects, select document templates, and conduct meetings where AI agents
//             generate requirement documents in real-time.
//           </p>
//           <p className="terms-description">
//             During meetings, voice input is transcribed using Azure Speech-to-Text, and multi-agent systems (LangGraph + OpenAI)
//             generate structured documents that update every 30 seconds. A real-time Coordinator Agent assists the meeting creator.
//           </p>
//           <p className="terms-description">
//             After the meeting, users can edit and download the generated document (PDF or Word).
//             By using this system, you agree to participate in this research.
//           </p>
//         </section>

//         {/* 2. PROJECT INFO */}
//         <section className="terms-section">
//           <h2 className="section-title">2. Research Project Information</h2>
//           <ul className="terms-list">
//             <li><span className="highlight">Project Name:</span> MARARE — Multi-Agent RAG Requirement Engineering</li>
//             <li><span className="highlight">Research Institution:</span> Tampere University</li>
//             <li><span className="highlight">Researcher:</span> mallik Abdul Sami</li>
//             <li><span className="highlight">Contact Email:</span> malik.sami@tuni.fi</li>
//           </ul>
//         </section>

//         {/* 3. DATA COLLECTION */}
//         <section className="terms-section">
//           <h2 className="section-title">3. Data Collection and Processing</h2>

//           <div className="subsection">
//             <h3>3.1 Account Information</h3>
//             <p>Name, email, and profile picture via Google authentication (Supabase).</p>
//           </div>

//           <div className="subsection">
//             <h3>3.2 Usage Data</h3>
//             <p>Session activity, templates selected, meeting configuration, and interactions.</p>
//           </div>

//           <div className="subsection">
//             <h3>3.3 Meeting Content</h3>
//             <p>Real-time transcripts generated using Azure Speech-to-Text (STT).</p>
//           </div>

//           <div className="subsection">
//             <h3>3.4 Generated Documents</h3>
//             <p>Documents generated and updated every 30 seconds using AI agents.</p>
//           </div>

//           <div className="subsection">
//             <h3>3.5 Interaction Data</h3>
//             <p>Interactions with Coordinator Agent and multi-agent system (LangGraph + OpenAI).</p>
//           </div>
//         </section>

//         {/* 4. PURPOSE */}
//         <section className="terms-section">
//           <h2 className="section-title">4. Purpose of Data Collection</h2>
//           <ul className="terms-list">
//             <li>AI-assisted requirement engineering research</li>
//             <li>Improving real-time document generation</li>
//             <li>Analyzing human-AI collaboration</li>
//             <li>Academic publications</li>
//           </ul>
//         </section>

//         {/* 5. STORAGE */}
//         <section className="terms-section">
//           <h2 className="section-title">5. Data Storage and Security</h2>
//           <ul className="terms-list">
//             <li><b>MongoDB:</b> Stores transcripts, templates, documents</li>
//             <li><b>Supabase:</b> Authentication</li>
//             <li><b>Azure STT:</b> Voice transcription</li>
//             <li><b>Encryption:</b> Secure transmission (HTTPS)</li>
//             <li><b>Retention:</b> Up to 5 years</li>
//           </ul>
//         </section>

//         {/* 6. RIGHTS */}
//         <section className="terms-section">
//           <h2 className="section-title">6. Your Rights</h2>
//           <ul className="terms-list">
//             <li>Access your data</li>
//             <li>Request correction</li>
//             <li>Request deletion</li>
//             <li>Withdraw consent anytime</li>
//           </ul>
//           <p>Contact: malik.sami@tuni.fi</p>
//         </section>

//         {/* 7. LEGAL BASIS */}
//         <section className="terms-section">
//           <h2 className="section-title">7. Legal Basis</h2>
//           <p>Processing is based on your consent and research purposes.</p>
//         </section>

//         {/* 8. THIRD PARTY */}
//         <section className="terms-section">
//           <h2 className="section-title">8. Third-Party Services</h2>
//           <ul className="terms-list">
//             <li>Azure STT (voice transcription)</li>
//             <li>MongoDB (database)</li>
//             <li>Supabase (authentication)</li>
//             <li>LangGraph (multi-agent orchestration)</li>
//             <li>OpenAI (AI agents)</li>
//           </ul>
//         </section>

//         {/* 9. RESTRICTIONS */}
//         <section className="terms-section">
//           <h2 className="section-title">9. Restrictions on Use</h2>
//           <ul className="terms-list">
//             <li>No commercial use</li>
//             <li>No sharing accounts</li>
//             <li>No sensitive data input</li>
//             <li>No misuse of system</li>
//           </ul>
//         </section>

//         {/* 10. DISCLAIMER */}
//         <section className="terms-section">
//           <h2 className="section-title">10. Disclaimer</h2>
//           <ul className="terms-list">
//             <li>Provided "as is"</li>
//             <li>AI outputs may contain errors</li>
//             <li>Use at your own risk</li>
//           </ul>
//         </section>

//         {/* 11. CONTACT */}
//         <section className="terms-section">
//           <h2 className="section-title">11. Contact Information</h2>
//           <ul className="terms-list">
//             <li>Researcher: mallik Abdul Sami</li>
//             <li>Email: malik.sami@tuni.fi</li>
//             <li>Tampere University</li>
//           </ul>
//         </section>

//         {/* CONSENT */}
//         <section className="terms-section consent-section">
//           <h2 className="section-title">Informed Consent</h2>

//           <Checkbox checked={checkboxes.read} onChange={() => handleCheckboxChange('read')}>
//             I have read and understood the terms
//           </Checkbox>

//           <Checkbox checked={checkboxes.consent} onChange={() => handleCheckboxChange('consent')}>
//             I consent to data processing
//           </Checkbox>

//           <Checkbox checked={checkboxes.understand} onChange={() => handleCheckboxChange('understand')}>
//             I understand this is a research prototype
//           </Checkbox>
//         </section>

//       </div>
//     </div>
//   );
// };

// export default TermsAndConditions;











import React, { useState } from "react";
import { Checkbox, Button } from "antd";
import "./TermsAndConditions.css";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";

const TermsAndConditions = ({ onAccept }) => {
  const [checkboxes, setCheckboxes] = useState({
    read: false,
    consent: false,
    understand: false,
  });

  const handleCheckboxChange = (key) => {
    setCheckboxes((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const isConsentGiven =
    checkboxes.read && checkboxes.consent && checkboxes.understand;

  const handleAccept = () => {
    if (!isConsentGiven) return;


    // Save consent locally (you can also store in DB)
    localStorage.setItem("termsAccepted", "false");

    if (onAccept) {
      onAccept(); // parent will close popup or redirect
    }
  };

  return (
    <div className="terms-container">
      <div className="terms-content">

        <h1 className="terms-title">
          MARARE — Informed Consent & Terms of Use
        </h1>

        {/* 1. PURPOSE */}
        <section className="terms-section">
          <h2 className="section-title">1. Purpose</h2>
          <p>
            MARARE (Multi-Agent RAG Requirement Engineering) is a research
            prototype developed at Tampere University.
          </p>

          <p>It allows you to:</p>
          <ul className="terms-list">
            <li>Create projects</li>
            <li>Run meetings</li>
            <li>Generate requirement documents using AI agents</li>
          </ul>

          <p>During meetings:</p>
          <ul className="terms-list">
            <li>Voice is transcribed using Azure Speech-to-Text</li>
            <li>AI agents generate documents in real time</li>
          </ul>

          <p>After meetings:</p>
          <ul className="terms-list">
            <li>You can edit and download documents</li>
          </ul>

          <p><b>Use of this system is voluntary.</b></p>
        </section>

        {/* 2. CONSENT */}
        <section className="terms-section">
          <h2 className="section-title">2. Consent Required</h2>
          <p>You must agree to these terms before using the system.</p>
          <ul className="terms-list">
            <li>If you agree → you can use the system</li>
            <li>If you do not agree → do not use the system</li>
          </ul>
        </section>

        {/* 3. DATA */}
        <section className="terms-section">
          <h2 className="section-title">3. Data We Collect</h2>
          <ul className="terms-list">
            <li>Account data: name, email, profile picture</li>
            <li>Usage data: sessions, templates, interactions</li>
            <li>Meeting data: audio transcription (speech to text)</li>
            <li>Generated documents</li>
            <li>Interaction logs with AI agents</li>
          </ul>
        </section>

        {/* 4. USAGE */}
        <section className="terms-section">
          <h2 className="section-title">4. How Data Is Used</h2>
          <ul className="terms-list">
            <li>Research on AI-assisted requirement engineering</li>
            <li>Improve system performance</li>
            <li>Study human and AI collaboration</li>
          </ul>
          <p><b>No commercial use.</b></p>
        </section>

        {/* 5. PROCESSING */}
        <section className="terms-section">
          <h2 className="section-title">5. Data Processing and Location</h2>
          <p>This system uses third-party services:</p>
          <ul className="terms-list">
            <li>Azure (speech to text)</li>
            <li>OpenAI (AI processing)</li>
            <li>Supabase (authentication)</li>
            <li>MongoDB (storage)</li>
          </ul>
          <p>Some data may be processed outside the EU.</p>
          <p><b>By using the system, you accept this.</b></p>
        </section>

        {/* 6. DELETION */}
        <section className="terms-section">
          <h2 className="section-title">6. Data Deletion</h2>
          <ul className="terms-list">
            <li>If you delete your account, all your data will be deleted</li>
            <li>You can request deletion at any time</li>
          </ul>
          <p>Contact: malik.sami@tuni.fi</p>
        </section>

        {/* 7. RIGHTS */}
        <section className="terms-section">
          <h2 className="section-title">7. Your Rights</h2>
          <ul className="terms-list">
            <li>Access your data</li>
            <li>Request correction</li>
            <li>Request deletion</li>
            <li>Withdraw consent anytime</li>
          </ul>
        </section>

        {/* 8. RULES */}
        <section className="terms-section">
          <h2 className="section-title">8. Rules</h2>
          <ul className="terms-list">
            <li>You must not enter sensitive personal data</li>
            <li>You must not share accounts</li>
            <li>You must not misuse the system</li>
          </ul>
        </section>

        {/* 9. DISCLAIMER */}
        <section className="terms-section">
          <h2 className="section-title">9. Disclaimer</h2>
          <ul className="terms-list">
            <li>This is a research prototype</li>
            <li>AI outputs may contain errors</li>
            <li>Use results with care</li>
          </ul>
        </section>

        {/* 10. CONTACT */}
        <section className="terms-section">
          <h2 className="section-title">10. Contact</h2>
          <ul className="terms-list">
            <li>Mallik Abdul Sami</li>
            <li>Tampere University</li>
            <li>malik.sami@tuni.fi</li>
          </ul>
        </section>

        {/* CONSENT */}
        <section className="terms-section consent-section">
          <h2 className="section-title">Consent</h2>

          <div className="checkbox-group">
            <Checkbox
              checked={checkboxes.read}
              onChange={() => handleCheckboxChange("read")}
            >
              I understand how my data is used
            </Checkbox>

            <Checkbox
              checked={checkboxes.consent}
              onChange={() => handleCheckboxChange("consent")}
            >
              I agree to data processing (including outside EU)
            </Checkbox>

            <Checkbox
              checked={checkboxes.understand}
              onChange={() => handleCheckboxChange("understand")}
            >
              I participate voluntarily
            </Checkbox>
          </div>

          <p className="mt-3">
            <b>If you do not agree, do not use the system.</b>
          </p>

          {/* <Button
            type="primary"
            disabled={!isConsentGiven}
            onClick={handleAccept}
            className="accept-btn"
          >
            Accept & Continue
          </Button> */}
        </section>

      {/* <Link to="/">
        <Button
            type="primary"
            className="accept-btn"
          >
            Done
          </Button>
        </Link> */}
      </div>
    </div>
  );
};

TermsAndConditions.propTypes = {
  onAccept: PropTypes.func, // optional callback
};

export default TermsAndConditions;