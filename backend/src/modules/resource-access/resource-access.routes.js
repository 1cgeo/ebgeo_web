// Path: src/modules/resource-access/resource-access.routes.js
//
// POR QUE REST, E NÃO SYNC. A regra da casa proíbe rota REST de escrita para
// feição/mapa/camada/grupo/briefing/slide/3D/360 porque são entidades
// colaborativas INCREMENTAIS. Metadado de acesso não é nenhuma dessas coisas: não
// tem representação local, não é exportado no `.ebgeo`, não participa do
// snapshot, e é AUTORIDADE DO SERVIDOR — uma concessão escrita pelo cliente e
// replicada pelo log inverteria a direção de confiança, com o cliente afirmando a
// própria permissão. O precedente exato é `atlas.settings`, que é metadado de
// atlas, escrito por PATCH sob `requireAtlasPermission('manage')`, e fora do log
// pelo mesmo raciocínio.

import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  liftOptionalAtlasId, requireAtlasScopeWhenPresent, requireResourceShare, requireGrantRevoker,
  requireResourceMaintainer,
} from '../../middleware/resource-access.js';
import * as ctrl from './resource-access.controller.js';
import * as schemas from './resource-access.schemas.js';

const router = Router();

/**
 * GET /api/v1/resource-access/visible?atlasId=
 *
 * O payload aditivo: só os recursos PRIVADOS que este principal enxerga. É o
 * segundo endpoint que o desenho exige, e existe para que `/api/config` NÃO
 * precise variar por chamador — aquele documento é memoizado como um só e serve
 * um boot fail-fast, então filtrá-lo por usuário trocaria um memo O(1) por um
 * memo por conjunto de visibilidade, que é ilimitado.
 *
 * A ORDEM DOS TRÊS PRIMEIROS É CONTRATO. `validate` fecha a borda (um `atlasId`
 * não-UUID morre em 422 antes de chegar a um cast `::uuid`); `liftOptionalAtlasId`
 * sobe o parâmetro para `req.params` ANTES de `auth`, porque é lá dentro que
 * `confineVisitorPrincipal` confina o visitante de link público comparando com
 * `req.params` — invertido, o visitante levaria 403 na própria rota que deveria
 * lhe entregar os recursos do atlas que o convidou.
 *
 * O QUARTO ENTROU NA FASE F9, e ele fecha o buraco que os tres primeiros deixavam:
 * `liftOptionalAtlasId` sobe o parametro e `auth` confina o VISITANTE DE LINK PUBLICO,
 * mas nenhum dos dois pergunta se um usuario COMUM alcanca aquele atlas. Como
 * `fn_granted_resource_ids` nao confere participacao (ela so casa `ar.atlas_id`), o UUID
 * do atlas bastava para receber tudo o que ele empresta — e o UUID viaja em toda URL de
 * compartilhamento. `requireAtlasScopeWhenPresent` roda o `requireAtlasPermission('read')`
 * de verdade quando ha atlas em foco, e nao faz nada quando nao ha (que e o estado normal
 * de quem acabou de entrar). Ele vem DEPOIS de `auth` porque precisa de `req.user`.
 */
router.get(
  '/visible',
  validate({ query: schemas.visibleQuerySchema }),
  liftOptionalAtlasId,
  auth,
  requireAtlasScopeWhenPresent,
  ctrl.visible,
);

/**
 * GET /api/v1/resource-access/grants/issued   — o que EU concedi.
 * GET /api/v1/resource-access/grants/received — o que EU recebi.
 *
 * AS DUAS PRECEDEM `/:type/:id/grants` NO ARQUIVO, e a ordem é o que as mantém
 * alcançáveis. Elas têm DOIS segmentos e aquela tem TRÊS, então `/grants/issued` não casa
 * com `/:type/:id/grants` (o Express casa por número de segmentos), e a colisão que o
 * comentário do DELETE discute não se repete aqui. Declará-las antes é cinto de segurança
 * barato: no dia em que alguém escrever uma rota de dois segmentos com `:type` na
 * primeira posição, o parâmetro engoliria a palavra `grants` e a rota nova roubaria estas
 * duas em silêncio — o sintoma seria 404 ou, pior, a listagem errada.
 *
 * O GATE É `auth` E NADA MAIS, e isso não é gate faltando: o SUJEITO das duas consultas é
 * o próprio chamador, resolvido do token, e não há parâmetro por onde apontar para
 * terceiro. O recorte mora na CONSULTA (`granted_by = $1` numa, autoria; beneficiário
 * direto ou por grupo na outra), que é a mesma escada de `GET /access-groups/`.
 *
 * POR QUE ELAS EXISTEM: só havia listagem POR RECURSO, então quem concede precisava
 * LEMBRAR o que concedeu para revogar, e quem recebeu não tinha como sequer perguntar o
 * que tem. Autoridade que não se enumera é autoridade que não se desfaz.
 */
