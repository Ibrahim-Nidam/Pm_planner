-- 011_lead_schedule_rpcs.sql — Lead-only RPCs for approve & clear schedule (security definer bypasses RLS)

-- Approve a schedule month: sets status='approved', records who approved
create or replace function public.approve_schedule(p_month_id uuid)
returns public.schedule_months
language plpgsql security definer set search_path = public as $$
declare
  m public.schedule_months;
begin
  -- Verify caller is an active team lead
  if not public.is_lead() then
    raise exception 'Only team leads can approve schedules';
  end if;

  select * into m from public.schedule_months where id = p_month_id for update;
  if not found then raise exception 'Schedule month not found'; end if;
  if m.status = 'approved' then raise exception 'Schedule is already approved'; end if;

  update public.schedule_months
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_month_id
   returning * into m;

  return m;
end $$;

-- Clear a schedule: deletes non-completed tasks and resets month to draft
create or replace function public.clear_schedule(p_month_id uuid)
returns public.schedule_months
language plpgsql security definer set search_path = public as $$
declare
  m public.schedule_months;
begin
  -- Verify caller is an active team lead
  if not public.is_lead() then
    raise exception 'Only team leads can clear schedules';
  end if;

  select * into m from public.schedule_months where id = p_month_id for update;
  if not found then raise exception 'Schedule month not found'; end if;

  -- Delete all non-completed tasks (scheduled + in_progress)
  delete from public.pm_tasks
   where month_id = p_month_id
     and status in ('scheduled', 'in_progress');

  -- Reset month back to draft
  update public.schedule_months
     set status = 'draft',
         approved_by = null,
         approved_at = null
   where id = p_month_id
   returning * into m;

  return m;
end $$;

-- Grant execute to authenticated users (lead check is inside the function)
revoke all on function public.approve_schedule, public.clear_schedule from public;
grant execute on function public.approve_schedule, public.clear_schedule to authenticated;
