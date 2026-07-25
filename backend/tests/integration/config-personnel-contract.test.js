// Path: tests/integration/config-personnel-contract.test.js
// Item 94 (testes-backend.md) — `postos` and `organizacoesMilitares`, the controlled
// lists GET /api/config serves ANONYMOUSLY so the signup form can fill its dropdowns.
//
// No backend test mentioned either key, and config.test.js's TOP_KEYS does not include
// them, so deleting both from the payload was a green change. They cross the package
// boundary (frontend signup.modal.js and admin/users-tab.js build their <select>s from
// them) and they are the ONLY code path that reads the `ranks` table. A mapping slip
// (r.nome_abrev no longer becoming `abrev`, or the is_active filter falling off) breaks
// account creation silently — there is no 500 for a status assertion to catch.
//
// MERGED on 2026-07-25: `config-personnel-lists.test.js` (item 54) covered the same
// endpoint from the other direction — the whole-array key set, an API round-trip of
// deactivate/reactivate, and the `?? null` normalization of a cleared abrev/sigla.
// Two files mutating the SAME seeded rows and the SAME org, each restoring in its own
// `finally`, is a race waiting for the day the runner stops being serial. Every case
// from both files is present below; nothing was dropped in the merge.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const POSTO_KEYS = ['abrev', 'id', 'name', 'sort_order'];
const OM_KEYS = ['id', 'name', 'sigla'];

