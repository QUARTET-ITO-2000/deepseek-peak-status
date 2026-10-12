/**
 * The days DeepSeek bills entirely at off-peak rates, regardless of the hours
 * the published peak-hours feed lists for them.
 *
 * Ported from `OffPeakCalendar.swift`. DeepSeek's published rule is "Beijing
 * time Monday to Friday (excluding Chinese statutory holidays), 09:00–12:00 and
 * 14:00–18:00 are peak; all other times, including weekends and the whole of a
 * Chinese statutory holiday, are off-peak". A weekend designated as a make-up
 * working day (调休) is billed off-peak as well.
 *
 * This type carries only the *date* half of the rule: it can only ever remove
 * peak windows, never add one.
 */

import {
  zonedParts,
  instantFromCivil,
  addCivilDays,
  civilWeekday,
  civilDayKey,
  normalizeCivil,
} from '../support/zoned-date-time.js';
import { Interval } from '../support/interval.js';
import { OffPeakReason } from './peak-state.js';

const BEIJING = 'Asia/Shanghai';
/** Upper bound on the days expanded for one query (two years). */
const MAXIMUM_EXPANDED_DAYS = 800;

export class OffPeakCalendar {
  /**
   * The rule is stated in Beijing time, so day boundaries are drawn there.
   * Asia/Shanghai has no daylight saving, so the offset is fixed.
   */
  static timeZoneIdentifier = BEIJING;

  /**
   * @param {Map<number,string>} holidays Beijing day key -> holiday name
   * @param {Map<number,string>} makeUpWorkdays day key -> holiday name
   * @param {Set<number>} coveredYears years whose arrangement has been loaded
   */
  constructor({ holidays = new Map(), makeUpWorkdays = new Map(), coveredYears = new Set() } = {}) {
    this.holidays = holidays;
    this.makeUpWorkdays = makeUpWorkdays;
    this.coveredYears = coveredYears;
  }

  /** A calendar that only knows about weekends. */
  static weekendsOnly() {
    return new OffPeakCalendar();
  }

  get isEmpty() {
    return this.holidays.size === 0 && this.makeUpWorkdays.size === 0 && this.coveredYears.size === 0;
  }

  /** Statutory days off recorded, across every covered year. */
  get holidayCount() {
    return this.holidays.size;
  }

  /** Make-up working days recorded, across every covered year. */
  get makeUpWorkdayCount() {
    return this.makeUpWorkdays.size;
  }

  // MARK: - Day keys

  /** A Beijing calendar day as `yyyyMMdd`, which orders like the date does. */
  static dayKey(year, month, day) {
    return year * 10_000 + month * 100 + day;
  }

  /** The Beijing calendar day containing `date`. */
  static dayKeyFor(date) {
    return civilDayKey(zonedParts(date, BEIJING));
  }

  static #startOfBeijingDay(date) {
    const c = zonedParts(date, BEIJING);
    return instantFromCivil({ year: c.year, month: c.month, day: c.day, hour: 0, minute: 0, second: 0 }, BEIJING);
  }

  static #startsOfDays(from, to, limit) {
    const days = [];
    let currentCivil = zonedParts(OffPeakCalendar.#startOfBeijingDay(from), BEIJING);
    let current = instantFromCivil(normalizeCivil(currentCivil), BEIJING);
    while (current < to && days.length < limit) {
      days.push(current);
      currentCivil = addCivilDays(currentCivil, 1);
      current = instantFromCivil(normalizeCivil(currentCivil), BEIJING);
    }
    return days;
  }

  // MARK: - Queries

  /** `true` when the whole Beijing day containing `date` is off-peak. */
  isOffPeakDay(date) {
    const day = OffPeakCalendar.dayKeyFor(date);
    return this.holidays.has(day) || this.isWeekend(date);
  }

  /** `true` for a Saturday or Sunday in Beijing time. */
  isWeekend(date) {
    const weekday = civilWeekday(zonedParts(date, BEIJING));
    return weekday === 1 || weekday === 7;
  }

  /** The holiday name published for the Beijing day containing `date`. */
  holidayName(date) {
    return this.holidays.get(OffPeakCalendar.dayKeyFor(date)) ?? null;
  }

  /**
   * Why `date` is off-peak because of a date rule, or `null` when the day is an
   * ordinary working day (where off-peak simply means "between windows").
   */
  reason(date) {
    const day = OffPeakCalendar.dayKeyFor(date);
    const holiday = this.holidays.get(day);
    if (holiday != null) return OffPeakReason.holiday(holiday);
    if (!this.isWeekend(date)) return null;
    const makeUp = this.makeUpWorkdays.get(day);
    if (makeUp != null) return OffPeakReason.makeUpWorkday(makeUp);
    return OffPeakReason.weekend;
  }

  /**
   * Whole off-peak days intersecting `range`, as intervals in absolute time.
   *
   * Intervals are not clipped to `range`: a day that starts before the range
   * still describes the whole day, which is what subtraction needs.
   */
  suppressedIntervals(range) {
    if (range.durationMs <= 0) return [];
    const starts = OffPeakCalendar.#startsOfDays(range.start, range.end, MAXIMUM_EXPANDED_DAYS);
    const intervals = [];
    for (const dayStart of starts) {
      if (!this.isOffPeakDay(dayStart)) continue;
      const civil = addCivilDays(zonedParts(dayStart, BEIJING), 1);
      const dayEnd = instantFromCivil(normalizeCivil(civil), BEIJING);
      intervals.push(new Interval(dayStart, dayEnd));
    }
    return intervals;
  }

  /**
   * Years spanned by `range` whose holiday arrangement has not been loaded.
   *
   * A non-empty result is expected, not an error: the State Council usually
   * publishes the next year's arrangement in November or December.
   */
  uncoveredYears(range) {
    const first = zonedParts(range.start, BEIJING).year;
    const last = zonedParts(range.end, BEIJING).year;
    if (first > last) return [];
    const uncovered = [];
    for (let year = first; year <= last; year += 1) {
      if (!this.coveredYears.has(year)) uncovered.push(year);
    }
    return uncovered;
  }
}
