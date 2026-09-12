import { findReceipt } from './sync-receipts.js';
import { scrubEntityPayload } from './free-field.schemas.js';

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
  const destination = await t.oneOrNone('SELECT id FROM maps WHERE id=$1 AND atlas_id=$2 AND deleted_at IS NULL', [op.mapId, atlasId]);
  if (!destination) return conflict('O mapa de destino foi excluído ou não está disponível.');
  if (op.type === 'create') {
    if (current) return conflict(current.deleted_at
      ? 'O item foi excluído no servidor. A criação antiga não pode restaurá-lo.'
      : 'Já existe um item com este identificador.');
    return { op, previous: null, fields: ['*'] };
  }
  if (!current || current.deleted_at) return conflict('O item foi excluído no servidor.');
  if (String(current.map_id) !== String(op.mapId)) return conflict('O item foi movido para outro mapa.');

  let base = rawOp.baseVersion;
  if (rawOp.baseOperationId) {
    const receipt = await findReceipt(t, atlasId, rawOp.baseOperationId);
    if (!receipt || String(receipt.user_id) !== String(userId)
        || String(receipt.entity_id) !== String(op.targetId) || receipt.result.rejected) {
      return conflict('A alteração da qual esta edição depende não foi confirmada.');
    }
    const predecessorVersion = receipt.result.entityVersion;
    if (!Number.isSafeInteger(predecessorVersion)) return conflict('O recibo anterior não comprova uma versão da entidade.');
    base = Number.isSafeInteger(base) ? Math.max(base, predecessorVersion) : predecessorVersion;
  }
  if (!Number.isSafeInteger(base) || base < 1 || base > currentVersion) {
    return conflict('Esta edição não possui uma versão-base confirmada.');
  }
  const saved = await t.oneOrNone(`SELECT entity_version, field_versions FROM sync_entity_fields
    WHERE atlas_id=$1 AND entity_type='feature' AND entity_id=$2`, [atlasId, op.targetId]);
  // REST/import mutations are not allowed to inherit stale field history.
  const versions = saved && Number(saved.entity_version) === currentVersion
    ? saved.field_versions : { '*': currentVersion };
  const patch = rawOp.patch;
  if (op.type === 'delete') {
    if (base !== currentVersion) return conflict('O item foi alterado após a versão que você pretende excluir.', ['*']);
    return { op, previous: current, versions, fields: ['*'] };
  }
  if (!Array.isArray(patch) || patch.length > 1000 || !patch.every(validPatchEntry)) {
    return conflict('O patch desta edição é inválido.');
  }
  const keys = patch.map(entry => fieldKey(entry.path));
  if (new Set(keys).size !== keys.length) return conflict('O patch altera o mesmo campo mais de uma vez.');
  const disputed = keys.filter(key => Number(versions[key] ?? versions['*'] ?? 0) > base);
  if (disputed.length) return conflict('Os mesmos campos foram alterados no servidor.', disputed.map(key => JSON.parse(key)));
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
  await t.none(`INSERT INTO sync_entity_fields (atlas_id, entity_type, entity_id, entity_version, field_versions)
    VALUES ($1, 'feature', $2, $3, $4::jsonb)
    ON CONFLICT (atlas_id, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version, field_versions=EXCLUDED.field_versions`,
  [atlasId, op.targetId, entityVersion, JSON.stringify(fieldVersions)]);
  return { entityVersion, data: canonicalFeature(row) };
}
