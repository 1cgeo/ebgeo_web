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

function fieldKey(path) { return JSON.stringify(path); }

function validPatchEntry(entry) {
    if (!entry || !['set', 'remove'].includes(entry.op) || !Array.isArray(entry.path)) return false;
    if (entry.op === 'set' && !Object.hasOwn(entry, 'value')) return false;
  const [root, key] = entry.path;
  if (root === 'geometry') return entry.path.length === 1 && entry.op === 'set';
  return root === 'properties' && entry.path.length === 2 && typeof key === 'string'
    && key.length > 0 && !RESERVED.has(key);
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
  const disputed = keys.filter(key => Number(versions[key] ?? versions['*'] ?? 0) > base);
  if (disputed.length) return conflict(RAZAO_CAMPOS_DISPUTADOS, disputed.map(key => JSON.parse(key)));
  const merged = canonicalFeature(current);
  for (const entry of patch) {
    if (entry.path[0] === 'geometry') merged.geometry = entry.value;
    else if (entry.op === 'remove') delete merged.properties[entry.path[1]];
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
