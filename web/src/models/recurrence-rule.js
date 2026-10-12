/**
 * The subset of RFC 5545 recurrence rules required to expand peak-hours
 * schedules.
 *
 * Ported from `RecurrenceRule.swift`. Supported: `FREQ`, `INTERVAL`, `COUNT`,
 * `UNTIL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH` and `WKST` for the `DAILY`,
 * `WEEKLY`, `MONTHLY` and `YEARLY` frequencies. Unsupported parts (for example
 * `BYSETPOS`) are ignored and reported as warnings.
 */

import { ICSDateParser } from '../services/ics-date-parser.js';

/** `Calendar` weekday index: 1 = Sunday … 7 = Saturday. */
export const WEEKDAY_CALENDAR_INDEX = Object.freeze({
  SU: 1, MO: 2, TU: 3, WE: 4, TH: 5, FR: 6, SA: 7,
});

export const FREQUENCIES = Object.freeze(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

/** Strict integer parse: optional sign and digits only, like Swift's `Int(_:)`. */
function strictInt(raw) {
  if (typeof raw !== 'string' || !/^[+-]?\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

function boundedInt(raw, maximum) {
  const parsed = strictInt(raw);
  if (parsed == null || parsed <= 0 || parsed > maximum) return null;
  return parsed;
}

/**
 * A `BYDAY` entry, optionally carrying a monthly/yearly ordinal such as `1MO`
 * or `-1SU`. `ordinal` is `null` for a plain weekday.
 */
export function parseWeekdaySelector(token) {
  const trimmed = String(token).trim().toUpperCase();
  if (trimmed.length < 2) return null;
  const dayToken = trimmed.slice(-2);
  if (!(dayToken in WEEKDAY_CALENDAR_INDEX)) return null;
  const ordinalToken = trimmed.slice(0, -2);
  if (ordinalToken.length === 0) return { weekday: dayToken, ordinal: null };
  const ordinal = strictInt(ordinalToken);
  if (ordinal == null || ordinal === 0) return null;
  return { weekday: dayToken, ordinal };
}

export function weekdaySelectorRaw(selector) {
  if (selector.ordinal == null) return selector.weekday;
  return `${selector.ordinal}${selector.weekday}`;
}

export class RecurrenceRule {
  /** Largest `INTERVAL` accepted from a feed. */
  static maximumInterval = 10_000;
  /** Largest `COUNT` accepted from a feed. */
  static maximumCount = 20_000;

  constructor({
    frequency,
    interval = 1,
    count = null,
    until = null,
    byDay = [],
    byMonthDay = [],
    byMonth = [],
    weekStart = 'MO',
    unsupportedParts = [],
  }) {
    this.frequency = frequency;
    this.interval = Math.max(1, interval);
    this.count = count;
    this.until = until;
    this.byDay = byDay;
    this.byMonthDay = byMonthDay;
    this.byMonth = byMonth;
    this.weekStart = weekStart;
    this.unsupportedParts = unsupportedParts;
  }

  /**
   * Parses a `RRULE` value such as `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`.
   *
   * An unusable numeric part (`INTERVAL`/`COUNT` out of bounds) rejects the
   * whole rule so the event degrades to a single occurrence, which can only
   * drop windows, never invent them.
   *
   * @param {string} value the raw rule value (after `RRULE:`)
   * @param {string} defaultTimeZone zone used for a floating `UNTIL` value
   * @returns {RecurrenceRule|null}
   */
  static parse(value, defaultTimeZone = 'UTC') {
    let frequency = null;
    let interval = 1;
    let count = null;
    let until = null;
    let byDay = [];
    let byMonthDay = [];
    let byMonth = [];
    let weekStart = 'MO';
    const unsupported = [];

    for (const part of String(value).split(';')) {
      if (part.length === 0) continue;
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      const key = part.slice(0, separator).trim().toUpperCase();
      const rawValue = part.slice(separator + 1).trim();

      switch (key) {
        case 'FREQ': {
          const token = rawValue.toUpperCase();
          frequency = FREQUENCIES.includes(token) ? token : null;
          break;
        }
        case 'INTERVAL': {
          const parsed = boundedInt(rawValue, RecurrenceRule.maximumInterval);
          if (parsed == null) return null;
          interval = parsed;
          break;
        }
        case 'COUNT': {
          const parsed = boundedInt(rawValue, RecurrenceRule.maximumCount);
          if (parsed == null) return null;
          count = parsed;
          break;
        }
        case 'UNTIL': {
          const parsed = ICSDateParser.parse(rawValue, defaultTimeZone);
          until = parsed ? parsed.date : null;
          break;
        }
        case 'BYDAY':
          byDay = rawValue
            .split(',')
            .map((token) => parseWeekdaySelector(token.trim()))
            .filter((selector) => selector != null);
          break;
        case 'BYMONTHDAY':
          byMonthDay = rawValue
            .split(',')
            .map((token) => strictInt(token.trim()))
            .filter((value) => value != null);
          break;
        case 'BYMONTH':
          byMonth = rawValue
            .split(',')
            .map((token) => strictInt(token.trim()))
            .filter((value) => value != null);
          break;
        case 'WKST': {
          const token = rawValue.toUpperCase();
          if (token in WEEKDAY_CALENDAR_INDEX) weekStart = token;
          break;
        }
        default:
          unsupported.push(key);
          break;
      }
    }

    if (frequency == null) return null;
    return new RecurrenceRule({
      frequency,
      interval,
      count,
      until,
      byDay,
      byMonthDay,
      byMonth,
      weekStart,
      unsupportedParts: unsupported,
    });
  }

  /** Human readable summary used by diagnostics. */
  get descriptionText() {
    const parts = [`FREQ=${this.frequency}`];
    if (this.interval !== 1) parts.push(`INTERVAL=${this.interval}`);
    if (this.count != null) parts.push(`COUNT=${this.count}`);
    if (this.until != null) parts.push('UNTIL=<absolute>');
    if (this.byDay.length > 0) parts.push(`BYDAY=${this.byDay.map(weekdaySelectorRaw).join(',')}`);
    if (this.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${this.byMonthDay.join(',')}`);
    if (this.byMonth.length > 0) parts.push(`BYMONTH=${this.byMonth.join(',')}`);
    return parts.join(';');
  }
}
