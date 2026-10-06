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
      <div class="top-bar-inner max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
        <div class="top-bar-main flex items-center gap-4 min-w-0">
          <span class="font-bold text-lg text-slate-900 tracking-tight truncate">${title}</span>
          ${leadNav}
        </div>
        <div class="top-bar-user flex items-center gap-3 shrink-0">
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
  const parts = currentMonthStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);

  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;

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

export function openPhotoLightbox(photoUrl, title = "PM Evidence Photo") {
  const existing = document.getElementById('lightbox-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'lightbox-modal';
  modal.className = 'fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-between p-4 sm:p-6 animate-fadeIn';

  modal.innerHTML = `
    <!-- Top Bar -->
    <div class="w-full max-w-5xl flex items-center justify-between text-white py-2">
      <div class="flex items-center gap-3">
        <span class="font-bold text-sm sm:text-base">${title}</span>
        <span class="text-xs text-slate-400 font-medium hidden sm:inline">(Click image to toggle Zoom)</span>
      </div>
      <div class="flex items-center gap-3">
        <a href="${photoUrl}" download="pm-evidence.jpg" target="_blank" rel="noopener noreferrer" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm transition-all flex items-center gap-2 cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Download Photo
        </a>
        <button id="close-lightbox-btn" class="p-2 text-slate-400 hover:text-white font-bold text-lg rounded-lg hover:bg-slate-800 transition-all cursor-pointer" title="Close (Esc)">✕</button>
      </div>
    </div>

    <!-- Center Image Container -->
    <div class="flex-1 w-full max-w-5xl flex items-center justify-center overflow-auto py-4 cursor-zoom-in" id="lightbox-img-wrapper">
      <img id="lightbox-img" src="${photoUrl}" alt="${title}" class="max-h-[80vh] max-w-full object-contain rounded-xl shadow-2xl transition-transform duration-200 select-none">
    </div>

    <!-- Footer Hint -->
    <div class="text-xs text-slate-400 font-medium py-1">
      Press <kbd class="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 font-mono">Esc</kbd> or click outside to close
    </div>
  `;

  document.body.appendChild(modal);

  const img = modal.querySelector('#lightbox-img');
  const imgWrapper = modal.querySelector('#lightbox-img-wrapper');
  let isZoomed = false;

  imgWrapper.addEventListener('click', (e) => {
    if (e.target === img) {
      isZoomed = !isZoomed;
      if (isZoomed) {
        img.classList.remove('max-h-[80vh]', 'max-w-full');
        img.classList.add('scale-150', 'my-auto');
        imgWrapper.classList.remove('cursor-zoom-in');
        imgWrapper.classList.add('cursor-zoom-out');
      } else {
        img.classList.add('max-h-[80vh]', 'max-w-full');
        img.classList.remove('scale-150', 'my-auto');
        imgWrapper.classList.remove('cursor-zoom-out');
        imgWrapper.classList.add('cursor-zoom-in');
      }
    } else {
      modal.remove();
    }
  });

  modal.querySelector('#close-lightbox-btn').addEventListener('click', () => modal.remove());

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handleKeyDown);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
}
