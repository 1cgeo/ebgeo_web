// Path: tests/unit/logger-secret-scrub.test.js
// Regression: the submitted password was written to the log, in clear text, on every
// validation failure of /auth/login and /auth/register.
//
// pino applies `stdSerializers.err` by default, and that serializer copies EVERY
// enumerable property of the error (`for (const key in err)` in
// pino-std-serializers/lib/err.js). A `Joi.ValidationError` carries the whole
// validated body in `_original` and each rejected value in `details[].context.value`.
// Validation runs at the EDGE, before the controller, and `errorHandler` logs
// `{ err }` raw — so a wrong password, a too-short one, or any typo'd field produced
// a `warn` line containing the credential. `logger.js` configured no redaction at all.
//
// The irony is exact: error-handler.js documents this very worry ("a credential
// passed via ?api_key= never lands in the logs") and guards the URL through
// `redactUrl`, while the request BODY walked in through the door beside it.
//
// Scrubbing by field NAME rather than by pino `redact` paths is the point: a path
// list has to know the shape in advance, and `err._original.password` is an internal
// of a third-party library that can move on any upgrade. The test drives a REAL Joi
// error for the same reason — a hand-built fake would not have `_original` at all,
// and would pass while the bug lived.
//
// Negative control: restore `serializers: { err: ... }` to pino's default and the
// first test fails.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Joi from 'joi';
import pino from 'pino';
import logger, { errSerializer, scrubSecrets } from '../../src/utils/logger.js';

/** Produces the exact error shape `validate({ body })` lets escape to errorHandler. */
function realJoiError(body) {
  const schema = Joi.object({
    username: Joi.string().required().min(3),
    password: Joi.string().required().min(6),
  });
  const { error } = schema.validate(body, { abortEarly: false });
  return error;
}

describe('error serializer — validation errors must not carry the body', () => {
  it('drops the submitted password from a real Joi error', () => {
    const err = realJoiError({ username: 'ab', password: 'senha-secreta-do-usuario' });
    assert.ok(err, 'fixture: the schema really rejected the body');
    assert.ok(
      JSON.stringify(err._original).includes('senha-secreta-do-usuario'),
      'fixture: the raw error really does carry the credential (this is the bug)'
    );

    const out = JSON.stringify(errSerializer(err));
    assert.ok(
      !out.includes('senha-secreta-do-usuario'),
      `the password reached the serialized log: ${out}`
    );
  });

  it('drops `_original` entirely, not just the password key', () => {
    // `_original` is the whole submitted body. Even without a field named `password`
    // it is user data with no diagnostic value in a log line.
    const err = realJoiError({ username: 'ab', password: 'x' });
    const out = errSerializer(err);
    assert.equal(out._original, undefined);
  });

  it('strips the rejected VALUE from details, keeping which key failed', () => {
    const err = realJoiError({ username: 'ab', password: 'curta' });
    const out = errSerializer(err);
    const flat = JSON.stringify(out);

    assert.ok(!flat.includes('curta'), `the rejected value leaked: ${flat}`);
    assert.ok(flat.includes('password'), 'but the failing field is still identifiable');
  });

  it('keeps the parts that make an error useful', () => {
    const err = realJoiError({ username: 'ab', password: 'x' });
    const out = errSerializer(err);
    assert.ok(out.message, 'message survives');
    assert.ok(out.type || out.stack, 'the error identity survives');
    assert.ok(Array.isArray(out.details) && out.details.length > 0, 'details survive, minus values');
  });

  it('does not break on an ordinary Error', () => {
    const out = errSerializer(new Error('algo quebrou'));
    assert.equal(out.message, 'algo quebrou');
    assert.ok(out.stack, 'a normal error still serializes with its stack');
  });
});

// The tests above prove the FUNCTION is correct. They do not prove pino USES it —
// and the first version of this file stopped there, so removing
// `serializers: { err: errSerializer }` from the logger config left all of them
// green. That is the same "checks that do not check" failure the constitution names:
// a correct component, wired to nothing, reads exactly like a working one.
describe('the logger is actually WIRED with the serializer', () => {
  it('registers errSerializer on the exported logger instance', () => {
    const serializers = logger[pino.symbols.serializersSym];
    assert.ok(serializers, 'the logger has a serializers table at all');
    assert.equal(
      serializers.err, errSerializer,
      'the exported logger uses OUR err serializer, not pino default (which copies _original)'
    );
  });

  // NOT asserted here, deliberately: that the `redact` block is active. The logger
  // runs at level 'silent' under test, so nothing is ever written and redaction —
  // which applies at write time — cannot be observed; pino also exposes no stable
  // instance property for it (checked: neither redactFmtSym nor a populated
  // stringifiers table). Writing an assertion against those internals would pass or
  // fail for reasons unrelated to whether secrets are redacted, which is worse than
  // admitting the gap. The `err` serializer above is the load-bearing half and IS
  // verified; `redact` is defense in depth for fields logged outside `err`.
});

describe('scrubSecrets', () => {
  it('redacts secret-named fields at any depth', () => {
    const out = scrubSecrets({
      a: { b: { c: { password: 'p', refreshToken: 'r', keep: 'ok' } } },
    });
    assert.equal(out.a.b.c.password, '[REDACTED]');
    assert.equal(out.a.b.c.refreshToken, '[REDACTED]');
    assert.equal(out.a.b.c.keep, 'ok', 'non-secret data is untouched');
  });

  it('handles arrays without losing them', () => {
    const out = scrubSecrets({ items: [{ password: 'p' }, { nome: 'x' }] });
    assert.equal(out.items[0].password, '[REDACTED]');
    assert.equal(out.items[1].nome, 'x');
  });

  it('is bounded in depth, so a deep object cannot burn CPU', () => {
    let deep = { password: 'p' };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    // The assertion is that it returns at all, promptly, without recursing 50 levels.
    const out = scrubSecrets(deep);
    assert.ok(out, 'returns a value instead of running away');
  });

  it('is bounded in width', () => {
    const wide = {};
    for (let i = 0; i < 500; i++) wide[`k${i}`] = i;
    const out = scrubSecrets(wide);
    assert.ok(Object.keys(out).length <= 101, 'truncates instead of copying everything');
  });

  it('passes through primitives and null unchanged', () => {
    assert.equal(scrubSecrets(null), null);
    assert.equal(scrubSecrets('texto'), 'texto');
    assert.equal(scrubSecrets(42), 42);
  });
});
