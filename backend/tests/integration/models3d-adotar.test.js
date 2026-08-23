// Path: tests/integration/models3d-adotar.test.js
// A ADOÇÃO DE UM `.3dtiles`, FIM A FIM: o arquivo em disco vira duas linhas (catálogo e
// produção) e, a partir daí, bytes servidos pela rota. É o caminho que substitui o
// `index.db` do repositório `ebgeo_3d` pelo Postgres.
//
// O CASO QUE IMPORTA MAIS AQUI é o da readoção: reimportar um modelo publica um arquivo
// novo e torna a registrar, e um modelo que alguém marcou como PRIVADO não pode voltar a
// público por causa disso. O eixo de acesso não é do importador.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { blobPool } from '../../src/utils/sqlite-blob-pool.js';
import { resolveDbPath, resetOpenModels } from '../../src/modules/models3d/models3d.store.js';
import { adotarModelo } from '../../scripts/models3d-adotar.js';
import config from '../../src/config.js';

const SUFIXO = randomUUID().slice(0, 8);
const ID = `adot-${SUFIXO}`;
const ARQUIVO = `${ID}.3dtiles`;

const TILESET = JSON.stringify({ asset: { version: '1.1' }, root: {} });
const GLB = Buffer.from('conteudo-do-tile-convertido-0123456789');

/**
 * Escreve um `.3dtiles` COM cabeçalho, que é o que a adoção lê.
 * @param {string} arquivo
 * @param {Object} meta - sobrescreve o cabeçalho padrão
 */
function escreverModelo(arquivo, meta = {}) {
  mkdirSync(config.models3d.dbDir, { recursive: true });
  const caminho = resolveDbPath(arquivo);
  rmSync(caminho, { force: true });
  const db = new Database(caminho);
  db.exec('CREATE TABLE media (key TEXT PRIMARY KEY, content BLOB NOT NULL)');
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  const m = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  const cabecalho = {
    id: ID,
    name: `Modelo adotado ${SUFIXO}`,
    buildToken: 'tokAAAA1',
    builtAt: '2026-08-22T11:41:27.325Z',
    // UM tile: é o que `media` tem abaixo, e a validação compara os dois.
    tileCount: '1',
    jsonCount: '1',
    lon: '-44.286984',
    lat: '-22.400374',
    groundHeight: '343.2',
    minHeight: '339.5',
    source: 'Agisoft Metashape',
    ...meta,
  };
  for (const [k, v] of Object.entries(cabecalho)) m.run(k, String(v));
  const ins = db.prepare('INSERT OR REPLACE INTO media (key, content) VALUES (?, ?)');
  ins.run('tileset.json', Buffer.from(TILESET));
  ins.run('Data/c00.glb', GLB);
  db.close();
  return caminho;
}

async function apagar(arquivo) {
  const caminho = resolveDbPath(arquivo);
  await blobPool.withEvicted(caminho, () => rmSync(caminho, { force: true }));
}

