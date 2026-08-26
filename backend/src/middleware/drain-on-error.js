// Path: src/middleware/drain-on-error.js
import config from '../config.js';

/**
 * How long to keep reading a rejected request's body before giving up on a clean
 * close. A client that stalls mid-upload must not hold the error response
 * hostage; after this we answer anyway and let the socket end however it ends.
 */
const DRAIN_TIMEOUT_MS = 5000;

/**
 * Ceiling on how much of a rejected body we are willing to read. Sized to the
 * single-image upload limit plus slack for the multipart envelope, because that
 * route (`POST /atlas/:atlasId/images`) is the one whose gate rejects mid-upload.
 * A body larger than this stops being drained and the socket ends as it will —
 * losing the status on a caller that big is cheaper than reading it out.
 *
 * @returns {number}
 */
function tetoDeBytes() {
  return (config.images.maxSizeMb + 2) * 1024 * 1024;
}

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
 * TWO GUARDS, BOTH LOAD-BEARING, AND WHY. Draining was considered and REJECTED
 * once before (livro-razao, 2026-07-25, while fixing the 413 that /images/bulk
 * returned to an expired token): reading the body out lets an anonymous caller
 * push 50 MB through, which is the amplification the bulk-parser guard exists to
 * prevent. That objection is correct and still stands, so this middleware is
 * bounded by exactly the criterion `app.js` already uses for the enlarged bulk
 * parser:
 *
 *  - a VERIFIED principal must be attached (`req.user`, which flexibleAuth sets
 *    only after jwt.verify / a valid api key — never the mere presence of an
 *    Authorization header). An anonymous caller is never drained, so the 401 path
 *    that the earlier decision was about behaves exactly as it did before.
 *  - the read is capped (`tetoDeBytes`). A principal cannot buy an unbounded sink
 *    by being logged in.
 *
 * The narrow case that remains — an authenticated caller inside the image-size
 * limit — is precisely the one that was losing its 403, and it costs at most what
 * that route already accepts from an authorized upload.
 *
 * Mount it immediately before `errorHandler` — it must see the error first.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function drainOnError(err, req, res, next) {
  // `req.destroyed` E NOVO AQUI, e sem ele o conserto do upload abortado piora o
  // tempo de resposta: o erro do `armazenamentoAbortavel` chega com
  // `req.complete === false`, e este middleware tentaria drenar um stream MORTO
  // por 5 segundos inteiros (DRAIN_TIMEOUT_MS) antes de seguir. Nao ha corpo a
  // ler de um socket destruido, nem cliente para receber a resposta.
  if (req.complete || req.readableEnded || res.headersSent || req.destroyed) return next(err);
  if (!req.user) return next(err);   // anonymous: never read out, see above

  const teto = tetoDeBytes();
  let lidos = 0;
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
  req.on('data', (chunk) => {
    lidos += chunk.length;
    if (lidos > teto) finish();
  });
  req.once('end', finish);
  req.once('close', finish);
  req.resume();
}
