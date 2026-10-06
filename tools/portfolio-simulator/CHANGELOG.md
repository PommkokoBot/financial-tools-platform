# Changelog — Institutional Portfolio Simulator

The tool is a single static HTML file with no build step. `index.html` is the product;
everything under `tests/` exists to prove a change did not move the numbers.

Dates are the date the work was pushed. Versions come from `APP_VERSION` in `index.html`,
which is also written into every saved case file and onto the PDF cover — so a bug report
from a stranger names the build that produced it.

---

## 1.4.0 — 2026-10-06

Two naming and disclosure changes requested after the three risk-reporting releases were
live. No engine code was touched and no number moved.

### Changed

- **"ลงลึกสุด" → "Max Drawdown"** everywhere it appeared: the metric card, the past-values
  column header, two sentences in the past-values summary, the funds-sheet column label in
  saved case files, the two keyed rows in the results sheet, the report's drawdown rows and
  the report's past-values header — eleven places in all. The Thai gloss survives in exactly
  one spot, inside `DISCLAIMER_MAXDD`, so a reader meeting the English term for the first
  time still gets it explained once.
  `maxdd.test.js` now fails if the old term appears anywhere in the document except inside
  that one caveat string — the failure mode being renamed in one place and missed in
  another, which leaves the tool calling one number two things.
- **`DISCLAIMER_SURVIVAL`** — the survival headline now says what it counts, on the page
  and directly under the KPI row in the report, from one constant. The phrase reads
  stronger than the measurement in two specific ways, and both of them flatter the result,
  so both are stated: the check happens **once, at the end of year 30**, and **any balance
  above zero passes it**. Concretely — a path that runs out mid-way and is refilled by a
  DCA set up later still counts as survived, and "more than 0" is not "enough to live on".
- `APP_VERSION` → `1.4.0`. Baseline promoted to 1.3.0 (verified on the live site first).

### Verified

- `npm test` — 16 suites pass. `regression.test.js` **ALL IDENTICAL** against the 1.3.0
  baseline: this release is wording only, and the suite proves it.
- `app-chrome.test.js` now also reads the engine's own source and asserts that survival is
  counted the way the new sentence describes (`endTotal > 0`, once, after the last month).
  A disclosure that drifts from the code it describes is worse than none, and this is the
  only check in the suite that compares prose against implementation.
- Browser suites on Chromium: `sri-load` 8/8 · `csp-load` 27/27, 0 violations ·
  `case-roundtrip`, `pdf-export` (8 pages), `heatmap-badge` pass.
- `desktop-diff` vs the 1.3.0 baseline: 32 differences, all of them the contents of
  `#section-mc` shifted down 33px by the survival sentence added to the note. Page width
  and height unchanged. `mobile-audit`: 22 sub-32px targets, unchanged.
- The Excel template was rebuilt with the renamed column header and re-checked with the
  app's own `parseCaseWorkbook()`: it parses **identically to the 1.3.0 template**, since
  the tool reads that sheet by the key row, not by the header text. A copy with the key row
  deleted is still refused.
- Six sabotages, all caught: the rename missed on the card · the rename missed in the PDF
  only · the survival explanation dropped from the page · dropped from the report · the
  explanation reworded to claim "never ran out along the way" · and the engine switched to
  `endTotal >= 0`. That last one left `regression.test.js` green (no path in those
  scenarios lands exactly on zero) and was caught by the source-reading check above —
  which is the reason that check exists.

---

## 1.3.0 — 2026-10-06

Last of the three risk-reporting releases. The feature it adds is defined as much by what
it does not do as by what it does: the figures a user types here are displayed, saved and
printed, and read by nothing.

### Added

- **Historical reference figures per fund** — past monthly 95% VaR and past Max Drawdown,
  in a panel below the fund table that is **collapsed until opened**. Deliberately not two
  more columns inside the fund table: every box in that table feeds the simulation, and
  putting boxes that do not next to boxes that do is how a user concludes that typing here
  changes the answer.
- **The model's own VaR for the same fund, beside the entered one**, so the comparison is
  like for like rather than against a portfolio-level number.
