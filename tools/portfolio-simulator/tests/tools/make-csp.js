#!/usr/bin/env node
// Builds the Content-Security-Policy meta tag for index.html and (with --write) inserts it.
//
// The policy is assembled here rather than typed by hand because one part of it -- the hash of
// the inline <script> -- changes every time anyone edits a line of the app's JavaScript. Typing
// that by hand is a guarantee that one day it will be wrong, and a wrong script hash does not
// degrade: the browser refuses the whole program and the page loads dead.
//
//   node tests/tools/make-csp.js           print the tag and the hash
//   node tests/tools/make-csp.js --write   rewrite the meta tag in index.html
//
// unit/csp.test.js recomputes the hash on every CI run and fails if the tag has drifted, so a
// forgotten --write is caught before it ships rather than by a visitor.
const fs = require('fs');
const crypto = require('crypto');
const { APP, requireFile } = require('../lib/paths');

// Every directive, with the reason it is what it is. Anything not listed falls back to
// default-src 'none', which is deliberate: a directive nobody thought about should deny.
const DIRECTIVES = [
  ["default-src", ["'none'"]],
  // The four pinned CDNs plus the page's own inline program (by hash). No 'unsafe-inline',
  // no 'unsafe-eval' -- the app uses neither eval nor new Function.
  ["script-src", ["'self'", "__INLINE_HASH__",
    "https://cdn.jsdelivr.net", "https://cdn.sheetjs.com", "https://cdnjs.cloudflare.com"]],
  // 'unsafe-inline' is a deliberate trade, not an oversight: the page carries 23 style=""
  // attributes and two inline <style> blocks, and CSS cannot execute script. Locking this down
  // means rewriting all of them into classes and re-measuring the layout -- a large change for
  // a small gain, so script-src is where the strictness goes.
  ["style-src", ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"]],
  ["font-src", ["https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"]],
  // data: for the JPEG the PDF export builds from a canvas; blob: for the file downloads.
  ["img-src", ["'self'", "data:", "blob:"]],
  // The one that makes the promise in the disclaimer enforceable rather than a claim: the page
  // makes no network requests of its own, so the browser is told it may make none. Even code
  // injected through some future hole could not send what the user typed anywhere.
  ["connect-src", ["'none'"]],
  ["form-action", ["'none'"]],   // there are no forms; a injected one could not post out
  ["base-uri", ["'none'"]],      // stops an injected <base> from re-pointing every relative URL
  ["object-src", ["'none'"]],    // no <object>/<embed>/<applet>
  ["frame-src", ["'none'"]],     // the page embeds nothing
  ["worker-src", ["'none'"]],
  ["manifest-src", ["'none'"]],
];

// NOT included, and why -- so nobody adds them later expecting them to work:
//   frame-ancestors : ignored when the policy arrives in a <meta> tag. GitHub Pages cannot send
//                     HTTP headers, so clickjacking cannot be closed from here at all. Moving to
//                     a host that sets headers is the only fix; it is in the backlog.
//   report-uri /     : reporting needs an endpoint to receive it, and this tool has no backend
//   report-to          by design. Nothing to point them at.

function inlineScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no inline <script> block found in index.html');
  const all = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (all.length !== 1) throw new Error(`expected exactly 1 inline <script>, found ${all.length} -- each one needs its own hash`);
  return m[1];
}

function hashOf(body) {
  // The hash is over the exact bytes between the tags, with no trimming: that is what the
  // browser hashes. One stray space changes it.
  return "'sha256-" + crypto.createHash('sha256').update(body, 'utf8').digest('base64') + "'";
}

function buildPolicy(hash) {
  return DIRECTIVES
    .map(([name, vals]) => name + ' ' + vals.map(v => v === '__INLINE_HASH__' ? hash : v).join(' '))
    .join('; ') + ';';
}

function buildTag(policy) {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

const appPath = requireFile(APP, 'app under test');
let html = fs.readFileSync(appPath, 'utf8');
const hash = hashOf(inlineScript(html));
const policy = buildPolicy(hash);
const tag = buildTag(policy);

if (require.main === module) {
  console.log('\ninline script hash: ' + hash + '\n');
  console.log(tag + '\n');
  if (process.argv.includes('--write')) {
    const existing = /[ \t]*<meta http-equiv="Content-Security-Policy"[^>]*>\n/;
    if (existing.test(html)) {
      html = html.replace(existing, '    ' + tag + '\n');
    } else {
      const anchor = '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
      if (!html.includes(anchor)) throw new Error('viewport meta not found -- cannot place the CSP tag');
      html = html.replace(anchor, anchor + '    ' + tag + '\n');
    }
    fs.writeFileSync(appPath, html, 'utf8');
    console.log('index.html rewritten. Now OPEN IT IN A BROWSER and confirm the tool still works');
    console.log('before committing -- a wrong hash leaves a page that looks fine and does nothing.');
  } else {
    console.log('(run again with --write to apply)');
  }
}

module.exports = { DIRECTIVES, inlineScript, hashOf, buildPolicy, buildTag };
