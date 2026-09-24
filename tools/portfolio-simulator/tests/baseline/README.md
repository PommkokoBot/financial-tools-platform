# Baseline build

`portfolio-simulator.baseline.html` is a frozen copy of the **last released**
`index.html`. `unit/regression.test.js` loads this file and the current
`index.html` into the same jsdom harness, feeds both the same seeded random
sequence, and compares the output of all three engines field by field across
four scenarios.

## Why a whole HTML file instead of saved numbers

Saving the expected numbers in a JSON file would be smaller, but then a change to
the harness itself (a different stub, a different seed) would shift the numbers
with no app change at all, and there would be no way to tell the two apart.
Running both builds through the same harness in the same process immunises the
comparison: if the harness drifts, it drifts identically on both sides and the
diff stays clean.

## When to update it

Only when releasing a version you have verified. Run:

    npm run baseline:update

which refuses to copy unless the suites pass against the current `index.html`,
then commit the new baseline alongside the release.

## Why only one file is kept

Older baselines are not kept on disk -- git history and release tags are the
archive. To compare against an older release, check that tag out and point the
suites at it:

    SIM_BASELINE_FILE=/path/to/old/index.html npm test