- **A portfolio-level view that refuses to invent a single number.** Drawdowns of different
  funds happen in different months and cannot be averaged into "the portfolio's past
  drawdown". What is shown is the range, the share of the phase's weight actually covered
  by the entries, and a weight-weighted figure labelled for exactly what it assumes —
  every fund bottoming in the same month, which is an upper bound, not a history.
- **`DISCLAIMER_PAST`**, printed inside the panel where the boxes are and in the report,
  saying the values are user-entered, unverified, and used in no calculation at all.
- **Two appended columns in the case file's funds sheet** (`pastVar`, `pastDd`) and a
  **keyed drawdown block appended to the results sheet**, written only on the path that
  already refuses to save results that no longer match the inputs in the same file.
- **A report block that prints only when something was entered**, so a report from someone
  who never opened the panel is byte-identical to a 1.2.0 one.

### Changed

- Typing in this panel does **not** call `markDirty()`. These values feed no engine, so the
  last Run is still valid, and sending the user to press Run again would throw away a
  correct result for nothing.
- A finished Run refreshes the panel's comparison line (from the Run button's handler, once
  `hasRunOnce`/`simResultsStale` are set — not from inside `runSimulation()`, where those
  flags still describe the previous state, and where a silent Optimizer run would repaint a
  panel the user is looking at).
- Blank stays blank: `''` means "not provided" and is stored and reloaded as such, never as
  0. A value typed as `-42` is stored as the magnitude, since fact sheets print it signed.
- **`CASE_SCHEMA_VERSION` stays at 1.** Nothing was redefined — the columns are appended and
  read by key, so a file written before this release opens here with the boxes blank, and a
  file written here still opens in 1.2.0, which looks up the keys it knows and ignores the
  rest. Bumping the number would make this release's files unopenable by any older build
  for no benefit.
- `tests/unit/csp.test.js` now resolves the file under test through `tests/lib/paths.js`
  like every other suite. It used to hardcode `<tool dir>/index.html`, so it silently
  ignored `SIM_APP_FILE` and reported on the committed file instead of the candidate build
  it was pointed at — green for a file it had never read. Found while proving the 1.1.0
  suites could go red; now proved red against a candidate build, which was impossible before.
- `tests/unit/regression.test.js` compares the whole `runSimulation()` return again, the
  1.2.0 carve-out having become unnecessary once the baseline carried `maxDrawdown` itself.
- `tests/unit/case-excel.test.js` knows about the appended drawdown block, and checks the
  yearly table is still exactly 31 rows + header at the same positions.
- The historical panel's toggle is 32px tall so it does not add to the mobile backlog.
- `APP_VERSION` → `1.3.0`. Baseline promoted to 1.2.0 (verified on the live site first).

### Fixed

- The panel kept showing "press Run to compare" after a Run had already finished, because
  only typing refreshed it. Found by looking at a real PDF export, not by a test — and the
  first test written for it passed without the fix, because it checked after typing, which
  refreshes the panel as a side effect. Rewritten to check with no typing after the Run.

### Verified

- `npm test` — 16 suites pass (`past-metrics.test.js`, 46 checks, is new).
- `regression.test.js` — **ALL IDENTICAL** against the 1.2.0 baseline, now including the
  drawdown figures in the comparison.
- Filling every historical box on every fund leaves the engine output and the phase stats
  (VaR included) byte-identical — the central claim of the feature, pinned by test.
- Case files both ways: values survive save → open; a file with the two columns physically
  removed (a pre-1.3.0 file) opens with blank boxes and **no warnings**.
- Browser suites on Chromium: `sri-load` 8/8 · `csp-load` 27/27, 0 violations ·
  `case-roundtrip`, `pdf-export`, `heatmap-badge` pass.
- `desktop-diff` vs the 1.2.0 baseline: 11 differences, all of them the left panel shifted
  down 39px by the collapsed toggle row. `mobile-audit`: back to 22 sub-32px targets after
  the toggle was given a 32px height, nothing overflowing, no new horizontal scroll.
