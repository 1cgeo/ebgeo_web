// Path: src/utils/mailer.js

/**
 * Outbound e-mail for account verification.
 *
 *  - No SMTP host configured (dev/test, closed networks) → NO-OP that logs the link.
 *  - SMTP host configured                                → sends via SMTP.
 *
 * `nodemailer` is a REAL dependency as of 2026-07-19. It used to be treated as
 * optional ("wiring real SMTP is a deploy-time follow-up"), except it was never in
 * package.json, so `getTransport()` always threw and returned null: no deployment,
 * production included, could ever send a verification e-mail. The feature existed,
 * was documented, was tested — and was inert. A dependency-optional design that is
 * never satisfied is just a disabled feature with extra branches.
 *
 * Installing it moves weight onto a path that had never executed, so two things that
 * could not previously fail now can, and are handled here rather than at each caller:
 * transport construction and `sendMail` itself. See the catch in `deliver`.
 */

import config from '../config.js';
import logger from './logger.js';

/** @returns {boolean} Whether an SMTP transport is configured. */
export function isSmtpConfigured() {
  return Boolean(config.mail.host);
}

/**
 * Whether a message this module sends can actually REACH somebody.
 *
 * NOT the same question as `isSmtpConfigured`, and the difference is the no-send branch of
 * `deliver`: outside production a missing relay is not a dead end, because the link (or code) is
 * written to the log, and that log IS the delivery channel of a developer's local stack. In
 * production the same state is a misconfiguration, `deliver` shouts about it, and nothing
 * reaches anyone.
 *
 * It exists because a FEATURE has to be mounted (or not) on this fact rather than on the narrow
 * one: `src/modules/auth/auth.routes.js` mounts the password-recovery routes by it, and
 * `GET /api/config` reports the same predicate as `features.password_reset_email`, so the login
 * screen never offers a recovery whose message cannot land. Two predicates for one fact would
 * eventually disagree, and the visible failure would be a screen promising an e-mail nobody sends.
 *
 * @returns {boolean}
 */
export function canDeliverAccountMail() {
  return isSmtpConfigured() || !config.isProd;
}

/**
 * Decides which base URL a verification link may point at.
 *
 * The request `origin` is CLIENT-CONTROLLED: the only caller derives it from
 * `req.headers.origin || \`${req.protocol}://${req.get('host')}\``
 * (auth.controller.js), and `POST /auth/resend-verification` is mounted without auth
 * and accepts an arbitrary e-mail in the body. Trusting it verbatim meant an
 * anonymous attacker could have the server mail a GENUINE message — real MAIL_FROM,
 * real unconsumed token — whose link pointed at a host they control. Only APP_BASE_URL
 * being set prevented it, and that is optional even in production, unlike CORS_ORIGIN
 * which `validateEnvVariables` does require there: the factory default WAS the
 * vulnerable path.
 *
 * So the origin is accepted only when it matches an origin the deployment already
 * trusts. Kept as a pure function, separate from config, so both branches are directly
 * testable — the surrounding config object is frozen and cannot be swapped in a test.
 *
 * @param {string} origin - Client-supplied origin (untrusted).
 * @param {{appBaseUrl?: string, allowedOrigin?: string}} trusted - Deployment configuration.
 * @returns {string} Base URL with no trailing slash; '' when nothing is trustworthy.
 */
export function resolveVerificationBase(origin, { appBaseUrl = '', allowedOrigin = '' } = {}) {
  const strip = (u) => String(u || '').replace(/\/$/, '');
  if (appBaseUrl) return strip(appBaseUrl);

  // No configured base: fall back to the request origin ONLY if it is the very origin
  // CORS already trusts. Anything else is an attacker naming their own host.
  const candidate = strip(origin);
  if (candidate && candidate === strip(allowedOrigin)) return candidate;

  return '';
}

/**
 * Builds the verification link for a token.
 * @param {string} token
 * @param {string} [origin] - Client-supplied origin; honoured only if trusted.
 * @returns {string}
 */
