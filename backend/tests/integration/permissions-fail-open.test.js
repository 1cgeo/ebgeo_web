// Path: tests/integration/permissions-fail-open.test.js
//
// Item 34 (com a lacuna restante do item 35 no fim).
//
// `requireAtlasPermission` comparava `resolvedLevel < PERMISSION_LEVELS[requiredLevel]`.
// Para um nível desconhecido — 'managee', 'writes', 'READ' — o lado direito é
// `undefined`, e `3 < undefined` é `false` (comparação com NaN), então o middleware
// chamava `next()`: UM erro de digitação em UMA rota liberava aquela rota para
// QUALQUER portador de qualquer nível, inclusive o anônimo num atlas público, que
// resolve 'read'. É o oposto de fail-closed, e não havia rede nenhuma: as 28 call sites
// estavam corretas por sorte, não por verificação — nenhum teste do repositório
// alimentava o middleware com um nível inválido.
//
// A correção é fail-CLOSED em tempo de MONTAGEM (`permissions.js:57-74`): a fábrica
// lança `TypeError` para nível desconhecido, então a digitação vira falha de boot em
// vez de porta aberta. O caso simétrico (um valor de `atlas_shares.permission` fora do
// CHECK, que também daria `undefined < 4 === false`) fecha no runtime.
//
// Este arquivo prova as três coisas que sustentam a porta: a fábrica recusa o inválido,
// o harness sabe barrar E deixar passar com níveis VÁLIDOS (senão o assert de recusa
// não distinguiria "fechou" de "quebrou"), e nenhuma das call sites reais usa um nível
// inexistente — com guarda anti-cobertura-vazia sobre o número de call sites achadas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createShare, loginUser, makeAtlasPublic,
} from '../helpers/fixtures.js';
import { requireAtlasPermission, PERMISSION_LEVELS } from '../../src/middleware/permissions.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { recordSpan, getTrace } from '../../src/utils/sync-trace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = join(__dirname, '..', '..', 'src', 'modules');

/** Recursively collects every *.routes.js under src/modules. */
function routeFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry.endsWith('.routes.js')) out.push(full);
  }
  return out;
}

