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

/** O `audit_trail.target_type` de todo ato de grupo (declarado em `002_auditoria.sql`). */
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
 * O GRUPO TEM DOIS EIXOS DE ALCANCE desde D2 (2026-08-21), e só um deles é podado. As
 * concessões de RECURSO caem por escrita (`podarPorRaizes`); o acesso a ATLAS
 * (`atlas_shares.group_id`) cai por PREDICADO, no mesmo instante e sem linha alterada.
 * Contá-lo é a única forma de o ato aparecer inteiro na trilha e no aviso.
 *
 * @param {{groupId: string, actor: object, req: object}} params
 * @returns {Promise<{id: string, name: string, grantsAffected: number,
 *                    directGrants: number, atlasShares: number, memberCount: number}>}
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
        // O SEGUNDO EIXO DO GRUPO (D2, 2026-08-21). Ele não passa por `podarPorRaizes`
        // e não escreve linha nenhuma: apagar o grupo é SOFT, soft não dispara o
        // `ON DELETE CASCADE` de `atlas_shares.group_id`, e quem mata o share é
        // `fn_user_group_ids` no predicado. Sem este número a trilha registraria um ato
        // cujo maior efeito (N atlas fora do alcance de todo o coletivo) não aparece em
        // lugar nenhum, porque não há linha alterada para contar.
        atlasShares: alcance.atlas_share_count,
        memberCount: alcance.member_count,
        membros: roster.map((m) => ({ userId: m.id, username: m.username })),
      },
    }, trx);

    return {
      id: row.id,
      name: row.name,
      grantsAffected: revoked.length,
      directGrants: alcance.grant_count,
      atlasShares: alcance.atlas_share_count,
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
 * O QUE A ARESTA ALCANÇA: o repasse pendurado numa concessão PESSOAL não é nem raiz da
 * poda, porque `GRANT_IDS_FED_BY_MEMBER_VIA_GROUP` exige que o pai seja a concessão AO
 * GRUPO. O pendurado na do grupo é raiz — inclusive quando o membro tem, ao lado, uma
 * concessão pessoal viva sobre o mesmo recurso, porque o pai é escolhido no INSERT por
 * `LIVE_GRANTS_OF_ACTOR`, que prefere o `view_share` mais ANTIGO sem olhar se ele é
 * pessoal ou coletivo. Quem recebeu a do grupo primeiro fica com o pai coletivo.
 *
 * ESSE ÚLTIMO CASO ERA UMA DIVERGÊNCIA COM `deleteGroup`, E DEIXOU DE SER (2026-08-21,
 * decisão do dono: convergir para MANTER). Lá a concessão do membro é DESCENDENTE da
 * coletiva que caiu, então ela é RESGATADA quando o membro tem autoridade própria (o caso
 * "o repasse feito PELO grupo sobrevive REPAI-ADO" mede isso); aqui ela é a ÂNCORA, e
 * âncora não se resgatava. O mesmo fato — o membro deixou de alcançar o recurso PELO
 * grupo — dava desfechos opostos conforme o ato que o produzisse.
 *
 * A CONVERGÊNCIA É PELA CLÁUSULA 3.7 ("se B não caiu, o que B concedeu não cai"), e o
 * lugar dela é a CTE, não este arquivo: `podarPorRaizes` recebe `resgatarRaiz: true`, e é
 * o que diz "estas raízes não são revogação deliberada, são um CAMINHO que caiu". As duas
 * alternativas recusadas (passar a concessão coletiva como raiz, e decidir o resgate em JS
 * antes de podar) estão argumentadas na decisão (1) de `REVOKE_SUBTREE_PRESERVING_REACH`;
 * a primeira revogaria a coletiva para o grupo INTEIRO, a segunda deixaria o repasse vivo
 * ainda pendurado no grupo. Note o que NÃO mudou: quem não tem outra autoridade sobre
 * aquele recurso continua perdendo o repasse, e a decisão é POR RECURSO — o membro
 * resgatado num recurso cai normalmente nos outros.
 *
 * A ORDEM `DELETE_MEMBER` ANTES DE `podarPorRaizes` VIROU CONTRATO com o resgate, e antes
 * dele era só arrumação. O pai alternativo é procurado por
 * `p.grantee_group_id IN fn_user_group_ids(g.granted_by)`, e a concessão coletiva DESTE
 * grupo não está no `alcance` da poda (o alcance nasce no repasse, e o pai dele fica de
 * fora). Podar antes de apagar a linha de composição faria o resgate escolher como "outro
 * caminho" exatamente o caminho que o ato acabou de fechar: um repai para o pai que a
 * linha já tinha, isto é, a saída do membro sem efeito nenhum, com 200 na resposta. A
 * discriminação do membro SEM autoridade própria é o que prende essa ordem.
 *
 * @param {{groupId: string, userId: string, actor: object, req: object}} params
 * @returns {Promise<{groupId: string, userId: string, grantsAffected: number}>}
 */
export async function removeMember({ groupId, userId, actor, req }) {
  const grupo = await getGroup(groupId);
  return retirarMembro({ grupo, userId, actor, req, self: false });
}

/**
 * O CORPO COMPARTILHADO das duas saídas de um grupo: a por terceiro (`removeMember`) e a
 * VOLUNTÁRIA (`leaveGroup`).
 *
 * ELE EXISTE PARA QUE A PODA TENHA UMA DEFINIÇÃO SÓ. A parte difícil deste ato não é apagar a
 * linha de composição, é o que ela alimentava: as raízes, a ordem `DELETE_MEMBER` antes de
 * `podarPorRaizes`, e o `resgatarRaiz: true` que faz valer a cláusula 3.7. Uma segunda cópia disso
 * na rota nova divergiria da primeira no primeiro conserto que alguém fizesse em um dos lados, e o
 * sintoma seria acesso órfão — a classe que o JSDoc acima descreve por extenso.
 *
 * A ÚNICA DIFERENÇA ENTRE OS DOIS CHAMADORES É A TRILHA (`details.self`) e o ator; a origem da
 * poda continua `ACCESS_GROUP_MEMBER_REMOVE` porque o FATO podado é o mesmo (um caminho caiu), e
 * `origem` responde por que a poda aconteceu, não quem a pediu.
 *
 * @param {{grupo: Object, userId: string, actor: object, req: object, self: boolean}} params
 * @returns {Promise<{groupId: string, userId: string, removed: true, grantsAffected: number}>}
 * @throws {NotFoundError} `Group member` quando não há linha de composição (só no caminho por
 *   terceiro: a saída voluntária trata isso antes, como estado já alcançado).
 */
async function retirarMembro({ grupo, userId, actor, req, self }) {
  const groupId = grupo.id;
  // O usuário pode ter sido DESATIVADO depois de entrar no grupo, e nesse caso
  // `GET_ACTIVE_USER` não o acha. Tirá-lo do grupo continua sendo legítimo (a
  // linha de composição existe), então o nome para a trilha é opcional aqui.
  const usuario = await oneOrNone(Q.GET_ACTIVE_USER, [userId]);

  return tx(async (trx) => {
    const raizes = await trx.any(RA.GRANT_IDS_FED_BY_MEMBER_VIA_GROUP, [userId, groupId]);

    const row = await trx.oneOrNone(Q.DELETE_MEMBER, [groupId, userId]);
    if (!row) throw new NotFoundError('Group member');

    const { revoked, reparented, trimmed } = await podarPorRaizes({
      raizes, actor, req, trx, origem: 'ACCESS_GROUP_MEMBER_REMOVE', resgatarRaiz: true,
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
        // `self: true` SÓ NO CAMINHO VOLUNTÁRIO, e ausente no outro: é a mesma discriminação
        // das duas auto-edições de conta (`users.service.js`), e é ela que responde QUEM
        // DECIDIU quando `actor_id` e `details.userId` são a mesma pessoa por coincidência
        // (um dono que se tira do próprio grupo pela rota administrativa).
        ...(self ? { self: true } : {}),
      },
    }, trx);
    return { groupId, userId, removed: true, grantsAffected: revoked.length };
  });
}

