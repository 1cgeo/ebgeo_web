// Path: src/modules/sync/sync-receipts.js
import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

/** Hash the write intent, excluding local queue bookkeeping and transport diagnostics. */
export function operationDigest(op) {
  return createHash('sha256').update(JSON.stringify(canonical({
    type: op.operationType ?? op.type,
    target: op.entityType ?? op.target,
    entityId: op.entityId ?? op.targetId,
    mapId: op.mapId ?? null,
    data: op.data ?? null,
    changes: op.changes ?? null,
    baseVersion: op.baseVersion ?? null,
    baseOperationId: op.baseOperationId ?? null,
    protocolVersion: op.protocolVersion ?? null,
    patch: op.patch ?? null,
  }))).digest('hex');
}

export async function findReceipt(t, atlasId, opId) {
  return t.oneOrNone(
    'SELECT user_id, payload_hash, server_version, entity_id, result FROM sync_receipts WHERE atlas_id=$1 AND op_id=$2',
    [atlasId, opId],
  );
}

export async function saveReceipt(t, atlasId, rawOp, userId, applied, result = null) {
  const outcome = result ?? {
    opId: rawOp.id, serverVersion: applied.server_version,
    entityId: applied.entity_id, status: 'applied',
  };
  await t.none(`
    INSERT INTO sync_receipts (atlas_id, op_id, user_id, payload_hash, server_version, entity_id, result)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    ON CONFLICT (atlas_id, op_id) DO NOTHING
  `, [atlasId, rawOp.id, userId, operationDigest(rawOp), applied.server_version,
    applied.entity_id, JSON.stringify(outcome)]);
}
