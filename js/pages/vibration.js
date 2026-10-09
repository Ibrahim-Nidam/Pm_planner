import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { renderTopBar, showToast } from '../ui.js';

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

async function init() {
  const guard = await requireRole('any');
  if (!guard) return;
  renderTopBar(document.getElementById('top-bar'), guard.profile, 'Monthly Vibration Tests');
  await renderPage(guard.profile);
}

async function renderPage(profile) {
  const app = document.getElementById('app');
  const month = monthStart();
  app.innerHTML = '<div class="p-8 text-center text-slate-500">Loading vibration tests...</div>';

  const [{ data: machines, error: machineError }, { data: tests, error: testError }] = await Promise.all([
    supabase.from('machines').select('id, code, line, location').eq('is_active', true).order('sort_order'),
    supabase.from('vibration_tests').select('*').eq('month', month)
  ]);
  if (machineError || testError) {
    app.innerHTML = `<div class="p-6 bg-white rounded-2xl text-rose-600 font-semibold">${machineError?.message || testError?.message}</div>`;
    return;
  }

  const tested = new Map((tests || []).map(test => [test.machine_id, test]));
  const rows = (machines || []).map(machine => {
    const test = tested.get(machine.id);
    return `<tr class="border-b border-slate-100">
      <td class="p-3 font-bold">${machine.code}</td>
      <td class="p-3 text-xs text-slate-500">${machine.line || '—'}</td>
      <td class="p-3 text-xs">${test ? `<span class="font-bold ${test.result === 'passed' ? 'text-emerald-700' : 'text-rose-700'}">${test.result === 'passed' ? 'Passed' : 'Failed'}</span><span class="block text-[10px] text-slate-400">${test.performer_name}</span>` : '<span class="text-amber-700 font-semibold">Not tested</span>'}</td>
      <td class="p-3 text-right"><div class="flex justify-end gap-2">
        <button data-machine-id="${machine.id}" data-result="passed" class="vibration-btn px-3 py-2 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 hover:bg-emerald-200">Passed</button>
        <button data-machine-id="${machine.id}" data-result="failed" class="vibration-btn px-3 py-2 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 hover:bg-rose-200">Failed</button>
      </div></td>
    </tr>`;
  }).join('');

  app.innerHTML = `
    <div class="bg-amber-50 border border-amber-200 text-amber-950 p-4 rounded-2xl">
      <h2 class="font-bold">First-week vibration test</h2>
      <p class="text-sm mt-1">All machines require a vibration test during calendar days 1–7. Any active user can record a result, and multiple users can test different machines.</p>
    </div>
    <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div class="p-4 border-b border-slate-100"><h3 class="font-bold">Machine tests for ${month.substring(0, 7)}</h3></div>
      <div class="overflow-x-auto"><table class="w-full text-left"><thead><tr class="bg-slate-50 text-xs"><th class="p-3">Machine</th><th class="p-3">Line</th><th class="p-3">Status</th><th class="p-3 text-right">Record result</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;

  app.querySelectorAll('.vibration-btn').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const { error } = await supabase.rpc('save_vibration_test', {
        p_machine_id: button.dataset.machineId,
        p_month: month,
        p_result: button.dataset.result
      });
      if (error) showToast(error.message, 'error');
      else showToast('Vibration test saved', 'success');
      await renderPage(profile);
    });
  });
}

init();
