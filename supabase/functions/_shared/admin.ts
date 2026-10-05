import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const DEFAULT_PASSWORD = Deno.env.get('DEFAULT_PASSWORD') || 'PMPlanner123!';

export function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

export function toEmail(username: string): string {
  return `${username.toLowerCase().trim()}@pm-planner.local`;
}

export async function assertCallerIsActiveLead(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const adminClient = getAdminClient();

  const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !user) {
    throw new Error('Invalid user token');
  }

  const { data: profile, error: profErr } = await adminClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profErr || !profile) {
    throw new Error('User profile not found');
  }

  if (profile.role !== 'team_lead' || !profile.is_active) {
    throw new Error('Forbidden: Active Team Lead role required');
  }

  return { callerUser: user, callerProfile: profile, adminClient };
}
