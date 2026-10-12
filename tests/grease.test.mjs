import test from 'node:test';
import assert from 'node:assert/strict';
import { getOverdueGreaseRecords, formatGreaseReminderMessage } from '../js/grease.js';
import { formatDateDDMMYYYY } from '../js/time.js';

test('formatDateDDMMYYYY formats YYYY-MM-DD correctly without timezone shift', () => {
  assert.equal(formatDateDDMMYYYY('2026-10-09'), '09/10/2026');
  assert.equal(formatDateDDMMYYYY('2027-01-12'), '12/01/2027');
  assert.equal(formatDateDDMMYYYY(''), '');
});

test('identifies overdue machine when next grease date has passed and not updated', () => {
  const records = [
    {
      id: 'rec-1',
      machine_id: 'm1',
      performed_on: '2026-07-09',
      next_due_on: '2026-10-09',
      updated_at: '2026-07-09T08:00:00Z',
      machines: { code: 'K278', is_active: true }
    }
  ];

  const todayStr = '2026-10-12';
  const overdue = getOverdueGreaseRecords(records, todayStr);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].machines.code, 'K278');
  assert.equal(formatGreaseReminderMessage(overdue), 'Grease reminder: K278 connector must be greased on 09/10/2026');
});

test('removes machine from notice when greased later and next due date is above current date', () => {
  // Machine K278 was originally due 09/10/2026.
  // Greased later on 2026-10-12, new next_due_on is 2027-01-12.
  // Both historical records exist in the table.
  const records = [
    {
      id: 'rec-2',
      machine_id: 'm1',
      performed_on: '2026-10-12',
      next_due_on: '2027-01-12',
      updated_at: '2026-10-12T10:00:00Z',
      machines: { code: 'K278', is_active: true }
    },
    {
      id: 'rec-1',
      machine_id: 'm1',
      performed_on: '2026-07-09',
      next_due_on: '2026-10-09',
      updated_at: '2026-07-09T08:00:00Z',
      machines: { code: 'K278', is_active: true }
    }
  ];

  const todayStr = '2026-10-12';
  const overdue = getOverdueGreaseRecords(records, todayStr);

  // Since next grease session is above current date (2027-01-12 > 2026-10-12),
  // there must be NO notice for this machine!
  assert.equal(overdue.length, 0);
  assert.equal(formatGreaseReminderMessage(overdue), '');
});

test('does not show notice if next grease session is in the future (above current date)', () => {
  const records = [
    {
      id: 'rec-1',
      machine_id: 'm1',
      performed_on: '2026-07-15',
      next_due_on: '2026-10-15',
      updated_at: '2026-07-15T08:00:00Z',
      machines: { code: 'K278', is_active: true }
    }
  ];

  // Today is 2026-10-12, next due date is 2026-10-15 (above current date)
  const todayStr = '2026-10-12';
  const overdue = getOverdueGreaseRecords(records, todayStr);
  assert.equal(overdue.length, 0);
});

test('handles multiple machines: removes greased machine but keeps still-overdue machine', () => {
  const records = [
    // Machine 1 greased and updated to 2027
    {
      id: 'rec-1-new',
      machine_id: 'm1',
      performed_on: '2026-10-12',
      next_due_on: '2027-01-12',
      updated_at: '2026-10-12T09:00:00Z',
      machines: { code: 'K278', is_active: true }
    },
    {
      id: 'rec-1-old',
      machine_id: 'm1',
      performed_on: '2026-07-09',
      next_due_on: '2026-10-09',
      updated_at: '2026-07-09T08:00:00Z',
      machines: { code: 'K278', is_active: true }
    },
    // Machine 2 not greased yet, still overdue from 2026-10-08
    {
      id: 'rec-2',
      machine_id: 'm2',
      performed_on: '2026-07-08',
      next_due_on: '2026-10-08',
      updated_at: '2026-07-08T08:00:00Z',
      machines: { code: 'K279', is_active: true }
    }
  ];

  const todayStr = '2026-10-12';
  const overdue = getOverdueGreaseRecords(records, todayStr);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].machines.code, 'K279');
  assert.equal(formatGreaseReminderMessage(overdue), 'Grease reminder: K279 connector must be greased on 08/10/2026');
});


test('ignores inactive machines', () => {
  const records = [
    {
      id: 'rec-inactive',
      machine_id: 'm-inactive',
      performed_on: '2026-07-01',
      next_due_on: '2026-10-01',
      updated_at: '2026-07-01T08:00:00Z',
      machines: { code: 'K291', is_active: false }
    }
  ];

  const todayStr = '2026-10-12';
  const overdue = getOverdueGreaseRecords(records, todayStr);
  assert.equal(overdue.length, 0);
});

test('history rows show previous performed_on → current performed_on, not next_due_on', () => {
  // Simulates the JS logic from lead-grease.js history rendering
  // history is ordered newest-first
  const history = [
    { id: 'r3', performed_on: '2027-01-05', next_due_on: '2027-04-07' },
    { id: 'r2', performed_on: '2026-10-12', next_due_on: '2027-01-12' },
    { id: 'r1', performed_on: '2026-07-09', next_due_on: '2026-10-09' },
  ];

  const rows = history.map((row, i) => {
    const prev = history[i + 1];
    const fromLabel = prev ? formatDateDDMMYYYY(prev.performed_on) : '—';
    const toLabel = formatDateDDMMYYYY(row.performed_on);
    return `${fromLabel} → ${toLabel}`;
  });

  // Most recent entry: previous session was 2026-10-12, current is 2027-01-05
  assert.equal(rows[0], '12/10/2026 → 05/01/2027');
  // Middle entry: previous session was 2026-07-09, current is 2026-10-12
  assert.equal(rows[1], '09/07/2026 → 12/10/2026');
  // Oldest entry: no previous session, shows em-dash
  assert.equal(rows[2], '— → 09/07/2026');
});
