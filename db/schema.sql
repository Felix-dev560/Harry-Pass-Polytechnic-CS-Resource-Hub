-- Run once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists levels (
  id          smallint primary key check (id between 1 and 4),
  level_name  text not null unique
);
insert into levels (id, level_name) values (1,'ND 1'),(2,'ND 2'),(3,'HND 1'),(4,'HND 2')
on conflict (id) do nothing;

-- Admins table with first name, last name, email, password hash, and the strict
-- single-admin database constraint. Safe to re-run: it never drops existing data.
create table if not exists admins (
  id             serial primary key,
  first_name     text not null,
  last_name      text not null,
  email          text not null unique,
  password_hash  text not null,
  single_row     boolean not null default true unique check (single_row),
  created_at     timestamptz not null default now()
);

-- Raised every time the admin password changes. Sessions carry the number they were created with,
-- so raising it signs out every other device. Safe to re-run.
alter table admins add column if not exists session_version integer not null default 0;

create table if not exists courses (
  id            serial primary key,
  level_id      smallint not null references levels(id),
  semester      text not null check (semester in ('First','Second')),
  course_code   text not null,
  course_title  text not null,
  unique (level_id, semester, course_code)
);
create index if not exists courses_code_idx on courses (course_code);

create table if not exists course_materials (
  id            serial primary key,
  course_id     integer not null references courses(id) on delete cascade,
  year          smallint not null check (year between 2021 and 2100),
  question_url  text,
  handout_url   text,
  status_note   text,
  unique (course_id, year)
);

create table if not exists student_submissions (
  id            serial primary key,
  course_code   text not null,
  course_title  text,
  year          smallint not null,
  image_url     text not null,
  public_id     text not null,
  submitted_at  timestamptz not null default now()
);
-- Semester the student chose. Added after the first release, so existing databases need this line too.
-- Rows sent before it existed stay empty (null); every new submission must have it.
alter table student_submissions add column if not exists semester text check (semester in ('First','Second'));

-- Row Level Security
alter table levels               enable row level security;
alter table admins               enable row level security;
alter table courses              enable row level security;
alter table course_materials     enable row level security;
alter table student_submissions  enable row level security;

-- ---- Push notifications (safe to re-run) ----
-- One row per browser/device that switched notifications on. role is 'admin' (subscribed while signed in
-- on the dashboard) or 'student'. endpoint is unique, so a device never gets the same notification twice.
create table if not exists push_subscriptions (
  id          serial primary key,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  role        text not null default 'student' check (role in ('admin','student')),
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_role_idx on push_subscriptions (role);
alter table push_subscriptions enable row level security;

-- Marks photos the admin has already been notified about, so one batch of photos gives one notification.
alter table student_submissions add column if not exists notified boolean not null default false;
-- Photos that were already waiting before this feature existed should not trigger a notification later.
update student_submissions set notified = true where notified = false and submitted_at < now() - interval '1 minute';