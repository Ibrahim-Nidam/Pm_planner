import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, assertCallerIsActiveLead } from "../_shared/admin.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { callerProfile, adminClient } = await assertCallerIsActiveLead(req);
    const { user_id, is_active } = await req.json();

    if (!user_id || typeof is_active !== 'boolean') {
      return new Response(JSON.stringify({ error: 'user_id and boolean is_active are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (user_id === callerProfile.id) {
      return new Response(JSON.stringify({ error: 'Cannot alter your own active status' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update Profile status
    const { error: profErr } = await adminClient
      .from('profiles')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', user_id);

    if (profErr) throw profErr;

    // Ban or unban Auth user
    const ban_duration = is_active ? 'none' : '876000h'; // ~100 years ban if inactive
    await adminClient.auth.admin.updateUserById(user_id, {
      ban_duration
    });

    // Write Audit Log
    await adminClient.from('audit_log').insert({
      actor_id: callerProfile.id,
      action: 'user.set_active',
      details: { target_user_id: user_id, is_active }
    });

    return new Response(
      JSON.stringify({ success: true, is_active }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
