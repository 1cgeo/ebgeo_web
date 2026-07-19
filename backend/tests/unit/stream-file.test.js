// Path: tests/unit/stream-file.test.js
// The error contract of streamFileToResponse, at the unit where every branch is
// reachable.
//
// The integration repro (tests/integration/stream-error-crash.repro.test.js) proves
// the real route survives an unreadable file, but it can only reach the non-Range
// call site: its fixture is a directory, which reports size 0, so parseRange refuses
// with 416 before opening anything. Here the range options go straight to the
// helper, so both call sites are actually exercised.
//
// What the fix has to get right, and what each test below pins:
//   - a read error must reach next(), not the event loop (that was the crash);
//   - once headers are out, next() would throw ERR_HTTP_HEADERS_SENT on top of the
//     original error, so the socket is destroyed instead;
//   - the file descriptor must not outlive either path.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { streamFileToResponse } from '../../src/utils/stream-file.js';

/**
 * Minimal writable-ish stand-in for a ServerResponse. It carries `headers` and
 * `statusCode` because the error path must UNDO the framing the caller set up
 * (Content-Length from the stat, Content-Range + 206 on the range branch) before
 * the error handler writes its envelope.
 */
function fakeRes({ headersSent = false } = {}) {
  const res = new EventEmitter();
  res.headersSent = headersSent;
  res.writable = true;
  res.destroyed = false;
  res.destroyedWith = null;
  res.headers = {};
  res.statusCode = 200;
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.removeHeader = (k) => { delete res.headers[k]; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.write = () => true;
  res.end = () => { res.ended = true; };
  res.destroy = (err) => { res.destroyed = true; res.destroyedWith = err; };
  res.on('error', () => {}); // a pipe destination without one would itself throw
  return res;
}

const MISSING = path.join(os.tmpdir(), `stream-file-missing-${process.pid}-nope.bin`);

describe('streamFileToResponse', () => {
  it('routes a read error to next() instead of throwing on the event loop', async () => {
    const res = fakeRes();
    const err = await new Promise((resolve) => {
      streamFileToResponse(res, resolve, MISSING);
    });

    assert.equal(err.code, 'ENOENT', 'the original filesystem error reaches the handler intact');
    assert.equal(res.destroyed, false, 'headers had not been sent, so the response is left to the error handler');
  });

  it('routes a read error from the RANGE call site too', async () => {
    const res = fakeRes();
    const err = await new Promise((resolve) => {
      streamFileToResponse(res, resolve, MISSING, { start: 0, end: 10 });
    });

    assert.equal(err.code, 'ENOENT', 'the range variant is a distinct call and needs its own guarantee');
  });

  // Found while fixing the crash: routing the error to next() is not enough on its
  // own. The caller has already framed the response for a file that turned out to be
  // unreadable, and a stale Content-Length: 0 truncates the error envelope to an
  // empty body — status looks correct, nothing arrives. A 206 left over from the
  // range branch mis-frames it the same way.
  it('clears the file framing so the error envelope is not truncated', async () => {
    const res = fakeRes();
    res.setHeader('Content-Length', 0);
    res.setHeader('Content-Range', 'bytes 0-10/0');
    res.setHeader('Content-Type', 'image/webp');
    res.status(206);

    await new Promise((resolve) => {
      streamFileToResponse(res, resolve, MISSING, { start: 0, end: 10 });
    });

    assert.equal(res.headers['Content-Length'], undefined, 'a stale Content-Length would truncate the envelope');
    assert.equal(res.headers['Content-Range'], undefined, 'and a stale Content-Range would mis-frame it');
    assert.equal(res.headers['Content-Type'], undefined, 'the body is now JSON, not the file type');
    assert.equal(res.statusCode, 200, 'the 206 is dropped so the error handler sets the real status');
  });

  it('destroys the response instead of calling next() once headers are sent', async () => {
    const res = fakeRes({ headersSent: true });
    let nextCalls = 0;

    streamFileToResponse(res, () => { nextCalls++; }, MISSING);
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(nextCalls, 0, 'next() after headersSent would throw ERR_HTTP_HEADERS_SENT over the real error');
    assert.equal(res.destroyed, true, 'the socket is torn down so the client sees a truncated body');
    assert.equal(res.destroyedWith?.code, 'ENOENT', 'and it is destroyed WITH the cause, not silently');
  });

  it('closes the file descriptor when the client disconnects mid-stream', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stream-file-'));
    const file = path.join(dir, 'payload.bin');
    writeFileSync(file, Buffer.alloc(1024 * 512, 7)); // big enough not to finish in one tick

    try {
      const res = fakeRes();
      const rs = streamFileToResponse(res, () => {}, file);

      res.emit('close'); // the client went away
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(rs.destroyed, true, 'an abandoned download must not keep reading into a dead socket');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('streams a readable file through untouched', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stream-file-ok-'));
    const file = path.join(dir, 'ok.bin');
    writeFileSync(file, 'conteudo');

    try {
      const res = fakeRes();
      const chunks = [];
      res.write = (c) => { chunks.push(Buffer.from(c)); return true; };

      let failed = null;
      streamFileToResponse(res, (e) => { failed = e; }, file);
      await new Promise((r) => setTimeout(r, 40));

      assert.equal(failed, null, 'the happy path does not go through the error branch');
      assert.equal(Buffer.concat(chunks).toString(), 'conteudo', 'the bytes still arrive');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