- The Excel template was checked with the app's **own** `parseCaseWorkbook()`, loaded out of
  the `index.html` in this release: it parses with no warnings, parses **identically to the
  previous template** once the two new fields are stripped, carries typed values through
  (including `-12` normalised to `12`), and a copy with the key row deleted is refused.
- Ten sabotages, all caught by the suite that owns them: past values reaching the engine ·
  editing one marking results stale · blank stored as 0 · the upper bound becoming a plain
  average · the new columns inserted instead of appended · the drawdown block dropped from
  the case file · the report given its own copy of the caveat · the panel starting open ·
  a Run no longer refreshing the comparison line · and a space added to the inline script
  without re-running `npm run csp -- --write` (that last one would have passed before the
  `csp.test.js` fix above).

---

## 1.2.0 — 2026-10-06

Second of the three risk-reporting releases. Unlike 1.1.0 this one does touch the engine
loop, so the bar it had to clear was that every existing simulated number comes out
byte-identical — which it does.

### Added

- **Max Drawdown of the combined portfolio**, reported as two figures: the middle path and
  the path 10% of futures are worse than. The median alone reads as a ceiling on risk when
  it is the middle of a range, so it is never shown on its own.
- **Measured on a pure market index, not on the balance.** The engine compounds only the
  monthly market return of the whole portfolio into a separate index; deposits, withdrawals
  and rebalancing cashflows never enter it. Measuring the balance instead would make a
  withdrawal plan that spends itself down exactly as intended report a drawdown approaching
  −100%, which says nothing about risk — and would not be comparable with the drawdown
  figure printed in a fund's own fact sheet, which is what a reader will compare it to.
  The mix still drifts and still rebalances; those change *which* returns get compounded,
  they are simply not cashflows.
- **A block on the PDF summary page** with both figures and the caveat. Deliberately its
  own block rather than a fifth KPI box: that row is a fixed four-column grid, so a fifth
  card would wrap onto a row of its own with three empty slots.
- **`DISCLAIMER_MAXDD`** — one constant, printed on the page and in the PDF, saying that
  the figure excludes cashflows and that "bad case" is not a worst-case bound.

### Changed

- `runSimulation()` returns `maxDrawdown` and publishes it to `globalExportData`. The
  bookkeeping is taken at the end of the market-return step, before any cashflow touches a
  balance; it consumes no random number and writes nothing the engine reads back.
- The new metric card is written with `textContent` rather than the `innerText` the older
  cards use: jsdom does not implement `innerText`, so a value written that way cannot be
  verified by the suite at all. Identical behaviour in a browser for a span of plain text.
- `regression.test.js`: now that the 1.1.0 baseline carries the VaR column, the stats table
  goes back into the plain byte-for-byte DOM comparison and the 1.1.0 column-stripping
  helper is gone. The `sim` snapshot compares the fields that existed before this release
  and checks the new one separately — present in the new build on both surfaces
  (return value and `globalExportData`), absent in the baseline — so a build that quietly
  dropped it fails instead of passing as "identical".
- `var-metric.test.js`: the page-note check became `includes` rather than equality, since
  that paragraph now carries both caveats. Still compared against the constant itself.
- Baseline promoted to 1.1.0 (verified on the live site before promotion).
- `APP_VERSION` → `1.2.0`.

### Verified

- `npm test` — 15 suites pass (`maxdd.test.js`, 23 checks, is new).
- `regression.test.js` — **ALL IDENTICAL** against the 1.1.0 baseline across all four
  scenarios, including the two heatmap modes and the drift visualiser. The engine loop was
  edited and did not move a single number.
- Arithmetic checked against values computed independently in the suite, not against the
  app's own output: with volatility switched off, a +7% portfolio must report exactly zero
  drawdown, and a −12% portfolio must report the compounded 30-year figure to 1e-12.
- The design decision is pinned by test: a 20,000/month withdrawal and a 50,000/month DCA
  each leave the drawdown unchanged to within 1e-12 (float noise from dividing differently
  sized numbers; anything measuring the balance would be off by percentage points), with a
  guard that the withdrawal scenario did not deplete the portfolio, which would have made
  that comparison pass for the wrong reason.
