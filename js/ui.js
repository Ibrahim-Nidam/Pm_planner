// Shared UI Components & Helpers (SPECS §10)
import { logout } from './auth.js';

export function renderTopBar(containerEl, profile, title = "PM Planner") {
  if (!containerEl) return;
  const isSubFolder = window.location.pathname.includes('/lead/') || window.location.pathname.includes('/tech/');
  const rootPath = isSubFolder ? '../' : './';
  
  const leadNav = profile.role === 'team_lead' ? `
    <div class="flex items-center gap-1 sm:gap-2 overflow-x-auto py-1">
      <a href="${rootPath}lead/schedule.html" class="px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors ${window.location.pathname.includes('schedule') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">Schedule</a>
      <a href="${rootPath}lead/roster.html" class="px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors ${window.location.pathname.includes('roster') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">Roster</a>
      <a href="${rootPath}lead/machines.html" class="px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors ${window.location.pathname.includes('machines') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">Machines</a>
      <a href="${rootPath}lead/technicians.html" class="px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors ${window.location.pathname.includes('technicians') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">Technicians</a>
    </div>
  ` : '';

  containerEl.innerHTML = `
    <header class="bg-white shadow-sm mb-4 sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-4">
          <span class="font-bold text-lg text-slate-900 tracking-tight">${title}</span>
          ${leadNav}
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs sm:text-sm font-medium text-slate-600">${profile.full_name}</span>
          <a href="${rootPath}profile.html" class="text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 px-2 py-1 bg-slate-100 rounded-md">Profile</a>
          <button id="logout-btn" class="text-xs sm:text-sm font-medium text-rose-600 hover:text-rose-700 px-2 py-1 bg-rose-50 rounded-md cursor-pointer">Sign Out</button>
        </div>
      </div>
    </header>
  `;

  const logoutBtn = containerEl.querySelector('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => logout());
  }
}

export function renderMustChangePasswordBanner(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = `
    <div class="bg-amber-50 text-amber-900 px-4 py-3 rounded-lg mb-4 flex items-center justify-between text-xs sm:text-sm font-medium">
      <span>Security Notice: You are using a temporary password. Please update your password.</span>
      <a href="./profile.html" class="underline hover:text-amber-950 ml-2 whitespace-nowrap">Change Password</a>
    </div>
  `;
}

export function renderStatusBadge(status, isOverdue = false) {
  if (isOverdue) {
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">Overdue</span>`;
  }
  switch (status) {
    case 'scheduled':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">Scheduled</span>`;
    case 'in_progress':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">In Progress</span>`;
    case 'completed':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Completed</span>`;
    case 'draft':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">Draft</span>`;
    case 'approved':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-800">Approved</span>`;
    default:
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">${status}</span>`;
  }
}

export function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full px-4';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  const bgClass = type === 'error' ? 'bg-rose-900 text-white' : type === 'success' ? 'bg-slate-900 text-white' : 'bg-slate-800 text-white';
  toast.className = `${bgClass} p-3 rounded-lg text-xs sm:text-sm font-medium shadow-lg transition-all transform translate-y-2 opacity-0 duration-200`;
  toast.textContent = message;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

export function renderMonthSelector(containerEl, currentMonthStr, onChange) {
  if (!containerEl) return;
  // currentMonthStr format: "YYYY-MM-01"
  const parts = currentMonthStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10); // 1 to 12

  // Previous month
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;

  // Next month
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const nextDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const displayLabel = `${monthNames[month - 1]} ${year}`;

  containerEl.innerHTML = `
    <div class="inline-flex items-center bg-white rounded-lg shadow-sm px-2 py-1 gap-3">
      <button id="prev-month-btn" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md font-bold text-sm cursor-pointer" title="Previous Month">&lt;</button>
      <span class="text-xs sm:text-sm font-semibold text-slate-800 min-w-[120px] text-center">${displayLabel}</span>
      <button id="next-month-btn" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md font-bold text-sm cursor-pointer" title="Next Month">&gt;</button>
    </div>
  `;

  containerEl.querySelector('#prev-month-btn').addEventListener('click', () => onChange(prevDate));
  containerEl.querySelector('#next-month-btn').addEventListener('click', () => onChange(nextDate));
}
