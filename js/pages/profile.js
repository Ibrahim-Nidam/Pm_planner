// Profile & Password change controller (SPECS §10.2, §7)
import { requireRole } from '../guard.js';
import { changePassword } from '../auth.js';
import { renderTopBar, showToast } from '../ui.js';
import { t } from '../i18n.js';

async function init() {
  const guard = await requireRole('any');
  if (!guard) return;
  const { profile } = guard;

  renderTopBar(document.getElementById('top-bar'), profile, "User Profile");

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="bg-white rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
      <div class="border-b border-slate-100 pb-4">
        <h2 class="text-xl font-bold text-slate-900 tracking-tight">${profile.full_name}</h2>
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400 mt-1">Role: ${profile.role === 'team_lead' ? 'Team Lead (Admin)' : 'Technician'}</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="bg-slate-50 p-4 rounded-xl">
          <span class="block text-xs font-semibold uppercase text-slate-400 mb-1">${t('username')}</span>
          <span class="font-medium text-slate-800 text-sm">${profile.username}</span>
        </div>
        <div class="bg-slate-50 p-4 rounded-xl">
          <span class="block text-xs font-semibold uppercase text-slate-400 mb-1">Status</span>
          <span class="font-medium text-emerald-700 text-sm">Active Account</span>
        </div>
      </div>

      <div class="space-y-4 pt-4">
        <h3 class="text-base font-bold text-slate-900 tracking-tight">${t('changePassword')}</h3>

        <form id="password-form" class="space-y-4">
          <div>
            <label for="new-pass" class="block text-xs font-semibold uppercase text-slate-500 mb-1">${t('newPassword')}</label>
            <input id="new-pass" type="password" required minlength="8" placeholder="Minimum 8 characters" class="w-full px-4 py-3 bg-slate-100 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm font-medium">
          </div>

          <div>
            <label for="confirm-pass" class="block text-xs font-semibold uppercase text-slate-500 mb-1">${t('confirmPassword')}</label>
            <input id="confirm-pass" type="password" required minlength="8" placeholder="Confirm new password" class="w-full px-4 py-3 bg-slate-100 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm font-medium">
          </div>

          <button id="save-pass-btn" type="submit" class="py-3 px-6 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-all text-sm shadow-sm active:scale-[0.99]">
            ${t('savePassword')}
          </button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('password-form');
  const saveBtn = document.getElementById('save-pass-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPass = document.getElementById('new-pass').value;
    const confirmPass = document.getElementById('confirm-pass').value;

    if (newPass !== confirmPass) {
      showToast("Passwords do not match", "error");
      return;
    }

    if (newPass.length < 8) {
      showToast("Password must be at least 8 characters long", "error");
      return;
    }

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = "Updating...";
      await changePassword(newPass);
      showToast(t('passwordChangedSuccess'), "success");
      document.getElementById('new-pass').value = '';
      document.getElementById('confirm-pass').value = '';
    } catch (err) {
      showToast(err.message || "Failed to update password", "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = t('savePassword');
    }
  });
}

init();