export function buildVerificationLink(token, origin = '') {
  const base = resolveVerificationBase(origin, {
    appBaseUrl: config.mail.appBaseUrl,
    allowedOrigin: config.cors.origin,
  });
  return `${base}/?verify=${encodeURIComponent(token)}`;
}

/**
 * Builds a link to the app root for messages that carry no token.
 * Same trust rules as `buildVerificationLink`; returns '' when no base is trustworthy,
 * because a relative '/' in an e-mail body is noise, not a link.
 * @param {string} [origin] - Client-supplied origin; honoured only if trusted.
 * @returns {string}
 */
export function buildAppLink(origin = '') {
  const base = resolveVerificationBase(origin, {
    appBaseUrl: config.mail.appBaseUrl,
    allowedOrigin: config.cors.origin,
  });
  return base ? `${base}/` : '';
}

// Memoized so a burst of signups reuses one connection pool instead of building a
// transport per message. Reset by `_resetTransportForTests`.
let transportPromise = null;

/**
 * Lazily resolves an SMTP transport via `nodemailer`. Returns null when the transport
 * cannot be built at all (missing/broken dependency, unusable options), so the caller
 * degrades to logging instead of throwing.
 * @returns {Promise<Object|null>}
 */
async function getTransport() {
  if (!transportPromise) {
    transportPromise = (async () => {
      try {
        const { default: nodemailer } = await import('nodemailer');
        return nodemailer.createTransport({
          host: config.mail.host,
          port: config.mail.port,
          secure: config.mail.port === 465,
          auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
        });
      } catch (err) {
        logger.error({ err }, '[mailer] could not build the SMTP transport');
        return null;
      }
    })();
  }
  return transportPromise;
}

/** Test seam: drops the memoized transport. */
export function _resetTransportForTests() {
  transportPromise = null;
}

/**
 * Sends (or logs) one transactional message, containing every failure mode in one place.
 *
 * Shared by the two account e-mails because they must be indistinguishable in EVERY
 * respect that a caller can observe: `register` answers 201 whether it created an
 * account or found one, so a difference in throw/timing/return shape between the two
 * messages would put the enumeration oracle back on the wire behind the status code.
 *
 * @param {{ to: string, subject: string, text: string, detail: Object, label: string,
 *   devChannel: boolean }} message - `detail` is what may be logged (see the note on
 *   credentials in `sendVerificationEmail`); `devChannel` says whether a no-send is an
 *   informational dev event or a production misconfiguration.
 * @param {Object|null} injectedTransport - Test seam (see `sendVerificationEmail`).
 * @returns {Promise<{ sent: boolean, info?: Object, error?: Error }>}
 */
async function deliver({ to, subject, text, detail, label, devChannel }, injectedTransport = null) {
  if (!injectedTransport && !isSmtpConfigured()) {
    if (devChannel) {
      logger.info(detail, `[mailer] SMTP not configured — ${label} (no e-mail sent)`);
    } else {
      // In production this is a misconfiguration, not an informational event: nobody
      // can activate an account and there is now no link in the log to fall back on.
      logger.error(detail, `[mailer] SMTP not configured — ${label} NOT sent`);
    }
    return { sent: false };
  }

  const transport = injectedTransport || await getTransport();
  if (!transport) {
    logger.error(detail, `[mailer] SMTP configured but no transport available — ${label} NOT sent`);
    return { sent: false };
  }

  // A send failure must NOT propagate. Three callers depend on that:
  //
  //  - `register` already wraps this in try/catch, but relying on every future caller
  //    to remember is how the next gap gets made.
  //  - `resendVerification` does NOT wrap it, and a throw there would turn the
  //    endpoint into an existence oracle: an unknown address always answers 200 (no
  //    send is attempted), while a KNOWN address whose send fails would answer 500.
  //  - the account-exists notice below is sent ONLY on the "already registered" branch
  //    of register. A throw escaping there would be the sharpest oracle of the lot:
  //    500 for an existing account, 201 for a new one.
  //
  // This could not happen while the dependency was missing, because sendMail was
  // never reached. Enabling a dormant path is what put weight on it.
  let info;
  try {
    info = await transport.sendMail({ from: config.mail.from, to, subject, text });
  } catch (err) {
    logger.error({ err, to }, `[mailer] SMTP delivery failed (${label}) — user can request a resend`);
    return { sent: false, error: err };
  }

  logger.info({ to }, `[mailer] ${label} sent`);
  return { sent: true, info };
}

