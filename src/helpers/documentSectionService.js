/**
 * API calls to save/load individual document sections.
 * File: src/helpers/documentSectionService.js
 */
import {
  setGeneratedDocumentSections,
  updateDocumentSection,
} from "../features/ReportSlice";
import {
  AGENT_DOCUMENT_SECTION_SAVED_EVENT,
  buildSectionContentMap,
  dispatchAgentDocumentSectionSaved,
  normalizeSectionKey,
} from "./documentSectionSync";

export const DOC_LOG = "[AgentDocument]";

export function logDocumentSave(stage, payload) {
  console.info(DOC_LOG, stage, payload !== undefined ? payload : "");
}

function normalizeSearchValue(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Parse tool args — models often send `content` instead of `generated_content`. */
export function extractSaveDocumentToolArgs(parsedArgs = {}) {
  const section_id =
    parsedArgs.section_id ??
    parsedArgs.sectionId ??
    parsedArgs.section ??
    "";
  const section_title =
    parsedArgs.section_title ??
    parsedArgs.sectionTitle ??
    parsedArgs.title ??
    "";
  const generated_content =
    parsedArgs.generated_content ??
    parsedArgs.generatedContent ??
    parsedArgs.content ??
    parsedArgs.text ??
    parsedArgs.body ??
    parsedArgs.section_content ??
    parsedArgs.sectionContent ??
    "";
  const user_raw_answer =
    parsedArgs.user_raw_answer ??
    parsedArgs.userRawAnswer ??
    parsedArgs.raw_answer ??
    "";
  const action = String(
    parsedArgs.action ??
      parsedArgs.edit_mode ??
      parsedArgs.editMode ??
      "replace",
  )
    .trim()
    .toLowerCase();

  return {
    section_id,
    section_title,
    generated_content,
    user_raw_answer,
    action,
  };
}

export function resolveTemplateSectionFromDocument(
  sectionId = "",
  sectionTitle = "",
  documentTemplate = null,
) {
  const templateSections = Array.isArray(documentTemplate?.sections)
    ? documentTemplate.sections
    : [];

  const normalizedId = normalizeSearchValue(sectionId);
  const normalizedTitle = normalizeSearchValue(sectionTitle);
  const normalizedIdKey = normalizeSectionKey(sectionId);
  const normalizedTitleKey = normalizeSectionKey(sectionTitle);

  const matchedSection = templateSections.find((section) => {
    const sectionIdValue = normalizeSearchValue(section.id);
    const sectionTitleValue = normalizeSearchValue(section.title);
    const sectionIdKey = normalizeSectionKey(section.id);
    const sectionTitleKey = normalizeSectionKey(section.title);

    return (
      (normalizedId &&
        (sectionIdValue === normalizedId ||
          sectionTitleValue === normalizedId ||
          sectionIdKey === normalizedIdKey ||
          sectionTitleKey === normalizedIdKey)) ||
      (normalizedTitle &&
        (sectionIdValue === normalizedTitle ||
          sectionTitleValue === normalizedTitle ||
          sectionIdKey === normalizedTitleKey ||
          sectionTitleKey === normalizedTitleKey))
    );
  });

  if (matchedSection) {
    return {
      sectionId: matchedSection.id,
      sectionTitle: matchedSection.title,
      templateSection: matchedSection,
      matched: true,
    };
  }

  const probe = normalizedTitleKey || normalizedIdKey;
  const fuzzySection = templateSections.find((section) => {
    const sectionTitleKey = normalizeSectionKey(section.title);
    const sectionIdKey = normalizeSectionKey(section.id);
    if (!probe || probe.length < 4) return false;
    return (
      (sectionTitleKey &&
        (sectionTitleKey.includes(probe) || probe.includes(sectionTitleKey))) ||
      (sectionIdKey &&
        (sectionIdKey.includes(probe) || probe.includes(sectionIdKey)))
    );
  });

  if (fuzzySection) {
    return {
      sectionId: fuzzySection.id,
      sectionTitle: fuzzySection.title,
      templateSection: fuzzySection,
      matched: true,
    };
  }

  return {
    sectionId: normalizeSectionKey(sectionId || sectionTitle) || sectionId || sectionTitle,
    sectionTitle: sectionTitle || sectionId || "Generated Section",
    templateSection: null,
    matched: false,
  };
}

export function resolveStoredSectionContent(section, sectionsMap = {}) {
  if (!section || !sectionsMap || typeof sectionsMap !== "object") return "";

  const titleSnake =
    typeof section.title === "string"
      ? section.title.toLowerCase().replace(/\s+/g, "_")
      : "";

  const tryKeys = [
    section.id,
    section.id != null && section.id !== "" ? String(section.id) : "",
    normalizeSectionKey(section.id),
    titleSnake,
    normalizeSectionKey(section.title),
  ].filter((key, idx, arr) => key !== "" && key != null && arr.indexOf(key) === idx);

  for (const key of tryKeys) {
    const raw = sectionsMap[key];
    if (typeof raw === "string" && raw.trim()) return raw;
  }

  return "";
}

/** Apply add / update / replace / append / remove / clear to section text. */
export function applyDocumentSectionAction({
  action = "replace",
  existingContent = "",
  newContent = "",
}) {
  const mode = String(action || "replace").toLowerCase();
  const existing = String(existingContent || "").trim();
  const incoming = String(newContent || "").trim();

  if (mode === "remove" || mode === "clear" || mode === "delete") {
    return { finalContent: "", action: "remove" };
  }

  if (mode === "append" || mode === "add") {
    if (!incoming) return { finalContent: existing, action: mode };
    if (!existing) return { finalContent: incoming, action: mode };
    return { finalContent: `${existing}\n\n${incoming}`, action: mode };
  }

  // replace, update, edit, overwrite (default)
  return { finalContent: incoming, action: mode || "replace" };
}

/**
 * Single entry point: agent tool → Redux + DOM event + optional socket/backend.
 * Call this from save_document_section tool handler only.
 */
export function persistDocumentSectionUpdate({
  parsedArgs = {},
  documentTemplate = null,
  existingSections = {},
  dispatch,
  meetingId = null,
  socket = null,
  undiscussedTopics = [],
  onBackendSave,
}) {
  const args = extractSaveDocumentToolArgs(parsedArgs);
  const { section_id, section_title, generated_content, user_raw_answer, action } =
    args;

  logDocumentSave("persist_start", {
    keys: Object.keys(parsedArgs || {}),
    section_id,
    section_title,
    action,
    contentLength: String(generated_content || "").length,
  });

  if (action !== "remove" && action !== "clear" && action !== "delete") {
    if (!generated_content || !String(generated_content).trim()) {
      logDocumentSave("persist_rejected_no_content", parsedArgs);
      return {
        success: false,
        error:
          "No content provided. Pass generated_content or content with the section text.",
      };
    }
  }

  if (!section_id && !section_title) {
    logDocumentSave("persist_rejected_no_section", parsedArgs);
    return {
      success: false,
      error: "section_id or section_title is required.",
    };
  }

  const resolved = resolveTemplateSectionFromDocument(
    section_id,
    section_title || section_id,
    documentTemplate,
  );
  const { sectionId, sectionTitle, templateSection } = resolved;

  const existingContent = resolveStoredSectionContent(
    templateSection || { id: sectionId, title: sectionTitle },
    existingSections,
  );

  const { finalContent, action: appliedAction } = applyDocumentSectionAction({
    action,
    existingContent,
    newContent: generated_content,
  });

  const canonicalSectionId = templateSection?.id ?? sectionId;
  const mergedSections = buildSectionContentMap(existingSections, finalContent, {
    templateSection,
    sectionId: canonicalSectionId,
    sectionTitle,
  });

  logDocumentSave("persist_resolved", {
    requested_section_id: section_id,
    requested_section_title: section_title,
    canonicalSectionId,
    sectionTitle,
    matched: resolved.matched,
    appliedAction,
    contentLength: finalContent.length,
    mergedKeys: Object.keys(mergedSections).filter((k) =>
      String(mergedSections[k] || "").trim(),
    ),
  });

  if (typeof dispatch === "function") {
    dispatch(
      updateDocumentSection({
        sectionId: canonicalSectionId,
        content: finalContent,
      }),
    );
    dispatch(setGeneratedDocumentSections(mergedSections));
  }

  dispatchAgentDocumentSectionSaved({
    meetingId,
    sectionId: canonicalSectionId,
    sectionTitle,
    content: finalContent,
    action: appliedAction,
    generatedSections: mergedSections,
    documentTemplate,
  });

  if (socket && meetingId) {
    socket.emit("broadcast_document_data", {
      meetingId,
      documentTemplate,
      generatedSections: mergedSections,
      undiscussedTopics,
      meetingPhase: "ongoing",
      updatedSection: {
        section_id: canonicalSectionId,
        section_title: sectionTitle,
        content: finalContent,
        edit_mode: appliedAction,
      },
    });
  }

  if (typeof onBackendSave === "function") {
    onBackendSave({
      sectionId: canonicalSectionId,
      sectionTitle,
      content: finalContent,
      userRawAnswer: user_raw_answer,
      action: appliedAction,
    });
  }

  logDocumentSave("persist_complete", {
    sectionId: canonicalSectionId,
    sectionTitle,
    contentLength: finalContent.length,
  });

  return {
    success: true,
    status: "saved",
    message: `Section "${sectionTitle}" saved to the document panel.`,
    section_id: canonicalSectionId,
    section_title: sectionTitle,
    action: appliedAction,
    content_length: finalContent.length,
    instruction:
      "The section was saved to the document UI. Briefly confirm to the creator, then stop.",
  };
}

export function buildDocumentSaveResponseCreate(utterance = "", documentTemplate = null, reason = "nudge") {
  const sections = Array.isArray(documentTemplate?.sections)
    ? documentTemplate.sections
    : [];
  const lower = String(utterance).toLowerCase();
  let sectionHint = "";

  for (const section of sections) {
    const titleLower = String(section.title || "").toLowerCase();
    if (titleLower && lower.includes(titleLower)) {
      sectionHint = `Use section_title="${section.title}" and section_id="${section.id}".`;
      break;
    }
  }
  if (!sectionHint && /\bpersonas?\b/.test(lower)) {
    const persona = sections.find((s) =>
      normalizeSectionKey(s.id).includes("persona"),
    );
    if (persona) {
      sectionHint = `Use section_title="${persona.title}" and section_id="${persona.id}".`;
    }
  }

  return {
    type: "response.create",
    response: {
      output_modalities: ["audio"],
      tool_choice: { type: "function", name: "save_document_section" },
      instructions:
        `The creator asked to update the document (${reason}). ` +
        `You MUST call save_document_section now with generated_content (or content) containing professional text. ` +
        `${sectionHint || "Use the exact template section_title and section_id."} ` +
        `Do not say it is saved until the tool succeeds. Request: "${String(utterance).slice(0, 800)}"`,
    },
  };
}

export { AGENT_DOCUMENT_SECTION_SAVED_EVENT };
