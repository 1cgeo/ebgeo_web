// Path: tests/integration/streetview-markers-rota-morta.test.js
//
// A ROTA MORTA SAIU, E O 360 DO MAPA NÃO (fase F9 item 1).
//
// DUAS COISAS TINHAM O NOME `streetview_markers`, E ELAS SÃO OPOSTAS:
//
//   (A) a TABELA de catálogo `streetview_markers` e a rota `/api/v1/streetview-markers`
//       montadas por `makeCatalogRouter` — nascidas de um `LIKE basemaps INCLUDING ALL`
//       no catálogo (005_catalogo.sql), sem alimentar o /api/config, sem consumidor no frontend e sem
//       seed que as populasse. É o que saiu do schema;
//
//   (B) o ARQUIVO `frontend/src/js/street_view_tool/streetview_markers.js`, que é a
//       camada de marcadores do 360 no mapa 2D e desenha a partir do MÓDULO 360
//       (schema `sv360`, rota `/api/v1/sv360`). É o que precisa continuar vivo.
//
// Uma remoção conduzida por NOME derruba (B) junto com (A), e a suíte não fica
// vermelha, porque (B) é UI. Este arquivo mede a fronteira pelos dois lados no mesmo
// corpo: a rota de (A) não existe mais, a fonte de (B) continua servindo tile.
//
// O QUE CADA VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. Um 404 sozinho não prova
// remoção: 404 é também o que um app quebrado, um backend fora do ar ou um router
// montado DEPOIS do catch-all respondem. Por isso todo caso aqui é um PAR — a rota
// morta contra as quatro vivas, na mesma chamada e com a mesma credencial. As quatro
// vivas respondem 401 sem credencial e 200 com ela; a morta responde 404 nas duas.
// Um 404 uniforme em todas seria o app quebrado, e reprovaria.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');
const APP_JS = join(SRC, 'app.js');

/** O segmento de rota que morreu. */
const ROTA_MORTA = '/api/v1/streetview-markers';

/** As quatro que sobraram, na ordem em que `app.js` as monta. */
const ROTAS_VIVAS = Object.freeze([
  '/api/v1/basemaps',
  '/api/v1/data-layers',
  '/api/v1/analysis-layers',
  '/api/v1/tilesets',
]);

