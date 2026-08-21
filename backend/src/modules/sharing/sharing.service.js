// Path: src/modules/sharing/sharing.service.js
// Every mutation here records an audit row IN THE SAME TRANSACTION as the change,
// matching users/organizations/zones. Before this, none of the five did: the actions
// 'SHARING_CHANGE', 'PERMISSION_GRANT' and 'PERMISSION_REVOKE' had been reserved in
// the audit_trail CHECK (002_auditoria.sql) from the first day and were emitted by nobody, so granting
// someone 'manage' or publishing an atlas left no trace, and an admin filtering on
// those actions got zero rows every time — a filter that could never match, which
// reads as "nothing happened" rather than "never wired".
import { query, tx } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import * as atlasService from '../atlas/atlas.service.js';
import { assertCanAdministerGroup } from '../access-groups/access-groups.service.js';
import { PERMISSION_LEVELS } from '../../middleware/permissions.js';
import * as Q from './sharing.queries.js';

export async function getSharingConfig(atlasId) {
  const { rows } = await query(Q.GET_SHARING_CONFIG, [atlasId]);
  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }
  return {
    isPublic: rows[0].is_public,
    publicLink: rows[0].public_link,
    owner: {
      userId: rows[0].owner_id,
      username: rows[0].owner_username,
      nome: rows[0].owner_nome,
    },
    shares: rows[0].shares,
    groups: rows[0].groups,
  };
}

/** Audit params shared by every sharing mutation (all target the ATLAS). */
const atlasAudit = (action, atlasId, actorId, details) => ({
  action, actorId, targetType: 'ATLAS', targetId: atlasId, details,
});

export async function enablePublicSharing(atlasId, actorId = null, req = null) {
  const result = await atlasService.enablePublicSharing(atlasId);
  await createAudit(req, atlasAudit('SHARING_CHANGE', atlasId, actorId, {
    isPublic: true, publicLink: result?.publicLink ?? result?.public_link ?? null,
  }));
  return result;
}

export async function disablePublicSharing(atlasId, actorId = null, req = null) {
  const result = await atlasService.disablePublicSharing(atlasId);
  await createAudit(req, atlasAudit('SHARING_CHANGE', atlasId, actorId, { isPublic: false }));
  return result;
}

export async function addUserShare(atlasId, userId, permission, addedBy, req = null) {
  // Verify user exists
  const userResult = await query(Q.FIND_USER_BY_ID, [userId]);
  if (userResult.rows.length === 0) {
    throw new NotFoundError('User');
  }

  return tx(async (t) => {
    const share = await t.one(Q.INSERT_USER_SHARE, [atlasId, userId, permission, addedBy]);
    await createAudit(req, atlasAudit('PERMISSION_GRANT', atlasId, addedBy, {
      userId, permission,
    }), t);
    return share;
  });
}

export async function updateUserShare(atlasId, userId, permission, actorId = null, req = null) {
  return tx(async (t) => {
    const share = await t.oneOrNone(Q.UPDATE_USER_SHARE, [atlasId, userId, permission]);
    if (!share) {
      throw new NotFoundError('Share');
    }
    await createAudit(req, atlasAudit('SHARING_CHANGE', atlasId, actorId, {
      userId, permission, previousPermission: share.previous_permission,
    }), t);
    return share;
  });
}

export async function removeUserShare(atlasId, userId, actorId = null, req = null) {
  return tx(async (t) => {
    const removed = await t.oneOrNone(Q.DELETE_USER_SHARE, [atlasId, userId]);
    if (!removed) {
      throw new NotFoundError('Share');
    }
    await createAudit(req, atlasAudit('PERMISSION_REVOKE', atlasId, actorId, { userId }), t);
    return true;
  });
}

