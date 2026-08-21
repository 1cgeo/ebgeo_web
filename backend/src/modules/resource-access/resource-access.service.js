// Path: src/modules/resource-access/resource-access.service.js
// Lógica do acesso a recurso privado. O PREDICADO não mora aqui: ele mora nas funções
// SQL de `008_acesso_a_recurso.sql` (`fn_can_see_resource`, `fn_can_produce_resource`,
// `fn_granted_resource_ids` e as de apoio). É o que permite dizer "o dado não vaza nem
// com bug de app" — um erro nesta camada não abre nada que o SQL feche.

import { query, one, oneOrNone, tx } from '../../database/index.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import * as Q from './resource-access.queries.js';
import {
  RESOURCE_TYPES, PAYLOAD_KEY_BY_TYPE, assertResourceType, tableOf, assertCatalogTableOf,
  assertAuditTargetTypeOfResource,
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
    // O ALVO É COLUNA DE PRIMEIRA CLASSE, e esta é a linha que motivou a mudança de
    // schema. Até ela, as duas restrições do schema de auditoria (002_auditoria.sql)
    // empurravam tipo e id para dentro de `details` — o CHECK de `target_type` não
    // tinha valor para "camada de dados" ('MODEL' seria mentira para três dos quatro
    // tipos) e `target_id` era UUID enquanto o id de catálogo é um SLUG TEXTUAL
    // (gravá-lo ali levantava 22P02, que a borda devolvia como HTTP 400, numa rota
    // sem relação aparente com auditoria). A consequência era que `idx_audit_target`
    // não respondia "tudo que já foi feito com este recurso" e 'SYSTEM' virava
    // depósito de alvo que não coube. As duas caíram; 'SYSTEM' volta a significar
    // sistema.
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: assertAuditTargetTypeOfResource(t),
      targetId: resourceId,
      targetName: updated.name,
      details: { resourceType: t, accessLevel },
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
 * cinco grupos de propósito — somá-lo dentro dos itens mudaria o shape que
 * `mergeGrantedIntoBaseline` despeja nos arrays do `config`.
 *
 * @param {Object} params
 * A OM DO CHAMADOR NÃO É MAIS PARÂMETRO. Ela era auto-declarada no auto-cadastro e
 * mesmo assim abria o privado daquela OM; o eixo continua existindo, resolvido no
 * SQL pelo escopo de PRODUÇÃO, que só um administrador concede.
 *
 * @param {string|null} params.userId - null para o visitante de link público (R4).
 * @param {string|null} params.atlasId - O atlas em foco (empresta), ou null.
 * @returns {Promise<{basemaps: Array, tilesets: Array, dataLayers: Array, analysisLayers: Array, views360: Array, shareable: Object}>}
 */
export async function listVisiblePrivateResources({ userId, atlasId }) {
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

  const { rows: rows360 } = await query(Q.LIST_VISIBLE_PRIVATE_360, [userId, atlasId]);

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
 * @returns {Promise<{basemaps: string[], tilesets: string[], dataLayers: string[], analysisLayers: string[], views360: string[]}>}
 */
async function listShareableOfActor(userId) {
  const vazio = Object.fromEntries(RESOURCE_TYPES.map((t) => [PAYLOAD_KEY_BY_TYPE[t], []]));
  if (!userId) return vazio;

  const { rows } = await query(Q.LIST_SHAREABLE_OF_ACTOR, [userId]);
  for (const r of rows) {
    const chave = PAYLOAD_KEY_BY_TYPE[r.resource_type];
    // Um `resource_type` fora dos cinco é impossível pelo CHECK da tabela, mas
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
 *
 * O PRAZO DO PAI VIAJA JUNTO PARA O INSERT, que é onde ele vira teto. Comparar as
 * duas datas aqui e recusar seria pior de duas maneiras: a comparação usaria o
 * relógio do processo (e o CHECK usa o do banco), e recusar transforma um pedido
 * razoável ("um ano") em erro quando o pai vence antes — o certo é entregar o que
 * dá para entregar e dizer, na resposta e na auditoria, até quando vale.
 */
export async function grantResource({
  type, resourceId, granteeId = null, granteeGroupId = null, grantLevel,
  expiresAt = null, actor, hasGlobalAccess, req,
}) {
  const t = assertResourceType(type);
  // O `xor` do Joi já garante que exatamente um chegou, e o CHECK da tabela garante de
  // novo. Esta linha existe para o chamador INTERNO (teste, script), que não passa pela
  // borda HTTP e caso contrário produziria um 23514 sem relação aparente com a causa.
  if ((granteeId === null) === (granteeGroupId === null)) {
    throw new Error('grantResource: informe granteeId OU granteeGroupId, nunca os dois');
  }
  const paraGrupo = granteeGroupId !== null;

  if (await accessLevelOf(t, resourceId) === null) throw new NotFoundError('Resource');

  // O BENEFICIÁRIO PRECISA EXISTIR E ESTAR VIVO nos dois ramos, e "vivo" quer dizer
  // coisas diferentes: pessoa ATIVA (`is_active`) e grupo NÃO APAGADO (`deleted_at`).
  // Os dois predicados são os mesmos que a resolução usa, então uma concessão aceita
  // aqui é uma concessão que o predicado de leitura vai honrar — sem isto ela nasceria
  // morta, com 201 na resposta e acesso nenhum na prática.
  const grantee = paraGrupo
    ? await oneOrNone(Q.GET_LIVE_GROUP, [granteeGroupId])
    : await oneOrNone(Q.GET_ACTIVE_USER, [granteeId]);
  if (!grantee) throw new NotFoundError(paraGrupo ? 'Access group' : 'User');
  if (!paraGrupo && granteeId === actor.id) {
    throw new ConflictError('Não é possível conceder acesso a si mesmo.');
  }

  let parentGrantId = null;
  let parentExpiresAt = null;
  if (!hasGlobalAccess) {
    const mine = await liveGrantsOfActor(actor.id, t, resourceId);
    const sharer = mine.find((g) => g.grant_level === 'view_share');
    if (!sharer) {
      throw new ForbiddenError('É preciso ter acesso com permissão de compartilhar para conceder este recurso.');
    }
    // O CASO DEGENERADO: conceder AO MESMO grupo de onde a própria autoridade veio.
    // Ele é o análogo coletivo de "conceder a si mesmo" e não é pego pela checagem de
    // duplicata (que compara `granted_by`, e o pai foi concedido por OUTRA pessoa). A
    // linha nasceria pendurada na irmã, cairia junto com ela na poda e não daria a
    // ninguém um acesso que o grupo já não tivesse — ou seja, custo sem efeito, e mais
    // uma aresta na árvore que a tela de revogação tem de explicar.
    if (paraGrupo && String(sharer.grantee_group_id ?? '') === String(granteeGroupId)) {
      throw new ConflictError('Este grupo já é a origem do seu próprio acesso a este recurso.');
    }
    parentGrantId = sharer.id;
    parentExpiresAt = sharer.expires_at ?? null;
  }

  const jaDei = paraGrupo
    ? await oneOrNone(Q.LIVE_GRANT_FROM_ACTOR_TO_GROUP, [actor.id, granteeGroupId, t, resourceId])
    : await oneOrNone(Q.LIVE_GRANT_FROM_ACTOR_TO_GRANTEE, [actor.id, granteeId, t, resourceId]);
  if (jaDei) {
    throw new ConflictError(paraGrupo
      ? 'Este grupo já recebeu acesso a este recurso de você.'
      : 'Este usuário já recebeu acesso a este recurso de você.');
  }

  return tx(async (trx) => {
    const row = await trx.one(Q.INSERT_GRANT, [
      t, resourceId, granteeId, grantLevel, actor.id, parentGrantId,
      expiresAt ?? null, parentExpiresAt, granteeGroupId,
    ]);
    await createAudit(req, {
      // O ALVO É O RECURSO, não o beneficiário, e a escolha é deliberada: o que
      // mudou foi o ACESSO A ESTA COISA, e é por ela que se investiga ("quem mexeu
      // no acesso deste tileset?"), pelo mesmo `idx_audit_target` que a auditoria de
      // zona já usa (`ZONE` + zoneId). O beneficiário desce para `details` com o
      // nome junto, para que a linha continue legível sem um JOIN.
      //
      // A escolha é a MESMA em `revokeGrant`: os dois lados de um par
      // conceder/revogar precisam apontar para o mesmo alvo, senão a história de um
      // acesso se parte em duas listas que não se cruzam.
      action: 'PERMISSION_GRANT',
      actorId: actor.id,
      targetType: assertAuditTargetTypeOfResource(t),
      targetId: resourceId,
      // `expiresAt` é o prazo EFETIVO (já podado pelo teto da casa e pelo do pai),
      // não o pedido: a auditoria da expiração acontece na CONCESSÃO, porque não há
      // varredura que aplique a expiração depois — a morte mora no predicado, e sem
      // esta linha nada no registro diria até quando aquele acesso valeu.
      //
      // O BENEFICIÁRIO COLETIVO OCUPA CAMPOS PRÓPRIOS, e não os mesmos com outro
      // significado: `granteeId` continua sendo pessoa e `granteeGroupId` é grupo, os
      // dois presentes e um deles nulo, exatamente como as colunas. Reusar um campo só
      // ("granteeId, que às vezes é um grupo") obrigaria toda leitura da trilha a
      // consultar uma segunda coluna para saber o que aquele UUID significa, e um filtro
      // por pessoa passaria a casar grupos por coincidência de id.
      details: {
        resourceType: t, grantLevel, grantId: row.id, parentGrantId,
        granteeId,
        granteeUsername: paraGrupo ? null : grantee.username,
        granteeGroupId,
        granteeGroupName: paraGrupo ? grantee.name : null,
        expiresAt: row.expires_at,
      },
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
        // O RECURSO É O ALVO, igual ao `PERMISSION_GRANT` — ver a nota lá. UMA LINHA
        // POR CONCESSÃO DERRUBADA continua valendo: aqui cada linha é sobre uma
        // PESSOA que perdeu acesso, e o `granteeId` de cada uma é o que responde
        // "por que Fulano perdeu acesso" quando ele caiu por poda da subárvore e
        // não por revogação direta.
        action: 'PERMISSION_REVOKE',
        actorId: actor.id,
        targetType: assertAuditTargetTypeOfResource(p.resource_type),
        targetId: p.resource_id,
        details: {
          resourceType: p.resource_type,
          granteeId: p.grantee_id,
          // O beneficiário coletivo em campo PRÓPRIO, como no par `PERMISSION_GRANT`:
          // sem ele, revogar uma concessão a grupo gravaria uma linha cujo "quem perdeu
          // acesso" é nulo, e a pergunta que esta trilha existe para responder ficaria
          // sem resposta justo no caso em que N pessoas caem de uma vez.
          granteeGroupId: p.grantee_group_id,
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
 * A pergunta inversa de {@link listAtlasResources}: que atlas emprestam este recurso.
 *
 * Sem transação, sem auditoria e sem gate, de propósito: o único consumidor é o aviso
 * ao vivo da revogação, que precisa de ENDEREÇO DE SALA e não de autorização. Quem
 * decide o que cada receptor pode ver é o payload aditivo que ele mesmo re-pede
 * depois do frame.
 *
 * @param {string} type - Tipo de recurso já validado pelo chamador.
 * @param {string} resourceId
 * @returns {Promise<string[]>} Ids de atlas, sem repetição.
 */
export async function atlasesLendingResource(type, resourceId) {
  const { rows } = await query(Q.ATLASES_LENDING_RESOURCE, [type, resourceId]);
  return rows.map((r) => r.atlas_id);
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
 *
 * ESTA FUNÇÃO FICOU SEM CHAMADOR NENHUM POR UMA FASE INTEIRA, enquanto o comentário
 * que introduziu `resource_grants` afirmava por escrito que `deleteProject` a chamava na mesma
 * transação. Não chamava: apagar um projeto 360 deixava `resource_grants` e
 * `atlas_resources` apontando para um UUID que não existia mais. A ligação foi
 * feita em `deleteProject`, e é ela que dá sentido à trilha abaixo.
 *
 * UMA LINHA POR CONCESSÃO E UMA POR EMPRÉSTIMO, e não uma linha com contagens: este
 * é o ÚNICO hard-delete do sistema, então depois do COMMIT não existe mais nada de
 * onde reconstruir quem tinha acesso ao recurso apagado. Uma linha por vínculo é a
 * última fotografia possível — a mesma razão de `revokeGrant` emitir por concessão
 * podada, e aqui o argumento é mais forte, porque lá a linha sobrevive com
 * `revoked_at`.
 *
 * ANTES do DELETE do recurso e DENTRO da transação do chamador: fora dela, uma
 * ingestão que falhasse depois deixaria a trilha afirmando uma destruição que o
 * rollback desfez.
 *
 * @param {object} trx - A transação de quem está apagando.
 * @param {string} type - Tipo de recurso (whitelist).
 * @param {string} resourceId
 * @param {string|null} [actorId] - Quem disparou a exclusão do recurso.
 * @param {object} [req] - Express req, para ip/user-agent.
 * @returns {Promise<{grants: number, atlasLinks: number}>}
 */
export async function purgeResourceLinks(trx, type, resourceId, actorId = null, req = null) {
  const t = assertResourceType(type);
  const alvo = assertAuditTargetTypeOfResource(t);
  const grants = await trx.any(Q.PURGE_GRANTS_OF_RESOURCE, [t, resourceId]);
  const links = await trx.any(Q.PURGE_ATLAS_LINKS_OF_RESOURCE, [t, resourceId]);

  if (actorId) {
    for (const g of grants) {
      await createAudit(req, {
        action: 'PERMISSION_PURGE',
        actorId,
        targetType: alvo,
        targetId: resourceId,
        details: {
          kind: 'grant',
          resourceType: t,
          grantId: g.id,
          granteeId: g.grantee_id,
          granteeGroupId: g.grantee_group_id,
          grantedBy: g.granted_by,
          grantLevel: g.grant_level,
          parentGrantId: g.parent_grant_id,
          // `wasLive` separa a concessão que ainda valia da que já estava revogada
          // ou vencida: só a primeira significa que alguém perdeu acesso agora.
          wasLive: g.revoked_at === null,
        },
      }, trx);
    }
    for (const l of links) {
      await createAudit(req, {
        action: 'PERMISSION_PURGE',
        actorId,
        targetType: alvo,
        targetId: resourceId,
        details: {
          kind: 'atlas_link',
          resourceType: t,
          atlasResourceId: l.id,
          atlasId: l.atlas_id,
          addedBy: l.added_by,
          wasLive: l.removed_at === null,
        },
      }, trx);
    }
  }

  return { grants: grants.length, atlasLinks: links.length };
}
