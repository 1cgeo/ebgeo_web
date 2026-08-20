// Path: src/modules/catalog/resource-payload.prune.js
// THE ONE PRUNE, KEYED ON CONTENT — never on `entityType`, never on a route, never on a column.
//
// WHY THIS FILE REPLACES A LIST OF CASES. Three adversarial reviews in a row found a NEW leak
// path, each one after a phase that believed it was complete: F11 closed the snapshot and the
// review found the map routes and the incremental pull; F12 closed both and the review found
// three more. That is not bad luck, it is the signature of a guard keyed on the WRAPPER instead
// of the CARGO. `pruneCatalogLayerOperation` decided by `op.entityType`, so the same catalog-layer
// definition travelled untouched the moment it was stamped `map` (renaming a map re-sends the
// whole document, `catalogLayers` included), or was relayed by a fourth exit nobody had counted,
// or rode inside `maps.analysis_layers`, a free-form JSONB sibling published raw by four routes.
//
// The remedy this house already applied to global role, to the audit trail and to resource
// surfaces is STRUCTURE: one point everything passes through, plus a census that fails on a new
// exit until it is classified. This module is that point's brain; the two boundaries that call it
// are `middleware/prune-resource-payload.js` (every `res.json`) and `collab/collab.send.js`
// (every `ws.send`).
//
// THE DECISION IS THE CLIENT'S STAMP, PLUS THE SHAPE. This line said "THE DECISION IS THE SHAPE OF
// THE NODE", and that was false in the direction that matters: the discriminator is `node.type`, a
// key the CLIENT writes (`claimsCatalogResource`, i.e. `data_layer` / `analysis_layer`). An object
// with the same shape and NO `type` (`{ name, config: { source: { url } } }`) crosses this
// boundary untouched, and that is deliberate. What IS stripped, wherever it sits (an op payload, a
// map document under `catalogLayers`, `analysis_layers`, `previousData`/`changes`, any nesting):
// the DEFINITION (`name`/`config`) of a node that claims a catalog type.
//
// THE CEILING OF THAT, MEASURED, so nobody re-derives it by widening the predicate. Bare shape
// cannot be the outbound rule, because two legitimate payloads have exactly that shape. HILLSHADE
// IS NOT A CATALOG RESOURCE, and this is the regression that would be quiet in the tests and loud
// on the screen: it has no row in any catalog table, its definition is static, and it is written
// `{name, config.source.url}` (`tests/integration/poda-por-conteudo.test.js`, `entradaDoRelevo`).
// `claimsCatalogResource` answers false for it, so it is never touched. The catalog REST listing
// has the same shape from the other side: its columns ARE `id, name, description, config`
// (`catalog.service.js` COLS), so `GET /api/v1/data-layers` returns `{name, config}` with no
// `type` at all. Widening the predicate to "anything with a `config`" takes the shaded relief off
// everyone's map AND empties the catalog panel.
//
// WHERE THE BARE SHAPE IS ANSWERED INSTEAD: at the WRITE border
// (`catalog/resource-definition.scrub.js` + `sync/free-field.schemas.js`, F14). What may not be
// let OUT by shape can be refused ENTRY by shape, because no client writer nests a catalog-row
// shaped object inside a domain field. That asymmetry is the whole reason the two files exist.
//
// THE ONE EXEMPTION, AND WHY IT CANNOT BE FORGED. The snapshot legitimately serves a definition:
// `rehydrateCatalogLayer` resolves it from the catalog through the same (principal, atlas)
// predicate `/resource-access/visible` uses, so what it puts back is what THIS caller may see.
// That authorization is recorded by OBJECT IDENTITY, in a WeakSet, and never on the wire — a
// wire-visible marker would be a key any client could write into its own payload to smuggle a
// definition past the boundary.
//
// THE EXEMPTION COVERS A FIELD, NEVER A NODE, and this is what the F13 review found (V-A). While
// the served ENTRY carried the mark, the walk returned it whole, including the half the CLIENT
// wrote: a definition planted under `styleOverrides` of a PUBLIC entry (which the visitor is
// entitled to see, hence rehydrated, hence marked) rode out with it, measured. The invariant is
// now narrow enough to state in one line: ONLY AN OBJECT THIS SERVER BUILT FOR THIS RESPONSE IS
// EVER MARKED. `rehydrateCatalogLayer` marks the `config` it assembles and nothing else, so the
// entry around it is walked like any other payload and the client's keys inside it are pruned
// normally. Identity has a hard consequence, stated here because it is the
// one way to break this design silently: the exemption does NOT survive
// `JSON.parse(JSON.stringify(x))`. A producer that serialises an authorized payload ITSELF and
// hands the boundary a string gets it pruned. That is why `handleSyncRequest` hands `ws.send` the
// OBJECT. The failure direction is safe (a layer arrives without its definition and the client
// renders "camada indisponível"), never a leak.

import { claimsCatalogResource, pruneCatalogLayerDefinition, CATALOG_LAYER_ID_PREFIX }
  from './catalog-layer.ref.js';

/**
 * Traversal ceiling. Payloads reaching the boundary include whatever a client pushed, so the walk
 * has to be bounded: recursion with no ceiling is a denial of service, and a cycle would not
 * terminate at all (the ceiling bounds a cycle too — a true cycle also makes `JSON.stringify`
 * throw one frame later, so nothing downstream depends on it).
 *
 * 64 is far above anything real. Measured on the biggest payload this server produces (a full
 * atlas snapshot), the deepest node sits at 10, on a polygon ring coordinate; a synthetic 9 MB
 * snapshot of 20 maps and 10k features also measures 10. Over the ceiling the subtree is replaced
 * by `null` rather than passed through: passing it through would make "nest it deeper than the
 * walker goes" a bypass, which is exactly the class of hole this file closes.
 */
