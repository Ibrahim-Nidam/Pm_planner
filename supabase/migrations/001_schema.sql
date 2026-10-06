-- 001_schema.sql — tables, constraints, settings. Run FIRST in the Supabase SQL editor.
-- Spec reference: docs/SPECS.md §6 (Data model)

create table public.app_settings (
  key   text primary key,
  value text not null
);

insert into public.app_settings (key, value) values
  ('timezone',                     'Africa/Casablanca'), -- IANA name, never a fixed offset (DST/Ramadan changes)
  ('night_start',                  '20:30'),
  ('night_end',                    '08:30'),
  ('second_pm_gap_days',           '14'),
  ('second_pm_gap_tolerance_days', '2'),
  ('max_photos_per_pm',            '5');

create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  username             text not null unique,
  full_name            text not null,
  role                 text not null check (role in ('team_lead', 'technician')),
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  -- Shift cycle is fixed: index 0 = day, 1 = night, 2 = rest, 3 = rest.
  -- "On cycle_anchor_date this person is at cycle_anchor_index."
  cycle_anchor_date    date,
  cycle_anchor_index   smallint check (cycle_anchor_index between 0 and 3),
  created_at           timestamptz not null default now()
);

create table public.machines (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,               -- e.g. K278, K887U
  location      text check (location in ('terminal_1', 'transit')), -- 2 locations, 6 lines each, 1 machine per line
  line          text,                               -- e.g. L2 (L1-L6 inside its location)
  sort_order    int  not null default 0,
  pm_per_month  smallint not null default 1 check (pm_per_month between 0 and 2),
  technician_id uuid references public.profiles(id),
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now()
);

create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete cascade,
  shift_date    date not null,
  shift_type    text not null check (shift_type in ('day', 'night', 'rest')),
  unique (technician_id, shift_date)
);
create index shifts_date_idx on public.shifts (shift_date);

create table public.schedule_months (
  id           uuid primary key default gen_random_uuid(),
  month        date not null unique check (extract(day from month) = 1), -- first day of the month
  status       text not null default 'draft' check (status in ('draft', 'approved')),
  pm_start_armed boolean not null default true,
  generated_at timestamptz,
  approved_by  uuid references public.profiles(id),
  approved_at  timestamptz
);

create table public.pm_tasks (
  id                  uuid primary key default gen_random_uuid(),
  month_id            uuid not null references public.schedule_months(id) on delete cascade,
  machine_id          uuid not null references public.machines(id),
  technician_id       uuid not null references public.profiles(id),
  sequence            smallint not null check (sequence in (1, 2)), -- 1 = PM, 2 = 2P
  scheduled_date      date not null,   -- the NIGHT date (the date the night shift starts)
  latest_allowed_date date not null,   -- tolerance date; equals scheduled_date when no tolerance
  status              text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed')),
  is_armed            boolean not null default true,
  started_at          timestamptz,
  ended_at            timestamptz,
  postponed           boolean not null default false,
  postpone_reason     text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (month_id, machine_id, sequence),
  check (latest_allowed_date >= scheduled_date),
  check (ended_at is null or (started_at is not null and ended_at >= started_at))
);
create index pm_tasks_tech_date_idx on public.pm_tasks (technician_id, scheduled_date);

create table public.pm_photos (
  id           uuid primary key default gen_random_uuid(),
  pm_task_id   uuid not null references public.pm_tasks(id) on delete cascade,
  storage_path text not null,           -- '<pm_task_id>/<uuid>.jpg' in bucket 'pm-photos'
  uploaded_by  uuid not null references public.profiles(id),
  created_at   timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id),
  action     text not null,             -- e.g. 'schedule.generate', 'schedule.approve', 'task.move', 'user.reset_password'
  entity     text,
  entity_id  uuid,
  details    jsonb,
  created_at timestamptz not null default now()
);
