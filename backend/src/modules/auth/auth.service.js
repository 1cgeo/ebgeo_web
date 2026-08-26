// Path: src/modules/auth/auth.service.js
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { query, tx } from '../../database/index.js';
import {
  AppError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '../../utils/errors.js';
import { orgIsActiveFromRow } from '../../utils/org-status.js';
import { createAudit, createAuditBestEffort } from '../../utils/audit.js';
import {
  sendVerificationEmail,
  sendAccountExistsEmail,
  sendEmailChangeVerification,
  sendPasswordResetEmail,
  buildVerificationLink,
  buildAppLink,
} from '../../utils/mailer.js';
import { parseDuration } from '../../utils/duration.js';
import * as Q from './auth.queries.js';

const SALT_ROUNDS = 12;

// How long after a rotation a loser of the atomic claim is treated as a concurrent
// duplicate rather than as token theft. Covers a client firing several refreshes at
// once (double F5, two tabs, network retry); short enough that a replay arriving
// later still trips reuse detection. See the grace-window note in refresh().
const REFRESH_RACE_GRACE_MS = 10_000;

// A valid bcrypt hash of a throwaway password, computed once at load.
// Compared against when the username does NOT exist, so login spends the same
// CPU time whether or not the user is real — eliminating the timing oracle.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-dummy-password', SALT_ROUNDS);

/**
 * Generates a JWT access token (single-issuer payload, shared by web/nomes/360).
 */
export function issueAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      nome: user.nome,
      posto: user.posto_graduacao,
      role: user.role || 'user', // global {user, admin}
      organization_id: user.organization_id ?? null, // tenant claim (LOTACAO: exibicao)
      // A claim `org_role` (papel dentro da OM) FOI REMOVIDA em 2026-08-20 (D7). Ela
      // nao autorizava nada aqui e, no cliente, alimentava o papel POR ATLAS: quem
      // tivesse 'admin' ou 'owner' nela era desenhado como Administrador ou Dono de
      // atlas sem ter permissao nenhuma. Token LEGADO ainda chega com ela e os dois
      // mapeadores a IGNORAM (nao ha campo para onde ela va), que e a forma certa de
      // aposentar claim: ignorar o desconhecido, nunca reagir a ele.
      // Escopo de PRODUCAO (null = nao produz). ADITIVO: um token legado nao a
      // carrega e degrada para null nos dois mapeadores, o que e o valor certo —
      // quem nao tem a claim nao produz. Nenhum ramo de autorizacao deve LER esta
      // claim: ela alimenta o INSERT de `owner_org_id`, o pre-filtro de upload e o
      // cinto do 360, e a garantia real fica no SQL, que resolve o escopo pelo UUID.
      producer_org_id: user.producer_org_id ?? null,
      // Aliases so the single-issuer token is consumable as-is by ebgeo_360
      // (which reads {sub, org, role, login}) without changing the 360.
      org: user.organization_id ?? null,
      login: user.username,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiry, algorithm: 'HS256' }
  );
}

// Backwards-compatible alias used internally.
const generateAccessToken = issueAccessToken;

/**
 * Milliseconds until a decoded JWT payload expires (for sliding sessions).
 */
export function msUntilExpiry(payload) {
  return (payload?.exp ? payload.exp * 1000 : 0) - Date.now();
}

/**
 * Generates a random refresh token and its hash.
 */
