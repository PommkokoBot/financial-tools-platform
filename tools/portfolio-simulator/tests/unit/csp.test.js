// Content-Security-Policy: proves the policy in index.html is the one the file's own contents
// imply, and that nothing has been added to the page that the policy would refuse.
//
// The danger this exists for is specific and quiet. `script-src` pins the inline program by the
// SHA-256 of its exact bytes. Change one character anywhere in that <script> block -- a comment,
// a space -- and the hash no longer matches, so the browser refuses to run the entire program.
// The page still renders: header, inputs, buttons, disclaimer, all of it. Nothing happens when
// you press anything. Nothing in the diff looks wrong. Only the console says why, and the person
// who shipped it will not be looking at the console.
//
// So this suite recomputes the hash from the file on every run and compares it to the tag. It
// does not compare the tag to a stored copy of itself, which would prove nothing.
//
// If it goes red, the fix is `npm run csp -- --write`, then open the page in a browser.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { buildTag, buildPolicy, hashOf, inlineScript } = require('../tools/make-csp');

const TOOL_DIR = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(TOOL_DIR, 'index.html'), 'utf8');

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));

// Parsed, not grepped: an attribute inside a comment or a template literal is not an attribute,
// and a regex over 340 KB of markup cannot tell the difference.
const dom = new JSDOM(html);
const doc = dom.window.document;

const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
check('the CSP meta tag exists', !!meta);

if (meta) {
  const policy = meta.getAttribute('content') || '';

  // --- 1. The hash matches the script that is actually in the file ---
  const expected = hashOf(inlineScript(html));
  check('script-src pins the inline program by hash',
    policy.includes('sha256-'), policy.slice(0, 120));
  check('the pinned hash is the hash of the inline script as it stands now',
    policy.includes(expected.replace(/'/g, '')),
    `tag has ${(policy.match(/'sha256-[^']+'/) || ['(none)'])[0]}, script hashes to ${expected}`);

  // The whole tag, not just the hash -- catches a hand-edited directive too.
  check('the whole tag matches what tests/tools/make-csp.js would generate',
    meta.outerHTML === buildTag(buildPolicy(expected)),
    'run: npm run csp -- --write');

  // --- 2. The parts that would quietly gut the policy ---
  check('the policy is enforcing, not report-only',
    meta.getAttribute('http-equiv').toLowerCase() === 'content-security-policy',
    meta.getAttribute('http-equiv'));
  check("script-src does not allow 'unsafe-inline'",
    !/script-src[^;]*'unsafe-inline'/.test(policy),
    "adding it would make the hash pointless -- any injected inline script would run");
  check("script-src does not allow 'unsafe-eval'",
    !/script-src[^;]*'unsafe-eval'/.test(policy));
  check("default-src is 'none'", /default-src 'none'/.test(policy), policy.slice(0, 80));
  check("connect-src is 'none' -- the page must not be able to send data anywhere",
    /connect-src 'none'/.test(policy),
    "this is what makes the privacy sentence in the disclaimer enforceable rather than a claim");
  check("base-uri is 'none'", /base-uri 'none'/.test(policy));
  check("object-src is 'none'", /object-src 'none'/.test(policy));
  check("form-action is 'none'", /form-action 'none'/.test(policy));

  // --- 3. The policy and the page agree about which hosts are used ---
  const scriptHosts = [...new Set([...doc.querySelectorAll('script[src^="https://"]')]
    .map(s => new dom.window.URL(s.src).origin))];
  const allowed = (policy.match(/script-src ([^;]+)/) || [, ''])[1];
  scriptHosts.forEach(h => check(`script-src allows ${h}, which the page loads from`,
    allowed.includes(h), `script-src is: ${allowed}`));
  // And the reverse: a host left in the policy after its script was removed is a hole nobody
  // meant to leave open.
  allowed.split(/\s+/).filter(t => t.startsWith('https://')).forEach(h =>
    check(`script-src host ${h} is still actually used by the page`,
      scriptHosts.includes(h), `page loads scripts from: ${scriptHosts.join(', ')}`));
}

// --- 4. Nothing in the page would be refused by the policy ---
// Inline event handlers are the usual way a CSP gets broken by accident: somebody adds one
// onclick="" while fixing something else, it silently does nothing, and no other test notices.
const HANDLERS = ['onclick', 'oninput', 'onchange', 'onsubmit', 'onload', 'onerror', 'onkeyup',
  'onkeydown', 'onmouseover', 'onfocus', 'onblur'];
const withHandlers = [...doc.querySelectorAll('*')].filter(el =>
  HANDLERS.some(h => el.hasAttribute(h)));
check('no inline event handler attributes anywhere in the markup',
  withHandlers.length === 0,
  withHandlers.slice(0, 5).map(el => el.outerHTML.slice(0, 90)).join(' | '));

// The same applies to markup the app generates at runtime: those strings live inside the inline
// script, so the parsed DOM above cannot see them. This is the one place a text search is the
// right tool -- restricted to handler attributes inside template literals.
const scriptBody = inlineScript(html);
const generated = [...scriptBody.matchAll(/\s(on(?:click|input|change|submit|load|error|mouseover|focus|blur))\s*=\s*["'`]/g)];
check('no inline event handlers in the HTML the app builds at runtime',
  generated.length === 0,
  generated.map(m => m[1]).join(', '));

check('javascript: URLs are not used', !/["'`]javascript:/.test(html));
check('the app uses neither eval nor new Function',
  !/\beval\s*\(|new\s+Function\s*\(/.test(scriptBody));

// --- 5. The limits, asserted so they stay known ---
// frame-ancestors is silently IGNORED in a meta tag. Putting it there would look like protection
// and provide none, which is worse than the gap itself being documented.
check('frame-ancestors is NOT in the policy (it is ignored in a meta tag -- see tests/README.md)',
  !/frame-ancestors/.test(meta ? meta.getAttribute('content') : ''),
  'remove it: in a <meta> tag it does nothing, and its presence implies clickjacking is handled');

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
