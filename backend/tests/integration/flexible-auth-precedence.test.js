// Path: tests/integration/flexible-auth-precedence.test.js
//
// Itens 32, 33 e 113 — as três cegueiras de `middleware/flexible-auth.js`, todas com a
// mesma raiz: a suíte inteira exercitava o middleware através de `/api/v1/auth/me`, uma
// rota de `auth` ESTRITO. O estrito relê o Bearer sempre que `req.user` está vazio e
// reconcilia contra o banco, então ele MASCARA tudo o que o flexível faz de errado — é
// o padrão C3, o assert passa com e sem o comportamento. A divergência só aparece numa
// rota que tem apenas o flexível, e `GET /nomes/busca` é a única do repositório que é
// ao mesmo tempo anônima e sensível a `req.user` (o filtro de acesso embutido em
// `nomes.queries.js` recebe `$5 = req.user?.id`).
//
//   32 — a renovação deslizante re-assinava `req.user`, cujas claims de organização
//        vinham do TOKEN ANTIGO. Enquanto um cliente de cookie continuasse deslizando,
//        uma democão `editor -> viewer` NUNCA propagava: janela não de 15 min, mas
//        infinita. E `org_role` é autorização real (sv360 decide escrita por ele).
//        CORRIGIDO aqui: a renovação reconcilia `org_role`/`organization_id` contra o
//        banco QUANDO O TOKEN JÁ CARREGA a claim. Token legado (claim ausente) continua
//        degradando para viewer/null, que é o que auth-gaps auth-05 prende.
//
//   33 — REFUTADO contra o HEAD. O relatório diz que uma conta desativada continuava
//        lendo nome privado por até ~10 min, porque nem o flexível nem o SQL checavam
//        `users.is_active`. O SQL passou a checar (`nomes.queries.js:50`,
//        `EXISTS (SELECT 1 FROM users WHERE id = $5 AND is_active = true)`). O furo está
//        fechado no lugar certo — a query, não o app —, mas nenhum teste o afirmava:
//        remover aquele EXISTS deixava a suíte inteira verde.
//
//  113 — dois curto-circuitos sem fallback: o ramo do api key faz `return next()`
//        incondicional mesmo com chave lixo (flexible-auth.js:60), e o ramo do token lê
//        `req.cookies?.token || extractBearerToken(req)` e, se o cookie falhar no
//        verify, faz `return next()` sem tentar o header (:63-71). Numa rota
//        só-flexível o usuário é silenciosamente rebaixado a anônimo e perde acesso ao
//        PRÓPRIO dado privado. Isto é caracterização: o comportamento fica documentado
//        e passa a ser uma escolha visível, não um efeito colateral.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

const SFX = randomUUID().slice(0, 8);
// Nome único por execução: o gazetteer é global e outros arquivos semeiam nele.
const PRIVADO = `Base Flex ${SFX}`;
const PUBLICO = `Praca Flex ${SFX}`;

// Zona quadrada em torno de (-43.2, -22.9), igual à de nomes-access.test.js.
const ZONE = {
  type: 'Polygon',
  coordinates: [[[-43.3, -22.95], [-43.1, -22.95], [-43.1, -22.85], [-43.3, -22.85], [-43.3, -22.95]]],
};

