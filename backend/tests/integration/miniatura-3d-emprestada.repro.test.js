// Path: tests/integration/miniatura-3d-emprestada.repro.test.js
//
// REGRESSÃO: A MINIATURA DO MODELO 3D EMPRESTADO PELO ATLAS NÃO CARREGAVA PARA O COLEGA, e o
// modelo carregava (relato do dono, 2026-09-22). O defeito era do CLIENTE; este arquivo prende o
// CONTRATO DO SERVIDOR de que o conserto depende, contra a rota real, e documenta por que só o
// carimbo resolve.
//
// O ELO. A miniatura do acervo 3D adotado é um ARQUIVO sob `/api/v1/assets3d`
// (`config.previewThumbnail = '/api/v1/assets3d/<id>.webp'`, gravado por
// `dev/import-catalogo-3d-legado.mjs`, FORA da pasta do modelo), e o índice de regime a indexa como
// CAMPO DE ARQUIVO da linha (`CAMPOS_DE_ARQUIVO`, `src/modules/nomes/assets3d-regime.js`). Linha
// privada, bytes privados, e o gate é o MESMO do `tileset.json` (`gateDeAsset3d`, com
// `recursoPrivadoLiberado`): papel, concessão ou EMPRÉSTIMO, e o empréstimo só entra pelo
// `?atlasId=` da query. O visualizador manda o carimbo no `tileset.json` (`descritorDeAsset`, no
// cliente); o `<img src>` da miniatura saía sem ele. O navegador busca a imagem SEM cabeçalho, e o
// cookie de sessão que vai junto só diz QUEM pede: para quem só tem o empréstimo, isso é um
// usuário sem título nenhum, e a resposta é 404.
//
// O QUE ESTE ARQUIVO COBRA, e cada caso é metade de um par:
//
//   (a) o DONO da concessão vê a miniatura sem escopo (a metade que o relato viu funcionar);
//   (b) o COLEGA, pelo COOKIE (o transporte de um `<img>`), leva 404 SEM o carimbo e 200 COM ele,
//       com o regime `private` e o `Vary` de credencial;
//   (c) miniatura e `tileset.json` respondem IGUAL ao mesmo chamador, com e sem carimbo: o modelo
//       abria só porque o Cesium levava o atlas, e é a assimetria do CLIENTE que o relato viu;
//   (d) o UUID do atlas não é senha: forasteiro logado, anônimo e o dono de um atlas que não
//       empresta levam 404 com o carimbo;
//   (e) a miniatura PÚBLICA continua `public` com e sem carimbo, que é o que torna o carimbo
//       inofensivo para a maioria do catálogo.
//
// O cliente tem repro próprio: `frontend/tests/unit/miniatura-emprestada-carimba-escopo.repro.test.js`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';
import { invalidarAcessoDeAssets3d } from '../../src/modules/nomes/assets3d-acesso.js';
import config from '../../src/config.js';

const SUFIXO = crypto.randomUUID().slice(0, 8);
// A MESMA raiz que o servidor resolve (`assets3d.service.js`), e não uma cópia do valor padrão:
// com banco próprio o setup de teste move o diretório, e a fixture iria parar noutro lugar.
const ROOT = resolve(config.assets3d.dir);

const PASTA_PRIV = `mini-priv-${SUFIXO}`;
const ARQ_MINI_PRIV = `mini-priv-${SUFIXO}.webp`;
const ARQ_MINI_PUB = `mini-pub-${SUFIXO}.webp`;
const ID_PRIV = `mini-priv-${SUFIXO}`;
const ID_PUB = `mini-pub-${SUFIXO}`;

const URL_TILESET = `/api/v1/assets3d/${PASTA_PRIV}/tileset.json`;
const URL_MINI_PRIV = `/api/v1/assets3d/${ARQ_MINI_PRIV}`;
const URL_MINI_PUB = `/api/v1/assets3d/${ARQ_MINI_PUB}`;

const CACHE_PRIVADO = 'private, max-age=31536000, immutable';
const CACHE_PUBLICO = 'public, max-age=31536000, immutable';

