// Path: tests/integration/models3d-tiles.test.js
// O ACERVO CONVERTIDO SERVIDO DE UM `.3dtiles` POR MODELO — a camada que absorveu o
// serviço do repositório `ebgeo_3d`. Cobre o que a rota promete: tile imutável,
// `tileset.json` revalidável, 304 sem abrir o arquivo, Range, os dois modos de 404
// (modelo que o catálogo não publica, chave que não existe) e o eixo de privacidade,
// que aqui é o MESMO gate do resto da rota.
//
// O CONTROLE NEGATIVO DE `garanteFrescor` é o caso `arquivo apagado`: sem a checagem de
// frescor a leitura chegaria ao worker, que abre com `fileMustExist: true` e rejeita, e a
// rota devolveria 500 em vez de 404. Um 404 aqui não é cosmético: é o que faz um modelo
// removido do disco parecer ausente em vez de quebrado.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { blobPool } from '../../src/utils/sqlite-blob-pool.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';
import { resolveDbPath, resetOpenModels } from '../../src/modules/models3d/models3d.store.js';
import config from '../../src/config.js';

const SUFIXO = randomUUID().slice(0, 8);
const ID_PUB = `m3d-pub-${SUFIXO}`;
const ID_PRIV = `m3d-priv-${SUFIXO}`;
const ID_OFF = `m3d-off-${SUFIXO}`;
const ID_SUMIU = `m3d-sumiu-${SUFIXO}`;

const TILESET = JSON.stringify({
  asset: { version: '1.1' },
  root: { content: { uri: 'Data/c00.glb?v=tok00001' } },
});
const GLB = Buffer.from('glb-binario-de-teste-0123456789abcdef');

/** Escreve um `.3dtiles` no formato do 3d-tiles-tools: media(key, content). */
function escreverModelo(dbFilename, entradas) {
  mkdirSync(config.models3d.dbDir, { recursive: true });
  const caminho = resolveDbPath(dbFilename);
  rmSync(caminho, { force: true });
  const db = new Database(caminho);
  db.pragma('page_size = 4096');
  db.exec('CREATE TABLE media (key TEXT PRIMARY KEY, content BLOB NOT NULL)');
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  const ins = db.prepare('INSERT OR REPLACE INTO media (key, content) VALUES (?, ?)');
  for (const [chave, conteudo] of entradas) ins.run(chave, conteudo);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('id', dbFilename);
  db.close();
  return caminho;
}

/** Apaga o arquivo, com a janela de quarentena que o Windows exige. */
async function apagarModelo(dbFilename) {
  const caminho = resolveDbPath(dbFilename);
  await blobPool.withEvicted(caminho, () => {
    rmSync(caminho, { force: true });
  });
}

async function criarTileset(db, id, accessLevel, ativo = true) {
  await db.query(
    `INSERT INTO tilesets (id, name, config, sort_order, active, access_level)
     VALUES ($1, $2, $3::jsonb, 0, $4, $5)`,
    [
      id,
      `Modelo ${id}`,
      JSON.stringify({ url: `/api/v1/assets3d/m/${id}/tileset.json`, forma3d: 'tiles3d' }),
      ativo,
      accessLevel,
    ],
  );
}

async function registrarModelo(db, id, dbFilename, token) {
  await db.query(
    `INSERT INTO a3d.models (model_id, db_filename, build_token, tile_count, total_bytes)
     VALUES ($1, $2, $3, 1, 1024)`,
    [id, dbFilename, token],
  );
}

/** Pede bytes crus: sem parser binário o superagent devolve um objeto vazio. */
function pedirBytes(app, url) {
  return supertest(app).get(url).buffer().parse((res, cb) => {
    const pedacos = [];
    res.on('data', (c) => pedacos.push(Buffer.from(c)));
    res.on('end', () => cb(null, Buffer.concat(pedacos)));
  });
}

