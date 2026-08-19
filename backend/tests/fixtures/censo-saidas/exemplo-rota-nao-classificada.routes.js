// Path: tests/fixtures/censo-saidas/exemplo-rota-nao-classificada.routes.js
//
// FIXTURE — não é código de produção e não é montada em lugar nenhum. Ela existe para PROVAR que
// a varredura de rota do censo (`tests/unit/saidas-de-conteudo-censo.test.js`) acusa uma saída
// nova, em vez de o censo afirmar isso sobre si mesmo.
//
// AS DUAS ROTAS SÃO DELIBERADAS. A GET é o controle; a POST é o ponto cego em pessoa: o censo
// anterior varria `router.get(` e por isso não enxergava `POST /atlas/:id/maps/:mapId/duplicate`,
// que responde 201 com uma linha de `maps` inteira. Se alguém estreitar a varredura de volta para
// GET, é este arquivo que fica vermelho.

const router = { get() {}, post() {} };
const ctrl = { lista: () => {}, cria: () => {} };

router.get('/rota-de-leitura-sem-classificacao', ctrl.lista);
router.post('/rota-de-escrita-sem-classificacao', ctrl.cria);

export { router as fixtureRoutes };
