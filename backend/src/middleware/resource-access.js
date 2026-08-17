// Path: src/middleware/resource-access.js
// Gates de acesso a RECURSO (modelo 3D, camada de dados, camada de análise,
// panorama 360). Eixo distinto do de atlas: `requireAtlasPermission` responde
// "esta pessoa pode mexer NESTE atlas", e estes respondem "esta pessoa pode ver /
// repassar ESTE recurso".
//
// O papel global é lido do BANCO (`fn_has_global_data_access`), nunca do
// `req.user.role`, e a razão é a mesma que fez a função nascer em SQL: o token
// vive até 15 min e `flexibleAuth` não reconcilia, então um curador rebaixado
// carregaria o papel antigo por essa janela inteira.

import { ForbiddenError, NotFoundError, BadRequestError } from '../utils/errors.js';
import { one, oneOrNone } from '../database/index.js';
import { principalUserId } from '../utils/principal.js';
import * as svc from '../modules/resource-access/resource-access.service.js';

/**
 * Sobe o `atlasId` da QUERY para `req.params`.
 *
 * DUAS RAZÕES, e a segunda é a que morde. A primeira é a mesma do módulo `debug`:
 * `requireAtlasPermission` lê de `req.params`. A segunda é
 * `confineVisitorPrincipal` (dentro de `auth`), que confina o visitante de link
 * público comparando `req.params.atlasId || req.params.aId || req.params.id` com o
 * `publicAtlasId` do token — como esta rota recebe o atlas na QUERY, o visitante
 * cairia num 403 sem que nada estivesse errado. Por isso este middleware roda
 * ANTES de `auth`, e não depois como no `debug`.
 *
 * Ao contrário do `liftAtlasIdToParams` do `debug`, aqui o parâmetro é OPCIONAL:
 * "sem atlas em foco" é estado legítimo (a pessoa entrou e ainda não abriu
 * projeto nenhum), e responder 400 ali transformaria o login numa falha.
 */
export function liftOptionalAtlasId(req, res, next) {
  const atlasId = req.query?.atlasId;
  if (atlasId) req.params.atlasId = atlasId;
  next();
}

/**
 * true quando o principal tem papel global de dado (admin ou curador).
 * @param {object} req
 * @returns {Promise<boolean>}
 */
async function hasGlobalDataAccess(req) {
  const userId = principalUserId(req.user);
  if (!userId) return false;
  const row = await one('SELECT fn_has_global_data_access($1::uuid) AS ok', [userId]);
  return row.ok === true;
}

/**
 * Gate de COMPARTILHAR: papel global de dado, ou uma concessão viva com
 * `grant_level = 'view_share'` naquele recurso.
 *
 * `view` NÃO passa, e essa é a única diferença entre os dois níveis: quem recebeu
 * acesso simples vê e não repassa. O teste negativo
 * (`resource-grants-escalonamento.test.js`) é o que impede a distinção de virar
 * prosa.
 *
 * O resultado do papel global fica em `req.hasGlobalDataAccess` porque o serviço
 * precisa dele logo em seguida (é quem decide `parent_grant_id = NULL`), e
 * reconsultar seria uma segunda leitura do mesmo fato — que é como duas respostas
 * diferentes para a mesma pergunta aparecem numa requisição só.
 */
export function requireResourceShare(req, res, next) {
  Promise.resolve().then(async () => {
    const { type, id } = req.params;
    req.hasGlobalDataAccess = await hasGlobalDataAccess(req);
    if (req.hasGlobalDataAccess) return next();

    const userId = principalUserId(req.user);
    const vivas = await svc.liveGrantsOfActor(userId, type, id);
    if (vivas.some((g) => g.grant_level === 'view_share')) return next();

    return next(new ForbiddenError('É preciso ter acesso com permissão de compartilhar para esta ação.'));
  }).catch(next);
}

/**
 * Gate de REVOGAR: o ator precisa ser quem CONCEDEU aquela linha, ou ter papel
 * global.
 *
 * Não basta ter `view_share` no recurso: revogar a concessão de outra pessoa
 * derrubaria uma subárvore que não é sua, e a poda é exatamente a operação cujo
 * alcance passa longe da linha que se aponta.
 */
export function requireGrantRevoker(req, res, next) {
  Promise.resolve().then(async () => {
    const linha = await oneOrNone(
      'SELECT id, granted_by FROM resource_grants WHERE id = $1::uuid',
      [req.params.grantId],
    );
    if (!linha) return next(new NotFoundError('Grant'));

    if (await hasGlobalDataAccess(req)) return next();

    const userId = principalUserId(req.user);
    if (userId && linha.granted_by === userId) return next();

    return next(new ForbiddenError('Só quem concedeu esta permissão (ou um administrador) pode revogá-la.'));
  }).catch(next);
}

/**
 * Gate de VER o recurso apontado no corpo (o anexo ao atlas, na fase F5).
 *
 * Além de `manage` no atlas, quem anexa precisa VER o recurso — sem isso um
 * co-Gestor emprestaria, por adivinhação de id, um recurso que ele mesmo não pode
 * abrir.
 *
 * 404 e não 403: um recurso que o ator não enxerga precisa ser indistinguível de
 * um que não existe, senão o próprio 403 confirma a existência. É a mesma escada
 * de `enforceProjectReadable` no 360.
 */
export function assertCanSeeResource(req, res, next) {
  Promise.resolve().then(async () => {
    const type = req.body?.resourceType ?? req.params?.type;
    const resourceId = req.body?.resourceId ?? req.params?.id;
    if (!type || !resourceId) {
      return next(new BadRequestError('resourceType e resourceId são obrigatórios'));
    }

    const ok = await svc.canSeeResource({
      userId: principalUserId(req.user),
      atlasId: req.params.atlasId ?? null,
      type,
      resourceId,
    });
    if (!ok) return next(new NotFoundError('Resource'));
    return next();
  }).catch(next);
}
