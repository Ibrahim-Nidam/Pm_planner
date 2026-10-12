-- 021_xray_grease_last5.sql
-- Change connector grease history retention from "last 5 years" to "last 5 records per machine".

create or replace function public.save_xray_generator_grease(
  p_machine_id uuid,
  p_connector text,
  p_performed_on date
)
returns public.xray_generator_grease
language plpgsql security definer set search_path = public as $$
declare result public.xray_generator_grease;
declare due date;
declare excess_count int;
begin
  if not public.is_lead() then raise exception 'Team lead required'; end if;
  due := public.next_workday((p_performed_on + interval '3 months')::date);

  -- Insert the new session first
  insert into public.xray_generator_grease(machine_id, connector, performed_on, next_due_on, performed_by)
  values (p_machine_id, coalesce(nullif(trim(p_connector), ''), 'X-ray generator connector'), p_performed_on, due, auth.uid())
  returning * into result;

  -- Keep only the 5 most recent records for this machine; delete the rest
  delete from public.xray_generator_grease
  where machine_id = p_machine_id
    and id not in (
      select id
      from public.xray_generator_grease
      where machine_id = p_machine_id
      order by performed_on desc, updated_at desc
      limit 5
    );

  return result;
end $$;

grant execute on function public.save_xray_generator_grease(uuid, text, date) to authenticated;
