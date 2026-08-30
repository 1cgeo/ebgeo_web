// Path: tests/unit/amostra-de-saude.test.js
//
// `src/utils/amostra-de-saude.js` é a amostra periódica de saúde: uma linha de log por
// intervalo, para que exista série mesmo sem ninguém olhando. Ela roda em TIMER, fora de
// toda requisição, então os modos de falha dela não têm quem os pegue — e é isso que este
// arquivo mede, e não só o caminho feliz:
//
//   (1) nunca ser o motivo de uma queda: sonda que lança, leitura que lança e até o LOGGER
//       que lança degradam para uma linha, nunca para uma rejeição que suba de um callback
//       de timer (no Node 22 isso derruba o processo);
//   (2) o timer é `unref()`: sem isso o processo não termina sozinho e a suíte penduraria
//       sem nada na saída explicando o quê;
//   (3) a sonda ao banco tem prazo PRÓPRIO, e os três desfechos (ok / erro / prazo) são
//       distinguíveis — colapsar erro e prazo apagaria a diferença entre "o Postgres caiu" e
//       "o nosso pool está entupido", que pedem providências opostas;
//   (4) o gate de ambiente: em teste ela não liga, e o motivo é nomeado.
//
// Relógio, temporizador, sonda, leituras e logger são todos INJETADOS: nada aqui espera
// tempo real nem toca banco, que é a razão de o módulo ter sido escrito com essas costuras.
// Teste que dorme é teste que flakeia, e um teste de timer que dorme flakeia duas vezes.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//   - tire o `if (id.unref)` de `criarAmostradorDeSaude` e o caso do `unref` cai;
//   - troque o `try/catch` de `amostrarAgora` por chamada nua e os três casos de degradação
//     passam a REJEITAR, derrubando o caso em vez de reprová-lo com mensagem;
//   - devolva `{ ok: false, motivo: 'erro' }` no ramo do prazo em `sondarBancoComPrazo` e o
//     caso que separa prazo de erro cai;
//   - troque `if (isTest)` por `if (isTest && !ativa)` em `deveAmostrar` e o caso do gate de
//     ambiente cai (é a forma exata de "ligar em teste sem querer");
//   - devolva `{ emUso: NaN }` em vez de `null` em `descreverPool` e o caso da regra de campo
//     ausente cai.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARCADOR_AMOSTRA,
  descreverPool,
  descreverMemoria,
  montarAmostra,
  deveAmostrar,
  sondarBancoComPrazo,
  criarAmostradorDeSaude,
} from '../../src/utils/amostra-de-saude.js';

/** Um logger de mentira que guarda o que recebeu, por nível. */
function loggerFalso({ falharEm = null } = {}) {
  const linhas = { info: [], warn: [], error: [] };
  const registrar = (nivel) => (obj, msg) => {
    if (falharEm === nivel) throw new Error('logger quebrado');
    linhas[nivel].push({ obj, msg });
  };
  return {
    linhas,
    info: registrar('info'),
    warn: registrar('warn'),
    error: registrar('error'),
  };
}

/** O `$pool` do pg-promise, na forma que o pg-pool realmente expõe. */
function poolFalso({ total = 4, ocioso = 3, esperando = 0, max = 10 } = {}) {
  return { totalCount: total, idleCount: ocioso, waitingCount: esperando, options: { max } };
}

/** Um par agendar/cancelar espião, com `unref` observável. */
function temporizadorFalso({ dispararNaHora = false } = {}) {
  const agendados = [];
  const cancelados = [];
  return {
    agendados,
    cancelados,
    agendar(fn, ms) {
      const id = { ms, unrefChamado: false, fn };
      id.unref = () => { id.unrefChamado = true; };
      agendados.push(id);
      if (dispararNaHora) fn();
      return id;
    },
    cancelar(id) {
      cancelados.push(id);
    },
  };
}

/** Deixa a fila de microtasks/immediates rodar, sem esperar tempo de relógio. */
const proximoTique = () => new Promise((resolve) => setImmediate(resolve));