- Browser suites on Chromium: `sri-load` 8/8 · `csp-load` 27/27, 0 violations ·
  `heatmap-badge`, `case-roundtrip` pass · `pdf-export` succeeds.
- **The PDF grew from 7 pages to 8.** The new block pushed the per-period table onto a
  page of its own; both pages were rendered and inspected, nothing overflows or is clipped.
- `desktop-diff` vs the 1.1.0 baseline: 33 differences, all of them the contents of
  `#section-mc` shifted down 32px by the caveat's second sentence, plus the new card. Page
  width and height unchanged.
- `mobile-audit` at 360px and 390px: unchanged from 1.1.0 — 22 sub-32px targets, nothing
  overflowing, no new horizontal page scroll.
- Eight sabotages, all caught: the index measuring the balance instead of market returns ·
  the bookkeeping moved after the withdrawal step · the two percentiles swapped · the
  figure printed unsigned · the PDF given its own copy of the caveat · `maxDrawdown`
  dropped from the return value · the card left unpainted · a silent run repainting the
  card the user is looking at.

---

## 1.1.0 — 2026-10-06

First of three planned releases that add risk reporting to the tool. This one is the
cheapest and most isolated of the three on purpose: it adds a number that is computed
from inputs the page already has, so no engine, no saved file and no existing output
changes. Max Drawdown (1.2.0) and the user-entered historical figures (1.3.0) follow.

### Added

- **Monthly 95% VaR column** in the Phase Stats Matrix, per portfolio per phase plus the
  weighted overview row. It is built from the same two numbers a simulated month uses —
  expected monthly return `(1+r)^(1/12)-1` and monthly S.D. `sd/√12` — so the figure
  describes the model that actually runs rather than being a second opinion derived some
  other way. It updates as you type, like S.D., with no Run required.
  Clamped at zero: when the expected return exceeds 1.645 monthly S.D. the formula turns
  negative, which is a true statement about the assumption but reads as a bug when printed
  as a loss.
- **The same column on the PDF structure page.** Not optional: `pdf-report.test.js` asserts
  the report's Phase Stats Matrix matches the on-screen table cell for cell, so a column on
  one surface and not the other is a red suite, by design.
- **`DISCLAIMER_RISK_METRICS`** — one constant, printed under the table on the page and
  under the table in the PDF. VaR is the figure most likely to be over-read, so the
  sentence saying what it is not travels with it to every surface, the same way the
  disclaimer does. `var-metric.test.js` compares both rendered surfaces to the constant.

### Changed

- `calculatePhaseStats()` and `blendWeightedStats()` now also return `var95`. Nothing in
  `runSimulation` / `runDriftVisualizer` / `runHeatmap` reads it — the value is display-only.
- `regression.test.js` now snapshots the stats table separately from the other DOM outputs.
  The table legitimately gained a column, so comparing its markup byte-for-byte against the
  1.0.0 baseline would fail for the one change that was intended. The new comparison strips
  only the VaR cell and then demands an exact match, and refuses to pass unless it found one
  VaR cell in every row — so a vanished column fails rather than passing as "identical".
  Everything else in the suite is unchanged and still compares byte-for-byte.
- `APP_VERSION` → `1.1.0`.

### Verified

- `npm test` — 14 suites pass (13 existing + `var-metric.test.js`, 30 checks).
- `regression.test.js` — **ALL IDENTICAL** against the 1.0.0 baseline across all four
  scenarios: `runSimulation`, `runDriftVisualizer` and both heatmap modes produce the same
  bytes. The engine did not move.
- Browser suites on Chromium: `sri-load` 8/8 · `csp-load` 27/27, 0 violations ·
  `heatmap-badge`, `case-roundtrip`, `pdf-export` (7 pages) pass.
- `desktop-diff`: 32 differences, all of them the contents of `#section-mc` shifted down
  41px by the new note line, plus the note itself. Page width and height unchanged.
  Checked and expected; the baseline was deliberately **not** promoted in this release.
