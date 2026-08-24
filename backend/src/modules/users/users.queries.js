// Path: src/modules/users/users.queries.js
//
// users.rank_id (FK ranks) and users.organization_id (FK organizations) are the stored values;
// posto_graduacao / organizacao_militar are DERIVED display names via LEFT JOIN, so the API/UI
// keep seeing strings while storage is normalized. Write queries take the FK ids and re-join in a
// CTE so RETURNING still emits the derived names.

// O UNICO IMPORT DESTE ARQUIVO, e ele e um fragmento de SQL de outro modulo: o predicado
// de "concessao viva feita por" pertence ao modulo de acesso a recurso, e a listagem de
// usuarios so o pendura. Ver `LIVE_GRANTS_BY_GRANTER_AGG`, abaixo.
import { LIVE_GRANT_COUNT_BY_GRANTER } from '../resource-access/resource-access.queries.js';

// `email` / `email_verified` are HERE and not only on the admin twin, since 2026-08-23.
//
// Their absence was not a missing column, it was a hole in the product: `GET /users/me` is what
// "Minha conta" reads, so a person could not see the address their account carries nor whether it
// was confirmed — and a typo made at signup is invisible to the only person who can spot it. The
// pair also drives the wording of the change form (an unconfirmed address is stated as such).
// Neither is writable through this route; `updateProfileSchema` does not accept them and the
// change goes through `PUT /users/me/email`, which re-verifies.
export const FIND_USER_BY_ID = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar,
         u.email, u.email_verified, u.created_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.id = $1 AND u.is_active = true
`;

// The password hash PLUS the identity the e-mail-change flow needs (`username` names the account
// in the confirmation message; `email` is compared against the requested one). One read instead
// of two on a route that already pays a bcrypt comparison.
export const FIND_USER_FOR_EMAIL_CHANGE = `
  SELECT id, username, nome, email, email_verified, password_hash
  FROM users
  WHERE id = $1 AND is_active = true
`;

export const FIND_USER_WITH_PASSWORD = `
  SELECT id, password_hash
  FROM users
  WHERE id = $1 AND is_active = true