// ---------------------------------------------------------------------------
// O EIXO DE GRUPO
// ---------------------------------------------------------------------------
//
// AS TRÊS AÇÕES DE TRILHA SÃO AS MESMAS DO EIXO DE PESSOA (`PERMISSION_GRANT`,
// `SHARING_CHANGE`, `PERMISSION_REVOKE`), e a reutilização é decisão, não preguiça: uma
// ação nova exigiria alargar o CHECK de `audit_trail`, o que em Postgres é DROP + ADD
// CONSTRAINT, uma entrada em `EXCECOES_DESTRUTIVAS` e uma migração a mais. O `details`
// já discrimina o eixo — `groupId` onde o eixo de pessoa põe `userId` — e é por ele que
// um filtro de trilha separa os dois.
//
// SÓ SE COMPARTILHA COM GRUPO PRÓPRIO (decisão do dono, 2026-08-20), e a checagem é
// `assertCanAdministerGroup`, o MESMO predicado que gateia as rotas do módulo de grupos.
// Ela responde 404, nunca 403, porque a listagem de grupos é recortada por posse: um 403
// sobre grupo alheio contaria que aquele id existe, e recusa que informa é oráculo de
// inventário.
//
// A CHECAGEM É NO ATO, e não contínua. Perder a posse do grupo depois NÃO revoga o share
// existente, exatamente como `grantResource` só exige `view_share` no instante da
// concessão. É semântica declarada, não esquecimento.
//
// `remove` NÃO chama o predicado de posse, e a assimetria tem precedente nesta casa
// (`requireGrantRevoker` separa quem concede de quem revoga): tirar acesso nunca pode ser
// mais difícil que dar. Quem tem `manage` no atlas desfaz o que qualquer grupo ganhou nele.
//
// E É POR ESSA MESMA FRASE QUE O `PUT` SÓ EXIGE POSSE QUANDO SOBE O NÍVEL. Enquanto ele a
// exigia sempre, a regra escrita acima estava aplicada ao contrário: o gestor do atlas
// podia APAGAR o vínculo do grupo (tirar tudo) e não podia REBAIXÁ-LO de `manage` para
// `read` (tirar um pouco), de modo que a única ferramenta que lhe sobrava era a mais
// destrutiva. Conceder é que exige posse — e rebaixar não é conceder.

/** A escada, para separar "conceder" de "tirar". Nível desconhecido vale 0: falha fechada. */
const rank = (nivel) => PERMISSION_LEVELS[nivel] ?? 0;

/** O grupo VIVO, ou 404. Não gateia autoridade — quem gateia é o `assert` acima. */
async function findLiveGroup(groupId, t = null) {
  const row = t
    ? await t.oneOrNone(Q.FIND_LIVE_GROUP_BY_ID, [groupId])
    : (await query(Q.FIND_LIVE_GROUP_BY_ID, [groupId])).rows[0] ?? null;
  if (!row) {
    throw new NotFoundError('Access group');
  }
  return row;
}

/**
 * Compartilha o atlas com um grupo PRÓPRIO do ator.
 * @param {string} atlasId
 * @param {string} groupId
 * @param {'read'|'comment'|'write'|'manage'} permission
 * @param {string} addedBy - o ator (é a posse DELE que é conferida)
 * @param {object} [req]
 * @returns {Promise<Object>} a linha de `atlas_shares`, com `group_name` para o toast.
 * @throws {NotFoundError} quando o grupo não existe, está apagado, ou não é do ator.
 */
export async function addGroupShare(atlasId, groupId, permission, addedBy, req = null) {
  await assertCanAdministerGroup({ actorId: addedBy, groupId });
  const group = await findLiveGroup(groupId);

  return tx(async (t) => {
    const share = await t.one(Q.INSERT_GROUP_SHARE, [atlasId, groupId, permission, addedBy]);
    await createAudit(req, atlasAudit('PERMISSION_GRANT', atlasId, addedBy, {
      groupId, groupName: group.name, permission,
    }), t);
    return { ...share, group_name: group.name };
  });
}

