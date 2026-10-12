/**
 * Supplies the peak-hours schedule, plus the transport and the warning
 * vocabulary the rest of the page shares.
 *
 * Ported from `ScheduleService.swift`. The port used to carry the app's whole
 * load order — network, then `localStorage`, then a bundled snapshot, each step
 * labelled for the visitor, with a stored copy older than seven days refused as
 * unusable. All of that is gone, because the official pricing page publishes no
 * feed to download: the rule is compiled into `sources.js` and parsed here. So
 * there is nothing to fetch, nothing to cache and nothing to fall back to — and
 * no route left by which the schedule can become unavailable.
 *
 * Two things survive the removal, and neither is vestigial. The transport stays
 * because the *holiday* half of the rule is still downloaded, and a failure
 * there must still be reported in the same vocabulary. The warning
 * classification stays because a parser warning must still be able to downgrade
 * an off-peak reading, even though the only calendar it now reads is one this
 * repository owns.
 */

import { OfficialRule } from '../sources.js';
import { ScheduleLimits } from '../support/schedule-limits.js';
import { ICSParser } from './ics-parser.js';

/** Severity of a parser warning, per the public-page degradation policy. */
export const WarningSeverity = Object.freeze({
  /** Anything that can delete or shorten a window. */
  windowDrop: 'window-drop',
  /** Unsupported branches and unknown properties; does not affect state. */
  ignoredPart: 'ignored-part',
});

/**
 * Classifies a parser warning.
 *
 * Anything that can remove or shorten a window is `window-drop`, because those
 * are exactly the failures that push the result toward "off-peak" — the one
 * direction a fail-closed product must not drift. Unrecognised text defaults to
 * `window-drop` so an unanticipated warning cannot silently pass as harmless.
 */
export function classifyWarning(warning) {
  if (warning.includes('ignoring unsupported RRULE parts')) return WarningSeverity.ignoredPart;
  if (warning.includes('missing DTSTART')) return WarningSeverity.windowDrop;
  if (warning.includes('unknown TZID')) return WarningSeverity.windowDrop;
  if (warning.includes('unparsable DTSTART')) return WarningSeverity.windowDrop;
  if (warning.includes('DTEND precedes DTSTART')) return WarningSeverity.windowDrop;
  if (warning.includes('missing DTEND/DURATION')) return WarningSeverity.windowDrop;
  if (warning.includes('unparsable RRULE')) return WarningSeverity.windowDrop;
  return WarningSeverity.windowDrop;
}

/** Splits a warning list into the two severities. */
export function classifyWarnings(warnings) {
  const dropped = [];
  const ignored = [];
  for (const warning of warnings) {
    (classifyWarning(warning) === WarningSeverity.windowDrop ? dropped : ignored).push(warning);
  }
  return { dropped, ignored };
}

export class ScheduleTransportError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'ScheduleTransportError';
    this.kind = kind;
  }
}

/**
 * An abort signal that fires after `milliseconds`, plus a way to cancel it.
 *
 * `AbortSignal.timeout` is the concise form, but it is not universal: Safari
 * only gained it in 16.4. Called directly in argument position it throws a
 * `TypeError` *inside* the `try` below, which the catch reports as a generic
 * transport failure — so on an older browser the page would fall back to the
 * cache, then the snapshot, then UNKNOWN, and never say why, leaving the visitor
 * permanently offline with a reason that blames the network. The manual
 * `AbortController` + `setTimeout` pair has been available since Safari 12.1, so
 * detecting and degrading keeps those browsers on the online path.
 *
 * `release` clears the timer once the **whole exchange** has settled — headers
 * and body. It must not run any earlier: a server that answers the headers and
 * then stalls the body is the easiest way to hold a connection open, and
 * `arrayBuffer()` would wait on it forever with nothing left to abort it.
 */
