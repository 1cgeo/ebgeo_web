// Path: src/modules/sharing/sharing.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import * as ctrl from './sharing.controller.js';
import * as schemas from './sharing.schemas.js';

const router = Router({ mergeParams: true });

// Sharing is a co-Gestor ('manage') capability, not owner-only. A manager can grant up to
// 'manage' (the share enum max — 'owner' is NOT grantable) and remove other members, but can
// never touch the owner. Tentar remover o dono responde **404**, não um no-op silencioso: esta
// linha dizia "a no-op on them" até 2026-07-25 e mentia sobre o service que ela mesma monta,
// o que importa porque um cliente escrito contra o comentário trataria a recusa como sucesso.
// Ownership changes only via the owner-only transfer route.
router.get('/', auth, requireAtlasPermission('manage'), ctrl.getSharingConfig);
router.post('/public', auth, requireAtlasPermission('manage'), ctrl.enablePublicSharing);
router.delete('/public', auth, requireAtlasPermission('manage'), ctrl.disablePublicSharing);
router.post('/users', auth, requireAtlasPermission('manage'), validate({ body: schemas.addUserShareSchema }), ctrl.addUserShare);
router.put('/users/:userId', auth, requireAtlasPermission('manage'), validate({ body: schemas.updateUserShareSchema }), ctrl.updateUserShare);
router.delete('/users/:userId', auth, requireAtlasPermission('manage'), ctrl.removeUserShare);

// SAIR DO ATLAS POR CONTA PRÓPRIA (decisão do dono, 2026-08-23).
//
// O GATE É `auth` E MAIS NADA, e é a única rota deste módulo assim. `requireAtlasPermission`
// mediria a autoridade sobre o ATLAS, e a autoridade exercida aqui é sobre SI MESMO: pedir
// `manage` para se retirar é o que deixava um Editor preso num projeto, dependendo de quem
// administra para sair. Nem sequer `read` serve de piso — quem já perdeu o nível de leitura por
// outro caminho continua com a linha de share pendurada, e ela é dele para apagar.
//
// `validate({ params })` SUBSTITUI O GATE COMO GUARDA DE FORMA. Era `requireAtlasPermission` que
// barrava um `:atlasId` malformado antes do cast `::uuid`; sem ele, a validação da borda é o único
// lugar que sobra (ver `atlasIdParamsSchema`).
//
// A ORDEM CONTRA `/users/:userId` NÃO IMPORTA aqui — os caminhos não colidem —, mas o irmão do
// módulo de grupos colide, e lá a ordem é contrato. Ver `access-groups.routes.js`.
router.delete(
  '/me',
  auth,
  validate({ params: schemas.atlasIdParamsSchema }),
  ctrl.leaveAtlas,
);

// O EIXO DE GRUPO (desde 2026-08-21). Um share tem como alvo uma PESSOA **ou** um GRUPO de
// acesso, com os MESMOS quatro níveis concedíveis — inclusive `manage`.
//
// O GATE DE ATLAS CONTINUA `manage`, como no eixo de pessoa: compartilhar é capacidade de
// co-Gestor. O que se soma é um SEGUNDO gate, sobre o GRUPO, e ele vive no serviço
// (`assertCanAdministerGroup`), não aqui: `requireGroupAuthority` é do módulo de grupos e
// lê `req.params.groupId`, que no POST vem no CORPO. Um gate que lesse o param errado
// passaria calado, que é a pior forma de gate.
//
// A ASSIMETRIA É CONCEDER/TIRAR, NÃO ROTA/ROTA, e tem precedente (`requireGrantRevoker`).
// O segundo gate cobra posse do grupo em toda escrita que AUMENTA o alcance dele: o `POST`
// sempre, e o `PUT` só quando o nível novo é MAIOR que o vigente. Tirar — o `DELETE` e o
// `PUT` que rebaixa — não cobra nada, porque tirar acesso nunca pode ser mais difícil que
// dar; senão um grupo compartilhado por alguém que depois perdeu a posse ficaria preso ao
// atlas para sempre, e o gestor do atlas teria como única saída a ação mais destrutiva.
// A comparação de níveis mora no serviço, com o nível anterior que o próprio `UPDATE`
// devolve, porque só lá ele é conhecido sem uma segunda leitura da tabela.
//
// NENHUMA ROTA GET NOVA: `GET /` já devolve `groups` no mesmo payload. Uma porta a mais
// para a mesma informação seria uma superfície a mais para gatear e um censo a mais para
// classificar.
router.post(
  '/groups',
  auth,
  requireAtlasPermission('manage'),
  validate({ body: schemas.addGroupShareSchema }),
  ctrl.addGroupShare,
);
router.put(
  '/groups/:groupId',
  auth,
  requireAtlasPermission('manage'),
  validate({ params: schemas.groupIdParamsSchema, body: schemas.updateGroupShareSchema }),
  ctrl.updateGroupShare,
);
router.delete(
  '/groups/:groupId',
  auth,
  requireAtlasPermission('manage'),
  validate({ params: schemas.groupIdParamsSchema }),
  ctrl.removeGroupShare,
);

export { router as sharingRoutes };