describe('amostra de saúde — o que a linha CONTÉM', () => {
  it('carrega o marcador, o banco, o pool, a memória, o uptime e os sockets', () => {
    const linha = montarAmostra({
      banco: { ok: true, ms: 7 },
      pool: poolFalso({ total: 6, ocioso: 2, esperando: 3, max: 10 }),
      memoria: { heapUsed: 42 * 1024 * 1024, rss: 130 * 1024 * 1024 },
      uptimeS: 3600.7,
      sockets: 9,
    });

    assert.deepEqual(linha, {
      amostra: 'saude',
      banco: { ok: true, ms: 7 },
      pool: { emUso: 4, ocioso: 2, total: 6, esperando: 3, max: 10 },
      memoria: { heapMb: 42, rssMb: 130 },
      uptimeS: 3601,
      sockets: 9,
    });
    // O marcador é consumido por SÍMBOLO pelo relatório; se a string mudar, é aqui que se vê.
    assert.equal(linha.amostra, MARCADOR_AMOSTRA);
  });

  it('o desfecho ruim do banco viaja inteiro, com motivo e latência', () => {
    const linha = montarAmostra({
      banco: { ok: false, ms: 5000, motivo: 'prazo' },
      uptimeS: 10,
    });
    assert.deepEqual(linha.banco, { ok: false, ms: 5000, motivo: 'prazo' });
  });

  it('REGRA DE CAMPO AUSENTE: o que não pôde ser medido não aparece', () => {
    const linha = montarAmostra({
      banco: { ok: true, ms: 1 },
      pool: { formaDesconhecida: true },   // biblioteca mudou de forma
      memoria: null,                        // leitura indisponível
      uptimeS: Number.NaN,
      sockets: null,                        // sem WebSocketServer em mãos
    });

    assert.deepEqual(Object.keys(linha), ['amostra', 'banco']);
    assert.ok(!('pool' in linha), 'pool de forma desconhecida some, e NÃO vira NaN na série');
    assert.ok(!('sockets' in linha));
    assert.ok(!('uptimeS' in linha));
  });

  it('descreverPool: emUso é o que está fora do repouso, e `esperando` é a fila', () => {
    assert.deepEqual(
      descreverPool(poolFalso({ total: 10, ocioso: 0, esperando: 17, max: 10 })),
      { emUso: 10, ocioso: 0, total: 10, esperando: 17, max: 10 }
    );
    // Sem `options.max` a descrição continua válida, só sem o teto.
    assert.deepEqual(
      descreverPool({ totalCount: 1, idleCount: 1, waitingCount: 0 }),
      { emUso: 0, ocioso: 1, total: 1, esperando: 0 }
    );
    assert.equal(descreverPool(null), null);
    assert.equal(descreverPool({ totalCount: 'muitas' }), null);
  });

  it('descreverMemoria arredonda para MB e recusa entrada não numérica', () => {
    assert.deepEqual(
      descreverMemoria({ heapUsed: 1.5 * 1024 * 1024, rss: 2.4 * 1024 * 1024 }),
      { heapMb: 2, rssMb: 2 }
    );
    assert.equal(descreverMemoria({ heapUsed: Number.NaN, rss: 1 }), null);
    assert.equal(descreverMemoria(undefined), null);
  });
});

describe('amostra de saúde — a decisão de ligar', () => {
  it('NUNCA liga em teste, mesmo com a env ligada e o intervalo válido', () => {
    assert.deepEqual(
      deveAmostrar({ ativa: true, isTest: true, intervaloMs: 300000 }),
      { ligar: false, motivo: 'teste' }
    );
  });

  it('não liga desligada por env', () => {
    assert.deepEqual(
      deveAmostrar({ ativa: false, isTest: false, intervaloMs: 300000 }),
      { ligar: false, motivo: 'desligado' }
    );
  });

  it('não liga com intervalo que viraria setInterval(NaN) ou zero', () => {
    for (const ruim of [Number.NaN, 0, -1, undefined, Infinity]) {
      assert.deepEqual(
        deveAmostrar({ ativa: true, isTest: false, intervaloMs: ruim }),
        { ligar: false, motivo: 'intervalo-invalido' },
        `intervalo ${String(ruim)} tinha de ser recusado`
      );
    }
  });

  it('liga no caso normal', () => {
    assert.deepEqual(deveAmostrar({ ativa: true, isTest: false, intervaloMs: 300000 }), { ligar: true });
  });
});

