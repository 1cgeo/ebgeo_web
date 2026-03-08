// Path: tests/unit/middleware-error-handler.test.js
// Tests for the centralized error handler middleware.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../../src/middleware/error-handler.js';
import {
  AppError, NotFoundError, ForbiddenError, UnauthorizedError,
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
});
