/**
 * Board 3 — the next 14 days, as a heat map.
 *
 * 14 columns (Beijing days) by 24 rows (Beijing hours) = 336 rects, which is
 * nothing for SVG and keeps every cell hoverable, focusable and printable.
 *
 * The board is drawn on the *Beijing* calendar day, unlike the timeline beside
 * it, because the off-peak rule is written in Beijing days. That is exactly why
 * the legend has to spell the convention out: for a viewer in North America a
 * suppressed day would otherwise look like it had only been suppressed for
 * half its length.
 *
 * A whole suppressed day therefore shows up as one contiguous 24-cell column —
 * which is the single thing this board exists to make visible.
 *
 * Peak cells are hatched as well as coloured, so the chart still reads without
 * colour perception.
 */

import { el, svg } from '../dom.js';
import { PeakState } from '../../models/peak-state.js';
import { instantFromCivil, zonedParts, addCivilDays } from '../../support/zoned-date-time.js';
import { pad2, reasonShort, shortDate, weekdayName } from '../format.js';

const COLUMNS = 14;
const ROWS = 24;
const CELL_WIDTH = 56;
const CELL_HEIGHT = 18;
const GAP = 2;
const GUTTER_LEFT = 48;
const HEADER_TOP = 62;
const WIDTH = GUTTER_LEFT + COLUMNS * (CELL_WIDTH + GAP) - GAP;
const HEIGHT = HEADER_TOP + ROWS * (CELL_HEIGHT + GAP) - GAP;
const HOUR_MS = 3_600_000;

let sequence = 0;

function cellX(column) {
  return GUTTER_LEFT + column * (CELL_WIDTH + GAP);
}

function cellY(row) {
  return HEADER_TOP + row * (CELL_HEIGHT + GAP);
}

function cellKey(column, row) {
  return `${column}:${row}`;
}

