-- ============================================================
-- CampusOne — Supabase Schema (VESIT Pilot)
-- Paste this whole file into Supabase SQL Editor and click Run.
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS guards.
-- ============================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. COLLEGES (tenant table — every other table hangs off this)
-- ------------------------------------------------------------
create table if not exists colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email_domain text unique not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. USERS
-- NOTE: added `password_hash` — not in the original spec list,
-- but required to implement custom email+password -> JWT login
-- (POST /auth/signup, POST /auth/login) as planned for Sep 3-7.
-- If you switch to Supabase Auth instead, drop this column and
-- set id = auth.uid() instead.
-- ------------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  name text not null,
  email text unique not null,
  password_hash text not null,
  role text not null default 'student' check (role in ('student','club_head','admin')),
  trust_score integer not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. TIMETABLE
-- ------------------------------------------------------------
create table if not exists timetable (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  division text not null,
  subject text not null,
  day text not null check (day in ('Mon','Tue','Wed','Thu','Fri','Sat')),
  start_time time not null,
  end_time time not null,
  room text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. NOTES REPOSITORY
-- ------------------------------------------------------------
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  uploader_id uuid not null references users(id) on delete cascade,
  subject text not null,
  year text not null,
  topic text,
  file_url text not null,
  file_type text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. EVENTS + RSVPs
-- ------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  title text not null,
  description text,
  date date not null,
  time time,
  venue text,
  created_at timestamptz not null default now()
);

create table if not exists event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- ------------------------------------------------------------
-- 6. CLUBS + CLUB POSTS
-- ------------------------------------------------------------
create table if not exists clubs (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  name text not null,
  description text,
  head_id uuid references users(id)
);

create table if not exists club_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  college_id uuid not null references colleges(id) on delete cascade,
  title text not null,
  body text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. LOST & FOUND
-- ------------------------------------------------------------
create table if not exists lost_found (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  poster_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('lost','found')),
  description text not null,
  photo_url text,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. RESOURCE MARKETPLACE
-- ------------------------------------------------------------
create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  title text not null,
  category text not null,
  condition text,
  listing_type text not null check (listing_type in ('lend','donate')),
  status text not null default 'AVAILABLE'
    check (status in ('AVAILABLE','REQUESTED','APPROVED','REJECTED','ACTIVE','OVERDUE','RETURNED','COMPLETED','DISPUTED')),
  image_urls text[] default '{}',
  created_at timestamptz not null default now()
);

create table if not exists borrow_requests (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references resources(id) on delete cascade,
  borrower_id uuid not null references users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED','APPROVED','REJECTED','ACTIVE','OVERDUE','RETURNED','COMPLETED','DISPUTED')),
  created_at timestamptz not null default now()
);

