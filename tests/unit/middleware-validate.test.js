// Path: tests/unit/middleware-validate.test.js
// Tests for the Joi validation middleware.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Joi from 'joi';
import { validate } from '../../src/middleware/validate.js';

function mockReq(overrides = {}) {
  return { body: {}, params: {}, query: {}, ...overrides };
}

describe('validate() middleware', () => {
  it('passes when body schema validates successfully', (_, done) => {
    const schema = { body: Joi.object({ name: Joi.string().required() }) };
    const middleware = validate(schema);
    const req = mockReq({ body: { name: 'test' } });

    middleware(req, {}, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.body.name, 'test');
      done();
    });
  });

  it('strips unknown fields from body (stripUnknown: true)', (_, done) => {
    const schema = { body: Joi.object({ name: Joi.string().required() }) };
    const middleware = validate(schema);
    const req = mockReq({ body: { name: 'test', extra: 'should-be-removed' } });

    middleware(req, {}, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.body.name, 'test');
      assert.equal(req.body.extra, undefined);
      done();
    });
  });

  it('calls next(error) when body is invalid', (_, done) => {
    const schema = { body: Joi.object({ name: Joi.string().required() }) };
    const middleware = validate(schema);
    const req = mockReq({ body: {} });

    middleware(req, {}, (err) => {
      assert.ok(err);
      assert.ok(err.isJoi);
      done();
    });
  });

  it('validates params when params schema is provided', (_, done) => {
    const schema = { params: Joi.object({ id: Joi.string().uuid().required() }) };
    const middleware = validate(schema);
    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    const req = mockReq({ params: { id: validUUID } });

    middleware(req, {}, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.params.id, validUUID);
      done();
    });
  });

  it('validates query when query schema is provided', (_, done) => {
    const schema = { query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) };
    const middleware = validate(schema);
    const req = mockReq({ query: {} });

    middleware(req, {}, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.query.page, 1); // default applied
      done();
    });
  });

  it('validates multiple sources simultaneously (body + params)', (_, done) => {
    const schema = {
      body: Joi.object({ name: Joi.string().required() }),
      params: Joi.object({ id: Joi.string().required() }),
    };
    const middleware = validate(schema);
    const req = mockReq({ body: { name: 'test' }, params: { id: 'abc' } });

    middleware(req, {}, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.body.name, 'test');
      assert.equal(req.params.id, 'abc');
      done();
    });
  });

  it('stops at first invalid source (body fails, params not checked)', (_, done) => {
    const schema = {
      body: Joi.object({ name: Joi.string().required() }),
      params: Joi.object({ id: Joi.string().required() }),
    };
    const middleware = validate(schema);
    const req = mockReq({ body: {}, params: {} }); // both invalid

    middleware(req, {}, (err) => {
      assert.ok(err);
      assert.ok(err.isJoi);
      // Error should be from body (processed first), not params
      assert.ok(err.details.some(d => d.path.includes('name')));
      done();
    });
  });

  it('skips sources without a schema', (_, done) => {
    const schema = { body: Joi.object({ x: Joi.number() }) };
    const middleware = validate(schema);
    const req = mockReq({ body: { x: 42 }, query: { anything: 'goes' } });

    middleware(req, {}, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.body.x, 42);
      assert.equal(req.query.anything, 'goes'); // untouched
      done();
    });
  });
});
