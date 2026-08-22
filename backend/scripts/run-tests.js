#!/usr/bin/env node
// Path: scripts/run-tests.js
// Complete test runner: creates DB, runs migrations, runs tests, drops DB
// Usage: node scripts/run-tests.js [--coverage] [--keep-db] [--reuse-db] [test-pattern]

import { spawn } from 'child_process';
import pgPromise from 'pg-promise';
import { runMigrations } from '../src/database/migrate.js';

// Configuration
const TEST_DB_NAME = process.env.TEST_DB_NAME || 'ebgeo_test';
const DB_USER = process.env.DB_USER || 'ebgeo';
const DB_PASSWORD = process.env.DB_PASSWORD || 'ebgeo_secret';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';

const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL || `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`;
const TEST_DB_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}`;

// Parse arguments
const args = process.argv.slice(2);
const withCoverage = args.includes('--coverage');
const keepDb = args.includes('--keep-db');
const padraoExplicito = args.find(a => !a.startsWith('--'));
const testPattern = padraoExplicito || 'tests/**/*.test.js';

// ---------------------------------------------------------------------------
// `--reuse-db`: o laço de desenvolvimento.
//
// MEDIDO em 2026-08-16, mesmo arquivo de dez casos, `time` nos dois modos: **2,76 s** com
// o ciclo completo de banco contra **1,53 s** reaproveitando. Vale para o laço apertado, e
// o número está aqui porque a estimativa que motivou esta bandeira era 40 s — tempo de
// parede percebido, nunca medido — e errava por mais de uma ordem de grandeza. Derrubar,
// recriar e aplicar as dezesseis migrações custa ~1,2 s, não os 99% do relógio.
//
// Consequência que essa medição impõe a quem vier depois: se o laço parece lento, o banco
// NÃO é o suspeito. O custo está na suíte inteira (que roda sob `c8` e verifica o piso de
// cobertura) e na perna de e2e, e é lá que se mede antes de otimizar.
//
// Com a bandeira, o banco só nasce se não existir, as migrações PENDENTES são aplicadas
// (`runMigrations` consulta `_migrations`, então isto é barato e mantém o schema em dia:
// pular a migração é como o modo rápido passaria a rodar contra um schema velho, que é o
// jeito de ser rápido e errado ao mesmo tempo), e nada é apagado no fim.
//
// O QUE SE PERDE, e é o motivo da trava abaixo: o banco deixa de ser virgem. As fixtures
// geram nome com UUID, então acúmulo normalmente não colide, mas um caso que conte linhas
// de uma tabela inteira passa a enxergar o lixo das rodadas anteriores. Por isso a
// bandeira EXIGE um alvo explícito: a suíte completa — a que a constituição manda rodar
// antes do commit — continua hermética, e não existe forma de pedir "tudo, rápido".
// ---------------------------------------------------------------------------
const reuseDb = args.includes('--reuse-db');
if (reuseDb && !padraoExplicito) {
  console.error('❌ `--reuse-db` exige um alvo explícito (ex.: tests/integration/atlas.test.js).');
  console.error('   A suíte completa roda sempre em banco virgem, porque é ela que vale antes');
  console.error('   do commit: um verde tirado de banco sujo não prova o que ele parece provar.');
  process.exit(1);
}

// O piso de cobertura do `.c8rc.json` só é avaliado quando o c8 embrulha este script,
// e até 2026-07-25 só `npm run test:coverage` fazia isso. Piso que só reprova quem
// escolhe rodá-lo não é guarda, é relatório: ele pega quem lembra, não quem esquece,
// e o comando do Definition of Done é `npm test`.
//
// A auto-elevação abaixo resolve isso SEM quebrar o loop de trabalho: `npm test` sem
// padrão re-executa sob c8 e verifica o piso; `npm test -- <arquivo>` segue rápido e
// sem piso, que é obrigatório, porque um arquivo só medido contra um piso GLOBAL
// reprovaria sempre (medido: rodar só `ranks.test.js` dá 50,86% de linha contra piso
// de 96). Guarda que reprova trabalho legítimo é guarda que alguém desliga.
//
// `NODE_V8_COVERAGE` é posto pelo próprio c8 e serve de trava de recursão.
const deveElevarParaC8 = !padraoExplicito && !process.env.NODE_V8_COVERAGE;

let pgp = null;

/** Re-executa este script sob `c8`, para que o piso do `.c8rc.json` seja avaliado. */
function elevarParaC8() {
  console.log('📊 Suíte completa: re-executando sob c8 para verificar o piso de cobertura.');
  console.log('   (`npm test -- <arquivo>` pula esta etapa, de propósito.)\n');
  const filho = spawn('npx', ['c8', 'node', ...process.argv.slice(1)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  filho.on('close', (code) => process.exit(code ?? 1));
  filho.on('error', (err) => {
    console.error('❌ Falha ao elevar para c8:', err.message);
    process.exit(1);
  });
}

async function createDatabase() {
  pgp = pgPromise();
  const adminDb = pgp(ADMIN_DB_URL);

  try {
    // Check if database exists
    const exists = await adminDb.oneOrNone(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB_NAME]
    );

    if (exists) {
      console.log(`📦 Database "${TEST_DB_NAME}" already exists, resetting...`);
      // Terminate connections and drop. pg_terminate_backend RETURNS rows, so use
      // .any (not .none, which throws "No return data was expected").
      //
      // `backend_type = 'client backend'` IS NOT A FILTER FOR TIDINESS. An autovacuum
      // worker may be attached to the test database at this instant, and a plain role
      // cannot signal one: Postgres answers 42501 ("only roles with privileges of
      // pg_signal_autovacuum_worker...") and the whole backend leg dies during SETUP,
      // with an error that names neither the suite nor the change under test. Measured
      // on this machine before the filter: 4 reds in 10 runs of a single file. Nor do
      // those workers need terminating — DROP DATABASE signals the autovacuum workers
      // of its target itself; the connections it will NOT clear on its own are exactly
      // the client ones that remain in this list. Every other copy of this statement in
      // the repo carries the same filter, and `tests/unit/derrubar-conexao-so-de-cliente.test.js`
      // is what stops the eleventh copy from being written without it.
      await adminDb.any(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid() AND backend_type = 'client backend'
      `, [TEST_DB_NAME]);
      await adminDb.none(`DROP DATABASE ${TEST_DB_NAME}`);
    }

    // Create fresh database
    await adminDb.none(`CREATE DATABASE ${TEST_DB_NAME}`);
    console.log(`✅ Created database "${TEST_DB_NAME}"`);
  } finally {
    await pgp.end();
    pgp = null;
  }
}

