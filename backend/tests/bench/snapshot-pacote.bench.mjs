// Path: tests/bench/snapshot-pacote.bench.mjs
//
// A BANCADA do pacote de statements do snapshot. NAO e um caso de teste: nao roda na suite,
// nao afirma nada, e imprime numeros. Rode a mao:
//
//   TEST_DB_NAME=ebgeo_test_sync node scripts/run-tests.js --reuse-db --keep-db <um-arquivo>
//   DATABASE_URL=postgresql://ebgeo:ebgeo_secret@localhost:5432/ebgeo_test_sync \
//     node tests/bench/snapshot-pacote.bench.mjs
//
// POR QUE UMA BANCADA SEPARADA, e nao mais um `.test.js`: o numero que interessa aqui e TEMPO,
// e tempo dentro de suite e ruido. O que a suite guarda e a CONTAGEM de idas ao banco
// (`sync-snapshot-pacote.test.js`), que e deterministica.
//
// O QUE ELA MEDE, e o segundo cenario e o unico honesto:
//
//   1. localhost. O banco esta na mesma maquina, o RTT e da ordem de 0,2 ms, e treze idas
//      custam uns 2,6 ms. A MEDIDA VAI DIZER QUE NAO HA PROBLEMA. Isso e artefato de bancada,
//      nao resultado: nenhum servidor de producao fala com o banco por loopback.
//
//   2. RTT INJETADO. Cada round-trip ganha um atraso artificial (`--rtt`, 3 ms por padrao),
//      aplicado no ponto exato onde o driver entrega a resposta. E o cenario de um banco a
//      um salto de rede de distancia, que e onde o conserto vale.
//
//   3. CONCORRENCIA. K snapshots ao mesmo tempo contra um pool de 10 conexoes. E aqui que
//      esta o eixo real do conserto: o `task()` retem UMA das dez conexoes durante a serie
//      inteira, entao encurtar a serie devolve a conexao mais cedo e o 11o cliente espera
//      menos. Um snapshot sozinho nunca mostraria isso.
//
// COMO ELA COMPARA. Importa DUAS implementacoes: a ATUAL e a do git (`--ref`, `HEAD` por
// padrao), que a propria bancada extrai para um arquivo temporario ao lado do original e apaga
// no fim. Extrair em vez de deixar a copia no repositorio evita que ela entre na suite, na
// cobertura e no lint. As duas rodam contra o MESMO atlas semeado, ALTERNANDO as rodadas, para
// que qualquer deriva da maquina (cache do Postgres, turbo do processador, outro agente
// compilando alguma coisa) caia igual nas duas.

import pg from 'pg';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://ebgeo:ebgeo_secret@localhost:5432/ebgeo_test_sync';
process.env.JWT_SECRET = process.env.JWT_SECRET
  || 'test-secret-key-for-testing-purposes-only-32chars';

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? padrao : Number(process.argv[i + 1]);
};
const RTT_MS = arg('rtt', 3);
const MAPAS = arg('mapas', 12);
const RODADAS = arg('rodadas', 15);
const K = arg('k', 40);

// ---------------------------------------------------------------------------
// INJECAO DE RTT.
//
// O atraso entra no CALLBACK que o node-postgres chama com o resultado, que e onde
// pg-promise espera (`pg-promise/lib/query.js:156` faz `client.query(q, params, cb)`).
// Atrasar o callback modela o salto de rede nas duas dimensoes que importam: a serie fica
// mais longa E a conexao do pool fica retida por mais tempo, porque pg-promise so emite o
// proximo statement, e so devolve a conexao, depois que este callback dispara.
//
// Nao serve atrasar o `options.query` do pg-promise: aquele gancho e SINCRONO e o retorno
// dele e ignorado, entao um `await` ali nao segura nada.
// ---------------------------------------------------------------------------
// `setTimeout` NAO SERVE SOZINHO NO WINDOWS, e a primeira rodada desta bancada provou isso:
// pedindo 3 ms por ida, ANTES deu 189,9 ms com 12 idas, ou 15,8 ms POR IDA. Esse numero e a
// granularidade do temporizador do Windows (~15,6 ms), nao o atraso pedido. A medida existia,
// estava errada por 5x, e so a divisao 189,9/12 denunciou. Por isso o atraso e HIBRIDO: a
// parte que cabe num tique vai de `setTimeout`, e o resto e resolvido por `setImmediate`, que
// da resolucao de fracao de milissegundo sem bloquear o laco de eventos (um `while` sobre o
// relogio bloquearia, e ai o teste de concorrencia mediria a fila do Node, nao a do pool).
// `calibrar()` la embaixo mede o que este atraso realmente entrega, e e esse numero que vai
// ao relatorio.
const GRANULARIDADE_MS = 16;
function atrasar(ms, cb) {
  const fim = process.hrtime.bigint() + BigInt(Math.round(ms * 1e6));
  const espiar = () => {
    if (process.hrtime.bigint() >= fim) cb();
    else setImmediate(espiar);
  };
  const grosso = ms - GRANULARIDADE_MS;
  if (grosso > 0) setTimeout(espiar, grosso);
  else setImmediate(espiar);
}

