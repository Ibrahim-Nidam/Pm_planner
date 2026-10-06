-- 016_manual_tasks_and_unrestricted_start.sql
-- Preserve manual schedule entries, record task origin, and remove armed-start enforcement.

alter table public.pm_tasks
  add column if not exists source text not null default 'generated'
    check (source in ('manual', 'generated'));

alter table public.pm_tasks
  add column if not exists created_by uuid references public.profiles(id);

create index if not exists pm_tasks_source_idx on public.pm_tasks (source);

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

drop index if exists public.pm_tasks_armed_idx;
alter table public.pm_tasks drop column if exists is_armed;
alter table public.schedule_months drop column if exists pm_start_armed;
delete from public.app_settings where key = 'pm_start_armed';
