/**
 * Resolves parent document + transcript for meeting continuation.
 * File: src/utils/meetingContinuationUtils.js
 */
import {
  getGeneratedDocumentById,
  getMeetingTranscript,
} from "../features/mainStates/Template_Slice";
import { isSupabaseMeeting } from "./unifiedMeetingHistory";
import { isSupabaseDocumentId } from "./documentStorageRecords";

export const isFullGeneratedDocument = (document) =>
  Boolean(
    document &&
      (document.generated_sections != null || document.generatedSections != null)
  );

export const isFullMeetingTranscript = (transcript) =>
  Boolean(transcript && Array.isArray(transcript.entries));

export const resolveMeetingContinuationPayload = async (meeting, dispatch) => {
  if (!meeting?.document) {
    return { document: null, transcript: null };
  }

  const documentId = meeting.document?._id || meeting.document?.id;
  let document = meeting.document;
  let transcript = meeting.transcript || null;
  const fromSupabase = isSupabaseMeeting(meeting);

  const documentTasks = [];
  if (
    fromSupabase &&
    documentId &&
    isSupabaseDocumentId(documentId) &&
    !isFullGeneratedDocument(document)
  ) {
    documentTasks.push(
      dispatch(getGeneratedDocumentById(documentId))
        .unwrap()
        .then((result) => {
          document = result?.document || document;
        })
        .catch(() => undefined)
    );
  }

  const transcriptTasks = [];
  const meetingId = meeting.meeting_id;
  if (
    fromSupabase &&
    meetingId &&
    !String(meetingId).startsWith("import-") &&
    !isFullMeetingTranscript(transcript)
  ) {
    transcriptTasks.push(
      dispatch(getMeetingTranscript(meetingId))
        .unwrap()
        .then((result) => {
          transcript = result?.transcript || transcript;
        })
        .catch(() => undefined)
    );
  }

  await Promise.all([...documentTasks, ...transcriptTasks]);

  return { document, transcript };
};
