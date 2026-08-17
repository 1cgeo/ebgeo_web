// Path: src/modules/resource-access/resource-access.service.js
// Lógica do acesso a recurso privado. O PREDICADO não mora aqui: ele mora nas três
// funções SQL da migração 017. É o que permite dizer "o dado não vaza nem com bug
// de app" — um erro nesta camada não abre nada que o SQL feche.

import { query, one, oneOrNone, tx } from '../../database/index.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import * as Q from './resource-access.queries.js';
import {
  RESOURCE_TYPES, PAYLOAD_KEY_BY_TYPE, assertResourceType, tableOf, assertCatalogTableOf,
} from './resource-access.types.js';

/**
 * Marca um recurso como público ou privado (gate de administrador na rota).
 *
 * `invalidateAppConfigCache()` roda DEPOIS do commit, nunca dentro (R3). Invalidar
 * dentro da transação reabre a janela na forma de cache: um GET concorrente
 * caindo ali reconstruiria o memo a partir da linha ANTIGA e o re-cacharia,
 * exatamente a janela que a transação acabou de fechar. É a lição de
 * `config-admin-lost-update.repro.test.js`.
 *
 * @param {{type: string, resourceId: string, accessLevel: 'public'|'private', actor: object, req: object}} params
 * @returns {Promise<{id: string, name: string, access_level: string}>}
 */
export async function setResourceVisibility({ type, resourceId, accessLevel, actor, req }) {
  const t = assertResourceType(type);
  const table = tableOf(t);

  const row = await tx(async (trx) => {
    const updated = table
      ? await trx.oneOrNone(Q.setCatalogAccessLevel(table), [accessLevel, resourceId])
      : await trx.oneOrNone(Q.SET_360_ACCESS_LEVEL, [accessLevel, resourceId]);
    if (!updated) throw new NotFoundError('Resource');
    // O ALVO VIAJA EM `details`, E NÃO NAS COLUNAS DE ALVO. Duas restrições do
    // schema de auditoria (001_core.sql) obrigam a isso, e o plano de origem só
    // conferiu a primeira das três colunas:
    //   - `action` tem CHECK, e 'SHARING_CHANGE' já está reservado. Essa parte bate.
    //   - `target_type` tem CHECK PRÓPRIO, limitado a USER/GROUP/MODEL/ZONE/
    //     SYSTEM/ATLAS/ORG. Não existe valor para "camada de dados", e 'MODEL'
    //     seria mentira para três dos quatro tipos.
    //   - `target_id` é UUID, e o id de recurso de catálogo é um SLUG TEXTUAL.
    //     Gravá-lo ali levanta 22P02, que o errorHandler devolve como HTTP 400 —
    //     foi exatamente assim que este defeito apareceu, com a rota respondendo
    //     400 sem nenhuma relação aparente com auditoria.
    // Alargar os dois exigiria DDL destrutiva (DROP CONSTRAINT e ALTER COLUMN
    // TYPE) por uma linha de log. `SYSTEM` + `details` é aditivo e não perde
    // informação nenhuma: o tipo e o id continuam consultáveis, em JSONB.
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: 'SYSTEM',
      targetId: null,
      targetName: updated.name,
      details: { resourceType: t, resourceId, accessLevel },
    }, trx);
    return updated;
  });

  invalidateAppConfigCache();
  return row;
}

// --- o payload aditivo -----------------------------------------------------

/**
 * Os recursos PRIVADOS que este principal enxerga, por tipo.
 *
 * ADITIVO é a palavra que define o desenho. `GET /api/config` continua servindo o
 * documento PÚBLICO, igual para todo chamador e memoizado como UM só; o que a
 * pessoa ganha por papel global, concessão ou empréstimo chega por aqui e o
 * cliente SOMA. Filtrar o `/api/config` por usuário destruiria aquele memo (ele
 * passaria a ser por conjunto de visibilidade, que é ilimitado) no único endpoint
 * cuja falha impede o produto de subir.
 *
 * Repare que o payload devolve SÓ o privado: ele é o delta, não o conjunto.
 *
 * `shareable` é o único campo que NÃO é recurso: é a lista de pares
 * (tipo, id) que este ator pode repassar adiante, para a interface decidir se
 * mostra a ação "Compartilhar" sem uma chamada por cartão. Ele viaja fora dos
 * quatro grupos de propósito — somá-lo dentro dos itens mudaria o shape que
 * `mergeGrantedIntoBaseline` despeja nos arrays do `config`.
 *
 * @param {Object} params
 * @param {string|null} params.userId - null para o visitante de link público (R4).
 * @param {string|null} params.atlasId - O atlas em foco (empresta), ou null.
 * @param {string|null} [params.orgId] - OM do chamador (o ramo dono do 360, D6).
 * @returns {Promise<{tilesets: Array, dataLayers: Array, analysisLayers: Array, views360: Array, shareable: Object}>}
 */
