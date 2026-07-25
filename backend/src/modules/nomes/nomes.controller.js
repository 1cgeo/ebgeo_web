// Path: src/modules/nomes/nomes.controller.js
// NOTE: /busca and /catalogo3d return FROZEN frontend contracts that do NOT use
// the standard { data } envelope. Do not wrap them.
import { asyncHandler } from '../../utils/async-handler.js';
import * as nomesService from './nomes.service.js';

// A principal backed by a real `users` row always has a UUID sub; a public-link visitor token
// deliberately carries `public-<uuid>` (atlas.service mints it). Same convention as auth.js and
// permissions.js — repeated here rather than imported so this module keeps no auth dependency.
const PRINCIPAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The user id these queries may receive, or null.
 *
 * Every gazetteer query casts it (`$5::uuid` in BUSCA, `$4::uuid` in FEICOES/CATALOGO), so the
 * synthetic `public-<uuid>` principal used to reach Postgres and raise 22P02 → HTTP 400. The
 * absurd part is which caller broke: NO credential resolved to null and returned 200, while a
 * LEGITIMATE public-link token turned the anonymous-capable `/busca` into a 400. `flexibleAuth`
 * injects a subject with no `users` row and leaves no marker, so normalizing is the consumer's
 * job — a visitor is simply anonymous to the gazetteer, which is what the embedded access filter
 * already assumes ($5 null ⇒ public names only).
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

export const feicoes = asyncHandler(async (req, res) => {
  const result = await nomesService.feicoes({ ...req.query, userId: principalUserId(req) });
  res.json(result ?? { message: 'Nenhuma edificação encontrada nas proximidades.' });
});

// Frozen contract: { total, page, nr_records, data }.
export const catalogo3d = asyncHandler(async (req, res) => {
  const result = await nomesService.catalogo3d({ ...req.query, userId: principalUserId(req) });
  res.json(result);
});
