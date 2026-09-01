// Path: tests/unit/regime-vencido-fala.test.js
//
// O ÍNDICE DE REGIME QUE PASSA A SERVIR ESTADO VELHO PRECISA DIZER QUE PASSOU, e este
// arquivo é o que prende as duas metades disso.
//
// POR QUE O TESTE NÃO ESPIA O PINO. Sob `NODE_ENV=test` o logger roda em nível `silent`,
// então um teste que observasse a saída do logger reportaria VERDE com a linha inteira
// ausente, que é exatamente o defeito que esta mudança existe para fechar. A verificação é
// sobre o OBJETO CONSTRUÍDO (`entradaEmRegimeVencidoPayload` / `saidaDeRegimeVencidoPayload`)
// e sobre a DECISÃO de escrever (o sink injetado em `criarVigiaDeRegime`). Mesmo arranjo, e
// pelo mesmo motivo, que `queryLogPayload` e `dbErrorLogPayload` em `src/database/index.js`.
//
// AS QUATRO PROPRIEDADES QUE CADA BLOCO ABAIXO COMPRA:
//
//   1. a ENTRADA em regime vencido escreve UMA linha. Se ela não escrevesse, o produto
//      voltaria a servir recurso recém-marcado privado como público e imutável sem uma
//      linha em lugar nenhum, que é o estado anterior a esta mudança;
//   2. a SEGUNDA consulta no MESMO regime não escreve nada. Esta é a propriedade que impede
//      o amplificador: o índice é consultado uma vez por tile, e a promessa rejeitada é
//      compartilhada, então sem o silêncio a rajada inteira iria para o `.jsonl` do disco
//      do backend. Sem este bloco, "logue a transição" degradaria para "logue a consulta"
//      numa edição distraída e nada ficaria vermelho;
//   3. a VOLTA ao normal escreve a linha de saída, com há quanto tempo estávamos vencidos.
//      Sem ela, quem lê o log vê uma queda que parece nunca ter terminado;
//   4. a linha de entrada carrega a IDADE do índice. Sem esse número o operador não
//      distingue "o banco piscou por dois segundos" de "estamos servindo estado de ontem",
//      e as duas coisas pedem providências opostas.
//
// O RELÓGIO É INJETADO, nunca falseado globalmente: `Date.now` é compartilhado com o pool
// do banco, e substituí-lo em volta deste módulo mediria outra coisa.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  criarVigiaDeRegime,
  entradaEmRegimeVencidoPayload,
  saidaDeRegimeVencidoPayload,
  motivoDaFalha,
  NIVEL_POR_TIPO,
  MSG_ENTRADA,
  MSG_SAIDA,
} from '../../src/modules/nomes/regime-vencido.js';
import logger from '../../src/utils/logger.js';

/** Um sink que grava, no lugar do escritor de pino. */
function coletor() {
  const linhas = [];
  return { linhas, escrever: (tipo, payload) => linhas.push({ tipo, payload }) };
}

/** Um erro de banco como o pg-promise entrega: com SQLSTATE e mensagem. */
function erroDeBanco(message = 'connect ECONNREFUSED 127.0.0.1:5432', code = 'ECONNREFUSED') {
  const e = new Error(message);
  e.code = code;
  return e;
}