`;

// Nullable FK fields (rank_id/organization_id) use a "provided" flag so an explicit null CLEARS the
// column, while an omitted field is left unchanged. (COALESCE alone could never clear to NULL.)
export const UPDATE_USER_PROFILE = `
  WITH upd AS (
    UPDATE users
    SET nome = COALESCE($2, nome),
        rank_id = CASE WHEN $4 THEN $3::uuid ELSE rank_id END,
        organization_id = CASE WHEN $6 THEN $5::uuid ELSE organization_id END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar,
         u.email, u.email_verified, u.created_at, u.last_login_at
  FROM upd u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

export const UPDATE_USER_PASSWORD = `
  UPDATE users
  SET password_hash = $2, updated_at = NOW()
  WHERE id = $1
`;

export const SEARCH_USERS = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.is_active = true
    AND (
      LOWER(u.username) LIKE LOWER($1)
      OR LOWER(u.nome) LIKE LOWER($1)
      OR LOWER(r.nome) LIKE LOWER($1)
      OR LOWER(o.nome) LIKE LOWER($1)
    )
  ORDER BY u.nome
  LIMIT 20
`;

// ============================================
// Admin queries
// ============================================

/**
 * A JUNCAO QUE TRAZ `live_grant_count` PARA A LINHA DO USUARIO.
 *
 * POR QUE A LISTAGEM CARREGA ISTO. Trocar o papel global, ou a OM produtora, de quem
 * concedeu acesso DERRUBA o que essa pessoa concedeu (`fundamentoDeRaizPerdido` +
 * `podarPorRaizes`, em `users.service.js`). A aba de administracao precisa dizer QUANTAS
 * concessoes o salvamento vai revogar ANTES do clique, e o irmao dela ja resolve o mesmo
 * problema do mesmo jeito: a listagem de grupos traz `grant_count` por linha e
 * `groupDeletionWarning` monta o aviso a partir dele.
 *
 * O SELECT VEM DE `resource-access.queries.js`, E NAO ESTA ESCRITO AQUI, por dois motivos.
 * O primeiro e o de sempre neste arquivo: "concessao viva feita por" tem UMA definicao, ao
 * lado da lista de raizes que a poda consome, e a segunda copia e a que envelhece.
 *
 * O SEGUNDO FOI MEDIDO, e sozinho ja bastaria. O censo de
 * `tests/integration/resource-grants-prazo.test.js` caca varredura de expiracao pelo PAR
 * (o arquivo nomeia a tabela de concessoes E carimba a coluna de revogacao com a hora
 * corrente), e `REVOKE_ALL_USER_TOKENS`, mais abaixo, carimba essa coluna em
 * `refresh_tokens`, que e outro assunto. Enquanto a tabela de concessoes era nomeada neste
 * arquivo o censo reprovava, e com razao: o filtro por tabela dele depende de os dois
 * assuntos nao se encostarem no mesmo arquivo. Repare que o censo le o TEXTO, comentario
 * incluso, entao esta nota tambem nao pode escrever os dois literais.
 *
 * `LEFT JOIN` e nao `JOIN`: quem nunca concedeu nada precisa aparecer na lista, e o
 * `COALESCE` do SELECT le a ausencia como zero.
 */
const LIVE_GRANTS_BY_GRANTER_AGG = `
  LEFT JOIN (${LIVE_GRANT_COUNT_BY_GRANTER}) lg ON lg.granted_by = u.id
`;

export const LIST_ALL_USERS = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role,
         u.producer_org_id, u.is_active,
         u.email, u.email_verified, u.created_at, u.last_login_at,
         COALESCE(lg.n, 0) AS live_grant_count
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  ${LIVE_GRANTS_BY_GRANTER_AGG}
  ORDER BY u.created_at DESC
`;

export const LIST_ACTIVE_USERS = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role,
         u.producer_org_id, u.is_active,
         u.email, u.email_verified, u.created_at, u.last_login_at,
         COALESCE(lg.n, 0) AS live_grant_count
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  ${LIVE_GRANTS_BY_GRANTER_AGG}
  WHERE u.is_active = true
  ORDER BY u.nome
`;

export const FIND_USER_BY_ID_ADMIN = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role,
         u.producer_org_id, u.is_active,
         u.email, u.email_verified, u.created_at, u.updated_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.id = $1
`;

export const CHECK_USERNAME_EXISTS = `
  SELECT id FROM users WHERE LOWER(username) = LOWER($1)
`;

export const CHECK_USERNAME_EXISTS_EXCLUDING = `
  SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2
`;

export const INSERT_USER_ADMIN = `
  WITH new_user AS (
    INSERT INTO users (username, password_hash, nome, rank_id, organization_id, role,
                       producer_org_id)
    VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::uuid)
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role,
         u.producer_org_id, u.is_active, u.created_at
  FROM new_user u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

// rank_id/organization_id/producer_org_id use a "provided" flag (see UPDATE_USER_PROFILE) so an
// explicit null clears the column; an omitted field is left unchanged.
//
// O ESCOPO DE PRODUCAO PRECISA DA BANDEIRA, e nao de um COALESCE como o papel: sem
// ela nao ha como LIMPAR a coluna ao rebaixar um produtor, e o CHECK bicondicional
// (`users_producer_scope_check`) recusaria o UPDATE inteiro com 23514 — que sai como
// um 400 generico, sem dizer que o problema e um escopo orfao.
// `email` USA A BANDEIRA, e nao um COALESCE, pela mesma razao dos FKs acima: sem ela nao ha
// como LIMPAR o endereco de uma conta (voltar ao estado "conta administrativa sem e-mail", que
// e legitimo e e como `POST /api/v1/users` cria). E a bandeira e o que separa "nao mandou o
// campo" de "mandou vazio", que aqui significam coisas opostas.
//
// A REGRA QUE ACOMPANHA ESTE CAMPO NAO ESTA NO SQL: trocar o endereco DERRUBA
// `email_verified` para falso, salvo se o mesmo pedido disser o contrario. Quem impoe e
// `users.service.js`, sobre o estado efetivo, porque a decisao depende de comparar o valor
// novo com o da LINHA, e um CASE aqui compararia com o que veio no corpo.
export const UPDATE_USER_ADMIN = `
  WITH upd AS (
    UPDATE users
    SET username = COALESCE($2, username),
        nome = COALESCE($3, nome),
        rank_id = CASE WHEN $5 THEN $4::uuid ELSE rank_id END,
        organization_id = CASE WHEN $7 THEN $6::uuid ELSE organization_id END,
        role = COALESCE($8, role),
        is_active = COALESCE($9, is_active),
        email_verified = COALESCE($10, email_verified),
        producer_org_id = CASE WHEN $12 THEN $11::uuid ELSE producer_org_id END,
        email = CASE WHEN $14 THEN $13 ELSE email END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role,
         u.producer_org_id, u.is_active,
         u.email, u.email_verified, u.created_at, u.updated_at, u.last_login_at
  FROM upd u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

export const RESET_USER_PASSWORD = `
  UPDATE users
  SET password_hash = $2, updated_at = NOW()
  WHERE id = $1
  RETURNING id
`;

export const SOFT_DELETE_USER = `
  UPDATE users
  SET is_active = false, updated_at = NOW()
  WHERE id = $1
  RETURNING id
`;

export const REACTIVATE_USER = `
  WITH upd AS (
    UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.is_active, u.created_at
  FROM upd u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

// A TRANSFERÊNCIA ALCANÇA A LIXEIRA (achado A5, decisão do dono em 2026-08-24), e o
// `deleted_at IS NULL` que morava aqui era o que a impedia. Deixar o atlas descartado com o
// dono que está sendo desativado não é "não mexer no que já foi apagado": conta inativa é
// recusada com 401 em toda rota, então aquele atlas passava a não ter NENHUM titular capaz
// de restaurá-lo, listá-lo ou apagá-lo de vez, e a única porta que sobrava era a do
// administrador global. Lixeira é um estado do atlas, não o fim dele.
//
// `from_trash` viaja no RETURNING porque a CONFIRMAÇÃO precisa dele: o novo dono herda uma
// lixeira que não é dele, e quem clica em "transferir" tem de poder ser avisado disso. Sai
// como booleano já resolvido, e não como a data: o chamador não tem o que fazer com o
// instante do descarte, e devolver a coluna crua convidaria a próxima leitura a repetir aqui
// a decisão de o que conta como lixeira.
export const TRANSFER_ATLAS_OWNERSHIP = `
  UPDATE atlas
  SET owner_id = $2, updated_at = NOW()
  WHERE owner_id = $1
  RETURNING id, (deleted_at IS NOT NULL) AS from_trash
`;

// After a transfer, the new owner must not also hold a share row on the same atlas:
// LIST_USER_ATLAS resolves COALESCE(share, owner), so the share would outrank the
// synthesized 'owner' and report the new owner with their previous, lesser
// permission. Ownership comes from owner_id alone.
export const DELETE_SHARES_FOR_NEW_OWNER = `
  DELETE FROM atlas_shares WHERE atlas_id = ANY($1::uuid[]) AND user_id = $2
`;

// O PAR (total, lixeira), e o `deleted_at IS NULL` saiu daqui pelo mesmo motivo que saiu da
// transferência acima. A metade que só esta consulta causava: contando zero, `deleteUser` não
// PERGUNTAVA nada, então quem só tinha atlas descartados era desativado sem que a
// transferência fosse sequer oferecida — o caminho mais silencioso possível para o mesmo
// atlas órfão.
//
// `trashed` é PARCELA de `count`, não um segundo total, e é assim que os dois consumidores o
// leem (a recusa diz "N atlas, sendo M na lixeira"). Somá-los em algum lugar contaria os
// descartados duas vezes.
export const COUNT_USER_ATLAS = `
  SELECT COUNT(*) AS count,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS trashed
  FROM atlas WHERE owner_id = $1
`;

// Revoke all active refresh tokens for a user (on password change/reset/deactivate)
// AND stamp the session cut-off that the live auth path actually reads.
//
// Revoking the family alone was inert against a principal holding a live access token:
// nothing on the request path reads `refresh_tokens`, and the sliding renewal in
// flexible-auth.js re-issued that token indefinitely (bugs-backend #35).
// `users.sessions_valid_from` is what `getLiveAuthState` reads, and `auth` /
// `flexibleAuth` / the collab handshake use it to refuse any token whose `iat`
// predates it.
//
// One statement, not two: a data-modifying CTE runs exactly once and to completion
// regardless of the outer query, so revocation and marker can never drift apart.
//
// DEACTIVATION (`deleteUser`) is already barred by `users.is_active` on every live
// path, so the marker is REDUNDANT there. It is written anyway, deliberately: the
// invariant is "mass revocation always sets the cut-off", and an invariant with one
// documented exception is an invariant nobody can rely on — the next caller of this
// query gets the effect without having to know which of the four cases it is.
//
// Kept byte-identical to the copy in auth.queries.js (reuse detection calls that one).
export const REVOKE_ALL_USER_TOKENS = `
  WITH revoked AS (
    UPDATE refresh_tokens SET revoked_at = NOW()
    WHERE user_id = $1 AND revoked_at IS NULL
    RETURNING id
  )
  UPDATE users SET sessions_valid_from = NOW() WHERE id = $1
`;

// Atomic API key rotation: archive the old key + issue a new one in one statement.
export const ROTATE_API_KEY = `
  WITH old AS (
    INSERT INTO api_key_history (user_id, api_key, created_at, revoked_at, revoked_by)
    SELECT id, api_key, NULL::timestamptz, NOW(), $2
    FROM users WHERE id = $1 AND api_key IS NOT NULL
    RETURNING 1
  )
  UPDATE users SET api_key = gen_random_uuid(), updated_at = NOW()
  WHERE id = $1
  RETURNING api_key
`;

// A CHAVE DE API EXIGE A OM DE LOTACAO ATIVA, como o caminho de sessao.
//
// O buraco que isto fecha: esta consulta filtrava so `u.is_active`, e o ramo de chave de
// `middleware/flexible-auth.js` devolve `next()` sem consultar organizacao nenhuma. Numa
// rota de `auth` ESTRITO isso nao aparece, porque o estrito reconcilia contra
// `LIVE_AUTH_STATE` e responde 403 'Organization is inactive' — e e por isso que a
// assimetria sobreviveu: o caminho onde ela e visivel nao e o caminho onde a suite
// olhava. Numa rota SO-FLEXIVEL, que e exatamente a familia das leituras de recurso
// privado (sv360, nomes, assets3d), a chave continuava valendo com a OM desativada, e o
// principal seguia sendo o dono de uma conta que login, refresh e toda rota estrita ja
// recusavam.
//
// O TERMO MORA AQUI, E NAO NO MIDDLEWARE, por duas razoes. A primeira e custo: o JOIN com
// `organizations` ja existia nesta consulta (para `organizacao_militar`), entao o termo e
// de graca, enquanto conferir no JS custaria uma segunda ida ao banco em cada requisicao
// de chave. A segunda e que ele falha FECHADO: um chamador novo de
// `FIND_USER_BY_API_KEY` herda a regra sem ter de lembrar dela, que e a mesma razao pela
// qual o predicado de recurso privado vive em funcao SQL.
//
// `COALESCE(o.is_active, true)` repete a regra de `utils/org-status.js`: conta SEM OM e
// OM com linha AUSENTE passam. Linha ausente e anomalia de dado, nao desativacao
// deliberada, e tranca-la aqui seria inventar uma revogacao que ninguem pediu.
export const FIND_USER_BY_API_KEY = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.producer_org_id, u.role
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.api_key = $1
    AND u.is_active = true
    AND COALESCE(o.is_active, true) = true
`;
