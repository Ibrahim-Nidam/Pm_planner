import { supabase } from './supabase-client.js';
import { showToast } from './ui.js';

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function renderVibrationWidget(container, profile) {
  if (!container) return;
  const month = monthStart();
  const [{ data: machines, error: machineError }, { data: tests, error: testError }] = await Promise.all([
    supabase.from('machines').select('id, code, line').eq('is_active', true).order('sort_order'),
    supabase.from('vibration_tests').select('*').eq('month', month)
  ]);
  if (machineError || testError) {
    container.innerHTML = `<div class="p-4 rounded-2xl bg-rose-50 text-rose-800 text-sm font-semibold">Unable to load vibration tests: ${machineError?.message || testError?.message}</div>`;
    return;
  }

  const tested = new Map((tests || []).map(test => [test.machine_id, test]));
  const allPassed = machines?.length > 0 && machines.every(machine => tested.get(machine.id)?.result === 'passed');
  if (!machines?.length || allPassed) {
    container.innerHTML = '';
    return;
  }
  const cards = (machines || []).map(machine => {
    const test = tested.get(machine.id);
    const resultClass = test?.result === 'passed' ? 'vibration-status vibration-status--passed' : test?.result === 'failed' ? 'vibration-status vibration-status--failed' : 'vibration-status vibration-status--pending';
    return `<article class="vibration-card">
      <div class="p-4 flex items-center justify-between gap-2">
        <div><h4 class="font-bold text-sm text-slate-900">${machine.code}</h4><p class="text-xs text-slate-500 mt-1">${machine.line || 'No line assigned'}</p></div>
        <span class="${resultClass}">${test ? test.result : 'Not tested'}</span>
      </div>
      <div class="px-4 pb-4 flex items-center justify-between gap-3">
        <span class="text-xs text-slate-500">${test ? `Recorded by ${test.performer_name}` : 'Choose the result'}</span>
        <div class="flex gap-2">
          <button data-vibration-machine="${machine.id}" data-vibration-result="passed" class="vibration-widget-btn px-3 py-2 rounded-lg border border-emerald-600 bg-white text-emerald-700 text-xs font-bold">Pass</button>
          <button data-vibration-machine="${machine.id}" data-vibration-result="failed" class="vibration-widget-btn px-3 py-2 rounded-lg border border-rose-600 bg-white text-rose-700 text-xs font-bold">Fail</button>
        </div>
      </div>
    </article>`;
  }).join('');

  container.innerHTML = `<section class="vibration-panel">
    <div class="vibration-panel__header">
      <div><p class="eyebrow">Monthly check</p><h2 class="text-lg font-bold text-slate-900 mt-1">Vibration checks</h2><p class="text-sm text-slate-500 mt-1">Record one result for each active machine during the first week.</p></div>
      <span class="vibration-window">Days 1–7</span>
    </div>
    <div class="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">${cards}</div>
  </section>`;

  container.querySelectorAll('.vibration-widget-btn').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const { error } = await supabase.rpc('save_vibration_test', {
        p_machine_id: button.dataset.vibrationMachine,
        p_month: month,
        p_result: button.dataset.vibrationResult
      });
      if (error) showToast(error.message, 'error');
      else showToast('Vibration test saved', 'success');
      await renderVibrationWidget(container, profile);
    });
  });
}