describe('amostra de saúde — a sonda ao banco tem prazo próprio', () => {
  it('banco que responde: ok, com a latência medida pelo relógio injetado', async () => {
    let t = 1000;
    const relogio = temporizadorFalso();
    const desfecho = await sondarBancoComPrazo({
      consultar: async () => { t += 12; return { ok: 1 }; },
      prazoMs: 5000,
      agora: () => t,
      agendar: relogio.agendar,
      cancelar: relogio.cancelar,
    });

    assert.deepEqual(desfecho, { ok: true, ms: 12 });
    assert.equal(relogio.cancelados.length, 1, 'o temporizador do prazo é sempre cancelado');
  });

  it('banco que RECUSA é `erro`, e a mensagem viaja', async () => {
    const relogio = temporizadorFalso();
    const desfecho = await sondarBancoComPrazo({
      consultar: async () => { throw new Error('ECONNREFUSED 127.0.0.1:5432'); },
      prazoMs: 5000,
      agora: () => 0,
      agendar: relogio.agendar,
      cancelar: relogio.cancelar,
    });

    assert.equal(desfecho.ok, false);
    assert.equal(desfecho.motivo, 'erro');
    assert.match(desfecho.erro, /ECONNREFUSED/);
  });

  it('pool esgotado (consulta que nunca resolve) é `prazo`, e NÃO fica pendurado', async () => {
    let t = 0;
    // `dispararNaHora` é o pool esgotado tornado determinístico: o prazo vence na hora,
    // enquanto a consulta segue eternamente na fila do pool, que é o cenário real.
    const relogio = temporizadorFalso({ dispararNaHora: true });
    const desfecho = await sondarBancoComPrazo({
      consultar: () => new Promise(() => { t += 5000; }),
      prazoMs: 5000,
      agora: () => t,
      agendar: relogio.agendar,
      cancelar: relogio.cancelar,
    });

    assert.equal(desfecho.ok, false);
    assert.equal(desfecho.motivo, 'prazo', 'prazo e erro são desfechos DIFERENTES');
    assert.ok(!('erro' in desfecho));
    assert.equal(relogio.agendados[0].ms, 5000, 'o prazo agendado é o pedido');
    assert.equal(relogio.agendados[0].unrefChamado, true, 'nem o prazo segura o event loop');
  });
});