function generateRefreshToken() {
  const token = crypto.randomUUID() + '-' + crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/**
 * Authenticates a user and returns tokens.
 */
export async function login(username, password) {
  // Find user
  const { rows } = await query(Q.FIND_USER_BY_USERNAME, [username]);
  const user = rows[0];

  // Always run bcrypt — against the real hash or the dummy — so the response
  // time does not reveal whether the username exists (no timing oracle).
  const hashToCompare = user ? user.password_hash : DUMMY_HASH;
  const isValid = await bcrypt.compare(password, hashToCompare);

  if (!user || !isValid) {
    logger.warn({ username }, 'Failed login attempt');
    throw new UnauthorizedError('Usuário ou senha inválidos');
  }

  if (!user.is_active) {
    throw new UnauthorizedError('Conta desativada');
  }

  // E-mail confirmation gate: an account registered WITH an e-mail must verify it before login.
  // Accounts without an e-mail (admin-created / legacy / M2M) skip this entirely.
  if (user.email && !user.email_verified) {
    throw new AppError('Confirme seu e-mail para entrar.', 401, 'EMAIL_NOT_VERIFIED');
  }

  // O1: a member of a deactivated organization cannot start a session.
  // Decidido sobre a linha JÁ LIDA: `FIND_USER_BY_USERNAME` junta `organizations` para
  // trazer o nome, e projeta `org_ativa` no mesmo JOIN. A chamada a `orgIsActive` que
  // estava aqui abria uma segunda consulta à MESMA linha.
  if (!orgIsActiveFromRow(user.organization_id, user.org_ativa)) {
    throw new ForbiddenError('Organização inativa');
  }

  // Update last login
  await query(Q.UPDATE_LAST_LOGIN, [user.id]);

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const { token: refreshToken, hash: refreshHash } = generateRefreshToken();

  // Store refresh token
  const expiresAt = new Date(Date.now() + parseDuration(config.jwt.refreshExpiry));
  await query(Q.INSERT_REFRESH_TOKEN, [user.id, refreshHash, expiresAt]);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      nome: user.nome,
      posto_graduacao: user.posto_graduacao,
      organizacao_militar: user.organizacao_militar,
      organization_id: user.organization_id ?? null,
      producer_org_id: user.producer_org_id ?? null,
      role: user.role || 'user',
    },
  };
}

/**
 * Refreshes tokens using a valid refresh token.
 * Implements token rotation: old token is revoked, new pair is issued.
 */
