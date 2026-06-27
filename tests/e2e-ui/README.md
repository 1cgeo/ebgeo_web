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

## Full-chain specs (the robust collab pattern)

A collab spec should not just assert "the feature eventually showed up on B". It should
prove, for **each operation**, that it traversed the **entire** multi-user pipeline — and,
when it doesn't, say **exactly which link broke**. That is what the **full-chain DSL** does.

The six links (mapped to SyncLedger stages + two ground-truths the trace can't fake):

| # | Link | Deterministic signal | Ground-truth |
|---|------|----------------------|--------------|
| 1 | author IndexedDB     | `apply.persist` (author) | `repo.getMap()` on A (reads IDB, not memoryStore) |
| 2 | transport → backend  | `push.ack` (author)      | — |
| 3 | backend stored       | `server.inserted/applied`| `SELECT … FROM operations WHERE op_id=$1` + entity row |
| 4 | signal → peers       | `server.broadcast` + `ws.inbound` | — |
| 5 | peer IndexedDB       | `apply.persist` (peer)   | `repo.getMap()` on each peer |
| 6 | appeared in browser  | `remote.applied` + `render.source` | MapLibre source |

`apply.persist` is emitted by the app (gated, zero-cost when tracing is off) right after the
IndexedDB write on **both** sides: author in `operation-dispatcher.js`, peer in
`remote-operation-handler.js`. `render.source` needs the entity-render probe
(`window.__EBGEO_TRACE_RENDER__`), which the fixture turns on.

### Writing one — use the `collab` fixture

```js
import { collabTest, expect, drawLineUI } from './helpers/collab.fixtures.js';

collabTest('a line CREATE traverses all six links to the peer', async ({ collab }) => {
    const id = await drawLineUI(collab.author, COORDS);          // real UI gesture
    await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });
});
```

`browser-collab-full-chain.spec.js` is the **canonical template** (create / update / delete +
three-client fan-out). Copy it to start a new spec.

The fixture (`helpers/collab.fixtures.js`) seeds two users + a shared atlas, opens the author
+ peers (each its own context, tracer + render probe on), resolves the owner token, opens the
read-only SQL connection, and attaches the unified ledger on teardown. It exposes on `collab`:

- `author`, `peers[]`, `pages`, `atlasId`, `mapId`, `mapName`, `db`, `userA`, `userB`.
- `expectFullSync(opRef)` — the upsert chain (entity must EXIST at both ends).
- `expectFullSyncDelete(opRef)` — the delete chain (entity GONE at both ends, Postgres row tombstoned).
- `expectNotSynced(opRef, {settle, expectDrop})` / `expectBlockedAt(opRef, {reason})` — **negative**
  path (permission / lock / isolation): the op must NOT reach the peers.
- `assertLedgerClean()` (I2: no acked-but-no-effect) and `assertChainClean()` (I-AP1/I-AP2:
  no claimed IndexedDB write left unconfirmed).

`opRef` = `{ entityId, entityType='feature', type (storage bucket, e.g. 'lines'), operationType='create', opId?, timeout? }`.

Scale to **N peers** per describe (three-client fan-out — every peer is verified):

```js
collabTest.use({ collabOptions: { peers: 2, permission: 'write' } });
```

### Ground-truth helpers

- `helpers/idb.js` — `readIdbEntity(page, {entityId, entityType, mapId, storage})` reads the
  **IndexedDB** via the repository (bypasses the in-memory `memoryStore` that `readFeatures`
  reads). This is links 1 and 5's real check.
- `helpers/db.js` — `createDb(dbName)` → `queryOperation(opId)`, `queryFeatureRow(entityId)`,
  `queryEntityRow(table, id)`, `queryServerVersion(atlasId)`. Direct SQL against the throwaway
  DB (link 3). Independent of the trace, so a missing row breaks link 3 even if the spans exist.

### Migrating an existing collab spec

1. Replace the `seedSharedAtlas` + two `openClient` + `loginUI`/`openAtlasUI` boilerplate with
   `collabTest(... async ({ collab }) => …)`.
2. Keep the **UI gesture** (`drawLineUI`/panel edit) to produce the change on `collab.author`.
3. Replace ad-hoc `pollPeerFeature` / store-poll assertions with one `collab.expectFullSync(...)`
   (or `expectFullSyncDelete` / `expectNotSynced`).
4. Negative specs (`permissions`, `lock`, `multimap-isolation`) use `expectNotSynced` /
   `expectBlockedAt` instead.

> Note: update/delete in the template use the store-op escape hatch for brevity. Where a real
> panel-driven UI driver exists, prefer it (per the UI-first philosophy above). The README's
> `renameViaPanelUI`/`deleteFeatureUI` references are aspirational — add those drivers to
> `collab-helpers.js` as specs need them.

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

`global-setup` reads `DB_USER` / `DB_PASSWORD` (default `ebgeo` / `ebgeo_secret`) to provision the
throwaway `ebgeo_ui_e2e` DB. On a machine whose Postgres only has the `postgres:postgres`
superuser (no `ebgeo` role), **override** them — otherwise the backend won't come up and the
specs `skip` instead of running.

## Run

```bash
npm run test:e2e:ui                                   # full browser-E2E suite

# Machine without the `ebgeo` role → point it at your local Postgres:
DB_USER=postgres DB_PASSWORD=postgres npm run test:e2e:ui

# A single spec (substring match on the filename):
DB_USER=postgres DB_PASSWORD=postgres npx playwright test browser-authz-ui
```

This neither commits nor touches `package-lock.json`.
