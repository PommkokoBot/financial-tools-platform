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
| `unit/csp.test.js` | The Content-Security-Policy: the SHA-256 pinning the inline program is **recomputed from the file** and must match the tag, the whole tag must match what `make-csp.js` would generate, the directives that would gut the policy (`'unsafe-inline'`/`'unsafe-eval'` in `script-src`, an opened `connect-src`) are absent, every host in `script-src` corresponds to a script the page really loads and vice versa, and no inline event handler exists in the markup or in the HTML the app builds at runtime. The failure it exists for: edit one character of the app's JS, forget `npm run csp -- --write`, and the browser refuses the entire program — the page renders perfectly and does nothing. |
| `unit/jspdf-api-lock.test.js` | The list of jsPDF methods the tool may call. jsPDF 2.5.1 carries 12 advisories (2 critical) plus 16 against its bundled DOMPurify, and **every one of them lives in a feature this tool does not use** — the export path is html2canvas → JPEG data URL → `addImage`, so no user text ever reaches jsPDF. That is safety by coincidence, and this suite is what turns it into safety somebody is watching. A new call turns it red with the reason and the two ways forward. |
| `unit/optimizer-sanity.test.js` | The frontier maths: the conservative pick really is minimum-risk, the Sharpe pick really is maximum Sharpe, the aggressive pick sits on the frontier, and no run mutates `pt.fundsData`. |
| `unit/fund-defaults.test.js` | The shipped default fund set: the generic example funds, their exact weights and numbers, the blended statistics they produce, and — the part that is easy to break silently — that S.D. 18 / 4 keeps them on opposite sides of `classifyAsset()` so the default view actually shows a diversification benefit. A bond at S.D. 6 lands in "Mixed" and the blend becomes *worse* than the naive average; this suite catches that. Also asserts no real fund ticker ships as a page default. |
| `unit/app-chrome.test.js` | The version string (header, footer, case-file `_meta`, PDF cover) and the disclaimer. The disclaimer wording lives in one constant shared by the page footer and every PDF page, so this suite compares both rendered outputs against that constant — editing one side alone turns it red. It also asserts the visible strip exists and has no dismiss button, because deleting it would break nothing else and look fine on screen. |
| `unit/heatmap-async.test.js` | The heatmap's `setTimeout` half completes and fills the table. |
| `browser/sri-load.js` | A real Chromium loads the page with the real `integrity` attributes and all four libraries must execute. Includes a negative control: one digest is deliberately corrupted and the browser must refuse that script. Runs first in `test:browser`, because if the libraries do not load, every suite after it is measuring a broken page. |
| `browser/csp-load.js` | Drives the whole tool in a real Chromium under the real **enforcing** policy — run, heatmap, optimizer, the two converted click handlers, saving a case to `.xlsx`, exporting the PDF — and fails on one violation, one error dialog, or one uncaught error. Includes a negative control: an un-hashed inline script must be refused. This suite exists because the usual safe rollout (Report-Only first) is impossible here; see below. |
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

## Content-Security-Policy — enforcing, and why there was no Report-Only step

The page carries an enforcing CSP in a `<meta>` tag. `default-src` is `'none'`, so any directive
nobody thought about denies by default. The inline program is allowed by the SHA-256 of its exact
bytes; `script-src` carries no `'unsafe-inline'` and no `'unsafe-eval'`, and the app uses neither
`eval` nor `new Function`.

The directive worth understanding is **`connect-src 'none'`**. The tool makes no network requests
of its own — no `fetch`, no `XMLHttpRequest`, no beacon, nothing — so the browser is told it may
make none. That turns the sentence in the disclaimer, *"ข้อมูลทั้งหมดที่ท่านกรอกถูกประมวลผลในเครื่อง
ของท่านเอง ไม่มีการส่งออก"*, from a promise the code makes into one the browser enforces. Even code
injected through some future hole could not send what the user typed anywhere.

