// Path: tests/fixtures/censo-saidas/exemplo-mensagem-nao-classificada.handlers.js
//
// FIXTURE — prova as varreduras 3 e 4 do censo de uma vez: um sítio novo de escrita em socket E um
// tipo de frame novo. É a forma exata do quarto relay que a F13 fechou (`handleOperation`, um
// frame `operation` SINGULAR que nunca passou por `broadcastOperations`): um `ws.send` escrito num
// handler, com um `type` que ninguém classificou.

export function enviaFrameNaoClassificado(ws, dados) {
  ws.send(JSON.stringify({
    type: 'mensagem_sem_classificacao',
    payload: dados,
  }));
}
