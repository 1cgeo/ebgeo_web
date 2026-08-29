// Path: tests/integration/sv360-foto-privada.test.js
//
// AS CINCO ROTAS DE FOTO DO 360, QUE ATÉ A FASE F9 NÃO TINHAM EIXO DE PRIVACIDADE.
//
// Este é o buraco mais fundo que a fase encontrou, e ele tem a forma exata do defeito
// que o censo de superfícies existe para impedir: a suíte media privacidade na
// LISTAGEM, no SLUG e no TILE (`sv360-privado.test.js`, doze casos) e NUNCA na foto.
// As quatro consultas por trás destas rotas — GET_PHOTO_BY_ID, GET_PHOTO_BY_NAME,
// GET_PHOTO_SIZES e NEARBY_PHOTOS — não carregavam `sv360AccessPredicate` nenhum, e
// quem decidia era `isProjectReadable`, que só conhece o eixo de `status`. Um projeto
// `enabled + private` é legível nesse eixo, então:
//
//   - `GET /photos/:uuid` e `/photos/by-name/:nome` entregavam o metadado a QUALQUER UM;
//   - `GET /photos/:uuid/image` entregava os BYTES, e os marcava `public, immutable`;
//   - `GET /photos/nearest` os entregava POR COORDENADA, sem precisar de identificador
//     nenhum — bastava clicar no mapa perto do acervo restrito.
//
// O comentário de `isProjectReadable` afirmava, em voz alta, que "nenhuma linha chega a
// esta função sem ter passado por ele [o SQL]". Era falso para estas cinco, e essa é a
// razão de o censo cobrar CLASSE de cada consulta em vez de confiar numa frase.
//
// A ESTRUTURA DE CADA CASO É UM PAR, nunca uma asserção só. Um projeto PRIVADO e um
// projeto PÚBLICO vizinho, com uma foto cada e blob real em disco: sem o vizinho,
// "o forasteiro leva 404" é indistinguível de "a rota quebrou para todo mundo".
//
// O QUE ESTE ARQUIVO NÃO MEDE: a existência do predicado no código, que é
// `tests/unit/superficies-de-recurso-censo.test.js`. Aqui só comportamento.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser, createAtlas, createShare,
} from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';
import { buildTilesDb } from '../helpers/sv360-tiles.js';

// A foto PRIVADA fica MAIS PERTO do ponto de busca que a pública: é o que faz
// `/photos/nearest` responder coisas diferentes conforme quem pergunta, e é o único
// jeito de aquele caso discriminar de verdade.
const LON = -51.0;
const LAT = -30.0;
const LON_PUB = -51.0009; // ~87 m a oeste
const NOME_COLIDENTE = 'colide.jpg';

const BLOB_PRIV = Buffer.from('RIFFxxxxWEBP-privada-full');
const PREV_PRIV = Buffer.from('RIFFxxxxWEBP-privada-prev');
const BLOB_PUB = Buffer.from('RIFFxxxxWEBP-publica-full');
const PREV_PUB = Buffer.from('RIFFxxxxWEBP-publica-prev');