describe('a rota de streetview-markers morreu; a fonte do 360 no mapa não', () => {
  let app, db, admin, tokenAdmin;
  const sufixo = randomUUID().slice(0, 8);
  const criados = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: `morta_admin_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    if (criados.length > 0) {
      await db.query('DELETE FROM basemaps WHERE id = ANY($1::text[])', [criados]);
    }
    await db.query('DELETE FROM users WHERE id = $1', [admin.id]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // (A) A ROTA NÃO EXISTE MAIS
  // ==========================================================================

  it('sem credencial: a morta dá 404 e as quatro vivas dão 401', async () => {
    // O PAR É O TESTE. As quatro vivas exigem sessão para LER (`catalog-tables.test.js`
    // fixa isso), então o 401 delas é a prova de que o app subiu, de que a cadeia de
    // middlewares está de pé e de que o catch-all não engoliu o módulo inteiro. Contra
    // esse fundo, o 404 da morta significa exatamente uma coisa: aquele prefixo não é
    // mais montado.
    assert.equal(ROTAS_VIVAS.length, 4, 'guarda: o par precisa das quatro sobreviventes');
    for (const rota of ROTAS_VIVAS) {
      await supertest(app).get(rota).expect(401);
    }
    await supertest(app).get(ROTA_MORTA).expect(404);
    await supertest(app).get(`${ROTA_MORTA}/qualquer-id`).expect(404);
  });

  it('com credencial de administrador: a morta continua 404 e as quatro devolvem lista', async () => {
    assert.equal(ROTAS_VIVAS.length, 4);
    let listadas = 0;
    for (const rota of ROTAS_VIVAS) {
      const res = await supertest(app).get(rota)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      assert.ok(Array.isArray(res.body.data), `${rota} devolve um array em .data`);
      listadas += 1;
    }
    assert.equal(listadas, 4, 'as quatro rotas vivas foram mesmo exercitadas');

    const morta = await supertest(app).get(ROTA_MORTA)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(404);
    // O 404 é o do catch-all, e não o de um recurso ausente dentro de um router vivo:
    // ele é IDÊNTICO ao de um caminho que nunca existiu.
    const inventada = await supertest(app).get(`/api/v1/rota-inventada-${sufixo}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(404);
    assert.deepEqual(morta.body, inventada.body, 'mesmo envelope: é o catch-all de app.js');
  });

  it('ESCREVER na rota morta é 404; a rota viva ao lado aceita a mesma escrita', async () => {
    // A metade que mais custaria se ficasse de pé: um router de catálogo montado dá
    // POST/PUT/DELETE de administrador contra uma tabela. Sem o par positivo, "o POST
    // deu 404" seria indistinguível de "o painel de administração parou de escrever".
    const corpo = { id: `morta-${sufixo}`, name: `Sonda ${sufixo}`, config: {} };

    await supertest(app).post(ROTA_MORTA)
      .set('Authorization', `Bearer ${tokenAdmin}`).send(corpo).expect(404);
    await supertest(app).put(`${ROTA_MORTA}/${corpo.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`).send({ name: 'x' }).expect(404);
    await supertest(app).delete(`${ROTA_MORTA}/${corpo.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`).expect(404);

    await supertest(app).post('/api/v1/basemaps')
      .set('Authorization', `Bearer ${tokenAdmin}`).send(corpo).expect(201);
    criados.push(corpo.id);

    // E a escrita recusada não escreveu em canto nenhum: o id só existe onde o POST
    // que passou o pôs.
    const { rows } = await db.query('SELECT id FROM basemaps WHERE id = $1', [corpo.id]);
    assert.equal(rows.length, 1);
  });

  it('o nome morto não sobrou no CÓDIGO do backend (só em migração já publicada e em prosa)', async () => {
    // A varredura vem do versionamento, nunca de uma lista escrita à mão. Ela mede
    // CÓDIGO: os arquivos `.sql` de migração ficam de fora porque a regra é
    // forward-only (uma baseline já publicada não se edita, e a que documenta a ausência
    // precisa nomear a tabela para explicá-la), e comentário é prosa, não fiação.
    const versionados = execFileSync('git', ['ls-files', '*.js'], { cwd: SRC, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(versionados.length > 50, `guarda: git devolveu ${versionados.length} arquivos`);

    const semComentarios = (t) => t
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const MORTO = /streetview[-_]marker/i;
    const sujos = versionados.filter(
      (rel) => MORTO.test(semComentarios(readFileSync(join(SRC, rel), 'utf8')))
    );
    assert.deepEqual(sujos, [], 'o tipo/rota morto voltou ao código do backend');

    // ANTI-COBERTURA-VAZIA: o mesmo método aplicado às quatro sobreviventes tem de
    // ACHAR alguma coisa. Sem isto, um `ls-files` que falhasse ou um regex que
    // deixasse de casar deixariam o caso acima trivialmente verde.
    for (const tabela of ['basemaps', 'data_layers', 'analysis_layers', 'tilesets']) {
      const vivos = versionados.filter(
        (rel) => new RegExp(tabela).test(semComentarios(readFileSync(join(SRC, rel), 'utf8')))
      );
      assert.ok(vivos.length > 0, `a varredura não achou ${tabela}: o método está cego`);
    }
  });

  it('app.js monta QUATRO catálogos, e nenhum deles é o morto', async () => {
    const fonte = readFileSync(APP_JS, 'utf8');
    const montados = [...fonte.matchAll(/makeCatalogRouter\('([a-z_]+)'\)/g)].map((m) => m[1]);
    assert.deepEqual(
      montados,
      ['basemaps', 'data_layers', 'analysis_layers', 'tilesets'],
      'os quatro mounts de catálogo, nesta ordem e sem o quinto'
    );
  });

  // ==========================================================================
  // (B) O 360 DO MAPA CONTINUA SERVIDO
  // ==========================================================================

  it('o /api/config continua apontando a camada 360 do mapa 2D para o MVT do módulo sv360', async () => {
    // É daqui que a camada de marcadores (o arquivo homônimo do frontend) tira a
    // fonte: `config.streetView360.pointsSource` / `linesSource`. Se a remoção tivesse
    // encostado no módulo 360, é este contrato que se perderia — e ele é o único elo
    // entre o documento público e a camada desenhada.
    const { body } = await supertest(app).get('/api/config').expect(200);
    const sv = body.data.streetView360;
    assert.ok(sv, 'guarda: o bloco streetView360 continua no documento público');
    assert.equal(sv.pointsSourceLayer, 'fotos');
    assert.equal(sv.linesSourceLayer, 'fotos_linha');
    assert.match(sv.pointsSource.tiles[0], /\/sv360\/tiles\/\{z\}\/\{x\}\/\{y\}\.pbf$/);
    assert.equal(sv.linesSource.tiles[0], sv.pointsSource.tiles[0], 'as duas camadas, um template só');

    // E o template resolve numa rota que RESPONDE, para um chamador anônimo, que é o
    // regime em que o mapa busca tile (o Worker do MapLibre não carrega token).
    const url = sv.pointsSource.tiles[0]
      .replace('{z}', '10').replace('{x}', '380').replace('{y}', '600');
    const tile = await supertest(app).get(url).expect(200);
    assert.match(tile.headers['content-type'], /vnd\.mapbox-vector-tile/);

    // O PAR, no mesmo instante e com a mesma credencial (nenhuma): a rota morta.
    await supertest(app).get(ROTA_MORTA).expect(404);
  });
});
