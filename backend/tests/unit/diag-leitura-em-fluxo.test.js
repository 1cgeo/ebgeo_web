// Path: tests/unit/diag-leitura-em-fluxo.test.js
//
// `lerRegistros` (`scripts/diag.js`) fazia `readFileSync().split('\n')` e devolvia a janela
// INTEIRA num array, sem teto. Medido nesta máquina, num arquivo de 108 MB com 402 mil
// linhas: pico de 410 a 488 MB de working set, contra 60 a 91 MB depois da leitura em fluxo.
// E havia parede DURA: acima de 512 MiB de string o node levanta `ERR_STRING_TOO_LONG`, sem
// escape por reduzir a janela, porque o arquivo era lido e parseado inteiro ANTES do filtro
// por tempo (medido: 382 ms com `--desde 5m` contra 433 ms com `24h`).
//
// SÃO TRÊS NATUREZAS DE TESTE AQUI, e cada uma sozinha deixa passar o defeito da outra:
//
//   (1) EQUIVALÊNCIA da leitura. O leitor antigo está copiado abaixo, palavra por palavra,
//       e as duas listas são comparadas sobre o mesmo arquivo. Sem isto, um leitor que
//       perdesse a última linha do arquivo, ou o filtro por tempo, passaria no teste de
//       memória com folga (quanto menos ele lê, menos ele gasta).
//   (2) ORÇAMENTO de memória. A equivalência sozinha aceita de volta o `readFileSync`, que é
//       equivalente por construção.
//   (3) EQUIVALÊNCIA do agrupamento. A leitura em fluxo obrigou `agruparErros` a virar um
//       acumulador de duas passadas, e a fusão das duas linhas de uma requisição falha é o
//       ponto onde uma reescrita "que funciona" muda contagens em silêncio.
//
// CONTROLE NEGATIVO (conferido revertendo cada peça, com a mensagem observada no relatório):
//   - trocar `percorrerRegistros` de volta pelo `readFileSync().split()` acumulando num array:
//     o caso do orçamento reprova (o de equivalência continua verde, de propósito);
//   - tirar o filtro por `reg.time`: o caso da equivalência reprova, porque o leitor antigo
//     descarta o que caiu fora da janela;
//   - tirar a segunda passada de `erros` e indexar as linhas ricas na mesma passada: o caso
//     "a linha rica chega DEPOIS da linha de requisição" reprova, porque a fusão não acontece
//     e o mesmo erro conta duas vezes, em duas assinaturas;
//   - casar o filtro contra `JSON.stringify(reg)` de novo: os dois casos do escape reprovam,
//     porque a re-serialização e o disco discordam exatamente ali.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { percorrerRegistros } from '../../scripts/diag.js';
import { parseLinha, agruparErros, fundirPorRequisicao, ehErro, assinaturaDeErro } from '../../src/utils/diag-consulta.js';

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));

/**
 * Uma coleta de lixo sob demanda, sem exigir que o corredor de testes rode com
 * `--expose-gc`.
 *
 * Sem ela não há como medir RETENÇÃO: `heapUsed` logo depois de uma passada inclui todo o
 * lixo que o parser gerou e ainda não foi coletado, então um leitor que não guarda nada e um
 * que guarda tudo saem parecidos. Com ela, a diferença entre os dois é a medição.
 */
const coletar = (() => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  v8.setFlagsFromString('--no-expose-gc');
  return gc;
})();
const DIA_MS = 86_400_000;
const temporarios = [];

after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

function novoDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-fluxo-'));
  temporarios.push(dir);
  return dir;
}

/** O nome de arquivo que `diasDaJanela` procura para um instante (dia LOCAL). */
function arquivoDoDia(t) {
  const d = new Date(t);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `ebgeo-${d.getFullYear()}-${mes}-${dia}.jsonl`;
}

/**
 * O leitor de 2026-08-31, palavra por palavra, como referência de equivalência.
 *
 * Ele é a definição do que a leitura em fluxo precisa preservar: quais arquivos abre, o que
 * descarta e em que ordem entrega.
 */
