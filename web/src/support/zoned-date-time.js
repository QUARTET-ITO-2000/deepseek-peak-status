/**
 * Wall-clock arithmetic in an arbitrary IANA time zone.
 *
 * This is the only module in the port with no Swift counterpart: Foundation
 * delegates zone arithmetic to ICU, and the browser has to do it itself.
 * `Intl.DateTimeFormat.formatToParts` is the only dependency-free primitive
 * available, so every function here is built on top of it.
 *
 * Why not Temporal: as of late 2026 it is still not in a stable Safari, and
 * shipping a polyfill would break the "zero dependencies" premise. Everything
 * here is deliberately second-precision, matching the granularity of
 * `Intl` parts and of the ICS feed.
 *
 * A "Civil" value is a plain object `{year, month, day, hour, minute, second}`
 * interpreted as wall-clock fields in some zone. It is *not* an instant; use
 * `instantFromCivil` to turn one into a millisecond epoch value.
 */

const FORMATTER_CACHE = new Map();
const OFFSET_CACHE = new Map();

/** Pinned so a Thai/Buddhist or Arabic locale cannot return 2569 or non-ASCII digits. */
const FORMAT_OPTIONS = Object.freeze({
  calendar: 'gregory',
  numberingSystem: 'latn',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // Without this, `Intl` numbers years *within an era*: the year before 1 AD
  // comes back as "1", not as 0 or -1. `partsToCivil` folds the era back in so
  // that `year` is an astronomical year, matching `Date.UTC`, `toISOString` and
  // `daysFromCivil`. Left out, every conversion of a year <= 0 disagreed with
  // the rest of the module by a whole year — which `offsetMsAt` turned into an
  // offset of 366 days and `instantFromCivil` then subtracted.
  era: 'short',
});

function formatterFor(timeZone) {
  let formatter = FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    // An unknown identifier throws a RangeError; callers guard with
    // `isValidTimeZone` or `assertValidTimeZone` first.
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, ...FORMAT_OPTIONS });
    FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** `true` when `identifier` is an IANA zone this engine recognises. */
export function isValidTimeZone(identifier) {
  if (typeof identifier !== 'string' || identifier.length === 0) return false;
  try {
    formatterFor(identifier);
    return true;
  } catch {
    return false;
  }
}

/** Throws a RangeError-shaped error for an unknown zone, matching `Intl`. */
export function assertValidTimeZone(identifier) {
  return formatterFor(identifier);
}

function partsToCivil(parts) {
  const civil = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  let era = null;
  for (const part of parts) {
    switch (part.type) {
      case 'year': civil.year = Number(part.value); break;
      case 'month': civil.month = Number(part.value); break;
      case 'day': civil.day = Number(part.value); break;
      case 'hour': civil.hour = Number(part.value); break;
      case 'minute': civil.minute = Number(part.value); break;
      case 'second': civil.second = Number(part.value); break;
      case 'era': era = part.value; break;
      default: break;
    }
  }
  // `Intl` counts years inside an era, so 1 BC arrives as `{year: 1, era: 'BC'}`
  // and 10 BC as `{year: 10, era: 'BC'}`. Fold it into an astronomical year
  // (1 BC -> 0, 10 BC -> -9) so that the value returned here means the same
  // thing as a year handed to `Date.UTC` or `daysFromCivil`. The locale is
  // pinned to en-US above, so the short era is exactly 'BC'; `startsWith` also
  // tolerates an engine that spells out 'BCE'.
  if (era != null && era.startsWith('B')) civil.year = 1 - civil.year;
  // Some engines report midnight as 24 under a 24-hour cycle; h23 should not,
  // but the mapping is cheap insurance and matches the plan's warning.
  if (civil.hour === 24) civil.hour = 0;
  return civil;
}

/** Days in one complete 400-year Gregorian cycle. */
const DAYS_PER_400_YEARS = 146_097;

