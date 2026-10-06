-- 012_pm_start_arming.sql -- Allow leads to unlock a PM for an off-schedule start.

alter table public.pm_tasks
  add column if not exists is_armed boolean not null default true;

comment on column public.pm_tasks.is_armed is
  'When true, the technician may start only on the scheduled or tolerance night.';

create index if not exists pm_tasks_armed_idx on public.pm_tasks (is_armed)
  where status = 'scheduled';

create or replace function public.start_pm(p_task_id uuid, p_postpone_reason text default null)
returns public.pm_tasks
language plpgsql security definer set search_path = public as $$
declare
  t   public.pm_tasks;
  m   public.schedule_months;
  nd  date := public.current_night_date();
  is_postponed boolean := false;
begin
  select * into t from public.pm_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if t.technician_id <> auth.uid() or not public.is_active_user() then
    raise exception 'Not allowed';
  end if;

  select * into m from public.schedule_months where id = t.month_id;
  if m.status <> 'approved' then raise exception 'Schedule not approved yet'; end if;
  if t.status <> 'scheduled' then raise exception 'Task already started or completed'; end if;
  if not public.is_night_time() then raise exception 'A PM can only be started during the night shift'; end if;

  if exists (select 1 from public.pm_tasks
             where technician_id = auth.uid() and status = 'in_progress') then
    raise exception 'Finish your current PM before starting another';
  end if;

  if coalesce(t.is_armed, true) then
    if nd = t.scheduled_date then
      is_postponed := false;
    elsif nd = t.latest_allowed_date and t.latest_allowed_date > t.scheduled_date then
      if coalesce(trim(p_postpone_reason), '') = '' then
        raise exception 'A reason is required to postpone a PM';
      end if;
      is_postponed := true;
    else
      raise exception 'This PM is not scheduled for tonight';
    end if;
  end if;

  update public.pm_tasks
     set status = 'in_progress', started_at = now(), postponed = is_postponed,
         postpone_reason = case when is_postponed then trim(p_postpone_reason) else null end,
         updated_at = now()
   where id = t.id
   returning * into t;
  return t;
end $$;
