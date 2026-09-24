// Path: src/modules/sync/feature-conflicts.js
/**
 * @fileoverview The FEATURE instance of the base-and-revision frame.
 *
 * The frame itself moved to `entity-conflicts.js` on 2026-09-13, when it stopped being a feature
 * privilege: the base resolution, the durable field frontier and the refusal vocabulary are now
 * shared with every other collaborative entity. What stays here is what is genuinely about
 * features: the GeoJSON canonical projection, the patch grammar (path-level, finer than any other
 * entity's unit of dispute) and the four command intents (plain edit, move, restore, delete).
 *
 * ITS EXPORTS ARE UNCHANGED ON PURPOSE, the three `RAZAO_*` constants included: they are
 * re-exported from here so `sync.service.js` and the suites that name them keep working without a
 * rename riding along in the commit that moved the logic. Doing both at once is how a refactor
 * stops being verifiable.
 */

import { ForbiddenError } from '../../utils/errors.js';
import { scrubEntityPayload } from './free-field.schemas.js';
import {
  RAZAO_EXCLUIDO_NO_SERVIDOR, RAZAO_CRIACAO_NAO_RESTAURA, RAZAO_IDENTIFICADOR_EM_USO,
  RAZAO_CAMPOS_DISPUTADOS, RAZAO_ALTERADO_ANTES_DA_EXCLUSAO,
  resolveObservedBase, readFieldFrontier, writeFieldFrontier,
} from './entity-conflicts.js';

export {
  RAZAO_EXCLUIDO_NO_SERVIDOR, RAZAO_CRIACAO_NAO_RESTAURA, RAZAO_IDENTIFICADOR_EM_USO,
} from './entity-conflicts.js';

const RESERVED = new Set(['__proto__', 'prototype', 'constructor', 'sync', 'confirmedVersion', 'version', 'createdAt', 'updatedAt', 'id']);

export function canonicalFeature(row) {
  if (!row) return null;
  return {
    type: 'Feature', geometry: row.geometry,
    properties: { ...row.properties, id: row.id, source: row.feature_type,
      layerId: row.layer_id ?? 'default', confirmedVersion: Number(row.version) },
  };
}

async function featureRow(t, atlasId, entityId) {
  return t.oneOrNone(`SELECT f.* FROM features f JOIN maps m ON m.id=f.map_id
    WHERE f.id=$1 AND m.atlas_id=$2`, [entityId, atlasId]);
}

/**
 * The custom attributes of a feature (`properties.attributes`), the one property whose unit of
 * dispute is each of its KEYS rather than the property itself (owner's decision, 2026-09-24).
 *
 * WHY THIS ONE AND ONLY THIS ONE. The attributes are a bag of independent fields the person names
 * and fills in one at a time, in the panel or in the attribute table, and two colleagues filling
 * DIFFERENT fields of the same feature were disputing one unit: the second to arrive was refused
 * and, once reapplied, its whole bag brought back the field the first had deleted. Every other
 * property keeps its unit, and the rule for the SAME key does not change: written after the
 * declared base, it is a conflict, exactly like `nome` or `descricao`.
 *
 * THE OLD SHAPE STAYS VALID. A queue persisted before this change carries the whole bag at
 * `['properties','attributes']`, and it is applied as it always was (the bag replaced). What is new
 * is that such a write is also disputed by a per-key write made after its base, because replacing
 * the bag would silently erase it.
 */
export const ATTRIBUTES = 'attributes';
const ATTRIBUTES_PATH_KEY = JSON.stringify(['properties', ATTRIBUTES]);
const ATTRIBUTE_KEY_PREFIX = ATTRIBUTES_PATH_KEY.slice(0, -1) + ',';
/**
 * Names that would reach the prototype of the attribute bag instead of an own key. Only `__proto__`
 * does: assigning `constructor` or `prototype` on a plain object creates an own key, and refusing
 * them made every edit of a feature with an attribute of that name travel as the whole bag.
 */
export const UNSAFE_ATTRIBUTE_KEYS = new Set(['__proto__']);

function fieldKey(path) { return JSON.stringify(path); }

function isAttributeKeyPath(path) {
  return path.length === 3 && path[0] === 'properties' && path[1] === ATTRIBUTES;
}

