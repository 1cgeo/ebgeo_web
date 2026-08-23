// Path: src/modules/nomes/nomes.routes.js
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { nomesAccessLog } from '../../middleware/nomes-access-log.js';
import { gazetteerLimiter } from '../../middleware/rate-limit.js';
import * as ctrl from './nomes.controller.js';
import * as schemas from './nomes.schemas.js';

const router = Router();

// /busca is the frontend's gazetteer search (config.search.apiUrl) and must work
// for the ANONYMOUS path: no strict `auth` here. The global flexibleAuth still
// populates req.user when a credential is present.
//
// THERE IS NO ACCESS PREDICATE IN THIS ROUTE, and this comment claimed the opposite
// until 2026-08-23: it promised an "$5 userId => public names only" filter embedded in
// the BUSCA SQL, "defense in depth". `BUSCA` (`nomes.queries.js`) takes FOUR parameters
// and `$5` never existed; the header of that query says so by extension, and the false
// half was cleaned there on 2026-08-21 and survived HERE, which is the file a reader
// opens first. Prose promising a gate that does not exist is worse than no prose: it
// makes the reader conclude the hardening is already done. Every name in `ng.nomes` is
// served to everyone.
// O limiter vem ANTES do validate de propósito: uma varredura manda query
// malformada de graça se o teto só contar o que passa na validação.
router.get('/busca', gazetteerLimiter, nomesAccessLog, validate({ query: schemas.buscaSchema }), ctrl.busca);

export { router as nomesRoutes };
