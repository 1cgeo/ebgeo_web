// Path: tests/unit/mailer-verification-link.test.js
// Two defects on the account-verification token, both reachable by default.
//
// 1. HOST-HEADER INJECTION (bugs-backend #58). `buildVerificationLink` fell back to
//    `origin`, and the only caller derives that from client headers:
//    `req.headers.origin || \`${req.protocol}://${req.get('host')}\``
//    (auth.controller.js:29-31). `POST /auth/resend-verification` is mounted
//    unconditionally and without `auth`, and takes an arbitrary e-mail in the body.
//    So an anonymous attacker sends `Origin: https://evil.example` with a victim's
//    address, and the server mails a GENUINE message, from the real MAIL_FROM, whose
//    link points at the attacker's host and carries the victim's real, unconsumed
//    token. The only thing that prevented it was APP_BASE_URL being set — and that is
//    `optional('APP_BASE_URL', '')`, not required in production, unlike CORS_ORIGIN
//    which the same function does require there. The factory default in production
//    WAS the vulnerable path.
//
// 2. TOKEN IN THE LOGS (bugs-backend #66). Both no-SMTP branches logged the full link,
//    token included, next to the recipient's address. Not an edge case: `nodemailer`
//    is absent from package.json, so `getTransport()` always returns null and every
//    configuration alive today takes one of those branches. Anyone reading the logs —
//    an operator, or a shipping pipeline like Loki/ELK — can copy the token and POST
//    /auth/verify-email to activate someone else's account with no mailbox access.
//    `redactUrl` cannot help: it only rewrites `req.url`, and `verify` is not even in
//    SENSITIVE_QUERY_KEYS.
//
// TESTABILITY NOTE. The first version of this file tried to swap `config.mail` with
// Object.defineProperty and every test failed, including two that should have passed
// — the object is frozen. That is a design signal, not an obstacle: the fix exposes a
// PURE resolver (`resolveVerificationBase`) and an INJECTABLE flag (`exposeLink`), so
// both branches are reachable without mutating module globals.
//
// Negative controls: make resolveVerificationBase return `origin` unconditionally and
// the injection tests fail; put `link` back in the production log object and the leak
// test fails.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveVerificationBase, buildVerificationLink, buildAppLink, sendVerificationEmail,
  sendAccountExistsEmail, _resetTransportForTests,
} from '../../src/utils/mailer.js';
import logger from '../../src/utils/logger.js';

const APP_BASE = 'https://ebgeo.eb.mil.br';
const EVIL = 'https://evil.example';

/** Captures everything pino is asked to write, at any level. */
function captureLogs() {
  const entries = [];
  const levels = ['info', 'warn', 'error', 'debug'];
  const originals = {};
  for (const lvl of levels) {
    originals[lvl] = logger[lvl];
    logger[lvl] = (obj, msg) => { entries.push({ lvl, obj, msg }); };
  }
  return {
    entries,
    restore: () => { for (const lvl of levels) logger[lvl] = originals[lvl]; },
    /** The serialized form an aggregator would actually receive. */
    text: () => JSON.stringify(entries),
  };
}

describe('resolveVerificationBase — which host may receive the token', () => {
  it('prefers the configured app base URL over any client origin', () => {
    const base = resolveVerificationBase(EVIL, { appBaseUrl: APP_BASE });
    assert.equal(base, APP_BASE, 'a client header must never outrank the deployment config');
  });

  it('refuses an unrecognised origin when no base URL is configured', () => {
    // The factory default in production: APP_BASE_URL unset. The old code fell
    // straight through to the attacker's origin here.
    const base = resolveVerificationBase(EVIL, { appBaseUrl: '', allowedOrigin: APP_BASE });
    assert.equal(base, '', 'unset APP_BASE_URL must not mean "trust the caller"');
  });

  it('accepts the origin only when it is the one CORS already trusts', () => {
    const base = resolveVerificationBase(APP_BASE, { appBaseUrl: '', allowedOrigin: APP_BASE });
    assert.equal(base, APP_BASE, 'the legitimate single-origin deployment still works');
  });

  it('is not fooled by a trailing slash on either side', () => {
    const base = resolveVerificationBase(`${APP_BASE}/`, { allowedOrigin: APP_BASE });
    assert.equal(base, APP_BASE);
  });

  it('refuses a lookalike origin that merely starts with the trusted one', () => {
    // Guards against a prefix comparison being substituted for equality later.
    const base = resolveVerificationBase(`${APP_BASE}.evil.example`, { allowedOrigin: APP_BASE });
    assert.equal(base, '', 'suffix-appending must not pass');
  });

  it('refuses an empty origin rather than producing a scheme-relative link', () => {
    assert.equal(resolveVerificationBase('', { allowedOrigin: APP_BASE }), '');
  });
});