const queryOriginal = pg.Client.prototype.query;
let rttAtivo = 0;
pg.Client.prototype.query = function comRtt(config, values, callback) {
  if (rttAtivo > 0 && typeof callback === 'function') {
    const cb = callback;
    return queryOriginal.call(this, config, values, (...a) => atrasar(rttAtivo, () => cb(...a)));
  }
  return queryOriginal.call(this, config, values, callback);
};

/** O atraso que `atrasar()` entrega de fato, medido. Sem isto o RTT do relatorio e uma intencao. */
async function calibrar(ms, amostras = 60) {
  const xs = [];
  for (let i = 0; i < amostras; i++) {
    const t0 = process.hrtime.bigint();
    await new Promise((r) => atrasar(ms, r));
    xs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// A linha de base sai do git, nunca de uma copia esquecida no disco: uma copia que envelhece
// mede a diferenca entre a versao atual e o que alguem lembrou de salvar.
const REF = (() => {
  const i = process.argv.indexOf('--ref');
  return i === -1 ? 'HEAD' : process.argv[i + 1];
})();
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../..');
const ARQUIVO_ANTES = path.resolve(AQUI, '../../src/modules/sync/sync.service.BASE.mjs');
writeFileSync(
  ARQUIVO_ANTES,
  execFileSync('git', ['show', `${REF}:backend/src/modules/sync/sync.service.js`],
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
);
const apagarBase = () => { try { rmSync(ARQUIVO_ANTES); } catch { /* ja foi */ } };
process.on('exit', apagarBase);

const { db } = await import('../../src/database/index.js');
const depois = await import('../../src/modules/sync/sync.service.js');
const antes = await import('../../src/modules/sync/sync.service.BASE.mjs');

// ---------------------------------------------------------------------------
// Contagem de idas ao banco, pelo gancho de evento do pg-promise. As opcoes vivem em
// `db.$config.options` — `pgp.options` nao existe nesta versao.
// ---------------------------------------------------------------------------
async function contarIdas(fn) {
  const opts = db.$config.options;
  const original = opts.query;
  let n = 0;
  const stmts = [];
  opts.query = (e) => {
    n += 1;
    stmts.push(String(e.query).replace(/\s+/g, ' ').trim().slice(0, 60));
  };
  try {
    await fn();
  } finally {
    opts.query = original;
  }
  return { n, stmts };
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f = (x) => x.toFixed(2);

async function cronometrar(fn) {
  const t0 = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

// ---------------------------------------------------------------------------
// Semeadura: um atlas com conteudo em TODAS as nove colecoes do pacote. Um atlas de mapas
// vazios mediria o custo de idas que voltam sem linha nenhuma, que e justamente o caso em
// que o pacote parece melhor do que e.
// ---------------------------------------------------------------------------
async function semear() {
  const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cliente.connect();
  const q = (s, v) => cliente.query(s, v);

  // `users` tem FK de posto e de OM e um CHECK bicondicional de escopo de produtor; a
  // fixture da suite ja sabe disso, entao ela e quem cria o dono.
  const { createUser } = await import('../helpers/fixtures.js');
  const dono = await createUser(cliente, { username: `bench_${randomUUID().slice(0, 8)}` });
  const userId = dono.id;
  const atlasId = randomUUID();
  await q(
    `INSERT INTO atlas (id, name, owner_id, version, current_version, min_version)
     VALUES ($1, $2, $3, 1, 1, 0)`,
    [atlasId, `Bench ${atlasId.slice(0, 8)}`, userId],
  );

  for (let i = 0; i < MAPAS; i++) {
    const mapId = randomUUID();
    await q(`INSERT INTO maps (id, atlas_id, name, version) VALUES ($1, $2, $3, 1)`,
      [mapId, atlasId, `Mapa ${i}`]);
    const layerId = randomUUID();
    await q(`INSERT INTO layers (id, map_id, name, sort_order, version) VALUES ($1, $2, 'L', 0, 1)`,
      [layerId, mapId]);
    const grupoId = randomUUID();
    await q(`INSERT INTO groups (id, map_id, name, version) VALUES ($1, $2, 'G', 1)`,
      [grupoId, mapId]);
    for (let j = 0; j < 8; j++) {
      const featId = randomUUID();
      await q(
        `INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id, version)
         VALUES ($1, $2, 'point', $3, $4, $5, 1)`,
        [featId, mapId, JSON.stringify({ type: 'Point', coordinates: [-43 + j / 100, -22] }),
          JSON.stringify({ nome: `P${j}` }), layerId],
      );
      await q(`INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)`, [grupoId, featId]);
    }
    await q(
      `INSERT INTO cesium3d_data (id, map_id, data_type, tileset_id, data, version)
       VALUES ($1, $2, 'marker', $3, $4, 1)`,
      [randomUUID(), mapId, `ts_${i}`, JSON.stringify({ pos: [1, 2, 3] })],
    );
    await q(
      `INSERT INTO streetview360_data (id, map_id, data_type, photo_name, data, version)
       VALUES ($1, $2, 'orientation', $3, $4, 1)`,
      [randomUUID(), mapId, `foto_${i}`, JSON.stringify({ heading: 90 })],
    );
    await q(
      `INSERT INTO catalog_layers (id, map_id, data, version) VALUES ($1, $2, $3, 1)`,
      [randomUUID(), mapId, JSON.stringify({ type: 'wms', name: `C${i}`, visible: true })],
    );
    await q(
      `INSERT INTO comments (id, atlas_id, map_id, author_id, lng, lat, status, data, version)
       VALUES ($1, $2, $3, $4, -43, -22, 'open', $5, 1)`,
      [randomUUID(), atlasId, mapId, userId, JSON.stringify({ texto: 'oi' })],
    );
  }

  for (let b = 0; b < 3; b++) {
    const briefingId = randomUUID();
    const slideIds = [randomUUID(), randomUUID(), randomUUID()];
    await q(
      `INSERT INTO briefings (id, atlas_id, name, slide_order, version) VALUES ($1, $2, $3, $4, 1)`,
      [briefingId, atlasId, `Briefing ${b}`, slideIds],
    );
    for (const sid of slideIds) {
      await q(
        `INSERT INTO slides (id, briefing_id, title, content, mode, version)
         VALUES ($1, $2, 'S', '', '2d', 1)`,
        [sid, briefingId],
      );
    }
  }

  await cliente.end();
  return { atlasId, userId };
}

// ---------------------------------------------------------------------------
const { atlasId } = await semear();
console.log(`\nAtlas semeado: ${MAPAS} mapas, ${MAPAS * 8} feicoes, 3 briefings, 9 slides.`);
const rttEfetivo = await calibrar(RTT_MS);
console.log(`RTT injetado: ${RTT_MS} ms pedidos, ${f(rttEfetivo)} ms MEDIDOS por ida.`);
console.log(`Rodadas: ${RODADAS}. Concorrencia K=${K}.\n`);

// --- 1. contagem de idas -----------------------------------------------------
const cAntes = await contarIdas(() => antes.getAtlasSnapshot(atlasId));
const cDepois = await contarIdas(() => depois.getAtlasSnapshot(atlasId));
const cAntesRead = await contarIdas(() => antes.getAtlasSnapshot(atlasId, 'read'));
const cDepoisRead = await contarIdas(() => depois.getAtlasSnapshot(atlasId, 'read'));

console.log('== IDAS AO BANCO ==');
console.log(`  owner: ANTES ${cAntes.n}  ->  DEPOIS ${cDepois.n}`);
console.log(`  read : ANTES ${cAntesRead.n}  ->  DEPOIS ${cDepoisRead.n}`);
console.log('  statements DEPOIS (owner):');
cDepois.stmts.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));

// --- prova de equivalencia do payload ---------------------------------------
const snapA = await antes.getAtlasSnapshot(atlasId);
const snapB = await depois.getAtlasSnapshot(atlasId);
const iguais = JSON.stringify(snapA) === JSON.stringify(snapB);
console.log(`\n== PAYLOAD IDENTICO (JSON) ==\n  ${iguais ? 'sim' : 'NAO — investigar'}`);
if (!iguais) {
  console.log(`  antes: ${JSON.stringify(snapA).length} bytes; depois: ${JSON.stringify(snapB).length} bytes`);
}

// --- 2. latencia de um snapshot so ------------------------------------------
async function serie(rtt) {
  rttAtivo = rtt;
  const a = []; const d = [];
  // aquecimento: a primeira rodada paga o plano da consulta e o cache frio do Postgres.
  await antes.getAtlasSnapshot(atlasId);
  await depois.getAtlasSnapshot(atlasId);
  for (let i = 0; i < RODADAS; i++) {
    // alternado, para que qualquer deriva da maquina caia nas duas.
    a.push(await cronometrar(() => antes.getAtlasSnapshot(atlasId)));
    d.push(await cronometrar(() => depois.getAtlasSnapshot(atlasId)));
  }
  rttAtivo = 0;
  return { a, d };
}

for (const rtt of [0, RTT_MS]) {
  const { a, d } = await serie(rtt);
  const rotulo = rtt === 0 ? 'localhost (RTT real, ~0,2 ms)' : `RTT injetado de ${rtt} ms/ida`;
  console.log(`\n== LATENCIA DE UM SNAPSHOT — ${rotulo} ==`);
  console.log(`  ANTES : mediana ${f(pct(a, 50))} ms   media ${f(media(a))} ms   p95 ${f(pct(a, 95))} ms`);
  console.log(`  DEPOIS: mediana ${f(pct(d, 50))} ms   media ${f(media(d))} ms   p95 ${f(pct(d, 95))} ms`);
  console.log(`  delta mediana: ${f(pct(a, 50) - pct(d, 50))} ms (${f(100 * (1 - pct(d, 50) / pct(a, 50)))}%)`);
}

// --- 3. concorrencia: K snapshots contra um pool de 10 ----------------------
//
// O numero que interessa e o P95 do TEMPO DE CADA snapshot, nao o do lote: o cliente que
// espera e o que pegou a fila do pool, e ele desaparece numa media.
async function lote(mod, rtt) {
  rttAtivo = rtt;
  const tempos = await Promise.all(
    Array.from({ length: K }, () => cronometrar(() => mod.getAtlasSnapshot(atlasId))),
  );
  rttAtivo = 0;
  return tempos;
}

for (const rtt of [0, RTT_MS]) {
  // duas passadas alternadas, e fica a segunda (a primeira aquece o pool).
  await lote(antes, rtt); await lote(depois, rtt);
  const tA = await lote(antes, rtt);
  const tD = await lote(depois, rtt);
  const rotulo = rtt === 0 ? 'localhost' : `RTT ${rtt} ms`;
  console.log(`\n== CONCORRENCIA K=${K}, pool 10 — ${rotulo} ==`);
  console.log(`  ANTES : p50 ${f(pct(tA, 50))}  p95 ${f(pct(tA, 95))}  max ${f(Math.max(...tA))} ms`);
  console.log(`  DEPOIS: p50 ${f(pct(tD, 50))}  p95 ${f(pct(tD, 95))}  max ${f(Math.max(...tD))} ms`);
  console.log(`  delta p95: ${f(pct(tA, 95) - pct(tD, 95))} ms (${f(100 * (1 - pct(tD, 95) / pct(tA, 95)))}%)`);
}

console.log('');
process.exit(0);
