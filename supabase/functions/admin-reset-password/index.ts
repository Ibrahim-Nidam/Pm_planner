import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, DEFAULT_PASSWORD, assertCallerIsActiveLead } from "../_shared/admin.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { callerProfile, adminClient } = await assertCallerIsActiveLead(req);
    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Reset Auth Password
    const { error: authErr } = await adminClient.auth.admin.updateUserById(user_id, {
      password: DEFAULT_PASSWORD
    });

    if (authErr) throw authErr;

    // Set must_change_password flag
    const { error: profErr } = await adminClient
      .from('profiles')
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq('id', user_id);

    if (profErr) throw profErr;

    // Write audit log
    await adminClient.from('audit_log').insert({
      actor_id: callerProfile.id,
      action: 'user.reset_password',
      details: { target_user_id: user_id }
    });

    return new Response(
      JSON.stringify({ default_password: DEFAULT_PASSWORD }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
