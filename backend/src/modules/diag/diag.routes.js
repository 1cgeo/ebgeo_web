// Path: src/modules/diag/diag.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import { clientErrorLimiter } from './diag.rate-limit.js';
import * as ctrl from './diag.controller.js';
import * as schemas from './diag.schemas.js';

const router = Router();

/**
 * A ROTA ANÔNIMA VEM PRIMEIRO no arquivo porque ela é a exceção, e escrevê-la no meio de
 * quatro rotas de administrador é como alguém a lê como uma delas. Ela é o único ponto
 * deste módulo sem `auth`: o app roda deslogado, e o visitante é justamente quem não tem
 * ninguém olhando o console dele.
 *
 * A ordem `limiter → validate` é a de `POST /auth/register`: o teto por endereço precisa
 * ser cobrado ANTES do trabalho de validar, senão o corpo gigante já custou o parse.
 */
router.post(
  '/erro-cliente',
  clientErrorLimiter,
  validate({ body: schemas.erroDeClienteSchema }),
  ctrl.registrarErroDeCliente
);

/**
 * As quatro de leitura: `auth` ESTRITO (401 sem credencial) e `requireAdmin` (403 para
 * qualquer outro papel global, credenciado e produtor inclusive — nenhum dos dois
 * administra o sistema).
 *
 * `requireAdmin` ANTES de `validate`, como em `audit.routes.js`: quem não pode ler o
 * diagnóstico não precisa saber que a query dele estava malformada, e um 422 nesse caso
 * confirmaria a existência e a forma da rota para quem não deveria alcançá-la.
 */
router.get('/erros', auth, requireAdmin, validate({ query: schemas.errosQuerySchema }), ctrl.erros);
router.get('/lento', auth, requireAdmin, validate({ query: schemas.lentoQuerySchema }), ctrl.lento);
router.get('/status', auth, requireAdmin, validate({ query: schemas.statusQuerySchema }), ctrl.status);
router.get(
  '/erros-cliente',
  auth,
  requireAdmin,
  validate({ query: schemas.errosDeClienteQuerySchema }),
  ctrl.listarErrosDeCliente
);

export { router as diagRoutes };
