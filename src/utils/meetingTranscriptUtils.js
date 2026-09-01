/**
 * Parse and normalize transcript records for display.
 * File: src/utils/meetingTranscriptUtils.js
 */
import { jsPDF } from "jspdf";

const normalizeEntry = ({
  text,
  timestamp,
  speakerId = "",
  speakerName = "Unknown",
  speakerRole = "participant",
}) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  return {
    speaker_id: String(speakerId || speakerName || "unknown"),
    speaker_name: String(speakerName || "Unknown"),
    speaker_role: speakerRole,
    text: trimmed,
    timestamp: timestamp || new Date().toISOString(),
  };
};

export const buildTranscriptEntries = ({
  localTranscriptView = [],
  remoteTranscriptView = {},
  agentTranscriptView = [],
  localUserName = "User",
  localUserId = "local",
  isHost = true,
  agentName = "Agent",
}) => {
  const entries = [];

  if (Array.isArray(localTranscriptView)) {
    localTranscriptView.forEach((item) => {
      const entry = normalizeEntry({
        text: item?.text ?? item,
        timestamp: item?.timestamp
          ? new Date(item.timestamp).toISOString()
          : new Date().toISOString(),
        speakerId: item?.speaker_id || item?.speakerId || localUserId,
        speakerName: item?.speaker_name || item?.speakerName || localUserName,
        speakerRole: item?.speaker_role || item?.speakerRole || (isHost ? "host" : "participant"),
      });
      if (entry) entries.push(entry);
    });
  }

  if (remoteTranscriptView && typeof remoteTranscriptView === "object") {
    Object.entries(remoteTranscriptView).forEach(([userName, messages]) => {
      if (!Array.isArray(messages)) return;
      messages.forEach((message) => {
        const entry = normalizeEntry({
          text: message?.text ?? message,
          timestamp: message?.timestamp
            ? new Date(message.timestamp).toISOString()
            : new Date().toISOString(),
          speakerId: message?.speaker_id || message?.speakerId || userName,
          speakerName: message?.speaker_name || message?.speakerName || userName,
          speakerRole: message?.speaker_role || message?.speakerRole || "participant",
        });
        if (entry) entries.push(entry);
      });
    });
  }

  if (Array.isArray(agentTranscriptView)) {
    agentTranscriptView.forEach((item, index) => {
      const entry = normalizeEntry({
        text: typeof item === "string" ? item : item?.text,
        timestamp:
          typeof item === "object" && item?.timestamp
            ? new Date(item.timestamp).toISOString()
            : new Date(Date.now() + index).toISOString(),
        speakerId: "agent",
        speakerName: item?.speaker_name || item?.speakerName || agentName || "Agent",
        speakerRole: "agent",
      });
      if (entry) entries.push(entry);
    });
  }

  return entries.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
};

/**
 * Prefer timestamped transcript views; fall back to legacy string arrays when views are empty.
 */
export const buildTranscriptEntriesWithFallback = ({
  localTranscriptView = [],
  remoteTranscriptView = {},
  agentTranscriptView = [],
  localTranscript = [],
  remoteTranscript = {},
  agentTranscript = [],
  localUserName = "User",
  localUserId = "local",
  isHost = true,
  agentName = "Agent",
}) => {
  const fromViews = buildTranscriptEntries({
    localTranscriptView,
    remoteTranscriptView,
    agentTranscriptView,
    localUserName,
    localUserId,
    isHost,
    agentName,
  });
  if (fromViews.length > 0) return fromViews;

  const entries = [];
  const baseTime = Date.now();

  if (Array.isArray(localTranscript)) {
    localTranscript.forEach((item, index) => {
      const entry = normalizeEntry({
        text: typeof item === "string" ? item : item?.text ?? item,
        timestamp: new Date(baseTime + index).toISOString(),
        speakerId: localUserId,
        speakerName: localUserName,
        speakerRole: isHost ? "host" : "participant",
      });
      if (entry) entries.push(entry);
    });
  }

  if (remoteTranscript && typeof remoteTranscript === "object" && !Array.isArray(remoteTranscript)) {
    Object.entries(remoteTranscript).forEach(([userName, messages], userIndex) => {
      const list = Array.isArray(messages) ? messages : [messages];
      list.forEach((message, msgIndex) => {
        const entry = normalizeEntry({
          text: typeof message === "string" ? message : message?.text ?? message,
          timestamp: new Date(baseTime + 1000 * (userIndex + 1) + msgIndex).toISOString(),
          speakerId: userName,
          speakerName: userName,
          speakerRole: "participant",
        });
        if (entry) entries.push(entry);
      });
    });
  }

  if (Array.isArray(agentTranscript)) {
    agentTranscript.forEach((item, index) => {
      const entry = normalizeEntry({
        text: typeof item === "string" ? item : item?.text,
        timestamp: new Date(baseTime + 5000 + index).toISOString(),
        speakerId: "agent",
        speakerName: agentName,
        speakerRole: "agent",
      });
      if (entry) entries.push(entry);
    });
  }

  return entries.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
};

