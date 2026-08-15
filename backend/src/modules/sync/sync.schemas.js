// Path: src/modules/sync/sync.schemas.js
import Joi from 'joi';

// Upper bound on the number of operations a single push may carry.
// Aligned with the batch/ack contract refined in fase-1.
export const MAX_OPS_PER_PUSH = 500;

// A single CRDT operation. Accepts BOTH vocabularies (frozen frontend contract):
//   frontend: entityType / operationType / entityId
//   legacy:   target / type / targetId
// `data` and `changes` MUST use .unknown(true) so the validate middleware
// (stripUnknown:true) does not wipe the operation payload.
const operationSchema = Joi.object({
  id: Joi.string().required(),
  entityType: Joi.string(),
  target: Joi.string(),
  operationType: Joi.string().valid('create', 'update', 'delete'),
  type: Joi.string().valid('create', 'update', 'delete'),
  entityId: Joi.string(),
  targetId: Joi.string(),
  mapId: Joi.string().allow(null),
  data: Joi.object().unknown(true).allow(null),
  changes: Joi.object().unknown(true).allow(null),
  // L1 — REQUIRED, matching the NOT NULL columns they land in
  // (operations.client_timestamp / operations.client_id). Optional here meant an
  // op missing either one passed validation and only failed at the INSERT, so a
  // malformed push surfaced as a 500 instead of a clean 422.
  //
  // Safe against the current frontend: every op is built by
  // `createOperation`/`createBatchOperations` (operation-factory.js), which
  // populate both unconditionally for EVERY entity type, and nothing strips them
  // between the queue and the push. Verified before tightening.
  timestamp: Joi.number().required(),
  // Logical clock. Load-bearing: the frontend calls advanceLamportClock() with this
  // on every inbound op, so it is persisted and echoed back on incremental pull.
  // Stays OPTIONAL — its column is nullable (legacy ops predate it).
  lamportTimestamp: Joi.number(),
  clientId: Joi.string().required(),
  // SyncLedger gesture id (best-effort observability). Explicitly allowed (rather than
  // relying on .unknown(true)) so it survives validation and rides the broadcast to peers.
  traceId: Joi.string().allow(null),
  // ── Identidade de ORIGEM da operação (namespace de IndexedDB por atlas) ──────────
  // `atlasId` é o atlas de SERVIDOR em que a op nasceu; `scopeSuffix` é o endereço do
  // banco local que a produziu (`remote-<atlasId>`, ou o slot local). O cliente carimba
  // os dois na FÁBRICA (frontend `operation-factory.js`), e aqui eles são declarados pela
  // mesma razão do `traceId`: não se confia no `.unknown(true)` para transportar um campo
  // que alguém vai ler do outro lado.
  //
  // O QUE ELES NÃO SÃO, E ESTÁ MEDIDO: eles NÃO são persistidos. O INSERT usa o atlas da
  // ROTA e uma lista fixa de colunas (`sync.queries.js`), então o par sobrevive à validação,
  // viaja no rebroadcast (o controller espalha a op validada) e NÃO volta no pull
  // incremental. Ou seja, nenhuma guarda de cliente pode ser construída sobre a presença
  // deles numa op RECEBIDA. O único uso legítimo no servidor é a recusa por operação de uma
  // op que declara pertencer a OUTRO atlas (`foreignAtlasDenialReason`).
  atlasId: Joi.string().allow(null),
  scopeSuffix: Joi.string().allow(null, ''),
})
  .or('entityType', 'target')
  .or('operationType', 'type')
  .or('entityId', 'targetId')
  .unknown(true);

export const pushSchema = Joi.object({
  operations: Joi.array().items(operationSchema).min(1).max(MAX_OPS_PER_PUSH).required(),
});

export const cleanupSchema = Joi.object({
  keepFromVersion: Joi.number().integer().min(0),
  keepDays: Joi.number().integer().min(1).max(365).default(7),
}).or('keepFromVersion', 'keepDays');
