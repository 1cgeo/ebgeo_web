// Path: tests/unit/request-aborted-log.test.js
import { it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import logger from '../../src/utils/logger.js';
import { requestLogger } from '../../src/middleware/request-logger.js';

it('records an aborted anonymous request once as 499, never as successful 200', () => {
  const records = [];
  const warn = mock.method(logger, 'warn', value => records.push(value));
  const info = mock.method(logger, 'info', value => records.push(value));
  try {
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false });
    requestLogger({ headers: {}, method: 'GET', url: '/api/config', ip: '127.0.0.1' }, res, () => {});
    res.emit('close'); res.emit('finish');
    assert.equal(records.length, 1);
    assert.equal(records[0].statusCode, 499);
    assert.equal(records[0].aborted, true);
    assert.ok(records[0].reqId);
  } finally { warn.mock.restore(); info.mock.restore(); }
});