export async function listVisiblePrivateResources({ userId, atlasId, orgId = null }) {
  const catalogTypes = RESOURCE_TYPES.filter((t) => tableOf(t) !== null);

  const catalogRows = await Promise.all(catalogTypes.map(async (type) => {
    const table = assertCatalogTableOf(type);
    const { rows } = await query(Q.listVisiblePrivate(table), [userId, atlasId, type]);
    // A MESMA REPROJEÇÃO DE `config.service.js` (`{ id, name, ...config }`), e não
    // a linha crua: o cliente soma isto dentro dos mesmos arrays de `config`, e um
    // item com shape diferente dos vizinhos quebra o consumidor no ponto de USO,
    // longe daqui.
    return [PAYLOAD_KEY_BY_TYPE[type], rows.map((r) => ({ id: r.id, name: r.name, ...(r.config || {}) }))];
  }));

  const { rows: rows360 } = await query(Q.LIST_VISIBLE_PRIVATE_360, [userId, atlasId, orgId]);

  return {
    ...Object.fromEntries(catalogRows),
    [PAYLOAD_KEY_BY_TYPE.sv360_project]: rows360,
    shareable: await listShareableOfActor(userId),
  };
}

/**
 * Os pares (tipo, id) que este ator pode REPASSAR, agrupados pela mesma chave de
 * payload dos recursos.
 *
 * O visitante de link público não tem linha em `users` e chega aqui com `userId`
 * nulo; devolver os grupos VAZIOS (e não omitir a chave) mantém o shape estável,
 * de modo que o cliente nunca precise distinguir "não pode repassar nada" de
 * "o servidor não respondeu essa parte".
 *
 * @param {string|null} userId
 * @returns {Promise<{tilesets: string[], dataLayers: string[], analysisLayers: string[], views360: string[]}>}
 */
async function listShareableOfActor(userId) {
  const vazio = Object.fromEntries(RESOURCE_TYPES.map((t) => [PAYLOAD_KEY_BY_TYPE[t], []]));
  if (!userId) return vazio;

  const { rows } = await query(Q.LIST_SHAREABLE_OF_ACTOR, [userId]);
  for (const r of rows) {
    const chave = PAYLOAD_KEY_BY_TYPE[r.resource_type];
    // Um `resource_type` fora dos quatro é impossível pelo CHECK da tabela, mas
    // um `undefined` como chave viraria um grupo fantasma no payload em vez de um
    // erro — descartar é a degradação certa aqui.
    if (chave) vazio[chave].push(r.resource_id);
  }
  return vazio;
}

/** O nível de acesso de um recurso, ou null quando ele não existe (ou está inativo). */
async function accessLevelOf(type, resourceId) {
  const table = tableOf(assertResourceType(type));
  const row = table
    ? await oneOrNone(Q.getCatalogAccessLevel(table), [resourceId])
    : await oneOrNone(Q.GET_360_ACCESS_LEVEL, [resourceId]);
  return row ? row.access_level : null;
}

/**
 * O gate PONTUAL: este principal enxerga este recurso? Wrapper de
 * `fn_can_see_resource`, que é COMPOSTA das outras duas — não há aqui uma segunda
 * cópia da regra.
 *
 * Recurso inexistente devolve `false`, não erro: quem chama isto está decidindo se
 * mostra ou esconde, e "não existe" e "não pode ver" precisam ser a mesma resposta
 * para não virarem um oráculo de existência.
 *
 * @returns {Promise<boolean>}
 */
