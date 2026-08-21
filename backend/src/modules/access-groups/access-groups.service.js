// Path: src/modules/access-groups/access-groups.service.js
// O GRUPO DE ACESSO: coisa de USUÁRIO, com dono.
//
// POR QUE ESTE MÓDULO EXISTE. As duas tabelas, o `resource_grants.grantee_group_id` e
// o braço de grupo de `fn_granted_resource_ids` nasceram com a
// 008_acesso_a_recurso.sql, e até 2026-08-19 NENHUMA linha de JavaScript os tocava:
// o predicado tinha um ramo que nunca devolveu linha em produção, porque não havia
// como pôr alguém num grupo.
//
// A AUTORIDADE É POSSE, e é decisão do dono tomada em 2026-08-20, que SUPERA a de
// 2026-08-19 (naquela, administrava grupo quem tinha papel global de DADO, isto é
// administrador ou credenciado, por `requireGlobalDataAccess`). Qualquer sessão
// autenticada cria um grupo; quem cria é o DONO; e quem administra é o dono vivo ou o
// administrador do sistema, por `fn_can_administer_group`. O credenciado volta a ser
// papel de leitura: ele mantém o eixo de RECURSO inteiro (lê todo privado, concede e
// revoga o que deu) e perde a autoridade sobre grupo alheio, que nunca foi sobre dado.
//
// O 404 É UNIFORME e não é elegância: com a listagem recortada por posse, um 403 sobre
// grupo alheio contaria que aquele id existe. Invisível tem de ser indistinguível de
// inexistente.
//
// ADMINISTRAR O GRUPO E PARTICIPAR DELE SÃO PERGUNTAS DIFERENTES, e a segunda ganhou
// resposta própria (`listGroupsOfMember`): quem foi posto num grupo vê QUE participa e
// DE QUEM é o grupo, sem o roster. Um mecanismo que decide o acesso da pessoa a
// recurso privado não pode ser invisível para ela.

import { query, oneOrNone, one, tx } from '../../database/index.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import { podarPorRaizes } from '../resource-access/resource-access.service.js';
import * as RA from '../resource-access/resource-access.queries.js';
import * as Q from './access-groups.queries.js';

/** O `audit_trail.target_type` de todo ato de grupo (migração 009_grupos_de_acesso.sql). */
const ALVO = 'ACCESS_GROUP';

/**
 * "Este ator manda neste grupo?" — e, quando não manda, 404.
 *
 * O INVÓLUCRO JS DE `fn_can_administer_group`, e o único: o gate das rotas
 * (`requireGroupAuthority`) chama esta função, e o beneficiário-coletivo de uma
 * concessão chama a MESMA função SQL de dentro do `WHERE`
 * (`GET_ADDRESSABLE_LIVE_GROUP`). Um nome, uma definição.
 *
 * O `t` OPCIONAL É A REGRA DA CASA, não conveniência: quem chama de dentro de uma
 * transação precisa passar o executor dela, senão a pergunta sai por uma SEGUNDA conexão
 * do pool enquanto a primeira segura a transação aberta. `sharing.service.updateGroupShare`
 * é o primeiro chamador nessa posição (ele decide a autoridade depois de conhecer o nível
 * anterior, que só o `UPDATE` devolve).
 *
 * @param {{actorId: string|null, groupId: string, t?: Object|null}} params
 * @returns {Promise<true>}
 * @throws {NotFoundError} Quando o grupo não existe, está apagado, ou não é dele.
 */
export async function assertCanAdministerGroup({ actorId, groupId, t = null }) {
  const row = t
    ? await t.one(Q.CAN_ADMINISTER_GROUP, [actorId ?? null, groupId])
    : await one(Q.CAN_ADMINISTER_GROUP, [actorId ?? null, groupId]);
  if (row.ok !== true) throw new NotFoundError('Access group');
  return true;
}

/**
 * Os grupos que este chamador administra (todos, para o administrador).
 * @param {string|null} actorId
 * @returns {Promise<Array>}
 */
export async function listGroups(actorId) {
  const { rows } = await query(Q.LIST_GROUPS, [actorId ?? null]);
  return rows;
}

/**
 * Os grupos de que esta pessoa PARTICIPA: nome e DONO, e nada mais. Sem roster, sem
 * contagens e sem descrição (ver o JSDoc de `LIST_GROUPS_OF_MEMBER`).
 * @param {string|null} actorId
 * @returns {Promise<Array>}
 */
export async function listGroupsOfMember(actorId) {
  const { rows } = await query(Q.LIST_GROUPS_OF_MEMBER, [actorId ?? null]);
  return rows;
}

/**
 * Um grupo vivo, ou 404. NÃO gateia autoridade: quem gateia é `requireGroupAuthority`,
 * antes da rota chegar aqui.
 * @param {string} groupId
 * @returns {Promise<Object>}
 */
export async function getGroup(groupId) {
  const row = await oneOrNone(Q.GET_GROUP, [groupId]);
  if (!row) throw new NotFoundError('Access group');
  return row;
}

