// Path: tests/fixtures/censo-superficies/exemplo-com-regime-de-cache.controller.js
//
// FIXTURE DO CONTROLE NEGATIVO da varredura 4 (regime de cache), metade COM cabeçalho.
//
// A discriminação do controle: sem ela, "a varredura acusa" também seria o
// comportamento de uma varredura que acusa tudo. Este handler CUMPRE o regime que o
// censo pode declarar para ele, e serve à outra direção do guarda: declarado como
// buraco, ele precisa ser acusado, porque um buraco fechado no código e não acompanhado
// pelo censo é um censo que descreve um sistema que não existe mais.
//
// O marcador é definido aqui dentro, e não importado, para que a resolução
// marcador -> `Cache-Control` possa ser exercida sem arrastar `src/` para a fixture.

function marcarEscopoDaFixture(req, res) {
  if (!req.user) return;
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Authorization, Cookie');
}

export const comCabecalho = async (req, res) => {
  marcarEscopoDaFixture(req, res);
  res.json({ data: [] });
};
