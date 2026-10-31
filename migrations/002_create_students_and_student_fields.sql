-- Migration 002: Add student profile attributes to users table and create students table
-- Safe, backward-compatible, non-destructive migration. Can be run multiple times.

-- 1. Extend users table with student-specific academic attributes
alter table users add column if not exists roll_number text;
alter table users add column if not exists year text;
alter table users add column if not exists branch text;
alter table users add column if not exists division text;

-- Add indexes for student lookups
create index if not exists idx_users_roll_number on users(roll_number);
create index if not exists idx_users_college_division on users(college_id, division);
create index if not exists idx_users_college_branch on users(college_id, branch);
create index if not exists idx_users_college_year on users(college_id, year);

-- 2. Dedicated students table (optional structured access for student management)
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references users(id) on delete cascade,
  college_id uuid not null references colleges(id) on delete cascade,
  name text not null,
  email text unique not null,
  roll_number text unique not null,
  year text not null,
  year_code text,
  branch text not null,
  branch_code text,
  division text not null,
  division_letter text,
  created_at timestamptz not null default now()
);

create index if not exists idx_students_college on students(college_id);
create index if not exists idx_students_division on students(college_id, division);
create index if not exists idx_students_year on students(college_id, year);
create index if not exists idx_students_branch on students(college_id, branch);

alter table students enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = current_schema()
      and tablename = 'students'
      and policyname = 'students_isolation'
  ) then
    create policy "students_isolation" on students for all
      using (college_id = current_college_id())
      with check (college_id = current_college_id());
  end if;
end
$$;
