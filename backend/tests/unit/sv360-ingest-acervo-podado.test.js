// Path: tests/unit/sv360-ingest-acervo-podado.test.js
//
// O INGEST PRECISA ACEITAR UM ACERVO SEM BLOB, E RECUSAR UM ACERVO SEM PIXEL NENHUM.
//
// A origem (ebgeo_360) rodou `aposentar-full.js` sobre 29 projetos e APAGOU as colunas
// `full_webp` e `preview_webp`, liberando 64,6 GB. A tabela `images` continua existindo,
// só com `photo_id`, como registro de que a foto teve imagem. O que sobrou de pixel são
// os 120,7 GB de pirâmide.
//
// Enquanto `validateImagesDb` exigia as duas colunas e casava byte a byte com o
// manifesto, TODO acervo novo era recusado na entrada. A guarda não foi removida: foi
// TROCADA. Sem colunas de blob, o bundle precisa trazer o `{slug}_tiles.db` com pirâmide
// cobrindo TODA foto viva do manifesto — a mesma conferência que a origem faz antes de
// apagar um único byte, e por FOTO VIVA, não por arquivo existir.
//
// O QUE ESTE ARQUIVO PRENDE, nos dois sentidos: que o acervo podado ENTRA (senão o porte
// inteiro não recebe dado) e que um bundle sem nenhuma fonte de pixel NÃO entra (senão o
// defeito reaparece longe, como foto que nunca pinta).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { validateImagesDb, resolveTilesDbPath as resolveNoIngest } from '../../src/modules/streetview360/sv360.ingest.js';
import { resolveTilesDbPath as resolveNoBlobstore } from '../../src/modules/streetview360/sv360.blobstore.js';

const RID = crypto.randomUUID().slice(0, 8);
const FOTO_A = crypto.randomUUID();
const FOTO_B = crypto.randomUUID();

let tmp;

/**
 * Manifesto mínimo com as duas fotos.
 * @param {Object} [extra] - campos a sobrepor em cada foto
 * @returns {Object} o manifesto
 */
function manifesto(extra = {}) {
  return {
    project: { slug: `podado-${RID}` },
    photos: [
      { id: FOTO_A, ...extra },
      { id: FOTO_B, ...extra },
    ],
  };
}

/**
 * Escreve um images.db COM as colunas de blob (o acervo histórico).
 * @param {string} nome - nome do arquivo
 * @param {Array<{id: string, full: Buffer, preview: Buffer}>} linhas - as fotos
 * @returns {string} caminho
 */
function imagesComBlob(nome, linhas) {
  const p = path.join(tmp, nome);
  const db = new Database(p);
  db.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
  const ins = db.prepare('INSERT INTO images VALUES (?,?,?)');
  for (const l of linhas) ins.run(l.id, l.full, l.preview);
  db.close();
  return p;
}

/**
 * Escreve um images.db PODADO: a tabela existe, as colunas de blob não.
 * @param {string} nome - nome do arquivo
 * @param {string[]} ids - as fotos que sobreviveram como registro
 * @returns {string} caminho
 */
function imagesPodado(nome, ids) {
  const p = path.join(tmp, nome);
  const db = new Database(p);
  db.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY)');
  const ins = db.prepare('INSERT INTO images VALUES (?)');
  for (const id of ids) ins.run(id);
  db.close();
  return p;
}

/**
 * Escreve um {slug}_tiles.db com pirâmide para os ids dados.
 * @param {string} nome - nome do arquivo
 * @param {Array<{id: string, tileSize?: number, width?: number, height?: number}>} linhas - pirâmides
 * @returns {string} caminho
 */
function tilesDb(nome, linhas) {
  const p = path.join(tmp, nome);
  const db = new Database(p);
  db.exec(`CREATE TABLE tile_pyramids (
    photo_id TEXT PRIMARY KEY, tile_size INTEGER NOT NULL, max_level INTEGER NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, quality INTEGER NOT NULL,
    tile_count INTEGER NOT NULL, total_bytes INTEGER NOT NULL, built_at TEXT NOT NULL,
    razao REAL NOT NULL DEFAULT 2)`);
  const ins = db.prepare('INSERT INTO tile_pyramids VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const l of linhas) {
    ins.run(l.id, l.tileSize ?? 512, 1, l.width ?? 1024, l.height ?? 512, 80, 3, 999, '2026-08-20', 2);
  }
  db.close();
  return p;
}