export async function refresh(refreshToken) {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // Claim the token by revoking it, atomically. The UPDATE's `revoked_at IS NULL`
  // IS the mutual exclusion: exactly one concurrent caller can transition the row,
  // so one token can never yield two families. This replaces a read-check-then-write
  // triple (find → inspect revoked_at → revoke) whose three unsynchronized
  // round-trips let every racing caller observe an unrevoked row and pass the reuse
  // check together — defeating the very control that turns a stolen token into a
  // family-wide revocation.
  const claimed = await query(Q.CLAIM_REFRESH_TOKEN, [hash]);

  if (claimed.rows.length === 0) {
    // Nothing claimed: the token never existed, or it is expired, or it was already
    // rotated. Only the last case is evidence of anything. Read it back to tell them
    // apart, exactly as the old code did before deciding.
    const { rows } = await query(Q.FIND_REFRESH_TOKEN_ANY, [hash]);
    if (rows.length === 0) {
      throw new UnauthorizedError('Sessão inválida. Entre novamente.');
    }

    const spent = rows[0];

    // Expiry is judged BEFORE reuse. An expired token is already powerless, so
    // presenting one is not evidence of theft, and treating it as such would turn
    // every ordinary resume-after-expiry into a family-wide logout.
    if (new Date(spent.expires_at) < new Date()) {
      throw new UnauthorizedError('Sessão expirada. Entre novamente.');
    }

    // Concurrency grace window (OAuth 2.1 BCP §4.14.2). One client legitimately
    // firing several refreshes at once — double F5, two tabs, a network retry —
    // produces exactly this shape: one winner and N losers holding the token that
    // was rotated microseconds ago. Without the window every such burst reads as
    // theft and logs the user out of everything, including the winner's brand-new
    // token, which is strictly worse than the problem being guarded against.
    //
    // The cost is stated plainly: an attacker replaying INSIDE the window escapes
    // the alarm. They still get nothing — they lost the claim, so no tokens are
    // issued — but the victim's family is not proactively revoked. Outside the
    // window, which is where a stolen token realistically gets used, detection is
    // unchanged.
    const revokedAgo = Date.now() - new Date(spent.revoked_at).getTime();
    if (spent.revoked_at && revokedAgo <= REFRESH_RACE_GRACE_MS) {
      throw new UnauthorizedError('Sessão inválida. Entre novamente.');
    }

    // Reuse detection: a live token reappearing long after rotation means the chain
    // was compromised. Revoke the whole family AND cut the sessions.
    //
    // SCOPE, as of 2026-07-25 (bugs-backend #35). `REVOKE_ALL_USER_TOKENS` now writes
    // TWO things in one statement: `refresh_tokens.revoked_at` (ends rotation) and
    // `users.sessions_valid_from` (ends the sessions themselves). The second is what
    // the live path can see — `getLiveAuthState` reads it, and every access token
    // whose `iat` predates the marker is refused by the strict `auth` middleware, by
    // the sliding renewal in flexible-auth.js and by the collab WS handshake.
    //
    // Until that marker existed, revoking the family ended the ability to ROTATE and
    // nothing else. The access token carries no jti/session/version (issueAccessToken
    // above), nothing on the request path read `refresh_tokens`, and flexible-auth.js
    // re-issued the token whenever it was <5 min from expiring — regardless of whether
    // it arrived as a cookie or as a Bearer header. So the holder of a stolen token
    // simply made one request every <15 min and renewed forever: the theft alarm fired
    // and turned nothing off. This comment used to claim a fresh login was "forced";
    // it was not, and the claim survived for months because no test held it.
    //
    // Same effect now reaches the other three callers of this query, which all needed
    // it: password change and admin reset (users.service.js) and deactivation, where
    // the marker is redundant with `is_active` but written anyway so the invariant has
    // no exceptions.
    //
    // WHAT IT STILL DOES NOT DO, precisely: an ALREADY-OPEN collab socket is not torn
    // down (the sweep reconciles authorization, not session — see collab.gateway.js),
    // and the few routes that run on `flexibleAuth` alone (`GET /nomes/busca`, the
    // sv360 reads) keep honouring the token until its own `exp`. Both are bounded by
    // JWT_ACCESS_EXPIRY; the UNBOUNDED renewal, which was the actual defect, is gone.
    // Pinned by tests/integration/refresh-reuse-session-scope.repro.test.js.
    logger.warn({ userId: spent.user_id }, 'Refresh token reuse detected');
    await query(Q.REVOKE_ALL_USER_TOKENS, [spent.user_id]);
    throw new UnauthorizedError('Sessão inválida. Entre novamente.');
  }

  const storedToken = claimed.rows[0];

  // Get user data
  const userResult = await query(Q.FIND_USER_BY_ID, [storedToken.user_id]);
  if (userResult.rows.length === 0) {
    throw new UnauthorizedError('Usuário não encontrado');
  }

  const user = userResult.rows[0];

  // O1: a member of a deactivated organization cannot renew a session.
  // Mesma troca do login: `FIND_USER_BY_ID` acima já leu a organização de lotação junto
  // com o usuário, então a vivacidade sai daquela linha, não de uma segunda consulta.
  if (!orgIsActiveFromRow(user.organization_id, user.org_ativa)) {
    throw new ForbiddenError('Organização inativa');
  }

  // Generate new tokens
  const accessToken = generateAccessToken(user);
  const { token: newRefreshToken, hash: newRefreshHash } = generateRefreshToken();

  // Store new refresh token
  const expiresAt = new Date(Date.now() + parseDuration(config.jwt.refreshExpiry));
  await query(Q.INSERT_REFRESH_TOKEN, [user.id, newRefreshHash, expiresAt]);

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * Revokes ONE refresh token (logout), scoped to its owner and idempotent.
 *
 * `userId` is REQUIRED and must come from the verified access token (`req.user.id`),
 * never from the request body: it is what stops a caller from ending a session that
 * is not theirs merely by knowing its refresh token. Omit it and the query matches
 * `user_id = NULL`, i.e. nothing — failing closed rather than revoking blindly.
 *
 * Nothing matching is a legitimate, common outcome (a second logout, a token from
 * another account, a token never issued) and is reported by the return value, not by
 * an exception: see the note on the 204 in auth.controller.js.
 *
 * @param {string} refreshToken - The raw refresh token presented by the client.
 * @param {string} userId - The authenticated caller's id (JWT `sub`).
 * @returns {Promise<boolean>} True when a live token of this user was revoked by
 *   THIS call; false when the statement matched no row.
 */
export async function logout(refreshToken, userId) {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const { rows } = await query(Q.REVOKE_REFRESH_TOKEN, [hash, userId]);
  return rows.length > 0;
}

/**
 * Gets the current user profile.
 */
export async function getMe(userId) {
  const { rows } = await query(Q.FIND_USER_BY_ID, [userId]);

  if (rows.length === 0) {
    throw new UnauthorizedError('Usuário não encontrado');
  }

  return rows[0];
}

/**
 * Registers a new user (self-registration), WITHOUT telling the caller whether the account already
 * existed. `email` is REQUIRED by `registerSchema`, so the account is ALWAYS created PENDING
 * (email_verified=false) with a verification token issued + e-mailed, and the `?verify=` link is
 * the only way into it. (This paragraph read "without an e-mail the account is immediately active"
 * until e-mail became mandatory; the e-mail-less account still exists, but only through
 * `POST /api/v1/users`, whose schema has no such field — which is why the gate in `login()` stays
 * conditional on `user.email`.)
 *
 * ORACLE, and how it is closed. This route used to answer 409 for a taken username or e-mail and
 * 201 otherwise, while the comment sitting here claimed the single generic 409 message meant "an
 * attacker can't tell whether a specific e-mail is already registered". That was false from the
 * first day it was written: the message was uniform, the STATUS CODE was not, so anyone could
 * enumerate accounts one request at a time. The message never mattered.
 *
 * Now every outcome is the same 201 with the same body, and the collision is reported to the only
 * party entitled to know: the owner of the mailbox, by e-mail (`sendAccountExistsEmail`). Three
 * things have to hold together for that to be worth anything, and each is pinned by a test in
 * tests/integration/auth-register-verification-oracle.test.js:
 *
 *  1. STATUS + BODY are identical. The created user is no longer returned — an account payload on
 *     one branch and nothing on the other is the same oracle wearing a 201.
 *  2. TIMING is comparable. Creating an account costs a bcrypt hash at cost 12 (hundreds of ms);
 *     the "already exists" branch would otherwise cost a couple of queries. That difference is
 *     readable over the network, exactly like the login oracle DUMMY_HASH exists to kill, so the
 *     hash is computed BEFORE the branch and simply discarded when nothing is created.
 *  3. FAILURES stay contained. The notice is best-effort like the verification e-mail: a send that
 *     throws only on the "exists" branch would restore the oracle as a 500.
 *
 * What is NOT hidden, deliberately: an invalid/inactive `organization_id` still answers 400. The
 * org list is served publicly by GET /api/config, so it reveals nothing about accounts.
 *
 * @param {Object} data - Validated register payload.
 * @param {string} [origin] - Request origin, used to build the verification link when APP_BASE_URL
 *   is unset.
 * @param {object} [req] - Express req, só para ip/user-agent da trilha do cadastro.
 * @returns {Promise<Object|null>} The created user, or null when nothing was created because the
 *   username/e-mail was taken. The CONTROLLER must not let that difference reach the response.
 */
export async function register(data, origin = '', req = null) {
  // Always present: `registerSchema` requires it. The account is therefore always born
  // pending, and the confirmation link is the only way in.
  const email = data.email.trim();

  // The client picks its own organization here (the OM dropdown), and the value went
  // straight into the INSERT unchecked, so a caller could name any UUID — including a
  // soft-deactivated or nonexistent org — and become a member of it.
  //
  // SCOPE, stated plainly: this check rejects orgs that do not exist or are inactive.
  // It does NOT stop someone from self-selecting a real, active OM they do not belong
  // to; that remains possible by design, because the signup dropdown is a
  // self-declaration. Membership is not decorative — it grants read of that org's
  // unpublished (`disabled`) 360 projects via isProjectReadable — and every active
  // org's UUID is served by the anonymous GET /api/config to populate that dropdown.
  // Closing it properly needs an approval step; deliberately deferred (see
  // bugs-backend.md #33). What now bounds the exposure is confirmation, not rarity: the
  // account is born pending and only a caller who controls the declared mailbox ever gets
  // to use it. That is weaker than approval and it is the honest description — the
  // declaration still goes unreviewed. (This paragraph used to close with "the exposure
  // today is limited to deployments with ALLOW_SELF_REGISTRATION on, which is off in
  // production"; that sentence is the whole argument for leaving the hole open, so it must
  // not be the sentence that survives an unrelated deployment decision.)
  if (data.organization_id) {
    const { rows: org } = await query(Q.FIND_ACTIVE_ORGANIZATION, [data.organization_id]);
    if (org.length === 0) {
      throw new BadRequestError('Organização militar inválida ou inativa.');
    }
  }

  // Hash the password BEFORE knowing whether it will be used. This is the timing half of the
  // anti-oracle: bcrypt at cost 12 dominates the request (hundreds of ms against a couple of ms of
  // queries), so hashing only on the create branch would let a caller read "account exists" off the
  // clock even with the status and body made identical. Same trick, same reason, as DUMMY_HASH in
  // login() above. Pinned by the timing test in auth-register-verification-oracle.test.js.
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  const { rows: existing } = await query(Q.CHECK_USERNAME_EXISTS, [data.username]);
  const usernameTaken = existing.length > 0;

  const { rows: emailRows } = await query(Q.CHECK_EMAIL_EXISTS, [email]);
  const emailTaken = emailRows.length > 0;

  if (usernameTaken || emailTaken) {
    // Nothing is created and nothing is said back. The notice goes to the mailbox instead, which
    // is the whole point: only its owner learns that the address is registered.
    //
    // Best-effort, exactly like the verification e-mail below and for a sharper reason: a throw
    // that escapes ONLY here would answer 500 for an existing account and 201 for a new one,
    // re-opening by exception the oracle the status code just closed.
    try {
      await sendAccountExistsEmail({ to: email, appLink: buildAppLink(origin) });
    } catch (err) {
      logger.error({ err }, 'Account-exists notice failed (nothing was created)');
    }
    logger.info({ usernameTaken, emailTaken }, 'Register attempt on an existing account — nothing created');
    return null;
  }

  // Create user (role is always 'user' for self-registration; org defaults). email_verified
  // starts false, and since e-mail is mandatory here the login gate always applies: a
  // self-registered account is unusable until the link is followed. Accounts created by an
  // administrator carry no e-mail and are therefore active on creation, which is why the
  // gate in login() must stay conditional on `user.email` rather than on the flag alone.
  const { rows } = await query(Q.INSERT_USER, [
    data.username,
    passwordHash,
    data.nome,
    data.rank_id || null,
    'user',
    data.organization_id || null, // COALESCE -> default org in SQL
    email,
    false,
  ]);
  const user = rows[0];

  // A CONTA NASCIA SEM TRILHA. `USER_CREATE` só tinha emissor no caminho
  // administrativo (`users.service.js`), então uma conta criada pelo auto-cadastro
  // não deixava nada — e é justamente a que ninguém aprovou. `self: true` é o que
  // separa as duas origens no mesmo filtro.
  //
  // O ATOR É O PRÓPRIO NOVO USUÁRIO, porque `actor_id` é NOT NULL e não há outro:
  // ninguém autorizou este cadastro.
  //
  // BEST-EFFORT, e aqui a razão é o oráculo de existência de conta, não a
  // disponibilidade: esta linha existe SÓ no ramo que cria, então um erro que
  // escapasse daqui responderia 500 para um nome livre e 201 para um nome tomado,
  // reabrindo por exceção exatamente o oráculo que o 201 uniforme fecha. É a mesma
  // contenção do e-mail de verificação logo abaixo, pelo mesmo motivo.
  //
  // O custo de tempo é um INSERT (~1 ms) num ramo que já paga um INSERT de conta e
  // um envio de e-mail, sob um bcrypt de custo 12 que domina a requisição inteira e
  // que é computado ANTES do ramo de propósito. Não é uma assimetria nova de classe.
  await createAuditBestEffort(req, {
    action: 'USER_CREATE',
    actorId: user.id,
    targetType: 'USER',
    targetId: user.id,
    targetName: user.nome,
    details: {
      self: true,
      role: 'user',
      organization_id: data.organization_id || null,
    },
  });

  // Verification is best-effort: the account row is already committed, so a token/mail failure must
  // NOT 500 the request (that would orphan a pending account the user can neither re-register nor log
  // into). On failure the account simply stays pending and the user can re-trigger via resend.
  try {
    await issueAndSendVerification(user, email, origin);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Verification e-mail failed (account created; user can resend)');
  }
  return user;
}

/**
 * The three things a token of `email_verification_tokens` may be redeemed for.
 *
 * MIRRORS THE CHECK of that table in `src/database/migrations/001_identidade.sql`, and it is a
 * mirror on purpose: the database is the authority (a value it refuses never reaches a row), and
 * this object exists so no call site spells a purpose as a bare string. Adding a fourth means
 * editing both, in the same commit.
 */
export const TokenPurpose = Object.freeze({
  VERIFY: 'verify',
  CHANGE_EMAIL: 'change_email',
  RESET_PASSWORD: 'reset_password',
});

/**
 * The purposes the `?verify=` link may redeem, and the ONE it may not.
 *
 * Both entries arrive through the same link and the same route because the client sends only a
 * token and cannot know which flow minted it. `RESET_PASSWORD` is absent, and its absence is the
 * whole safety argument for one shared table: see `CLAIM_VERIFICATION_TOKEN`.
 * @type {readonly string[]}
 */
const CONFIRMABLE_PURPOSES = Object.freeze([TokenPurpose.VERIFY, TokenPurpose.CHANGE_EMAIL]);

/**
 * Mints one account-mail token.
 *
 * @param {string} userId
 * @param {string} purpose - One of {@link TokenPurpose}.
 * @param {number} ttlMs
 * @param {string|null} [newEmail] - Required for (and only for) `change_email`.
 * @returns {Promise<string>} The token.
 */
async function mintToken(userId, purpose, ttlMs, newEmail = null) {
  const expiresAt = new Date(Date.now() + ttlMs);
  const { rows } = await query(Q.INSERT_VERIFICATION_TOKEN, [
    userId,
    expiresAt,
    purpose,
    newEmail,
  ]);
  return rows[0].token;
}

/** @returns {number} The confirmation TTL in milliseconds, guarding a non-numeric env. */
function verificationTtlMs() {
  const hours = Number(config.security.verificationTtlHours);
  return (Number.isFinite(hours) ? hours : 48) * 60 * 60 * 1000;
}

/** @returns {number} The password-reset TTL in minutes, guarding a non-numeric env. */
export function passwordResetTtlMinutes() {
  const minutes = Number(config.security.passwordResetTtlMinutes);
  return Number.isFinite(minutes) ? minutes : 60;
}

/**
 * Issues a fresh verification token for a user and e-mails (or logs) the link.
 * @param {{ id: string, nome: string }} user
 * @param {string} email
 * @param {string} origin
 * @returns {Promise<string>} The token.
 */
async function issueAndSendVerification(user, email, origin) {
  const token = await mintToken(user.id, TokenPurpose.VERIFY, verificationTtlMs());
  const link = buildVerificationLink(token, origin);
  await sendVerificationEmail({ to: email, link, nome: user.nome });
  return token;
}

/**
 * Issues a token for an e-mail CHANGE and mails the confirmation to the address being adopted.
 *
 * THE MECHANISM IS THE SAME ONE THE SIGNUP USES, deliberately: same table, same single-use
 * atomic claim, same `?verify=` link, same TTL. Only `purpose` and the destination differ. A
 * second token mechanism for the same fact ("prove you hold this mailbox") is how the two drift.
 *
 * Every still-live change token of this user is burned first, so asking twice never leaves two
 * addresses confirmable: the last request is the one that counts.
 *
 * @param {{ id: string, username: string }} user - The account asking for the change.
 * @param {string} newEmail - The address to adopt, already trimmed.
 * @param {string} [origin] - Request origin, honoured only when trusted.
 * @returns {Promise<string>} The token.
 */
export async function issueAndSendEmailChange(user, newEmail, origin = '') {
  await query(Q.CONSUME_PENDING_TOKENS, [user.id, TokenPurpose.CHANGE_EMAIL]);
  const token = await mintToken(
    user.id,
    TokenPurpose.CHANGE_EMAIL,
    verificationTtlMs(),
    newEmail
  );
  const link = buildVerificationLink(token, origin);
  await sendEmailChangeVerification({ to: newEmail, link, username: user.username });
  return token;
}

/**
 * Confirms an account-mail token that arrived by the `?verify=` link.
 *
 * TWO OUTCOMES, ONE ROUTE, because the client holds only a token and the flow that minted it is
 * a server-side fact:
 *   - `verify`       — the address the account was born with becomes confirmed;
 *   - `change_email` — the pending address REPLACES the current one and is born confirmed, since
 *     the click is the proof of ownership.
 * A `reset_password` token is not redeemable here at all (`CONFIRMABLE_PURPOSES`).
 *
 * @param {string} token
 * @returns {Promise<{ success: true, purpose: string }>}
 */
export async function verifyEmail(token) {
  // L4 — claim and verify in ONE transaction, with the claim itself doing the
  // mutual exclusion (`consumed_at IS NULL` in the WHERE). The previous
  // read-check-then-write sequence let two concurrent requests both observe an
  // unconsumed token and both succeed, so the token was not truly single-use.
  return tx(async (t) => {
    // CADA RECUSA LEVA CÓDIGO PRÓPRIO, e não é detalhe de arrumação. As quatro recusas desta
    // função eram `BadRequestError` ou `ConflictError`, ou seja, TRÊS delas colapsavam no mesmo
    // `BAD_REQUEST`, e o cliente não tinha como distingui-las: ele mostrava uma frase única que
    // CHUTAVA a expiração ("o link pode ter expirado"), inclusive para o link inválido e para a
    // conta desativada. Distinguir pela MENSAGEM seria acoplar a tela ao texto do servidor.
    const claimed = await t.oneOrNone(Q.CLAIM_VERIFICATION_TOKEN, [token, CONFIRMABLE_PURPOSES]);
    if (!claimed) {
      // Unknown token, already claimed, or minted for a purpose this route may not redeem.
      throw new AppError('Token de verificação inválido.', 400, 'EMAIL_TOKEN_INVALID');
    }
    if (new Date(claimed.expires_at) < new Date()) {
      // Roll the claim back so an expired token is not silently burned — the
      // user can still ask for a new one and this row stays diagnosable.
      throw new AppError('Token de verificação expirado.', 400, 'EMAIL_TOKEN_EXPIRED');
    }

    if (claimed.purpose === TokenPurpose.CHANGE_EMAIL) {
      // THE SECOND UNIQUENESS CHECK, and it is not redundant with the one made when the change
      // was requested: between the two, somebody else may have taken the address (a signup, or
      // another account's change confirmed first). Without it the UPDATE raises 23505, which the
      // error handler turns into a 400 that says nothing about e-mail. Throwing rolls the claim
      // back, so the link is not burned by a refusal the holder cannot act on immediately.
      const taken = await t.oneOrNone(Q.CHECK_EMAIL_EXISTS_EXCLUDING, [
        claimed.new_email,
        claimed.user_id,
      ]);
      if (taken) {
        throw new AppError('Este e-mail já está em uso por outra conta.', 409, 'EMAIL_TAKEN');
      }
      const applied = await t.oneOrNone(Q.APPLY_EMAIL_CHANGE, [claimed.user_id, claimed.new_email]);
      if (!applied) {
        // The account was deactivated between the request and the click.
        throw new AppError('Esta conta não está mais ativa.', 400, 'ACCOUNT_INACTIVE');
      }
      return { success: true, purpose: claimed.purpose };
    }

    await t.none(Q.MARK_EMAIL_VERIFIED, [claimed.user_id]);
    return { success: true, purpose: claimed.purpose };
  });
}

/**
 * Starts a password recovery: mints a short-lived token and mails it, WITHOUT ever saying whether
 * the address belongs to an account.
 *
 * THE ANSWER IS ALWAYS THE SAME `{ success: true }`, which is the same anti-enumeration decision
 * `resendVerification` makes, applied to the route that is far more worth attacking. The residual
 * that this design does NOT close is stated plainly rather than hidden: the branch that finds an
 * account pays two extra queries and one SMTP delivery, so the two branches differ in TIME. That
 * is the same accepted cost `resendVerification` already carries and, unlike `register`, there is
 * no bcrypt here to dominate the request and mask it. What bounds it is the per-address limiter
 * on the route, not the shape of this function.
 *
 * ONLY A CONFIRMED ADDRESS gets a link. An unverified address is not proven to belong to the
 * person who typed it at signup, so mailing a password credential there would hand over the
 * account. Someone stuck in that state is the case for the administrator, and for the e-mail
 * correction on "Minha conta".
 *
 * @param {string} email
 * @param {string} [origin] - Request origin, honoured only when trusted.
 * @returns {Promise<{ success: true }>} Identical on every branch.
 */
export async function requestPasswordReset(email, origin = '') {
  const { rows } = await query(Q.FIND_RESETTABLE_USER_BY_EMAIL, [email]);
  const user = rows[0];

  if (user) {
    // Asking again invalidates the previous code: two live codes for one account doubles the
    // window without buying the person anything.
    await query(Q.CONSUME_PENDING_TOKENS, [user.id, TokenPurpose.RESET_PASSWORD]);
    const minutes = passwordResetTtlMinutes();
    const token = await mintToken(
      user.id,
      TokenPurpose.RESET_PASSWORD,
      minutes * 60 * 1000
    );
    await sendPasswordResetEmail({
      to: user.email,
      token,
      nome: user.nome,
      minutes,
      appLink: buildAppLink(origin),
    });
  } else {
    logger.info('Password reset requested for an address with no resettable account');
  }

  return { success: true };
}

/**
 * Finishes a password recovery: consumes the token, writes the new password and ends every
 * session of the account.
 *
 * EVERY SESSION DIES, including any the attacker may hold. `REVOKE_ALL_USER_TOKENS` revokes the
 * refresh family AND stamps `users.sessions_valid_from`, which is the marker the live request
 * path reads; without the second write, revoking would end the ability to rotate and nothing
 * else. This is the same effect the administrator reset already has (`users.service.js`), and
 * the reason a recovery must have it is sharper: the reason to recover is often that somebody
 * else is inside.
 *
 * @param {string} token
 * @param {string} newPassword
 * @param {object} [req] - Express req, for the ip/user-agent of the audit line.
 * @returns {Promise<{ success: true }>}
 */
export async function resetPasswordWithToken(token, newPassword, req = null) {
  // Hashed BEFORE the transaction: bcrypt at cost 12 dominates the request, and holding a
  // database transaction open across it would pin a connection for hundreds of milliseconds on
  // an anonymous route.
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  return tx(async (t) => {
    const claimed = await t.oneOrNone(Q.CLAIM_VERIFICATION_TOKEN, [
      token,
      [TokenPurpose.RESET_PASSWORD],
    ]);
    if (!claimed) {
      // Unknown, already spent, or a confirmation token being presented here.
      throw new AppError('Código de redefinição inválido ou já utilizado.', 400, 'RESET_TOKEN_INVALID');
    }
    if (new Date(claimed.expires_at) < new Date()) {
      throw new AppError('Código de redefinição expirado. Peça outro.', 400, 'RESET_TOKEN_EXPIRED');
    }

    const updated = await t.oneOrNone(Q.SET_USER_PASSWORD, [claimed.user_id, passwordHash]);
    if (!updated) {
      throw new AppError('Esta conta não está mais ativa.', 400, 'ACCOUNT_INACTIVE');
    }

    // Any OTHER live code of this account dies with the one just spent: a second code in a
    // second mailbox copy would still open the account after the owner recovered it.
    await t.none(Q.CONSUME_PENDING_TOKENS, [claimed.user_id, TokenPurpose.RESET_PASSWORD]);
    await t.none(Q.REVOKE_ALL_USER_TOKENS, [claimed.user_id]);

    // BLOCKING, like every other write to this trail, and unlike LOGIN/LOGOUT: there is no
    // oracle to protect here (the outcome of THIS route is already told to the caller) and a
    // password changed without a trail line is exactly what an investigation cannot afford.
    // `actorId` is the account itself: whoever held the mailbox acted as the owner, and there
    // is no other identity to name.
    await createAudit(req, {
      action: 'PASSWORD_RESET',
      actorId: claimed.user_id,
      targetType: 'USER',
      targetId: claimed.user_id,
      details: { self: true, via: 'email', sessionsRevoked: true },
    }, t);

    return { success: true };
  });
}

/**
 * Re-issues a verification e-mail. Always resolves success (never leaks whether the e-mail exists);
 * only re-sends for a real, not-yet-verified account.
 * @param {string} email
 * @param {string} [origin]
 * @returns {Promise<{ success: true }>}
 */
export async function resendVerification({ email = null, username = null }, origin = '') {
  // POR ENDEREÇO **OU** POR USUÁRIO. O segundo serve o botão que fica ao lado do erro de login,
  // onde a tela só tem o usuário. Em qualquer dos dois o e-mail sai para o endereço REGISTRADO da
  // conta (`user.email`), nunca para o que veio no pedido: é isso que impede a rota de virar um
  // encaminhador de mensagem para endereço arbitrário.
  const { rows } = email
    ? await query(Q.FIND_USER_BY_EMAIL, [email])
    : await query(Q.FIND_USER_BY_USERNAME, [username]);
  const user = rows[0];
  if (user && user.email && !user.email_verified) {
    await issueAndSendVerification(user, user.email, origin);
  }
  // Sempre o mesmo desfecho, com ou sem conta: a rota não diz quem existe.
  return { success: true };
}
