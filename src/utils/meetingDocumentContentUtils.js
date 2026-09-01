/**
 * Checks whether document sections have meaningful content.
 * File: src/utils/meetingDocumentContentUtils.js
 */
const normalizeSectionKey = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();

export const buildTemplateDefaultContentLookup = (template) => {
  const lookup = {};
  const sections = Array.isArray(template?.sections) ? template.sections : [];

  sections.forEach((section) => {
    const defaultContent = String(section?.content || "").trim();
    if (!defaultContent) return;

    if (section?.id) {
      lookup[String(section.id)] = defaultContent;
    }
    if (section?.title) {
      lookup[normalizeSectionKey(section.title)] = defaultContent;
    }
  });

  return lookup;
};

/**
 * True when the meeting has user/agent-authored section content beyond
 * empty values and static template placeholder defaults.
 */
export const hasMeaningfulMeetingDocumentContent = ({
  generatedSections = {},
  template = null,
} = {}) => {
  if (!generatedSections || typeof generatedSections !== "object") {
    return false;
  }

  const templateDefaults = buildTemplateDefaultContentLookup(template);

  return Object.entries(generatedSections).some(([key, rawValue]) => {
    const content = String(rawValue ?? "").trim();
    if (!content) return false;

    const templateDefault = templateDefaults[key] || "";
    return content !== templateDefault;
  });
};

export const buildMeetingSectionsWithUserContent = ({
  generatedSections = {},
  template = null,
}) => {
  const templateSections = Array.isArray(template?.sections) ? template.sections : [];
  const templateCategories = template?.categories || {};
  const templateDefaults = buildTemplateDefaultContentLookup(template);

  const sections = templateSections
    .map((section) => {
      const content =
        generatedSections?.[section.id] ??
        generatedSections?.[normalizeSectionKey(section.title)] ??
        "";

      const trimmed = String(content ?? "").trim();
      const templateDefault = templateDefaults[section.id] ||
        templateDefaults[normalizeSectionKey(section.title)] ||
        "";

      if (!trimmed || trimmed === templateDefault) {
        return null;
      }

      return {
        id: section.id,
        title: section.title,
        category: section.category || "general",
        categoryTitle:
          templateCategories?.[section.category]?.title ||
          section.category ||
          "General",
        content: trimmed,
      };
    })
    .filter(Boolean);

  const existingIds = new Set(sections.map((section) => section.id));
  const existingTitleKeys = new Set(
    templateSections.map((section) => normalizeSectionKey(section.title))
  );

  Object.entries(generatedSections).forEach(([key, rawValue]) => {
    const content = String(rawValue ?? "").trim();
    if (!content) return;
    if (existingIds.has(key) || existingTitleKeys.has(key)) return;
    if (content === (templateDefaults[key] || "")) return;

    sections.push({
      id: key,
      title: key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      category: "general",
      categoryTitle: "General",
      content,
    });
    existingIds.add(key);
  });

  return sections;
};
