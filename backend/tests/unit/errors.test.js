// Path: tests/unit/errors.test.js
// Tests for custom error classes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError, NotFoundError, ForbiddenError, UnauthorizedError,
  ConflictError, ValidationError, BadRequestError, ServiceUnavailableError,
} from '../../src/utils/errors.js';

describe('Error Classes', () => {
  it('AppError sets statusCode, code, and isOperational', () => {
    const err = new AppError('test', 500, 'TEST_ERROR');
    assert.equal(err.message, 'test');
    assert.equal(err.statusCode, 500);
    assert.equal(err.code, 'TEST_ERROR');
    assert.equal(err.isOperational, true);
    assert.ok(err instanceof Error);
  });

  it('NotFoundError: 404, NOT_FOUND, message includes resource name', () => {
    const err = new NotFoundError('Atlas');
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, 'NOT_FOUND');
    assert.equal(err.message, 'Atlas not found');

    const errDefault = new NotFoundError();
    assert.equal(errDefault.message, 'Resource not found');
  });

  it('ForbiddenError: 403, FORBIDDEN', () => {
    const err = new ForbiddenError();
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, 'FORBIDDEN');
    assert.equal(err.message, 'Insufficient permissions');

    const errCustom = new ForbiddenError('Access denied');
    assert.equal(errCustom.message, 'Access denied');
  });

  it('UnauthorizedError: 401, UNAUTHORIZED', () => {
    const err = new UnauthorizedError();
    assert.equal(err.statusCode, 401);
    assert.equal(err.code, 'UNAUTHORIZED');
    assert.equal(err.message, 'Authentication required');
  });

  it('ConflictError: 409, CONFLICT', () => {
    const err = new ConflictError('Duplicate');
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'CONFLICT');
    assert.equal(err.message, 'Duplicate');
  });

  it('ValidationError: 422, VALIDATION_ERROR with details', () => {
    const details = [{ field: 'name', message: 'required' }];
    const err = new ValidationError('Bad data', details);
    assert.equal(err.statusCode, 422);
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.deepEqual(err.details, details);

    const errDefault = new ValidationError();
    assert.equal(errDefault.message, 'Validation failed');
    assert.equal(errDefault.details, null);
  });

  it('BadRequestError: 400, BAD_REQUEST', () => {
    const err = new BadRequestError();
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'BAD_REQUEST');
    assert.equal(err.message, 'Bad request');
  });

  // ServiceUnavailableError was the ONLY subclass this file omitted, and no test
  // anywhere in the repo mentioned it. It is the RETRYABLE signal produced when the
  // per-atlas advisory lock of the sync push (and of the sv360 ingestion) hits its
  // `lock_timeout`: the client is expected to send the same batch again. A 500 in its
  // place tells the client "we broke", and the operation is dropped instead of retried,
  // so the status code and the code string are contract, not detail.
  it('ServiceUnavailableError: 503, SERVICE_UNAVAILABLE, operational, default message', () => {
    const err = new ServiceUnavailableError();
    assert.equal(err.statusCode, 503);
    assert.equal(err.code, 'SERVICE_UNAVAILABLE');
    assert.equal(err.isOperational, true, 'transient overload is EXPECTED, not a programming bug');
    assert.equal(err.message, 'Service temporarily unavailable');
    assert.ok(err instanceof AppError, 'must reach the errorHandler AppError branch');
    assert.ok(err instanceof Error);
  });

  it('ServiceUnavailableError preserves a custom message', () => {
    const err = new ServiceUnavailableError('atlas ocupado');
    assert.equal(err.message, 'atlas ocupado');
    assert.equal(err.statusCode, 503, 'a custom message must not disturb the status');
  });

  // 503 is a 5xx: it must NOT be reachable by any 4xx-shaped classification. This is
  // the discriminator against the errorHandler branch that maps 400..499 by status.
  it('ServiceUnavailableError sits OUTSIDE the 4xx client-error range', () => {
    const err = new ServiceUnavailableError();
    assert.ok(err.statusCode >= 500, 'a retryable overload is a server-side condition');
    assert.ok(!(err.statusCode >= 400 && err.statusCode < 500));
  });
});