describe('ingest de acervo 360 podado (só-tiles)', () => {
  before(() => {
    tmp = path.join(os.tmpdir(), `sv360-podado-${RID}`);
    mkdirSync(tmp, { recursive: true });
  });

  after(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it('ACEITA images.db podado quando a pirâmide cobre TODA foto do manifesto', () => {
    const imgs = imagesPodado('ok-images.db', [FOTO_A, FOTO_B]);
    const tiles = tilesDb('ok-tiles.db', [{ id: FOTO_A }, { id: FOTO_B }]);
    // Não lançar É o resultado: este é o caminho que precisava voltar a existir.
    validateImagesDb(imgs, manifesto(), tiles);
  });

  it('RECUSA acervo podado sem arquivo de tiles nenhum, e a mensagem diz o que falta', () => {
    const imgs = imagesPodado('sem-tiles-images.db', [FOTO_A, FOTO_B]);
    assert.throws(
      () => validateImagesDb(imgs, manifesto(), null),
      (err) => {
        // A mensagem tem de nomear o FORMATO, não "arquivo inválido": sem isso o
        // operador procura corrupção num arquivo perfeito.
        assert.match(err.message, /so-tiles|tiles\.db/i);
        assert.equal(err.statusCode ?? err.status, 400);
        return true;
      }
    );
  });

  it('RECUSA quando a pirâmide cobre só PARTE das fotos vivas', () => {
    // O caso que "o arquivo existe" deixaria passar: metade do projeto sem pixel.
    const imgs = imagesPodado('parcial-images.db', [FOTO_A, FOTO_B]);
    const tiles = tilesDb('parcial-tiles.db', [{ id: FOTO_A }]);
    assert.throws(
      () => validateImagesDb(imgs, manifesto(), tiles),
      (err) => {
        assert.match(err.message, new RegExp(FOTO_B));
        return true;
      }
    );
  });

  it('RECUSA pirâmide degenerada, que passaria na contagem', () => {
    // tile_size 0 produz descritor que o cliente segue até um nível sem tile nenhum.
    const imgs = imagesPodado('degen-images.db', [FOTO_A, FOTO_B]);
    const tiles = tilesDb('degen-tiles.db', [{ id: FOTO_A }, { id: FOTO_B, tileSize: 0 }]);
    assert.throws(
      () => validateImagesDb(imgs, manifesto(), tiles),
      (err) => {
        assert.match(err.message, /degenerate/i);
        return true;
      }
    );
  });

  it('RECUSA um tiles.db sem a tabela de pirâmides', () => {
    const imgs = imagesPodado('semtab-images.db', [FOTO_A, FOTO_B]);
    const p = path.join(tmp, 'semtab-tiles.db');
    const db = new Database(p);
    db.exec('CREATE TABLE outra_coisa (x INTEGER)');
    db.close();
    assert.throws(() => validateImagesDb(imgs, manifesto(), p), /tile_pyramids/);
  });

  it('RECUSA um tiles.db que não é SQLite', () => {
    const imgs = imagesPodado('lixo-images.db', [FOTO_A, FOTO_B]);
    const p = path.join(tmp, 'lixo-tiles.db');
    writeFileSync(p, 'isto nao e um banco');
    assert.throws(() => validateImagesDb(imgs, manifesto(), p), /not a valid SQLite/);
  });

  // O CAMINHO ANTIGO NÃO PODE TER REGREDIDO: o acervo ficou MISTO, com 29 projetos
  // só-tiles e o Estádio Serra Dourada ainda com blob.
  describe('o acervo COM blob continua sendo verificado como antes', () => {
    const cheio = Buffer.from('0123456789');
    const previa = Buffer.from('01234');

    it('aceita quando os tamanhos batem com o manifesto', () => {
      const imgs = imagesComBlob('cheio-ok.db', [
        { id: FOTO_A, full: cheio, preview: previa },
        { id: FOTO_B, full: cheio, preview: previa },
      ]);
      validateImagesDb(imgs, manifesto({ full_size_bytes: 10, preview_size_bytes: 5 }), null);
    });

    it('RECUSA quando o tamanho do blob diverge do manifesto', () => {
      // A conferência que o modo só-tiles não faz, e que aqui continua valendo.
      const imgs = imagesComBlob('cheio-ruim.db', [
        { id: FOTO_A, full: cheio, preview: previa },
        { id: FOTO_B, full: cheio, preview: previa },
      ]);
      assert.throws(
        () => validateImagesDb(imgs, manifesto({ full_size_bytes: 999, preview_size_bytes: 5 }), null),
        /full_webp size mismatch/
      );
    });

    it('RECUSA quando falta a linha de uma foto', () => {
      const imgs = imagesComBlob('cheio-falta.db', [{ id: FOTO_A, full: cheio, preview: previa }]);
      assert.throws(
        () => validateImagesDb(imgs, manifesto({ full_size_bytes: 10, preview_size_bytes: 5 }), null),
        new RegExp(`missing a row for photo ${FOTO_B}`)
      );
    });
  });
});

describe('o nome do arquivo de tiles é o mesmo nos dois módulos', () => {
  // Quem INSTALA (ingest) e quem LÊ (blobstore) derivam o nome cada um por sua conta,
  // seguindo o padrão que este módulo já usa para `resolveDbPath`. Se divergirem, o
  // ingest grava num nome e o leitor procura noutro: nada quebra na ingestão, e toda
  // foto responde 404 depois. Este caso é a única amarra entre as duas.
  const casos = ['org__proj.db', 'org__proj', 'a__b-c-d.db', 'sem_extensao_nenhuma'];

  it('as duas derivações concordam em todos os casos', () => {
    assert.equal(casos.length, 4);
    for (const nome of casos) {
      assert.equal(resolveNoIngest(nome), resolveNoBlobstore(nome), `divergiu para ${nome}`);
    }
  });

  it('e o nome derivado termina em _tiles.db', () => {
    assert.match(resolveNoIngest('org__proj.db'), /org__proj_tiles\.db$/);
    // Traversal: o basename roda ANTES do sufixo, então componente de diretório sai.
    assert.doesNotMatch(resolveNoIngest('../../etc/passwd.db'), /\.\./);
  });
});
