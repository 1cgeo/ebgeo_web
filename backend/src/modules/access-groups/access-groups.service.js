// Path: src/modules/access-groups/access-groups.service.js
// O GRUPO DE ACESSO: a metade que faltava ao mecanismo.
//
// POR QUE ESTE MÓDULO EXISTE. As duas tabelas, o `resource_grants.grantee_group_id`
// e o braço de grupo de `fn_granted_resource_ids` nasceram com a
// 008_acesso_a_recurso.sql, e até 2026-08-19 NENHUMA linha de JavaScript os tocava:
// uma varredura por `grantee_group_id` em `src/` devolvia zero. Ou seja, o predicado
// tinha um ramo que nunca devolveu linha em produção, porque não havia como pôr
// alguém num grupo. É exatamente o defeito de `ng.groups`/`ng.user_groups`, que
// `access_groups` SUBSTITUI e cujo epitáfio está escrito na mesma baseline: "a metade
// que faltava era a que fazia o mecanismo existir".
//
// A AUTORIDADE, e ela é decisão do dono tomada em 2026-08-19: administra o grupo quem
// tem PAPEL GLOBAL DE DADO (administrador OU credenciado), pelo gate
// `requireGlobalDataAccess`. O credenciado ganha aqui a primeira escrita do papel
// dele, e a assimetria com o resto do eixo é deliberada: ele já LÊ todo recurso
// privado, então agrupar pessoas para conceder acesso não lhe dá alcance nenhum que
// ele não tivesse — o que muda é a quem ELE pode repassar, e isso já passava por
// `requireResourceShare`.
//
// ADMINISTRAR O GRUPO E CONCEDER A ELE SÃO PERGUNTAS DIFERENTES, e a separação é a
// razão de a listagem estar fora deste gate: quem tem `view_share` num recurso pode
// conceder a um grupo sem poder criar, renomear ou compor grupo nenhum. Ver o
// cabeçalho de `access-groups.routes.js`.

import { query, oneOrNone, tx } from '../../database/index.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import * as Q from './access-groups.queries.js';

/** O `audit_trail.target_type` de todo ato de grupo (migração 009_grupos_de_acesso.sql). */
const ALVO = 'ACCESS_GROUP';

/**
 * Os grupos vivos, com contagem de membros e de concessões vivas.
 * @returns {Promise<Array>}
 */
export async function listGroups() {
  const { rows } = await query(Q.LIST_GROUPS);
  return rows;
}

/**
 * Um grupo vivo, ou 404.
 * @param {string} groupId
 * @returns {Promise<Object>}
 */
export async function getGroup(groupId) {
  const row = await oneOrNone(Q.GET_GROUP, [groupId]);
  if (!row) throw new NotFoundError('Access group');
  return row;
}

/**
 * Cria um grupo.
 *
 * O 409 vem de ZERO LINHA no `ON CONFLICT DO NOTHING`, não de um SELECT prévio: ler
 * antes de escrever deixa uma janela em que duas criações do mesmo nome passam as
 * duas pela leitura, e a segunda só morre no índice, como 23505 genérico.
 *
 * @param {{name: string, description?: string|null, actor: object, req: object}} params
 * @returns {Promise<Object>}
 */
export async function createGroup({ name, description = null, actor, req }) {
  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.INSERT_GROUP, [name, description || null, actor.id]);
    if (!row) throw new ConflictError('Já existe um grupo de acesso com este nome.');
    await createAudit(req, {
      action: 'ACCESS_GROUP_CREATE',
      actorId: actor.id,
      targetType: ALVO,
      targetId: row.id,
      targetName: row.name,
      details: { name: row.name },
    }, trx);
    return row;
  });
}

/**
 * Renomeia e/ou reescreve a descrição.
 *
 * A TRILHA GUARDA O ANTES E O DEPOIS, e não só o depois. "Quem renomeou este grupo"
 * só tem resposta útil com o nome anterior na linha: sem ele, a investigação de "o
 * grupo Alfa sumiu" não consegue ligar Alfa ao grupo que hoje se chama outra coisa.
 * É a mesma razão de a exclusão ser soft.
 *
 * @param {{groupId: string, name?: string, description?: string|null,
 *          descriptionProvided: boolean, actor: object, req: object}} params
 * @returns {Promise<Object>}
 */
export async function updateGroup({
  groupId, name = null, description = null, descriptionProvided, actor, req,
}) {
  const antes = await getGroup(groupId);

  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.UPDATE_GROUP, [
      groupId, name ?? null, description === '' ? null : description, descriptionProvided === true,
    ]);
    // A linha existia na leitura acima; sumir aqui significa exclusão concorrente.
    if (!row) throw new NotFoundError('Access group');
    await createAudit(req, {
      action: 'ACCESS_GROUP_UPDATE',
      actorId: actor.id,
      targetType: ALVO,
      targetId: row.id,
      targetName: row.name,
      details: { nomeAnterior: antes.name, name: row.name },
    }, trx);
    return row;
  });
}