/**
 * SAIR DE UM GRUPO POR CONTA PRÓPRIA (decisão do dono, 2026-08-23).
 *
 * POR QUE ELA NÃO É A ROTA DE CIMA COM OUTRO GATE. `requireGroupAuthority` responde 404 ao PRÓPRIO
 * membro — ele não administra o grupo —, então quem foi posto num coletivo por outra pessoa não
 * tinha como sair dele: a composição decide o acesso dele a recurso privado e a atlas, e ele
 * dependia de pedir a quem administra. A cláusula 4.5 já dizia que esse mecanismo não pode ser
 * invisível para quem está dentro; sair é a metade dela que faltava.
 *
 * O DONO NÃO SAI, e a recusa é 409. Aqui é pior que no atlas: `fn_can_administer_group` tem dois
 * ramos, posse VIVA e administrador do sistema, então um grupo cujo dono se retirasse ficaria sem
 * administrador salvo pelo segundo ramo — e o predicado de acesso derruba junto todo alcance dele
 * (`fn_user_group_ids` exige `fn_principal_vivo(owner)`). A recusa não prende ninguém: o dono que
 * por acaso também esteja na composição continua tirando a própria linha pela rota administrativa,
 * que ele já pode; o que ele não faz por esta porta é abandonar o coletivo. Apagar ou transferir é
 * outro ato, com outro nome.
 *
 * IDEMPOTENTE, E O SILÊNCIO É UNIFORME, exatamente como em `leaveAtlas`: não estar no grupo e o
 * grupo não existir respondem a mesma coisa (200, `removed: false`). O 404 uniforme deste módulo
 * existe para que o invisível seja indistinguível do inexistente, e uma rota que distinguisse os
 * dois aqui devolveria por outra porta o oráculo de inventário que ele nega.
 *
 * @param {{groupId: string, userId: string|null, actor: object, req: object}} params
 * @returns {Promise<{groupId: string, userId: string|null, removed: boolean,
 *                    grantsAffected: number}>}
 * @throws {ConflictError} Quando o chamador é o DONO do grupo.
 */
export async function leaveGroup({ groupId, userId, actor, req }) {
  const grupo = await oneOrNone(Q.GET_GROUP, [groupId]);
  if (grupo && userId && String(grupo.owner_id) === String(userId)) {
    throw new ConflictError(
      'O dono não pode sair do próprio grupo de acesso: um grupo sem dono deixa de entregar '
      + 'acesso e fica sem quem o administre. Apague o grupo, ou transfira a posse dele.'
    );
  }
  const naoParticipa = { groupId, userId, removed: false, grantsAffected: 0 };
  if (!grupo || !userId) return naoParticipa;

  try {
    return await retirarMembro({ grupo, userId, actor, req, self: true });
  } catch (err) {
    // A LEITURA E A ESCRITA SÃO SEPARADAS POR UMA JANELA, e neste caminho a ausência da linha é
    // desfecho normal em vez de erro. `retirarMembro` levanta porque o caminho por terceiro
    // PRECISA levantar (apontar para o grupo errado é a informação); aqui a mesma ausência
    // significa "já não participo", que é o estado pedido.
    if (err instanceof NotFoundError) return naoParticipa;
    throw err;
  }
}
