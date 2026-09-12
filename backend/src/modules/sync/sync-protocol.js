// Path: src/modules/sync/sync-protocol.js
import { AppError } from '../../utils/errors.js';

export const syncProtocol = Object.freeze({ writeVersions: [2], receiptLookup: true });

export function assertSyncProtocol(operations) {
  if (!Array.isArray(operations)) return;
  if (operations.some(op => op && typeof op === 'object' && op.id
    && (op.entityType || op.target) && op.protocolVersion !== 2)) {
    // Older clients classify 400/422 as terminal. 426 preserves their queue
    // while requiring an update; it must run before Joi's generic validation.
    throw new AppError('Atualize o EBGeo para enviar alterações. As pendências antigas precisam de revisão.',
      426, 'SYNC_PROTOCOL_INCOMPATIBLE');
  }
}

export function requireSyncProtocol(req, _res, next) {
  try {
    assertSyncProtocol(req.body?.operations);
    next();
  } catch (error) { next(error); }
}