router.get('/grants/issued', auth, ctrl.grantsIssued);
router.get('/grants/received', auth, ctrl.grantsReceived);

/**
 * PATCH /api/v1/resource-access/:type/:id/visibility
 *
 * Marcar um recurso como público ou privado é ato de MANUTENÇÃO do acervo, não de
 * administração do sistema: quem mantém o que a OM produziu decide o que dela é
 * público. Até 2026-08-20 o gate era `requireAdmin`, e o comentário que ocupava estas
 * linhas dizia por extenso o contrário do que o produto passou a querer.
 *
 * A ORDEM INVERTE DE PROPÓSITO: `validate` vem ANTES do gate porque
 * `requireResourceMaintainer` chama `fn_can_produce_resource`, cujo `CASE` LEVANTA para
 * tipo fora da whitelist — um `:type` inventado na URL viraria 500 em vez do 422 da
 * borda. É a mesma razão já escrita em `producesResource`.
 *
 * E o gate resolve o papel NO BANCO: `requireAdmin` lia `req.user.role` do TOKEN, que
 * é justamente a leitura que este módulo inteiro evita porque `flexibleAuth` não
 * reconcilia.
 *
 * O eixo de CONCESSÃO continua à parte: quem tem `view_share` repassa acesso e não
 * decide que o recurso deixou de ser público para todo mundo.
 */
router.patch(
  '/:type/:id/visibility',
  auth,
  validate({ params: schemas.resourceParamsSchema, body: schemas.visibilitySchema }),
  requireResourceMaintainer,
  ctrl.setVisibility,
);

/**
 * GET /api/v1/resource-access/:type/:id/grants — quem tem acesso a este recurso.
 *
 * Gate de compartilhar, e não de ver: a lista nomeia pessoas, então quem só
 * recebeu `view` não precisa saber quem mais recebeu.
 */
router.get(
  '/:type/:id/grants',
  auth,
  validate({ params: schemas.resourceParamsSchema }),
  requireResourceShare,
  ctrl.listGrants,
);

/** POST /api/v1/resource-access/:type/:id/grants — concede `view` ou `view_share`. */
router.post(
  '/:type/:id/grants',
  auth,
  validate({ params: schemas.resourceParamsSchema, body: schemas.grantSchema }),
  requireResourceShare,
  ctrl.createGrant,
);

/**
 * DELETE /api/v1/resource-access/grants/:grantId — revoga a concessão E a
 * subárvore que dela deriva.
 *
 * Rota de DOIS segmentos, enquanto as de concessão têm três: `/grants/:grantId`
 * não colide com `/:type/:id/grants`. O id da concessão basta porque ela já sabe
 * de que recurso é — pedir o tipo e o recurso na URL criaria uma segunda fonte
 * para o mesmo fato, e um par incoerente teria de ser reconciliado por alguém.
 */
router.delete(
  '/grants/:grantId',
  auth,
  validate({ params: schemas.grantIdParamsSchema }),
  requireGrantRevoker,
  ctrl.revokeGrant,
);

/**
 * PATCH /api/v1/resource-access/grants/:grantId — estende o prazo de uma concessão viva.
 *
 * O GATE É O MESMO DA REVOGAÇÃO, `requireGrantRevoker`, REUSADO e não copiado: quem pode
 * desfazer uma concessão pode prorrogá-la, e o predicado (administração do sistema, ou
 * AUTORIA por `granted_by`) já está escrito uma vez. Uma segunda cópia dele divergiria da
 * primeira no ramo que ninguém olha, e aqui a divergência seria para o lado aberto.
 *
 * POR QUE A ROTA EXISTE, e por que "conceder de novo" não resolvia: a segunda concessão
 * do mesmo par devolve 409, e o único caminho que sobrava era revogar antes — mas revogar
 * PODA a subárvore, e a poda não volta. Renovar destruía o acesso de terceiros que a
 * renovação existia para preservar.
 *
 * NÃO EXISTE PATCH QUE ENCURTE. Mover a data para trás deixaria toda a subárvore vencendo
 * DEPOIS do pai, e manter a invariante exigiria descer o aparo por ela — a escrita que o
 * repai da poda já paga. Quem quer tirar acesso revoga.
 */
router.patch(
  '/grants/:grantId',
  auth,
  validate({ params: schemas.grantIdParamsSchema, body: schemas.extendGrantSchema }),
  requireGrantRevoker,
  ctrl.extendGrant,
);

export { router as resourceAccessRoutes };
