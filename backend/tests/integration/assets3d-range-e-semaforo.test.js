// Path: tests/integration/assets3d-range-e-semaforo.test.js
// Itens 117 e 169 — os dois lados de assets3d.controller.js que não tinham amarra.
//
// 117 (parseRange) — os testes existentes cobrem `bytes=0-9`, `bytes=-5`, `bytes=2-`
//     e o 416 por start>=size. Faltavam justamente os dois ramos que MUDAM O CORPO
//     da resposta: o clamp `if (end === null || end >= size) end = size - 1` e a
//     rejeição pelo regex. Sem o clamp, `bytes=0-999999` responderia Content-Length
//     maior que o corpo e o Cesium fica pendurado no tile. Os dois caminhos (SQLite
//     e filesystem) têm cópias independentes da mesma lógica, então tudo roda nos dois.
//
// 169 (semáforo) — classe C5 do livro-razão: permissão adquirida e não devolvida.
//     O release depende de TRÊS caminhos (res 'finish', res 'close' e o release
//     explícito do BLOB ausente / catch). Nenhum teste emitia mais requisições
//     concorrentes que `maxInflight`, então um release perdido em qualquer ramo não
//     seria notado: da nona requisição em diante tudo ficaria pendurado para sempre.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { openWritable, putAsset, closeStore } from '../../src/modules/nomes/assets3d.store.js';
import config from '../../src/config.js';

const SQLITE = resolve(process.env.ASSETS_3D_SQLITE || './data/assets3d.sqlite');
const FS_ROOT = resolve('./data/assets3d');
const PASTA = 'rangesem';

// 30 bytes exatos — o tamanho é load-bearing em todo assert de Content-Range.
const PAYLOAD = Buffer.from('0123456789abcdefghijklmnopqrst');

