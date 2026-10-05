-- 010_allow_photo_upload_on_completed_pm.sql — Allow photo upload on both in_progress and completed PM tasks

drop policy if exists photos_tech_insert on public.pm_photos;
drop policy if exists photos_tech_delete on public.pm_photos;

create policy photos_tech_insert on public.pm_photos for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.pm_tasks t 
      where t.id = pm_task_id and t.technician_id = auth.uid() and t.status in ('in_progress', 'completed')
    )
  );

create policy photos_tech_delete on public.pm_photos for delete to authenticated
  using (
    exists (
      select 1 from public.pm_tasks t 
      where t.id = pm_task_id and t.technician_id = auth.uid() and t.status in ('in_progress', 'completed')
    )
  );
