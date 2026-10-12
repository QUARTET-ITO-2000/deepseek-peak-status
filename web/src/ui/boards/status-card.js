/**
 * Board 1 — the headline status card.
 *
 * The app's status row is reproduced faithfully: the same three headlines, the
 * same per-second countdown, and the same caption explaining an off-peak
 * instant that is off-peak because of a *date* rule rather than because it sits
 * between two peak windows.
 *
 * Two things are added, both required by the plan, neither of which touches the
 * judgement itself:
 *
 *   - the Beijing clock and the visitor's own clock are shown together, so a
 *     reader in another zone can tell which calendar day the rule is applied
 *     to — the ambiguity the legend exists to resolve;
 *   - a `window-drop` parse problem turns the *off-peak* card amber. A
 *     confident green "off-peak" is the only output that can talk someone into
 *     paying peak prices, so it is the one reading that gets downgraded. A
 *     "peak" reading is unaffected and stays green-free.
 */

import { el } from '../dom.js';
import { PeakState, reasonDetailText } from '../../models/peak-state.js';
import { countdown, zoneAbbreviation } from '../../support/display-formatting.js';
import { clock, clockSeconds } from '../format.js';

const STATE_CLASS = {
  [PeakState.offPeak]: 'is-offpeak',
  [PeakState.peak]: 'is-peak',
  [PeakState.unknown]: 'is-unknown',
};

const MASCOT_ASSET = {
  [PeakState.peak]: 'peak',
  [PeakState.offPeak]: 'offpeak',
  [PeakState.unknown]: 'unknown',
};

const MASCOT_URL = Object.fromEntries(
  Object.entries(MASCOT_ASSET).map(([state, name]) => [
    state,
    new URL(`../../../assets/whale-girl-${name}.png`, import.meta.url).href,
  ]),
);

