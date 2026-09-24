# Quarantined suites

These are **not run** by `npm test`. They are kept because the checks inside them
are worth reviving, not because they currently pass.

## Why they fail

Both were written when the tool shipped a default fund set with real Expected
values (Yield / Growth / S.D. filled in). Since 2026-09-22 the defaults ship with
those fields **blank**, which is deliberate -- the user fills them in. With every
fund at 0% return and 0% risk the entire optimizer input space is degenerate:
every sampled portfolio sits at exactly the same point, so "the floor constraint
actually binds" and "the capped pick differs from the unconstrained pick" cannot
be true by construction. The failures are a stale fixture, not a broken app.

`v3-constraints.test.js` additionally diffs against `baseline_v2_optimizer.html`,
a build from before the fund-set change, so its engine-output comparisons can
never match either.

## What reviving them takes

Rewrite both to set their own fund data instead of relying on the shipped
defaults -- `lib/harness.js` already exports `REAL_FUNDS` for exactly this, and
the six live suites use it. Then point the engine-diff checks at
`lib/paths.js`'s `BASELINE` instead of the hardcoded v2 file.

Until then, the optimizer is covered by `unit/optimizer-sanity.test.js`
(frontier maths, preset selection, no mutation of `fundsData`).
