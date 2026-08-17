// Path: tests/integration/app-mount-order.test.js
//
// Item 112. O 404 catch-all e o `errorHandler` fecham a cadeia de `app.js` (as duas
// últimas linhas antes do `return app`). Montar um router NOVO depois deles — erro
// trivial num arquivo de 180 linhas com 17 `app.use` — faz o módulo inteiro responder
// 404 silenciosamente, sem erro de boot, sem log e sem nada vermelho: um 404 é
// exatamente o que o cliente veria de uma rota que não existe.
//
// `health.test.js` afirma que uma rota desconhecida dá 404, o que é o lado FÁCIL. O
// lado que faltava é o oposto: que cada prefixo declarado está ANTES do catch-all e
// portanto é alcançável. Dois prefixos já montados (ranks, debug) não recebiam nenhum
// request na suíte quando o relatório foi escrito, então ninguém distinguiria "montado"
// de "inalcançável".
//
// A guarda anti-cobertura-vazia aqui não é um número mágico: a lista de sondas é
// confrontada com os prefixos LIDOS DE `app.js`. Montar um router novo sem sonda
// reprova este teste, que é a única maneira de a lista não apodrecer.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(__dirname, '..', '..', 'src', 'app.js');

// Uma sonda por prefixo montado: um caminho que o SUB-ROUTER daquele prefixo de fato
// declara. Sem credencial de propósito — 401/403/422/200 são todos aceitáveis, o que
// importa é a resposta NÃO ser o 404 do catch-all.
//
// `method` é OPCIONAL e vale 'get' por padrão. Ele existe porque nem todo router
// declara um GET: `resource-access` nasceu só com PATCH, e sondá-lo com GET
// produzia o 404 do catch-all — ou seja, o guarda acusaria "inalcançável" um
// prefixo perfeitamente montado. Um guarda que só sabe interrogar um verbo obriga
// o código a ter esse verbo, e isso é a ferramenta mandando no desenho.
const PROBES = [
  { prefix: '/api/v1/config', path: '/api/v1/config' },
  { prefix: '/api/config', path: '/api/config' },
  { prefix: '/api/v1/assets3d', path: '/api/v1/assets3d/nao-existe.glb' },
  { prefix: '/api/v1/auth', path: '/api/v1/auth/me' },
  { prefix: '/api/v1/users', path: '/api/v1/users/me' },
  { prefix: '/api/v1/atlas', path: '/api/v1/atlas' },
  { prefix: '/api/v1/basemaps', path: '/api/v1/basemaps' },
  { prefix: '/api/v1/data-layers', path: '/api/v1/data-layers' },
  { prefix: '/api/v1/analysis-layers', path: '/api/v1/analysis-layers' },
  { prefix: '/api/v1/tilesets', path: '/api/v1/tilesets' },
  { prefix: '/api/v1/streetview-markers', path: '/api/v1/streetview-markers' },
  { prefix: '/api/v1/nomes', path: '/api/v1/nomes/busca?q=zz&lat=-22.9&lon=-43.2' },
  { prefix: '/api/v1/organizations', path: '/api/v1/organizations' },
  { prefix: '/api/v1/ranks', path: '/api/v1/ranks' },
  { prefix: '/api/v1/audit', path: '/api/v1/audit' },
  { prefix: '/api/v1/zones', path: '/api/v1/zones' },
  { prefix: '/api/v1/sv360', path: '/api/v1/sv360/projects' },
  // Desde F3 o módulo TAMBÉM tem GET (`/visible`), mas a sonda continua no PATCH
  // de propósito: é a única que exercita a opção `method`, e opção de guarda que
  // nenhum caso usa é opção que ninguém percebe quebrar.
  { prefix: '/api/v1/resource-access', path: '/api/v1/resource-access/tileset/x/visibility', method: 'patch' },
  { prefix: '/api/v1/debug', path: '/api/v1/debug/trace' },
];