describe('regime vencido: a transição fala uma vez, a consulta nunca', () => {
  it('escreve UMA linha ao entrar em regime vencido', () => {
    const { linhas, escrever } = coletor();
    const vigia = criarVigiaDeRegime('tile', escrever);

    vigia.anotarConstrucao(1_000);
    const falou = vigia.anotarQueda(erroDeBanco(), 3_000);

    assert.equal(falou, true);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].tipo, 'entrada');
    assert.equal(linhas[0].payload.indice, 'tile');
    assert.equal(linhas[0].payload.regime, 'vencido');
  });

  it('NÃO escreve nada na segunda queda do MESMO regime (o anti-amplificador)', () => {
    const { linhas, escrever } = coletor();
    const vigia = criarVigiaDeRegime('tile', escrever);
    vigia.anotarConstrucao(1_000);

    vigia.anotarQueda(erroDeBanco(), 3_000);
    // A rajada: o índice é consultado uma vez por tile, e todas caem no mesmo `catch`.
    for (let i = 0; i < 500; i += 1) {
      assert.equal(vigia.anotarQueda(erroDeBanco(), 3_001 + i), false);
    }

    assert.equal(linhas.length, 1, 'uma linha por transição, nunca uma por consulta');
  });

  it('a linha de entrada carrega a IDADE do último índice bom', () => {
    const { linhas, escrever } = coletor();
    const vigia = criarVigiaDeRegime('assets3d', escrever);

    vigia.anotarConstrucao(1_000);
    vigia.anotarQueda(erroDeBanco(), 3_600_000 + 1_000);

    const { payload } = linhas[0];
    assert.equal(payload.ultimoBomEm, 1_000);
    assert.equal(payload.idadeMs, 3_600_000, 'uma hora de estado velho, não uma piscada');
  });

  it('escreve a linha de SAÍDA ao voltar ao normal, com quanto tempo esteve vencido', () => {
    const { linhas, escrever } = coletor();
    const vigia = criarVigiaDeRegime('tile', escrever);

    vigia.anotarConstrucao(1_000);
    vigia.anotarQueda(erroDeBanco(), 5_000);
    vigia.anotarConstrucao(7_500);

    assert.equal(linhas.length, 2);
    assert.equal(linhas[1].tipo, 'saida');
    assert.deepEqual(linhas[1].payload, {
      indice: 'tile',
      regime: 'normal',
      vencidoDesde: 5_000,
      vencidoPorMs: 2_500,
    });
  });

  it('uma reconstrução que dá certo em regime NORMAL não escreve nada', () => {
    const { linhas, escrever } = coletor();
    const vigia = criarVigiaDeRegime('tile', escrever);

    // Toda escrita de catálogo invalida e reconstrói: se isto falasse, o log ganharia uma
    // linha por escrita de catálogo sem que nada tivesse acontecido.
    vigia.anotarConstrucao(1_000);
    vigia.anotarConstrucao(2_000);
    vigia.anotarConstrucao(3_000);

    assert.equal(linhas.length, 0);
  });

  it('um SEGUNDO episódio depois da recuperação volta a falar', () => {
    // O silêncio é do episódio, não permanente: um vigia que só falasse uma vez na vida
    // passaria os três blocos anteriores e ficaria mudo no incidente seguinte.
    const { linhas, escrever } = coletor();
    const vigia = criarVigiaDeRegime('tile', escrever);

    vigia.anotarConstrucao(1_000);
    vigia.anotarQueda(erroDeBanco(), 2_000);
    vigia.anotarConstrucao(3_000);
    const falou = vigia.anotarQueda(erroDeBanco(), 9_000);

    assert.equal(falou, true);
    assert.deepEqual(linhas.map((l) => l.tipo), ['entrada', 'saida', 'entrada']);
    // A idade da segunda entrada conta do ÚLTIMO bom (3_000), não do primeiro: se contasse
    // do primeiro, uma recuperação bem-sucedida seria relatada como estado velho de sempre.
    assert.equal(linhas[2].payload.idadeMs, 6_000);
  });
});

describe('regime vencido: a forma da linha', () => {
  it('a entrada carrega o código ESTRUTURAL e a mensagem, e nunca `err` ou `reqId`', () => {
    const payload = entradaEmRegimeVencidoPayload({
      indice: 'tile',
      erro: erroDeBanco('relation "basemaps" does not exist', '42P01'),
      ultimoBomEm: 1_000,
      agora: 4_000,
    });

    assert.deepEqual(payload, {
      indice: 'tile',
      regime: 'vencido',
      ultimoBomEm: 1_000,
      idadeMs: 3_000,
      codigo: '42P01',
      motivo: 'relation "basemaps" does not exist',
    });
    // `err` faria `ehErro` admitir a linha por um segundo termo e arrastaria o serializer
    // do pino com `err.query`/`err.detail`; `reqId` faria `fundirPorRequisicao` fundir esta
    // linha com a do erro de banco do mesmo pedido e DESCARTAR uma das duas.
    assert.ok(!('err' in payload));
    assert.ok(!('reqId' in payload));
  });

  it('idadeMs é null, e não zero, quando não houve construção anotada', () => {
    // Zero leria como "acabou de ser construído", que é o oposto do que a ausência diz.
    const payload = entradaEmRegimeVencidoPayload({
      indice: 'assets3d',
      erro: erroDeBanco(),
      ultimoBomEm: null,
      agora: 4_000,
    });
    assert.equal(payload.idadeMs, null);
    assert.equal(payload.ultimoBomEm, null);
  });

  it('a saída carrega a duração do regime vencido', () => {
    assert.deepEqual(
      saidaDeRegimeVencidoPayload({ indice: 'assets3d', vencidoDesde: 10_000, agora: 12_345 }),
      { indice: 'assets3d', regime: 'normal', vencidoDesde: 10_000, vencidoPorMs: 2_345 },
    );
  });

  it('o motivo perde caractere de controle e respeita o teto', () => {
    // A linha é impressa num terminal por `npm run diag -- linhas`: uma quebra de linha
    // dentro do campo forjaria linhas de log naquela tela.
    assert.equal(motivoDaFalha(erroDeBanco('linha1\nlinha2[31m')), 'linha1linha2[31m');

    const longo = motivoDaFalha(erroDeBanco('x'.repeat(500)));
    assert.equal(longo.length, 203);
    assert.ok(longo.endsWith('...'));

    // Erro sem `message`, e a ausência total: nenhum dos dois pode lançar no caminho de log.
    assert.equal(motivoDaFalha({ code: '42P01' }), '[object Object]');
    assert.equal(motivoDaFalha(null), '');
    assert.equal(motivoDaFalha(undefined), '');
  });

  it('o código é null quando o erro não traz um, e nunca a string "undefined"', () => {
    const payload = entradaEmRegimeVencidoPayload({
      indice: 'tile',
      erro: new Error('timeout'),
      ultimoBomEm: 1,
      agora: 2,
    });
    assert.equal(payload.codigo, null);
  });
});

