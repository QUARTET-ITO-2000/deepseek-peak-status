/**
 * Presentation helpers shared by the boards.
 *
 * Numeric formatting is done by hand rather than through `toLocaleString`,
 * which varies by locale and numbering system — the same reason the app pins
 * `en_US_POSIX`.
 */

import { zonedParts, civilWeekday, addCivilDays, instantFromCivil } from '../support/zoned-date-time.js';

export function pad2(value) {
  return String(value).padStart(2, '0');
}

/** `HH:MM` in the given zone. */
export function clock(instantMs, timeZone) {
  const c = zonedParts(instantMs, timeZone);
  return `${pad2(c.hour)}:${pad2(c.minute)}`;
}

/** `HH:MM:SS` in the given zone. */
export function clockSeconds(instantMs, timeZone) {
  const c = zonedParts(instantMs, timeZone);
  return `${pad2(c.hour)}:${pad2(c.minute)}:${pad2(c.second)}`;
}

/** `YYYY-MM-DD` in the given zone. */
export function dateStamp(instantMs, timeZone) {
  const c = zonedParts(instantMs, timeZone);
  return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
}

/** `MM-DD` in the given zone. */
export function shortDate(instantMs, timeZone) {
  const c = zonedParts(instantMs, timeZone);
  return `${pad2(c.month)}-${pad2(c.day)}`;
}

/** The localized short weekday name for an instant's zone-local day. */
export function weekdayName(i18n, instantMs, timeZone) {
  return i18n.t(`weekday.${civilWeekday(zonedParts(instantMs, timeZone))}`);
}

/** Midnight at the start of the zone-local day containing `instantMs`. */
export function startOfLocalDay(instantMs, timeZone) {
  const c = zonedParts(instantMs, timeZone);
  return instantFromCivil({ year: c.year, month: c.month, day: c.day, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Midnight at the start of the zone-local day `offset` days away. */
export function startOfLocalDayOffset(instantMs, timeZone, offset) {
  const c = zonedParts(startOfLocalDay(instantMs, timeZone), timeZone);
  const shifted = addCivilDays({ year: c.year, month: c.month, day: c.day }, offset);
  return instantFromCivil({ ...shifted, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** "4 hours", "1 hour 30 minutes" — the app's duration phrasing. */
export function durationText(i18n, seconds) {
  // Round to the minute *first* and only then split. Rounding the remainder on
  // its own turns 3599s into "60 minutes" and 7199s into "1 hour 60 minutes",
  // because `Math.round(59.98)` is 60 and nothing carries into the hour.
  const totalMinutes = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds / 60)) : 0;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0 && minutes === 0) return i18n.t('duration.minutes', { count: 0 });
  if (hours === 0) return i18n.t('duration.minutes', { count: minutes });
  if (minutes === 0) return i18n.t('duration.hours', { count: hours });
  return i18n.t('duration.hoursMinutes', { hours, minutes });
}

/** "just now", "12 minutes ago", "3 days ago". */
export function relativeAge(i18n, ageMs) {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return i18n.t('relative.justNow');
  if (minutes < 60) return i18n.t('relative.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('relative.hoursAgo', { count: hours });
  return i18n.t('relative.daysAgo', { count: Math.floor(hours / 24) });
}

/** "Today" / "Tomorrow" / "Mon 10-13", relative to a zone-local day. */
export function dayLabel(i18n, instantMs, timeZone, now) {
  const target = startOfLocalDay(instantMs, timeZone);
  const today = startOfLocalDay(now, timeZone);
  if (target === today) return i18n.t('transitions.today');
  if (target === startOfLocalDayOffset(now, timeZone, 1)) return i18n.t('transitions.tomorrow');
  return `${weekdayName(i18n, instantMs, timeZone)} ${shortDate(instantMs, timeZone)}`;
}

/**
 * A compact reason, for chart labels and cell tooltips.
 *
 * The holiday name is still quoted from the data source and never translated;
 * only the noun after it changes with the interface language.
 */
export function reasonShort(i18n, reason) {
  if (reason == null) return '';
  switch (reason.kind) {
    case 'weekend': return i18n.t('reason.weekend');
    case 'makeUpWorkday': return i18n.t('reason.makeUpNamed', { name: reason.name });
    case 'holiday': return i18n.t('reason.holidayNamed', { name: reason.name });
    default: return '';
  }
}
