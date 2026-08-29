// Path: tests/integration/sv360-piramide-ingestao.test.js
// A FRONTEIRA: o que a INGESTÃO grava é o que o CLIENTE consegue ler.
//
// POR QUE ESTE ARQUIVO EXISTE, e por que os dois lados estavam verdes enquanto o
// produto não pintava uma única panorâmica:
//
//   - `backend/tests/integration/sv360-piramide-tiles.test.js` INSERE a linha de
//     `sv360.photo_pyramids` À MÃO no fixture. Ele prova que a rota serve o que
//     estiver na tabela, e nada sobre quem põe lá. `UPSERT_PHOTO_PYRAMID` não tinha
//     UM chamador: a tabela nunca recebia linha, `tiles.json` respondia 404 para toda
//     foto, e o cliente entendia 404 como "esta foto tem blob" e pedia o
//     `image?quality=full` que a origem apagou em 2026-08-20.
//   - as suítes do frontend FABRICAM o descritor no formato da origem. Elas provam
//     que o carregador sabe ler `schemaVersion`/`levels`/`template`, e nada sobre o
//     servidor os emitir. Ele emitia um objeto plano, sem os três.
//
// Cada metade media a si mesma. Este arquivo mede a JUNÇÃO: ingere um bundle SÓ-TILES
// pelo caminho REAL (multipart -> ingestBundle -> mergeProject), pede o descritor pela
// ROTA, e então segue o `template` publicado até um tile de verdade — que é a única
// asserção que um servidor devolvendo `levels: []` ou um template com `.webp` (o da
// origem, que a rota daqui NÃO tem) reprova.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createProducerUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const RID = crypto.randomUUID().slice(0, 8);
const JWT_SECRET = process.env.JWT_SECRET;
const url = (p) => `/api/v1/sv360${p}`;

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
/**
 * uuid v5 determinístico, como o estúdio de calibração faz para id de foto.
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

// ---------------------------------------------------------------------------
// PROJETO A — o esquema COMPLETO da origem (dez colunas em `tile_pyramids`).
// A escada é pequena de propósito: o que se mede é a borda da grade, e uma escada
// grande só faria o fixture demorar.
//   tile 512, nativo 1024x512, razao 2, max_level 1
//     nível 0 -> 512x256  -> 1x1
//     nível 1 -> 1024x512 -> 2x1
// ---------------------------------------------------------------------------
const A = {
  slug: `pyr-ing-a-${RID}`,
  tileSize: 512,
  maxLevel: 1,
  width: 1024,
  height: 512,
  razao: 2,
  quality: 80,
  // A ESCADA ESPERADA, ESCRITA À MÃO e não derivada do código sob teste: comparar a
  // saída com uma segunda chamada de `escadaGravada` deixaria passar as duas cópias
  // erradas do mesmo jeito.
  levels: [
    { level: 0, width: 512, height: 256, cols: 1, rows: 1 },
    { level: 1, width: 1024, height: 512, cols: 2, rows: 1 },
  ],
  tiles: [
    { level: 0, x: 0, y: 0, webp: Buffer.from('RIFF....WEBP-A-nivel0-0-0') },
    { level: 1, x: 0, y: 0, webp: Buffer.from('RIFF....WEBP-A-nivel1-0-0') },
    { level: 1, x: 1, y: 0, webp: Buffer.from('RIFF....WEBP-A-nivel1-1-0-maior') },
  ],
};

// ---------------------------------------------------------------------------
// PROJETO B — o esquema MAGRO, que existe no acervo real: `tile_pyramids` só com as
// cinco colunas que fazem a escada. Sem `razao` (o fixture do ETL prova que isso
// ocorre), sem `quality`, sem `built_at` e SEM os agregados, que aqui têm de sair da
// contagem da própria tabela `tiles`.
//   tile 256, nativo 512x256, razao ausente (vale 2), max_level 1
//     nível 0 -> 256x128 -> 1x1
//     nível 1 -> 512x256 -> 2x1
// ---------------------------------------------------------------------------
const B = {
  slug: `pyr-ing-b-${RID}`,
  tileSize: 256,
  maxLevel: 1,
  width: 512,
  height: 256,
  levels: [
    { level: 0, width: 256, height: 128, cols: 1, rows: 1 },
    { level: 1, width: 512, height: 256, cols: 2, rows: 1 },
  ],
  tiles: [
    { level: 0, x: 0, y: 0, webp: Buffer.from('RIFF....WEBP-B-0') },
    { level: 1, x: 0, y: 0, webp: Buffer.from('RIFF....WEBP-B-1-0') },
    { level: 1, x: 1, y: 0, webp: Buffer.from('RIFF....WEBP-B-1-1-com-mais-bytes') },
  ],
};

const somaBytes = (tiles) => tiles.reduce((n, t) => n + t.webp.length, 0);

describe('sv360 — a pirâmide ingerida é a pirâmide que o cliente lê', () => {
  let app;
  let db;
  let defaultOrgId;
  let token;
  let tmpRoot;
  const arquivos = new Set();

  /**
   * Registra os quatro nomes que uma ingestão pode deixar no dbDir do projeto.
   * @param {string} slug - slug do projeto
   * @returns {void}
   */
  function registrarArquivos(slug) {
    const base = path.resolve(config.sv360.dbDir, `${slug}`);
    for (const p of [
      `${base}.db`, `${base}.db.bak`, `${base}.db.tmp`,
      `${base}_tiles.db`, `${base}_tiles.db.bak`, `${base}_tiles.db.tmp`,
    ]) {
      arquivos.add(p);
    }
  }


  /**
   * O `{slug}_tiles.db`: `tile_pyramids` (no esquema pedido) + `tiles` com os bytes.
   * @param {string} nome - nome do arquivo tmp
   * @param {string} photoId - a foto dona da pirâmide
   * @param {Object} spec - A ou B
   * @param {boolean} completo - true escreve as dez colunas; false só as cinco exigidas
   * @returns {string} caminho
   */
  function tilesDb(nome, photoId, spec, completo) {
    const p = path.join(tmpRoot, nome);
    const sdb = new Database(p);
    if (completo) {
      sdb.exec(`CREATE TABLE tile_pyramids (
        photo_id TEXT PRIMARY KEY, tile_size INTEGER NOT NULL, max_level INTEGER NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, quality INTEGER NOT NULL,
        tile_count INTEGER NOT NULL, total_bytes INTEGER NOT NULL, built_at TEXT NOT NULL,
        razao REAL NOT NULL DEFAULT 2)`);
      sdb.prepare('INSERT INTO tile_pyramids VALUES (?,?,?,?,?,?,?,?,?,?)').run(
        photoId, spec.tileSize, spec.maxLevel, spec.width, spec.height, spec.quality,
        spec.tiles.length, somaBytes(spec.tiles), '2026-08-20T12:00:00Z', spec.razao
      );
    } else {
      sdb.exec(`CREATE TABLE tile_pyramids (
        photo_id TEXT PRIMARY KEY, tile_size INTEGER NOT NULL, max_level INTEGER NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL)`);
      sdb.prepare('INSERT INTO tile_pyramids VALUES (?,?,?,?,?)').run(
        photoId, spec.tileSize, spec.maxLevel, spec.width, spec.height
      );
    }
    sdb.exec(`CREATE TABLE tiles (
      photo_id TEXT NOT NULL, level INTEGER NOT NULL, x INTEGER NOT NULL,
      y INTEGER NOT NULL, webp BLOB NOT NULL, PRIMARY KEY (photo_id, level, x, y))`);
    const ins = sdb.prepare('INSERT INTO tiles VALUES (?,?,?,?,?)');
    for (const t of spec.tiles) ins.run(photoId, t.level, t.x, t.y, t.webp);
    sdb.close();
    return p;
  }

  /**
   * Um manifesto de uma foto só, sem `full_size_bytes`/`preview_size_bytes` — que é
   * exatamente o que um acervo só-tiles tem para declarar: nada.
   * @param {Object} spec - A ou B
   * @param {string} photoId - o id da foto
   * @returns {string} caminho do manifest.json tmp
   */
  function manifestoPodado(spec, photoId) {
    const p = path.join(tmpRoot, `${spec.slug}-manifest.json`);
    writeFileSync(p, JSON.stringify({
      schemaVersion: 1,
      project: {
        slug: spec.slug,
        name: `Projeto ${spec.slug}`,
        orgSlug: 'default',
        center_lat: -30.0,
        center_long: -51.0,
      },
      photos: [{
        id: photoId,
        original_name: `${spec.slug}-1.jpg`,
        display_name: `${spec.slug}-1`,
        sequence_number: 1,
        lat: -30.0,
        lon: -51.0,
      }],
      targets: [],
      deleted_photos: [],
    }));
    return p;
  }

  /**
   * Ingere um projeto SÓ-TILES pelo caminho REAL (multipart -> ingestBundle).
   * @param {Object} spec - A ou B
   * @param {string} photoId - o id da foto
   * @param {boolean} completo - esquema de `tile_pyramids` (dez colunas ou cinco)
   * @returns {Promise<Object>} o corpo do 201
   */
  async function ingerir(spec, photoId, completo) {
    registrarArquivos(spec.slug);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${token}`)
      .attach('manifest', manifestoPodado(spec, photoId))
      .attach('tilesDb', tilesDb(`${spec.slug}-tiles.db`, photoId, spec, completo))
      .expect(201);
    return res.body;
  }

  /**
   * Resolve o `template` do descritor EXATAMENTE como o cliente resolve
   * (`tile-loader.js`: substitui os três marcadores e resolve contra a URL do
   * próprio `tiles.json`), e devolve o caminho para o supertest.
   * @param {string} template - `descritor.template`
   * @param {string} photoId - a foto do descritor
   * @param {{level:number,x:number,y:number}} t - o tile pedido
   * @returns {string} caminho + querystring, relativo à raiz do app
   */
  function urlDoTile(template, photoId, t) {
    const doc = new URL(url(`/photos/${photoId}/tiles.json`), 'http://localhost');
    const rel = template
      .replace('{level}', String(t.level))
      .replace('{x}', String(t.x))
      .replace('{y}', String(t.y));
    const alvo = new URL(rel, doc);
    return `${alvo.pathname}${alvo.search}`;
  }

  const photoA = uuidv5(`pyr-ing-a-${RID}-foto`);
  const photoB = uuidv5(`pyr-ing-b-${RID}-foto`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    tmpRoot = path.join(os.tmpdir(), `sv360-pyr-ing-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;
    const produtor = await createProducerUser(db, defaultOrgId, { username: `pyring_${RID}` });
    token = jwt.sign(
      {
        sub: produtor.id,
        username: `pyring_${RID}`,
        role: 'producer',
        organization_id: defaultOrgId,
        producer_org_id: defaultOrgId,
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
  });

  after(async () => {
    await closeStore(); // Windows: o worker segura o arquivo, e o rm falha com EBUSY.
    for (const p of arquivos) {
      if (existsSync(p)) {
        try {
          rmSync(p, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    await db.query(`DELETE FROM sv360.projects WHERE slug IN ($1, $2)`, [A.slug, B.slug]);
    await db.query(`DELETE FROM public.users WHERE username = $1`, [`pyring_${RID}`]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // A INGESTÃO ESCREVE A PIRÂMIDE
  // ==========================================================================
  describe('a ingestão de um bundle só-tiles GRAVA sv360.photo_pyramids', () => {
    it('a tabela está vazia para esta foto ANTES do upload (a precondição que torna o resto uma prova)', async () => {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM sv360.photo_pyramids WHERE photo_id = $1`,
        [photoA]
      );
      assert.equal(rows[0].n, 0, 'sem esta precondição, uma linha residual daria o teste por bom');
    });

    it('o upload multipart aceita o {slug}_tiles.db e o 201 traz o projeto', async () => {
      const body = await ingerir(A, photoA, true);
      assert.equal(body.slug, A.slug);
      assert.equal(body.photoCount, 1);
      assert.equal(body.dbFilename, `${A.slug}.db`);
      // Tiles-only: o UNICO arquivo de pixel instalado e o `{slug}_tiles.db`. O
      // `db_filename` e a chave logica `{slug}.db`, sem arquivo com esse nome no disco.
      assert.ok(
        existsSync(path.resolve(config.sv360.dbDir, `${A.slug}_tiles.db`)),
        'o {slug}_tiles.db precisa estar instalado, senão a rota do tile lê o vazio'
      );
    });

    it('e a linha de pirâmide existe, com o que estava GRAVADO no SQLite da origem', async () => {
      const { rows } = await db.query(
        `SELECT tile_size, max_level, width, height, quality, tile_count, total_bytes, razao
           FROM sv360.photo_pyramids WHERE photo_id = $1`,
        [photoA]
      );
      assert.equal(rows.length, 1, 'UPSERT_PHOTO_PYRAMID precisa ter um chamador de verdade');
      const r = rows[0];
      assert.equal(r.tile_size, A.tileSize);
      assert.equal(r.max_level, A.maxLevel);
      assert.equal(r.width, A.width);
      assert.equal(r.height, A.height);
      assert.equal(r.quality, A.quality);
      assert.equal(r.tile_count, A.tiles.length);
      assert.equal(Number(r.total_bytes), somaBytes(A.tiles));
      assert.equal(Number(r.razao), A.razao);
    });
  });

  // ==========================================================================
  // O DESCRITOR CARREGA O QUE O CLIENTE EXIGE
  // ==========================================================================
  describe('o descritor servido é o documento que o carregador do cliente lê', () => {
    let descritor;

    it('GET tiles.json responde 200 (antes disto, 404 para toda foto do acervo)', async () => {
      const r = await supertest(app).get(url(`/photos/${photoA}/tiles.json`)).expect(200);
      descritor = r.body;
      assert.equal(descritor.photoId, photoA);
    });

    it('traz schemaVersion 1 — o cliente LANÇA com qualquer outro valor, inclusive ausente', () => {
      // `tile-loader.js`: `if (documento.schemaVersion !== 1) throw`. Um descritor sem
      // o campo derruba a composição por tiles na primeira linha e manda a foto para o
      // `image?quality=full` que não existe mais.
      assert.equal(descritor.schemaVersion, 1);
    });

    it('traz `levels` com a escada INTEIRA, na forma que o cliente indexa e ordena', () => {
      // O cliente faz `niveis[nivel.level] = nivel` e lê `width`/`height`/`cols`/`rows`.
      // A asserção é ABSOLUTA (a escada escrita à mão no topo), e não uma segunda
      // chamada da mesma função: duas cópias erradas do mesmo jeito passariam.
      assert.deepEqual(descritor.levels, A.levels);
      // O discriminante contra `levels: []`, que satisfaria qualquer teste que só
      // olhasse "o campo existe".
      assert.equal(descritor.levels.length, A.maxLevel + 1);
      assert.equal(descritor.levels[A.maxLevel].width, A.width);
    });

    it('traz um `template` RELATIVO ao próprio tiles.json, com os três marcadores e sem `.webp`', () => {
      assert.equal(typeof descritor.template, 'string');
      for (const marcador of ['{level}', '{x}', '{y}']) {
        assert.ok(descritor.template.includes(marcador), `falta ${marcador} no template`);
      }
      // O contrato proíbe URL absoluta: é a resolução relativa que faz um prefixo
      // público continuar valendo.
      assert.ok(!/^https?:/i.test(descritor.template), 'template não pode ser absoluto');
      // O template da ORIGEM era `{level}/{x}/{y}.webp`, e a rota daqui não tem
      // extensão: copiá-lo daria 404 em todo tile. A busca é por SUBSTRING e não por
      // `endsWith`, medido: com o token de geração no fim, `{level}/{x}/{y}.webp?v=N`
      // não termina em `.webp` e passava no `endsWith` — a asserção "checava" o
      // exato defeito que ela existe para pegar e não pegava. Quem pega de verdade é
      // o caso seguinte, que SEGUE o template até um tile.
      assert.ok(!descritor.template.includes('.webp'), 'a rota real não tem extensão');
      // O token de geração é o que quebra o cache imutável do tile numa regeração.
      assert.ok(
        descritor.template.includes(`v=${somaBytes(A.tiles)}`),
        `template sem token de geração: ${descritor.template}`
      );
    });

    it('e SEGUIR o template chega em TODO tile que a escada anuncia, com os bytes certos', async () => {
      // ESTE É O ELO. Ele reprova um template com prefixo errado, com extensão, com
      // marcador trocado, e reprova uma escada que anuncia coluna que não existe.
      assert.equal(descritor.levels.length, A.levels.length);
      let pedidos = 0;
      for (const nivel of descritor.levels) {
        for (let x = 0; x < nivel.cols; x++) {
          for (let y = 0; y < nivel.rows; y++) {
            const esperado = A.tiles.find((t) => t.level === nivel.level && t.x === x && t.y === y);
            assert.ok(esperado, `a escada anuncia ${nivel.level}/${x}/${y} e o fixture não o tem`);
            const r = await supertest(app)
              .get(urlDoTile(descritor.template, photoA, { level: nivel.level, x, y }))
              .expect(200);
            assert.equal(r.headers['content-type'], 'image/webp');
            assert.deepEqual(r.body, esperado.webp, `bytes errados em ${nivel.level}/${x}/${y}`);
            pedidos++;
          }
        }
      }
      // A contagem é asserida porque um laço sobre coleção vazia passa verde.
      assert.equal(pedidos, A.tiles.length);
    });

    it('o `base` legado saiu do documento (tiles-only 2026-08-29)', () => {
      // O campo apontava para `image?quality=preview`, e a rota de imagem inteira foi
      // removida. O caminho padrão do cliente é o tile de nível 0 e nunca o tocou;
      // emitir uma URL para uma rota que dá 404 seria referência morta.
      assert.equal(descritor.base, undefined);
    });
  });

  // ==========================================================================
  // O ESQUEMA MAGRO DA ORIGEM
  // ==========================================================================
  describe('um {slug}_tiles.db com só as cinco colunas exigidas também atravessa', () => {
    let descritor;

    it('ingere e responde 200 no descritor', async () => {
      const body = await ingerir(B, photoB, false);
      assert.equal(body.slug, B.slug);
      const r = await supertest(app).get(url(`/photos/${photoB}/tiles.json`)).expect(200);
      descritor = r.body;
    });

    it('`razao` ausente vale 2, que é o mesmo default de escadaGravada — senão a grade divergiria', () => {
      assert.equal(Number(descritor.razao), 2);
      assert.deepEqual(descritor.levels, B.levels);
    });

    it('os agregados ausentes são CONTADOS da tabela `tiles`, e não zerados', () => {
      // Zerar passaria em qualquer asserção de "o campo existe"; os números vêm do
      // fixture, então um servidor que devolvesse 0 reprova.
      assert.equal(descritor.tileCount, B.tiles.length);
      assert.equal(descritor.totalBytes, somaBytes(B.tiles));
      assert.ok(descritor.totalBytes > 0);
    });

    it('e o tile do nível nativo chega pelo template publicado', async () => {
      const ultimo = B.tiles[B.tiles.length - 1];
      const r = await supertest(app)
        .get(urlDoTile(descritor.template, photoB, ultimo))
        .expect(200);
      assert.deepEqual(r.body, ultimo.webp);
    });
  });
});
