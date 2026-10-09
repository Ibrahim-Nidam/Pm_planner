-- Maintenance tracking: vibration checks, rotation grease, X-ray generator grease,
-- PM tour counters, and technician deletion traceability.

alter table public.pm_tasks
  add column if not exists tour_count bigint,
  add column if not exists technician_name_snapshot text;

alter table public.pm_tasks
  alter column technician_id drop not null;

create table if not exists public.machine_rotation_grease (
  machine_id uuid primary key references public.machines(id) on delete cascade,
  grease_counter bigint not null default 0 check (grease_counter >= 0),
  current_tour_count bigint not null default 0 check (current_tour_count >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.machine_rotation_grease
  add column if not exists current_tour_count bigint not null default 0;

create table if not exists public.vibration_tests (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  tested_on timestamptz not null default now(),
  result text not null check (result in ('passed', 'failed')),
  performed_by uuid references public.profiles(id) on delete set null,
  performer_name text not null,
  unique (machine_id, month)
);
create index if not exists vibration_tests_month_idx on public.vibration_tests(month);

create table if not exists public.xray_generator_grease (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  connector text not null default 'X-ray generator connector',
  performed_on date not null,
  next_due_on date not null,
  performed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.next_workday(p_date date)
returns date
language sql immutable
as $$
  select case extract(isodow from p_date)::int
    when 6 then p_date + 2
    when 7 then p_date + 1
    else p_date
  end
$$;

create or replace function public.admin_set_rotation_grease(
  p_machine_id uuid,
  p_grease_counter bigint
)
returns public.machine_rotation_grease
language plpgsql security definer set search_path = public as $$
declare result public.machine_rotation_grease;
begin
  if not public.is_lead() then raise exception 'Team lead required'; end if;
  if p_grease_counter < 0 then raise exception 'Grease counter cannot be negative'; end if;

  insert into public.machine_rotation_grease(machine_id, grease_counter, updated_by)
  values (p_machine_id, p_grease_counter, auth.uid())
  on conflict (machine_id) do update
    set grease_counter = excluded.grease_counter,
        current_tour_count = greatest(public.machine_rotation_grease.current_tour_count, excluded.grease_counter),
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into result;
  return result;
end $$;

create or replace function public.save_vibration_test(
  p_machine_id uuid,
  p_month date,
  p_result text
)
returns public.vibration_tests
language plpgsql security definer set search_path = public as $$
declare result public.vibration_tests;
begin
  if not public.is_active_user() then raise exception 'Active user required'; end if;
  if p_result not in ('passed', 'failed') then raise exception 'Invalid vibration result'; end if;

  insert into public.vibration_tests(machine_id, month, result, performed_by, performer_name)
  select p_machine_id, date_trunc('month', p_month)::date, p_result, auth.uid(), full_name
  from public.profiles where id = auth.uid()
  on conflict (machine_id, month) do update
    set result = excluded.result,
        tested_on = now(),
        performed_by = excluded.performed_by,
        performer_name = excluded.performer_name
  returning * into result;
  return result;
end $$;

create or replace function public.save_xray_generator_grease(
  p_machine_id uuid,
  p_connector text,
  p_performed_on date
)
returns public.xray_generator_grease
language plpgsql security definer set search_path = public as $$
declare result public.xray_generator_grease;
declare due date;
begin
  if not public.is_lead() then raise exception 'Team lead required'; end if;
  due := public.next_workday((p_performed_on + interval '3 months')::date);

  delete from public.xray_generator_grease
   where performed_on < (current_date - interval '5 years')::date;

  insert into public.xray_generator_grease(machine_id, connector, performed_on, next_due_on, performed_by)
  values (p_machine_id, coalesce(nullif(trim(p_connector), ''), 'X-ray generator connector'), p_performed_on, due, auth.uid())
  returning * into result;
  return result;
end $$;

create or replace function public.clear_xray_generator_grease(
  p_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_lead() then raise exception 'Team lead required'; end if;
  delete from public.xray_generator_grease where id = p_id;
end $$;

create or replace function public.delete_technician(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_lead() then raise exception 'Team lead required'; end if;
  if p_user_id = auth.uid() then raise exception 'Cannot delete your own account'; end if;

  update public.pm_tasks t
     set technician_name_snapshot = coalesce(t.technician_name_snapshot, p.full_name),
         technician_id = null
    from public.profiles p
   where t.technician_id = p.id and p.id = p_user_id;

  update public.machines set technician_id = null where technician_id = p_user_id;
  delete from public.shifts where technician_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end $$;

drop function if exists public.end_pm(uuid, text, jsonb);

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
  if p_tour_count is not null and p_tour_count < 0 then
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
  if p_tour_count is not null and p_tour_count < current_count then
    raise exception 'Tour count cannot be below the existing machine counter';
  end if;

  update public.pm_tasks
     set status = 'completed', ended_at = now(),
         notes = coalesce(p_notes, notes), parts = p_parts,
         tour_count = coalesce(p_tour_count, tour_count),
         technician_name_snapshot = tech_name, updated_at = now()
   where id = p_task_id and technician_id = auth.uid()
     and status = 'in_progress' and public.is_active_user()
   returning * into result;
  if not found then raise exception 'Not allowed or PM not in progress'; end if;

  if p_tour_count is not null then
    insert into public.machine_rotation_grease(machine_id, grease_counter, updated_by)
    values (result.machine_id, 0, auth.uid())
    on conflict (machine_id) do update
      set current_tour_count = greatest(public.machine_rotation_grease.current_tour_count, p_tour_count),
          updated_by = excluded.updated_by, updated_at = now();
    update public.machine_rotation_grease
       set current_tour_count = greatest(current_tour_count, p_tour_count),
           updated_by = auth.uid(), updated_at = now()
     where machine_id = result.machine_id;
  end if;
  return result;
end $$;

alter table public.machine_rotation_grease enable row level security;
alter table public.vibration_tests enable row level security;
alter table public.xray_generator_grease enable row level security;

create policy rotation_grease_read on public.machine_rotation_grease for select to authenticated using (public.is_active_user());
create policy rotation_grease_lead on public.machine_rotation_grease for all to authenticated using (public.is_lead()) with check (public.is_lead());
create policy vibration_read on public.vibration_tests for select to authenticated using (public.is_active_user());
create policy xray_grease_read on public.xray_generator_grease for select to authenticated using (public.is_active_user());
create policy xray_grease_lead on public.xray_generator_grease for all to authenticated using (public.is_lead()) with check (public.is_lead());
create policy shifts_active_read on public.shifts for select to authenticated using (public.is_active_user());

drop policy if exists machines_active_read on public.machines;
create policy machines_active_read on public.machines for select to authenticated using (public.is_active_user());

grant execute on function public.admin_set_rotation_grease(uuid, bigint),
  public.save_vibration_test(uuid, date, text),
  public.save_xray_generator_grease(uuid, text, date),
  public.clear_xray_generator_grease(uuid),
  public.delete_technician(uuid),
  public.next_workday(date),
  public.end_pm(uuid, text, jsonb, bigint) to authenticated;
