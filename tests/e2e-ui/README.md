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

> Not yet covered: clicking through the app UI to log in / open a backend project —
> that UI doesn't exist yet. These tests prove the transport works in a browser; full
> click-through flows await the login/project UI.

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
