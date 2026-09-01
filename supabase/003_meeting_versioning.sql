-- Meeting versioning: transcripts + document lineage

alter table public.generated_documents
  add column if not exists based_on_meeting_id text,
  add column if not exists based_on_document_id uuid;

create index if not exists idx_generated_documents_based_on_meeting
  on public.generated_documents (based_on_meeting_id);

create table if not exists public.meeting_transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  meeting_id text not null,
  project_id text not null,
  project_name text,
  based_on_meeting_id text,
  entries jsonb not null default '[]'::jsonb,
  full_text text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meeting_id)
);

create index if not exists idx_meeting_transcripts_user_project
  on public.meeting_transcripts (user_id, project_id, created_at desc);

create index if not exists idx_meeting_transcripts_meeting
  on public.meeting_transcripts (meeting_id);