/**
 * Cria o banco de teste APENAS se ele ainda não existir (modo `--reuse-db`).
 * @returns {Promise<boolean>} True quando o banco já estava lá (e traz dados de rodadas
 *   anteriores), false quando foi criado agora.
 */
async function ensureDatabase() {
  pgp = pgPromise();
  const adminDb = pgp(ADMIN_DB_URL);
  try {
    const exists = await adminDb.oneOrNone(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB_NAME]
    );
    if (exists) {
      console.log(`♻️  Reaproveitando o banco "${TEST_DB_NAME}" (NÃO está vazio).`);
      return true;
    }
    await adminDb.none(`CREATE DATABASE ${TEST_DB_NAME}`);
    console.log(`✅ Created database "${TEST_DB_NAME}"`);
    return false;
  } finally {
    await pgp.end();
    pgp = null;
  }
}

// PostGIS is an UNTRUSTED extension: it must be created by a superuser. In CI
// the postgis/postgis image already enables it in template1 (new DBs inherit
// it). Locally the app role (ebgeo) is not a superuser, so we pre-create the
// spatial extensions with a superuser connection. Best-effort: if no superuser
// is reachable, migrations still try CREATE EXTENSION as the app role (works
// where the app role is a superuser, e.g. the CI image).
async function ensureExtensions() {
  const superUrl =
    process.env.SUPERUSER_DATABASE_URL ||
    `postgresql://postgres:postgres@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}`;
  const sp = pgPromise();
  const sdb = sp(superUrl);
  try {
    for (const ext of ['postgis', 'pg_trgm', 'unaccent', 'pgcrypto']) {
      await sdb.none(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    }
    console.log('✅ Spatial extensions ensured (superuser)');
  } catch (err) {
    console.warn(`⚠️  Could not pre-create extensions as superuser: ${err.message}`);
    console.warn('   Migrations will attempt CREATE EXTENSION as the app role.');
  } finally {
    await sp.end();
  }
}

async function migrate() {
  console.log('📋 Running migrations...');
  await runMigrations(TEST_DB_URL);
  console.log('✅ Migrations completed');
}

async function runTests() {
  console.log(`\n🧪 Running tests${withCoverage ? ' with coverage' : ''}...\n`);

  const nodeArgs = ['--test', '--test-force-exit', '--test-concurrency=1', '--test-timeout=30000'];

  // Coverage is collected out-of-band by c8 (via NODE_V8_COVERAGE), which the spawned
  // `node --test` child inherits and writes on exit — `npm run test:coverage` wraps this
  // script in c8. Node's built-in --experimental-test-coverage is deliberately NOT used:
  // combined with --test-force-exit it cancels in-flight tests (understating coverage),
  // and without force-exit the suite hangs on open ws/pg handles.
  void withCoverage;

  nodeArgs.push(testPattern);

  return new Promise((resolve, reject) => {
    const testProcess = spawn('node', nodeArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: TEST_DB_URL,
        JWT_SECRET: 'test-secret-key-for-testing-purposes-only-32chars',
        IMAGES_DIR: './data/test-images',
        // O ACERVO 3D TAMBEM PRECISA DE CAMINHO PROPRIO, e a razao e que um teste o APAGA:
        // `assets3d-sqlite.test.js` limpa o arquivo apontado por esta variavel antes e depois
        // de escrever nele. Sem esta linha valia o default, que e o caminho de
        // DESENVOLVIMENTO, e rodar a suite destruia o acervo importado — sem erro, e so
        // percebido na proxima vez que alguem abrisse um modelo.
        ASSETS_3D_SQLITE: './data/test-assets3d.sqlite',
      },
    });

    testProcess.on('close', (code) => {
      resolve(code);
    });

    testProcess.on('error', (err) => {
      reject(err);
    });
  });
}

