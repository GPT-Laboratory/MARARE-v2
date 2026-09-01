/**
 * Export buttons for document PDF download in project views.
 * File: src/components/documents/DownloadPDFButtons.jsx
 */
import React from "react";
import { Button, Space, message } from "antd";
import { FilePdfOutlined, DownloadOutlined, FileTextOutlined } from "@ant-design/icons";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const DownloadPDFButtons = ({ allTranscripts, teams, documentSections }) => {
  // ✅ Download Transcript as PDF
  const downloadTranscript = () => {
    if (!allTranscripts || allTranscripts.length === 0) {
      message.warning("No transcript available to download!");
      return;
    }

    const doc = new jsPDF();

    // Title
    doc.setFontSize(18);
    doc.text("Meeting Transcript", 14, 20);

    // Prepare table data
    const tableData = allTranscripts.map((item, idx) => [
      idx + 1,
      item.speaker || item.source,
      item.message || item.text,
    ]);

    autoTable(doc, {
      head: [["#", "Speaker", "Message"]],
      body: tableData,
      startY: 30,
      styles: { fontSize: 10, cellWidth: "wrap" },
      columnStyles: {
        0: { cellWidth: 10 },
        1: { cellWidth: 30 },
        2: { cellWidth: 140 },
      },
    });

    doc.save("Meeting_Transcript.pdf");
    message.success("Transcript downloaded!");
  };

  // ✅ Download Teams Data as PDF
  const downloadTeamsData = () => {
    if (!teams || teams.length === 0) {
      message.warning("No teams data available to download!");
      return;
    }

    const doc = new jsPDF();

    // Title
    doc.setFontSize(18);
    doc.text("Teams Proposal Data", 14, 20);

    // Prepare table data
    const tableData = teams.map((team, idx) => [
      idx + 1,
      team.name,
      team.data?.mvp || "N/A",
      team.data?.vision || "N/A",
    ]);

    autoTable(doc, {
      head: [["#", "Team", "MVP", "Vision"]],
      body: tableData,
      startY: 30,
      styles: { fontSize: 10, cellWidth: "wrap" },
      columnStyles: {
        0: { cellWidth: 10 },
        1: { cellWidth: 40 },
        2: { cellWidth: 70 },
        3: { cellWidth: 70 },
      },
    });

    doc.save("Teams_Data.pdf");
    message.success("Teams data downloaded!");
  };


  // ✅ Download Document Sections as PDF
  const downloadDocumentSections = () => {
    if (!documentSections || documentSections.length === 0) {
      message.warning("No document sections available to download!");
      return;
    }

    const doc = new jsPDF();

    // Title
    doc.setFontSize(18);
    doc.text("Generated Document Sections", 14, 20);

    let yPosition = 30;

    documentSections.forEach((section) => {
      // Check if we need a new page
      if (yPosition > 270) {
        doc.addPage();
        yPosition = 20;
      }

      // Section Title
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(section.title, 14, yPosition);
      yPosition += 7;

      // Section Content
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');

      const content = section.content || "No content available";
      const splitContent = doc.splitTextToSize(content, 180);

      splitContent.forEach((line) => {
        if (yPosition > 280) {
          doc.addPage();
          yPosition = 20;
        }
        doc.text(line, 14, yPosition);
        yPosition += 5;
      });

      yPosition += 5; // Space between sections
    });

    doc.save("Document_Sections.pdf");
    message.success("Document sections downloaded!");
  };

  return (
    <Space style={{ marginBottom: 16 }}>
      <Button
        type="primary"
        icon={<FilePdfOutlined />}
        onClick={downloadTranscript}
        disabled={!allTranscripts || allTranscripts.length === 0}
      >
        Download Transcript
      </Button>

      {/* <Button
        type="primary"
        icon={<DownloadOutlined />}
        onClick={downloadTeamsData}
      >
        Download Teams Data
      </Button> */}

      <Button
        type="primary"
        icon={<FileTextOutlined />}
        onClick={downloadDocumentSections}
        disabled={!documentSections || documentSections.length === 0}
      >
        Download Document Sections
      </Button>
    </Space>
  );
};

export default DownloadPDFButtons;
