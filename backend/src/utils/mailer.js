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
  const text =
    'Olá,\n\n' +
    'Recebemos um pedido de cadastro no EBGeo com este endereço de e-mail, mas ele não foi ' +
    'concluído: já existe uma conta com este e-mail, ou o nome de usuário escolhido já está em uso. ' +
    'Nenhuma conta nova foi criada.\n\n' +
    'O que fazer:\n' +
    `- Se a conta já é sua, não faça um novo cadastro.${acesso} e entre com o seu usuário.\n` +
    '- Se você ainda não confirmou o e-mail, use a opção de reenviar a confirmação na tela de cadastro.\n' +
    '- Se esqueceu a senha, peça a redefinição ao administrador do EBGeo. Não há redefinição ' +
    'automática por e-mail.\n' +
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
