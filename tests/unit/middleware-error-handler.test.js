// Path: tests/unit/middleware-error-handler.test.js
// Tests for the centralized error handler middleware.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../../src/middleware/error-handler.js';
import {
  NotFoundError, ForbiddenError, UnauthorizedError,
  ValidationError, ConflictError, BadRequestError,
} from '../../src/utils/errors.js';

function mockReq() {
  return { method: 'GET', url: '/test', user: { id: 'u1' } };
}

function mockRes() {
  let _status = null;
  let _json = null;
  return {
    status(code) { _status = code; return this; },
    json(body) { _json = body; return this; },
    get statusCode() { return _status; },
    get body() { return _json; },
  };
}

describe('errorHandler middleware', () => {
  it('handles Joi validation errors → 422 with details', () => {
    const joiError = {
      isJoi: true,
      details: [
        { path: ['body', 'name'], message: '"name" is required' },
        { path: ['body', 'email'], message: '"email" must be valid' },
      ],
    };
    const res = mockRes();
    errorHandler(joiError, mockReq(), res, () => {});

    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details.length, 2);
    assert.equal(res.body.error.details[0].field, 'body.name');
  });

  it('handles NotFoundError → 404', () => {
    const res = mockRes();
    errorHandler(new NotFoundError('Atlas'), mockReq(), res, () => {});

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'Atlas not found');
  });

  it('handles UnauthorizedError → 401', () => {
    const res = mockRes();
    errorHandler(new UnauthorizedError('Token expired'), mockReq(), res, () => {});

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
    assert.equal(res.body.error.message, 'Token expired');
  });

  it('handles ForbiddenError → 403', () => {
    const res = mockRes();
    errorHandler(new ForbiddenError(), mockReq(), res, () => {});

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('handles ConflictError → 409', () => {
    const res = mockRes();
    errorHandler(new ConflictError('Duplicate'), mockReq(), res, () => {});

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  it('handles ValidationError with details', () => {
    const details = [{ field: 'name', message: 'required' }];
    const res = mockRes();
    errorHandler(new ValidationError('Invalid data', details), mockReq(), res, () => {});

    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(res.body.error.details, details);
  });

  it('handles unknown errors → 500 with INTERNAL_ERROR', () => {
    const res = mockRes();
    errorHandler(new Error('Something broke'), mockReq(), res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });

  it('handles BadRequestError → 400', () => {
    const res = mockRes();
    errorHandler(new BadRequestError('Invalid input'), mockReq(), res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  // --- PostgreSQL SQLSTATE mapping (no more raw 500s on constraint/cast errors) ---
  const PG_CASES = [
    { code: '23505', status: 409, errCode: 'CONFLICT' },   // unique_violation
    { code: '23503', status: 409, errCode: 'CONFLICT' },   // foreign_key_violation
    { code: '23502', status: 400, errCode: 'BAD_REQUEST' }, // not_null_violation
    { code: '23514', status: 400, errCode: 'BAD_REQUEST' }, // check_violation
    { code: '22P02', status: 400, errCode: 'BAD_REQUEST' }, // invalid_text_representation (bad uuid/enum)
    { code: '22003', status: 400, errCode: 'BAD_REQUEST' }, // numeric_value_out_of_range
  ];
  for (const c of PG_CASES) {
    it(`maps PG ${c.code} → ${c.status} ${c.errCode}`, () => {
      // Simulate a driver error: a plain Error carrying the SQLSTATE in .code, with
      // a leaky message (column/constraint names) that MUST NOT be forwarded.
      const pgErr = Object.assign(new Error('duplicate key value violates unique constraint "users_username_key"'), { code: c.code });
      const res = mockRes();
      errorHandler(pgErr, mockReq(), res, () => {});

      assert.equal(res.statusCode, c.status);
      assert.equal(res.body.error.code, c.errCode);
      assert.ok(!/users_username_key|duplicate key/.test(res.body.error.message), 'must not leak the raw driver message');
    });
  }

  it('does NOT treat pg-promise QueryResultError (numeric .code) as a SQLSTATE', () => {
    // pg-promise QueryResultError uses a small integer code (e.g. 0); it must fall
    // through to the unknown-error 500 path, not the string-keyed PG map.
    const qre = Object.assign(new Error('No data returned from the query.'), { code: 0 });
    const res = mockRes();
    errorHandler(qre, mockReq(), res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });

  it('masks internals on unknown errors (prod contract): no raw message, no stack', () => {
    // In NODE_ENV=test config.isDev is false → the production masking branch runs.
    // This pins the info-leak protection: the driver/stack must never reach the client.
    const res = mockRes();
    errorHandler(new Error('secret internal failure at /etc/passwd'), mockReq(), res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.equal(res.body.error.message, 'Something went wrong', 'raw message must be masked');
    assert.equal(res.body.error.stack, undefined, 'stack must never be exposed outside dev');
  });

  // --- Non-AppError client errors (body-parser) keep their 4xx status but must be
  //     labeled as client errors, not masqueraded as INTERNAL_ERROR ---
  it('maps a body-parser 400 (malformed JSON) → BAD_REQUEST, not INTERNAL_ERROR', () => {
    // express.json throws an Error with statusCode 400 + type 'entity.parse.failed'.
    const parseErr = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
      statusCode: 400,
      status: 400,
      type: 'entity.parse.failed',
    });
    const res = mockRes();
    errorHandler(parseErr, mockReq(), res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST', 'client-caused 400 must not be INTERNAL_ERROR');
  });

  it('maps a body-parser 413 (payload too large) → PAYLOAD_TOO_LARGE', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      statusCode: 413,
      status: 413,
      type: 'entity.too.large',
    });
    const res = mockRes();
    errorHandler(tooLarge, mockReq(), res, () => {});

    assert.equal(res.statusCode, 413);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  // --- The client-error code must be derived from the status, never contradict it ---
  it('labels a non-AppError 404 as NOT_FOUND, not BAD_REQUEST', () => {
    // A 4xx raised by third-party middleware (http-errors style) must not be
    // handed to the client with a code that disagrees with its status — clients
    // key off error.code.
    const notFound = Object.assign(new Error('Not Found'), { statusCode: 404, expose: true });
    const res = mockRes();
    errorHandler(notFound, mockReq(), res, () => {});

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND', 'code must match the status, not default to BAD_REQUEST');
  });

  it('labels a non-AppError 415 as UNSUPPORTED_MEDIA_TYPE', () => {
    const unsupported = Object.assign(new Error('unsupported content-type'), {
      statusCode: 415,
      expose: true,
    });
    const res = mockRes();
    errorHandler(unsupported, mockReq(), res, () => {});

    assert.equal(res.statusCode, 415);
    assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  // --- Raw messages only cross the boundary when explicitly marked safe ---
  it('forwards the message of an `expose: true` error (body-parser convention)', () => {
    // http-errors (what body-parser throws) sets expose=true for 4xx, marking the
    // message as safe to show the caller.
    const parseErr = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
      statusCode: 400,
      expose: true,
      type: 'entity.parse.failed',
    });
    const res = mockRes();
    errorHandler(parseErr, mockReq(), res, () => {});

    assert.equal(res.body.error.message, 'Unexpected token } in JSON');
  });

  it('masks the message of a 4xx that does NOT set expose (may hold server internals)', () => {
    // A third-party error carrying a 4xx status but no expose flag is not
    // guaranteed to be client-safe — it must not leak outside dev.
    const leaky = Object.assign(new Error('/var/app/secret/path failed to open'), {
      statusCode: 403,
    });
    const res = mockRes();
    errorHandler(leaky, mockReq(), res, () => {});

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.equal(res.body.error.message, 'Bad request', 'unexposed message must be masked');
    assert.doesNotMatch(res.body.error.message, /secret/, 'internal path must never leak');
  });
});