describe('models3d — o acervo convertido, um arquivo por modelo', () => {
  let app, db;
  const arquivos = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    for (const id of [ID_PUB, ID_PRIV, ID_OFF, ID_SUMIU]) {
      const nome = `${id}.3dtiles`;
      escreverModelo(nome, [
        ['tileset.json', Buffer.from(TILESET)],
        ['Data/c00.glb', GLB],
      ]);
      arquivos.push(nome);
    }

    await criarTileset(db, ID_PUB, 'public');
    await criarTileset(db, ID_PRIV, 'private');
    await criarTileset(db, ID_OFF, 'public', false);
    await criarTileset(db, ID_SUMIU, 'public');
    await registrarModelo(db, ID_PUB, `${ID_PUB}.3dtiles`, 'tok00001');
    await registrarModelo(db, ID_PRIV, `${ID_PRIV}.3dtiles`, 'tok00002');
    await registrarModelo(db, ID_OFF, `${ID_OFF}.3dtiles`, 'tok00003');
    await registrarModelo(db, ID_SUMIU, `${ID_SUMIU}.3dtiles`, 'tok00004');

    // O mesmo gancho que toda escrita de catálogo chama: ele derruba os três índices em
    // memória de uma vez (payload do /api/config, regime de acesso e este).
    invalidateAppConfigCache();
  });

  after(async () => {
    for (const nome of arquivos) {
      try {
        await apagarModelo(nome);
      } catch {
        // Um `after` que não consegue limpar não é motivo para reprovar a suíte.
      }
    }
    resetOpenModels();
    await db.query('DELETE FROM a3d.models WHERE model_id LIKE $1', [`m3d-%${SUFIXO}`]);
    await db.query('DELETE FROM tilesets WHERE id LIKE $1', [`m3d-%${SUFIXO}`]);
    await teardownTestEnv(db);
  });

  it('serve o tile com `immutable` e o tipo IANA do glb', async () => {
    const res = await pedirBytes(app, `/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`).expect(200);
    assert.equal(res.headers['content-type'], 'model/gltf-binary');
    assert.match(res.headers['cache-control'], /public, max-age=31536000, immutable/);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    // O ETag é (modelo, chave, token). O token no fim é o que autoriza o `immutable`.
    assert.match(res.headers['etag'], new RegExp(`^"${ID_PUB}-[0-9a-f]{8}-tok00001"$`));
    assert.deepEqual(res.body, GLB);
  });

  it('serve o tileset.json REVALIDÁVEL, e não imutável', async () => {
    // É a diferença que o formato exige: reimportar troca a árvore inteira, e um ano de
    // `immutable` no documento deixaria o cliente pedindo tiles de uma geração morta.
    const res = await supertest(app)
      .get(`/api/v1/assets3d/m/${ID_PUB}/tileset.json`)
      .expect(200);
    assert.equal(res.headers['cache-control'], 'public, no-cache');
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(JSON.parse(res.text).asset.version, '1.1');
  });

  it('responde 304 ao If-None-Match, sem tocar o arquivo', async () => {
    const primeiro = await supertest(app)
      .get(`/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`)
      .expect(200);
    await supertest(app)
      .get(`/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`)
      .set('If-None-Match', primeiro.headers.etag)
      .expect(304);
  });

  it('o ETag muda quando o token de geração muda, que é o que autoriza o `immutable`', async () => {
    const antes = await supertest(app)
      .get(`/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`)
      .expect(200);
    await db.query('UPDATE a3d.models SET build_token = $2 WHERE model_id = $1', [
      ID_PUB,
      'tok99999',
    ]);
    invalidateAppConfigCache();
    const depois = await supertest(app)
      .get(`/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`)
      .expect(200);
    assert.notEqual(antes.headers.etag, depois.headers.etag);
    // E o ETag velho deixa de casar: um cliente que segurava a geração anterior recebe
    // bytes, não um 304 que o prenderia nela.
    await supertest(app)
      .get(`/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`)
      .set('If-None-Match', antes.headers.etag)
      .expect(200);
    await db.query('UPDATE a3d.models SET build_token = $2 WHERE model_id = $1', [
      ID_PUB,
      'tok00001',
    ]);
    invalidateAppConfigCache();
  });

  it('serve Range (206) e recusa faixa impossível (416)', async () => {
    const faixa = await supertest(app)
      .get(`/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`)
      .set('Range', 'bytes=0-9')
      .expect(206);
    assert.equal(faixa.headers['content-length'], '10');
    assert.match(faixa.headers['content-range'], /^bytes 0-9\/\d+$/);

    await supertest(app)
      .get(`/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`)
      .set('Range', 'bytes=999999-')
      .expect(416);
  });

  it('404 para chave que não está no arquivo', async () => {
    await supertest(app).get(`/api/v1/assets3d/m/${ID_PUB}/Data/naoexiste.glb`).expect(404);
  });

  it('404 para modelo que o catálogo não publica, e para modelo que não existe', async () => {
    // `active = false` tem de ser indistinguível de inexistente: a escada do 360.
    await supertest(app).get(`/api/v1/assets3d/m/${ID_OFF}/tileset.json`).expect(404);
    await supertest(app).get(`/api/v1/assets3d/m/nao-existe-${SUFIXO}/tileset.json`).expect(404);
  });

  it('400 para chave que tenta subir de diretório', async () => {
    // O caminho NOMEIA um modelo, então pertence a esta camada: cair no store plano
    // devolveria 404 pelo motivo errado.
    await supertest(app).get(`/api/v1/assets3d/m/${ID_PUB}/..%2Ffora.glb`).expect(400);
  });

  it('404 para o anônimo quando o modelo é privado', async () => {
    // O eixo de acesso é o do RECURSO, e quem decide é o mesmo gate do resto da rota:
    // a camada nova não tem eixo próprio.
    await supertest(app).get(`/api/v1/assets3d/m/${ID_PRIV}/tileset.json`).expect(404);
  });

  it('404, e não 500, quando o arquivo do modelo some do disco', async () => {
    // Controle negativo da checagem de frescor: sem ela o pedido chega ao worker, que abre
    // com `fileMustExist: true`, rejeita, e a rota responde 500.
    await supertest(app).get(`/api/v1/assets3d/m/${ID_SUMIU}/tileset.json`).expect(200);
    await apagarModelo(`${ID_SUMIU}.3dtiles`);
    assert.equal(existsSync(resolveDbPath(`${ID_SUMIU}.3dtiles`)), false);
    await supertest(app).get(`/api/v1/assets3d/m/${ID_SUMIU}/tileset.json`).expect(404);
  });

  it('serve os bytes NOVOS depois de o arquivo ser trocado', async () => {
    // A reimportação publica trocando o arquivo. Uma conexão presa ao arquivo velho
    // serviria a geração anterior sob um `immutable` de um ano.
    //
    // O QUE ESTE CASO COBRE, E O QUE NÃO: ele exercita a troca pelo caminho OFICIAL, com
    // a janela de quarentena (`withEvicted`), que é o que o publicador do mesmo processo
    // usa. Medido: ele continua VERDE com a checagem de frescor desligada, porque a
    // quarentena já fecha a conexão. Quem cobra o frescor é o caso do arquivo apagado,
    // logo acima, que fica vermelho sem ela. A troca feita por OUTRO processo (o
    // importador de linha de comando, que não conhece este pool) é o caso que só o
    // statSync alcança, e ele não se reproduz aqui: no Windows não se substitui um
    // arquivo com handle aberto.
    const nome = `${ID_PUB}.3dtiles`;
    const antes = await pedirBytes(app, `/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`).expect(200);
    assert.deepEqual(antes.body, GLB);

    const novo = Buffer.from('glb-de-outra-geracao-com-outro-tamanho-9876543210');
    const caminho = resolveDbPath(nome);
    await blobPool.withEvicted(caminho, () => {
      escreverModelo(nome, [
        ['tileset.json', Buffer.from(TILESET)],
        ['Data/c00.glb', novo],
      ]);
    });

    const depois = await pedirBytes(app, `/api/v1/assets3d/m/${ID_PUB}/Data/c00.glb`).expect(200);
    assert.deepEqual(depois.body, novo);
  });
});
