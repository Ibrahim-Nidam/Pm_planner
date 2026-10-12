// Grease calculation and reminder helpers
import { formatDateDDMMYYYY } from './time.js';

export function getTodayDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Given all X-ray generator grease records (ordered by newest performed_on/updated_at first),
 * finds which machines have an overdue grease session.
 * 
 * Rules:
 * 1. Only considers the LATEST grease record for each active machine.
 * 2. If the latest session's next_due_on is above current date (next_due_on > todayStr),
 *    no notice for that machine (it is on track / has been updated).
 * 3. Only if the next_due_on has arrived or passed (next_due_on <= todayStr) and has not been updated
 *    with a future session, include that machine in the overdue notice.
 */
export function getOverdueGreaseRecords(records = [], todayStr = getTodayDateString()) {
  const latestByMachine = new Map();

  for (const record of records) {
    if (!record || !record.machine_id) continue;
    // Skip if machine is explicitly marked inactive
    if (record.machines && record.machines.is_active === false) continue;

    // First encountered record for a machine is its latest session
    if (!latestByMachine.has(record.machine_id)) {
      latestByMachine.set(record.machine_id, record);
    }
  }

  const overdueList = [];
  for (const record of latestByMachine.values()) {
    if (record.next_due_on && record.next_due_on <= todayStr) {
      overdueList.push(record);
    }
  }

  overdueList.sort((a, b) => (a.next_due_on || '').localeCompare(b.next_due_on || ''));
  return overdueList;
}

export function formatGreaseReminderMessage(overdueRecords = []) {
  if (!overdueRecords.length) return '';
  const items = overdueRecords.map(record => {
    const code = record.machines?.code || 'Machine';
    return `${code} connector must be greased on ${formatDateDDMMYYYY(record.next_due_on)}`;
  });
  return `Grease reminder: ${items.join(' · ')}`;
}