describe('buildVerificationLink', () => {
  it('embeds the token url-encoded', () => {
    const link = buildVerificationLink('a b+c/d');
    assert.ok(link.includes(`verify=${encodeURIComponent('a b+c/d')}`), link);
  });

  it('never points at a host supplied by the caller', () => {
    const link = buildVerificationLink('tok-123', EVIL);
    assert.ok(!link.includes('evil.example'), `client header steered the link: ${link}`);
  });
});

// ============================================================================
// The account-exists notice — where the enumeration answer went (2026-07-25)
// ============================================================================
// POST /auth/register answered 409 for a taken e-mail and 201 otherwise, so anyone
// could enumerate accounts one request at a time. It now answers 201 either way and
// tells the MAILBOX instead. That only holds if this message behaves like the other
// one in every observable respect: same containment of failures (a throw only on the
// "exists" branch would be a 500-shaped oracle) and no credential in it.

describe('buildAppLink — the token-free link in the account-exists notice', () => {
  it('follows the same trust rules as the verification link', () => {
    assert.equal(buildAppLink(EVIL), '', 'a client header must not steer the link');
  });

  it('returns empty rather than a bare relative slash when no base is trustworthy', () => {
    // '/' alone in an e-mail body is noise, not a link — the caller drops the sentence.
    assert.equal(buildAppLink(''), '');
  });
});

describe('account-exists notice', () => {
  let cap;

  beforeEach(() => { cap = captureLogs(); _resetTransportForTests(); });
  afterEach(() => { cap.restore(); _resetTransportForTests(); });

  it('does not name the registrant, whose name is attacker-controlled here', async () => {
    // On this branch the payload was typed by whoever attempted the signup, and the
    // message goes to SOMEBODY ELSE'S mailbox. Echoing their `nome` would let anyone
    // mail arbitrary text to any address from the real MAIL_FROM.
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ jsonTransport: true });

    const result = await sendAccountExistsEmail(
      { to: 'dono@exemplo.mil.br', appLink: `${APP_BASE}/` },
      { exposeLink: false, transport }
    );

    const msg = JSON.parse(result.info.message);
    assert.equal(msg.to[0].address, 'dono@exemplo.mil.br');
    assert.ok(msg.subject && msg.subject.length > 0, 'has a subject');
    assert.ok(msg.text.includes(`${APP_BASE}/`), 'carries the app link');
    assert.ok(!msg.text.includes('verify='), 'and carries no verification token');
  });

  it('says the same thing whether the e-mail or the username was the collision', async () => {
    // Two wordings would hand the oracle back through the mail channel: authLimiter
    // keys on `${ip}:${username}`, so a fresh username per probe is never throttled and
    // an attacker mailing their own address could enumerate usernames for free.
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const enviar = (to) => sendAccountExistsEmail({ to, appLink: `${APP_BASE}/` }, { transport });

    const a = JSON.parse((await enviar('um@exemplo.mil.br')).info.message);
    const b = JSON.parse((await enviar('outro@exemplo.mil.br')).info.message);

    assert.equal(a.subject, b.subject);
    assert.equal(a.text, b.text, 'the body carries no case-specific detail at all');
  });

  it('a delivery failure is contained, never thrown', async () => {
    // register() sends this INSIDE the "already exists" branch. An escaping throw would
    // answer 500 for an existing account and 201 for a new one — the sharpest form of
    // the oracle the 201 was introduced to close.
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: '127.0.0.1', port: 1,
      connectionTimeout: 200, greetingTimeout: 200, socketTimeout: 200,
    });

    let threw = null;
    let result;
    try {
      result = await sendAccountExistsEmail({ to: 'dono@exemplo.mil.br' }, { transport });
    } catch (err) {
      threw = err;
    }

    assert.equal(threw, null, 'a broken SMTP server must not surface as an exception');
    assert.equal(result.sent, false);
    assert.ok(cap.entries.some((e) => e.lvl === 'error'), 'and it is reported, not swallowed');
  });

  it('with no SMTP it degrades to a log line, like every other message here', async () => {
    const res = await sendAccountExistsEmail({ to: 'dev@exemplo.mil.br' }, { exposeLink: true });
    assert.equal(res.sent, false);
    assert.ok(cap.text().includes('dev@exemplo.mil.br'), 'the event is auditable');
  });
});

