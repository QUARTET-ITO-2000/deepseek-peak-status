/**
 * Downloads, caches and assembles the State Council's holiday arrangements.
 *
 * Ported from `HolidayService.swift`. The service mirrors `ScheduleService`:
 * a size-bounded body, a cached copy with a staleness window, and a `load` that
 * never throws. The difference is that a partial answer is useful here —
 * losing one year still leaves the weekend rule and every other year intact —
 * so failures degrade rather than failing the whole load.
 *
 * A holiday fetch that fails must **never** move the schedule state to
 * `unknown`: the page still shows "verified" and merely notes that the holiday
 * data is unavailable.
 */

import { HolidaySource, holidayURL } from '../sources.js';
import { ScheduleLimits } from '../support/schedule-limits.js';
import { zonedParts } from '../support/zoned-date-time.js';
import { OffPeakCalendar } from '../models/off-peak-calendar.js';
import { HolidayDataParser } from './holiday-data-parser.js';
import { ScheduleTransportError } from './schedule-service.js';

const MS_PER_DAY = 86_400_000;
const BEIJING = OffPeakCalendar.timeZoneIdentifier;

/** Years beyond this many either side of the current year are pruned. */
const RETAINED_YEAR_RADIUS = 3;
/** Upper bound on years fetched for one request. */
const MAXIMUM_YEARS = 5;

export class HolidayService {
  static Configuration = Object.freeze({
    urlTemplate: HolidaySource.defaultURLTemplate,
    /** How long a published year is trusted before being re-checked. */
    refreshInterval: 24 * 3_600_000,
    /** How long a year known to be unpublished is trusted before asking again. */
    unpublishedRefreshInterval: 6 * 3_600_000,
    /** How long a cached year stays usable when the network is down. */
    staleWindow: 90 * MS_PER_DAY,
  });

  constructor({ transport, cache, parser = new HolidayDataParser() } = {}) {
    this.transport = transport;
    this.cache = cache;
    this.parser = parser;
  }

