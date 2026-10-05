// Lead Schedule Matrix Controller (SPECS §10.5, §8)
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { formatDateDDMMYYYY, formatTime24h, formatDurationMinutes } from '../time.js';
import { renderTopBar, renderStatusBadge, renderMonthSelector, showToast } from '../ui.js';
import { generateSchedule, nightsFromCycle, getCycleShiftForDate, toleranceDate } from '../scheduler.js';

let currentMonthStr = '2026-10-01'; // default to acceptance test month
let activeWarnings = [];

async function init() {
  const guard = await requireRole('team_lead');
  if (!guard) return;
  const { profile } = guard;

  renderTopBar(document.getElementById('top-bar'), profile, "Fleet PM Schedule");

  await renderPage(profile);
}

async function renderPage(profile) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="p-8 text-center text-slate-500 font-medium">Loading schedule matrix...</div>`;

  // Fetch Month status
  let { data: monthRow } = await supabase
    .from('schedule_months')
    .select('*')
    .eq('month', currentMonthStr)
    .maybeSingle();

  // Fetch machines in sort_order
  const { data: machines } = await supabase
    .from('machines')
    .select('*, profiles(id, full_name, username)')
    .order('sort_order');

  // Fetch technicians
  const { data: technicians } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'technician')
    .order('full_name');

  // Fetch tasks
  let tasks = [];
  if (monthRow) {
    const { data: taskRows } = await supabase
      .from('pm_tasks')
      .select('*, machines(*), profiles(*)')
      .eq('month_id', monthRow.id);
    if (taskRows) tasks = taskRows;
  }

  // Fetch shifts for roster grid B
  const [year, month] = currentMonthStr.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDate = `${currentMonthStr}`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const { data: shiftRows } = await supabase
    .from('shifts')
    .select('*')
    .gte('shift_date', startDate)
    .lte('shift_date', endDate);

  const status = monthRow ? monthRow.status : 'draft';

  // Build Warnings HTML
  let warningsHtml = '';
  if (activeWarnings.length > 0) {
    warningsHtml = `
      <div id="warnings-panel" class="bg-amber-50 text-amber-900 p-4 rounded-2xl text-xs font-medium space-y-1">
        <span class="font-bold text-sm block">Schedule Warnings (${activeWarnings.length})</span>
        <ul class="list-disc list-inside space-y-0.5">
          ${activeWarnings.map(w => `<li>${w}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Build Header Controls
  const headerHtml = `
    <div class="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm no-print">
      <div class="flex items-center gap-3">
        <div id="month-selector"></div>
        ${renderStatusBadge(status)}
      </div>

      <div class="flex items-center gap-2">
        <button id="generate-btn" ${status === 'approved' ? 'disabled' : ''} class="px-4 py-2 bg-slate-900 text-white font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 transition-all">
          Generate Schedule
        </button>
        <button id="approve-btn" ${status === 'approved' || !monthRow || tasks.length === 0 ? 'disabled' : ''} class="px-4 py-2 bg-emerald-700 text-white font-semibold text-xs sm:text-sm rounded-xl hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 transition-all">
          Approve
        </button>
        <button id="print-btn" class="px-4 py-2 bg-slate-100 text-slate-700 font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-200 transition-all">
          Print
        </button>
      </div>
    </div>
  `;

  // Grid Headers (Days 1 to 31)
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let dayHeaderCells = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    dayHeaderCells += `
      <th class="p-2 text-center text-slate-500 font-bold border-r border-slate-100 text-xs min-w-[36px]">
        <div>${d}</div>
        <div class="text-[9px] font-medium text-slate-400">${weekdays[dayOfWeek]}</div>
      </th>
    `;
  }

  // Grid A Rows: Machines x Days
  let gridARowsHtml = (machines || []).map(m => {
    let dayCells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const task = tasks.find(t => t.machine_id === m.id && t.scheduled_date === dayStr);

      if (task) {
        let badgeBg = 'bg-slate-900 text-white';
        if (task.status === 'in_progress') badgeBg = 'bg-amber-500 text-white';
        if (task.status === 'completed') badgeBg = 'bg-emerald-600 text-white';

        dayCells += `
          <td class="p-1 border-r border-slate-100 text-center">
            <button data-task-id="${task.id}" class="pm-task-cell w-full py-1.5 px-1 rounded font-bold text-[10px] ${badgeBg} hover:scale-105 transition-all truncate">
              ${task.sequence === 2 ? '2P' : 'PM'}
            </button>
          </td>
        `;
      } else {
        dayCells += `<td class="p-1 border-r border-slate-100 text-center"></td>`;
      }
    }

    const techName = m.profiles?.full_name || 'Unassigned';

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50">
        <td class="sticky-col-1 p-3 font-bold text-xs text-slate-900 border-r border-slate-100 min-w-[100px]">${m.code}</td>
        <td class="sticky-col-2 p-3 text-xs text-slate-600 border-r border-slate-100 min-w-[140px]">
          <div class="font-medium text-slate-900">${techName}</div>
          <div class="text-[10px] text-slate-400">${m.line || ''} &bull; ${m.pm_per_month} PM/mo</div>
        </td>
        ${dayCells}
      </tr>
    `;
  }).join('');

  // Grid B Rows: Technicians x Shift Days
  let gridBRowsHtml = (technicians || []).map(t => {
    let dayCells = '';
    const techShifts = (shiftRows || []).filter(s => s.technician_id === t.id);

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const stored = techShifts.find(s => s.shift_date === dayStr);

      let shiftType = 'rest';
      if (stored) shiftType = stored.shift_type;
      else shiftType = getCycleShiftForDate(t, dayStr);

      let textClr = 'text-slate-400';
      if (shiftType === 'night') textClr = 'font-bold text-indigo-700 bg-indigo-50';
      if (shiftType === 'day') textClr = 'font-bold text-amber-700 bg-amber-50';

      dayCells += `
        <td class="p-1 border-r border-slate-100 text-center text-xs ${textClr}">
          ${shiftType[0].toUpperCase()}
        </td>
      `;
    }

    return `
      <tr class="border-b border-slate-100">
        <td class="sticky-col-1 p-3 font-bold text-xs text-slate-900 border-r border-slate-100" colspan="2">${t.full_name}</td>
        ${dayCells}
      </tr>
    `;
  }).join('');

  app.innerHTML = `
    ${headerHtml}
    ${warningsHtml}

    <!-- Grid A: PM Schedule -->
    <div class="bg-white rounded-2xl shadow-sm overflow-hidden space-y-2">
      <div class="p-4 border-b border-slate-100 font-bold text-sm text-slate-900">Grid A — PM Schedule Matrix</div>
      <div class="grid-container">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-100">
              <th class="sticky-corner p-3 text-xs font-bold text-slate-700 border-r border-slate-100 min-w-[100px]">Machine</th>
              <th class="sticky-header p-3 text-xs font-bold text-slate-700 border-r border-slate-100 min-w-[140px]">Technician</th>
              ${dayHeaderCells}
            </tr>
          </thead>
          <tbody>
            ${gridARowsHtml}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Grid B: Technician Shift Roster -->
    <div class="bg-white rounded-2xl shadow-sm overflow-hidden space-y-2 no-print">
      <div class="p-4 border-b border-slate-100 font-bold text-sm text-slate-900">Grid B — Monthly Shift Roster (D=Day, N=Night, R=Rest)</div>
      <div class="grid-container">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-100">
              <th class="sticky-corner p-3 text-xs font-bold text-slate-700 border-r border-slate-100" colspan="2">Technician</th>
              ${dayHeaderCells}
            </tr>
          </thead>
          <tbody>
            ${gridBRowsHtml}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Slide-over Drawer Backdrop -->
    <div id="drawer-backdrop" class="fixed inset-0 bg-slate-900/40 z-50 hidden transition-opacity">
      <div id="drawer-panel" class="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white p-6 shadow-2xl overflow-y-auto space-y-6"></div>
    </div>
  `;

  // Attach Month Selector
  renderMonthSelector(document.getElementById('month-selector'), currentMonthStr, (newMonth) => {
    currentMonthStr = newMonth;
    activeWarnings = [];
    renderPage(profile);
  });

  // Generate Button Handler
  document.getElementById('generate-btn').addEventListener('click', async () => {
    if (status === 'approved') return;
    if (!confirm('Generate monthly PM schedule? Existing un-started tasks for this month will be replaced.')) return;

    try {
      showToast("Generating schedule...", "info");

      // Ensure month record exists
      if (!monthRow) {
        const { data: newMonthRow, error: monthErr } = await supabase
          .from('schedule_months')
          .insert({ month: currentMonthStr, status: 'draft' })
          .select()
          .single();
        if (monthErr) throw monthErr;
        monthRow = newMonthRow;
      }

      // Fetch active machines
      const { data: activeMachines } = await supabase
        .from('machines')
        .select('*')
        .eq('is_active', true);

      // Fetch all technician profiles
      const { data: techProfiles } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'technician')
        .eq('is_active', true);

      // Build nightsByTech
      const nightsByTech = {};
      for (const t of techProfiles) {
        // Check stored shifts
        const { data: tShifts } = await supabase
          .from('shifts')
          .select('shift_date')
          .eq('technician_id', t.id)
          .eq('shift_type', 'night')
          .gte('shift_date', startDate)
          .lte('shift_date', endDate);

      // Derive previous month string (e.g. 2026-10-01 -> 2026-09-01)
      const [yearNum, monthNum] = currentMonthStr.split('-').map(Number);
      let prevYr = yearNum;
      let prevMo = monthNum - 1;
      if (prevMo < 1) { prevMo = 12; prevYr -= 1; }
      const prevMonthStr = `${prevYr}-${String(prevMo).padStart(2, '0')}-01`;

      // Fetch previous month PM tasks for cross-month gap checking
      const previousPmDates = {};
      const { data: prevMonthRow } = await supabase
        .from('schedule_months')
        .select('id')
        .eq('month', prevMonthStr)
        .maybeSingle();

      if (prevMonthRow) {
        const { data: prevTasks } = await supabase
          .from('pm_tasks')
          .select('machine_id, scheduled_date')
          .eq('month_id', prevMonthRow.id);

        if (prevTasks) {
          for (const pt of prevTasks) {
            if (!previousPmDates[pt.machine_id] || pt.scheduled_date > previousPmDates[pt.machine_id]) {
              previousPmDates[pt.machine_id] = pt.scheduled_date;
            }
          }
        }
      }

      // Check if generating mid-month (today's date > month start)
      const todayStr = new Date().toISOString().split('T')[0];
      let minDate = null;
      if (todayStr.substring(0, 7) === currentMonthStr.substring(0, 7) && todayStr > currentMonthStr) {
        minDate = todayStr;
      }

      // Run Scheduler
      const { tasks: generatedTasks, warnings } = generateSchedule({
        monthStart: currentMonthStr,
        machines: activeMachines,
        nightsByTech,
        previousPmDates,
        minDate,
        settings: { second_pm_gap_days: '14', second_pm_gap_tolerance_days: '2' }
      });

      activeWarnings = warnings;

      // Delete existing scheduled tasks for draft month
      await supabase.from('pm_tasks').delete().eq('month_id', monthRow.id).eq('status', 'scheduled');

      // Insert new tasks
      const insertRows = generatedTasks.map(gt => ({
        month_id: monthRow.id,
        machine_id: gt.machine_id,
        technician_id: gt.technician_id,
        sequence: gt.sequence,
        scheduled_date: gt.scheduled_date,
        latest_allowed_date: gt.latest_allowed_date,
        status: 'scheduled'
      }));

      if (insertRows.length > 0) {
        const { error: insertErr } = await supabase.from('pm_tasks').insert(insertRows);
        if (insertErr) throw insertErr;
      }

      showToast("Schedule generated successfully!", "success");
      await renderPage(profile);
    } catch (err) {
      showToast(`Generation failed: ${err.message}`, "error");
    }
  });

  // Approve Button Handler
  document.getElementById('approve-btn').addEventListener('click', async () => {
    if (!monthRow || monthRow.status === 'approved') return;
    if (!confirm('Approve PM schedule? Technicians will be able to see their assigned PM tasks immediately.')) return;

    try {
      const { error: appErr } = await supabase
        .from('schedule_months')
        .update({
          status: 'approved',
          approved_by: profile.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', monthRow.id);

      if (appErr) throw appErr;
      showToast("Schedule approved and published!", "success");
      await renderPage(profile);
    } catch (err) {
      showToast(`Approval failed: ${err.message}`, "error");
    }
  });

  // Print Button Handler
  document.getElementById('print-btn').addEventListener('click', () => {
    window.print();
  });

  // Cell Drawer Click Handlers
  document.querySelectorAll('.pm-task-cell').forEach(btn => {
    btn.addEventListener('click', () => {
      const tId = btn.dataset.taskId;
      const taskObj = tasks.find(t => t.id === tId);
      if (taskObj) openDrawer(taskObj, profile, technicians, shiftRows);
    });
  });

  // Table Row & Column Blue Hover Highlight Event Delegation
  document.querySelectorAll('.grid-container table').forEach(table => {
    table.addEventListener('mouseover', (e) => {
      const td = e.target.closest('td, th');
      if (!td) return;
      const colIndex = td.cellIndex;
      const tr = td.closest('tr');

      table.querySelectorAll('.hover-row, .hover-col, .hover-cell').forEach(el => {
        el.classList.remove('hover-row', 'hover-col', 'hover-cell');
      });

      if (tr) tr.classList.add('hover-row');
      if (colIndex !== undefined && colIndex >= 0) {
        table.querySelectorAll(`tr > *:nth-child(${colIndex + 1})`).forEach(cell => cell.classList.add('hover-col'));
      }
      td.classList.add('hover-cell');
    });

    table.addEventListener('mouseleave', () => {
      table.querySelectorAll('.hover-row, .hover-col, .hover-cell').forEach(el => {
        el.classList.remove('hover-row', 'hover-col', 'hover-cell');
      });
    });
  });
}

function openDrawer(task, profile, technicians, shiftRows) {
  const backdrop = document.getElementById('drawer-backdrop');
  const panel = document.getElementById('drawer-panel');

  const tech = technicians.find(t => t.id === task.technician_id);

  // Calculate available night dates for date dropdown (R2, R3)
  const techShifts = (shiftRows || []).filter(s => s.technician_id === task.technician_id);
  const generatedNights = nightsFromCycle(tech, currentMonthStr);
  const availableNights = new Set(generatedNights);
  techShifts.forEach(s => {
    if (s.shift_type === 'night') availableNights.add(s.shift_date);
    else if (s.shift_type === 'day' || s.shift_type === 'rest') availableNights.delete(s.shift_date);
  });

  const sortedNights = Array.from(availableNights).sort();

  panel.innerHTML = `
    <div class="flex items-center justify-between border-b border-slate-100 pb-4">
      <h3 class="font-bold text-lg text-slate-900">${task.machines?.code} ${task.sequence === 2 ? '(2P)' : '(PM)'}</h3>
      <button id="close-drawer" class="text-slate-400 hover:text-slate-900 font-bold text-sm">✕ Close</button>
    </div>

    <div class="space-y-4 text-xs font-medium text-slate-700">
      <div class="bg-slate-50 p-3 rounded-xl space-y-1">
        <span class="text-slate-400 block text-[10px] uppercase font-bold">Assigned Technician</span>
        <span class="font-bold text-sm text-slate-900">${tech?.full_name || 'N/A'}</span>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-50 p-3 rounded-xl">
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Scheduled Date</span>
          <span class="font-bold text-sm text-slate-800">${formatDateDDMMYYYY(task.scheduled_date)}</span>
        </div>
        <div class="bg-slate-50 p-3 rounded-xl">
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Tolerance Date</span>
          <span class="font-bold text-sm text-slate-800">${formatDateDDMMYYYY(task.latest_allowed_date)}</span>
        </div>
      </div>

      <div class="space-y-1">
        <span class="text-slate-400 block text-[10px] uppercase font-bold">Execution Status</span>
        <div>${renderStatusBadge(task.status)}</div>
      </div>

      ${task.notes ? `
        <div class="space-y-1">
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Technician Notes</span>
          <p class="p-3 bg-slate-50 rounded-xl text-slate-800">${task.notes}</p>
        </div>
      ` : ''}

      ${task.status === 'scheduled' ? `
        <div class="border-t border-slate-100 pt-4 space-y-2">
          <label for="change-date-select" class="block text-xs font-bold uppercase text-slate-900">Change Scheduled Date</label>
          <select id="change-date-select" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-medium focus:outline-none">
            ${sortedNights.map(n => `<option value="${n}" ${n === task.scheduled_date ? 'selected' : ''}>${formatDateDDMMYYYY(n)} (${n === task.scheduled_date ? 'Current' : 'Night'})</option>`).join('')}
          </select>
          <button id="save-date-btn" class="w-full py-3 bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm hover:bg-slate-800">
            Update PM Date
          </button>
        </div>
      ` : ''}
    </div>
  `;

  backdrop.classList.remove('hidden');

  document.getElementById('close-drawer').addEventListener('click', () => {
    backdrop.classList.add('hidden');
  });

  const saveDateBtn = document.getElementById('save-date-btn');
  if (saveDateBtn) {
    saveDateBtn.addEventListener('click', async () => {
      const newDate = document.getElementById('change-date-select').value;
      if (newDate === task.scheduled_date) {
        backdrop.classList.add('hidden');
        return;
      }

      try {
        const newTolerance = toleranceDate(newDate, sortedNights);
        const { error: updateErr } = await supabase
          .from('pm_tasks')
          .update({
            scheduled_date: newDate,
            latest_allowed_date: newTolerance,
            updated_at: new Date().toISOString()
          })
          .eq('id', task.id);

        if (updateErr) throw updateErr;
        showToast("PM date updated", "success");
        backdrop.classList.add('hidden');
        await renderPage(profile);
      } catch (err) {
        showToast(`Failed to update date: ${err.message}`, "error");
      }
    });
  }
}

init();
