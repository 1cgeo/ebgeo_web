// Path: src/modules/nomes/nomes.controller.js
// NOTE: /busca returns a FROZEN frontend contract that does NOT use the standard
// { data } envelope. Do not wrap it.
import { asyncHandler } from '../../utils/async-handler.js';
import * as nomesService from './nomes.service.js';

// A principal backed by a real `users` row always has a UUID sub; a public-link visitor token
// deliberately carries `public-<uuid>` (atlas.service mints it). Same convention as auth.js and
// permissions.js — repeated here rather than imported so this module keeps no auth dependency.
const PRINCIPAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The user id these queries may receive, or null.
 *
 * HISTORICAL: a gazetteer query once cast this into SQL, so the synthetic `public-<uuid>`
 * principal reached Postgres and raised 22P02 → HTTP 400. The absurd part was which caller
 * broke: NO credential resolved to null and returned 200, while a LEGITIMATE public-link token
 * turned the anonymous-capable `/busca` into a 400. `flexibleAuth` injects a subject with no
 * `users` row and leaves no marker, so normalizing is the consumer's job.
 *
 * TODAY THE VALUE IS IGNORED, and knowing that is the point of this paragraph. `busca`
 * (`nomes.service.js`) destructures `{ q, lat, lon, zoom }` and never reads `userId`; `BUSCA`
 * takes four parameters. The `$4::uuid in FEICOES` this JSDoc used to cite pointed at a query
 * removed in 2026-08-19. The normalization is kept because it costs nothing and the day an
 * access predicate lands, the visitor must arrive as anonymous rather than as a 400.
 * @returns {string|null}
 */
function principalUserId(req) {
  const id = req.user?.id;
  return typeof id === 'string' && PRINCIPAL_UUID_RE.test(id) ? id : null;
}

// Frozen contract: bare array of up to 5 results.
export const busca = asyncHandler(async (req, res) => {
  const result = await nomesService.busca({ ...req.query, userId: principalUserId(req) });
  res.json(result);
});
