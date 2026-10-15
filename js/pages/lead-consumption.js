// Team Lead Parts Consumption Page
// Aggregates the parts recorded on PM tasks: per part, per month, and per machine.
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { renderTopBar, showToast } from '../ui.js';
import { PART_CATALOG } from '../parts-catalog.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const monthLabel = monthStr => {
  const [year, month] = monthStr.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
};

const defaultMonth = () => new Date().toISOString().slice(0, 7);

// Shift a 'YYYY-MM' string by the given number of months.
function shiftMonth(monthStr, delta) {
  const [year, month] = monthStr.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Every 'YYYY-MM' between from and to, inclusive.
function monthsBetween(from, to) {
  const months = [];
  let cursor = from;
  while (cursor <= to) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}

async function init() {
  const guard = await requireRole('team_lead');
  if (!guard) return;
  renderTopBar(document.getElementById('top-bar'), guard.profile, 'Parts Consumption');
  await renderPage(guard.profile);
}

// One flat record per consumed part line: reference, designation, month, machine code, quantity.
async function fetchConsumption(fromMonth, toMonth) {
  const from = `${fromMonth}-01`;
  const [endYear, endMonth] = toMonth.split('-').map(Number);
  const to = `${toMonth}-${new Date(endYear, endMonth, 0).getDate()}`;

  const { data: tasks, error } = await supabase
    .from('pm_tasks')
    .select('id, scheduled_date, ended_at, parts, machines(code, line)')
    .gte('scheduled_date', from)
    .lte('scheduled_date', to);

  if (error) throw error;

  const lines = [];
  for (const task of tasks || []) {
    if (!Array.isArray(task.parts)) continue;
    for (const part of task.parts) {
      const quantity = Number(part?.quantity);
      const reference = String(part?.reference || '').trim();
      if (!reference || !Number.isFinite(quantity) || quantity <= 0) continue;
      lines.push({
        reference,
        designation: String(part?.designation || reference).trim(),
        // Consumption belongs to the PM's scheduled month, matching the planner timeline.
        month: String(task.scheduled_date).slice(0, 7),
        machine: task.machines?.code || 'Unknown',
        quantity
      });
    }
  }
  return lines;
}

function buildConsumptionRows(lines, months) {
  // Catalog parts always show (even at zero), then any legacy/free-text references found in the data.
  const rows = new Map();
  const rowKey = reference => reference.trim().toUpperCase();
  PART_CATALOG.forEach(part => {
    rows.set(rowKey(part.reference), {
      reference: part.reference,
      designation: part.designation,
      byMonth: Object.fromEntries(months.map(m => [m, 0])),
      byMachine: {}
    });
  });

  for (const line of lines) {
    const key = rowKey(line.reference);
    let row = rows.get(key);
    if (!row) {
      row = {
        reference: line.reference,
        designation: line.designation,
        byMonth: Object.fromEntries(months.map(m => [m, 0])),
        byMachine: {}
      };
      rows.set(key, row);
    }
    if (row.byMonth[line.month] === undefined) row.byMonth[line.month] = 0;
    row.byMonth[line.month] += line.quantity;
    row.byMachine[line.machine] = (row.byMachine[line.machine] || 0) + line.quantity;
  }

  return [...rows.values()]
    .map(row => ({ ...row, total: Object.values(row.byMonth).reduce((sum, qty) => sum + qty, 0) }))
    .sort((a, b) => b.total - a.total || a.designation.localeCompare(b.designation));
}

async function renderPage(profile) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <section class="bg-white rounded-2xl p-6 shadow-sm space-y-1">
      <p class="eyebrow">Maintenance overview</p>
      <h2 class="text-2xl font-bold text-slate-900 mt-1">Parts consumption</h2>
      <p class="text-sm text-slate-500 mt-2">Parts recorded on PM tasks, broken down per month and per machine for the selected period.</p>
    </section>
    <section class="bg-white rounded-2xl p-6 shadow-sm">
      <div class="flex flex-wrap items-end gap-4">
        <label class="text-xs font-semibold uppercase text-slate-500">From
          <input id="period-from" type="month" value="${shiftMonth(defaultMonth(), -2)}" class="block mt-2 w-full p-3 bg-slate-100 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900">
        </label>
        <label class="text-xs font-semibold uppercase text-slate-500">To
          <input id="period-to" type="month" value="${defaultMonth()}" class="block mt-2 w-full p-3 bg-slate-100 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900">
        </label>
        <button id="apply-period-btn" class="px-4 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all">Apply</button>
      </div>
    </section>
    <div id="consumption-results" class="space-y-6">
      <div class="p-8 text-center text-slate-500">Loading consumption data...</div>
    </div>
  `;

  document.getElementById('apply-period-btn').addEventListener('click', () => {
    const from = document.getElementById('period-from').value;
    const to = document.getElementById('period-to').value;
    if (!from || !to) return showToast('Select both months', 'error');
    if (from > to) return showToast('The "From" month must be before the "To" month', 'error');
    renderResults(from, to);
  });

  await renderResults(shiftMonth(defaultMonth(), -2), defaultMonth());
}

async function renderResults(fromMonth, toMonth) {
  const container = document.getElementById('consumption-results');
  container.innerHTML = '<div class="p-8 text-center text-slate-500">Loading consumption data...</div>';

  let lines;
  try {
    lines = await fetchConsumption(fromMonth, toMonth);
  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-white rounded-2xl text-rose-600 font-semibold">${escapeHtml(err.message)}</div>`;
    return;
  }

  const months = monthsBetween(fromMonth, toMonth);
  const rows = buildConsumptionRows(lines, months);
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const machinesUsed = [...new Set(lines.map(line => line.machine))].sort();

  const monthTotals = Object.fromEntries(months.map(m => [m, rows.reduce((sum, row) => sum + (row.byMonth[m] || 0), 0)]));

  const summaryCards = `
    <section class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <span class="block text-[10px] font-semibold uppercase text-slate-400">Period</span>
        <span class="font-bold text-slate-900 text-sm">${monthLabel(fromMonth)} → ${monthLabel(toMonth)}</span>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <span class="block text-[10px] font-semibold uppercase text-slate-400">Total consumed</span>
        <span class="font-bold text-slate-900 text-sm">${grandTotal.toLocaleString()} units</span>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm col-span-2 sm:col-span-1">
        <span class="block text-[10px] font-semibold uppercase text-slate-400">Machines involved</span>
        <span class="font-bold text-slate-900 text-sm">${machinesUsed.length ? machinesUsed.join(', ') : 'None'}</span>
      </div>
    </section>
  `;

  const monthHeaders = months.map(m => `<th class="px-3 py-2 text-[11px] font-semibold uppercase text-slate-500 text-center whitespace-nowrap">${monthLabel(m)}</th>`).join('');

  const bodyRows = rows.map(row => {
    const machineBreakdown = Object.entries(row.byMachine)
      .sort((a, b) => b[1] - a[1])
      .map(([code, qty]) => `<span class="inline-flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-700">${escapeHtml(code)}: ${qty}</span>`)
      .join('');
    const monthCells = months.map(m => {
      const qty = row.byMonth[m] || 0;
      return `<td class="px-3 py-2 text-sm text-center ${qty ? 'font-bold text-slate-900' : 'text-slate-300'}">${qty || '·'}</td>`;
    }).join('');
    return `
      <tr class="border-t border-slate-100">
        <td class="px-3 py-2 sticky left-0 bg-white">
          <span class="block text-sm font-semibold text-slate-900">${escapeHtml(row.designation)}</span>
          <span class="block text-[11px] font-medium text-slate-400">${escapeHtml(row.reference)}</span>
        </td>
        <td class="px-3 py-2">
          <div class="flex flex-wrap gap-1.5">${machineBreakdown || '<span class="text-[11px] text-slate-300 font-medium">None</span>'}</div>
        </td>
        ${monthCells}
        <td class="px-3 py-2 text-sm font-bold text-slate-900 text-center">${row.total || '<span class="text-slate-300">0</span>'}</td>
      </tr>
    `;
  }).join('');

  const totalRow = `
    <tr class="border-t-2 border-slate-200 bg-slate-50">
      <td class="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 sticky left-0 bg-slate-50">Total</td>
      <td class="px-3 py-2"></td>
      ${months.map(m => `<td class="px-3 py-2 text-sm font-bold text-slate-900 text-center">${monthTotals[m] || '<span class="text-slate-300">0</span>'}</td>`).join('')}
      <td class="px-3 py-2 text-sm font-black text-slate-900 text-center">${grandTotal}</td>
    </tr>
  `;

  const tableCard = grandTotal === 0 && lines.length === 0
    ? `<section class="bg-white rounded-2xl p-6 shadow-sm text-sm text-slate-500">No parts recorded for this period.</section>`
    : `
      <section class="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse min-w-[720px]">
            <thead>
              <tr class="bg-slate-50">
                <th class="px-3 py-2 text-[11px] font-semibold uppercase text-slate-500 text-left">Part</th>
                <th class="px-3 py-2 text-[11px] font-semibold uppercase text-slate-500 text-left">By machine</th>
                ${monthHeaders}
                <th class="px-3 py-2 text-[11px] font-semibold uppercase text-slate-500 text-center">Total</th>
              </tr>
            </thead>
            <tbody>${bodyRows}${totalRow}</tbody>
          </table>
        </div>
      </section>
      <section class="bg-white rounded-2xl p-6 shadow-sm">
        <h3 class="text-xs font-semibold uppercase text-slate-500 mb-3">Consumption per machine (whole period)</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${machinesUsed.length ? machinesUsed.map(code => {
            const total = lines.filter(line => line.machine === code).reduce((sum, line) => sum + line.quantity, 0);
            return `<div class="bg-slate-50 rounded-xl p-4">
              <span class="block text-[10px] font-semibold uppercase text-slate-400">${escapeHtml(code)}</span>
              <span class="font-bold text-slate-900 text-base">${total.toLocaleString()} units</span>
            </div>`;
          }).join('') : '<p class="text-sm text-slate-400">No consumption recorded.</p>'}
        </div>
      </section>
    `;

  container.innerHTML = summaryCards + tableCard;
}

init();
