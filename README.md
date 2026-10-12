# DeepSeek Peak Status

> A static page that answers one question: is DeepSeek in its peak-pricing hours right now?

**Languages:** English | [简体中文](README.zh-CN.md)

## Overview

The page shows the current state, a countdown to the next change, today's 24-hour timeline, the next 14 days as a heat map, and a plain-language list of upcoming transitions. It is pure static files: no build step, no bundler, no package manager, no runtime dependency.

The decision logic is a line-by-line port of a local macOS menu-bar app, written to match it. That agreement is the point of the project: if the page drifted from the app, it would be worse than useless, because a confident wrong "off-peak" is what talks someone into paying double.

## Not affiliated with DeepSeek

**The peak-hours rule itself is DeepSeek's, transcribed from their pricing page. The holiday arrangement is not.**

| Source | What it is | Operator |
| --- | --- | --- |
| `api-docs.deepseek.com/quick_start/pricing` | The peak-hours rule, transcribed by hand | DeepSeek |
| `holiday-cn` (via jsDelivr) | The State Council holiday arrangement, republished | A community project |

This page is **not affiliated with, endorsed by, or connected to DeepSeek** in any way. It is an independent reimplementation of a public rule.

The holiday source currently sends permissive CORS headers. That is a courtesy, not a contract: it can change at any time, which is exactly why there is a daily snapshot fallback. Long-term availability is not under this project's control.

## How it works

Two layers, and only two:

1. **The rule supplies hours.** The two windows are compiled into the page as an iCalendar document and their `RRULE`s are expanded into concrete windows.
2. **The Beijing calendar removes whole days.** Weekends and statutory holidays are billed off-peak all day, and a weekend designated as a make-up working day (调休) still is.

The second layer can only ever *delete* windows. It can never invent one, so the local rule can never manufacture a peak the rule did not publish.

**The page fails closed.** The rule is a constant compiled into the page, so it has no way to fail to arrive — but a rule that cannot be read still yields `UNKNOWN` rather than a guess of "off-peak". The holiday data is downloaded, and degrades instead of failing: losing it falls back to the weekend rule alone, and the diagnostics drawer says so.

> ⚠️ A confident green "off-peak" is the only output of this page that can cost someone money. Every design decision below follows from that one sentence.

### Degradation

Parser warnings are graded, because they do not all point the same way:

- **`window-drop`** — anything that can delete or shorten a window: an unresolvable `TZID`, an unparsable `DTSTART` or `RRULE`, an out-of-range `INTERVAL`/`COUNT`, a missing `DTEND`. These all push the result *toward* off-peak, which is the one direction a fail-closed product must not drift. Any of them turns the off-peak card from green to amber and pins a badge to it.
- **`ignored-part`** — unsupported rule branches such as `BYSETPOS`, and unknown properties. These cannot change the state, so they are listed in the diagnostics drawer and nothing else.

A degraded parse never causes a peak to be fabricated. If every event is dropped, the timeline is empty and the answer is `UNKNOWN`.

### Updating the rule

The rule is a hand transcription, so it is only as current as the last person to read the pricing page. DeepSeek can change its pricing policy at any time; when it does:

1. Edit `OfficialRule.calendar` in `web/src/sources.js` — the windows as `DTSTART`/`DTEND` pairs in UTC. The dates on those lines are a fixed anchor and carry no meaning; only the times of day do.
2. Set `OfficialRule.transcribedOn` to the day you checked. The source strip and the diagnostics drawer both report it, which is what makes a stale transcription visible rather than silent.
3. Run `npm run check-rule`. It re-parses the constant and prints every window in UTC and in Beijing time, so they can be read against the official page by eye.

Step 3 is the whole of the automated checking, and it deliberately does not know what the right answer is: hard-coding the hours would mean editing two places per policy change, and a wrong edit that was internally consistent would still pass it.

**If the change touches which days are peak, stop.** The weekday half of the rule does not live in that file. It lives in `web/src/models/off-peak-calendar.js`, and the "apply the China off-peak rule" switch is defined by that split. `check-rule` fails if the calendar starts carrying `BYDAY`, so this cannot be missed by accident.