describe('amostra de saúde — o amostrador', () => {
  function montarAmostrador({ sondarBanco, extras = {}, loggerOpts = {}, temporizadorOpts = {} } = {}) {
    const registrar = loggerFalso(loggerOpts);
    const relogio = temporizadorFalso(temporizadorOpts);
    const amostrador = criarAmostradorDeSaude({
      intervaloMs: 300000,
      sondarBanco,
      lerPool: () => poolFalso(),
      lerMemoria: () => ({ heapUsed: 10 * 1024 * 1024, rss: 20 * 1024 * 1024 }),
      lerUptime: () => 60,
      contarSockets: () => 3,
      registrar,
      agendar: relogio.agendar,
      cancelar: relogio.cancelar,
      ...extras,
    });
    return { amostrador, registrar, relogio };
  }

  it('PROPRIEDADE (2): o timer é agendado no intervalo pedido e recebe unref()', () => {
    const { relogio } = montarAmostrador({ sondarBanco: async () => ({ ok: true, ms: 1 }) });
    assert.equal(relogio.agendados.length, 1);
    assert.equal(relogio.agendados[0].ms, 300000);
    assert.equal(
      relogio.agendados[0].unrefChamado,
      true,
      'sem unref() o processo (e a suíte) não termina sozinho'
    );
  });

  it('banco de pé: uma linha `info` com o marcador e o conteúdo', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 4 }),
    });

    const linha = await amostrador.amostrarAgora();

    assert.equal(registrar.linhas.info.length, 1);
    assert.equal(registrar.linhas.warn.length, 0);
    assert.equal(registrar.linhas.error.length, 0);
    assert.equal(registrar.linhas.info[0].obj, linha);
    assert.deepEqual(linha, {
      amostra: MARCADOR_AMOSTRA,
      banco: { ok: true, ms: 4 },
      pool: { emUso: 1, ocioso: 3, total: 4, esperando: 0, max: 10 },
      memoria: { heapMb: 10, rssMb: 20 },
      uptimeS: 60,
      sockets: 3,
    });
  });

  it('banco fora: MESMO marcador, nível `warn` (é fato observado, não amostrador quebrado)', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: false, ms: 5000, motivo: 'prazo' }),
    });

    const linha = await amostrador.amostrarAgora();

    assert.equal(registrar.linhas.warn.length, 1);
    assert.equal(registrar.linhas.error.length, 0);
    assert.equal(linha.amostra, MARCADOR_AMOSTRA);
    assert.equal(linha.banco.motivo, 'prazo');
  });

  it('PROPRIEDADE (1): sonda que LANÇA vira linha de erro, nunca rejeição', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => { throw new Error('sonda quebrada'); },
    });

    const linha = await amostrador.amostrarAgora();  // não rejeita: o await é a asserção

    assert.equal(linha, null);
    assert.equal(registrar.linhas.error.length, 1);
    const { obj } = registrar.linhas.error[0];
    assert.equal(obj.amostra, MARCADOR_AMOSTRA, 'a falha do amostrador carrega o MESMO marcador');
    assert.equal(obj.falhou, true);
    assert.match(obj.err.message, /sonda quebrada/);
  });

  it('PROPRIEDADE (1): leitura de estado que lança também degrada', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 1 }),
      extras: { contarSockets: () => { throw new Error('servidor WS já fechou'); } },
    });

    assert.equal(await amostrador.amostrarAgora(), null);
    assert.equal(registrar.linhas.error.length, 1);
    assert.equal(registrar.linhas.info.length, 0);
  });

  it('PROPRIEDADE (1): até o LOGGER quebrado é engolido (não há terceiro lugar para reclamar)', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 1 }),
      loggerOpts: { falharEm: 'info' },
    });

    assert.equal(await amostrador.amostrarAgora(), null);
    // O ramo de erro tentou falar e também quebrou? Aqui só o `info` quebra, então a linha
    // de falha sai; o que este caso prova é que NADA sobe.
    assert.equal(registrar.linhas.error.length, 1);
  });

  it('PROPRIEDADE (1): o callback do TIMER não devolve promessa rejeitada', async () => {
    const { relogio, registrar } = montarAmostrador({
      sondarBanco: async () => { throw new Error('falhou dentro do timer'); },
    });

    const retorno = relogio.agendados[0].fn();
    assert.equal(retorno, undefined, 'rejeição de callback de timer não tem dono');
    await proximoTique();
    assert.equal(registrar.linhas.error.length, 1);
  });

  it('parar() cancela o timer que criou', () => {
    const { amostrador, relogio } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 1 }),
    });
    amostrador.parar();
    assert.equal(relogio.cancelados.length, 1);
    assert.equal(relogio.cancelados[0], relogio.agendados[0]);
  });

  it('sem contarSockets, a linha simplesmente não fala de sockets', async () => {
    const { amostrador } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 1 }),
      extras: { contarSockets: null },
    });
    const linha = await amostrador.amostrarAgora();
    assert.ok(!('sockets' in linha));
  });
});