  /**
   * Loads the arrangements covering `range`.
   *
   * @returns {Promise<{calendar, status, pendingYears, failedYears, sourcePapers}>}
   */
  async load({ configuration = HolidayService.Configuration, covering, now }) {
    const years = HolidayService.years(covering);
    const existing = this.cache?.load() ?? [];
    const previousByYear = new Map();
    for (const entry of existing) previousByYear.set(entry.year, entry);

    const resolved = [];
    const holidays = new Map();
    const makeUpWorkdays = new Map();
    const coveredYears = new Set();
    const pendingYears = [];
    const failedYears = [];
    const failureReasons = [];
    const papers = [];
    let lastVerified = null;

    for (const year of years) {
      const resolution = await this.#resolve(year, previousByYear.get(year), configuration, now);
      if (resolution.entry != null) {
        resolved.push(resolution.entry);
        if (resolution.entry.isCovered) {
          coveredYears.add(year);
          for (const [key, name] of resolution.entry.holidays) holidays.set(key, name);
          for (const [key, name] of resolution.entry.makeUpWorkdays) makeUpWorkdays.set(key, name);
          papers.push(...resolution.entry.papers);
        }
        lastVerified = Math.max(lastVerified ?? resolution.entry.verifiedAt, resolution.entry.verifiedAt);
      }
      if (resolution.isPending) pendingYears.push(year);
      if (resolution.failureReason != null) {
        failedYears.push(year);
        failureReasons.push(resolution.failureReason);
      }
    }

    this.cache?.save(this.#merged(existing, resolved, now));

    const calendar = new OffPeakCalendar({ holidays, makeUpWorkdays, coveredYears });
    const status = failedYears.length === 0
      ? { kind: 'verified', date: lastVerified ?? now }
      : { kind: 'partial', lastVerified, reason: failureReasons.join(' ') };

    return {
      calendar,
      status,
      pendingYears: pendingYears.slice().sort((a, b) => a - b),
      failedYears: failedYears.slice().sort((a, b) => a - b),
      sourcePapers: HolidayService.#deduplicated(papers),
    };
  }

  async #resolve(year, previous, configuration, now) {
    if (previous != null) {
      const age = now - previous.verifiedAt;
      const timeToLive = previous.isCovered
        ? configuration.refreshInterval
        : configuration.unpublishedRefreshInterval;
      if (age >= 0 && age < timeToLive) {
        return { entry: previous, isPending: !previous.isCovered, failureReason: null };
      }
    }

    const url = holidayURL(configuration.urlTemplate, year);
    if (url == null) {
      return {
        entry: this.#usableFallback(previous, configuration, now),
        failureReason: 'The holiday data URL must contain a {year} placeholder.',
      };
    }

    try {
      const response = await this.transport.fetch({
        url,
        etag: previous?.etag ?? null,
        accept: 'application/json',
      });

      if (response.notModified && previous != null) {
        return {
          entry: { ...previous, verifiedAt: now, etag: response.etag ?? previous.etag ?? null },
          isPending: !previous.isCovered,
          failureReason: null,
        };
      }

      const body = response.body ?? '';
      const byteLength = new TextEncoder().encode(body).length;
      if (byteLength > ScheduleLimits.maximumHolidayPayloadBytes) {
        throw new ScheduleTransportError(
          'responseTooLarge',
          `The holiday data for ${year} was larger than ${ScheduleLimits.maximumHolidayPayloadBytes / 1_024} KiB.`,
        );
      }

      const outcome = this.parser.parse(body, year);
      if (outcome.kind === 'loaded') {
        return {
          entry: {
            year,
            verifiedAt: now,
            isCovered: true,
            holidays: [...outcome.data.holidays],
            makeUpWorkdays: [...outcome.data.makeUpWorkdays],
            papers: outcome.data.papers,
            etag: response.etag ?? null,
          },
          isPending: false,
          failureReason: null,
        };
      }
      if (outcome.kind === 'uncovered') {
        return {
          entry: { year, verifiedAt: now, isCovered: false, holidays: [], makeUpWorkdays: [], papers: [], etag: response.etag ?? null },
          isPending: true,
          failureReason: null,
        };
      }
      return {
        entry: this.#usableFallback(previous, configuration, now),
        failureReason: outcome.reason,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        entry: this.#usableFallback(previous, configuration, now),
        failureReason: `Holiday data for ${year} could not be retrieved: ${reason}`,
      };
    }
  }

  /** A cached year stays usable — but no longer trusted as current — while fresh enough. */
  #usableFallback(previous, configuration, now) {
    if (previous == null) return null;
    return now - previous.verifiedAt <= configuration.staleWindow ? previous : null;
  }

  #merged(existing, resolved, now) {
    const byYear = new Map();
    for (const entry of existing) byYear.set(entry.year, entry);
    for (const entry of resolved) byYear.set(entry.year, entry);

    const currentYear = zonedParts(now, BEIJING).year;
    const oldest = currentYear - RETAINED_YEAR_RADIUS;
    const newest = currentYear + RETAINED_YEAR_RADIUS;

    return [...byYear.values()]
      .filter((entry) => entry.year >= oldest && entry.year <= newest)
      .sort((a, b) => a.year - b.year);
  }

  static #deduplicated(papers) {
    const seen = new Set();
    const unique = [];
    for (const paper of papers) {
      if (!seen.has(paper)) {
        seen.add(paper);
        unique.push(paper);
      }
      if (unique.length === HolidayDataParser.maximumPapers) break;
    }
    return unique;
  }

  /** The Beijing calendar years spanned by `range`, bounded. */
  static years(range) {
    const start = Math.min(range.start, range.end);
    const end = Math.max(range.start, range.end) - 1;
    const first = zonedParts(start, BEIJING).year;
    const last = zonedParts(end, BEIJING).year;
    if (first > last) return [first];
    const result = [];
    for (let year = first; year <= Math.min(last, first + MAXIMUM_YEARS - 1); year += 1) result.push(year);
    return result;
  }
}
