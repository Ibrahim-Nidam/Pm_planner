-- 005_admin_rpcs.sql — Database RPC functions for technician management supporting full 4-day shift cycle (Day, Night, Rest 1, Rest 2).

-- 1. admin_create_technician RPC
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

  -- Insert Auth User
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, crypt(v_default_pwd, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'role', 'technician'),
    now(), now()
  );

  -- Insert Profile
  insert into public.profiles (
    id, username, full_name, role, cycle_anchor_date, cycle_anchor_index,
    cycle_anchor_shift_type, must_change_password, is_active
  ) values (
    v_user_id, v_username, p_full_name, 'technician', p_cycle_anchor_date,
    v_anchor_index, p_cycle_anchor_shift_type, true, true
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

-- 2. admin_reset_password RPC
create or replace function public.admin_reset_password(p_user_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_caller_role text;
  v_default_pwd text := 'PMPlanner123!';
begin
  select role into v_caller_role from public.profiles where id = auth.uid() and is_active = true;
  if v_caller_role is null or v_caller_role != 'team_lead' then
    raise exception 'Forbidden: Active Team Lead role required';
  end if;

  update auth.users set encrypted_password = crypt(v_default_pwd, gen_salt('bf')) where id = p_user_id;
  update public.profiles set must_change_password = true, updated_at = now() where id = p_user_id;

  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), 'user.reset_password', jsonb_build_object('target_user_id', p_user_id));

  return jsonb_build_object('default_password', v_default_pwd);
end;
$$;

-- 3. admin_set_active RPC
create or replace function public.admin_set_active(p_user_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from public.profiles where id = auth.uid() and is_active = true;
  if v_caller_role is null or v_caller_role != 'team_lead' then
    raise exception 'Forbidden: Active Team Lead role required';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Cannot alter your own active status';
  end if;

  update public.profiles set is_active = p_is_active, updated_at = now() where id = p_user_id;

  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), 'user.set_active', jsonb_build_object('target_user_id', p_user_id, 'is_active', p_is_active));

  return jsonb_build_object('success', true, 'is_active', p_is_active);
end;
$$;
