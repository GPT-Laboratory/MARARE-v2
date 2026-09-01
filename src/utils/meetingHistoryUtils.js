/**
 * Display titles and formatting for meeting history entries.
 * File: src/utils/meetingHistoryUtils.js
 */
const readAgendaValue = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const getMeetingAgenda = (meeting) => {
  if (!meeting) return "";

  return (
    readAgendaValue(meeting.meeting_agenda) ||
    readAgendaValue(meeting.meetingAgenda) ||
    readAgendaValue(meeting.document?.meeting_agenda) ||
    readAgendaValue(meeting.document?.meetingAgenda) ||
    readAgendaValue(meeting.transcript?.meeting_agenda) ||
    readAgendaValue(meeting.transcript?.meetingAgenda)
  );
};

export const getMeetingDisplayTitle = (meeting, allMeetings = []) => {
  const agenda = getMeetingAgenda(meeting);
  if (agenda) return agenda;
  if (meeting?.is_import) return "Imported document";
  return "Untitled meeting";
};

export const getParentMeetingTitle = (basedOnMeetingId, allMeetings = []) => {
  if (!basedOnMeetingId) return "";

  const parentMeeting = allMeetings.find(
    (meeting) => meeting.meeting_id === basedOnMeetingId
  );
  if (parentMeeting) {
    const parentTitle = getMeetingDisplayTitle(parentMeeting, allMeetings);
    if (parentTitle && parentTitle !== "Untitled meeting") {
      return parentTitle;
    }
  }

  return basedOnMeetingId;
};
