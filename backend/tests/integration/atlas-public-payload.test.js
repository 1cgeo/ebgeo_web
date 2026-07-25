// Path: tests/integration/atlas-public-payload.test.js
// Item 126 — o payload ANÔNIMO de GET /atlas/public/:link.
//
// `FIND_ATLAS_BY_PUBLIC_LINK` é `SELECT a.*` mais duas colunas do dono: a superfície
// exposta a um chamador NÃO AUTENTICADO passa a ser definida pela TABELA, não pelo
// código. Hoje é inofensiva, mas qualquer `ALTER TABLE atlas ADD COLUMN` futuro (nota
// interna, chave, id externo) vaza para o anônimo sem que nada acuse. Os testes que
// existiam (atlas-advanced.test.js) só afirmam que id/name/publicToken EXISTEM, ou
// seja, verificam presença e nunca ausência.
//
// Um conjunto de chaves FECHADO transforma a fronteira de vazamento em decisão
// consciente: coluna nova quebra este teste, e alguém precisa dizer se ela é pública.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, makeAtlasPublic } from '../helpers/fixtures.js';

const U = () => `pubp_${randomUUID().slice(0, 8)}`;

// Allowlist EXPLÍCITA do que um anônimo pode ver. Derivada da tabela `atlas`
// (`SELECT a.*`) + as duas colunas do dono + o token efêmero. Mexer aqui é declarar
// que a coluna nova é pública.
const CHAVES_PUBLICAS = [
  'created_at',
  'current_version',
  'deleted_at',
  'description',
  'id',
  'is_public',
  'map_order',
  'min_version',
  'name',
  'owner_id',
  'owner_nome',
  'owner_username',
  'public_link',
  'publicToken',
  'settings',
  'updated_at',
  'version',
].sort();

describe('GET /atlas/public/:link — superfície exposta ao anônimo', () => {
  let app, db, owner, atlas, link;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: U(), nome: 'Dono Público' });
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    link = await makeAtlasPublic(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('sem Authorization: 200 e o conjunto de chaves é EXATAMENTE a allowlist', async () => {
    const res = await supertest(app).get(`/api/v1/atlas/public/${link}`).expect(200);

    const chaves = Object.keys(res.body.data).sort();
    // Guarda de lista não-vazia: sem isto um payload vazio passaria pelo deepEqual
    // se a allowlist também estivesse vazia.
    assert.ok(chaves.length > 5, `payload suspeito de tão pequeno: ${JSON.stringify(chaves)}`);
    assert.deepEqual(
      chaves,
      CHAVES_PUBLICAS,
      'coluna nova em `atlas` vaza para o anônimo por SELECT a.*; decida se ela é pública'
    );
  });

  it('traz `settings` (o modo visitante depende dele) e a identidade do dono', async () => {
    const res = await supertest(app).get(`/api/v1/atlas/public/${link}`).expect(200);
    const d = res.body.data;

    assert.equal(typeof d.settings, 'object');
    assert.notEqual(d.settings, null);
    assert.equal(d.owner_nome, 'Dono Público');
    assert.equal(typeof d.owner_username, 'string');
  });

  it('nenhuma chave parecida com credencial, exceto exatamente `publicToken`', async () => {
    const res = await supertest(app).get(`/api/v1/atlas/public/${link}`).expect(200);

    const suspeitas = Object.keys(res.body.data)
      .filter((k) => /token|secret|key|password|hash/i.test(k));
    assert.deepEqual(suspeitas, ['publicToken'], 'só o token efêmero de visitante pode aparecer');
    assert.equal(typeof res.body.data.publicToken, 'string');
  });

  it('atlas soft-deletado com public_link preenchido → 404 (a query filtra deleted_at)', async () => {
    const morto = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, morto.id);
    const linkMorto = await makeAtlasPublic(db, morto.id);

    // Confere que o link funcionava ANTES, senão o 404 não prova nada.
    await supertest(app).get(`/api/v1/atlas/public/${linkMorto}`).expect(200);

    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [morto.id]);
    const { rows } = await db.query('SELECT public_link FROM atlas WHERE id = $1', [morto.id]);
    assert.equal(rows[0].public_link, linkMorto, 'o link continua na linha; quem barra é deleted_at');

    await supertest(app).get(`/api/v1/atlas/public/${linkMorto}`).expect(404);
  });
});
