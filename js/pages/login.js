// Login page controller (SPECS §10.1)
import { login, getCurrentSession, getProfile, logout } from '../auth.js';
import { t } from '../i18n.js';

async function init() {
  const app = document.getElementById('app');
  if (!app) return;

  // Render Login UI immediately so page is never blank
  app.innerHTML = `
    <div class="space-y-6">
      <div class="space-y-2 text-center">
        <h1 class="text-2xl font-bold text-slate-900 tracking-tight">${t('appName')}</h1>
        <p class="text-sm text-slate-500 font-medium">${t('loginTitle')}</p>
      </div>

      <form id="login-form" class="space-y-4">
        <div id="error-message" class="hidden bg-rose-50 text-rose-700 p-3 rounded-lg text-xs sm:text-sm font-medium"></div>

        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1" for="username">${t('username')}</label>
          <input id="username" type="text" autocomplete="username" required placeholder="e.g. lead or technician username" class="w-full px-4 py-3 bg-slate-100 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all font-medium text-sm">
        </div>

        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1" for="password">${t('password')}</label>
          <div class="relative">
            <input id="password" type="password" autocomplete="current-password" required placeholder="••••••••" class="w-full px-4 py-3 pr-10 bg-slate-100 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all font-medium text-sm">
            <button type="button" id="toggle-password-btn" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none p-1 cursor-pointer" title="Show/Hide Password">
              <svg id="eye-icon" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <svg id="eye-off-icon" class="w-5 h-5 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.05 10.05 0 014.122-.863c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21M3 3l18 18" />
              </svg>
            </button>
          </div>
        </div>

        <button id="submit-btn" type="submit" class="w-full py-3.5 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-all text-sm shadow-sm active:scale-[0.99] cursor-pointer">
          ${t('signIn')}
        </button>
      </form>
    </div>
  `;

  // Setup Password Toggle
  const passInput = document.getElementById('password');
  const toggleBtn = document.getElementById('toggle-password-btn');
  const eyeIcon = document.getElementById('eye-icon');
  const eyeOffIcon = document.getElementById('eye-off-icon');

  toggleBtn.addEventListener('click', () => {
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    eyeIcon.classList.toggle('hidden', isPass);
    eyeOffIcon.classList.toggle('hidden', !isPass);
  });

  // Check URL params for error messages
  const urlParams = new URLSearchParams(window.location.search);
  const errorMsg = urlParams.get('error');
  if (errorMsg) {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
      errorDiv.textContent = decodeURIComponent(errorMsg);
      errorDiv.classList.remove('hidden');
    }
  }

  // Check if session exists and is valid
  try {
    const session = await getCurrentSession();
    if (session && !urlParams.has('logout')) {
      const profile = await getProfile(session.user.id);
      if (profile && profile.is_active) {
        if (profile.role === 'team_lead') {
          window.location.href = './lead/schedule.html';
        } else {
          window.location.href = './tech/dashboard.html';
        }
        return;
      } else {
        await logout(false);
      }
    }
  } catch (e) {
    console.error('Session auto-login error:', e);
    localStorage.clear();
  }

  const form = document.getElementById('login-form');
  const submitBtn = document.getElementById('submit-btn');
  const errorDiv = document.getElementById('error-message');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorDiv.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = t('loggingIn');

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
      const { profile } = await login(username, password);
      if (profile.role === 'team_lead') {
        window.location.href = './lead/schedule.html';
      } else {
        window.location.href = './tech/dashboard.html';
      }
    } catch (err) {
      errorDiv.textContent = err.message || 'Login failed. Please check your credentials.';
      errorDiv.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = t('signIn');
    }
  });
}

init();
