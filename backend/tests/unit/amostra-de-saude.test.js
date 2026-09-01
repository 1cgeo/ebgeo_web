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
//
// O CAMPO `disco`, e por que ele é o único que foi acrescentado. Quando o disco enche,
// `log-diario.js` desliga o destino de arquivo e avisa uma vez no stderr, que num container
// some: da segunda amostra em diante a série para de aparecer no `.jsonl`, com a MESMA
// assinatura de um processo morto. `npm run diag -- saude` conta os buracos e a wiki manda
// lê-los como queda, então a única pergunta que esta camada existe para responder passou a ter
// duas respostas sem meio de separá-las. O espaço livre publicado na amostra ANTERIOR ao
// buraco é o que separa. As outras métricas que faltam (atraso de event loop, ocupação e
// companhia) produzem sinal NENHUM, que é buraco de cobertura honesto; esta produzia sinal
// AMBÍGUO, que é pior, porque é lido com confiança.
//
// CONTROLE NEGATIVO dos casos do disco (conferido revertendo cada um, 2026-09-01):
//   - troque `bavail` por `bfree` em `descreverDisco` e o caso da reserva do root cai
//     ("expected { livreMb: 100 ... } to deeply equal { livreMb: 10 ... }");
//   - tire a guarda `bsize <= 0` e o caso da regra de campo ausente cai já na primeira forma
//     que ela cobre, dizendo "bsize zero ... tinha de recusar a medição INTEIRA";
//   - troque a recusa por `{ livreMb: 0, totalMb: 0 }` e o mesmo caso cai, que é a inversão
//     do alarme escrita por extenso;
//   - tire o `try/catch` de `medirDiscoSemPerderALinha` e o caso da medição que rejeita cai
//     em "a amostra não pode se perder por causa do campo novo";
//   - tire o `if (emVoo) return null` e o caso da guarda de voo cai em "medição em voo NÃO
//     pode empilhar outra chamada de sistema";
//   - solte o `emVoo` só no ramo de sucesso e o caso do ENOENT cai em "a segunda medição foi
//     de fato tentada";
//   - tire o `Promise.resolve().then` e o caso do `statfs` síncrono deixa de reprovar: ele
//     LANÇA de dentro do `await`, derrubando o caso em vez de devolver `null`;
//   - tire o ramo do prazo de `criarMedidorDeDisco` e o caso do volume pendurado não fica
//     vermelho, fica PENDURADO até o timeout do runner ("test timed out after 8000ms", com
//     `--test-timeout`), que é o sintoma que ele descreve;
//   - troque `livre / BYTES_POR_MB` por `bavail / BYTES_POR_MB` (esquecer o `bsize`, que é o
//     erro de UNIDADE clássico) e os casos da forma medida caem dizendo `livreMb: 27` onde
//     havia 109343: 27 é um número pequeno e plausível, e é por isso que o par de controle
//     medido por caminho independente está no comentário da fixture;
//   - acrescente `if (!(estatistica.files > 0)) return null` (a sobre-validação que mata toda
//     amostra do Windows) e cai o caso dos campos zerados, junto com mais quatro;
//   - troque `if (descricaoDisco) linha.disco = ...` por atribuição INCONDICIONAL e caem sete
//     casos, entre eles dois que já existiam antes deste campo, porque `disco: null` vazando
//     para a linha é a violação da regra de campo ausente na forma mais direta;
//   - tire o `cancelar(id)` do `finally` de `criarMedidorDeDisco` e o caminho feliz cai em "o
//     temporizador do prazo é sempre cancelado".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pino from 'pino';
import { ehErro } from '../../src/utils/diag-consulta.js';
import {
  MARCADOR_AMOSTRA,
  descreverPool,
  descreverMemoria,
  descreverDisco,
  criarMedidorDeDisco,
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

/**
 * A saída LITERAL de `fs.statfsSync()` nesta plataforma, copiada de uma sondagem real em
 * `%TEMP%` (Windows, volume C: de 1 TB). Ela é fixture e não invenção porque a unidade e o
 * significado de cada campo são exatamente o que se escreve errado sem perceber: um `bsize`
 * tomado por bytes livres, ou `bfree` por `bavail`, produz um número GRANDE e PLAUSÍVEL, que
 * é a forma de erro que passa despercebida numa série temporal.
 *
 * Três coisas medidas que o campo precisa respeitar: `bsize` é o tamanho da unidade de
 * alocação em bytes (não um total), `bfree` e `bavail` são IGUAIS no Windows (no Linux não
 * são, ver o caso do `bavail`), e `type`, `files` e `ffree` vêm ZERADOS porque o conceito não
 * existe nesta plataforma, não porque acabaram.
 */
const STATFS_MEDIDO_NO_WINDOWS = Object.freeze({
  type: 0,
  bsize: 4096,
  blocks: 244273919,
  bfree: 27991933,
  bavail: 27991933,
  files: 0,
  ffree: 0,
});

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

  it('DISCO: a medição entra na linha ao lado dos outros campos', async () => {
    const { amostrador } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 1 }),
      extras: { medirDisco: async () => STATFS_MEDIDO_NO_WINDOWS },
    });

    const linha = await amostrador.amostrarAgora();

    assert.deepEqual(linha.disco, { livreMb: 109343, totalMb: 954195 });
  });

  it('DISCO: medição que REJEITA custa o CAMPO, nunca a linha', async () => {
    const { amostrador, registrar } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 1 }),
      extras: { medirDisco: async () => { throw new Error('EIO no volume'); } },
    });

    const linha = await amostrador.amostrarAgora();

    // A linha SAIU, e saiu inteira. Se a exceção subisse, `amostrarAgora` cairia no ramo
    // `falhou: true` e apagaria banco, pool, memória e uptime junto, que é o buraco na série
    // aberto pela mão do campo que existe para explicar buracos.
    assert.notEqual(linha, null, 'a amostra não pode se perder por causa do campo novo');
    assert.equal(registrar.linhas.info.length, 1);
    assert.equal(registrar.linhas.error.length, 0, 'falha de medição não é falha do amostrador');
    assert.ok(!('disco' in linha), 'não medido é AUSENTE, nunca zero');
    assert.deepEqual(linha.banco, { ok: true, ms: 1 });
    assert.deepEqual(linha.memoria, { heapMb: 10, rssMb: 20 });
    assert.equal(linha.uptimeS, 60);
  });

  it('DISCO: medição que devolve `null` (prazo vencido) some da linha', async () => {
    const { amostrador } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 1 }),
      extras: { medirDisco: async () => null },
    });

    const linha = await amostrador.amostrarAgora();

    assert.ok(!('disco' in linha));
    assert.equal(linha.amostra, MARCADOR_AMOSTRA);
  });

  it('DISCO: sem medidor, a linha simplesmente não fala de disco', async () => {
    const { amostrador } = montarAmostrador({
      sondarBanco: async () => ({ ok: true, ms: 1 }),
    });
    const linha = await amostrador.amostrarAgora();
    assert.ok(!('disco' in linha), 'o default é não medir, e não medir é não publicar');
  });
});

