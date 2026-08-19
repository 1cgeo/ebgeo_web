// Path: src/modules/sync/catalog-layer-op.js
// The operation LOG is a surface that carries a catalog-layer definition, and it is the one no
// migration reaches: `INSERT_OPERATION` stores the client's payload verbatim, so every catalog
// layer added before F11 sits in `operations.data` with `config.source.url` inside it. The log is
// append-only by design and its retention is manual (`POST /sync/admin/cleanup`, no scheduler), so
// "it will age out" is not true of it.
//
// This module is the read-side prune for that surface: the definition is taken off on the way OUT,
// which works for historical rows without rewriting a single stored byte, and is what the current
// client expects to receive anyway (reference + per-atlas state, definition resolved from
// `/api/config`).
//
// THE HEADER THAT USED TO SIT HERE WAS FALSE, AND THE FALSEHOOD COST A PHASE. It announced "THREE
// EXITS, NOT ONE", listed the incremental pull and the two relays, and concluded that "(2) and (3)
// both funnel through `broadcastOperations` ... so a fourth relay caller is covered by
// construction". Both halves were wrong. A fourth relay was already live —
// `collab.handlers.js:handleOperation` broadcasts a SINGULAR `operation` frame and never calls
// `broadcastOperations` — and the exits were never three: the incremental pull, the two relays,
// the map routes (`GET /maps`, `GET /maps/:mapId`, `POST /duplicate`), the snapshot over both
// transports and the WS `sync_response` all carry entity payload. A comment that asserts a
// guarantee nobody measured is worse than no comment: the next reader stops looking.
//
// WHAT IS TRUE NOW. Counting exits is not the guarantee and never was, because the guard was keyed
// on the WRAPPER (`op.entityType`) instead of the CARGO: the same definition travelled untouched
// stamped `map`, or inside `maps.analysis_layers`. The guarantee is STRUCTURAL and lives in two
// boundaries every byte passes — `middleware/prune-resource-payload.js` for every `res.json` and
// `collab/collab.send.js` for every `ws.send` — both driven by the content walk in
// `catalog/resource-payload.prune.js`, plus a census
// (`tests/unit/saidas-de-conteudo-censo.test.js`) that fails on an exit nobody classified.
//
// SO WHY DOES THIS FILE STILL EXIST? Not as a case in a list: it is the SAME content prune applied
// one step earlier, at the point where a stored log row becomes a frontend-shaped op. Running it
// here keeps the definition out of the objects the rest of the pull path handles, and it is
// free — the walk returns its argument by identity when there is nothing to take.
//
// WHY THE LAYER ID IS NOT `entityId`. `operations.entity_id` is UUID NOT NULL and a catalog-layer
// id is not a UUID ('data-<slug>', 'hillshade'), so the insert substitutes the ATLAS id
// (`sync.service.js`, FEATURE_UUID_RE). A pruner keyed on `entityId` therefore matches nothing on
// a stored row and is cover that covers nothing — green while verifying nothing. The content walk
// never asks the envelope anything: it reads the id from the payload, and when the payload has
// none it rescues the reference into `originalId` (`pruneCatalogLayerDefinition`), so the stripped
// entry keeps the only address it had.

import { pruneResourcePayload } from '../catalog/resource-payload.prune.js';

/**
 * A sync operation with any catalog-layer DEFINITION stripped from its payload, wherever it sits:
 * the per-layer entry, the legacy whole-array (`{ catalog_layers: [...] }`), a map document under
 * `catalogLayers`, `data`, `changes`, `previousData`, at any nesting.
 *
 * Ops with nothing to take are returned BY IDENTITY, so this costs one walk with no allocation on
 * the hot relay path.
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
 * @returns {Object} The op, or a copy with the definitions removed.
 */
export function pruneCatalogLayerOperation(op) {
  return pruneResourcePayload(op);
}

/**
 * The same, for a batch. Returns the SAME array when no op changed.
 * @param {Object[]} ops
 * @returns {Object[]}
 */
export function pruneCatalogLayerOperations(ops) {
  return pruneResourcePayload(ops);
}
