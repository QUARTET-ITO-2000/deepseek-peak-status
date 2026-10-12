/**
 * A half-open time interval `[start, end)`, in milliseconds since the epoch.
 *
 * Stands in for `Foundation.DateInterval`. `duration` is reported in *seconds*
 * so the ported tests can assert the same numbers the Swift suite does.
 */
export class Interval {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }

  /** Length in seconds, matching `DateInterval.duration`. */
  get duration() {
    return (this.end - this.start) / 1000;
  }

  /** Length in milliseconds. */
  get durationMs() {
    return this.end - this.start;
  }

  /** `true` when the two intervals share more than a boundary. */
  intersects(other) {
    return this.start < other.end && this.end > other.start;
  }

  equals(other) {
    return other != null && this.start === other.start && this.end === other.end;
  }

  toString() {
    return `[${new Date(this.start).toISOString()}, ${new Date(this.end).toISOString()})`;
  }
}

/** Compares two interval arrays for exact equality, for test assertions. */
export function intervalsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item.equals(b[index]));
}