/**
 * Sends (or logs) an account-verification e-mail.
 * @param {{ to: string, link: string, nome?: string }} params
 * @returns {Promise<{ sent: boolean }>} sent=false when it was logged instead of mailed.
 */
export async function sendVerificationEmail(
  { to, link, nome },
  // `transport` is a test seam: the SMTP path was unreachable for the whole life of
  // this module (no dependency installed), so it had never been exercised. Injecting a
  // real nodemailer transport — jsonTransport, or one pointed at a dead port — lets the
  // success and failure branches be driven with the library's own API rather than a
  // hand-rolled stub that could drift from it.
  { exposeLink = !config.isProd, transport: injectedTransport = null } = {}
) {
  const subject = 'Confirme sua conta — EBGeo';
  const text =
    `Olá${nome ? ` ${nome}` : ''},\n\n` +
    `Confirme sua conta no EBGeo acessando o link abaixo:\n${link}\n\n` +
    `Se você não criou esta conta, ignore esta mensagem.`;

  // The link carries the verification token, which is a single-factor credential:
  // `verifyEmail` consumes it and marks the account verified with nothing else
  // required. Logging it put a usable credential in front of every operator and every
  // log-shipping pipeline, next to the owner's e-mail address. `redactUrl` never
  // covered it — that only rewrites `req.url`, and `verify` is not in
  // SENSITIVE_QUERY_KEYS.
  //
  // It was not an edge case either: before nodemailer was actually installed,
  // getTransport() always returned null and EVERY live configuration took one of the
  // no-send branches below, so the token was always logged.
  //
  // Outside production the link IS the delivery channel — with no SMTP, that log line
  // is how a developer verifies a local account — so it is kept there and dropped in
  // production. `exposeLink` is injectable so both branches are testable; the frozen
  // config cannot be swapped in a test.
  const detail = exposeLink ? { to, link } : { to };

  return deliver(
    { to, subject, text, detail, label: 'verification e-mail', devChannel: exposeLink },
    injectedTransport
  );
}

/**
 * Sends (or logs) the confirmation of an e-mail CHANGE, to the address being adopted.
 *
 * It travels by the same `?verify=` link as a signup confirmation, because it is the same
 * token mechanism (`purpose = 'change_email'`); what differs is the wording, and the wording
 * has to differ: the recipient of THIS message may not have an EBGeo account at all yet under
 * this address, and the message they get must say whose account is trying to adopt it and what
 * to do if it was not them.
 *
 * The requester's `nome` is NOT interpolated, for the same reason as `sendAccountExistsEmail`:
 * on the branch where the address belongs to somebody else, that text is attacker-chosen and
 * addressed to a stranger's mailbox. The `username` IS named, because it is what lets the
 * recipient recognise (or fail to recognise) the account, and it is the half of a credential
 * the person requesting the change already typed.
 *
 * @param {{ to: string, link: string, username?: string }} params
 * @param {{ exposeLink?: boolean, transport?: Object|null }} [options]
 * @returns {Promise<{ sent: boolean }>} sent=false when it was logged instead of mailed.
 */
export async function sendEmailChangeVerification(
  { to, link, username = '' },
  { exposeLink = !config.isProd, transport: injectedTransport = null } = {}
) {
  const subject = 'EBGeo — confirme o seu novo e-mail';
  const conta = username ? ` da conta "${username}"` : '';
  const text =
    'Olá,\n\n' +
    `Recebemos um pedido para passar a usar este endereço como e-mail${conta} no EBGeo.\n\n` +
    `Para confirmar, acesse o link abaixo:\n${link}\n\n` +
    'Enquanto você não confirmar, nada muda: a conta continua com o e-mail anterior.\n\n' +
    'Se não foi você quem pediu, ignore esta mensagem.';

  // Same credential regime as the signup link: the token in it activates something by
  // itself, so it is logged only outside production.
  const detail = exposeLink ? { to, link } : { to };

  return deliver(
    { to, subject, text, detail, label: 'e-mail change confirmation', devChannel: exposeLink },
    injectedTransport
  );
}

