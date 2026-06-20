// Path: src/modules/nomes/nomes.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { nomesAccessLog } from '../../middleware/nomes-access-log.js';
import * as ctrl from './nomes.controller.js';
import * as schemas from './nomes.schemas.js';

const router = Router();

router.get('/busca', auth, nomesAccessLog, validate({ query: schemas.buscaSchema }), ctrl.busca);
router.get('/feicoes', auth, nomesAccessLog, validate({ query: schemas.feicoesSchema }), ctrl.feicoes);
router.get('/catalogo3d', auth, nomesAccessLog, validate({ query: schemas.catalogoSchema }), ctrl.catalogo3d);

export { router as nomesRoutes };
