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
    await logout(false);
    throw new Error('Account disabled. Contact your team lead.');
  }
  return { user: data.user, profile };
}

export async function logout(doRedirect = true, reason = '') {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error('Logout error:', e);
  }
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {}

  if (doRedirect) {
    const isSubFolder = window.location.pathname.includes('/lead/') || window.location.pathname.includes('/tech/');
    const rootPath = isSubFolder ? '../' : './';
    const query = reason ? `?error=${encodeURIComponent(reason)}` : '?logout=1';
    window.location.href = rootPath + 'index.html' + query;
  }
}

export async function getCurrentSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return null;
    return session;
  } catch (e) {
    console.error('getCurrentSession error:', e);
    return null;
  }
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
    .maybeSingle();
    
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
