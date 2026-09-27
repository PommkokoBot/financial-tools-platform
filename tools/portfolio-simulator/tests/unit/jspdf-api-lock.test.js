// Locks the list of jsPDF methods this tool is allowed to call.
//
// WHY THIS EXISTS -- read before changing anything here.
//
// index.html loads jsPDF 2.5.1 from cdnjs. `npm audit` reports 12 advisories against that
// release, two of them rated critical, plus 16 more against the DOMPurify copy it bundles. The
// tool is not exposed to any of them, and the reason is worth stating precisely, because it is
// not a property of jsPDF:
//
//   Every one of those advisories lives in a jsPDF feature this tool does not use.
//   AcroForm fields, addJS, FreeText annotations, BMP decoding, opening the PDF in a new window,
//   and .html() -- the method that pulls DOMPurify in -- are all unreachable, because the export
//   path is: html2canvas rasterises each page -> canvas.toDataURL('image/jpeg') -> addImage.
//   Nothing the user typed is ever handed to jsPDF as text or markup.
//
// That is safety by coincidence. Nothing enforces it, nothing writes it down where a person
// adding a PDF feature would trip over it, and the project is about to be paused for months. The
// realistic future is someone (including the person who wrote this) reaching for jsPDF's own
// .html() to add a page, and silently re-opening sixteen XSS advisories on a page that accepts
// case files from other people.
//
// So the allow-list below is the record, and this test is what makes anyone read it.
//
// WHAT TO DO IF THIS GOES RED:
//   - You renamed the jsPDF variable, or added a call that is genuinely harmless: the test tells
//     you which method it found. Add it to ALLOWED with a one-line reason. That is the intended
//     workflow, not a defeat.
//   - You are adding .html(), AcroForm, addJS, or anything that puts user-supplied text into the
//     PDF: upgrade jsPDF to 4.x first. It is a breaking change and the PDF suites will need
//     re-running, which is the point -- that work belongs with the feature, not after it.
//
// WHAT THIS TEST CANNOT DO: it reads the source text. `pdf['html']()` or a method called through
// an alias would slip past it. It is a tripwire for the ordinary mistake, not a sandbox.
const fs = require('fs');
const path = require('path');

const TOOL_DIR = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(TOOL_DIR, 'index.html'), 'utf8');

// method: why it is safe to call on 2.5.1
const ALLOWED = {
  addPage: 'takes only a page format; no user input reaches it',
  addImage: 'fed a JPEG data URL produced by our own canvas, never a user-supplied file or path',
  link: 'the URL is the PDF_BRAND_LINK_URL constant; no user input reaches it',
  save: 'writes the blob to a download. The alternatives (output to a new window) carry the HTML-injection advisory',
};

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));

// Find what the jsPDF instance is called rather than assuming "pdf", so renaming the variable
// does not produce a red run with a misleading message.
const ctor = [...html.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+jsPDF\s*\(/g)]
  .map(m => m[1]);
check('the page constructs a jsPDF instance', ctor.length > 0,
  'no `new jsPDF(` found -- if the PDF export was removed, delete this suite and the dependency');
check('there is exactly one jsPDF instance to track', ctor.length === 1, ctor.join(', '));

if (ctor.length === 1) {
  const v = ctor[0];
  const called = [...new Set(
    [...html.matchAll(new RegExp(`\\b${v}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g'))].map(m => m[1])
  )].sort();

  check('the page calls at least one jsPDF method', called.length > 0);

  const unexpected = called.filter(m => !(m in ALLOWED));
  check('every jsPDF method called is on the reviewed allow-list',
    unexpected.length === 0,
    unexpected.length
      ? `NEW CALL(S): ${unexpected.join(', ')} -- jsPDF 2.5.1 carries critical advisories in ` +
        `AcroForm, addJS, FreeText, BMP decoding, new-window output and .html(). Read the header ` +
        `of this file, then either add the method to ALLOWED with a reason or upgrade to 4.x.`
      : '');

  // The reverse: a method on the list that nothing calls any more is a stale note. Harmless, but
  // it makes the list less trustworthy over time, and this list is meant to be trusted.
  const unused = Object.keys(ALLOWED).filter(m => !called.includes(m));
  check('the allow-list has no leftover entries', unused.length === 0,
    `no longer called: ${unused.join(', ')} -- remove from ALLOWED`);

  // Named explicitly so the red message says the dangerous thing out loud, rather than leaving
  // somebody to work out why "html" was not on a list.
  const DANGEROUS = ['html', 'addJS', 'setJS', 'createAnnotation', 'addField', 'output'];
  DANGEROUS.forEach(m => check(`jsPDF .${m}() is not used`, !called.includes(m),
    `.${m}() is covered by an unpatched advisory in 2.5.1 -- upgrade to 4.x before using it`));
}

// The version in the page must still be the one this analysis was done against. If somebody
// bumps the CDN URL, the advisory picture changes and this file's reasoning expires.
const REVIEWED_VERSION = '2.5.1';
const tag = html.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/([0-9.]+)\//);
check('index.html still loads the jsPDF version this review covers', tag && tag[1] === REVIEWED_VERSION,
  tag ? `page loads ${tag[1]}, this file reviewed ${REVIEWED_VERSION} -- re-check the advisories and update ALLOWED`
      : 'no jsPDF script tag found');

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
