// Path: src/modules/sync/catalog-layer-op.js
// The operation LOG is the second surface that carries a catalog-layer definition, and it is the
// one no migration reaches: `INSERT_OPERATION` stores the client's payload verbatim, so every
// catalog layer added before F11 sits in `operations.data` with `config.source.url` inside it.
// The log is append-only by design and its retention is manual (`POST /sync/admin/cleanup`, no
// scheduler), so "it will age out" is not true of it.
//
// This module is the read-side prune: the definition is taken off on the way OUT, which works for
// historical rows without rewriting a single stored byte, and is exactly what the current client
// expects to receive anyway (reference + per-atlas state, definition resolved from `/api/config`).
//
// THREE EXITS, NOT ONE, and missing any of them leaves the hole open on a path that is reached
// more often than the one everybody looks at:
//   1. `pullOperations` incremental — `GET /atlas/:id/sync/:version` with version > 0. Gated at
//      `read`, so an anonymous public-link visitor reaches it, and the route has no LIMIT: asking
//      for version 1 returns the whole log.
//   2. the HTTP relay — `sync.controller.js` re-broadcasts `req.body.operations` to the room.
//   3. the WS relay — `collab.handlers.js` re-broadcasts `data.ops` to the room.
// (2) and (3) both funnel through `broadcastOperations`, which is where they are covered, so a
// fourth relay caller is covered by construction.
//
// WHY THE LAYER ID IS NOT `entityId`. `operations.entity_id` is UUID NOT NULL and a catalog-layer
// id is not a UUID ('data-<slug>', 'hillshade'), so the insert substitutes the ATLAS id
// (`sync.service.js`, FEATURE_UUID_RE). A pruner keyed on `entityId` therefore matches nothing on
// a stored row and is cover that covers nothing — green while verifying nothing. The id is read
// from the payload first, and `entityId` is only the fallback that serves the RELAY shape, where
// the client's own id is still on the envelope.

import { claimsCatalogResource, pruneCatalogLayerDefinition } from '../catalog/catalog-layer.ref.js';

/** Frontend and legacy vocabularies for the same entity (`sync.schemas.js` accepts both). */
const CATALOG_LAYER_TYPES = new Set(['catalogLayer', 'catalog_layer']);

/**
 * One stored entry with its definition removed, when it claims a catalog resource.
 *
 * @param {*} entry
 * @param {*} id - Best-known id for the entry.
 * @returns {*} The same object when nothing is taken, so the caller can detect a no-op.
 */
function pruneEntry(entry, id) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  if (!claimsCatalogResource(entry.type)) return entry;
  return pruneCatalogLayerDefinition(entry, id);
}

/**
 * One `data`/`changes` payload, pruned. Handles the two shapes the entity travels in: the
 * per-layer entry, and the legacy whole-array (`{ catalog_layers: [...] }`), pruned item by item.
 *
 * @param {*} payload
 * @param {*} envelopeId - The op's entityId/targetId, used only when the payload carries no id.
 * @returns {*} The same object when nothing is taken.
 */
function prunePayload(payload, envelopeId) {
  if (!payload || typeof payload !== 'object') return payload;

  if (Array.isArray(payload.catalog_layers)) {
    const items = payload.catalog_layers.map((item) => pruneEntry(item, item?.id));
    const changed = items.some((item, i) => item !== payload.catalog_layers[i]);
    return changed ? { ...payload, catalog_layers: items } : payload;
  }

  return pruneEntry(payload, payload.id ?? envelopeId);
}

/**
 * A sync operation with any catalog-layer DEFINITION stripped from its payload.
 *
 * Non-catalogLayer ops and payloads with nothing to take are returned by identity, so this costs
 * one type test on the hot relay path.
 *
 * WHAT AN OLD CLIENT SEES. A client from before F11 stamps the definition into the op it writes
 * and reads `layer.config.source.url` back out of what it receives. After this prune it receives
 * the reference and the per-atlas state without the definition, and its own copy in IndexedDB is
 * untouched (nothing rewrites the client's document), so the layer it already had keeps drawing.
 * What it loses is the ability to draw a layer added by SOMEONE ELSE while it stayed open: that
 * one arrives without a URL and simply does not render, until the tab is reloaded onto the
 * current client, which resolves the definition from `/api/config`. That is the intended trade —
 * the alternative is serving the URL of a private resource to whoever holds `read`.
 *
 * @param {Object} op - Frontend-shaped operation (either vocabulary).
 * @returns {Object} The op, or a copy with `data`/`changes` pruned.
 */
export function pruneCatalogLayerOperation(op) {
  if (!op || typeof op !== 'object') return op;
  if (!CATALOG_LAYER_TYPES.has(op.entityType ?? op.target)) return op;

  const envelopeId = op.entityId ?? op.targetId;
  const data = prunePayload(op.data, envelopeId);
  const changes = prunePayload(op.changes, envelopeId);
  if (data === op.data && changes === op.changes) return op;

  const pruned = { ...op };
  if (data !== op.data) pruned.data = data;
  if (changes !== op.changes) pruned.changes = changes;
  return pruned;
}

/**
 * The same, for a batch. Returns the SAME array when no op changed.
 * @param {Object[]} ops
 * @returns {Object[]}
 */
export function pruneCatalogLayerOperations(ops) {
  if (!Array.isArray(ops)) return ops;
  const pruned = ops.map(pruneCatalogLayerOperation);
  return pruned.some((op, i) => op !== ops[i]) ? pruned : ops;
}
