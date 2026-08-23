---
name: store-op
description: Use when adding a new store operation, ensuring the persistence-first transaction pattern, error conventions, and proper facade/barrel exports
---

# New Store Operation

Creates store operations following persistence-first transaction pattern.

## Architecture

```
store/
  ├── <domain>.operations.js   # New operation file
  ├── store.js                 # Facade — re-export here
  ├── index.js                 # Barrel — re-export here
  └── store-transaction.js     # runTransaction helper
```

## Permission Gate

**Ask the guard BEFORE the transaction, or you queue work that dies on the other side.**
An operation that enqueues a sync op writes into a *remote* atlas. If the session's role
does not allow that write, the server refuses the push and the OUTBOUND QUEUE STOPS: every
later op of every entity is stuck behind the one op the UI should never have offered. No
error reaches the user; sync just quietly stops. This has shipped more than once.

**How to decide whether your op needs a gate.** The criterion is not how important the
operation looks, nor whether the entity feels "shared". It is one question: **does this
operation enqueue a sync op?** If anywhere in it (including inside `tx.deferAsync`) you
call one of the entity loggers of `store/sync/operation-dispatcher.js` (`logFeatureOperation`,
`logMapOperation`, `logLayerOperation`, `logAtlasSetting`, and their siblings), it needs a
gate. An operation that only writes IndexedDB and emits an event does not.

**The pattern**, verbatim from the sibling ops (`store/map.operations.js` is the model):

```javascript
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';

export async function createWidget(data) {
    const perm = checkPermission(GuardAction.CREATE_FEATURE);   // pick the matching action
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'createWidget', reason: perm.reason
        });
        return null;   // match your own signature: null / false / { success: false }
    }

    await runTransaction(async (tx) => { /* ... */ });
}
```

Three properties that decide how you use it:

- **Refusal is an EXPECTED failure, never a throw.** Emit `STORE_OPERATION_BLOCKED` and
  return the falsy value your signature already documents. Callers routinely wrap these in
  a `try/catch` that only logs, so a throw is swallowed and the user is told nothing at all.
- **`checkPermission` is already permissive where it must be.** It returns
  `{ allowed: true }` whenever the session is offline OR the store is not a connected
  remote atlas, so an anonymous visitor, and a logged-in user on their own local atlas,
  keep full control. Do NOT write a local-work special case: that early return is it, and
  it is also what keeps `.ebgeo` import working.
- **Gate through `GuardAction`, never by comparing role strings.** `GuardAction` maps your
  operation to a `PermissionAction` and `checkPermission` resolves it against the
  hierarchy. A hand-rolled `perm === 'write' || perm === 'owner'` silently excludes
  `manage`, and that exact bug has shipped twice in this repository, in both packages.

Pick the `GuardAction` key by what the operation IS to the server, not by the entity name:
map settings (notes, timeline config, base layer) go through `UPDATE_MAP`, because the
server gates them at the same level as a rename.

## Transaction Pattern

All mutating operations MUST use `runTransaction`. Side effects only run after IndexedDB succeeds:

```javascript
import { runTransaction } from './store-transaction.js';
import { getEventBus } from './services.js';
import { EventTypes } from '@events/event_types.js';

export async function createWidget(data, layerId) {
    // 1. Validate arguments (throw on bugs)
    if (!data) throw new Error('createWidget: data is required');

    await runTransaction(async (tx) => {
        // 2. Defer sync side effects (UI, color tracking)
        tx.deferSync(() => {
            getEventBus().emit(EventTypes.FEATURE_CREATED, { feature });
        });

        // 3. Defer async side effects (logging, sync queue)
        tx.deferAsync(() => {
            logOperation('CREATE', feature);
        });

        // 4. Return persistence function (runs FIRST)
        return async () => {
            await repo.set(key, data);
        };
    });
}
```

**Execution order:** Persistence → deferSync → deferAsync. If persistence fails, no side effects run.

## Error Conventions

| Scenario | Pattern | Example |
|----------|---------|---------|
| Invalid argument (bug) | `throw new Error(msg)` | Missing required field |
| Expected failure (locked) | `return` + emit `STORE_OPERATION_BLOCKED` | Locked map edit |
| Data loss risk (IndexedDB) | `throw` + emit `STORE_PERSIST_ERROR` | DB write failure |
| Non-critical background | `console.warn()` only | Side effect warning |

Store-error events (`STORE_OPERATION_BLOCKED`, `STORE_PERSIST_ERROR`, `STORE_SYNC_ERROR`) are NOT in `event_types.js`. They live in `StoreErrorEvents` (`store/store-errors.js`) and are emitted with the `emitStoreError` helper:

```javascript
// Expected failure example
import { emitStoreError, StoreErrorEvents } from './store-errors.js';

if (isMapLocked(mapName)) {
    emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
        operation: 'createWidget', reason: 'map_locked'
    });
    return;
}
```

## Dependency Injection

Operations use lazy-injected dependencies:

```javascript
const deps = { eventBus: null, layerManager: null };

export function setWidgetDependencies(dependencies) {
    Object.assign(deps, dependencies);
}
```

Initialize in `store.js` facade via `setWidgetDependencies()`.

## Metadata

Feature mutations auto-track sync metadata via the **private** helpers
`addCreatedTimestamp()` / `touchUpdatedTimestamp()` inside `feature.operations.js`.
They are NOT exported — do not import them from another module:

```javascript
// Inside feature.operations.js only:
addCreatedTimestamp(feature);    // sets createdAt, updatedAt, version: 1
touchUpdatedTimestamp(feature);  // bumps updatedAt, version++
```

For a new entity type, set the same fields (`createdAt`, `updatedAt`, `version`)
in your own operation file rather than importing these helpers.

## Export Checklist

1. **Operation file**: `export async function createWidget(...)` in `<domain>.operations.js`
2. **Facade** (`store.js`): `export { createWidget } from './<domain>.operations.js';`
3. **Barrel** (`index.js`): Already re-exports everything from `store.js`
4. **Event type**: Add `WIDGET_CREATED` to `events/event_types.js` if new

## Quick Validation

- [ ] If it enqueues a sync op, it calls `checkPermission(GuardAction.X)` FIRST and
      returns on refusal
- [ ] Uses `runTransaction` for all mutations
- [ ] `throw` for invalid args, `return + emit` for expected failures
- [ ] Sync metadata set (`createdAt` / `updatedAt` / `version`)
- [ ] Exported from `store.js` facade
- [ ] New EventTypes defined in `event_types.js`
- [ ] Dependencies injected, not imported directly from singletons
