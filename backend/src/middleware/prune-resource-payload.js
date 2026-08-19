// Path: src/middleware/prune-resource-payload.js
// THE HTTP BOUNDARY. Every JSON body this server writes goes out through `res.json`, so wrapping
// `res.json` once, globally, covers every route of every method — the 404, the error handler and
// whatever route is added next included. That is the whole point: the previous guard was applied
// at chosen call sites, and each review found a call site nobody had chosen.
//
// MOUNTED AS EARLY AS THE APP ALLOWS (`app.js`, right after the request logger and before the
// first `app.use('/api/...')`), because a route mounted before this middleware would never see the
// wrapper. Order is the contract here, and `tests/unit/saidas-de-conteudo-censo.test.js` asserts
// it against the source of `app.js` rather than trusting this comment.
//
// ONE GAP THAT THE ORDER CREATES, stated so nobody has to rediscover it: the handful of
// middlewares mounted ABOVE this one (helmet, cors, cookie-parser, the body parsers) can end a
// request before the wrapper is installed — a malformed body answers 400 through the error handler
// with the ORIGINAL `res.json`. Those responses are error envelopes (`{ error: { code, message } }`)
// built by `errorHandler` from an `AppError`, never entity payload, so there is nothing to prune.
// Moving the wrapper above the body parser would not help either: it has to run after `flexibleAuth`
// for nothing, and the parsers must stay where the bulk-upload limit needs them.
//
// WHAT IT DOES NOT COVER, by construction, and therefore what the census has to classify by hand:
// the emitters that are not `res.json` — `res.sendFile`, `res.end(buffer)` and `pipe(res)`. All
// three carry BYTES (an image, a 3D asset, a 360 photo), never an entity document, and none of
// them can carry a catalog-layer definition. A new non-`res.json` emitter is exactly the kind of
// exit that must fail the census until somebody says why it is safe.

import { pruneResourcePayload } from '../modules/catalog/resource-payload.prune.js';

/**
 * Wraps `res.json` so every JSON body is pruned of catalog-resource definitions on the way out.
 *
 * The object is pruned BEFORE serialization, which is what keeps the snapshot's authorized
 * definitions alive: the exemption is recorded by object identity and would not survive a
 * round-trip through text. See the header of `resource-payload.prune.js`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function pruneResponsePayload(req, res, next) {
  const original = res.json;
  res.json = function prunedJson(...args) {
    // Express 4 still accepts the deprecated `res.json(status, body)` form; the body is the
    // second argument there. Handled so the wrapper cannot become a hole the day someone uses it.
    if (args.length >= 2 && typeof args[0] === 'number') {
      args[1] = pruneResourcePayload(args[1]);
    } else if (args.length >= 1) {
      args[0] = pruneResourcePayload(args[0]);
    }
    return original.apply(this, args);
  };
  next();
}