/**
 * `Date.UTC`, with its two-digit-year quirk removed.
 *
 * `Date.UTC` reads a year of 0–99 as `1900 + year`, so `Date.UTC(99, 0, 1)` is
 * 1999. `daysFromCivil` / `civilFromDays` below are plain arithmetic and carry
 * no such quirk, so without this the two halves of this module would disagree
 * about the very same civil date. Shifting by a whole 400-year cycle lands on
 * the same day of the same leap cycle, which makes the correction exact rather
 * than approximate. `month` is 0-based, as `Date.UTC` expects.
 *
 * **Every** `Date.UTC` call in this module goes through here. Fixing only
 * `instantFromCivil` is not enough: `offsetMsAt` builds its offset with the same
 * call, so a quirked year there produces an offset that is wrong by ~1900 years
 * and cancels the correction out again. Negative years are left to `Date.UTC`,
 * which does *not* apply the quirk below zero.
 */
function utcMillis(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year >= 0 && year <= 99) {
    return Date.UTC(year + 400, month, day, hour, minute, second)
      - DAYS_PER_400_YEARS * 86_400_000;
  }
  return Date.UTC(year, month, day, hour, minute, second);
}

/** Normalises a partial Civil value, filling missing time fields with zero. */
export function normalizeCivil(civil) {
  return {
    year: civil.year,
    month: civil.month,
    day: civil.day,
    hour: civil.hour ?? 0,
    minute: civil.minute ?? 0,
    second: civil.second ?? 0,
  };
}

/** The wall clock in `timeZone` at `instantMs`. */
export function zonedParts(instantMs, timeZone) {
  const base = Math.floor(instantMs / 1000) * 1000;
  return partsToCivil(formatterFor(timeZone).formatToParts(new Date(base)));
}

/**
 * The zone's offset from UTC at `instantMs`, in milliseconds, east positive.
 *
 * Memoised per second per zone, because the recurrence expander calls this in
 * a tight loop.
 */
export function offsetMsAt(instantMs, timeZone) {
  const base = Math.floor(instantMs / 1000) * 1000;
  const key = `${timeZone}|${base}`;
  const cached = OFFSET_CACHE.get(key);
  if (cached !== undefined) return cached;

  const parts = partsToCivil(formatterFor(timeZone).formatToParts(new Date(base)));
  // `utcMillis`, not `Date.UTC`: the wall clock read back here can be any year,
  // including 0–99, and a `Date.UTC` year would be read as `1900 + year` and
  // turn a real offset into a ~1900-year one. That bogus offset would then be
  // subtracted in `instantFromCivil`, which is exactly how a "corrected"
  // `instantFromCivil` still landed in the wrong millennium.
  const asUTC = utcMillis(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour === 24 ? 0 : parts.hour,
    parts.minute,
    parts.second,
  );
  const offset = asUTC - base;

  // Bound the memo so a long-running tab cannot grow it without limit.
  if (OFFSET_CACHE.size > 200_000) OFFSET_CACHE.clear();
  OFFSET_CACHE.set(key, offset);
  return offset;
}

/**
 * The instant at which the wall clock in `timeZone` reads `civil`.
 *
 * Two passes of offset search cover ordinary days. When the two passes
 * disagree the wall time falls in a daylight-saving gap or overlap, and the
 * `'compatible'` convention applies: an overlap yields the earlier instant and
 * a gap skips forward past the hour that does not exist.
 */
