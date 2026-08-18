// Path: src/modules/users/users.service.js
import bcrypt from 'bcrypt';
import { query, tx } from '../../database/index.js';
import {
  NotFoundError, UnauthorizedError, ConflictError, ForbiddenError, BadRequestError,
} from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import * as Q from './users.queries.js';

const SALT_ROUNDS = 12;

/**
 * Normaliza um campo opcional de uuid: `''` e `undefined` viram null.
 * @param {*} v
 * @returns {string|null}
 */
function uuidOuNulo(v) {
  return v === '' || v === undefined ? null : (v ?? null);
}

/**
 * Cobra o BICONDICIONAL do escopo de producao sobre o estado EFETIVO da conta, e
 * devolve o par (papel, escopo) que deve ir para o banco.
 *
 * POR QUE AQUI E NAO SO NO CHECK. `users_producer_scope_check` e a guarda que vale,
 * e ela nao pode sair; mas quando ela dispara o driver levanta 23514, que o
 * `errorHandler` traduz num 400 generico ("Value violates a constraint") de
 * proposito, porque o texto do driver expoe nome de coluna e de constraint. O
 * administrador que tentasse promover alguem a Produtor sem OM leria um erro que nao
 * diz o que corrigir. Esta funcao devolve a mesma recusa com a frase certa.
 *
 * POR QUE O REBAIXAMENTO LIMPA EM VEZ DE RECUSAR. Trocar o papel para qualquer outro
 * significa "esta pessoa nao produz mais"; exigir que quem edita tambem se lembre de
 * mandar `producer_org_id: null` transformaria a operacao mais comum (rebaixar) num
 * 400. O caminho inverso NAO tem simetria: promover a Produtor exige a OM, porque
 * nao ha valor que o servidor possa adivinhar sem escolher a OM de alguem.
 *
 * @param {{role?: string, producer_org_id?: string|null}} data - O corpo (parcial).
 * @param {{role: string, producer_org_id?: string|null}} existing - A linha atual.
 * @returns {{role: string|null, producerOrgId: string|null, producerProvided: boolean}}
 */
function resolveProducerScope(data, existing) {
  const papel = data.role || null;
  const papelEfetivo = papel ?? existing.role;
  const pediuEscopo = data.producer_org_id !== undefined;
  const escopoPedido = uuidOuNulo(data.producer_org_id);
  const escopoEfetivo = pediuEscopo ? escopoPedido : (existing.producer_org_id ?? null);

  if (papelEfetivo === 'producer') {
    if (!escopoEfetivo) {
      throw new BadRequestError('O papel Produtor exige uma OM de produção.');
    }
    return { role: papel, producerOrgId: escopoEfetivo, producerProvided: pediuEscopo };
  }

  if (escopoEfetivo && pediuEscopo) {
    throw new BadRequestError('A OM de produção só se define para o papel Produtor.');
  }
  // Rebaixou (ou ja nao era produtor): o escopo cai junto, sempre.
  return { role: papel, producerOrgId: null, producerProvided: true };
}

/**
 * Gets user profile by ID.
 */
