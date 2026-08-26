// Path: src/modules/auth/auth.queries.js

// posto_graduacao / organizacao_militar are DERIVED display names from the rank_id / organization_id
// FKs (so the token claim + UI keep seeing strings while storage is normalized).
//
// `org_ativa` PROJETA A VIVACIDADE DA OM QUE O JOIN JA PAGA. Até 2026-08-25 esta consulta
// juntava `organizations` e trazia só `o.nome`; o login então chamava `orgIsActive`
// (utils/org-status.js), que abria uma SEGUNDA consulta na MESMA linha, já lida. Junção
// paga, coluna descartada, e mais uma ida ao banco por entrada.
//
// `COALESCE(o.is_active, true)` NÃO É ESCOLHA DE ESTILO: é a regra defensiva de
// `org-status.js`, copiada campo a campo. Lá, uma OM inexistente (linha sumida) conta como
// ATIVA, porque isso é anomalia e não desativação deliberada, e trancar o usuário fora por
// causa dela seria pior do que o problema. O LEFT JOIN devolve NULL nos DOIS casos que a
// função isenta — sem OM e OM inexistente — e o COALESCE os manda para `true`, igual.
// O `false` de `producer_org_ativa` abaixo é o oposto por um motivo que não vale aqui: sem
// OM produtora a resposta certa é "não produz".
export const FIND_USER_BY_USERNAME = `
  SELECT u.id, u.username, u.password_hash, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar,
         COALESCE(o.is_active, true) AS org_ativa,
         u.producer_org_id,
         u.is_active, u.role, u.email, u.email_verified
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE LOWER(u.username) = LOWER($1)
`;

// A JUNCAO COM A OM PRODUTORA, e nao so com a de LOTACAO.
//
// Ate 2026-08-24 esta consulta juntava `organizations` uma vez so, por `u.organization_id`
// (LOTACAO), e projetava `u.producer_org_id` CRU: sem nome e sem vivacidade. As duas ausencias
// custavam caro e de formas diferentes.
//
// A vivacidade: `fn_can_produce_resource` recusa toda escrita quando a OM PRODUTORA esta
// inativa, e o cliente nao tinha como saber disso. O resultado era o pior padrao de recusa que
// existe: a porta "Catalogo" abria, a calibracao continuava visivel, Editar e Excluir continuavam
// desenhados, e cada escrita voltava 404 (o WHERE nao casa, zero linhas viram "nao encontrado").
// Repare que o gate de rota NAO barra: `CATALOG_PRODUCER_ACTOR` resolve o escopo juntando so a
// OM de lotacao, entao `producer_org_id` continua nao-nulo e a requisicao passa; quem recusa e o
// predicado dentro do WHERE da escrita.
//
// O nome: `producer_org_nome` era lido em DOIS pontos do cliente (`admin/users-tab.js`) e nunca
// existiu no servidor — varredura em `backend/` devolvia zero. O ramo esquerdo daquele `||` era
// morto, a tabela caia sempre em `orgLabel`, e como `config.organizacoesMilitares` so traz OM
// ATIVA, uma OM produtora desativada imprimia o UUID cru na tela.
//
// `COALESCE(po.is_active, false)`: sem OM produtora, a resposta e "nao produz", que e o mesmo
// que `producer_org_id IS NULL` ja dizia. Nao ha caso em que ausencia signifique ativa.
//
// `org_ativa` (a OM de LOTAÇÃO) entrou em 2026-08-25, pelo mesmo motivo que em
// `FIND_USER_BY_USERNAME`: o `refresh` já pagava este JOIN e mesmo assim abria uma segunda
// consulta a `organizations` pela função `orgIsActive`. As duas colunas COALESCEiam para
// lados OPOSTOS de propósito, e a assimetria é a regra de cada uma: ausência de OM de
// lotação ISENTA (não há o que desativar), ausência de OM produtora RECUSA (não produz).
export const FIND_USER_BY_ID = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar,
         COALESCE(o.is_active, true) AS org_ativa,
         u.producer_org_id, po.nome AS producer_org_nome,
         COALESCE(po.is_active, false) AS producer_org_ativa,
         u.role, u.created_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  LEFT JOIN organizations po ON po.id = u.producer_org_id
  WHERE u.id = $1 AND u.is_active = true
`;

export const UPDATE_LAST_LOGIN = `
  UPDATE users SET last_login_at = NOW() WHERE id = $1
`;

export const INSERT_REFRESH_TOKEN = `
  INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
  VALUES ($1, $2, $3)
  RETURNING id
`;

export const FIND_REFRESH_TOKEN = `
  SELECT id, user_id, expires_at
  FROM refresh_tokens
  WHERE token_hash = $1 AND revoked_at IS NULL
