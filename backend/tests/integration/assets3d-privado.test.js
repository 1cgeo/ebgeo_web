// Path: tests/integration/assets3d-privado.test.js
//
// OS BYTES DO MODELO 3D SEGUEM O RECURSO, NÃO A ROTA (fase F11, parte B).
//
// O QUE ERA. `assets3d.routes.js` era `router.get('/*', serveAsset)` sem um middleware
// sequer, e a wiki dizia a verdade em voz alta: a proteção era "quem não conhece a URL não
// baixa". A URL viaja no payload aditivo (`/resource-access/visible`), então quem a recebe
// legitimamente pode repassar o caminho, e o caminho entregava os bytes a qualquer um.
//
// O QUE ESTE ARQUIVO COBRA, e são OITO propriedades, não uma:
//
//   (a) O PÚBLICO NÃO REGRIDE EM NADA. Mesmo 200 sem credencial, mesmo `public, immutable`,
//       mesmo ETag, mesmo 304, mesmo Range. Este é o par positivo, e sem ele o arquivo
//       inteiro passaria idêntico com uma rota que negasse tudo.
//   (b) O PRIVADO NEGA, e nega com 404 — a escada da casa, a mesma de
//       `enforceProjectReadable` no 360 —, para que o modelo escondido seja
//       indistinguível de um que não existe. E o positivo do mesmo par: o BENEFICIÁRIO DA
//       CONCESSÃO alcança, com `private` no cache. Sem essa metade, todo 404 daqui passaria
//       idêntico se o gate negasse a todos, que é a forma clássica de cobertura vazia. O HEAD
//       segue o GET, senão a rota teria uma segunda porta que confirma existência sem corpo.
//   (c) O UUID DO ATLAS NÃO É SENHA. `?atlasId=` diz QUAL empréstimo o chamador quer usar;
//       quem diz que ele pode usá-lo é `requireAtlasPermission('read')`. O visitante
//       ANÔNIMO de um atlas `is_public` herda o empréstimo (decisão R4); o mesmo anônimo
//       apontando para um atlas que não é público não herda nada. E são DUAS perguntas, não
//       uma: alcançar o atlas não basta, o atlas precisa ter tomado o recurso emprestado, o
//       que se mede com o chamador que é DONO de um atlas que não empresta nada.
//   (c2) A SOLETRAÇÃO DO CAMINHO NÃO CONTORNA O GATE. Caixa alta e barra invertida endereçam o
//       mesmo arquivo em Windows e macOS, onde quem serve é `path.resolve`; enquanto o índice
//       comparava string crua, essas duas grafias saíam PÚBLICAS e entregavam o tileset
//       privado ao anônimo. Regressão medida DEPOIS de a fase se declarar entregue.
//   (c3) QUEM DECIDE É `fn_can_see_resource`, com os filtros dela. Três chamadores com linha em
//       `resource_grants` sobre o mesmo recurso: o vivo entra, o VENCIDO e o REVOGADO não. Uma
//       segunda regra em JS olharia a existência da linha e liberaria os três.
//   (d) A MARCA TROCA EM TEMPO REAL, NOS DOIS SENTIDOS. Público -> privado fecha os bytes na
//       requisição seguinte, e privado -> público os devolve. Só o par prova o MECANISMO: um
//       sentido só passaria idêntico num gate que, uma vez fechado, ficasse fechado.
//   (e) NENHUMA RESPOSTA PRIVADA É PUBLICAMENTE CACHEÁVEL, e NENHUM 304 ATRAVESSA ESCOPO.
//       Um 304 devolvido a quem não pode ver confirma existência E ETag, e é a forma pela
//       qual um gate correto no 200 vaza pela revalidação.
//   (f) OS DOIS RAMOS DE ARMAZENAMENTO SE COMPORTAM IGUAL. O controlador tenta o SQLite e
//       cai no filesystem, e as duas metades têm cópias independentes de ETag/304/Range.
//       Filtro aplicado a um ramo só é a forma exata do defeito que este branch já pagou no
//       MVT, então a bateria de acesso roda DUAS vezes, uma por ramo, e um caso separado
//       afirma que os dois ramos são de fato dois (senão a paridade mediria o mesmo ramo
//       duas vezes e passaria verde por engano).
//
// E a última, que é de desenho e não de acesso: NENHUMA CONSULTA POR REQUISIÇÃO DE ASSET.
// O Cesium abre uma requisição por tile por LOD; um gate que consultasse o banco em cada
// uma poria essa explosão no mesmo pool de dez conexões do sync e do `/api/config`, cuja
// falha impede o boot. O último bloco conta as consultas de verdade, com o contador de pool.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { installPoolQueryCounter } from '../helpers/query-counter.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser,
  makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';
import {
  openWritable, putAsset, closeStore, getAssetMeta,
} from '../../src/modules/nomes/assets3d.store.js';
import Database from 'better-sqlite3';
import { blobPool } from '../../src/utils/sqlite-blob-pool.js';
import { resolveDbPath, resetOpenModels } from '../../src/modules/models3d/models3d.store.js';

const ROOT = resolve('./data/assets3d');
const SQLITE = resolve(process.env.ASSETS_3D_SQLITE || './data/assets3d.sqlite');
const SUFIXO = crypto.randomUUID().slice(0, 8);
const PASTA_PUB = `f11pub-${SUFIXO}`;
const PASTA_PRIV = `f11priv-${SUFIXO}`;
// O par do outro ramo. Estas pastas NÃO existem no disco: elas só vivem dentro do SQLite,
// que é o que garante que a bateria de paridade exercita mesmo a primeira metade do
// controlador, e não o fallback com outro nome.
const PASTA_SQL_PUB = `f11sqlpub-${SUFIXO}`;
const PASTA_SQL_PRIV = `f11sqlpriv-${SUFIXO}`;
const CORPO = JSON.stringify({ asset: { version: '1.0' }, root: {} });
const BINARIO = Buffer.alloc(4096, 9);

const URL_PUB = `/api/v1/assets3d/${PASTA_PUB}/tileset.json`;
const URL_PRIV = `/api/v1/assets3d/${PASTA_PRIV}/tileset.json`;
const TILE_PRIV = `/api/v1/assets3d/${PASTA_PRIV}/0/0.b3dm`;
const URL_SQL_PUB = `/api/v1/assets3d/${PASTA_SQL_PUB}/tileset.json`;
const URL_SQL_PRIV = `/api/v1/assets3d/${PASTA_SQL_PRIV}/tileset.json`;
const TILE_SQL_PRIV = `/api/v1/assets3d/${PASTA_SQL_PRIV}/0/0.b3dm`;

