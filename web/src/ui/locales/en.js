/**
 * English strings.
 *
 * Holiday names are never translated: a Chinese public holiday keeps its
 * Chinese name and is glossed with an English explanation, exactly as the app
 * does. Only the sentences are localized.
 */
export default {
  'app.title': 'DeepSeek Peak Status',
  'app.tagline': 'A third-party page · not affiliated with DeepSeek',
  'app.languageSwitch': '中文',
  'app.languageSwitchLabel': 'Switch to Chinese',

  'status.headline.offPeak': 'OFF-PEAK',
  'status.headline.peak': 'PEAK HOURS',
  'status.headline.unknown': 'UNKNOWN',
  'status.detail.offPeak': 'Standard pricing applies right now',
  'status.detail.peak': 'Tokens cost roughly 2x right now',
  'status.detail.unknown': 'The schedule could not be verified — do not read this as a price signal',
  'status.headline.checking': 'CHECKING',
  'status.detail.checking': 'Still checking the holiday calendar — the reading is not ready yet',

  'status.degraded.badge': 'Degraded parse',
  'status.degraded.detail':
    'The schedule did not parse cleanly, so the off-peak reading is advisory only. A peak reading is unaffected.',

  'status.remaining': 'Peak ends in',
  'status.nextPeak': 'Next peak in',
  'status.windowRange': 'Peak runs {start}–{end}',
  'status.beijingNow': 'Beijing time',
  'status.localNow': 'Your time',

  'timeline.title': "Today's 24-hour timeline",
  'timeline.hint':
    'Drawn on your local calendar day; each hour tick is labelled with your local time (above) and Beijing time (below)',
  'timeline.aria':
    'A 24-hour timeline for today. Peak hours are red with diagonal hatching, everything else is off-peak, and the vertical dashed line marks now.',
  'timeline.dayCaption': '{date} {weekday} (your local time)',
  'timeline.axisLocal': 'Your time',
  'timeline.axisBeijing': 'Beijing',
  'timeline.windowTitle': '{start}–{end} · {state}',
  'timeline.now': 'now',
  'timeline.empty': 'No peak window today',
  'timeline.tableCaption': "Today's peak windows, start to end",
  'timeline.tableStart': 'Start',
  'timeline.tableEnd': 'End',
  'timeline.tableDuration': 'Duration',
  'timeline.tableState': 'State',

  'heatmap.title': 'Next 14 days',
  'heatmap.hint': 'Drawn on Beijing calendar days: one column per day, one row per hour. A whole grey column is a suppressed day.',
  'heatmap.aria':
    'A 14-day heat map. Each column is one Beijing calendar day and each row is one hour. Peak cells are red with diagonal hatching; a wholly grey column means that Beijing day is billed off-peak all day.',
  'heatmap.today': 'today',
  'heatmap.cellTitle': '{date} Beijing {hour}:00–{nextHour}:00 · {state}',

  'transitions.title': 'Upcoming transitions',
  'transitions.hint': 'Peak windows are quoted in your local time; a whole suppressed day is quoted as a Beijing day.',
  'transitions.enterPeak': '{when} peak begins, lasting {duration}',
  'transitions.leavePeak': '{when} peak ends',
  'transitions.suppressedDay': '{date} (Beijing day) off-peak all day ({reason})',
  'transitions.none': 'No peak windows in the expanded range',
  'transitions.today': 'Today',
  'transitions.tomorrow': 'Tomorrow',

  'legend.peak': 'Peak',
  'legend.offPeak': 'Off-peak',
  'legend.unknown': 'Unknown',
  'legend.suppressed': 'Whole day suppressed',
  'legend.now': 'now',
  'legend.convention':
    '"Today" means two different things here, on purpose: the timeline follows your local calendar day, the heat map follows the Beijing calendar day. For a viewer in North America the two do not overlap.',

  'controls.applyChinaRule': 'Apply the China off-peak rule (weekends and statutory holidays)',
  'controls.applyChinaRuleOff': 'China off-peak rule is off: weekends and statutory holidays are not removed',
  'controls.refresh': 'Refresh',
  'controls.refreshing': 'Refreshing…',

  'source.builtIn': 'Built-in rule',
  'source.unavailable': 'Unavailable',
  'source.dataAge': 'Data age',

  'holiday.status.verified': 'Verified',
  'holiday.status.partial': 'Partly available',
  'holiday.status.off': 'Not applied',

  'diagnostics.title': 'Diagnostics',
  'diagnostics.officialRule': 'Official rule',
  'diagnostics.ruleTranscribed': 'Rule transcribed',
  'diagnostics.scheduleStatus': 'Schedule status',
  'diagnostics.holidayStatus': 'Holiday data',
  'diagnostics.holidayUnavailable':
    'Holiday data is unavailable, so the page fell back to the weekend rule alone. The peak-hours rule itself is unaffected.',
  'diagnostics.degradedNote':
    'Some warnings can delete or shorten peak windows (window-drop), so the off-peak reading is shown in a degraded state.',
  'diagnostics.note': 'Note',
  'diagnostics.warnings': 'Parser warnings',
  'diagnostics.noWarnings': 'No warnings',
  'diagnostics.severity.windowDrop': 'drops windows',
  'diagnostics.severity.ignoredPart': 'ignored part',
  'diagnostics.pendingYears': 'Not published yet',
  'diagnostics.failedYears': 'Unavailable years',
  'diagnostics.coveredYears': 'Covered years',
  'diagnostics.sourcePapers': 'Source documents',
  'diagnostics.expandedWindows': 'Expanded windows',

  'footer.disclaimer':
    'The peak-hours rule is transcribed from the official DeepSeek pricing page; the holiday arrangement is republished from the State Council notices by a third party. This page is not affiliated with DeepSeek; its decision logic is ported from a local macOS app.',
  'footer.unknownPriority': 'An "unknown" answer is always preferred over a possibly wrong "off-peak".',

  'relative.justNow': 'just now',
  'relative.minutesAgo': '{count} minutes ago',
  'relative.hoursAgo': '{count} hours ago',
  'relative.daysAgo': '{count} days ago',

  'weekday.1': 'Sun',
  'weekday.2': 'Mon',
  'weekday.3': 'Tue',
  'weekday.4': 'Wed',
  'weekday.5': 'Thu',
  'weekday.6': 'Fri',
  'weekday.7': 'Sat',

  'reason.weekend': 'weekend',
  'reason.holidayNamed': '{name} (public holiday)',
  'reason.makeUpNamed': '{name} (make-up workday)',

  'duration.hours': '{count} hours',
  'duration.minutes': '{count} minutes',
  'duration.hoursMinutes': '{hours} h {minutes} min',
};
