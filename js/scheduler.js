// Pure scheduling engine (SPECS §8)

/**
 * Returns ISO date strings for all night shifts of a technician in the target month based on cycle anchor.
 */
export function getCycleShiftForDate(profile, dateStr) {
  if (!profile || !profile.cycle_anchor_date || profile.cycle_anchor_index == null) {
    return 'rest';
  }

  const [aYear, aMonth, aDay] = profile.cycle_anchor_date.split('-').map(Number);
  const anchorUtc = Date.UTC(aYear, aMonth - 1, aDay);

  const [year, month, day] = dateStr.split('-').map(Number);
  const currentUtc = Date.UTC(year, month - 1, day);

  const diffDays = Math.round((currentUtc - anchorUtc) / (1000 * 60 * 60 * 24));
  let cyclePos = (profile.cycle_anchor_index + (diffDays % 4)) % 4;
  if (cyclePos < 0) cyclePos += 4;

  if (cyclePos === 0) return 'day';
  if (cyclePos === 1) return 'night';
  return 'rest';
}

export function nightsFromCycle(profile, monthStartStr) {
  if (!profile || !profile.cycle_anchor_date || profile.cycle_anchor_index == null) {
    return [];
  }

  const [year, month] = monthStartStr.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const nights = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (getCycleShiftForDate(profile, dayStr) === 'night') {
      nights.push(dayStr);
    }
  }

  return nights;
}

/**
 * Returns the Monday-Sunday week start (ISO date string) for a given date.
 */
function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getUTCDay(); // 0 is Sun, 1 is Mon...
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().split('T')[0];
}

/**
 * Returns latest allowed date (R6 tolerance).
 * Next night in the same Monday-Sunday week if available, else scheduledDate.
 */
export function toleranceDate(scheduledDateStr, techNights) {
  if (!techNights || techNights.length === 0) return scheduledDateStr;
  const scheduledWeek = getWeekStart(scheduledDateStr);

  const sameWeekNights = techNights
    .filter(n => getWeekStart(n) === scheduledWeek && n > scheduledDateStr)
    .sort();

  if (sameWeekNights.length > 0) {
    return sameWeekNights[0];
  }
  return scheduledDateStr;
}

/**
 * Pure scheduling function.
 * SPECS §8 Algorithm.
 */
