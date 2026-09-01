-- Tracks MongoDB / legacy Supabase user ids and links them to new auth users by email.

create table if not exists public.migration_user_map (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  legacy_user_id text not null,
  new_user_id text,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (email),
  unique (legacy_user_id)
);

create index if not exists idx_migration_user_map_new_user
  on public.migration_user_map (new_user_id);

create table if not exists public.migration_project_map (
  id uuid primary key default gen_random_uuid(),
  legacy_project_id text not null,
  new_project_id uuid not null,
  legacy_user_id text not null,
  created_at timestamptz not null default now(),
  unique (legacy_project_id)
);

create index if not exists idx_migration_project_map_new
  on public.migration_project_map (new_project_id);