describe('GET /api/config — the controlled personnel lists', () => {
  let app, db, adminToken;
  const tag = randomUUID().slice(0, 8);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `pers_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    // Belt and braces: nothing may stay deactivated for the files that run after this one.
    await db.query("UPDATE ranks SET is_active = true WHERE nome = 'Civil'");
    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [DEFAULT_ORG_ID]);
    await teardownTestEnv(db);
  });

  const getConfig = () => supertest(app).get('/api/config').expect(200);

  it('serves both lists to an ANONYMOUS caller, non-empty', async () => {
    const res = await getConfig();
    assert.ok(Array.isArray(res.body.data.postos), 'postos must be an array');
    assert.ok(Array.isArray(res.body.data.organizacoesMilitares), 'organizacoesMilitares must be an array');
    assert.ok(res.body.data.postos.length > 0, 'the signup dropdown would be empty');
    assert.ok(res.body.data.organizacoesMilitares.length > 0, 'the OM dropdown would be empty');
  });

  it('a posto is {id: uuid, name, abrev, sort_order} — English keys, id is the FK', async () => {
    const res = await getConfig();
    const civil = res.body.data.postos.find((p) => p.name === 'Civil');
    assert.ok(civil, "the seeded 'Civil' rank must be served");
    assert.match(civil.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/i, 'id is the row UUID (users.rank_id is an FK), not a code');
    assert.equal(civil.abrev, 'Civ', 'nome_abrev is mapped to `abrev`');
    assert.equal(typeof civil.sort_order, 'number');
    // The DB column names must NOT leak: the frontend reads name/abrev.
    assert.equal(civil.nome, undefined);
    assert.equal(civil.nome_abrev, undefined);
    assert.equal(civil.is_active, undefined, 'no internal flag in a public payload');
  });

  it('postos come out ordered by sort_order (non-decreasing across the array)', async () => {
    const res = await getConfig();
    const postos = res.body.data.postos;
    assert.ok(postos.length > 1, 'ordering needs at least two entries to mean anything');
    let previous = -Infinity;
    let compared = 0;
    for (const p of postos) {
      assert.ok(p.sort_order >= previous, `sort_order went backwards at ${p.name}`);
      previous = p.sort_order;
      compared += 1;
    }
    assert.equal(compared, postos.length, 'every entry was inspected');
  });

  it('an organizacaoMilitar exposes {id, name, sigla} and nothing else', async () => {
    const res = await getConfig();
    const om = res.body.data.organizacoesMilitares.find((o) => o.id === DEFAULT_ORG_ID);
    assert.ok(om, 'the seeded default org must be served');
    assert.equal(typeof om.name, 'string');
    assert.ok('sigla' in om);
    // A public, unauthenticated payload must carry only what the dropdown needs.
    assert.equal(om.slug, undefined, 'slug is an internal addressing key, not for the dropdown');
    assert.equal(om.is_active, undefined);
    assert.equal(om.nome, undefined, 'the DB column name must not leak');
    assert.deepEqual(Object.keys(om).sort(), ['id', 'name', 'sigla']);
  });

  it('a DEACTIVATED rank disappears from the list (is_active filter)', async () => {
    const before = await getConfig();
    assert.ok(before.body.data.postos.some((p) => p.name === 'Civil'), 'baseline: it is offered');

    try {
      await db.query("UPDATE ranks SET is_active = false WHERE nome = 'Civil'");
      const after = await getConfig();
      assert.ok(
        !after.body.data.postos.some((p) => p.name === 'Civil'),
        'a deactivated rank must not be offered at signup',
      );
    } finally {
      await db.query("UPDATE ranks SET is_active = true WHERE nome = 'Civil'");
    }

    const restored = await getConfig();
    assert.ok(restored.body.data.postos.some((p) => p.name === 'Civil'), 'and it comes back');
  });

  it('a DEACTIVATED organization disappears from the list (is_active filter)', async () => {
    try {
      await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [DEFAULT_ORG_ID]);
      const after = await getConfig();
      assert.ok(
        !after.body.data.organizacoesMilitares.some((o) => o.id === DEFAULT_ORG_ID),
        'a deactivated OM must not be offered at signup',
      );
    } finally {
      await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [DEFAULT_ORG_ID]);
    }

    const restored = await getConfig();
    assert.ok(restored.body.data.organizacoesMilitares.some((o) => o.id === DEFAULT_ORG_ID));
  });

  it('features.self_registration mirrors the server flag the signup affordance reads', async () => {
    const res = await getConfig();
    assert.equal(
      res.body.data.features.self_registration,
      config.security.allowSelfRegistration,
      'the client shows "Criar conta" based on exactly this field',
    );
  });

  // ---------------------------------------------------------------------------
  // Merged from config-personnel-lists.test.js (item 54). The cases above pin the
  // shape of ONE seeded entry; these pin it for EVERY entry, plus the two behaviors
  // only reachable through the admin API.
  // ---------------------------------------------------------------------------

  it('EVERY entry of both lists has exactly the frozen key set (not just the seeded one)', async () => {
    const cfg = (await getConfig()).body.data;

    assert.ok(cfg.postos.length > 0, 'guard: an empty array would make the loop verify nothing');
    for (const posto of cfg.postos) {
      assert.deepEqual(Object.keys(posto).sort(), POSTO_KEYS, `posto ${posto.name}`);
      assert.equal(typeof posto.id, 'string', 'the option value is the FK, not the label');
      assert.equal(typeof posto.name, 'string');
    }

    assert.ok(cfg.organizacoesMilitares.length > 0, 'guard: the default org is seeded');
    for (const om of cfg.organizacoesMilitares) {
      assert.deepEqual(Object.keys(om).sort(), OM_KEYS, `OM ${om.name}`);
      assert.equal(typeof om.id, 'string');
      assert.equal(typeof om.name, 'string');
    }
  });

  it('deactivating a rank through the ADMIN API removes it, and reactivating puts it back', async () => {
    // The direct-SQL case above proves the filter; this proves the round-trip an
    // administrator actually performs, including that DELETE is a soft-delete here.
    const created = await supertest(app)
      .post('/api/v1/ranks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: `Posto Efêmero ${tag}`, nome_abrev: 'Efe' })
      .expect(201);
    const id = created.body.data.id;

    const listado = async () => (await getConfig()).body.data.postos.some((p) => p.id === id);
    assert.equal(await listado(), true, 'um posto novo e ativo é oferecido');

    await supertest(app)
      .delete(`/api/v1/ranks/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    assert.equal(await listado(), false, 'is_active = false é a única coisa que o mantém fora');

    await supertest(app)
      .put(`/api/v1/ranks/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: true })
      .expect(200);
    assert.equal(await listado(), true, 'e volta ao ser reativado');
  });

  it('a cleared abrev/sigla travels as null — not undefined, not the string "null"', async () => {
    // Honestidade sobre o que este caso prende: contra o `?? null` isolado ele é
    // TAUTOLÓGICO — o driver devolve `null` para uma coluna NULL selecionada, nunca
    // `undefined`, então remover o `?? null` não muda a resposta. O que ele prende de
    // fato é o par (coluna certa → chave certa): trocar `r.nome_abrev` por `r.nome`
    // derruba este caso e o do posto 'Civil' acima.
    const rank = await supertest(app)
      .post('/api/v1/ranks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: `Posto Sem Abrev ${tag}` })
      .expect(201);

    const om = await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: `OM Sem Sigla ${tag}`, slug: `om-sem-sigla-${tag}` })
      .expect(201);

    const cfg = (await getConfig()).body.data;
    const posto = cfg.postos.find((p) => p.id === rank.body.data.id);
    const organizacao = cfg.organizacoesMilitares.find((o) => o.id === om.body.data.id);

    assert.ok(posto, 'o posto novo é servido');
    assert.equal(posto.abrev, null);
    assert.ok(organizacao, 'a OM nova é servida');
    assert.equal(organizacao.sigla, null);
  });
});