export async function canSeeResource({ userId, atlasId = null, type, resourceId }) {
  const level = await accessLevelOf(type, resourceId);
  if (level === null) return false;
  const row = await one(Q.CAN_SEE_RESOURCE, [userId, atlasId, assertResourceType(type), resourceId, level]);
  return row.ok === true;
}

// --- concessões ------------------------------------------------------------

/** As concessões vivas do ator sobre um recurso, maior nível primeiro (D3). */
export async function liveGrantsOfActor(actorId, type, resourceId) {
  if (!actorId) return [];
  const { rows } = await query(Q.LIVE_GRANTS_OF_ACTOR, [actorId, assertResourceType(type), resourceId]);
  return rows;
}

/** As concessões vivas de um recurso, com beneficiário e concedente. */
export async function listGrantsForResource(type, resourceId) {
  const { rows } = await query(Q.LIST_GRANTS_FOR_RESOURCE, [assertResourceType(type), resourceId]);
  return rows;
}

/**
 * Concede acesso a um recurso, pendurando a concessão nova na do ATOR.
 *
 * `parent_grant_id` é o que faz a árvore existir, e é fixado AQUI, no INSERT — a
 * única escrita dele em todo o sistema. Nenhuma rota expõe UPDATE dele, e é por
 * isso que ciclo é impossível por construção (R7).
 *
 * Quem tem papel global concede de RAIZ (`parent_grant_id = NULL`): a concessão
 * dele não deriva de ninguém, então não há de quem pendurar — e é por isso que
 * revogar a concessão de um administrador não pode ser feito derrubando "o pai".
 *
 * O gate de nível é reafirmado aqui e não só no middleware, de propósito: o
 * middleware protege a ROTA, esta função protege a REGRA. Quem tem `view` não
 * concede nada; quem tem `view_share` concede `view` ou `view_share`.
 */
export async function grantResource({ type, resourceId, granteeId, grantLevel, actor, hasGlobalAccess, req }) {
  const t = assertResourceType(type);

  if (await accessLevelOf(t, resourceId) === null) throw new NotFoundError('Resource');

  const grantee = await oneOrNone(Q.GET_ACTIVE_USER, [granteeId]);
  if (!grantee) throw new NotFoundError('User');
  if (granteeId === actor.id) throw new ConflictError('Não é possível conceder acesso a si mesmo.');

  let parentGrantId = null;
  if (!hasGlobalAccess) {
    const mine = await liveGrantsOfActor(actor.id, t, resourceId);
    const sharer = mine.find((g) => g.grant_level === 'view_share');
    if (!sharer) {
      throw new ForbiddenError('É preciso ter acesso com permissão de compartilhar para conceder este recurso.');
    }
    parentGrantId = sharer.id;
  }

  const jaDei = await oneOrNone(Q.LIVE_GRANT_FROM_ACTOR_TO_GRANTEE, [actor.id, granteeId, t, resourceId]);
  if (jaDei) throw new ConflictError('Este usuário já recebeu acesso a este recurso de você.');

  return tx(async (trx) => {
    const row = await trx.one(Q.INSERT_GRANT, [t, resourceId, granteeId, grantLevel, actor.id, parentGrantId]);
    await createAudit(req, {
      // O ALVO VIAJA EM `details` pelo mesmo motivo de `setResourceVisibility`:
      // `target_id` é UUID e o id de catálogo é slug textual, e o CHECK de
      // `target_type` não prevê tipo de recurso. Aqui `target_id` PODE carregar o
      // beneficiário, que é UUID de verdade e é o alvo humano da ação.
      action: 'PERMISSION_GRANT',
      actorId: actor.id,
      targetType: 'USER',
      targetId: granteeId,
      targetName: grantee.username,
      details: { resourceType: t, resourceId, grantLevel, grantId: row.id, parentGrantId },
    }, trx);
    return row;
  });
}

/**
 * Revoga uma concessão E TODA a subárvore que dela deriva.
 *
 * A auditoria emite UMA LINHA POR CONCESSÃO DERRUBADA, com o `parent_grant_id` e a
 * raiz da poda nos detalhes. Sem isso "por que Fulano perdeu acesso" não tem
 * resposta: só a raiz apareceria no registro, e quem caiu junto seria invisível —
 * que é exatamente a razão de a revogação ser soft e não um DELETE em cascata (D2).
 *
 * Revogar duas vezes devolve lista vazia em vez de erro: `revoked_at IS NULL` no
 * âncora torna a operação idempotente, e a data da PRIMEIRA revogação é a que vale.
 */