export const MAX_PRUNE_DEPTH = 64;

/**
 * Definitions the SERVER resolved for this response, by identity. See the header: never a wire
 * field, because a wire field is client-writable.
 */
const authorized = new WeakSet();

/**
 * Records that THIS SERVER BUILT this object for the current principal, so the boundary must leave
 * it and its subtree alone.
 *
 * Never call it on an object that carries a client-written key: that is exactly what reopened the
 * boundary in F13 (V-A). Assemble the authorized value first, mark THAT, and let the surrounding
 * payload be walked.
 *
 * @template T
 * @param {T} node
 * @returns {T} The same object, for chaining.
 */
export function markResourceDefinitionAuthorized(node) {
  if (node && typeof node === 'object') authorized.add(node);
  return node;
}

/**
 * @param {*} node
 * @returns {boolean} Whether this exact object was marked authorized.
 */
export function isResourceDefinitionAuthorized(node) {
  return !!node && typeof node === 'object' && authorized.has(node);
}

/**
 * The substrings that make a serialized payload WORTH parsing, derived from the vocabulary rather
 * than written out, so a new catalog type cannot be forgotten here.
 *
 * The shortcut is sound because every string the boundary sees came from `JSON.stringify`, which
 * never escapes ASCII letters as `\uXXXX`: a client cannot hide the discriminator from the scan
 * by writing it escaped, because the value would then be a different string and
 * `claimsCatalogResource` would answer false for it too.
 */
const DISCRIMINADORES = Object.keys(CATALOG_LAYER_ID_PREFIX).map((t) => `"${t}"`);

/**
 * Does this object still hold a definition? Asked before pruning so an ALREADY pruned entry is
 * returned by identity instead of copied.
 *
 * The reason used to be written as "the boundary runs after the op-level prune on the hot relay
 * path". MEASURED, IT DOES NOT: `pruneCatalogLayerOperation` has exactly one caller in `src/`
 * (`toFrontendOperation`, in `sync.service.js`), which serves the INCREMENTAL PULL. On the hot
 * relay (`handleOperation` then `broadcastToRoom`, `collab.handlers.js`) this boundary is the
 * FIRST prune, not the second. The identity check still earns its line, for an honest reason: most
 * nodes of most payloads hold no definition at all, and copying every one of them would turn a
 * read of the tree into a rebuild of it.
 *
 * @param {Object} node
 * @returns {boolean}
 */
function holdsDefinition(node) {
  return Object.hasOwn(node, 'name') || Object.hasOwn(node, 'config');
}

/**
 * Walks the own enumerable keys, returning the same object when no child changed.
 * @param {Object} node
 * @param {number} depth
 * @returns {Object}
 */
function walkChildren(node, depth) {
  let changed = false;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const walked = walk(value, depth + 1);
    if (walked !== value) changed = true;
    out[key] = walked;
  }
  return changed ? out : node;
}

/**
 * @param {*} node
 * @param {number} depth
 * @returns {*}
 */
function walk(node, depth) {
  if (node === null || typeof node !== 'object') return node;
  if (depth >= MAX_PRUNE_DEPTH) return null;

  if (Array.isArray(node)) {
    let changed = false;
    const out = new Array(node.length);
    for (let i = 0; i < node.length; i += 1) {
      out[i] = walk(node[i], depth + 1);
      if (out[i] !== node[i]) changed = true;
    }
    return changed ? out : node;
  }

  // An object the SERVER built for this response: left whole, children included. In practice it is
  // the assembled `config`, which IS the authorized catalog row, so descending into it could only
  // take away what the principal is entitled to. It is never an entry mixing server and client
  // keys; see the header, THE EXEMPTION COVERS A FIELD.
  if (authorized.has(node)) return node;

  // The definition survives only when the `config` in this node is the one the server just
  // resolved. Asking about `node.config` instead of about `node` is the F14 correction: the entry
  // is then WALKED, so whatever the client stored beside the definition is pruned like any other
  // payload. `WeakSet.has` answers false for a primitive and for `undefined`, so a `name` with no
  // `config`, and a client-written `config`, both fall through to the prune.
  if (claimsCatalogResource(node.type) && holdsDefinition(node) && !authorized.has(node.config)) {
    // `pruneCatalogLayerDefinition` rescues the reference into `originalId` when the entry's own
    // id does not carry the prefix — without that rescue a pre-prefix entry would lose the
    // definition AND its only address, leaving a layer nobody can resolve.
    return walkChildren(pruneCatalogLayerDefinition(node), depth);
  }

  return walkChildren(node, depth);
}

/**
 * A payload with every catalog-resource DEFINITION removed, wherever it sits.
 *
 * Returns the argument by identity when nothing was taken, so an untouched response is not copied.
 *
 * @param {*} payload - Any JSON-shaped value about to be serialized to a client.
 * @returns {*}
 */
export function pruneResourcePayload(payload) {
  return walk(payload, 0);
}

/**
 * The same, for a payload that is ALREADY serialized.
 *
 * Cheap by construction: a string with no discriminator in it has nothing to prune, and that scan
 * is one pass over the bytes with no parse. Only a string that mentions a catalog type pays for
 * `JSON.parse` + walk + `JSON.stringify`.
 *
 * A string that does not parse is returned untouched: the boundary is not a validator, and
 * failing a send because a frame was not JSON would break transports that have nothing to do with
 * this.
 *
 * @param {*} text
 * @returns {*} The same string when nothing is taken.
 */
export function pruneResourceJsonText(text) {
  if (typeof text !== 'string') return text;
  if (!DISCRIMINADORES.some((d) => text.includes(d))) return text;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  const pruned = pruneResourcePayload(parsed);
  return pruned === parsed ? text : JSON.stringify(pruned);
}