describe('amostra de saúde — o espaço livre onde mora o LOG_DIR', () => {
  it('MEDIDO NO WINDOWS: a forma real do fs.statfs vira livre e total plausíveis', () => {
    // Esta é a saída LITERAL de `fs.statfsSync(os.tmpdir())` nesta máquina (Windows), copiada
    // de uma sondagem, e conferida por caminho INDEPENDENTE: `Get-PSDrive C` devolveu
    // Used=885891588096 e Free=114654384128, cuja soma bate byte a byte com `bsize * blocks`
    // daqui (1000545972224), e cujo Free bate com `bsize * bavail` a menos da escrita que a
    // máquina fez entre as duas leituras. Sem esse par, "um número grande e plausível" é
    // exatamente o que uma unidade trocada produz.
    assert.deepEqual(descreverDisco(STATFS_MEDIDO_NO_WINDOWS), {
      livreMb: 109343,
      totalMb: 954195,
    });
  });

  it('MEDIDO NO WINDOWS: `files`/`ffree`/`type` ZERADOS não invalidam a medição', () => {
    // O Windows devolve zero nos três, e não porque acabaram: o conceito não existe ali. Um
    // validador que os cobrasse recusaria TODA amostra desta plataforma, e o campo nasceria
    // morto no ambiente em que foi escrito, sem nada ficar vermelho.
    assert.equal(STATFS_MEDIDO_NO_WINDOWS.files, 0);
    assert.equal(STATFS_MEDIDO_NO_WINDOWS.ffree, 0);
    assert.equal(STATFS_MEDIDO_NO_WINDOWS.type, 0);
    assert.notEqual(descreverDisco(STATFS_MEDIDO_NO_WINDOWS), null);
  });

  it('usa `bavail` e NÃO `bfree`: a reserva do root não é folga do servidor', () => {
    // No Linux `bfree` inclui os blocos reservados ao root, que o processo do servidor não
    // pode gastar. Aqui os dois divergem de propósito: se a implementação lesse `bfree`, o
    // campo anunciaria 100 MB de folga onde há 10, e erraria na direção de tranquilizar.
    const linux = { bsize: 4096, blocks: 25600, bfree: 25600, bavail: 2560 };
    assert.deepEqual(descreverDisco(linux), { livreMb: 10, totalMb: 100 });
  });

  it('DISCO CHEIO é um valor legítimo, e sai como zero', () => {
    // O contraponto de toda a regra de campo ausente: zero livre não é "não medi", é o
    // alarme. Se este caso e o de baixo dessem o mesmo resultado, o campo não serviria para
    // nada, porque a única leitura que ele precisa suportar é justamente a distinção.
    assert.deepEqual(
      descreverDisco({ bsize: 4096, blocks: 25600, bavail: 0 }),
      { livreMb: 0, totalMb: 100 }
    );
  });

  it('REGRA DE CAMPO AUSENTE: forma que não dá para medir vira `null`, nunca zero', () => {
    const naoMensuraveis = {
      'nada': null,
      'forma desconhecida': { livre: 123, total: 456 },
      'bsize ausente': { blocks: 100, bavail: 50 },
      'bavail ausente': { bsize: 4096, blocks: 100 },
      'bsize zero (zeraria os dois produtos e diria DISCO CHEIO)': {
        bsize: 0, blocks: 100, bavail: 50,
      },
      'bsize negativo': { bsize: -4096, blocks: 100, bavail: 50 },
      'blocks zero (volume de tamanho zero não é volume)': { bsize: 4096, blocks: 0, bavail: 0 },
      'bavail negativo': { bsize: 4096, blocks: 100, bavail: -1 },
      'não numérico': { bsize: '4096', blocks: 100, bavail: 50 },
      'NaN': { bsize: 4096, blocks: Number.NaN, bavail: 50 },
      'Infinity': { bsize: 4096, blocks: Infinity, bavail: 50 },
      'livre maior que o total (forma incoerente)': { bsize: 4096, blocks: 10, bavail: 11 },
      'acima do teto de precisão do double': {
        bsize: 4096, blocks: Number.MAX_SAFE_INTEGER, bavail: 1,
      },
    };

    for (const [nome, forma] of Object.entries(naoMensuraveis)) {
      assert.equal(
        descreverDisco(forma),
        null,
        `${nome}: tinha de recusar a medição INTEIRA, porque zero é alarme e não ausência`
      );
    }
    // O laço acima itera uma coleção de tamanho não asserido se ninguém disser o tamanho: com
    // a coleção vazia ele passaria verde sem verificar nada.
    assert.equal(Object.keys(naoMensuraveis).length, 13);
  });

  it('a linha OMITE `disco` quando a medição não veio', () => {
    const linha = montarAmostra({
      banco: { ok: true, ms: 1 },
      uptimeS: 10,
      disco: { bsize: 0, blocks: 100, bavail: 50 },
    });
    assert.deepEqual(Object.keys(linha), ['amostra', 'banco', 'uptimeS']);
    assert.ok(!('disco' in linha), 'campo não medido não aparece, nem como 0 nem como null');
  });
});

