-- 007_fix_technician_schema_rls.sql — Fix PostgREST join schema errors for technicians

-- 1. Fix machines table read policy
drop policy if exists machines_tech on public.machines;
drop policy if exists machines_lead on public.machines;
drop policy if exists machines_read_authenticated on public.machines;
drop policy if exists machines_write_lead on public.machines;

create policy machines_read_authenticated on public.machines for select to authenticated using (true);
create policy machines_write_lead on public.machines for insert to authenticated with check (public.is_lead());
create policy machines_update_lead on public.machines for update to authenticated using (public.is_lead()) with check (public.is_lead());
create policy machines_delete_lead on public.machines for delete to authenticated using (public.is_lead());

-- 2. Fix schedule_months table read policy
drop policy if exists months_tech on public.schedule_months;
drop policy if exists months_lead on public.schedule_months;
drop policy if exists months_read_authenticated on public.schedule_months;

create policy months_read_authenticated on public.schedule_months for select to authenticated using (true);
create policy months_write_lead on public.schedule_months for insert to authenticated with check (public.is_lead());
create policy months_update_lead on public.schedule_months for update to authenticated using (public.is_lead()) with check (public.is_lead());

-- 3. Fix shifts table read policy
drop policy if exists shifts_own on public.shifts;
drop policy if exists shifts_lead on public.shifts;
drop policy if exists shifts_read_authenticated on public.shifts;

create policy shifts_read_authenticated on public.shifts for select to authenticated using (true);
create policy shifts_write_lead on public.shifts for insert to authenticated with check (public.is_lead());
create policy shifts_update_lead on public.shifts for update to authenticated using (public.is_lead()) with check (public.is_lead());