function timeoutSignal(milliseconds) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(milliseconds), release() {} };
  }
  if (typeof AbortController === 'undefined') return { signal: undefined, release() {} };

  const controller = new AbortController();
  const timer = setTimeout(() => {
    // The same `name` that `AbortSignal.timeout` produces, so `describeFetchError`
    // reports "timed out" on both paths rather than "the operation was aborted".
    controller.abort(new DOMException('The request timed out.', 'TimeoutError'));
  }, milliseconds);
  // Node returns a `Timeout` object; browsers return a number. Unref'ing keeps a
  // pending request from holding the test process open.
  if (typeof timer?.unref === 'function') timer.unref();
  return { signal: controller.signal, release() { clearTimeout(timer); } };
}

/**
 * The browser transport, now used only by the holiday path.
 *
 * Unlike the app it does **not** send `If-None-Match` / `If-Modified-Since`:
 * neither is a CORS-safelisted request header, so sending one would force a
 * preflight `OPTIONS` that the upstream is not obliged to answer. The service
 * still understands a 304 so an injected transport can exercise that path.
 *
 * The size bound is the calendar budget, which is deliberately looser than the
 * holiday budget: this is the generic backstop against a response the page
 * would otherwise buffer whole, while `HolidayService` enforces its own tighter
 * limit on the document it actually decodes.
 */
export function createBrowserTransport({ fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  return {
    async fetch(request) {
      const { signal, release } = timeoutSignal(request.timeoutMs ?? timeoutMs);
      // The whole exchange sits inside the guard, the body read included.
      // Reading the body is the slow part a stalled server controls, so it has
      // to run while the signal is still armed: `release()` fires in the
      // `finally`, and anything after the `try` would be unbounded *and* would
      // throw past the catch — escaping as a raw `DOMException` instead of the
      // curated transport message.
      try {
        const response = await fetchImpl(request.url, {
          cache: 'no-store',
          redirect: 'follow',
          signal,
        });
        if (response.status === 304) {
          return {
            statusCode: 304,
            body: '',
            etag: response.headers.get('ETag'),
            lastModified: response.headers.get('Last-Modified'),
            notModified: true,
          };
        }
        if (!response.ok) {
          throw new ScheduleTransportError('httpStatus', `The server returned HTTP ${response.status}.`);
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > ScheduleLimits.maximumCalendarBytes) {
          throw new ScheduleTransportError(
            'responseTooLarge',
            `The server returned more than ${ScheduleLimits.maximumCalendarBytes / 1_024} KiB of data.`,
          );
        }
        return {
          statusCode: response.status,
          body: new TextDecoder().decode(buffer),
          etag: response.headers.get('ETag'),
          lastModified: response.headers.get('Last-Modified'),
          notModified: false,
        };
      } catch (error) {
        // The two errors raised above already carry the right kind and message;
        // re-wrapping them would relabel a size or status failure as a
        // transport one. Everything else is a genuine transport failure.
        if (error instanceof ScheduleTransportError) throw error;
        throw new ScheduleTransportError('transport', describeFetchError(error));
      } finally {
        release();
      }
    },
  };
}

function describeFetchError(error) {
  if (error?.name === 'TimeoutError') return 'The request timed out.';
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'The data could not be reached.';
}

export class ScheduleService {
  constructor({ parser = new ICSParser() } = {}) {
    this.parser = parser;
  }

  /**
   * Parses the rule compiled into the page.
   *
   * Synchronous, and it cannot fail for the constant this repository ships:
   * there is no network, no stored copy and no expiry left to get wrong. The
   * `null` return covers the one remaining possibility — the compiled calendar
   * is malformed — which is a defect here rather than a condition out there.
   * The caller turns that into an unverified schedule, so a broken constant
   * fails closed instead of putting a half-built schedule on screen.
   *
   * @param {number} now the instant the schedule is being built for
   * @returns {import('../models/schedule.js').Schedule|null}
   */
  load(now) {
    try {
      const schedule = this.parser.parse(OfficialRule.calendar, OfficialRule.documentationURL, now);
      return schedule.isEmpty ? null : schedule;
    } catch {
      return null;
    }
  }
}