describe('amostra de saúde — o medidor de disco tem prazo e guarda de voo', () => {
  it('caminho feliz: devolve a estatística CRUA, e cancela o prazo', async () => {
    const relogio = temporizadorFalso();
    const medir = criarMedidorDeDisco({
      caminho: '/var/log/ebgeo',
      statfs: async (p) => ({ ...STATFS_MEDIDO_NO_WINDOWS, caminhoPedido: p }),
      prazoMs: 2000,
      agendar: relogio.agendar,
      cancelar: relogio.cancelar,
    });

    const estatistica = await medir();

    assert.equal(estatistica.caminhoPedido, '/var/log/ebgeo', 'mede o LOG_DIR, não outra coisa');
    assert.equal(estatistica.bavail, STATFS_MEDIDO_NO_WINDOWS.bavail);
    assert.equal(relogio.cancelados.length, 1, 'o temporizador do prazo é sempre cancelado');
  });

  it('volume PENDURADO vence o prazo e vira ausência, sem pendurar a amostra', async () => {
    const relogio = temporizadorFalso({ dispararNaHora: true });
    const medir = criarMedidorDeDisco({
      caminho: '/mnt/nfs/logs',
      statfs: () => new Promise(() => {}),   // NFS pendurado: nem resolve nem rejeita
      prazoMs: 2000,
      agendar: relogio.agendar,
      cancelar: relogio.cancelar,
    });

    // O `await` É a asserção: sem prazo, este caso nunca terminaria.
    assert.equal(await medir(), null);
    assert.equal(relogio.agendados[0].ms, 2000, 'o prazo agendado é o pedido');
    assert.equal(relogio.agendados[0].unrefChamado, true, 'nem o prazo segura o event loop');
  });

  it('GUARDA DE VOO: enquanto a medição não assentou, a próxima não é emitida', async () => {
    let chamadas = 0;
    let liberar = null;
    // O prazo vence na hora nas duas primeiras medições (o volume pendurado) e deixa de vencer
    // na terceira, para que ela possa mostrar o valor de verdade. Um temporizador que vencesse
    // SEMPRE faria a terceira devolver `null` por prazo, e o caso passaria a verde medindo o
    // temporizador em vez da guarda.
    let vencerNaHora = true;
    const agendados = [];
    const agendar = (fn, ms) => {
      const id = { ms, unrefChamado: false, unref() { id.unrefChamado = true; } };
      agendados.push(id);
      if (vencerNaHora) fn();
      return id;
    };
    const medir = criarMedidorDeDisco({
      caminho: '/mnt/nfs/logs',
      statfs: () => { chamadas += 1; return new Promise((r) => { liberar = r; }); },
      prazoMs: 2000,
      agendar,
      cancelar: () => {},
    });

    assert.equal(await medir(), null, 'a primeira vence o prazo');
    assert.equal(chamadas, 1);

    // O prazo abandonou a ESPERA, não a chamada: ela continua ocupando um dos quatro slots do
    // threadpool do libuv, que é o mesmo que grava o `.jsonl`. Sem esta guarda, uma amostra
    // por intervalo satura os quatro e o amostrador de saúde vira o incidente.
    assert.equal(await medir(), null);
    assert.equal(chamadas, 1, 'medição em voo NÃO pode empilhar outra chamada de sistema');

    liberar(STATFS_MEDIDO_NO_WINDOWS);
    await proximoTique();

    vencerNaHora = false;
    const promessa = medir();
    await proximoTique();   // deixa o `statfs` da terceira medição ser de fato chamado
    liberar(STATFS_MEDIDO_NO_WINDOWS);
    const depois = await promessa;

    assert.equal(chamadas, 2, 'assentada a anterior, a guarda solta');
    assert.equal(depois.bavail, STATFS_MEDIDO_NO_WINDOWS.bavail);
    // DUAS, não três: a medição barrada pela guarda não agenda nem prazo. Ela custa zero.
    assert.equal(agendados.length, 2);
    assert.equal(agendados[1].unrefChamado, true);
  });

  it('NUNCA rejeita: ENOENT, EACCES e afins viram ausência', async () => {
    const relogio = temporizadorFalso();
    const medir = criarMedidorDeDisco({
      caminho: '/nao/existe',
      statfs: async () => {
        const err = new Error("ENOENT: no such file or directory, statfs '/nao/existe'");
        err.code = 'ENOENT';
        throw err;
      },
      agendar: relogio.agendar,
      cancelar: relogio.cancelar,
    });

    assert.equal(await medir(), null);
    // E a guarda de voo SOLTA no caminho de erro: se ela só soltasse no sucesso, um volume
    // que rejeitasse depressa mataria o campo para sempre, em silêncio.
    assert.equal(await medir(), null);
    assert.equal(relogio.agendados.length, 2, 'a segunda medição foi de fato tentada');
  });

  it('NUNCA rejeita: nem um `statfs` que lança SINCRONAMENTE', async () => {
    const relogio = temporizadorFalso();
    const medir = criarMedidorDeDisco({
      caminho: '/var/log/ebgeo',
      statfs: () => { throw new TypeError('statfs não é função'); },
      agendar: relogio.agendar,
      cancelar: relogio.cancelar,
    });

    // Exceção síncrona daqui subiria por um callback de TIMER, que é o que a propriedade (1)
    // proíbe: no Node 22 ela derruba o processo.
    assert.equal(await medir(), null);
  });
});

