// Path: tests/integration/upload-recusado-nao-grava-blob.test.js
//
// O QUE ESTE ARQUIVO PRENDE: a ORDEM dos middlewares de `POST /atlas/:atlasId/images`, pelo
// EFEITO dela no disco. O gate de permissão vem ANTES do multer (`images.routes.js`), e é isso
// que faz uma recusa não custar byte nenhum. Nenhum teste cobrava essa propriedade: o irmão
// `upload-negado-perde-a-resposta.repro.test.js` afirma que o 403 CHEGA ao cliente (era um
// ECONNRESET), e cita a ordem só em comentário; os outros que contam blobs medem recusas que
// acontecem DEPOIS do multer (tipo inválido, tamanho, id de outro atlas).
//
// POR QUE A PROPRIEDADE IMPORTA, e é a mesma lição que `app.js` já pagou no seletor do parser
// de corpo do `/images/bulk`: enquanto o gate rodava depois do parse, o consumo de memória que
// o config chamava de "autenticado" era alcançável por qualquer um. Aqui o recurso é DISCO, e
// o custo de inverter a ordem é um arquivo por tentativa recusada, escrito por quem não tem
// acesso ao atlas — e limpo por ninguém, porque o controller nunca roda.
//
// CONTROLE NEGATIVO EXECUTADO em 13/09/2026: movendo `uploadSingleImage` para ANTES de
// `requireAtlasPermission('write')` na rota, os três primeiros casos ficam vermelhos com um
// blob órfão no diretório do atlas.
//
// CONTROLE POSITIVO: o último caso exige que o upload legítimo continue gravando UM blob.
// Sem ele, "zero blobs" seria satisfeito por um servidor que parou de aceitar imagem.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join } from 'path';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { contarBlobs } from '../helpers/blobs-em-disco.js';
import {
  createUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';

// PNG 1x1 válido: o serviço confere os bytes mágicos, então um texto qualquer seria recusado
// pelo motivo errado e o teste mediria outra coisa.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

describe('upload recusado não grava blob (ordem gate → multer)', () => {
  let app, db, dono, escritor, leitor, revogado, estranho;
  let tokEscritor, tokLeitor, tokRevogado, tokEstranho, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const rid = randomUUID().slice(0, 8);
    dono = await createUser(db, { username: `ub_own_${rid}` });
    escritor = await createUser(db, { username: `ub_wr_${rid}` });
    leitor = await createUser(db, { username: `ub_rd_${rid}` });
    revogado = await createUser(db, { username: `ub_rev_${rid}` });
    estranho = await createUser(db, { username: `ub_str_${rid}` });

    tokEscritor = await loginUser(app, escritor.username, escritor.password);
    tokLeitor = await loginUser(app, leitor.username, leitor.password);
    tokRevogado = await loginUser(app, revogado.username, revogado.password);
    tokEstranho = await loginUser(app, estranho.username, estranho.password);

    atlas = await createAtlas(db, dono.id, { name: 'Atlas do upload recusado' });
    await createShare(db, atlas.id, escritor.id, 'write', dono.id);
    await createShare(db, atlas.id, leitor.id, 'read', dono.id);
    await createShare(db, atlas.id, revogado.id, 'write', dono.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Blobs de VERDADE no diretório do atlas (0 quando ele nem existe). */
  const blobs = () => contarBlobs(join(config.images.dir, atlas.id));

  const enviar = (tok) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/images`)
    .set('Authorization', `Bearer ${tok}`)
    .attach('image', PNG, 'x.png');

  it('nível read é recusado e não deixa arquivo', async () => {
    const antes = blobs();
    const r = await enviar(tokLeitor);
    assert.equal(r.status, 403, 'quem tem share de leitura leva 403, não 404');
    assert.equal(blobs(), antes, 'a recusa não podia custar um arquivo');
  });

  it('share REVOGADO é recusado (404) e não deixa arquivo', async () => {
    await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, revogado.id]);
    const antes = blobs();
    const r = await enviar(tokRevogado);
    assert.equal(r.status, 404, 'sem relação nenhuma com o atlas a resposta é 404');
    assert.equal(blobs(), antes, 'a recusa não podia custar um arquivo');
  });

  it('estranho é recusado (404) e não deixa arquivo', async () => {
    const antes = blobs();
    const r = await enviar(tokEstranho);
    assert.equal(r.status, 404);
    assert.equal(blobs(), antes, 'a recusa não podia custar um arquivo');
  });

  it('a rota de LOTE também recusa o revogado, sem linha e sem arquivo', async () => {
    const antes = blobs();
    const { rows: contaAntes } = await db.query(
      'SELECT COUNT(*)::int AS c FROM images WHERE atlas_id = $1', [atlas.id]);
    const r = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
      .set('Authorization', `Bearer ${tokRevogado}`)
      .send({
        images: [{
          localId: randomUUID(), filename: 'x.png', mimeType: 'image/png',
          data: PNG.toString('base64'),
        }],
      });
    assert.equal(r.status, 404);
    const { rows: contaDepois } = await db.query(
      'SELECT COUNT(*)::int AS c FROM images WHERE atlas_id = $1', [atlas.id]);
    assert.equal(contaDepois[0].c, contaAntes[0].c, 'nenhuma linha podia entrar');
    assert.equal(blobs(), antes, 'nenhum arquivo podia entrar');
  });

  it('e o revogado também deixa de BAIXAR o que já existia', async () => {
    const enviado = await enviar(tokEscritor).expect(201);
    const id = enviado.body.data.id;
    const ok = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
      .set('Authorization', `Bearer ${tokEscritor}`);
    assert.equal(ok.status, 200, 'controle positivo: quem tem acesso continua baixando');
    const negado = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
      .set('Authorization', `Bearer ${tokRevogado}`);
    assert.equal(negado.status, 404, 'o revogado não alcança os bytes que já estavam lá');
  });

  // ── CONTROLE POSITIVO ────────────────────────────────────────────────────────────
  it('o upload legítimo continua gravando UM arquivo', async () => {
    const antes = blobs();
    await enviar(tokEscritor).expect(201);
    assert.equal(blobs(), antes + 1, 'o caminho bom tinha de gravar exatamente um');
  });
});
