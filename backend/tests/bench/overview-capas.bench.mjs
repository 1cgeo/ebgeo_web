// Path: tests/bench/overview-capas.bench.mjs
//
// A BANCADA de `GET /atlas/overview` sob N capas. NAO e um caso de teste: nao roda na suite,
// nao afirma nada, e imprime numeros. Rode a mao:
//
//   TEST_DB_NAME=ebgeo_bench_capas node scripts/run-tests.js --reuse-db --keep-db \
//     tests/integration/atlas-cartao-projeto.test.js
//   DATABASE_URL=postgresql://ebgeo:ebgeo_secret@localhost:5432/ebgeo_bench_capas \
//     node tests/bench/overview-capas.bench.mjs
//
// O QUE ELA MEDE. A rota devolve TODA capa alcancavel como data URI base64, num objeto so,
// sem paginacao. O tamanho da resposta cresce LINEARMENTE com o numero de atlas, e o custo
// nao e so rede: `JSON.stringify` de uma string de megabytes nao cede o laco de eventos do
// Node, entao o processo inteiro (WebSockets de colaboracao inclusos) para enquanto serializa.
// A bancada semeia N = 20, 100 e 200 atlas com capa sintetica de 100 kB e cronometra a rota.
//
// POR QUE `curl` E NAO `supertest`. O numero que interessa e o TEMPO de parede de um cliente
// de verdade contra um servidor de verdade, com serializacao, compressao e socket no meio.
// `supertest` sobe um servidor efemero por pedido e mede outra coisa. `%{time_total}` e
// `%{size_download}` do curl sao a mesma regua que a mao usaria.
//
// A SEGUNDA COLUNA E O CONSERTO. Depois do ETag, a bancada repete cada pedido mandando de
// volta o `ETag` que o primeiro devolveu, e imprime o tamanho e o tempo do 304 ao lado do 200.
// O criterio e binario: 304 com corpo menor que 500 bytes.

import pg from 'pg';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

// ASSINCRONO, E ISSO NAO E ESTILO. O servidor medido roda NESTE processo, entao um
// `execFileSync` travaria o laco de eventos do Node e o curl esperaria para sempre por uma
// resposta que o proprio bench impede de nascer. Foi o primeiro modo de falha desta bancada.
const execFileAsync = promisify(execFile);

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://ebgeo:ebgeo_secret@localhost:5432/ebgeo_bench_capas';
process.env.JWT_SECRET = process.env.JWT_SECRET
  || 'test-secret-key-for-testing-purposes-only-32chars';
process.env.IMAGES_DIR = process.env.IMAGES_DIR || './data/test-images';

const { createApp } = await import('../../src/app.js');
const { createUser, createAtlas, loginUser } = await import('../helpers/fixtures.js');

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? padrao : Number(process.argv[i + 1]);
};
const KB_POR_CAPA = arg('kb', 100);
const RODADAS = arg('rodadas', 5);
const DEGRAUS = [20, 100, 200];

/**
 * Uma capa sintetica com a assinatura de PNG de verdade nos oito primeiros bytes.
 *
 * A assinatura importa mesmo a bancada inserindo direto na tabela: o resto do sistema
 * (`COVER_SIGNATURES`) le esses bytes, e uma capa que nao passaria pelo caminho de escrita
 * seria um cenario que nunca existe em producao.
 */
function capaSintetica(kb) {
  const total = kb * 1024;
  const buf = Buffer.alloc(total);
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary').copy(buf, 0);
  // Ruido, e nao zeros: o `compression` do app engoliria uma capa de zeros e a medida de
  // rede viraria ficcao. Capa de verdade e webp/png ja comprimido, ou seja, incompressivel.
  for (let i = 8; i < total; i++) buf[i] = (Math.random() * 256) | 0;
  return buf;
}

/**
 * A SONDA DO LACO DE EVENTOS, que e o dano de verdade.
 *
 * O tamanho da resposta e o sintoma facil de contar, mas o prejuizo nao cai sobre esta tela: um
 * `JSON.stringify` de megabytes nao cede o laco, e enquanto ele roda o processo inteiro para -
 * inclusive os WebSockets de colaboracao de quem esta no mapa noutra aba. Esta sonda pede o laco
 * a cada 5 ms e mede o ATRASO real de cada tique. O maximo e quanto tempo o servidor ficou surdo.
 *
 * E UM TETO, NAO UMA MEDIDA LIMPA, e a coluna do 304 e a prova disso: a propria bancada nasce
 * processos `curl` neste mesmo laco, e o coletor de lixo ainda esta desmontando os 27 MB da serie
 * anterior. Leia a COLUNA DO 200, que cresce com N (16,5 / 68,5 / 152,9 ms), e nao o numero
 * absoluto. Separar a serializacao do resto exigiria instrumentar o servidor por dentro.
 */
function sondaDeLaco(passoMs = 5) {
  let ultimo = process.hrtime.bigint();
  let maxMs = 0;
  const timer = setInterval(() => {
    const agora = process.hrtime.bigint();
    const atraso = Number(agora - ultimo) / 1e6 - passoMs;
    if (atraso > maxMs) maxMs = atraso;
    ultimo = agora;
  }, passoMs);
  timer.unref();
  return {
    zerar() { maxMs = 0; ultimo = process.hrtime.bigint(); },
    get max() { return maxMs; },
    parar() { clearInterval(timer); },
  };
}

