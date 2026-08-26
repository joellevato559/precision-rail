/**
 * Overtime on HOURLY WORK only (not drive time).
 *
 * Triggers:
 * - Over 8 hours in a single workday → 1.5× work rate
 * - Over 12 hours in a single workday → 2× work rate
 * - Over 40 hours in a workweek → 1.5× work rate
 * - 7th consecutive day with work: first 8h @ 1.5×, over 8h @ 2×
 *
 * When daily and weekly OT both apply, pay the HIGHER of:
 *   A) Daily-method total (8 / 12 / 7th-day rules, no weekly conversion)
 *   B) Weekly-method total (40h threshold + still honor daily 2× over 12 and 7th-day)
 */

function dayKey(iso, timeZone = 'America/Chicago') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

function addDays(yyyyMmDd, n) {
  const d = new Date(yyyyMmDd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isSeventhConsecutive(workedDates, date) {
  const set = new Set(workedDates);
  if (!set.has(date)) return false;
  for (let i = 1; i <= 6; i++) {
    if (!set.has(addDays(date, -i))) return false;
  }
  return true;
}

/** Daily OT buckets: 8→1.5x, 12→2x, or 7th-day rules */
function splitDailyHours(totalHours, isSeventhConsecutive) {
  const h = Math.max(0, Number(totalHours) || 0);
  if (h === 0) return { regular: 0, ot15: 0, ot20: 0 };

  if (isSeventhConsecutive) {
    return {
      regular: 0,
      ot15: Math.min(h, 8),
      ot20: Math.max(0, h - 8)
    };
  }

  return {
    regular: Math.min(h, 8),
    ot15: Math.min(Math.max(0, h - 8), 4),
    ot20: Math.max(0, h - 12)
  };
}

function payFromBuckets(regular, ot15, ot20, workRate) {
  return regular * workRate * 1.0 + ot15 * workRate * 1.5 + ot20 * workRate * 2.0;
}

/**
 * Path A — daily method only (no weekly OT upgrade)
 */
function computeDailyMethod(workByDay, workedDates, workRate) {
  const days = Object.keys(workByDay)
    .sort()
    .map((date) => {
      const workHours = workByDay[date];
      const seventh = isSeventhConsecutive(workedDates, date);
      const b = splitDailyHours(workHours, seventh);
      const dayPay = payFromBuckets(b.regular, b.ot15, b.ot20, workRate);
      return {
        date,
        workHours,
        isSeventhConsecutive: seventh,
        ...b,
        dayPay
      };
    });

  const totals = days.reduce(
    (a, d) => ({
      regularHours: a.regularHours + d.regular,
      ot15Hours: a.ot15Hours + d.ot15,
      ot20Hours: a.ot20Hours + d.ot20,
      regularPay: a.regularPay + d.regular * workRate,
      ot15Pay: a.ot15Pay + d.ot15 * workRate * 1.5,
      ot20Pay: a.ot20Pay + d.ot20 * workRate * 2.0,
      workPay: a.workPay + d.dayPay
    }),
    { regularHours: 0, ot15Hours: 0, ot20Hours: 0, regularPay: 0, ot15Pay: 0, ot20Pay: 0, workPay: 0 }
  );

  return { days, totals };
}

/**
 * Path B — weekly method:
 * 1) Lock daily double-time (over 12) and 7th-day premiums (always required)
 * 2) Remaining hours: first 40 at 1×, excess at 1.5×
 */
function computeWeeklyMethod(workByDay, workedDates, workRate) {
  const dates = Object.keys(workByDay).sort();
  const dayMeta = dates.map((date) => {
    const workHours = workByDay[date];
    const seventh = isSeventhConsecutive(workedDates, date);
    let lockedOt15 = 0;
    let lockedOt20 = 0;
    let remaining = workHours;

    if (seventh) {
      // Entire day is premium; first 8 @ 1.5, rest @ 2
      lockedOt15 = Math.min(workHours, 8);
      lockedOt20 = Math.max(0, workHours - 8);
      remaining = 0;
    } else if (workHours > 12) {
      lockedOt20 = workHours - 12;
      remaining = 12; // will split into regular/ot via weekly pool, then daily 8–12 as OT if weekly doesn't already
      // For weekly path: hours 8-12 can be regular or weekly OT; over 12 locked as DT
    }

    return { date, workHours, isSeventhConsecutive: seventh, lockedOt15, lockedOt20, remaining };
  });

  // Pool remaining hours for weekly 40 threshold (non-seventh, including first 12 of long days)
  let pool = dayMeta.reduce((s, d) => s + d.remaining, 0);
  let weeklyRegular = Math.min(pool, 40);
  let weeklyOt15 = Math.max(0, pool - 40);

  // Allocate weekly regular/ot15 back to days proportionally by remaining
  const days = dayMeta.map((d) => {
    let regular = 0;
    let ot15 = d.lockedOt15;
    let ot20 = d.lockedOt20;

    if (d.remaining > 0 && pool > 0) {
      const share = d.remaining / pool;
      let dayReg = weeklyRegular * share;
      let dayOt = weeklyOt15 * share;

      // Also enforce daily OT for hours 8–12 within remaining when weekly left them as "regular"
      // remaining is at most 12 on non-seventh days
      if (!d.isSeventhConsecutive && d.workHours > 8) {
        // Of the first 12 hours, hours 8-12 should be at least 1.5x
        const mustOt = Math.min(4, Math.max(0, Math.min(d.workHours, 12) - 8));
        // dayReg + dayOt = remaining; move from regular to ot15 to satisfy daily 8h rule if needed
        const currentOtInRemaining = dayOt;
        if (currentOtInRemaining < mustOt) {
          const need = mustOt - currentOtInRemaining;
          const fromReg = Math.min(dayReg, need);
          dayReg -= fromReg;
          dayOt += fromReg;
        }
      }

      regular += dayReg;
      ot15 += dayOt;
    }

    const dayPay = payFromBuckets(regular, ot15, ot20, workRate);
    return {
      date: d.date,
      workHours: d.workHours,
      isSeventhConsecutive: d.isSeventhConsecutive,
      regular,
      ot15,
      ot20,
      dayPay
    };
  });

  const totals = days.reduce(
    (a, d) => ({
      regularHours: a.regularHours + d.regular,
      ot15Hours: a.ot15Hours + d.ot15,
      ot20Hours: a.ot20Hours + d.ot20,
      regularPay: a.regularPay + d.regular * workRate,
      ot15Pay: a.ot15Pay + d.ot15 * workRate * 1.5,
      ot20Pay: a.ot20Pay + d.ot20 * workRate * 2.0,
      workPay: a.workPay + d.dayPay
    }),
    { regularHours: 0, ot15Hours: 0, ot20Hours: 0, regularPay: 0, ot15Pay: 0, ot20Pay: 0, workPay: 0 }
  );

  return { days, totals };
}

function computeDriverOvertime({ sessions = [], drives = [], workRate = 0, driveRate = 0, timeZone = 'America/Chicago' }) {
  const workByDay = {};
  for (const s of sessions) {
    const d = dayKey(s.clock_in, timeZone);
    if (!workByDay[d]) workByDay[d] = 0;
    workByDay[d] += Number(s.hours) || 0;
  }

  let driveHours = 0;
  for (const dr of drives) {
    driveHours += Number(dr.hours) || 0;
  }
  const drivePay = driveHours * driveRate;

  const workedDates = Object.keys(workByDay)
    .filter((d) => workByDay[d] > 0)
    .sort();

  const dailyMethod = computeDailyMethod(workByDay, workedDates, workRate);
  const weeklyMethod = computeWeeklyMethod(workByDay, workedDates, workRate);

  // Pay the higher total when daily vs weekly OT overlap
  const useWeekly = weeklyMethod.totals.workPay > dailyMethod.totals.workPay + 1e-9;
  const chosen = useWeekly ? weeklyMethod : dailyMethod;
  const methodUsed = useWeekly ? 'weekly' : 'daily';

  const workHours = Object.values(workByDay).reduce((a, b) => a + b, 0);

  return {
    methodUsed,
    dailyMethodPay: dailyMethod.totals.workPay,
    weeklyMethodPay: weeklyMethod.totals.workPay,
    days: chosen.days,
    totals: {
      workHours,
      driveHours,
      regularHours: chosen.totals.regularHours,
      ot15Hours: chosen.totals.ot15Hours,
      ot20Hours: chosen.totals.ot20Hours,
      regularPay: chosen.totals.regularPay,
      ot15Pay: chosen.totals.ot15Pay,
      ot20Pay: chosen.totals.ot20Pay,
      drivePay,
      workPay: chosen.totals.workPay,
      totalPay: chosen.totals.workPay + drivePay,
      workRate,
      driveRate
    },
    comparison: {
      dailyMethodPay: dailyMethod.totals.workPay,
      weeklyMethodPay: weeklyMethod.totals.workPay,
      paidMethod: methodUsed,
      note: 'Employer pays the higher of daily-method vs weekly-method work OT totals'
    },
    rules: {
      scope: 'work_hours_only',
      dailyOtAfter: 8,
      dailyDtAfter: 12,
      weeklyOtAfter: 40,
      overlap: 'higher_of_daily_or_weekly',
      drive: 'flat drive rate only — no OT'
    }
  };
}

module.exports = {
  computeDriverOvertime,
  splitDailyHours,
  isSeventhConsecutive,
  dayKey,
  computeDailyMethod,
  computeWeeklyMethod
};
