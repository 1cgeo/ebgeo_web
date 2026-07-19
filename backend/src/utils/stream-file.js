// Path: src/utils/stream-file.js
// Streams a file to the response with the source's errors actually handled.
//
// `createReadStream(p).pipe(res)` only wires the DESTINATION. It does not forward
// the source's errors, so a Readable that emits 'error' with no listener throws on
// a later tick — outside the handler's promise chain, where `asyncHandler`'s
// `.catch(next)` cannot reach it and `errorHandler` never runs. With no
// `process.on('uncaughtException')` in this backend, that ends the process: every
// collab WebSocket drops and the frontend stops booting, since its boot is
// fail-fast on `GET /api/config` with no static fallback.
//
// The window is real. Both callers validate the path with `fs.stat`/`existsSync`
// and open it LATER (assets3d.service.js resolveAsset, sv360.service.js
// resolveThumbnailPath), and `npm run deploy` publishes by swapping a symlink
// under the running process. ENOENT, EACCES, EISDIR and EBUSY all land here.

import { createReadStream } from 'node:fs';

/**
 * Pipes `filePath` to `res`, routing any read error to the error handler.
 *
 * Headers may already be flushed by the time the failure surfaces (a mid-stream
 * EIO on a network volume). Once that has happened the status line is spent and
 * `next(err)` would throw ERR_HTTP_HEADERS_SENT on top of the original error, so
 * the only honest move left is to destroy the socket and let the client see a
 * truncated body. Before the flush, the request still gets a normal envelope.
 *
 * @param {import('http').ServerResponse} res
 * @param {Function} next - Express next, for the pre-headers case
 * @param {string} filePath
 * @param {{start?: number, end?: number}} [opts] - Byte range for a 206 response
 * @returns {import('fs').ReadStream}
 */
export function streamFileToResponse(res, next, filePath, opts) {
  const rs = createReadStream(filePath, opts);

  rs.on('error', (err) => {
    // Stop reading before responding: on the headers-sent path the socket is about
    // to die, and leaving the fd open leaks it for the lifetime of the process.
    rs.destroy();
    if (res.headersSent) {
      res.destroy(err);
      return;
    }

    // The caller already shaped this response for a file that turned out to be
    // unreadable: Content-Length from the stat, plus Content-Range and a 206 status
    // on the range branch. Left in place, they truncate or mis-frame the error
    // envelope the handler is about to write — the status looks right and the body
    // arrives empty. Clear them so the error is a normal response again.
    res.removeHeader('Content-Length');
    res.removeHeader('Content-Range');
    res.removeHeader('Content-Type');
    res.status(200); // errorHandler sets the real status; 206 would survive otherwise

    next(err);
  });

  // If the client disconnects mid-download, close the fd instead of reading the
  // rest of the file into a socket nobody is on the other end of.
  res.on('close', () => rs.destroy());

  rs.pipe(res);

  // Returns the SOURCE, not `rs.pipe(res)` (which is `res`). Callers `return` this
  // straight out of the handler, where Express ignores the value either way, so the
  // useful thing to hand back is the stream a test or caller can inspect.
  return rs;
}