`style-src` keeps `'unsafe-inline'`. That is a deliberate trade, not an oversight: the page has 23
`style=""` attributes and two inline `<style>` blocks, CSS cannot execute script, and locking it
down means rewriting all of them into classes and re-measuring the layout — a large change for a
small gain. The strictness goes where script execution is.

**There was no Report-Only step, because there cannot be one.** The safe rollout for CSP is
normally: ship `Content-Security-Policy-Report-Only`, read what it *would* have blocked, fix,
then enforce. That header can only arrive over HTTP, and GitHub Pages does not let us set headers,
so `<meta>` is the only channel — and Report-Only is ignored in a `<meta>` tag. Measured, not
assumed: Chromium answers a Report-Only meta tag with *"the report-only Content Security Policy
… was delivered via a `<meta>` element"* and drops the whole policy, while the same policy in
enforcing mode blocks correctly. Shipping Report-Only here would have produced a commit that looks
like protection and provides none, which is worse than a known gap.

The verification therefore happens **before** the commit instead of after, in
`browser/csp-load.js`, which exercises every feature that could trip the policy in a real browser.

**`frame-ancestors` is deliberately absent.** It is ignored in a `<meta>` tag, so including it
would imply clickjacking is handled when it is not. On GitHub Pages that gap cannot be closed at
all; moving to a host that sets HTTP headers is the only fix, and it is in the backlog. The unit
suite asserts the directive stays out, so nobody adds it later and feels safer for no reason.

### The two CSP errors you will see with DevTools open

Opening DevTools on the live page logs two blocked requests:

```
Connecting to 'https://cdn.jsdelivr.net/.../chart.umd.min.js.map' violates ... "connect-src 'none'"
Connecting to 'https://cdnjs.cloudflare.com/.../jspdf.umd.min.js.map' violates ... "connect-src 'none'"
```

**This is the policy working, not a defect, and it must not be "fixed".**

Those are source maps, and *DevTools* requests them, not the page. Measured: exactly two of the
loaded libraries carry a `sourceMappingURL` comment (Chart.js and jsPDF; html2canvas does not),
which is why there are exactly two errors — and with DevTools closed the page issues 15 requests,
of which zero are `.map`. Nobody who is not debugging will ever see this.

The only way to silence it is to add `cdn.jsdelivr.net` and `cdnjs.cloudflare.com` to
`connect-src`. That re-opens the outbound route the directive exists to close — data can be
carried out in a URL, not just in a request body — in exchange for two lines of console noise
visible only while debugging. Do not make that trade.

Worth noting where this was found: `browser/csp-load.js` reported zero violations, because
headless Chromium has no DevTools and therefore never asks for a source map. The errors turned
up when a person opened the deployed page and pressed F12. That is the part of the process the
automated suites do not replace.

### After editing index.html

```bash
npm run csp            # print the tag and the new hash
npm run csp -- --write # rewrite the meta tag in place
```

Forgetting this is the one mistake that ships a page which renders correctly and does nothing.
`unit/csp.test.js` catches it, but only once it has run — so run it before you push.

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

All five cross-origin subresources are pinned: Chart.js, SheetJS, html2canvas, jsPDF
and Font Awesome's stylesheet. Exactly one is deliberately **not**, and
`cdn-provenance.test.js` lists it with the reason so it stays visible rather than
being forgotten: Google Fonts, whose CSS varies by requesting browser, so a fixed
digest would break the page on some of them. It cannot be pinned, only removed.

Font Awesome is also the reason `browser-env.js` now serves that stylesheet from
`node_modules` instead of letting it fall through to the empty-body catch-all. An
empty body is a digest mismatch, so the browser would drop the stylesheet and the
suites would have been measuring a page whose icons had been refused, while
reporting nothing.

To change a version or host:

```bash
npm run sri            # print the tags, hashed from what the CDN serves
npm run sri -- --write # rewrite index.html
# then update the constants in unit/cdn-provenance.test.js to match,
# and OPEN THE PAGE IN A BROWSER before committing
```
