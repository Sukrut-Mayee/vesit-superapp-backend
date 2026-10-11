-- Migration 001: announcements table definition, kept aligned with
-- supabase_schema.sql. Production has already had this schema applied.
-- This file is a repository reference; do not rerun it against production.

-- -----------------------------------------------------------------------
-- ANNOUNCEMENTS
-- -----------------------------------------------------------------------
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_announcements_college on announcements(college_id);

alter table announcements enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = current_schema()
      and tablename = 'announcements'
      and policyname = 'announcements_isolation'
  ) then
    create policy "announcements_isolation" on announcements for all
      using (college_id = current_college_id())
      with check (college_id = current_college_id());
  end if;
end
$$;
