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
| `unit/sheetjs-provenance.test.js` | The SheetJS the tests run is byte-identical to the 0.20.3 build `index.html` loads from cdn.sheetjs.com — size, sha384, md5, the version the library reports at runtime, and that the abandoned npm `xlsx@0.18.5` has not crept back into `node_modules`. Without this, the case-file suites could pass against somebody else's copy and read as confidence. |
| `unit/cdn-provenance.test.js` | Subresource Integrity: every cross-origin `<script>` carries a digest and `crossorigin="anonymous"`, each digest is **recomputed** from the pinned npm package rather than compared to itself, the version in the URL matches `package.json`, and no new CDN script has slipped in unpinned. The failure it exists to prevent is bumping a CDN version without the digest — the browser then refuses the script and the tool loads to a dead page, which looks fine in the diff. |
| `unit/optimizer-sanity.test.js` | The frontier maths: the conservative pick really is minimum-risk, the Sharpe pick really is maximum Sharpe, the aggressive pick sits on the frontier, and no run mutates `pt.fundsData`. |
| `unit/fund-defaults.test.js` | The shipped default fund set: the generic example funds, their exact weights and numbers, the blended statistics they produce, and — the part that is easy to break silently — that S.D. 18 / 4 keeps them on opposite sides of `classifyAsset()` so the default view actually shows a diversification benefit. A bond at S.D. 6 lands in "Mixed" and the blend becomes *worse* than the naive average; this suite catches that. Also asserts no real fund ticker ships as a page default. |
| `unit/app-chrome.test.js` | The version string (header, footer, case-file `_meta`, PDF cover) and the disclaimer. The disclaimer wording lives in one constant shared by the page footer and every PDF page, so this suite compares both rendered outputs against that constant — editing one side alone turns it red. It also asserts the visible strip exists and has no dismiss button, because deleting it would break nothing else and look fine on screen. |
| `unit/heatmap-async.test.js` | The heatmap's `setTimeout` half completes and fills the table. |
| `browser/sri-load.js` | A real Chromium loads the page with the real `integrity` attributes and all four libraries must execute. Includes a negative control: one digest is deliberately corrupted and the browser must refuse that script. Runs first in `test:browser`, because if the libraries do not load, every suite after it is measuring a broken page. |
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
SheetJS is the awkward one: `index.html` loads **0.20.3** from `cdn.sheetjs.com`,
but npm's own `xlsx` package was abandoned at 0.18.5, which carries
CVE-2023-30533 (prototype pollution, reachable the moment the tool parses a file
the user supplies) and CVE-2024-22363 (ReDoS). The tests therefore install
`@e965/xlsx`, a third-party republish of the same 0.20.3 release, and
`unit/sheetjs-provenance.test.js` checks on every run that the republish is
byte-identical to the official file. It was verified against a browser download
from `cdn.sheetjs.com` on 2026-09-26 and matched exactly.

If that suite ever goes red, do not "fix" it by re-pinning the digest. Fetch the
official file again and compare — a mirror that moved is the thing the check
exists to catch.

## Subresource Integrity — applied, and what still has to be checked by hand

All four cross-origin `<script>` tags in `index.html` now carry an `integrity`
digest and `crossorigin="anonymous"`. The browser hashes what the CDN actually
sent and refuses to run it if the digest differs, so a compromised or silently
re-published CDN file cannot execute in a visitor's browser.

Each digest came from **two independent sources**, which is the part that makes it
worth trusting: the bytes the CDN served (downloaded through a browser on a machine
that can reach them — 2026-09-27) *and* the pinned npm package of the same version,
compared byte for byte. A digest taken from one mirror and then checked against
that same mirror proves only that a file did not change on disk.

`unit/cdn-provenance.test.js` recomputes all four from `node_modules` on every run,
so bumping a CDN version and forgetting the digest turns CI red instead of killing
the tool for every visitor. `browser/sri-load.js` then makes a real Chromium run
its genuine integrity check, with a deliberately corrupted digest as a negative
control — if a wrong hash did *not* block the script, the other checks would be
measuring nothing.

**What none of this can prove:** that the CDNs send `Access-Control-Allow-Origin`.
`crossorigin="anonymous"` makes each request a CORS request, and a host that
answers without that header makes the browser drop the script *before* checking the
hash — the tool loads to a dead page with nothing on screen to say why. The offline
stub cannot test it (Chromium does not enforce CORS on a Playwright-fulfilled
response for a `file://` page — measured, not assumed). **After any change to a CDN
URL or host, open the deployed page in a real browser and confirm all four
libraries load.**

Two subresources are deliberately **not** pinned, and `cdn-provenance.test.js`
lists them with the reason so they stay visible rather than being forgotten:
Font Awesome's stylesheet (nobody has downloaded the bytes yet; a tampered
stylesheet cannot execute script, so it is a smaller hole than an unpinned
`<script>` — but it is still open) and Google Fonts (its CSS varies by browser, so
a fixed digest would break the page on some of them).

To change a version or host:

```bash
npm run sri            # print the tags, hashed from what the CDN serves
npm run sri -- --write # rewrite index.html
# then update the constants in unit/cdn-provenance.test.js to match,
# and OPEN THE PAGE IN A BROWSER before committing
```
