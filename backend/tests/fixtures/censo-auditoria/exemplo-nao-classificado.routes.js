// Path: tests/fixtures/censo-auditoria/exemplo-nao-classificado.routes.js
//
// FIXTURE DO CONTROLE NEGATIVO de `tests/unit/auditoria-censo.test.js`.
//
// Este arquivo NÃO é montado por `app.js` e não é alcançado por `git ls-files src`:
// ele existe para que o censo possa ser apontado, num caso do próprio arquivo, para
// uma rota de escrita que ninguém classificou — e reprovar. Sem ele, "o censo
// reprova rota nova" seria uma afirmação sobre o guarda, feita pelo guarda.
//
// Ele é deliberadamente banal: uma rota de escrita com a forma exata das reais.

import { Router } from 'express';

const router = Router();

router.post('/rota-de-escrita-sem-trilha', (req, res) => {
  res.status(201).json({ data: {} });
});

export { router as exemploNaoClassificadoRoutes };
