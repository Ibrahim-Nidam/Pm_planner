-- 009_fix_pm_photos_rls.sql — Fix photo uploads for technicians & storage RLS policies

-- 1. Ensure storage bucket exists
insert into storage.buckets (id, name, public) values ('pm-photos', 'pm-photos', false)
on conflict (id) do nothing;

-- 2. Clean up & recreate pm_photos table policies
drop policy if exists photos_lead on public.pm_photos;
drop policy if exists photos_tech_read on public.pm_photos;
drop policy if exists photos_tech_insert on public.pm_photos;
drop policy if exists photos_tech_delete on public.pm_photos;
drop policy if exists photos_read_authenticated on public.pm_photos;

create policy photos_read_authenticated on public.pm_photos for select to authenticated
  using (true);

create policy photos_tech_insert on public.pm_photos for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.pm_tasks t 
      where t.id = pm_task_id and t.technician_id = auth.uid() and t.status = 'in_progress'
    )
  );

create policy photos_tech_delete on public.pm_photos for delete to authenticated
  using (
    exists (
      select 1 from public.pm_tasks t 
      where t.id = pm_task_id and t.technician_id = auth.uid() and t.status = 'in_progress'
    )
  );

-- 3. Clean up & recreate storage.objects bucket policies
drop policy if exists photos_obj_lead on storage.objects;
drop policy if exists photos_obj_tech_read on storage.objects;
drop policy if exists photos_obj_tech_insert on storage.objects;
drop policy if exists photos_obj_tech_delete on storage.objects;
drop policy if exists photos_obj_authenticated_read on storage.objects;
drop policy if exists photos_obj_authenticated_insert on storage.objects;
drop policy if exists photos_obj_authenticated_delete on storage.objects;

create policy photos_obj_authenticated_read on storage.objects for select to authenticated
  using (bucket_id = 'pm-photos');

create policy photos_obj_authenticated_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pm-photos');

create policy photos_obj_authenticated_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pm-photos');
