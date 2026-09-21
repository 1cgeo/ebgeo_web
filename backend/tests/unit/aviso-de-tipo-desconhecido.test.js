// Path: tests/unit/aviso-de-tipo-desconhecido.test.js
//
// N5 — O `default` DO ROTEADOR DE MENSAGENS DO COLLAB ESCREVIA UMA LINHA DE LOG POR QUADRO.
//
// A CAUSA, e ela é de VOLUME e não de lógica. `handleMessage` (`src/modules/collab/collab.gateway.js`)
// terminava em `logger.warn({ type: data.type, userId }, 'Unknown message type')`, sem memória
// nenhuma. Em 2026-09-21 o quadro de presença `temporal` foi removido dos dois pacotes (o instante
// da linha do tempo de uma pessoa não se propaga), e a fila de saída do cliente é append-only:
// uma aba carregada ANTES do deploy segue mandando o quadro a cada mudança de cursor da régua,
// cerca de doze por segundo em reprodução. Doze linhas por segundo, por cliente, no arquivo de log
// do dia — e o cliente antigo é justamente o que o contrato manda TOLERAR.
//
// O CONSERTO É UMA DECISÃO PURA, `decidirAvisoDeTipoDesconhecido`
// (`src/modules/collab/unknown-type-warning.js`, folha de zero imports): o aviso sai uma vez por
// TIPO por SOCKET. O gateway fica com uma linha de efeito, e é este arquivo que prende o
// comportamento, incluindo as duas bordas que nascem de `data.type` ser valor ARBITRÁRIO de
// cliente — o TETO do conjunto e o TAMANHO do rótulo. Sem as duas, a correção de volume de log
// vira um vetor de memória, que é a troca pior: o log roda todo dia, o conjunto vive enquanto o
// socket viver.
//
// O PISO ESTÁ EM TODO CASO: cada um afirma também que o PRIMEIRO aviso sai. Sem isso, uma função
// que devolvesse `avisar: false` sempre passaria em todas as asserções de silêncio deste arquivo,
// que é a forma mais barata de um verde vazio aqui.
//
// O gêmeo de ponta a ponta é `tests/ws/tipo-desconhecido-avisa-uma-vez.test.js`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirAvisoDeTipoDesconhecido,
  rotuloDeTipo,
  MAX_CHARS_DO_TIPO,
  MAX_TIPOS_POR_SOCKET,
  TETO_ATINGIDO,
} from '../../src/modules/collab/unknown-type-warning.js';

/** O conjunto que o gateway pendura no socket, criado preguiçosamente lá. */
const socketNovo = () => new Set();

/** Quantos avisos N quadros do MESMO tipo produzem num socket recém-aberto. */
function avisosDe(avisados, tipos) {
  return tipos.filter((t) => decidirAvisoDeTipoDesconhecido(avisados, t).avisar).length;
}

