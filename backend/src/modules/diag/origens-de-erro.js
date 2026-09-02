// Path: src/modules/diag/origens-de-erro.js
/**
 * @fileoverview O vocabulário de ORIGEM de um erro de navegador: por qual porta ele entrou
 * no coletor do cliente.
 *
 * ESTE ARQUIVO É O ESPELHO DO CHECK, e o CHECK é o espelho dele. A lista vive duas vezes,
 * aqui e em `018_defeitos_e_ocorrencias.sql`, porque as duas pontas recusam em momentos
 * diferentes e nenhuma substitui a outra: o Joi recusa na borda com 422 nomeando o campo, e
 * o CHECK recusa no banco com 23514 mesmo que alguém escreva por outro caminho (um roteiro,
 * um INSERT à mão, um controller futuro que esqueça o schema). Valor novo entra nos DOIS no
 * mesmo commit; a guarda disso é `tests/unit/diag-origem-de-erro.test.js`, que compara esta
 * lista com o texto do CHECK em disco e ainda prova que o banco recusa o desconhecido.
 *
 * ZERO IMPORTS, e isso é contrato: o schema de Joi e os testes o carregam, e ele precisa
 * continuar carregável sem `DATABASE_URL` e sem `JWT_SECRET` (que é o que `config.js`
 * exige na avaliação do módulo). Um import daqui para qualquer coisa do módulo `diag`
 * arrastaria o serviço, o banco e o config atrás de uma lista de onze strings.
 *
 * A ORDEM É PARTE DO CONTRATO, porque o teste compara a lista com a do CHECK termo a termo,
 * e ela é a do CICLO DE VIDA, não alfabética: o que acontece antes do app existir (`boot`),
 * os dois coletores globais do navegador (`nao-tratado`, `rejeicao`), o console, e então os
 * subsistemas que sabem falhar por conta própria, do mais central para o mais periférico.
 * Alfabética faria um leitor procurar significado na vizinhança e não achar nenhum.
 *
 * `SERVIDOR` ENTRA POR ÚLTIMO, E ELE QUEBRA A REGRA DO NOME DO ARQUIVO: os dez primeiros
 * dizem por qual porta o erro entrou no coletor DO NAVEGADOR, e o décimo primeiro diz que
 * não houve navegador nenhum. Ele existe porque o 5xx do próprio servidor passou a virar
 * DEFEITO na mesma tabela (`defeitos-de-servidor.js`), e as duas metades precisam ser
 * separáveis numa consulta: `origem = 'servidor'` é o filtro que isola o que o backend
 * escreveu sobre si, e `origem IS DISTINCT FROM 'servidor'` é o que mantém
 * `GET /diag/erros-cliente` respondendo exatamente o que respondia antes. Acrescentá-lo no
 * MEIO teria embaralhado a ordem do ciclo de vida do cliente, que é o que faz os dez se
 * lerem em sequência.
 */

/**
 * Os onze valores aceitos, na ordem do CHECK.
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
 *  - `indisponivel` — a tela de indisponibilidade, que é um desfecho e não um acidente;
 *  - `servidor`     — não veio de navegador nenhum: é o 5xx do próprio backend, agregado
 *                     em memória e descarregado como defeito (`defeitos-de-servidor.js`).
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
  'servidor',
]);

/**
 * As DEZ que um NAVEGADOR pode declarar: a lista acima menos `'servidor'`.
 *
 * ELA EXISTE PORQUE AS DUAS BORDAS NÃO SÃO A MESMA. O CHECK do banco precisa aceitar as onze
 * (é a mesma coluna, e o agregador de servidor escreve nela); o Joi da rota ANÔNIMA precisa
 * aceitar só as dez, senão qualquer visitante carimba um relato como se fosse o próprio
 * servidor falando, e o filtro `origem = 'servidor'` da tela passa a misturar o que o backend
 * registrou sobre si com o que um cliente qualquer disse. Não é escalação de privilégio (a
 * linha não autoriza nada), é FALSIFICAÇÃO DE PROCEDÊNCIA, que numa tela de diagnóstico custa
 * a confiança no recorte inteiro.
 *
 * DERIVADA, NUNCA ESCRITA À MÃO: uma segunda lista literal com dez das onze strings é
 * exatamente a cópia que envelhece na próxima origem nova, e envelheceria falhando ABERTO (a
 * origem nova ficaria de fora da borda do cliente sem ninguém notar). O `filter` amarra as
 * duas ao mesmo lugar, e o teste exige que a diferença entre elas seja EXATAMENTE
 * `['servidor']`.
 *
 * O `filter` E NÃO UM `slice(0, 10)`: os dois dão a mesma lista hoje, e só um continua dando
 * depois que alguém acrescentar uma origem de navegador no fim (o `slice` cortaria a nova e
 * manteria `'servidor'`, silenciosamente trocando as duas). O que a lista significa é "todas
 * menos `'servidor'`", e é isso que o código precisa dizer, não a posição em que ela está.
 */
export const ORIGENS_DO_CLIENTE = Object.freeze(
  ORIGENS_DE_ERRO.filter((o) => o !== 'servidor')
);

/**
 * As mesmas onze, por nome, para quem EMITE uma origem em vez de validá-la.
 *
 * Existe pela razão de sempre nesta casa: string literal espalhada é erro de digitação que
 * o compilador não vê e o CHECK só acusa em produção, dentro do caminho que existe para
 * registrar falhas. Quem valida usa `ORIGENS_DE_ERRO` (ou `ORIGENS_DO_CLIENTE`, na borda
 * anônima); quem escreve usa este objeto.
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
  SERVIDOR: 'servidor',
});