export function generateSchedule({ monthStart, machines, nightsByTech, settings = {} }) {
  const gap = parseInt(settings.second_pm_gap_days || '14', 10);
  const tol = parseInt(settings.second_pm_gap_tolerance_days || '2', 10);
  const minGap = gap - tol;
  const maxGap = gap + tol;

  const tasks = [];
  const warnings = [];
  const usedNightsGlobal = new Set();

  // Group machines by technician
  const activeMachines = machines.filter(m => m.is_active && m.pm_per_month > 0);
  const techMachineMap = new Map();

  for (const m of activeMachines) {
    if (!m.technician_id) {
      warnings.push(`Machine ${m.code} has no technician assigned.`);
      continue;
    }
    if (!techMachineMap.has(m.technician_id)) {
      techMachineMap.set(m.technician_id, []);
    }
    techMachineMap.get(m.technician_id).push(m);
  }

  // Process technician by technician
  const techIds = Array.from(techMachineMap.keys()).sort();

  for (const techId of techIds) {
    const techMachines = techMachineMap.get(techId);
    const techNights = [...(nightsByTech[techId] || [])].sort();

    if (techNights.length === 0) {
      warnings.push(`Technician ${techId} has no night shifts in ${monthStart}.`);
      continue;
    }

    let freeNights = [...techNights];
    const placedDates = [];

    // Separate 2-PM and 1-PM machines, sort by sort_order
    const machines2PM = techMachines.filter(m => m.pm_per_month === 2).sort((a, b) => a.sort_order - b.sort_order);
    const machines1PM = techMachines.filter(m => m.pm_per_month === 1).sort((a, b) => a.sort_order - b.sort_order);

    // Place 2-PM machines first
    for (const m of machines2PM) {
      let bestPair = null;
      let bestCost = Infinity;

      for (let i = 0; i < freeNights.length; i++) {
        for (let j = i + 1; j < freeNights.length; j++) {
          const dateA = freeNights[i];
          const dateB = freeNights[j];

          const diffMs = new Date(dateB).getTime() - new Date(dateA).getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

          if (diffDays >= minGap && diffDays <= maxGap) {
            const dayNum = parseInt(dateA.split('-')[2], 10);
            const cost = Math.abs(diffDays - gap) * 10 + dayNum;
            if (cost < bestCost) {
              bestCost = cost;
              bestPair = { a: dateA, b: dateB, inRange: true };
            }
          }
        }
      }

      // Fallback if no pair in 12-16 days range
      if (!bestPair && freeNights.length >= 2) {
        for (let i = 0; i < freeNights.length; i++) {
          for (let j = i + 1; j < freeNights.length; j++) {
            const dateA = freeNights[i];
            const dateB = freeNights[j];
            const diffMs = new Date(dateB).getTime() - new Date(dateA).getTime();
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
            const cost = Math.abs(diffDays - gap) * 10;
            if (cost < bestCost) {
              bestCost = cost;
              bestPair = { a: dateA, b: dateB, inRange: false };
            }
          }
        }
        if (bestPair) {
          warnings.push(`2P gap for machine ${m.code} is outside ${minGap}-${maxGap} days range.`);
        }
      }

      if (bestPair) {
        // Remove chosen nights from freeNights
        freeNights = freeNights.filter(n => n !== bestPair.a && n !== bestPair.b);
        placedDates.push(bestPair.a, bestPair.b);
        usedNightsGlobal.add(bestPair.a);
        usedNightsGlobal.add(bestPair.b);

        tasks.push({
          machine_id: m.id,
          machine_code: m.code,
          technician_id: techId,
          sequence: 1,
          scheduled_date: bestPair.a,
          latest_allowed_date: toleranceDate(bestPair.a, techNights)
        });

        tasks.push({
          machine_id: m.id,
          machine_code: m.code,
          technician_id: techId,
          sequence: 2,
          scheduled_date: bestPair.b,
          latest_allowed_date: toleranceDate(bestPair.b, techNights)
        });
      } else {
        warnings.push(`Could not place 2 PMs for machine ${m.code} (insufficient free nights).`);
      }
    }

    // Place 1-PM machines
    for (const m of machines1PM) {
      if (freeNights.length === 0) {
        warnings.push(`Could not place PM for machine ${m.code} (no free nights remaining).`);
        continue;
      }

      let bestNight = null;
      let maxMinDist = -1;
      let minMidDist = Infinity;

      for (const n of freeNights) {
        // Calculate min distance to already placed dates for this tech
        let minDist = Infinity;
        for (const p of placedDates) {
          const d = Math.abs(Math.round((new Date(n).getTime() - new Date(p).getTime()) / (1000 * 60 * 60 * 24)));
          if (d < minDist) minDist = d;
        }
        if (placedDates.length === 0) minDist = 0;

        const dayNum = parseInt(n.split('-')[2], 10);
        const midDist = Math.abs(dayNum - 15);

        if (minDist > maxMinDist || (minDist === maxMinDist && midDist < minMidDist)) {
          maxMinDist = minDist;
          minMidDist = midDist;
          bestNight = n;
        }
      }

      if (bestNight) {
        freeNights = freeNights.filter(n => n !== bestNight);
        placedDates.push(bestNight);
        usedNightsGlobal.add(bestNight);

        tasks.push({
          machine_id: m.id,
          machine_code: m.code,
          technician_id: techId,
          sequence: 1,
          scheduled_date: bestNight,
          latest_allowed_date: toleranceDate(bestNight, techNights)
        });
      }
    }
  }

  // Global Hard Constraint Check (R8)
  const dateCounts = {};
  for (const t of tasks) {
    dateCounts[t.scheduled_date] = (dateCounts[t.scheduled_date] || 0) + 1;
    if (dateCounts[t.scheduled_date] > 1) {
      warnings.push(`Conflict: Night ${t.scheduled_date} has more than 1 scheduled PM (Rule R8 violation).`);
    }
  }

  return { tasks, warnings };
}