function validPatchEntry(entry) {
    if (!entry || !['set', 'remove'].includes(entry.op) || !Array.isArray(entry.path)) return false;
    if (entry.op === 'set' && !Object.hasOwn(entry, 'value')) return false;
  const [root, key] = entry.path;
  if (root === 'geometry') return entry.path.length === 1 && entry.op === 'set';
  if (isAttributeKeyPath(entry.path)) {
    const name = entry.path[2];
    return typeof name === 'string' && name.length > 0 && !UNSAFE_ATTRIBUTE_KEYS.has(name);
  }
  return root === 'properties' && entry.path.length === 2 && typeof key === 'string'
    && key.length > 0 && !RESERVED.has(key);
}

/**
 * Whether a unit named by the patch was written after the base this operation observed.
 *
 * The frontier stores what each write named, and an attribute key and the whole bag overlap: a key
 * is disputed by a later write of its key OR of the whole bag, and the whole bag by a later write
 * of itself OR of any of its keys. Every other path reads exactly as before (its own entry, then
 * `'*'`, against the resolved base).
 *
 * THE WHOLE BAG READS ITS KEYS AGAINST THE DECLARED BASE, not the chained one. A dependent edit
 * (`baseOperationId`) adopts the revision its predecessor committed, and that revision already
 * holds what a colleague wrote between the declared base and the predecessor. For a unit the author
 * writes, that is the usual rule; for the whole bag, which replaces keys the author never saw, it
 * erased a colleague's key without a word. A key written by the predecessor ITSELF is the author's
 * own and is not a dispute; a key written by an earlier link of a longer chain is (the receipt names
 * only the immediate predecessor), which fails closed into a reviewable conflict.
 * @param {Object} versions - The frontier, unit → version.
 * @param {string} key - `fieldKey` of the path.
 * @param {{base: number, declared: (number|null), predecessor: (number|undefined)}} observed
 * @returns {boolean}
 */
function writtenAfter(versions, key, { base, declared, predecessor }) {
  const own = versions[key];
  if (key.startsWith(ATTRIBUTE_KEY_PREFIX)) {
    const bag = versions[ATTRIBUTES_PATH_KEY];
    if (own === undefined && bag === undefined) return Number(versions['*'] ?? 0) > base;
    return Math.max(Number(own ?? 0), Number(bag ?? 0)) > base;
  }
  if (Number(own ?? versions['*'] ?? 0) > base) return true;
  if (key !== ATTRIBUTES_PATH_KEY) return false;
  const keysBase = declared ?? base;
  return Object.entries(versions).some(([unit, version]) => unit.startsWith(ATTRIBUTE_KEY_PREFIX)
    && Number(version) > keysBase && Number(version) !== predecessor);
}

/** The attribute bag of the merged feature as an OWN copy, created when absent or malformed. */
function ownAttributeBag(properties) {
  const current = properties[ATTRIBUTES];
  const bag = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  properties[ATTRIBUTES] = bag;
  return bag;
}