/**
 * Troca o nível de um grupo já compartilhado.
 *
 * A ORDEM DENTRO DA TRANSAÇÃO É O DESENHO, e cada passo responde a uma pergunta diferente:
 *
 * 1. o `UPDATE` primeiro, porque é ele que devolve o nível ANTERIOR (o auto-join de
 *    `UPDATE_GROUP_SHARE`), e sem o anterior não há como distinguir conceder de tirar sem
 *    escrever um segundo `SELECT permission FROM atlas_shares` — a forma que o censo
 *    (`tests/unit/atlas-shares-eixo-de-grupo-censo.test.js`) proíbe;
 * 2. só então a autoridade, e SÓ QUANDO SOBE. `NotFoundError` lançado aqui dentro desfaz o
 *    `UPDATE` junto, então a recusa não deixa rastro: sem transação, gatear depois de
 *    escrever seria gatear coisa nenhuma;
 * 3. o grupo VIVO por último, para o nome da trilha.
 *
 * O 404 de "não existe share deste grupo neste atlas" vem ANTES de qualquer pergunta sobre
 * o grupo em si, e isso não é ordem por acaso: quem chega aqui tem `manage` no atlas e já
 * enxerga, em `GET /sharing`, todos os grupos que o alcançam. Perguntar primeiro pelo GRUPO
 * deixaria um gestor distinguir "esse uuid não é grupo nenhum" de "é grupo, mas não está
 * neste atlas" — um oráculo de inventário sobre coletivos alheios, que é exatamente o que o
 * 404 uniforme do módulo de grupos existe para negar.
 *
 * @returns {Promise<Object>} a linha atualizada, com `previous_permission`.
 * @throws {NotFoundError} `Share` quando o grupo não está neste atlas; `Access group`
 *   quando o grupo morreu, ou quando o ator tenta SUBIR o nível de grupo que não administra.
 */
export async function updateGroupShare(atlasId, groupId, permission, actorId = null, req = null) {
  return tx(async (t) => {
    const share = await t.oneOrNone(Q.UPDATE_GROUP_SHARE, [atlasId, groupId, permission]);
    if (!share) {
      throw new NotFoundError('Share');
    }
    if (rank(permission) > rank(share.previous_permission)) {
      await assertCanAdministerGroup({ actorId, groupId, t });
    }
    const group = await findLiveGroup(groupId, t);
    await createAudit(req, atlasAudit('SHARING_CHANGE', atlasId, actorId, {
      groupId, groupName: group.name, permission, previousPermission: share.previous_permission,
    }), t);
    return { ...share, group_name: group.name };
  });
}

/**
 * Tira o grupo do atlas. Sem predicado de posse, de propósito (ver o bloco acima).
 *
 * A TRILHA NOMEIA O GRUPO, e por `FIND_GROUP_NAME_ANY` (que ignora `deleted_at`): as duas
 * outras ações do eixo já gravavam `groupName`, e só esta gravava o UUID sozinho —
 * justamente a que se lê quando alguém pergunta, meses depois, o que foi tirado de lá.
 * `null` é desfecho legítimo (grupo expurgado FISICAMENTE, o que o `ON DELETE CASCADE`
 * permite), e é por isso que a leitura é `oneOrNone` e não `one`: ela não pode transformar
 * uma revogação válida em 500.
 * @returns {Promise<true>}
 */
export async function removeGroupShare(atlasId, groupId, actorId = null, req = null) {
  return tx(async (t) => {
    const removed = await t.oneOrNone(Q.DELETE_GROUP_SHARE, [atlasId, groupId]);
    if (!removed) {
      throw new NotFoundError('Share');
    }
    const group = await t.oneOrNone(Q.FIND_GROUP_NAME_ANY, [groupId]);
    await createAudit(req, atlasAudit('PERMISSION_REVOKE', atlasId, actorId, {
      groupId, groupName: group?.name ?? null,
    }), t);
    return true;
  });
}

/** Os ids de quem está no grupo. Serve ao fan-out, não à tela. */
export async function groupMemberIds(groupId) {
  const { rows } = await query(Q.LIST_GROUP_MEMBER_IDS, [groupId]);
  return rows.map((r) => r.user_id);
}

/**
 * A permissão EFETIVA de cada uma destas pessoas neste atlas.
 *
 * É o que impede a frame de compartilhamento de MENTIR: `sync-engine.js` aplica
 * `msg.role` cru, então anunciar o nível do GRUPO rebaixaria quem tem share direto maior
 * — uma queda que o servidor nunca fez, que some no F5 e que ninguém consegue reproduzir.
 * O nível efetivo vem da mesma função dos dois gates.
 * @param {string} atlasId
 * @param {string[]} userIds
 * @returns {Promise<Map<string, string|null>>} userId → nível efetivo (null = nenhum).
 */
export async function effectiveRolesFor(atlasId, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return new Map();
  const { rows } = await query(Q.EFFECTIVE_PERMISSIONS, [atlasId, userIds]);
  return new Map(rows.map((r) => [String(r.user_id), r.permission ?? null]));
}
