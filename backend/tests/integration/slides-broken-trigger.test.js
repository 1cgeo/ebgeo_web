// Path: tests/integration/slides-broken-trigger.test.js
// Item 104 — trg_mark_slides_broken (002_atlas.sql): o soft-delete de um mapa
// marca os slides que o referenciam como quebrados.
//
// Comportamento inteiro implementado em plpgsql, com ZERO teste: os únicos hits de
// `is_broken` em tests/ eram uma op de sync setando o campo à mão, o que passaria
// idêntico se o trigger não existisse. Perdido o trigger numa migração futura, ou
// invertida a sua guarda, um briefing apresenta slide apontando para mapa
// inexistente e nada acusa.
//
// Duas consequências NÃO DECIDIDAS ficam pinadas aqui para que mudá-las passe a
// ser decisão explícita: o trigger escreve em `slides` FORA do pipeline de sync
// (nenhuma linha em `operations`, nenhum broadcast, `atlas.current_version`
// inalterado pelo próprio trigger), e a operação inversa não existe (restaurar o
// mapa deixa o slide quebrado para sempre).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createBriefing, createSlide, loginUser,
} from '../helpers/fixtures.js';

describe('trg_mark_slides_broken (item 104)', () => {
  let app, db, user, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `brk_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const deletarMapaPorSync = (mapId) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          id: randomUUID(),
          type: 'delete',
          target: 'map',
          targetId: mapId,
          timestamp: Date.now(),
          clientId: 'brk-client',
        }],
      });

  const lerSlide = async (id) => {
    const { rows } = await db.query(
      'SELECT is_broken, broken_reason, version, deleted_at FROM slides WHERE id = $1',
      [id]
    );
    assert.equal(rows.length, 1, 'o slide precisa existir');
    return rows[0];
  };

  it('soft-delete do mapa marca o slide como quebrado e incrementa version em exatamente 1', async () => {
    const mapa = await createMap(db, atlas.id);
    const outroMapa = await createMap(db, atlas.id);
    const briefing = await createBriefing(db, atlas.id);
    const slide = await createSlide(db, briefing.id, { mode: '2d', map_id: mapa.id });
    const slideDeOutroMapa = await createSlide(db, briefing.id, { mode: '2d', map_id: outroMapa.id });

    const antes = await lerSlide(slide.id);
    assert.equal(antes.is_broken, false, 'baseline: o slide nasce íntegro');

    await deletarMapaPorSync(mapa.id).expect(200);

    const depois = await lerSlide(slide.id);
    assert.equal(depois.is_broken, true);
    assert.equal(depois.broken_reason, 'map_deleted');
    assert.equal(depois.version, antes.version + 1, 'version sobe exatamente 1');

    // O WHERE map_id do trigger: o slide do OUTRO mapa não é tocado.
    const vizinho = await lerSlide(slideDeOutroMapa.id);
    assert.equal(vizinho.is_broken, false, 'só os slides do mapa apagado são marcados');
  });

  it('slide já soft-deletado NÃO é marcado (guarda AND deleted_at IS NULL)', async () => {
    const mapa = await createMap(db, atlas.id);
    const briefing = await createBriefing(db, atlas.id);
    const slide = await createSlide(db, briefing.id, { mode: '2d', map_id: mapa.id });
    await db.query('UPDATE slides SET deleted_at = NOW() WHERE id = $1', [slide.id]);
    const antes = await lerSlide(slide.id);

    await deletarMapaPorSync(mapa.id).expect(200);

    const depois = await lerSlide(slide.id);
    assert.equal(depois.is_broken, false, 'slide apagado não vira slide quebrado');
    assert.equal(depois.version, antes.version, 'e sua version não é mexida');
  });

  it('UPDATE em maps que não toca deleted_at não marca slide nenhum', async () => {
    const mapa = await createMap(db, atlas.id);
    const briefing = await createBriefing(db, atlas.id);
    const slide = await createSlide(db, briefing.id, { mode: '2d', map_id: mapa.id });
    const antes = await lerSlide(slide.id);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          id: randomUUID(), type: 'update', target: 'map', targetId: mapa.id,
          changes: { name: `Renomeado ${randomUUID().slice(0, 6)}` },
          timestamp: Date.now(), clientId: 'brk-client',
        }],
      })
      .expect(200);

    const depois = await lerSlide(slide.id);
    assert.equal(depois.is_broken, false, 'o trigger é AFTER UPDATE OF deleted_at');
    assert.equal(depois.version, antes.version);
  });

  it('um segundo delete do mesmo mapa não re-incrementa version (guarda OLD.deleted_at IS NULL)', async () => {
    const mapa = await createMap(db, atlas.id);
    const briefing = await createBriefing(db, atlas.id);
    const slide = await createSlide(db, briefing.id, { mode: '2d', map_id: mapa.id });

    await deletarMapaPorSync(mapa.id).expect(200);
    const primeiro = await lerSlide(slide.id);
    assert.equal(primeiro.is_broken, true);

    // Segundo UPDATE de deleted_at sobre um mapa JÁ apagado.
    await db.query('UPDATE maps SET deleted_at = NOW() WHERE id = $1', [mapa.id]);

    const segundo = await lerSlide(slide.id);
    assert.equal(segundo.version, primeiro.version, 'OLD.deleted_at IS NULL impede o re-disparo');
  });

  it('a marcação acontece FORA do pipeline de sync: nenhuma op para o slide', async () => {
    const mapa = await createMap(db, atlas.id);
    const briefing = await createBriefing(db, atlas.id);
    const slide = await createSlide(db, briefing.id, { mode: '2d', map_id: mapa.id });

    await deletarMapaPorSync(mapa.id).expect(200);

    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM operations WHERE entity_id = $1',
      [slide.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].n, 0, 'o peer conectado NÃO recebe a mudança do slide — só a descobre em snapshot novo');

    const marcado = await lerSlide(slide.id);
    assert.equal(marcado.is_broken, true, 'guarda: o efeito de fato ocorreu (senão o zero acima seria vácuo)');
  });

  it('restaurar o mapa NÃO desfaz a marcação (assimetria deliberada, pinada)', async () => {
    const mapa = await createMap(db, atlas.id);
    const briefing = await createBriefing(db, atlas.id);
    const slide = await createSlide(db, briefing.id, { mode: '2d', map_id: mapa.id });

    await deletarMapaPorSync(mapa.id).expect(200);
    assert.equal((await lerSlide(slide.id)).is_broken, true);

    await db.query('UPDATE maps SET deleted_at = NULL WHERE id = $1', [mapa.id]);

    const depois = await lerSlide(slide.id);
    assert.equal(depois.is_broken, true, 'não existe operação inversa');
    assert.equal(depois.broken_reason, 'map_deleted');
  });
});
