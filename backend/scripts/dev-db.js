// Path: scripts/dev-db.js
// Provisiona o banco de DESENVOLVIMENTO (o equivalente de test-db.js para os testes).
//
// Por que existe: no Postgres 15+ o schema `public` deixou de conceder CREATE a
// PUBLIC — só o DONO do banco cria tabelas nele. O runner de testes acerta isso
// por acidente feliz: ele cria o `ebgeo_test` conectado COMO O PAPEL DA APLICAÇÃO,
// que portanto vira dono. Um banco de dev criado à mão pelo `postgres` (o caminho
// natural: `createdb ebgeo`) fica com dono errado e `npm run db:migrate` falha com
// "permissão negada para esquema public" — sem nenhuma pista do porquê.
//
// Uso:  node scripts/dev-db.js create   (ou `npm run db:setup`)

import pgPromise from 'pg-promise';

const pgp = pgPromise();

// FONTE ÚNICA: `DATABASE_URL` é o que `src/config.js` exige e o que db:migrate,
// db:seed e o próprio servidor usam. Derivar o alvo de variáveis soltas
// (DEV_DB_NAME/DB_USER/…) faria este script provisionar um banco e as migrações
// irem para outro — falhando em silêncio no eixo do NOME. As variáveis avulsas
// seguem valendo como override explícito.
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definido.');
  console.error('   Copie o exemplo e ajuste:  cp .env.example .env');
  process.exit(1);
}