- `mobile-audit` at 390px: unchanged from 1.0.0 — 22 sub-32px targets (same list), no new
  horizontal page scroll. The stats table already scrolled sideways before the column.
- Eight sabotages, all caught: VaR formula drifting to `r/12` · the page cell deleted ·
  an existing stats cell reformatted · the PDF given its own copy of the caveat · the PDF
  column dropped · the header removed · `var95` zeroed at the source · one space added to
  the inline script without re-running `npm run csp -- --write`.

---

## 1.0.0 — 2026-09-27

First release meant for people outside the team. Three rounds of work sit behind it: the page
had to say what it is before strangers could use it (C1), and everything security-related had
to land before the project was paused, because anything left undone would stay undone for
months (C2).

### Added

- **Disclaimer, visible without scrolling.** A non-dismissible strip under the header and the
  full text in the footer. There was previously no disclaimer anywhere on the page — it existed
  only inside the PDF export, so it was seen only by someone who had already generated a report.
  The page and every PDF page now read from the same constant, so editing one side alone turns
  `unit/app-chrome.test.js` red rather than leaving the tool saying two different things about
  itself. The strip deliberately has no close button.
- **A statement that nothing leaves the browser**, in the disclaimer, and — as of the CSP below
  — enforced by the browser rather than merely claimed.
- **`APP_VERSION`**, declared once and rendered in four places: the header, the case file's
  `_meta` sheet, the PDF cover, and the console on load.
- **Subresource Integrity on all five cross-origin subresources** — Chart.js 4.5.1, SheetJS
  0.20.3, html2canvas 1.4.1, jsPDF 2.5.1, Font Awesome 6.4.0 — with `crossorigin="anonymous"`.
  The browser hashes what the CDN actually sent and refuses to run it if it differs, so a
  compromised or silently re-published CDN file cannot execute in a visitor's browser.
  Every digest came from two independent sources: the bytes the CDN served (downloaded through
  a browser) and the pinned npm package of the same version, compared byte for byte.
- **An enforcing Content-Security-Policy.** `default-src 'none'`; the inline program allowed by
  the SHA-256 of its exact bytes; no `'unsafe-inline'` and no `'unsafe-eval'` in `script-src`.
  The directive that matters most is **`connect-src 'none'`**: the tool makes no network
  requests of its own, so the browser is told it may make none. Even code injected through some
  future hole could not send what the user typed anywhere.
- **New test suites**: `unit/csp.test.js` (recomputes the inline-script hash from the file and
  fails if the tag has drifted), `unit/cdn-provenance.test.js` (re-derives all five SRI digests
  from `node_modules` on every run), `unit/jspdf-api-lock.test.js` (see *Known limitations*),
  `browser/sri-load.js` and `browser/csp-load.js` (real Chromium, real policy, each with a
  deliberately sabotaged negative control so a passing run means something).
- **`package-lock.json`**, with CI switched from `npm install` to `npm ci`.

### Changed

- **The default fund set is now generic examples**, not four real funds sold in the market.
  Shipping real tickers next to expected-return numbers reads as a statement about those funds'
  performance, which contradicts the disclaimer the same release adds. The team's real fund set
  moved into an `.xlsx` case file opened through the existing "เปิดเคส" button, which also means
  the team updates those numbers without waiting for a code change.
  Bond S.D. is **4%**, not 6%: `classifyAsset()` buckets 6 as *Mixed*, correlating **+0.70**
  with equity instead of **−0.10**, which would make the first thing a new visitor sees show
  diversification *increasing* risk. `unit/fund-defaults.test.js` pins this.
- **Three inline `onclick` attributes became `addEventListener`** (portfolio tab close, and the
  two priority-order move buttons), required by the CSP. Behaviour is unchanged, including the
  `stopPropagation` that keeps clicking a tab's X from also switching to that tab.
- The browser harness now serves Font Awesome's stylesheet from `node_modules` instead of
  letting it fall through to the empty-body catch-all, which under SRI would be a digest
  mismatch and would have left the suites silently measuring a page whose icons were refused.