export async function getProfile(userId) {
  const { rows } = await query(Q.FIND_USER_BY_ID, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Updates user profile.
 */
export async function updateProfile(userId, data) {
  // For nullable fields, pass [value, provided?]: an explicit null/'' clears the
  // column (value normalized to null), an omitted field leaves it unchanged.
  const { rows } = await query(Q.UPDATE_USER_PROFILE, [
    userId,
    data.nome || null,
    data.rank_id === '' ? null : (data.rank_id ?? null),
    data.rank_id !== undefined,
    data.organization_id === '' ? null : (data.organization_id ?? null),
    data.organization_id !== undefined,
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Changes user password.
 *
 * Since 2026-07-25 (bugs-backend #35) `REVOKE_ALL_USER_TOKENS` also stamps the session
 * cut-off `users.sessions_valid_from`, so this ends EVERY session of the user — the
 * caller's included, not just "elsewhere" as the old comment below promised. That is
 * the point: a password change made because the account may be compromised has to
 * reach the compromised session, and the compromised session is the one holding a live
 * access token, not a refresh token.
 *
 * The route does NOT hand back a new pair, so the caller's own access token dies with
 * the rest and the client re-authenticates. This is deliberate rather than an
 * oversight: issuing a replacement here would mean minting a token in the same second
 * as the cut-off, i.e. exactly the ambiguity `tokenPredatesSessionCut` had to resolve
 * (utils/org-status.js). This app's UI does not call the route at all — no
 * `/users/me/password` call site exists in frontend/src — so nothing regresses.
 */
export async function updatePassword(userId, currentPassword, newPassword) {
  // Get current password hash
  const { rows } = await query(Q.FIND_USER_WITH_PASSWORD, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  // Verify current password
  const isValid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!isValid) {
    throw new UnauthorizedError('A senha atual está incorreta.');
  }

  // Hash new password
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Update password, revoke the refresh family and cut every session (one statement).
  await query(Q.UPDATE_USER_PASSWORD, [userId, newHash]);
  await query(Q.REVOKE_ALL_USER_TOKENS, [userId]);

  return { success: true };
}

/**
 * Searches users by name or username.
 */
/**
 * Escapes the LIKE wildcards so the search is LITERAL.
 *
 * Not SQL injection — the value travels as $1 — but PATTERN injection: a `%` or `_`
 * typed by the user acquired wildcard meaning. It broke ordinary searches (usernames
 * here routinely contain `_`, e.g. the `share_owner` fixtures) and turned `q = '%%'`
 * into a full-table scan bounded only by LIMIT 20. Backslash is escaped first, or it
 * would double-escape the escapes that follow.
 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchUsers(searchQuery) {
  const pattern = `%${escapeLike(searchQuery)}%`;
  const { rows } = await query(Q.SEARCH_USERS, [pattern]);
  return rows;
}

// ============================================
// Admin functions
// ============================================

/**
 * Lists all users (admin only).
 */
export async function listUsers(includeInactive = false) {
  const queryStr = includeInactive ? Q.LIST_ALL_USERS : Q.LIST_ACTIVE_USERS;
  const { rows } = await query(queryStr);
  return rows;
}

/**
 * Gets a user by ID (admin view - includes inactive users).
 */
export async function getUserById(userId) {
  const { rows } = await query(Q.FIND_USER_BY_ID_ADMIN, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Creates a new user (admin only).
 */
export async function createUser(data, req = null, actorId = null) {
  // Check if username already exists
  const { rows: existing } = await query(Q.CHECK_USERNAME_EXISTS, [data.username]);
  if (existing.length > 0) {
    throw new ConflictError('Nome de usuário já existe.');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  // A auditoria participa da MESMA transação da escrita: ou a conta existe e há
  // linha de trilha, ou nenhuma das duas coisas. `USER_CREATE` está reservado no
  // CHECK de `audit_trail.action` desde a migração 001 e não tinha emissor
  // nenhum — filtro que por construção nunca casa se lê como "nada aconteceu",
  // não como "nunca foi ligado", que é a forma mais silenciosa de lacuna.
  return tx(async (t) => {
    const criado = await t.one(Q.INSERT_USER_ADMIN, [
      data.username,
      passwordHash,
      data.nome,
      data.rank_id || null,
      data.organization_id || null,
      data.role || 'user',
      data.org_role || null, // SQL COALESCEs to 'viewer'
      // O bicondicional ja foi cobrado pelo Joi da criacao (onde o corpo e completo
      // e o `when` alcanca os dois lados); aqui basta normalizar '' para null.
      uuidOuNulo(data.producer_org_id),
    ]);

    if (actorId) {
      await createAudit(req, {
        action: 'USER_CREATE', actorId, targetType: 'USER',
        targetId: criado.id, targetName: criado.nome,
        // O papel criado é o dado que interessa numa revisão: uma conta nascida
        // 'admin' é o evento que se quer achar depois.
        details: {
          role: criado.role, org_role: criado.org_role,
          organization_id: criado.organization_id,
          producer_org_id: criado.producer_org_id,
        },
      }, t);
    }

    return criado;
  });
}

/**
 * Updates a user (admin only).
 */
export async function updateUser(userId, data, actingUserId = null, req = null) {
  // Check if user exists
  const existing = await getUserById(userId);

  // Self-guard (defense-in-depth alongside the UI): an admin cannot deactivate or demote their OWN
  // account — that is a last-admin lockout the disabled "Desativar" button is meant to prevent.
  if (actingUserId && userId === actingUserId) {
    if (data.is_active === false) {
      throw new ConflictError('Você não pode desativar a própria conta.');
    }
    if (data.role && data.role !== 'admin' && existing.role === 'admin') {
      throw new ConflictError('Você não pode remover seu próprio papel de admin.');
    }
  }

  // Desativar por PUT era uma porta dos fundos. `deleteUser` (a rota de
  // desativação) roda três coisas que este caminho não roda: conta os atlas do
  // usuário e EXIGE um destinatário antes de soltar a posse, audita, e revoga os
  // refresh tokens. O PUT escrevia `is_active` direto no UPDATE, então desmarcar
  // o checkbox "Ativo" do formulário de edição (`frontend/src/js/admin/users-tab.js:357`)
  // desativava a conta deixando os atlas dela órfãos — donos inativos são
  // recusados no middleware `auth`, e só um admin global consegue mexer neles
  // depois. É exatamente o estado que o ConflictError de `deleteUser` existe para
  // impedir, alcançado pela porta ao lado.
  //
  // Recusar é a correção certa e não "faltou implementar a guarda aqui": o PUT não
  // tem como receber o destinatário da transferência, então não existe forma de
  // ele completar a operação com segurança. Reativar (`is_active: true`) segue
  // livre, e reenviar `false` para quem JÁ está inativo não é transição e passa —
  // senão editar o nome de um usuário inativo quebraria.
  if (data.is_active === false && existing.is_active) {
    throw new ConflictError(
      'Desative pela ação de desativação, não pela edição: ela exige um destinatário para os atlas do usuário e revoga as sessões dele.'
    );
  }

  // If changing username, check it's not taken
  if (data.username && data.username.toLowerCase() !== existing.username.toLowerCase()) {
    const { rows: usernameCheck } = await query(Q.CHECK_USERNAME_EXISTS_EXCLUDING, [data.username, userId]);
    if (usernameCheck.length > 0) {
      throw new ConflictError('Nome de usuário já existe.');
    }
  }

  // O par (papel, escopo) e resolvido ANTES do UPDATE, sobre o estado efetivo: o
  // corpo e parcial, e so a mistura dele com a linha existente diz se a conta vai
  // terminar com cracha sem escopo ou escopo sem cracha.
  const escopo = resolveProducerScope(data, existing);

  return tx(async (t) => {
    const rows = await t.any(Q.UPDATE_USER_ADMIN, [
      userId,
      data.username || null,
      data.nome || null,
      data.rank_id === '' ? null : (data.rank_id ?? null),
      data.rank_id !== undefined,
      data.organization_id === '' ? null : (data.organization_id ?? null),
      data.organization_id !== undefined,
      escopo.role,
      data.is_active !== undefined ? data.is_active : null,
      data.email_verified !== undefined ? data.email_verified : null,
      data.org_role || null,
      escopo.producerOrgId,
      escopo.producerProvided,
    ]);

    if (rows.length === 0) {
      throw new NotFoundError('User');
    }
    const atualizado = rows[0];

    if (actingUserId) {
      // ROLE_CHANGE é emitido À PARTE de USER_UPDATE, e não como um detalhe dele:
      // promoção a admin é o evento que uma revisão procura primeiro, e procurar
      // por ação é o que o índice `idx_audit_action` serve. Os dois valores vão
      // no detalhe — mudança de nível só é auditável se disser DE ONDE veio, que
      // é a mesma lição do `previous_permission` da auditoria de sharing.
      const mudouPapel = data.role && data.role !== existing.role;
      if (mudouPapel) {
        await createAudit(req, {
          action: 'ROLE_CHANGE', actorId: actingUserId, targetType: 'USER',
          targetId: userId, targetName: atualizado.nome,
          details: { from: existing.role, to: atualizado.role },
        }, t);
      }

      // PRODUCER_SCOPE_CHANGE é ação PRÓPRIA, e não um detalhe de ROLE_CHANGE, por
      // uma razão que o CHECK bicondicional de 018 torna concreta: transferir um
      // produtor de uma OM para outra é mudança de ESCOPO sem mudança de PAPEL, e
      // nesse evento não existe ROLE_CHANGE nenhum para carregar o detalhe. Como
      // `producer_org_id` decide todo recurso que a conta MANTÉM, isso ficaria sem
      // nada para filtrar — que é o mesmo buraco de LOGIN/ATLAS_DELETE, só que
      // silencioso desde o primeiro dia.
      //
      // A comparação é contra a LINHA GRAVADA (`atualizado`), nunca contra o corpo
      // do request: rebaixar de Produtor limpa o escopo como EFEITO (o serviço
      // resolve o par), sem `producer_org_id` no corpo, e comparar com o corpo
      // perderia exatamente essa revogação.
      if ((existing.producer_org_id ?? null) !== (atualizado.producer_org_id ?? null)) {
        await createAudit(req, {
          action: 'PRODUCER_SCOPE_CHANGE', actorId: actingUserId, targetType: 'USER',
          targetId: userId, targetName: atualizado.nome,
          details: {
            from: existing.producer_org_id ?? null,
            to: atualizado.producer_org_id ?? null,
            role: atualizado.role,
          },
        }, t);
      }

      const campos = Object.keys(data).filter((k) => k !== 'role');
      if (campos.length > 0 || !mudouPapel) {
        await createAudit(req, {
          action: 'USER_UPDATE', actorId: actingUserId, targetType: 'USER',
          targetId: userId, targetName: atualizado.nome,
          // Só os NOMES dos campos: o valor pode carregar dado pessoal, e a
          // trilha é lida por qualquer admin. Senha nem chega aqui (rota própria).
          details: { fields: campos },
        }, t);
      }
    }

    return atualizado;
  });
}

/**
 * Resets a user's password (admin only).
 */
export async function resetPassword(userId, newPassword, req = null, actorId = null) {
  // Check if user exists
  const alvo = await getUserById(userId);

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Tudo na MESMA transação: trocar a senha, matar as sessões antigas e registrar.
  // Antes a revogação era uma segunda query solta — uma falha entre as duas
  // deixava senha nova com sessões velhas ainda válidas.
  return tx(async (t) => {
    const rows = await t.any(Q.RESET_USER_PASSWORD, [userId, passwordHash]);
    if (rows.length === 0) {
      throw new NotFoundError('User');
    }

    // Revoke existing refresh tokens so the old password's sessions die.
    await t.none(Q.REVOKE_ALL_USER_TOKENS, [userId]);

    if (actorId) {
      // NUNCA a senha, nem seu tamanho, nem hash: a trilha é lida por qualquer
      // admin, e senha em log já foi defeito real neste projeto (duas vezes).
      await createAudit(req, {
        action: 'PASSWORD_RESET', actorId, targetType: 'USER',
        targetId: userId, targetName: alvo.nome,
        details: { by: 'admin', sessionsRevoked: true },
      }, t);
    }

    return { success: true };
  });
}

/**
 * Deactivates a user (soft delete). Optionally transfers atlas ownership.
 * @param {string} userId - User to deactivate
 * @param {string} adminId - Admin performing the action
 * @param {string} transferToUserId - User to transfer atlas to (optional)
 */
export async function deleteUser(userId, adminId, transferToUserId = null, req = null) {
  // Can't delete yourself
  if (userId === adminId) {
    throw new ForbiddenError('Você não pode desativar a própria conta.');
  }

  // Fast-fail existence check (read) before opening the transaction.
  const user = await getUserById(userId);

  // Atomic: count atlas -> (transfer) -> soft-delete -> revoke tokens.
  // If any step fails, the whole thing rolls back (no orphaned transfer).
  return tx(async (t) => {
    const atlasCount = await t.one(Q.COUNT_USER_ATLAS, [userId]);
    const count = parseInt(atlasCount.count, 10);

    if (count > 0) {
      if (!transferToUserId) {
        throw new ConflictError(
          `O usuário possui ${count} atlas. Informe um destinatário para transferir a propriedade, senão os atlas ficariam órfãos.`
        );
      }
      // Transferring to the user being deactivated is a no-op that LOOKS like a
      // success: `TRANSFER_ATLAS_OWNERSHIP` runs `SET owner_id = $2 WHERE owner_id =
      // $1` with $1 === $2, and the target still reads is_active = true because the
      // soft delete happens further down. The service then reported N transfers that
      // never occurred, leaving a live atlas owned by an inactive account — exactly
      // what the ConflictError above exists to prevent. Nobody but a global admin
      // could act on it afterwards, since only the owner may transfer or delete an
      // atlas and an inactive owner is refused at the `auth` middleware.
      // Mirrors atlas.service.js:499, which rejects newOwnerId === currentOwnerId.
      if (transferToUserId === userId) {
        throw new ConflictError(
          'O destinatário não pode ser o próprio usuário que está sendo desativado: '
          + 'os atlas ficariam órfãos.'
        );
      }

      const target = await t.oneOrNone(Q.FIND_USER_BY_ID_ADMIN, [transferToUserId]);
      if (!target) throw new NotFoundError('User');
      if (!target.is_active) throw new ForbiddenError('Não é possível transferir o atlas para um usuário inativo.');
      // RETURNING rows -> use t.any (t.none would reject on returned rows).
      const transferred = await t.any(Q.TRANSFER_ATLAS_OWNERSHIP, [userId, transferToUserId]);

      // Drop any share the recipient already held on the atlases they just
      // inherited. Ownership comes from `owner_id` alone, but `LIST_USER_ATLAS`
      // resolves `COALESCE(s.permission, ...owner...)`, so a surviving share OUTRANKS
      // the synthesized 'owner' and the new owner is listed with their old, lesser
      // permission. The server gate stays correct (resolvePermission checks owner
      // first), but the listing lies and the frontend reads it with a closed equality
      // (`user_permission === 'owner'`), so the atlas disappears from "Meus atlas"
      // and shows as read-only under "Compartilhados".
      // Mirrors atlas.service.js:529-532, same reasoning.
      if (transferred.length > 0) {
        await t.none(Q.DELETE_SHARES_FOR_NEW_OWNER, [
          transferred.map((a) => a.id),
          transferToUserId,
        ]);
      }
    }

    const deleted = await t.oneOrNone(Q.SOFT_DELETE_USER, [userId]);
    if (!deleted) throw new NotFoundError('User');

    await t.none(Q.REVOKE_ALL_USER_TOKENS, [userId]);

    // Audit participates in the same transaction (rolls back together).
    await createAudit(req, {
      action: 'USER_DELETE', actorId: adminId, targetType: 'USER',
      targetId: userId, targetName: user.nome, details: { atlasTransferred: count },
    }, t);

    return { success: true, atlasTransferred: count > 0 ? count : 0 };
  });
}

/**
 * Atomically rotates a user's API key (old key archived to api_key_history),
 * auditing within the same transaction.
 */
export async function rotateApiKey(userId, actorId, req = null) {
  return tx(async (t) => {
    // oneOrNone (not one): a nonexistent user matches 0 rows; map that to a
    // clean 404 instead of letting pg-promise's QueryResultError surface as 500.
    const row = await t.oneOrNone(Q.ROTATE_API_KEY, [userId, actorId]);
    if (!row) throw new NotFoundError('User');
    await createAudit(req, {
      action: 'API_KEY_ROTATE',
      actorId,
      targetType: 'USER',
      targetId: userId,
    }, t);
    return { apiKey: row.api_key };
  });
}

/**
 * Reactivates a previously deactivated user.
 *
 * AUDITA, e a assimetria que isso corrige é literal: `deleteUser` (a desativação)
 * emite `USER_DELETE` desde sempre, e o ato que devolve a conta ao ar não deixava
 * nada. Meia história é pior do que nenhuma numa trilha de acesso — quem filtra por
 * `USER_DELETE` conclui que a conta continua desativada.
 *
 * Uma query só, então não há transação a que aderir; a trilha vem depois do UPDATE.
 * @param {string} userId
 * @param {string|null} [actorId] - Administrador que reativou.
 * @param {object} [req]
 */
export async function reactivateUser(userId, actorId = null, req = null) {
  const { rows } = await query(Q.REACTIVATE_USER, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  if (actorId) {
    await createAudit(req, {
      action: 'USER_REACTIVATE', actorId, targetType: 'USER',
      targetId: userId, targetName: rows[0].nome,
      details: { role: rows[0].role },
    });
  }

  return rows[0];
}
