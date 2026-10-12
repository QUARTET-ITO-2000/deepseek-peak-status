/**
 * Board 4 — what happens next, in words.
 *
 * The charts answer "what does the shape look like"; this answers "what do I
 * need to know before I hit send". Two kinds of entry:
 *
 *   - a peak window starting, or the current one ending, quoted in the
 *     visitor's own clock, because that is the clock they act on;
 *   - a whole suppressed Beijing day, quoted as a Beijing day and labelled as
 *     such, because that is the unit the rule is written in.
 *
 * Mixing the two frames is deliberate, and every line says which frame it is
 * in, so the list cannot be misread as sharing one timezone.
 *
 * The list is ordered by the moment each change happens — which is also the
 * moment the rendering stops being true — so `tick` can use the first row to
 * decide when to rebuild, instead of rebuilding once a second for nothing.
 */

import { el } from '../dom.js';
import { OffPeakCalendar } from '../../models/off-peak-calendar.js';
import { addCivilDays, instantFromCivil, zonedParts } from '../../support/zoned-date-time.js';
import { clock, dayLabel, durationText, reasonShort, shortDate, weekdayName } from '../format.js';

const DAY_MS = 86_400_000;
/** How far ahead the list looks, and how many rows it will show. */
const HORIZON_DAYS = 14;
/**
 * Twelve, not ten: the feed publishes two windows on each working day, so a
 * ten-row cap is filled by five days of peak starts and a suppressed day a week
 * away never gets to appear. Twelve reaches the next weekend.
 */
const MAXIMUM_ENTRIES = 12;

const BEIJING = OffPeakCalendar.timeZoneIdentifier;

export function createTransitions() {
  const heading = el('h3', { class: 'board-title', id: 'transitions-heading' });
  const hint = el('p', { class: 'board-hint' });
  const list = el('ol', { class: 'transition-list' });

  const element = el('section', {
    class: 'board board--transitions',
    'aria-labelledby': 'transitions-heading',
  }, [heading, hint, list]);

  /**
   * The instant the list as rendered first becomes wrong.
   *
   * Every entry is a future moment — a window starting, a window ending, a
   * Beijing midnight — and the list is sorted by it, so the first row is
   * exactly when the rendering stops matching the clock.
   */
  let nextChangeAt = null;

  function render(view) {
    const { i18n, now, localTimeZone, timeline, calendar } = view;

    heading.textContent = i18n.t('transitions.title');
    hint.textContent = i18n.t('transitions.hint');
    list.setAttribute('aria-label', i18n.t('transitions.title'));

    const entries = [];
    const horizon = now + HORIZON_DAYS * DAY_MS;

    if (timeline != null) {
      for (const window_ of timeline.windowsIntersecting({ start: now, end: horizon })) {
        if (window_.end <= now) continue;
        if (window_.start > now) {
          entries.push({
            // Sorting key: the instant the *change* happens.
            at: window_.start,
            kind: 'enter',
            text: i18n.t('transitions.enterPeak', {
              when: `${dayLabel(i18n, window_.start, localTimeZone, now)} ${clock(window_.start, localTimeZone)}`,
              duration: durationText(i18n, window_.duration),
            }),
          });
        } else {
          // Already inside a window, so the next change is this one ending.
          entries.push({
            at: window_.end,
            kind: 'leave',
            text: i18n.t('transitions.leavePeak', {
              when: `${dayLabel(i18n, window_.end, localTimeZone, now)} ${clock(window_.end, localTimeZone)}`,
            }),
          });
        }
      }
    }

    if (calendar != null) {
      const today = zonedParts(now, BEIJING);
      // Starts at tomorrow: a suppressed day is suppressed from its midnight, so
      // today's is already the state the headline is showing, not a change still
      // to come. Peak windows above are filtered by "starts after now" instead,
      // which is what keeps a peak later today on the list.
      for (let offset = 1; offset <= HORIZON_DAYS; offset += 1) {
        // Midnight in Beijing for this Beijing day: the same instant
        // `suppressedIntervals` starts the day at, so the list and the heat map
        // can never disagree about which day is suppressed.
        const instant = instantFromCivil({ ...addCivilDays(today, offset), hour: 0, minute: 0, second: 0 }, BEIJING);
        if (!calendar.isOffPeakDay(instant)) continue;
        entries.push({
          at: instant,
          kind: 'suppressed',
          text: i18n.t('transitions.suppressedDay', {
            date: `${shortDate(instant, BEIJING)} ${weekdayName(i18n, instant, BEIJING)}`,
            reason: reasonShort(i18n, calendar.reason(instant)),
          }),
        });
      }
    }

    entries.sort((a, b) => a.at - b.at);
    nextChangeAt = entries.length > 0 ? entries[0].at : null;

    list.replaceChildren();
    if (entries.length === 0) {
      list.append(el('li', { class: 'transition-item is-empty', text: i18n.t('transitions.none') }));
      return;
    }
    for (const entry of entries.slice(0, MAXIMUM_ENTRIES)) {
      list.append(el('li', {
        class: `transition-item transition-item--${entry.kind}`,
        text: entry.text,
      }));
    }
  }

  /**
   * Rebuilds the list once the clock has caught up with its first row.
   *
   * Nothing else moves this board, so between rebuilds it costs one comparison
   * per second — cheap enough to keep the list from contradicting the headline.
   */
  function tick(view) {
    if (nextChangeAt == null || view.now < nextChangeAt) return;
    render(view);
  }

  return { element, render, tick };
}
