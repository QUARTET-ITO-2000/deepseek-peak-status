/**
 * Board 2 — today's 24-hour timeline.
 *
 * Inline SVG, not canvas: the rects stay in the DOM when the script that
 * colours them has not run, the text scales and prints cleanly, and CSS custom
 * properties can recolour the whole chart for the dark scheme.
 *
 * The axis is the *visitor's* local calendar day, but every tick is annotated
 * with the Beijing hour that falls on it. That pairing is the whole point of
 * the board: the rule is written in Beijing days, so a reader who only sees
 * local hours cannot tell why a whole afternoon is suppressed. The legend
 * states the convention in words as well.
 *
 * Peak bands carry a diagonal hatch on top of the fill so that state is never
 * signalled by colour alone.
 */

import { el, svg } from '../dom.js';
import { PeakState } from '../../models/peak-state.js';
import { instantFromCivil, zonedParts } from '../../support/zoned-date-time.js';
import {
  clock,
  dateStamp,
  durationText,
  pad2,
  startOfLocalDay,
  startOfLocalDayOffset,
  weekdayName,
} from '../format.js';

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 178;
/** Right edge of the plot, leaving a 16-unit margin inside the viewBox. */
const PLOT_RIGHT = VIEW_WIDTH - 16;
/**
 * Where the plot starts, and so how wide the axis-name gutter is.
 *
 * The two axis names are right-aligned in that gutter, while the first tick
 * label is centred on the plot's left edge and therefore reaches half its own
 * width back into it. Both are set at 11px, where `00:00` measures 31.3 units
 * (so it reaches 15.7 back) and the longest name, `Your time`, measures 49.6.
 *
 * The gutter used to be 60, with the names ending 10 units short of the plot —
 * at x = 50. `00:00` began at x = 44.4, so it ran 5.7 units underneath the name
 * and the two collided on every render, in both locales.
 *
 * 88 places the names' right edge at 64 and the first label's left edge at 72.4:
 * an 8.4-unit gap, and 14.4 units of clearance to the left of the longest name.
 */
const PLOT_X = 88;
/** Clear space between the axis names and the first tick label. */
const AXIS_NAME_GAP = 24;
const PLOT = { x: PLOT_X, y: 34, width: PLOT_RIGHT - PLOT_X, height: 88 };
const CAPTION_Y = 14;
const NOW_LABEL_Y = 24;
const LABEL_LOCAL_Y = 146;
const LABEL_BEIJING_Y = 163;
/** Labelling all 24 hours crowds the axis; every third hour reads cleanly. */
const TICK_STEP = 3;
const CORNER_RADIUS = 6;

