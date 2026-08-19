// Path: src/modules/nomes/nomes.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { nomesAccessLog } from '../../middleware/nomes-access-log.js';
import { gazetteerLimiter } from '../../middleware/rate-limit.js';
import * as ctrl from './nomes.controller.js';
import * as schemas from './nomes.schemas.js';

const router = Router();

// /busca is the frontend's gazetteer search (config.search.apiUrl) and must work
// for the ANONYMOUS path: no strict `auth` here. The global flexibleAuth still
// populates req.user when a credential is present, and the BUSCA SQL filters by
// access embedded ($5 userId null => public names only) — defense in depth.
// O limiter vem ANTES do validate de propósito: uma varredura manda query
// malformada de graça se o teto só contar o que passa na validação.
router.get('/busca', gazetteerLimiter, nomesAccessLog, validate({ query: schemas.buscaSchema }), ctrl.busca);
router.get('/feicoes', auth, nomesAccessLog, validate({ query: schemas.feicoesSchema }), ctrl.feicoes);

export { router as nomesRoutes };