/** Reads the `token` value out of a Set-Cookie header (array or string). */
function tokenFromSetCookie(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  for (const c of Array.isArray(raw) ? raw : [raw]) {
    const m = /(?:^|;\s*)token=([^;]+)/.exec(c);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

describe('flexibleAuth — reconciliation and credential precedence (32, 33, 113)', () => {
  let app, db, zoneUser, zoneTok, admin, adminTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    zoneUser = await createUser(db, { username: `fx_zone_${SFX}` });
    admin = await createAdminUser(db, { username: `fx_admin_${SFX}` });
    zoneTok = await loginUser(app, zoneUser.username, zoneUser.password);
    adminTok = await loginUser(app, admin.username, admin.password);

    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, access_level, geom)
       VALUES ($1, 'Cidade', 'public',  ST_SetSRID(ST_MakePoint(-43.2,-22.9),4674)),
              ($2, 'Cidade', 'private', ST_SetSRID(ST_MakePoint(-43.2,-22.9),4674))`,
      [PUBLICO, PRIVADO]
    );
    await db.query('SELECT ng.refresh_busca()');

    const zone = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Zona Flex ${SFX}`, geom: ZONE })
      .expect(201);
    await supertest(app)
      .put(`/api/v1/zones/${zone.body.data.id}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ users: [zoneUser.id] })
      .expect(200);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** GET /nomes/busca com os headers que o chamador quiser (rota SÓ flexível). */
  function busca(term, headers = {}) {
    let req = supertest(app).get('/api/v1/nomes/busca').query({ q: term, lat: -22.9, lon: -43.2 });
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req;
  }

  /** true when the private name shows up in a /busca response. */
  async function vePrivado(headers) {
    const res = await busca(PRIVADO, headers).expect(200);
    return res.body.some((r) => r.nome === PRIVADO);
  }

  // ==========================================================================
  // Linha de base — sem ela, todo "não vê o nome privado" abaixo seria vacuous
  // ==========================================================================
  describe('baseline: the fixture really is visible to the right principal', () => {
    it('the zone user sees the private name with a plain Bearer', async () => {
      assert.equal(await vePrivado({ Authorization: `Bearer ${zoneTok}` }), true);
    });

    it('an anonymous request sees the PUBLIC name but never the private one', async () => {
      const pub = await busca(PUBLICO).expect(200);
      assert.ok(pub.body.some((r) => r.nome === PUBLICO), 'o gazetteer precisa responder de fato');
      assert.equal(await vePrivado({}), false);
    });
  });

  // ==========================================================================
  // 33 — conta desativada não pode continuar lendo nome PRIVADO na rota anônima
  // ==========================================================================
  describe('33 — a deactivated account loses the private gazetteer immediately', () => {
    let deadUser, deadTok;

    before(async () => {
      deadUser = await createUser(db, { username: `fx_dead_${SFX}` });
      deadTok = await loginUser(app, deadUser.username, deadUser.password);
      const z = await supertest(app)
        .post('/api/v1/zones')
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ name: `Zona Dead ${SFX}`, geom: ZONE })
        .expect(201);
      await supertest(app)
        .put(`/api/v1/zones/${z.body.data.id}/permissions`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ users: [deadUser.id] })
        .expect(200);
    });

    it('baseline: while active, the account reads the private name', async () => {
      assert.equal(await vePrivado({ Authorization: `Bearer ${deadTok}` }), true);
    });

    it('after `UPDATE users SET is_active=false` the SAME token stops seeing it', async () => {
      // O token continua válido e não expirado; flexibleAuth NÃO reconcilia fora da
      // janela de renovação. Quem barra é o filtro de acesso EMBUTIDO na query.
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [deadUser.id]);
      assert.equal(await vePrivado({ Authorization: `Bearer ${deadTok}` }), false);
    });

    it('the deactivated token still resolves as a principal — the block comes from the SQL, not from a 401', async () => {
      // Se o middleware tivesse rejeitado o token, o teste acima passaria pelo motivo
      // errado. A rota responde 200 e devolve o nome PÚBLICO: o principal chegou ao
      // SQL, e foi o SQL que recusou o privado.
      const res = await busca(PUBLICO, { Authorization: `Bearer ${deadTok}` }).expect(200);
      assert.ok(res.body.some((r) => r.nome === PUBLICO));
    });

    it('parity: the same token on a STRICT route is 401 (a divergência é por família de rota)', async () => {
      await supertest(app)
        .get('/api/v1/atlas')
        .set('Authorization', `Bearer ${deadTok}`)
        .expect(401);
    });

    it('control: reactivating restores the private read (não é over-blocking permanente)', async () => {
      await db.query('UPDATE users SET is_active = true WHERE id = $1', [deadUser.id]);
      assert.equal(await vePrivado({ Authorization: `Bearer ${deadTok}` }), true);
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [deadUser.id]);
    });

    it('an admin who is deactivated also loses the admin shortcut inside the query', async () => {
      // O ramo `role='admin'` do SQL tem o seu próprio `is_active = true`; sem ele um
      // admin desativado continuaria vendo TUDO, que é estritamente pior.
      const deadAdmin = await createAdminUser(db, { username: `fx_dadm_${SFX}` });
      const tok = await loginUser(app, deadAdmin.username, deadAdmin.password);
      assert.equal(await vePrivado({ Authorization: `Bearer ${tok}` }), true);
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [deadAdmin.id]);
      assert.equal(await vePrivado({ Authorization: `Bearer ${tok}` }), false);
    });
  });

  // ==========================================================================
  // 113 — precedência de credencial: cookie/api-key inválidos SUPRIMEM o Bearer
  // ==========================================================================
  describe('113 — an invalid cookie or api-key silently demotes a valid Bearer', () => {
    it('control: só o Bearer -> o nome privado aparece', async () => {
      assert.equal(await vePrivado({ Authorization: `Bearer ${zoneTok}` }), true);
    });

    it('control: só o cookie válido -> o nome privado aparece', async () => {
      assert.equal(await vePrivado({ Cookie: `token=${zoneTok}` }), true);
    });

    it('cookie LIXO + Bearer válido -> a requisição vira ANÔNIMA (o header nem é tentado)', async () => {
      // `req.cookies?.token || extractBearerToken(req)` escolhe o cookie e, no catch do
      // verify, faz `return next()` sem fallback.
      assert.equal(
        await vePrivado({ Cookie: 'token=lixo.jwt.valor', Authorization: `Bearer ${zoneTok}` }),
        false
      );
    });

    it('x-api-key inválida + Bearer válido -> também anônima (o ramo do api key nunca cai fora)', async () => {
      assert.equal(
        await vePrivado({ 'x-api-key': 'not-a-uuid', Authorization: `Bearer ${zoneTok}` }),
        false
      );
    });

    it('x-api-key com FORMA de UUID mas inexistente -> anônima igualmente', async () => {
      assert.equal(
        await vePrivado({ 'x-api-key': randomUUID(), Authorization: `Bearer ${zoneTok}` }),
        false
      );
    });

    it('?api_key= na query tem o mesmo efeito do header (mesmo ramo)', async () => {
      const res = await supertest(app)
        .get('/api/v1/nomes/busca')
        .query({ q: PRIVADO, lat: -22.9, lon: -43.2, api_key: 'not-a-uuid' })
        .set('Authorization', `Bearer ${zoneTok}`)
        .expect(200);
      assert.ok(!res.body.some((r) => r.nome === PRIVADO));
    });

    it('contraste: as MESMAS três combinações em /auth/me respondem 200', async () => {
      // O `auth` estrito relê o Bearer quando req.user está vazio, então a divergência é
      // por FAMÍLIA DE ROTA, não por credencial. É exatamente isto que impedia a suíte
      // atual (que testa tudo em /auth/me) de enxergar o problema.
      for (const headers of [
        { Cookie: 'token=lixo.jwt.valor', Authorization: `Bearer ${zoneTok}` },
        { 'x-api-key': 'not-a-uuid', Authorization: `Bearer ${zoneTok}` },
        { Authorization: `Bearer ${zoneTok}` },
      ]) {
        let req = supertest(app).get('/api/v1/auth/me');
        for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
        const res = await req;
        assert.equal(res.status, 200, `combinação ${JSON.stringify(headers)} deveria autenticar`);
        assert.equal(res.body.data.id, zoneUser.id);
      }
    });

    it('sem NENHUMA credencial /auth/me é 401 (o 200 acima vem do Bearer, não de um gate aberto)', async () => {
      await supertest(app).get('/api/v1/auth/me').expect(401);
    });
  });

  // ==========================================================================
  // 32 — a renovação deslizante reconcilia org_role/organization_id
  // ==========================================================================
  describe('32 — the sliding renewal propagates an org demotion', () => {
    /**
     * Mints a token 4 minutes from expiry (inside SLIDING_THRESHOLD_MS) carrying the
     * given org claims, so the very next request triggers the re-mint.
     */
    function nearExpiryToken(user, claims) {
      return jwt.sign(
        { sub: user.id, username: user.username, role: 'user', ...claims },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '4m' }
      );
    }

    /** Drives one renewal through /auth/me and returns the decoded renewed token. */
    async function renew(token) {
      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Cookie', `token=${token}`)
        .expect(200);
      const renewed = tokenFromSetCookie(res);
      assert.ok(renewed, 'a near-expiry token must be re-minted');
      return jwt.verify(renewed, JWT_SECRET, { algorithms: ['HS256'] });
    }

    it('editor demoted to viewer in the DB: the renewed token says viewer', async () => {
      const u = await createUser(db, { username: `fx_dem_${SFX}` });
      await db.query(
        `UPDATE users SET organization_id = $1, org_role = 'editor' WHERE id = $2`,
        [DEFAULT_ORG, u.id]
      );

      // Sanity: o token nasce dizendo editor, senão o assert final seria trivial.
      const stale = nearExpiryToken(u, { organization_id: DEFAULT_ORG, org_role: 'editor' });
      assert.equal(jwt.decode(stale).org_role, 'editor');

      await db.query(`UPDATE users SET org_role = 'viewer' WHERE id = $1`, [u.id]);

      const decoded = await renew(stale);
      assert.equal(decoded.org_role, 'viewer', 'a demoção precisa propagar na renovação');
      assert.equal(decoded.organization_id, DEFAULT_ORG);
      assert.equal(decoded.sub, u.id);
    });

    it('consequência observável: com o cookie renovado, o upload sv360 é 403', async () => {
      const u = await createUser(db, { username: `fx_up_${SFX}` });
      await db.query(
        `UPDATE users SET organization_id = $1, org_role = 'editor' WHERE id = $2`,
        [DEFAULT_ORG, u.id]
      );
      const stale = nearExpiryToken(u, { organization_id: DEFAULT_ORG, org_role: 'editor' });

      // Enquanto editor: passa do requireUploadCapability (o 4xx que vem depois é do
      // multer/serviço, não do gate — o que importa é NÃO ser 403).
      const antes = await supertest(app)
        .post('/api/v1/sv360/admin/projects/upload')
        .set('Cookie', `token=${stale}`);
      assert.notEqual(antes.status, 403, 'um editor tem de passar da capability');

      await db.query(`UPDATE users SET org_role = 'viewer' WHERE id = $1`, [u.id]);

      const depois = await supertest(app)
        .post('/api/v1/sv360/admin/projects/upload')
        .set('Cookie', `token=${stale}`)
        .expect(403);
      assert.equal(depois.body.error?.code ?? 'FORBIDDEN', 'FORBIDDEN');
    });

    it('controle positivo (não super-corrigir): uma PROMOÇÃO também propaga', async () => {
      const u = await createUser(db, { username: `fx_pro_${SFX}` });
      await db.query(
        `UPDATE users SET organization_id = $1, org_role = 'viewer' WHERE id = $2`,
        [DEFAULT_ORG, u.id]
      );
      const stale = nearExpiryToken(u, { organization_id: DEFAULT_ORG, org_role: 'viewer' });
      await db.query(`UPDATE users SET org_role = 'editor' WHERE id = $1`, [u.id]);

      const decoded = await renew(stale);
      assert.equal(decoded.org_role, 'editor');
    });

    it('a mudança de organização também propaga (organization_id e o alias org)', async () => {
      const u = await createUser(db, { username: `fx_org_${SFX}` });
      const { rows } = await db.query(
        `INSERT INTO organizations (nome, sigla, slug, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
        [`Org Flex ${SFX}`, `OF${SFX.slice(0, 4)}`, `org-flex-${SFX}`]
      );
      const novaOrg = rows[0].id;
      await db.query(
        `UPDATE users SET organization_id = $1, org_role = 'editor' WHERE id = $2`,
        [DEFAULT_ORG, u.id]
      );
      const stale = nearExpiryToken(u, { organization_id: DEFAULT_ORG, org_role: 'editor' });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [novaOrg, u.id]);

      const decoded = await renew(stale);
      assert.equal(decoded.organization_id, novaOrg);
      assert.equal(decoded.org, novaOrg, 'o alias congelado do ebgeo_360 acompanha');
    });

    it('NÃO-REGRESSÃO de auth-gaps auth-05: token LEGADO continua degradando para viewer/null', async () => {
      // A distinção que o fix introduz: claim AUSENTE degrada (mapeamento), claim
      // PRESENTE reconcilia (banco). Sem esta separação, "reconciliar sempre"
      // promoveria o token legado a owner e quebraria a regra de degradação.
      const u = await createUser(db, { username: `fx_leg_${SFX}` });
      await db.query(
        `UPDATE users SET organization_id = $1, org_role = 'owner' WHERE id = $2`,
        [DEFAULT_ORG, u.id]
      );
      const legacy = nearExpiryToken(u, {}); // sem organization_id, sem org_role

      const decoded = await renew(legacy);
      assert.equal(decoded.org_role, 'viewer', 'token legado degrada, nunca é promovido pelo banco');
      assert.equal(decoded.organization_id, null);
      assert.equal(decoded.org, null);
    });

    it('a demoção do papel GLOBAL continua propagando (o fix não desfez o P1 anterior)', async () => {
      const u = await createAdminUser(db, { username: `fx_glb_${SFX}` });
      const stale = jwt.sign(
        { sub: u.id, username: u.username, role: 'admin', organization_id: DEFAULT_ORG, org_role: 'editor' },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '4m' }
      );
      await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [u.id]);

      const decoded = await renew(stale);
      assert.equal(decoded.role, 'user');
    });
  });
});
