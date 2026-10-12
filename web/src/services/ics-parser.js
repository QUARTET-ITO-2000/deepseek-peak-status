/**
 * A dependency-free RFC 5545 reader for DeepSeek peak-hours calendars.
 *
 * Ported from `ICSParser.swift`. Supported properties: `VCALENDAR`, `VEVENT`,
 * `UID`, `SUMMARY`, `DTSTART`, `DTEND`, `DURATION`, `TZID`, `RRULE`, `EXDATE`,
 * `X-WR-CALNAME`, `X-WR-TIMEZONE`. Unsupported properties are ignored;
 * unsupported rule parts become warnings.
 */

import { ICSDateParser } from './ics-date-parser.js';
import { RecurrenceRule } from '../models/recurrence-rule.js';
import { PeakEvent } from '../models/peak-event.js';
import { Schedule } from '../models/schedule.js';

export const ICSParseErrorKind = Object.freeze({
  notACalendar: 'notACalendar',
  noEvents: 'noEvents',
});

export class ICSParseError extends Error {
  constructor(kind) {
    super(kind === ICSParseErrorKind.notACalendar
      ? 'The response is not an iCalendar document (missing BEGIN:VCALENDAR).'
      : 'The calendar contains no usable peak-hours events.');
    this.name = 'ICSParseError';
    this.kind = kind;
  }
}

// MARK: - Content lines

/** A single `NAME;PARAM=VALUE:VALUE` content line. */
export class ICSProperty {
  constructor(line) {
    const separator = firstUnquotedColon(line);
    if (separator < 0) {
      this.name = null;
      this.parameters = {};
      this.value = '';
      return;
    }
    const head = line.slice(0, separator);
    this.value = line.slice(separator + 1);
    const segments = splitUnquoted(head, ';');
    const rawName = segments[0];
    if (rawName == null || rawName.length === 0) {
      this.name = null;
      this.parameters = {};
      return;
    }
    this.name = rawName.trim().toUpperCase();
    const parameters = {};
    for (const segment of segments.slice(1)) {
      const equals = segment.indexOf('=');
      if (equals < 0) continue;
      const key = segment.slice(0, equals).trim().toUpperCase();
      let parameterValue = segment.slice(equals + 1).trim();
      if (parameterValue.length >= 2 && parameterValue.startsWith('"') && parameterValue.endsWith('"')) {
        parameterValue = parameterValue.slice(1, -1);
      }
      parameters[key] = parameterValue;
    }
    this.parameters = parameters;
  }

  /** `true` when the line had a usable `NAME:VALUE` shape. */
  get isValid() {
    return this.name != null;
  }

  /** Unescapes RFC 5545 TEXT values (`\n`, `\,`, `\;`, `\\`). */
  get unescapedValue() {
    let result = '';
    const chars = [...this.value];
    for (let index = 0; index < chars.length; index += 1) {
      const character = chars[index];
      if (character !== '\\') {
        result += character;
        continue;
      }
      index += 1;
      if (index >= chars.length) break;
      const escaped = chars[index];
      switch (escaped) {
        case 'n': case 'N': result += '\n'; break;
        case ',': result += ','; break;
        case ';': result += ';'; break;
        case '\\': result += '\\'; break;
        default: result += escaped; break;
      }
    }
    return result;
  }
}

function firstUnquotedColon(line) {
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') inQuotes = !inQuotes;
    if (character === ':' && !inQuotes) return index;
  }
  return -1;
}

