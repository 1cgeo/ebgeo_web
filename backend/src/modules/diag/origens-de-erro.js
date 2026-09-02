// Path: src/modules/diag/origens-de-erro.js
/**
 * @fileoverview O vocabulário de ORIGEM de um erro de navegador: por qual porta ele entrou
 * no coletor do cliente.
 *
 * ESTE ARQUIVO É O ESPELHO DO CHECK, e o CHECK é o espelho dele. A lista vive duas vezes,
 * aqui e em `017_erro_cliente_identidade.sql`, porque as duas pontas recusam em momentos
 * diferentes e nenhuma substitui a outra: o Joi recusa na borda com 422 nomeando o campo, e
 * o CHECK recusa no banco com 23514 mesmo que alguém escreva por outro caminho (um roteiro,
 * um INSERT à mão, um controller futuro que esqueça o schema). Valor novo entra nos DOIS no
 * mesmo commit; a guarda disso é `tests/unit/diag-origem-de-erro.test.js`, que compara esta
 * lista com o texto do CHECK em disco e ainda prova que o banco recusa o desconhecido.
 *
 * ZERO IMPORTS, e isso é contrato: o schema de Joi e os testes o carregam, e ele precisa
 * continuar carregável sem `DATABASE_URL` e sem `JWT_SECRET` (que é o que `config.js`
 * exige na avaliação do módulo). Um import daqui para qualquer coisa do módulo `diag`
 * arrastaria o serviço, o banco e o config atrás de uma lista de dez strings.
 *
 * A ORDEM É PARTE DO CONTRATO, porque o teste compara a lista com a do CHECK termo a termo,
 * e ela é a do CICLO DE VIDA, não alfabética: o que acontece antes do app existir (`boot`),
 * os dois coletores globais do navegador (`nao-tratado`, `rejeicao`), o console, e então os
 * subsistemas que sabem falhar por conta própria, do mais central para o mais periférico.
 * Alfabética faria um leitor procurar significado na vizinhança e não achar nenhum.
 */

/**
 * Os dez valores aceitos, na ordem do CHECK.
 *
 * Cada um responde "quem estava segurando o erro quando ele foi capturado":
 *  - `boot`         — a falha antes de o app subir (o fail-fast em `GET /api/config`);
 *  - `nao-tratado`  — `window.onerror`: exceção que ninguém pegou;
 *  - `rejeicao`     — `unhandledrejection`: promessa rejeitada sem dono;
 *  - `console`      — o que só apareceu como `console.error`;
 *  - `store`        — a store (IndexedDB, transação, persistência);
 *  - `ws`           — o socket de colaboração;
 *  - `maplibre`     — o mapa 2D (estilo, fonte, tile);
 *  - `cesium`       — o 3D;
 *  - `sv360`        — o visualizador 360;
 *  - `indisponivel` — a tela de indisponibilidade, que é um desfecho e não um acidente.
 */
export const ORIGENS_DE_ERRO = Object.freeze([
  'boot',
  'nao-tratado',
  'rejeicao',
  'console',
  'store',
  'ws',
  'maplibre',
  'cesium',
  'sv360',
  'indisponivel',
]);

/**
 * As mesmas dez, por nome, para quem EMITE uma origem em vez de validá-la.
 *
 * Existe pela razão de sempre nesta casa: string literal espalhada é erro de digitação que
 * o compilador não vê e o CHECK só acusa em produção, dentro do caminho que existe para
 * registrar falhas. Quem valida usa `ORIGENS_DE_ERRO`; quem escreve usa este objeto.
 */
export const OrigemDeErro = Object.freeze({
  BOOT: 'boot',
  NAO_TRATADO: 'nao-tratado',
  REJEICAO: 'rejeicao',
  CONSOLE: 'console',
  STORE: 'store',
  WS: 'ws',
  MAPLIBRE: 'maplibre',
  CESIUM: 'cesium',
  SV360: 'sv360',
  INDISPONIVEL: 'indisponivel',
});
