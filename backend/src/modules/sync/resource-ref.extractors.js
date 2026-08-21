// Path: src/modules/sync/resource-ref.extractors.js
// ONDE UMA REFERÊNCIA DE RECURSO VIAJA DENTRO DE UMA OPERAÇÃO DE SYNC — uma entrada por
// superfície, e o lado de ESCRITA do inventário que `../atlas/resource-reference.registry.js`
// mantém.
//
// A DIVISÃO ENTRE OS DOIS ARQUIVOS. O registro diz em que COLUNA um id de catálogo acaba (é o
// que a poda do clone e do import percorre); este diz que CHAVE de que PAYLOAD o põe lá. As
// duas metades andam juntas: uma superfície nova no registro que viaje em op e não tenha
// entrada aqui é exatamente o buraco que esta tabela acabou de fechar em quatro superfícies, e
// `tests/unit/sync-referencia-de-recurso-censo.test.js` reprova até ela ser cadastrada ou
// declarada fora do sync com motivo escrito.
//
// POR QUE ARQUIVO PRÓPRIO, E NÃO DENTRO DE `sync.service.js`. Pelo mesmo motivo do registro:
// para que o censo possa EXERCITAR os extratores em node puro em vez de conferi-los por texto.
// `sync.service.js` abre o pool de banco no import, e um guarda que só casa string é um guarda
// que aprova uma tabela sintaticamente certa e semanticamente errada. A cadeia de imports daqui
// é folha de propósito (`catalog-layer.ref.js` -> `resource-access.types.js`, que não importa
// nada), e mantê-la assim é o que preserva essa propriedade.

import { catalogLayerReference } from '../catalog/catalog-layer.ref.js';

/**
 * One reference `{resourceType, resourceId}`, or none, from a raw payload value.
 *
 * Anything that is not a non-empty string is NOT a reference: `null` (the slide that points at
 * no model), `undefined` (the field simply absent from a partial update) and `''` all mean the
 * same thing here, and turning any of them into a lookup would refuse writes that CLEAR a
 * reference — the very move a user who lost access has to be able to make.
 *
 * @param {string} resourceType - One of RESOURCE_TYPES.
 * @param {*} value
 * @returns {Array<{resourceType: string, resourceId: string}>} Zero or one reference.
 */
function resourceRef(resourceType, value) {
  return (typeof value === 'string' && value !== '') ? [{ resourceType, resourceId: value }] : [];
}

/**
 * The extractor table, keyed by the NORMALIZED `op.target`.
 *
 * WHY EVERY KEY IS SPELLED TWICE. The write paths of `sync.service.js` accept both dialects on
 * purpose (`normalizeMapChanges` aliases `baseLayer`→`base_layer`, `normalizeSlidePayload`
 * aliases `modelId`→`model_id`, `reshape3d360Payload` aliases `tilesetId`→`tileset_id`), so a
 * gate reading only the server dialect would be blind to exactly the spelling the real client
 * emits — a gate that compiles, runs, and never refuses anything.
 *
 * THE SURFACES OF THE REGISTRY THAT ARE **NOT** HERE, each for a reason that is not "forgotten":
 *   - `settings.*` (the six `atlas.settings` allowlists): a `setting` op only ever writes the
 *     whitelisted app-preference keys, and `applyOperation` already rejects the
 *     resource-availability keys by omission. There is no sync surface to gate.
 *   - `mapa.analysisLayers`: declared NAO_REFERENCIA in the registry — grid state, not ids.
 *   - `map_meta`/`atlas_meta`: appliable targets with no entity write at all (they reach the
 *     operations log and nothing else), so no reference can land in a column through them.
 *
 * @type {Readonly<Object<string, function(Object, Object): Array<{resourceType: string, resourceId: string}>>>}
 */