describe('verification e-mail logging', () => {
  let cap;

  beforeEach(() => { cap = captureLogs(); });
  afterEach(() => { cap.restore(); });

  it('NEVER writes the token to the log in production', async () => {
    await sendVerificationEmail(
      { to: 'alvo@exemplo.mil.br', link: `${APP_BASE}/?verify=SEGREDO-DO-TOKEN`, nome: 'Alvo' },
      { exposeLink: false }
    );

    assert.ok(!cap.text().includes('SEGREDO-DO-TOKEN'), `the token reached the logs: ${cap.text()}`);
    assert.ok(cap.entries.length > 0, 'but the event itself is still reported');
  });

  it('reports the production failure above info level, so it is not silent', async () => {
    const res = await sendVerificationEmail(
      { to: 'alvo@exemplo.mil.br', link: `${APP_BASE}/?verify=OUTRO-TOKEN` },
      { exposeLink: false }
    );

    assert.equal(res.sent, false, 'nothing was actually mailed');
    assert.ok(
      cap.entries.some((e) => e.lvl === 'error' || e.lvl === 'warn'),
      'a deploy that cannot send verification e-mail must say so louder than info'
    );
  });

  it('still logs the link outside production, which is how dev verifies accounts', async () => {
    // Removing the dev affordance would break local signup for no security gain: the
    // logging exists because there is no SMTP in development.
    await sendVerificationEmail(
      { to: 'dev@exemplo.mil.br', link: `${APP_BASE}/?verify=TOKEN-DEV`, nome: 'Dev' },
      { exposeLink: true }
    );

    assert.ok(cap.text().includes('TOKEN-DEV'), 'the local flow keeps working');
  });

  it('always logs the recipient, so the event is auditable either way', async () => {
    await sendVerificationEmail(
      { to: 'alguem@exemplo.mil.br', link: `${APP_BASE}/?verify=X` },
      { exposeLink: false }
    );
    assert.ok(cap.text().includes('alguem@exemplo.mil.br'), 'who it was for is not the secret');
  });
});

// ============================================================================
// SMTP delivery — reachable only since `nodemailer` became a real dependency
// ============================================================================
// The library was never in package.json, so `getTransport()` always threw and
// returned null and `sendMail` was never called by anyone, in any environment. These
// tests cover the code that installing it brought to life. They drive nodemailer's
// own `jsonTransport`/stream transports rather than a hand-rolled stub, so they fail
// if the real API shape changes.

describe('SMTP delivery', () => {
  let cap;

  beforeEach(() => { cap = captureLogs(); _resetTransportForTests(); });
  afterEach(() => { cap.restore(); _resetTransportForTests(); });

  it('nodemailer is really installed and exposes createTransport', async () => {
    // Guards the actual regression: the feature was documented, tested and inert
    // because the dependency was absent. If it disappears again, this says so
    // directly instead of leaving every send silently degrading to a log line.
    const { default: nodemailer } = await import('nodemailer');
    assert.equal(typeof nodemailer.createTransport, 'function');
  });

  it('a delivery failure is contained, never thrown', async () => {
    // resendVerification does NOT wrap this call. If a send throw escaped, an unknown
    // address would answer 200 (no send attempted) while a KNOWN address whose send
    // failed would answer 500 — turning the endpoint into an existence oracle, which
    // the rest of the auth module is carefully written to avoid.
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: '127.0.0.1', port: 1, // nothing listens here
      connectionTimeout: 200, greetingTimeout: 200, socketTimeout: 200,
    });

    let threw = null;
    let result;
    try {
      result = await sendVerificationEmail(
        { to: 'alvo@exemplo.mil.br', link: `${APP_BASE}/?verify=T`, nome: 'Alvo' },
        { exposeLink: false, transport }
      );
    } catch (err) {
      threw = err;
    }

    assert.equal(threw, null, 'a broken SMTP server must not surface as an exception');
    assert.equal(result.sent, false, 'and the caller is told it did not go out');
    assert.ok(
      cap.entries.some((e) => e.lvl === 'error'),
      'the failure is reported at error level, not swallowed silently'
    );
  });

  it('a successful send reports sent:true and does not log the token', async () => {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ jsonTransport: true });

    const result = await sendVerificationEmail(
      { to: 'ok@exemplo.mil.br', link: `${APP_BASE}/?verify=TOKEN-ENVIADO`, nome: 'OK' },
      { exposeLink: false, transport }
    );

    assert.equal(result.sent, true, 'the message really went through the transport');
    assert.ok(
      !cap.text().includes('TOKEN-ENVIADO'),
      'a successful send must not log the credential either'
    );
  });

  it('the message carries the link, the recipient and a subject', async () => {
    // jsonTransport hands back exactly what would have gone on the wire, so this
    // asserts the payload instead of trusting that sendMail was called.
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ jsonTransport: true });

    const link = `${APP_BASE}/?verify=CONTEUDO`;
    const result = await sendVerificationEmail(
      { to: 'destino@exemplo.mil.br', link, nome: 'Fulano' },
      { exposeLink: false, transport }
    );

    const msg = JSON.parse(result.info.message);
    assert.equal(msg.to[0].address, 'destino@exemplo.mil.br');
    assert.ok(msg.subject && msg.subject.length > 0, 'has a subject');
    assert.ok(msg.text.includes(link), 'the body carries the verification link');
    assert.ok(msg.text.includes('Fulano'), 'and greets the user by name');
  });
});
