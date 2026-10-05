// Lead Technicians Controller (SPECS §10.8, §7)
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { formatDateDDMMYYYY } from '../time.js';
import { renderTopBar, showToast } from '../ui.js';
import { callEdgeFunction } from '../api.js';

let allTechnicians = [];
let allMachines = [];
let createdCredentials = null;

async function init() {
  const guard = await requireRole('team_lead');
  if (!guard) return;
  const { profile } = guard;

  renderTopBar(document.getElementById('top-bar'), profile, "Technician Staff Management");
  await renderPage(profile);
}

async function renderPage(profile) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="p-8 text-center text-slate-500 font-medium">Loading technician profiles...</div>`;

  // Fetch technicians
  const { data: technicians, error: tErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'technician')
    .order('full_name');

  if (tErr) {
    app.innerHTML = `<div class="p-8 text-center text-rose-600 font-bold">Error loading technicians: ${tErr.message}</div>`;
    return;
  }
  allTechnicians = technicians || [];

  // Fetch machines to count/list per technician
  const { data: machines } = await supabase
    .from('machines')
    .select('id, code, technician_id')
    .order('code');
  allMachines = machines || [];

  // Credentials Box HTML
  let credsBoxHtml = '';
  if (createdCredentials) {
    credsBoxHtml = `
      <div class="bg-emerald-50 text-emerald-950 p-4 rounded-2xl space-y-2 border border-emerald-200">
        <div class="flex items-center justify-between">
          <span class="font-bold text-sm text-emerald-900">New Account Created Successfully</span>
          <button id="dismiss-creds-btn" class="text-xs text-emerald-700 hover:text-emerald-900 font-bold">✕ Dismiss</button>
        </div>
        <p class="text-xs text-emerald-800">Please provide these login credentials to the technician:</p>
        <div class="flex flex-wrap gap-4 text-xs font-mono bg-white p-3 rounded-xl border border-emerald-100">
          <div><span class="text-slate-400">Username:</span> <strong>${createdCredentials.username}</strong></div>
          <div><span class="text-slate-400">Temporary Password:</span> <strong>${createdCredentials.default_password}</strong></div>
        </div>
      </div>
    `;
  }

  // Rows HTML
  const rowsHtml = allTechnicians.map(tech => {
    const techMachines = allMachines.filter(m => m.technician_id === tech.id);
    const machineBadges = techMachines.map(m => `
      <span class="inline-block bg-slate-100 text-slate-800 font-bold text-[10px] px-2 py-0.5 rounded-full mr-1 mb-1">${m.code}</span>
    `).join('');

    const anchorDateFormatted = tech.cycle_anchor_date ? formatDateDDMMYYYY(tech.cycle_anchor_date) : '01/10/2026';
    const anchorType = (tech.cycle_anchor_shift_type || 'night').toUpperCase();

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-all">
        <td class="p-4 font-bold text-sm text-slate-900">${tech.full_name}</td>
        <td class="p-4 text-xs font-mono text-slate-600">${tech.username}</td>
        <td class="p-4 text-xs">
          ${machineBadges || '<span class="text-slate-400 italic">No assigned machines</span>'}
        </td>
        <td class="p-4 text-xs font-medium text-slate-700">
          ${anchorType} starting ${anchorDateFormatted}
        </td>
        <td class="p-4 text-xs">
          <button data-tech-id="${tech.id}" data-active="${tech.is_active}" class="toggle-tech-active-btn px-2.5 py-1 rounded-full font-semibold text-[11px] ${tech.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'} transition-all">
            ${tech.is_active ? 'Active' : 'Inactive'}
          </button>
        </td>
        <td class="p-4 text-xs text-right space-x-2">
          <button data-tech-id="${tech.id}" class="edit-tech-btn px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl transition-all">
            Edit Cycle
          </button>
          <button data-tech-id="${tech.id}" data-tech-username="${tech.username}" class="reset-pwd-btn px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold rounded-xl transition-all">
            Reset Password
          </button>
        </td>
      </tr>
    `;
  }).join('');

  app.innerHTML = `
    ${credsBoxHtml}

    <!-- Header Controls -->
    <div class="flex items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm">
      <div>
        <h2 class="font-bold text-base text-slate-900">Maintenance Technicians (${allTechnicians.length})</h2>
        <p class="text-xs text-slate-500">Manage technician accounts, machine assignments, and 4-day shift cycles.</p>
      </div>

      <button id="add-tech-btn" class="px-4 py-2 bg-slate-900 text-white font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-800 transition-all">
        + Add Technician
      </button>
    </div>

    <!-- Technicians Table -->
    <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-100">
              <th class="p-4 text-xs font-bold text-slate-700">Full Name</th>
              <th class="p-4 text-xs font-bold text-slate-700">Username</th>
              <th class="p-4 text-xs font-bold text-slate-700">Assigned Machines</th>
              <th class="p-4 text-xs font-bold text-slate-700">4-Day Cycle Anchor</th>
              <th class="p-4 text-xs font-bold text-slate-700">Status</th>
              <th class="p-4 text-xs font-bold text-slate-700 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml.length > 0 ? rowsHtml : `<tr><td colspan="6" class="p-8 text-center text-slate-400 font-medium">No technicians found</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Backdrop: Add/Edit Technician -->
    <div id="tech-modal-backdrop" class="fixed inset-0 bg-slate-900/40 z-50 hidden flex items-center justify-center p-4">
      <div class="bg-white w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 id="tech-modal-title" class="font-bold text-lg text-slate-900">Add Technician</h3>
          <button id="close-tech-modal-btn" class="text-slate-400 hover:text-slate-900 font-bold text-sm">✕</button>
        </div>

        <form id="tech-form" class="space-y-4 text-xs font-medium text-slate-700">
          <input type="hidden" id="tech-id" value="">

          <div>
            <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Full Name *</label>
            <input id="tech-full-name" type="text" required placeholder="e.g. John Doe" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-semibold focus:outline-none">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Cycle Anchor Date *</label>
              <input id="tech-anchor-date" type="date" required value="2026-10-01" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-semibold focus:outline-none">
            </div>
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Anchor Shift Type *</label>
              <select id="tech-anchor-type" class="w-full p-3 bg-slate-100 rounded-xl text-sm font-semibold focus:outline-none">
                <option value="night">Night Shift (N) — Day 2 of 4</option>
                <option value="day">Day Shift (D) — Day 1 of 4</option>
                <option value="rest1">Rest 1 Shift (R1) — Day 3 of 4</option>
                <option value="rest2">Rest 2 Shift (R2) — Day 4 of 4</option>
              </select>
            </div>
          </div>

          <div id="machine-selection-container" class="space-y-1">
            <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Assign Fleet Machines</label>
            <div class="max-h-36 overflow-y-auto p-3 bg-slate-50 rounded-xl space-y-1 border border-slate-100">
              ${allMachines.map(m => `
                <label class="flex items-center gap-2 p-1 hover:bg-white rounded cursor-pointer">
                  <input type="checkbox" name="assign-machines" value="${m.id}" class="w-4 h-4 rounded text-slate-900 focus:ring-0">
                  <span class="font-bold text-xs text-slate-800">${m.code}</span>
                  <span class="text-[10px] text-slate-400">(${m.location || ''} &bull; ${m.pm_per_month} PM/mo)</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" id="cancel-tech-modal-btn" class="px-4 py-2 bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-200">Cancel</button>
            <button type="submit" class="px-4 py-2 bg-slate-900 text-white font-semibold rounded-xl text-xs hover:bg-slate-800 shadow-sm">Save Technician</button>
          </div>
        </form>
      </div>
    </div>
  `;

  if (document.getElementById('dismiss-creds-btn')) {
    document.getElementById('dismiss-creds-btn').addEventListener('click', () => {
      createdCredentials = null;
      renderPage(profile);
    });
  }

  // Modal handlers
  const modal = document.getElementById('tech-modal-backdrop');
  const modalTitle = document.getElementById('tech-modal-title');
  const techForm = document.getElementById('tech-form');

  function openTechModal(tech = null) {
    if (tech) {
      modalTitle.innerText = `Edit Cycle: ${tech.full_name}`;
      document.getElementById('tech-id').value = tech.id;
      document.getElementById('tech-full-name').value = tech.full_name;
      document.getElementById('tech-anchor-date').value = tech.cycle_anchor_date || '2026-10-01';
      document.getElementById('tech-anchor-type').value = tech.cycle_anchor_shift_type || 'night';

      // Select assigned machines
      const techMachineIds = new Set(allMachines.filter(m => m.technician_id === tech.id).map(m => m.id));
      document.querySelectorAll('input[name="assign-machines"]').forEach(cb => {
        cb.checked = techMachineIds.has(cb.value);
      });
    } else {
      modalTitle.innerText = "Add New Technician";
      techForm.reset();
      document.getElementById('tech-id').value = '';
      document.getElementById('tech-anchor-date').value = '2026-10-01';
      document.getElementById('tech-anchor-type').value = 'night';
      document.querySelectorAll('input[name="assign-machines"]').forEach(cb => cb.checked = false);
    }
    modal.classList.remove('hidden');
  }

  document.getElementById('add-tech-btn').addEventListener('click', () => openTechModal(null));
  document.getElementById('close-tech-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('cancel-tech-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));

  document.querySelectorAll('.edit-tech-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tId = btn.dataset.techId;
      const tech = allTechnicians.find(t => t.id === tId);
      if (tech) openTechModal(tech);
    });
  });

  // Reset password button handler
  document.querySelectorAll('.reset-pwd-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tId = btn.dataset.techId;
      const username = btn.dataset.techUsername;
      if (!confirm(`Reset password for ${username} to default password?`)) return;

      try {
        let res;
        try {
          res = await callEdgeFunction('admin-reset-password', { user_id: tId });
        } catch (efErr) {
          // Fallback to database RPC
          const { data, error } = await supabase.rpc('admin_reset_password', { p_user_id: tId });
          if (error) throw error;
          res = data;
        }

        createdCredentials = {
          username: username,
          default_password: res.default_password || 'PMPlanner123!'
        };
        showToast("Password reset successfully", "success");
        await renderPage(profile);
      } catch (err) {
        showToast(`Reset failed: ${err.message}`, "error");
      }
    });
  });

  // Toggle active button handler
  document.querySelectorAll('.toggle-tech-active-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tId = btn.dataset.techId;
      const currentActive = btn.dataset.active === 'true';

      try {
        try {
          await callEdgeFunction('admin-set-active', { user_id: tId, is_active: !currentActive });
        } catch (efErr) {
          // Fallback to database RPC
          const { error } = await supabase.rpc('admin_set_active', { p_user_id: tId, p_is_active: !currentActive });
          if (error) throw error;
        }

        showToast("Technician status updated", "success");
        await renderPage(profile);
      } catch (err) {
        showToast(`Update failed: ${err.message}`, "error");
      }
    });
  });

  // Save technician form handler
  techForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('tech-id').value;
    const full_name = document.getElementById('tech-full-name').value.trim();
    const cycle_anchor_date = document.getElementById('tech-anchor-date').value;
    const cycle_anchor_shift_type = document.getElementById('tech-anchor-type').value;

    const selectedMachineIds = Array.from(document.querySelectorAll('input[name="assign-machines"]:checked')).map(cb => cb.value);

    let anchor_index = 1;
    if (cycle_anchor_shift_type === 'day') anchor_index = 0;
    else if (cycle_anchor_shift_type === 'night') anchor_index = 1;
    else if (cycle_anchor_shift_type === 'rest1' || cycle_anchor_shift_type === 'rest') anchor_index = 2;
    else if (cycle_anchor_shift_type === 'rest2') anchor_index = 3;

    try {
      if (id) {
        // Edit existing technician cycle & profile
        const { error: profErr } = await supabase
          .from('profiles')
          .update({
            full_name,
            cycle_anchor_date,
            cycle_anchor_shift_type,
            cycle_anchor_index: anchor_index,
            updated_at: new Date().toISOString()
          })
          .eq('id', id);

        if (profErr) throw profErr;

        // Update assigned machines
        for (const m of allMachines) {
          const shouldAssign = selectedMachineIds.includes(m.id);
          const isAssigned = m.technician_id === id;

          if (shouldAssign && !isAssigned) {
            await supabase.from('machines').update({ technician_id: id }).eq('id', m.id);
          } else if (!shouldAssign && isAssigned) {
            await supabase.from('machines').update({ technician_id: null }).eq('id', m.id);
          }
        }

        showToast("Technician updated successfully", "success");
      } else {
        // Add new technician
        let res;
        try {
          res = await callEdgeFunction('admin-create-user', {
            full_name,
            machine_ids: selectedMachineIds,
            cycle_anchor_date,
            cycle_anchor_index: anchor_index
          });
        } catch (efErr) {
          // Fallback to database RPC (no Edge Function required)
          const { data, error: rpcErr } = await supabase.rpc('admin_create_technician', {
            p_full_name: full_name,
            p_cycle_anchor_date: cycle_anchor_date,
            p_cycle_anchor_shift_type: cycle_anchor_shift_type,
            p_cycle_anchor_index: anchor_index
          });

          if (rpcErr) throw rpcErr;
          res = data;

          if (selectedMachineIds.length > 0 && res.user_id) {
            await supabase.from('machines').update({ technician_id: res.user_id }).in('id', selectedMachineIds);
          }
        }

        createdCredentials = {
          username: res.username,
          default_password: res.default_password || 'PMPlanner123!'
        };

        showToast("Technician created!", "success");
      }

      modal.classList.add('hidden');
      await renderPage(profile);
    } catch (err) {
      showToast(`Save failed: ${err.message}`, "error");
    }
  });
}

init();
