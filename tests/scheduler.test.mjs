import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule, nightsFromCycle } from '../js/scheduler.js';

test('Acceptance Tests 1-5 (October 2026 Fleet Schedule)', () => {
  const monthStart = '2026-10-01';

  // Technicians (SPECS §4)
  const techMohamed = { id: 'tech-mohamed', cycle_anchor_date: '2026-10-01', cycle_anchor_index: 2 };
  const techChouaib = { id: 'tech-chouaib', cycle_anchor_date: '2026-10-01', cycle_anchor_index: 3 };
  const techHamza   = { id: 'tech-hamza',   cycle_anchor_date: '2026-10-01', cycle_anchor_index: 0 };
  const techOussama = { id: 'tech-oussama', cycle_anchor_date: '2026-10-01', cycle_anchor_index: 1 };

  // Calculate nights
  const nightsByTech = {
    [techMohamed.id]: nightsFromCycle(techMohamed, monthStart),
    [techChouaib.id]: nightsFromCycle(techChouaib, monthStart),
    [techHamza.id]:   nightsFromCycle(techHamza, monthStart),
    [techOussama.id]: nightsFromCycle(techOussama, monthStart)
  };

  // Machines (SPECS §4)
  const machines = [
    { id: 'm1',  code: 'K278',  sort_order: 1,  pm_per_month: 2, technician_id: techMohamed.id, is_active: true },
    { id: 'm2',  code: 'K279',  sort_order: 2,  pm_per_month: 2, technician_id: techChouaib.id, is_active: true },
    { id: 'm3',  code: 'K280',  sort_order: 3,  pm_per_month: 2, technician_id: techChouaib.id, is_active: true },
    { id: 'm4',  code: 'K288',  sort_order: 4,  pm_per_month: 2, technician_id: techOussama.id, is_active: true },
    { id: 'm5',  code: 'K289',  sort_order: 5,  pm_per_month: 2, technician_id: techMohamed.id, is_active: true },
    { id: 'm6',  code: 'K290',  sort_order: 6,  pm_per_month: 2, technician_id: techOussama.id, is_active: true },
    { id: 'm7',  code: 'K291',  sort_order: 7,  pm_per_month: 0, technician_id: null,            is_active: false }, // out of service
    { id: 'm8',  code: 'K887U', sort_order: 8,  pm_per_month: 1, technician_id: techHamza.id,   is_active: true },
    { id: 'm9',  code: 'K888U', sort_order: 9,  pm_per_month: 1, technician_id: techMohamed.id, is_active: true },
    { id: 'm10', code: 'K889U', sort_order: 10, pm_per_month: 1, technician_id: techHamza.id,   is_active: true },
    { id: 'm11', code: 'K931U', sort_order: 11, pm_per_month: 1, technician_id: techHamza.id,   is_active: true },
    { id: 'm12', code: 'K932U', sort_order: 12, pm_per_month: 1, technician_id: techChouaib.id, is_active: true },
    { id: 'm13', code: 'K933U', sort_order: 13, pm_per_month: 1, technician_id: techOussama.id, is_active: true }
  ];

  const settings = {
    second_pm_gap_days: '14',
    second_pm_gap_tolerance_days: '2'
  };

  const { tasks, warnings } = generateSchedule({ monthStart, machines, nightsByTech, settings });

  // 1. Mohamed has 5 PMs over 7 nights
  const mohamedTasks = tasks.filter(t => t.technician_id === techMohamed.id);
  assert.equal(mohamedTasks.length, 5, 'Mohamed should have 5 PMs');

  // 2. Counts check: Chouaib (5), Oussama (5), Hamza (3), K291 (0), Total (18)
  const chouaibTasks = tasks.filter(t => t.technician_id === techChouaib.id);
  const oussamaTasks = tasks.filter(t => t.technician_id === techOussama.id);
  const hamzaTasks   = tasks.filter(t => t.technician_id === techHamza.id);
  const k291Tasks    = tasks.filter(t => t.machine_code === 'K291');

  assert.equal(chouaibTasks.length, 5, 'Chouaib should have 5 PMs');
  assert.equal(oussamaTasks.length, 5, 'Oussama should have 5 PMs');
  assert.equal(hamzaTasks.length, 3, 'Hamza should have 3 PMs');
  assert.equal(k291Tasks.length, 0, 'K291 should have 0 PMs');
  assert.equal(tasks.length, 18, 'Total PM tasks should be 18');

  // 3. For every 2-PM machine, 2P - PM gap is 12..16 days
  const twoPMMachines = machines.filter(m => m.pm_per_month === 2);
  for (const m of twoPMMachines) {
    const mTasks = tasks.filter(t => t.machine_id === m.id).sort((a, b) => a.sequence - b.sequence);
    assert.equal(mTasks.length, 2);
    const date1 = new Date(mTasks[0].scheduled_date);
    const date2 = new Date(mTasks[1].scheduled_date);
    const gapDays = Math.round((date2 - date1) / (1000 * 60 * 60 * 24));
    assert.ok(gapDays >= 12 && gapDays <= 16, `Gap for ${m.code} must be between 12 and 16 days, got ${gapDays}`);
  }

  // 4. Rule R8: No two tasks share a scheduled_date
  const scheduledDates = tasks.map(t => t.scheduled_date);
  const uniqueDates = new Set(scheduledDates);
  assert.equal(uniqueDates.size, scheduledDates.length, 'Every task must have a unique scheduled_date (R8)');

  // 5. Deterministic check
  const secondRun = generateSchedule({ monthStart, machines, nightsByTech, settings });
  assert.deepEqual(tasks, secondRun.tasks, 'Scheduler output must be deterministic');
});
