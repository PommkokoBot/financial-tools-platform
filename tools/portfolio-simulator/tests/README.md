# Tests — Institutional Portfolio Simulator

The tool is a single static HTML file with no build step. Nothing in this folder
ships to users; it exists so that a change to `index.html` can be proven not to
have moved the numbers.

## Running them

```bash
cd tools/portfolio-simulator
npm install                 # first time only
npm test                    # the jsdom suites — ~5 min, this is what CI runs
npm test -- case            # only suites whose filename contains "case"
```

Before a release, also run the browser suites (they need a real Chromium):

```bash
npx playwright install chromium
npm run test:browser
```

Everything the browser suites write — screenshots, generated `.xlsx` and `.pdf` —
lands in `tests/.out/`, which is git-ignored.

## Why these tests exist

The engines are Monte Carlo: every run draws different random numbers, so two
runs of the same build never produce the same figures. The suites replace
`Math.random` with a seeded generator, which makes a run reproducible and a
before/after comparison meaningful. Without that, "the numbers look about the
same" is the only check available, and it has missed real bugs in this codebase
before — reading the code alone once led to diagnosing entirely the wrong line.

The tool also has **three separate engines** — `runSimulation`,
`runDriftVisualizer`, `runHeatmap` — that implement the same financial rules in
parallel, copy-pasted rather than shared. Every one of them is exercised on every
run, because the recurring failure mode here is fixing one engine and leaving
another on the old logic.

## The suites

| Suite | What it proves |
|---|---|
| `unit/regression.test.js` | The engine output of the current build is **byte-identical** to the last released build across 4 scenarios × 5 outputs (main MC, drift, the on-screen stats DOM, heatmap in both timing modes). This is the one that catches "I only changed the CSS" turning out to be false. Slowest suite (~3 min). |
| `unit/case-excel.test.js` | Save/open a case: a real `.xlsx` round trip through actual file bytes, blank fields staying blank (not becoming 0), names containing `" & < >`, tolerance of columns being reordered or headers retyped in Excel, 9 kinds of bad file being rejected without touching what is on screen, and the run-results sheet only being written when the results still match the inputs. |
| `unit/pdf-report.test.js` | Export gating (not run yet / results stale / heatmap stale / optimizer cleared), page count and order for every checkbox combination, the disclaimer and watermark on every page, and the figures in the report matching the ones on screen. |
| `unit/escaping.test.js` | Portfolio and fund names cannot inject markup — asserted on the parsed DOM, by checking a hostile name produces the same elements and attributes as a harmless one. Guards the fix from 2026-09-07. |
| `unit/optimizer-sanity.test.js` | The frontier maths: the conservative pick really is minimum-risk, the Sharpe pick really is maximum Sharpe, the aggressive pick sits on the frontier, and no run mutates `pt.fundsData`. |
| `unit/fund-defaults.test.js` | The shipped default fund set, and that blank Expected fields stay blank and never produce `NaN` anywhere downstream. |
| `unit/heatmap-async.test.js` | The heatmap's `setTimeout` half completes and fills the table. |
| `browser/desktop-diff.js` | Box geometry of every element with an `id` at 1440×900, current build vs baseline. A mobile-only change that moves anything on desktop shows up here. |
| `browser/mobile-audit.js` | At 360 and 390 px: no horizontal page scroll, the three wide tables scroll instead of squeezing, tap-target census, screenshots. |
| `browser/heatmap-badge.js` | The heatmap staleness badge across its four states in a real browser. |
| `browser/case-roundtrip.js` | Fill the form through the UI → save → reload the page → re-open the file through a real file picker → every field is back. |
| `browser/pdf-export.js` | Generates a real PDF in Chromium and checks page count, no JS errors, and that the page is left clean afterwards. |

## Layout

```
tests/
  lib/harness.js        jsdom environment: seeded PRNG, canvas/Chart/marked/XLSX stubs,
                        and REAL_FUNDS — a fund set with non-blank Expected values, since
                        the shipped defaults are blank and would make every engine return 0
  lib/paths.js          every path used anywhere; nothing else may hardcode one
  lib/browser-env.js    Playwright: serves all CDN assets from node_modules, so the
                        suites never touch the network and never measure an unstyled page
  baseline/             the last released build + when and how to move it
  quarantine/           suites kept but not run, with why
  tools/                make-template.js, update-baseline.js
  run-unit.js           runs each unit suite in its own process and aggregates
```

Two environment variables override the defaults, which is how you test a
candidate build without moving it into place:

```bash
SIM_APP_FILE=/path/to/candidate.html npm test
SIM_BASELINE_FILE=/path/to/older/index.html node tests/unit/regression.test.js
```

## Two things worth knowing

**A passing baseline diff proves nothing on release day.** Right after
`npm run baseline:update`, the baseline and `index.html` are the same file, so
`regression.test.js` compares a file with itself. It only starts doing work once
someone edits `index.html`. That is the intended behaviour, not a broken test.

**The dependency versions here mirror the CDN versions in `index.html`.** If you
change one, change the other, or the browser suites stop testing what users get.
`xlsx` is currently pinned at `0.18.5` to match; both are due to move to a newer
SheetJS release served from `cdn.sheetjs.com`, because 0.18.5 has a known
prototype-pollution issue that is reachable now that the tool parses files the
user supplies.
