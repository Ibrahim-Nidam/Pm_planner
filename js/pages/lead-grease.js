import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { renderTopBar, showToast, confirmAction } from '../ui.js';
import { formatDateDDMMYYYY } from '../time.js';

const today = () => new Date().toISOString().slice(0, 10);
const escapeAttribute = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const formatTourCount = value => Number(value || 0).toLocaleString('en-US');
const formatDate = value => formatDateDDMMYYYY(value);

async function init() {
  const guard = await requireRole('team_lead');
  if (!guard) return;
  renderTopBar(document.getElementById('top-bar'), guard.profile, 'Grease Tracking');
  await renderPage(guard.profile);
}

function rotationState(row) {
  const baseline = Number(row?.grease_counter || 0);
  const current = Number(row?.current_tour_count || baseline);
  const delta = Math.max(0, current - baseline);
  if (delta >= 100000) return { label: 'Grease required', className: 'grease-status grease-status--due' };
  if (delta >= 75000) return { label: `${100000 - delta} tours remaining`, className: 'grease-status grease-status--soon' };
  return { label: `${delta.toLocaleString()} / 100,000 tours`, className: 'grease-status grease-status--ok' };
}

async function renderPage(profile) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="p-8 text-center text-slate-500">Loading grease records...</div>';
  const [{ data: machines, error: machineError }, { data: rotation, error: rotationError }, { data: xray, error: xrayError }, historyResult] = await Promise.all([
    supabase.from('machines').select('id, code, line').eq('is_active', true).order('sort_order'),
    supabase.from('machine_rotation_grease').select('*'),
    supabase.from('xray_generator_grease').select('*').order('performed_on', { ascending: false }).order('updated_at', { ascending: false }),
    // Non-fatal: the history table only exists once migration 023 is applied.
    supabase.from('rotation_grease_history').select('*').order('recorded_at', { ascending: false })
  ]);
  const firstError = machineError || rotationError || xrayError;
  if (firstError) {
    app.innerHTML = `<div class="p-6 bg-white rounded-2xl text-rose-600 font-semibold">${firstError.message}</div>`;
    return;
  }
  const greaseHistory = historyResult.data || [];

  const rotationMap = new Map((rotation || []).map(row => [row.machine_id, row]));
  // Last "greased at tour N" events per machine (newest first).
  const historyMap = new Map();
  (greaseHistory || []).forEach(row => {
    if (!historyMap.has(row.machine_id)) historyMap.set(row.machine_id, []);
    historyMap.get(row.machine_id).push(row);
  });
  const xrayMap = new Map();
  (xray || []).forEach(row => {
    if (!xrayMap.has(row.machine_id)) xrayMap.set(row.machine_id, []);
    xrayMap.get(row.machine_id).push(row);
  });

  const machineCards = (machines || []).map(machine => {
    const rotationRow = rotationMap.get(machine.id);
    const state = rotationState(rotationRow);
    const history = xrayMap.get(machine.id) || [];
    const latest = history[0];
    const due = latest?.next_due_on ? new Date(`${latest.next_due_on}T00:00:00`) : null;
    const days = due ? Math.ceil((due - new Date(`${today()}T00:00:00`)) / 86400000) : null;
    const isOverdue = Boolean(latest?.next_due_on && latest.next_due_on <= today());
    const xrayClass = !latest
      ? 'grease-section grease-section--muted'
      : isOverdue
        ? 'grease-section grease-section--due'
        : (days !== null && days <= 3)
          ? 'grease-section grease-section--soon'
          : 'grease-section grease-section--ok';
    const xrayStatusLabel = !latest
      ? 'Not recorded'
      : isOverdue
        ? `Overdue (${formatDateDDMMYYYY(latest.next_due_on)})`
        : `Next ${formatDateDDMMYYYY(latest.next_due_on)}`;
    const xrayStatusColor = !latest
      ? 'text-slate-600'
      : isOverdue
        ? 'text-rose-700 font-bold'
        : (days !== null && days <= 3)
          ? 'text-amber-700 font-bold'
          : 'text-slate-600';
    // history is ordered newest-first; for each entry show previous_session → this_session
    const historyHtml = history.length
      ? history.map((row, i) => {
          const prev = history[i + 1];
          const fromLabel = prev ? formatDateDDMMYYYY(prev.performed_on) : '—';
          const toLabel = formatDateDDMMYYYY(row.performed_on);
          return `<li class="flex items-center justify-between gap-2 border-t border-slate-200/70 py-1.5 text-[10px]"><span>${fromLabel} → ${toLabel}</span><button data-clear-xray="${row.id}" class="clear-xray-btn text-rose-700 font-bold hover:underline">Clear</button></li>`;
        }).join('')
      : '<li class="text-[10px] text-slate-500">No session history yet.</li>';

    return `<article class="grease-card">
      <div class="grease-card__header"><div><p class="eyebrow">Machine</p><h3 class="text-lg font-bold text-slate-900 mt-1">${machine.code}</h3><p class="text-xs text-slate-500 mt-1">${machine.line || 'No line assigned'}</p></div><span class="${state.className}">${state.label}</span></div>
      <div class="grease-section grease-section--rotation">
        <div class="flex items-center justify-between gap-2"><div><p class="eyebrow">Tour-based</p><h4 class="font-semibold text-slate-900 mt-1">Rotation grease</h4></div><span class="text-xs text-slate-500">Next: ${formatTourCount(Number(rotationRow?.grease_counter || 0) + 100000)} tours</span></div>
        <div class="grid grid-cols-2 gap-4 mt-4 text-xs">
          <label class="text-slate-500">Last greased at<input aria-label="Last greased count" data-rotation-id="${machine.id}" type="text" inputmode="numeric" value="${formatTourCount(rotationRow?.grease_counter)}" class="rotation-input mt-2 w-full p-3 bg-white rounded-lg text-sm text-slate-900"></label>
          <div class="text-slate-500">Current tour count<strong class="block mt-2 text-base text-slate-900">${Number(rotationRow?.current_tour_count ?? 0).toLocaleString()}</strong></div>
        </div>
        <button data-save-rotation="${machine.id}" class="save-rotation-btn mt-4 px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold">Save baseline</button>
        ${(() => {
          const history = (historyMap.get(machine.id) || []).slice(0, 2);
          return `<details class="mt-4"><summary class="cursor-pointer text-xs font-semibold text-slate-600">Last ${history.length} grease record${history.length !== 1 ? 's' : ''}</summary><ul class="mt-2">${history.length ? history.map(row => `
            <li class="flex items-center justify-between gap-2 border-t border-slate-200/70 py-1.5 text-[10px]"><span>Greased at <strong>${formatTourCount(row.greased_at_tour)} tours</strong></span><span class="text-slate-500">${formatDateDDMMYYYY(row.recorded_at)}</span></li>
          `).join('') : '<li class="text-[10px] text-slate-500">No grease history recorded yet.</li>'}</ul></details>`;
        })()}
      </div>
      <div class="p-4 ${xrayClass}">
        <div class="flex items-center justify-between gap-2"><div><p class="eyebrow">Calendar-based</p><h4 class="font-semibold text-slate-900 mt-1">X-ray connector</h4></div><span class="text-xs font-semibold ${xrayStatusColor}">${xrayStatusLabel}</span></div>
        <div class="grid grid-cols-2 gap-4 mt-4 text-xs"><div class="text-slate-500">Last completed<strong class="block mt-2 text-base text-slate-900">${latest ? formatDate(latest.performed_on) : '—'}</strong></div><label class="text-slate-500">Completed on<input aria-label="X-ray grease date" data-xray-machine="${machine.id}" type="date" value="${today()}" class="xray-date mt-2 w-full p-3 bg-white rounded-lg text-sm text-slate-900"></label></div>
        <button data-save-xray="${machine.id}" class="save-xray-btn mt-4 px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold">Save session</button>
        <details class="mt-4"><summary class="cursor-pointer text-xs font-semibold text-slate-600">Last ${history.length} session${history.length !== 1 ? 's' : ''}</summary><ul class="mt-2">${historyHtml}</ul></details>
      </div>
    </article>`;
  }).join('');

  app.innerHTML = `<div class="space-y-4">
    <section class="grease-page-header"><div><p class="eyebrow">Maintenance overview</p><h2 class="text-2xl font-bold text-slate-900 mt-1">Grease tracking</h2><p class="text-sm text-slate-500 mt-2">Two simple checks per machine: rotation grease follows tours, and the X-ray connector is due every three months.</p></div>
      <div class="grease-legend"><span><i class="grease-dot grease-dot--ok"></i>On track</span><span><i class="grease-dot grease-dot--soon"></i>Due soon</span><span><i class="grease-dot grease-dot--due"></i>Action needed</span></div>
    </section>
    <section class="grid grid-cols-1 lg:grid-cols-2 gap-4">${machineCards || '<p class="text-sm text-slate-500">No active machines.</p>'}</section>
  </div>`;

  app.querySelectorAll('.save-rotation-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const input = app.querySelector(`[data-rotation-id="${button.dataset.saveRotation}"]`);
      const value = Number(input.value.replace(/,/g, ''));
      if (!Number.isSafeInteger(value) || value < 0) return showToast('Enter a non-negative whole number', 'error');
      const { error } = await supabase.rpc('admin_set_rotation_grease', { p_machine_id: button.dataset.saveRotation, p_grease_counter: value });
      if (error) showToast(error.message, 'error');
      else { showToast('Rotation grease baseline saved', 'success'); await renderPage(profile); }
    });
  });
  app.querySelectorAll('.save-xray-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const date = app.querySelector(`[data-xray-machine="${button.dataset.saveXray}"]`).value;
      if (!date) return showToast('Select the grease date', 'error');
      const { error } = await supabase.rpc('save_xray_generator_grease', { p_machine_id: button.dataset.saveXray, p_connector: 'X-ray generator connector', p_performed_on: date });
      if (error) showToast(error.message, 'error');
      else {
        showToast('X-ray grease session saved', 'success');
        renderTopBar(document.getElementById('top-bar'), profile, 'Grease Tracking');
        await renderPage(profile);
      }
    });
  });
  app.querySelectorAll('.clear-xray-btn').forEach(button => {
    button.addEventListener('click', async () => {
      if (!await confirmAction('Clear this X-ray generator grease record?', { title: 'Clear grease record', confirmLabel: 'Clear', danger: true })) return;
      const { error } = await supabase.rpc('clear_xray_generator_grease', { p_id: button.dataset.clearXray });
      if (error) showToast(error.message, 'error');
      else {
        showToast('Grease record cleared', 'success');
        renderTopBar(document.getElementById('top-bar'), profile, 'Grease Tracking');
        await renderPage(profile);
      }
    });
  });
}

init();