// Um cabeçalho RIFF/WEBP de verdade seguido de enchimento: o gate não olha o conteúdo, mas o
// tamanho é o que o caso positivo confere, então os bytes têm de ser estes e não outros.
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(18, 7),
]);
const TILESET = JSON.stringify({ asset: { version: '1.0' }, root: {} });

/** Insere uma linha de catálogo com `access_level` explícito (o fixture não expõe a coluna). */
async function criarTileset(db, id, accessLevel, cfg) {
  await db.query(
    `INSERT INTO tilesets (id, name, description, config, sort_order, access_level)
     VALUES ($1, $2, $3, $4::jsonb, 0, $5)`,
    [id, `Tileset ${id}`, 'miniatura emprestada', JSON.stringify(cfg), accessLevel],
  );
}

/** Um pedido feito como o NAVEGADOR faz um `<img src>`: sem cabeçalho, só o cookie de sessão. */
function comoImg(app, url, token) {
  const pedido = supertest(app).get(url);
  return token ? pedido.set('Cookie', [`token=${token}`]) : pedido;
}

describe('a miniatura do modelo 3D emprestado segue o mesmo gate do modelo', () => {
  let app, db;
  let admin, dono, colega, forasteiro;
  let tokenDono, tokenColega, tokenForasteiro;
  let atlasQueEmpresta, atlasQueNaoEmpresta;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    mkdirSync(join(ROOT, PASTA_PRIV), { recursive: true });
    writeFileSync(join(ROOT, PASTA_PRIV, 'tileset.json'), TILESET);
    // NA RAIZ da árvore, fora da pasta do modelo: é onde o importador do acervo a põe, e é o caso
    // que só a entrada de ARQUIVO do índice alcança (a de pasta cobre só `PASTA_PRIV/`).
    writeFileSync(join(ROOT, ARQ_MINI_PRIV), WEBP);
    writeFileSync(join(ROOT, ARQ_MINI_PUB), WEBP);

    await criarTileset(db, ID_PRIV, 'private', {
      url: URL_TILESET, forma3d: 'tiles3d', previewThumbnail: URL_MINI_PRIV,
    });
    await criarTileset(db, ID_PUB, 'public', {
      url: `/api/v1/assets3d/mini-pub-pasta-${SUFIXO}/tileset.json`,
      forma3d: 'tiles3d',
      previewThumbnail: URL_MINI_PUB,
    });

    admin = await createAdminUser(db);
    dono = await createUser(db);
    // `colega` e `forasteiro` são gêmeos: mesma fábrica, mesmo papel `user`, nenhuma concessão.
    // A ÚNICA diferença entre os dois é o share de leitura no atlas que empresta, e é ela que o
    // carimbo transforma em bytes.
    colega = await createUser(db);
    forasteiro = await createUser(db);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenColega = await loginUser(app, colega.username, colega.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);

    atlasQueEmpresta = await createAtlas(db, dono.id);
    // O atlas que o COLEGA possui e que não empresta nada: o negativo em que o chamador ALCANÇA o
    // atlas que nomeia, sem o qual todo 404 com carimbo poderia ser "não alcança o atlas".
    atlasQueNaoEmpresta = await createAtlas(db, colega.id);
    await createShare(db, atlasQueEmpresta.id, colega.id, 'read', dono.id);

    // D4: o empréstimo vive enquanto o DONO do atlas enxergar o recurso. Sem esta concessão o braço
    // de empréstimo nasce morto e todo 404 deste arquivo passaria pela razão errada.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('tileset', $1, $2, 'view_share', $3)`,
      [ID_PRIV, dono.id, admin.id],
    );
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, 'tileset', $2, $3)`,
      [atlasQueEmpresta.id, ID_PRIV, dono.id],
    );

    // As linhas entraram por SQL direto, que nenhum serviço vê: o índice de regime e o memo do
    // predicado precisam ser derrubados à mão, senão o caso mede o cache e não o gate.
    invalidateAppConfigCache();
    invalidarAcessoDeAssets3d();
  });

  after(async () => {
    for (const alvo of [join(ROOT, PASTA_PRIV), join(ROOT, ARQ_MINI_PRIV), join(ROOT, ARQ_MINI_PUB)]) {
      if (existsSync(alvo)) rmSync(alvo, { recursive: true, force: true });
    }
    // AS LINHAS DE CATÁLOGO SAEM: a suíte compartilha um banco entre arquivos, e
    // `resource-access-listagem-crua.test.js` conta tilesets privados por diferença exata.
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [ID_PRIV]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [ID_PRIV]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[ID_PRIV, ID_PUB]]);
    invalidateAppConfigCache();
    invalidarAcessoDeAssets3d();
    await teardownTestEnv(db);
  });

  it('(a) o DONO da concessão vê a miniatura sem escopo nenhum', async () => {
    const res = await comoImg(app, URL_MINI_PRIV, tokenDono).expect(200);
    assert.equal(res.headers['cache-control'], CACHE_PRIVADO);
    assert.equal(res.headers['content-length'], String(WEBP.length));
  });

  it('(b) o COLEGA, pelo cookie: 404 SEM o carimbo, 200 COM ele', async () => {
    // O DEFEITO, como o navegador o via: o `<img src>` sem `?atlasId=`.
    const sem = await comoImg(app, URL_MINI_PRIV, tokenColega);
    assert.equal(sem.status, 404, 'sem o carimbo o empréstimo nem é consultado');

    // O CONSERTO: o mesmo pedido, o mesmo transporte, e o atlas na URL.
    const com = await comoImg(app, `${URL_MINI_PRIV}?atlasId=${atlasQueEmpresta.id}`, tokenColega)
      .expect(200);
    assert.equal(com.headers['content-length'], String(WEBP.length));
    // A resposta dependeu do chamador E do empréstimo, e nunca é publicamente cacheável.
    assert.equal(com.headers['cache-control'], CACHE_PRIVADO);
    assert.match(com.headers.vary ?? '', /Cookie/);
    assert.match(com.headers.vary ?? '', /Authorization/);
  });

  it('(c) miniatura e `tileset.json` respondem IGUAL ao mesmo chamador, com e sem carimbo', async () => {
    const tilesetSem = await comoImg(app, URL_TILESET, tokenColega);
    const miniSem = await comoImg(app, URL_MINI_PRIV, tokenColega);
    assert.equal(tilesetSem.status, 404);
    assert.equal(miniSem.status, tilesetSem.status);

    const escopo = `?atlasId=${atlasQueEmpresta.id}`;
    const tilesetCom = await comoImg(app, `${URL_TILESET}${escopo}`, tokenColega);
    const miniCom = await comoImg(app, `${URL_MINI_PRIV}${escopo}`, tokenColega);
    assert.equal(tilesetCom.status, 200);
    assert.equal(miniCom.status, tilesetCom.status);
  });

  it('(d) o UUID do atlas não é senha', async () => {
    const escopo = `?atlasId=${atlasQueEmpresta.id}`;

    const alheio = await comoImg(app, `${URL_MINI_PRIV}${escopo}`, tokenForasteiro);
    assert.equal(alheio.status, 404, 'estar logado não basta: é preciso alcançar o atlas');

    const anonimo = await comoImg(app, `${URL_MINI_PRIV}${escopo}`, null);
    assert.equal(anonimo.status, 404, 'o atlas não é público, então o anônimo não herda o empréstimo');

    // A segunda pergunta do gate, isolada: o colega é DONO do atlas que nomeia e mesmo assim não
    // leva os bytes, porque aquele atlas não tomou o recurso emprestado.
    const semEmprestimo = await comoImg(
      app, `${URL_MINI_PRIV}?atlasId=${atlasQueNaoEmpresta.id}`, tokenColega,
    );
    assert.equal(semEmprestimo.status, 404, 'ser dono de um atlas não empresta o acervo alheio');
  });

  it('(e) a miniatura PÚBLICA continua pública, e o carimbo não muda o regime dela', async () => {
    const semCarimbo = await comoImg(app, URL_MINI_PUB, null).expect(200);
    assert.equal(semCarimbo.headers['cache-control'], CACHE_PUBLICO);

    const comCarimbo = await comoImg(app, `${URL_MINI_PUB}?atlasId=${atlasQueEmpresta.id}`, tokenColega)
      .expect(200);
    assert.equal(comCarimbo.headers['cache-control'], CACHE_PUBLICO);
    assert.doesNotMatch(comCarimbo.headers.vary ?? '', /Cookie/);
  });
});
