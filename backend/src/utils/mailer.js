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

  if (!injectedTransport && !isSmtpConfigured()) {
    if (exposeLink) {
      logger.info(detail, '[mailer] SMTP not configured — verification link (no e-mail sent)');
    } else {
      // In production this is a misconfiguration, not an informational event: nobody
      // can activate an account and there is now no link in the log to fall back on.
      logger.error(detail, '[mailer] SMTP not configured — verification e-mail NOT sent');
    }
    return { sent: false };
  }

  const transport = injectedTransport || await getTransport();
  if (!transport) {
    logger.error(detail, '[mailer] SMTP configured but no transport available — e-mail NOT sent');
    return { sent: false };
  }

  // A send failure must NOT propagate. Two callers depend on that:
  //
  //  - `register` already wraps this in try/catch, but relying on every future caller
  //    to remember is how the next gap gets made.
  //  - `resendVerification` does NOT wrap it, and a throw there would turn the
  //    endpoint into an existence oracle: an unknown address always answers 200 (no
  //    send is attempted), while a KNOWN address whose send fails would answer 500.
  //    The whole route is written to avoid exactly that leak — `register` uses one
  //    generic conflict message so it cannot be used to probe for accounts.
  //
  // This could not happen while the dependency was missing, because sendMail was
  // never reached. Enabling a dormant path is what put weight on it.
  let info;
  try {
    info = await transport.sendMail({ from: config.mail.from, to, subject, text });
  } catch (err) {
    logger.error({ err, to }, '[mailer] SMTP delivery failed — user can request a resend');
    return { sent: false, error: err };
  }

  logger.info({ to }, '[mailer] verification e-mail sent');
  return { sent: true, info };
}
