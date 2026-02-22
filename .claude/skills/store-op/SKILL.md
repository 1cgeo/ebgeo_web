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

```javascript
// Expected failure example
if (isMapLocked(mapName)) {
    getEventBus().emit(EventTypes.STORE_OPERATION_BLOCKED, {
        operation: 'createWidget', mapName
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

All features auto-track timestamps:

```javascript
import { addCreatedTimestamp, touchUpdatedTimestamp } from './feature.operations.js';

// On create:
addCreatedTimestamp(feature);  // sets createdAt, updatedAt, version: 1

// On update:
touchUpdatedTimestamp(feature);  // bumps updatedAt, version++
```

## Export Checklist

1. **Operation file**: `export async function createWidget(...)` in `<domain>.operations.js`
2. **Facade** (`store.js`): `export { createWidget } from './<domain>.operations.js';`
3. **Barrel** (`index.js`): Already re-exports everything from `store.js`
4. **Event type**: Add `WIDGET_CREATED` to `events/event_types.js` if new

## Quick Validation

- [ ] Uses `runTransaction` for all mutations
- [ ] `throw` for invalid args, `return + emit` for expected failures
- [ ] Timestamps via `addCreatedTimestamp` / `touchUpdatedTimestamp`
- [ ] Exported from `store.js` facade
- [ ] New EventTypes defined in `event_types.js`
- [ ] Dependencies injected, not imported directly from singletons
