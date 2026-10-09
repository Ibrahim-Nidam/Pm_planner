import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { renderTopBar, showToast, confirmAction } from '../ui.js';

const today = () => new Date().toISOString().slice(0, 10);
const escapeAttribute = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function init() {
  const guard = await requireRole('team_lead');
  if (!guard) return;
  renderTopBar(document.getElementById('top-bar'), guard.profile, 'Grease Tracking');
  await renderPage(guard.profile);
}

async function renderPage(profile) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="p-8 text-center text-slate-500">Loading grease records...</div>';
  const [{ data: machines, error: machineError }, { data: rotation }, { data: xray }] = await Promise.all([
    supabase.from('machines').select('id, code, line').eq('is_active', true).order('sort_order'),
    supabase.from('machine_rotation_grease').select('*'),
    supabase.from('xray_generator_grease').select('*')
  ]);
  if (machineError) {
    app.innerHTML = `<div class="p-6 bg-white rounded-2xl text-rose-600 font-semibold">${machineError.message}</div>`;
    return;
  }

  const rotationMap = new Map((rotation || []).map(row => [row.machine_id, row]));
  const xrayMap = new Map();
  (xray || []).forEach(row => {
    const previous = xrayMap.get(row.machine_id);
    if (!previous || row.performed_on > previous.performed_on) xrayMap.set(row.machine_id, row);
  });
  const rotationRows = (machines || []).map(machine => {
    const row = rotationMap.get(machine.id);
    return `<tr class="border-b border-slate-100">
      <td class="p-3 font-bold">${machine.code}</td><td class="p-3 text-xs text-slate-500">${machine.line || '—'}</td>
      <td class="p-3"><input data-rotation-id="${machine.id}" type="number" min="0" step="1" value="${row?.grease_counter ?? 0}" class="rotation-input w-36 p-2 bg-slate-100 rounded-lg text-sm"></td>
      <td class="p-3 text-xs font-bold ${row && row.current_tour_count - row.grease_counter >= 100000 ? 'text-rose-700' : 'text-emerald-700'}">${row && row.current_tour_count - row.grease_counter >= 100000 ? 'Grease required' : 'On track'}</td>
      <td class="p-3 text-right"><button data-save-rotation="${machine.id}" class="save-rotation-btn px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold">Save</button></td>
    </tr>`;
  }).join('');

  const xrayRows = (machines || []).map(machine => {
    const row = xrayMap.get(machine.id);
    const due = row?.next_due_on ? new Date(`${row.next_due_on}T00:00:00`) : null;
    const days = due ? Math.ceil((due - new Date(`${today()}T00:00:00`)) / 86400000) : null;
    const dueClass = !row ? 'bg-slate-50' : days <= 3 ? 'bg-orange-100' : 'bg-emerald-100';
    return `<tr class="border-b border-slate-100 ${dueClass}">
      <td class="p-3 font-bold">${machine.code}</td><td class="p-3 text-xs">${row?.connector || 'X-ray generator connector'}</td>
      <td class="p-3 text-xs">${row?.performed_on || 'Not recorded'}</td><td class="p-3 text-xs font-bold">${row?.next_due_on || '—'}${days !== null && days <= 3 ? `<span class="block text-orange-800">Reminder: ${Math.max(days, 0)} day(s) remaining</span>` : ''}</td>
      <td class="p-3"><input data-xray-machine="${machine.id}" type="date" value="${row?.performed_on || today()}" class="xray-date p-2 bg-white/70 rounded-lg text-sm"></td>
      <td class="p-3 text-right"><button data-save-xray="${machine.id}" class="save-xray-btn px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold">Save</button>${row ? ` <button data-clear-xray="${row.id}" class="clear-xray-btn px-3 py-2 bg-rose-100 text-rose-800 rounded-lg text-xs font-bold">Clear</button>` : ''}</td>
    </tr>`;
  }).join('');

  app.innerHTML = `
    <section class="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div class="p-5 border-b border-slate-100"><h2 class="font-bold text-lg">Rotation grease</h2><p class="text-xs text-slate-500 mt-1">Enter the last greased tour count. PM tour entries update the current counter; grease is due every 100,000 tours from this baseline.</p></div>
      <div class="overflow-x-auto"><table class="w-full text-left"><thead><tr class="bg-slate-50 text-xs"><th class="p-3">Machine</th><th class="p-3">Line</th><th class="p-3">Last greased tour count</th><th class="p-3">Status</th><th class="p-3"></th></tr></thead><tbody>${rotationRows}</tbody></table></div>
    </section>
    <section class="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div class="p-5 border-b border-slate-100"><h2 class="font-bold text-lg">X-ray generator grease</h2><p class="text-xs text-slate-500 mt-1">A saved session schedules the next workday three months later. Green means on track; orange means due within three days. Records older than five years are removed automatically.</p></div>
      <div class="overflow-x-auto"><table class="w-full text-left"><thead><tr class="bg-slate-50 text-xs"><th class="p-3">Machine</th><th class="p-3">Connector</th><th class="p-3">Last done</th><th class="p-3">Next due</th><th class="p-3">Edit date</th><th class="p-3"></th></tr></thead><tbody>${xrayRows}</tbody></table></div>
    </section>`;

  app.querySelectorAll('.save-rotation-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const input = app.querySelector(`[data-rotation-id="${button.dataset.saveRotation}"]`);
      const value = Number(input.value);
      if (!Number.isSafeInteger(value) || value < 0) return showToast('Enter a non-negative whole number', 'error');
      const { error } = await supabase.rpc('admin_set_rotation_grease', { p_machine_id: button.dataset.saveRotation, p_grease_counter: value });
      if (error) showToast(error.message, 'error'); else { showToast('Rotation grease counter saved', 'success'); await renderPage(profile); }
    });
  });
  app.querySelectorAll('.save-xray-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const date = app.querySelector(`[data-xray-machine="${button.dataset.saveXray}"]`).value;
      const { error } = await supabase.rpc('save_xray_generator_grease', { p_machine_id: button.dataset.saveXray, p_connector: 'X-ray generator connector', p_performed_on: date });
      if (error) showToast(error.message, 'error'); else { showToast('X-ray grease date saved', 'success'); await renderPage(profile); }
    });
  });
  app.querySelectorAll('.clear-xray-btn').forEach(button => {
    button.addEventListener('click', async () => {
      if (!await confirmAction('Clear this X-ray generator grease record?', { title: 'Clear grease record', confirmLabel: 'Clear', danger: true })) return;
      const { error } = await supabase.rpc('clear_xray_generator_grease', { p_id: button.dataset.clearXray });
      if (error) showToast(error.message, 'error'); else { showToast('Grease record cleared', 'success'); await renderPage(profile); }
    });
  });
}

init();
