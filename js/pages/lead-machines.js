// Lead Machines Controller (SPECS §10.7)
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { renderTopBar, showToast } from '../ui.js';

let allMachines = [];
let allTechnicians = [];
let filterQuery = '';

const locationLabels = {
  'terminal_1': 'Terminal 1',
  'transit': 'Transit'
};

async function init() {
  const guard = await requireRole('team_lead');
  if (!guard) return;
  const { profile } = guard;

  renderTopBar(document.getElementById('top-bar'), profile, "Fleet Machines Management");
  await renderPage(profile);
}

async function renderPage(profile) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="p-8 text-center text-slate-500 font-medium">Loading fleet machines...</div>`;

  // Fetch machines ordered by sort_order
  const { data: machines, error: mErr } = await supabase
    .from('machines')
    .select('*, profiles(id, full_name, username)')
    .order('sort_order', { ascending: true });

  if (mErr) {
    app.innerHTML = `<div class="p-8 text-center text-rose-600 font-bold">Error loading machines: ${mErr.message}</div>`;
    return;
  }
  allMachines = machines || [];

  // Fetch active technicians
  const { data: technicians } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'technician')
    .order('full_name');
  allTechnicians = technicians || [];

  // Filter machines
  const filtered = allMachines.filter(m => {
    const q = filterQuery.toLowerCase();
    const locLabel = locationLabels[m.location] || m.location || '';
    return (
      m.code.toLowerCase().includes(q) ||
      locLabel.toLowerCase().includes(q) ||
      (m.line && m.line.toLowerCase().includes(q)) ||
      (m.profiles?.full_name && m.profiles.full_name.toLowerCase().includes(q))
    );
  });

  // Table rows HTML
  const rowsHtml = filtered.map(m => {
    const techName = m.profiles?.full_name || 'Unassigned';
    const locText = locationLabels[m.location] || m.location || '—';

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all">
        <td class="p-4 font-bold text-sm text-slate-900">${m.code}</td>
        <td class="p-4 text-xs font-medium text-slate-600">${locText}</td>
        <td class="p-4 text-xs font-medium text-slate-600">${m.line || '—'}</td>
        <td class="p-4 text-xs font-bold text-slate-800">${m.pm_per_month} PM/mo</td>
        <td class="p-4 text-xs font-medium text-slate-900">${techName}</td>
        <td class="p-4 text-xs">
          <button data-machine-id="${m.id}" data-active="${m.is_active}" class="toggle-active-btn px-2.5 py-1 rounded-full font-semibold text-[11px] ${m.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'} transition-all">
            ${m.is_active ? 'Active' : 'Inactive'}
          </button>
        </td>
        <td class="p-4 text-xs text-slate-500 max-w-[200px] truncate">${m.notes || '—'}</td>
        <td class="p-4 text-xs text-right">
          <button data-machine-id="${m.id}" class="edit-machine-btn px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl transition-all">
            Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');

  app.innerHTML = `
    <!-- Header Controls -->
    <div class="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm">
      <div class="flex items-center gap-3 w-full sm:w-auto">
        <input id="search-machines" type="text" placeholder="Search machine code, location, tech..." value="${filterQuery}"
               class="px-4 py-2 bg-slate-100 rounded-xl text-xs sm:text-sm font-medium focus:outline-none w-full sm:w-72">
      </div>

      <button id="add-machine-btn" class="px-4 py-2 bg-slate-900 text-white font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-800 transition-all">
        + Add Machine
      </button>
    </div>

    <!-- Machines Table -->
    <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-100">
              <th class="p-4 text-xs font-bold text-slate-700">Code</th>
              <th class="p-4 text-xs font-bold text-slate-700">Location</th>
              <th class="p-4 text-xs font-bold text-slate-700">Line</th>
              <th class="p-4 text-xs font-bold text-slate-700">PM / Month</th>
              <th class="p-4 text-xs font-bold text-slate-700">Assigned Technician</th>
              <th class="p-4 text-xs font-bold text-slate-700">Status</th>
              <th class="p-4 text-xs font-bold text-slate-700">Notes</th>
              <th class="p-4 text-xs font-bold text-slate-700 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml.length > 0 ? rowsHtml : `<tr><td colspan="8" class="p-8 text-center text-slate-400 font-medium">No machines found</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Backdrop -->
    <div id="machine-modal-backdrop" class="fixed inset-0 bg-slate-900/40 z-50 hidden flex items-center justify-center p-4">
      <div class="bg-white w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 id="modal-title" class="font-bold text-lg text-slate-900">Add Machine</h3>
          <button id="close-modal-btn" class="text-slate-400 hover:text-slate-900 font-bold text-sm">✕</button>
        </div>

        <form id="machine-form" class="space-y-4 text-xs font-medium text-slate-700">
          <input type="hidden" id="machine-id" value="">

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Machine Code *</label>
              <input id="machine-code" type="text" required placeholder="e.g. K278" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-semibold focus:outline-none">
            </div>
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Location</label>
              <select id="machine-location" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-medium focus:outline-none">
                <option value="">-- Unassigned --</option>
                <option value="terminal_1">Terminal 1</option>
                <option value="transit">Transit</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Line / Area</label>
              <input id="machine-line" type="text" placeholder="e.g. L1" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-medium focus:outline-none">
            </div>
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">PM Count / Month *</label>
              <select id="machine-pm-count" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-semibold focus:outline-none">
                <option value="1">1 PM / month</option>
                <option value="2">2 PMs / month (2P)</option>
                <option value="0">0 (Disabled)</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Assigned Technician</label>
              <select id="machine-tech-id" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-medium focus:outline-none">
                <option value="">-- Unassigned --</option>
                ${allTechnicians.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Sort Order</label>
              <input id="machine-sort-order" type="number" value="10" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-medium focus:outline-none">
            </div>
          </div>

          <div>
            <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Notes</label>
            <textarea id="machine-notes" rows="2" placeholder="Optional machine notes..." class="w-full p-3 bg-slate-100 rounded-xl text-xs font-medium focus:outline-none"></textarea>
          </div>

          <div class="flex items-center gap-2">
            <input type="checkbox" id="machine-is-active" checked class="w-4 h-4 rounded text-slate-900 focus:ring-0">
            <label for="machine-is-active" class="text-xs font-semibold text-slate-800">Active Machine</label>
          </div>

          <div class="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" id="cancel-modal-btn" class="px-4 py-2 bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-200">Cancel</button>
            <button type="submit" class="px-4 py-2 bg-slate-900 text-white font-semibold rounded-xl text-xs hover:bg-slate-800 shadow-sm">Save Machine</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Search input handler
  const searchInput = document.getElementById('search-machines');
  searchInput.addEventListener('input', (e) => {
    filterQuery = e.target.value;
    renderPage(profile);
  });

  // Modal logic
  const modal = document.getElementById('machine-modal-backdrop');
  const modalTitle = document.getElementById('modal-title');
  const machineForm = document.getElementById('machine-form');

  function openModal(machine = null) {
    if (machine) {
      modalTitle.innerText = `Edit Machine: ${machine.code}`;
      document.getElementById('machine-id').value = machine.id;
      document.getElementById('machine-code').value = machine.code;
      document.getElementById('machine-location').value = machine.location || '';
      document.getElementById('machine-line').value = machine.line || '';
      document.getElementById('machine-pm-count').value = machine.pm_per_month;
      document.getElementById('machine-tech-id').value = machine.technician_id || '';
      document.getElementById('machine-sort-order').value = machine.sort_order || 10;
      document.getElementById('machine-notes').value = machine.notes || '';
      document.getElementById('machine-is-active').checked = machine.is_active;
    } else {
      modalTitle.innerText = "Add New Machine";
      machineForm.reset();
      document.getElementById('machine-id').value = '';
      document.getElementById('machine-sort-order').value = (allMachines.length + 1) * 10;
      document.getElementById('machine-is-active').checked = true;
    }
    modal.classList.remove('hidden');
  }

  document.getElementById('add-machine-btn').addEventListener('click', () => openModal(null));
  document.getElementById('close-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('cancel-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));

  // Edit button click handlers
  document.querySelectorAll('.edit-machine-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mId = btn.dataset.machineId;
      const machine = allMachines.find(m => m.id === mId);
      if (machine) openModal(machine);
    });
  });

  // Active toggle handlers
  document.querySelectorAll('.toggle-active-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mId = btn.dataset.machineId;
      const currentActive = btn.dataset.active === 'true';
      try {
        const { error } = await supabase.from('machines').update({ is_active: !currentActive }).eq('id', mId);
        if (error) throw error;
        showToast("Machine status updated", "success");
        await renderPage(profile);
      } catch (err) {
        showToast(`Update failed: ${err.message}`, "error");
      }
    });
  });

  // Form submit handler
  machineForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('machine-id').value;
    const code = document.getElementById('machine-code').value.trim();
    const rawLoc = document.getElementById('machine-location').value;
    const location = rawLoc || null;
    const line = document.getElementById('machine-line').value.trim() || null;
    const pm_per_month = parseInt(document.getElementById('machine-pm-count').value, 10);
    const technician_id = document.getElementById('machine-tech-id').value || null;
    const sort_order = parseInt(document.getElementById('machine-sort-order').value, 10) || 10;
    const notes = document.getElementById('machine-notes').value.trim() || null;
    const is_active = document.getElementById('machine-is-active').checked;

    const existing = id ? allMachines.find(m => m.id === id) : null;

    const payload = {
      code,
      location,
      line,
      pm_per_month,
      technician_id,
      sort_order,
      notes,
      is_active
    };

    try {
      if (id) {
        const { error } = await supabase.from('machines').update(payload).eq('id', id);
        if (error) throw error;
        if (existing && existing.technician_id !== technician_id && technician_id) {
          const { error: taskError } = await supabase.rpc('reassign_machine_pm_tasks', {
            p_machine_id: id,
            p_technician_id: technician_id
          });
          if (taskError) throw taskError;
        }
        showToast("Machine updated successfully", "success");
      } else {
        const { error } = await supabase.from('machines').insert([payload]);
        if (error) throw error;
        showToast("Machine added successfully", "success");
      }
      modal.classList.add('hidden');
      await renderPage(profile);
    } catch (err) {
      showToast(`Save failed: ${err.message}`, "error");
    }
  });
}

init();
