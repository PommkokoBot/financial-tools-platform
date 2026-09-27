#!/usr/bin/env node
// Prints ready-to-paste <script>/<link> tags with Subresource Integrity hashes for
// every external asset index.html loads.
//
// Why this is a script and not something already applied: a wrong hash does not
// degrade, it makes the browser refuse the file outright and the tool breaks on
// load. The hash therefore has to come from the bytes the CDN actually serves --
// not from a local npm copy that merely ought to match. Run this from a machine
// that can reach the CDNs, check the tool still loads, then commit.
//
// As of round C2 the four <script> tags already carry their digests, and
// tests/unit/cdn-provenance.test.js re-derives each one from the pinned npm package on
// every run. So this script is for CHANGING a version or host, not for initial setup --
// and after running it, update the constants in that suite to match, or CI will tell you
// the page and the recorded bytes disagree. That red is the check working, not a nuisance.
//
//   node tests/tools/make-sri.js            print tags for what index.html loads now
//   node tests/tools/make-sri.js --write    also rewrite index.html in place
const fs = require('fs');
const crypto = require('crypto');
const { APP, requireFile } = require('../lib/paths');

const appPath = requireFile(APP, 'app under test');
let html = fs.readFileSync(appPath, 'utf8');

// Only cross-origin subresources can carry integrity; inline blocks and same-origin
// files cannot and do not need it.
const TAG_RE = /<(script|link)\b[^>]*\b(?:src|href)="(https:\/\/[^"]+)"[^>]*>/g;

const targets = [];
for (const m of html.matchAll(TAG_RE)) {
  const [tag, kind, url] = m;
  if (url.includes('fonts.googleapis.com')) continue; // stylesheet contents vary by UA
  targets.push({ tag, kind, url });
}

if (!targets.length) { console.log('No external script/link tags found.'); process.exit(0); }

(async () => {
  const results = [];
  for (const t of targets) {
    process.stderr.write(`fetching ${t.url}\n`);
    const res = await fetch(t.url, { redirect: 'follow' });
    if (!res.ok) { console.error(`  FAILED ${res.status} -- aborting, no partial output`); process.exit(1); }
    const buf = Buffer.from(await res.arrayBuffer());
    const sri = 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
    results.push({ ...t, sri, bytes: buf.length });
  }

  console.log('\n--- paste these in place of the current tags ---\n');
  for (const r of results) {
    let out = r.tag;
    out = out.replace(/\s+integrity="[^"]*"/, '').replace(/\s+crossorigin="[^"]*"/, '');
    const insertAt = out.lastIndexOf('>');
    out = out.slice(0, insertAt) + ` integrity="${r.sri}" crossorigin="anonymous"` + out.slice(insertAt);
    console.log(`${out}   <!-- ${r.bytes} bytes -->`);
    if (process.argv.includes('--write')) html = html.replace(r.tag, out);
  }

  if (process.argv.includes('--write')) {
    fs.writeFileSync(appPath, html, 'utf8');
    console.log('\nindex.html rewritten. Now OPEN IT IN A BROWSER and confirm the tool still loads');
    console.log('before committing -- a bad hash fails silently in the console, not visibly on screen.');
  } else {
    console.log('\n(run again with --write to apply)');
  }
})();
