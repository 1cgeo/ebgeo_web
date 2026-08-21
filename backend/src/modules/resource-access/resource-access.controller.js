// Path: src/modules/resource-access/resource-access.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { marcarEscopoJson } from '../../utils/cache-scope.js';
import { principalUserId } from '../../utils/principal.js';
import { broadcastToRoom } from '../collab/collab.rooms.js';
import logger from '../../utils/logger.js';
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
 * Avisa AO VIVO as salas dos atlas que EMPRESTAM cada recurso tocado pela poda.
 *
 * O frame é `atlas_resources_updated`, reusado e não inventado: ele já é "só um aviso,
 * sem payload", e o receptor já faz exatamente o certo (re-pede o PRÓPRIO payload
 * aditivo). Como o conjunto visível é diferente por pessoa, mandar conteúdo no frame de
 * todos seria vazamento; por isso ele não carrega tipo nem id de recurso, e é isso que
 * o teste de fronteira afirma pelas chaves da mensagem.
 *
 * ENDEREÇAMENTO. A sala do atlas que empresta é o único subconjunto de afetados que os
 * frames existentes alcançam corretamente, e é onde o dano é COLETIVO (revogar a
 * concessão do dono derruba o empréstimo de todos de uma vez). O beneficiário PESSOAL ou
 * de grupo fora de um atlas que empresta continua sem push: o socket dele pode estar
 * noutra sala ou não existir. Falho ABERTO na notificação de propósito: um aviso a mais é
 * um GET a mais, um aviso a menos é o defeito.
 *
 * SAIBA QUE ESSA POLÍTICA VALE PARA UM DOS QUATRO CHAMADORES DA PODA, e não para os
 * quatro. `podarPorRaizes` é chamada por revogar, apagar grupo, tirar membro e desativar
 * conta; só a revogação passa por aqui, porque esta função é do controller de
 * resource-access e os outros três vivem em `access-groups.controller.js` e
 * `users.controller.js`. Os três podam sem acordar sala nenhuma.
 *
 * NÃO É VAZAMENTO, e é por isso que ficou assim: o predicado SQL nega toda leitura real
 * do que caiu, então o efeito é catálogo obsoleto na TELA até o próximo
 * `refreshVisibleResources` ou a próxima reconciliação de socket. O que custaria fechar é
 * extrair esta função para um módulo compartilhado e chamá-la dos outros dois
 * controllers, com teste de WS em cada um — e broadcast sem teste é justamente o
 * verificador que quebra calado. Ficou na lista de resíduos, escrito aqui para que a
 * próxima sessão não SUPONHA que a poda avisa.
 *
 * SÓ OS REVOGADOS ENTRAM, e esta linha é escrita hoje para uma lista que ainda não
 * existe. Quando a poda passar a devolver `{ revoked, reparented, trimmed }` (o resgate
 * por alcançabilidade), quem foi REPAI-ADO não perdeu acesso nenhum, e acordar a sala por
 * ele diria "algo que você via mudou" a quem nada mudou. A normalização abaixo já lê só
 * `revoked` nas duas formas, para que aquela fase não precise voltar aqui.
 *
 * O par (tipo, recurso) vem das LINHAS PODADAS e não do alvo da rota: a subárvore não é,
 * necessariamente, de um recurso só.
 *
 * @param {Array|{ revoked?: Array }} podadas - O que a poda devolveu.
 * @returns {Promise<void>} Best-effort: nunca lança (a revogação já aconteceu).
 */
async function avisarAtlasQueEmprestam(podadas) {
  const revogadas = Array.isArray(podadas) ? podadas : (podadas?.revoked ?? []);
  if (revogadas.length === 0) return;
  try {
    const pares = new Map();
    for (const linha of revogadas) {
      pares.set(`${linha.resource_type}|${linha.resource_id}`, [linha.resource_type, linha.resource_id]);
    }
    const salas = new Set();
    for (const [tipo, id] of pares.values()) {
      for (const atlasId of await svc.atlasesLendingResource(tipo, id)) salas.add(atlasId);
    }
    // Sem `minPermission`: o frame não carrega nada que precise de nível, e um gate por
    // nível aqui deixaria de acordar justamente o Leitor, que é quem mais depende de o
    // catálogo estar certo. O aviso vale para a sala inteira.
    for (const atlasId of salas) broadcastToRoom(atlasId, { type: 'atlas_resources_updated' });
  } catch (error) {
    logger.warn({ err: error }, 'revokeGrant: falha ao avisar as salas dos atlas que emprestam');
  }
}

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
  await avisarAtlasQueEmprestam(podada);
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