describe('N5 — aviso de tipo desconhecido: uma vez por tipo, por socket', () => {
  it('o primeiro quadro avisa e os seguintes do mesmo tipo calam', () => {
    const avisados = socketNovo();

    const primeiro = decidirAvisoDeTipoDesconhecido(avisados, 'temporal');
    assert.equal(primeiro.avisar, true, 'o primeiro quadro de um tipo novo precisa avisar');
    assert.equal(primeiro.tipo, 'temporal');
    assert.equal(primeiro.tetoAtingido, false);

    // A RAJADA do cliente antigo: doze por segundo. Nenhuma delas volta a escrever no log.
    assert.equal(avisosDe(avisados, Array(200).fill('temporal')), 0);

    // E o conjunto não cresce com a rajada: uma vaga, não duzentas.
    assert.equal(avisados.size, 1);
  });

  it('tipos DISTINTOS avisam um cada, e a decisão é por socket', () => {
    const avisados = socketNovo();
    const decisoes = ['temporal', 'temporal', 'reproducao', 'temporal', 'reproducao'];
    assert.equal(avisosDe(avisados, decisoes), 2, 'dois tipos distintos, dois avisos');
    assert.equal(avisados.size, 2);

    // OUTRO socket recomeça do zero: a memória é do socket, e um cliente novo não herda o
    // silêncio de um antigo (é o que mantém o aviso útil para diagnóstico).
    const outro = socketNovo();
    assert.equal(decidirAvisoDeTipoDesconhecido(outro, 'temporal').avisar, true);
  });

  it('BORDA — o teto de tipos distintos fecha com UM último aviso e cala de vez', () => {
    const avisados = socketNovo();

    // Gasta o teto inteiro com tipos distintos: cada um avisa uma vez.
    const ateOTeto = Array.from({ length: MAX_TIPOS_POR_SOCKET }, (_, i) => `tipo-${i}`);
    assert.equal(avisosDe(avisados, ateOTeto), MAX_TIPOS_POR_SOCKET);
    assert.equal(avisados.size, MAX_TIPOS_POR_SOCKET);

    // O que ESTOURA o teto: um último aviso, dizendo que é o último.
    const estouro = decidirAvisoDeTipoDesconhecido(avisados, 'tipo-que-estoura');
    assert.equal(estouro.avisar, true, 'o teto precisa ser anunciado, senão o silêncio é mudo');
    assert.equal(estouro.tetoAtingido, true);
    assert.equal(estouro.tipo, 'tipo-que-estoura');

    // Silêncio DEFINITIVO daí em diante, para tipo novo e para tipo já visto.
    assert.equal(avisosDe(avisados, ['outro-novo', 'mais-um', 'tipo-0', 'tipo-que-estoura']), 0);

    // O conjunto para de crescer: o teto mais o sentinela, e nada além disso.
    assert.equal(avisados.size, MAX_TIPOS_POR_SOCKET + 1);
    assert.equal(avisados.has(TETO_ATINGIDO), true);

    // E o desfecho continua NOMEADO depois do estouro, para quem ler o retorno.
    assert.equal(decidirAvisoDeTipoDesconhecido(avisados, 'z').tetoAtingido, true);
  });

  it('BORDA — tipo que não é string não gasta uma vaga por valor', () => {
    const avisados = socketNovo();

    // Número, booleano e objeto colapsam por `typeof`: mil valores, UMA vaga cada família. Sem
    // isso, um cliente que sorteasse o número a cada quadro estouraria o teto na primeira
    // fração de segundo e ainda deixaria mil strings na memória do socket.
    const numeros = Array.from({ length: 1000 }, (_, i) => i);
    assert.equal(avisosDe(avisados, numeros), 1, 'mil números precisam gastar UM aviso');
    assert.equal(avisosDe(avisados, [true, false, true]), 1);
    assert.equal(avisosDe(avisados, [{ a: 1 }, { b: 2 }, [1, 2, 3]]), 1);

    // As formas AUSENTE e NULA são desfechos legítimos (um cliente pode mandar `{}`), e cada uma
    // tem rótulo próprio para que o log diga qual foi.
    assert.equal(avisosDe(avisados, [undefined, undefined]), 1);
    assert.equal(avisosDe(avisados, [null, null]), 1);

    assert.deepEqual(
      [...avisados],
      ['<number>', '<boolean>', '<object>', '<ausente>', '<nulo>'],
      'cada família de valor não-string ocupa exatamente uma vaga, e o rótulo a nomeia'
    );
  });

  it('BORDA — o rótulo é cortado, e o corte é o que limita o log e a memória', () => {
    const gigante = 'x'.repeat(5000);
    const rotulo = rotuloDeTipo(gigante);
    assert.equal(rotulo.length, MAX_CHARS_DO_TIPO, 'o rótulo não pode passar do teto de caracteres');
    assert.equal(rotulo.endsWith('…'), true, 'o corte precisa ser visível para quem lê o log');

    // O que ENTRA no conjunto é o rótulo cortado, não o valor cru: é isso que impede uma string
    // de megabytes de viver no socket.
    const avisados = socketNovo();
    assert.equal(decidirAvisoDeTipoDesconhecido(avisados, gigante).avisar, true);
    assert.deepEqual([...avisados], [rotulo]);

    // PREÇO DECLARADO: duas strings que só diferem DEPOIS do corte compartilham a vaga, e a
    // segunda não é avisada. É o câmbio que fecha o vetor de memória.
    const outraGigante = `${'x'.repeat(5000)}-sufixo-diferente`;
    assert.equal(decidirAvisoDeTipoDesconhecido(avisados, outraGigante).avisar, false);
    assert.equal(avisados.size, 1);

    // O limite não corta o que cabe: um tipo do tamanho exato do teto passa inteiro.
    const noLimite = 'y'.repeat(MAX_CHARS_DO_TIPO);
    assert.equal(rotuloDeTipo(noLimite), noLimite);
  });

  it('BORDA — string vazia tem rótulo próprio, em vez de um campo em branco no log', () => {
    // Um campo vazio na linha de log se lê como defeito do servidor; `<vazio>` diz que o quadro
    // do cliente é que veio assim.
    assert.equal(rotuloDeTipo(''), '<vazio>');

    const avisados = socketNovo();
    const decisao = decidirAvisoDeTipoDesconhecido(avisados, '');
    assert.equal(decisao.avisar, true);
    assert.equal(decisao.tipo, '<vazio>');
    assert.equal(avisosDe(avisados, ['', '']), 0);
  });
});
