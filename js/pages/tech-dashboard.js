// Technician Dashboard Controller (SPECS §10.3)
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { fetchServerContext, initServerTimeSync, formatDateDDMMYYYY, getServerNow } from '../time.js';
import { renderTopBar, renderMustChangePasswordBanner, renderStatusBadge, renderMonthSelector } from '../ui.js';
import { nightsFromCycle, getCycleShiftForDate } from '../scheduler.js';
import { renderVibrationWidget } from '../vibration-widget.js';

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
  const { data: rosterTechnicians } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'technician')
    .eq('is_active', true)
    .order('full_name');
  const [rosterYear, rosterMonth] = currentMonthStr.split('-').map(Number);
  const rosterDays = new Date(rosterYear, rosterMonth, 0).getDate();
  const { data: allShiftRows } = await supabase
    .from('shifts')
    .select('*')
    .gte('shift_date', currentMonthStr)
    .lte('shift_date', `${rosterYear}-${String(rosterMonth).padStart(2, '0')}-${String(rosterDays).padStart(2, '0')}`);

  // Fallback to cycle if shifts table row missing
  const generatedNights = new Set(nightsFromCycle(profile, currentMonthStr));

  // RLS returns approved tasks assigned to this technician or to their machines.
  // The machine-owner path keeps existing PMs visible immediately after reassignment.
  let tasks = [];
  if (isApproved && monthRow) {
    const { data: taskRows } = await supabase
      .from('pm_tasks')
      .select('*, machines(code, line)')
      .eq('month_id', monthRow.id)
      .order('scheduled_date');
    if (taskRows) tasks = taskRows;
  }

  // The card leads with what comes NEXT, not with what was missed: an overdue
  // PM is surfaced through the calendar (color) and the task list instead, so
  // the technician always sees the upcoming job first.
  const serverNow = getServerNow();
  const todayStr = `${serverNow.getFullYear()}-${String(serverNow.getMonth() + 1).padStart(2, '0')}-${String(serverNow.getDate()).padStart(2, '0')}`;
  const isOverdue = t => t.status === 'scheduled' && t.scheduled_date < todayStr;
  const upcoming = tasks
    .filter(t => t.status === 'scheduled' && t.scheduled_date >= todayStr)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  const nextTask = tasks.find(t => t.status === 'in_progress') || upcoming[0] || null;

  // Header Banner & Tonight Card
  let bannerHtml = '';
  if (profile.must_change_password) {
    bannerHtml = `<div id="pass-banner"></div>`;
  }

  let tonightCardHtml = `
    <div class="bg-white p-6 rounded-2xl shadow-sm space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Next Assigned PM</span>
        ${serverCtx.is_night ? '<span class="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Active Night Window (20:30 - 08:30)</span>' : '<span class="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">Daytime Window</span>'}
      </div>
      ${nextTask ? `
        <div class="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div>
            <div class="text-xl font-bold text-slate-900 tracking-tight">${nextTask.machines?.code || 'Machine'} ${nextTask.sequence === 2 ? '(2P)' : '(PM)'}</div>
            <p class="text-xs text-slate-500 font-medium mt-0.5">Planned: ${formatDateDDMMYYYY(nextTask.scheduled_date)} &bull; Line: ${nextTask.machines?.line || 'N/A'}</p>
          </div>
          <a href="pm.html?id=${nextTask.id}" class="px-5 py-3 bg-slate-900 text-white font-semibold text-sm rounded-xl hover:bg-slate-800 transition-all shadow-sm">
            ${nextTask.status === 'in_progress' ? 'Continue PM' : 'Open PM Page'}
          </a>
        </div>
      ` : `
        <p class="text-sm font-medium text-slate-500 pt-1">No upcoming PM this month.</p>
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
    } else {
      shiftType = getCycleShiftForDate(profile, dayStr);
    }

    let shiftBg = 'bg-slate-100 text-slate-600';
    if (shiftType === 'night') shiftBg = 'bg-indigo-50 text-indigo-900 font-semibold';
    if (shiftType === 'day') shiftBg = 'bg-amber-50 text-amber-900 font-semibold';

    const dayTasks = tasks.filter(t => t.scheduled_date === dayStr);

    // Color is the only signal used here (no extra text): rose = overdue,
    // amber = in progress, emerald = done, dark = still to come. Text and
    // background color live in the same variant string so no two bg-*/text-*
    // utilities ever compete on one element.
    let pmBadges = dayTasks.map(t => {
      let badge = 'bg-slate-900 text-white hover:bg-slate-800';
      if (t.status === 'completed') badge = 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200';
      else if (t.status === 'in_progress') badge = 'bg-amber-400 text-amber-950 hover:bg-amber-500';
      else if (isOverdue(t)) badge = 'bg-rose-500 text-white hover:bg-rose-600';
      return `
        <a href="pm.html?id=${t.id}" class="block mt-1 px-1.5 py-1 text-[10px] font-bold rounded ${badge} truncate">
          ${t.machines?.code} ${t.sequence === 2 ? '2P' : 'PM'}
        </a>
      `;
    }).join('');

    // Days holding a missed PM get a red frame so nothing stands out louder
    // than the date itself — visible at a glance, readable without zooming.
    // Only one ring can win per cell: today > first week > overdue. The frame
    // is used instead of a background tint on purpose: shiftBg already sets a
    // background color and two bg-* utilities on one element have no defined
    // winner, whereas ring-* never conflicts with bg-*.
    const hasOverdueTask = dayTasks.some(isOverdue);

    const isToday = dayStr === todayStr;
    const firstWeekHighlight = day <= 7 && !isToday ? 'ring-2 ring-orange-300' : '';
    const todayHighlight = isToday ? 'ring-2 ring-sky-500 ring-offset-1 shadow-md z-10' : '';
    const overdueFrame = hasOverdueTask && !isToday && !firstWeekHighlight ? 'ring-2 ring-rose-400' : '';
    calendarCells += `
      <div class="${shiftBg} ${overdueFrame} ${todayHighlight} ${firstWeekHighlight} p-2 rounded-xl min-h-[75px] flex flex-col justify-between gap-1 transition-all">
        <div class="flex items-center justify-between gap-1">
          <span class="${isToday ? 'text-xs font-black text-sky-700' : 'text-xs font-bold'}">${day}</span>
          <span class="text-[9px] uppercase tracking-wider opacity-75">${shiftType[0].toUpperCase()}</span>
        </div>
        ${isToday ? '<span class="self-start text-[8px] font-black uppercase tracking-wider bg-sky-600 text-white rounded px-1 py-0.5 leading-none">Today</span>' : ''}
        <div>${pmBadges}</div>
      </div>
    `;
  }

  // PM List View
  let taskListRows = tasks.map(t => {
    return `
      <a href="pm.html?id=${t.id}" class="block bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-all">
        <div class="flex items-center justify-between">
          <div class="space-y-1">
            <span class="font-bold text-slate-900 text-base">${t.machines?.code} ${t.sequence === 2 ? '(2P)' : '(PM)'}</span>
            <div class="text-xs text-slate-500 font-medium">Scheduled: ${formatDateDDMMYYYY(t.scheduled_date)}</div>
          </div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded text-xs font-semibold ${t.source === 'manual' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-700'}">${t.source === 'manual' ? 'Manual' : 'Generated'}</span>
            ${renderStatusBadge(t.status, isOverdue(t))}
          </div>
        </div>
      </a>
    `;
  }).join('');

  if (tasks.length === 0 && isApproved) {
    taskListRows = `<div class="bg-white p-6 rounded-xl text-center text-sm font-medium text-slate-500">No PM tasks assigned to you this month.</div>`;
  }

  const rosterHeader = Array.from({ length: rosterDays }, (_, index) => `<th class="p-1 text-[9px] text-center min-w-[28px]">${index + 1}</th>`).join('');
  const rosterRows = (rosterTechnicians || []).filter(tech => tech.id !== profile.id).map(tech => {
    const cells = Array.from({ length: rosterDays }, (_, index) => {
      const date = `${rosterYear}-${String(rosterMonth).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
      const stored = (allShiftRows || []).find(row => row.technician_id === tech.id && row.shift_date === date);
      const shift = stored?.shift_type || getCycleShiftForDate(tech, date);
      const style = shift === 'night' ? 'bg-indigo-100 text-indigo-800' : shift === 'day' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-400';
      return `<td class="p-0.5 text-center"><span class="inline-block w-5 h-5 leading-5 rounded text-[9px] font-bold ${style}">${shift[0].toUpperCase()}</span></td>`;
    }).join('');
    return `<tr class="border-b border-slate-100"><td class="p-2 text-xs font-bold whitespace-nowrap sticky left-0 bg-white">${tech.full_name}</td>${cells}</tr>`;
  }).join('');

  app.innerHTML = `
    ${bannerHtml}
    ${tonightCardHtml}
    ${pubStatusHtml}

    <div class="flex items-center justify-between pt-2">
      <h2 class="text-lg font-bold text-slate-900 tracking-tight">Month Schedule</h2>
      <div id="month-selector-container"></div>
    </div>

    <div id="vibration-widget"></div>

    <!-- Calendar Grid -->
    <div class="bg-white p-4 rounded-2xl shadow-sm space-y-2">
      <div class="grid grid-cols-7 gap-1 text-center font-bold text-xs text-slate-400 uppercase tracking-wider pb-2 border-b border-slate-100">
        <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
      </div>
      <div class="grid grid-cols-7 gap-1 sm:gap-2">
        ${calendarCells}
      </div>
    </div>

    <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div class="p-4 border-b border-slate-100"><h3 class="text-base font-bold text-slate-900">Technician Monthly Roster & Shift Cycles (Days 1 - ${rosterDays})</h3><p class="text-xs text-slate-500 mt-1">Other technicians only; your shifts are shown in your calendar above.</p></div>
      <div class="overflow-x-auto"><table class="text-left border-collapse"><thead><tr class="bg-slate-50 border-b border-slate-100"><th class="p-2 text-xs min-w-[150px]">Technician</th>${rosterHeader}</tr></thead><tbody>${rosterRows || '<tr><td colspan="32" class="p-4 text-sm text-slate-500">No other active technicians.</td></tr>'}</tbody></table></div>
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
  await renderVibrationWidget(document.getElementById('vibration-widget'), profile, currentMonthStr);
}

init();