`;

// Includes revoked tokens, so the service can detect reuse of a revoked token.
export const FIND_REFRESH_TOKEN_ANY = `
  SELECT id, user_id, expires_at, revoked_at
  FROM refresh_tokens
  WHERE token_hash = $1
`;

// Logout revokes exactly ONE session: the row whose hash matches, whose owner is the
// authenticated caller, and only while that row is still live. Both extra predicates
// fix a defect; neither is decoration.
//
// `user_id = $2` — the query used to match on `token_hash` alone and the service never
// received a user id, so the ONLY credential needed to end someone else's session was
// knowledge of their refresh token: any authenticated caller could replay a captured
// token and log its owner out. The owner now comes from the verified JWT
// (`req.user.id`), never from the request body, so the body cannot name its own owner.
//
// `revoked_at IS NULL` — makes revocation IDEMPOTENT, which is a security property
// here, not tidiness. `refresh()` decides "concurrent duplicate" vs "stolen token" by
// how long ago `revoked_at` was stamped (REFRESH_RACE_GRACE_MS, auth.service.js).
// Without this predicate every repeated logout moved the stamp to NOW(), so a user
// pressing "sair" again kept a spent token permanently INSIDE the grace window, where
// a replay reads as an ordinary duplicate and reuse detection never fires. That is the
// theft alarm being disarmed by a button the victim presses themselves.
//
// RETURNING so the service can distinguish "revoked a live session" from "matched
// nothing" (someone else's token, an already-revoked one, or one never issued).
export const REVOKE_REFRESH_TOKEN = `
  UPDATE refresh_tokens
  SET revoked_at = NOW()
  WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL
  RETURNING id
`;

// Atomic claim for rotation, same shape as CLAIM_VERIFICATION_TOKEN below and for
// the same reason: `revoked_at IS NULL` in the WHERE makes the UPDATE itself the
// mutual exclusion, so exactly ONE concurrent caller can rotate a given token, and
// RETURNING tells that winner what it claimed.
//
// The previous read-then-write pair (FIND_REFRESH_TOKEN_ANY, decide, then
// REVOKE_REFRESH_TOKEN with no guard and no RETURNING) let several callers all
// observe `revoked_at = NULL`, all pass the reuse check, and all issue a new family
// from one token — which is precisely the control that reuse detection exists to
// enforce. `expires_at` comes back so expiry is judged on the row actually claimed.
// `expires_at > NOW()` is part of the claim on purpose: an expired token must be
// refused WITHOUT being mutated. Checking expiry after the claim would revoke the
// row as a side effect of rejecting it, which contradicts the contract asserted by
// auth-gaps auth-08 (expiry is not reuse and must leave `revoked_at` NULL).
export const CLAIM_REFRESH_TOKEN = `
  UPDATE refresh_tokens
  SET revoked_at = NOW()
  WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
  RETURNING user_id, expires_at
`;

// Mass revocation, in ONE statement, doing TWO things — and the second one is why the
// first is worth anything.
//
// Stamping `refresh_tokens.revoked_at` ends the ability to ROTATE and nothing else:
// no code on the request path reads that table, so a principal already holding a live
// access token kept working, and the sliding renewal in flexible-auth.js re-issued it
// forever (bugs-backend #35). `users.sessions_valid_from` is the cut-off the live path
// CAN see: `getLiveAuthState` reads it, and `auth` / `flexibleAuth` / the collab
// handshake refuse any token whose `iat` predates it.
//
// The two writes are ONE statement on purpose. A data-modifying CTE is executed
// exactly once and always to completion, whether or not the outer query reads it, so
// the revocation and the marker cannot land apart — no caller can revoke and forget
// the marker, and both take the same NOW() (transaction start, i.e. the marker is if
// anything slightly EARLIER than the revocation, which fails safe: earlier means
// fewer legitimate tokens caught).
//
// Kept byte-identical to the copy in users.queries.js — four call sites split across
// the two modules and all four need the same effect.
export const REVOKE_ALL_USER_TOKENS = `
  WITH revoked AS (
    UPDATE refresh_tokens SET revoked_at = NOW()
    WHERE user_id = $1 AND revoked_at IS NULL
    RETURNING id
  )
  UPDATE users SET sessions_valid_from = NOW() WHERE id = $1
`;

// Self-registration accepts a client-chosen organization_id (the OM dropdown). This
// confirms the target exists and is active before the INSERT binds a user to it.
export const FIND_ACTIVE_ORGANIZATION = `
  SELECT id FROM organizations WHERE id = $1 AND is_active = TRUE
`;

export const CHECK_USERNAME_EXISTS = `
  SELECT id FROM users WHERE LOWER(username) = LOWER($1)
`;

export const CHECK_EMAIL_EXISTS = `
  SELECT id FROM users WHERE LOWER(email) = LOWER($1)
