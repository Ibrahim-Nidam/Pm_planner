// Lead Schedule Matrix Controller (SPECS §10.5, §8)
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { formatDateDDMMYYYY, formatTime24h, formatDurationMinutes } from '../time.js';
import { renderTopBar, renderStatusBadge, renderMonthSelector, showToast, openPhotoLightbox, confirmAction } from '../ui.js';
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

  try {
    // 1. Fetch current month record
    let { data: monthRow } = await supabase
      .from('schedule_months')
      .select('*')
      .eq('month', currentMonthStr)
      .maybeSingle();

    const status = monthRow ? monthRow.status : 'draft';

    // 2. Fetch machines
    const { data: machines } = await supabase
      .from('machines')
      .select('*')
      .order('sort_order', { ascending: true });

    // 3. Fetch technicians
    const { data: technicians } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'technician')
      .order('full_name', { ascending: true });

    // 4. Fetch scheduled tasks for this month
    let tasks = [];
    if (monthRow) {
      const { data: taskRows } = await supabase
        .from('pm_tasks')
        .select('*, machines(*)')
        .eq('month_id', monthRow.id);
      if (taskRows) tasks = taskRows;
    }

    // 5. Fetch shifts for the month
    const [year, monthNum] = currentMonthStr.split('-').map(Number);
    const startDate = currentMonthStr;
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const { data: shiftRows } = await supabase
      .from('shifts')
      .select('*')
      .gte('shift_date', startDate)
      .lte('shift_date', endDate);

    // Build calendar header for Matrix (Scrollable)
    let calendarHeadersHtml = '';
    let rosterHeadersHtml = '';
    const dateHeaders = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dateHeaders.push(dateStr);
      const firstWeekClass = d <= 7 ? 'bg-orange-100 text-orange-900' : '';
      calendarHeadersHtml += `<th class="px-1 py-1.5 text-[11px] font-semibold text-slate-600 text-center min-w-[36px] w-[36px] ${firstWeekClass}" data-date="${dateStr}">${d}</th>`;
      rosterHeadersHtml += `<th class="p-0.5 text-[9px] font-semibold text-slate-600 text-center" data-date="${dateStr}">${d}</th>`;
    }

    // Render Warnings Box if any
    let warningsHtml = '';
    if (activeWarnings.length > 0) {
      warningsHtml = `
        <div class="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-xl text-xs space-y-1 mb-4">
          <span class="font-bold block uppercase tracking-wider text-[10px]">Schedule Generation Warnings (${activeWarnings.length})</span>
          <ul class="list-disc list-inside space-y-0.5">
            ${activeWarnings.map(w => `<li>Machine ${w.machine_code || w.machine_id}: ${w.message}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    // Render PM Schedule Matrix Rows
    let matrixRowsHtml = (machines || []).map(m => {
      const assignedTech = technicians?.find(t => t.id === m.technician_id);
      const machineTasks = tasks.filter(t => t.machine_id === m.id);

      let cellsHtml = dateHeaders.map(dateStr => {
        const matchingTask = machineTasks.find(t => t.scheduled_date === dateStr || (t.latest_allowed_date === dateStr && t.postponed));
        if (matchingTask) {
          const is2P = matchingTask.sequence === 2;
          const label = is2P ? '2P' : 'PM';
          const bg = matchingTask.status === 'completed' ? 'bg-emerald-600 text-white' : matchingTask.status === 'in_progress' ? 'bg-amber-500 text-white' : matchingTask.source === 'manual' ? 'bg-sky-700 text-white' : 'bg-slate-900 text-white';
          return `
            <td class="p-1 text-center align-middle grid-cell min-w-[36px] w-[36px] ${dateStr.slice(-2) <= '07' ? 'bg-orange-50' : ''}" data-row-id="m-${m.id}" data-machine-id="${m.id}" data-date="${dateStr}">
              <button data-task-id="${matchingTask.id}" title="${matchingTask.source === 'manual' ? 'Manual PM' : 'Generated PM'}" class="task-pill w-full h-[20px] text-[9px] font-bold rounded ${bg} shadow-xs hover:opacity-90 cursor-pointer transition-all">
                ${label}
              </button>
            </td>
          `;
        }
        return `
          <td class="p-1 text-center align-middle grid-cell min-w-[36px] w-[36px] ${dateStr.slice(-2) <= '07' ? 'bg-orange-50' : ''} hover:bg-sky-100/60 cursor-pointer group" data-row-id="m-${m.id}" data-machine-id="${m.id}" data-date="${dateStr}" title="Click to manually add PM">
            <span class="text-[9px] font-bold text-slate-300 opacity-0 group-hover:opacity-100">+</span>
          </td>
        `;
      }).join('');

      return `
        <tr class="grid-row" data-row-id="m-${m.id}">
          <td class="px-3 py-1.5 text-xs font-bold text-slate-900 whitespace-nowrap sticky left-0 bg-white z-10 min-w-[80px] w-[80px] border-r border-slate-200">${m.code}</td>
          <td class="px-3 py-1.5 text-xs font-medium text-slate-500 whitespace-nowrap sticky left-[80px] bg-white z-10 min-w-[60px] w-[60px] border-r border-slate-200">${m.line || 'N/A'}</td>
          <td class="px-3 py-1.5 text-xs font-medium text-slate-700 whitespace-nowrap sticky left-[140px] bg-white z-10 min-w-[140px] w-[140px] border-r border-slate-200">${assignedTech ? assignedTech.full_name : '<span class="text-rose-500 italic">Unassigned</span>'}</td>
          ${cellsHtml}
        </tr>
      `;
    }).join('');

    // Render Technician Roster Rows below the matrix (Fits screen 100% NO SCROLL)
    let rosterRowsHtml = (technicians || []).map(t => {
      const techShifts = (shiftRows || []).filter(s => s.technician_id === t.id);

      let shiftCellsHtml = dateHeaders.map(dateStr => {
        const storedShift = techShifts.find(s => s.shift_date === dateStr);
        let shiftType = storedShift ? storedShift.shift_type : getCycleShiftForDate(t, dateStr);

        let badgeHtml = '';
        if (shiftType === 'day') {
          badgeHtml = `<span class="inline-block w-4 h-4 leading-4 text-[9px] font-bold rounded bg-sky-100 text-sky-800 text-center">D</span>`;
        } else if (shiftType === 'night') {
          badgeHtml = `<span class="inline-block w-4 h-4 leading-4 text-[9px] font-bold rounded bg-indigo-900 text-white text-center">N</span>`;
        } else {
          badgeHtml = `<span class="inline-block w-4 h-4 leading-4 text-[9px] font-bold rounded bg-slate-100 text-slate-400 text-center">R</span>`;
        }

        return `<td class="p-0 text-center align-middle grid-cell" data-row-id="t-${t.id}" data-date="${dateStr}">${badgeHtml}</td>`;
      }).join('');

      return `
        <tr class="grid-row" data-row-id="t-${t.id}">
          <td class="px-2 py-1.5 text-xs font-bold text-slate-900 whitespace-nowrap w-[140px] truncate border-r border-slate-200" title="${t.full_name}">${t.full_name}</td>
          ${shiftCellsHtml}
        </tr>
      `;
    }).join('');

    app.innerHTML = `
      <div class="space-y-6 max-w-full">
        <!-- Action Bar -->
        <div class="schedule-action-bar bg-white p-4 rounded-2xl shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <div id="month-selector-container"></div>
            ${renderStatusBadge(status)}
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button id="add-pm-btn" class="px-4 py-2.5 bg-slate-800 text-white font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-700 transition-all shadow-sm cursor-pointer flex items-center gap-1.5">
              <span>+</span> Add PM Task
            </button>
            <button id="generate-btn" ${status === 'approved' ? 'disabled' : ''} class="px-4 py-2.5 bg-slate-900 text-white font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-800 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed shadow-sm cursor-pointer">
              Auto-Generate Matrix
            </button>
            <button id="clear-btn" ${!monthRow || tasks.length === 0 ? 'disabled' : ''} class="px-4 py-2.5 bg-rose-50 text-rose-700 font-semibold text-xs sm:text-sm rounded-xl hover:bg-rose-100 transition-all disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed shadow-sm cursor-pointer">
              Clear Matrix
            </button>
            <button id="approve-btn" ${status === 'approved' || !monthRow ? 'disabled' : ''} class="px-4 py-2.5 bg-emerald-700 text-white font-semibold text-xs sm:text-sm rounded-xl hover:bg-emerald-800 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed shadow-sm cursor-pointer">
              Approve & Publish
            </button>
          </div>
        </div>

        ${warningsHtml}

        <!-- 1. PM Schedule Matrix Table (Scrollable Detailed Matrix) -->
        <div class="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-bold text-slate-900 tracking-tight">Fleet PM Schedule Matrix (Days 1 - ${daysInMonth})</h2>
            <span class="text-xs text-slate-400 font-medium">Click empty cell to manually add PM &bull; Click task pill to view/edit</span>
          </div>

          <div class="grid-container border border-slate-200 rounded-xl overflow-x-auto">
            <table class="schedule-matrix-table min-w-[1650px] border-separate">
              <thead>
                <tr class="bg-slate-50">
                  <th class="px-3 py-2 text-xs font-bold text-slate-700 text-left sticky left-0 bg-slate-50 z-20 min-w-[80px] w-[80px] border-r border-slate-200">Machine</th>
                  <th class="px-3 py-2 text-xs font-bold text-slate-700 text-left sticky left-[80px] bg-slate-50 z-20 min-w-[60px] w-[60px] border-r border-slate-200">Line</th>
                  <th class="px-3 py-2 text-xs font-bold text-slate-700 text-left sticky left-[140px] bg-slate-50 z-20 min-w-[140px] w-[140px] border-r border-slate-200">Technician</th>
                  ${calendarHeadersHtml}
                </tr>
              </thead>
              <tbody>
                ${matrixRowsHtml}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 2. Technician Roster & Shift Cycles Table (No-Scroll Full Month Summary) -->
        <div class="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <h2 class="text-base font-bold text-slate-900 tracking-tight">Technician Monthly Roster & Shift Cycles (Days 1 - ${daysInMonth})</h2>
            <div class="flex items-center gap-3 text-xs font-semibold">
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-sky-200"></span> Day (D)</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-indigo-900"></span> Night (N)</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-slate-200"></span> Rest (R)</span>
            </div>
          </div>

          <div class="schedule-roster-scroll grid-container border border-slate-200 rounded-xl overflow-hidden">
            <table class="schedule-roster-table min-w-[1280px] table-fixed border-separate">
              <thead>
                <tr class="bg-slate-50">
                  <th class="px-2 py-2 text-xs font-bold text-slate-700 text-left w-[140px] border-r border-slate-200">Technician</th>
                  ${rosterHeadersHtml}
                </tr>
              </thead>
              <tbody>
                ${rosterRowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Add Manual PM Modal -->
      <div id="add-pm-modal" class="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
        <div class="bg-white max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 class="font-bold text-lg text-slate-900">Add Manual PM Task</h3>
            <button id="close-add-modal" class="text-slate-400 hover:text-slate-900 font-bold text-sm cursor-pointer">✕</button>
          </div>

          <form id="add-pm-form" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold uppercase text-slate-500 mb-1">Target Machine</label>
              <select id="manual-machine" required class="w-full p-3 bg-slate-100 text-slate-900 rounded-xl text-sm font-medium focus:outline-none">
                ${(machines || []).map(m => `<option value="${m.id}">${m.code} (${m.line || 'Line N/A'})</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold uppercase text-slate-500 mb-1">Assigned Technician</label>
              <select id="manual-tech" required class="w-full p-3 bg-slate-100 text-slate-900 rounded-xl text-sm font-medium focus:outline-none">
                ${(technicians || []).map(t => `<option value="${t.id}">${t.full_name} (@${t.username})</option>`).join('')}
              </select>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold uppercase text-slate-500 mb-1">PM Type</label>
                <select id="manual-sequence" required class="w-full p-3 bg-slate-100 text-slate-900 rounded-xl text-sm font-medium focus:outline-none">
                  <option value="1">Regular PM (1st)</option>
                  <option value="2">Second PM (2P)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold uppercase text-slate-500 mb-1">Scheduled Night</label>
                <select id="manual-date" required class="w-full p-3 bg-slate-100 text-slate-900 rounded-xl text-sm font-medium focus:outline-none">
                  ${dateHeaders.map(d => `<option value="${d}">${formatDateDDMMYYYY(d)}</option>`).join('')}
                </select>
              </div>
            </div>

            <button type="submit" class="w-full py-3.5 bg-slate-900 text-white font-bold rounded-xl text-sm shadow-sm hover:bg-slate-800 cursor-pointer">
              Save PM Task
            </button>
          </form>
        </div>
      </div>

      <!-- Task Details Drawer Panel -->
      <div id="drawer-backdrop" class="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 hidden transition-opacity">
        <div id="drawer-panel" class="fixed right-0 top-0 bottom-0 max-w-md w-full bg-white shadow-2xl p-6 overflow-y-auto space-y-6"></div>
      </div>
    `;

    // Render Month Selector
    renderMonthSelector(document.getElementById('month-selector-container'), currentMonthStr, async (newMonth) => {
      currentMonthStr = newMonth;
      await renderPage(profile);
    });

    // Attach Task Pill Click Handler
    app.querySelectorAll('.task-pill').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const taskObj = tasks.find(t => t.id === taskId);
        if (taskObj) {
          await openDrawer(taskObj, profile, technicians, shiftRows, monthRow);
        }
      });
    });

    // Attach Empty Grid Cell Click Handler to Open Add Modal
    app.querySelectorAll('.grid-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (e.target.classList.contains('task-pill')) return;
        const machineId = cell.dataset.machineId;
        const dateStr = cell.dataset.date;

        if (machineId && dateStr) {
          openAddPmModal(machineId, dateStr, machines, technicians);
        }
      });

      // Hover highlights
      cell.addEventListener('mouseenter', () => {
        const rowId = cell.dataset.rowId;
        const dateStr = cell.dataset.date;
        if (rowId) {
          app.querySelectorAll(`.grid-row[data-row-id="${rowId}"] td`).forEach(td => td.classList.add('hover-row'));
        }
        if (dateStr) {
          app.querySelectorAll(`.grid-cell[data-date="${dateStr}"]`).forEach(c => c.classList.add('hover-col'));
          app.querySelectorAll(`th[data-date="${dateStr}"]`).forEach(th => th.classList.add('hover-col'));
        }
        cell.classList.add('hover-cell');
      });

      cell.addEventListener('mouseleave', () => {
        const rowId = cell.dataset.rowId;
        const dateStr = cell.dataset.date;
        if (rowId) {
          app.querySelectorAll(`.grid-row[data-row-id="${rowId}"] td`).forEach(td => td.classList.remove('hover-row'));
        }
        if (dateStr) {
          app.querySelectorAll(`.grid-cell[data-date="${dateStr}"]`).forEach(c => c.classList.remove('hover-col'));
          app.querySelectorAll(`th[data-date="${dateStr}"]`).forEach(th => th.classList.remove('hover-col'));
        }
        cell.classList.remove('hover-cell');
      });
    });

    // Clear Matrix Handler (uses security definer RPC to bypass RLS)
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!monthRow) return;
        if (!await confirmAction(`Clear all un-started PM tasks for ${currentMonthStr}? The schedule will return to draft state.`, { title: 'Clear schedule', confirmLabel: 'Clear schedule', danger: true })) return;

        try {
          const { data: resetRow, error: clearErr } = await supabase
            .rpc('clear_schedule', { p_month_id: monthRow.id });

          if (clearErr) throw clearErr;

          showToast("Schedule matrix cleared & reset to draft!", "success");
          activeWarnings = [];
          await renderPage(profile);
        } catch (err) {
          showToast(`Clear failed: ${err.message}`, "error");
        }
      });
    }

    // Add PM Button Handler
    const addPmBtn = document.getElementById('add-pm-btn');
    if (addPmBtn) {
      addPmBtn.addEventListener('click', () => {
        openAddPmModal(null, null, machines, technicians);
      });
    }

    // Add PM Form Handler
    const addPmForm = document.getElementById('add-pm-form');
    if (addPmForm) {
      addPmForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const machineId = document.getElementById('manual-machine').value;
        const techId = document.getElementById('manual-tech').value;
        const sequence = parseInt(document.getElementById('manual-sequence').value, 10);
        const schedDate = document.getElementById('manual-date').value;

        try {
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

          // Delete existing task for (month_id, machine_id, sequence) if present
          await supabase
            .from('pm_tasks')
            .delete()
            .eq('month_id', monthRow.id)
            .eq('machine_id', machineId)
            .eq('sequence', sequence);

          // Insert manual task
          const { error: insErr } = await supabase
            .from('pm_tasks')
            .insert({
              month_id: monthRow.id,
              machine_id: machineId,
              technician_id: techId,
              sequence: sequence,
              scheduled_date: schedDate,
              latest_allowed_date: schedDate,
              status: 'scheduled',
              source: 'manual',
              created_by: profile.id
            });

          if (insErr) throw insErr;

          showToast("PM task added successfully!", "success");
          document.getElementById('add-pm-modal').classList.add('hidden');
          await renderPage(profile);
        } catch (err) {
          showToast(`Failed to add PM: ${err.message}`, "error");
        }
      });
    }

    document.getElementById('close-add-modal')?.addEventListener('click', () => {
      document.getElementById('add-pm-modal').classList.add('hidden');
    });

    // Generate Button Handler
    document.getElementById('generate-btn').addEventListener('click', async () => {
      if (status === 'approved') return;
      if (!await confirmAction('Generate the monthly PM schedule? Manual PMs will be preserved and used as fixed entries.', { title: 'Generate schedule', confirmLabel: 'Generate schedule' })) return;

      try {
        showToast("Generating schedule...", "info");

        if (!monthRow) {
          const { data: newMonthRow, error: monthErr } = await supabase
            .from('schedule_months')
            .insert({ month: currentMonthStr, status: 'draft' })
            .select()
            .single();
          if (monthErr) throw monthErr;
          monthRow = newMonthRow;
        }

        const { data: activeMachines } = await supabase
          .from('machines')
          .select('*')
          .eq('is_active', true);

        const { data: techProfiles } = await supabase
          .from('profiles')
          .select('*')
          .eq('role', 'technician')
          .eq('is_active', true);

        const nightsByTech = {};
        for (const t of (techProfiles || [])) {
          const { data: tShifts } = await supabase
            .from('shifts')
            .select('shift_date')
            .eq('technician_id', t.id)
            .eq('shift_type', 'night')
            .gte('shift_date', startDate)
            .lte('shift_date', endDate);

          if (tShifts && tShifts.length > 0) {
            nightsByTech[t.id] = tShifts.map(s => s.shift_date);
          } else {
            nightsByTech[t.id] = nightsFromCycle(t, currentMonthStr);
          }
        }

        const [yearNum, monthNum] = currentMonthStr.split('-').map(Number);
        let prevYr = yearNum;
        let prevMo = monthNum - 1;
        if (prevMo < 1) { prevMo = 12; prevYr -= 1; }
        const prevMonthStr = `${prevYr}-${String(prevMo).padStart(2, '0')}-01`;

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

        const todayStr = new Date().toISOString().split('T')[0];
        let minDate = null;
        if (todayStr.substring(0, 7) === currentMonthStr.substring(0, 7) && todayStr > currentMonthStr) {
          minDate = todayStr;
        }

        const { tasks: generatedTasks, warnings } = generateSchedule({
          monthStart: currentMonthStr,
          machines: activeMachines,
          nightsByTech,
          previousPmDates,
          minDate,
          fixedTasks: tasks.filter(task => task.status === 'scheduled' && task.source === 'manual'),
          settings: { second_pm_gap_days: '14', second_pm_gap_tolerance_days: '2' }
        });

        activeWarnings = warnings;

        await supabase.from('pm_tasks').delete().eq('month_id', monthRow.id).eq('status', 'scheduled').eq('source', 'generated');

        const insertRows = generatedTasks.map(gt => ({
          month_id: monthRow.id,
          machine_id: gt.machine_id,
          technician_id: gt.technician_id,
          sequence: gt.sequence,
          scheduled_date: gt.scheduled_date,
          latest_allowed_date: gt.latest_allowed_date,
          status: 'scheduled',
          source: 'generated',
          created_by: profile.id
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

    // Approve Button Handler (uses security definer RPC to bypass RLS)
    document.getElementById('approve-btn').addEventListener('click', async () => {
      if (!monthRow || monthRow.status === 'approved') return;
      if (!await confirmAction('Approve this PM schedule? Technicians will be able to see their assigned PM tasks immediately.', { title: 'Approve schedule', confirmLabel: 'Approve schedule' })) return;

      try {
        const { data: approved, error: appErr } = await supabase
          .rpc('approve_schedule', { p_month_id: monthRow.id });

        if (appErr) throw appErr;

        showToast("Schedule approved and published!", "success");
        await renderPage(profile);
      } catch (err) {
        showToast(`Approval failed: ${err.message}`, "error");
      }
    });

  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="p-8 text-center text-rose-600 font-bold">Error loading schedule matrix: ${err.message || err}</div>`;
  }
}

