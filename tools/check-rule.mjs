#!/usr/bin/env node
/**
 * Checks the peak-hours rule compiled into the page.
 *
 * The rule is a hand transcription of DeepSeek's pricing page, and nothing
 * automated compares the two. This is the other half of that bargain: it cannot
 * tell you whether the rule still matches the page, but it can tell you whether
 * what you typed is a rule the page can actually use — and it prints every
 * window in both zones, so the one check a machine cannot make (is this the
 * same rule?) can be made by eye in a few seconds.
 *
 * Run it after editing `web/src/sources.js`:
 *
 *   npm run check-rule
 *
 * It fails on:
 *
 *   - a calendar that does not parse, or parses with warnings;
 *   - a weekday that does not yield exactly two windows;
 *   - windows that are not whole hours, or that overlap;
 *   - a rule that expands to nothing, which would pin the page at UNKNOWN;
 *   - a rule stated in a zone other than UTC;
 *   - a first layer that has started carrying BYDAY. That last one is not a
 *     style preference: the weekday half of the rule belongs to
 *     `OffPeakCalendar`, which can only remove whole Beijing days, and the
 *     "apply the China off-peak rule" switch is defined by that split.
 *
 * This tool is not reachable from the page and is not part of the published
 * directory. It is the counterpart to `snapshot.mjs`: that one keeps the
 * downloaded half fresh, this one keeps the typed half honest.
 */

import { OfficialRule } from '../web/src/sources.js';
import { ScheduleService } from '../web/src/services/schedule-service.js';
import { ICSParser } from '../web/src/services/ics-parser.js';
import { OffPeakCalendar } from '../web/src/models/off-peak-calendar.js';

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const BEIJING = OffPeakCalendar.timeZoneIdentifier;

