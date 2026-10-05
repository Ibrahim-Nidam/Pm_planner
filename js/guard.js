// Page authentication & role guard (SPECS §7)
import { getCurrentSession, getProfile, logout } from './auth.js';

export async function requireRole(allowedRole = 'any') {
  const isSubFolder = window.location.pathname.includes('/lead/') || window.location.pathname.includes('/tech/');
  const rootPath = isSubFolder ? '../' : './';

  const session = await getCurrentSession();

  if (!session) {
    await logout(true);
    return null;
  }

  let profile = null;
  try {
    profile = await getProfile(session.user.id);
  } catch (err) {
    console.error('Error fetching profile:', err);
    await logout(true, 'Failed to fetch user profile');
    return null;
  }

  if (!profile || !profile.is_active) {
    await logout(true, 'Account disabled or inactive. Contact your team lead.');
    return null;
  }

  if (allowedRole === 'team_lead' && profile.role !== 'team_lead') {
    if (!window.location.pathname.includes('tech/dashboard.html')) {
      window.location.href = rootPath + 'tech/dashboard.html';
    }
    return null;
  }

  if (allowedRole === 'technician' && profile.role !== 'technician') {
    if (!window.location.pathname.includes('lead/schedule.html')) {
      window.location.href = rootPath + 'lead/schedule.html';
    }
    return null;
  }

  return { session, profile };
}
