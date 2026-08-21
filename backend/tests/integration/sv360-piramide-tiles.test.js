// Path: tests/integration/sv360-piramide-tiles.test.js
// A PANORÂMICA SERVIDA EM PEDAÇOS: o descritor da escada e os tiles.
//
// POR QUE ESTA SUPERFÍCIE EXISTE. O acervo do ebgeo_360 aposentou `full_webp` e
// `preview_webp` (29 projetos, 64,6 GB liberados) e passou a ser só pirâmide de tiles.
// Este backend só sabia servir imagem inteira, então, sem estas duas rotas, todo acervo
// novo importado para cá chega sem nenhuma fonte de pixel: a foto não pinta, e não há
// erro em lugar nenhum que diga por quê.
//
// O QUE ESTE ARQUIVO PRENDE, e a ordem é deliberada: PRIVACIDADE primeiro.
//
// A pior falha que esta linha de trabalho já encontrou em si mesma foi um predicado de
// privacidade do MVT do 360 passar VERDE ao ser revertido, porque a suíte media
// privacidade na listagem e nunca no tile. Aqui nascem duas portas novas para o mesmo
// pixel, e as duas são medidas contra um forasteiro — não porque se duvide do predicado,
// mas porque "um recurso sai por muitas portas, e o predicado numa consulta não protege
// as outras" é a lição que este módulo pagou. Os casos de privacidade abaixo são
// escritos para FALHAR se alguém remover `sv360AccessPredicate` de
// `GET_PHOTO_PYRAMID`, e isso foi verificado por controle negativo, não suposto.
//
// A SEGUNDA COISA que ele prende é o REGIME DE CACHE, e ele difere entre as duas rotas
// por natureza: o tile é imutável (uma escada gravada não muda de conteúdo), o descritor
// NÃO é (a escada se regera, e um descritor pregado por um ano deixa o cliente pedindo
// tiles que não existem mais).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import path from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createProducerUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const RID = crypto.randomUUID().slice(0, 8);
const JWT_SECRET = process.env.JWT_SECRET;
const url = (p) => `/api/v1/sv360${p}`;

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
/**
 * Gera um uuid v5 determinístico, como o estúdio de calibração faz para id de foto.
 * @param {string} name - semente
 * @returns {string} uuid v5
 */
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/**
 * Token de um usuário REAL: a leitura de projeto restrito é resolvida em SQL a partir do
 * uuid, então um `sub` inventado não exercita o predicado.
 * @param {Object} opts - orgId, role, producerOrgId, sub
 * @returns {string} JWT
 */
