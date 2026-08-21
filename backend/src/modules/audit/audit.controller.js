// Path: src/modules/audit/audit.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { marcarEscopoJson } from '../../utils/cache-scope.js';
import * as auditService from './audit.service.js';

/**
 * A RESPOSTA PASSOU A VARIAR POR CHAMADOR, e por isso ela marca escopo de cache.
 *
 * Enquanto a rota era só-admin o corpo era o mesmo para todo mundo que podia vê-lo;
 * agora um produtor recebe um recorte e um administrador recebe a trilha inteira. Sem
 * `Cache-Control`, o RFC 9111 autoriza um cache COMPARTILHADO a guardar por heurística
 * e repor a trilha do administrador para o produtor — e a isenção do RFC para
 * `Authorization` não cobre isto, porque a requisição autenticada por cookie chega sem
 * aquele cabeçalho. É a mesma peça e o mesmo argumento de `catalog.controller.js`.
 */
export const listAudit = asyncHandler(async (req, res) => {
  const result = await auditService.listAudit(req.query, req.auditScope);
  marcarEscopoJson(req, res);
  res.json({ data: result });
});
