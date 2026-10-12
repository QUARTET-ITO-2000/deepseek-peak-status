/**
 * A defensive reader for `holiday-cn` year documents.
 *
 * Ported from `HolidayDataParser.swift`. The holiday payload is the second
 * piece of untrusted network input the page handles, so it is read with the
 * same posture as the peak-hours calendar: a document that exceeds a size or
 * entry budget is rejected outright, a single malformed entry is skipped with a
 * warning rather than poisoning the file, and every date is round-tripped so a
 * value such as `2026-02-30` cannot become a real instant later.
 */

import { ScheduleLimits } from '../support/schedule-limits.js';
import { daysInCivilMonth } from '../support/zoned-date-time.js';
import { OffPeakCalendar } from '../models/off-peak-calendar.js';

/** Control, format, line and paragraph separators — the terminal-control set. */
const TERMINAL_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function sanitizeText(text) {
  return String(text).replace(TERMINAL_CONTROL, ' ');
}

function firstCharacters(text, count) {
  return [...String(text)].slice(0, count).join('');
}

export class HolidayDataParser {
  /** Longest holiday name kept. */
  static maximumNameLength = 40;
  /** Longest source-document URL kept. */
  static maximumPaperLength = 300;
  /** Number of source documents kept. */
  static maximumPapers = 10;

  /**
   * @param {string|Uint8Array} data
   * @param {number} year
   * @returns {{kind:'loaded', data:object}|{kind:'uncovered'}|{kind:'failed', reason:string}}
   */
  parse(data, year) {
    const byteLength = typeof data === 'string'
      ? new TextEncoder().encode(data).length
      : data.byteLength;
    if (byteLength > ScheduleLimits.maximumHolidayPayloadBytes) {
      return {
        kind: 'failed',
        reason: `The holiday data for ${year} was larger than `
          + `${ScheduleLimits.maximumHolidayPayloadBytes / 1_024} KiB.`,
      };
    }

    let root;
    try {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      root = JSON.parse(text);
    } catch {
      return { kind: 'failed', reason: `The holiday data for ${year} is not a JSON object.` };
    }
    if (root == null || typeof root !== 'object' || Array.isArray(root)) {
      return { kind: 'failed', reason: `The holiday data for ${year} is not a JSON object.` };
    }
    return this.interpret(root, year);
  }

  // MARK: - Document interpretation

  interpret(root, year) {
    const declaredYear = typeof root.year === 'number' && Number.isInteger(root.year) ? root.year : null;
    if (declaredYear !== year) {
      return {
        kind: 'failed',
        reason: `The holiday document declares year ${declaredYear ?? 'nothing'}, but ${year} was requested.`,
      };
    }
    const rawDays = root.days;
    if (!Array.isArray(rawDays)) {
      return { kind: 'failed', reason: `The holiday data for ${year} has no days array.` };
    }
    if (rawDays.length > ScheduleLimits.maximumHolidayDaysPerYear) {
      return {
        kind: 'failed',
        reason: `The holiday data for ${year} lists ${rawDays.length} days, more than the `
          + `${ScheduleLimits.maximumHolidayDaysPerYear} this app will expand.`,
      };
    }
    if (rawDays.length === 0) return { kind: 'uncovered' };

    const warnings = [];
    const holidays = new Map();
    const makeUpWorkdays = new Map();

    for (const rawDay of rawDays) {
      if (rawDay == null || typeof rawDay !== 'object' || Array.isArray(rawDay)
        || typeof rawDay.date !== 'string' || typeof rawDay.isOffDay !== 'boolean') {
        warnings.push('Skipped a holiday entry without a usable date and isOffDay flag.');
        continue;
      }
      const key = HolidayDataParser.dayKey(rawDay.date);
      if (key == null) {
        warnings.push(`Skipped a holiday entry with an unusable date ${HolidayDataParser.describe(rawDay.date)}.`);
        continue;
      }
      const entryYear = Math.floor(key / 10_000);
      if (Math.abs(entryYear - year) > 1) {
        warnings.push(`Skipped a holiday entry dated ${HolidayDataParser.describe(rawDay.date)}, outside ${year}.`);
        continue;
      }
      const name = HolidayDataParser.sanitizedName(typeof rawDay.name === 'string' ? rawDay.name : '');
      if (rawDay.isOffDay) {
        // First entry for a day wins, matching the calendar parser.
        if (!holidays.has(key)) holidays.set(key, name);
      } else if (!makeUpWorkdays.has(key)) {
        makeUpWorkdays.set(key, name);
      }
    }

    if (holidays.size === 0 && makeUpWorkdays.size === 0) {
      // The document claimed to carry days but none survived validation, so it
      // must not be cached as if the year were known.
      return { kind: 'failed', reason: `The holiday data for ${year} contained no usable entries.` };
    }

    return {
      kind: 'loaded',
      data: {
        year,
        holidays,
        makeUpWorkdays,
        papers: HolidayDataParser.papers(root.papers),
        warnings,
      },
    };
  }

  static papers(raw) {
    if (!Array.isArray(raw)) return [];
    const result = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) continue;
      result.push(trimmed.length > HolidayDataParser.maximumPaperLength
        ? firstCharacters(trimmed, HolidayDataParser.maximumPaperLength)
        : trimmed);
      if (result.length === HolidayDataParser.maximumPapers) break;
    }
    return result;
  }

  /** Strict `YYYY-MM-DD`, validated against the real calendar. */
  static dayKey(text) {
    const parts = String(text).split('-');
    if (parts.length !== 3) return null;
    if (parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) return null;
    if (!parts.every((part) => /^\d+$/.test(part))) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    // A round trip rejects days that do not exist in that month, which a range
    // check on the numbers alone would let through.
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInCivilMonth(year, month)) return null;
    return OffPeakCalendar.dayKey(year, month, day);
  }

  /** Removes control and format characters, collapses whitespace, bounds length. */
  static sanitizedName(raw) {
    const cleaned = sanitizeText(raw)
      .split(/\s+/u)
      .filter((part) => part.length > 0)
      .join(' ');
    return firstCharacters(cleaned, HolidayDataParser.maximumNameLength);
  }

  /** Keeps untrusted text out of error messages. */
  static describe(raw) {
    return sanitizeText(firstCharacters(String(raw), 40));
  }
}
