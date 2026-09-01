// Path: tests/unit/diag-leitura-de-log.test.js
// A leitura do log em arquivo por trás de `GET /diag/erros|lento|status`: quais arquivos
// abrir, o que descartar, e o que fazer quando não há diretório nenhum.
//
// ESTE ARQUIVO RODA SEM BANCO E SEM CONFIG, e essa é a razão de `diag.service.js` receber o
// diretório por argumento em vez de importar `config`: com o import, este teste exigiria
// DATABASE_URL e JWT_SECRET para exercitar uma função que só lê disco.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - trocar o `fs.existsSync(diretorio)` por leitura direta: o caso do diretório ausente
//    passa a lançar ENOENT, e a rota de diagnóstico responderia 500 justamente quando o
//    operador está diagnosticando;
//  - remover o filtro por `reg.time`: o caso "janela de uma hora dentro de um arquivo de
//    dia inteiro" passa a devolver as linhas velhas junto, e o relatório responde sobre
//    outro período sem avisar;
//  - trocar `diasDaJanela` por "só o dia de hoje": o caso da virada da meia-noite perde o
//    arquivo de ontem, que é exatamente a hora em que ninguém pensa nisso;
//  - trocar o anel por um corte simples (`break` ao encher): o caso do teto passa a
//    guardar as linhas MAIS ANTIGAS, e "o que quebrou agora" some da resposta.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerJanela, erros, lento, status, mapearGrupo } from '../../src/modules/diag/diag.service.js';

/**
 * O dia local em AAAA-MM-DD, escrito à mão e não importado de `log-diario.js`: um teste que
 * usa a mesma função do produto para prever o nome do arquivo passa verde com as duas
 * pontas erradas do mesmo jeito.
 */