/**
 * Sends (or logs) the notice that answers an e-mail-CHANGE request aimed at an address that
 * already belongs to another account.
 *
 * It is the sibling of `sendAccountExistsEmail` and exists for the same reason: the route
 * answers the very same 200 whether the address was free or taken, so the collision travels
 * ONLY to the mailbox that owns it. A separate wording rather than reuse, because the signup
 * notice says "cadastro não concluído" and instructs a would-be registrant; here nobody tried
 * to register, and the fact worth telling the owner is that somebody tried to attach THEIR
 * address to another account.
 *
 * Nothing identifying the requester is included. The recipient can act on the message without
 * it, and naming an account here would turn the notice into the oracle the uniform 200 closes.
 *
 * @param {{ to: string, appLink?: string }} params
 * @param {{ exposeLink?: boolean, transport?: Object|null }} [options]
 * @returns {Promise<{ sent: boolean }>} sent=false when it was logged instead of mailed.
 */
export async function sendEmailInUseNotice(
  { to, appLink = '' },
  { exposeLink = !config.isProd, transport: injectedTransport = null } = {}
) {
  const subject = 'EBGeo — tentativa de usar o seu e-mail';
  const acesso = appLink ? ` Acesse o EBGeo em ${appLink}.` : ' Acesse o EBGeo.';
  const text =
    'Olá,\n\n' +
    'Alguém pediu para passar a usar este endereço de e-mail em uma conta do EBGeo, mas ele ' +
    'já pertence a uma conta existente. Nada foi alterado, nem na sua conta nem na outra.\n\n' +
    `Se foi você, entre com a conta que já usa este endereço.${acesso}\n` +
    'Se não foi você, não é preciso fazer nada: ninguém consegue usar este endereço sem ' +
    'acesso a esta caixa de mensagens.';

  // No credential in this message, so `detail` is the same in every environment.
  return deliver(
    { to, subject, text, detail: { to }, label: 'e-mail-in-use notice', devChannel: exposeLink },
    injectedTransport
  );
}

/**
 * Sends (or logs) a password-reset message.
 *
 * IT CARRIES THE TOKEN AS TEXT AND NOT AS A LINK, and that is a measured limit of today's
 * client, stated in the message itself rather than hidden: the boot of the web app consumes
 * exactly one one-shot query parameter (`?verify=`), and routing a second one belongs to
 * `frontend/src/js/index.js`. Promising a clickable link the app would not act on is worse
 * than asking for a paste, so the recovery panel of the login screen accepts the code.
 *
 * The token is a single-factor credential exactly like the verification one, so it follows the
 * same logging regime: visible in the log outside production (where the log IS the delivery
 * channel for a deployment without SMTP), never in production.
 *
 * @param {{ to: string, token: string, nome?: string, minutes: number, appLink?: string }} params
 * @param {{ exposeLink?: boolean, transport?: Object|null }} [options]
 * @returns {Promise<{ sent: boolean }>} sent=false when it was logged instead of mailed.
 */
export async function sendPasswordResetEmail(
  { to, token, nome = '', minutes, appLink = '' },
  { exposeLink = !config.isProd, transport: injectedTransport = null } = {}
) {
  const subject = 'EBGeo — redefinição de senha';
  const acesso = appLink ? `Abra o EBGeo em ${appLink}` : 'Abra o EBGeo';
  const text =
    `Olá${nome ? ` ${nome}` : ''},\n\n` +
    'Recebemos um pedido para redefinir a senha da sua conta no EBGeo.\n\n' +
    `Use este código:\n${token}\n\n` +
    `${acesso}, clique em "Entrar", depois em "Esqueci minha senha", e cole o código junto ` +
    'com a nova senha.\n\n' +
    `O código vale por ${minutes} minutos e serve uma vez só. Ao redefinir, todas as sessões ` +
    'abertas desta conta são encerradas.\n\n' +
    'Se não foi você quem pediu, ignore esta mensagem: sua senha continua a mesma.';

  const detail = exposeLink ? { to, token } : { to };

  return deliver(
    { to, subject, text, detail, label: 'password reset', devChannel: exposeLink },
    injectedTransport
  );
}

