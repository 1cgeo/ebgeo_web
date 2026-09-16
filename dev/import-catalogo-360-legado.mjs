#!/usr/bin/env node
// Path: dev/import-catalogo-360-legado.mjs
//
// COMPLETA A DESCRIÇÃO E O LOCAL DOS PROJETOS 360 IMPORTADOS, lendo o `index.db` do
// serviço antigo (`ebgeo_360`). É o par do `import-catalogo-3d-legado.mjs`, e existe pela
// mesma razão: o importador traz a PRODUÇÃO inteira e deixa dois campos de CATÁLOGO para
// trás.
//
// O QUE FALTA, e está medido. O `scripts/sv360-import.js` monta o manifesto do projeto com
// slug, nome, centro, foto de entrada, data e nome do arquivo (`sv360-import.js:359-373`), e
// nem ele nem o `mergeProject` tocam em `description` e `location`, embora as duas colunas
// existam nas duas pontas e a API nova as SIRVA (`sv360.queries.js:70`). Medido no acervo de
// 2026-09-16: os 36 projetos do servidor têm descrição e local preenchidos, e o serviço
// antigo os publica no `/api/v1/projects`. Sem este passo, a travessia entrega 36 cartões de
// catálogo sem uma linha de descrição e sem a cidade.
//
// O CONSERTO DEFINITIVO É OUTRO, e é uma linha no importador: acrescentar os dois campos ao
// manifesto e ao merge. Ele não foi feito aqui porque o `mergeProject` é o núcleo COMPARTILHADO
// com o envio online do painel administrativo, e mexer nele pede a revisão do dono. Este
// script é o passo de fora, que não toca o caminho online.
//
// O QUE ELE NÃO FAZ: não cria projeto (projeto não importado é PULADO e dito na saída), não
// mexe em foto, alvo, andar ou pirâmide, e não toca `access_level` nem `organization_id`.
//
// Uso:
//   node dev/import-catalogo-360-legado.mjs --index-db=<caminho>/index.db
//   node dev/import-catalogo-360-legado.mjs --index-db=... --apply
//
// | Flag | Efeito |
// |---|---|
// | `--index-db=` | o `index.db` do `ebgeo_360` legado. Obrigatório. Aberto SOMENTE-LEITURA. |
// | `--apply` | executa a escrita. Sem ela é dry-run. |
// | `--so=a,b` | restringe a estes slugs. |
//
// `DATABASE_URL` (o DESTINO) sai do ambiente ou de `backend/.env`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..', 'backend');
const requireFromBackend = createRequire(pathToFileURL(resolve(BACKEND, 'package.json')));
const pgp = requireFromBackend('pg-promise')();
const Database = requireFromBackend('better-sqlite3');

const args = process.argv.slice(2);
const flag = (nome) => args.some((a) => a === `--${nome}`);
const valor = (nome) => {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.slice(nome.length + 3) : null;
};

const INDEX_DB = valor('index-db');
const APPLY = flag('apply');
const SO = (valor('so') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!INDEX_DB || !existsSync(INDEX_DB)) {
  console.error(`Falta --index-db=<caminho do index.db do ebgeo_360>${INDEX_DB ? ` (não encontrado: ${INDEX_DB})` : ''}.`);
  process.exit(1);
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = resolve(BACKEND, '.env');
  if (existsSync(envPath)) {
    for (const linha of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      if (linha.startsWith('DATABASE_URL=')) return linha.slice('DATABASE_URL='.length).trim();
    }
  }
  console.error('DATABASE_URL ausente no ambiente e em backend/.env.');
  process.exit(1);
}

// A escrita é por SLUG, e não por id: o id do projeto no destino é derivado (UUID v5) e o
// slug é o que as duas pontas compartilham. `COALESCE` do lado do banco não serve aqui,
// porque o objetivo é justamente preencher o que está nulo sem apagar o que um administrador
// já tenha escrito na tela: por isso o `WHERE` exige o campo vazio no destino.
const UPDATE = `
  UPDATE sv360.projects SET
    description = COALESCE(NULLIF(description, ''), $<description>),
    location    = COALESCE(NULLIF(location, ''), $<location>),
    updated_at  = now()
  WHERE slug = $<slug>
    AND (NULLIF(description, '') IS NULL OR NULLIF(location, '') IS NULL)
`;

async function main() {
  const src = new Database(INDEX_DB, { readonly: true, fileMustExist: true });
  const origem = src.prepare('SELECT slug, name, description, location FROM projects ORDER BY slug').all();
  src.close();

  const db = pgp(databaseUrl());
  const alvo = new URL(databaseUrl());
  console.log(`\norigem : ${INDEX_DB} (${origem.length} projeto(s))`);
  console.log(`destino: ${alvo.pathname.slice(1)} em ${alvo.hostname}:${alvo.port || 5432}`);
  console.log(`modo   : ${APPLY ? 'APPLY (escreve)' : 'DRY-RUN (nada é escrito)'}${SO.length ? ` | só ${SO.join(',')}` : ''}\n`);

  const destino = new Map(
    (await db.any('SELECT slug, description, location FROM sv360.projects')).map((r) => [r.slug, r])
  );

  const aEscrever = [];
  const naoImportados = [];
  const jaCompletos = [];
  for (const p of origem) {
    if (SO.length && !SO.includes(p.slug)) continue;
    const d = destino.get(p.slug);
    if (!d) { naoImportados.push(p.slug); continue; }
    const faltaDesc = !d.description && p.description;
    const faltaLocal = !d.location && p.location;
    if (!faltaDesc && !faltaLocal) { jaCompletos.push(p.slug); continue; }
    aEscrever.push({
      slug: p.slug,
      description: p.description ?? null,
      location: p.location ?? null,
      _falta: [faltaDesc && 'description', faltaLocal && 'location'].filter(Boolean).join(','),
    });
  }

  console.log('--- a completar ---');
  for (const r of aEscrever.slice(0, 10)) {
    console.log(`  ${r.slug.padEnd(22)} ${r._falta.padEnd(22)} ${String(r.location || '').slice(0, 30)}`);
  }
  if (aEscrever.length > 10) console.log(`  … e mais ${aEscrever.length - 10}.`);
  console.log(`\n  ${aEscrever.length} projeto(s) a completar, ${jaCompletos.length} já completo(s)`);
  if (naoImportados.length) {
    console.log(`  ${naoImportados.length} na origem e NÃO importado(s) aqui (pulados): `
      + `${naoImportados.slice(0, 10).join(', ')}${naoImportados.length > 10 ? ', …' : ''}`);
  }

  if (!APPLY) {
    console.log('\nDry-run: nada foi escrito. Repita com --apply.\n');
    await db.$pool.end();
    return;
  }

  let escritos = 0;
  await db.tx(async (t) => {
    for (const r of aEscrever) escritos += (await t.result(UPDATE, r)).rowCount;
  });
  console.log(`\n--- escrito ---\n  ${escritos} projeto(s) completado(s)\n`);
  await db.$pool.end();
}

main().catch((e) => {
  console.error(`Falhou: ${e.message}`);
  process.exit(1);
});
