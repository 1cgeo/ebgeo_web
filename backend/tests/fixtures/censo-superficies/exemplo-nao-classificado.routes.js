// Path: tests/fixtures/censo-superficies/exemplo-nao-classificado.routes.js
//
// FIXTURE DO CONTROLE NEGATIVO de `tests/unit/superficies-de-recurso-censo.test.js`,
// metade das ROTAS. Gêmea da fixture de consulta ao lado, e pela mesma razão: a
// varredura de rota precisa ser provada capaz de acusar uma rota de LEITURA nova sem
// classificação, e não apenas afirmada capaz.
//
// Ela existe separada da consulta porque as duas varreduras são independentes de
// propósito: uma rota nova pode reusar uma consulta antiga (e escaparia da primeira),
// e uma consulta nova pode ser chamada de uma rota antiga (e escaparia da segunda).

import { Router } from 'express';

const router = Router();

router.get('/rota-de-leitura-sem-classificacao', (req, res) => {
  res.json({ data: [] });
});

export { router as exemploNaoClassificadoRoutes };
