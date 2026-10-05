-- 008_fix_auth_users_confirmed_at.sql — Complete GoTrue schema fix for auth.users

-- 1. Fix instance_id on auth.users by copying the project's real instance_id from existing lead/admin user
do $$
declare
  v_real_instance_id uuid;
begin
  select instance_id into v_real_instance_id 
    from auth.users 
   where instance_id is not null and instance_id != '00000000-0000-0000-0000-000000000000'::uuid 
   limit 1;

  if v_real_instance_id is not null then
    update auth.users 
       set instance_id = v_real_instance_id 
     where instance_id = '00000000-0000-0000-0000-000000000000'::uuid or instance_id is null;
  end if;
end $$;

-- 2. Populate empty string defaults for token columns to prevent GoTrue null pointer panics
update auth.users
   set encrypted_password = extensions.crypt('PMPlanner123!', extensions.gen_salt('bf', 10)),
       email_confirmed_at = coalesce(email_confirmed_at, created_at, now()),
       confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change = coalesce(email_change, ''),
       phone_change = coalesce(phone_change, ''),
       phone_change_token = coalesce(phone_change_token, ''),
       email_change_token_current = coalesce(email_change_token_current, ''),
       reauthentication_token = coalesce(reauthentication_token, ''),
       is_sso_user = coalesce(is_sso_user, false),
       is_anonymous = coalesce(is_anonymous, false)
 where email like '%@pmplanner.local';

-- 3. Update admin_create_technician RPC to include all GoTrue required columns
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
  v_instance_id uuid;
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

  -- Get project instance_id
  select instance_id into v_instance_id from auth.users where instance_id is not null limit 1;
  if v_instance_id is null then
    v_instance_id := '00000000-0000-0000-0000-000000000000'::uuid;
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

  -- Insert Auth User using real instance_id, bcrypt cost factor 10, and empty string tokens
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    phone_change, phone_change_token, email_change_token_current, reauthentication_token,
    is_sso_user, is_anonymous
  ) values (
    v_user_id, v_instance_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_default_pwd, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'role', 'technician'),
    now(), now(),
    '', '', '', '',
    '', '', '', '',
    false, false
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