/** Reads durable revisions under the caller's atlas write lock, before any mutation. */
export async function prepareFeatureMutation(t, atlasId, op, rawOp, userId) {
  const current = await featureRow(t, atlasId, op.targetId);
  const currentVersion = Number(current?.version ?? 0);
  const conflict = (reason, fields = []) => ({ conflict: {
    reason, fields, entityVersion: currentVersion, deleted: Boolean(current?.deleted_at),
    serverData: canonicalFeature(current),
  } });
  // Validate every declared destination before interpreting the patch. A field omitted by
  // v2 must never turn a cross-atlas write into an apparently successful no-op.
  for (const mapId of new Set([op.mapId, rawOp.data?.map_id, rawOp.changes?.map_id].filter(Boolean))) {
    const destination = await t.oneOrNone('SELECT atlas_id FROM maps WHERE id=$1 AND deleted_at IS NULL', [mapId]);
    if (destination && String(destination.atlas_id) !== String(atlasId)) throw new ForbiddenError('Mapa de outro atlas.');
    if (!destination) return conflict('O mapa de destino foi excluido ou nao esta disponivel.');
  }
  const intent = rawOp.featureIntent;
  if (intent && !['move', 'restore'].includes(intent)) return conflict('Comando de feição inválido.');
  if (intent && op.type !== 'create') return conflict('Este comando exige uma operacao de criacao.');
  if (op.type === 'create' && !intent) {
    if (current) return conflict(current.deleted_at
      ? RAZAO_CRIACAO_NAO_RESTAURA
      : RAZAO_IDENTIFICADOR_EM_USO);
    return { op, previous: null, fields: ['*'] };
  }
  if (!current || (current.deleted_at && intent !== 'restore')) return conflict(RAZAO_EXCLUIDO_NO_SERVIDOR);
  if (intent === 'restore' && !current.deleted_at) return conflict('O item ja foi restaurado ou alterado no servidor.');
  if (intent === 'move' && String(current.map_id) !== String(rawOp.sourceMapId)) return conflict('O item foi movido para outro mapa.');
  if (!intent && String(current.map_id) !== String(op.mapId)) return conflict('O item foi movido para outro mapa.');

  const resolved = await resolveObservedBase(t, atlasId, rawOp, userId, op.targetId, currentVersion);
  if (resolved.reason) return conflict(resolved.reason);
  const base = resolved.base;
  if (intent) {
    if (base !== currentVersion) return conflict('O item mudou desde a versao deste comando.', ['*']);
    return { op, previous: current, fields: ['*'] };
  }
  // REST/import mutations are not allowed to inherit stale field history: the frontier read
  // degrades to `{'*': currentVersion}` whenever the saved revision does not describe this row.
  const versions = await readFieldFrontier(t, atlasId, 'feature', op.targetId, currentVersion);
  const patch = rawOp.patch;
  if (op.type === 'delete') {
    if (base !== currentVersion) return conflict(RAZAO_ALTERADO_ANTES_DA_EXCLUSAO, ['*']);
    return { op, previous: current, versions, fields: ['*'] };
  }
  if (!Array.isArray(patch) || patch.length > 1000 || !patch.every(validPatchEntry)) {
    return conflict('O patch desta edição é inválido.');
  }
  const keys = patch.map(entry => fieldKey(entry.path));
  if (new Set(keys).size !== keys.length) return conflict('O patch altera o mesmo campo mais de uma vez.');
  // The whole bag and one of its keys in the same patch would each undo part of the other.
  if (keys.includes(ATTRIBUTES_PATH_KEY) && keys.some(key => key.startsWith(ATTRIBUTE_KEY_PREFIX))) {
    return conflict('O patch altera o mesmo campo mais de uma vez.');
  }
  const observed = {
    base,
    declared: Number.isSafeInteger(rawOp.baseVersion) ? rawOp.baseVersion : null,
    predecessor: resolved.predecessorVersion,
  };
  const disputed = keys.filter(key => writtenAfter(versions, key, observed));
  if (disputed.length) return conflict(RAZAO_CAMPOS_DISPUTADOS, disputed.map(key => JSON.parse(key)));
  const merged = canonicalFeature(current);
  for (const entry of patch) {
    if (entry.path[0] === 'geometry') merged.geometry = entry.value;
    else if (isAttributeKeyPath(entry.path)) {
      // Removing from a bag that is not there removes nothing, and must not create one.
      if (entry.op === 'remove' && !Object.hasOwn(merged.properties, ATTRIBUTES)) continue;
      const bag = ownAttributeBag(merged.properties);
      if (entry.op === 'remove') delete bag[entry.path[2]];
      else bag[entry.path[2]] = entry.value;
    } else if (entry.op === 'remove') delete merged.properties[entry.path[1]];
    else merged.properties[entry.path[1]] = entry.value;
  }
  const layerId = merged.properties.layerId;
  const safe = scrubEntityPayload('feature', merged);
  const changes = {
    geometry: safe.geometry, properties: safe.properties,
    layer_id: !layerId || layerId === 'default' ? null : layerId,
    feature_type: merged.properties.source,
  };
  return { op: { ...op, changes, data: changes }, previous: current, versions, fields: keys };
}

/** Stores the field frontier and returns the actual committed entity for author and peers. */
export async function finishFeatureMutation(t, atlasId, op, prepared) {
  const row = await featureRow(t, atlasId, op.targetId);
  if (!row) throw new Error('A mutação não materializou a feição.');
  const entityVersion = Number(row.version);
  const fieldVersions = { ...(prepared.versions ?? {}) };
  for (const field of prepared.fields) fieldVersions[field] = entityVersion;
  await writeFieldFrontier(t, atlasId, 'feature', op.targetId, entityVersion, fieldVersions);
  const data = canonicalFeature(row);
  if (prepared.previous && String(prepared.previous.map_id) !== String(row.map_id)) {
    data.previousMapId = prepared.previous.map_id;
  }
  return { entityVersion, data };
}
