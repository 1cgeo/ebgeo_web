# Testing Rules

Full guide: `tests/TESTING.md`. Quick rules for working in this repo:

## When to add tests
- New pure logic (math, geometry, parsing, conversion, formatting) → add a unit
  test in `tests/unit/`, including **at least one edge case** (not just happy path).
- Fixed a bug → add a regression test `tests/<area>/<bug>.repro.test.js` that
  documents the root cause (model: `tests/integration/import-phantom-map.repro.test.js`).
- Don't hand-test in the chat what a unit test can pin down.

## How to write them
- Environment is `node` (no jsdom). Test **pure functions**, not DOM/MapLibre.
  Keep calculations in `add_*_geometry.js`-style pure modules and test those.
- Edge-case checklist: `null`/`undefined`/`NaN`/`Infinity`, empty, boundaries
  (±90 lat, ±180 lng, 0/360 azimuth), sign/`-0`/modulo wrap, hemispheres,
  antimeridian, round-trips, unit conversions. Remember `x ?? 0` does NOT guard
  `NaN` — use `Number.isFinite`.
- For math/geometry/coordinates prefer **fast-check** invariants (round-trip,
  idempotence, output-range) over hand-picked examples.
- Reuse factories in `tests/helpers/test-utils.js`. To test a `*_geometry.js`
  that imports the `@tools` barrel, mock `@tools` with a trivial `BaseGeometry`
  (see `tests/unit/sector-geometry.test.js`). Stub `globalThis.turf` only with
  the methods used.

## Before claiming done
- **Logic**: `npm run lint` and `npm test`, as separate commands run BEFORE any
  commit. On one command line the lint output lands after the commit already
  succeeded, which is not verification.
- **UI**: no preview or interactive-browser tool. The approved loop is a
  Playwright capture driving the real app and backend, then READING the produced
  image. Delete the temporary spec afterwards. `npm run test:e2e:ui`.
- There is **no CI of any kind and no git hooks** — everything is run manually.
  (The GitHub Pages workflow was removed on 2026-07-18 along with the dead
  `prepare-deploy.js` it depended on; see [[deploy-web]].) Coverage is
  `npm run test:coverage` (report-only, no threshold).
- The two Claude Code hooks in `.claude/settings.json` are real guards, not
  decoration: `.claude/hooks/block-protected.js` refuses writes to protected
  paths, `.claude/hooks/lint-on-write.js` lints every `.js`/`.css` write. Both
  were DEAD for months (they read a `$TOOL_INPUT_FILE_PATH` that Claude Code
  never sets). **If you change either, probe it** — write to `deploy/` and
  confirm the refusal. A guard is only worth what its last probe proved.

## Collaboration / sync e2e
- For multi-user (collab/sync) behavior, prefer the **SyncLedger** deterministic waits
  (`tests/e2e-ui/helpers/trace-helpers.js` — `waitForRemoteEntity`/`waitForStage`) over
  store polling; on timeout they name the last sync stage reached. See
  `tests/e2e-ui/README.md` §"SyncLedger trace helpers".
