/**
 * PDF/DOCX export helpers for generated documents.
 * File: src/utils/documentUtils.js
 */
import { message } from "antd";
import { jsPDF } from "jspdf";

export const toSectionTitleKey = (title = "") =>
  title.toLowerCase().replace(/\s+/g, "_");

export const buildDocumentSections = (doc) => {
  const templateSections = doc?.template?.sections || [];
  const templateCategories = doc?.template?.categories || {};
  const generatedSections = doc?.generated_sections || {};

  const sections = templateSections.map((section) => ({
    id: section.id,
    title: section.title,
    category: section.category,
    categoryTitle:
      templateCategories?.[section.category]?.title || section.category,
    content:
      generatedSections?.[section.id] ||
      generatedSections?.[section.title?.toLowerCase().replace(/\s+/g, "_")] ||
      "",
  }));

  const existingIds = new Set(sections.map((s) => s.id));
  const templateTitleKeys = new Set(
    templateSections.map((s) => toSectionTitleKey(s.title))
  );

  Object.entries(generatedSections).forEach(([key, content]) => {
    if (!content || existingIds.has(key)) return;
    if (templateTitleKeys.has(key)) return;
    const original = templateSections.find((s) => s.id === key);
    sections.push({
      id: key,
      title:
        original?.title ||
        key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      category: original?.category || "general",
      categoryTitle:
        templateCategories?.[original?.category]?.title || "General",
      content,
    });
    existingIds.add(key);
  });

  return sections;
};

export const buildSavePayload = (sections, selectedDoc) => {
  const generatedSections = {};
  const remainingIds = new Set(sections.map((section) => section.id));
  const remainingTitleKeys = new Set(
    sections.map((section) => toSectionTitleKey(section.title))
  );

  sections.forEach((section) => {
    generatedSections[section.id] = section.content || "";
  });

  const existingTemplate = selectedDoc?.template || {
    sections: [],
    categories: {},
  };

  const updatedTemplate = {
    ...existingTemplate,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      category: section.category,
      icon: section.icon,
    })),
  };

  const removedKeys = [];
  const previousGenerated = selectedDoc?.generated_sections || {};
  Object.keys(previousGenerated).forEach((key) => {
    if (remainingIds.has(key) || remainingTitleKeys.has(key)) return;
    removedKeys.push(key);
  });

  return { generatedSections, template: updatedTemplate, removedKeys };
};

export const downloadDocPDF = (doc, { notify } = {}) => {
  const showWarning = (text) => {
    if (notify?.warning) {
      notify.warning(text);
      return;
    }
    message.warning(text);
  };

  const sections = buildDocumentSections(doc).filter((s) => s.content);
  if (sections.length === 0) {
    showWarning("No content to download");
    return false;
  }

  const pdf = new jsPDF();
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const maxW = pw - margin * 2;
  let y = 40;

  const newPage = () => {
    pdf.addPage();
    y = 30;
  };
  const guard = (need = 25) => {
    if (y > ph - need) newPage();
  };

  pdf.setFontSize(20);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(0, 0, 0);
  pdf.text(doc.project_name || "Generated Document", pw / 2, y, {
    align: "center",
  });
  y += 12;
  pdf.setFontSize(12);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(100, 100, 100);
  pdf.text(
    `Version ${doc.version || 1}  |  ${new Date(doc.created_at).toLocaleString()}`,
    pw / 2,
    y,
    { align: "center" }
  );
  y += 20;

  let lastCategory = null;
  sections.forEach((section) => {
    if (section.category !== lastCategory) {
      guard(30);
      lastCategory = section.category;
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(24, 144, 255);
      const catLines = pdf.splitTextToSize(
        section.categoryTitle || section.category,
        maxW
      );
      pdf.text(catLines, margin, y);
      y += catLines.length * 8 + 6;
      pdf.setDrawColor(24, 144, 255);
      pdf.setLineWidth(0.4);
      pdf.line(margin, y, pw - margin, y);
      y += 8;
    }
    guard(20);
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(0, 0, 0);
    pdf.text(section.title, margin, y);
    y += 8;

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(50, 50, 50);
    const clean = (section.content || "").replace(/\*\*([^*]+)\*\*/g, "$1");
    const contentLines = pdf.splitTextToSize(clean, maxW);
    contentLines.forEach((line) => {
      guard(14);
      pdf.text(line, margin, y);
      y += 6;
    });
    y += 6;
  });

  const total = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`Page ${i} of ${total}`, pw / 2, ph - 8, { align: "center" });
  }

  pdf.save(`${doc.project_name || "document"}_v${doc.version || 1}.pdf`);
  return true;
};
