// Path: tests/integration/config-effective-invariant.repro.test.js
// Regression: an admin could brick the whole app — for everyone, including
// anonymous users — with one valid-looking config save.
//
// `map2d.minZoom <= maxZoom` was declared in config.admin.schemas.js, but
// `validate({ body })` runs on the PARTIAL that arrives in the request, and the
// custom check only fires when BOTH keys are in the same payload. The merge happens
// afterwards in `updateConfigOverrides`, and the merged document was never
// revalidated. Worse, revalidating the merged OVERRIDES would still not be enough:
// the conflict is against the STATIC base (`MAP2D_BASE` is minZoom 1 / maxZoom
// 17.9, config.static.js:23-24), which the overrides are layered onto only later,
// in `getAppConfig`. The invariant has to be checked on the EFFECTIVE document.
//
// So it takes a single PUT, not two: `{"map2d":{"minZoom":20}}` validates fine and
// yields a public /api/config serving minZoom 20 against maxZoom 17.9. And the
// admin panel emits exactly that payload by construction — `diffNum` sends only the
// changed key (frontend admin/config-tab.js), so an admin who edits just "Zoom
// mínimo" produces it through normal UI use.
//
// Then: the frontend passes both values verbatim to the MapLibre constructor, which
// throws "maxZoom must be greater than or equal to minZoom"; boot is fail-fast on
// GET /api/config with no static fallback, so the app stops loading for everyone.
// The admin sees a 200 and no sign anything is wrong. Recovery exists
// (DELETE /config/admin) but only via curl — the panel that would trigger it lives
// in the frontend that no longer boots.
//
// Why the existing coverage missed it: config-admin.test.js:127 sends
// `{minZoom: 20, maxZoom: 5}` — the one shape the payload-local check DOES catch.
// It proves the validator works on the input it was written for, and never tests
// the input the product actually produces.
//
// Negative control: remove the effective-document check and test 1 returns 200.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';
import { MAP2D_BASE } from '../../src/modules/config/config.static.js';

describe('config invariants hold on the EFFECTIVE document (repro)', () => {
  let app, db, adminTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  beforeEach(async () => {
    // Each case starts from pristine overrides, so one test's partial save cannot
    // supply the other half of another test's invariant.
    await supertest(app)
      .delete('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`);
  });

  const put = (body) =>
    supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send(body);

  it('refuses a lone minZoom that exceeds the STATIC maxZoom', async () => {
    assert.ok(
      MAP2D_BASE.maxZoom < 20,
      `fixture: the static base must make 20 an invalid minZoom (base maxZoom=${MAP2D_BASE.maxZoom})`
    );

    const res = await put({ map2d: { minZoom: 20 } });
    assert.ok(
      res.status >= 400,
      `a save that would brick the app must be refused, got ${res.status}`
    );

    // The real assertion is not the status but what the public endpoint now serves.
    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    const { minZoom, maxZoom } = cfg.body.data.map2d;
    assert.ok(
      minZoom <= maxZoom,
      `/api/config must never serve minZoom > maxZoom (got ${minZoom} > ${maxZoom})`
    );
  });

  it('refuses the invariant broken across TWO successive saves', async () => {
    // Each half is individually harmless; only the merged document is invalid.
    const first = await put({ map2d: { minZoom: 10 } });
    assert.equal(first.status, 200, 'a minZoom below the static maxZoom is a legitimate save');

    const second = await put({ map2d: { maxZoom: 5 } });
    assert.ok(second.status >= 400, `the merged document is invalid, got ${second.status}`);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    const { minZoom, maxZoom } = cfg.body.data.map2d;
    assert.ok(minZoom <= maxZoom, `still consistent (got ${minZoom} > ${maxZoom})`);
  });

  it('still accepts a legitimate partial save', async () => {
    // The fix must not turn every partial save into a rejection: the whole point of
    // the merge is that an admin can edit one field without resending the rest.
    await put({ map2d: { minZoom: 3 } }).expect(200);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.map2d.minZoom, 3, 'the legitimate override applies');
    assert.equal(
      cfg.body.data.map2d.maxZoom, MAP2D_BASE.maxZoom,
      'and the untouched half keeps its static value'
    );
  });

  it('still accepts both keys together when they are consistent', async () => {
    await put({ map2d: { minZoom: 4, maxZoom: 16 } }).expect(200);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.map2d.minZoom, 4);
    assert.equal(cfg.body.data.map2d.maxZoom, 16);
  });

  it('lowering maxZoom below an ALREADY saved minZoom is refused', async () => {
    await put({ map2d: { minZoom: 12 } }).expect(200);

    // The stored override is now the other side of the invariant — the case that
    // makes checking only the incoming payload insufficient.
    const res = await put({ map2d: { maxZoom: 8 } });
    assert.ok(res.status >= 400, `got ${res.status}`);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    const { minZoom, maxZoom } = cfg.body.data.map2d;
    assert.ok(minZoom <= maxZoom, `still consistent (got ${minZoom} > ${maxZoom})`);
  });
});
