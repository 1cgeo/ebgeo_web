# Browser E2E (Playwright) — `tests/e2e-ui/`

Real-browser (Chromium) end-to-end layer, **complementary** to the headless Node E2E
in `tests/e2e/` (which drives the same transport in Node against the real backend).

## What it covers

- **`smoke.spec.js`** — the app boots in real Chromium (served by Vite) and mounts a
  MapLibre canvas; uncaught page errors are reported as a soft assertion.
- **`integration.spec.js`** — drives the **real** transport modules
  (`api-client` / `ws-client` / `operation-factory`), imported live from the Vite dev
  server **inside the browser**, against the **real backend**: an HTTP round-trip
  (register → login → push feature → read back via snapshot) and a WebSocket broadcast
  (a feature pushed over HTTP arrives on a real browser `WebSocket`). This exercises the
  browser's own `fetch` + `WebSocket` + CORS + IndexedDB stack — coverage the Node E2E
  can't give.

> The two specs above are the transport-level baseline; the suite has since grown to
> cover clicking through the app UI to log in / open a backend project (e.g.
> `login-flow.spec.js`: AccountControl → login modal → project picker → sync badge),
> plus many feature, collaboration, and presence specs (`browser-*.spec.js`,
> `presence*.spec.js`, `*-local.spec.js`).

## UI-first philosophy (non-negotiable)

**Anything a user can do through the UI MUST be driven through the real UI in the test** —
never through a programmatic shortcut. Concretely:

- **Create features** by activating the real toolbar tool and clicking the canvas (point =
  one click; line/polygon = vertex clicks + right-click to finish). Do **not** call
  `store.addFeature(...)` via `page.evaluate`.
- **Edit features** (rename / recolor / describe / move / delete) through the real
  attribute panel + canvas (select via the layers tree or a canvas click, then use the
  panel inputs / color picker, drag to move, `Delete` to delete). Do **not** call
  `updateFeature` / `updateFeatureProperty` / `removeFeature`.
- **Maps / layers / groups** through the sidebar tabs + context menus; **settings** through
  their modals/toggles.

Programmatic `page.evaluate` calls are allowed **only** for things with **no UI**:

1. **Setup**: registering users, seeding an atlas/map, sharing/permission routes (all
   backend-only), enabling the tracer, forcing reconnect/offline, controlling the clock.
2. **Assertion reads**: reading the store / live MapLibre source to *verify* an outcome
   (`readFeatures`, `getCurrentMapFeatures`, `getSource(...).getData()`) — there is no UI
   for "asserting".

Reusable UI drivers live in **`helpers/collab-helpers.js`** (`drawLineUI`, `drawPointUI`,
`drawPolygonUI`, `selectFeatureUI`, `renameViaPanelUI`, `recolorViaPanelUI`,
`deleteFeatureUI`, …). `browser-collab-native-render.spec.js` is the reference: it draws
through the real line tool and asserts native cross-client render. When a feature type
genuinely has no single-gesture UI create (e.g. `processed_los`/`processed_visibility` are
**analysis outputs**, `image` needs a file pick), document the exception inline.

## SyncLedger trace helpers

The collaboration specs are wired to **SyncLedger** (the additive, env-gated sync
tracing layer; see `../../docs/proposta-observabilidade-sync.md`). Instead of polling
the store, prefer the deterministic waits in `helpers/trace-helpers.js`
(`waitForRemoteEntity`, `waitForStage`, `getClientLedger`) — on timeout they dump the
ledger naming the **last stage reached**, so a failure says *where* sync died.
`helpers/ledger.js` merges each browser's `window.__ebgeoSyncTrace` ring with the
backend ring (`GET /api/v1/debug/trace`) via `collectLedger`, reduces it (`reduceLedger`,
pure) and checks invariants (`findViolations`). `helpers/collab-helpers.js` is now
trace-gated with a graceful fallback to the original store poll, so the existing specs
keep working. Demo spec: `browser-collab-ledger.spec.js`. Tracing turns on via
`?trace=sync` / `localStorage` (browser) and `EBGEO_TRACE=1` / `NODE_ENV=test` (backend).

## How it runs

`playwright.config.js`:
- **`webServer`** runs `npm run dev -- --port 4321 --strictPort` (Vite serving the app).
- **`globalSetup`** (`e2e-ui/global-setup.js`) spawns the real `ebgeo_backend` on port
  `3912` against a throwaway `ebgeo_ui_e2e` Postgres DB (created + migrated), with
  `CORS_ORIGIN` set to the Vite origin so the browser can call it cross-origin.
- **`globalTeardown`** kills the backend and drops the DB.
- If Postgres / the backend can't come up, the specs **skip** cleanly (they never fail
  the run for a missing DB).

## Prerequisites (one-time)

Playwright is a `devDependency` but the browser binary must be fetched. Because
`package-lock.json` is protected here, **you** run:

```bash
npm install                       # installs @playwright/test
npx playwright install chromium   # downloads the Chromium build
```

Also needs a reachable PostgreSQL with PostGIS (same as the backend test suite:
superuser `postgres:postgres` for `CREATE EXTENSION`, app role `ebgeo:ebgeo_secret`).

## Run

```bash
npm run test:e2e:ui
```

This neither commits nor touches `package-lock.json`.
