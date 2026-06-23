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
  timestamp: Joi.number(),
  // Logical clock. Load-bearing: the frontend calls advanceLamportClock() with this
  // on every inbound op, so it is persisted and echoed back on incremental pull.
  lamportTimestamp: Joi.number(),
  clientId: Joi.string(),
  // SyncLedger gesture id (best-effort observability). Explicitly allowed (rather than
  // relying on .unknown(true)) so it survives validation and rides the broadcast to peers.
  traceId: Joi.string().allow(null),
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