function openAddPmModal(machineId, dateStr, machines, technicians) {
  const modal = document.getElementById('add-pm-modal');
  if (!modal) return;

  const machineSelect = document.getElementById('manual-machine');
  const techSelect = document.getElementById('manual-tech');
  const dateSelect = document.getElementById('manual-date');

  if (machineId && machineSelect) machineSelect.value = machineId;
  if (dateStr && dateSelect) dateSelect.value = dateStr;

  if (machineSelect && techSelect) {
    const selectedM = (machines || []).find(m => m.id === machineSelect.value);
    if (selectedM && selectedM.technician_id) {
      techSelect.value = selectedM.technician_id;
    }
  }

  modal.classList.remove('hidden');
}

async function openDrawer(task, profile, technicians, shiftRows, monthRow) {
  const backdrop = document.getElementById('drawer-backdrop');
  const panel = document.getElementById('drawer-panel');

  const tech = technicians.find(t => t.id === task.technician_id);

  // Fetch photos for task
  const { data: photos } = await supabase
    .from('pm_photos')
    .select('*')
    .eq('pm_task_id', task.id);

  const photoUrls = [];
  if (photos && photos.length > 0) {
    for (const photo of photos) {
      const { data: signedData } = await supabase.storage
        .from('pm-photos')
        .createSignedUrl(photo.storage_path, 3600);
      if (signedData?.signedUrl) {
        photoUrls.push({ id: photo.id, url: signedData.signedUrl });
      }
    }
  }

  // Calculate available night dates for date dropdown
  const techShifts = (shiftRows || []).filter(s => s.technician_id === task.technician_id);
  const generatedNights = nightsFromCycle(tech, currentMonthStr);
  const availableNights = new Set(generatedNights);
  techShifts.forEach(s => {
    if (s.shift_type === 'night') availableNights.add(s.shift_date);
    else if (s.shift_type === 'day' || s.shift_type === 'rest') availableNights.delete(s.shift_date);
  });

  const sortedNights = Array.from(availableNights).sort();

  let photosHtml = photoUrls.map((p, idx) => `
    <div class="relative group rounded-xl overflow-hidden bg-slate-100 aspect-square shadow-sm cursor-pointer border border-slate-200 hover:border-slate-400 transition-all">
      <img src="${p.url}" alt="PM Evidence ${idx + 1}" data-photo-url="${p.url}" class="drawer-lightbox-trigger w-full h-full object-cover">
      <div class="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
        <span class="bg-slate-900/90 text-white text-[10px] font-bold px-2 py-1 rounded">Zoom & Download</span>
      </div>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="flex items-center justify-between border-b border-slate-100 pb-4">
      <div>
        <h3 class="font-bold text-lg text-slate-900">${task.machines?.code} ${task.sequence === 2 ? '(2P)' : '(PM)'}</h3>
        <p class="text-xs text-slate-500 font-medium">Line ${task.machines?.line || 'N/A'}</p>
      </div>
      <button id="close-drawer" class="text-slate-400 hover:text-slate-900 font-bold text-sm cursor-pointer">✕ Close</button>
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

      <div class="space-y-1">
        <span class="text-slate-400 block text-[10px] uppercase font-bold">Task Origin</span>
        <span class="inline-flex px-2 py-1 rounded text-xs font-bold ${task.source === 'manual' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-700'}">${task.source === 'manual' ? 'Manual PM' : 'Generated PM'}</span>
        <span class="block text-[11px] text-slate-500">Created by ${task.created_by === profile.id ? profile.full_name : 'another team lead'}</span>
      </div>

      ${task.notes ? `
        <div class="space-y-1">
          <span class="text-slate-400 block text-[10px] uppercase font-bold">Technician Notes</span>
          <p class="p-3 bg-slate-50 rounded-xl text-slate-800 font-normal leading-relaxed">${task.notes}</p>
        </div>
      ` : ''}

      <!-- Evidence Photos Section -->
      <div class="space-y-2 pt-1 border-t border-slate-100">
        <span class="text-slate-400 block text-[10px] uppercase font-bold">Evidence Photos (${photoUrls.length})</span>
        ${photoUrls.length > 0 ? `
          <div class="grid grid-cols-3 gap-2">
            ${photosHtml}
          </div>
        ` : `
          <p class="text-xs text-slate-400 italic">No photos uploaded for this PM.</p>
        `}
      </div>

      <div class="pt-2 border-t border-slate-100 flex items-center gap-2">
        <a href="../tech/pm.html?id=${task.id}" class="flex-1 py-3 bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm hover:bg-slate-800 transition-all flex items-center justify-center gap-2">
          Open Full PM Page &rarr;
        </a>
        ${task.status === 'scheduled' ? `
          <button id="delete-task-btn" class="px-4 py-3 bg-rose-50 text-rose-700 font-bold rounded-xl text-xs hover:bg-rose-100 transition-all cursor-pointer">
            Delete
          </button>
        ` : ''}
      </div>

      ${task.status === 'scheduled' ? `
        <div class="border-t border-slate-100 pt-4 space-y-2">
          <label for="change-date-select" class="block text-xs font-bold uppercase text-slate-900">Change Scheduled Date</label>
          <select id="change-date-select" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-medium focus:outline-none">
            ${sortedNights.map(n => `<option value="${n}" ${n === task.scheduled_date ? 'selected' : ''}>${formatDateDDMMYYYY(n)} (${n === task.scheduled_date ? 'Current' : 'Night'})</option>`).join('')}
          </select>
          <button id="save-date-btn" class="w-full py-3 bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm hover:bg-slate-800 cursor-pointer">
            Update PM Date
          </button>
        </div>
      ` : ''}
    </div>
  `;

  backdrop.classList.remove('hidden');

  // Lightbox click trigger inside drawer
  panel.querySelectorAll('.drawer-lightbox-trigger').forEach(img => {
    img.addEventListener('click', () => {
      const url = img.getAttribute('data-photo-url');
      if (url) openPhotoLightbox(url, `${task.machines?.code || 'PM'} Evidence Photo`);
    });
  });

  document.getElementById('close-drawer').addEventListener('click', () => {
    backdrop.classList.add('hidden');
  });

  // Delete individual task handler
  const delTaskBtn = document.getElementById('delete-task-btn');
  if (delTaskBtn) {
    delTaskBtn.addEventListener('click', async () => {
      if (!await confirmAction(`Delete the PM task for ${task.machines?.code}?`, { title: 'Delete PM task', confirmLabel: 'Delete task', danger: true })) return;

      try {
        const { error: delErr } = await supabase
          .from('pm_tasks')
          .delete()
          .eq('id', task.id);

        if (delErr) throw delErr;
        showToast("PM task deleted", "success");
        backdrop.classList.add('hidden');
        await renderPage(profile);
      } catch (err) {
        showToast(`Delete failed: ${err.message}`, "error");
      }
    });
  }

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
        showToast(`Update failed: ${err.message}`, "error");
      }
    });
  }
}

init();
