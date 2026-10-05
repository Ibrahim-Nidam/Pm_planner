// API Layer (SPECS §6, §9, §10)
import { supabase } from './supabase-client.js';

// --- RPC Wrappers ---
export async function getServerContext() {
  const { data, error } = await supabase.rpc('get_server_context');
  if (error) throw error;
  return data;
}

export async function startPm(taskId, reason = null) {
  const { data, error } = await supabase.rpc('start_pm', {
    p_task_id: taskId,
    p_reason: reason
  });
  if (error) throw error;
  return data;
}

export async function savePmNotes(taskId, notes) {
  const { data, error } = await supabase.rpc('save_pm_notes', {
    p_task_id: taskId,
    p_notes: notes
  });
  if (error) throw error;
  return data;
}

export async function endPm(taskId, notes = null) {
  const { data, error } = await supabase.rpc('end_pm', {
    p_task_id: taskId,
    p_notes: notes
  });
  if (error) throw error;
  return data;
}

// --- Machine Queries ---
export async function getMachines() {
  const { data, error } = await supabase
    .from('machines')
    .select('*, profiles(id, full_name, username)')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

export async function upsertMachine(machine) {
  const { data, error } = await supabase
    .from('machines')
    .upsert(machine)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- Technician Queries ---
export async function getTechnicians() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'technician')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- Shift Queries ---
export async function getShiftsForMonth(startDate, endDate) {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .gte('shift_date', startDate)
    .lte('shift_date', endDate);
  if (error) throw error;
  return data;
}

export async function upsertShift(shift) {
  const { data, error } = await supabase
    .from('shifts')
    .upsert(shift, { onConflict: 'technician_id,shift_date' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function upsertShiftsBatch(shiftsArray) {
  const { data, error } = await supabase
    .from('shifts')
    .upsert(shiftsArray, { onConflict: 'technician_id,shift_date' });
  if (error) throw error;
  return data;
}

// --- Edge Functions Invocation ---
export async function callEdgeFunction(functionName, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: payload,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (error) throw error;
  return data;
}

// --- Storage Signed URLs ---
export async function getPhotoSignedUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from('pm-photos')
    .createSignedUrl(storagePath, 3600); // 1 hour TTL
  if (error) throw error;
  return data.signedUrl;
}
