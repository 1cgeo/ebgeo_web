// Path: src/modules/access-groups/access-groups.routes.js
//
// DOIS GATES, E A SEPARAÇÃO É O DESENHO. "Quem administra o grupo" e "quem concede a
// ele" são perguntas diferentes, e confundi-las quebra o produto num dos dois
// sentidos:
//
//   - fechar a LISTAGEM no gate de administração tiraria do seletor de compartilhar
//     todo mundo que não é administrador nem credenciado. Quem tem `view_share` num
//     recurso concede a um grupo (é `requireResourceShare` quem autoriza isso, e ele
//     não pergunta papel global nenhum), e sem poder LISTAR grupos ele não tem como
//     escolher um. O ramo de grupo do predicado voltaria a ser inalcançável pela
//     interface, que é o defeito que este módulo inteiro existe para fechar;
//   - abrir a ESCRITA para além do papel global deixaria qualquer pessoa com
//     `view_share` num recurso qualquer criar grupos e pôr gente dentro, o que é
//     autoridade sobre a composição de quem vê o quê no sistema inteiro.
//
// Daí a linha exata: `GET /` é `auth` sozinho, e todo o resto é
// `requireGlobalDataAccess` (administrador OU credenciado, resolvido no banco).
//
// A LISTA DE MEMBROS FICA DO LADO FECHADO, junto com a escrita. Nome de grupo é
// vocabulário organizacional e serve ao seletor; quem está dentro dele é um roster de
// pessoas, e o seletor não precisa dele — a contagem, que `LIST_GROUPS` já devolve,
// basta para a interface dizer "Estado-Maior (12)".
//
// POR QUE REST, e não sync: o raciocínio inteiro está no cabeçalho de
// `resource-access.routes.js`. Metadado de acesso é autoridade do SERVIDOR, não tem
// representação local, não viaja no `.ebgeo` e não participa do snapshot.

import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireGlobalDataAccess } from '../../middleware/resource-access.js';
import * as ctrl from './access-groups.controller.js';
import * as schemas from './access-groups.schemas.js';

const router = Router();

/**
 * GET /api/v1/access-groups — os grupos vivos, com contagem de membros e de
 * concessões vivas.
 *
 * `auth` SOZINHO, pela razão do cabeçalho. A resposta não nomeia pessoa nenhuma: ela
 * traz id, nome, descrição, quem criou e duas contagens.
 */
router.get('/', auth, ctrl.listGroups);

/** POST /api/v1/access-groups — cria. 409 quando o nome já existe entre os vivos. */
router.post(
  '/',
  auth,
  requireGlobalDataAccess,
  validate({ body: schemas.createGroupSchema }),
  ctrl.createGroup,
);

/** PATCH /api/v1/access-groups/:groupId — renomeia e/ou reescreve a descrição. */
router.patch(
  '/:groupId',
  auth,
  requireGlobalDataAccess,
  validate({ params: schemas.groupIdParamsSchema, body: schemas.updateGroupSchema }),
  ctrl.updateGroup,
);

/**
 * DELETE /api/v1/access-groups/:groupId — apaga (SOFT) e, com isso, revoga o que o
 * grupo concedia. A resposta traz o alcance.
 */
router.delete(
  '/:groupId',
  auth,
  requireGlobalDataAccess,
  validate({ params: schemas.groupIdParamsSchema }),
  ctrl.deleteGroup,
);

/** GET /api/v1/access-groups/:groupId/members — quem está no grupo. */
router.get(
  '/:groupId/members',
  auth,
  requireGlobalDataAccess,
  validate({ params: schemas.groupIdParamsSchema }),
  ctrl.listMembers,
);

/** POST /api/v1/access-groups/:groupId/members — põe alguém. Idempotente. */
router.post(
  '/:groupId/members',
  auth,
  requireGlobalDataAccess,
  validate({ params: schemas.groupIdParamsSchema, body: schemas.addMemberSchema }),
  ctrl.addMember,
);

/** DELETE /api/v1/access-groups/:groupId/members/:userId — tira alguém. */
router.delete(
  '/:groupId/members/:userId',
  auth,
  requireGlobalDataAccess,
  validate({ params: schemas.memberParamsSchema }),
  ctrl.removeMember,
);

export { router as accessGroupsRoutes };
