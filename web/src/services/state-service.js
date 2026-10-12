/**
 * Derives snapshots from a parsed timeline.
 *
 * Ported from `StateService.swift`. The rules are intentionally small and
 * explicit: a state is peak exactly when `DTSTART <= now < DTEND` for some
 * window. The page fails closed — an unverifiable schedule is `unknown`, never
 * `offPeak`.
 */

import { PeakState } from '../models/peak-state.js';

/**
 * An immutable description of the pricing situation at one instant.
 */
export class PeakSnapshot {
  constructor({
    state,
    status,
    currentWindow = null,
    nextWindowStart = null,
    nextBoundary = null,
    offPeakReason = null,
    now,
  }) {
    this.state = state;
    this.status = status;
    /** The peak window covering `now`, when the state is `peak`. */
    this.currentWindow = currentWindow;
    /** Start of the next peak window, when the state is `offPeak`. */
    this.nextWindowStart = nextWindowStart;
    /** The next instant at which the state will change. */
    this.nextBoundary = nextBoundary;
    // A reason only describes an off-peak instant; carrying one alongside a
    // peak or unknown state would let a view render a contradictory caption.
    this.offPeakReason = state === PeakState.offPeak ? offPeakReason : null;
    this.now = now;
  }

  /** Time left in the current peak window, in seconds, or `null`. */
  get remaining() {
    if (this.currentWindow == null) return null;
    return Math.max(0, (this.currentWindow.end - this.now) / 1000);
  }

  /** Time until the next peak window, in seconds, or `null`. */
  get timeUntilNextPeak() {
    if (this.nextWindowStart == null) return null;
    return Math.max(0, (this.nextWindowStart - this.now) / 1000);
  }
}

export class StateService {
  /**
   * Computes the snapshot for `now`.
   *
   * `timeline == null` disables verification and yields `unknown` (fail
   * closed), regardless of what the page previously displayed.
   *
   * The Swift `fallbackState` parameter is deliberately *not* ported: the app
   * only ever passes its `.unknown` default, and exposing it here would let an
   * instant outside the expanded range silently become "off-peak".
   */
  snapshot({ timeline, status, offPeakReason = null, now }) {
    if (timeline == null || timeline.isEmpty) {
      return new PeakSnapshot({ state: PeakState.unknown, status, now });
    }

    // Outside the expanded range the timeline cannot answer, so fail closed
    // instead of assuming off-peak.
    if (!timeline.covers(now)) {
      return new PeakSnapshot({ state: PeakState.unknown, status, now });
    }

    const state = timeline.state(now);
    const currentWindow = timeline.window(now);
    const nextWindowStart = state === PeakState.offPeak ? timeline.nextWindowStart(now) : null;

    return new PeakSnapshot({
      state,
      status,
      currentWindow,
      nextWindowStart,
      nextBoundary: timeline.nextBoundary(now),
      offPeakReason,
      now,
    });
  }
}
