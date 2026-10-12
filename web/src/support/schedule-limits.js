/**
 * Resource limits applied to calendar and holiday data that arrives from
 * outside the page.
 *
 * Ported one-for-one from `ScheduleLimits.swift`. The published peak-hours feed
 * is the untrusted input here, so the ingest path bounds what it will buffer,
 * decode, cache and read back. A response that exceeds a limit is rejected and
 * the schedule is treated as unavailable rather than truncated.
 */

export const ScheduleLimits = Object.freeze({
  /** Largest calendar body the page will buffer, decode or cache. */
  maximumCalendarBytes: 1_048_576,

  /** Largest cache entry the page will read back (JSON escaping can expand it). */
  maximumCacheFileBytes: 4 * 1_048_576,

  /** Largest holiday-data payload accepted for one year. */
  maximumHolidayPayloadBytes: 64 * 1_024,

  /** Largest number of day entries accepted for a single year. */
  maximumHolidayDaysPerYear: 400,

  /** Largest holiday cache entry the page will read back. */
  maximumHolidayCacheFileBytes: 4 * 64 * 1_024,
});
