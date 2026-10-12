/**
 * Parses the RFC 5545 date formats used by the DeepSeek peak-hours feed.
 *
 * Ported from `ICSDateParser.swift`. All conversions go through
 * `zoned-date-time.js`; the parser never applies a hand-rolled UTC offset.
 */

import { instantFromCivil, isValidTimeZone } from '../support/zoned-date-time.js';

/**
 * Common zone abbreviations `TimeZone(abbreviation:)` resolves but `Intl` does
 * not. IANA identifiers are always preferred; this table only narrows the gap
 * for feeds that spell a zone out in shorthand.
 */
const ABBREVIATIONS = Object.freeze({
  UTC: 'UTC',
  GMT: 'UTC',
  UT: 'UTC',
  Z: 'UTC',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  BST: 'Europe/London',
  CET: 'Europe/Paris',
  CEST: 'Europe/Paris',
  JST: 'Asia/Tokyo',
  KST: 'Asia/Seoul',
  HKT: 'Asia/Hong_Kong',
});

export const ICSDateParser = {
  /**
   * Parses `YYYYMMDD`, `YYYYMMDDTHHMMSS` or `YYYYMMDDTHHMMSSZ`.
   *
   * @param {string} rawValue
   * @param {string} timeZone zone to interpret floating (non-`Z`) values in
   * @returns {{components: object, date: number, isDateOnly: boolean, isUTC: boolean}|null}
   */
  parse(rawValue, timeZone) {
    const value = String(rawValue).trim();
    if (value.length === 0) return null;

    const isUTC = value.endsWith('Z') || value.endsWith('z');
    const body = isUTC ? value.slice(0, -1) : value;
    const isDateOnly = !body.includes('T') && body.length === 8;

    let digits = '';
    let time = '';
    const separatorIndex = body.indexOf('T');
    if (separatorIndex >= 0) {
      digits = body.slice(0, separatorIndex);
      time = body.slice(separatorIndex + 1);
    } else {
      digits = body;
    }

    if (digits.length !== 8) return null;
    if (!/^\d{8}$/.test(digits)) return null;
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));

    let hour = 0;
    let minute = 0;
    let second = 0;
    if (!isDateOnly) {
      if (time.length !== 6 || !/^\d{6}$/.test(time)) return null;
      hour = Number(time.slice(0, 2));
      minute = Number(time.slice(2, 4));
      second = Number(time.slice(4, 6));
    }

    const zone = isUTC ? 'UTC' : timeZone;
    let date;
    try {
      date = instantFromCivil({ year, month, day, hour, minute, second }, zone);
    } catch {
      // An unknown zone throws; callers treat an unparsable value as absent.
      return null;
    }
    if (!Number.isFinite(date)) return null;

    return {
      components: { year, month, day, hour, minute, second, timeZone: zone },
      date,
      isDateOnly,
      isUTC,
    };
  },

  /**
   * Resolves a `TZID` parameter value into a zone identifier.
   *
   * Handles the leading slash form (`/Asia/Tokyo`) and falls back to the
   * supplied default when the identifier is unknown. Returns `null` for an
   * unknown identifier so callers can drop the event (DTSTART) or fall back
   * (DTEND), mirroring the Swift asymmetry.
   *
   * @param {string|undefined|null} rawIdentifier
   * @param {string} fallback
   * @returns {string|null}
   */
  timeZone(rawIdentifier, fallback) {
    if (rawIdentifier == null || rawIdentifier.length === 0) return fallback;
    let identifier = String(rawIdentifier).trim();
    if (identifier.length >= 2 && identifier.startsWith('"') && identifier.endsWith('"')) {
      identifier = identifier.slice(1, -1);
    }
    if (identifier.startsWith('/')) identifier = identifier.slice(1);

    if (isValidTimeZone(identifier)) return identifier;
    const abbreviated = ABBREVIATIONS[identifier.toUpperCase()];
    if (abbreviated != null) return abbreviated;
    return null;
  },
};
