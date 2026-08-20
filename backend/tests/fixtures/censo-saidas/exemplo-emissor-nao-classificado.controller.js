// Path: tests/fixtures/censo-saidas/exemplo-emissor-nao-classificado.controller.js
//
// FIXTURE — prova que a varredura 2 do censo acusa uma saída HTTP que NÃO passa por `res.json`.
// É a porta dos fundos que a varredura de rota sozinha não fecha: a rota parece uma rota qualquer,
// e o corpo sai por um emissor que o embrulho global de `res.json` não alcança.

export function respondeForaDoJson(req, res) {
  res.send(JSON.stringify({ definicao: 'que nunca passou pela poda' }));
}