/** Reads every `app.use('<path>', …)` prefix declared in app.js. */
function declaredPrefixes() {
  const src = readFileSync(APP_JS, 'utf8');
  return [...src.matchAll(/app\.use\(\s*'(\/[^']*)'/g)].map((m) => m[1]);
}

describe('app.js mount order — every declared prefix is reachable (112)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('control: an unmatched route IS the catch-all 404, formatted by the errorHandler', async () => {
    // Sem este controle, o assert "não é 404 do catch-all" abaixo não saberia
    // distinguir os dois 404 possíveis (o do catch-all e o de um recurso ausente).
    const res = await supertest(app).get('/api/v1/naoexiste').expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'Route not found');
    // O envelope só sai formatado assim se o errorHandler for o ÚLTIMO middleware:
    // o `next(new NotFoundError('Route'))` do catch-all precisa cair nele.
    assert.equal(typeof res.body.error.code, 'string');
    assert.equal(res.body.data, undefined);
  });

  it('control: a deep unmatched path under a REAL prefix also reaches the catch-all', async () => {
    const res = await supertest(app).get('/api/v1/atlas/nao/existe/mesmo').expect(404);
    assert.equal(res.body.error.message, 'Route not found');
  });

  it('the probe list covers EVERY prefix declared in app.js (guard against rot)', () => {
    const declared = declaredPrefixes();
    // Anti-cobertura-vazia: se o regex parar de casar, a varredura vira vazia e todo
    // o resto deste teste passaria sem verificar nada.
    assert.ok(
      declared.length >= 16,
      `expected >= 16 app.use('<prefix>') in app.js, found ${declared.length}: ${JSON.stringify(declared)}`
    );

    const probed = new Set(PROBES.map((p) => p.prefix));
    const semSonda = declared.filter((p) => !probed.has(p));
    assert.deepEqual(
      semSonda, [],
      'prefixo montado sem sonda neste teste — acrescente uma em PROBES'
    );

    const orfas = PROBES.map((p) => p.prefix).filter((p) => !declared.includes(p));
    assert.deepEqual(orfas, [], 'sonda apontando para prefixo que app.js não monta mais');
  });

  it('no probed prefix answers the catch-all 404', async () => {
    assert.ok(PROBES.length >= 16, `guard: ${PROBES.length} probes is too few to prove anything`);

    const catchAll = [];
    for (const { prefix, path, method = 'get' } of PROBES) {
      const res = await supertest(app)[method](path);
      if (res.status === 404 && res.body?.error?.message === 'Route not found') {
        catchAll.push(`${prefix} (via ${path}) -> catch-all 404`);
      }
    }
    assert.deepEqual(
      catchAll, [],
      'prefixo(s) inalcançável(is): montados DEPOIS do catch-all, ou não montados'
    );
  });

  it('instrument control: a router mounted AFTER the catch-all IS detected as unreachable', async () => {
    // Controle negativo sem mutar `app.js` (arquivo de outra fatia, editado em
    // paralelo): reproduzimos o defeito num app local e passamos o MESMO predicado.
    // Se ele não reprovasse aqui, o `deepEqual([], …)` acima seria decorativo.
    const express = (await import('express')).default;
    const { errorHandler } = await import('../../src/middleware/error-handler.js');
    const { NotFoundError } = await import('../../src/utils/errors.js');

    const broken = express();
    broken.use((req, res, next) => next(new NotFoundError('Route')));   // catch-all cedo
    broken.use('/api/v1/tarde', (req, res) => res.json({ data: 'ok' })); // montado depois
    broken.use(errorHandler);

    const res = await supertest(broken).get('/api/v1/tarde');
    const detectado = res.status === 404 && res.body?.error?.message === 'Route not found';
    assert.equal(detectado, true, 'o predicado precisa enxergar um prefixo inalcançável');

    // E o mesmo predicado NÃO pode acusar um app correto.
    const ok = express();
    ok.use('/api/v1/cedo', (req, res) => res.json({ data: 'ok' }));
    ok.use((req, res, next) => next(new NotFoundError('Route')));
    ok.use(errorHandler);
    const res2 = await supertest(ok).get('/api/v1/cedo');
    assert.equal(res2.status, 200);
  });

  it('reports how many prefixes were checked (a contagem faz parte da asserção)', () => {
    assert.equal(
      PROBES.length, declaredPrefixes().length,
      'uma sonda por prefixo, exatamente'
    );
  });

  it('the debug prefix is mounted in the test env — otherwise its probe proves nothing', async () => {
    // `app.js:117` monta /api/v1/debug só com `isTraceEnabled() && !config.isProd`.
    // Se ele não estivesse montado, a sonda dele daria catch-all 404 e o teste acima
    // reprovaria — este caso torna a razão explícita em vez de misteriosa.
    const res = await supertest(app).get('/api/v1/debug/trace');
    assert.equal(res.status, 401, 'debug/trace sem credencial responde 401, não 404');
  });

  it('the error envelope is produced by the errorHandler on a NON-404 path too', async () => {
    // Se o errorHandler não fosse o último, um erro lançado dentro de um router sairia
    // como o HTML padrão do Express, não como {error:{code,message}}.
    const res = await supertest(app).get('/api/v1/atlas').expect(401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
    assert.equal(typeof res.body.error.message, 'string');
  });
});