let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL  ${message}`); };
const pass = (message) => console.log(`ok    ${message}`);

const formatIn = (ms, timeZone) => new Intl.DateTimeFormat('en-GB', {
  timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(ms));

const dayIn = (ms, timeZone) => new Intl.DateTimeFormat('en-GB', {
  timeZone, dateStyle: 'medium',
}).format(new Date(ms));

// MARK: - The transcription's provenance

console.log(`rule: ${OfficialRule.documentationURL}`);
console.log(`transcribed on: ${OfficialRule.transcribedOn}\n`);

const transcribedAt = Date.parse(OfficialRule.transcribedOn);
if (!Number.isFinite(transcribedAt)) {
  fail(`transcribedOn is not a date: ${OfficialRule.transcribedOn}`);
} else if (transcribedAt > Date.now() + MS_PER_DAY) {
  // A date with no time is parsed as midnight UTC, so a transcriber anywhere
  // ahead of UTC can legitimately stamp today while UTC is still yesterday.
  // The widest real offset is UTC+14, which is under a day, so one day of
  // slack separates "stamped today" from "stamped in the future".
  fail(`transcribedOn is in the future: ${OfficialRule.transcribedOn}`);
} else {
  const days = Math.max(0, Math.floor((Date.now() - transcribedAt) / MS_PER_DAY));
  pass(`transcribedOn parses, ${days} day(s) ago`);
}

// MARK: - It must parse the way the page parses it

const now = Date.now();
const schedule = new ScheduleService().load(now);
if (schedule == null) {
  // `load` fails closed by design and carries no reason, so ask the parser
  // directly for one. This is the only path on which the page would show
  // UNKNOWN, so the message matters more here than anywhere else.
  try {
    new ICSParser().parse(OfficialRule.calendar, OfficialRule.documentationURL, now);
    fail('the compiled rule produced an empty schedule');
  } catch (error) {
    fail(`the compiled rule does not parse: ${error.message}`);
  }
  console.log('\nThe page would show UNKNOWN. Fix the calendar before going further.');
  process.exit(1);
}
pass('the compiled rule parses into a non-empty schedule');

if (schedule.warnings.length === 0) {
  pass('no parser warnings');
} else {
  for (const warning of schedule.warnings) fail(`parser warning: ${warning}`);
}

// MARK: - Layer 1 must state hours only

if (schedule.calendarTimeZoneIdentifier == null || schedule.calendarTimeZoneIdentifier.toUpperCase() === 'UTC') {
  pass(`the calendar is stated in UTC (${schedule.calendarTimeZoneIdentifier ?? 'unset, defaults to UTC'})`);
} else {
  fail(`the calendar declares ${schedule.calendarTimeZoneIdentifier}; the official rule is written in UTC`);
}

for (const event of schedule.events) {
  const zone = event.timeZone;
  if (zone.toUpperCase() !== 'UTC') fail(`event ${event.uid} is stated in ${zone}, not UTC`);
  const rule = event.recurrenceRule;
  if (rule == null) {
    fail(`event ${event.uid} has no recurrence rule; a one-off window is almost certainly a mistake`);
    continue;
  }
  if (rule.byDay.length > 0) {
    fail(`event ${event.uid} carries BYDAY=${rule.byDay.map((selector) => selector.weekday).join(',')} — the weekday rule belongs to OffPeakCalendar, not here. Encoding it here moves that decision into the window layer, where nothing can add a day back, and changes what the "apply the China off-peak rule" switch means.`);
  }
  if (rule.until != null || rule.count != null) {
    fail(`event ${event.uid} is bounded (${rule.descriptionText}); the official rule has no end date`);
  }
  if (event.duration <= 0) fail(`event ${event.uid} has a non-positive duration`);
}
pass(`checked ${schedule.events.length} event(s) for zone, recurrence and bounds`);

// MARK: - What it actually expands to

// A plain Wednesday, so the day layer has nothing to remove.
const WEDNESDAY = Date.UTC(2026, 9, 14, 12, 0, 0);
const dayWindows = schedule.timeline(WEDNESDAY, 0, MS_PER_DAY).windows;

console.log(`\nwindows on a plain weekday (${dayIn(WEDNESDAY, 'UTC')}):`);
for (const window of dayWindows) {
  const hours = (window.end - window.start) / MS_PER_HOUR;
  console.log(`  UTC ${formatIn(window.start, 'UTC')}-${formatIn(window.end, 'UTC')}`
    + `  =  Beijing ${formatIn(window.start, BEIJING)}-${formatIn(window.end, BEIJING)}`
    + `  (${hours} h)`);
  if (window.start % MS_PER_HOUR !== 0 || window.end % MS_PER_HOUR !== 0) {
    fail('a window boundary is not on the hour; the official rule is stated in whole hours');
  }
  if (hours <= 0 || !Number.isInteger(hours)) fail(`a window is ${hours} h long`);
}
if (dayWindows.length === 0) fail('a plain weekday has no windows at all');
if (dayWindows.length !== 2) fail(`a plain weekday has ${dayWindows.length} windows; the official rule states two`);
for (let index = 1; index < dayWindows.length; index += 1) {
  if (dayWindows[index].start < dayWindows[index - 1].end) fail('two windows overlap');
}
if (dayWindows.length > 0) pass(`${dayWindows.length} window(s) on a plain weekday, whole hours, non-overlapping`);

// MARK: - The two-layer contract

// Layer 1 is daily on purpose, so a weekend still has windows until the date
// layer removes them. If this ever stops being true, the switch has changed
// meaning and the day layer needs reworking in the same change.
const SATURDAY = Date.UTC(2026, 9, 17, 12, 0, 0);
const saturdayRaw = schedule.timeline(SATURDAY, 0, MS_PER_DAY).windows;
const saturdaySuppressed = schedule.timeline(SATURDAY, 0, MS_PER_DAY)
  .suppressingOffPeakDays(new OffPeakCalendar()).windows;

console.log(`\nweekend (${dayIn(SATURDAY, 'UTC')}): ${saturdayRaw.length} window(s) before the date layer, ${saturdaySuppressed.length} after`);
if (saturdayRaw.length === 0) {
  fail('a Saturday has no windows before the date layer, so layer 1 is carrying the weekday rule');
} else {
  pass('layer 1 still states every day; the weekend is removed by the date layer alone');
}
if (saturdaySuppressed.length !== 0) {
  fail('the weekend layer left a window on a Saturday');
} else {
  pass('the weekend layer removes the whole Saturday');
}

// MARK: - The page must not be able to sit at UNKNOWN

const horizon = schedule.timeline(now).windows.length;
console.log(`\nwindows over the page's default horizon: ${horizon}`);
if (horizon === 0) fail('the default horizon expands to nothing, so the page would report UNKNOWN');
else pass('the default horizon expands to a usable timeline');

console.log(failures === 0
  ? '\nOK — the compiled rule is well formed. It still has to be read against the official page by eye.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