export const RESOURCE_REF_EXTRACTORS = Object.freeze({
  // The layer put on the map: the reference may ride in the id PREFIX, in `originalId` or in
  // `config.id`, and resolving those three is `catalogLayerReference`'s job, not this table's.
  catalog_layer: (payload, op) => {
    const ref = catalogLayerReference(payload, op?.targetId);
    return ref ? [ref] : [];
  },
  // 3D marker / measurement / viewshed / camera position: all four carry the SAME column.
  cesium3d: (payload) => resourceRef('tileset', payload.tileset_id ?? payload.tilesetId),
  // 360 orientation / marker. The value is a photo NAME, not a project id — the resolution to a
  // project lives in `CAN_SEE_SV360_REF` (`sync.queries.js`), never here.
  streetview360: (payload) => resourceRef('sv360_project', payload.photo_name ?? payload.photoName),
  // A briefing slide points at a 3D model AND/OR a 360 view; the two legs are independent.
  slide: (payload) => [
    ...resourceRef('tileset', payload.model_id ?? payload.modelId),
    ...resourceRef('sv360_project', payload.photo_id ?? payload.photoId),
  ],
  // The map's base layer, whether it arrives as the `baseLayer` sub-typed op (what the client
  // emits) or inside a whole-map create/update (what a rename emits).
  //
  // A SUB-TYPED UPDATE THAT IS NOT `baseLayer` IS NOT THIS GATE'S BUSINESS, and the exclusion is
  // the write path's own: `MAP_SUBTYPE_FIELDS` narrows a `mapTemporal`/`mapPosition`/`mapNotes`/
  // `gridStyle` update to its OWN column(s) precisely so that a sibling column smuggled in the
  // payload is DISCARDED. Gating on a value the write already throws away would refuse the whole
  // operation over a field that never reaches a column — the false refusal that
  // `sync-map-subentity-isolation.test.js` caught the first time this table was written.
  map: (payload, op) => {
    if (op?._subType && op._subType !== 'baseLayer') return [];
    return resourceRef('basemap', payload.base_layer ?? payload.baseLayer);
  },
});

/**
 * Refusal text per target: the SURFACE is what the user recognises, not the resource type.
 *
 * Keyed by target and not by `resourceType` because one target can carry two types (the slide)
 * and one type can arrive through two targets (`tileset`, through the 3D entity and through the
 * catalog layer). The person reading the toast knows which THING they were editing.
 */
export const UNSEEN_RESOURCE_REASONS = Object.freeze({
  catalog_layer: 'Alteração descartada: você não tem acesso a esta camada de catálogo.',
  cesium3d: 'Alteração descartada: você não tem acesso a este modelo 3D.',
  streetview360: 'Alteração descartada: você não tem acesso a este projeto 360.',
  slide: 'Alteração descartada: você não tem acesso ao recurso referenciado por este slide.',
  map: 'Alteração descartada: você não tem acesso a esta camada de base.',
});

/**
 * The payload a reference is read from, MIRRORING what the write path reads.
 *
 * `map` is the exception, and the exception is the write path's rather than this gate's:
 * `buildUpdateQuery` merges `{...changes, ...data}` for a map before normalising aliases, so a
 * gate reading only one half would miss the base layer the other half carries. Every other
 * target reads `changes` on an update (`buildDynamicUpdate`) and `data` on a create, which is
 * exactly what `changes ?? data` is.
 *
 * @param {Object} op - Normalized operation.
 * @returns {Object}
 */
export function referencePayloadOf(op) {
  if (op.target === 'map') return { ...op.changes, ...op.data };
  return op.changes ?? op.data ?? {};
}

/**
 * Every resource reference an operation DECLARES, or an empty list.
 *
 * @param {Object} op - Normalized operation.
 * @returns {Array<{resourceType: string, resourceId: string}>}
 */
export function declaredResourceRefs(op) {
  const extract = RESOURCE_REF_EXTRACTORS[op?.target];
  return extract ? extract(referencePayloadOf(op), op) : [];
}
