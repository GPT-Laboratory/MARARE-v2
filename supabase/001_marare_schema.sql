-- MARARE application schema (MongoDB replacement)
-- Run in Supabase SQL editor or via Supabase CLI.

create extension if not exists "pgcrypto";

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  template_document jsonb,
  mvp_vision_template jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_user_id on public.projects (user_id);

create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  meeting_id text,
  project_id text not null,
  project_name text,
  template jsonb,
  generated_sections jsonb,
  undiscussed_topics jsonb default '[]'::jsonb,
  meeting_phase text,
  progress double precision default 0,
  timestamp timestamptz,
  team_data jsonb,
  source text,
  version integer not null default 1,
  version_created_at timestamptz,
  version_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_generated_documents_user_project
  on public.generated_documents (user_id, project_id, created_at desc);
create index if not exists idx_generated_documents_user_meeting
  on public.generated_documents (user_id, meeting_id, created_at desc);

create table if not exists public.meeting_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  meeting_id text,
  project_id text,
  project_name text,
  summary_content text,
  timestamp timestamptz,
  team_data jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meeting_summaries_user_project
  on public.meeting_summaries (user_id, project_id, created_at desc);

create table if not exists public.meeting_mvpvisions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  meeting_id text,
  project_id text,
  project_name text,
  mvp text default '',
  vision text default '',
  timestamp timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meeting_mvpvisions_user_project
  on public.meeting_mvpvisions (user_id, project_id, created_at desc);

create table if not exists public.mcp_configurations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project_id text not null,
  provider text not null,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id, provider)
);

create index if not exists idx_mcp_configurations_project
  on public.mcp_configurations (project_id, provider);

create table if not exists public.mcp_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  provider text,
  project_id text not null,
  user_id text not null,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_states_expires_at
  on public.mcp_oauth_states (expires_at);

create table if not exists public.meeting_document_sessions (
  meeting_id text primary key,
  session_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_admins (
  id uuid primary key default gen_random_uuid(),
  meeting_id text not null,
  user_id text,
  is_admin boolean not null default true,
  is_agent boolean not null default false,
  agent_name text,
  exp timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_admins_meeting
  on public.meeting_admins (meeting_id, is_admin);

create table if not exists public.project_reports (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  user_id text,
  file_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_reports_project
  on public.project_reports (project_id);