describe('requireAtlasPermission — fail-closed on an unknown level (34)', () => {
  let app, db, owner, stranger, atlasPublic, atlasPrivate;
  const sfx = randomUUID().slice(0, 8);

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    owner = await createUser(db, { username: `fo_own_${sfx}` });
    stranger = await createUser(db, { username: `fo_str_${sfx}` });
    atlasPublic = await createAtlas(db, owner.id, { name: `FO pub ${sfx}` });
    atlasPrivate = await createAtlas(db, owner.id, { name: `FO priv ${sfx}` });
    await makeAtlasPublic(db, atlasPublic.id);

    // Mini-app: the REAL middleware, a real atlas, and a real principal — only the
    // surrounding router is replaced. `auth` is not needed: the point is the LEVEL
    // comparison, so the principal is injected directly.
    app = express();
    app.use((req, res, next) => {
      req.user = {
        id: stranger.id, username: stranger.username, role: 'user',
        organization_id: null, isPublic: false, publicAtlasId: null,
      };
      next();
    });
    for (const level of Object.keys(PERMISSION_LEVELS)) {
      app.get(
        `/probe/${level}/:atlasId`,
        requireAtlasPermission(level),
        (req, res) => res.json({ data: { permission: req.atlasPermission } })
      );
    }
    app.use(errorHandler);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('the factory refuses an unknown level at MOUNT time', () => {
    // Cada string abaixo é uma digitação plausível numa linha de rota.
    for (const bad of ['managee', 'writes', 'READ', 'Owner', 'admin', 'edit', '', ' read']) {
      it(`requireAtlasPermission(${JSON.stringify(bad)}) throws instead of returning an open gate`, () => {
        assert.throws(() => requireAtlasPermission(bad), TypeError);
      });
    }

    for (const bad of [undefined, null, 0, 1, true, {}, ['read']]) {
      it(`requireAtlasPermission(${JSON.stringify(bad) ?? String(bad)}) throws too`, () => {
        assert.throws(() => requireAtlasPermission(bad), TypeError);
      });
    }

    it('an INHERITED Object property is not a level either (prototype is not a permission)', () => {
      // `'toString' in PERMISSION_LEVELS` is true; `Object.hasOwn` is what makes this
      // check honest. A plain `in` would accept 'constructor' and mount an open gate.
      assert.throws(() => requireAtlasPermission('toString'), TypeError);
      assert.throws(() => requireAtlasPermission('constructor'), TypeError);
      assert.throws(() => requireAtlasPermission('hasOwnProperty'), TypeError);
    });

    it('the message names the offending value and the accepted set (a boot failure has to be readable)', () => {
      const levels = Object.keys(PERMISSION_LEVELS);
      assert.equal(levels.length, 5, 'guard: an empty level set would make the loop below vacuous');
      assert.throws(() => requireAtlasPermission('managee'), (err) => {
        assert.match(err.message, /managee/);
        assert.ok(levels.length > 0, 'guard: an empty level set would make the loop below vacuous');
        for (const level of levels) {
          assert.match(err.message, new RegExp(level));
        }
        return true;
      });
    });

    it('control: every VALID level still builds a middleware function', () => {
      const levels = Object.keys(PERMISSION_LEVELS);
      assert.equal(levels.length, 5, 'the hierarchy has five levels: read < comment < write < manage < owner');
      for (const level of levels) {
        const mw = requireAtlasPermission(level);
        assert.equal(typeof mw, 'function');
        assert.equal(mw.length, 3, 'an express middleware takes (req, res, next)');
      }
    });
  });

  describe('control do harness: com níveis VÁLIDOS ele sabe barrar E deixar passar', () => {
    // Sem estes dois, o "throw" acima provaria apenas que uma função lança, e não que
    // o gate que ela produz é o que separa 200 de 403.
    it('a stranger on a PUBLIC atlas passes read (resolve to read via isPublic)', async () => {
      const res = await supertest(app).get(`/probe/read/${atlasPublic.id}`).expect(200);
      assert.equal(res.body.data.permission, 'read');
    });

    it('the same stranger on the same PUBLIC atlas is 403 at manage', async () => {
      // Este é o caso que a fábrica com typo abria: 'managee' respondia 200 aqui.
      const res = await supertest(app).get(`/probe/manage/${atlasPublic.id}`).expect(403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('403 at every level above read, one by one (a hierarquia inteira, não só o topo)', async () => {
      for (const level of ['comment', 'write', 'manage', 'owner']) {
        const res = await supertest(app).get(`/probe/${level}/${atlasPublic.id}`);
        assert.equal(res.status, 403, `level ${level} must refuse a public-read principal`);
      }
    });

    it('a PRIVATE atlas refuses the stranger even at read', async () => {
      // 404, not 403: on the private atlas this principal has no share and the atlas is
      // not public, so nothing resolves and the escada answers NotFound. The 403s in the
      // three cases above stay 403 because there the atlas IS public, so `read` resolves
      // and the refusal really is about the tier — which is what this block controls for.
      await supertest(app).get(`/probe/read/${atlasPrivate.id}`).expect(404);
    });

    it('a share raises exactly to its tier and no further', async () => {
      await createShare(db, atlasPrivate.id, stranger.id, 'manage', owner.id);
      for (const [level, expected] of [
        ['read', 200], ['comment', 200], ['write', 200], ['manage', 200], ['owner', 403],
      ]) {
        const res = await supertest(app).get(`/probe/${level}/${atlasPrivate.id}`);
        assert.equal(res.status, expected, `manage share vs required ${level}`);
      }
    });
  });

  describe('static sweep: no route file mounts a level that does not exist', () => {
    it('every requireAtlasPermission(X) in src/modules uses a real level', () => {
      const files = routeFiles(MODULES_DIR);
      assert.ok(files.length >= 8, `expected several *.routes.js files, found ${files.length}`);

      const found = [];
      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/requireAtlasPermission\(\s*(['"`])([^'"`]*)\1\s*\)/g)) {
          found.push({ file, level: m[2] });
        }
      }

      // Guarda anti-cobertura-vazia (C4): se o regex parar de casar — renomeação,
      // quebra de linha, import com alias — a varredura acima vira um laço sobre zero
      // itens e passaria verde sem verificar nada.
      assert.ok(
        found.length >= 25,
        `expected >= 25 requireAtlasPermission call sites, found ${found.length} — the sweep is not matching`
      );

      const bad = found.filter((f) => !Object.hasOwn(PERMISSION_LEVELS, f.level));
      assert.deepEqual(bad, [], `route(s) mounting an unknown permission level: ${JSON.stringify(bad)}`);
    });

    it('non-literal call sites would escape the sweep — assert there are none', () => {
      // A varredura acima só enxerga literais. Se alguém passar uma variável, o teste
      // acima continua verde e não cobre a chamada; então proibimos a forma.
      const offenders = [];
      for (const file of routeFiles(MODULES_DIR)) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/requireAtlasPermission\(\s*([^)]*)\)/g)) {
          if (!/^\s*(['"`])[^'"`]*\1\s*$/.test(m[1])) offenders.push(`${file}: ${m[0]}`);
        }
      }
      assert.deepEqual(offenders, [], 'requireAtlasPermission must be called with a string literal');
    });
  });

  describe('the symmetric fail-open: a share permission outside the CHECK', () => {
    it('the column CHECK is what makes the resolved side unreachable — assert it still holds', async () => {
      // `resolvedLevel` viria undefined para um valor fora do CHECK, e `undefined < 4`
      // também é false. O runtime agora recusa explicitamente, mas o CHECK é a razão de
      // esse ramo ser inalcançável hoje: se ele cair, a defesa passa a ser só o código.
      await assert.rejects(
        () => db.query(
          `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1,$2,$3,$4)`,
          [atlasPublic.id, stranger.id, 'superuser', owner.id]
        ),
        (err) => {
          assert.equal(err.code, '23514', 'expected a CHECK violation');
          return true;
        }
      );
    });

    it('the CHECK accepts exactly the four storable levels (owner is synthesized, never stored)', async () => {
      for (const level of ['read', 'comment', 'write', 'manage']) {
        const a = await createAtlas(db, owner.id, { name: `FO ck ${level} ${sfx}` });
        await createShare(db, a.id, stranger.id, level, owner.id);
      }
      const a = await createAtlas(db, owner.id, { name: `FO ck owner ${sfx}` });
      await assert.rejects(
        () => createShare(db, a.id, stranger.id, 'owner', owner.id),
        (err) => err.code === '23514'
      );
    });
  });
});

// ============================================================================
// 35 — a lacuna que sobrou: o caminho POSITIVO ponta a ponta do ring por atlas.
// Os negativos (403 de estranho, DELETE 'write' -> 403 / 'manage' -> 200, 400 sem
// atlasId, IDOR cross-atlas) já vivem em cross-tenant-negativos.test.js. O que faltava
// era provar que um push REAL escreve no ring do atlas certo e que o dono o lê de
// volta pela rota gateada — sem isso, todo aquele negativo poderia estar passando
// sobre um ring que nunca recebe nada.
// ============================================================================
describe('35 — /debug/trace serves the atlas ring fed by a real sync push', () => {
  let app, db, owner, token, atlas;
  const sfx = randomUUID().slice(0, 8);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `tr_own_${sfx}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `TR ${sfx}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a push by the owner leaves server.inserted spans readable through GET /trace', async () => {
    await supertest(app)
      .delete(`/api/v1/debug/trace?atlasId=${atlas.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Um mapa é a entidade mais barata de criar por sync (nenhuma FK a preencher antes).
    const opId = randomUUID();
    const mapId = randomUUID();
    const push = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          id: opId,
          entityType: 'map',
          operationType: 'create',
          entityId: mapId,
          data: { id: mapId, name: `TR map ${sfx}` },
          timestamp: Date.now(),
          clientId: `tr-${sfx}`,
        }],
      })
      .expect(200);
    assert.ok(push.body.data, 'the push itself must succeed, otherwise the ring is empty for the wrong reason');

    const res = await supertest(app)
      .get(`/api/v1/debug/trace?atlasId=${atlas.id}&opId=${opId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.data.enabled, true);
    const stages = res.body.data.spans.map((s) => s.stage);
    assert.ok(
      stages.includes('server.inserted'),
      `expected a server.inserted span for the pushed op, got: ${JSON.stringify(stages)}`
    );
    assert.ok(res.body.data.spans.length > 0, 'guard: an empty ring would make the loop vacuous');
    for (const span of res.body.data.spans) {
      assert.equal(span.atlasId, atlas.id, 'every span served must belong to the queried atlas');
      assert.equal(span.opId, opId, 'the opId filter must actually filter');
    }
  });

  it('the opId filter is real: an unrelated span in the same ring is not returned', async () => {
    const other = randomUUID();
    recordSpan(atlas.id, 'server.inserted', { opId: other });
    assert.equal(getTrace(atlas.id, { opId: other }).length, 1, 'the ring holds the seeded span');

    const res = await supertest(app)
      .get(`/api/v1/debug/trace?atlasId=${atlas.id}&opId=${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(res.body.data.spans.length, 0);
  });
});
