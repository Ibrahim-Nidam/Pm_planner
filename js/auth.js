// Authentication module (SPECS §7)
import { supabase } from './supabase-client.js';

export async function login(username, password) {
  const email = `${username.trim().toLowerCase()}@pmplanner.local`;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  
  // Fetch user profile
  const profile = await getProfile(data.user.id);
  if (!profile.is_active) {
    await supabase.auth.signOut();
    throw new Error('Account disabled. Contact your team lead.');
  }
  return { user: data.user, profile };
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Logout error:', error);
  window.location.href = window.location.origin + '/index.html';
}

export async function getCurrentSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return null;
  return session;
}

export async function getProfile(userId = null) {
  let uid = userId;
  if (!uid) {
    const session = await getCurrentSession();
    if (!session) return null;
    uid = session.user.id;
  }
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .single();
    
  if (error) throw error;
  return data;
}

export async function changePassword(newPassword) {
  const { error: updateErr } = await supabase.auth.updateUser({
    password: newPassword
  });
  if (updateErr) throw updateErr;

  const { error: rpcErr } = await supabase.rpc('mark_password_changed');
  if (rpcErr) throw rpcErr;
}
