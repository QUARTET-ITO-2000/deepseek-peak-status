/**
 * The page shell.
 *
 * The peak-hours rule is compiled into the page and parsed on every load, so
 * the schedule half of the page has no way left to fail. The holiday half still
 * does: it is downloaded, cached in `localStorage` and falls back to the
 * bundled `web/data` copy, and a failure there degrades the reading rather than
 * the schedule.
 *
 * Tick architecture (§9.2): the timeline is expanded **once per data load**.
 * Every second after that only *queries* it, by binary search, and re-reads
 * `Date.now()` rather than accumulating — a backgrounded tab whose timers were
 * throttled would otherwise drift.
 */

import { I18n, detectLanguage } from './i18n.js';
import { createStatusCard } from './boards/status-card.js';
import { createTimelineChart } from './boards/timeline-chart.js';
import { createHeatmap } from './boards/heatmap.js';
import { createTransitions } from './boards/transitions.js';
import { el, replaceChildren } from './dom.js';
import { relativeAge } from './format.js';
import { systemTimeZone } from '../support/display-formatting.js';
import { Interval } from '../support/interval.js';
import { instantFromCivil, zonedParts } from '../support/zoned-date-time.js';
import { OffPeakCalendar } from '../models/off-peak-calendar.js';
import {
  statusDiagnosticReason,
  statusIsVerified,
  statusLastVerified,
  ScheduleStatus,
} from '../models/peak-state.js';
import { Schedule } from '../models/schedule.js';
import { StateService } from '../services/state-service.js';
import {
  ScheduleService,
  classifyWarnings,
  createBrowserTransport,
} from '../services/schedule-service.js';
import { HolidayService } from '../services/holiday-service.js';
import {
  LocalStorageHolidayCache,
  PreferencesStore,
} from '../services/cache-store.js';
import { OfficialRule, SnapshotPaths } from '../sources.js';

const BEIJING = OffPeakCalendar.timeZoneIdentifier;
/** Periodic re-check of the holiday data, plus a re-check when a backgrounded tab comes forward. */
const RELOAD_INTERVAL = 30 * 60_000;
const VISIBILITY_STALE_AFTER = 5 * 60_000;

// MARK: - Wiring

const preferences = new PreferencesStore();
const stored = preferences.read();
const i18n = new I18n(detectLanguage(stored.language));
const localTimeZone = systemTimeZone();

let applyChinaRule = stored.applyChinaOffPeakRule;

const scheduleService = new ScheduleService();
const holidayService = new HolidayService({
  transport: createHolidayTransport(),
  cache: new LocalStorageHolidayCache(),
});
const stateService = new StateService();

// MARK: - Data

let schedule = null;
let baseTimeline = null;
let timeline = null;
let calendar = null;
let status = null;
let holidayResult = null;
let severity = { dropped: [], ignored: [] };
let loadedAt = 0;
let busy = false;
/** Set when a load is asked for while another is already in flight. */
let reloadQueued = false;

let renderedLocalDay = null;
let renderedBeijingDay = null;

// MARK: - Elements

const statusCard = createStatusCard();
const timelineChart = createTimelineChart();
const heatmap = createHeatmap();
const transitions = createTransitions();

const pageTitle = document.getElementById('page-title');
const pageTagline = document.getElementById('page-tagline');
const languageButton = document.getElementById('language-toggle');
const refreshButton = document.getElementById('refresh-button');
const footerDisclaimer = document.getElementById('footer-disclaimer');
const footerNote = document.getElementById('footer-unknown');
const footerMeta = document.getElementById('footer-meta');
const tailEasterEggButton = document.getElementById('tail-easter-egg');
const tailEasterEggMessage = document.getElementById('tail-easter-egg-message');
const sourceStrip = document.getElementById('source-strip');
let lastEasterEggMessageKey = null;

const legendList = el('ul', { class: 'legend' });
const legendConvention = el('p', { class: 'legend-convention' });

const ruleCheckbox = el('input', { type: 'checkbox', id: 'apply-china-rule' });
const ruleLabel = el('label', { class: 'control-label', for: 'apply-china-rule' });
const ruleNote = el('p', { class: 'control-note' });
const controls = el('section', { class: 'board board--controls' }, [
  el('div', { class: 'control-row' }, [ruleCheckbox, ruleLabel]),
  ruleNote,
]);

