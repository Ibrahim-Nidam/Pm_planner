-- READ-ONLY diagnostic. Changes nothing. Run this FIRST in the Supabase SQL Editor.
-- Purpose: confirm you are in the SAME project the app uses before running any migration.
-- The app (js/config.js) points at project ref: hrryibuugdovqlbiyejl
--
-- If query 1 errors with "relation public.pm_tasks does not exist",
-- you are in the WRONG project: use the project selector at the top-left of the
-- Supabase dashboard and pick hrryibuugdovqlbiyejl, then run this again.

-- 1) Production tables present? (must return rows, not an error)
select 'pm_tasks' as object, count(*) as rows_in_table from public.pm_tasks
union all select 'machines',       count(*) from public.machines
union all select 'profiles',       count(*) from public.profiles
union all select 'schedule_months',count(*) from public.schedule_months;

-- 2) Which optional objects already exist? (tells you which migrations are applied)
select
  to_regclass('public.pm_tasks')                     is not null as has_pm_tasks_001,
  to_regclass('public.shifts')                       is not null as has_shifts_001,
  exists(select 1 from information_schema.columns
         where table_schema='public' and table_name='pm_tasks' and column_name='parts')
                                                     as has_parts_017,
  to_regclass('public.machine_rotation_grease')      is not null as has_grease_018,
  to_regclass('public.xray_generator_grease')        is not null as has_xray_018,
  exists(select 1 from information_schema.columns
         where table_schema='public' and table_name='pm_tasks' and column_name='tour_count')
                                                     as has_tour_count_018,
  to_regclass('public.rotation_grease_history')      is not null as has_grease_history_023;

-- 3) Which start_pm version is live? (the overdue-start fix lands in 023)
select p.oid::regprocedure as signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'start_pm';

-- 4) Who am I and what database is this?
select current_database() as database, current_user as role, version() as postgres_version;
