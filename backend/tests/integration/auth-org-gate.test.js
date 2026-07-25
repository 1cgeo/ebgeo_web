// Path: tests/integration/auth-org-gate.test.js
//
// Itens 6 e 7 — o gate O1 ("membro de organização desativada não abre nem renova
// sessão"), em `auth.service.js:98` (login) e `:221` (refresh).
//
// Cobertura antes deste arquivo: NENHUMA. Nenhum teste de integração do repositório
// jamais desativava uma organização — o único INSERT com `is_active=false` em
// `organizations` estava em `tests/ws/collab-reauthz.test.js:70`, caminho WebSocket.
// auth-edge-cases / auth-gaps / auth-live-reconciliation cobrem `users.is_active` e
// `role`, nunca `organizations.is_active`. Apagando qualquer uma das duas linhas, TODA a
// suíte continuava verde e um membro de OM desativada voltava a logar e a renovar
// indefinidamente (o access token de 15 min vira ilimitado pela renovação).
//
// Dois asserts existem para separar "gate ANTES do efeito" de "gate depois": nenhuma
// linha em `refresh_tokens` (o INSERT_REFRESH_TOKEN de :111) e `last_login_at` ainda
// NULL (o UPDATE_LAST_LOGIN de :103). Sem eles o teste não distingue um 403 que abortou
// cedo de um 403 emitido depois de já ter emitido sessão.
//
// REFUTAÇÃO registrada no item 7: o relatório previa que a retentativa após o 403 caía
// no ramo `revoked_at` e disparava REVOKE_ALL_USER_TOKENS, matando TODAS as sessões do
// usuário por um falso positivo de roubo. Não acontece mais: a janela de graça de 10 s
// (`REFRESH_RACE_GRACE_MS`, auth.service.js:20) classifica a retentativa imediata como
// duplicata concorrente e devolve 401 SEM revogar a família. O teste prende esse
// comportamento nos dois lados — o token apresentado morre, as outras sessões vivem.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('O1 — a deactivated organization bars login and refresh (6, 7)', () => {
  let app, db, orgId;

  /** Creates an org (active by default) and returns its id. */
  async function createOrg(tag, isActive = true) {
    const { rows } = await db.query(
      `INSERT INTO organizations (nome, sigla, slug, is_active) VALUES ($1,$2,$3,$4) RETURNING id`,
      [`Org ${tag} ${SFX}`, `O${tag}${SFX.slice(0, 3)}`, `org-${tag}-${SFX}`.toLowerCase(), isActive]
    );
    return rows[0].id;
  }

  const login = (u, p) => supertest(app).post('/api/v1/auth/login').send({ username: u, password: p });
  const refresh = (t) => supertest(app).post('/api/v1/auth/refresh').send({ refreshToken: t });

  const setOrgActive = (id, active) =>
    db.query('UPDATE organizations SET is_active = $1 WHERE id = $2', [active, id]);

  async function tokenRows(userId) {
    const { rows } = await db.query(
      'SELECT token_hash, revoked_at FROM refresh_tokens WHERE user_id = $1', [userId]
    );
    return rows;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    orgId = await createOrg('gate');
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // 6 — login()
  // ==========================================================================
  describe('6 — login() refuses a member of a deactivated organization', () => {
    it('403 FORBIDDEN with the CORRECT password, and nothing was issued', async () => {
      const org = await createOrg('l1');
      const u = await createUser(db, { username: `og_l1_${SFX}`, organization_id: org });
      await setOrgActive(org, false);

      const res = await login(u.username, u.password);
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
      assert.equal(res.body.data, undefined, 'nenhum token pode atravessar o 403');

      // O gate roda ANTES dos dois efeitos colaterais do caminho feliz.
      assert.equal((await tokenRows(u.id)).length, 0, 'abortou antes do INSERT_REFRESH_TOKEN');
      const { rows } = await db.query('SELECT last_login_at FROM users WHERE id = $1', [u.id]);
      assert.equal(rows[0].last_login_at, null, 'abortou antes do UPDATE_LAST_LOGIN');
    });

    it('a senha ERRADA continua 401, não 403 (o gate não vira oráculo de organização)', async () => {
      // Se o gate de org rodasse ANTES do bcrypt, o 403 revelaria que a conta existe e
      // a que OM pertence, para quem nem sabe a senha.
      const org = await createOrg('l2');
      const u = await createUser(db, { username: `og_l2_${SFX}`, organization_id: org });
      await setOrgActive(org, false);

      const res = await login(u.username, 'senha-errada');
      assert.equal(res.status, 401);
    });

    it('controle negativo: reativar a org devolve o login (não é over-blocking)', async () => {
      const org = await createOrg('l3');
      const u = await createUser(db, { username: `og_l3_${SFX}`, organization_id: org });

      await setOrgActive(org, false);
      assert.equal((await login(u.username, u.password)).status, 403);

      await setOrgActive(org, true);
      const ok = await login(u.username, u.password);
      assert.equal(ok.status, 200);
      assert.ok(ok.body.data.accessToken);
      assert.equal((await tokenRows(u.id)).length, 1, 'agora sim a sessão foi emitida');
    });

    it('usuário SEM organização loga normalmente (isenção documentada em org-status.js:17)', async () => {
      const u = await createUser(db, { username: `og_l4_${SFX}`, organization_id: null });
      const res = await login(u.username, u.password);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.organization_id, null);
    });

    it('a regra "row missing = active" é INALCANÇÁVEL por users.organization_id — a FK a torna morta', async () => {
      // O relatório pedia "user com organization_id de org INEXISTENTE -> 200". Não é
      // possível montar esse estado: `users_organization_id_fkey` recusa o UPDATE, e a
      // FK não tem ON DELETE, então apagar a org também é recusado. O ramo
      // `rows.length === 0` de org-status.js:19 é defensivo (existe para um token com
      // claim órfã / uma corrida de leitura), não um estado de banco atingível.
      const u = await createUser(db, { username: `og_l5_${SFX}`, organization_id: null });
      await assert.rejects(
        () => db.query('UPDATE users SET organization_id = $1 WHERE id = $2',
          ['00000000-0000-0000-0000-0000000000ff', u.id]),
        (err) => {
          assert.equal(err.code, '23503', 'esperado violação de chave estrangeira');
          return true;
        }
      );

      const org = await createOrg('l5b');
      await db.query('UPDATE users SET organization_id = $1 WHERE id = $2', [org, u.id]);
      await assert.rejects(
        () => db.query('DELETE FROM organizations WHERE id = $1', [org]),
        (err) => err.code === '23503'
      );

      // E o comportamento que a regra protege continua valendo pelo caminho real:
      // a org existe e está ativa, então loga.
      assert.equal((await login(u.username, u.password)).status, 200);
    });

    it('orgIsActive() devolve true para uma org que não existe (o ramo defensivo, testado direto)', async () => {
      const { orgIsActive } = await import('../../src/utils/org-status.js');
      assert.equal(await orgIsActive('00000000-0000-0000-0000-0000000000ff'), true);
      assert.equal(await orgIsActive(null), true, 'sem organização = isento');
      assert.equal(await orgIsActive(undefined), true);
      // Controle: uma org que EXISTE e está desativada devolve false, senão o `true`
      // acima passaria também com um stub que sempre devolve true.
      const morta = await createOrg('l5c');
      await setOrgActive(morta, false);
      assert.equal(await orgIsActive(morta), false);
    });

    it('a org ATIVA do caso base loga (controle do fixture)', async () => {
      const u = await createUser(db, { username: `og_l6_${SFX}`, organization_id: orgId });
      assert.equal((await login(u.username, u.password)).status, 200);
    });
  });

  // ==========================================================================
  // 7 — refresh()
  // ==========================================================================
  describe('7 — refresh() refuses after the organization is deactivated', () => {
    it('403 FORBIDDEN, e o token apresentado JÁ foi queimado pela ordem das operações', async () => {
      // `CLAIM_REFRESH_TOKEN` (:143) roda ANTES do check de org (:221), então o 403 sai
      // com o token já revogado. É o oposto do ramo de expiração, que auth-gaps:246
      // prova NÃO revogar — a assimetria vale ser documentada.
      const org = await createOrg('r1');
      const u = await createUser(db, { username: `og_r1_${SFX}`, organization_id: org });

      const first = await login(u.username, u.password).expect(200);
      const rt = first.body.data.refreshToken;

      await setOrgActive(org, false);

      const res = await refresh(rt);
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
      assert.equal(res.body.data, undefined);

      const { rows } = await db.query(
        'SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1', [sha256(rt)]
      );
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].revoked_at, null, 'o claim atômico já queimou o token antes do gate');
    });

    it('REFUTA o item: a retentativa imediata é 401 e NÃO derruba a família (janela de graça)', async () => {
      // O relatório previa REVOKE_ALL_USER_TOKENS por falso positivo de roubo. A janela
      // de graça de 10 s classifica a retentativa como duplicata concorrente: o token
      // apresentado continua morto, mas as demais sessões do usuário sobrevivem.
      const org = await createOrg('r2');
      const u = await createUser(db, { username: `og_r2_${SFX}`, organization_id: org });

      const s1 = await login(u.username, u.password).expect(200);
      const s2 = await login(u.username, u.password).expect(200); // segunda sessão (outra aba)
      assert.notEqual(s1.body.data.refreshToken, s2.body.data.refreshToken);

      await setOrgActive(org, false);
      await refresh(s1.body.data.refreshToken).expect(403);

      const again = await refresh(s1.body.data.refreshToken);
      assert.equal(again.status, 401, 'o token já gasto não pode renovar');

      const vivos = (await tokenRows(u.id)).filter((r) => r.revoked_at === null);
      assert.equal(vivos.length, 1, 'a OUTRA sessão precisa sobreviver à retentativa');
      assert.equal(vivos[0].token_hash, sha256(s2.body.data.refreshToken));
    });

    it('caminho de recuperação: reativar a org e logar de novo funciona', async () => {
      const org = await createOrg('r3');
      const u = await createUser(db, { username: `og_r3_${SFX}`, organization_id: org });
      const s = await login(u.username, u.password).expect(200);

      await setOrgActive(org, false);
      await refresh(s.body.data.refreshToken).expect(403);

      await setOrgActive(org, true);
      const back = await login(u.username, u.password);
      assert.equal(back.status, 200);
      const rot = await refresh(back.body.data.refreshToken);
      assert.equal(rot.status, 200, 'a sessão nova renova normalmente');
    });

    it('controle negativo: usuário de org ATIVA renova e a família continua viva', async () => {
      const org = await createOrg('r4');
      const u = await createUser(db, { username: `og_r4_${SFX}`, organization_id: org });
      const s = await login(u.username, u.password).expect(200);

      const res = await refresh(s.body.data.refreshToken);
      assert.equal(res.status, 200);
      assert.ok(res.body.data.accessToken);
      assert.notEqual(res.body.data.refreshToken, s.body.data.refreshToken, 'houve rotação');

      const vivos = (await tokenRows(u.id)).filter((r) => r.revoked_at === null);
      assert.equal(vivos.length, 1, 'exatamente o token novo');
      assert.equal(vivos[0].token_hash, sha256(res.body.data.refreshToken));
    });

    it('usuário sem organização renova (mesma isenção do login)', async () => {
      const u = await createUser(db, { username: `og_r5_${SFX}`, organization_id: null });
      const s = await login(u.username, u.password).expect(200);
      assert.equal((await refresh(s.body.data.refreshToken)).status, 200);
    });

    it('o access token emitido ANTES da desativação já não abre rota estrita (o gate não é só do refresh)', async () => {
      // Sem isto o 403 do refresh seria uma trava de porta com a janela aberta: o
      // access token de 15 min continuaria valendo. `middleware/auth.js:142` recusa.
      const org = await createOrg('r6');
      const u = await createUser(db, { username: `og_r6_${SFX}`, organization_id: org });
      const s = await login(u.username, u.password).expect(200);

      await supertest(app)
        .get('/api/v1/atlas')
        .set('Authorization', `Bearer ${s.body.data.accessToken}`)
        .expect(200);

      await setOrgActive(org, false);

      const res = await supertest(app)
        .get('/api/v1/atlas')
        .set('Authorization', `Bearer ${s.body.data.accessToken}`);
      assert.equal(res.status, 403);
    });
  });
});
