/**
 * Where the page's two inputs come from.
 *
 * The peak-hours rule is **compiled into the page**. DeepSeek states it as
 * prose on the pricing page and publishes no feed to download, so the two
 * windows are transcribed here and read by the same `ICSParser` the macOS app
 * uses. Until 2026-10-12 they were downloaded from an independently operated
 * ICS feed; that dependency is gone, and with it the only route by which the
 * schedule could previously fail to load.
 *
 * The holiday arrangement is still fetched, and is still republished from the
 * State Council's notices by a community project — DeepSeek does not publish it
 * in any form.
 */

export const OfficialRule = Object.freeze({
  /** Where the rule is stated. Linked from the diagnostics panel. */
  documentationURL: 'https://api-docs.deepseek.com/quick_start/pricing',

  /**
   * The day the transcription below was last checked against the page above.
   *
   * The page reports this as the schedule's age, because it is the only honest
   * answer left: the rule is a constant, so its freshness is how long ago a
   * human compared it with the source, not how long ago a request succeeded.
   */
  transcribedOn: '2026-10-12',

  /**
   * The rule as an iCalendar document.
   *
   * iCalendar rather than a bespoke constant so that the reader is the parser
   * the app already uses, rather than a second code path free to drift from it.
   *
   * `DTSTART` is pinned to the epoch because the rule has no start date — it is
   * a standing policy, not a calendar that begins somewhere. A `DAILY` rule
   * without `COUNT` is fast-forwarded to the requested range, so an anchor this
   * old costs nothing to expand.
   *
   * Both events are `FREQ=DAILY`, weekends included, and that is deliberate.
   * The official rule reads "Monday through Friday, excluding Chinese public
   * holidays", and the weekday half belongs to `OffPeakCalendar`, which can only
   * *remove* whole Beijing days. Writing `BYDAY=MO,TU,WE,TH,FR` here would move
   * the weekday decision into the window layer and change what the page's
   * "apply the China off-peak rule" switch means: with the switch on, weekends
   * and holidays are removed; with it off, the windows are shown exactly as the
   * rule states them.
   */
  calendar: [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DeepSeek Peak Status//official peak-pricing rule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:DeepSeek peak pricing hours',
    'X-WR-TIMEZONE:UTC',
    'BEGIN:VEVENT',
    'UID:peak-window-early@deepseek-peak-status',
    'DTSTART:19700101T010000Z',
    'DTEND:19700101T040000Z',
    'RRULE:FREQ=DAILY',
    'SUMMARY:DeepSeek peak hours (01:00-04:00 UTC)',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:peak-window-late@deepseek-peak-status',
    'DTSTART:19700101T060000Z',
    'DTEND:19700101T100000Z',
    'RRULE:FREQ=DAILY',
    'SUMMARY:DeepSeek peak hours (06:00-10:00 UTC)',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n'),
});

export const HolidaySource = Object.freeze({
  defaultURLTemplate: 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
});

/**
 * Expands a template into the URL for one year.
 *
 * A template without `{year}` would silently serve the same document for every
 * year, so it is refused.
 */
export function holidayURL(template, year) {
  if (!template.includes('{year}')) return null;
  const expanded = template.replaceAll('{year}', String(year));
  let url;
  try {
    url = new URL(expanded);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.host.length === 0) return null;
  return url.toString();
}

/**
 * Bundled copies, relative to the directory `index.html` is served from.
 *
 * Only the holidays are bundled. The scheduled workflow writes the raw upstream
 * document here, never a computed state: a state depends on the instant and
 * would be stale within hours. The manifest the workflow keeps beside it
 * (`snapshot.json`) is bookkeeping for that job and is never read by the page.
 */
export const SnapshotPaths = Object.freeze({
  holidays(year) { return `data/holidays-${year}.json`; },
});