describe('regime vencido: o nível é a decisão de visibilidade', () => {
  it('entrada em `error` e saída em `info`', () => {
    // NÃO é rótulo de gravidade: `ehErro` (`src/utils/diag-consulta.js`) tem três termos, e
    // como estas linhas não carregam `err` nem `statusCode`, o NÍVEL é o único que pode
    // admiti-las em `npm run diag -- erros`. Baixar a entrada para `warn` a some do
    // relatório sem mudar mais nada, e é por isso que o valor está preso aqui: quem mexer
    // passa pelo argumento do cabeçalho antes de passar pelo verde.
    assert.deepEqual(NIVEL_POR_TIPO, { entrada: 'error', saida: 'info' });
    // E os dois nomes precisam existir no logger, senão o escritor lança no dia do incidente
    // (o nível `silent` do teste esconderia uma chamada a um método inexistente).
    assert.equal(typeof logger[NIVEL_POR_TIPO.entrada], 'function');
    assert.equal(typeof logger[NIVEL_POR_TIPO.saida], 'function');
  });

  it('as duas mensagens são distintas e casáveis pelo campo `indice`', () => {
    assert.notEqual(MSG_ENTRADA, MSG_SAIDA);
    assert.ok(MSG_ENTRADA.length > 0 && MSG_SAIDA.length > 0);
  });
});

describe('regime vencido: os DOIS índices estão fiados', () => {
  // GUARDA DE FIAÇÃO, e é preciso dizer o que ela NÃO prova: ela não executa o caminho de
  // queda dentro dos índices (isso exigiria banco), então ela não garante que a chamada
  // esteja no ramo certo. O que ela garante é a falha que aconteceria de verdade: um vigia
  // perfeitamente testado que nenhum dos dois arquivos chama, ou que só um deles chama. O
  // irmão esquecido é o modo de falha desta casa (`caminho-de-recurso.js` nasceu dele), e
  // ele deixa as suítes das duas verdes.
  const ALVOS = [
    ['tile-regime.js', 'tile'],
    ['assets3d-regime.js', 'assets3d'],
  ];

  for (const [arquivo, nome] of ALVOS) {
    it(`${arquivo} cria o vigia e chama as DUAS anotações`, () => {
      const caminho = fileURLToPath(new URL(`../../src/modules/nomes/${arquivo}`, import.meta.url));
      const fonte = readFileSync(caminho, 'utf8');

      assert.match(fonte, /from '\.\/regime-vencido\.js'/, 'importa o módulo compartilhado');
      assert.ok(
        fonte.includes(`criarVigiaDeRegime('${nome}')`),
        `nomeia o índice como '${nome}', que é o campo que casa as duas linhas do par`,
      );
      assert.match(fonte, /vigia\.anotarConstrucao\(\)/, 'anota a reconstrução bem-sucedida');
      assert.match(fonte, /vigia\.anotarQueda\(/, 'anota a queda para o último índice bom');
    });
  }

  it('os dois nomes de índice são distintos', () => {
    assert.notEqual(ALVOS[0][1], ALVOS[1][1]);
  });
});
