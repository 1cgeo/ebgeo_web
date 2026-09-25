// Path: tests/integration/imagens-orfas-portas.test.js
//
// AS DUAS PORTAS DA COLETA DE IMAGEM ÓRFÃ: a rota de administrador (`/api/v1/diag/imagens-orfas`)
// e o comando (`npm run diag -- orfas`). O comportamento da coleta mora em
// `tests/integration/imagens-orfas.test.js`; aqui se prende o que a porta acrescenta: o gate
// (administrador, sessão, e nenhuma chave de API), o padrão SEM escrita, a bandeira explícita para
// apagar, e o ator da trilha vindo da sessão na rota e do `--como` no comando.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createProducerUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { ACAO_DE_REMOCAO } from '../../src/modules/images/imagens-orfas.service.js';

/** The seeded organization, the producer's scope (see `access-groups-crud.test.js`). */
const OM_PADRAO = '00000000-0000-0000-0000-000000000001';
const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

/** Runs the command in a child process WITH a deadline (see `diag-cli-estado-de-defeito.test.js`). */
function rodar(args) {
  const r = spawnSync(process.execPath, [COMANDO, ...args], {
    encoding: 'utf8', env: process.env, timeout: 30_000, killSignal: 'SIGKILL',
  });
  assert.equal(r.signal, null, `o comando foi morto por ${r.signal}: pool vazado ou consulta presa`);
  return { codigo: r.status, saida: r.stdout || '', erro: r.stderr || '' };
}

