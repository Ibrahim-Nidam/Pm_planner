-- 015_roster_write_rpc.sql -- Use lead-checked RPCs for roster writes.

create or replace function public.save_shift(
  p_technician_id uuid,
  p_shift_date date,
  p_shift_type text
)
returns public.shifts
language plpgsql security definer set search_path = public as $$
declare
  s public.shifts;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'team_lead' and is_active
  ) then
    raise exception 'Only active team leads can edit shifts';
  end if;

  if p_shift_type not in ('day', 'night', 'rest') then
    raise exception 'Invalid shift type';
  end if;

  insert into public.shifts (technician_id, shift_date, shift_type)
  values (p_technician_id, p_shift_date, p_shift_type)
  on conflict (technician_id, shift_date) do update
    set shift_type = excluded.shift_type
  returning * into s;

  return s;
end $$;

create or replace function public.save_shifts(p_shifts jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  saved_count integer := 0;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'team_lead' and is_active
  ) then
    raise exception 'Only active team leads can edit shifts';
  end if;

  for item in select value from jsonb_array_elements(p_shifts)
  loop
    if item->>'shift_type' not in ('day', 'night', 'rest') then
      raise exception 'Invalid shift type';
    end if;

    insert into public.shifts (technician_id, shift_date, shift_type)
    values (
      (item->>'technician_id')::uuid,
      (item->>'shift_date')::date,
      item->>'shift_type'
    )
    on conflict (technician_id, shift_date) do update
      set shift_type = excluded.shift_type;

    saved_count := saved_count + 1;
  end loop;

  return saved_count;
end $$;

revoke all on function public.save_shift, public.save_shifts from public;
grant execute on function public.save_shift, public.save_shifts to authenticated;
