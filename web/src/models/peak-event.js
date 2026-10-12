/**
 * A single DeepSeek peak-pricing window, possibly recurring.
 *
 * Ported from `PeakEvent.swift`. The start is kept as wall-clock components
 * (with its time zone) so recurrence is expanded on the clock of the event's
 * own zone, which keeps `FREQ=DAILY` at a fixed local time across
 * daylight-saving transitions.
 */

import { instantFromCivil, normalizeCivil } from '../support/zoned-date-time.js';
import { expandEvent } from '../services/recurrence-expander.js';

export class PeakEvent {
  constructor({
    uid,
    summary = null,
    startComponents,
    duration,
    recurrenceRule = null,
    excludedDates = [],
    isAllDay = false,
  }) {
    this.uid = uid;
    this.summary = summary;
    this.startComponents = startComponents;
    // Windows are always finite: a non-finite duration would otherwise reach
    // the integer conversions in the countdown.
    this.duration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
    this.recurrenceRule = recurrenceRule;
    this.excludedDates = excludedDates;
    this.isAllDay = isAllDay;
  }

  get id() {
    return this.uid;
  }

  /** The time zone the window is defined in. */
  get timeZone() {
    return this.startComponents.timeZone ?? 'UTC';
  }

  /** The first (non-recurring) start instant, or `null` when invalid. */
  get firstStart() {
    try {
      return instantFromCivil(normalizeCivil(this.startComponents), this.timeZone);
    } catch {
      return null;
    }
  }

  /** Expands this event into concrete windows overlapping `range`. */
  windows(overlapping, limit = 20_000) {
    return expandEvent(this, overlapping, limit);
  }
}
