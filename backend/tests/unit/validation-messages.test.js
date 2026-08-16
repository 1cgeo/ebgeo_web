// Path: tests/unit/validation-messages.test.js

/**
 * The pt-BR rendering of Joi failures (`utils/validation-messages.js`).
 *
 * These strings are USER-FACING: the web client folds `details[].message` straight into the
 * text it shows (`buildApiErrorMessage`, `frontend/src/js/store/sync/api-client.js`), so a
 * regression here is read by a human, not by a log.
 *
 * The cases that matter are the two degradations, because they are what keeps the table
 * honest as the API grows: an unmapped RULE must fall back to Joi's own sentence (wrong
 * language, never a missing message), and an unmapped FIELD must keep its wire name.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Joi from 'joi';
import { translateJoiDetail, toValidationDetails } from '../../src/utils/validation-messages.js';

/** Runs a real Joi validation so the details carry Joi's own `type`/`context`, not a fixture. */
function detailsOf(schema, value) {
  const { error } = schema.validate(value, { abortEarly: false });
  return error ? error.details : [];
}

describe('validation-messages — pt-BR rendering of Joi details', () => {
  it('renders the rules a login/registration form can hit', () => {
    const schema = Joi.object({
      password: Joi.string().required().min(6).max(100),
      nome: Joi.string().required(),
      email: Joi.string().email(),
      role: Joi.string().valid('user', 'admin'),
    });

    const byField = new Map(
      toValidationDetails(detailsOf(schema, {
        password: '123', email: 'nao-e-email', role: 'chefe',
      })).map((d) => [d.field, d.message])
    );

    assert.equal(byField.get('password'), 'Senha deve ter ao menos 6 caracteres.');
    assert.equal(byField.get('nome'), 'Informe nome.');
    assert.equal(byField.get('email'), 'E-mail não é um endereço de e-mail válido.');
    assert.equal(byField.get('role'), 'Papel deve ser "user" ou "admin".');
  });

  it('quotes the rule\'s own number, so the message says what to do', () => {
    const [tooLong] = detailsOf(Joi.object({ nome: Joi.string().max(4) }), { nome: 'Silveira' });
    assert.equal(translateJoiDetail(tooLong), 'Nome deve ter no máximo 4 caracteres.');
  });

  it('keeps the WIRE path in `field` while translating only `message`', () => {
    // `field` is a machine key: clients and tests match on it, and an accented pt-BR label
    // there would break them. Only the sentence is for humans.
    const schema = Joi.object({ body: Joi.object({ password: Joi.string().required() }) });
    const [detail] = toValidationDetails(detailsOf(schema, { body: {} }));

    assert.equal(detail.field, 'body.password');
    assert.equal(detail.message, 'Informe senha.');
  });

  it('DEGRADES an unmapped rule to Joi\'s own sentence instead of dropping it', () => {
    const joiSaid = 'something Joi says that this table never mapped';
    assert.equal(
      translateJoiDetail({ type: 'string.hex', path: ['token'], message: joiSaid }),
      joiSaid
    );
  });

  it('DEGRADES an unmapped field to its wire name instead of inventing a label', () => {
    // `lamportTimestamp` is a sync-envelope field no human ever types; the table deliberately
    // does not carry it, and the wire name is what a developer reading the 422 wants.
    const [detail] = detailsOf(Joi.object({ lamportTimestamp: Joi.number() }), {
      lamportTimestamp: 'agora',
    });
    assert.equal(translateJoiDetail(detail), 'lamportTimestamp deve ser um número.');
  });

  it('survives malformed input rather than throwing inside the error handler', () => {
    // This code runs INSIDE `errorHandler`. A throw here replaces the client's 422 with a
    // truncated socket, so every shape has to have an answer.
    assert.equal(translateJoiDetail(null), 'Valor inválido.');
    assert.equal(translateJoiDetail({}), 'Valor inválido.');
    assert.equal(
      translateJoiDetail({ type: 'string.min', path: [], context: { limit: 3 } }),
      'O valor enviado deve ter ao menos 3 caracteres.'
    );
    assert.deepEqual(toValidationDetails(null), []);
    assert.deepEqual(toValidationDetails('boom'), []);
  });

  it('skips Joi\'s null placeholder when listing allowed values', () => {
    const [detail] = detailsOf(
      Joi.object({ permission: Joi.string().valid('read', 'write').allow(null) }),
      { permission: 'tudo' }
    );
    assert.equal(translateJoiDetail(detail), 'Permissão deve ser "read" ou "write".');
  });
});

describe('validation-messages — every `.pattern()` carries its own pt-BR message', () => {
  it('because the table deliberately does not map `string.pattern.base`', () => {
    // The one rule `validation-messages.js` refuses to translate generically: only the schema
    // knows what its regex means. The cost of that decision is that a `.pattern()` written
    // without `.messages()` silently ships Joi's English sentence, so the decision needs a
    // guard rather than a convention nobody remembers.
    const files = execFileSync('git', ['ls-files', 'src/**/*.schemas.js'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    assert.ok(files.length >= 15, `expected the schema files to be found, got ${files.length}`);

    const missing = [];
    let patternsSeen = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Only the STRING `.pattern(/regex/)` is in scope. `Joi.object().pattern(key, value)`
      // is a different method with the same name — it declares dynamic keys and never emits
      // `string.pattern.base` — so requiring a message from it would be requiring a message
      // for an error that cannot happen. The leading `/` is what tells them apart.
      //
      // A field runs from one `.pattern(` to the next, so a message that belongs to a LATER
      // field cannot vouch for this one. The lookahead is what makes the check per-field.
      for (const match of source.matchAll(/\.pattern\(\/([\s\S]*?)(?=\.pattern\(|$)/g)) {
        patternsSeen += 1;
        if (!/'string\.pattern\.(invert\.)?base'/.test(match[1])) {
          missing.push(`${file}: ${match[0].slice(0, 60).replace(/\s+/g, ' ')}…`);
        }
      }
    }

    assert.ok(patternsSeen >= 4, `the scan found only ${patternsSeen} patterns — it stopped matching`);
    assert.deepEqual(missing, [], 'these `.pattern()` calls have no pt-BR message of their own');
  });
});
