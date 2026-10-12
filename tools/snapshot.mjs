#!/usr/bin/env node
/**
 * Refreshes `web/data` with the raw upstream holiday documents.
 *
 * This tool never commits and never pushes — the scheduled workflow does that.
 * It only puts bytes on disk and reports whether anything actually changed.
 *
 * Only the holidays are refreshed. The peak-hours rule used to be mirrored here
 * from a third-party feed; it is transcribed into `web/src/sources.js` now, so
 * there is no upstream left to mirror.
 *
 * What it deliberately does **not** do is store a computed state. A state
 * depends on the instant and would be stale within hours; the whole point of
 * the snapshot is that the browser recomputes it from the same inputs with the
 * same engine.
 *
 * Two timestamps are recorded, and the difference matters:
 *
 *   generatedAt — when the raw inputs last actually changed.
 *   checkedAt   — when the job last confirmed them against upstream, even if
 *                 the answer was "not modified".
 *
 * The manifest is bookkeeping for this job alone: it is what lets a 304 or an
 * unchanged digest leave the file on disk untouched, and what makes the daily
 * run produce a one-line commit proving the job is still alive. The page never
 * reads it.
 *
 * Usage:
 *   node tools/snapshot.mjs [--out web/data] [--now <ISO>] [--dry-run]
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '..');

const HOLIDAY_URL_TEMPLATE = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json';
const TIME_ZONE = 'Asia/Shanghai';
const REQUEST_TIMEOUT_MS = 30_000;
/** The page expands a little over a year ahead, so the next year is needed too. */
const YEARS_AHEAD = 1;
/**
 * How stale `checkedAt` may get before the manifest is rewritten purely to
 * record a fresh heartbeat. A daily job therefore produces a one-line commit
 * proving it is alive, while repeated runs in the same hour produce no diff.
 */
const HEARTBEAT_INTERVAL_MS = 60 * 60_000;

// MARK: - Arguments

function parseArguments(argv) {
  const options = { out: join(REPOSITORY_ROOT, 'web', 'data'), now: new Date(), dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out') options.out = resolve(argv[++index]);
    else if (argument === '--now') options.now = new Date(argv[++index]);
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--help' || argument === '-h') {
      console.log('usage: node tools/snapshot.mjs [--out <dir>] [--now <ISO>] [--dry-run]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${argument}`);
      process.exit(2);
    }
  }
  if (Number.isNaN(options.now.getTime())) {
    console.error('--now must be a valid ISO date.');
    process.exit(2);
  }
  return options;
}

// MARK: - Helpers

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The Beijing calendar year of an instant, without pulling in a date library. */
function beijingYear(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === 'year').value);
}

async function readTextIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function readJSONIfPresent(path) {
  const text = await readTextIfPresent(path);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchText(url, etag) {
  const headers = { accept: '*/*', 'user-agent': 'deepseek-peak-status-snapshot' };
  if (etag != null) headers['if-none-match'] = etag;

  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 304) {
    return { notModified: true, etag: response.headers.get('etag') ?? etag };
  }
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return {
    notModified: false,
    etag: response.headers.get('etag'),
    body: await response.text(),
  };
}

/**
 * Fetches one resource and decides whether the stored copy still stands.
 *
 * A 304 or an unchanged digest means the file on disk is left exactly as it is,
 * so a feed that has not moved produces no diff at all.
 */
async function refreshResource({ label, url, path, previousEtag, previousDigest, dryRun }) {
  const result = await fetchText(url, previousEtag);

  if (result.notModified) {
    return { label, url, path, changed: false, notModified: true, etag: result.etag ?? previousEtag, digest: previousDigest };
  }

  const digest = sha256(result.body);
  const existing = await readTextIfPresent(path);
  const changed = digest !== previousDigest || existing !== result.body;

  if (changed && !dryRun) {
    await writeFile(path, result.body, 'utf8');
  }

  return { label, url, path, changed, notModified: false, etag: result.etag, digest };
}

// MARK: - Main

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await mkdir(options.out, { recursive: true });

  const manifestPath = join(options.out, 'snapshot.json');
  const previous = await readJSONIfPresent(manifestPath);

  const previousHolidays = previous?.holidays ?? {};

  const year = beijingYear(options.now);
  const years = [];
  for (let offset = 0; offset <= YEARS_AHEAD; offset += 1) years.push(year + offset);

  const holidays = [];
  for (const target of years) {
    const entry = previousHolidays[String(target)] ?? {};
    holidays.push(await refreshResource({
      label: `holidays-${target}.json`,
      url: HOLIDAY_URL_TEMPLATE.replace('{year}', String(target)),
      path: join(options.out, `holidays-${target}.json`),
      previousEtag: entry.etag ?? null,
      previousDigest: entry.sha256 ?? null,
      dryRun: options.dryRun,
    }));
  }

  const contentChanged = holidays.some((entry) => entry.changed);
  const checkedAt = options.now.getTime();
  // `generatedAt` only moves when the inputs themselves move; otherwise it is
  // the previous value, so it keeps meaning "when this content was produced".
  const generatedAt = contentChanged || previous?.generatedAt == null
    ? checkedAt
    : previous.generatedAt;

  const manifest = {
    _comment: 'Raw upstream holiday inputs only. No computed state: a state depends on the instant and the browser recomputes it. Bookkeeping for tools/snapshot.mjs; the page never reads this file.',
    generatedAt,
    checkedAt,
    holidays: Object.fromEntries(holidays.map((entry, index) => [
      String(years[index]),
      { url: entry.url, etag: entry.etag ?? null, sha256: entry.digest ?? null, notModified: entry.notModified },
    ])),
  };

  const serialised = `${JSON.stringify(manifest, null, 2)}\n`;
  const previousSerialised = await readTextIfPresent(manifestPath);
  const previousCheckedAt = previous?.checkedAt ?? previous?.generatedAt ?? null;
  const heartbeatDue = previousCheckedAt == null
    || (checkedAt - previousCheckedAt) >= HEARTBEAT_INTERVAL_MS;
  // Rewrite only when the inputs moved or the heartbeat is due; otherwise leave
  // the file alone so a re-run inside the same hour produces no diff at all.
  const manifestChanged = (contentChanged || heartbeatDue) && serialised !== previousSerialised;

  if (manifestChanged && !options.dryRun) {
    await writeFile(manifestPath, serialised, 'utf8');
  }

  for (const entry of holidays) {
    const state = entry.changed ? 'updated' : entry.notModified ? '304' : 'unchanged';
    console.log(`${state.padEnd(9)} ${entry.label}`);
  }
  console.log(`${manifestChanged ? 'updated' : 'unchanged'}   snapshot.json`);

  const anythingChanged = contentChanged || manifestChanged;
  console.log(anythingChanged ? 'changed' : 'no change');
  if (options.dryRun) console.log('(dry run: nothing written)');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
