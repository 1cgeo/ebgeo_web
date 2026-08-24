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

/**
 * GET /api/v1/resource-access/grants/issued — o que EU concedi.
 * GET /api/v1/resource-access/grants/received — o que EU recebi.
 *
 * CADA PESSOA VÊ O SEU, e o sujeito vem do TOKEN, nunca da query string: um `?userId=`
 * transformaria as duas rotas em enumeração do acesso alheio, e o gate teria de ser
 * inventado depois. Sem parâmetro não há o que gatear além do `auth`.
 *
 * `principalUserId` pelo mesmo motivo do payload aditivo: o visitante de link público
 * carrega um sub sintético que estoura num cast `::uuid`. Aqui, porém, NULO não é um
 * valor legítimo — ele não tem linha em `users`, logo não concedeu nem recebeu nada —, e
 * a consulta com `$1` nulo devolve zero linha por construção (`granted_by = NULL` e
 * `grantee_id = NULL` são NULL, nunca verdadeiro). O envelope vazio é a resposta certa, e
 * é ela que evita um 500 num caminho que o visitante pode alcançar.
 *
 * `marcarEscopoJson` porque o corpo é, por definição, o de UM chamador: sem
 * `Cache-Control` um cache compartilhado pode guardar por heurística e repor o inventário
 * de uma pessoa para outra.
 */
export const grantsIssued = asyncHandler(async (req, res) => {
  const grants = await svc.listGrantsIssuedByActor(principalUserId(req.user));
  marcarEscopoJson(req, res);
  res.json({ data: { grants } });
});

export const grantsReceived = asyncHandler(async (req, res) => {
  const grants = await svc.listGrantsReceivedByActor(principalUserId(req.user));
  marcarEscopoJson(req, res);
  res.json({ data: { grants } });
});

/**
 * PATCH /api/v1/resource-access/grants/:grantId — estende o prazo.
 *
 * A resposta carrega o prazo EFETIVO (pós-clamp), e não o pedido. Ver `extendGrant` no
 * serviço: é a diferença que permite à tela dizer "pedi 180 dias e o teto do pai cortou
 * em 20" em vez de afirmar um prazo que o banco não guardou.
 */
export const extendGrant = asyncHandler(async (req, res) => {
  const data = await svc.extendGrant({
    grantId: req.params.grantId,
    expiresAt: req.body.expiresAt,
    actor: req.user,
    req,
  });
  res.json({ data });
});

export const createGrant = asyncHandler(async (req, res) => {
  const data = await svc.grantResource({
    type: req.params.type,
    resourceId: req.params.id,
    // Exatamente um dos dois chega preenchido — o `xor` do Joi já recusou o corpo com
    // nenhum e o com ambos. O `?? null` é o que transforma "ausente" em NULL de coluna:
    // `undefined` num parâmetro de `pg-promise` vira a string 'undefined' num cast
    // `::uuid` e levanta 22P02, longe daqui.
    granteeId: req.body.granteeId ?? null,
    granteeGroupId: req.body.granteeGroupId ?? null,
    grantLevel: req.body.grantLevel,
    // Ausente = o default da coluna (um ano). O teto e o prazo do pai são aplicados
    // no INSERT, não aqui.
    expiresAt: req.body.expiresAt ?? null,
    actor: req.user,
    // Calculado por `requireResourceShare`, que acabou de rodar. Reconsultar aqui
    // seria uma segunda leitura do mesmo fato, e é assim que uma requisição passa
    // a ter duas respostas para a mesma pergunta.
    hasGlobalAccess: req.hasGlobalDataAccess === true,
    // O MESMO raciocínio, para o outro titular da concessão de RAIZ. A diferença é
    // que este é fato do PAR (ator, recurso), e o gate o calculou com o MESMO
    // `:type/:id` que o serviço vai usar — não há segundo alvo a reconciliar.
    producesResource: req.producesResource === true,
    req,
  });
  res.status(201).json({ data });
});

/**
 * O RECORTE DA RESPOSTA, e ele é de ESCOPO, não de estilo.
 *
 * As três listas saem de um `RETURNING` que carrega, além do sujeito de cada linha, o
 * `novo_pai` (o id de uma concessão que está FORA da subárvore revogada, e cuja
 * existência revela "esta pessoa tem outro caminho de acesso, dado por outra pessoa") e
 * os dois prazos de terceiros — sendo que `prazo_novo` é um `LEAST`, então muitas vezes
 * ele É o `expires_at` da concessão alheia. Nada disso é do chamador: o gate de revogar
 * (`requireGrantRevoker`) autoriza por AUTORIA da linha apontada e não exige que o ator
 * ainda tenha `view_share` no recurso, então quem já perdeu a tela "quem tem acesso"
 * continua podendo revogar — e receberia esse metadado junto.
 *
 * O QUE A UI PRECISA É A CONTAGEM E O SUJEITO, e é exatamente o que sobra aqui (o
 * cliente lê `.length` das três listas). O de-para completo do repai — de qual pai para
 * qual, de qual prazo para qual — pertence à TRILHA, que já o grava em
 * `PERMISSION_REPARENT` e tem gate próprio.
 *
 * @param {Array} linhas
 * @returns {Array<{id: string, grantee_id: string|null, grantee_group_id: string|null,
 *   resource_type: string, resource_id: string}>}
 */
const semDadoDeFora = (linhas) => (linhas ?? []).map((l) => ({
  id: l.id,
  grantee_id: l.grantee_id,
  grantee_group_id: l.grantee_group_id,
  resource_type: l.resource_type,
  resource_id: l.resource_id,
}));

export const revokeGrant = asyncHandler(async (req, res) => {
  const podada = await svc.revokeGrant({ grantId: req.params.grantId, actor: req.user, req });
  // A LISTA DOS DERRUBADOS É O PRODUTO, não um detalhe: quem revogou precisa ver
  // que a subárvore caiu junto, e a UI usa a contagem para confirmar antes de
  // fechar o modal.
  //
  // AS DUAS LISTAS NOVAS SÃO ADITIVAS AO CONTRATO, e ler só `revoked` continua correto —
  // com a diferença de que a contagem passou a ser a VERDADEIRA: quem foi resgatado saiu
  // dela. `reparented` é quem MANTEVE o acesso por outro caminho (`view_share` vivo do
  // concedente) e `trimmed` é quem manteve com o prazo aparado pelo teto do pai novo.
  // Nenhum dos dois perdeu acesso, e é por isso que o aviso ao vivo acima ignora os dois.
  res.json({
    data: {
      revoked: semDadoDeFora(podada.revoked),
      reparented: semDadoDeFora(podada.reparented),
      trimmed: semDadoDeFora(podada.trimmed),
    },
  });
});