const diagnosticsSummary = el('summary');
const diagnosticsBody = el('div', { class: 'diagnostics-body' });
const diagnostics = el('details', { class: 'board board--diagnostics', id: 'diagnostics' }, [
  diagnosticsSummary,
  diagnosticsBody,
]);

function mount(id, node) {
  const host = document.getElementById(id);
  if (host != null) replaceChildren(host, [node]);
}

mount('slot-status', statusCard.element);
mount('slot-controls', controls);
mount('slot-timeline', timelineChart.element);
mount('slot-heatmap', heatmap.element);
mount('slot-transitions', transitions.element);
mount('slot-legend', el('section', { class: 'board board--legend' }, [legendList, legendConvention]));
mount('slot-diagnostics', diagnostics);

// MARK: - Transports

/**
 * The holiday transport: the network first, then the bundled copy for that
 * year. The year is recovered from the URL the service asked for, so the
 * service itself needs no knowledge of the snapshot layout.
 */
function createHolidayTransport() {
  const network = createBrowserTransport();
  return {
    async fetch(request) {
      try {
        return await network.fetch(request);
      } catch (error) {
        const match = /(\d{4})\.json(?:\?.*)?$/.exec(request.url ?? '');
        if (match == null) throw error;
        try {
          const response = await fetch(SnapshotPaths.holidays(Number(match[1])), { cache: 'no-store' });
          if (!response.ok) throw error;
          return {
            statusCode: 200,
            body: await response.text(),
            etag: null,
            lastModified: null,
            notModified: false,
          };
        } catch {
          throw error;
        }
      }
    },
  };
}

// MARK: - Loading

/**
 * Returns every piece of derived state to "nothing is known".
 *
 * Used only when the load path itself misbehaves. Leaving the previous reading
 * on screen would present it as still verified, which is the one direction this
 * page must never drift; clearing it makes the failure visible instead.
 */
function resetToUnknown(reason) {
  schedule = null;
  baseTimeline = null;
  timeline = null;
  calendar = null;
  holidayResult = null;
  status = ScheduleStatus.unavailable(reason, null);
  severity = { dropped: [], ignored: [] };
}

/**
 * Builds the schedule and the holiday calendar, then publishes the result.
 *
 * Never throws: a failure anywhere on the path — including an unexpected one
 * from a service that promises not to throw — is mapped to a fail-closed state
 * that the diagnostics panel can explain.
 */
