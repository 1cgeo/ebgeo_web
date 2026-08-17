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
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import {
  liftOptionalAtlasId, requireResourceShare, requireGrantRevoker,
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
 */
router.get(
  '/visible',
  validate({ query: schemas.visibleQuerySchema }),
  liftOptionalAtlasId,
  auth,
  ctrl.visible,
);

/**
 * PATCH /api/v1/resource-access/:type/:id/visibility
 *
 * Marcar um recurso como privado é ato de ADMINISTRAÇÃO do catálogo, não de
 * compartilhamento: quem tem concessão pode repassar acesso, e não decidir que o
 * recurso deixou de ser público para todo mundo. Daí `requireAdmin` e não o gate
 * de compartilhar.
 */
router.patch(
  '/:type/:id/visibility',
  auth,
  requireAdmin,
  validate({ params: schemas.resourceParamsSchema, body: schemas.visibilitySchema }),
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

export { router as resourceAccessRoutes };