function mintToken({ orgId, role = 'user', producerOrgId = null, sub }) {
  return jwt.sign(
    {
      sub,
      username: `pyr_${RID}_${String(sub).slice(0, 8)}`,
      role,
      organization_id: orgId,
      org_role: 'viewer',
      producer_org_id: producerOrgId,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

// A escada do fixture: 512 de lado, nativo 1024x512, razão 2, max_level 1.
//   nível 0 → 512x256  → 1x1 tile
//   nível 1 → 1024x512 → 2x1 tiles
// Três tiles ao todo. Números pequenos de propósito: o que se mede aqui é a borda da
// grade, e uma escada grande só faria o fixture demorar.
const TILE_SIZE = 512;
const MAX_LEVEL = 1;
const WIDTH = 1024;
const HEIGHT = 512;
const TILES = [
  { level: 0, x: 0, y: 0, webp: Buffer.from('RIFF....WEBP-nivel0-0-0') },
  { level: 1, x: 0, y: 0, webp: Buffer.from('RIFF....WEBP-nivel1-0-0') },
  { level: 1, x: 1, y: 0, webp: Buffer.from('RIFF....WEBP-nivel1-1-0') },
];
const TOTAL_BYTES = TILES.reduce((n, t) => n + t.webp.length, 0);

describe('sv360 — pirâmide de tiles da panorâmica', () => {
  let app;
  let db;
  let defaultOrgId;
  let outraOrgId;
  let publicPhotoId;
  let privatePhotoId;
  let tokenDono;
  let tokenForasteiro;
  const arquivos = new Set();

  /**
   * Escreve um {slug}_tiles.db com a tabela e as linhas que a origem produz.
   * @param {string} dbFilename - db_filename do projeto (sem o sufixo _tiles)
   * @param {string} photoId - foto dona da pirâmide
   * @returns {string} caminho do arquivo
   */
  function buildTilesDb(dbFilename, photoId) {
    const base = dbFilename.endsWith('.db') ? dbFilename.slice(0, -3) : dbFilename;
    const p = path.join(config.sv360.dbDir, `${base}_tiles.db`);
    if (existsSync(p)) rmSync(p, { force: true });
    const sdb = new Database(p);
    sdb.exec(`CREATE TABLE tiles (
      photo_id TEXT NOT NULL, level INTEGER NOT NULL, x INTEGER NOT NULL,
      y INTEGER NOT NULL, webp BLOB NOT NULL, PRIMARY KEY (photo_id, level, x, y))`);
    const ins = sdb.prepare('INSERT INTO tiles VALUES (?,?,?,?,?)');
    for (const t of TILES) ins.run(photoId, t.level, t.x, t.y, t.webp);
    sdb.close();
    arquivos.add(p);
    return p;
  }

  /**
   * Cria projeto + foto + descritor de pirâmide.
   * @param {Object} opts - slug, status, accessLevel, orgId
   * @returns {Promise<string>} o photo id
   */
  async function criarProjetoComPiramide({ slug, status, accessLevel, orgId }) {
    const dbFilename = `${orgId}__${slug}.db`;
    const { rows } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, $5, $6, -30.0, -51.0, 1) RETURNING id`,
      [orgId, slug, `Projeto ${slug}`, dbFilename, status, accessLevel]
    );
    const projectId = rows[0].id;
    const photoId = uuidv5(`${slug}-foto-1`);
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
       VALUES ($1, $2, $3, 1, -30.0, -51.0)`,
      [photoId, projectId, `${slug}-1.webp`]
    );
    await db.query(
      `INSERT INTO sv360.photo_pyramids
         (photo_id, tile_size, max_level, width, height, quality, tile_count, total_bytes, razao)
       VALUES ($1, $2, $3, $4, $5, 80, $6, $7, 2)`,
      [photoId, TILE_SIZE, MAX_LEVEL, WIDTH, HEIGHT, TILES.length, TOTAL_BYTES]
    );
    buildTilesDb(dbFilename, photoId);
    return photoId;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    mkdirSync(config.sv360.dbDir, { recursive: true });

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;
    const outra = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ($1, $2, 'PYR') RETURNING id`,
      [`Pyr OM ${RID}`, `pyr-om-${RID}`]
    );
    outraOrgId = outra.rows[0].id;

    const dono = await createProducerUser(db, defaultOrgId, { username: `pyr_dono_${RID}` });
    const forasteiro = await createUser(db, {
      username: `pyr_fora_${RID}`, organization_id: outraOrgId,
    });
    tokenDono = mintToken({
      orgId: defaultOrgId, role: 'producer', producerOrgId: defaultOrgId, sub: dono.id,
    });
    tokenForasteiro = mintToken({ orgId: outraOrgId, sub: forasteiro.id });

    publicPhotoId = await criarProjetoComPiramide({
      slug: `pyr-pub-${RID}`, status: 'enabled', accessLevel: 'public', orgId: defaultOrgId,
    });
    privatePhotoId = await criarProjetoComPiramide({
      slug: `pyr-priv-${RID}`, status: 'enabled', accessLevel: 'private', orgId: defaultOrgId,
    });
  });

  after(async () => {
    await closeStore(); // Windows: o worker segura o arquivo, e o rm falha com EBUSY.
    for (const p of arquivos) {
      if (existsSync(p)) rmSync(p, { force: true });
    }
    await db.query(`DELETE FROM sv360.projects WHERE slug LIKE $1`, [`pyr-%-${RID}`]);
    await db.query(`DELETE FROM public.users WHERE username LIKE $1`, [`pyr_%_${RID}`]);
    await db.query(`DELETE FROM public.organizations WHERE slug = $1`, [`pyr-om-${RID}`]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // PRIVACIDADE — primeiro, e nas DUAS portas
  // ==========================================================================
  describe('privacidade: o predicado vale no descritor E no tile', () => {
    it('projeto PRIVADO: o forasteiro não recebe o descritor', async () => {
      await supertest(app)
        .get(url(`/photos/${privatePhotoId}/tiles.json`))
        .set('Authorization', `Bearer ${tokenForasteiro}`)
        .expect(404);
    });

    it('projeto PRIVADO: o forasteiro não recebe TILE nenhum', async () => {
      // A porta que a suíte do MVT esqueceu, e por isso o predicado revertido passou
      // verde. Os três tiles são pedidos, não um: um gate que erre só no nível nativo
      // (o pesado) ainda entregaria a foto inteira em resolução menor.
      for (const t of TILES) {
        await supertest(app)
          .get(url(`/photos/${privatePhotoId}/tiles/${t.level}/${t.x}/${t.y}`))
          .set('Authorization', `Bearer ${tokenForasteiro}`)
          .expect(404);
      }
    });

    it('projeto PRIVADO: anônimo não recebe descritor nem tile', async () => {
      await supertest(app).get(url(`/photos/${privatePhotoId}/tiles.json`)).expect(404);
      await supertest(app).get(url(`/photos/${privatePhotoId}/tiles/0/0/0`)).expect(404);
    });

    it('o DONO recebe as duas coisas — sem isto, os casos acima passariam com a rota quebrada', async () => {
      // O discriminante. Um 404 universal (rota inexistente, predicado sempre falso,
      // fixture errado) satisfaria os três casos acima e não protegeria nada.
      const desc = await supertest(app)
        .get(url(`/photos/${privatePhotoId}/tiles.json`))
        .set('Authorization', `Bearer ${tokenDono}`)
        .expect(200);
      assert.equal(desc.body.maxLevel, MAX_LEVEL);

      const tile = await supertest(app)
        .get(url(`/photos/${privatePhotoId}/tiles/0/0/0`))
        .set('Authorization', `Bearer ${tokenDono}`)
        .expect(200);
      assert.deepEqual(tile.body, TILES[0].webp);
    });
  });

  // ==========================================================================
  // O DESCRITOR
  // ==========================================================================
  describe('o descritor da escada', () => {
    it('devolve o que foi GRAVADO, inclusive razao e maxLevel', async () => {
      const r = await supertest(app).get(url(`/photos/${publicPhotoId}/tiles.json`)).expect(200);
      assert.equal(r.body.photoId, publicPhotoId);
      assert.equal(r.body.tileSize, TILE_SIZE);
      assert.equal(r.body.maxLevel, MAX_LEVEL);
      assert.equal(r.body.width, WIDTH);
      assert.equal(r.body.height, HEIGHT);
      assert.equal(r.body.tileCount, TILES.length);
      assert.equal(r.body.totalBytes, TOTAL_BYTES);
      // `razao` é contrato: sem ela o cliente reconstrói outra grade e pede tiles que
      // não existem, sintoma que aparece como buraco na tela e 404 no log.
      assert.equal(r.body.razao, 2);
      assert.ok(r.body.builtAt, 'o descritor precisa datar a escada, senão o ETag não distingue regerações');
    });

    it('NÃO é immutable, ao contrário do tile, e revalida por ETag', async () => {
      const r = await supertest(app).get(url(`/photos/${publicPhotoId}/tiles.json`)).expect(200);
      const cache = r.headers['cache-control'];
      assert.ok(cache.includes('no-cache'), `descritor precisa revalidar, veio '${cache}'`);
      assert.ok(!cache.includes('immutable'), `descritor NÃO pode ser immutable: a escada se regera (veio '${cache}')`);

      const etag = r.headers.etag;
      assert.ok(etag, 'sem ETag o `no-cache` custa o corpo inteiro a cada pedido');
      await supertest(app)
        .get(url(`/photos/${publicPhotoId}/tiles.json`))
        .set('If-None-Match', etag)
        .expect(304);
    });

    it('projeto privado responde `private` e declara Vary', async () => {
      const r = await supertest(app)
        .get(url(`/photos/${privatePhotoId}/tiles.json`))
        .set('Authorization', `Bearer ${tokenDono}`)
        .expect(200);
      assert.ok(r.headers['cache-control'].includes('private'));
      assert.ok(/Authorization/i.test(r.headers.vary || ''));
    });

    it('foto sem pirâmide responde 404, e não um descritor vazio', async () => {
      // Estado NORMAL, não doença: um acervo pode ter foto com blob e sem escada. O
      // cliente distingue os dois casos pelo 404 e cai no caminho do WebP inteiro.
      const semEscada = uuidv5(`sem-escada-${RID}`);
      await supertest(app).get(url(`/photos/${semEscada}/tiles.json`)).expect(404);
    });
  });

  // ==========================================================================
  // O TILE
  // ==========================================================================
  describe('o tile', () => {
    it('devolve os BYTES gravados, com o content-type de imagem', async () => {
      for (const t of TILES) {
        const r = await supertest(app)
          .get(url(`/photos/${publicPhotoId}/tiles/${t.level}/${t.x}/${t.y}`))
          .expect(200);
        assert.equal(r.headers['content-type'], 'image/webp');
        assert.deepEqual(r.body, t.webp, `tile ${t.level}/${t.x}/${t.y} veio com outro corpo`);
      }
    });

    it('é immutable quando o projeto é público', async () => {
      const r = await supertest(app).get(url(`/photos/${publicPhotoId}/tiles/0/0/0`)).expect(200);
      assert.ok(r.headers['cache-control'].includes('immutable'));
      assert.ok(r.headers['cache-control'].includes('public'));
    });

    it('o token de geração na querystring NÃO é validado, e isso é decisão', async () => {
      // O descritor publica `?v=<total_bytes>` para quebrar cache de CDN. Recusar um
      // token velho pintaria buraco: no instante da regeração o cliente ainda segura o
      // descritor anterior, e os pedidos em voo carregam o número antigo.
      await supertest(app).get(url(`/photos/${publicPhotoId}/tiles/0/0/0?v=999999`)).expect(200);
      await supertest(app).get(url(`/photos/${publicPhotoId}/tiles/0/0/0?v=${TOTAL_BYTES}`)).expect(200);
    });

    it('fora da ESCADA responde 404 sem tocar o disco, e sem cachear o 404', async () => {
      // A grade do fixture: nível 0 tem 1x1, nível 1 tem 2x1.
      const fora = [
        { level: 0, x: 1, y: 0, porque: 'coluna além do nível 0' },
        { level: 0, x: 0, y: 1, porque: 'linha além do nível 0' },
        { level: 1, x: 2, y: 0, porque: 'coluna além do nível 1' },
        { level: 2, x: 0, y: 0, porque: 'nível acima de max_level' },
      ];
      assert.equal(fora.length, 4);
      for (const c of fora) {
        const r = await supertest(app)
          .get(url(`/photos/${publicPhotoId}/tiles/${c.level}/${c.x}/${c.y}`))
          .expect(404);
        // Um 404 imutável pregaria o buraco por um ano, sobrevivendo à pirâmide nova.
        assert.equal(r.headers['cache-control'], 'no-store', `${c.porque}: 404 não pode ser cacheável`);
      }
    });

    it('nível negativo e não-inteiro são recusados na validação, antes do handler', async () => {
      // 422, não 400: `ValidationError` é o erro da borda Joi nesta casa, e a rota nunca
      // chega ao handler. Um 404 aqui significaria que a validação saiu do caminho e a
      // conferência de faixa virou a única defesa.
      await supertest(app).get(url(`/photos/${publicPhotoId}/tiles/-1/0/0`)).expect(422);
      await supertest(app).get(url(`/photos/${publicPhotoId}/tiles/abc/0/0`)).expect(422);
    });

    it('revalida por ETag', async () => {
      const r = await supertest(app).get(url(`/photos/${publicPhotoId}/tiles/1/1/0`)).expect(200);
      await supertest(app)
        .get(url(`/photos/${publicPhotoId}/tiles/1/1/0`))
        .set('If-None-Match', r.headers.etag)
        .expect(304);
    });
  });
});