describe('models3d — adoção de um arquivo em disco', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    escreverModelo(ARQUIVO);
  });

  after(async () => {
    await apagar(ARQUIVO).catch(() => {});
    await apagar(`renomeado-${SUFIXO}.3dtiles`).catch(() => {});
    resetOpenModels();
    await db.query('DELETE FROM a3d.models WHERE model_id LIKE $1', [`adot-${SUFIXO}%`]);
    await db.query('DELETE FROM tilesets WHERE id LIKE $1', [`adot-${SUFIXO}%`]);
    await apagar(`adot-${SUFIXO}-parcial.3dtiles`).catch(() => {});
    await apagar(`adot-${SUFIXO}-clone.3dtiles`).catch(() => {});
    await teardownTestEnv(db);
  });

  it('o dry-run não escreve nada, e mostra o que escreveria', async () => {
    const r = await adotarModelo(ARQUIVO, { dryRun: true });
    assert.equal(r.acao, 'dry-run');
    assert.equal(r.payload.config.url, `/api/v1/assets3d/m/${ID}/tileset.json`);
    const { rows } = await db.query('SELECT id FROM tilesets WHERE id = $1', [ID]);
    assert.equal(rows.length, 0, 'dry-run gravou linha de catálogo');
  });

  it('registra as DUAS linhas, catálogo e produção', async () => {
    const r = await adotarModelo(ARQUIVO);
    assert.equal(r.acao, 'criado');

    const cat = await db.query('SELECT * FROM tilesets WHERE id = $1', [ID]);
    assert.equal(cat.rows.length, 1);
    assert.equal(cat.rows[0].config.forma3d, 'tiles3d');
    assert.equal(cat.rows[0].config.heightOffset, 0);
    assert.deepEqual(cat.rows[0].config.locate, {
      lon: -44.286984,
      lat: -22.400374,
      height: 843.2,
    });

    const prod = await db.query('SELECT * FROM a3d.models WHERE model_id = $1', [ID]);
    assert.equal(prod.rows.length, 1);
    assert.equal(prod.rows[0].db_filename, ARQUIVO);
    assert.equal(prod.rows[0].build_token, 'tokAAAA1');
    assert.equal(prod.rows[0].tile_count, 1);
    assert.equal(Number(prod.rows[0].ground_height), 343.2);
  });

  it('e a rota passa a servir os bytes daquele arquivo', async () => {
    // O fim a fim: nada além da adoção aconteceu entre o arquivo em disco e este 200.
    const res = await supertest(app).get(`/api/v1/assets3d/m/${ID}/tileset.json`).expect(200);
    assert.equal(JSON.parse(res.text).asset.version, '1.1');
    assert.equal(res.headers['cache-control'], 'public, no-cache');
    assert.match(res.headers.etag, /-tokAAAA1"$/);
  });

  it('a readoção atualiza o token sem apagar o eixo de acesso', async () => {
    // Uma reimportação republica o mesmo id com token novo. O modelo tinha sido marcado
    // privado por um administrador; readotar não pode devolvê-lo ao público.
    await db.query('UPDATE tilesets SET access_level = $2 WHERE id = $1', [ID, 'private']);
    // A JANELA DE QUARENTENA NÃO É CERIMÔNIA: no Windows não se substitui um arquivo com
    // handle aberto, e o teste anterior já fez a rota abrir este. É a mesma dança que o
    // publicador de uma reimportação precisa fazer.
    await blobPool.withEvicted(resolveDbPath(ARQUIVO), () => {
      escreverModelo(ARQUIVO, { buildToken: 'tokBBBB2' });
    });

    const r = await adotarModelo(ARQUIVO);
    assert.equal(r.acao, 'atualizado');

    const cat = await db.query('SELECT access_level FROM tilesets WHERE id = $1', [ID]);
    assert.equal(cat.rows[0].access_level, 'private');
    const prod = await db.query('SELECT build_token FROM a3d.models WHERE model_id = $1', [ID]);
    assert.equal(prod.rows[0].build_token, 'tokBBBB2');

    // E o privado deixa de responder ao anônimo, pelo gate que já existia.
    await supertest(app).get(`/api/v1/assets3d/m/${ID}/tileset.json`).expect(404);
    await db.query('UPDATE tilesets SET access_level = $2 WHERE id = $1', [ID, 'public']);
  });

  it('recusa o arquivo renomeado à mão, em vez de publicar sob o id errado', async () => {
    const outro = `renomeado-${SUFIXO}.3dtiles`;
    await blobPool.withEvicted(resolveDbPath(ARQUIVO), () => {
      renameSync(resolveDbPath(ARQUIVO), resolveDbPath(outro));
    });
    try {
      const r = await adotarModelo(outro);
      assert.equal(r.acao, 'recusado');
      assert.match(r.motivo, new RegExp(ID));
      const { rows } = await db.query('SELECT id FROM tilesets WHERE id = $1', [
        `renomeado-${SUFIXO}`,
      ]);
      assert.equal(rows.length, 0);
    } finally {
      await blobPool.withEvicted(resolveDbPath(outro), () => {
        renameSync(resolveDbPath(outro), resolveDbPath(ARQUIVO));
      });
    }
  });

  it('importação PARCIAL não nasce visível no catálogo', async () => {
    // `--limite` grava `published = 0` no cabeçalho. Sem esse fio o modelo entraria
    // publicado com um punhado de tiles, e abriria em tela com buracos, sem erro.
    const parcial = `adot-${SUFIXO}-parcial`;
    const arquivoParcial = `${parcial}.3dtiles`;
    escreverModelo(arquivoParcial, { id: parcial, published: '0' });
    try {
      const r = await adotarModelo(arquivoParcial);
      assert.equal(r.acao, 'criado');
      const { rows } = await db.query('SELECT active FROM tilesets WHERE id = $1', [parcial]);
      assert.equal(rows[0].active, false);
      // E, não estando publicado, a rota o trata como inexistente.
      await supertest(app).get(`/api/v1/assets3d/m/${parcial}/tileset.json`).expect(404);
    } finally {
      await apagar(arquivoParcial).catch(() => {});
    }
  });

  it('a falha da segunda escrita não deixa catálogo órfão', async () => {
    // `a3d.models.db_filename` é UNIQUE: dois modelos não podem apontar para o mesmo
    // arquivo. Renomear o arquivo para um id novo mantendo o cabeçalho apontando... não
    // serve (a validação recusa antes). O que força a falha DEPOIS do catálogo é um
    // segundo modelo cujo cabeçalho declara o db_filename já tomado, e é o que este caso
    // monta: sem transação, a linha de catálogo sobreviveria apontando para bytes que o
    // serviço não sabe servir.
    const clone = `adot-${SUFIXO}-clone`;
    const arquivoClone = `${clone}.3dtiles`;
    escreverModelo(arquivoClone, { id: clone });
    try {
      await db.query('UPDATE a3d.models SET db_filename = $2 WHERE model_id = $1', [
        ID,
        arquivoClone,
      ]);
      await assert.rejects(() => adotarModelo(arquivoClone));
      const { rows } = await db.query('SELECT id FROM tilesets WHERE id = $1', [clone]);
      assert.equal(rows.length, 0, 'a linha de catálogo sobreviveu a uma escrita que falhou');
    } finally {
      await db.query('UPDATE a3d.models SET db_filename = $2 WHERE model_id = $1', [ID, ARQUIVO]);
      await apagar(arquivoClone).catch(() => {});
    }
  });

  it('recusa um arquivo que não existe, sem estourar', async () => {
    const r = await adotarModelo(`nao-existe-${SUFIXO}.3dtiles`);
    assert.equal(r.acao, 'recusado');
    assert.match(r.motivo, /ileg/);
  });
});
