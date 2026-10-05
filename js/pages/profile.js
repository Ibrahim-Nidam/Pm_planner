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

        <form id="password-form" class="space-y-4 max-w-md">
          <div>
            <label for="new-pass" class="block text-xs font-semibold uppercase text-slate-500 mb-1">${t('newPassword')}</label>
            <div class="relative">
              <input id="new-pass" type="password" required minlength="8" placeholder="Minimum 8 characters" class="w-full px-4 py-3 pr-10 bg-slate-100 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm font-medium">
              <button type="button" class="toggle-pass-btn absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none p-1 cursor-pointer" data-target="new-pass">
                <svg class="w-5 h-5 eye-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                <svg class="w-5 h-5 eye-off-icon hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.05 10.05 0 014.122-.863c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21M3 3l18 18" /></svg>
              </button>
            </div>
          </div>

          <div>
            <label for="confirm-pass" class="block text-xs font-semibold uppercase text-slate-500 mb-1">${t('confirmPassword')}</label>
            <div class="relative">
              <input id="confirm-pass" type="password" required minlength="8" placeholder="Confirm new password" class="w-full px-4 py-3 pr-10 bg-slate-100 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm font-medium">
              <button type="button" class="toggle-pass-btn absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none p-1 cursor-pointer" data-target="confirm-pass">
                <svg class="w-5 h-5 eye-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                <svg class="w-5 h-5 eye-off-icon hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.05 10.05 0 014.122-.863c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21M3 3l18 18" /></svg>
              </button>
            </div>
          </div>

          <button id="save-pass-btn" type="submit" class="py-3 px-6 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-all text-sm shadow-sm active:scale-[0.99] cursor-pointer">
            ${t('savePassword')}
          </button>
        </form>
      </div>
    </div>
  `;

  // Attach password toggle listeners
  app.querySelectorAll('.toggle-pass-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const eye = btn.querySelector('.eye-icon');
      const eyeOff = btn.querySelector('.eye-off-icon');
      if (input) {
        const isPass = input.type === 'password';
        input.type = isPass ? 'text' : 'password';
        eye.classList.toggle('hidden', isPass);
        eyeOff.classList.toggle('hidden', !isPass);
      }
    });
  });

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