/**
 * Apaga o grupo (SOFT) e, com isso, revoga o que ele concedia.
 *
 * NÃO EXISTE ESCRITA EM `resource_grants` AQUI, e a ausência é a decisão. O braço de
 * grupo da resolução (`fn_user_group_ids`) exige `deleted_at IS NULL`, então a data
 * escrita nesta linha já corta o acesso no mesmo instante — "apagado" e "não concede
 * mais" são o MESMO fato, não dois fatos que precisam concordar. É a mesma leitura
 * que faz a expiração de concessão morar no predicado em vez de num sweeper.
 *
 * Revogar as concessões junto destruiria a resposta de auditoria "por que o grupo X
 * tinha acesso ao recurso Y", pela mesma razão que a revogação de concessão é soft.
 *
 * A TRILHA REGISTRA QUANTAS CONCESSÕES CAÍRAM, lidas ANTES da exclusão: depois dela
 * a contagem é irrecuperável sem reconstruir o estado do grupo, e essa contagem é o
 * alcance real do ato. Sem ela a linha diria "apagou um grupo" quando o que aconteceu
 * foi "tirou o acesso de N pessoas a M recursos".
 *
 * @param {{groupId: string, actor: object, req: object}} params
 * @returns {Promise<{id: string, name: string, grantsAffected: number, memberCount: number}>}
 */
export async function deleteGroup({ groupId, actor, req }) {
  const alcance = (await listGroups()).find((g) => String(g.id) === String(groupId));
  if (!alcance) throw new NotFoundError('Access group');

  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.SOFT_DELETE_GROUP, [groupId]);
    if (!row) throw new NotFoundError('Access group');
    await createAudit(req, {
      action: 'ACCESS_GROUP_DELETE',
      actorId: actor.id,
      targetType: ALVO,
      targetId: row.id,
      targetName: row.name,
      details: {
        grantsAffected: alcance.grant_count,
        memberCount: alcance.member_count,
      },
    }, trx);
    return {
      id: row.id,
      name: row.name,
      grantsAffected: alcance.grant_count,
      memberCount: alcance.member_count,
    };
  });
}

/**
 * Quem está no grupo.
 * @param {string} groupId
 * @returns {Promise<Array>}
 */
export async function listMembers(groupId) {
  await getGroup(groupId);
  const { rows } = await query(Q.LIST_MEMBERS, [groupId]);
  return rows;
}

/**
 * Põe alguém no grupo.
 *
 * IDEMPOTENTE POR DESENHO: repetir devolve o estado, não um 409. Pôr duas vezes é o
 * mesmo estado desejado, e um erro ali só ensinaria a tela a esconder o botão em vez
 * de a repetir a operação com segurança.
 *
 * A TRILHA SÓ SAI QUANDO O ESTADO MUDOU, e essa é a metade que a idempotência exige:
 * uma linha por clique repetido encheria a investigação de eventos que não são
 * eventos, e "desde quando o Fulano estava neste grupo" passaria a ter várias
 * respostas.
 *
 * @param {{groupId: string, userId: string, actor: object, req: object}} params
 * @returns {Promise<{groupId: string, userId: string, added: boolean}>}
 */
export async function addMember({ groupId, userId, actor, req }) {
  const grupo = await getGroup(groupId);
  const usuario = await oneOrNone(Q.GET_ACTIVE_USER, [userId]);
  if (!usuario) throw new NotFoundError('User');

  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.INSERT_MEMBER, [groupId, userId, actor.id]);
    if (row) {
      await createAudit(req, {
        // O ALVO É O GRUPO, nunca o usuário movido, e a escolha espelha a de
        // `PERMISSION_GRANT`: investiga-se pela coisa cujo acesso mudou, por
        // `idx_audit_target`. Quem entrou desce para `details` com o nome junto, para
        // que a linha continue legível sem um JOIN.
        action: 'ACCESS_GROUP_MEMBER_ADD',
        actorId: actor.id,
        targetType: ALVO,
        targetId: groupId,
        targetName: grupo.name,
        details: { userId, username: usuario.username, nome: usuario.nome },
      }, trx);
    }
    return { groupId, userId, added: row !== null };
  });
}

/**
 * Tira alguém do grupo.
 *
 * ZERO LINHA É 404 e não silêncio, ao contrário do irmão acima, e a assimetria é
 * deliberada: "pôr quem já está" chega ao estado pedido, e "tirar quem não está"
 * quase sempre significa que o chamador está apontando para o grupo errado ou para
 * uma pessoa que outra aba já removeu. O erro aqui é a informação.
 *
 * @param {{groupId: string, userId: string, actor: object, req: object}} params
 * @returns {Promise<{groupId: string, userId: string}>}
 */
export async function removeMember({ groupId, userId, actor, req }) {
  const grupo = await getGroup(groupId);
  // O usuário pode ter sido DESATIVADO depois de entrar no grupo, e nesse caso
  // `GET_ACTIVE_USER` não o acha. Tirá-lo do grupo continua sendo legítimo (a
  // linha de composição existe), então o nome para a trilha é opcional aqui.
  const usuario = await oneOrNone(Q.GET_ACTIVE_USER, [userId]);

  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.DELETE_MEMBER, [groupId, userId]);
    if (!row) throw new NotFoundError('Group member');
    await createAudit(req, {
      action: 'ACCESS_GROUP_MEMBER_REMOVE',
      actorId: actor.id,
      targetType: ALVO,
      targetId: groupId,
      targetName: grupo.name,
      details: { userId, username: usuario?.username ?? null },
    }, trx);
    return { groupId, userId };
  });
}
