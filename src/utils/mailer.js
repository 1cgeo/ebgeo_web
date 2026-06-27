// Path: src/utils/mailer.js

/**
 * Outbound e-mail for account verification. Dependency-OPTIONAL and channel-agnostic:
 *
 *  - No SMTP host configured (dev/test, closed networks)  → NO-OP that LOGS the link.
 *  - SMTP host configured + `nodemailer` installed        → sends via SMTP.
 *  - SMTP host configured + `nodemailer` NOT installed    → logs a warning + the link
 *    (so the flow still works; wiring real SMTP is a deploy-time follow-up that adds
 *    the dependency, with NO change to callers).
 *
 * Keeping this dependency-optional means the verification flow is fully testable today
 * without pulling a mail library into the build.
 */

import config from '../config.js';
import logger from './logger.js';

/** @returns {boolean} Whether an SMTP transport is configured. */
export function isSmtpConfigured() {
  return Boolean(config.mail.host);
}

/**
 * Builds the verification link for a token, preferring the configured app base URL and
 * falling back to the request origin.
 * @param {string} token
 * @param {string} [origin] - Fallback origin (e.g. from the request) when APP_BASE_URL is unset.
 * @returns {string}
 */
export function buildVerificationLink(token, origin = '') {
  const base = (config.mail.appBaseUrl || origin || '').replace(/\/$/, '');
  return `${base}/?verify=${encodeURIComponent(token)}`;
}

/**
 * Lazily resolves an SMTP transport via `nodemailer`. Returns null when the dependency
 * is unavailable (so the caller falls back to logging).
 * @returns {Promise<Object|null>}
 */
async function getTransport() {
  try {
    const { default: nodemailer } = await import('nodemailer');
    return nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  } catch {
    return null;
  }
}

/**
 * Sends (or logs) an account-verification e-mail.
 * @param {{ to: string, link: string, nome?: string }} params
 * @returns {Promise<{ sent: boolean }>} sent=false when it was logged instead of mailed.
 */
export async function sendVerificationEmail({ to, link, nome }) {
  const subject = 'Confirme sua conta — EBGeo';
  const text =
    `Olá${nome ? ` ${nome}` : ''},\n\n` +
    `Confirme sua conta no EBGeo acessando o link abaixo:\n${link}\n\n` +
    `Se você não criou esta conta, ignore esta mensagem.`;

  if (!isSmtpConfigured()) {
    logger.info({ to, link }, '[mailer] SMTP not configured — verification link (no e-mail sent)');
    return { sent: false };
  }

  const transport = await getTransport();
  if (!transport) {
    logger.warn({ to, link }, '[mailer] SMTP configured but nodemailer unavailable — logging link');
    return { sent: false };
  }

  await transport.sendMail({ from: config.mail.from, to, subject, text });
  logger.info({ to }, '[mailer] verification e-mail sent');
  return { sent: true };
}
