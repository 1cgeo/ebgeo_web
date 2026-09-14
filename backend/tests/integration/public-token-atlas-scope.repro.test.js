// Path: tests/integration/public-token-atlas-scope.repro.test.js
// Regression: the read-only visitor token was scoped to ONE atlas everywhere
// except the HTTP path, where the scope was never checked.
//
// `getAtlasByPublicLink` mints the token with an `atlasId` claim
// (atlas.service.js:144-154) — the token declares which atlas it is for. The WS
// gateway honours it explicitly (`if (payload.atlasId !== atlasId) return null`,
// collab.gateway.js:55-57). HTTP never did:
//
//   - `flexibleAuth.mapPayload` and `auth.verifyAndMapUser` both map only
//     sub/username/nome/posto/role/org, so the claim never reaches the middleware;
//   - `auth` exempts non-UUID principals from reconciliation (auth.js:80-82), with a
//     comment asserting their authority is "enforced by requireAtlasPermission";
//   - `requireAtlasPermission` uses `sub` only to skip the share lookup and falls
//     through to the `isPublic` branch (permissions.js:42-44, 92), returning 'read'
//     for ANY public atlas.
//
// So the comment documented a guard that did not exist. A visitor holding the token
// for atlas A could read atlas B — GET /atlas/:id, /maps, /maps/:mapId and
// /sync/:version, the last being the full operation history — knowing only B's UUID.
//
// Scope, stated honestly (per the verifier's correction): this is an escalation from
// ANONYMOUS to read-equivalent, not "the secret link stops mattering". Any
// authenticated user already gets 'read' on any public atlas by the pre-existing
// design of the isPublic branch. It only reaches atlases the owner deliberately
// published, needs the target UUID (the API does not enumerate), lasts an hour, and
// grants no writes. The defect is the asymmetry: two transports disagree about what
// the same token authorizes, and the weaker one wins.
//
// Negative control: drop the publicAtlasId comparison in permissions.js and the
// cross-atlas tests below return 200.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap } from '../helpers/fixtures.js';

