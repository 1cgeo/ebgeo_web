// Path: src/modules/atlas/atlas.routes.js
import { Router } from 'express';
import { auth, requireAccountPrincipal } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import { assertCanSeeResource, requireResourceRelay } from '../../middleware/resource-access.js';
import { publicLinkLimiter } from '../../middleware/rate-limit.js';
import * as ctrl from './atlas.controller.js';
import * as schemas from './atlas.schemas.js';

// Sub-routers (nested resources)
import { sharingRoutes } from '../sharing/index.js';
import { imagesRoutes } from '../images/index.js';
import { syncRoutes } from '../sync/index.js';
import { mapsRoutes } from '../maps/index.js';
import { briefingsRoutes } from '../briefings/index.js';

const router = Router();

// Atlas CRUD
router.get('/', auth, ctrl.listAtlas);
router.post('/', auth, validate({ body: schemas.createAtlasSchema }), ctrl.createAtlas);
router.post('/import', auth, validate({ body: schemas.importSchema }), ctrl.importAtlas);
router.get('/public/:link', publicLinkLimiter, ctrl.getPublicAtlas);
// Trash: list the caller's own soft-deleted atlases. MUST precede '/:atlasId' (literal vs param).
router.get('/trash', auth, ctrl.listTrash);
// Idem: rotas literais ANTES do parâmetro, senão '/overview' entra como um atlasId e responde 400.
// Nenhuma das duas leva `requireAtlasPermission`: elas não falam de UM atlas, e o escopo (só os
// atlas que o chamador alcança) está dentro da própria consulta, que é onde ele não escapa.
router.get('/overview', auth, ctrl.listAtlasOverview);
router.get('/presence', auth, ctrl.listAtlasPresence);
router.get('/:atlasId', auth, requireAtlasPermission('read'), ctrl.getAtlas);
router.put('/:atlasId', auth, requireAtlasPermission('write'), validate({ body: schemas.updateAtlasSchema }), ctrl.updateAtlas);
router.delete('/:atlasId', auth, requireAtlasPermission('owner'), ctrl.deleteAtlas);
// Restore is owner-checked inside the service (the atlas is soft-deleted, so requireAtlasPermission
// — which only sees live atlases — cannot gate it).
router.post('/:atlasId/restore', auth, validate({ params: schemas.atlasIdParamsSchema }), ctrl.restoreAtlas);

// Settings (co-Gestor pode configurar o atlas)
router.get('/:atlasId/settings', auth, requireAtlasPermission('read'), ctrl.getSettings);
router.patch('/:atlasId/settings', auth, requireAtlasPermission('manage'), validate({ body: schemas.atlasSettingsSchema }), ctrl.updateSettings);

// Ownership transfer (owner-only). Elege um membro como novo dono; o ex-dono vira 'manage'.
router.post('/:atlasId/transfer', auth, requireAtlasPermission('owner'), validate({ body: schemas.transferOwnershipSchema }), ctrl.transferOwnership);

// Capa do atlas. Gate em 'write', o mesmo de renomear: capa e nome são a identidade visível do
// projeto, e quem pode trocar uma pode trocar a outra. 'manage' seria a régua do compartilhamento,
// que é outra coisa.
router.put('/:atlasId/cover', auth, requireAtlasPermission('write'), validate({ body: schemas.atlasCoverSchema }), ctrl.setAtlasCover);
router.delete('/:atlasId/cover', auth, requireAtlasPermission('write'), ctrl.deleteAtlasCover);

// Recursos EMPRESTADOS pelo atlas (o eixo AMPLIATIVO).
//
// Irmao de `/settings`, e por opcao: os dois sao metadado de atlas, escritos por
// PATCH/POST sob `requireAtlasPermission('manage')`, e ficam FORA do log de
// operacoes pelo mesmo raciocinio — nao tem representacao local, nao viajam no
// `.ebgeo`, nao participam do snapshot, e sao autoridade do servidor.
//
// A diferenca com `settings.available_*` e a DIRECAO, e ela e o motivo de a tabela
// ser separada: la lista vazia significa "sem restricao" (contrato congelado), aqui
// significa "nao empresta nada". A mesma estrutura nao carrega as duas semanticas.
//
// Ler exige so `read`: quem abre o atlas ja RECEBE os recursos emprestados, entao
// esconder dele a lista do que recebeu nao protege nada.
router.get('/:atlasId/resources', auth, requireAtlasPermission('read'), ctrl.listResources);
// Anexar leva gate TRIPLO: `manage` no atlas, VER o recurso e ter autoridade para
// REPASSA-LO. O segundo impede o co-Gestor de emprestar, por adivinhacao de id, um
// recurso que ele mesmo nao abre (404). O terceiro impede que EMPRESTAR seja uma
// forma de repassar sem ter direito de repassar (403): `fn_can_see_resource` nao
// distingue NIVEL de concessao, entao quem tinha so `view` — o nivel definido como
// "ve e NAO repassa" — entregava o recurso a todo membro do atlas, e a um chamador
// anonimo depois de o atlas virar publico. A ORDEM e contrato: o 404 do que nao se
// enxerga vem ANTES do 403 do que nao se pode repassar, senao o segundo confirmaria
// a existencia do recurso que o primeiro esconde.
router.post(
  '/:atlasId/resources',
  auth,
  requireAtlasPermission('manage'),
  validate({ body: schemas.atlasResourceSchema }),
  assertCanSeeResource,
  requireResourceRelay,
  ctrl.attachResource,
);
// Remover NAO exige ver o recurso: quem tem `manage` precisa poder retirar o que
// outro Gestor anexou, inclusive algo que ele proprio nao enxerga — exigir
// visibilidade aqui deixaria o emprestimo preso.
router.delete(
  '/:atlasId/resources/:type/:id',
  auth,
  requireAtlasPermission('manage'),
  validate({ params: schemas.atlasResourceParamsSchema }),
  ctrl.detachResource,
);

// Clone.
//
// A ORDEM E CONTRATO, como na rota de recursos acima: `requireAtlasPermission` primeiro, para
// que um atlas inexistente responda 404 antes de o servidor revelar que a acao exige conta;
// `requireAccountPrincipal` depois, porque o visitante ANONIMO de link publico passa nos dois
// gates anteriores (o link E o atlas da rota, e o ramo `isPublic` concede `read`) e so morria
// no INSERT, com `owner_id = 'public-<uuid>'` num cast ::uuid — um 500 por 22P02. O portador
// do mesmo link que esta LOGADO continua clonando: ele tem linha em `users`.
router.post(
  '/:atlasId/clone',
  auth,
  requireAtlasPermission('read'),
  requireAccountPrincipal,
  validate({ body: schemas.cloneAtlasSchema }),
  ctrl.cloneAtlas,
);

// Map operations
router.post('/:atlasId/maps/:mapId/duplicate', auth, requireAtlasPermission('write'), ctrl.duplicateMap);

// Mount nested routers
router.use('/:atlasId/sharing', sharingRoutes);
router.use('/:atlasId/images', imagesRoutes);
router.use('/:atlasId/sync', syncRoutes);
router.use('/:atlasId/maps', mapsRoutes);
router.use('/:atlasId/briefings', briefingsRoutes);

export { router as atlasRoutes };