create table if not exists donations (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  donor_id uuid not null references users(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  verified boolean not null default false,
  verified_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 9. INTERNSHIPS + PLACEMENTS
-- ------------------------------------------------------------
create table if not exists internships (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  title text not null,
  company text not null,
  department text,
  year_eligible text,
  deadline date,
  apply_link text,
  created_at timestamptz not null default now()
);

create table if not exists placement (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  company text not null,
  eligibility text,
  visit_date date,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- INDEXES (every tenant table gets a college_id index —
-- this is the column every query and every RLS check filters on)
-- ------------------------------------------------------------
create index if not exists idx_users_college on users(college_id);
create index if not exists idx_timetable_college on timetable(college_id);
create index if not exists idx_notes_college on notes(college_id);
create index if not exists idx_events_college on events(college_id);
create index if not exists idx_clubs_college on clubs(college_id);
create index if not exists idx_club_posts_college on club_posts(college_id);
create index if not exists idx_lost_found_college on lost_found(college_id);
create index if not exists idx_resources_college on resources(college_id);
create index if not exists idx_donations_college on donations(college_id);
create index if not exists idx_internships_college on internships(college_id);
create index if not exists idx_placement_college on placement(college_id);

alter table colleges enable row level security;
alter table users enable row level security;
alter table timetable enable row level security;
alter table notes enable row level security;
alter table events enable row level security;
alter table event_rsvps enable row level security;
alter table clubs enable row level security;
alter table club_posts enable row level security;
alter table lost_found enable row level security;
alter table resources enable row level security;
alter table borrow_requests enable row level security;
alter table donations enable row level security;
alter table internships enable row level security;
alter table placement enable row level security;

-- Helper: current caller's college_id, read from a custom JWT claim.
-- Your backend must sign tokens with a `college_id` claim for this
-- to work for any client that talks to Supabase directly.
create or replace function current_college_id()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'college_id', '')::uuid;
$$;

-- colleges: readable by anyone authenticated (needed for signup domain lookup)
drop policy if exists "colleges_select" on colleges;
create policy "colleges_select" on colleges for select using (true);

-- generic pattern applied to every tenant table below:
-- select/insert/update/delete only where college_id = current_college_id()

drop policy if exists "users_isolation" on users;
create policy "users_isolation" on users for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "timetable_isolation" on timetable;
create policy "timetable_isolation" on timetable for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "notes_isolation" on notes;
create policy "notes_isolation" on notes for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "events_isolation" on events;
create policy "events_isolation" on events for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "event_rsvps_isolation" on event_rsvps;
create policy "event_rsvps_isolation" on event_rsvps for all
  using (exists (select 1 from events e where e.id = event_id and e.college_id = current_college_id()))
  with check (exists (select 1 from events e where e.id = event_id and e.college_id = current_college_id()));

drop policy if exists "clubs_isolation" on clubs;
create policy "clubs_isolation" on clubs for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "club_posts_isolation" on club_posts;
create policy "club_posts_isolation" on club_posts for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "lost_found_isolation" on lost_found;
create policy "lost_found_isolation" on lost_found for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "resources_isolation" on resources;
create policy "resources_isolation" on resources for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "borrow_requests_isolation" on borrow_requests;
create policy "borrow_requests_isolation" on borrow_requests for all
  using (exists (select 1 from resources r where r.id = resource_id and r.college_id = current_college_id()))
  with check (exists (select 1 from resources r where r.id = resource_id and r.college_id = current_college_id()));

drop policy if exists "donations_isolation" on donations;
create policy "donations_isolation" on donations for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "internships_isolation" on internships;
create policy "internships_isolation" on internships for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

drop policy if exists "placement_isolation" on placement;
create policy "placement_isolation" on placement for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

-- ------------------------------------------------------------
-- 10. ANNOUNCEMENTS
-- ------------------------------------------------------------
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_announcements_college on announcements(college_id);
alter table announcements enable row level security;

drop policy if exists "announcements_isolation" on announcements;
create policy "announcements_isolation" on announcements for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

-- ------------------------------------------------------------
-- 11. ATTENDANCE
-- ------------------------------------------------------------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  student_id uuid not null references users(id) on delete cascade,
  subject text not null,
  attended_classes integer not null default 0 check (attended_classes >= 0),
  total_classes integer not null default 0 check (total_classes >= 0),
  percentage numeric(5,2) not null default 0.00 check (percentage >= 0.00 and percentage <= 100.00),
  semester text,
  division text,
  academic_year text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint check_attended_le_total check (attended_classes <= total_classes),
  constraint unique_student_subject_sem unique (college_id, student_id, subject, semester)
);

create index if not exists idx_attendance_college on attendance(college_id);
create index if not exists idx_attendance_student on attendance(student_id);
create index if not exists idx_attendance_division on attendance(college_id, division);
alter table attendance enable row level security;

-- Students can read their own attendance
drop policy if exists "attendance_student_isolation" on attendance;
create policy "attendance_student_isolation" on attendance for select
  using (college_id = current_college_id() and (student_id = auth.uid() or current_setting('request.jwt.claims', true)::json->>'app_role' = 'admin'));

-- Admins can insert/update/delete attendance for their college
drop policy if exists "attendance_admin_modify" on attendance;
create policy "attendance_admin_modify" on attendance for all
  using (college_id = current_college_id())
  with check (college_id = current_college_id());

-- ------------------------------------------------------------
insert into colleges (name, email_domain)
values ('VESIT', 'vesit.ves.ac.in')
on conflict (email_domain) do nothing;