Nothing automated compares the transcription with the pricing page — see [Known blind spots](#known-blind-spots).

## Features

### The four boards

- **Status card** — the current state in one word (`PEAK HOURS`, `OFF-PEAK` or `UNKNOWN`), a per-second countdown to the next change, and the current time shown in both Beijing time and the visitor's own zone.
- **24-hour timeline** — today drawn as one bar, with peak windows marked, a "now" line, and a visually hidden table carrying the same windows for screen readers.
- **14-day heat map** — one column per Beijing day, one row per hour: 336 cells, every one focusable and labelled. A whole suppressed day appears as one contiguous column.
- **Upcoming transitions** — the next changes in plain language, such as "14:00 today peak begins, lasting 4 hours".

### Language and controls

- **Chinese and English.** The page defaults to Chinese and switches without a reload. Holiday names are never translated, so a name always matches the official notice it came from.
- **China off-peak rule switch.** Turns the local weekend and holiday rule off to show the windows exactly as the rule states them, weekends included.
- **Diagnostics drawer.** Every parser warning, graded, alongside the official rule's URL and the date the transcription was last checked against it.

### Two conventions the legend has to spell out

"Today" means two different things on this page, on purpose:

- **The timeline** is drawn on the **visitor's** local calendar day, with each hour tick annotated with the Beijing hour that falls on it.
- **The heat map** is drawn on the **Beijing** calendar day, because that is the unit the rule is written in.

For a visitor in North America the two days do not overlap. Without the legend the two charts would read as contradicting each other.

### The tick

The timeline is expanded **once per data load**. Every second after that only queries it, by binary search, and re-reads `Date.now()` rather than accumulating a counter — a backgrounded tab whose timers were throttled would otherwise drift, and recomputing 400 days of windows every second would burn the CPU.

## Requirements

- **To view the page:** any browser from the last few years. It uses ES modules, `Intl.DateTimeFormat` and `fetch`; no polyfills are shipped, and none will be.
- **To refresh the bundled holiday data, or to check the rule:** Node 22 or newer. That is the tooling's dependency, not the page's.
- **To serve it:** any static file server. There is no server-side runtime.

## Usage

### Running locally

```sh
# from the repository root, so that relative paths are exercised as deployed
python3 -m http.server 8765
# then open http://127.0.0.1:8765/web/
```

The page must be served over HTTP rather than opened as a `file://` URL, because ES modules and `fetch` both require an origin.

### Deploying

Publish the `web/` directory. It is self-contained: no build, no install, no environment variables, no server-side runtime, and no configuration file.

- **Any static host** — Netlify, Vercel, Cloudflare Pages, S3, nginx — point the publish directory at `web/`.
- **GitHub Pages** — the branch source accepts only `/` or `/docs`, so a `web/` directory needs the Actions route: `.github/workflows/pages.yml` uploads `web/` as the Pages artifact.

The only same-origin thing the page fetches is `data/` inside its own directory, so it survives being served from a sub-path without any base-URL setting.

## Repository layout

The module tree deliberately mirrors the Swift sources one file to one file, so a reader can diff `web/src/models/off-peak-calendar.js` against `OffPeakCalendar.swift` directly.

```text
deepseek-peak-status/
├── README.md                    # English
├── README.zh-CN.md              # 简体中文
├── LICENSE                      # MIT
├── package.json                 # no dependencies; check-rule, snapshot and serve scripts
├── web/                         # the deployable site — publish this one directory
│   ├── index.html               # the shell; Chinese text is present without JS
│   ├── styles.css               # tokens for both schemes, no webfont
│   ├── assets/                  # status-card whale-girl illustrations
│   ├── data/                    # the bundled holiday fallback, refreshed daily
│   └── src/
│       ├── sources.js           # the compiled peak-hours rule, and the holiday source
│       ├── support/             # zoned-date-time.js is the only module with no Swift counterpart
│       ├── models/              # mirrors Models/*.swift
│       ├── services/            # mirrors Services/*.swift
│       └── ui/                  # i18n, the four boards, and app.js
└── tools/
    ├── check-rule.mjs           # checks the rule transcribed into web/src/sources.js
    └── snapshot.mjs             # the scheduled job that refreshes web/data
```

Nothing under `tools/` is reachable from the page; it holds the snapshot job, which writes only raw holiday documents into `web/data/`.

## Known blind spots

Declared rather than papered over — the limits of the engine and the page, not of any test suite.

- **The transcription itself.** The rule is transcribed by hand from a page of prose. Nothing automated compares the two, so a silent edit to that page would leave this one wrong until someone reads it again — which is why the diagnostics drawer shows when the transcription was last checked.
- **RRULE shapes the compiled rule does not use.** The expander implements an RFC 5545 subset — `FREQ`, `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`, `WKST`. Anything outside it is refused rather than guessed at; `P1M`/`P1Y` `DURATION` forms in particular.
- **Time zones beyond the common ones.** Conversion arithmetic was exercised mainly on `Asia/Tokyo` and daylight saving on `America/New_York`. Every other zone relies on `Intl` being right.
- **DST transitions and overlaps.** `Foundation`/ICU and JavaScript's `Intl` may disagree by an hour at a spring-forward gap or a fall-back overlap. The page pins the `'compatible'` convention — an overlap resolves to the earlier instant, a gap skips forward.
- **The 400-day expansion horizon.** Windows are expanded 400 days ahead; past that, `covers()` is what keeps the page from claiming more than it can see.
- **The rendering layer.** The boards were built and read by hand. Nothing automated checks what they look like.
- **Real-world 304 handling.** The browser transport deliberately does not send `If-None-Match`, because it is not a CORS-safelisted request header and would force a preflight the upstream is not obliged to answer.

## FAQ

### Why does the page say UNKNOWN?

Because the peak-hours rule compiled into the page could not be read. That is a defect in this repository rather than a condition of the network: the rule is a constant, so there is nothing to fetch, nothing to cache and nothing to expire. `UNKNOWN` is not an error state to be worked around; it is the honest answer, and it is always preferred over a guess of "off-peak".

### The timeline and the heat map disagree about which day is "today"

They are drawn on different calendars on purpose — the timeline on the visitor's local day, the heat map on the Beijing day, because that is the unit the rule is written in. For a visitor in North America the two days do not overlap at all. The legend states this on the page itself.

### Why did the off-peak card turn amber?

At least one `window-drop` warning was raised, meaning part of the rule could not be read and a peak window may have been lost. The card stays green only when nothing could have removed a window.

### Is this DeepSeek's official page?

No. See [Not affiliated with DeepSeek](#not-affiliated-with-deepseek). The holiday arrangement is third-party data; the peak-hours rule is DeepSeek's own, transcribed here by hand.

## License

Released under the [MIT License](LICENSE).

The whale-girl illustrations in `web/assets/` are derivative works based on the original character by 上善无形 and visual references by ZipZipPipe. They are provided under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) for non-commercial use, with attribution on the site; that license applies to the illustrations, not the source code. See the site for the original character source and attribution details.

Copyright © 2026 QUARTETTO D'ARCHI