/**
 * Cria um grupo. Quem cria é o DONO.
 *
 * O 409 vem de ZERO LINHA no `ON CONFLICT DO NOTHING`, não de um SELECT prévio: ler
 * antes de escrever deixa uma janela em que duas criações do mesmo nome passam as
 * duas pela leitura, e a segunda só morre no índice, como 23505 genérico. A colisão é
 * POR DONO, então o 409 nunca fala de um grupo que o chamador não pode ver.
 *
 * `details.ownerId` na trilha é o que responde "de quem era este grupo" depois de uma
 * desativação do dono — ou de uma transferência, se ela existir um dia.
 *
 * @param {{name: string, description?: string|null, actor: object, req: object}} params
 * @returns {Promise<Object>}
 */
export async function createGroup({ name, description = null, actor, req }) {
  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.INSERT_GROUP, [name, description || null, actor.id]);
    if (!row) throw new ConflictError('Você já tem um grupo de acesso com este nome.');
    await createAudit(req, {
      action: 'ACCESS_GROUP_CREATE',
      actorId: actor.id,
      targetType: ALVO,
      targetId: row.id,
      targetName: row.name,
      details: { name: row.name, ownerId: row.owner_id },
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
 * Apaga o grupo (SOFT), PODA o que ele concedia e esvazia a composição.
 *
 * A EXCLUSÃO PASSOU A ESCREVER EM `resource_grants` (2026-08-20), e o parágrafo que
 * este substitui afirmava o contrário por extenso. O argumento antigo estava certo
 * pela metade: `fn_user_group_ids` exige `deleted_at IS NULL`, então marcar a data já
 * corta o acesso DOS MEMBROS no mesmo instante. O que ele não via é o que os membros
 * REPASSARAM a partir daquela concessão: essas linhas apontam para terceiros que nunca
 * estiveram no grupo, o predicado não as alcança, e elas sobreviviam penduradas numa
 * concessão viva cuja justificativa já não existia — acesso órfão que nenhuma tela
 * mostra como órfão.
 *
 * AS CONCESSÕES SÃO REVOGADAS (soft), NÃO APAGADAS, e o GRUPO continua na tabela: as
 * duas linhas juntas são a resposta de auditoria "por que o grupo X tinha acesso ao
 * recurso Y". O que some de verdade é o ROSTER, porque `access_group_members` não tem
 * soft-delete — e é por isso que ele é copiado para os detalhes ANTES do COMMIT: é a
 * única cópia que resta de "quem estava dentro quando ele morreu".
 *
 * O ROSTER DA TRILHA VEM DO `RETURNING` DO PRÓPRIO ESVAZIAMENTO, e não de uma leitura
 * anterior. Enquanto vinha de `LIST_MEMBERS`, ele perdia o membro DESATIVADO (aquela
 * consulta junta `users` com `is_active = true`, de propósito, porque alimenta a tela),
 * e a mesma linha de auditoria saía com `memberCount: 2` ao lado de `membros: [um]` —
 * a contagem vinha do alcance, que conta todas as linhas de composição. Quem foi
 * desativado depois de entrar no grupo tinha a linha apagada sem ficar registrado.
 *
 * A ORDEM DENTRO DA TRANSAÇÃO É CONTRATO: ler alcance → podar → esvaziar (e é o
 * esvaziamento que produz o roster) → apagar. Ler o alcance depois de podar daria
 * contagem zero.
 *
 * @param {{groupId: string, actor: object, req: object}} params
 * @returns {Promise<{id: string, name: string, grantsAffected: number, memberCount: number}>}
 */
export async function deleteGroup({ groupId, actor, req }) {
  return tx(async (trx) => {
    const alcance = await trx.oneOrNone(Q.GET_GROUP_REACH, [groupId]);
    if (!alcance) throw new NotFoundError('Access group');
    const raizes = await trx.any(RA.LIVE_GRANT_IDS_TO_GROUP, [groupId]);

    const { revoked, reparented, trimmed } = await podarPorRaizes({
      raizes, actor, req, trx, origem: 'ACCESS_GROUP_DELETE',
    });

    const roster = await trx.any(Q.DELETE_ALL_MEMBERS, [groupId]);

    const row = await trx.oneOrNone(Q.SOFT_DELETE_GROUP, [groupId]);
    if (!row) throw new NotFoundError('Access group');

    await createAudit(req, {
      action: 'ACCESS_GROUP_DELETE',
      actorId: actor.id,
      targetType: ALVO,
      targetId: row.id,
      targetName: row.name,
      details: {
        // `grantsAffected` conta a PODA INTEIRA (raízes mais descendentes), que é o
        // alcance real do ato; `directGrants` é o que a listagem sabia mostrar antes
        // do clique. Os dois, porque um número que muda de significado entre a tela e
        // a trilha é pior que dois números.
        grantsAffected: revoked.length,
        // O QUE NAO CAIU TAMBEM E FATO DO ATO, desde a preservacao de alcancabilidade
        // (D3). Apagar o grupo deixou de derrubar tudo o que ele alimentava: o repasse
        // feito PELO grupo por quem tambem tem `view_share` pessoal vivo sobre o mesmo
        // recurso sobrevive REPAI-ADO na concessao pessoal. Sem este numero ao lado do
        // outro, `grantsAffected` menor que `directGrants` parece poda incompleta.
        grantsReparented: reparented.length + trimmed.length,
        directGrants: alcance.grant_count,
        memberCount: alcance.member_count,
        membros: roster.map((m) => ({ userId: m.id, username: m.username })),
      },
    }, trx);

    return {
      id: row.id,
      name: row.name,
      grantsAffected: revoked.length,
      directGrants: alcance.grant_count,
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
 * Tira alguém do grupo e PODA o que ele alimentou ATRAVÉS dele.
 *
 * ZERO LINHA É 404 e não silêncio, ao contrário do irmão acima, e a assimetria é
 * deliberada: "pôr quem já está" chega ao estado pedido, e "tirar quem não está"
 * quase sempre significa que o chamador está apontando para o grupo errado ou para
 * uma pessoa que outra aba já removeu. O erro aqui é a informação.
 *
 * A PODA SEGUE A ARESTA `parent_grant_id`, e não "tudo o que ele concedeu": o acesso
 * do próprio membro morre pelo predicado no instante do DELETE, mas quem ele repassou
 * continuava pendurado numa concessão AO GRUPO que segue viva.
 *
 * O QUE A ARESTA ALCANÇA E O QUE ELA ERRA, dito com precisão porque a onda 3 vai
 * herdar esta linha como piso: o repasse pendurado numa concessão PESSOAL não cai, e
 * está certo; o pendurado na do GRUPO cai mesmo quando o membro tinha, ao lado, uma
 * concessão pessoal viva sobre o mesmo recurso que justificaria o ato. O pai é
 * escolhido no INSERT por `LIVE_GRANTS_OF_ACTOR`, que prefere o `view_share` mais
 * ANTIGO sem olhar se ele é pessoal ou coletivo — quem recebeu a do grupo primeiro fica
 * com o pai coletivo. A direção do erro é poda A MAIS, nunca acesso a mais.
 *
 * D3 CHEGOU E ESTE CAMINHO CONTINUA NÃO PRESERVANDO, ao contrário do que este parágrafo
 * prometia ("até lá, não leia esta função como se já preservasse" — a espera acabou e a
 * resposta foi não). O motivo é estrutural e vale entender antes de "consertar": aqui as
 * raízes são `GRANT_IDS_FED_BY_MEMBER_VIA_GROUP`, isto é, as PRÓPRIAS concessões do
 * membro, e elas são a ÂNCORA da poda. A decisão (1) de
 * `REVOKE_SUBTREE_PRESERVING_REACH` garante que a âncora nunca é resgatada, senão
 * revogar quem tem outro caminho vivo seria um no-op com 200 na resposta.
 *
 * O DESFECHO DIVERGE DO DE `deleteGroup`, PARA O MESMO FATO, e a divergência é conhecida:
 * lá a concessão do membro é DESCENDENTE da coletiva que caiu, então ela é resgatada (o
 * caso "o repasse feito PELO grupo sobrevive REPAI-ADO" mede exatamente isso). Ou seja, o
 * membro com dupla autoridade MANTÉM o repasse se o grupo for apagado e PERDE se ele for
 * retirado do grupo. Convergir é decisão de produto, não arrumação: a implementação seria
 * podar a partir da concessão COLETIVA restrita ao membro, e não a partir dos repasses
 * dele. Não a faça por conta própria.
 *
 * @param {{groupId: string, userId: string, actor: object, req: object}} params
 * @returns {Promise<{groupId: string, userId: string, grantsAffected: number}>}
 */
export async function removeMember({ groupId, userId, actor, req }) {
  const grupo = await getGroup(groupId);
  // O usuário pode ter sido DESATIVADO depois de entrar no grupo, e nesse caso
  // `GET_ACTIVE_USER` não o acha. Tirá-lo do grupo continua sendo legítimo (a
  // linha de composição existe), então o nome para a trilha é opcional aqui.
  const usuario = await oneOrNone(Q.GET_ACTIVE_USER, [userId]);

  return tx(async (trx) => {
    const raizes = await trx.any(RA.GRANT_IDS_FED_BY_MEMBER_VIA_GROUP, [userId, groupId]);

    const row = await trx.oneOrNone(Q.DELETE_MEMBER, [groupId, userId]);
    if (!row) throw new NotFoundError('Group member');

    const { revoked, reparented, trimmed } = await podarPorRaizes({
      raizes, actor, req, trx, origem: 'ACCESS_GROUP_MEMBER_REMOVE',
    });

    await createAudit(req, {
      action: 'ACCESS_GROUP_MEMBER_REMOVE',
      actorId: actor.id,
      targetType: ALVO,
      targetId: groupId,
      targetName: grupo.name,
      details: {
        userId,
        username: usuario?.username ?? null,
        grantsAffected: revoked.length,
        // Ver a nota gemea em `deleteGroup`: o repasse que sobreviveu repai-ado e o que
        // explica um `grantsAffected` menor que o alcance que a tela mostrou.
        grantsReparented: reparented.length + trimmed.length,
      },
    }, trx);
    return { groupId, userId, grantsAffected: revoked.length };
  });
}