const dbUrl = new URL(process.env.DATABASE_URL);
const DB_NAME = process.env.DEV_DB_NAME || decodeURIComponent(dbUrl.pathname.replace(/^\//, ''));
const DB_USER = process.env.DB_USER || decodeURIComponent(dbUrl.username);
const DB_PASSWORD = process.env.DB_PASSWORD || decodeURIComponent(dbUrl.password);
const DB_HOST = process.env.DB_HOST || dbUrl.hostname;
const DB_PORT = process.env.DB_PORT || dbUrl.port || '5432';

/** Monta uma URL apontando para `dbName`, preservando credenciais e query params. */
function urlFor(base, dbName) {
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  return u.toString();
}

// Conecta ao `postgres` COMO O PAPEL DA APLICAÇÃO, para que o CREATE DATABASE o
// deixe como dono (mesma estratégia de scripts/run-tests.js).
const APP_BASE = `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/postgres`;
const APP_ADMIN_URL = APP_BASE;
// PostGIS é extensão UNTRUSTED: exige superusuário.
const SUPERUSER_URL =
  process.env.SUPERUSER_DATABASE_URL || `postgresql://postgres:postgres@${DB_HOST}:${DB_PORT}/postgres`;
const SPATIAL_EXTENSIONS = ['postgis', 'unaccent', 'pgcrypto'];

// Identificadores SQL NUNCA por interpolação: `pgp.as.name` faz o quoting correto
// (um DB_NAME com hífen ou maiúscula quebraria — ou pior, aplicaria ao objeto errado).
const qName = (v) => pgp.as.name(v);
/** URL de superusuário apontada para o banco alvo (preserva query string). */
const superuserFor = (dbName) => urlFor(SUPERUSER_URL, dbName);

async function ensureDatabase() {
  const admin = pgp(APP_ADMIN_URL);
  try {
    const row = await admin.oneOrNone(
      `SELECT pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1`,
      [DB_NAME]
    );

    if (!row) {
      await admin.none(`CREATE DATABASE ${qName(DB_NAME)}`);
      console.log(`✅ Banco "${DB_NAME}" criado (dono: ${DB_USER})`);
      return;
    }

    if (row.owner === DB_USER) {
      console.log(`✓ Banco "${DB_NAME}" já existe e pertence a "${DB_USER}"`);
      return;
    }

    // Existe com dono errado — o caso que quebra as migrações. Tenta corrigir com
    // superusuário; se não houver, explica exatamente o que rodar.
    console.log(`⚠️  Banco "${DB_NAME}" existe mas pertence a "${row.owner}" (esperado: "${DB_USER}")`);
    const su = pgp(urlFor(SUPERUSER_URL, 'postgres'));
    try {
      await su.none(`ALTER DATABASE ${qName(DB_NAME)} OWNER TO ${qName(DB_USER)}`);
      console.log(`✅ Dono ajustado para "${DB_USER}"`);
    } catch (err) {
      console.error(`❌ Não foi possível ajustar o dono: ${err.message}`);
      console.error('   Rode como superusuário do Postgres:');
      console.error(`     ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};`);
      console.error(`     ALTER SCHEMA public OWNER TO ${DB_USER};   -- dentro de ${DB_NAME}`);
      throw err;
    } finally {
      await su.$pool.end();
    }
  } finally {
    await admin.$pool.end();
  }
}

// O dono do BANCO não implica dono do SCHEMA `public`: num banco pré-existente ele
// pode continuar do `postgres`, e é o schema que decide o CREATE TABLE.
async function ensureSchemaOwner() {
  const su = pgp(superuserFor(DB_NAME));
  try {
    await su.none(`ALTER SCHEMA public OWNER TO ${qName(DB_USER)}`);
    console.log(`✓ Schema public pertence a "${DB_USER}"`);
  } catch (err) {
    console.warn(`⚠️  Não foi possível ajustar o dono do schema public: ${err.message}`);
  } finally {
    await su.$pool.end();
  }
}

// Um banco que já existia com o dono errado carrega objetos com o dono errado — e é
// o dono da TABELA que decide o acesso, não o do banco. Reatribui tabelas, sequences
// e views do schema `public` para o papel da aplicação. NÃO-DESTRUTIVO: só troca o
// dono, nenhum dado é tocado. (Um `REASSIGN OWNED` seria mais curto, mas varre tudo
// que o papel possui; aqui o alcance é explicitamente o schema public deste banco.)
async function reassignPublicObjects() {
  const su = pgp(superuserFor(DB_NAME));
  try {
    const objs = await su.any(`
      SELECT 'TABLE'    AS kind, tablename    AS name FROM pg_tables    WHERE schemaname = 'public' AND tableowner    <> $1
      UNION ALL
      SELECT 'VIEW'     AS kind, viewname     AS name FROM pg_views     WHERE schemaname = 'public' AND viewowner     <> $1
      UNION ALL
      SELECT 'SEQUENCE' AS kind, sequencename AS name FROM pg_sequences WHERE schemaname = 'public' AND sequenceowner <> $1
    `, [DB_USER]);

    if (objs.length === 0) {
      console.log(`✓ Objetos do schema public já pertencem a "${DB_USER}"`);
      return;
    }

    for (const o of objs) {
      await su.none(`ALTER ${o.kind} public.${qName(o.name)} OWNER TO ${qName(DB_USER)}`);
    }
    console.log(`✅ ${objs.length} objeto(s) do schema public reatribuídos para "${DB_USER}"`);
  } catch (err) {
    console.warn(`⚠️  Não foi possível reatribuir objetos existentes: ${err.message}`);
  } finally {
    await su.$pool.end();
  }
}

async function ensureExtensions() {
  const su = pgp(superuserFor(DB_NAME));
  try {
    for (const ext of SPATIAL_EXTENSIONS) {
      await su.none(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    }
    console.log('✓ Extensões espaciais garantidas (superusuário)');
  } catch (err) {
    console.warn(`⚠️  Não foi possível pré-criar as extensões: ${err.message}`);
    console.warn('   As migrações vão tentar CREATE EXTENSION com o papel da aplicação.');
  } finally {
    await su.$pool.end();
  }
}

// DESTRUTIVO — dropa e recria o banco de dev do zero.
//
// Necessário porque as migrações são rastreadas por NOME DE ARQUIVO, não por
// conteúdo: quando as primeiras migrações foram consolidadas/reescritas no lugar
// (pré-release), todo banco criado ANTES disso ficou preso no schema antigo, com o runner
// reportando alegremente "already applied". O sintoma é uma tabela que sumiu do
// nada (ex.: `basemaps` não existe → GET /api/config responde 500).
//
// Só faz sentido em DESENVOLVIMENTO. Em produção, um schema defasado se resolve
// com uma migração nova (forward-only), nunca com drop.
async function recreateDatabase() {
  const admin = pgp(APP_ADMIN_URL);
  try {
    // `any` (não `none`): este SELECT retorna uma linha por conexão derrubada.
    await admin.any(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [DB_NAME]
    );
    await admin.none(`DROP DATABASE IF EXISTS ${qName(DB_NAME)}`);
    console.log(`🗑️  Banco "${DB_NAME}" removido`);
    await admin.none(`CREATE DATABASE ${qName(DB_NAME)}`);
    console.log(`✅ Banco "${DB_NAME}" recriado (dono: ${DB_USER})`);
  } finally {
    await admin.$pool.end();
  }
}

async function main() {
  const action = process.argv[2] || 'create';
  if (!['create', 'recreate'].includes(action)) {
    console.error(`Ação desconhecida: ${action}. Use: create | recreate`);
    process.exit(1);
  }

  if (action === 'recreate') {
    console.log(`⚠️  DESTRUTIVO: recriando "${DB_NAME}" do zero (todos os dados serão perdidos)…`);
    await recreateDatabase();
    await ensureSchemaOwner();
    await ensureExtensions();
    console.log('\nPronto. Agora rode: npm run db:migrate && npm run db:seed');
    return;
  }

  console.log(`Provisionando banco de desenvolvimento "${DB_NAME}"…`);
  await ensureDatabase();
  await ensureSchemaOwner();
  await reassignPublicObjects();
  await ensureExtensions();
  console.log('\nPronto. Agora rode: npm run db:migrate');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Falhou:', err.message);
    process.exit(1);
  });
