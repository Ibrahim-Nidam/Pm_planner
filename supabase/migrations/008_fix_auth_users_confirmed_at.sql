-- 008_fix_auth_users_confirmed_at.sql — Fix missing confirmed_at in auth.users causing GoTrue 500 errors.

-- 1. Backfill all existing users in auth.users so their confirmed_at is populated
update auth.users 
   set confirmed_at = coalesce(email_confirmed_at, created_at, now()),
       email_confirmed_at = coalesce(email_confirmed_at, created_at, now())
 where confirmed_at is null;

-- 2. Update admin_create_technician RPC to populate confirmed_at
create or replace function public.admin_create_technician(
  p_full_name text,
  p_username text default null,
  p_cycle_anchor_date date default '2026-10-01',
  p_cycle_anchor_shift_type text default 'night',
  p_cycle_anchor_index int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_base_username text;
  v_username text;
  v_counter int := 1;
  v_email text;
  v_default_pwd text := 'PMPlanner123!';
  v_caller_role text;
  v_anchor_index int := 1;
begin
  -- Check caller is active team_lead
  select role into v_caller_role from public.profiles where id = auth.uid() and is_active = true;
  if v_caller_role is null or v_caller_role != 'team_lead' then
    raise exception 'Forbidden: Active Team Lead role required';
  end if;

  -- Derive unique username if not provided
  if p_username is null or trim(p_username) = '' then
    v_base_username := lower(regexp_replace(p_full_name, '[^a-zA-Z0-9]', '', 'g'));
    if v_base_username = '' then v_base_username := 'tech'; end if;
    v_username := v_base_username;

    while exists (select 1 from public.profiles where username = v_username) loop
      v_username := v_base_username || v_counter;
      v_counter := v_counter + 1;
    end loop;
  else
    v_username := lower(trim(p_username));
  end if;

  v_email := v_username || '@pmplanner.local';

  -- Resolve anchor index (0=Day, 1=Night, 2=Rest 1, 3=Rest 2)
  if p_cycle_anchor_index is not null then
    v_anchor_index := p_cycle_anchor_index;
  else
    if p_cycle_anchor_shift_type = 'day' then v_anchor_index := 0;
    elsif p_cycle_anchor_shift_type = 'night' then v_anchor_index := 1;
    elsif p_cycle_anchor_shift_type = 'rest1' or p_cycle_anchor_shift_type = 'rest' then v_anchor_index := 2;
    elsif p_cycle_anchor_shift_type = 'rest2' then v_anchor_index := 3;
    end if;
  end if;

  -- Insert Auth User with both confirmed_at and email_confirmed_at
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_default_pwd, extensions.gen_salt('bf')), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'role', 'technician'),
    now(), now()
  );

  -- Insert Profile
  insert into public.profiles (
    id, username, full_name, role, cycle_anchor_date, cycle_anchor_index,
    must_change_password, is_active
  ) values (
    v_user_id, v_username, p_full_name, 'technician', p_cycle_anchor_date,
    v_anchor_index, true, true
  );

  -- Write Audit Log
  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), 'user.create', jsonb_build_object('target_user_id', v_user_id, 'username', v_username, 'full_name', p_full_name));

  return jsonb_build_object(
    'user_id', v_user_id,
    'username', v_username,
    'default_password', v_default_pwd
  );
end;
$$;