async function limparStore() {
  await closeStore();
  for (const f of [SQLITE, `${SQLITE}-wal`, `${SQLITE}-shm`, `${SQLITE}-journal`]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

describe('assets3d — clamp/rejeição de Range e devolução de permissão (itens 117 e 169)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    assert.equal(PAYLOAD.length, 30, 'guarda: o payload tem de ter 30 bytes');

    // Caminho SQLite.
    await limparStore();
    const w = openWritable();
    putAsset(w, `${PASTA}/sq.glb`, PAYLOAD, 'model/gltf-binary');
    w.close();

    // Caminho filesystem: um ativo que NÃO está no SQLite (fallback por stream).
    mkdirSync(join(FS_ROOT, PASTA), { recursive: true });
    writeFileSync(join(FS_ROOT, PASTA, 'fs.glb'), PAYLOAD);
  });

  after(async () => {
    await limparStore();
    if (existsSync(join(FS_ROOT, PASTA))) rmSync(join(FS_ROOT, PASTA), { recursive: true, force: true });
    await teardownTestEnv(db);
  });

  const CAMINHOS = [
    { nome: 'SQLite', url: `/api/v1/assets3d/${PASTA}/sq.glb` },
    { nome: 'filesystem', url: `/api/v1/assets3d/${PASTA}/fs.glb` },
  ];

  const pedir = (url, headers = {}) => {
    const req = supertest(app).get(url).buffer().parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    Object.entries(headers).forEach(([k, v]) => req.set(k, v));
    return req;
  };

  // ── Item 117 ───────────────────────────────────────────────────────────────

  it('clamp: bytes=0-999999 vira o arquivo inteiro nos DOIS caminhos', async () => {
    const respostas = await Promise.all(
      CAMINHOS.map(({ url }) => pedir(url, { Range: 'bytes=0-999999' }))
    );
    assert.equal(respostas.length, 2);
    respostas.forEach((res, i) => {
      const onde = CAMINHOS[i].nome;
      assert.equal(res.status, 206, onde);
      assert.equal(res.headers['content-range'], 'bytes 0-29/30', onde);
      assert.equal(res.headers['content-length'], '30', onde);
      assert.equal(Buffer.compare(res.body, PAYLOAD), 0, `${onde}: o corpo é o arquivo inteiro`);
    });
  });

  it('bytes=0-0 devolve exatamente o primeiro byte nos DOIS caminhos', async () => {
    const respostas = await Promise.all(CAMINHOS.map(({ url }) => pedir(url, { Range: 'bytes=0-0' })));
    assert.equal(respostas.length, 2);
    respostas.forEach((res, i) => {
      const onde = CAMINHOS[i].nome;
      assert.equal(res.status, 206, onde);
      assert.equal(res.headers['content-range'], 'bytes 0-0/30', onde);
      assert.equal(res.headers['content-length'], '1', onde);
      assert.equal(Buffer.compare(res.body, PAYLOAD.subarray(0, 1)), 0, onde);
    });
  });

  it('bytes=20-10 (start > end) é 416 com Content-Range */30 nos DOIS caminhos', async () => {
    const respostas = await Promise.all(CAMINHOS.map(({ url }) => pedir(url, { Range: 'bytes=20-10' })));
    assert.equal(respostas.length, 2);
    respostas.forEach((res, i) => {
      assert.equal(res.status, 416, CAMINHOS[i].nome);
      assert.equal(res.headers['content-range'], 'bytes */30', CAMINHOS[i].nome);
    });
  });

  it('Range sintaticamente inválido é 416 (comportamento atual, diferente do RFC 7233)', async () => {
    // O RFC manda IGNORAR um Range malformado e responder 200. Este servidor
    // responde 416; o comportamento fica pinado para que mudá-lo seja deliberado.
    const invalidos = ['bytes=abc', 'bytes=-', 'items=0-5'];
    const respostas = await Promise.all(
      CAMINHOS.flatMap(({ url }) => invalidos.map((r) => pedir(url, { Range: r })))
    );
    assert.equal(respostas.length, 6, 'guarda: 3 Ranges × 2 caminhos');
    const statuses = respostas.map((r) => r.status);
    assert.deepEqual(statuses, [416, 416, 416, 416, 416, 416]);
    const ranges = respostas.map((r) => r.headers['content-range']);
    assert.deepEqual(ranges, Array(6).fill('bytes */30'));
  });

  it('If-None-Match casando VENCE o Range: 304 sem corpo, antes de ler o BLOB', async () => {
    for (const { url, nome } of CAMINHOS) {
      const primeiro = await pedir(url);
      assert.equal(primeiro.status, 200, nome);
      const etag = primeiro.headers.etag;
      assert.ok(etag, `${nome}: precisa haver ETag`);

      const res = await pedir(url, { 'If-None-Match': etag, Range: 'bytes=0-9' });
      assert.equal(res.status, 304, nome);
      assert.equal(res.headers['content-range'], undefined, `${nome}: 304 não carrega Content-Range`);
      assert.equal(Buffer.byteLength(res.body ?? ''), 0, `${nome}: 304 não tem corpo`);
    }
  });

  // ── Item 169 ───────────────────────────────────────────────────────────────

  it('24 GETs concorrentes do ativo SQLite (maxInflight=8) completam com corpo íntegro', async () => {
    assert.ok(
      config.assets3d.maxInflight <= 12,
      `guarda: o teto precisa ser MENOR que a rajada (${config.assets3d.maxInflight})`
    );

    const respostas = await Promise.all(
      Array.from({ length: 24 }, () => pedir(`/api/v1/assets3d/${PASTA}/sq.glb`))
    );
    assert.equal(respostas.length, 24);
    const ruins = respostas.filter((r) => r.status !== 200 || Buffer.compare(r.body, PAYLOAD) !== 0);
    assert.equal(ruins.length, 0, 'toda requisição da rajada devolve 200 e o corpo inteiro');
  });

  it('early-returns (304 e 416) NÃO consomem permissão: intercalados com sucessos, tudo completa', async () => {
    const primeiro = await pedir(`/api/v1/assets3d/${PASTA}/sq.glb`);
    assert.equal(primeiro.status, 200);
    const etag = primeiro.headers.etag;

    const pedidos = [];
    for (let i = 0; i < 24; i += 1) {
      pedidos.push(pedir(`/api/v1/assets3d/${PASTA}/sq.glb`));
      pedidos.push(pedir(`/api/v1/assets3d/${PASTA}/sq.glb`, { 'If-None-Match': etag }));
      pedidos.push(pedir(`/api/v1/assets3d/${PASTA}/sq.glb`, { Range: 'bytes=abc' }));
    }
    const respostas = await Promise.all(pedidos);
    assert.equal(respostas.length, 72);

    const contagem = respostas.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(contagem, { 200: 24, 304: 24, 416: 24 });
  });

  it('12 requisições ao caminho FS (sem semáforo) intercaladas com 12 do SQLite completam', async () => {
    const pedidos = [];
    for (let i = 0; i < 12; i += 1) {
      pedidos.push(pedir(`/api/v1/assets3d/${PASTA}/fs.glb`));
      pedidos.push(pedir(`/api/v1/assets3d/${PASTA}/sq.glb`));
    }
    const respostas = await Promise.all(pedidos);
    assert.equal(respostas.length, 24);
    const ruins = respostas.filter((r) => r.status !== 200 || Buffer.compare(r.body, PAYLOAD) !== 0);
    assert.equal(ruins.length, 0);
  });

  it('depois de toda a rajada, uma requisição simples ainda responde 200 (nada vazou)', async () => {
    const res = await pedir(`/api/v1/assets3d/${PASTA}/sq.glb`);
    assert.equal(res.status, 200);
    assert.equal(Buffer.compare(res.body, PAYLOAD), 0);
  });
});
