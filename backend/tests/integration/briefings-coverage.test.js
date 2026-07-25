// Path: tests/integration/briefings-coverage.test.js
// Coverage tests for the read-only Briefings endpoints, focused on access-filter
// edges not covered by maps-briefings.test.js (owner / read-shared / stranger).
// Briefings are GET-only; writes go through sync.
// Genuine gaps asserted here:
//  - a WRITE-shared user can read briefings (list + detail with slides)
//  - REVOKING the share flips a 200 read to 403 (no leak after revoke)
//  - cross-atlas isolation for a shared user: the briefing-detail query is
//    scoped by atlas_id, so a briefing of atlas B is 404 (not 200) when fetched
//    through atlas A by a user who can read A

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createBriefing, createSlide, loginUser, createShare,
} from '../helpers/fixtures.js';

const uniq = () => `brfc_${randomUUID().slice(0, 8)}`;

describe('Briefings — read-access coverage', () => {
  let app, db, owner, atlas, briefing;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: uniq() });
    atlas = await createAtlas(db, owner.id, { name: `brfc atlas ${uniq()}` });
    briefing = await createBriefing(db, atlas.id, { name: 'brfc-briefing' });
    await createSlide(db, briefing.id, { title: 'brfc-slide-1' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a WRITE-shared user can list briefings and read a briefing with its slides', async () => {
    const writer = await createUser(db, { username: uniq() });
    const writerToken = await loginUser(app, writer.username, writer.password);
    await createShare(db, atlas.id, writer.id, 'write', owner.id);

    const list = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings`)
      .set('Authorization', `Bearer ${writerToken}`)
      .expect(200);
    assert.ok(list.body.data.some((b) => b.id === briefing.id));

    const detail = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing.id}`)
      .set('Authorization', `Bearer ${writerToken}`)
      .expect(200);
    assert.equal(detail.body.data.id, briefing.id);
    assert.ok(Array.isArray(detail.body.data.slides));
    assert.ok(detail.body.data.slides.some((s) => s.title === 'brfc-slide-1'));
  });

  // 404 e não 403 desde 2026-07-25: revogado o share, o leitor deixa de ter QUALQUER relação
  // com o atlas, e a resposta passa a ser indistinguível de atlas inexistente. Ver
  // tests/integration/atlas-404-vs-403-escada.test.js.
  it('NEGATIVE: revoking a read share flips briefing reads from 200 to 404', async () => {
    const reader = await createUser(db, { username: uniq() });
    const readerToken = await loginUser(app, reader.username, reader.password);
    await createShare(db, atlas.id, reader.id, 'read', owner.id);

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(200);
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing.id}`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(200);

    await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, reader.id]);

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(404);
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing.id}`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(404);
  });

  it('NEGATIVE: a user with read access to atlas A gets 404 for a briefing that belongs to atlas B (atlas-scoped query)', async () => {
    const sharedUser = await createUser(db, { username: uniq() });
    const sharedToken = await loginUser(app, sharedUser.username, sharedUser.password);
    await createShare(db, atlas.id, sharedUser.id, 'read', owner.id);

    // Atlas B (also owned by the same user so the shared user could otherwise
    // be tricked) with its own briefing.
    const atlasB = await createAtlas(db, owner.id, { name: `brfc atlasB ${uniq()}` });
    const briefingB = await createBriefing(db, atlasB.id, { name: 'brfc-briefingB' });

    // The permission gate passes for atlas A (the URL path), but the detail
    // query is scoped (briefing_id, atlas_id) -> briefing B is not found -> 404.
    const viaA = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/${briefingB.id}`)
      .set('Authorization', `Bearer ${sharedToken}`)
      .expect(404);

    // E o mesmo briefing pelo caminho do atlas B tambem da 404, agora porque o chamador nao
    // tem relacao nenhuma com B (era 403 ate 2026-07-25).
    const viaB = await supertest(app)
      .get(`/api/v1/atlas/${atlasB.id}/briefings/${briefingB.id}`)
      .set('Authorization', `Bearer ${sharedToken}`)
      .expect(404);

    // As duas sao 404 por motivos DIFERENTES (escopo da query contra gate de acesso) e as
    // mensagens DIFEREM ('Briefing not found' contra 'Atlas not found'). Isso e correto, e
    // escrevi este caso exigindo mensagens iguais antes de perceber por que nao deve ser.
    //
    // A propriedade que a escada garante nao e "as duas respostas sao iguais entre si", e
    // "cada resposta e indistinguivel do seu PROPRIO caso inexistente". Colapsar as duas
    // custaria diagnostico a um usuario legitimo (quem tem acesso a A e digitou o id errado
    // merece ouvir que o briefing nao esta em A) sem fechar oraculo nenhum, porque nenhuma
    // das duas revela existencia. E isso que os dois pares abaixo afirmam.
    const briefingInexistenteEmA = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/${randomUUID()}`)
      .set('Authorization', `Bearer ${sharedToken}`)
      .expect(404);
    const atlasInexistente = await supertest(app)
      .get(`/api/v1/atlas/${randomUUID()}/briefings/${briefingB.id}`)
      .set('Authorization', `Bearer ${sharedToken}`)
      .expect(404);

    // Ancora anti-vacuidade: sem ela, dois envelopes sem campo `error` comparariam
    // undefined com undefined e o caso passaria provando nada.
    assert.equal(viaA.body.error.code, 'NOT_FOUND');
    assert.equal(viaB.body.error.code, 'NOT_FOUND');

    assert.equal(viaA.body.error.message, briefingInexistenteEmA.body.error.message,
      'briefing de outro atlas tem que soar igual a briefing que nao existe');
    assert.equal(viaB.body.error.message, atlasInexistente.body.error.message,
      'atlas sem acesso tem que soar igual a atlas que nao existe');
  });

  it('NEGATIVE: a logged-in stranger cannot list briefings (404, no data leaked)', async () => {
    const stranger = await createUser(db, { username: uniq() });
    const strangerToken = await loginUser(app, stranger.username, stranger.password);

    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(404);
    assert.ok(!res.body.data, 'no data leaked in a 404');
  });
});