export function createStatusCard() {
  const mascot = el('img', {
    class: 'status-mascot',
    src: MASCOT_URL[PeakState.unknown],
    alt: '',
    'aria-hidden': 'true',
    decoding: 'async',
  });
  const dot = el('span', { class: 'status-dot', 'aria-hidden': 'true' });
  const headline = el('h2', { class: 'status-headline', id: 'status-headline' });
  const badge = el('span', { class: 'status-badge' });
  const badgeRow = el('p', { class: 'status-badge-row' }, [badge]);
  const detail = el('p', { class: 'status-detail' });
  const reason = el('p', { class: 'status-reason' });
  const windowLine = el('p', { class: 'status-window' });
  const degradedNote = el('p', { class: 'status-degraded-note' });

  const countdownLabel = el('span', { class: 'countdown-label' });
  const countdownValue = el('span', { class: 'countdown-value' });
  const countdownRow = el('p', { class: 'countdown' }, [countdownLabel, countdownValue]);

  const beijingLabel = el('dt', { class: 'clock-label' });
  const beijingValue = el('span', { class: 'clock-value' });
  const beijingZone = el('span', { class: 'clock-zone' });
  const localLabel = el('dt', { class: 'clock-label' });
  const localValue = el('span', { class: 'clock-value' });
  const localZone = el('span', { class: 'clock-zone' });

  const clocks = el('dl', { class: 'clocks' }, [
    el('div', { class: 'clock-row' }, [
      beijingLabel,
      el('dd', { class: 'clock-reading' }, [beijingValue, beijingZone]),
    ]),
    el('div', { class: 'clock-row' }, [
      localLabel,
      el('dd', { class: 'clock-reading' }, [localValue, localZone]),
    ]),
  ]);

  const content = el('div', { class: 'status-content' }, [
    el('div', { class: 'status-head' }, [dot, headline, badgeRow]),
    detail,
    reason,
    windowLine,
    degradedNote,
    countdownRow,
    clocks,
  ]);

  const element = el('section', {
    class: 'board board--status',
    'aria-labelledby': 'status-headline',
  }, [content, mascot]);

  /**
   * Cheap enough to run every second: it only assigns text and toggles classes,
   * never rebuilds the tree, so the browser does not re-lay-out the card on
   * each tick.
   */
  function render(view) {
    const { i18n, snapshot, now, localTimeZone, beijingTimeZone, degraded } = view;
    const state = snapshot?.state ?? PeakState.unknown;

    element.classList.remove('is-offpeak', 'is-peak', 'is-unknown', 'is-degraded');
    element.classList.add(STATE_CLASS[state] ?? 'is-unknown');
    if (degraded && state === PeakState.offPeak) element.classList.add('is-degraded');
    const mascotUrl = MASCOT_URL[state] ?? MASCOT_URL[PeakState.unknown];
    if (mascot.src !== mascotUrl) mascot.src = mascotUrl;

    // `unknown` covers two situations that a reader experiences very
    // differently, so they get different captions: a load that is still
    // running, and a load that finished without a timeline. Everything that
    // carries meaning — the state, the grey, the suppressed countdown — is
    // driven by `state` and is untouched by this choice. Announcing the
    // fail-closed caption while the page is still working would tell a reader
    // on a slow connection that it had given up.
    const captionKey = view.checking === true && state === PeakState.unknown ? 'checking' : state;
    headline.textContent = i18n.t(`status.headline.${captionKey}`);
    detail.textContent = i18n.t(`status.detail.${captionKey}`);

    // The app's own caption, used verbatim: a Chinese holiday name stays in
    // Chinese under the English interface because the app never translates it.
    const caption = state === PeakState.offPeak ? reasonDetailText(snapshot.offPeakReason) : '';
    reason.textContent = caption;
    reason.hidden = caption.length === 0;

    const window_ = state === PeakState.peak ? snapshot.currentWindow : null;
    if (window_ != null) {
      windowLine.textContent = i18n.t('status.windowRange', {
        start: clock(window_.start, localTimeZone),
        end: clock(window_.end, localTimeZone),
      });
      windowLine.hidden = false;
    } else {
      // Cleared as well as hidden: `hidden` is authoritative (see the `[hidden]`
      // rule in styles.css), but a range from the previous state must not be
      // able to linger in the DOM behind it.
      windowLine.hidden = true;
      windowLine.textContent = '';
    }

    if (state === PeakState.peak) {
      countdownRow.hidden = false;
      countdownLabel.textContent = i18n.t('status.remaining');
      countdownValue.textContent = countdown(snapshot.remaining ?? 0);
    } else if (state === PeakState.offPeak && snapshot.timeUntilNextPeak != null) {
      countdownRow.hidden = false;
      countdownLabel.textContent = i18n.t('status.nextPeak');
      countdownValue.textContent = countdown(snapshot.timeUntilNextPeak);
    } else {
      // Unknown, or off-peak with nothing further in the expanded range: there
      // is no honest number to show, so none is shown. `hidden` alone used to
      // be defeated by `.countdown { display: flex }`, which left the previous
      // reading visible next to an "UNKNOWN" headline; the text is cleared too
      // so that a stale countdown cannot survive even if the CSS guard goes.
      countdownRow.hidden = true;
      countdownLabel.textContent = '';
      countdownValue.textContent = '';
    }

    badgeRow.hidden = !degraded;
    badge.textContent = i18n.t('status.degraded.badge');
    degradedNote.textContent = degraded ? i18n.t('status.degraded.detail') : '';
    degradedNote.hidden = !degraded;

    beijingLabel.textContent = i18n.t('status.beijingNow');
    localLabel.textContent = i18n.t('status.localNow');
    beijingValue.textContent = clockSeconds(now, beijingTimeZone);
    localValue.textContent = clockSeconds(now, localTimeZone);
    beijingZone.textContent = zoneAbbreviation(now, beijingTimeZone);
    localZone.textContent = zoneAbbreviation(now, localTimeZone);
  }

  return { element, render };
}
