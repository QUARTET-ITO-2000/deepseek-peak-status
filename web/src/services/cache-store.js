/**
 * Persistence for the offline fallback.
 *
 * Replaces the app's on-disk cache (`CacheService.swift`). The browser has no
 * files, so `localStorage` stands in; when it is unavailable (private mode, or
 * a browser that blocks storage for the origin) the store degrades to an
 * in-memory map, which keeps the page working for the current session.
 *
 * The shapes stored here mirror `CachedHolidayYear` so the same reasoning about
 * staleness applies. The peak-hours schedule used to be stored here too,
 * mirroring `CachedSchedule`; it is compiled into the page now, so there is
 * nothing left to keep and nothing left to expire.
 *
 * Read-back is bounded by `ScheduleLimits`, mirroring the byte check the Swift
 * cache makes before decoding a file. `localStorage` is same-origin, so this is
 * not a network-facing boundary — it is the same "bound what you will buffer and
 * decode" rule the ingest path follows, applied to the one input that outlives a
 * page load.
 */

import { ScheduleLimits } from '../support/schedule-limits.js';

const PREFIX = 'deepseek-peak-status.';

/** Reused so a read-back does not allocate a fresh encoder each time. */
const UTF8_ENCODER = new TextEncoder();

/** UTF-8 byte length of a string, without keeping the encoded copy. */
function utf8ByteLength(text) {
  return UTF8_ENCODER.encode(text).length;
}

/** localStorage, or a session-scoped stand-in when storage is unavailable. */
function createBackingStore() {
  try {
    if (typeof window === 'undefined' || window.localStorage == null) throw new Error('no storage');
    const probe = `${PREFIX}probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => { map.set(key, String(value)); },
      removeItem: (key) => { map.delete(key); },
    };
  }
}

// Resolved lazily so the module can be imported in Node (for the test suite)
// without a DOM, and so a storage that is blocked at load time still works.
let storeInstance = null;
function store() {
  if (storeInstance == null) storeInstance = createBackingStore();
  return storeInstance;
}

/**
 * Parses a stored value, or returns `null` if it is missing, oversized or
 * malformed.
 *
 * The size test measures **UTF-8 bytes**, not `String#length`. `length` counts
 * UTF-16 code units, and a non-ASCII character is one code unit but two or three
 * bytes — so comparing `length` against a byte budget under-counts and would
 * admit an entry that is over it. Measuring the real bytes is also what the
 * Swift cache does before decoding a file.
 */
function readJSON(key, maximumBytes = null) {
  try {
    const raw = store().getItem(PREFIX + key);
    if (raw == null) return null;
    if (maximumBytes != null && utf8ByteLength(raw) > maximumBytes) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    store().setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exhaustion must never break the page.
    return false;
  }
}

export class LocalStorageHolidayCache {
  /** @returns {Array<{year, verifiedAt, isCovered, holidays, makeUpWorkdays, papers, etag}>} */
  load() {
    const entries = readJSON('holidays', ScheduleLimits.maximumHolidayCacheFileBytes);
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) => entry != null && Number.isInteger(entry.year));
  }

  save(entries) {
    return writeJSON('holidays', entries);
  }

  clear() {
    try { store().removeItem(`${PREFIX}holidays`); } catch { /* ignore */ }
  }
}

/** Visitor preferences: language and whether the China rule is applied. */
export class PreferencesStore {
  read() {
    return {
      language: readJSON('language') ?? null,
      applyChinaOffPeakRule: readJSON('applyChinaRule') ?? true,
    };
  }

  writeLanguage(language) { writeJSON('language', language); }
  writeApplyChinaOffPeakRule(value) { writeJSON('applyChinaRule', Boolean(value)); }
}
