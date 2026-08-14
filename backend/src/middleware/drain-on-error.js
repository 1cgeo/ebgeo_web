// Path: src/middleware/drain-on-error.js

/**
 * How long to keep reading a rejected request's body before giving up on a clean
 * close. A client that stalls mid-upload must not hold the error response
 * hostage; after this we answer anyway and let the socket end however it ends.
 */
const DRAIN_TIMEOUT_MS = 5000;

/**
 * Holds an error response back until the unread request body has been drained.
 *
 * THE FAILURE THIS FIXES. A gate that rejects BEFORE the body parser runs answers
 * while the client is still uploading — `requireAtlasPermission('write')` sitting
 * in front of multer on `POST /atlas/:id/images` is the canonical case. Writing
 * the response and returning leaves an unread stream, node tears the socket down,
 * and the caller gets ECONNRESET instead of the 403 that was actually produced.
 * The status was never wrong; DELIVERING it was.
 *
 * The size of the body decides whether the bug shows, which is why it read as
 * flake for so long. Measured on this codebase with the real app: a 70-byte PNG
 * survived 20/20 (it fit in the socket buffer, so nothing was left to read) and a
 * 3 MB one failed 20/20. The integration suite uploads 70 bytes, so it failed a
 * few times in eight — often enough to be noticed, rarely enough to be dismissed.
 *
 * WHY DRAINING ALONE IS NOT ENOUGH. `req.resume()` inside the error handler does
 * not help on its own: the response still goes out on the same tick and the
 * socket still closes under the incoming upload. The body has to be consumed
 * BEFORE the status is written, which is why this is a separate middleware that
 * defers `next(err)` rather than a line inside the handler.
 *
 * Mount it immediately before `errorHandler` — it must see the error first.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function drainOnError(err, req, res, next) {
  if (req.complete || req.readableEnded || res.headersSent) return next(err);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    next(err);
  };
  const timer = setTimeout(finish, DRAIN_TIMEOUT_MS);
  // Do not keep the process alive just to wait out a stalled upload.
  timer.unref?.();

  // `unpipe` first: multer may have wired the stream to a file before the error,
  // and resuming a piped stream would keep writing that orphan blob.
  req.unpipe?.();
  req.on('error', finish);   // a client that hangs up mid-drain is not our fault
  req.once('end', finish);
  req.once('close', finish);
  req.resume();
}
