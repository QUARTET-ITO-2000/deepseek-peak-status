/**
 * Formats instants for display, in the *visitor's* time zone.
 *
 * Ported from `DisplayFormatting.swift`. The schedule may be defined in UTC or
 * any `TZID`; display always follows the viewer's machine so travel across time
 * zones is handled automatically. Numeric formatting is done by hand rather
 * than through `toLocaleString`, which varies by locale and numbering system —
 * the app pins `en_US_POSIX` and so does this port.
 */

import { zonedParts } from './zoned-date-time.js';

/** The visitor's own IANA zone, falling back to UTC. */
export function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Countdown formatted as `HH:MM:SS`, e.g. `02:13:42`.
 *
 * Hours are not wrapped at 24. A non-finite interval formats as `00:00:00`
 * rather than trapping.
 */
export function countdown(intervalSeconds) {
  const total = Number.isFinite(intervalSeconds)
    ? Math.max(0, Math.floor(intervalSeconds))
    : 0;
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** The short zone name shown next to a time, e.g. `JST`. */
export function zoneAbbreviation(instantMs, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(new Date(instantMs));
    const name = parts.find((part) => part.type === 'timeZoneName');
    return name ? name.value : timeZone;
  } catch {
    return timeZone;
  }
}

/** e.g. `18:00 JST`. */
export function formatTime(instantMs, timeZone) {
  const c = zonedParts(instantMs, timeZone);
  return `${pad2(c.hour)}:${pad2(c.minute)} ${zoneAbbreviation(instantMs, timeZone)}`;
}

/** e.g. `2026-09-22 13:02 JST`. */
export function formatDateTime(instantMs, timeZone) {
  const c = zonedParts(instantMs, timeZone);
  const date = `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
  const time = `${pad2(c.hour)}:${pad2(c.minute)}`;
  return `${date} ${time} ${zoneAbbreviation(instantMs, timeZone)}`;
}

/**
 * e.g. `2026-09-22`.
 *
 * Kept for parity with `DisplayFormatting.swift` and reached by nothing else.
 * The page dates its charts through `ui/format.js#shortDate`, which is
 * localised; this one exists so the two implementations stay comparable line by
 * line.
 */
export function formatDate(instantMs, timeZone) {
  const c = zonedParts(instantMs, timeZone);
  return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
}

/**
 * Human duration such as `4 hours`.
 *
 * Ported for parity with `DisplayFormatting.swift`; the page itself formats
 * durations through `ui/format.js#durationText`, which is localised. Kept in
 * step with it anyway, because the same rounding mistake is easy to repeat.
 */
export function describeDuration(seconds) {
  // Round to the minute first, then split — see `durationText` in
  // `ui/format.js`. Rounding the remainder separately yields "60 minutes".
  const totalMinutes = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds / 60)) : 0;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0 && minutes === 0) return '0 minutes';
  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.join(' ');
}