function splitUnquoted(text, separator) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (const character of text) {
    if (character === '"') inQuotes = !inQuotes;
    if (character === separator && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts;
}

// MARK: - DURATION

/**
 * Parses RFC 5545 DURATION values such as `PT1H30M` or `P1D`.
 *
 * `P1M` and `P1Y` are refused: the month/year forms have no fixed length and
 * cannot describe a window boundary.
 */
export function parseDuration(rawValue) {
  let value = String(rawValue).trim().toUpperCase();
  if (value.length === 0) return null;
  let sign = 1;
  if (value.startsWith('-')) {
    sign = -1;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }
  if (!value.startsWith('P')) return null;
  value = value.slice(1);

  let total = 0;
  let numberBuffer = '';
  let inTimeSection = false;
  let sawComponent = false;

  for (const character of value) {
    if (character === 'T') {
      inTimeSection = true;
      continue;
    }
    if (character >= '0' && character <= '9') {
      numberBuffer += character;
      continue;
    }
    // An empty buffer means the letter had no preceding number, which the
    // Swift `Double(_:)` call rejects (JS `Number('')` would return 0).
    if (numberBuffer.length === 0) return null;
    const amount = Number(numberBuffer);
    if (!Number.isFinite(amount)) return null;
    numberBuffer = '';
    sawComponent = true;
    if (character === 'W') {
      total += amount * 7 * 86_400;
    } else if (character === 'D') {
      total += amount * 86_400;
    } else if (character === 'H' && inTimeSection) {
      total += amount * 3_600;
    } else if (character === 'M' && inTimeSection) {
      total += amount * 60;
    } else if (character === 'S' && inTimeSection) {
      total += amount;
    } else {
      return null;
    }
  }
  if (!sawComponent || numberBuffer.length !== 0) return null;
  const signed = total * sign;
  return Number.isFinite(signed) ? signed : null;
}

// MARK: - Parser

export class ICSParser {
  /**
   * Parses calendar text into a `Schedule`.
   *
   * @throws {ICSParseError} `notACalendar` when the payload is not iCalendar,
   *   `noEvents` when it contains no usable event.
   */
  parse(text, sourceURL, fetchedAt) {
    const lines = ICSParser.unfold(text);
    if (!lines.some((line) => line.toUpperCase() === 'BEGIN:VCALENDAR')) {
      throw new ICSParseError(ICSParseErrorKind.notACalendar);
    }

    const properties = lines.map((line) => new ICSProperty(line)).filter((property) => property.isValid);

    // Calendar-level properties are collected first so an `X-WR-TIMEZONE`
    // declared anywhere in the document applies to every event.
    const calendarName = properties.find((property) => property.name === 'X-WR-CALNAME')?.unescapedValue ?? null;
    const calendarTimeZoneIdentifier = properties.find((property) => property.name === 'X-WR-TIMEZONE')?.value ?? null;
    const calendarTimeZone = ICSDateParser.timeZone(calendarTimeZoneIdentifier, 'UTC') ?? 'UTC';

    const warnings = [];
    const events = [];
    let buffer = [];
    let insideEvent = false;
    let alarmDepth = 0;

    for (const property of properties) {
      if (property.name === 'BEGIN') {
        const value = property.value.toUpperCase();
        if (value === 'VEVENT') {
          insideEvent = true;
          buffer = [];
        } else if (value === 'VALARM' && insideEvent) {
          alarmDepth += 1;
        }
        continue;
      }
      if (property.name === 'END') {
        const value = property.value.toUpperCase();
        if (value === 'VEVENT') {
          insideEvent = false;
          alarmDepth = 0;
          const event = this.#makeEvent(buffer, calendarTimeZone, warnings);
          if (event != null) events.push(event);
        } else if (value === 'VALARM') {
          alarmDepth = Math.max(0, alarmDepth - 1);
        }
        continue;
      }

      if (alarmDepth !== 0) continue;
      if (insideEvent) buffer.push(property);
    }

    if (events.length === 0) throw new ICSParseError(ICSParseErrorKind.noEvents);

    return new Schedule({
      events,
      sourceURL,
      fetchedAt,
      calendarName,
      calendarTimeZoneIdentifier,
      warnings,
    });
  }

  #makeEvent(properties, calendarTimeZone, warnings) {
    // Repeated properties: the first wins.
    const byName = new Map();
    for (const property of properties) {
      if (!byName.has(property.name)) byName.set(property.name, property);
    }
    const dtstart = byName.get('DTSTART');
    const uid = byName.get('UID')?.value ?? `event-${properties.length}-${dtstart?.value ?? 'unknown'}`;

    if (dtstart == null) {
      warnings.push(`Skipped event ${uid}: missing DTSTART.`);
      return null;
    }

    const startTimeZone = ICSDateParser.timeZone(dtstart.parameters.TZID, calendarTimeZone);
    if (startTimeZone == null) {
      warnings.push(`Skipped event ${uid}: unknown TZID ${dtstart.parameters.TZID ?? '?'}.`);
      return null;
    }
    const start = ICSDateParser.parse(dtstart.value, startTimeZone);
    if (start == null) {
      warnings.push(`Skipped event ${uid}: unparsable DTSTART ${dtstart.value}.`);
      return null;
    }

    const dtend = byName.get('DTEND');
    const endTimeZone = ICSDateParser.timeZone(dtend?.parameters.TZID, startTimeZone) ?? startTimeZone;

    let duration;
    const end = dtend != null ? ICSDateParser.parse(dtend.value, endTimeZone) : null;
    if (end != null) {
      duration = (end.date - start.date) / 1000;
      if (duration < 0) {
        warnings.push(`Event ${uid}: DTEND precedes DTSTART; window clamped to zero length.`);
        duration = 0;
      }
    } else {
      const durationProperty = byName.get('DURATION');
      const parsed = durationProperty != null ? parseDuration(durationProperty.value) : null;
      if (parsed != null) {
        duration = parsed;
      } else {
        warnings.push(`Event ${uid}: missing DTEND/DURATION; window treated as an instant.`);
        duration = 0;
      }
    }

    let rule = null;
    const rrule = byName.get('RRULE');
    if (rrule != null) {
      rule = RecurrenceRule.parse(rrule.value, startTimeZone);
      if (rule == null) {
        warnings.push(`Event ${uid}: unparsable RRULE ${rrule.value}; treated as a single event.`);
      } else if (rule.unsupportedParts.length > 0) {
        warnings.push(`Event ${uid}: ignoring unsupported RRULE parts ${rule.unsupportedParts.join(', ')}.`);
      }
    }

    const excludedDates = [];
    for (const property of properties) {
      if (property.name !== 'EXDATE') continue;
      const zone = ICSDateParser.timeZone(property.parameters.TZID, startTimeZone) ?? startTimeZone;
      for (const token of property.value.split(',')) {
        const parsed = ICSDateParser.parse(token, zone);
        if (parsed != null) excludedDates.push(parsed.date);
      }
    }

    return new PeakEvent({
      uid,
      summary: byName.get('SUMMARY')?.unescapedValue ?? null,
      startComponents: start.components,
      duration,
      recurrenceRule: rule,
      excludedDates,
      isAllDay: start.isDateOnly,
    });
  }

  /**
   * Reverses RFC 5545 line folding (CRLF followed by a single space or tab).
   */
  static unfold(text) {
    const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = [];
    for (const rawLine of normalized.split('\n')) {
      const first = rawLine[0];
      if ((first === ' ' || first === '\t') && lines.length > 0) {
        lines[lines.length - 1] += rawLine.slice(1);
      } else {
        lines.push(rawLine);
      }
    }
    return lines.filter((line) => line.trim().length > 0);
  }
}
