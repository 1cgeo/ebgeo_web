// Path: src/modules/models3d/models3d.build.js
// A ESCRITA DE UM `.3dtiles`: criar o banco de um modelo com os pragmas de carga e
// fechá-lo pronto para produção. Vem de `src/db/connection.js` do repositório `ebgeo_3d`,
// e cada pragma aqui tem número atrás.
//
// Só a IMPORTAÇÃO usa este arquivo. O serviço lê por `models3d.store.js`, sobre o pool de
// workers; aqui a conexão é de escrita, síncrona, e vive dentro de um roteiro de linha de
// comando que não atende requisição nenhuma.
import Database from 'better-sqlite3';

/**
 * O ESQUEMA DO FORMATO, e ele não é nosso: `media(key, content)` é o `.3dtiles` do
 * 3d-tiles-tools do Cesium. A tabela `meta` é chave-valor de propósito, para que campo
 * novo não peça ALTER TABLE e um leitor antigo ignore o que não conhece.
 */
const ESQUEMA = `
CREATE TABLE IF NOT EXISTS media (
    key      TEXT PRIMARY KEY,
    content  BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT
);
`;

/**
 * Cria o banco de um modelo, com os pragmas de CARGA EM LOTE.
 *
 * O QUE REALMENTE CUSTA NA CARGA, medido com 8.000 blobs de 40 KiB:
 *
 *   tamanho da transação   lote de 1 contra lote de 256:  24x
 *   synchronous            FULL contra OFF:                2x
 *   journal_mode           MEMORY contra DELETE:      nenhum
 *   cache_size             2 MB contra 64 MB:         nenhum
 *
 * Ou seja, quem decide é a transação em lote do importador, não o pragma. Aqui sobra o
 * `synchronous = OFF`, que vale 2x e é seguro durante a construção: o arquivo nasce do
 * zero, e o conserto de uma queda é apagar e recomeçar.
 *
 * `journal_mode = MEMORY` E NÃO `OFF`: o SQLite RECUSA o OFF nesta situação e devolve
 * `delete` sem reclamar, então pedir OFF dava a impressão de uma otimização que nunca
 * aconteceu. O teste confere o valor EFETIVO, e não o que foi pedido.
 *
 * `page_size = 4096` TEM de vir antes de qualquer tabela: depois disso ele só muda por
 * VACUUM, que reescreve o arquivo inteiro. O 360 usa 65536 e está certo lá, porque o BLOB
 * dele é uma foto de megabytes; aqui o tile médio tem 39,9 KiB e 64 KB desperdiça 21,9%
 * de disco sem ganho de leitura.
 *
 * @param {string} caminho - caminho absoluto do arquivo a criar
 * @returns {import('better-sqlite3').Database}
 */
export function createModelDb(caminho) {
  const db = new Database(caminho);
  db.pragma('page_size = 4096');
  db.pragma('journal_mode = MEMORY');
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -64000');
  db.exec(ESQUEMA);
  return db;
}

/**
 * Fecha um banco recém-construído deixando-o pronto para produção.
 *
 * `journal_mode = DELETE`, e não WAL. Em WAL o SQLite precisa criar o `-shm` ao abrir, e
 * num volume montado `:ro` isso derruba o serviço com um erro que não aponta a causa. A
 * DGEO já pagou esse defeito na publicação do terreno. Fora do WAL o modelo vira arquivo
 * único, que é o que se copia para produção.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function finalizarModelDb(db) {
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');
  db.close();
}
