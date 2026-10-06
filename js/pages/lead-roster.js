// Lead Shift Roster Controller (SPECS §10.6, §5)
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { formatDateDDMMYYYY } from '../time.js';
import { renderTopBar, renderMonthSelector, showToast, confirmAction } from '../ui.js';
import { nightsFromCycle, getCycleShiftForDate } from '../scheduler.js';

let currentMonthStr = '2026-10-01';
let activeWarnings = [];

async function init() {
  const guard = await requireRole('team_lead');
  if (!guard) return;
  const { profile } = guard;

  renderTopBar(document.getElementById('top-bar'), profile, "Shift Roster Management");
  await renderPage(profile);
}

async function renderPage(profile) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="p-8 text-center text-slate-500 font-medium">Loading roster grid...</div>`;

  try {

  const [year, month] = currentMonthStr.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDate = `${currentMonthStr}`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // Fetch active technicians
  const { data: technicians } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'technician')
    .eq('is_active', true)
    .order('full_name');

  // Fetch shifts for the month
  const { data: shiftRows } = await supabase
    .from('shifts')
    .select('*')
    .gte('shift_date', startDate)
    .lte('shift_date', endDate);

  // Fetch scheduled PM tasks for warning check
  const { data: monthRow } = await supabase
    .from('schedule_months')
    .select('id')
    .eq('month', currentMonthStr)
    .maybeSingle();

  let pmTasks = [];
  if (monthRow) {
    const { data: tasks } = await supabase
      .from('pm_tasks')
      .select('*, machines(code)')
      .eq('month_id', monthRow.id)
      .eq('status', 'scheduled');
    if (tasks) pmTasks = tasks;
  }

  // Header Controls
  const headerHtml = `
    <div class="roster-action-bar flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm">
      <div class="flex items-center gap-3">
        <div id="month-selector"></div>
        <span class="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
          Tap a cell to cycle: D (Day) &rarr; N (Night) &rarr; R (Rest)
        </span>
      </div>

      <button id="generate-cycle-btn" class="px-4 py-2 bg-slate-900 text-white font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-800 transition-all">
        Fill Missing From Cycle
      </button>
    </div>
  `;

  // Warnings HTML
  let warningsHtml = '';
  if (activeWarnings.length > 0) {
    warningsHtml = `
      <div class="bg-amber-50 text-amber-900 p-4 rounded-2xl text-xs font-medium space-y-1">
        <span class="font-bold text-sm block">Roster Warnings (${activeWarnings.length})</span>
        <ul class="list-disc list-inside space-y-0.5">
          ${activeWarnings.map(w => `<li>${w}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Day headers
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let dayHeaderCells = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    dayHeaderCells += `
      <th class="p-2 text-center text-slate-500 font-bold border-r border-slate-100 text-xs min-w-[38px]">
        <div>${d}</div>
        <div class="text-[9px] font-medium text-slate-400">${weekdays[dayOfWeek]}</div>
      </th>
    `;
  }

  // Build Technician Rows
  let techRowsHtml = (technicians || []).map(tech => {
    let dayCells = '';
    const techShifts = (shiftRows || []).filter(s => s.technician_id === tech.id);

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const stored = techShifts.find(s => s.shift_date === dayStr);

      let shiftType = 'rest';
      if (stored) {
        shiftType = stored.shift_type;
      } else {
        shiftType = getCycleShiftForDate(tech, dayStr);
      }

      let badgeBg = 'bg-slate-100 text-slate-400 hover:bg-slate-200';
      if (shiftType === 'night') badgeBg = 'bg-indigo-100 text-indigo-700 font-bold hover:bg-indigo-200';
      if (shiftType === 'day') badgeBg = 'bg-amber-100 text-amber-800 font-bold hover:bg-amber-200';

      dayCells += `
        <td class="p-1 border-r border-slate-100 text-center">
          <button data-tech-id="${tech.id}" data-date="${dayStr}" data-current="${shiftType}"
                  class="roster-cell w-full py-2 rounded font-bold text-xs ${badgeBg} transition-all cursor-pointer">
            ${shiftType[0].toUpperCase()}
          </button>
        </td>
      `;
    }

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50">
        <td class="sticky-col-1 p-3 font-bold text-xs text-slate-900 border-r border-slate-100 min-w-[160px]">
          <div>${tech.full_name}</div>
          <div class="text-[10px] text-slate-400 font-normal">Anchor: ${tech.cycle_anchor_shift_type || 'night'} (${formatDateDDMMYYYY(tech.cycle_anchor_date || currentMonthStr)})</div>
        </td>
        ${dayCells}
      </tr>
    `;
  }).join('');

  app.innerHTML = `
    ${headerHtml}
    ${warningsHtml}

    <div class="bg-white rounded-2xl shadow-sm overflow-hidden space-y-2">
      <div class="grid-container">
        <table class="roster-table min-w-[1280px] text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-100">
              <th class="sticky-corner p-3 text-xs font-bold text-slate-700 border-r border-slate-100 min-w-[160px]">Technician</th>
              ${dayHeaderCells}
            </tr>
          </thead>
          <tbody>
            ${techRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach Month Selector
  renderMonthSelector(document.getElementById('month-selector'), currentMonthStr, (newMonth) => {
    currentMonthStr = newMonth;
    activeWarnings = [];
    renderPage(profile);
  });

  // Generate from Cycle Handler
  document.getElementById('generate-cycle-btn').addEventListener('click', async () => {
    if (!await confirmAction(`Fill missing shift cells from the 4-day cycle for ${currentMonthStr.substring(0, 7)}? Existing manual roster entries will be kept.`, { title: 'Fill roster from cycle', confirmLabel: 'Fill missing cells' })) return;

    try {
      showToast("Generating roster from cycles...", "info");
      const upsertPayload = [];

      for (const tech of technicians) {
        const nights = nightsFromCycle(tech, currentMonthStr);
        const nightSet = new Set(nights);

        // Derive 4-day cycle for all days in month
        const anchorStr = tech.cycle_anchor_date || currentMonthStr;
        const [aYear, aMonth, aDay] = anchorStr.split('-').map(Number);
        const anchorUtc = Date.UTC(aYear, aMonth - 1, aDay);

        let anchorIndex = tech.cycle_anchor_index ?? 1;
        if (tech.cycle_anchor_index == null) {
          const anchorShift = tech.cycle_anchor_shift_type || 'night';
          if (anchorShift === 'day') anchorIndex = 0;
          else if (anchorShift === 'night') anchorIndex = 1;
          else if (anchorShift === 'rest1' || anchorShift === 'rest') anchorIndex = 2;
          else if (anchorShift === 'rest2') anchorIndex = 3;
        }

        for (let d = 1; d <= daysInMonth; d++) {
          const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const currentUtc = Date.UTC(year, month - 1, d);
          const diffDays = Math.round((currentUtc - anchorUtc) / 86400000);
          
          let cyclePos = (anchorIndex + (diffDays % 4)) % 4;
          if (cyclePos < 0) cyclePos += 4;

          let shiftType = 'rest'; // Index 2 = Rest 1, Index 3 = Rest 2
          if (cyclePos === 0) shiftType = 'day';
          else if (cyclePos === 1) shiftType = 'night';

          const alreadyStored = (shiftRows || []).some(s => s.technician_id === tech.id && s.shift_date === dayStr);
          if (!alreadyStored) {
            upsertPayload.push({
              technician_id: tech.id,
              shift_date: dayStr,
              shift_type: shiftType
            });
          }
        }
      }

      if (upsertPayload.length > 0) {
        const { error: upsertErr } = await supabase.rpc('save_shifts', { p_shifts: upsertPayload });
        if (upsertErr) throw upsertErr;
      }

      showToast("Shift roster updated from cycle!", "success");
      await renderPage(profile);
    } catch (err) {
      showToast(`Failed to generate roster: ${err.message}`, "error");
    }
  });

  // Cell Click Handlers (Cycle Shift Type: day -> night -> rest -> day)
  document.querySelectorAll('.roster-cell').forEach(btn => {
    btn.addEventListener('click', async () => {
      const techId = btn.dataset.techId;
      const dateStr = btn.dataset.date;
      const currentShift = btn.dataset.current;

      const nextShiftMap = {
        'day': 'night',
        'night': 'rest',
        'rest': 'day'
      };
      const nextShift = nextShiftMap[currentShift] || 'night';

      // Check if changing FROM night to day/rest on a date with a scheduled PM
      if (currentShift === 'night' && nextShift !== 'night') {
        const affectedPm = pmTasks.find(t => t.technician_id === techId && t.scheduled_date === dateStr);
        if (affectedPm) {
          const warnMsg = `Night on ${formatDateDDMMYYYY(dateStr)} had a scheduled PM for machine ${affectedPm.machines?.code}. PM will need re-planning in schedule!`;
          showToast(warnMsg, "warning");
          if (!activeWarnings.includes(warnMsg)) {
            activeWarnings.push(warnMsg);
          }
        }
      }

      try {
        const { error: upsertErr } = await supabase.rpc('save_shift', {
          p_technician_id: techId,
          p_shift_date: dateStr,
          p_shift_type: nextShift
        });

        if (upsertErr) throw upsertErr;
        await renderPage(profile);
      } catch (err) {
        showToast(`Failed to update shift: ${err.message}`, "error");
      }
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
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="p-8 text-center text-rose-600 font-bold">Error loading roster grid: ${err.message || err}</div>`;
  }
}

init();
