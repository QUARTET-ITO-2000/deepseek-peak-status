/**
 * A parsed collection of DeepSeek peak-pricing events plus provenance, and the
 * merged, sorted timeline that can be queried in O(log n).
 *
 * Ported from `Schedule.swift` (`Schedule` + `PeakTimeline`). Windows are
 * half-open `[start, end)` intervals in milliseconds; durations are reported in
 * seconds so the ported assertions match the Swift suite.
 */

import { Interval } from '../support/interval.js';
import { PeakState } from './peak-state.js';

const MS_PER_DAY = 86_400_000;

export class Schedule {
  constructor({
    events,
    sourceURL,
    fetchedAt,
    calendarName = null,
    calendarTimeZoneIdentifier = null,
    etag = null,
    lastModified = null,
    warnings = [],
  }) {
    this.events = events;
    this.sourceURL = sourceURL;
    this.fetchedAt = fetchedAt;
    this.calendarName = calendarName;
    this.calendarTimeZoneIdentifier = calendarTimeZoneIdentifier;
    this.etag = etag;
    this.lastModified = lastModified;
    this.warnings = warnings;
  }

  /** `true` when the schedule carries no usable events. */
  get isEmpty() {
    return this.events.length === 0;
  }

  /**
   * Builds a queryable timeline around `now`.
   *
   * @param {number} now reference instant (ms)
   * @param {number} lookback how far behind `now` windows are still expanded
   * @param {number} horizon how far ahead windows are expanded
   */
  timeline(around, lookback = Schedule.defaultLookback, horizon = Schedule.defaultHorizon) {
    const range = new Interval(around - lookback, around + horizon);
    const windows = [];
    for (const event of this.events) {
      windows.push(...event.windows(range));
    }
    return new PeakTimeline(windows, range, around);
  }

  /** Two days covers the longest plausible in-flight peak window. */
  static defaultLookback = 2 * MS_PER_DAY;
  /** A bit more than a year so "next peak" always has an answer for daily rules. */
  static defaultHorizon = 400 * MS_PER_DAY;
}

export class PeakTimeline {
  constructor(windows, range, generatedAt) {
    /** Merged, ascending windows. Overlapping or adjacent events are coalesced. */
    this.windows = PeakTimeline.merge(windows);
    /** The range the timeline was expanded for. */
    this.range = range;
    this.generatedAt = generatedAt;
  }

  get isEmpty() {
    return this.windows.length === 0;
  }

  /**
   * The state at `date`.
   *
   * A missing entry outside the expanded range is *not* off-peak by itself;
   * callers decide between `offPeak` and `unknown` via `covers`.
   */
  state(at) {
    if (!this.covers(at)) return PeakState.unknown;
    return this.window(at) != null ? PeakState.peak : PeakState.offPeak;
  }

  /** Whether `date` lies inside the expanded range. */
  covers(date) {
    return date >= this.range.start && date < this.range.end;
  }

  /** The peak window containing `date`, if any. */
  window(date) {
    const index = this.lastIndexWithStartAtOrBefore(date);
    if (index == null) return null;
    const window = this.windows[index];
    return date < window.end ? window : null;
  }

  /** Start of the first peak window strictly after `date`. */
  nextWindowStart(after) {
    const index = this.firstIndexWithStartAfter(after);
    if (index == null) return null;
    return this.windows[index].start;
  }

  /** The next instant at which the state changes (peak start or peak end). */
  nextBoundary(after) {
    const candidates = [];
    const forward = this.firstIndexWithStartAfter(after);
    if (forward != null) candidates.push(this.windows[forward].start);
    const behind = this.lastIndexWithStartAtOrBefore(after);
    if (behind != null && this.windows[behind].end > after) candidates.push(this.windows[behind].end);
    const valid = candidates.filter((value) => value > after);
    return valid.length === 0 ? null : Math.min(...valid);
  }

  /** All windows that intersect `interval`. */
  windowsIntersecting(target) {
    return this.windows.filter((window) => window.start < target.end && window.end > target.start);
  }

  /**
   * Removes `excluded` from every window, re-merging whatever is left.
   *
   * A window entirely inside an excluded day disappears; one that straddles the
   * boundary is split rather than kept or dropped whole. The expanded `range` is
   * preserved so `covers` still answers for every instant the caller asked about.
   */
  subtracting(excluded) {
    const cuts = excluded.filter((item) => item.duration > 0).sort((a, b) => a.start - b.start);
    if (cuts.length === 0 || this.windows.length === 0) return this;

    const remaining = [];
    for (const window of this.windows) {
      let pieces = [window];
      for (const cut of cuts) {
        if (cut.end <= window.start) continue;
        if (cut.start >= window.end) break;
        const survivors = [];
        for (const piece of pieces) {
          if (cut.end <= piece.start || cut.start >= piece.end) {
            survivors.push(piece);
            continue;
          }
          if (cut.start > piece.start) survivors.push(new Interval(piece.start, cut.start));
          if (cut.end < piece.end) survivors.push(new Interval(cut.end, piece.end));
        }
        pieces = survivors;
        if (pieces.length === 0) break;
      }
      remaining.push(...pieces);
    }
    return new PeakTimeline(remaining, this.range, this.generatedAt);
  }

  /**
   * Applies the date half of DeepSeek's published pricing rule.
   *
   * The feed decides *which hours* are peak; `calendar` only ever removes whole
   * Beijing days, so the local rule can never invent a peak the feed did not
   * publish. A `null` calendar means the rule is switched off.
   */
  suppressingOffPeakDays(calendar) {
    if (calendar == null) return this;
    return this.subtracting(calendar.suppressedIntervals(this.range));
  }

  // MARK: - Binary search

  lastIndexWithStartAtOrBefore(date) {
    let low = 0;
    let high = this.windows.length - 1;
    let result = null;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.windows[mid].start <= date) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  firstIndexWithStartAfter(date) {
    let low = 0;
    let high = this.windows.length - 1;
    let result = null;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.windows[mid].start > date) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return result;
  }

  static merge(windows) {
    const sorted = windows
      .filter((window) => window.durationMs > 0)
      .slice()
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const window of sorted) {
      const last = merged[merged.length - 1];
      if (last != null && window.start <= last.end) {
        merged[merged.length - 1] = new Interval(last.start, Math.max(last.end, window.end));
      } else {
        merged.push(window);
      }
    }
    return merged;
  }
}
