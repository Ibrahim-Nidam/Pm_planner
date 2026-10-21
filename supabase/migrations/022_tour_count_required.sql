-- Migration 022: make the machine tour count mandatory when completing a PM.
-- The technician must record the current tour count; end_pm now refuses to
-- complete a PM without it.

do $$
begin
  if to_regclass('public.pm_tasks') is null then
    raise exception 'SAFETY STOP (no changes made): public.pm_tasks does not exist in this database. You are most likely in the WRONG Supabase project — the app uses project ref hrryibuugdovqlbiyejl (see js/config.js). Pick the correct project in the dashboard, then run docs/DB_CHECK.sql to confirm before running any migration.';
  end if;
  if to_regclass('public.machine_rotation_grease') is null then
    raise exception 'SAFETY STOP (no changes made): public.machine_rotation_grease not found. Run 018_maintenance_tracking.sql first, then 022_tour_count_required.sql.';
  end if;
end $$;

create or replace function public.end_pm(
  p_task_id uuid,
  p_notes text default null,
  p_parts jsonb default '[]'::jsonb,
  p_tour_count bigint default null
)
returns public.pm_tasks
language plpgsql security definer set search_path = public as $$
declare result public.pm_tasks;
declare current_count bigint;
declare tech_name text;
declare target_machine_id uuid;
begin
  if p_tour_count is null then
    raise exception 'Tour count is required to complete the PM';
  end if;
  if p_tour_count < 0 then
    raise exception 'Tour count cannot be negative';
  end if;

  select machine_id into target_machine_id
    from public.pm_tasks
   where id = p_task_id
     and technician_id = auth.uid()
     and status = 'in_progress'
   for update;

  if not found or not public.is_active_user() then raise exception 'Not allowed or PM not in progress'; end if;
  select coalesce(current_tour_count, 0) into current_count
    from public.machine_rotation_grease
   where machine_id = target_machine_id
   for update;
  current_count := coalesce(current_count, 0);
  select full_name into tech_name from public.profiles where id = auth.uid();
  if p_tour_count < current_count then
    raise exception 'Tour count cannot be below the existing machine counter';
  end if;

  update public.pm_tasks
     set status = 'completed', ended_at = now(),
         notes = coalesce(p_notes, notes), parts = p_parts,
         tour_count = p_tour_count,
         technician_name_snapshot = tech_name, updated_at = now()
   where id = p_task_id and technician_id = auth.uid()
     and status = 'in_progress' and public.is_active_user()
   returning * into result;
  if not found then raise exception 'Not allowed or PM not in progress'; end if;

  insert into public.machine_rotation_grease(machine_id, grease_counter, updated_by)
  values (result.machine_id, 0, auth.uid())
  on conflict (machine_id) do update
    set current_tour_count = greatest(public.machine_rotation_grease.current_tour_count, p_tour_count),
        updated_by = excluded.updated_by, updated_at = now();
  update public.machine_rotation_grease
     set current_tour_count = greatest(current_tour_count, p_tour_count),
         updated_by = auth.uid(), updated_at = now()
   where machine_id = result.machine_id;
  return result;
end $$;
