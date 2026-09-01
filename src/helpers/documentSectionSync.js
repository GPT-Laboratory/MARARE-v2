/**
 * Syncs document sections between Redux and backend.
 * File: src/helpers/documentSectionSync.js
 */
export const AGENT_DOCUMENT_SECTION_SAVED_EVENT = "marare:agent-document-section-saved";

export function dispatchAgentDocumentSectionSaved(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AGENT_DOCUMENT_SECTION_SAVED_EVENT, { detail }),
  );
}

export function normalizeSectionKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
}

/** Write section content under every key the UI may look up */
export function buildSectionContentMap(existingSections, content, sectionMeta = {}) {
  const { templateSection, sectionId, sectionTitle } = sectionMeta;
  const merged = { ...(existingSections || {}) };
  const text = String(content || "").trim();
  if (!text) return merged;

  const canonicalId = templateSection?.id ?? sectionId;
  const canonicalTitle = templateSection?.title ?? sectionTitle ?? sectionId;
  const titleSnake =
    typeof canonicalTitle === "string"
      ? canonicalTitle.toLowerCase().replace(/\s+/g, "_")
      : "";

  const keys = new Set(
    [
      canonicalId,
      canonicalId != null && canonicalId !== "" ? String(canonicalId) : "",
      normalizeSectionKey(canonicalId),
      titleSnake,
      normalizeSectionKey(canonicalTitle),
      sectionId,
      sectionId != null && sectionId !== "" ? String(sectionId) : "",
      normalizeSectionKey(sectionId),
      normalizeSectionKey(sectionTitle),
    ].filter(Boolean),
  );

  keys.forEach((key) => {
    merged[key] = text;
  });

  return merged;
}
