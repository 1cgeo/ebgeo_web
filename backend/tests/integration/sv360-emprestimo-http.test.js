// Path: tests/integration/sv360-emprestimo-http.test.js
//
// O EMPRÉSTIMO POR ATLAS ALCANÇA O 360 SOBRE HTTP (fase F9, item 4).
//
// O QUE ERA. `sv360AccessPredicate` sempre teve DOIS braços de concessão: a pessoal
// (`resource_grants`) e a de EMPRÉSTIMO (`atlas_resources`, que exige um atlas em
// foco). O `$atlasId` existia no SQL e nas assinaturas do serviço, e NENHUM
// controller o preenchia — o braço estava morto sobre HTTP, e um panorama emprestado
// a um atlas nunca aparecia para os membros dele. `sv360-privado.test.js` fixava
// esse estado por escrito, dizendo que ligar o eixo sem a autorização junto seria
// pior que não ligar.
//
// LIGAR EXIGIU DUAS CONDIÇÕES, e este arquivo mede as duas:
//
//   (a) O UUID DO ATLAS NÃO É SENHA. Receber `?atlasId=` diz QUAL empréstimo o
//       chamador quer usar; quem diz que ele pode é `requireAtlasPermission('read')`,
//       que resolve dono/share/`is_public` e CONFINA o visitante de link público ao
//       atlas do próprio token. Sem isso, saber o UUID (que viaja em toda URL de
//       compartilhamento) viraria o modelo de segurança.
//
//   (b) NADA QUE DEPENDEU DO EMPRÉSTIMO É PUBLICAMENTE CACHEÁVEL, e o ETag do tile
//       incorpora o conjunto de visibilidade. O caso que o predicado antigo
//       (`if (req.user)`) NÃO alcançava é o do atlas PÚBLICO: ele dá `read` a um
//       chamador ANÔNIMO, então uma resposta sem `req.user` podia carregar panorama
//       emprestado e sair marcada `public`. Os dois últimos blocos deste arquivo
//       existem por causa desse caso.
//
// A SUPERFÍCIE MEDIDA É A DE PROJETO (listagem, slug, derivadas, review-stats, MVT e
// geojson). AS ROTAS DE FOTO FICARAM DE FORA, e a ausência é deliberada: as consultas
// delas não carregam `sv360AccessPredicate` nenhum, então passar-lhes um `atlasId`
// seria fiar um parâmetro num predicado que não existe.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import supertest from 'supertest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser,
  makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