let sequence = 0;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function createTimelineChart() {
  const id = `timeline-${(sequence += 1)}`;
  const clipId = `${id}-clip`;
  const hatchId = `${id}-hatch`;

  const defs = svg('defs', {}, [
    svg('clipPath', { id: clipId }, [
      svg('rect', { x: PLOT.x, y: PLOT.y, width: PLOT.width, height: PLOT.height, rx: CORNER_RADIUS }),
    ]),
    svg('pattern', {
      id: hatchId,
      patternUnits: 'userSpaceOnUse',
      width: 8,
      height: 8,
      patternTransform: 'rotate(45)',
    }, [
      svg('rect', { width: 8, height: 8, class: 'hatch-base' }),
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 8, class: 'hatch-line' }),
    ]),
  ]);

  const titleNode = svg('title');
  const descNode = svg('desc');
  const caption = svg('text', { class: 'chart-caption', x: PLOT.x, y: CAPTION_Y });
  const axisLocalLabel = svg('text', {
    class: 'axis-name', x: PLOT.x - AXIS_NAME_GAP, y: LABEL_LOCAL_Y, 'text-anchor': 'end',
  });
  const axisBeijingLabel = svg('text', {
    class: 'axis-name', x: PLOT.x - AXIS_NAME_GAP, y: LABEL_BEIJING_Y, 'text-anchor': 'end',
  });

  const bandLayer = svg('g', { 'clip-path': `url(#${clipId})` });
  const gridLayer = svg('g');
  const nowLayer = svg('g');

  const chart = svg('svg', {
    class: 'chart chart--timeline',
    viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  }, [titleNode, descNode, defs, caption, bandLayer, gridLayer, axisLocalLabel, axisBeijingLabel, nowLayer]);

  const heading = el('h3', { class: 'board-title', id: `${id}-heading` });
  const hint = el('p', { class: 'board-hint' });

  // The same information as a table, for assistive technology: an SVG band is
  // not readable, and a screen reader gets far more from rows of times.
  const tableCaption = el('caption');
  const tableHeadStart = el('th', { scope: 'col' });
  const tableHeadEnd = el('th', { scope: 'col' });
  const tableHeadDuration = el('th', { scope: 'col' });
  const tableHeadState = el('th', { scope: 'col' });
  const tableBody = el('tbody');
  const table = el('table', { class: 'visually-hidden' }, [
    tableCaption,
    el('thead', {}, [
      el('tr', {}, [tableHeadStart, tableHeadEnd, tableHeadDuration, tableHeadState]),
    ]),
    tableBody,
  ]);

  const element = el('section', {
    class: 'board board--timeline',
    'aria-labelledby': `${id}-heading`,
  }, [heading, hint, el('div', { class: 'chart-scroll' }, [chart]), table]);

  let dayStart = 0;
  let dayEnd = 0;

  function placeNow(i18n, now, localTimeZone) {
    nowLayer.replaceChildren();
    if (!(now >= dayStart && now < dayEnd) || dayEnd === dayStart) return;
    const x = PLOT.x + clamp01((now - dayStart) / (dayEnd - dayStart)) * PLOT.width;
    nowLayer.append(svg('line', {
      class: 'now-line',
      x1: x,
      y1: PLOT.y - 6,
      x2: x,
      y2: PLOT.y + PLOT.height + 4,
    }));
    nowLayer.append(svg('text', {
      class: 'now-label',
      x,
      y: NOW_LABEL_Y,
      'text-anchor': 'middle',
      text: i18n.t('timeline.now'),
    }));
  }

  function render(view) {
    const { i18n, now, localTimeZone, beijingTimeZone, timeline } = view;

    heading.textContent = i18n.t('timeline.title');
    hint.textContent = i18n.t('timeline.hint');
    titleNode.textContent = i18n.t('timeline.title');
    descNode.textContent = i18n.t('timeline.aria');
    chart.setAttribute('aria-label', i18n.t('timeline.aria'));
    axisLocalLabel.textContent = i18n.t('timeline.axisLocal');
    axisBeijingLabel.textContent = i18n.t('timeline.axisBeijing');

    dayStart = startOfLocalDay(now, localTimeZone);
    dayEnd = startOfLocalDayOffset(now, localTimeZone, 1);
    const span = dayEnd - dayStart;
    const xFor = (instant) => PLOT.x + clamp01((instant - dayStart) / span) * PLOT.width;

    caption.textContent = i18n.t('timeline.dayCaption', {
      date: dateStamp(dayStart, localTimeZone),
      weekday: weekdayName(i18n, dayStart, localTimeZone),
    });

    bandLayer.replaceChildren();
    gridLayer.replaceChildren();

    // 1. The band. Off-peak is the default; anything the expanded range cannot
    //    answer is drawn as unknown rather than silently assumed off-peak.
    const range = timeline?.range ?? null;
    const segments = [];
    if (range == null || range.end <= dayStart || range.start >= dayEnd) {
      segments.push({ start: dayStart, end: dayEnd, state: PeakState.unknown });
    } else {
      const coverStart = Math.max(dayStart, range.start);
      const coverEnd = Math.min(dayEnd, range.end);
      if (dayStart < coverStart) segments.push({ start: dayStart, end: coverStart, state: PeakState.unknown });
      segments.push({ start: coverStart, end: coverEnd, state: PeakState.offPeak });
      if (coverEnd < dayEnd) segments.push({ start: coverEnd, end: dayEnd, state: PeakState.unknown });
    }
    for (const segment of segments) {
      const x = xFor(segment.start);
      const width = Math.max(0.5, xFor(segment.end) - x);
      bandLayer.append(svg('rect', {
        class: `track track--${segment.state}`,
        x,
        y: PLOT.y,
        width,
        height: PLOT.height,
      }));
    }

    // 2. Peak windows, clipped to the day being drawn.
    const windows = timeline == null
      ? []
      : timeline.windowsIntersecting({ start: dayStart, end: dayEnd });
    for (const window_ of windows) {
      const start = Math.max(window_.start, dayStart);
      const end = Math.min(window_.end, dayEnd);
      const x = xFor(start);
      const width = Math.max(1, xFor(end) - x);
      const rect = svg('rect', {
        class: 'band band--peak',
        x,
        y: PLOT.y,
        width,
        height: PLOT.height,
        fill: `url(#${hatchId})`,
      }, [
        svg('title', {
          text: i18n.t('timeline.windowTitle', {
            start: clock(start, localTimeZone),
            end: clock(end, localTimeZone),
            state: i18n.t('legend.peak'),
          }),
        }),
      ]);
      bandLayer.append(rect);
    }

    // 3. Hour ticks. Gridlines every hour; labels every third hour, carrying
    //    both the local hour (the axis) and the Beijing hour (the rule).
    const civil = zonedParts(dayStart, localTimeZone);
    const dayCivil = { year: civil.year, month: civil.month, day: civil.day };
    for (let hour = 0; hour < 24; hour += 1) {
      const instant = instantFromCivil({ ...dayCivil, hour, minute: 0, second: 0 }, localTimeZone);
      if (!Number.isFinite(instant) || instant < dayStart || instant >= dayEnd) continue;
      const x = xFor(instant);
      gridLayer.append(svg('line', {
        class: 'grid-line',
        x1: x,
        y1: PLOT.y,
        x2: x,
        y2: PLOT.y + PLOT.height,
      }));
      if (hour % TICK_STEP !== 0) continue;
      gridLayer.append(svg('text', {
        class: 'tick-label',
        x,
        y: LABEL_LOCAL_Y,
        'text-anchor': 'middle',
        text: `${pad2(hour)}:00`,
      }));
      gridLayer.append(svg('text', {
        class: 'tick-label tick-label--sub',
        x,
        y: LABEL_BEIJING_Y,
        'text-anchor': 'middle',
        text: `${pad2(zonedParts(instant, beijingTimeZone).hour)}:00`,
      }));
    }

    // 4. The "now" marker, last so it sits above the bands.
    placeNow(i18n, now, localTimeZone);

    // 5. The accessible table.
    tableCaption.textContent = i18n.t('timeline.tableCaption');
    tableHeadStart.textContent = i18n.t('timeline.tableStart');
    tableHeadEnd.textContent = i18n.t('timeline.tableEnd');
    tableHeadDuration.textContent = i18n.t('timeline.tableDuration');
    tableHeadState.textContent = i18n.t('timeline.tableState');

    tableBody.replaceChildren();
    if (windows.length === 0) {
      tableBody.append(el('tr', {}, [el('td', { colspan: 4, text: i18n.t('timeline.empty') })]));
    } else {
      for (const window_ of windows) {
        const start = Math.max(window_.start, dayStart);
        const end = Math.min(window_.end, dayEnd);
        tableBody.append(el('tr', {}, [
          el('td', { text: clock(start, localTimeZone) }),
          el('td', { text: clock(end, localTimeZone) }),
          el('td', { text: durationText(i18n, (end - start) / 1000) }),
          el('td', { text: i18n.t('legend.peak') }),
        ]));
      }
    }
  }

  /** Moves only the "now" marker; the bands change once per data load. */
  function tick(view) {
    placeNow(view.i18n, view.now, view.localTimeZone);
  }

  return { element, render, tick };
}
