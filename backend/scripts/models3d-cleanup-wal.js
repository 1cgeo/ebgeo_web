#!/usr/bin/env node
// Path: scripts/models3d-cleanup-wal.js
// TIRA OS `.3dtiles` DO WAL e apaga as sobras. Portado de `scripts/cleanup-wal.js` do
// repositório `ebgeo_3d`, sem a metade que cuidava do `index.db`: aqui o catálogo é o
// Postgres, e o único SQLite que resta é o arquivo de cada modelo.
//
// POR QUE ISSO IMPORTA. Em `journal_mode = wal` o SQLite precisa criar o `-shm` ao abrir,
// MESMO PARA LER. Num volume montado `:ro` isso falha, e o serviço morre com uma mensagem
// que não aponta a causa. A DGEO já pagou esse defeito na publicação do terreno. Fora do
// WAL o modelo vira arquivo único, que é o que se copia para produção.
//
// O importador já entrega em `DELETE` (`finalizarModelDb`). Este roteiro é para o arquivo
// que chegou de outra máquina, ou que alguém abriu para escrita e deixou em WAL.
//
// Uso:
//   npm run models3d:cleanup-wal -- --dry-run
//   npm run models3d:cleanup-wal
import { readdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import config from '../src/config.js';

const seco = process.argv.includes('--dry-run');

/**
 * Põe um arquivo no modo `DELETE` e remove `-wal`/`-shm`.
 * @param {string} caminho
 * @returns {{modo: string, antes: number, depois: number, sobras: string[]}}
 */
function trata(caminho) {
  const antes = statSync(caminho).size;
  const db = new Database(caminho);
  const modo = db.pragma('journal_mode', { simple: true });
  if (modo !== 'delete' && !seco) {
    // O checkpoint acontece na troca de modo: o WAL é dobrado no arquivo principal antes
    // de o modo mudar, então nada se perde.
    db.pragma('journal_mode = DELETE');
  }
  db.close();

  const sobras = [];
  for (const sufixo of ['-wal', '-shm']) {
    const f = `${caminho}${sufixo}`;
    if (!existsSync(f)) continue;
    sobras.push(f);
    if (!seco) unlinkSync(f);
  }
  return { modo, antes, depois: statSync(caminho).size, sobras };
}

const dir = config.models3d.dbDir;
if (!existsSync(dir)) {
  console.error(`ERRO: ${dir} nao existe.`);
  process.exit(2);
}

const arquivos = readdirSync(dir).filter((f) => f.endsWith('.3dtiles'));
console.log(`${arquivos.length} arquivo(s) em ${dir}${seco ? '  (dry-run)' : ''}\n`);

let mudados = 0;
for (const nome of arquivos) {
  const r = trata(join(dir, nome));
  if (r.modo === 'delete' && !r.sobras.length) continue;
  mudados += 1;
  console.log(
    `${nome}: journal ${r.modo}`
      + (r.sobras.length ? `, sobras ${r.sobras.length}` : '')
      + (r.antes !== r.depois ? `, ${(r.antes / 2 ** 20).toFixed(1)} -> ${(r.depois / 2 ** 20).toFixed(1)} MiB` : ''),
  );
}
console.log(seco ? `\ndry-run: ${mudados} arquivo(s) precisariam de conserto` : `\n${mudados} arquivo(s) tratados`);