export function createHeatmap() {
  const id = `heatmap-${(sequence += 1)}`;
  const hatchId = `${id}-hatch`;

  const titleNode = svg('title');
  const descNode = svg('desc');
  const defs = svg('defs', {}, [
    svg('pattern', {
      id: hatchId,
      patternUnits: 'userSpaceOnUse',
      width: 6,
      height: 6,
      patternTransform: 'rotate(45)',
    }, [
      svg('rect', { width: 6, height: 6, class: 'hatch-base' }),
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-line' }),
    ]),
  ]);

  const axisLayer = svg('g');
  const headerLayer = svg('g');
  const cellLayer = svg('g');

  const chart = svg('svg', {
    class: 'chart chart--heatmap',
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  }, [titleNode, descNode, defs, axisLayer, headerLayer, cellLayer]);

  const heading = el('h3', { class: 'board-title', id: `${id}-heading` });
  const hint = el('p', { class: 'board-hint' });
  const element = el('section', {
    class: 'board board--heatmap',
    'aria-labelledby': `${id}-heading`,
  }, [heading, hint, el('div', { class: 'chart-scroll' }, [chart])]);

  const cells = new Map();

  // Arrow-key walking, on top of the per-cell tab stop the plan asks for.
  // Tabbing through 336 cells is legal but tedious; this makes the board
  // actually usable from the keyboard without removing any tab stop.
  chart.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof SVGElement)) return;
    const column = Number(target.dataset?.column);
    const row = Number(target.dataset?.row);
    if (!Number.isInteger(column) || !Number.isInteger(row)) return;

    let nextColumn = column;
    let nextRow = row;
    switch (event.key) {
      case 'ArrowRight': nextColumn = Math.min(COLUMNS - 1, column + 1); break;
      case 'ArrowLeft': nextColumn = Math.max(0, column - 1); break;
      case 'ArrowDown': nextRow = Math.min(ROWS - 1, row + 1); break;
      case 'ArrowUp': nextRow = Math.max(0, row - 1); break;
      case 'Home': nextColumn = 0; break;
      case 'End': nextColumn = COLUMNS - 1; break;
      case 'PageUp': nextRow = 0; break;
      case 'PageDown': nextRow = ROWS - 1; break;
      default: return;
    }
    event.preventDefault();
    cells.get(cellKey(nextColumn, nextRow))?.focus();
  });

  function render(view) {
    const { i18n, now, beijingTimeZone, timeline, calendar } = view;

    heading.textContent = i18n.t('heatmap.title');
    hint.textContent = i18n.t('heatmap.hint');
    titleNode.textContent = i18n.t('heatmap.title');
    descNode.textContent = i18n.t('heatmap.aria');
    chart.setAttribute('aria-label', i18n.t('heatmap.aria'));

    // The 14 Beijing days, starting with the one containing `now`.
    const todayCivil = zonedParts(now, beijingTimeZone);
    const dayCivils = [];
    for (let column = 0; column < COLUMNS; column += 1) {
      dayCivils.push(addCivilDays(todayCivil, column));
    }
    // Midnight, not "the current time with the hour set to zero": `addCivilDays`
    // keeps the time of day, so leaving `minute`/`second` in place would shift
    // every cell boundary by however far into the hour the visitor arrived —
    // and the row index below is computed from that boundary.
    const midnight = (civil) => instantFromCivil(
      { ...civil, hour: 0, minute: 0, second: 0 },
      beijingTimeZone,
    );
    const dayStarts = dayCivils.map(midnight);
    const dayEnds = dayCivils.map((civil) => midnight(addCivilDays(civil, 1)));

    // Which cells are peak. Beijing has no daylight saving, so a Beijing day is
    // exactly 24 hours and the row index is plain arithmetic — no per-cell
    // search over the window list.
    const peakCells = new Set();
    if (timeline != null) {
      const span = { start: dayStarts[0], end: dayEnds[COLUMNS - 1] };
      for (const window_ of timeline.windowsIntersecting(span)) {
        for (let column = 0; column < COLUMNS; column += 1) {
          const overlapStart = Math.max(window_.start, dayStarts[column]);
          const overlapEnd = Math.min(window_.end, dayEnds[column]);
          if (overlapEnd <= overlapStart) continue;
          const firstRow = Math.max(0, Math.floor((overlapStart - dayStarts[column]) / HOUR_MS));
          const lastRow = Math.min(ROWS - 1, Math.ceil((overlapEnd - dayStarts[column]) / HOUR_MS) - 1);
          for (let row = firstRow; row <= lastRow; row += 1) peakCells.add(cellKey(column, row));
        }
      }
    }
    const range = timeline?.range ?? null;

    // Hour axis.
    axisLayer.replaceChildren();
    for (let row = 0; row < ROWS; row += 1) {
      axisLayer.append(svg('text', {
        class: 'tick-label',
        x: GUTTER_LEFT - 8,
        y: cellY(row) + CELL_HEIGHT / 2 + 4,
        'text-anchor': 'end',
        text: `${pad2(row)}:00`,
      }));
    }

    // Day headers.
    headerLayer.replaceChildren();
    for (let column = 0; column < COLUMNS; column += 1) {
      const dayStart = dayStarts[column];
      const center = cellX(column) + CELL_WIDTH / 2;
      const isToday = column === 0;
      const reason = calendar?.reason(dayStart) ?? null;
      const name = calendar?.holidayName(dayStart) ?? null;

      headerLayer.append(svg('text', {
        class: `day-date${isToday ? ' is-today' : ''}`,
        x: center,
        y: 14,
        'text-anchor': 'middle',
        text: isToday ? i18n.t('heatmap.today') : shortDate(dayStart, beijingTimeZone),
      }));
      headerLayer.append(svg('text', {
        class: 'day-weekday',
        x: center,
        y: 30,
        'text-anchor': 'middle',
        text: weekdayName(i18n, dayStart, beijingTimeZone),
      }));
      if (name != null) {
        // The holiday name is quoted from the data source and never translated.
        headerLayer.append(svg('text', {
          class: `day-name${reason?.kind === 'makeUpWorkday' ? ' is-makeup' : ''}`,
          x: center,
          y: 48,
          'text-anchor': 'middle',
        }, [
          svg('title', { text: reasonShort(i18n, reason) }),
          document.createTextNode(name),
        ]));
      }
    }

    // Cells.
    cellLayer.replaceChildren();
    cells.clear();
    for (let column = 0; column < COLUMNS; column += 1) {
      const suppressed = calendar?.isOffPeakDay(dayStarts[column]) ?? false;
      for (let row = 0; row < ROWS; row += 1) {
        const start = dayStarts[column] + row * HOUR_MS;
        const end = start + HOUR_MS;
        let state;
        if (range == null || start < range.start || end > range.end) state = PeakState.unknown;
        else state = peakCells.has(cellKey(column, row)) ? PeakState.peak : PeakState.offPeak;

        const classes = ['cell', `cell--${state}`];
        if (suppressed && state !== PeakState.unknown) classes.push('cell--suppressed');

        const stateLabel = i18n.t(`legend.${state}`);
        const date = shortDate(start, beijingTimeZone);
        const title = state === PeakState.unknown
          ? i18n.t('heatmap.cellTitle', {
            date, hour: pad2(row), nextHour: pad2(row + 1), state: stateLabel,
          })
          : `${i18n.t('heatmap.cellTitle', {
            date, hour: pad2(row), nextHour: pad2(row + 1), state: stateLabel,
          })}${suppressed ? ` · ${reasonShort(i18n, calendar.reason(start))}` : ''}`;

        const rect = svg('rect', {
          class: classes.join(' '),
          x: cellX(column),
          y: cellY(row),
          width: CELL_WIDTH,
          height: CELL_HEIGHT,
          rx: 3,
          tabindex: '0',
          dataset: { column, row },
          ...(state === PeakState.peak ? { fill: `url(#${hatchId})` } : {}),
        }, [svg('title', { text: title })]);

        cells.set(cellKey(column, row), rect);
        cellLayer.append(rect);
      }
    }
  }

  return { element, render };
}