async function loadOnce() {
  try {
    const now = Date.now();

    // The schedule is a constant compiled into the page, so it is read
    // synchronously and cannot fail. Its "verified" date is the day a human
    // last compared the transcription with the official pricing page, which is
    // what the source strip reports as the data's age.
    schedule = scheduleService.load(now);
    baseTimeline = schedule?.timeline(now) ?? null;
    // `transcribedOn` is a calendar date, but `ScheduleStatus.verified` carries
    // an *instant*: `statusLastVerified` is subtracted from `now` to age the
    // label, so storing the string made that subtraction `NaN` and the source
    // strip read "Data age · NaN days ago". Parse it once, here, at the
    // boundary. A date-only string is read as UTC midnight, which is the same
    // reading `renderDiagnostics` already applies when it formats the value back
    // through `toISOString` — anchoring it anywhere else would make that row
    // print the previous day. An unreadable date yields `null`, which drops the
    // age label rather than inventing one.
    const transcribedAt = Date.parse(OfficialRule.transcribedOn);
    status = schedule == null
      ? ScheduleStatus.unavailable('The peak-hours rule compiled into the page could not be read.', null)
      : ScheduleStatus.verified(Number.isFinite(transcribedAt) ? transcribedAt : null);
    severity = classifyWarnings(schedule?.warnings ?? []);

    // The holiday half is still a download, and it is what can fail.
    holidayResult = applyChinaRule ? await loadHolidays(now) : null;
    calendar = holidayResult?.calendar ?? null;
    // A `null` calendar means the rule is switched off and the windows are
    // shown exactly as the official rule states them, weekends included; the
    // app passes `nil` here for the same reason.
    timeline = baseTimeline == null ? null : baseTimeline.suppressingOffPeakDays(calendar);
    loadedAt = now;
  } catch (error) {
    // `ScheduleService.load` and `HolidayService.load` both document that they
    // never throw, but that is a convention rather than a guarantee. A breach
    // would otherwise be a silently lost refresh: no render, and a stale
    // reading left on screen presenting itself as current.
    resetToUnknown(
      `The page could not refresh its schedule: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Requests a load, serialising concurrent callers rather than dropping them.
 *
 * The rule switch calls this and then relies on the result, so a silent
 * `return` while another load was in flight would leave the checkbox on and the
 * data unfiltered — the page claiming a rule it had not applied.
 */
async function load() {
  if (busy) {
    // Queue rather than drop. The rule switch awaits this call and then trusts
    // it, so returning silently would leave the checkbox on and the data
    // unfiltered — the page claiming a rule it never applied.
    reloadQueued = true;
    return;
  }
  busy = true;
  updateRefreshButton();

  try {
    do {
      reloadQueued = false;
      await loadOnce();
    } while (reloadQueued);
  } finally {
    busy = false;
  }

  render();
}

async function loadHolidays(now) {
  // The calendar is asked for exactly the span the windows are expanded over,
  // so the two halves of the rule always describe the same days.
  const covering = new Interval(now - Schedule.defaultLookback, now + Schedule.defaultHorizon);
  return holidayService.load({ covering, now });
}

// MARK: - View

function buildView(now) {
  const offPeakReason = calendar?.reason(now) ?? null;
  return {
    i18n,
    now,
    localTimeZone,
    beijingTimeZone: BEIJING,
    snapshot: stateService.snapshot({ timeline, status, offPeakReason, now }),
    status,
    timeline,
    schedule,
    calendar,
    holiday: holidayResult,
    degraded: severity.dropped.length > 0,
    severity,
    applyChinaRule,
    loadedAt,
    busy,
    // A `null` timeline is the page's fail-closed `unknown` state, but there
    // are two different reasons for it and the card must not conflate them.
    // This is the first: a load is in flight, there is nothing to show yet,
    // and nothing has gone wrong — the page is simply waiting on a download.
    // The holiday half runs one year at a time and each year carries its own
    // 20 s timeout, so this window can last tens of seconds, which is long
    // enough that the fail-closed caption ("do not read this as a price
    // signal") is read as a verdict the page has not actually reached.
    //
    // The second reason is a load that is over: either it finished and left no
    // timeline behind, or the compiled rule would not parse at all — in which
    // case the page already knows, before any download, that it can never
    // produce a reading, and saying "checking" would be a misstatement. Hence
    // the third clause. Only the caption changes; the state, and every rule
    // derived from it, stay exactly as they were.
    checking: busy && timeline == null && statusIsVerified(status),
  };
}

// MARK: - Rendering

function render() {
  const now = Date.now();
  const view = buildView(now);

  statusCard.render(view);
  timelineChart.render(view);
  heatmap.render(view);
  transitions.render(view);
  renderChrome(view);

  const days = dayKeys(now);
  renderedLocalDay = days.local;
  renderedBeijingDay = days.beijing;
}

function tick() {
  const now = Date.now();
  const days = dayKeys(now);
  // A local or Beijing midnight invalidates the charts, so rebuild them once.
  if (days.local !== renderedLocalDay || days.beijing !== renderedBeijingDay) {
    render();
    return;
  }
  const view = buildView(now);
  statusCard.render(view);
  timelineChart.tick(view);
  // The transitions list is ordered by time, so it starts contradicting the
  // headline the moment the clock passes its first row — "peak begins 09:00"
  // underneath a card that already reads PEAK. It re-renders itself, and only
  // when that moment actually arrives.
  //
  // The heat map needs no per-second pass: its cells are hour-granular and it
  // is rebuilt by `render()` above on a Beijing midnight, which is the only
  // thing that moves it.
  transitions.tick(view);
  // The age label in the strip is day-granular now that the schedule is a
  // constant, but the strip still has to be redrawn here: it is what shows the
  // "refreshing" marker, which comes and goes between renders.
  renderSourceStrip(view);
}

function dayKeys(now) {
  return {
    local: midnightOf(now, localTimeZone),
    beijing: midnightOf(now, BEIJING),
  };
}

function midnightOf(now, timeZone) {
  const parts = zonedParts(now, timeZone);
  return instantFromCivil({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

// MARK: - Chrome

function renderChrome(view) {
  document.documentElement.lang = i18n.language === 'zh' ? 'zh-Hans' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = i18n.t(node.dataset.i18n);
  });
  pageTitle.textContent = i18n.t('app.title');
  pageTagline.textContent = i18n.t('app.tagline');
  languageButton.textContent = i18n.t('app.languageSwitch');
  languageButton.setAttribute('aria-label', i18n.t('app.languageSwitchLabel'));
  tailEasterEggButton.setAttribute('aria-label', i18n.t('credit.easterEggLabel'));
  if (tailEasterEggButton.getAttribute('aria-expanded') === 'true' && lastEasterEggMessageKey != null) {
    tailEasterEggMessage.textContent = i18n.t(lastEasterEggMessageKey);
  }
  updateRefreshButton();

  footerDisclaimer.textContent = i18n.t('footer.disclaimer');
  footerNote.textContent = i18n.t('footer.unknownPriority');
  footerMeta.textContent = i18n.t('footer.meta');

  renderSourceStrip(view);
  renderLegend();
  renderControls();
  renderDiagnostics(view);
}

function renderSourceStrip(view) {
  const key = sourceKeyFor(view.status?.kind);
  const lastVerified = statusLastVerified(view.status);
  const age = lastVerified == null ? null : relativeAge(i18n, Math.max(0, view.now - lastVerified));

  replaceChildren(sourceStrip, [
    el('span', { class: `source-pill source-pill--${view.status?.kind ?? 'unavailable'}`, text: i18n.t(key) }),
    age == null ? null : el('span', { class: 'source-age', text: `${i18n.t('source.dataAge')} · ${age}` }),
    view.busy ? el('span', { class: 'source-age', text: i18n.t('controls.refreshing') }) : null,
  ]);
}

function renderLegend() {
  const items = [
    { className: 'is-peak', key: 'legend.peak' },
    { className: 'is-offpeak', key: 'legend.offPeak' },
    { className: 'is-suppressed', key: 'legend.suppressed' },
    { className: 'is-unknown', key: 'legend.unknown' },
    { className: 'is-now', key: 'legend.now' },
  ];
  replaceChildren(legendList, items.map((item) => el('li', { class: 'legend-item' }, [
    el('span', { class: `legend-swatch ${item.className}`, 'aria-hidden': 'true' }),
    el('span', { class: 'legend-label', text: i18n.t(item.key) }),
  ])));
  legendConvention.textContent = i18n.t('legend.convention');
}

function renderControls() {
  ruleCheckbox.checked = applyChinaRule;
  ruleLabel.textContent = i18n.t('controls.applyChinaRule');
  ruleNote.textContent = i18n.t('controls.applyChinaRuleOff');
  ruleNote.hidden = applyChinaRule;
}

function renderDiagnostics(view) {
  const now = view.now;
  diagnosticsSummary.textContent = i18n.t('diagnostics.title');

  const rows = [];
  const add = (label, value) => {
    if (value == null || value === '') return;
    rows.push(el('div', { class: 'diagnostic-row' }, [
      el('dt', { text: label }),
      el('dd', { text: String(value) }),
    ]));
  };

  rows.push(el('div', { class: 'diagnostic-row' }, [
    el('dt', { text: i18n.t('diagnostics.officialRule') }),
    el('dd', {}, [el('a', {
      href: OfficialRule.documentationURL,
      rel: 'noreferrer noopener',
      text: OfficialRule.documentationURL,
    })]),
  ]));

  add(i18n.t('diagnostics.scheduleStatus'), i18n.t(sourceKeyFor(view.status?.kind)));
  const lastVerified = statusLastVerified(view.status);
  if (lastVerified != null) {
    add(
      i18n.t('diagnostics.ruleTranscribed'),
      `${new Date(lastVerified).toISOString().slice(0, 10)} (${relativeAge(i18n, Math.max(0, now - lastVerified))})`,
    );
  }
  const diagnostic = statusDiagnosticReason(view.status);
  if (diagnostic != null) add(i18n.t('diagnostics.note'), diagnostic);
  add(i18n.t('diagnostics.expandedWindows'), view.timeline?.windows.length ?? 0);

  if (view.applyChinaRule) {
    const holidays = view.holiday;
    if (holidays == null) {
      // While the first load is still running there is nothing to report: the
      // download is in flight and "unavailable" would be a claim the page
      // cannot make yet. The row is omitted rather than guessed — `add` already
      // skips a null value. A load that has finished and produced nothing still
      // reports `unavailable`, which is the honest answer at that point.
      if (!view.checking) add(i18n.t('diagnostics.holidayStatus'), i18n.t('source.unavailable'));
    } else {
      add(i18n.t('diagnostics.holidayStatus'), i18n.t(`holiday.status.${holidays.status.kind}`));
      add(
        i18n.t('diagnostics.coveredYears'),
        [...(view.calendar?.coveredYears ?? [])].sort((a, b) => a - b).join(', '),
      );
      add(i18n.t('diagnostics.pendingYears'), holidays.pendingYears.join(', '));
      add(i18n.t('diagnostics.failedYears'), holidays.failedYears.join(', '));
      add(i18n.t('diagnostics.sourcePapers'), holidays.sourcePapers.join(' · '));
      if (holidays.failedYears.length > 0) {
        rows.push(el('p', { class: 'diagnostic-note', text: i18n.t('diagnostics.holidayUnavailable') }));
      }
    }
  } else {
    add(i18n.t('diagnostics.holidayStatus'), i18n.t('holiday.status.off'));
  }

  if (view.degraded) {
    rows.push(el('p', { class: 'diagnostic-note is-degraded', text: i18n.t('diagnostics.degradedNote') }));
  }

  const warnings = view.schedule?.warnings ?? [];
  if (warnings.length === 0) {
    add(i18n.t('diagnostics.warnings'), i18n.t('diagnostics.noWarnings'));
  } else {
    const dropped = new Set(view.severity.dropped);
    rows.push(el('div', { class: 'diagnostic-row' }, [
      el('dt', { text: i18n.t('diagnostics.warnings') }),
      el('dd', {}, [
        el('ul', { class: 'warning-list' }, warnings.map((warning) => el('li', {
          class: `warning warning--${dropped.has(warning) ? 'drop' : 'ignored'}`,
          text: `${warning} — ${i18n.t(dropped.has(warning) ? 'diagnostics.severity.windowDrop' : 'diagnostics.severity.ignoredPart')}`,
        }))),
      ]),
    ]));
  }

  replaceChildren(diagnosticsBody, [el('dl', { class: 'diagnostics-list' }, rows)]);
}

/**
 * The label for a `ScheduleStatus`. There are only two answers left: the rule
 * compiled into the page, or a rule that would not parse — which is a defect
 * here, not a condition of the network, and is shown as unavailable rather than
 * quietly presented as fine.
 */
function sourceKeyFor(kind) {
  return kind === 'verified' ? 'source.builtIn' : 'source.unavailable';
}

function updateRefreshButton() {
  refreshButton.textContent = i18n.t(busy ? 'controls.refreshing' : 'controls.refresh');
  refreshButton.disabled = busy;
}

// MARK: - Interaction

languageButton.addEventListener('click', () => {
  i18n.setLanguage(i18n.otherLanguage);
  preferences.writeLanguage(i18n.language);
  render();
});

tailEasterEggButton.addEventListener('click', () => {
  const isOpen = tailEasterEggButton.getAttribute('aria-expanded') === 'true';
  tailEasterEggButton.setAttribute('aria-expanded', String(!isOpen));
  tailEasterEggMessage.hidden = isOpen;
  if (isOpen) return;

  const messages = Array.from({ length: 4 }, (_, index) => `credit.easterEgg${index + 1}`);
  let messageKey = messages[Math.floor(Math.random() * messages.length)];
  if (messages.length > 1 && messageKey === lastEasterEggMessageKey) {
    const alternatives = messages.filter((key) => key !== lastEasterEggMessageKey);
    messageKey = alternatives[Math.floor(Math.random() * alternatives.length)];
  }
  lastEasterEggMessageKey = messageKey;
  tailEasterEggMessage.textContent = i18n.t(messageKey);
});

refreshButton.addEventListener('click', () => {
  load();
});

ruleCheckbox.addEventListener('change', async () => {
  applyChinaRule = ruleCheckbox.checked;
  preferences.writeApplyChinaOffPeakRule(applyChinaRule);

  if (!applyChinaRule) {
    // Switching the rule off needs no fetch: the unsuppressed timeline is
    // already in hand, and the windows exactly as the official rule states them
    // are what the visitor asked for.
    calendar = null;
    holidayResult = null;
    timeline = baseTimeline;
    render();
    return;
  }
  await load();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - loadedAt > VISIBILITY_STALE_AFTER) load();
});

// MARK: - Clock

function startTicking() {
  const step = () => {
    tick();
    // Re-read the wall clock each time rather than adding 1000ms: a throttled
    // background tab would otherwise accumulate error.
    setTimeout(step, 1000 - (Date.now() % 1000));
  };
  setTimeout(step, 1000 - (Date.now() % 1000));
}

setInterval(() => {
  if (Date.now() - loadedAt > RELOAD_INTERVAL) load();
}, RELOAD_INTERVAL);

load();
startTicking();
