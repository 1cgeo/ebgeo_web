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
import { assertProductionTypeOf } from '../modules/catalog/catalog.tables.js';
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
 * O ator de uma escrita de CATÁLOGO, resolvido NO BANCO numa consulta só.
 *
 * `produz_este` é `fn_can_produce_resource` sobre a linha apontada pela rota — a
 * MESMA função que gateia o `WHERE` da escrita, e não uma segunda cópia da regra.
 * `producer_org_id` é o escopo, lido do banco e não do token, porque `flexibleAuth`
 * não reconcilia: um produtor rebaixado carregaria o crachá antigo por até 15 min.
 *   $1 = userId (uuid, nullable), $2 = tipo de produção, $3 = id do recurso (texto)
 */
const CATALOG_PRODUCER_ACTOR = `
  SELECT fn_can_produce_resource($1::uuid, $2::text, $3::text) AS produz_este,
         (SELECT u.producer_org_id
            FROM users u
            LEFT JOIN organizations o ON o.id = u.organization_id
           WHERE u.id = $1::uuid
             AND u.is_active = true
             AND COALESCE(o.is_active, true) = true) AS producer_org_id
`;

/**
 * Gate de ESCRITA de catálogo: administrador OU produtor.
 *
 * SÃO DOIS GATES EM CAMADAS DIFERENTES, e nenhum duplica o predicado do outro.
 * Este pergunta "esta pessoa produz alguma coisa?" e recusa cedo (403) quem não
 * produz nada, para que a rota inteira nem rode. QUAL linha é dela é decidido pelo
 * `WHERE` da própria escrita (`catalog.service.js`), na mesma consulta que muta —
 * o que fecha a janela entre ler o dono e escrever, e devolve 404 (não 403) para a
 * linha de outra OM, pela mesma escada de `assertCanSeeResource`.
 *
 * O tipo vem da TABELA com que o router foi fabricado, nunca do request.
 *
 * Deixa em `req.catalogActor` o escopo de produção, que a criação usa para FORÇAR
 * `owner_org_id`. Ele é conveniência para o INSERT, nunca o gate.
 *
 * @param {string} table - Uma de CATALOG_TABLES.
 * @returns {import('express').RequestHandler}
 */
export function requireCatalogProducer(table) {
  const tipo = assertProductionTypeOf(table);
  return (req, res, next) => {
    Promise.resolve().then(async () => {
      const userId = principalUserId(req.user);
      // O id da rota (PUT/DELETE) ou o do corpo (POST, que ainda não passou pelo
      // Joi). AUSENTE VIRA STRING VAZIA, NUNCA NULL, e a distinção não é estética:
      // `fn_can_produce_resource` sai cedo com FALSE para argumento nulo, antes de
      // olhar o papel, então um POST sem `id` (que o Joi vai recusar com 422 na
      // linha seguinte) fazia o ADMINISTRADOR levar 403 aqui. Um id vazio é um id
      // que não existe, e para esse a função responde a pergunta certa: verdadeiro
      // para administrador, falso para todo o resto.
      const bruto = req.params?.id ?? req.body?.id;
      const resourceId = typeof bruto === 'string' ? bruto : '';

      const linha = userId
        ? await one(CATALOG_PRODUCER_ACTOR, [userId, tipo, resourceId])
        : null;
      const producerOrgId = linha?.producer_org_id ?? null;

      if (!linha || (linha.produz_este !== true && !producerOrgId)) {
        return next(new ForbiddenError('É preciso ser administrador ou produtor para alterar o catálogo.'));
      }

      req.catalogActor = { id: userId, producerOrgId };
      return next();
    }).catch(next);
  };
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
