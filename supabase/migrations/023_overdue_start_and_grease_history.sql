-- Migration 023:
--  1) Overdue PMs stay startable. A technician may execute a PM at any time;
--     the planned dates are never modified, so the team lead keeps full
--     visibility of the original schedule (and can spot late executions).
--  2) Rotation grease history: keep track of the tour numbers at which each
--     machine was last greased (not the tour counter snapshots).

do $$
begin
  if to_regclass('public.pm_tasks') is null then
    raise exception 'SAFETY STOP (no changes made): public.pm_tasks does not exist in this database. You are most likely in the WRONG Supabase project — the app uses project ref hrryibuugdovqlbiyejl (see js/config.js). Pick the correct project in the dashboard, then run docs/DB_CHECK.sql to confirm before running any migration.';
  end if;
  if to_regclass('public.machine_rotation_grease') is null then
    raise exception 'SAFETY STOP (no changes made): public.machine_rotation_grease not found. Run 018_maintenance_tracking.sql first, then 023_overdue_start_and_grease_history.sql.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Unrestricted start: any scheduled PM can be started whenever the tech wants
-- ---------------------------------------------------------------------------
create or replace function public.start_pm(p_task_id uuid, p_postpone_reason text default null)
returns public.pm_tasks
language plpgsql security definer set search_path = public as $$
declare
  t public.pm_tasks;
begin
  select * into t from public.pm_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if t.technician_id <> auth.uid() or not public.is_active_user() then
    raise exception 'Not allowed';
  end if;

  if not exists (
    select 1 from public.schedule_months
    where id = t.month_id and status = 'approved'
  ) then
    raise exception 'Schedule not approved yet';
  end if;
  if t.status <> 'scheduled' then raise exception 'Task already started or completed'; end if;

  if exists (
    select 1 from public.pm_tasks
    where technician_id = auth.uid() and status = 'in_progress'
  ) then
    raise exception 'Finish your current PM before starting another';
  end if;

  -- Deliberately no date check: overdue PMs can be executed late. The original
  -- scheduled_date / latest_allowed_date stay untouched so the team lead can
  -- still see when the PM was planned.
  update public.pm_tasks
     set status = 'in_progress',
         started_at = now(),
         postponed = false,
         postpone_reason = null,
         updated_at = now()
   where id = t.id
   returning * into t;
  return t;
end $$;

-- Leftovers from the old armed-start mechanism, in case they are still present.
drop index if exists public.pm_tasks_armed_idx;
alter table public.pm_tasks drop column if exists is_armed;
alter table public.schedule_months drop column if exists pm_start_armed;
delete from public.app_settings where key = 'pm_start_armed';

-- ---------------------------------------------------------------------------
-- 2) Rotation grease history: "greased at tour N" events
-- ---------------------------------------------------------------------------
create table if not exists public.rotation_grease_history (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  greased_at_tour bigint not null check (greased_at_tour >= 0),
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index if not exists rotation_grease_history_machine_idx
  on public.rotation_grease_history(machine_id, recorded_at desc);

-- Record an event every time the "last greased at" baseline (grease_counter)
-- changes to a new positive value. A zero baseline (initial row, PM bookkeeping)
-- is not a greasing event.
create or replace function public.log_rotation_grease_history()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.grease_counter > 0
     and (tg_op = 'INSERT' or new.grease_counter is distinct from old.grease_counter) then
    insert into public.rotation_grease_history(machine_id, greased_at_tour, recorded_by)
    values (new.machine_id, new.grease_counter, new.updated_by);
  end if;
  return new;
end $$;

drop trigger if exists log_rotation_grease_history on public.machine_rotation_grease;
create trigger log_rotation_grease_history
after insert or update of grease_counter on public.machine_rotation_grease
for each row execute function public.log_rotation_grease_history();

alter table public.rotation_grease_history enable row level security;
drop policy if exists grease_history_read on public.rotation_grease_history;
create policy grease_history_read on public.rotation_grease_history for select to authenticated
  using (public.is_active_user());
-- No insert/update/delete policy: history is written by the security definer
-- trigger only, so technicians cannot rewrite past grease events.

revoke all on function public.log_rotation_grease_history() from public, anon, authenticated;