// O TERCEIRO ramo: um `.3dtiles` POR MODELO, sob o prefixo reservado `m/`. Os arquivos
// vivem em MODELS_3D_DIR e não existem nem em disco sob `assets3d/` nem no store plano,
// que é o que garante que a bateria exercita a camada nova e não uma das duas antigas.
const MOD_PUB = `f11-mpub-${SUFIXO}`;
const MOD_PRIV = `f11-mpriv-${SUFIXO}`;
const URL_MOD_PUB = `/api/v1/assets3d/m/${MOD_PUB}/Data/c00.glb`;
const URL_MOD_PRIV = `/api/v1/assets3d/m/${MOD_PRIV}/Data/c00.glb`;
const TILE_MOD_PRIV = `/api/v1/assets3d/m/${MOD_PRIV}/Data/c01.glb`;
const DOC_MOD_PUB = `/api/v1/assets3d/m/${MOD_PUB}/tileset.json`;
const DOC_MOD_PRIV = `/api/v1/assets3d/m/${MOD_PRIV}/tileset.json`;

const CACHE_PRIVADO = 'private, max-age=31536000, immutable';
const CACHE_PUBLICO = 'public, max-age=31536000, immutable';

// Os dois ramos do controlador, com fixtures equivalentes, para a mesma bateria de acesso
// rodar duas vezes. O `tileset.json` é a raiz da árvore (é ele que a linha de catálogo
// endereça) e `0/0.b3dm` é um filho dela, que é o que o Cesium busca aos milhares.
const RAMOS = [
  { nome: 'filesystem', publico: URL_PUB, privado: URL_PRIV, filho: TILE_PRIV },
  { nome: 'SQLite', publico: URL_SQL_PUB, privado: URL_SQL_PRIV, filho: TILE_SQL_PRIV },
  // No ramo por MODELO a bateria aponta para TILES, e não para o `tileset.json`: só o tile
  // tem o mesmo regime imutável dos outros dois ramos, porque o documento de um modelo é
  // revalidável de propósito (uma reimportação troca a árvore inteira). O documento tem
  // casos próprios, logo abaixo da bateria, e é lá que o regime dele é cobrado.
  { nome: 'modelo .3dtiles', publico: URL_MOD_PUB, privado: URL_MOD_PRIV, filho: TILE_MOD_PRIV },
];

/** Escreve um `.3dtiles` mínimo, com dois tiles e o documento da raiz. */
function escreverModelo3dtiles(id) {
  const caminho = resolveDbPath(`${id}.3dtiles`);
  mkdirSync(dirname(caminho), { recursive: true });
  rmSync(caminho, { force: true });
  const db = new Database(caminho);
  db.exec('CREATE TABLE media (key TEXT PRIMARY KEY, content BLOB NOT NULL)');
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  const ins = db.prepare('INSERT INTO media (key, content) VALUES (?, ?)');
  ins.run('tileset.json', Buffer.from(CORPO));
  ins.run('Data/c00.glb', BINARIO);
  ins.run('Data/c01.glb', BINARIO);
  db.close();
}

/**
 * Fecha as conexões (inclusive as do worker pool) e apaga o arquivo do store.
 *
 * A remoção RETENTA, e a retentativa não é superstição: medido, uma rodada que morreu no meio
 * deixou um descritor do worker pool vivo por alguns milissegundos, e o `rmSync` seguinte levou
 * `EPERM` (em Windows não se apaga arquivo com handle aberto). Isso derrubava a rodada SEGUINTE
 * no `before`, longe da causa e sem relação com o assunto do arquivo. Um `after` que não
 * consegue limpar não é motivo para reprovar a suíte; um `before` que não consegue, é, e por
 * isso o chamador decide com `exigir`.
 */