export const searchTranscriptEntries = (
  entries = [],
  searchKeywords = "",
  maxResults = 5,
) => {
  const keywords = String(searchKeywords || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((keyword) => keyword.length > 2);

  if (keywords.length === 0 || entries.length === 0) {
    return {
      found: false,
      context: keywords.length === 0
        ? "No search keywords provided"
        : "No conversation transcript available yet",
      matches: [],
      matchCount: 0,
    };
  }

  const scored = entries
    .map((entry) => {
      const line = `[${entry.speaker_name}]: ${entry.text}`.toLowerCase();
      const score = keywords.reduce(
        (acc, keyword) => acc + (line.includes(keyword) ? 1 : 0),
        0,
      );
      return score > 0 ? { entry, score } : null;
    })
    .filter(Boolean);

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxResults);

  return {
    found: top.length > 0,
    context: top.length > 0
      ? top.map(({ entry }) => `[${entry.speaker_name}]: ${entry.text}`).join("\n\n")
      : "Topic not discussed in the transcript",
    matches: top.map(({ entry, score }) => ({
      speaker: entry.speaker_name,
      text: entry.text,
      timestamp: entry.timestamp,
      matchScore: score,
    })),
    matchCount: scored.length,
  };
};

export const serializeTranscriptEntriesForTool = (entries = []) =>
  entries.map((entry) => ({
    speaker: entry.speaker_name,
    speaker_role: entry.speaker_role,
    text: entry.text,
    timestamp: entry.timestamp,
  }));

export const buildTranscriptFullText = (entries = []) =>
  entries
    .map((entry) => `[${entry.speaker_name}]: ${entry.text}`)
    .join("\n");

/**
 * Read transcript stored inside a Drive/Notion meeting document payload.
 */
export const extractEmbeddedMeetingTranscript = (source) => {
  if (!source || typeof source !== "object") return null;

  if (Array.isArray(source.entries) && source.entries.length > 0) {
    const entries = source.entries
      .map((entry) => ({
        speaker_id:
          entry.speaker_id ||
          entry.speakerId ||
          entry.speaker_name ||
          entry.speakerName ||
          "unknown",
        speaker_name: entry.speaker_name || entry.speakerName || "Unknown",
        speaker_role: entry.speaker_role || entry.speakerRole || "participant",
        text: entry.text || "",
        timestamp: entry.timestamp || new Date().toISOString(),
      }))
      .filter((entry) => String(entry.text || "").trim());

    if (entries.length === 0) return null;

    return {
      entries,
      has_transcript: true,
      entry_count: entries.length,
      speaker_names: [...new Set(entries.map((entry) => entry.speaker_name))],
      meeting_agenda: source.meeting_agenda || source.meetingAgenda || "",
    };
  }

  const payload =
    source.rawDriveDocument ||
    source.rawNotionDocument ||
    source.document ||
    source;

  const rawEntries =
    payload.transcriptEntries || payload.transcript_entries || [];
  const entries = (Array.isArray(rawEntries) ? rawEntries : [])
    .map((entry) => ({
      speaker_id:
        entry.speaker_id ||
        entry.speakerId ||
        entry.speaker_name ||
        entry.speakerName ||
        "unknown",
      speaker_name: entry.speaker_name || entry.speakerName || "Unknown",
      speaker_role: entry.speaker_role || entry.speakerRole || "participant",
      text: entry.text || "",
      timestamp:
        entry.timestamp || payload.updatedAt || new Date().toISOString(),
    }))
    .filter((entry) => String(entry.text || "").trim());

  if (entries.length === 0) {
    const fullText =
      payload.transcriptFullText || payload.transcript_full_text || "";
    if (!String(fullText).trim()) return null;

    return {
      entries: [
        {
          speaker_id: "transcript",
          speaker_name: "Transcript",
          speaker_role: "participant",
          text: String(fullText).trim(),
          timestamp: payload.updatedAt || new Date().toISOString(),
        },
      ],
      has_transcript: true,
      entry_count: 1,
      speaker_names: ["Transcript"],
      meeting_agenda:
        payload.meetingAgenda || payload.meeting_agenda || payload.agenda || "",
    };
  }

  return {
    entries,
    has_transcript: true,
    entry_count: entries.length,
    speaker_names: [...new Set(entries.map((entry) => entry.speaker_name))],
    meeting_agenda:
      payload.meetingAgenda || payload.meeting_agenda || payload.agenda || "",
  };
};

