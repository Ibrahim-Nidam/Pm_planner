-- 003_rls.sql — Row Level Security + private photo bucket. Run THIRD.
-- Technicians have NO direct insert/update/delete on pm_tasks: they use start_pm / save_pm_notes / end_pm only.
-- Spec reference: docs/SPECS.md §3 (permissions) and §11 (security)

alter table public.app_settings    enable row level security;
alter table public.profiles        enable row level security;
alter table public.machines        enable row level security;
alter table public.shifts          enable row level security;
alter table public.schedule_months enable row level security;
alter table public.pm_tasks        enable row level security;
alter table public.pm_photos       enable row level security;
alter table public.audit_log       enable row level security;

-- app_settings
create policy settings_read  on public.app_settings for select to authenticated using (true);
create policy settings_write on public.app_settings for all    to authenticated using (public.is_lead()) with check (public.is_lead());

-- profiles (creation/reset/activation go through Edge Functions with the service role)
create policy profiles_read_own  on public.profiles for select to authenticated using (id = auth.uid() or public.is_lead());
create policy profiles_lead_edit on public.profiles for update to authenticated using (public.is_lead()) with check (public.is_lead());

-- machines
create policy machines_lead  on public.machines for all    to authenticated using (public.is_lead()) with check (public.is_lead());
create policy machines_tech  on public.machines for select to authenticated
  using (technician_id = auth.uid() and public.is_active_user());

-- shifts (a technician always sees their own roster; only the lead edits)
create policy shifts_lead on public.shifts for all    to authenticated using (public.is_lead()) with check (public.is_lead());
create policy shifts_own  on public.shifts for select to authenticated
  using (technician_id = auth.uid() and public.is_active_user());

-- schedule_months (technicians only see APPROVED months)
create policy months_lead on public.schedule_months for all    to authenticated using (public.is_lead()) with check (public.is_lead());
create policy months_tech on public.schedule_months for select to authenticated
  using (status = 'approved' and public.is_active_user());

-- pm_tasks (technicians: read own tasks of approved months, nothing else)
create policy tasks_lead on public.pm_tasks for all    to authenticated using (public.is_lead()) with check (public.is_lead());
create policy tasks_tech on public.pm_tasks for select to authenticated
  using (technician_id = auth.uid() and public.is_active_user()
         and exists (select 1 from public.schedule_months m where m.id = month_id and m.status = 'approved'));

-- pm_photos
create policy photos_lead on public.pm_photos for all    to authenticated using (public.is_lead()) with check (public.is_lead());
create policy photos_tech_read on public.pm_photos for select to authenticated
  using (exists (select 1 from public.pm_tasks t where t.id = pm_task_id and t.technician_id = auth.uid()));
create policy photos_tech_insert on public.pm_photos for insert to authenticated
  with check (
    uploaded_by = auth.uid() and public.is_active_user()
    and exists (select 1 from public.pm_tasks t
                where t.id = pm_task_id and t.technician_id = auth.uid() and t.status = 'in_progress')
    and (select count(*) from public.pm_photos p where p.pm_task_id = pm_photos.pm_task_id)
        < public.setting('max_photos_per_pm')::int
  );
create policy photos_tech_delete on public.pm_photos for delete to authenticated
  using (exists (select 1 from public.pm_tasks t
                 where t.id = pm_task_id and t.technician_id = auth.uid() and t.status = 'in_progress'));

-- audit_log: lead reads and writes
create policy audit_lead on public.audit_log for all to authenticated using (public.is_lead()) with check (public.is_lead());

-- Private storage bucket for photos. Object path = '<pm_task_id>/<uuid>.jpg'
insert into storage.buckets (id, name, public) values ('pm-photos', 'pm-photos', false)
on conflict (id) do nothing;

create policy photos_obj_lead on storage.objects for all to authenticated
  using (bucket_id = 'pm-photos' and public.is_lead())
  with check (bucket_id = 'pm-photos' and public.is_lead());

create policy photos_obj_tech_read on storage.objects for select to authenticated
  using (bucket_id = 'pm-photos' and exists (
    select 1 from public.pm_tasks t
    where t.id::text = (storage.foldername(name))[1] and t.technician_id = auth.uid()));

create policy photos_obj_tech_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pm-photos' and exists (
    select 1 from public.pm_tasks t
    where t.id::text = (storage.foldername(name))[1]
      and t.technician_id = auth.uid() and t.status = 'in_progress'));

create policy photos_obj_tech_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pm-photos' and exists (
    select 1 from public.pm_tasks t
    where t.id::text = (storage.foldername(name))[1]
      and t.technician_id = auth.uid() and t.status = 'in_progress'));
