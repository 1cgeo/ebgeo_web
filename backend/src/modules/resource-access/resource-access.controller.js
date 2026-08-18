// Path: src/modules/resource-access/resource-access.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { marcarEscopoJson } from '../../utils/cache-scope.js';
import { principalUserId } from '../../utils/principal.js';
import * as svc from './resource-access.service.js';

/**
 * GET /api/v1/resource-access/visible?atlasId=
 *
 * O payload ADITIVO. `atlasId` é OPCIONAL: sem ele o segundo braço da resolução
 * (o empréstimo) não contribui, e sobram papel global e concessão pessoal.
 *
 * `principalUserId` (e não `req.user.id`) porque o visitante de link público
 * carrega um sub sintético `public-<uuid>`, que num cast `::uuid` levanta 22P02 e
 * volta como um HTTP 400 sem relação aparente com a causa. NULL ali é o valor
 * CORRETO para ele, não uma degradação (R4).
 *
 * É O CORPO MAIS SENSÍVEL DO SISTEMA a um cache compartilhado: ele é, por definição,
 * o delta privado deste chamador (concessão pessoal mais empréstimo do atlas em
 * foco). Marcar escopo aqui usa a MESMA peça do 360 (`utils/cache-scope.js`), porque
 * uma terceira definição de "esta resposta dependeu de quem pediu" é a forma que este
 * defeito tem de voltar. Ausência de `Cache-Control` autoriza heurística, e a isenção
 * do RFC 9111 para `Authorization` não vale sob `flexibleAuth`, que também lê cookie.
 */
export const visible = asyncHandler(async (req, res) => {
  const data = await svc.listVisiblePrivateResources({
    userId: principalUserId(req.user),
    atlasId: req.params.atlasId ?? null,
  });
  marcarEscopoJson(req, res);
  res.json({ data });
});

export const setVisibility = asyncHandler(async (req, res) => {
  const data = await svc.setResourceVisibility({
    type: req.params.type,
    resourceId: req.params.id,
    accessLevel: req.body.accessLevel,
    actor: req.user,
    req,
  });
  res.json({ data });
});

export const listGrants = asyncHandler(async (req, res) => {
  const data = await svc.listGrantsForResource(req.params.type, req.params.id);
  res.json({ data });
});

export const createGrant = asyncHandler(async (req, res) => {
  const data = await svc.grantResource({
    type: req.params.type,
    resourceId: req.params.id,
    granteeId: req.body.granteeId,
    grantLevel: req.body.grantLevel,
    // Ausente = o default da coluna (um ano). O teto e o prazo do pai são aplicados
    // no INSERT, não aqui.
    expiresAt: req.body.expiresAt ?? null,
    actor: req.user,
    // Calculado por `requireResourceShare`, que acabou de rodar. Reconsultar aqui
    // seria uma segunda leitura do mesmo fato, e é assim que uma requisição passa
    // a ter duas respostas para a mesma pergunta.
    hasGlobalAccess: req.hasGlobalDataAccess === true,
    req,
  });
  res.status(201).json({ data });
});

export const revokeGrant = asyncHandler(async (req, res) => {
  const revoked = await svc.revokeGrant({ grantId: req.params.grantId, actor: req.user, req });
  // A LISTA DOS DERRUBADOS É O PRODUTO, não um detalhe: quem revogou precisa ver
  // que a subárvore caiu junto, e a UI usa a contagem para confirmar antes de
  // fechar o modal.
  res.json({ data: { revoked } });
});
