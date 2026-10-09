-- Keep PM visibility and ownership synchronized with the machine assignment.

create or replace function public.sync_machine_pm_task_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.technician_id is distinct from old.technician_id then
    update public.pm_tasks
       set technician_id = new.technician_id,
           updated_at = now()
     where machine_id = new.id
       and technician_id is distinct from new.technician_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_machine_pm_task_ownership on public.machines;
create trigger sync_machine_pm_task_ownership
after update of technician_id on public.machines
for each row
execute function public.sync_machine_pm_task_ownership();

drop policy if exists tasks_tech on public.pm_tasks;
create policy tasks_tech on public.pm_tasks for select to authenticated
using (
  public.is_active_user()
  and exists (
    select 1
    from public.schedule_months m
    where m.id = month_id
      and m.status = 'approved'
  )
  and (
    technician_id = auth.uid()
    or exists (
      select 1
      from public.machines machine
      where machine.id = pm_tasks.machine_id
        and machine.technician_id = auth.uid()
    )
  )
);

revoke all on function public.sync_machine_pm_task_ownership() from public;
