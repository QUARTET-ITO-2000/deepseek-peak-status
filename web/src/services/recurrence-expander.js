/**
 * Expands a peak event into concrete windows.
 *
 * Ported from `RecurrenceExpander.swift`. The expander is intentionally
 * dependency free: recurrence is computed from the event's wall clock in its
 * own time zone so DST transitions behave correctly. All arithmetic happens on
 * the event's own zone via `zoned-date-time.js`; nothing here ever adds a flat
 * 86 400 000 ms to move a day forward.
 */

import {
  zonedParts,
  instantFromCivil,
  addCivilDays,
  addCivilMonths,
  addCivilYears,
  civilWeekday,
  civilDaysBetween,
  daysInCivilMonth,
  normalizeCivil,
} from '../support/zoned-date-time.js';
import { Interval } from '../support/interval.js';
import { WEEKDAY_CALENDAR_INDEX } from '../models/recurrence-rule.js';

/** Upper bound on expanded periods, guarding against pathological rules. */
const MAXIMUM_PERIODS = 20_000;

// MARK: - Zone-aware calendar helpers

function civilOf(ms, tz) {
  return zonedParts(ms, tz);
}

function instantOf(civil, tz) {
  return instantFromCivil(normalizeCivil(civil), tz);
}

/** Midnight at the start of the zone-local day containing `ms`. */
function startOfDay(ms, tz) {
  const c = civilOf(ms, tz);
  return instantOf({ year: c.year, month: c.month, day: c.day, hour: 0, minute: 0, second: 0 }, tz);
}

/** Midnight at the start of the zone-local week containing `ms`. */
function startOfWeek(ms, tz, firstWeekday) {
  const c = civilOf(ms, tz);
  const weekday = civilWeekday(c);
  const offset = ((weekday - firstWeekday) + 7) % 7;
  const day = addCivilDays({ year: c.year, month: c.month, day: c.day }, -offset);
  return instantOf({ ...day, hour: 0, minute: 0, second: 0 }, tz);
}

function startOfMonth(ms, tz) {
  const c = civilOf(ms, tz);
  return instantOf({ year: c.year, month: c.month, day: 1, hour: 0, minute: 0, second: 0 }, tz);
}