async function dropDatabase() {
  pgp = pgPromise();
  const adminDb = pgp(ADMIN_DB_URL);

  try {
    // Terminate connections. pg_terminate_backend RETURNS rows, so use .any
    // (not .none, which throws "No return data was expected").
    await adminDb.any(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid() AND backend_type = 'client backend'
    `, [TEST_DB_NAME]);

    // Drop database
    await adminDb.none(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    console.log(`\n🗑️  Dropped database "${TEST_DB_NAME}"`);
  } finally {
    await pgp.end();
    pgp = null;
  }
}

async function main() {
  if (deveElevarParaC8) {
    elevarParaC8();
    return;
  }

  // Sem inicializador: todo caminho abaixo atribui (o try atribui ou lança, e o
  // catch atribui 1), então `= 0` seria valor morto.
  let exitCode;

  console.log('═'.repeat(60));
  console.log('  EBGeo Backend - Test Runner');
  console.log('═'.repeat(60));
  console.log(`  Database: ${TEST_DB_NAME}`);
  console.log(`  Coverage: ${withCoverage ? 'Yes' : 'No'}`);
  console.log(`  Keep DB:  ${keepDb || reuseDb ? 'Yes' : 'No'}`);
  console.log(`  Reuse DB: ${reuseDb ? 'SIM — o banco NÃO é virgem' : 'No'}`);
  console.log(`  Pattern:  ${testPattern}`);
  console.log('═'.repeat(60));
  console.log('');

  try {
    // Step 1: Create database. Em modo rápido ele só nasce se faltar; no modo normal é
    // sempre derrubado e refeito, que é o que torna a suíte completa hermética.
    if (reuseDb) await ensureDatabase();
    else await createDatabase();

    // Step 1b: Ensure spatial extensions (PostGIS needs a superuser). Vale nos dois modos:
    // no rápido custa milissegundos (`IF NOT EXISTS`) e cobre o banco que sobreviveu de uma
    // versão anterior sem alguma extensão que uma migração nova venha a exigir.
    await ensureExtensions();

    // Step 2: Run migrations. Idempotente por `_migrations`: no modo rápido aplica só o
    // que faltar, e é o que impede o atalho de virar "rápido contra o schema errado".
    await migrate();

    // Step 3: Run tests
    exitCode = await runTests();

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    exitCode = 1;
  } finally {
    // Step 4: Drop database (unless --keep-db / --reuse-db)
    if (reuseDb) {
      console.log(`\n♻️  Banco "${TEST_DB_NAME}" preservado para a próxima rodada rápida.`);
      if (exitCode !== 0) {
        // O vermelho pode ser do código OU do lixo acumulado, e os dois se parecem. Dizer
        // isso aqui é mais barato que a hora que alguém vai gastar perseguindo o segundo
        // caso achando que é o primeiro.
        console.log('   Falhou? Confirme sem `--reuse-db` antes de acreditar: em banco');
        console.log('   reaproveitado, dado de rodada anterior também reprova.');
      }
    } else if (!keepDb) {
      try {
        await dropDatabase();
      } catch (err) {
        console.error('Warning: Failed to drop test database:', err.message);
      }
    } else {
      console.log(`\n📦 Database "${TEST_DB_NAME}" preserved (--keep-db)`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(exitCode === 0 ? '  ✅ All tests passed!' : '  ❌ Some tests failed');
  console.log('═'.repeat(60));

  process.exit(exitCode);
}

main();