function lerRegistrosComoAntes(dir, desdeMs, agora) {
  const inicio = new Date(agora.getTime() - desdeMs);
  const registros = [];
  let arquivosLidos = 0;
  const dias = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const ultimo = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  while (cursor <= ultimo) {
    const mes = String(cursor.getMonth() + 1).padStart(2, '0');
    const dia = String(cursor.getDate()).padStart(2, '0');
    dias.push(`${cursor.getFullYear()}-${mes}-${dia}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const dia of dias) {
    const alvo = path.join(dir, `ebgeo-${dia}.jsonl`);
    if (!fs.existsSync(alvo)) continue;
    arquivosLidos += 1;
    for (const linha of fs.readFileSync(alvo, 'utf8').split('\n')) {
      const reg = parseLinha(linha);
      if (!reg) continue;
      if (typeof reg.time === 'number' && reg.time < inicio.getTime()) continue;
      registros.push(reg);
    }
  }
  return { registros, arquivosLidos, inicio };
}

/** Escreve linhas cruas no arquivo do dia de `t`. */
function escrever(dir, t, linhas) {
  fs.appendFileSync(path.join(dir, arquivoDoDia(t)), `${linhas.join('\n')}\n`);
}

describe('diag — a leitura em fluxo entrega o MESMO que a leitura em memória', () => {
  it('mesmos registros, mesma ordem, mesmos arquivos e mesmo começo de janela', async () => {
    const dir = novoDir();
    const agora = new Date();
    const t = agora.getTime();
    // Uma janela que atravessa a meia-noite, com linha velha (fora), linha sem `time`,
    // linha que não é JSON, linha vazia, e a última sem quebra de linha no fim.
    escrever(dir, t - DIA_MS, [
      JSON.stringify({ level: 30, time: t - DIA_MS, msg: 'de ontem, dentro da janela' }),
      JSON.stringify({ level: 30, time: t - 3 * DIA_MS, msg: 'velha demais' }),
      'isto não é json',
      '',
      JSON.stringify({ level: 50, msg: 'sem horário nenhum' }),
    ]);
    fs.appendFileSync(
      path.join(dir, arquivoDoDia(t)),
      `${[
        JSON.stringify({ level: 30, time: t - 60_000, reqId: 'r1', method: 'GET', url: '/api/v1/atlas', statusCode: 200, duration: 4, msg: 'request' }),
        JSON.stringify({ level: 40, time: t - 30_000, reqId: 'r2', err: { type: 'BadRequestError', message: 'x' }, method: 'POST', url: '/api/v1/atlas', msg: 'Request error' }),
        JSON.stringify({ level: 30, time: t - 29_000, reqId: 'r2', ip: '203.0.113.9', method: 'POST', url: '/api/v1/atlas', statusCode: 400, duration: 7, msg: 'request' }),
      ].join('\n')}`
    );

    const esperado = lerRegistrosComoAntes(dir, 2 * DIA_MS, agora);
    const obtido = [];
    const leitura = await percorrerRegistros(dir, 2 * DIA_MS, agora, (reg) => obtido.push(reg));

    assert.equal(esperado.registros.length, 5, 'a fixture precisa ter registros, senão as duas listas vazias passam iguais');
    assert.deepEqual(obtido, esperado.registros);
    assert.equal(leitura.linhas, esperado.registros.length);
    assert.equal(leitura.arquivosLidos, esperado.arquivosLidos);
    assert.equal(leitura.inicio.getTime(), esperado.inicio.getTime());
  });

  it('a última linha SEM quebra no fim entra (é o arquivo que está sendo escrito agora)', async () => {
    const dir = novoDir();
    const agora = new Date();
    fs.writeFileSync(
      path.join(dir, arquivoDoDia(agora.getTime())),
      `${JSON.stringify({ level: 30, time: agora.getTime() - 1000, msg: 'sem \\n no fim' })}`
    );
    const vistos = [];
    await percorrerRegistros(dir, 3_600_000, agora, (reg) => vistos.push(reg));
    assert.equal(vistos.length, 1);
    assert.equal(vistos[0].msg, 'sem \\n no fim');
  });

  it('a LINHA CRUA chega ao chamador, byte a byte como está no disco', async () => {
    const dir = novoDir();
    const agora = new Date();
    // `é` no disco: `JSON.parse` seguido de `JSON.stringify` devolveria `é`, então esta
    // linha distingue o texto do disco do texto re-serializado.
    const crua = `{"level":30,"time":${agora.getTime() - 1000},"msg":"caf\\u00e9"}`;
    fs.writeFileSync(path.join(dir, arquivoDoDia(agora.getTime())), `${crua}\n`);

    const linhas = [];
    await percorrerRegistros(dir, 3_600_000, agora, (reg, linha) => linhas.push({ reg, linha }));
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].linha, crua);
    assert.equal(linhas[0].reg.msg, 'café', 'o registro parseado continua sendo o objeto de verdade');
    assert.notEqual(JSON.stringify(linhas[0].reg), crua, 'se as duas formas fossem iguais, este teste não distinguiria nada');
  });
});

describe('diag — a leitura em fluxo não segura o arquivo', () => {
  const dir = novoDir();
  const agora = new Date();
  const LINHAS = 220_000;
  let tamanho = 0;

  before(() => {
    // Um arquivo com o mesmo formato e a mesma densidade do log real (~200 B por linha do
    // `request-logger`), grande o bastante para que segurá-lo seja visível na RSS.
    const alvo = path.join(dir, arquivoDoDia(agora.getTime()));
    const fd = fs.openSync(alvo, 'w');
    let lote = [];
    for (let i = 0; i < LINHAS; i += 1) {
      lote.push(JSON.stringify({
        level: 30, time: agora.getTime() - 1000 - i, pid: 4242, hostname: 'ebgeo',
        reqId: `0000${i.toString(16).padStart(8, '0')}-4b1c-4f9a-9b8f-1c0f9a1b2c3d`,
        ip: `203.0.113.${i % 250}`, method: 'GET', url: '/api/v1/atlas/8f14e45f-ceea-467a-9b8f-4b1c0f9a1111/sync',
        statusCode: 200, duration: (i % 97) + 3, userId: '8f14e45f-ceea-467a-9b8f-4b1c0f9a2222', msg: 'request',
      }));
      if (lote.length >= 2000) { fs.writeSync(fd, `${lote.join('\n')}\n`); lote = []; }
    }
    if (lote.length) fs.writeSync(fd, `${lote.join('\n')}\n`);
    fs.closeSync(fd);
    tamanho = fs.statSync(alvo).size;
  });

  it('o pico de memória fica LONGE do tamanho do arquivo, e a medição sabe discriminar', async () => {
    const mb = (x) => `${(x / 1048576).toFixed(1)} MB`;
    coletar();
    const base = process.memoryUsage().heapUsed;
    let vistos = 0;
    let pico = 0;
    await percorrerRegistros(dir, DIA_MS, agora, () => {
      vistos += 1;
      // Amostrar de dois em dois mil, e não a cada linha: `memoryUsage()` custa uma chamada
      // de sistema, e a 150 mil delas o teste mediria a si mesmo.
      if (vistos % 2000 !== 0) return;
      const usado = process.memoryUsage().heapUsed - base;
      if (usado > pico) pico = usado;
    });
    coletar();
    const retidoPeloFluxo = process.memoryUsage().heapUsed - base;

    // O leitor ANTIGO, no MESMO processo e sobre o MESMO arquivo, logo depois, com a lista
    // viva na variável. É ele que calibra a medição: sem este segundo trecho, um
    // `process.memoryUsage()` que devolvesse sempre o mesmo número passaria verde, que é a
    // cobertura vazia da constituição.
    const antigo = lerRegistrosComoAntes(dir, DIA_MS, agora);
    coletar();
    const retidoPeloAntigo = process.memoryUsage().heapUsed - base - retidoPeloFluxo;

    assert.equal(vistos, LINHAS);
    assert.equal(antigo.registros.length, LINHAS);
    assert.ok(tamanho > 25_000_000, `a fixture precisa ser grande de verdade (${mb(tamanho)})`);

    // OS TETOS SÃO DERIVADOS DO ARQUIVO, e não números escritos: qualquer leitor que retenha
    // o conteúdo paga pelo menos o tamanho dele (o `readFileSync` paga isso só na string,
    // antes de um objeto sequer), então uma fração do arquivo separa o fluxo de qualquer
    // forma de retenção.
    //
    // A FOLGA É GENEROSA DE PROPÓSITO, e as duas linhas medem coisas diferentes.
    //
    // O PICO inclui o lixo que o parser gera ENTRE duas coletas, e esse lixo é função da
    // cadência do GC, não do arquivo: medido em 7 MB num processo recém-nascido (com arquivo
    // de 44 MB e com um de 108 MB, o mesmo número) e em 24 a 27 MB aqui dentro, onde o heap
    // já cresceu escrevendo a fixture. Um teto de METADE do arquivo flakeou 4 vezes em 5 por
    // isso, medindo a heurística do GC e não o algoritmo. O teto é o tamanho do arquivo:
    // duas vezes e meia o ruído observado, e ainda assim menos da metade do que um leitor
    // que retém marca (o controle negativo mediu 118,7 MB de pico sobre um arquivo de
    // 44,3 MB, e aqui o arquivo é maior).
    //
    // O RETIDO é o que sobra DEPOIS da coleta, e é a propriedade de verdade: medido em
    // 0,2 MB, contra o teto de um décimo do arquivo.
    assert.ok(
      pico < tamanho,
      `o pico do fluxo foi ${mb(pico)} num arquivo de ${mb(tamanho)} (teto: o tamanho do arquivo)`
    );
    assert.ok(
      retidoPeloFluxo < tamanho / 10,
      `o fluxo RETEVE ${mb(retidoPeloFluxo)} de um arquivo de ${mb(tamanho)} (teto: um décimo)`
    );
    assert.ok(
      retidoPeloAntigo > retidoPeloFluxo * 10,
      `a medição não discriminou: fluxo reteve ${mb(retidoPeloFluxo)}, leitor antigo ${mb(retidoPeloAntigo)}`
    );
  });
});

describe('diag — o agrupamento em duas passadas preserva a semântica', () => {
  /**
   * `agruparErros` de 2026-08-31, palavra por palavra, sobre a `fundirPorRequisicao` que
   * continua exportada. É a referência: a versão de hoje é um acumulador que recebe um
   * registro por vez e agrega os fundidos no fim, ou seja, numa ORDEM diferente.
   */
  function agruparComoAntes(registros) {
    const mapa = new Map();
    for (const reg of fundirPorRequisicao(registros)) {
      if (!ehErro(reg)) continue;
      const chave = assinaturaDeErro(reg);
      const t = typeof reg.time === 'number' ? reg.time : 0;
      const atual = mapa.get(chave);
      if (!atual) {
        mapa.set(chave, { assinatura: chave, total: 1, primeira: t, ultima: t, exemplo: reg });
        continue;
      }
      atual.total += 1;
      if (t < atual.primeira) atual.primeira = t;
      if (t > atual.ultima) { atual.ultima = t; atual.exemplo = reg; }
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total || b.ultima - a.ultima);
  }

  /**
   * Compara ignorando SÓ o campo novo, e conferindo a PROCEDÊNCIA do `exemplo` por
   * identidade: ele é o registro que a rota recorta depois, e uma cópia estruturalmente
   * igual passaria num `deepEqual` enquanto muda quem é o objeto. O índice na entrada (ou
   * -1 para o registro FUNDIDO, que é novo dos dois lados) é o que torna a asserção
   * incondicional; um `if` por grupo seria assert que pode não rodar.
   */
  function assertMesmoAgrupamento(entrada, nota) {
    const esperado = agruparComoAntes(entrada);
    const obtido = agruparErros(entrada);
    const semEnderecos = obtido.map(({ enderecos: _enderecos, ...resto }) => resto);
    const procedencia = (grupos) => grupos.map((g) => entrada.indexOf(g.exemplo));

    assert.equal(obtido.length, esperado.length, `${nota}: número de grupos`);
    assert.deepEqual(obtido.map((g) => Boolean(g.enderecos)), esperado.map(() => true), `${nota}: todo grupo traz o campo novo`);
    assert.deepEqual(procedencia(semEnderecos), procedencia(esperado), `${nota}: procedência do exemplo`);
    assert.deepEqual(semEnderecos, esperado, `${nota}: conteúdo`);
    return obtido;
  }

  it('o par comum: errorHandler + request-logger viram UMA ocorrência', () => {
    const grupos = assertMesmoAgrupamento([
      { time: 1, reqId: 'r1', err: { type: 'BadRequestError', message: 'x' }, method: 'POST', url: '/api/v1/atlas' },
      { time: 2, reqId: 'r1', statusCode: 400, method: 'POST', url: '/api/v1/atlas', ip: '203.0.113.9' },
    ], 'par comum');
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].total, 1);
  });

  it('a linha RICA que chega DEPOIS da linha de requisição também funde', () => {
    // É o caso que uma passada só não resolve: ao ler a linha de requisição ainda não se
    // sabe que existe linha rica para aquele `reqId`.
    const grupos = assertMesmoAgrupamento([
      { time: 2, reqId: 'r1', statusCode: 400, method: 'POST', url: '/api/v1/atlas', ip: '203.0.113.9' },
      { time: 1, reqId: 'r1', err: { type: 'BadRequestError', message: 'x' }, method: 'POST', url: '/api/v1/atlas' },
    ], 'rica depois');
    assert.equal(grupos.length, 1, 'sem a fusão seriam DUAS assinaturas para um erro só');
    assert.equal(grupos[0].total, 1);
  });

  it('empate no instante mais recente: o exemplo é o PRIMEIRO da ordem de leitura', () => {
    const grupos = assertMesmoAgrupamento([
      { time: 5, level: 50, msg: 'igual', url: '/a', method: 'GET' },
      { time: 5, level: 50, msg: 'igual', url: '/a', method: 'GET' },
    ], 'empate de instante');
    assert.equal(grupos[0].total, 2);
  });

  it('empate de total e de instante: a ordem dos grupos é a da primeira aparição', () => {
    assertMesmoAgrupamento([
      { time: 7, level: 50, msg: 'bbb' },
      { time: 7, level: 50, msg: 'aaa' },
    ], 'empate de grupo');
  });

  it('fuzz determinístico: mil listas sorteadas, mesmo agrupamento da referência', () => {
    let semente = 20260901;
    const proximo = (n) => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente % n;
    };
    for (let caso = 0; caso < 1000; caso += 1) {
      const entrada = [];
      const tamanho = proximo(9) + 1;
      const anteriores = [];
      for (let i = 0; i < tamanho; i += 1) {
        const sorte = proximo(10);
        if (sorte === 0) { entrada.push(null); continue; }
        if (sorte === 1 && anteriores.length) {
          entrada.push(anteriores[proximo(anteriores.length)]);
          continue;
        }
        const reg = { time: proximo(3) };
        if (sorte !== 2) reg.reqId = `r${proximo(3)}`;
        if (sorte % 2 === 0) reg.err = { message: `m${proximo(2)}` };
        const status = proximo(4);
        if (status === 1) reg.statusCode = 400 + proximo(2);
        else if (status === 2) reg.statusCode = 200;
        if (proximo(2)) reg.url = `/rota/${proximo(2)}`;
        if (proximo(3) === 0) reg.ip = `203.0.113.${proximo(4)}`;
        entrada.push(reg);
        anteriores.push(reg);
      }
      assertMesmoAgrupamento(entrada, `fuzz caso ${caso}`);
    }
  });
});

describe('diag — a ordem das duas linhas no arquivo não decide a fusão', () => {
  it('linha de requisição ANTES da linha rica: continua UMA assinatura, UMA ocorrência', () => {
    // É o caso que a SEGUNDA passada existe para cobrir. Numa passada só, ao ler a linha de
    // requisição ainda não se sabe que existe linha rica para aquele `reqId`, então ela entra
    // no relatório sozinha e o mesmo erro conta duas vezes, em duas assinaturas, que é
    // exatamente o defeito de 2026-08-30 que a fusão veio desfazer.
    const dir = novoDir();
    const agora = Date.now();
    escrever(dir, agora, [
      JSON.stringify({ level: 30, time: agora - 2000, reqId: 'r9', ip: '203.0.113.7', method: 'POST', url: '/api/v1/atlas', statusCode: 400, duration: 5, msg: 'request' }),
      JSON.stringify({ level: 40, time: agora - 1000, reqId: 'r9', method: 'POST', url: '/api/v1/atlas', err: { type: 'BadRequestError', message: 'nome obrigatório' }, msg: 'Request error' }),
    ]);

    const r = spawnSync(process.execPath, [COMANDO, 'erros', '--dir', dir, '--desde', '1h'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 assinatura\(s\) de erro, 1 ocorrência\(s\)/);
    assert.match(r.stdout, /BadRequestError \| nome obrigatório \[400\]/);
    assert.match(r.stdout, /1 endereço só, em 1 das 1 ocorrência\(s\): 203\.0\.113\.7/);
  });
});

describe('diag — o --filtro casa a linha COMO ELA ESTÁ NO DISCO', () => {
  const dir = novoDir();
  const agora = Date.now();

  before(() => {
    // Duas linhas: uma com escape `é` no disco, outra sem. A re-serialização
    // (`JSON.stringify` do objeto parseado) desfaz o escape, então as duas formas discordam
    // exatamente aqui, e é isso que separa "casar o disco" de "casar um texto inventado".
    escrever(dir, agora, [
      `{"level":30,"time":${agora - 2000},"msg":"caf\\u00e9","url":"/api/v1/nomes/busca"}`,
      `{"level":30,"time":${agora - 1000},"msg":"outra","url":"/api/v1/config"}`,
    ]);
  });

  const rodar = (...args) => spawnSync(process.execPath, [COMANDO, 'linhas', '--dir', dir, '--desde', '1h', ...args], { encoding: 'utf8' });

  it('casa o escape que existe no disco, e imprime a linha crua', () => {
    const r = rodar('--filtro', '\\u00e9');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 linha\(s\) casaram/);
    assert.match(r.stdout, /caf\\u00e9/, 'a linha sai como está no disco, não re-serializada');
  });

  it('NÃO casa a forma re-serializada, que nunca existiu em arquivo nenhum', () => {
    const r = rodar('--filtro', 'café');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0 linha\(s\) casaram/);
  });

  it('filtro por VALOR estreita de verdade', () => {
    const r = rodar('--filtro', '/api/v1/config');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 linha\(s\) casaram/);
  });

  it('--filtro time casa TUDO, e o comando diz por quê em vez de deixar a conclusão errada', () => {
    // O nome do campo é texto na linha do disco também, então nenhum casamento por substring
    // pode deixar de casá-lo: `"time"` está em toda linha que o pino escreve. O que mudou é
    // que o relatório agora NOMEIA isso, em vez de devolver a janela inteira sem explicação.
    const r = rodar('--filtro', 'time');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 linha\(s\) casaram/);
    assert.match(r.stdout, /casou TODAS as 2 linha\(s\) da janela, ou seja, não estreitou nada/);
    assert.match(r.stdout, /Procure pelo VALOR/);
  });

  it('filtro que estreita NÃO leva a nota (ela avisaria sobre um problema que não há)', () => {
    const r = rodar('--filtro', '/api/v1/config');
    assert.doesNotMatch(r.stdout, /não estreitou nada/);
  });

  it('sem filtro nenhum não há nota, mesmo casando tudo', () => {
    const r = rodar();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 linha\(s\) casaram/);
    assert.doesNotMatch(r.stdout, /não estreitou nada/);
  });
});
