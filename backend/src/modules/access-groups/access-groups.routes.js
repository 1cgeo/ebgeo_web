// Path: src/modules/access-groups/access-groups.routes.js
//
// O EIXO DESTE MÓDULO É POSSE, NÃO PAPEL GLOBAL, e a mudança é de 2026-08-20. Antes,
// listar era aberto a qualquer autenticado e escrever era `requireGlobalDataAccess`
// (administrador OU credenciado). O grupo virou entidade de USUÁRIO: qualquer sessão
// autenticada cria um, e quem administra é o DONO — ou o administrador do sistema,
// pelo ramo curinga de `fn_can_administer_group`.
//
// AS DUAS LEITURAS ABERTAS RESPONDEM PERGUNTAS DIFERENTES, e é por isso que são duas
// rotas:
//
//   - `GET /` são OS MEUS grupos, com gestão (contagem de membros, contagem de
//     concessões). É ela que alimenta o seletor do modal de compartilhar recurso, e é
//     por ela que "conceder a um coletivo" passa a oferecer só coletivos próprios —
//     conceder a um grupo é delegar a quem o compõe o poder de acrescentar
//     beneficiários ao seu recurso;
//   - `GET /participating` são os grupos de que EU PARTICIPO, com o nome do dono e
//     nada mais. Ela existe porque, com a listagem acima recortada, quem foi posto num
//     grupo por outra pessoa deixaria de ver em lugar nenhum um mecanismo que decide o
//     acesso dele a recurso privado. O ROSTER não sai por ela.
//
// A LISTA DE MEMBROS FICA DO LADO FECHADO, junto com a escrita: nome de grupo é
// vocabulário organizacional e serve ao seletor; quem está dentro dele é um roster de
// pessoas.
//
// A ORDEM DOS MIDDLEWARES É CONTRATO: `auth` → `validate({ params })` →
// `requireGroupAuthority` → `validate({ body })`. Se o gate rodasse antes do
// `validate({ params })`, um `:groupId` que não é UUID chegaria a um cast `::uuid` e
// sairia como 500/400 em vez do 422 da borda; se rodasse depois do `validate({ body })`,
// um corpo malformado responderia 422 sobre um grupo que o chamador não pode nem saber
// que existe.
//
// POR QUE REST, e não sync: o raciocínio inteiro está no cabeçalho de
// `resource-access.routes.js`. Metadado de acesso é autoridade do SERVIDOR, não tem
// representação local, não viaja no `.ebgeo` e não participa do snapshot.

import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireGroupAuthority } from './access-groups.authority.js';
import * as ctrl from './access-groups.controller.js';
import * as schemas from './access-groups.schemas.js';

const router = Router();

/**
 * GET /api/v1/access-groups — os grupos QUE ESTE CHAMADOR ADMINISTRA, com contagem de
 * membros, de concessões vivas e de ATLAS alcançados. O administrador do sistema vê
 * todos.
 *
 * `auth` sozinho, porque o recorte mora na CONSULTA: não há gate a aplicar quando a
 * resposta já é, por construção, o que o chamador administra.
 */
router.get('/', auth, ctrl.listGroups);

/**
 * GET /api/v1/access-groups/participating — os grupos de que este chamador PARTICIPA.
 *
 * Declarada antes de qualquer rota com `:groupId` por higiene de leitura; não há
 * colisão de fato, porque nenhuma rota deste módulo casa `GET /:algo`.
 */
router.get('/participating', auth, ctrl.listGroupsParticipating);

/**
 * POST /api/v1/access-groups — cria. Quem cria é o DONO. 409 quando ELE já tem um
 * grupo vivo com esse nome (a unicidade é por dono).
 *
 * `auth` sozinho: não há grupo a gatear ainda, e criar grupo é ato de qualquer sessão
 * autenticada. O visitante de link público não passa aqui porque `auth` é o estrito.
 */
router.post(
  '/',
  auth,
  validate({ body: schemas.createGroupSchema }),
  ctrl.createGroup,
);

/** PATCH /api/v1/access-groups/:groupId — renomeia e/ou reescreve a descrição. */
router.patch(
  '/:groupId',
  auth,
  validate({ params: schemas.groupIdParamsSchema }),
  requireGroupAuthority,
  validate({ body: schemas.updateGroupSchema }),
  ctrl.updateGroup,
);

/**
 * DELETE /api/v1/access-groups/:groupId — apaga (SOFT), revoga o que o grupo concedia
 * E poda a subárvore que os membros alimentaram a partir dele. A resposta traz o
 * alcance.
 */
router.delete(
  '/:groupId',
  auth,
  validate({ params: schemas.groupIdParamsSchema }),
  requireGroupAuthority,
  ctrl.deleteGroup,
);

/** GET /api/v1/access-groups/:groupId/members — quem está no grupo. */
router.get(
  '/:groupId/members',
  auth,
  validate({ params: schemas.groupIdParamsSchema }),
  requireGroupAuthority,
  ctrl.listMembers,
);

/** POST /api/v1/access-groups/:groupId/members — põe alguém. Idempotente. */
router.post(
  '/:groupId/members',
  auth,
  validate({ params: schemas.groupIdParamsSchema }),
  requireGroupAuthority,
  validate({ body: schemas.addMemberSchema }),
  ctrl.addMember,
);

/**
 * DELETE /api/v1/access-groups/:groupId/members/me — SAIR do grupo por conta própria
 * (decisão do dono, 2026-08-23).
 *
 * A ORDEM É CONTRATO, e aqui ela é do tipo que falha em silêncio: Express casa na ordem de
 * declaração, então `/me` DEPOIS de `/:userId` nunca seria alcançada — a rota de baixo
 * casaria com `userId = 'me'` e o `validate({ params })` dela responderia 422 dizendo que
 * `userId` precisa ser UUID. O sintoma não apontaria para ordem nenhuma. Mesmo motivo de
 * `/trash` e `/overview` virem antes de `/:atlasId` em `atlas.routes.js`.
 *
 * O GATE É `auth` E MAIS NADA, e é a única rota com `:groupId` assim. `requireGroupAuthority`
 * responde 404 ao próprio membro — ele não administra o grupo —, e era exatamente isso que
 * prendia quem foi posto num coletivo por outra pessoa. A autoridade exercida aqui é sobre si
 * mesmo. O grupo alheio continua indistinguível do inexistente: os dois respondem 200 com
 * `removed: false`.
 */
router.delete(
  '/:groupId/members/me',
  auth,
  validate({ params: schemas.groupIdParamsSchema }),
  ctrl.leaveGroup,
);

/**
 * DELETE /api/v1/access-groups/:groupId/members/:userId — tira alguém e poda o que ele
 * alimentou pelo grupo.
 */
router.delete(
  '/:groupId/members/:userId',
  auth,
  validate({ params: schemas.memberParamsSchema }),
  requireGroupAuthority,
  ctrl.removeMember,
);

export { router as accessGroupsRoutes };