function startOfYear(ms, tz) {
  const c = civilOf(ms, tz);
  return instantOf({ year: c.year, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, tz);
}

/** Sets the wall-clock time of `day` to the reference time of day. */
function combining(dayMs, timeOfDay, tz) {
  const c = civilOf(dayMs, tz);
  return instantOf({ year: c.year, month: c.month, day: c.day, ...timeOfDay }, tz);
}

function timeOfDayOf(ms, tz) {
  const c = civilOf(ms, tz);
  return { hour: c.hour, minute: c.minute, second: c.second };
}

// MARK: - Period arithmetic

function periodAnchor(frequency, startDate, tz, firstWeekday) {
  switch (frequency) {
    case 'DAILY': return startOfDay(startDate, tz);
    case 'WEEKLY': return startOfWeek(startDate, tz, firstWeekday);
    case 'MONTHLY': return startOfMonth(startDate, tz);
    case 'YEARLY': return startOfYear(startDate, tz);
    default: return startOfDay(startDate, tz);
  }
}

function periodStartOf(index, anchorCivil, frequency, interval, tz) {
  // An overflowing step is reported as "no such period" rather than trapping,
  // mirroring `multipliedReportingOverflow` plus Foundation refusing a date it
  // cannot represent.
  const step = index * interval;
  if (!Number.isSafeInteger(step)) return null;
  let result;
  switch (frequency) {
    case 'DAILY': result = instantOf(addCivilDays(anchorCivil, step), tz); break;
    case 'WEEKLY': result = instantOf(addCivilDays(anchorCivil, step * 7), tz); break;
    case 'MONTHLY': result = instantOf(addCivilMonths(anchorCivil, step), tz); break;
    case 'YEARLY': result = instantOf(addCivilYears(anchorCivil, step), tz); break;
    default: return null;
  }
  return Number.isFinite(result) ? result : null;
}

/**
 * Skips periods that end before the requested range.
 *
 * Only used when the rule has no `COUNT`, because `COUNT` is measured from
 * `DTSTART` and skipping periods would break the count.
 */
function fastForwardIndex(rule, startDate, rangeStart, tz, firstWeekday) {
  if (rule.count != null || !(rangeStart > startDate)) return 0;
  const interval = Math.max(1, rule.interval);
  switch (rule.frequency) {
    case 'DAILY': {
      const days = civilDaysBetween(civilOf(startOfDay(startDate, tz), tz), civilOf(startOfDay(rangeStart, tz), tz));
      return Math.max(0, Math.floor(days / interval) - 2);
    }
    case 'WEEKLY': {
      const weeks = civilDaysBetween(
        civilOf(startOfWeek(startDate, tz, firstWeekday), tz),
        civilOf(startOfWeek(rangeStart, tz, firstWeekday), tz),
      ) / 7;
      return Math.max(0, Math.floor(weeks / interval) - 2);
    }
    case 'MONTHLY': {
      const from = civilOf(startOfMonth(startDate, tz), tz);
      const to = civilOf(startOfMonth(rangeStart, tz), tz);
      const months = (to.year * 12 + to.month) - (from.year * 12 + from.month);
      return Math.max(0, Math.floor(months / interval) - 2);
    }
    case 'YEARLY': {
      const from = civilOf(startOfYear(startDate, tz), tz);
      const to = civilOf(startOfYear(rangeStart, tz), tz);
      const years = to.year - from.year;
      return Math.max(0, Math.floor(years / interval) - 2);
    }
    default:
      return 0;
  }
}

// MARK: - Candidate generation

function matchesWeekdayLimits(date, rule, tz) {
  if (rule.byDay.length === 0) return true;
  const weekday = civilWeekday(civilOf(date, tz));
  const plain = rule.byDay.filter((selector) => selector.ordinal == null).map((s) => WEEKDAY_CALENDAR_INDEX[s.weekday]);
  if (plain.length === 0) return true;
  return plain.includes(weekday);
}

function matchesLimits(date, rule, tz) {
  if (rule.byMonth.length > 0) {
    const month = civilOf(date, tz).month;
    if (!rule.byMonth.includes(month)) return false;
  }
  if (rule.byMonthDay.length > 0) {
    const c = civilOf(date, tz);
    const daysInMonth = daysInCivilMonth(c.year, c.month);
    const normalized = rule.byMonthDay.map((value) => (value > 0 ? value : daysInMonth + value + 1));
    if (!normalized.includes(c.day)) return false;
  }
  return matchesWeekdayLimits(date, rule, tz);
}

function dateInMonth(monthStart, dayOffset, timeOfDay, tz) {
  const c = civilOf(monthStart, tz);
  const daysInMonth = daysInCivilMonth(c.year, c.month);
  // Rejected *before* the range test, because that test cannot see it: `NaN < 1`
  // and `NaN > daysInMonth` are both false, so a non-finite month would sail
  // straight through and hand a NaN instant to the caller. Fails closed to
  // "no such date" rather than to a silently wrong one.
  if (!Number.isFinite(daysInMonth)) return null;
  const normalized = dayOffset > 0 ? dayOffset : daysInMonth + dayOffset + 1;
  if (normalized < 1 || normalized > daysInMonth) return null;
  const day = addCivilDays({ year: c.year, month: c.month, day: 1 }, normalized - 1);
  return instantOf({ ...day, ...timeOfDay }, tz);
}

function dateInWeek(weekStart, weekday, timeOfDay, tz, firstWeekday) {
  const offset = ((WEEKDAY_CALENDAR_INDEX[weekday] - firstWeekday) + 7) % 7;
  const c = civilOf(weekStart, tz);
  const day = addCivilDays({ year: c.year, month: c.month, day: c.day }, offset);
  return instantOf({ ...day, ...timeOfDay }, tz);
}

function dateInYearOf(reference, month, tz) {
  const c = civilOf(reference, tz);
  return instantOf({ year: c.year, month, day: 1, hour: 0, minute: 0, second: 0 }, tz);
}

function nthWeekdayOccurrences(monthStart, weekday, timeOfDay, tz) {
  const c = civilOf(monthStart, tz);
  const daysInMonth = daysInCivilMonth(c.year, c.month);
  const occurrences = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const shifted = addCivilDays({ year: c.year, month: c.month, day: 1 }, day - 1);
    if (civilWeekday(shifted) !== WEEKDAY_CALENDAR_INDEX[weekday]) continue;
    occurrences.push(instantOf({ ...shifted, ...timeOfDay }, tz));
  }
  return occurrences;
}

function nthWeekday(monthStart, weekday, ordinal, timeOfDay, tz) {
  const occurrences = nthWeekdayOccurrences(monthStart, weekday, timeOfDay, tz);
  if (occurrences.length === 0) return null;
  const index = ordinal > 0 ? ordinal - 1 : occurrences.length + ordinal;
  if (index < 0 || index >= occurrences.length) return null;
  return occurrences[index];
}

