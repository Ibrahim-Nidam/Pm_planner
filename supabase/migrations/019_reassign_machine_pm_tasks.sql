-- Keep the complete PM history aligned when a machine changes technician.

create or replace function public.reassign_machine_pm_tasks(
  p_machine_id uuid,
  p_technician_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  if not public.is_lead() then
    raise exception 'Team lead required';
  end if;

  update public.pm_tasks
     set technician_id = p_technician_id,
           updated_at = now()
     where machine_id = p_machine_id
       and technician_id is distinct from p_technician_id;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.reassign_machine_pm_tasks(uuid, uuid) from public;
grant execute on function public.reassign_machine_pm_tasks(uuid, uuid) to authenticated;
