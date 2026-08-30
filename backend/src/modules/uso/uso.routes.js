// Path: src/modules/uso/uso.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './uso.controller.js';
import * as schemas from './uso.schemas.js';

const router = Router();

/**
 * `auth` ESTRITO (401 sem credencial) e `requireAdmin` (403 para qualquer outro papel
 * global — credenciado e produtor inclusive, porque ler todo recurso privado e manter o
 * acervo da própria OM não é administrar o sistema).
 *
 * `requireAdmin` ANTES de `validate`, como em `diag.routes.js` e `audit.routes.js`: quem
 * não pode ler o relatório não precisa saber que a query dele estava malformada, e um 422
 * nesse caso confirmaria a forma da rota para quem não deveria alcançá-la.
 *
 * ROTA ÚNICA E SÓ DE LEITURA. Não há nada aqui que escreva, e por isso o módulo não emite
 * trilha de auditoria: `audit_trail` registra ATOS sobre contas, atlas e configuração, e
 * consultar um resumo agregado não é um deles (a classificação está no censo).
 */
router.get('/resumo', auth, requireAdmin, validate({ query: schemas.resumoQuerySchema }), ctrl.resumo);

export { router as usoRoutes };