/**
 * Sends (or logs) the notice that answers a signup attempt on an address (or username)
 * that is already taken. It replaces the 409 that `register` used to answer, which was
 * a plain e-mail-enumeration oracle: the fact that the account exists now travels ONLY
 * to the mailbox that owns the address, never back over HTTP.
 *
 * ONE message covers both collisions (e-mail already registered, username already
 * taken) on purpose. Two wordings would hand the oracle straight back through the mail
 * channel: `authLimiter` keys on `${ip}:${username}`, so probing a fresh username per
 * request never touches the same bucket, and an attacker mailing their OWN address
 * could enumerate usernames unthrottled. The wording is true in both cases and says
 * what to do in both.
 *
 * The registrant's `nome` is deliberately NOT used: on this branch it is
 * attacker-controlled text addressed to somebody else's mailbox. The account's real
 * name is not read either, because it is not needed to act on the message.
 *
 * @param {{ to: string, appLink?: string }} params - `appLink` is the trusted app base
 *   (see `resolveVerificationBase`); omitted when no base is trustworthy.
 * @param {{ exposeLink?: boolean, transport?: Object|null }} [options]
 * @returns {Promise<{ sent: boolean }>} sent=false when it was logged instead of mailed.
 */
export async function sendAccountExistsEmail(
  { to, appLink = '' },
  { exposeLink = !config.isProd, transport: injectedTransport = null } = {}
) {
  const subject = 'EBGeo — cadastro não concluído';
  const acesso = appLink ? ` Acesse o EBGeo em ${appLink}` : ' Acesse o EBGeo';
  // A LINHA DA SENHA ESQUECIDA É DERIVADA DO MESMO PREDICADO QUE MONTA AS ROTAS
  // (`isSmtpConfigured`, em `src/modules/auth/auth.routes.js`), e não uma frase fixa.
  // Enquanto ela era fixa, ela era a ÚNICA orientação de recuperação de senha do produto
  // inteiro, e dizia "não há redefinição automática por e-mail" — verdade até existir a
  // rota, e mentira no minuto seguinte, numa mensagem que ninguém relê.
  const senha = isSmtpConfigured()
    ? '- Se esqueceu a senha, use "Esqueci minha senha" na tela de entrada.\n'
    : '- Se esqueceu a senha, peça a redefinição ao administrador do EBGeo. Este servidor não '
      + 'tem redefinição automática por e-mail.\n';
  const text =
    'Olá,\n\n' +
    'Recebemos um pedido de cadastro no EBGeo com este endereço de e-mail, mas ele não foi ' +
    'concluído: já existe uma conta com este e-mail, ou o nome de usuário escolhido já está em uso. ' +
    'Nenhuma conta nova foi criada.\n\n' +
    'O que fazer:\n' +
    `- Se a conta já é sua, não faça um novo cadastro.${acesso} e entre com o seu usuário.\n` +
    '- Se você ainda não confirmou o e-mail, use a opção de reenviar a confirmação na tela de cadastro.\n' +
    senha +
    '- Se o problema for o nome de usuário, repita o cadastro escolhendo outro nome.\n\n' +
    'Se não foi você quem pediu, ignore esta mensagem. Nada mudou na sua conta.';

  // No credential in this message (the app link is public), so `detail` is the same in
  // every environment — the `exposeLink` asymmetry only governs the log LEVEL of a
  // no-send, which in production is still a misconfiguration worth shouting about.
  return deliver(
    { to, subject, text, detail: { to }, label: 'account-exists notice', devChannel: exposeLink },
    injectedTransport
  );
}