function datesInMonth(anyDayInMonth, rule, startDate, tz, timeOfDay) {
  const monthStart = startOfMonth(anyDayInMonth, tz);
  if (rule.byMonth.length > 0) {
    const month = civilOf(monthStart, tz).month;
    if (!rule.byMonth.includes(month)) return [];
  }

  if (rule.byMonthDay.length > 0) {
    return rule.byMonthDay
      .map((dayOffset) => dateInMonth(monthStart, dayOffset, timeOfDay, tz))
      .filter((date) => date != null)
      .filter((date) => matchesWeekdayLimits(date, rule, tz));
  }

  if (rule.byDay.length > 0) {
    return rule.byDay
      .map((selector) => {
        if (selector.ordinal == null) {
          const occurrences = nthWeekdayOccurrences(monthStart, selector.weekday, timeOfDay, tz);
          return occurrences.length > 0 ? occurrences[0] : null;
        }
        return nthWeekday(monthStart, selector.weekday, selector.ordinal, timeOfDay, tz);
      })
      .filter((date) => date != null);
  }

  const dayComponent = civilOf(startDate, tz).day;
  const date = dateInMonth(monthStart, dayComponent, timeOfDay, tz);
  return date == null ? [] : [date];
}

function candidateStarts(periodStart, rule, startDate, tz, firstWeekday, timeOfDay) {
  switch (rule.frequency) {
    case 'DAILY': {
      const day = combining(periodStart, timeOfDay, tz);
      return matchesLimits(day, rule, tz) ? [day] : [];
    }
    case 'WEEKLY': {
      const selectors = rule.byDay.length === 0
        ? [{ weekday: weekdayTokenOf(civilOf(startDate, tz)), ordinal: null }]
        : rule.byDay;
      return selectors
        .map((selector) => dateInWeek(periodStart, selector.weekday, timeOfDay, tz, firstWeekday))
        .filter((date) => date != null)
        .filter((date) => matchesLimits(date, rule, tz));
    }
    case 'MONTHLY':
      return datesInMonth(periodStart, rule, startDate, tz, timeOfDay);
    case 'YEARLY': {
      const months = rule.byMonth.length === 0 ? [civilOf(startDate, tz).month] : rule.byMonth;
      return months.flatMap((month) => {
        const monthStart = dateInYearOf(periodStart, month, tz);
        return datesInMonth(monthStart, rule, startDate, tz, timeOfDay);
      });
    }
    default:
      return [];
  }
}

function weekdayTokenOf(civil) {
  const weekday = civilWeekday(civil);
  return Object.keys(WEEKDAY_CALENDAR_INDEX).find((key) => WEEKDAY_CALENDAR_INDEX[key] === weekday) ?? 'MO';
}

// MARK: - Entry point

/**
 * Concrete windows of one event that intersect `range`, in ascending order.
 *
 * @param {object} event a PeakEvent-like object
 * @param {{start: number, end: number}} range
 * @param {number} limit
 * @returns {Interval[]}
 */
export function expandEvent(event, range, limit = 20_000) {
  const startDate = event.firstStart;
  if (startDate == null) return [];

  const tz = event.timeZone;
  const durationMs = (Number.isFinite(event.duration) ? Math.max(0, event.duration) : 0) * 1000;
  const rule = event.recurrenceRule;

  if (rule == null) {
    const window = new Interval(startDate, startDate + durationMs);
    return window.intersects(range) ? [window] : [];
  }

  const firstWeekday = WEEKDAY_CALENDAR_INDEX[rule.weekStart] ?? 2;
  const timeOfDay = timeOfDayOf(startDate, tz);
  const anchorCivil = civilOf(periodAnchor(rule.frequency, startDate, tz, firstWeekday), tz);
  const excluded = new Set(event.excludedDates);

  const results = [];
  let index = fastForwardIndex(rule, startDate, range.start, tz, firstWeekday);
  const deadline = index + MAXIMUM_PERIODS;
  let occurrenceCount = 0;

  while (index < deadline) {
    const periodStart = periodStartOf(index, anchorCivil, rule.frequency, rule.interval, tz);
    index += 1;
    if (periodStart == null) continue;
    if (periodStart >= range.end) break;
    if (rule.until != null && periodStart > rule.until) break;

    const candidates = candidateStarts(periodStart, rule, startDate, tz, firstWeekday, timeOfDay)
      .slice()
      .sort((a, b) => a - b);

    for (const candidate of candidates) {
      if (candidate < startDate) continue;
      if (rule.until != null && candidate > rule.until) return results;

      occurrenceCount += 1;
      if (rule.count != null && occurrenceCount > rule.count) return results;
      if (excluded.has(candidate)) continue;

      const window = new Interval(candidate, candidate + durationMs);
      if (window.end <= range.start) continue;
      if (window.start >= range.end) return results;
      results.push(window);
      if (results.length >= limit) return results;
    }
  }
  return results;
}
