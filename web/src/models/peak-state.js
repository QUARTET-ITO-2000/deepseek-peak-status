/**
 * The DeepSeek pricing state derived from the published peak-hours schedule.
 *
 * Ported from `PeakState.swift`. The page is deliberately *fail closed*: when
 * the schedule cannot be verified the state is `unknown` and never silently
 * reported as `offPeak`.
 *
 * Six exports are here only to keep the file-for-file correspondence with the
 * Swift original: `isKnownState`, `headline`, `symbolName`, `accessibilityLabel`,
 * `statusIsVerified` and `statusLabel`. Nothing imports them, and nothing should
 * start: each returns a hard-coded English string — and `symbolName` names an SF
 * Symbol, a concept a browser does not have — while the page renders the same
 * facts through `ui/i18n.js` keys so the interface can be translated. They are
 * kept rather than deleted because the port's review method is a file-by-file
 * diff against the app; removing them would make every future diff of this file
 * show phantom deletions.
 */

export const PeakState = Object.freeze({
  offPeak: 'offPeak',
  peak: 'peak',
  unknown: 'unknown',
});

export function isKnownState(state) {
  return state !== PeakState.unknown;
}

/** Headline shown on the status card. */
export function headline(state) {
  switch (state) {
    case PeakState.offPeak: return 'OFF-PEAK';
    case PeakState.peak: return 'PEAK HOURS';
    default: return 'UNKNOWN';
  }
}

/** Icon family for the status row. */
export function symbolName(state) {
  switch (state) {
    case PeakState.offPeak:
    case PeakState.peak: return 'circle.fill';
    default: return 'exclamationmark.triangle.fill';
  }
}

/** Screen-reader description for the status icon. */
export function accessibilityLabel(state) {
  switch (state) {
    case PeakState.offPeak: return 'DeepSeek Peak Guard: off-peak, normal pricing';
    case PeakState.peak: return 'DeepSeek Peak Guard: peak hours, elevated pricing';
    default: return 'DeepSeek Peak Guard: pricing state unknown';
  }
}

// MARK: - Off-peak reason

/**
 * Why an instant is off-peak because of a *date* rule rather than a gap
 * between peak windows.
 *
 * A reason is one of:
 *   `{kind: 'weekend'}`
 *   `{kind: 'makeUpWorkday', name}`
 *   `{kind: 'holiday', name}`
 */
export const OffPeakReason = Object.freeze({
  weekend: { kind: 'weekend' },
  makeUpWorkday(name) { return { kind: 'makeUpWorkday', name }; },
  holiday(name) { return { kind: 'holiday', name }; },
});

/** One-line caption rendered under the headline. */
export function reasonDetailText(reason) {
  if (reason == null) return '';
  switch (reason.kind) {
    case 'weekend': return '周末 · off-peak all day';
    case 'makeUpWorkday': return `${reason.name}调休上班日 · 仍按空闲时段计费`;
    case 'holiday': return `${reason.name} · Chinese public holiday`;
    default: return '';
  }
}

/** VoiceOver-friendly phrasing of the same fact. */
export function reasonAccessibilityDescription(reason) {
  if (reason == null) return '';
  switch (reason.kind) {
    case 'weekend': return 'weekend, off-peak all day';
    case 'makeUpWorkday': return `${reason.name} make-up workday, still billed at off-peak rates`;
    case 'holiday': return `${reason.name}, Chinese public holiday`;
    default: return '';
  }
}

export function reasonsEqual(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return a.kind === b.kind && a.name === b.name;
}

// MARK: - Schedule status

/**
 * How trustworthy the schedule backing a state is.
 *
 * One of:
 *   `{kind: 'verified', date}`
 *   `{kind: 'cached', lastVerified, reason}`
 *   `{kind: 'unavailable', reason, lastVerified}`
 */
export const ScheduleStatus = Object.freeze({
  verified(date) { return { kind: 'verified', date }; },
  cached(lastVerified, reason) { return { kind: 'cached', lastVerified, reason }; },
  unavailable(reason, lastVerified = null) { return { kind: 'unavailable', reason, lastVerified }; },
});

export function statusIsVerified(status) {
  return status != null && status.kind === 'verified';
}

/** One-line description rendered in the "Schedule" section. */
export function statusLabel(status) {
  switch (status?.kind) {
    case 'verified': return 'Online / Verified';
    case 'cached': return 'Cached';
    default: return 'Unavailable';
  }
}

/** The last moment the schedule content was known to be correct. */
export function statusLastVerified(status) {
  switch (status?.kind) {
    case 'verified': return status.date;
    case 'cached': return status.lastVerified;
    case 'unavailable': return status.lastVerified ?? null;
    default: return null;
  }
}

/** Why the schedule is not fully verified, when applicable. */
export function statusDiagnosticReason(status) {
  switch (status?.kind) {
    case 'cached': return status.reason;
    case 'unavailable': return status.reason;
    default: return null;
  }
}
