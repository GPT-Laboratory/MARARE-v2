-- Persist meeting agenda for history display

alter table public.generated_documents
  add column if not exists meeting_agenda text;

alter table public.meeting_transcripts
  add column if not exists meeting_agenda text;

create index if not exists idx_generated_documents_meeting_agenda
  on public.generated_documents (user_id, project_id, meeting_agenda);
