-- 017_pm_parts.sql — structured parts used by the generated PM documents.

alter table public.pm_tasks
  add column if not exists parts jsonb not null default '[]'::jsonb;

create or replace function public.save_pm_parts(p_task_id uuid, p_parts jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_parts) <> 'array' then
    raise exception 'PM parts must be an array';
  end if;

  update public.pm_tasks
     set parts = p_parts, updated_at = now()
   where id = p_task_id and technician_id = auth.uid()
     and status = 'in_progress' and public.is_active_user();
  if not found then raise exception 'Not allowed or PM not in progress'; end if;
end $$;

create or replace function public.end_pm(p_task_id uuid, p_notes text, p_parts jsonb)
returns public.pm_tasks
language plpgsql security definer set search_path = public as $$
declare t public.pm_tasks;
begin
  if jsonb_typeof(p_parts) <> 'array' then
    raise exception 'PM parts must be an array';
  end if;

  update public.pm_tasks
     set status = 'completed', ended_at = now(),
         notes = coalesce(p_notes, notes), parts = p_parts, updated_at = now()
   where id = p_task_id and technician_id = auth.uid()
     and status = 'in_progress' and public.is_active_user()
   returning * into t;
  if not found then raise exception 'Not allowed or PM not in progress'; end if;
  return t;
end $$;

revoke all on function public.save_pm_parts(uuid, jsonb), public.end_pm(uuid, text, jsonb) from public;
grant execute on function public.save_pm_parts(uuid, jsonb), public.end_pm(uuid, text, jsonb) to authenticated;