/** Mediana, que e o que se reporta de uma serie curta com outlier de primeira rodada. */
const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Um GET pelo curl, com ou sem `If-None-Match`.
 * @returns {{codigo: number, segundos: number, bytes: number, etag: string|null}}
 */
async function pedir(url, token, ifNoneMatch) {
  const args = [
    '-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null',
    '-D', '-',
    '-w', '\n%{http_code} %{time_total} %{size_download}\n',
    '-H', `Authorization: Bearer ${token}`,
  ];
  if (ifNoneMatch) args.push('-H', `If-None-Match: ${ifNoneMatch}`);
  args.push(url);
  const { stdout: saida } = await execFileAsync('curl', args, { maxBuffer: 64 * 1024 * 1024 });
  const linhas = saida.trim().split('\n');
  const [codigo, segundos, bytes] = linhas[linhas.length - 1].trim().split(/\s+/);
  const etagLinha = linhas.find((l) => /^etag:/i.test(l.trim()));
  return {
    codigo: Number(codigo),
    segundos: Number(segundos),
    bytes: Number(bytes),
    etag: etagLinha ? etagLinha.split(':').slice(1).join(':').trim() : null,
  };
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = createApp();
const servidor = app.listen(0);
await new Promise((r) => servidor.once('listening', r));
const base = `http://127.0.0.1:${servidor.address().port}/api/v1/atlas/overview`;

// LIMPA AS RODADAS ANTERIORES. Cada rodada semeia 200 atlas com 100 kB de capa, ou seja 20 MB de
// tabela. Sem esta poda a terceira rodada mediria a varredura do lixo das duas primeiras, e a
// curva subiria por um motivo que nao e o defeito.
await db.query(
  `DELETE FROM atlas WHERE owner_id IN (SELECT id FROM users WHERE username LIKE 'bench_capas_%')`
);
await db.query(`DELETE FROM users WHERE username LIKE 'bench_capas_%'`);

const sufixo = randomUUID().slice(0, 8);
const dono = await createUser(db, { username: `bench_capas_${sufixo}`, nome: 'Bench Dono' });
const token = await loginUser(app, dono.username, dono.password);

const capa = capaSintetica(KB_POR_CAPA);
console.log(`bancada de GET /atlas/overview - capa de ${KB_POR_CAPA} kB, ${RODADAS} rodadas por degrau`);
console.log(`(o proprio processo do servidor esta nesta maquina, entao o tempo NAO inclui rede real)`);
console.log('');
console.log('   N |  200 tempo |   200 bytes | laco 200 |  304 tempo |  304 bytes | laco 304 | codigo');
console.log('-----+------------+-------------+----------+------------+------------+----------+-------');

const laco = sondaDeLaco();

let criados = 0;
for (const N of DEGRAUS) {
  while (criados < N) {
    const atlas = await createAtlas(db, dono.id, { name: `bench_${sufixo}_${criados}` });
    await db.query(
      `INSERT INTO atlas_covers (atlas_id, mime_type, bytes, width, height, updated_by)
       VALUES ($1, 'image/png', $2, 512, 512, $3)`,
      [atlas.id, capa, dono.id]
    );
    criados++;
  }

  // Aquecimento: a primeira rodada paga o plano da consulta e o crescimento do heap.
  await pedir(base, token);

  const cheios = [];
  let etag = null;
  laco.zerar();
  for (let i = 0; i < RODADAS; i++) {
    const r = await pedir(base, token);
    if (r.codigo !== 200) throw new Error(`esperava 200, veio ${r.codigo}`);
    cheios.push(r);
    etag = r.etag;
  }
  const laco200 = laco.max;

  let linha304 = '         - |          - |        - ';
  let discrimina = 'sem ETag';
  if (etag) {
    const condicionais = [];
    laco.zerar();
    for (let i = 0; i < RODADAS; i++) condicionais.push(await pedir(base, token, etag));
    const laco304 = laco.max;
    const t = mediana(condicionais.map((r) => r.segundos));
    const b = mediana(condicionais.map((r) => r.bytes));
    const codigos = [...new Set(condicionais.map((r) => r.codigo))];
    linha304 = `${t.toFixed(4)}s | ${String(b).padStart(10)} | ${laco304.toFixed(1).padStart(6)}ms `;
    discrimina = codigos.join('/');
  }

  const t200 = mediana(cheios.map((r) => r.segundos));
  const b200 = mediana(cheios.map((r) => r.bytes));
  console.log(
    `${String(N).padStart(4)} | ${t200.toFixed(4)}s | ${String(b200).padStart(11)}`
    + ` | ${laco200.toFixed(1).padStart(6)}ms | ${linha304}| ${discrimina}`
  );
}

console.log('');
console.log(`atlas semeados: ${criados}, cada um com uma capa de ${KB_POR_CAPA} kB`);

servidor.close();
await db.end();
process.exit(0);