describe('coleta de imagem órfã: rota e comando', () => {
  let app, db, admin, comum, tokAdmin, tokComum, tokProdutor, tokCredenciado, chave;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: `orfas_padm_${randomUUID().slice(0, 6)}` });
    comum = await createUser(db, { username: `orfas_pcom_${randomUUID().slice(0, 6)}` });
    tokAdmin = await loginUser(app, admin.username, admin.password);
    tokComum = await loginUser(app, comum.username, comum.password);
    // The two global roles that are NOT a rung below admin (the axis is not a ladder): each one
    // holds a power of its own over the collection, and neither administers the system.
    const produtor = await createProducerUser(db, OM_PADRAO, { username: `orfas_pprod_${randomUUID().slice(0, 6)}` });
    const credenciado = await createUser(db, { username: `orfas_pcred_${randomUUID().slice(0, 6)}`, role: 'credenciado' });
    tokProdutor = await loginUser(app, produtor.username, produtor.password);
    tokCredenciado = await loginUser(app, credenciado.username, credenciado.password);
    const { rows } = await db.query(
      `INSERT INTO api_keys (user_id, api_key, label, scope, expires_at)
       VALUES ($1, gen_random_uuid(), 'orfas', 'full', NOW() + INTERVAL '30 days') RETURNING api_key`,
      [admin.id]
    );
    chave = rows[0].api_key;
  });

  after(async () => {
    await db.query('DELETE FROM api_keys WHERE user_id = $1', [admin.id]);
    await teardownTestEnv(db);
  });

  /** A fresh atlas with one ELIGIBLE orphan (40 days old, marked 31 days ago), file on disk. */
  async function atlasComOrfa() {
    const atlas = await createAtlas(db, admin.id, { name: `Portas ${randomUUID().slice(0, 6)}` });
    const id = randomUUID();
    const dir = join(config.images.dir, atlas.id);
    mkdirSync(dir, { recursive: true });
    const caminho = join(dir, `${id}.png`);
    writeFileSync(caminho, PNG);
    await db.query(
      `INSERT INTO images (id, atlas_id, filename, mime_type, size_bytes, storage_path, created_at, sem_referencia_desde)
       VALUES ($1, $2, 'orfa.png', 'image/png', $3, $4, NOW() - INTERVAL '40 days', NOW() - INTERVAL '31 days')`,
      [id, atlas.id, PNG.length, caminho]
    );
    return { atlas, id, caminho };
  }

  const existe = async (id) => (await db.query('SELECT 1 FROM images WHERE id = $1', [id])).rows.length === 1;
  const linhasDeTrilha = async (atlasId) => (await db.query(
    'SELECT actor_id FROM audit_trail WHERE action = $1 AND target_id = $2', [ACAO_DE_REMOCAO, atlasId]
  )).rows;

  // ------------------------------------------------------------------ ROTA
  describe('rota /api/v1/diag/imagens-orfas', () => {
    it('GET é a simulação: lista a elegível com os bytes e não apaga nada', async () => {
      const { atlas, id, caminho } = await atlasComOrfa();
      const res = await supertest(app).get(`/api/v1/diag/imagens-orfas?atlasId=${atlas.id}`)
        .set('Authorization', `Bearer ${tokAdmin}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.modo, 'simulacao');
      assert.deepEqual(res.body.data.elegiveis.porAtlas.flatMap((g) => g.imagens.map((i) => i.id)), [id]);
      assert.equal(res.body.data.elegiveis.bytes, PNG.length);
      assert.ok(await existe(id));
      assert.ok(existsSync(caminho));
    });

    // THE GATE, over the two verbs and every principal that is NOT a session of a system admin.
    // The global axis is not a ladder (CONSTITUICAO.md 1.1): producer and credenciado are listed
    // one by one, because a gate written as "not a plain user" would let both through, and the API
    // key is the admin's OWN key, because what it lacks is the session, not the rank (10.7).
    // Every refused call aims at an atlas with an ELIGIBLE orphan and asks to DELETE it, so a gate
    // that let one through would show up as a missing row, not only as a status code.
    it('só a SESSÃO de administrador passa: chave de API do próprio administrador, comum, produtor e credenciado recebem 403, sem sessão 401, e nada sai', async () => {
      const { atlas, id, caminho } = await atlasComOrfa();
      const recusados = [
        { quem: 'chave de API do administrador', cabecalho: ['x-api-key', chave], status: 403 },
        { quem: 'conta comum', cabecalho: ['Authorization', `Bearer ${tokComum}`], status: 403 },
        { quem: 'produtor', cabecalho: ['Authorization', `Bearer ${tokProdutor}`], status: 403 },
        { quem: 'credenciado', cabecalho: ['Authorization', `Bearer ${tokCredenciado}`], status: 403 },
        { quem: 'sem sessão', cabecalho: null, status: 401 },
      ];
      for (const r of recusados) {
        const pedir = (req) => (r.cabecalho ? req.set(...r.cabecalho) : req);
        const leitura = await pedir(supertest(app).get(`/api/v1/diag/imagens-orfas?atlasId=${atlas.id}`));
        assert.equal(leitura.status, r.status, `GET por ${r.quem}: ${JSON.stringify(leitura.body)}`);
        assert.equal(leitura.body.data, undefined, `GET por ${r.quem} não devolve relatório`);
        for (const acao of ['marcar', 'apagar']) {
          const escrita = await pedir(supertest(app).post('/api/v1/diag/imagens-orfas')).send({ acao, atlasId: atlas.id });
          assert.equal(escrita.status, r.status, `POST ${acao} por ${r.quem}: ${JSON.stringify(escrita.body)}`);
        }
      }
      assert.ok(await existe(id), 'nenhum dos recusados apagou a órfã elegível');
      assert.ok(existsSync(caminho), 'nem o arquivo dela');
      assert.deepEqual(await linhasDeTrilha(atlas.id), [], 'nem deixou linha na trilha');

      // THE POSITIVE CONTROL, on the same atlas: the admin's SESSION does delete it. Without this,
      // the refusals above could be an atlas the collector would not touch anyway.
      const res = await supertest(app).post('/api/v1/diag/imagens-orfas').set('Authorization', `Bearer ${tokAdmin}`)
        .send({ acao: 'apagar', atlasId: atlas.id });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(await existe(id), false);
    });

    it('POST sem `acao` válida é recusado (a simulação não é um POST)', async () => {
      for (const corpo of [{}, { acao: 'simulacao' }, { acao: 'APAGAR' }]) {
        const res = await supertest(app).post('/api/v1/diag/imagens-orfas').set('Authorization', `Bearer ${tokAdmin}`).send(corpo);
        assert.equal(res.status, 422, `${JSON.stringify(corpo)} -> ${res.status}`);
      }
    });

    it('POST `apagar` apaga a elegível, e a trilha leva o ator da SESSÃO', async () => {
      const { atlas, id, caminho } = await atlasComOrfa();
      const res = await supertest(app).post('/api/v1/diag/imagens-orfas').set('Authorization', `Bearer ${tokAdmin}`)
        .send({ acao: 'apagar', atlasId: atlas.id });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.apagadas.quantidade, 1);
      assert.equal(await existe(id), false);
      assert.equal(existsSync(caminho), false);
      assert.deepEqual((await linhasDeTrilha(atlas.id)).map((l) => l.actor_id), [admin.id]);
    });

    it('POST `marcar` escreve marcas e não apaga', async () => {
      const { atlas, id } = await atlasComOrfa();
      const res = await supertest(app).post('/api/v1/diag/imagens-orfas').set('Authorization', `Bearer ${tokAdmin}`)
        .send({ acao: 'marcar', atlasId: atlas.id });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.modo, 'marcar');
      assert.ok(await existe(id));
      assert.deepEqual(await linhasDeTrilha(atlas.id), []);
    });
  });

  // ------------------------------------------------------------------ COMANDO
  describe('comando `npm run diag -- orfas`', () => {
    it('o padrão é a simulação, em JSON sem janela, e não escreve', async () => {
      const { atlas, id } = await atlasComOrfa();
      const r = rodar(['orfas', '--atlas', atlas.id, '--json']);
      assert.equal(r.codigo, 0, r.erro);
      const doc = JSON.parse(r.saida);
      assert.equal(doc.comando, 'orfas');
      assert.equal(doc.janela, null);
      assert.equal(doc.modo, 'simulacao');
      assert.deepEqual(doc.elegiveis.porAtlas.flatMap((g) => g.imagens.map((i) => i.id)), [id]);
      assert.ok(await existe(id));
    });

    it('a saída humana diz o MODO e o que apagaria', async () => {
      const { atlas } = await atlasComOrfa();
      const r = rodar(['orfas', '--atlas', atlas.id]);
      assert.equal(r.codigo, 0, r.erro);
      assert.match(r.saida, /SIMULAÇÃO \(nada foi escrito\)/);
      assert.match(r.saida, /apagaria agora: 1 imagem\(ns\)/);
      assert.match(r.saida, /orfas --apagar --como/);
    });

    it('`--apagar` sem `--como` recusa antes de tocar no banco, e nada sai', async () => {
      const { atlas, id } = await atlasComOrfa();
      const r = rodar(['orfas', '--apagar', '--atlas', atlas.id]);
      assert.equal(r.codigo, 1);
      assert.match(r.erro, /Falta --como/);
      assert.ok(await existe(id));
    });

    it('`--marcar --apagar` juntos e `--atlas` que não é uuid são erro de uso', () => {
      assert.equal(rodar(['orfas', '--marcar', '--apagar', '--como', admin.username]).codigo, 1);
      assert.equal(rodar(['orfas', '--atlas', 'nao-e-uuid']).codigo, 1);
    });

    it('`--como` de conta que não é administrador recusa, e nada sai', async () => {
      const { atlas, id } = await atlasComOrfa();
      const r = rodar(['orfas', '--apagar', '--como', comum.username, '--atlas', atlas.id]);
      assert.equal(r.codigo, 1);
      assert.match(r.erro, /NÃO é administrador/);
      assert.ok(await existe(id));
    });

    it('`--apagar --como <admin>` apaga, e a trilha leva o ator do `--como`', async () => {
      const { atlas, id, caminho } = await atlasComOrfa();
      const r = rodar(['orfas', '--apagar', '--como', admin.username, '--atlas', atlas.id, '--json']);
      assert.equal(r.codigo, 0, r.erro);
      const doc = JSON.parse(r.saida);
      assert.equal(doc.apagadas.quantidade, 1);
      assert.equal(doc.ator.username, admin.username);
      assert.equal(await existe(id), false);
      assert.equal(existsSync(caminho), false);
      assert.deepEqual((await linhasDeTrilha(atlas.id)).map((l) => l.actor_id), [admin.id]);
    });
  });
});
