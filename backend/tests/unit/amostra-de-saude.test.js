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
//   (4) o gate de ambiente: em teste ela não liga, e o motivo é nomeado;
//   (5) o NÍVEL da linha, medido pelo `ehErro` REAL de `src/utils/diag-consulta.js`, e nunca
//       pelo número. `ehErro` reconhece um registro por `level >= 50`, por ter o campo `err`
//       ou por `statusCode >= 400`, e a amostra não tem os dois últimos (o texto da falha
//       mora em `banco.erro`, que é outro nome de campo). Enquanto banco fora saía em
//       `warn`, a amostra que dizia "o Postgres está fora" era INVISÍVEL para
//       `npm run diag -- erros`, e a do amostrador quebrado aparecia: o relatório enxergava
//       o termômetro quebrado e não o incêndio. Por isso os casos daqui importam os DOIS
//       módulos no mesmo processo e perguntam ao `ehErro` de verdade, no espírito de
//       `frontend/tests/unit/sync-trace-espelha-backend.test.js`. Asserir `level === 50`
//       ficaria verde no dia em que o critério do relatório mudasse, que é exatamente a
//       divergência que causou o defeito.
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
//     ausente cai;
//   - volte o `registrar.error` do ramo de banco fora para `registrar.warn` (a forma exata do
//     defeito de origem) e os dois casos de CLASSIFICAÇÃO de banco fora caem, com a mensagem
//     "banco fora tem de entrar no relatório de erros ...". Conferido em 2026-08-31.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { ehErro } from '../../src/utils/diag-consulta.js';
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
  // As emissões em ORDEM e COM o nível, que é o que `comoNoArquivo` precisa para remontar o
  // registro. As listas por nível acima ficam, porque é por elas que se lê "saiu uma linha, e
  // só uma".
  const emitidas = [];
  const registrar = (nivel) => (obj, msg) => {
    if (falharEm === nivel) throw new Error('logger quebrado');
    linhas[nivel].push({ obj, msg });
    emitidas.push({ nivel, obj, msg });
  };
  return {
    linhas,
    emitidas,
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

/**
 * O registro como ele CHEGA ao `.jsonl` diário, a partir do que o logger falso recebeu.
 *
 * É a ponte que o teste precisa atravessar para perguntar ao `ehErro` de verdade: o
 * amostrador chama `registrar.error(obj, msg)`, e quem transforma isso numa linha de arquivo
 * é o pino, que espalha o objeto no topo do registro e carimba `level` NUMÉRICO. O número vem
 * de `pino.levels.values`, do próprio pino, e não digitado aqui: 40 e 50 escritos à mão
 * seriam a minha lembrança do contrato, não o contrato. (`src/utils/logger.js` não define
 * `formatters.level`, então o `level` do arquivo é mesmo o número; um `formatters` que o
 * transformasse em string desligaria o primeiro termo do `ehErro` sem nada ficar vermelho.)
 */
function comoNoArquivo({ nivel, obj, msg }) {
  return { level: pino.levels.values[nivel], time: Date.now(), msg, ...obj };
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

  it('banco fora: UMA linha, com o MESMO marcador e o motivo preservado', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: false, ms: 5000, motivo: 'prazo' }),
    });

    const linha = await amostrador.amostrarAgora();

    // Uma emissão, não duas. O que ela vale para o relatório é o bloco de CLASSIFICAÇÃO
    // adiante, que pergunta ao `ehErro` em vez de contar níveis.
    assert.equal(registrar.emitidas.length, 1);
    assert.equal(registrar.linhas.info.length, 0);
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

  it('CLASSIFICAÇÃO: banco fora por ERRO entra no relatório de erros', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: false, ms: 12, motivo: 'erro', erro: 'ECONNREFUSED' }),
    });

    await amostrador.amostrarAgora();

    assert.equal(registrar.emitidas.length, 1);
    const reg = comoNoArquivo(registrar.emitidas[0]);
    // Os dois termos que o `ehErro` NÃO tem como usar aqui, ditos em voz alta: sem isto, um
    // caso verde não distinguiria "o nível está certo" de "alguém acrescentou um campo
    // `err` à linha", que é a alternativa recusada no comentário do amostrador.
    assert.equal(reg.err, undefined, 'o texto da falha mora em `banco.erro`, não em `err`');
    assert.equal(reg.statusCode, undefined);
    assert.equal(
      ehErro(reg),
      true,
      'banco fora tem de entrar no relatório de erros: em warn, a amostra que diz que o Postgres caiu é invisível para o diag'
    );
  });

  it('CLASSIFICAÇÃO: banco fora por PRAZO também entra (pool entupido não pode ser mudo)', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: false, ms: 5000, motivo: 'prazo' }),
    });

    await amostrador.amostrarAgora();

    const reg = comoNoArquivo(registrar.emitidas[0]);
    assert.equal(
      ehErro(reg),
      true,
      'banco fora tem de entrar no relatório de erros: o prazo é o incidente que a propriedade (3) existe para testemunhar'
    );
    // A distinção da propriedade (3) não se perde por os dois desfechos caírem no mesmo
    // relatório: ela vive no CAMPO, que é onde a providência se lê.
    assert.equal(reg.banco.motivo, 'prazo');
  });

  it('CLASSIFICAÇÃO: a amostra SAUDÁVEL não é erro (senão todo intervalo vira um)', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 3 }),
    });

    await amostrador.amostrarAgora();

    const reg = comoNoArquivo(registrar.emitidas[0]);
    assert.equal(
      ehErro(reg),
      false,
      'amostra saudável classificada como erro faria do firehose a campeã do relatório'
    );
  });

  it('CLASSIFICAÇÃO: o AMOSTRADOR quebrado continua sendo erro', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => { throw new Error('sonda quebrada'); },
    });

    await amostrador.amostrarAgora();

    const reg = comoNoArquivo(registrar.emitidas[0]);
    assert.equal(reg.falhou, true);
    // Este passa por DOIS termos do `ehErro` (o `err` e o nível), e é de propósito: era o
    // ÚNICO desfecho que o relatório enxergava, e o contraste com o outro é que dava a
    // leitura errada de "o amostrador quebra e o banco nunca cai".
    assert.equal(ehErro(reg), true);
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