### Verified, not assumed

- `unit/regression.test.js` reports **ALL IDENTICAL** across 4 scenarios × 5 outputs (main Monte
  Carlo, drift visualiser, on-screen stats DOM, heatmap in both timing modes) — the engines did
  not move in this release.
- `browser/desktop-diff.js`: 84 elements compared, **0 geometry differences**.
- Every new suite was sabotage-tested: a one-character digest change, a stale script hash, a
  re-introduced inline handler, an added unpinned CDN script, a call to `pdf.html()`. All red.

### Known limitations

- **Clickjacking is not prevented.** `frame-ancestors` is ignored when a policy arrives in a
  `<meta>` tag, and GitHub Pages cannot set HTTP headers, so it cannot be closed from here at
  all. The directive is deliberately left out rather than included for appearance;
  `unit/csp.test.js` asserts it stays out. Moving to a host that sets headers is the fix.
- **`style-src` keeps `'unsafe-inline'`.** 23 `style=""` attributes and two inline `<style>`
  blocks; CSS cannot execute script. A deliberate trade so that `script-src` can be strict.
- **With DevTools open, two source-map requests are blocked** and logged as CSP errors
  (`chart.umd.min.js.map`, `jspdf.umd.min.js.map`). Nobody who is not debugging will ever see
  them: measured, the page makes 15 requests and none of them is a `.map`. Making them go away
  means allowing those CDN hosts in `connect-src`, which would re-open the exfiltration route
  that directive exists to close. Not worth it.
- **jsPDF 2.5.1 carries 12 published advisories (2 critical), plus 16 against the DOMPurify it
  bundles — and the tool is exposed to none of them**, because every one lives in a feature it
  does not use: AcroForm, `addJS`, FreeText, BMP decoding, new-window output, and `.html()`
  (the method that pulls DOMPurify in). The export path is html2canvas → JPEG data URL →
  `addImage`, so no user-supplied text ever reaches jsPDF. That is safety by coincidence, so
  `unit/jspdf-api-lock.test.js` turns it into safety somebody is watching: a call to any method
  outside the reviewed allow-list fails CI with the reason and the two ways forward. Upgrading
  to jsPDF 4.x is a breaking change and belongs with whatever feature needs it.
- **Accessibility**: 37 reported issues — form fields without `id`/`name`, and `<label>`
  elements not associated with their field. Screen readers and label-clicking are affected.
  Backlog, alongside the mobile card-layout work that touches the same markup.

---

## Earlier work (before versioning)

These rounds predate `APP_VERSION` and are recorded here for continuity; the detail lives in
`portfolio-sim-handoff.md` and the project's decision log.

- **2026-09-27 — hotfix.** The round B file set shipped incomplete: CI went red with
  `Cannot find module 'xlsx'`. The missing files were sent and CI returned to green. The cause
  was diagnosing the file list by diffing against a locally-modified working folder instead of
  the artifact actually pushed — the rule since is to verify against what shipped.
- **2026-09-26 — round B, security.** SheetJS moved from the abandoned npm `xlsx` 0.18.5
  (CVE-2023-30533 prototype pollution on parse, reachable the moment the tool opens a
  user-supplied case file; CVE-2024-22363 ReDoS) to 0.20.3 from the vendor's own CDN, with
  `unit/sheetjs-provenance.test.js` proving the `@e965/xlsx` republish the tests run is
  byte-identical to it. Tailwind's Play CDN, which compiled CSS in the visitor's browser on
  every load and is not intended for production, was replaced with pre-compiled inlined CSS.
- **2026-09-23 — case files.** Save and open a full case as `.xlsx`, with a real round-trip
  suite: blank fields stay blank rather than becoming 0, names containing `" & < >` survive,
  reordered columns and retyped headers are tolerated, and nine kinds of malformed file are
  rejected without touching what is on screen.
- **2026-09-07 — escaping.** Portfolio and fund names could inject markup. Fixed, and guarded
  by `unit/escaping.test.js`, which asserts on the parsed DOM that a hostile name produces the
  same elements and attributes as a harmless one.