export function instantFromCivil(civil, timeZone) {
  const c = normalizeCivil(civil);
  const localTS = utcMillis(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  // A year outside the Date range (or a NaN field) has no representable
  // instant; report that rather than letting `Intl` throw on an invalid Date.
  if (!Number.isFinite(localTS)) return NaN;

  const firstGuess = offsetMsAt(localTS - 86_400_000, timeZone);
  let utc = localTS - firstGuess;
  const secondGuess = offsetMsAt(utc, timeZone);
  if (secondGuess === firstGuess) return utc;

  utc = localTS - secondGuess;
  const thirdGuess = offsetMsAt(utc, timeZone);
  if (secondGuess === thirdGuess) return utc;

  return localTS - Math.min(secondGuess, thirdGuess);
}

// MARK: - Pure calendar arithmetic
//
// These never touch a time zone: they shift the *fields*, which is what keeps
// `FREQ=DAILY` at a fixed local time across a DST transition.

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant). */
function daysFromCivil(year, month, day) {
  let y = year;
  y -= month <= 2 ? 1 : 0;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of `daysFromCivil`. */
function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/**
 * Number of days in a Gregorian month, or `NaN` when `month` is outside 1–12.
 *
 * `NaN` rather than `undefined` is load-bearing. Every caller compares the
 * result with `<` or `>` to validate a day number, and *both* comparisons are
 * `false` against `undefined` — so an out-of-range month would sail through the
 * range check and only surface several frames later as a `NaN` date. A value
 * that is already non-finite fails those comparisons in a way callers can test
 * for, which is what `recurrence-expander.dateInMonth` now does.
 */
export function daysInCivilMonth(year, month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return NaN;
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Shifts the calendar day by `n`, keeping the time of day. */
export function addCivilDays(civil, n) {
  const c = normalizeCivil(civil);
  const shifted = civilFromDays(daysFromCivil(c.year, c.month, c.day) + n);
  return { ...shifted, hour: c.hour, minute: c.minute, second: c.second };
}

/** Shifts the calendar month by `n`, clamping the day to the target month. */
export function addCivilMonths(civil, n) {
  const c = normalizeCivil(civil);
  const total = c.year * 12 + (c.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  const day = Math.min(c.day, daysInCivilMonth(year, month));
  return { year, month, day, hour: c.hour, minute: c.minute, second: c.second };
}

/** Shifts the calendar year by `n`, clamping 29 February to 28 February. */
export function addCivilYears(civil, n) {
  const c = normalizeCivil(civil);
  const year = c.year + n;
  const day = Math.min(c.day, daysInCivilMonth(year, c.month));
  return { year, month: c.month, day, hour: c.hour, minute: c.minute, second: c.second };
}

/**
 * ISO weekday index: 1 = Sunday … 7 = Saturday, matching `Calendar.weekday`.
 *
 * Derived from `daysFromCivil` rather than `Date.UTC` so that it cannot
 * disagree with the rest of this file. `Date.UTC` reads a year of 0–99 as
 * `1900 + year`, so it would report the weekday of 1999-01-01 for 0099-01-01
 * while `addCivilDays` (which goes through `daysFromCivil`) would report the
 * weekday of 0099-01-01 — the same civil date, two answers.
 */
export function civilWeekday(civil) {
  const c = normalizeCivil(civil);
  const days = daysFromCivil(c.year, c.month, c.day);
  // 1970-01-01 is day 0 and was a Thursday, i.e. index 4 of a Sunday-first week.
  // The extra `+ 7` keeps the modulo non-negative for dates before 1970.
  return ((days + 4) % 7 + 7) % 7 + 1;
}

/** A `yyyyMMdd` integer that orders the same way the dates do. */
export function civilDayKey(civil) {
  const c = normalizeCivil(civil);
  return c.year * 10_000 + c.month * 100 + c.day;
}

/** The number of whole calendar days from `a` to `b` (b - a). */
export function civilDaysBetween(a, b) {
  return daysFromCivil(b.year, b.month, b.day) - daysFromCivil(a.year, a.month, a.day);
}

/** Milliseconds between two instants, as a `{start, end}`-free helper. */
export function startOfCivilDay(civil) {
  const c = normalizeCivil(civil);
  return { year: c.year, month: c.month, day: c.day, hour: 0, minute: 0, second: 0 };
}
