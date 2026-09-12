// Path: src/modules/sync/sync.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import { marcarEscopoJson } from '../../utils/cache-scope.js';
import * as syncService from './sync.service.js';
import { broadcastOperations } from '../collab/collab.rooms.js';

export const lookupOperationReceipts = asyncHandler(async (req, res) => {
  const result = await syncService.lookupOperationReceipts(
    req.atlasId, req.body.operations, req.user.id, req.atlasPermission,
  );
  res.set('Cache-Control', 'no-store');
  res.json({ data: result });
});

export const pushOperations = asyncHandler(async (req, res) => {
  const result = await syncService.pushOperations(
    req.atlasId,
    req.body.operations,
    req.user.id,
    req.atlasPermission
  );

  // The service emits only newly committed, canonical operations. A receipt retry
  // acknowledges delivery but must never relay an old envelope as a new edit.
  const stamped = result.events;

  // Broadcast the pushed operations to WS peers for real-time updates. Comment ops are kept
  // away from read-only viewers (visibility rule); a mixed batch still reaches them minus the
  // comments. The HTTP sender has no socket, so it can't be excluded — clients ignore ops whose
  // clientId is their own (contract: fase-1/fase-8).
  if (stamped.length > 0) {
    broadcastOperations(req.atlasId, stamped, { userId: req.user.id });
  }

  res.json({ data: result });
});

// Since F11 the snapshot embeds catalog-layer definitions filtered by what the CALLER may see,
// so the response varies by principal and by the atlas in focus. Two consequences, both handled
// here: the principal is threaded down (`req.user.id` raw — the service normalises the
// public-link visitor's synthetic sub), and the response is marked as scoped, with the SAME
// piece the 360 and the catalog listings use. Without the mark, `Cache-Control` is absent and
// RFC 9111 lets a shared cache keep a member's snapshot by heuristic and replay it to someone
// who does not reach the private layer inside it.
export const pullOperations = asyncHandler(async (req, res) => {
  const sinceVersion = parseInt(req.params.version, 10) || 0;
  const result = await syncService.pullOperations(
    req.atlasId, sinceVersion, req.atlasPermission, req.user?.id ?? null,
  );
  marcarEscopoJson(req, res);
  res.json({ data: result });
});

// Admin endpoints for cleanup management
export const getCleanupStats = asyncHandler(async (req, res) => {
  const atlasId = req.params.atlasId;
  const stats = await syncService.getCleanupStats(atlasId);
  // getCleanupStats returns null for a non-existent/deleted atlas — surface 404
  // instead of a silent 200 with data:null.
  if (!stats) {
    throw new NotFoundError('Atlas');
  }
  res.json({ data: stats });
});

export const cleanupOperations = asyncHandler(async (req, res) => {
  const atlasId = req.params.atlasId;
  const { keepFromVersion, keepDays } = req.body;
  // `keepFromVersion: 0` é um pedido VÁLIDO (o Joi aceita `min(0)`) e significa
  // "preserve tudo a partir da versão 0", ou seja, não apague nada. A coerção
  // anterior era `keepFromVersion ? ... : undefined`: o zero caía como falsy, virava
  // `undefined`, e o serviço executava o OUTRO ramo — um expurgo por `keepDays` (7,
  // o default do Joi). O administrador que pedia "preserve tudo" disparava um
  // apagamento de sete dias e perdia operações antigas, com 200 e sem sinal nenhum.
  const result = await syncService.cleanupOldOperations(atlasId, {
    keepFromVersion: keepFromVersion !== undefined && keepFromVersion !== null
      ? parseInt(keepFromVersion, 10)
      : undefined,
    keepDays: keepDays ? parseInt(keepDays, 10) : 7,
  });
  res.json({ data: result });
});