describe('FIACAO: o boot liga o medidor de disco', () => {
  // GUARDA DO IRMAO ESQUECIDO. O campo de disco e OPCIONAL por desenho (campo que nao pode
  // ser medido nao aparece na linha), entao desfiar o medidor no boot nao produz erro
  // nenhum: produz exatamente a ausencia que o desenho trata como normal. O defeito ficaria
  // invisivel justamente no incidente que o campo existe para explicar, e a suite inteira
  // continuaria verde, porque todo o resto do modulo e exercitado com o medidor INJETADO.
  //
  // Por isso a assercao e sobre o FONTE do boot: src/index.js nao e importavel aqui (ao ser
  // avaliado ele sobe servidor HTTP, WebSocket e pool), e um teste que o importasse estaria
  // medindo outra coisa.
  it('o boot passa o medidor de disco para o amostrador', () => {
    const fonte = readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8');

    // PISO: sem isto, um arquivo renomeado, vazio ou ilegivel passaria verde em todas as
    // ausencias abaixo, que e cobertura vazia na forma mais barata de escrever.
    assert.ok(fonte.includes('criarAmostradorDeSaude({'), 'o boot ainda monta o amostrador');

    assert.ok(
      fonte.includes('criarMedidorDeDisco('),
      'o boot precisa CONSTRUIR o medidor de disco, senao o campo some em silencio'
    );
    assert.match(
      fonte,
      /medirDisco:\s*criarMedidorDeDisco\(/,
      'o medidor precisa ser PASSADO como medirDisco: construi-lo e nao fia-lo e o mesmo que nao te-lo'
    );
  });
});
