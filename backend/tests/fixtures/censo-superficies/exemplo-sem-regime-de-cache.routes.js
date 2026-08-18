// Path: tests/fixtures/censo-superficies/exemplo-sem-regime-de-cache.routes.js
//
// FIXTURE DO CONTROLE NEGATIVO da varredura 4 (regime de cache por superfície
// escopada), em `tests/unit/superficies-de-recurso-censo.test.js`.
//
// Este arquivo NÃO é montado por `app.js` e não é alcançado pelo inventário do censo,
// que é `src/`: ele existe para que a varredura possa ser apontada para um par de
// rotas escopadas de comportamento CONHECIDO — uma cujo handler não emite cabeçalho de
// cache nenhum e outra cujo handler emite — e para que se possa MEDIR que ela acusa a
// combinação errada em cada uma das duas direções.
//
// Sem este par, "o censo cobra o cabeçalho ausente" seria uma afirmação do guarda sobre
// o guarda, que é exatamente o defeito que a varredura 4 nasceu para consertar: a
// varredura anterior media PRESENÇA (`Cache-Control` ou `setImmutableHeaders(` numa
// linha), e um cabeçalho AUSENTE não casa com nada.

import { Router } from 'express';
import * as semCtrl from './exemplo-sem-regime-de-cache.controller.js';
import * as comCtrl from './exemplo-com-regime-de-cache.controller.js';

const requireAtlasScopeWhenPresent = (req, res, next) => next();

const router = Router();

router.get(
  '/rota-escopada-sem-cabecalho',
  requireAtlasScopeWhenPresent,
  semCtrl.semCabecalho
);

router.get(
  '/rota-escopada-com-cabecalho',
  requireAtlasScopeWhenPresent,
  comCtrl.comCabecalho
);

export { router as exemploSemRegimeDeCacheRoutes };