describe('F9 — as cinco rotas de FOTO aprenderam o eixo de privacidade', () => {
  let app, db;
  let admin, credenciado, beneficiario, forasteiro, produtor, membro;
  let tokenAdmin, tokenCredenciado, tokenBeneficiario, tokenForasteiro, tokenProdutor, tokenMembro;
  let orgId, projetoId, projetoPublicoId, atlasEmpresta, atlasSemNada;
  let dbPrivPath, dbPubPath;

  const fotoPrivadaId = crypto.randomUUID();
  const fotoPublicaId = crypto.randomUUID();
  const sufixo = crypto.randomUUID().slice(0, 8);
  const SLUG = `foto360-${sufixo}`;
  const SLUG_PUB = `foto360-pub-${sufixo}`;

  // --- helpers de requisição -------------------------------------------------
  const comEscopo = (req, token, atlasId) => {
    if (token) req.set('Authorization', `Bearer ${token}`);
    return atlasId ? req.query({ atlasId }) : req;
  };
  const getFoto = (id, token, atlasId) =>
    comEscopo(supertest(app).get(`/api/v1/sv360/photos/${id}`), token, atlasId);
  const getPorNome = (nome, token, atlasId) =>
    comEscopo(supertest(app).get(`/api/v1/sv360/photos/by-name/${nome}`), token, atlasId);
  const getVizinhas = (id, token, atlasId) =>
    comEscopo(supertest(app).get(`/api/v1/sv360/photos/${id}/nearby`), token, atlasId);
  const getMaisProxima = (token, atlasId) =>
    comEscopo(
      supertest(app).get('/api/v1/sv360/photos/nearest').query({ lon: LON, lat: LAT }),
      token, atlasId
    );
  const getImagem = (id, token, atlasId) => {
    const req = comEscopo(
      supertest(app).get(`/api/v1/sv360/photos/${id}/tiles/0/0/0`), token, atlasId
    );
    return req.buffer().parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM foto360 ${sufixo}`, `omfoto-${sufixo}`, `F${sufixo.slice(0, 4)}`]
    );
    orgId = orgs[0].id;

    admin = await createAdminUser(db, { username: `f360_admin_${sufixo}` });
    credenciado = await createUser(db, { username: `f360_cred_${sufixo}`, role: 'credenciado' });
    beneficiario = await createUser(db, { username: `f360_ben_${sufixo}` });
    forasteiro = await createUser(db, { username: `f360_fora_${sufixo}` });
    membro = await createUser(db, { username: `f360_membro_${sufixo}` });
    produtor = await createProducerUser(db, orgId, {
      username: `f360_prod_${sufixo}`, organization_id: orgId,
    });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenCredenciado = await loginUser(app, credenciado.username, credenciado.password);
    tokenBeneficiario = await loginUser(app, beneficiario.username, beneficiario.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);
    tokenProdutor = await loginUser(app, produtor.username, produtor.password);

    atlasEmpresta = await createAtlas(db, admin.id, { name: `Atlas foto ${sufixo}` });
    atlasSemNada = await createAtlas(db, admin.id, { name: `Atlas seco ${sufixo}` });
    await createShare(db, atlasEmpresta.id, membro.id, 'read', admin.id);
    await createShare(db, atlasSemNada.id, membro.id, 'read', admin.id);

    const nomeDbPriv = `${orgId}__${SLUG}.db`;
    const nomeDbPub = `${orgId}__${SLUG_PUB}.db`;
    const { rows } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'private', $5, $6, 1) RETURNING id`,
      [orgId, SLUG, `Privado foto ${sufixo}`, nomeDbPriv, LAT, LON]
    );
    projetoId = rows[0].id;
    const { rows: pub } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'public', $5, $6, 1) RETURNING id`,
      [orgId, SLUG_PUB, `Publico foto ${sufixo}`, nomeDbPub, LAT, LON_PUB]
    );
    projetoPublicoId = pub[0].id;

    // O MESMO `original_name` NOS DOIS PROJETOS. É o que transforma
    // `/photos/by-name/:nome` num teste de WHERE e não de ORDER BY: com o predicado
    // no lugar certo, o anônimo recebe a linha PÚBLICA; sem ele, o desempate poderia
    // entregar a privada.
    for (const [id, projeto, lon, full, prev] of [
      [fotoPrivadaId, projetoId, LON, BLOB_PRIV, PREV_PRIV],
      [fotoPublicaId, projetoPublicoId, LON_PUB, BLOB_PUB, PREV_PUB],
    ]) {
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon, geom,
                                   floor_level, full_size_bytes, preview_size_bytes)
         VALUES ($1, $2, $3, 1, $5, $4, ST_SetSRID(ST_MakePoint($4, $5), 4326), 0, $6, $7)`,
        [id, projeto, NOME_COLIDENTE, lon, LAT, full.length, prev.length]
      );
    }

    // Blobs REAIS em disco: sem eles o 200 do caminho autorizado vira 404 por falta de
    // arquivo e o par positivo/negativo deixa de discriminar (os dois lados dariam 404).
    mkdirSync(config.sv360.dbDir, { recursive: true });
    for (const [nome, foto] of [
      [nomeDbPriv, fotoPrivadaId],
      [nomeDbPub, fotoPublicaId],
    ]) {
      // Tiles-only: o pixel vem do `{slug}_tiles.db` + descritor em photo_pyramids.
      const caminho = path.resolve(config.sv360.dbDir, nome.replace(/\.db$/i, '_tiles.db'));
      if (existsSync(caminho)) rmSync(caminho, { force: true });
      buildTilesDb(caminho, [foto]);
      await db.query(
        `INSERT INTO sv360.photo_pyramids
           (photo_id, tile_size, max_level, width, height, quality, tile_count, total_bytes, razao)
         VALUES ($1, 512, 0, 1024, 512, 80, 1, 24, 2)`,
        [foto]
      );
      if (nome === nomeDbPriv) dbPrivPath = caminho;
      else dbPubPath = caminho;
    }

    // A CONCESSÃO PESSOAL ao beneficiário, e o EMPRÉSTIMO para um atlas do admin.
    await supertest(app)
      .post(`/api/v1/resource-access/sv360_project/${projetoId}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: beneficiario.id, grantLevel: 'view' })
      .expect(201);
    await supertest(app)
      .post(`/api/v1/atlas/${atlasEmpresta.id}/resources`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ resourceType: 'sv360_project', resourceId: projetoId })
      .expect(201);
  });

  after(async () => {
    await closeStore();
    for (const f of [dbPrivPath, dbPubPath]) {
      for (const s of ['', '-wal', '-shm']) {
        const alvo = f ? `${f}${s}` : null;
        if (alvo && existsSync(alvo)) {
          try {
            rmSync(alvo, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [projetoId]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [projetoId]);
    await db.query('DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])',
      [[projetoId, projetoPublicoId]]);
    await db.query('DELETE FROM atlas WHERE owner_id = $1', [admin.id]);
    await db.query('DELETE FROM users WHERE organization_id = $1 OR producer_org_id = $1', [orgId]);
    await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // 1. GET /photos/:uuid — o metadado
  // ==========================================================================

  it('METADADO — NEGATIVO para anônimo e forasteiro, POSITIVO para a foto pública', async () => {
    await getFoto(fotoPrivadaId, null).expect(404);
    await getFoto(fotoPrivadaId, tokenForasteiro).expect(404);

    // A DISCRIMINAÇÃO, e sem ela este caso passaria verde com a rota inteira quebrada:
    // a foto do projeto PÚBLICO continua saindo para o anônimo.
    const { body } = await getFoto(fotoPublicaId, null).expect(200);
    assert.equal(body.camera.id, fotoPublicaId);
  });

  it('METADADO — POSITIVO para quem alcança: produtor, admin, credenciado e concedido', async () => {
    for (const [quem, token] of [
      ['a OM produtora', tokenProdutor],
      ['o administrador', tokenAdmin],
      ['o credenciado', tokenCredenciado],
      ['o beneficiário da concessão', tokenBeneficiario],
    ]) {
      const { body } = await getFoto(fotoPrivadaId, token).expect(200);
      assert.equal(body.camera.id, fotoPrivadaId, `${quem} precisa receber a foto privada`);
    }
  });

  // ==========================================================================
  // 2. GET /photos/by-name/:nome — o predicado é WHERE, não desempate
  // ==========================================================================

  it('POR NOME — o nome COLIDE entre o privado e o público, e o anônimo recebe o PÚBLICO', async () => {
    // Se o predicado tivesse entrado só no `ORDER BY`, esta chamada poderia devolver a
    // linha privada — as duas casam o nome. O par é: anônimo → pública; produtor →
    // privada (que o desempate por OM preferida coloca à frente para ele).
    const anon = await getPorNome(NOME_COLIDENTE, null).expect(200);
    assert.equal(anon.body.camera.id, fotoPublicaId, 'o anônimo não pode receber a linha privada');

    const deFora = await getPorNome(NOME_COLIDENTE, tokenForasteiro).expect(200);
    assert.equal(deFora.body.camera.id, fotoPublicaId);

    const prod = await getPorNome(NOME_COLIDENTE, tokenProdutor).expect(200);
    assert.equal(
      prod.body.camera.id, fotoPrivadaId,
      'a OM produtora vê as duas, e o desempate por OM preferida escolhe a dela'
    );
  });

  // ==========================================================================
  // 3. GET /photos/:uuid/image — os BYTES
  // ==========================================================================

  it('IMAGEM — NEGATIVO: o anônimo não recebe os bytes da privada; POSITIVO: recebe os da pública', async () => {
    await getImagem(fotoPrivadaId, null).expect(404);
    await getImagem(fotoPrivadaId, tokenForasteiro).expect(404);

    await getImagem(fotoPublicaId, null).expect(200); // a foto publica segue servida (tile)
  });

  it('IMAGEM — POSITIVO: o concedido recebe os bytes, e a resposta NÃO é publicamente cacheável', async () => {
    const res = await getImagem(fotoPrivadaId, tokenBeneficiario).expect(200);
    assert.match(res.headers['cache-control'], /^private,/,
      'recurso restrito não pode ir para cache compartilhado');
    assert.match(res.headers.vary ?? '', /Authorization/);

    // O par: a foto PÚBLICA sai `public`, e é isso que prova que o cabeçalho está
    // sendo DECIDIDO e não fixado.
    const pub = await getImagem(fotoPublicaId, null).expect(200);
    assert.match(pub.headers['cache-control'], /^public,/);
  });

  // ==========================================================================
  // 4. GET /photos/nearest — o caminho que dispensa identificador
  // ==========================================================================

  it('MAIS PRÓXIMA — NEGATIVO: o anônimo recebe a PÚBLICA distante, nunca a privada sob o ponto', async () => {
    // A privada está EM CIMA do ponto pedido; a pública, ~87 m a oeste. Sem o
    // predicado a resposta é sempre a privada, para todo mundo, sem uuid nenhum.
    const anon = await getMaisProxima(null).expect(200);
    assert.equal(anon.body.photo.id, fotoPublicaId,
      'a busca ESPACIAL não pode entregar a foto privada a quem não a alcança');

    const fora = await getMaisProxima(tokenForasteiro).expect(200);
    assert.equal(fora.body.photo.id, fotoPublicaId);
  });

  it('MAIS PRÓXIMA — POSITIVO: quem alcança recebe a privada, que é de fato a mais próxima', async () => {
    for (const [quem, token] of [
      ['o beneficiário', tokenBeneficiario],
      ['a OM produtora', tokenProdutor],
      ['o administrador', tokenAdmin],
    ]) {
      const { body } = await getMaisProxima(token).expect(200);
      assert.equal(body.photo.id, fotoPrivadaId, `${quem} recebe a mais próxima de verdade`);
    }
  });

  // ==========================================================================
  // 5. GET /photos/:uuid/nearby — a vizinhança do mesmo projeto
  // ==========================================================================

  it('VIZINHAS — NEGATIVO 404 para quem não alcança a origem; POSITIVO 200 para quem alcança', async () => {
    await getVizinhas(fotoPrivadaId, null).expect(404);
    await getVizinhas(fotoPrivadaId, tokenForasteiro).expect(404);

    const { body } = await getVizinhas(fotoPrivadaId, tokenBeneficiario).expect(200);
    assert.ok(Array.isArray(body.photos), 'o concedido recebe a lista (vazia é resposta válida)');

    // Discriminação: a mesma rota sobre a foto pública responde 200 ao anônimo.
    await getVizinhas(fotoPublicaId, null).expect(200);
  });

  // ==========================================================================
  // 6. O EMPRÉSTIMO POR ATLAS alcança a foto, e o UUID do atlas não é senha
  // ==========================================================================

  it('EMPRÉSTIMO — o membro NÃO vê a foto sem atlas em foco, e VÊ com o atlas que empresta', async () => {
    await getFoto(fotoPrivadaId, tokenMembro).expect(404);
    await getFoto(fotoPrivadaId, tokenMembro, atlasSemNada.id).expect(404);

    const { body } = await getFoto(fotoPrivadaId, tokenMembro, atlasEmpresta.id).expect(200);
    assert.equal(body.camera.id, fotoPrivadaId);
  });

  it('EMPRÉSTIMO — as cinco rotas aprenderam o eixo juntas, e nenhuma ficou para trás', async () => {
    const semEscopo = [
      ['metadado', () => getFoto(fotoPrivadaId, tokenMembro)],
      ['imagem', () => getImagem(fotoPrivadaId, tokenMembro)],
      ['vizinhas', () => getVizinhas(fotoPrivadaId, tokenMembro)],
    ];
    for (const [nome, chamada] of semEscopo) {
      const res = await chamada();
      assert.equal(res.status, 404, `${nome}: sem atlas em foco o membro não alcança`);
    }
    const comAtlas = [
      ['metadado', () => getFoto(fotoPrivadaId, tokenMembro, atlasEmpresta.id)],
      ['imagem', () => getImagem(fotoPrivadaId, tokenMembro, atlasEmpresta.id)],
      ['vizinhas', () => getVizinhas(fotoPrivadaId, tokenMembro, atlasEmpresta.id)],
    ];
    for (const [nome, chamada] of comAtlas) {
      const res = await chamada();
      assert.equal(res.status, 200, `${nome}: com o atlas que empresta, alcança`);
    }
    // E as duas que não recebem uuid: nome colidente e busca espacial.
    const porNome = await getPorNome(NOME_COLIDENTE, tokenMembro, atlasEmpresta.id).expect(200);
    assert.equal(porNome.body.camera.id, fotoPrivadaId);
    const proxima = await getMaisProxima(tokenMembro, atlasEmpresta.id).expect(200);
    assert.equal(proxima.body.photo.id, fotoPrivadaId);
  });

  it('EMPRÉSTIMO — o FORASTEIRO com o mesmo UUID de atlas leva 404 do GATE, e nunca a foto', async () => {
    // O UUID do atlas não autoriza: quem não alcança o atlas morre no
    // `requireAtlasPermission('read')` de `requireAtlasScopeWhenPresent`.
    await getFoto(fotoPrivadaId, tokenForasteiro, atlasEmpresta.id).expect(404);
    await getImagem(fotoPrivadaId, tokenForasteiro, atlasEmpresta.id).expect(404);
    await getFoto(fotoPrivadaId, null, atlasEmpresta.id).expect(404);
    // E o malformado morre na BORDA, em 422, e não num cast lá dentro.
    await getFoto(fotoPrivadaId, tokenMembro, 'nao-e-uuid').expect(422);
  });

  // ==========================================================================
  // 7. Os dois eixos continuam ortogonais também na foto
  // ==========================================================================

  it('`disabled` oculta a foto até de quem TEM concessão, e a OM produtora continua vendo', async () => {
    await db.query(`UPDATE sv360.projects SET status = 'disabled' WHERE id = $1`, [projetoId]);
    try {
      await getFoto(fotoPrivadaId, tokenBeneficiario).expect(404);
      await getImagem(fotoPrivadaId, tokenBeneficiario).expect(404);
      await getFoto(fotoPrivadaId, tokenProdutor).expect(200);
    } finally {
      await db.query(`UPDATE sv360.projects SET status = 'enabled' WHERE id = $1`, [projetoId]);
    }
    // Controle de reversão: restaurado o status, o concedido volta a ver.
    await getFoto(fotoPrivadaId, tokenBeneficiario).expect(200);
  });

  // ==========================================================================
  // 8. Remarcado público, a foto volta a ser de todos
  // ==========================================================================

  it('remarcado público, o anônimo volta a receber metadado e bytes da MESMA foto', async () => {
    await supertest(app)
      .patch(`/api/v1/resource-access/sv360_project/${projetoId}/visibility`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ accessLevel: 'public' })
      .expect(200);
    try {
      const meta = await getFoto(fotoPrivadaId, null).expect(200);
      assert.equal(meta.body.camera.id, fotoPrivadaId);
      const img = await getImagem(fotoPrivadaId, null).expect(200);
      assert.match(img.headers['cache-control'], /^public,/);
    } finally {
      await supertest(app)
        .patch(`/api/v1/resource-access/sv360_project/${projetoId}/visibility`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ accessLevel: 'private' })
        .expect(200);
    }
    await getFoto(fotoPrivadaId, null).expect(404);
  });
});