async function limparStoreSqlite({ exigir = true } = {}) {
  await closeStore();
  for (const f of [SQLITE, `${SQLITE}-wal`, `${SQLITE}-shm`, `${SQLITE}-journal`]) {
    for (let tentativa = 0; existsSync(f); tentativa += 1) {
      try {
        rmSync(f, { force: true });
      } catch (err) {
        if (tentativa >= 10) {
          if (exigir) throw err;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  }
}

/** Insere uma linha de catálogo com `access_level` explícito (o fixture não expõe a coluna). */
async function criarTileset(db, id, accessLevel, config) {
  await db.query(
    `INSERT INTO tilesets (id, name, description, config, sort_order, access_level)
     VALUES ($1, $2, $3, $4::jsonb, 0, $5)`,
    [id, `Tileset ${id}`, 'F11', JSON.stringify(config), accessLevel],
  );
}

describe('F11 — os bytes do /assets3d seguem o recurso', () => {
  let app, db, contador;
  let admin, dono, membro, forasteiro, beneficiario, expirado, revogado;
  let tokenAdmin, tokenDono, tokenMembro, tokenForasteiro, tokenBeneficiario;
  let tokenExpirado, tokenRevogado;
  let atlasPublico, atlasPrivadoComEmprestimo, atlasSemEmprestimo, tokenVisitante;
  const idPub = `f11-pub-${SUFIXO}`;
  const idPriv = `f11-priv-${SUFIXO}`;
  const idSqlPub = `f11-sqlpub-${SUFIXO}`;
  const idSqlPriv = `f11-sqlpriv-${SUFIXO}`;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    mkdirSync(join(ROOT, PASTA_PUB), { recursive: true });
    mkdirSync(join(ROOT, PASTA_PRIV, '0'), { recursive: true });
    writeFileSync(join(ROOT, PASTA_PUB, 'tileset.json'), CORPO);
    writeFileSync(join(ROOT, PASTA_PUB, 'model.glb'), BINARIO);
    writeFileSync(join(ROOT, PASTA_PRIV, 'tileset.json'), CORPO);
    writeFileSync(join(ROOT, PASTA_PRIV, '0', '0.b3dm'), BINARIO);

    // O outro ramo, e só ele: nada destas pastas é escrito em disco.
    await limparStoreSqlite();
    const w = openWritable();
    putAsset(w, `${PASTA_SQL_PUB}/tileset.json`, Buffer.from(CORPO), 'application/json');
    putAsset(w, `${PASTA_SQL_PRIV}/tileset.json`, Buffer.from(CORPO), 'application/json');
    putAsset(w, `${PASTA_SQL_PRIV}/0/0.b3dm`, BINARIO, 'application/octet-stream');
    w.close();

    // O TERCEIRO ramo: dois modelos, cada um num `.3dtiles` próprio, com a linha de
    // catálogo apontando para o `tileset.json` deles (é dela que o índice de regime deriva
    // o prefixo, e é por isso que o gate alcança os tiles sem nenhuma linha por tile).
    escreverModelo3dtiles(MOD_PUB);
    escreverModelo3dtiles(MOD_PRIV);

    await criarTileset(db, idPub, 'public', { url: URL_PUB });
    await criarTileset(db, idPriv, 'private', { url: URL_PRIV });
    await criarTileset(db, idSqlPub, 'public', { url: URL_SQL_PUB });
    await criarTileset(db, idSqlPriv, 'private', { url: URL_SQL_PRIV });
    await criarTileset(db, MOD_PUB, 'public', { url: DOC_MOD_PUB, forma3d: 'tiles3d' });
    await criarTileset(db, MOD_PRIV, 'private', { url: DOC_MOD_PRIV, forma3d: 'tiles3d' });
    for (const id of [MOD_PUB, MOD_PRIV]) {
      await db.query(
        `INSERT INTO a3d.models (model_id, db_filename, build_token, tile_count, total_bytes)
         VALUES ($1, $2, 'tokf11aa', 2, 8192)`,
        [id, `${id}.3dtiles`],
      );
    }

    admin = await createAdminUser(db);
    dono = await createUser(db);
    membro = await createUser(db);
    forasteiro = await createUser(db);
    // `beneficiario` e `forasteiro` são gêmeos: mesma fábrica, mesmo papel `user`, nenhum
    // atlas, nenhum escopo de produção. A ÚNICA diferença entre os dois, no banco inteiro,
    // é a linha de concessão inserida mais abaixo. É o que faz o par valer.
    beneficiario = await createUser(db);
    // Os dois gêmeos do RELÓGIO: mesma fábrica, mesma linha de concessão, e a única diferença
    // é o prazo (um venceu ontem) e a revogação. Eles existem para provar que a decisão sai de
    // `fn_can_see_resource` com os filtros dela, e não de uma segunda regra escrita em JS que
    // olharia só a existência da linha.
    expirado = await createUser(db);
    revogado = await createUser(db);
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);
    tokenBeneficiario = await loginUser(app, beneficiario.username, beneficiario.password);
    tokenExpirado = await loginUser(app, expirado.username, expirado.password);
    tokenRevogado = await loginUser(app, revogado.username, revogado.password);

    atlasPublico = await createAtlas(db, dono.id);
    atlasPrivadoComEmprestimo = await createAtlas(db, dono.id);
    // O atlas que o `membro` POSSUI e que não empresta nada. Ele é o negativo do par de
    // empréstimo em que o chamador ALCANÇA o atlas: sem ele, todo 404 de `?atlasId=` deste
    // arquivo poderia ser explicado por "o chamador não alcança aquele atlas", e a segunda
    // pergunta do gate (o atlas empresta ESTE recurso?) passaria sem nunca ter sido feita.
    atlasSemEmprestimo = await createAtlas(db, membro.id);
    await createShare(db, atlasPrivadoComEmprestimo.id, membro.id, 'read', dono.id);
    const link = await makeAtlasPublic(db, atlasPublico.id);
    tokenVisitante = await getPublicToken(app, link);

    // D4: o empréstimo vive enquanto o DONO do atlas vir o recurso. Sem esta concessão o
    // braço de empréstimo nasce morto, e todo caso de `?atlasId=` passaria como 404 pela
    // razão errada — cobertura vazia com cara de teste negativo.
    //
    // Ela é também o POSITIVO do par de concessão: `dono` não é administrador, não produz
    // nada e não tem papel global de dado, então tudo o que ele traz é esta linha.
    // UM POR RAMO, e a lista tem de acompanhar `RAMOS`: um ramo cujo recurso privado não
    // ganhe concessão nem empréstimo aqui reprova os dois casos positivos da bateria, e o
    // diagnóstico aponta para o produto quando o buraco é da fixture (medido).
    for (const resourceId of [idPriv, idSqlPriv, MOD_PRIV]) {
      for (const grantee of [dono.id, beneficiario.id]) {
        await db.query(
          `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
           VALUES ('tileset', $1, $2, 'view_share', $3)`,
          [resourceId, grantee, admin.id],
        );
      }
      for (const atlasId of [atlasPublico.id, atlasPrivadoComEmprestimo.id]) {
        await db.query(
          `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
           VALUES ($1, 'tileset', $2, $3)`,
          [atlasId, resourceId, dono.id],
        );
      }
    }

    // A concessão VENCIDA e a REVOGADA, sobre o mesmo recurso do beneficiário vivo. O
    // `created_at` recua junto com o `expires_at` porque `resource_grants_expires_at_check`
    // ancora o prazo no nascimento da concessão (`expires_at > created_at`), não no relógio:
    // uma linha que já nasce morta é recusada pelo banco.
    await db.query(
      `INSERT INTO resource_grants
         (resource_type, resource_id, grantee_id, grant_level, granted_by, created_at, expires_at)
       VALUES ('tileset', $1, $2, 'view_share', $3, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day')`,
      [idPriv, expirado.id, admin.id],
    );
    await db.query(
      `INSERT INTO resource_grants
         (resource_type, resource_id, grantee_id, grant_level, granted_by, revoked_at)
       VALUES ('tileset', $1, $2, 'view_share', $3, NOW())`,
      [idPriv, revogado.id, admin.id],
    );

    // As linhas entraram por SQL direto, que é um caminho de escrita que nenhum serviço vê.
    invalidateAppConfigCache();
  });

  after(async () => {
    if (contador) contador.restore();
    for (const p of [PASTA_PUB, PASTA_PRIV]) {
      if (existsSync(join(ROOT, p))) rmSync(join(ROOT, p), { recursive: true, force: true });
    }
    await limparStoreSqlite({ exigir: false });
    // AS LINHAS DE CATÁLOGO SAEM, e isto não é higiene opcional. A suíte compartilha UM
    // banco entre arquivos, e `resource-access-listagem-crua.test.js` afirma que a lista do
    // administrador excede a do usuário comum em EXATAMENTE uma linha. Dois tilesets
    // privados deixados para trás transformam aquele teste num vermelho que não tem nada a
    // ver com o assunto dele — foi o que aconteceu na primeira rodada completa.
    // Os arquivos do terceiro ramo saem com a janela de quarentena: no Windows não se
    // apaga arquivo com handle aberto, e o pool de leitura tem um por modelo servido.
    for (const id of [MOD_PUB, MOD_PRIV]) {
      const caminho = resolveDbPath(`${id}.3dtiles`);
      try {
        await blobPool.withEvicted(caminho, () => rmSync(caminho, { force: true }));
      } catch {
        // Um `after` que não consegue limpar não é motivo para reprovar a suíte.
      }
    }
    resetOpenModels();
    await db.query("DELETE FROM atlas_resources WHERE resource_id LIKE 'f11-%'");
    await db.query("DELETE FROM resource_grants WHERE resource_id LIKE 'f11-%'");
    await db.query("DELETE FROM a3d.models WHERE model_id LIKE 'f11-%'");
    await db.query("DELETE FROM tilesets WHERE id LIKE 'f11-%'");
    invalidateAppConfigCache();
    await teardownTestEnv(db);
  });

  // --- (a) o público não regride ------------------------------------------------

  it('modelo PÚBLICO: 200 sem credencial, `public, immutable`, ETag e Accept-Ranges', async () => {
    const res = await supertest(app).get(URL_PUB).expect(200);
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.ok(res.headers.etag, 'o ETag continua saindo');
    assert.ok(
      !/Authorization|Cookie/i.test(res.headers.vary ?? ''),
      'resposta pública não pode variar por credencial (o Vary de CORS/compressão é de outro eixo)',
    );
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });

  it('modelo PÚBLICO: o 304 e o Range continuam funcionando, e continuam públicos', async () => {
    const primeiro = await supertest(app).get(URL_PUB).expect(200);
    const trezentos = await supertest(app)
      .get(URL_PUB).set('If-None-Match', primeiro.headers.etag).expect(304);
    assert.equal(trezentos.headers['cache-control'], 'public, max-age=31536000, immutable');

    const parcial = await supertest(app)
      .get(`/api/v1/assets3d/${PASTA_PUB}/model.glb`).set('Range', 'bytes=0-9').expect(206);
    assert.match(parcial.headers['content-range'], /^bytes 0-9\/\d+$/);
    assert.equal(parcial.headers['content-length'], '10');

    await supertest(app)
      .get(`/api/v1/assets3d/${PASTA_PUB}/model.glb`).set('Range', 'bytes=999999-').expect(416);
  });

  it('caminho que NENHUMA linha de catálogo reivindica continua público', async () => {
    // O que preserva o comportamento de hoje para tudo o que o catálogo não descreve: um
    // arquivo solto sob ASSETS_3D_DIR não passa a exigir credencial nenhuma.
    const solto = `avulso-${SUFIXO}`;
    mkdirSync(join(ROOT, solto), { recursive: true });
    writeFileSync(join(ROOT, solto, 'x.json'), CORPO);
    try {
      const res = await supertest(app).get(`/api/v1/assets3d/${solto}/x.json`).expect(200);
      assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    } finally {
      rmSync(join(ROOT, solto), { recursive: true, force: true });
    }
  });

  // --- (b) o privado nega, e nega com 404 ---------------------------------------

  it('modelo PRIVADO: anônimo leva 404, nunca 401 nem 403', async () => {
    for (const alvo of [URL_PRIV, TILE_PRIV]) {
      const res = await supertest(app).get(alvo);
      assert.equal(res.status, 404, `${alvo} devia ser indistinguível de inexistente`);
    }
    // E o 304 também nega: responder 304 a quem não pode ver confirma existência E ETag.
    const comEtag = await supertest(app).get(URL_PRIV).set('If-None-Match', '"qualquer"');
    assert.equal(comEtag.status, 404);
  });

  it('modelo PRIVADO: usuário logado SEM concessão nenhuma leva 404', async () => {
    const res = await supertest(app).get(URL_PRIV).set('Authorization', `Bearer ${tokenForasteiro}`);
    assert.equal(res.status, 404);
  });

  it('modelo PRIVADO: o BENEFICIÁRIO DA CONCESSÃO recebe 200 `private`, sem escopo de atlas', async () => {
    // O positivo do par que o caso acima abre, e o mais importante do arquivo:
    // `beneficiario` e `forasteiro` são dois usuários comuns, criados pela mesma fábrica,
    // pedindo o MESMO caminho sem `?atlasId=` nenhum. A única diferença entre eles em todo o
    // banco é uma linha em `resource_grants`, então este par isola a concessão de tudo o
    // mais (papel global, produção, empréstimo) e é o que impede que os 404 daqui sejam
    // verdes vazios de um gate que negasse a todos.
    const res = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenBeneficiario}`).expect(200);
    assert.equal(res.headers['cache-control'], CACHE_PRIVADO);
    assert.match(res.headers.vary, /Authorization/);
    assert.match(res.headers.vary, /Cookie/);
    assert.ok(res.headers.etag, 'o ETag continua saindo para quem pode ver');

    // E o filho do tileset, que é o que o Cesium busca aos milhares: a concessão vale para
    // a ÁRVORE, não só para o `tileset.json` que a linha de catálogo endereça.
    const filho = await supertest(app)
      .get(TILE_PRIV).set('Authorization', `Bearer ${tokenBeneficiario}`).expect(200);
    assert.equal(filho.headers['cache-control'], CACHE_PRIVADO);
  });

  it('a concessão VENCIDA e a REVOGADA não alcançam os bytes; a viva alcança', async () => {
    // O trio que prova QUEM decide. Os três chamadores têm linha em `resource_grants` sobre o
    // MESMO recurso, mesma fábrica de usuário, mesmo nível de concessão: o que os separa é o
    // relógio e o `revoked_at`, os dois filtros que vivem dentro de `fn_can_see_resource`. Uma
    // segunda regra escrita em JS (a que a casa proíbe) olharia a existência da linha e
    // liberaria os três, e este arquivo inteiro continuaria verde sem este caso.
    const vencida = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenExpirado}`);
    assert.equal(vencida.status, 404, 'concessão de ontem não vale hoje');

    const revogada = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenRevogado}`);
    assert.equal(revogada.status, 404, 'concessão revogada não vale');

    // O positivo do mesmo par, e ele é o que impede que os dois 404 acima sejam verdes vazios
    // de um gate que negasse a todo usuário comum.
    const viva = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenBeneficiario}`).expect(200);
    assert.equal(viva.headers['cache-control'], CACHE_PRIVADO);
  });

  it('HEAD segue o mesmo regime do GET, e não vira uma segunda porta', async () => {
    // A rota é `router.get`, e o Express atende HEAD pelo mesmo manipulador. Sem o gate ANTES
    // do controlador, um HEAD devolveria 200 com ETag, Content-Length e Content-Type do modelo
    // privado sem entregar byte nenhum, que é confirmação de existência com outro nome.
    const autorizado = await supertest(app)
      .head(URL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    assert.equal(autorizado.headers['cache-control'], CACHE_PRIVADO);
    assert.ok(autorizado.headers.etag, 'para quem pode ver, o HEAD continua servindo de sonda');

    const anonimo = await supertest(app).head(URL_PRIV);
    assert.equal(anonimo.status, 404);
    // A negação TEM um ETag, e ele é do envelope de erro que o Express serializa, igual em toda
    // 404 da casa. O que não pode sair é o ETag DO ASSET, que é a impressão digital do arquivo
    // privado; compará-lo com o do autorizado é o que separa as duas coisas.
    assert.notEqual(anonimo.headers.etag, autorizado.headers.etag, 'o ETag do asset vazou na negação');
  });

  it('modelo PRIVADO: quem tem papel global de dado recebe 200 `private` com Vary', async () => {
    const res = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    assert.equal(res.headers['cache-control'], 'private, max-age=31536000, immutable');
    assert.match(res.headers.vary, /Authorization/);
    assert.match(res.headers.vary, /Cookie/);
    assert.match(res.headers.vary, /Origin/, 'o Vary do CORS não pode ser sobrescrito, só somado');
    assert.ok(res.headers.etag);

    // O 304 do mesmo caminho continua privado: um `public` aqui autorizaria um cache
    // compartilhado a repor a revalidação de um autorizado para o próximo chamador.
    const trezentos = await supertest(app)
      .get(URL_PRIV)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('If-None-Match', res.headers.etag)
      .expect(304);
    assert.equal(trezentos.headers['cache-control'], 'private, max-age=31536000, immutable');
    assert.match(trezentos.headers.vary, /Authorization/);
    assert.match(trezentos.headers.vary, /Cookie/);
  });

  it('modelo PRIVADO: o Range do autorizado continua funcionando', async () => {
    const parcial = await supertest(app)
      .get(TILE_PRIV)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('Range', 'bytes=0-9')
      .expect(206);
    assert.match(parcial.headers['content-range'], /^bytes 0-9\/\d+$/);
    assert.equal(parcial.headers['cache-control'], 'private, max-age=31536000, immutable');
  });

  // --- (c) o empréstimo, e o UUID que não é senha -------------------------------

  it('membro do atlas que empresta: 404 SEM o escopo, 200 COM ele', async () => {
    // O par completo. Sem `?atlasId=` o braço de empréstimo do predicado nem é consultado
    // (ele exige `p_atlas_id IS NOT NULL`), então o membro é um usuário sem concessão.
    const sem = await supertest(app).get(URL_PRIV).set('Authorization', `Bearer ${tokenMembro}`);
    assert.equal(sem.status, 404);

    const com = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenMembro}`)
      .expect(200);
    assert.equal(com.headers['cache-control'], 'private, max-age=31536000, immutable');
  });

  it('alcançar o atlas não basta: o atlas precisa EMPRESTAR o recurso', async () => {
    // A segunda pergunta do gate, isolada. Nos outros casos negativos o chamador não alcança o
    // atlas que ele nomeia, então um gate que só perguntasse "este atlas empresta?" passaria
    // por eles. Aqui o `membro` é DONO do atlas que aponta (alcança-o em `owner`, o nível mais
    // alto), e mesmo assim não leva os bytes, porque aquele atlas não tomou o recurso
    // emprestado. O par fecha com o mesmo chamador, o mesmo caminho e o outro atlas.
    const semEmprestimo = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasSemEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenMembro}`);
    assert.equal(semEmprestimo.status, 404, 'ser dono de um atlas não empresta o acervo alheio');

    const comEmprestimo = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenMembro}`).expect(200);
    assert.equal(comEmprestimo.headers['cache-control'], CACHE_PRIVADO);
  });

  it('visitante ANÔNIMO de atlas `is_public` herda o empréstimo (R4)', async () => {
    const res = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPublico.id}`)
      .expect(200);
    assert.equal(res.headers['cache-control'], 'private, max-age=31536000, immutable');
    assert.match(res.headers.vary, /Authorization/);
    assert.match(res.headers.vary, /Cookie/);
    assert.match(res.headers.vary, /Origin/, 'o Vary do CORS não pode ser sobrescrito, só somado');

    // E o filho do tileset, que é o que o Cesium realmente busca aos milhares.
    await supertest(app).get(`${TILE_PRIV}?atlasId=${atlasPublico.id}`).expect(200);
  });

  it('o UUID do atlas NÃO é senha: anônimo apontando para atlas não público leva 404', async () => {
    const res = await supertest(app).get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}`);
    assert.equal(res.status, 404, 'saber o UUID de um atlas alheio não pode entregar o empréstimo');

    const logadoAlheio = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenForasteiro}`);
    assert.equal(logadoAlheio.status, 404, 'nem estar logado basta: é preciso alcançar o atlas');
  });

  it('visitante de LINK PÚBLICO fica confinado ao atlas do próprio token', async () => {
    // O token de link público é assinado para UM atlas. Com o atlas dele, herda o
    // empréstimo; apontando para outro, não — é a confinação que vive dentro de
    // `requireAtlasPermission` e que este caminho reusa em vez de reescrever.
    await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPublico.id}`)
      .set('Authorization', `Bearer ${tokenVisitante}`)
      .expect(200);

    const outro = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenVisitante}`);
    assert.equal(outro.status, 404);

    // E a terceira perna do mesmo trio: SEM escopo de atlas nenhum, o visitante não alcança
    // nada. O empréstimo é o único título que ele tem, e um título que ele não invoca não
    // vale. Sem esta linha, "o visitante alcança" seria compatível com um gate que
    // liberasse para todo portador de token de link, em qualquer caminho privado do acervo.
    const semEscopo = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenVisitante}`);
    assert.equal(semEscopo.status, 404);
  });

  it('`atlasId` que não é UUID não derruba a requisição nem abre nada', async () => {
    // A barreira de tipo de `atlasScopeId`: mandar lixo para um cast `::uuid` levantaria
    // 22P02, que a borda traduziria num 400 sem relação aparente com o assunto.
    for (const lixo of ['nao-e-uuid', '', "' OR 1=1--"]) {
      const res = await supertest(app).get(`${URL_PRIV}?atlasId=${encodeURIComponent(lixo)}`);
      assert.equal(res.status, 404, `atlasId inválido (${lixo}) devia degradar para "sem escopo"`);
    }

    // E a forma que não é lixo, é ARRAY: repetir o parâmetro faz o Express entregar
    // `['uuid-a', 'uuid-b']`, e um `atlasId` que não é string não pode virar escopo por
    // coerção. Nem mesmo repetindo o atlas que de fato empresta.
    const repetido = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}&atlasId=${atlasSemEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenMembro}`);
    assert.equal(repetido.status, 404, 'atlasId repetido devia degradar para "sem escopo"');
  });

  // --- (c2) a soletração do caminho ---------------------------------------------

  it('a SOLETRAÇÃO do caminho não contorna o gate: caixa e barra invertida', async () => {
    // REGRESSÃO MEDIDA, e o furo estava aberto quando esta fase se declarou entregue. O índice
    // de regime normalizava com `path.posix` e comparava string CRUA; o ramo de filesystem
    // resolve com `path.resolve`, cuja semântica é a do HOST. Em Windows e macOS as duas
    // soletrações abaixo endereçam o MESMO arquivo, então o índice não casava linha nenhuma, o
    // regime saía PÚBLICO e o anônimo recebia 200 com o corpo do tileset privado e
    // `public, max-age=31536000, immutable` — um ano de cache compartilhado sobre o modelo
    // fechado. É a mesma classe do defeito do MVT que este branch já pagou: o filtro valia
    // para uma forma do endereço e não para a outra.
    //
    // O QUE ESTE CASO AFIRMA, com precisão, é "os bytes NÃO saem", e não "o servidor nega":
    // num filesystem sensível a caixa a variante simplesmente não existe, e ali o 404 vem da
    // ausência. A propriedade vale nos dois mundos, e é a única que vale nos dois, porque um
    // caso cujo desfecho muda com o host não afirma a mesma coisa em cada máquina.
    //
    // O POSITIVO VEM PRIMEIRO porque ele é o INSUMO do negativo: é dele que saem o corpo e o
    // ETag com que as variantes são comparadas, e sem essa âncora "a variante devolveu 404"
    // passaria idêntico se a fixtura tivesse sumido do disco.
    const canonico = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    assert.equal(canonico.headers['cache-control'], CACHE_PRIVADO);
    assert.equal(canonico.text, CORPO, 'é este o corpo que as variantes não podem entregar');

    const variantes = [
      `/api/v1/assets3d/${PASTA_PRIV.toUpperCase()}/tileset.json`,
      `/api/v1/assets3d/${PASTA_PRIV}/TILESET.JSON`,
      `/api/v1/assets3d/${PASTA_PRIV}%5ctileset.json`,
      `/api/v1/assets3d/${PASTA_PRIV.toUpperCase()}%5CTILESET.JSON`,
      `/api/v1/assets3d/${PASTA_SQL_PRIV.toUpperCase()}/tileset.json`,
    ];
    for (const variante of variantes) {
      const res = await supertest(app).get(variante);
      assert.equal(res.status, 404, `a variante ${variante} entregou ${res.status} ao anônimo`);
      assert.notEqual(res.text, CORPO, `a variante ${variante} entregou o corpo do modelo privado`);
      // O ETag que sai numa 404 é o do envelope de erro, comum a toda negação da casa. O que
      // não pode aparecer é o do ASSET, que identifica o arquivo escondido.
      assert.notEqual(res.headers.etag, canonico.headers.etag, `a variante ${variante} vazou o ETag`);
    }

    // A MESMA variante invocando o empréstimo é outro caso, e a primeira versão deste teste
    // errou nele: o anônimo de um atlas `is_public` que empresta o tileset TEM direito aos
    // bytes (R4), então um 200 ali é a resposta certa, e exigir 404 seria pinar um bug. O que
    // vale para os dois desfechos é o REGIME: servida ou não, a variante nunca pode voltar
    // publicamente cacheável, que é a metade cara do defeito (um ano de cache compartilhado
    // sobre um modelo fechado).
    for (const variante of variantes) {
      const res = await supertest(app).get(`${variante}?atlasId=${atlasPublico.id}`);
      assert.notEqual(
        res.headers['cache-control'], CACHE_PUBLICO,
        `a variante ${variante} voltou publicamente cacheável`,
      );
    }

    // E o PÚBLICO não foi fechado junto: dobrar a soletração só pode fazer MAIS caminhos
    // casarem uma linha de catálogo, então falta mostrar que a linha casada continua sendo a
    // pública. As variantes daqui são as que TODO host resolve igual (`./` e `//`), e a escolha
    // é deliberada: uma variante de CAIXA é servida no Windows e ausente no Linux, e um caso
    // cujo resultado depende do host afirma coisas diferentes em cada máquina, que é o
    // contrário do que um teste faz.
    for (const variante of [
      `/api/v1/assets3d/${PASTA_PUB}/./tileset.json`,
      `/api/v1/assets3d/${PASTA_PUB}//tileset.json`,
    ]) {
      const res = await supertest(app).get(variante).expect(200);
      assert.equal(res.headers['cache-control'], CACHE_PUBLICO, `a variante ${variante} deixou de ser pública`);
    }
  });

  // --- (d) a invalidação ---------------------------------------------------------

  it('a marca troca EM TEMPO REAL nos dois sentidos, sem restart', async () => {
    // O par que prova o MECANISMO, e não o estado. Um sentido só (público -> privado) passa
    // idêntico num gate que, uma vez fechado, ficasse fechado para sempre: seria um índice
    // que se invalida e nunca se reconstrói, ou um memo de negação que grudou. O caminho de
    // volta é o que separa "a invalidação funciona" de "alguma coisa fechou".
    //
    // Repare que a volta cobra DUAS estruturas ao mesmo tempo: o índice de regime (que
    // decide se o caminho é privado) e o memo de decisão (que guardou um `false` para o
    // anônimo). Se `invalidateAppConfigCache()` derrubasse só o primeiro, o anônimo
    // continuaria negado por até 30 s e este caso ficaria vermelho.
    const id = `f11-flip-${SUFIXO}`;
    const pasta = `f11flip-${SUFIXO}`;
    mkdirSync(join(ROOT, pasta), { recursive: true });
    writeFileSync(join(ROOT, pasta, 'tileset.json'), CORPO);
    const url = `/api/v1/assets3d/${pasta}/tileset.json`;
    await criarTileset(db, id, 'public', { url });
    invalidateAppConfigCache();

    const svc = await import('../../src/modules/resource-access/resource-access.service.js');
    const marcar = (accessLevel) => svc.setResourceVisibility({
      type: 'tileset', resourceId: id, accessLevel, actor: { id: admin.id }, req: null,
    });

    try {
      const antes = await supertest(app).get(url).expect(200);
      assert.equal(antes.headers['cache-control'], CACHE_PUBLICO);

      await marcar('private');

      const fechado = await supertest(app).get(url);
      assert.equal(fechado.status, 404, 'o índice tem de ter sido reconstruído pela própria escrita');
      const autorizado = await supertest(app)
        .get(url).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
      assert.equal(autorizado.headers['cache-control'], CACHE_PRIVADO);

      await marcar('public');

      const reaberto = await supertest(app).get(url).expect(200);
      assert.equal(
        reaberto.headers['cache-control'], CACHE_PUBLICO,
        'reaberto, o recurso volta ao regime público inteiro, não só ao status 200',
      );
      assert.ok(
        !/Authorization|Cookie/i.test(reaberto.headers.vary ?? ''),
        'e para de variar por credencial: o cache compartilhado volta a poder guardá-lo',
      );
    } finally {
      rmSync(join(ROOT, pasta), { recursive: true, force: true });
    }
  });

  // --- (e) cache: nada privado é público, e nenhum 304 atravessa escopo ---------

  it('NENHUMA resposta de asset privado é publicamente cacheável', async () => {
    // `private` e não `no-store` é decisão medida (o navegador PRECISA guardar os tiles do
    // modelo para o streaming por LOD ser viável), então o que sobra para verificar é a
    // outra metade: nenhuma das formas de resposta pode autorizar um cache COMPARTILHADO a
    // repor a resposta de um autorizado para o próximo chamador. As cinco formas que a rota
    // sabe produzir estão aqui, e é o conjunto delas que importa: `Cache-Control` é escrito
    // num ponto só, mas 206 e 304 saem por ramos diferentes do controlador em cada metade.
    const duzentos = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const trezentos = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`)
      .set('If-None-Match', duzentos.headers.etag).expect(304);
    const parcial = await supertest(app)
      .get(TILE_PRIV).set('Authorization', `Bearer ${tokenAdmin}`)
      .set('Range', 'bytes=0-9').expect(206);
    const emprestado = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPublico.id}`).expect(200);
    const doSqlite = await supertest(app)
      .get(URL_SQL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);

    for (const res of [duzentos, trezentos, parcial, emprestado, doSqlite]) {
      const cc = res.headers['cache-control'];
      assert.equal(cc, CACHE_PRIVADO, `resposta ${res.status} saiu com "${cc}"`);
      assert.doesNotMatch(cc, /(^|[\s,])public([\s,]|$)/, 'a diretiva `public` não pode aparecer');
      assert.doesNotMatch(cc, /s-maxage/, '`s-maxage` fala com o cache compartilhado');
      assert.match(res.headers.vary, /Authorization/);
      assert.match(res.headers.vary, /Cookie/);
    }

    // E a negação também não pode ser guardada como se fosse a resposta pública do caminho:
    // um `public, immutable` num 404 congelaria a negação por um ano no proxy, inclusive
    // para quem passasse a ter direito depois.
    const negado = await supertest(app).get(URL_PRIV);
    assert.equal(negado.status, 404);
    assert.ok(
      !/public/i.test(negado.headers['cache-control'] ?? ''),
      `a negação saiu com "${negado.headers['cache-control']}"`,
    );
  });

  it('nenhum 304 atravessa escopo: ETag alheio revalida em 404, nunca em 304', async () => {
    // O 304 é o vazamento silencioso do cache condicional: ele não devolve byte nenhum, mas
    // confirma que o caminho existe E que aquele ETag é o dele, que é exatamente o que a
    // privacidade do modelo esconde. Por isso o gate corre ANTES do 304 no controlador, e é
    // esta a propriedade que fixa aquela ordem.
    const autorizado = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const etag = autorizado.headers.etag;
    assert.ok(etag, 'o ETag do autorizado é o insumo do teste');

    const anonimo = await supertest(app).get(URL_PRIV).set('If-None-Match', etag);
    assert.equal(anonimo.status, 404, 'um 304 aqui confirmaria existência e ETag ao anônimo');

    const logadoSemTitulo = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenForasteiro}`).set('If-None-Match', etag);
    assert.equal(logadoSemTitulo.status, 404);

    // O mesmo chamador, o mesmo ETag, e a única diferença é o escopo: com o empréstimo
    // invocado, revalida em 304; sem ele, o ETag não vale mais nada. Se a revalidação
    // pulasse o gate, esta segunda chamada devolveria 304 e o membro manteria o modelo
    // fresco para sempre a partir do dia em que o atlas o emprestou.
    const comEscopo = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenMembro}`).expect(200);
    const revalidaComEscopo = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenMembro}`)
      .set('If-None-Match', comEscopo.headers.etag).expect(304);
    assert.equal(revalidaComEscopo.headers['cache-control'], CACHE_PRIVADO);

    const revalidaSemEscopo = await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenMembro}`)
      .set('If-None-Match', comEscopo.headers.etag);
    assert.equal(
      revalidaSemEscopo.status, 404,
      'o ETag ganho pelo empréstimo não sobrevive a pedi-lo fora do empréstimo',
    );

    const visitanteEmOutroAtlas = await supertest(app)
      .get(`${URL_PRIV}?atlasId=${atlasPrivadoComEmprestimo.id}`)
      .set('Authorization', `Bearer ${tokenVisitante}`).set('If-None-Match', etag);
    assert.equal(visitanteEmOutroAtlas.status, 404);
  });

  // --- (f) os dois ramos de armazenamento --------------------------------------

  it('a bateria de paridade mede DOIS ramos, e não o mesmo ramo duas vezes', async () => {
    // O instrumento antes da medida. O controlador tenta o SQLite e cai no filesystem, e as
    // duas metades têm CÓPIAS independentes de ETag/304/Range: se as fixturas do "ramo
    // SQLite" também existissem em disco, ou se a escrita no store falhasse calada, a
    // bateria abaixo exercitaria o mesmo ramo duas vezes e passaria verde provando metade.
    // Cada 404 negativo do ramo SQLite depende de o caminho EXISTIR no store: sem isto, um
    // `putAsset` que falhasse calado daria 404 por inexistência e a negação passaria verde
    // sem ter negado coisa nenhuma. Por isso a raiz E o filho da árvore são conferidos.
    assert.ok(getAssetMeta(`${PASTA_SQL_PRIV}/tileset.json`), 'o privado do SQLite está no store');
    assert.ok(getAssetMeta(`${PASTA_SQL_PRIV}/0/0.b3dm`), 'e o filho dele também');
    assert.ok(getAssetMeta(`${PASTA_SQL_PUB}/tileset.json`), 'o público do SQLite está no store');
    assert.equal(getAssetMeta(`${PASTA_PRIV}/tileset.json`), null, 'o privado do FS NÃO está no store');
    assert.equal(existsSync(join(ROOT, PASTA_SQL_PRIV)), false, 'e o do SQLite não está em disco');
    assert.equal(existsSync(join(ROOT, PASTA_PRIV, 'tileset.json')), true);

    // E os dois ramos entregam o mesmo corpo, que é o que torna a comparação de regime
    // uma comparação e não uma coincidência.
    const fs = await supertest(app).get(URL_PUB).expect(200);
    const sql = await supertest(app).get(URL_SQL_PUB).expect(200);
    assert.deepEqual(JSON.parse(fs.text), JSON.parse(sql.text));
  });

  for (const ramo of RAMOS) {
    describe(`paridade de acesso — ramo ${ramo.nome}`, () => {
      it('público: 200 sem credencial, `public, immutable`, sem Vary de credencial', async () => {
        const res = await supertest(app).get(ramo.publico).expect(200);
        assert.equal(res.headers['cache-control'], CACHE_PUBLICO);
        assert.ok(!/Authorization|Cookie/i.test(res.headers.vary ?? ''));
        assert.ok(res.headers.etag);
      });

      it('privado: anônimo 404, e logado sem título nenhum 404', async () => {
        const anonimo = await supertest(app).get(ramo.privado);
        assert.equal(anonimo.status, 404);
        const filho = await supertest(app).get(ramo.filho);
        assert.equal(filho.status, 404, 'o filho da árvore nega igual à raiz');
        const forasteiroLogado = await supertest(app)
          .get(ramo.privado).set('Authorization', `Bearer ${tokenForasteiro}`);
        assert.equal(forasteiroLogado.status, 404);
      });

      it('privado: o beneficiário da concessão recebe 200 `private`', async () => {
        const res = await supertest(app)
          .get(ramo.privado).set('Authorization', `Bearer ${tokenBeneficiario}`).expect(200);
        assert.equal(res.headers['cache-control'], CACHE_PRIVADO);
        assert.match(res.headers.vary, /Authorization/);
        assert.match(res.headers.vary, /Cookie/);
      });

      it('privado: o empréstimo por atlas alcança os bytes, e só dentro do escopo', async () => {
        const semEscopo = await supertest(app)
          .get(ramo.privado).set('Authorization', `Bearer ${tokenMembro}`);
        assert.equal(semEscopo.status, 404);

        const comEscopo = await supertest(app)
          .get(`${ramo.privado}?atlasId=${atlasPrivadoComEmprestimo.id}`)
          .set('Authorization', `Bearer ${tokenMembro}`).expect(200);
        assert.equal(comEscopo.headers['cache-control'], CACHE_PRIVADO);

        const anonimoEmAtlasPublico = await supertest(app)
          .get(`${ramo.filho}?atlasId=${atlasPublico.id}`).expect(200);
        assert.equal(anonimoEmAtlasPublico.headers['cache-control'], CACHE_PRIVADO);

        const anonimoEmAtlasAlheio = await supertest(app)
          .get(`${ramo.privado}?atlasId=${atlasPrivadoComEmprestimo.id}`);
        assert.equal(anonimoEmAtlasAlheio.status, 404, 'o UUID do atlas não é senha');
      });

      it('privado: 304 e Range do autorizado, e 404 no 304 de quem não pode ver', async () => {
        const res = await supertest(app)
          .get(ramo.privado).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
        const trezentos = await supertest(app)
          .get(ramo.privado).set('Authorization', `Bearer ${tokenAdmin}`)
          .set('If-None-Match', res.headers.etag).expect(304);
        assert.equal(trezentos.headers['cache-control'], CACHE_PRIVADO);

        const parcial = await supertest(app)
          .get(ramo.filho).set('Authorization', `Bearer ${tokenAdmin}`)
          .set('Range', 'bytes=0-9').expect(206);
        assert.match(parcial.headers['content-range'], /^bytes 0-9\/\d+$/);
        assert.equal(parcial.headers['content-length'], '10');
        assert.equal(parcial.headers['cache-control'], CACHE_PRIVADO);

        const negado = await supertest(app)
          .get(ramo.privado).set('If-None-Match', res.headers.etag);
        assert.equal(negado.status, 404);
      });
    });
  }

  // --- (g) nenhuma consulta por requisição --------------------------------------

  // --- (g) o DOCUMENTO de um modelo: o único regime revalidável desta rota ---------

  it('o `tileset.json` de um modelo PÚBLICO sai revalidável, e não imutável', async () => {
    // Uma reimportação troca a árvore inteira; `immutable` prenderia o cliente por um ano
    // a uma geração que morreu. O eixo de acesso continua o do recurso.
    const res = await supertest(app).get(DOC_MOD_PUB).expect(200);
    assert.equal(res.headers['cache-control'], 'public, no-cache');
    assert.ok(res.headers.etag, 'o ETag é o que torna a revalidação barata');
    assert.ok(!/Authorization|Cookie/i.test(res.headers.vary ?? ''));
  });

  it('o `tileset.json` de um modelo PRIVADO segue o mesmo gate dos tiles', async () => {
    await supertest(app).get(DOC_MOD_PRIV).expect(404);

    const autorizado = await supertest(app)
      .get(DOC_MOD_PRIV)
      .set('Authorization', `Bearer ${tokenBeneficiario}`)
      .expect(200);
    assert.equal(autorizado.headers['cache-control'], 'private, no-cache');
    assert.match(autorizado.headers.vary ?? '', /Authorization/i);
    assert.match(autorizado.headers.vary ?? '', /Cookie/i);
  });

  it('NENHUMA consulta ao banco por requisição de asset, público ou privado', async () => {
    // A propriedade que decide se o desenho presta. Medida com o contador de POOL, que
    // conta tudo o que a requisição toca, middleware incluído.
    await supertest(app).get(URL_PUB).expect(200); // aquece o índice
    await supertest(app)
      .get(URL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`).expect(200); // aquece o memo

    contador = installPoolQueryCounter();
    try {
      contador.reset();
      for (let i = 0; i < 20; i += 1) await supertest(app).get(URL_PUB).expect(200);
      assert.equal(
        contador.state.count, 0,
        `20 requisições públicas custaram ${contador.state.count} consultas: ${contador.state.statements.join(' | ')}`,
      );

      contador.reset();
      for (let i = 0; i < 20; i += 1) {
        await supertest(app).get(URL_PRIV).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
      }
      assert.equal(
        contador.state.count, 0,
        `20 requisições privadas do MESMO chamador custaram ${contador.state.count} consultas: ${contador.state.statements.join(' | ')}`,
      );

      // O positivo do par: um chamador NOVO paga a decisão dele uma vez, e uma só. Sem
      // esta metade, "zero consultas" também seria verdade num gate que não consultasse
      // nada nunca — que é precisamente o estado anterior a esta fase.
      contador.reset();
      for (let i = 0; i < 5; i += 1) {
        await supertest(app).get(URL_PRIV).set('Authorization', `Bearer ${tokenDono}`);
      }
      assert.equal(
        contador.state.count, 1,
        `o primeiro acesso de um chamador novo custa UMA consulta, medi ${contador.state.count}`,
      );
    } finally {
      contador.restore();
      contador = null;
    }
  });
});
