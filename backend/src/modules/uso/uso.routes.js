// Path: src/modules/uso/uso.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import { usoEventosLimiter, usoPresencaLimiter } from './uso.rate-limit.js';
import * as ctrl from './uso.controller.js';
import * as schemas from './uso.schemas.js';

const router = Router();
router.post('/presenca', usoPresencaLimiter, validate({ body: schemas.presencaSchema }), ctrl.presenca);
router.get('/agora', auth, requireAdmin, ctrl.agora);

/**
 * Anonymous telemetry writes use flexibleAuth's verified identity when available.
 * The optional batch identity is a consistency guard, never an authentication source.
 * Presence and events have independent IP limits before validation. Neither writes
 * atlas data or access rules; frequent telemetry is deliberately outside audit_trail.
 * Both write endpoints return 204 without exposing stored data. Administrative reads
 * require strict auth and requireAdmin, including when the write was anonymous.
 */
router.post(
  '/eventos',
  usoEventosLimiter,
  validate({ body: schemas.eventosDeUsoSchema }),
  ctrl.registrarEventos
);

/**
 * A de LEITURA: `auth` ESTRITO (401 sem credencial) e `requireAdmin` (403 para qualquer outro
 * papel global, credenciado e produtor inclusive, porque ler todo recurso privado e manter o
 * acervo da própria OM não é administrar o sistema).
 *
 * `requireAdmin` ANTES de `validate`, como em `diag.routes.js` e `audit.routes.js`: quem não
 * pode ler o relatório não precisa saber que a query dele estava malformada, e um 422 nesse
 * caso confirmaria a forma da rota para quem não deveria alcançá-la.
 *
 * NENHUMA DAS DUAS EMITE TRILHA DE AUDITORIA, e as razões são diferentes, o que é justamente
 * o que o censo (`tests/unit/auditoria-censo.test.js`) existe para registrar: a leitura não é
 * um ato (consultar um resumo agregado não move eixo de acesso nenhum), e a escrita é
 * telemetria em altíssima frequência, vinda de chamador anônimo, cuja auditoria seria uma
 * linha de trilha por descarga de aba.
 */
router.get('/resumo', auth, requireAdmin, validate({ query: schemas.resumoQuerySchema }), ctrl.resumo);

export { router as usoRoutes };