`;

export const FIND_USER_BY_EMAIL = `
  SELECT id, username, nome, email, email_verified
  FROM users WHERE LOWER(email) = LOWER($1)
`;

// rank_id is the posto FK; organization_id is the OM FK (COALESCE -> default org). The CTE re-joins
// ranks/organizations so RETURNING still emits the derived posto_graduacao / organizacao_militar names.
export const INSERT_USER = `
  WITH new_user AS (
    INSERT INTO users (username, password_hash, nome, rank_id, role, organization_id, email, email_verified)
    VALUES ($1, $2, $3, $4::uuid, $5, COALESCE($6::uuid, '00000000-0000-0000-0000-000000000001'::uuid), $7, $8)
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.producer_org_id,
         u.role, u.created_at, u.email, u.email_verified
  FROM new_user u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

// ============================================
// Email verification tokens
// ============================================

// `purpose` and `new_email` are named EXPLICITLY (they are not defaulted here) so
// that every mint declares what the token may be redeemed for. The bicondicional
// CHECK of 001_identidade.sql refuses the two impossible pairings.
export const INSERT_VERIFICATION_TOKEN = `
  INSERT INTO email_verification_tokens (user_id, expires_at, purpose, new_email)
  VALUES ($1, $2, $3, $4)
  RETURNING token
`;

// Atomic claim (L4): the UPDATE itself is the mutual exclusion. `consumed_at IS
// NULL` in the WHERE means exactly ONE concurrent caller can transition the row,
// and RETURNING tells that winner what it claimed. A read-then-write pair could
// let two requests both pass the check and both consume the same token.
// `expires_at` comes back so expiry is judged on the row we actually claimed.
//
// `purpose = ANY($2::text[])` IS THE SAFETY PROPERTY OF THE SHARED TABLE, and it is
// why one table can serve three flows without being three mechanisms. The caller
// passes the list its own route is entitled to redeem — the confirmation route takes
// `['verify','change_email']` (both arrive by the same `?verify=` link) and the
// password route takes `['reset_password']` and nothing else. Matching on the token
// alone would let a confirmation link, which is mailed on every signup and every
// resend, be spent as a password reset. The negative control runs in BOTH directions
// in tests/integration/senha-redefinicao-por-email.test.js, and it also asserts that
// the refused token is NOT burned by the attempt — otherwise anyone could disable a
// stranger's signup link by presenting it at the wrong route.
export const CLAIM_VERIFICATION_TOKEN = `
  UPDATE email_verification_tokens
  SET consumed_at = NOW()
  WHERE token = $1 AND purpose = ANY($2::text[]) AND consumed_at IS NULL
  RETURNING user_id, expires_at, purpose, new_email
`;

// Burns every still-live token of ONE purpose for ONE user. Called before minting a
// new one (asking again must not leave the previous link usable) and after a reset
// succeeds. Scoped by purpose so re-asking for a password reset never silently
// cancels a pending e-mail confirmation.
export const CONSUME_PENDING_TOKENS = `
  UPDATE email_verification_tokens
  SET consumed_at = NOW()
  WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
`;

export const MARK_EMAIL_VERIFIED = `
  UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1
`;

// The confirmed half of an e-mail change: the pending address becomes the real one
// AND is verified in the same statement, because the click on the link IS the proof
// of ownership. Splitting the two writes would allow the state "new address, not
// verified", which is precisely the lock-out this whole flow exists to avoid.
export const APPLY_EMAIL_CHANGE = `
  UPDATE users SET email = $2, email_verified = TRUE, updated_at = NOW()
  WHERE id = $1 AND is_active = TRUE
  RETURNING id
`;

// Uniqueness of an address AGAINST EVERY OTHER ACCOUNT. `id <> $2` is what lets the
// owner re-send a confirmation for the address they already hold without colliding
// with themselves.
export const CHECK_EMAIL_EXISTS_EXCLUDING = `
  SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2
`;

// The only account a password-reset link may be minted for: active, with an address,
// and with that address ALREADY CONFIRMED. An unconfirmed address is not proven to
// belong to anyone, and mailing a password credential to it would hand the account to
// whoever typed it at signup.
export const FIND_RESETTABLE_USER_BY_EMAIL = `
  SELECT id, username, nome, email
  FROM users
  WHERE LOWER(email) = LOWER($1) AND is_active = TRUE AND email_verified = TRUE
`;

// `is_active` in the WHERE, not read-then-check: an account deactivated between the
// mint and the click must not be resettable, and RETURNING zero rows is how the
// service learns that without a second round trip.
export const SET_USER_PASSWORD = `
  UPDATE users SET password_hash = $2, updated_at = NOW()
  WHERE id = $1 AND is_active = TRUE
  RETURNING id
`;