export async function revokeGrant({ grantId, actor, req }) {
  const alvo = await oneOrNone(Q.GET_GRANT, [grantId]);
  if (!alvo) throw new NotFoundError('Grant');

  return tx(async (trx) => {
    const podados = await trx.any(Q.REVOKE_GRANT_SUBTREE, [grantId, actor.id]);
    for (const p of podados) {
      await createAudit(req, {
        action: 'PERMISSION_REVOKE',
        actorId: actor.id,
        targetType: 'USER',
        targetId: p.grantee_id,
        details: {
          resourceType: p.resource_type,
          resourceId: p.resource_id,
          grantId: p.id,
          parentGrantId: p.parent_grant_id,
          rootGrantId: grantId,
        },
      }, trx);
    }
    return podados;
  });
}

// --- empréstimo por atlas --------------------------------------------------

/** O que este atlas empresta (vivos). @returns {Promise<Array>} */
export async function listAtlasResources(atlasId) {
  const { rows } = await query(Q.LIST_ATLAS_RESOURCES, [atlasId]);
  return rows;
}

/**
 * Anexa um recurso ao atlas: ele passa a EMPRESTAR acesso, no escopo dele.
 *
 * O GATE É DUPLO e os dois lados são necessários: `manage` no atlas (quem pode
 * configurá-lo) E ver o recurso (para que um co-Gestor não empreste por adivinhação
 * de id um recurso que ele mesmo não pode abrir). O segundo mora no middleware
 * `assertCanSeeResource`, porque é ele que responde 404 — e 404, não 403, para que
 * um recurso invisível seja indistinguível de um inexistente.
 *
 * O que SUSTENTA o empréstimo depois de criado é outra condição, e é de propósito
 * que ela não seja esta: D4 diz que ele vive enquanto o DONO do atlas vir o
 * recurso, e essa checagem mora dentro de `fn_granted_resource_ids`, avaliada a
 * cada leitura. Aqui só se valida quem anexa.
 */
export async function attachAtlasResource({ atlasId, type, resourceId, actor, req }) {
  const t = assertResourceType(type);
  if (await accessLevelOf(t, resourceId) === null) throw new NotFoundError('Resource');

  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.ATTACH_ATLAS_RESOURCE, [atlasId, t, resourceId, actor.id]);
    if (!row) throw new ConflictError('Este recurso já está emprestado por este atlas.');
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: 'ATLAS',
      targetId: atlasId,
      details: { attached: { resourceType: t, resourceId } },
    }, trx);
    return row;
  });
}

/**
 * Desfaz o empréstimo (soft). Não exige ver o recurso: quem tem `manage` no atlas
 * precisa poder RETIRAR o que outro Gestor anexou, inclusive um recurso que ele
 * mesmo não enxerga — exigir visibilidade aqui deixaria o empréstimo preso.
 */
export async function detachAtlasResource({ atlasId, type, resourceId, actor, req }) {
  const t = assertResourceType(type);
  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.DETACH_ATLAS_RESOURCE, [atlasId, t, resourceId, actor.id]);
    if (!row) throw new NotFoundError('Atlas resource');
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: 'ATLAS',
      targetId: atlasId,
      details: { detached: { resourceType: t, resourceId } },
    }, trx);
    return row;
  });
}

/**
 * Apaga concessões e empréstimos de um recurso, NA TRANSAÇÃO DO CHAMADOR (R6).
 *
 * Existe para o único hard-delete do sistema, `DELETE /sv360/admin/projects/:slug`
 * — o plano de origem dizia `sv360.write.service.js` e estava errado; quem apaga é
 * `deleteProject` em `sv360.admin.service.js`. Recebe o `trx` porque uma limpeza
 * fora da transação sobrevive ao rollback do projeto.
 * @param {object} trx - A transação de quem está apagando.
 */
export async function purgeResourceLinks(trx, type, resourceId) {
  const t = assertResourceType(type);
  await trx.none(Q.PURGE_GRANTS_OF_RESOURCE, [t, resourceId]);
  await trx.none(Q.PURGE_ATLAS_LINKS_OF_RESOURCE, [t, resourceId]);
}
