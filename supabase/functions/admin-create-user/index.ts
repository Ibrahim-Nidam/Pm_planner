import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, DEFAULT_PASSWORD, getAdminClient, toEmail, assertCallerIsActiveLead } from "../_shared/admin.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { callerProfile, adminClient } = await assertCallerIsActiveLead(req);
    const { full_name, machine_ids = [], cycle_anchor_date = '2026-10-01', cycle_anchor_index = 1 } = await req.json();

    if (!full_name) {
      return new Response(JSON.stringify({ error: 'full_name is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build unique username
    let baseUsername = full_name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!baseUsername) baseUsername = 'tech';
    let username = baseUsername;
    let counter = 1;

    while (true) {
      const { data: existing } = await adminClient
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();
      if (!existing) break;
      username = `${baseUsername}${counter}`;
      counter++;
    }

    // Map anchor index to type
    let cycle_anchor_shift_type = 'night';
    if (cycle_anchor_index === 0) cycle_anchor_shift_type = 'day';
    if (cycle_anchor_index === 2 || cycle_anchor_index === 3) cycle_anchor_shift_type = 'rest';

    // Create Auth User
    const email = toEmail(username);
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name, role: 'technician' }
    });

    if (authErr || !authData.user) {
      throw new Error(`Auth user creation failed: ${authErr?.message}`);
    }

    const userId = authData.user.id;

    // Create Profile Row
    const { error: profErr } = await adminClient.from('profiles').insert({
      id: userId,
      full_name,
      username,
      role: 'technician',
      cycle_anchor_date,
      cycle_anchor_index,
      cycle_anchor_shift_type,
      must_change_password: true,
      is_active: true
    });

    if (profErr) {
      // Rollback auth user
      await adminClient.auth.admin.deleteUser(userId);
      throw profErr;
    }

    // Assign Machines
    if (machine_ids && machine_ids.length > 0) {
      await adminClient
        .from('machines')
        .update({ technician_id: userId })
        .in('id', machine_ids);
    }

    // Audit Log
    await adminClient.from('audit_log').insert({
      actor_id: callerProfile.id,
      action: 'user.create',
      details: { target_user_id: userId, username, full_name, machine_ids }
    });

    return new Response(
      JSON.stringify({ username, default_password: DEFAULT_PASSWORD }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