// O tile onde as duas fotos caem. Mesmo cálculo de `sv360-privado.test.js`.
const LON = -50.5;
const LAT = -29.5;
const Z = 12;
const TILE = (() => {
  const n = 2 ** Z;
  const latRad = (LAT * Math.PI) / 180;
  return {
    x: Math.floor(((LON + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
  };
})();

/** Decodifica um MVT em { [camada]: [props] }. */
function decodeTile(buf) {
  const tile = new VectorTile(new PbfReader(buf));
  const out = {};
  for (const nome of Object.keys(tile.layers)) {
    const layer = tile.layers[nome];
    out[nome] = [];
    for (let i = 0; i < layer.length; i += 1) out[nome].push(layer.feature(i).properties);
  }
  return out;
}

describe('F9 — o empréstimo por atlas alcança o 360 sobre HTTP', () => {
  let app, db;
  let admin, dono, membro, forasteiro;
  let tokenAdmin, tokenDono, tokenMembro, tokenForasteiro;
  let atlasComEmprestimo, atlasSemEmprestimo, atlasPublico, tokenVisitante;
  let projetoId, projetoPublicoId, orgId;
  const fotoPrivadaId = crypto.randomUUID();
  const fotoPublicaId = crypto.randomUUID();
  const sufixo = crypto.randomUUID().slice(0, 8);
  const SLUG = `emp360-${sufixo}`;
  const SLUG_PUB = `emp360-pub-${sufixo}`;

  // --- helpers de requisição -----------------------------------------------
  const comEscopo = (req, token, atlasId) => {
    if (token) req.set('Authorization', `Bearer ${token}`);
    return atlasId ? req.query({ atlasId }) : req;
  };

  const getProjeto = (token, atlasId) =>
    comEscopo(supertest(app).get(`/api/v1/sv360/projects/${SLUG}`), token, atlasId);

  const getLista = (token, atlasId) =>
    comEscopo(supertest(app).get('/api/v1/sv360/projects'), token, atlasId);

  const fetchTile = (token, atlasId) => {
    const req = comEscopo(
      supertest(app).get(`/api/v1/sv360/tiles/${Z}/${TILE.x}/${TILE.y}.pbf`), token, atlasId
    );
    return req.buffer().parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  };

  // A rota devolve um ARRAY NU (o contrato congelado do 360 não embrulha em {data}).
  const slugsDaLista = async (token, atlasId) => {
    const { body } = await getLista(token, atlasId).expect(200);
    return (Array.isArray(body) ? body : body.projects).map((p) => p.slug);
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM emp360 ${sufixo}`, `omemp-${sufixo}`, `E${sufixo.slice(0, 4)}`]
    );
    orgId = orgs[0].id;

    admin = await createAdminUser(db, { username: `emp_admin_${sufixo}` });
    dono = await createUser(db, { username: `emp_dono_${sufixo}` });
    membro = await createUser(db, { username: `emp_membro_${sufixo}` });
    forasteiro = await createUser(db, { username: `emp_fora_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);

    atlasComEmprestimo = await createAtlas(db, dono.id, { name: `Atlas empresta ${sufixo}` });
    atlasSemEmprestimo = await createAtlas(db, dono.id, { name: `Atlas nada ${sufixo}` });
    atlasPublico = await createAtlas(db, dono.id, { name: `Atlas publico ${sufixo}` });
    await createShare(db, atlasComEmprestimo.id, membro.id, 'read', dono.id);
    await createShare(db, atlasSemEmprestimo.id, membro.id, 'read', dono.id);
    const link = await makeAtlasPublic(db, atlasPublico.id);
    tokenVisitante = await getPublicToken(app, link);

    // O projeto PRIVADO (enabled + private) e um vizinho PÚBLICO no MESMO tile. O
    // vizinho é o controle de discriminação: sem ele, "o tile não traz o privado"
    // também é o que se mede quando o tile vem vazio.
    const { rows } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'private', $5, $6, 1) RETURNING id`,
      [orgId, SLUG, `Privado emprestado ${sufixo}`, `${orgId}__${SLUG}.db`, LAT, LON]
    );
    projetoId = rows[0].id;

    const { rows: pub } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'public', $5, $6, 1) RETURNING id`,
      [orgId, SLUG_PUB, `Vizinho publico ${sufixo}`, `${orgId}__${SLUG_PUB}.db`, LAT, LON]
    );
    projetoPublicoId = pub[0].id;

    for (const [id, projeto, nome] of [
      [fotoPrivadaId, projetoId, 'privada.jpg'],
      [fotoPublicaId, projetoPublicoId, 'publica.jpg'],
    ]) {
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon, geom, floor_level)
         VALUES ($1, $2, $3, 1, $5, $4, ST_SetSRID(ST_MakePoint($4, $5), 4326), 0)`,
        [id, projeto, nome, LON, LAT]
      );
    }
    // A trajetória do projeto privado, que alimenta a camada de LINHA.
    await db.query(
      `INSERT INTO sv360.tracks (project_id, geom)
       VALUES ($1, ST_SetSRID(ST_MakeLine(ST_MakePoint($2, $3), ST_MakePoint($4, $5)), 4326))`,
      [projetoId, LON, LAT, LON + 0.0004, LAT + 0.0004]
    );

    // O EMPRÉSTIMO. A concessão ao DONO é o que o sustenta (D4: o empréstimo vive
    // enquanto o dono do atlas vê o recurso), e é o dono quem anexa — `assertCanSeeResource`
    // recusaria quem não enxerga o recurso que está emprestando.
    await supertest(app)
      .post(`/api/v1/resource-access/sv360_project/${projetoId}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: dono.id, grantLevel: 'view' })
      .expect(201);
    await supertest(app)
      .post(`/api/v1/atlas/${atlasComEmprestimo.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'sv360_project', resourceId: projetoId })
      .expect(201);
    await supertest(app)
      .post(`/api/v1/atlas/${atlasPublico.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'sv360_project', resourceId: projetoId })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [projetoId]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [projetoId]);
    await db.query('DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])', [[projetoId, projetoPublicoId]]);
    await db.query('DELETE FROM atlas WHERE owner_id = $1', [dono.id]);
    await db.query('DELETE FROM users WHERE organization_id = $1', [orgId]);
    await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // O EIXO LIGADO: o par positivo/negativo do empréstimo
  // ==========================================================================

  it('SEM atlas em foco o membro NÃO vê; COM o atlas que empresta, vê', async () => {
    // O piso primeiro. O membro do atlas não tem concessão pessoal nenhuma: sem o
    // parâmetro ele é indistinguível de um forasteiro.
    await getProjeto(tokenMembro, null).expect(404);
    assert.ok(!(await slugsDaLista(tokenMembro, null)).includes(SLUG));

    // E o par, na mesma linha e no mesmo instante.
    await getProjeto(tokenMembro, atlasComEmprestimo.id).expect(200);
    assert.ok((await slugsDaLista(tokenMembro, atlasComEmprestimo.id)).includes(SLUG));
  });

  it('o empréstimo é POR ATLAS: o outro atlas do mesmo dono não empresta nada', async () => {
    // Sem este caso, "com atlasId vê" seria indistinguível de "com qualquer atlasId vê",
    // que é justamente o modelo que a fase recusa.
    await getProjeto(tokenMembro, atlasSemEmprestimo.id).expect(404);
    assert.ok(!(await slugsDaLista(tokenMembro, atlasSemEmprestimo.id)).includes(SLUG));
  });

  it('as QUATRO leituras derivadas do slug aprenderam o eixo junto', async () => {
    // `floors`, `photos`, `map` e `runs` resolvem o projeto por `resolveReadableProject`,
    // e até esta fase NENHUMA repassava o atlas — ligar o eixo só nos controllers diretos
    // deixaria as quatro para trás, com o sintoma "o projeto abre e as abas dele 404".
    for (const sub of ['floors', 'photos', 'map', 'runs']) {
      const url = `/api/v1/sv360/projects/${SLUG}/${sub}`;
      await supertest(app).get(url)
        .set('Authorization', `Bearer ${tokenMembro}`)
        .expect(404);
      await supertest(app).get(url).query({ atlasId: atlasComEmprestimo.id })
        .set('Authorization', `Bearer ${tokenMembro}`)
        .expect(200);
    }
  });

  it('review-stats e o geojson legado seguem a mesma regra', async () => {
    const semAtlas = await supertest(app).get('/api/v1/sv360/projects/review-stats')
      .set('Authorization', `Bearer ${tokenMembro}`).expect(200);
    assert.ok(!Object.keys(semAtlas.body.stats).includes(SLUG));

    const comAtlas = await supertest(app).get('/api/v1/sv360/projects/review-stats')
      .query({ atlasId: atlasComEmprestimo.id })
      .set('Authorization', `Bearer ${tokenMembro}`).expect(200);
    assert.ok(Object.keys(comAtlas.body.stats).includes(SLUG));

    const idsDoGeojson = async (atlasId) => {
      const req = supertest(app).get('/api/v1/sv360/tiles/fotos.geojson')
        .set('Authorization', `Bearer ${tokenMembro}`);
      if (atlasId) req.query({ atlasId });
      return (await req.expect(200)).body.features.map((f) => f.properties.id);
    };
    assert.ok(!(await idsDoGeojson(null)).includes(fotoPrivadaId));
    assert.ok((await idsDoGeojson(atlasComEmprestimo.id)).includes(fotoPrivadaId));
  });

  it('MVT — as DUAS camadas aparecem com o atlas em foco, e somem sem ele', async () => {
    const sem = decodeTile((await fetchTile(tokenMembro, null)).body);
    assert.ok((sem.fotos ?? []).map((f) => f.id).includes(fotoPublicaId), 'guarda: o tile não está vazio');
    assert.ok(!(sem.fotos ?? []).map((f) => f.id).includes(fotoPrivadaId));
    assert.ok(!(sem.fotos_linha ?? []).some((l) => l.projectSlug === SLUG));

    const com = decodeTile((await fetchTile(tokenMembro, atlasComEmprestimo.id)).body);
    assert.ok((com.fotos ?? []).map((f) => f.id).includes(fotoPrivadaId), 'o ponto emprestado aparece');
    assert.ok(
      (com.fotos_linha ?? []).some((l) => l.projectSlug === SLUG),
      'e a trajetória junto — a camada de linha é gateada pelo mesmo predicado'
    );
  });

  // ==========================================================================
  // (a) O UUID DO ATLAS NÃO É SENHA
  // ==========================================================================

  it('o FORASTEIRO com o mesmo UUID leva 404 do gate de atlas, e nunca o projeto', async () => {
    // A prova precisa dos DOIS lados, porque as duas respostas são 404: o do 360 (não
    // existe para você) e o do atlas (você não alcança este atlas). O que os separa é a
    // LISTAGEM: sem o parâmetro ela responde 200 com uma lista que não contém o slug;
    // com o parâmetro ela nem chega a rodar.
    const lista = await getLista(tokenForasteiro, null).expect(200);
    assert.ok(!(lista.body.projects ?? lista.body).map((p) => p.slug).includes(SLUG));

    await getLista(tokenForasteiro, atlasComEmprestimo.id).expect(404);
    await getProjeto(tokenForasteiro, atlasComEmprestimo.id).expect(404);
    await supertest(app).get(`/api/v1/sv360/tiles/${Z}/${TILE.x}/${TILE.y}.pbf`)
      .query({ atlasId: atlasComEmprestimo.id })
      .set('Authorization', `Bearer ${tokenForasteiro}`)
      .expect(404);
  });

  it('o ANÔNIMO com o UUID de um atlas privado também não passa', async () => {
    await getLista(null, atlasComEmprestimo.id).expect(404);
    await getProjeto(null, atlasComEmprestimo.id).expect(404);
    // Discriminação: sem o parâmetro, o mesmo anônimo recebe 200 com o acervo público.
    const lista = await getLista(null, null).expect(200);
    assert.ok((lista.body.projects ?? lista.body).map((p) => p.slug).includes(SLUG_PUB));
  });

  it('o VISITANTE DE LINK PÚBLICO é CONFINADO ao atlas do próprio token', async () => {
    // O caso mais forte de (a), e o que separa "confirmar o atlas" de "confiar no
    // parâmetro": este token é válido, tem `read` no atlas dele, e mesmo assim não pode
    // usar o UUID de OUTRO atlas para colher o empréstimo de lá.
    //
    // Ele também é o beneficiário principal do eixo: `principalUserId` devolve NULL para
    // `public-<uuid>`, então o ramo de concessão pessoal morre e SÓ o de empréstimo pode
    // alcançá-lo.
    await getProjeto(tokenVisitante, atlasPublico.id).expect(200);
    await getProjeto(tokenVisitante, atlasComEmprestimo.id).expect(404);
    // E sem atlas nenhum ele volta a ser um anônimo qualquer.
    await getProjeto(tokenVisitante, null).expect(404);
  });

  it('`atlasId` malformado morre em 422 na BORDA, não num cast lá dentro', async () => {
    // Joi na borda: sem isto o valor chegaria a `requireAtlasPermission`, que consulta
    // `atlas WHERE id = $1` e levantaria 22P02 — um 400 sem relação aparente com a causa.
    const res = await getProjeto(tokenMembro, 'nao-e-uuid').expect(422);
    assert.ok(res.body.error, 'o envelope plano { error } do módulo 360');
  });

  // ==========================================================================
  // (b) NADA QUE DEPENDEU DO EMPRÉSTIMO É PUBLICAMENTE CACHEÁVEL
  // ==========================================================================

  it('o atlas PÚBLICO é o caso que `req.user` sozinho não alcançava', async () => {
    // Um atlas `is_public` dá `read` a chamador ANÔNIMO. Sem o segundo termo de
    // `respostaEscopada`, este tile — que carrega o panorama emprestado — sairia
    // marcado `public, max-age=60` e um cache compartilhado o reporia para qualquer um.
    const res = await fetchTile(null, atlasPublico.id).expect(200);
    const camadas = decodeTile(res.body);
    assert.ok(
      (camadas.fotos ?? []).map((f) => f.id).includes(fotoPrivadaId),
      'piso: sem o empréstimo alcançando este chamador, o resto do caso não mede nada'
    );
    assert.match(res.headers['cache-control'], /^private,/);
    assert.match(res.headers.vary ?? '', /Authorization/);

    // O PAR: o MESMO anônimo, sem atlas em foco, recebe um tile só com dado público —
    // e esse continua publicamente cacheável, que é o cache legítimo de CDN preservado.
    const semAtlas = await fetchTile(null, null).expect(200);
    assert.ok(!decodeTile(semAtlas.body).fotos.map((f) => f.id).includes(fotoPrivadaId));
    assert.match(semAtlas.headers['cache-control'], /^public,/);
  });

  it('o mesmo vale para o geojson e para as rotas JSON de projeto', async () => {
    const geo = await supertest(app).get('/api/v1/sv360/tiles/fotos.geojson')
      .query({ atlasId: atlasPublico.id }).expect(200);
    assert.match(geo.headers['cache-control'], /^private,/);

    const proj = await supertest(app).get(`/api/v1/sv360/projects/${SLUG}`)
      .query({ atlasId: atlasPublico.id }).expect(200);
    assert.match(proj.headers['cache-control'], /^private,/);

    // O par anônimo sem escopo: a rota JSON continua sem Cache-Control, como sempre
    // esteve — o conteúdo dela é o mesmo para todo mundo.
    const publico = await supertest(app).get(`/api/v1/sv360/projects/${SLUG_PUB}`).expect(200);
    assert.equal(publico.headers['cache-control'], undefined);
  });

  it('o ETag do MVT incorpora o CONJUNTO DE VISIBILIDADE, não o z/x/y', async () => {
    // A propriedade que fecha a porta dos fundos: se o ETag identificasse a tile, um 304
    // confirmaria conteúdo através de escopos diferentes.
    const comEmprestimo = await fetchTile(tokenMembro, atlasComEmprestimo.id).expect(200);
    const semEmprestimo = await fetchTile(tokenMembro, null).expect(200);

    assert.ok(comEmprestimo.headers.etag, 'a rota passou a emitir ETag');
    assert.ok(semEmprestimo.headers.etag);
    assert.notEqual(
      comEmprestimo.headers.etag, semEmprestimo.headers.etag,
      'mesma tile, conjuntos de visibilidade diferentes: ETags diferentes'
    );

    // E o ETag do escopo mais amplo NÃO produz 304 no escopo mais estreito.
    await supertest(app).get(`/api/v1/sv360/tiles/${Z}/${TILE.x}/${TILE.y}.pbf`)
      .set('Authorization', `Bearer ${tokenMembro}`)
      .set('If-None-Match', comEmprestimo.headers.etag)
      .expect(200);
  });

  it('o 304 do MVT só vale para quem já tinha aquele corpo', async () => {
    const primeira = await fetchTile(tokenMembro, atlasComEmprestimo.id).expect(200);
    const segunda = await supertest(app)
      .get(`/api/v1/sv360/tiles/${Z}/${TILE.x}/${TILE.y}.pbf`)
      .query({ atlasId: atlasComEmprestimo.id })
      .set('Authorization', `Bearer ${tokenMembro}`)
      .set('If-None-Match', primeira.headers.etag)
      .expect(304);
    assert.equal(segunda.headers['content-length'], undefined, '304 não carrega corpo');
    assert.match(segunda.headers['cache-control'], /^private,/);
  });

  it('revogar a concessão do DONO derruba o empréstimo no 360, sem desanexar nada', async () => {
    // D4 medido pela superfície nova: o empréstimo vive enquanto o dono do atlas vê o
    // recurso, e a propagação é uma propriedade do predicado, não de uma varredura.
    const { rows } = await db.query(
      `SELECT id FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [projetoId, dono.id]
    );
    assert.equal(rows.length, 1, 'piso: a concessão do dono está viva');

    await supertest(app).delete(`/api/v1/resource-access/grants/${rows[0].id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`).expect(200);

    await getProjeto(tokenMembro, atlasComEmprestimo.id).expect(404);
    const camadas = decodeTile((await fetchTile(tokenMembro, atlasComEmprestimo.id)).body);
    assert.ok(!(camadas.fotos ?? []).map((f) => f.id).includes(fotoPrivadaId));
    // A ANCORAGEM: o anexo continua lá. O que caiu foi a condição, não o vínculo.
    const { rows: anexo } = await db.query(
      `SELECT 1 FROM atlas_resources
        WHERE atlas_id = $1 AND resource_id = $2 AND removed_at IS NULL`,
      [atlasComEmprestimo.id, projetoId]
    );
    assert.equal(anexo.length, 1);
  });
});
