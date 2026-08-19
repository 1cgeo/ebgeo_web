// Path: src/modules/catalog/resource-definition.scrub.js
// THE WRITE-SIDE TWIN of `resource-payload.prune.js`, and the asymmetry between the two is the
// whole reason this file exists rather than one more branch over there.
//
// THE PROBLEM IT ANSWERS. The outbound prune decides by the client's own `type` STAMP
// (`claimsCatalogResource`), so an object shaped exactly like a catalog row but carrying no
// `type` — `{ name, config: { source: { url } } }` — travels out untouched. Widening the OUTBOUND
// predicate to bare shape was measured and rejected: it would strip the hillshade entry (which is
// legitimately `{name, config.source.url}` and has no catalog row, see
// `tests/integration/poda-por-conteudo.test.js` `entradaDoRelevo`) and the REST catalog listing,
// whose columns literally are `id, name, description, config` (`catalog.service.js`). Pruning too
// much is a regression as real as a leak, and quieter.
//
// SO THE ASYMMETRY IS DELIBERATE: the same bare shape that must be LET OUT (it may be the relief
// or a catalog listing the caller is entitled to) must not be LET IN, because no client writer
// produces a catalog-row-shaped object nested inside a domain field. You cannot sweep out of a
// response what should never have been stored, because a copy of data is just data shaped like
// data. This is the house doctrine applied here: restrict what you accept.
//
// WHAT COUNTS AS A DEFINITION, and the ceiling of that answer. `carriesResourceDefinition` asks
// for a `config` OBJECT holding one of the three keys that carry the URL of a catalog resource
// (`source` / `tiles` / `url`), measured against the seeded catalog rows (migration 003:
// `{description, source:{type,url}, bounds, paint, sourceLayer, minzoom, maxzoom, style}`). It is
// deliberately NARROW: a nested `{config:{source:…}}` does not occur in any domain field measured
// (feature properties, 3D/360 data, grid, temporal, slide position), so the false-positive cost is
// nil, while a wider predicate ("anything with a `config`") would start eating domain state.
//
// WHAT IT DOES NOT CLOSE. The predicate is a LITERAL-KEY match: it fires only on a key spelled
// exactly `config` whose value is an object holding a key spelled exactly `source`, `tiles` or
// `url`. Rename either level (`cfg`, or `config.fonte`), or drop the wrapper entirely, and nothing
// here looks at it. That was measured, not assumed: seven renamed variants were stored through the
// real sync route and came back out in an anonymous public-link snapshot.
//
// WHY IT IS NOT WIDENED, which is a decision and not an omission. All three wider predicates were
// tried and each fails on the same rock. Bare MapLibre-source shape eats real domain state
// (`cesium3d_data.data` legitimately holds tileset URLs, icon configs legitimately hold
// `{type,url}`), which is silent data loss, the class this repository has paid for repeatedly.
// URL-text matching is data-dependent, defeated by any re-encoding, and stale the moment an admin
// fixes a URL. Enumerating the scrubbed fields means ~90 property keys that grow with every new
// tool, so it fails as a tool that quietly stops persisting.
//
// SO STATE THE TEETH HONESTLY: this file is strong against ACCIDENT and weak against INTENT. It
// stops the shape a real client produces, which is how every leak found in this line of work
// actually arose (a client copying a definition into a domain field). It does not stop a principal
// who can already READ the private definition from encoding it under a name of his choosing, and
// no schema can, because the product exists to let people store arbitrary annotations and
// republish them to collaborators. That residue is the SAME ceiling as free text (map notes,
// feature `descricao`, comment text, slide HTML), and it is an AUDIT and REVOCATION problem, not a
// schema problem.

import { CATALOG_LAYER_DEFINITION_KEYS } from './catalog-layer.ref.js';
import { MAX_PRUNE_DEPTH } from './resource-payload.prune.js';

/**
 * The keys inside a catalog `config` that carry the resource's address. Measured against the
 * seeded rows of migration 003 and against `config.static.js`; `url` alone covers the tileset
 * shape, `tiles` the raster-array shape.
 */
const CONFIG_ADDRESS_KEYS = Object.freeze(['source', 'tiles', 'url']);

/** @param {*} v @returns {boolean} Whether `v` is a non-array object. */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Does this node carry a copy of a catalog resource DEFINITION, judged by shape alone?
 *
 * Blind to `type` on purpose — that stamp is the outbound predicate, and the hole this file
 * closes is exactly the payload that omits it.
 *
 * @param {*} node
 * @returns {boolean}
 */
export function carriesResourceDefinition(node) {
  return isPlainObject(node) && isPlainObject(node.config)
    && CONFIG_ADDRESS_KEYS.some((k) => Object.hasOwn(node.config, k));
}

/**
 * Recursive walk. Returns the argument BY IDENTITY when nothing was taken, so the common case
 * (every real payload) costs one traversal and no allocation.
 *
 * `__proto__` is dropped rather than copied: `out[key] = value` for that key would set the
 * prototype of the copy instead of adding a field, and a write border is the wrong place to
 * discover that.
 *
 * @param {*} node
 * @param {number} depth
 * @returns {*}
 */
function walk(node, depth) {
  if (node === null || typeof node !== 'object') return node;
  // Same ceiling as the outbound boundary, imported rather than repeated: client payload is
  // untrusted input, and "nest it deeper than the walker goes" must not be a bypass on either side.
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

  const drop = carriesResourceDefinition(node) ? CATALOG_LAYER_DEFINITION_KEYS : null;
  let changed = false;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '__proto__') { changed = true; continue; }
    if (drop && drop.includes(key)) { changed = true; continue; }
    const walked = walk(value, depth + 1);
    if (walked !== value) changed = true;
    out[key] = walked;
  }
  return changed ? out : node;
}

/**
 * The value with every catalog-resource definition removed, at any depth, including at the root.
 *
 * Removal takes the DEFINITION keys (`name`/`config`) off the carrier, never the carrier itself:
 * the carrier is domain state that happens to have a copy stapled to it, and dropping the whole
 * node would lose the state the F11 rehydration exists to preserve.
 *
 * @param {*} value
 * @returns {*} The same value when nothing was taken.
 */
export function scrubResourceDefinitions(value) {
  return walk(value, 0);
}
