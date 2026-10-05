// Technician Dashboard Controller (SPECS §10.3)
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { fetchServerContext, initServerTimeSync, formatDateDDMMYYYY } from '../time.js';
import { renderTopBar, renderMustChangePasswordBanner, renderStatusBadge, renderMonthSelector } from '../ui.js';
import { nightsFromCycle } from '../scheduler.js';

let currentMonthStr = new Date().toISOString().slice(0, 7) + '-01';

async function init() {
  const guard = await requireRole('technician');
  if (!guard) return;
  const { profile } = guard;

  initServerTimeSync();
  const serverCtx = await fetchServerContext();

  renderTopBar(document.getElementById('top-bar'), profile, "Technician Dashboard");

  await renderDashboard(profile, serverCtx);
}

async function renderDashboard(profile, serverCtx) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="p-8 text-center text-slate-500 font-medium">Loading schedule...</div>`;

  // Fetch month status
  const { data: monthRow } = await supabase
    .from('schedule_months')
    .select('*')
    .eq('month', currentMonthStr)
    .maybeSingle();

  const isApproved = monthRow && monthRow.status === 'approved';

  // Fetch shifts for technician in current month
  const { data: storedShifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('technician_id', profile.id)
    .gte('shift_date', currentMonthStr);

  // Fallback to cycle if shifts table row missing
  const generatedNights = new Set(nightsFromCycle(profile, currentMonthStr));

  // Fetch PM tasks for technician if approved
  let tasks = [];
  if (isApproved && monthRow) {
    const { data: taskRows } = await supabase
      .from('pm_tasks')
      .select('*, machines(code, line)')
      .eq('month_id', monthRow.id)
      .eq('technician_id', profile.id)
      .order('scheduled_date');
    if (taskRows) tasks = taskRows;
  }

  // Find PM due tonight
  const tonightNightDate = serverCtx.night_date;
  const tonightTask = tasks.find(t => t.scheduled_date === tonightNightDate || (t.latest_allowed_date === tonightNightDate && t.status === 'scheduled'));

  // Header Banner & Tonight Card
  let bannerHtml = '';
  if (profile.must_change_password) {
    bannerHtml = `<div id="pass-banner"></div>`;
  }

  let tonightCardHtml = `
    <div class="bg-white p-6 rounded-2xl shadow-sm space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Tonight Shift (${formatDateDDMMYYYY(tonightNightDate)})</span>
        ${serverCtx.is_night ? '<span class="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Active Night Window (20:30 - 08:30)</span>' : '<span class="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">Daytime Window</span>'}
      </div>
      ${tonightTask ? `
        <div class="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div>
            <div class="text-xl font-bold text-slate-900 tracking-tight">${tonightTask.machines?.code || 'Machine'} ${tonightTask.sequence === 2 ? '(2P)' : '(PM)'}</div>
            <p class="text-xs text-slate-500 font-medium mt-0.5">Line: ${tonightTask.machines?.line || 'N/A'}</p>
          </div>
          <a href="pm.html?id=${tonightTask.id}" class="px-5 py-3 bg-slate-900 text-white font-semibold text-sm rounded-xl hover:bg-slate-800 transition-all shadow-sm">
            ${tonightTask.status === 'in_progress' ? 'Continue PM' : 'Open PM Page'}
          </a>
        </div>
      ` : `
        <p class="text-sm font-medium text-slate-500 pt-1">No PM scheduled for tonight.</p>
      `}
    </div>
  `;

  // Approval status banner
  let pubStatusHtml = '';
  if (!isApproved) {
    pubStatusHtml = `
      <div class="bg-amber-50 text-amber-900 p-4 rounded-xl text-xs sm:text-sm font-medium">
        Notice: The PM schedule for this month has not been published yet. Your shift calendar is visible below.
      </div>
    `;
  }

  // Month Calendar View (7 Columns: Mon to Sun)
  const [year, month] = currentMonthStr.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sun
  const offset = (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1); // 0 = Mon

  let calendarCells = '';
  for (let i = 0; i < offset; i++) {
    calendarCells += `<div class="bg-slate-50 min-h-[70px] rounded-lg"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Determine shift
    let shiftType = 'rest';
    const stored = (storedShifts || []).find(s => s.shift_date === dayStr);
    if (stored) {
      shiftType = stored.shift_type;
    } else if (generatedNights.has(dayStr)) {
      shiftType = 'night';
    }

    let shiftBg = 'bg-slate-100 text-slate-600';
    if (shiftType === 'night') shiftBg = 'bg-indigo-50 text-indigo-900 font-semibold';
    if (shiftType === 'day') shiftBg = 'bg-amber-50 text-amber-900 font-semibold';

    const dayTasks = tasks.filter(t => t.scheduled_date === dayStr);

    let pmBadges = dayTasks.map(t => `
      <a href="pm.html?id=${t.id}" class="block mt-1 px-1.5 py-1 text-[10px] font-bold rounded bg-slate-900 text-white truncate hover:bg-slate-800">
        ${t.machines?.code} ${t.sequence === 2 ? '2P' : 'PM'}
      </a>
    `).join('');

    calendarCells += `
      <div class="${shiftBg} p-2 rounded-xl min-h-[75px] flex flex-col justify-between transition-all">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold">${day}</span>
          <span class="text-[9px] uppercase tracking-wider opacity-75">${shiftType[0].toUpperCase()}</span>
        </div>
        <div>${pmBadges}</div>
      </div>
    `;
  }

  // PM List View
  let taskListRows = tasks.map(t => {
    const isOverdue = t.status === 'scheduled' && tonightNightDate > t.latest_allowed_date;
    return `
      <a href="pm.html?id=${t.id}" class="block bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-all">
        <div class="flex items-center justify-between">
          <div class="space-y-1">
            <span class="font-bold text-slate-900 text-base">${t.machines?.code} ${t.sequence === 2 ? '(2P)' : '(PM)'}</span>
            <div class="text-xs text-slate-500 font-medium">Scheduled: ${formatDateDDMMYYYY(t.scheduled_date)}</div>
          </div>
          <div class="flex items-center gap-2">
            ${t.postponed ? '<span class="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">Postponed</span>' : ''}
            ${renderStatusBadge(t.status, isOverdue)}
          </div>
        </div>
      </a>
    `;
  }).join('');

  if (tasks.length === 0 && isApproved) {
    taskListRows = `<div class="bg-white p-6 rounded-xl text-center text-sm font-medium text-slate-500">No PM tasks assigned to you this month.</div>`;
  }

  app.innerHTML = `
    ${bannerHtml}
    ${tonightCardHtml}
    ${pubStatusHtml}

    <div class="flex items-center justify-between pt-2">
      <h2 class="text-lg font-bold text-slate-900 tracking-tight">Month Schedule</h2>
      <div id="month-selector-container"></div>
    </div>

    <!-- Calendar Grid -->
    <div class="bg-white p-4 rounded-2xl shadow-sm space-y-2">
      <div class="grid grid-cols-7 gap-1 text-center font-bold text-xs text-slate-400 uppercase tracking-wider pb-2 border-b border-slate-100">
        <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
      </div>
      <div class="grid grid-cols-7 gap-1 sm:gap-2">
        ${calendarCells}
      </div>
    </div>

    <!-- Task List -->
    <div class="space-y-3 pt-2">
      <h3 class="text-base font-bold text-slate-900 tracking-tight">My Assigned PM Tasks (${tasks.length})</h3>
      <div class="space-y-2">${taskListRows}</div>
    </div>
  `;

  if (profile.must_change_password) {
    renderMustChangePasswordBanner(document.getElementById('pass-banner'));
  }

  renderMonthSelector(document.getElementById('month-selector-container'), currentMonthStr, (newMonth) => {
    currentMonthStr = newMonth;
    renderDashboard(profile, serverCtx);
  });
}

init();