function dia(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${d}`;
}

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-diag-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Escreve linhas (objetos) no arquivo do dia de `data`. */
function escrever(data, registros) {
  const alvo = path.join(dir, `ebgeo-${dia(data)}.jsonl`);
  fs.appendFileSync(alvo, registros.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

const requisicao = (time, extra = {}) => ({
  level: 30, time, reqId: `req-${time}`, method: 'GET', url: '/api/v1/atlas',
  statusCode: 200, duration: 10, msg: 'request', ...extra,
});

describe('diag — leitura do log em arquivo', () => {
  it('diretório ausente devolve resposta vazia e BEM-FORMADA, dizendo qual caminho faltou', async () => {
    const inexistente = path.join(dir, 'nao-existe');
    const j = await lerJanela({ diretorio: inexistente, desdeMs: 3_600_000 });

    assert.equal(j.diretorioAusente, true);
    assert.equal(j.arquivos, 0);
    assert.equal(j.linhas, 0);
    assert.deepEqual(j.registros, []);
    assert.equal(j.diretorio, path.resolve(inexistente), 'o caminho resolvido volta ao operador');
  });

  it('diretório vazio NÃO é diretório ausente (os dois estados são distinguíveis)', async () => {
    const j = await lerJanela({ diretorio: dir, desdeMs: 3_600_000 });
    assert.equal(j.diretorioAusente, false);
    assert.equal(j.arquivos, 0);
    assert.equal(j.linhas, 0);
  });

  it('lê o arquivo do dia e descarta o que caiu fora da janela', async () => {
    const agora = new Date('2026-08-30T15:00:00');
    escrever(agora, [
      requisicao(agora.getTime() - 30 * 60_000),      // dentro
      requisicao(agora.getTime() - 5 * 60_000),       // dentro
      requisicao(agora.getTime() - 5 * 60 * 60_000),  // fora (5 h atrás)
    ]);

    const j = await lerJanela({ diretorio: dir, desdeMs: 3_600_000, agora });
    assert.equal(j.arquivos, 1);
    assert.equal(j.linhas, 2);
    assert.equal(j.truncado, false);
    assert.deepEqual(
      j.registros.map((r) => r.time),
      [agora.getTime() - 30 * 60_000, agora.getTime() - 5 * 60_000]
    );
  });

  it('a janela que atravessa a meia-noite abre os DOIS arquivos', async () => {
    const agora = new Date('2026-08-30T00:30:00');
    const ontem = new Date('2026-08-29T23:50:00');
    escrever(ontem, [requisicao(ontem.getTime())]);
    escrever(agora, [requisicao(agora.getTime() - 60_000)]);

    const j = await lerJanela({ diretorio: dir, desdeMs: 3_600_000, agora });
    assert.equal(j.arquivos, 2, 'o arquivo de ontem também entra');
    assert.equal(j.linhas, 2);
  });

  it('ignora linha que não é JSON, linha vazia e arquivo de outro prefixo', async () => {
    const agora = new Date('2026-08-30T15:00:00');
    escrever(agora, [requisicao(agora.getTime())]);
    fs.appendFileSync(path.join(dir, `ebgeo-${dia(agora)}.jsonl`), '\nnão é json\n{quebrado\n');
    // Arquivo alheio no mesmo diretório: não é nosso, não se lê.
    fs.writeFileSync(
      path.join(dir, `outroapp-${dia(agora)}.jsonl`),
      `${JSON.stringify(requisicao(agora.getTime(), { url: '/de-outro-app' }))}\n`
    );

    const j = await lerJanela({ diretorio: dir, desdeMs: 3_600_000, agora });
    assert.equal(j.arquivos, 1);
    assert.equal(j.linhas, 1);
    assert.equal(j.registros[0].url, '/api/v1/atlas');
  });

  it('passando do teto de registros, guarda os MAIS RECENTES e diz que truncou', async () => {
    const agora = new Date('2026-08-30T15:00:00');
    const base = agora.getTime() - 10 * 60_000;
    escrever(agora, Array.from({ length: 10 }, (_, i) => requisicao(base + i * 1000)));

    const j = await lerJanela({ diretorio: dir, desdeMs: 3_600_000, agora, maxRegistros: 4 });
    assert.equal(j.truncado, true);
    assert.equal(j.linhas, 4);
    assert.deepEqual(
      j.registros.map((r) => r.time),
      [base + 6000, base + 7000, base + 8000, base + 9000],
      'os quatro últimos, em ordem cronológica'
    );
  });

  it('exatamente no teto NÃO trunca (a fronteira, dos dois lados)', async () => {
    const agora = new Date('2026-08-30T15:00:00');
    const base = agora.getTime() - 60_000;
    escrever(agora, Array.from({ length: 4 }, (_, i) => requisicao(base + i)));

    const cheio = await lerJanela({ diretorio: dir, desdeMs: 3_600_000, agora, maxRegistros: 4 });
    assert.equal(cheio.truncado, false);
    assert.equal(cheio.linhas, 4);

    const passou = await lerJanela({ diretorio: dir, desdeMs: 3_600_000, agora, maxRegistros: 3 });
    assert.equal(passou.truncado, true);
    assert.equal(passou.linhas, 3);
  });
});

describe('diag — as três consultas sobre o arquivo', () => {
  const agora = new Date('2026-08-30T15:00:00');

  /**
   * Duas linhas da MESMA requisição falha, como o servidor real as escreve: a do
   * `errorHandler` (com `err`) e a do `requestLogger` (com `statusCode` e `duration`).
   */
  function erroReal(time, { reqId, url, msg, stack, statusCode }) {
    return [
      { level: 50, time, reqId, method: 'POST', url, msg: 'Request error', err: { type: 'Error', message: msg, stack } },
      { level: 40, time: time + 1, reqId, method: 'POST', url, statusCode, duration: 42, msg: 'request error' },
    ];
  }

  it('erros: agrupa por assinatura, funde as duas linhas da mesma requisição e corta pelo limite', async () => {
    const t = agora.getTime() - 60_000;
    escrever(agora, [
      ...erroReal(t, { reqId: 'a', url: '/api/v1/atlas/11111111-2222-3333-4444-555555555555/sync', msg: 'op inválida', stack: 'Error: op inválida\n  at x', statusCode: 400 }),
      // Outro atlas, MESMO defeito: a normalização de rota tem de fundir os dois.
      ...erroReal(t + 100, { reqId: 'b', url: '/api/v1/atlas/99999999-8888-7777-6666-555555555555/sync', msg: 'op inválida', stack: 'Error: op inválida\n  at x', statusCode: 400 }),
      ...erroReal(t + 200, { reqId: 'c', url: '/api/v1/users', msg: 'outro defeito', stack: 'Error: outro\n  at y', statusCode: 500 }),
      requisicao(t + 300),
    ]);

    const r = await erros({ diretorio: dir, desde: '1h', limite: 20, agora });
    assert.equal(r.desde, agora.getTime() - 3_600_000);
    assert.equal(r.arquivos, 1);
    assert.equal(r.diretorioAusente, false);
    assert.equal(r.assinaturas, 2, 'duas assinaturas: o sync (dois atlas) e o /users');
    assert.equal(r.grupos.length, 2);

    const sync = r.grupos[0];
    assert.equal(sync.total, 2, 'dois atlas diferentes, uma assinatura');
    assert.match(sync.assinatura, /:id\/sync/);
    assert.equal(sync.exemplo.method, 'POST');
    assert.equal(sync.exemplo.statusCode, 400, 'o status vem da OUTRA linha, pela fusão por reqId');
    assert.match(sync.exemplo.stack, /^Error: op inválida/);
    assert.equal(sync.primeira, t);
    assert.equal(sync.ultima, t + 100);

    const cortado = await erros({ diretorio: dir, desde: '1h', limite: 1, agora });
    assert.equal(cortado.grupos.length, 1);
    assert.equal(cortado.assinaturas, 2, 'a contagem total sobrevive ao corte');
  });

  it('lento: p50/p95/máx por rota, ordenado pela cauda', async () => {
    const t = agora.getTime() - 60_000;
    escrever(agora, [
      ...[5, 10, 15, 900].map((d, i) => requisicao(t + i, { url: '/api/v1/nomes/busca', duration: d })),
      ...[100, 110].map((d, i) => requisicao(t + 10 + i, { url: '/api/v1/config', duration: d })),
    ]);

    const r = await lento({ diretorio: dir, desde: '1h', limite: 10, agora });
    assert.equal(r.total, 2);
    assert.equal(r.rotas.length, 2);
    assert.equal(r.rotas[0].rota, 'GET /api/v1/nomes/busca', 'a cauda decide a ordem, não a média');
    assert.equal(r.rotas[0].n, 4);
    assert.equal(r.rotas[0].p50, 10);
    assert.equal(r.rotas[0].max, 900);
    assert.equal(r.rotas[1].rota, 'GET /api/v1/config');
  });

  it('status: contagem por faixa, e `erros` conta também o que não tem status', async () => {
    const t = agora.getTime() - 60_000;
    escrever(agora, [
      requisicao(t, { statusCode: 200 }),
      requisicao(t + 1, { statusCode: 204 }),
      requisicao(t + 2, { statusCode: 404, level: 40 }),
      requisicao(t + 3, { statusCode: 500, level: 50 }),
      // Falha FORA do ciclo HTTP (o sweep do WS, um job): sem statusCode nenhum.
      { level: 50, time: t + 4, msg: 'sweep falhou', err: { type: 'Error', message: 'x' } },
    ]);

    const r = await status({ diretorio: dir, desde: '1h', agora });
    assert.equal(r.total, 4, 'quatro requisições com status');
    assert.deepEqual(r.porFaixa, { '2xx': 2, '4xx': 1, '5xx': 1 });
    assert.equal(r.erros, 3, '404 + 500 + a falha sem status');
  });

  it('as três respondem bem-formadas com o diretório ausente', async () => {
    const inexistente = path.join(dir, 'nao-existe');
    const e = await erros({ diretorio: inexistente, desde: '1h', limite: 20, agora });
    const l = await lento({ diretorio: inexistente, desde: '1h', limite: 15, agora });
    const s = await status({ diretorio: inexistente, desde: '1h', agora });

    for (const r of [e, l, s]) {
      assert.equal(r.diretorioAusente, true);
      assert.equal(r.arquivos, 0);
      assert.equal(r.linhas, 0);
      assert.equal(r.desde, agora.getTime() - 3_600_000);
    }
    assert.deepEqual(e.grupos, []);
    assert.deepEqual(l.rotas, []);
    assert.deepEqual(s.porFaixa, {});
    assert.equal(s.total, 0);
    assert.equal(s.erros, 0);
  });
});

// ===== o recorte de um grupo: o que atravessa e o que morre nele =====
//
// A PERGUNTA QUE ESTE BLOCO PRENDE é "este pico de 401 é UM endereço ou trezentos?", e ela
// só tem resposta se a agregação por endereço (`enderecos`, cunhada em `agruparErros`)
// atravessar o recorte. Ela é a única coisa que passou a atravessar: o `exemplo` continua
// com as MESMAS quatro chaves, e é por isso que a asserção é de IGUALDADE DE CONJUNTO e não
// de presença. Presença deixa a lista crescer sem ninguém ver, e o campo que cresceria
// primeiro é justamente o `ip` do registro cru, que é dado pessoal de UMA ocorrência e não
// responde a pergunta de cima.
//
// CONTROLE NEGATIVO (verificado, com a mensagem observada):
//  - apagar `if (g.enderecos) saida.enderecos = g.enderecos;` de `mapearGrupo`: o primeiro
//    caso reprova em `Expected values to be strictly deep-equal`, com `enderecos` ausente
//    do conjunto de chaves;
//  - acrescentar `ip: reg.ip` ao `exemplo`: o segundo e o quarto casos reprovam nomeando a
//    chave a mais, que é exatamente o alargamento silencioso que a igualdade impede.
describe('diag — o recorte de um grupo (`mapearGrupo`)', () => {
  const agora = new Date('2026-08-30T15:00:00');

  const grupoCru = (extra = {}) => ({
    assinatura: 'POST /api/v1/auth/login | Error | credenciais inválidas [401]',
    total: 312,
    primeira: 1,
    ultima: 2,
    exemplo: {
      level: 40,
      time: 2,
      reqId: 'req-2',
      // O que o recorte existe para MATAR, e as duas primeiras são o assunto desta mudança:
      // o endereço de uma ocorrência e o usuário.
      ip: '203.0.113.9',
      userId: 'u-1',
      duration: 12,
      method: 'POST',
      url: '/api/v1/auth/login',
      statusCode: 401,
      err: { type: 'Error', message: 'credenciais inválidas', stack: 'Error: x\n  at y' },
    },
    ...extra,
  });

  it('o campo de endereços atravessa inteiro, e por identidade de valor', () => {
    const enderecos = { distintos: 2, principais: [{ ip: '203.0.113.9', total: 300 }, { ip: '198.51.100.4', total: 12 }] };
    const g = mapearGrupo(grupoCru({ enderecos }));

    assert.deepEqual(Object.keys(g).sort(), ['assinatura', 'enderecos', 'exemplo', 'primeira', 'total', 'ultima']);
    assert.deepEqual(g.enderecos, enderecos, 'o agregado passa como veio: quem o apara é a tela');
  });

  it('e o `exemplo` continua com as mesmas quatro chaves, sem o endereço cru nem o usuário', () => {
    const g = mapearGrupo(grupoCru({ enderecos: { distintos: 1, principais: [{ ip: '203.0.113.9', total: 312 }] } }));

    assert.deepEqual(Object.keys(g.exemplo).sort(), ['method', 'stack', 'statusCode', 'url']);
    assert.equal(g.exemplo.statusCode, 401);
    assert.equal(g.exemplo.url, '/api/v1/auth/login');
  });

  it('sem o campo, a CHAVE não nasce: ausente e zero são estados diferentes na tela', () => {
    // Um `enderecos: undefined` posto sempre some do JSON e sobrevive como chave no objeto,
    // e é essa discordância entre a resposta e o objeto que esta asserção impede. O cliente
    // lê a ausência como "esta versão do servidor não informa", que não é "zero endereços".
    const g = mapearGrupo(grupoCru());
    assert.equal(Object.hasOwn(g, 'enderecos'), false);
    assert.deepEqual(Object.keys(g).sort(), ['assinatura', 'exemplo', 'primeira', 'total', 'ultima']);

    // E zero distintos ATRAVESSA, porque zero é uma afirmação do agregador: são as linhas
    // sem `ip` nenhum (erro fora do ciclo HTTP, ou linha anterior ao campo).
    const comZero = mapearGrupo(grupoCru({ enderecos: { distintos: 0, principais: [] } }));
    assert.deepEqual(comZero.enderecos, { distintos: 0, principais: [] });
  });

  it('e o caminho vivo de `erros()` continua entregando o mesmo `exemplo` recortado', async () => {
    // A asserção acima é sobre a função; esta é sobre a ROTA, e ela não pode afirmar nada
    // sobre `enderecos`, que é campo da agregação e não deste arquivo. O que ela prende é o
    // que este arquivo controla dos dois lados: o recorte do exemplo no caminho real.
    const t = agora.getTime() - 60_000;
    escrever(agora, [
      { level: 50, time: t, reqId: 'z', method: 'POST', url: '/api/v1/auth/login', ip: '203.0.113.9', userId: 'u-1', msg: 'Request error', err: { type: 'Error', message: 'credenciais inválidas', stack: 'Error: c\n  at y' } },
      { level: 40, time: t + 1, reqId: 'z', method: 'POST', url: '/api/v1/auth/login', ip: '203.0.113.9', statusCode: 401, duration: 5, msg: 'request error' },
    ]);
    const r = await erros({ diretorio: dir, desde: '1h', limite: 20, agora });
    assert.equal(r.grupos.length, 1);
    assert.deepEqual(Object.keys(r.grupos[0].exemplo).sort(), ['method', 'stack', 'statusCode', 'url']);
  });
});
