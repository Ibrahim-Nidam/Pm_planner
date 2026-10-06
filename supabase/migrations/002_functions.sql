-- 002_functions.sql — helpers and the ONLY write paths technicians have. Run SECOND.
-- Spec reference: docs/SPECS.md §9 (PM execution) and §11 (security)

create function public.setting(k text) returns text
language sql stable as $$ select value from public.app_settings where key = k $$;

create function public.is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'team_lead' and is_active)
$$;

create function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

-- Local wall-clock time in the configured timezone.
create function public.local_now() returns timestamp
language sql stable as $$ select now() at time zone public.setting('timezone') $$;

-- Night shifts cross midnight. The "night date" is the date the night STARTED.
-- Example (night 20:30-08:30): 02:00 on 13/10 still belongs to the night of 12/10.
create function public.current_night_date() returns date
language sql stable as $$
  select (public.local_now() - (public.setting('night_end')::time)::interval)::date
$$;

create function public.is_night_time() returns boolean
language sql stable as $$
  select public.local_now()::time >= public.setting('night_start')::time
      or public.local_now()::time <  public.setting('night_end')::time
$$;

-- Lets the browser use SERVER time instead of the device clock.
create function public.get_server_context() returns json
language sql stable as $$
  select json_build_object(
    'now',          now(),
    'night_date',   public.current_night_date(),
    'is_night',     public.is_night_time(),
    'timezone',     public.setting('timezone'),
    'night_start',  public.setting('night_start'),
    'night_end',    public.setting('night_end'),
    'max_photos',   public.setting('max_photos_per_pm')::int
  )
$$;

create function public.start_pm(p_task_id uuid, p_postpone_reason text default null)
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

create function public.save_pm_notes(p_task_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.pm_tasks set notes = p_notes, updated_at = now()
   where id = p_task_id and technician_id = auth.uid()
     and status = 'in_progress' and public.is_active_user();
  if not found then raise exception 'Not allowed or PM not in progress'; end if;
end $$;

create function public.end_pm(p_task_id uuid, p_notes text default null)
returns public.pm_tasks
language plpgsql security definer set search_path = public as $$
declare t public.pm_tasks;
begin
  update public.pm_tasks
     set status = 'completed', ended_at = now(),
         notes = coalesce(p_notes, notes), updated_at = now()
   where id = p_task_id and technician_id = auth.uid()
     and status = 'in_progress' and public.is_active_user()
   returning * into t;
  if not found then raise exception 'Not allowed or PM not in progress'; end if;
  return t;
end $$;

create function public.mark_password_changed() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;

revoke all on function public.start_pm, public.save_pm_notes, public.end_pm,
  public.mark_password_changed from public;
grant execute on function public.start_pm, public.save_pm_notes, public.end_pm,
  public.mark_password_changed, public.get_server_context to authenticated;