describe('a visitor token is bound to its own atlas (repro)', () => {
  let app, db;
  let atlasA, atlasB, mapB, tokenA;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const ownerA = await createUser(db, { username: `pubA_${randomUUID().slice(0, 8)}` });
    const ownerB = await createUser(db, { username: `pubB_${randomUUID().slice(0, 8)}` });

    atlasA = await createAtlas(db, ownerA.id, { name: 'Atlas Publicado A' });
    atlasB = await createAtlas(db, ownerB.id, { name: 'Atlas Publicado B' });
    mapB = await createMap(db, atlasB.id, { name: 'Mapa do B' });

    // Both owners publish. B's secret link is never given to the visitor.
    const linkA = randomUUID().replace(/-/g, '');
    const linkB = randomUUID().replace(/-/g, '');
    await db.query('UPDATE atlas SET is_public = true, public_link = $2 WHERE id = $1', [atlasA.id, linkA]);
    await db.query('UPDATE atlas SET is_public = true, public_link = $2 WHERE id = $1', [atlasB.id, linkB]);

    // The visitor legitimately follows A's public link.
    const res = await supertest(app).get(`/api/v1/atlas/public/${linkA}`).expect(200);
    tokenA = res.body.data.publicToken;
    assert.ok(tokenA, 'fixture: the public link really issues a visitor token');
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const asVisitor = (path) =>
    supertest(app).get(path).set('Authorization', `Bearer ${tokenA}`);

  it('still reads the atlas it was issued for', async () => {
    // The fix must not break the feature: the token has to keep working for A.
    const res = await asVisitor(`/api/v1/atlas/${atlasA.id}`).expect(200);
    assert.equal(res.body.data.id, atlasA.id);
  });

  it('cannot read a DIFFERENT public atlas by UUID', async () => {
    const res = await asVisitor(`/api/v1/atlas/${atlasB.id}`);
    assert.equal(res.status, 403, `a token minted for A must not read B, got ${res.status}`);
  });

  it('cannot read another atlas maps, nor a single map', async () => {
    assert.equal((await asVisitor(`/api/v1/atlas/${atlasB.id}/maps`)).status, 403);
    assert.equal((await asVisitor(`/api/v1/atlas/${atlasB.id}/maps/${mapB.id}`)).status, 403);
  });

  it('cannot pull another atlas full operation history', async () => {
    // The sharpest of the four: /sync/:version returns the whole snapshot.
    const res = await asVisitor(`/api/v1/atlas/${atlasB.id}/sync/0`);
    assert.equal(res.status, 403, `snapshot of B must be refused, got ${res.status}`);
  });

  it('the HTTP path now agrees with the WS gateway, which always refused', async () => {
    // The WS guard (collab.gateway.js:55-57) was already correct; this asserts the
    // two transports reach the SAME verdict for the same token, since the bug was
    // precisely that they disagreed.
    const httpB = await asVisitor(`/api/v1/atlas/${atlasB.id}`);
    const httpA = await asVisitor(`/api/v1/atlas/${atlasA.id}`);
    assert.equal(httpA.status, 200, 'own atlas: allowed on both transports');
    assert.equal(httpB.status, 403, 'other atlas: refused on both transports');
  });

  it('is read-only even on its OWN atlas: write routes are refused', async () => {
    // resolvePermission gives the visitor 'read' via the isPublic branch, so anything
    // above that tier must fail on A too, not only on B.
    const put = await supertest(app)
      .put(`/api/v1/atlas/${atlasA.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'sequestrado' });
    assert.equal(put.status, 403);

    const push = await supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ operations: [] });
    assert.equal(push.status, 403);

    const { rows } = await db.query('SELECT name FROM atlas WHERE id = $1', [atlasA.id]);
    assert.equal(rows[0].name, 'Atlas Publicado A');
  });

  it('POST /clone passes the read gate, so the non-UUID principal must fail CLEANLY', async () => {
    // The clone route is gated at 'read', which the visitor satisfies. The identity
    // behind the token is `public-<uuid>`, not a UUID, so it cannot become
    // atlas.owner_id — that has to surface as a clean 4xx, never a 500, and above all
    // never an atlas owned by a principal that does not exist in `users`.
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/clone`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    assert.ok(res.status >= 400 && res.status < 500, `expected a clean 4xx, got ${res.status}`);
    assert.notEqual(res.body.error?.code, 'INTERNAL_ERROR');

    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM atlas WHERE owner_id::text LIKE 'public-%'"
    );
    assert.equal(rows[0].n, 0, 'no atlas may be owned by a visitor principal');
  });

  it('an ordinary authenticated user still reads a public atlas (unchanged by design)', async () => {
    // Guards the blast radius of the fix: the isPublic branch is pre-existing and
    // deliberate for real users. Narrowing it here would be an unrelated behaviour
    // change smuggled in with a security fix.
    const someone = await createUser(db, { username: `plain_${randomUUID().slice(0, 8)}` });
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: someone.username, password: someone.password })
      .expect(200);

    await supertest(app)
      .get(`/api/v1/atlas/${atlasB.id}`)
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
  });

  // "O LINK É REVOGÁVEL" É A TERCEIRA AFIRMAÇÃO DA CLÁUSULA 5.4, e é esta a metade que
  // importa para segurança: não é que um link novo deixe de ser emitido, é que o token JÁ
  // EMITIDO pare de valer. Ele vale uma hora e mora só na memória do visitante, então entre
  // a revogação e o vencimento existe uma janela em que nada do lado do cliente o alcança.
  //
  // A cláusula cita este arquivo, e ele não tinha caso de revogação nenhum. O que existia,
  // noutro arquivo e sem citação, era a ROTAÇÃO do link ao republicar, que é outra pergunta:
  // ela mede o ENDEREÇO, não a credencial já entregue.
  //
  // O mecanismo é INDIRETO, e é por isso que ele precisa de caso próprio em vez de leitura:
  // nada revoga o JWT. Ele continua válido e continua sendo aceito pelo `auth`; o que muda é
  // que `resolvePermission` perde o ramo `isPublic` (o `is_public` da linha virou falso), e o
  // visitante, que não é dono e não tem share, cai em "nenhuma relação com o atlas".
  it('revogado o link, o token JÁ EMITIDO para de valer na hora', async () => {
    // O atlas B nunca foi tocado pelos casos acima, que dependem de A: usá-lo aqui não
    // perturba nenhum deles.
    const linkB2 = randomUUID().replace(/-/g, '');
    await db.query('UPDATE atlas SET is_public = true, public_link = $2 WHERE id = $1',
      [atlasB.id, linkB2]);
    const emissao = await supertest(app).get(`/api/v1/atlas/public/${linkB2}`).expect(200);
    const tokenB = emissao.body.data.publicToken;
    const comTokenB = (path) => supertest(app).get(path).set('Authorization', `Bearer ${tokenB}`);

    // PISO: o token funciona ANTES. Sem ele o 404 de depois seria indistinguível de um token
    // que nunca valeu, e o caso passaria verde com a emissão quebrada.
    await comTokenB(`/api/v1/atlas/${atlasB.id}`).expect(200);

    await db.query('UPDATE atlas SET is_public = false, public_link = NULL WHERE id = $1',
      [atlasB.id]);

    // 404 e não 403, pela cláusula 5.6: sem o ramo público o visitante não tem relação
    // nenhuma com o atlas, e "proibido" aqui contaria que ele existe.
    const depois = await comTokenB(`/api/v1/atlas/${atlasB.id}`);
    assert.equal(depois.status, 404, `esperava 404 depois de revogar; veio ${depois.status}`);

    // E a revogação alcança as OUTRAS portas do mesmo atlas, não só a que o caso mediu: uma
    // revogação que fechasse a leitura do documento e deixasse o snapshot aberto seria pior
    // que nenhuma, porque o snapshot é onde o conteúdo de fato está.
    assert.equal((await comTokenB(`/api/v1/atlas/${atlasB.id}/sync/0`)).status, 404);
    assert.equal((await comTokenB(`/api/v1/atlas/${atlasB.id}/maps`)).status, 404);
  });
});
