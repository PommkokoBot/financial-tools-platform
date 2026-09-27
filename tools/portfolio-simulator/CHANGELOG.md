# Changelog — Institutional Portfolio Simulator

The tool is a single static HTML file with no build step. `index.html` is the product;
everything under `tests/` exists to prove a change did not move the numbers.

Dates are the date the work was pushed. Versions come from `APP_VERSION` in `index.html`,
which is also written into every saved case file and onto the PDF cover — so a bug report
from a stranger names the build that produced it.

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
