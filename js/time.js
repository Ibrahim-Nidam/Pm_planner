// Server-time helpers & date formatting (SPECS §9, R7)
import { supabase } from './supabase-client.js';

let serverContext = {
  now: new Date().toISOString(),
  night_date: new Date().toISOString().split('T')[0],
  is_night: false,
  timezone: 'Africa/Casablanca',
  night_start: '20:30',
  night_end: '08:30',
  max_photos: 5,
  offsetMs: 0
};

export async function fetchServerContext() {
  try {
    const { data, error } = await supabase.rpc('get_server_context');
    if (!error && data) {
      const serverNow = new Date(data.now).getTime();
      const clientNow = Date.now();
      serverContext = {
        ...data,
        offsetMs: serverNow - clientNow
      };
    }
  } catch (err) {
    console.error('Failed to fetch server context:', err);
  }
  return serverContext;
}

// Start periodic polling every 60 seconds
export function initServerTimeSync() {
  fetchServerContext();
  setInterval(fetchServerContext, 60000);
}

export function getServerContext() {
  return serverContext;
}

export function getServerNow() {
  return new Date(Date.now() + serverContext.offsetMs);
}

export function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    // If string like "YYYY-MM-DD"
    const parts = String(dateStr).split('-');
    if (parts.length === 3) {
      return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
    return dateStr;
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatTime24h(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatDurationMinutes(startedAt, endedAt) {
  if (!startedAt || !endedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const diffMinutes = Math.max(0, Math.round((end - start) / 60000));
  const hrs = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m`;
}
