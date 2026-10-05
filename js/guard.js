// Page authentication & role guard (SPECS §7)
import { getCurrentSession, getProfile, logout } from './auth.js';

export async function requireRole(allowedRole = 'any') {
  const session = await getCurrentSession();
  const rootPath = window.location.pathname.includes('/lead/') || window.location.pathname.includes('/tech/') ? '../' : './';

  if (!session) {
    window.location.href = rootPath + 'index.html';
    return null;
  }

  let profile = null;
  try {
    profile = await getProfile(session.user.id);
  } catch (err) {
    console.error('Error fetching profile:', err);
    await logout();
    return null;
  }

  if (!profile || !profile.is_active) {
    alert('Account disabled or inactive. Contact your team lead.');
    await logout();
    return null;
  }

  if (allowedRole === 'team_lead' && profile.role !== 'team_lead') {
    window.location.href = rootPath + 'tech/dashboard.html';
    return null;
  }

  if (allowedRole === 'technician' && profile.role !== 'technician') {
    window.location.href = rootPath + 'lead/schedule.html';
    return null;
  }

  return { session, profile };
}