export const parseDriveDocumentMeetingId = (documentId, projectId) => {
  const value = String(documentId || "");
  if (!value.startsWith("google-drive-")) return null;
  const meetingId = value.slice("google-drive-".length).trim();
  if (!meetingId) return null;
  return meetingId;
};

export const parseNotionDocumentMeetingId = (documentId) => {
  const value = String(documentId || "");
  if (!value.startsWith("notion-")) return null;
  const meetingId = value.slice("notion-".length).trim();
  return meetingId || null;
};

const speakerColor = (role) => {
  if (role === "agent") return [128, 0, 128];
  if (role === "host") return [24, 144, 255];
  return [82, 82, 82];
};

/**
 * Download transcript entries as a formatted PDF document.
 */
export const downloadTranscriptEntriesAsPdf = ({
  entries = [],
  projectName = "Meeting",
  meetingId = "",
} = {}) => {
  if (!entries.length) {
    return { success: false, message: "No transcript to download" };
  }

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxWidth = pageWidth - 2 * margin;
  let yPosition = margin;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Meeting Transcript", pageWidth / 2, yPosition, { align: "center" });
  yPosition += 10;

  if (projectName) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Project: ${projectName}`, pageWidth / 2, yPosition, { align: "center" });
    yPosition += 7;
  }

  if (meetingId) {
    doc.setFontSize(10);
    doc.text(`Meeting ID: ${meetingId}`, pageWidth / 2, yPosition, { align: "center" });
    yPosition += 7;
  }

  doc.setFontSize(10);
  doc.text(
    `Generated: ${new Date().toLocaleString()}`,
    pageWidth / 2,
    yPosition,
    { align: "center" }
  );
  yPosition += 10;

  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  entries.forEach((entry) => {
    const speaker = entry.speaker_name || entry.speakerName || "Unknown";
    const role = entry.speaker_role || entry.speakerRole || "participant";
    const time = entry.timestamp
      ? new Date(entry.timestamp).toLocaleString()
      : "";
    const text = String(entry.text || "").trim();
    if (!text) return;

    const [r, g, b] = speakerColor(role);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(r, g, b);

    if (yPosition > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
    }
    doc.text(time ? `${speaker}  •  ${time}` : speaker, margin, yPosition);
    yPosition += 6;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line) => {
      if (yPosition > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
      }
      doc.text(line, margin, yPosition);
      yPosition += 5;
    });

    yPosition += 6;
  });

  const safeProject = String(projectName || "Meeting").replace(/[^\w\-]+/g, "_");
  const datePart = new Date().toISOString().split("T")[0];
  const safeMeeting = meetingId
    ? `_${String(meetingId).replace(/[^\w\-]+/g, "_")}`
    : "";
  doc.save(`Transcript_${safeProject}${safeMeeting}_${datePart}.pdf`);

  return { success: true };
};

export const computeNextDocumentVersion = ({
  documents = [],
  sourceDocument = null,
  continueFromPrevious = false,
}) => {
  if (continueFromPrevious && sourceDocument) {
    return (sourceDocument.version || 1) + 1;
  }
  const maxVersion = documents.reduce(
    (max, doc) => Math.max(max, doc?.version || 0),
    0
  );
  return maxVersion === 0 ? 1 : maxVersion + 1;
};

export default buildTranscriptEntries;
