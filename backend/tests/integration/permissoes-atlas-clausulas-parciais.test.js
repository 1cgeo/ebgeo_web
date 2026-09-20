// Path: tests/integration/permissoes-atlas-clausulas-parciais.test.js
//
// THE CLAUSES THAT THE 2026-09-13 REVIEW LEFT WITH PARTIAL PROOF.
//
// `docs/wiki/permissoes-atlas.md` carries a table of clauses whose green proves LESS
// than the clause says. This file closes the four of them whose missing case is a
// backend behaviour with no coherent home in an existing file. The other six were
// closed inside the file that already owned the clause, and each one is named below so
// that this header does not become a second, diverging index:
//
//   1.1  -> tests/unit/papel-global-censo.test.js  (the sweep now reaches a role
//           comparison written WITHOUT the literal 'admin', which is the exact form the
//           census header names as the danger)
//   4.2  -> tests/integration/access-groups-crud.test.js (the two MEMBERSHIP routes,
//           exercised as the administrator wildcard)
//   4.4  -> tests/integration/access-groups-crud.test.js (the administrator listing
//           somebody else's group)
//   5.8  -> tests/integration/sair-do-atlas.test.js (the refusal names BOTH exits)
//   7.4  -> frontend/tests/unit/copia-de-atlas-local.test.js (`duplicateLocalAtlas`
//           rewriting the copy's identity in the registry)
//
// EVERY NEGATIVE HERE COMES WITH THE POSITIVE OF THE SAME PRINCIPAL, and every
// deactivation is UNDONE inside its own case. The undo is not hygiene, it is the
// negative control: a predicate that started refusing everything would keep the "after"
// assertion green, and only the restore separates "this trigger cut it" from "nothing
// worked any more".

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';
import { flexibleAuth } from '../../src/middleware/flexible-auth.js';

const SFX = randomUUID().slice(0, 8);

describe('Cláusulas com prova parcial (revisão de 2026-09-13)', () => {
  let app, db;
  let admin, tokenAdmin;
  let dono, membro, tokenMembro;
  let produtor;
  let omLotacao, omProdutora;
  let atlas, atlasDoProdutor;

  const TS_CONCEDIDO = `parcial-concedido-${SFX}`;
  const TS_PRODUZIDO = `parcial-produzido-${SFX}`;

  /** Ids of the tilesets this caller sees with the given atlas in focus. */
  const tilesetsVisiveis = async (token, atlasId) => (await supertest(app)
    .get(`/api/v1/resource-access/visible?atlasId=${atlasId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200)).body.data.tilesets.map((t) => t.id);

  /** Does the member still reach the LOANED tileset through this atlas? */
  const veEmprestado = async (id, atlasId) => (await tilesetsVisiveis(tokenMembro, atlasId)).includes(id);

  const criarOrg = async (rotulo) => (await db.query(
    'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
    [`OM ${rotulo} ${SFX}`, `om-parcial-${rotulo}-${SFX}`, `${rotulo}${SFX.slice(0, 3)}`]
  )).rows[0].id;

  const ativarConta = (id, ativa) => db.query('UPDATE users SET is_active = $2 WHERE id = $1', [id, ativa]);
  const ativarOrg = (id, ativa) => db.query('UPDATE organizations SET is_active = $2 WHERE id = $1', [id, ativa]);

  /** The grant that sustains the loan is untouched: only liveness can explain a fall. */
  const concessaoIntacta = async (resourceId) => {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM resource_grants
        WHERE resource_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [resourceId]
    );
    return rows[0].n;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    omLotacao = await criarOrg('lot');
    omProdutora = await criarOrg('prod');

    admin = await createAdminUser(db, { username: `parc_admin_${SFX}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    // The atlas owner is posted to a DEDICATED organization: deactivating the seeded
    // default one would take the rest of the suite down with it.
    dono = await createUser(db, { username: `parc_dono_${SFX}`, organization_id: omLotacao });
    membro = await createUser(db, { username: `parc_membro_${SFX}` });
    tokenMembro = await loginUser(app, membro.username, membro.password);
    produtor = await createProducerUser(db, omProdutora, { username: `parc_prod_${SFX}` });

    atlas = await createAtlas(db, dono.id, { name: `Atlas parcial ${SFX}` });
    atlasDoProdutor = await createAtlas(db, produtor.id, { name: `Atlas do produtor ${SFX}` });
    await createShare(db, atlas.id, membro.id, 'read', dono.id);
    await createShare(db, atlasDoProdutor.id, membro.id, 'read', produtor.id);

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level, owner_org_id)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private', NULL),
              ($3, $4, '{"url":"/y"}'::jsonb, 0, 'private', $5::uuid)`,
      [TS_CONCEDIDO, `Concedido ${SFX}`, TS_PRODUZIDO, `Produzido ${SFX}`, omProdutora]
    );

    // The owner gets `view_share`, which is what lets him ATTACH; the SAME grant is what
    // sustains the loan afterwards (D4).
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TS_CONCEDIDO}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: dono.id, grantLevel: 'view_share' })
      .expect(201);
    const tokenDono = await loginUser(app, dono.username, dono.password);
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'tileset', resourceId: TS_CONCEDIDO })
      .expect(201);

    // The producer attaches WITHOUT any grant: he maintains the resource, and production
    // is a relay authority of its own (`requireResourceRelay`, branch `produz`).
    const tokenProdutor = await loginUser(app, produtor.username, produtor.password);
    await supertest(app)
      .post(`/api/v1/atlas/${atlasDoProdutor.id}/resources`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ resourceType: 'tileset', resourceId: TS_PRODUZIDO })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])',
      [[TS_CONCEDIDO, TS_PRODUZIDO]]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])',
      [[TS_CONCEDIDO, TS_PRODUZIDO]]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[TS_CONCEDIDO, TS_PRODUZIDO]]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlas.id, atlasDoProdutor.id]]);
    await db.query('DELETE FROM sv360.projects WHERE slug LIKE $1', [`parcial-360-${SFX}%`]);
    await db.query('DELETE FROM api_keys WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)',
      [`parc_%${SFX}`]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // 8.5, primeiro marcador: a DESATIVAÇÃO na superfície de EMPRÉSTIMO
  // ==========================================================================
  //
  // The clause says "desativar uma conta (ou a organização dela) tira dela todos os
  // acessos, e alcança o que ela sustentava: os atlas de que ela é dona deixam de
  // emprestar os recursos que ela deixou de ver". Until this file existed the loan
  // surface was measured only against REVOCATION and TRANSFER: the two files that own
  // it (`atlas-emprestimo-recurso.test.js`, `atlas-emprestimo-revogacao.test.js`) do not
  // contain a single occurrence of `is_active`.
  //
  // FOUR TRIGGERS, because the loan predicate reaches liveness at four distinct places
  // inside `fn_granted_resource_ids` (migração `008_acesso_a_recurso.sql`), and a test
  // that only killed the owner's account would leave three of them unmeasured.
  describe('8.5 — a desativação alcança o EMPRÉSTIMO do atlas', () => {
    it('desativar a CONTA do dono derruba o empréstimo, e reativar o devolve', async () => {
      assert.equal(await veEmprestado(TS_CONCEDIDO, atlas.id), true, 'piso: antes, o membro vê');

      await ativarConta(dono.id, false);
      assert.equal(
        await veEmprestado(TS_CONCEDIDO, atlas.id), false,
        'o dono desativado deixa de sustentar o empréstimo: `fn_principal_vivo(a.owner_id)`'
      );

      // DISCRIMINAÇÃO: nada foi revogado nem venceu. Só a vivacidade do dono mudou.
      assert.equal(await concessaoIntacta(TS_CONCEDIDO), 1, 'a concessão continua viva e não revogada');
      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM atlas_resources WHERE resource_id = $1 AND removed_at IS NULL',
        [TS_CONCEDIDO]
      );
      assert.equal(rows[0].n, 1, 'e a linha de empréstimo continua anexada');

      await ativarConta(dono.id, true);
      assert.equal(
        await veEmprestado(TS_CONCEDIDO, atlas.id), true,
        'reativar devolve: sem esta metade, o `false` acima seria compatível com um predicado que nega tudo'
      );
    });

    it('desativar a OM de LOTAÇÃO do dono derruba o mesmo empréstimo', async () => {
      // A lotação NÃO autoriza nada (cláusula 10.5) e mesmo assim REVOGA: o termo é de
      // vivacidade (`COALESCE(o.is_active, true)` dentro de `fn_principal_vivo`), e é a
      // metade "(ou a organização dela)" da cláusula 8.5.
      assert.equal(await veEmprestado(TS_CONCEDIDO, atlas.id), true, 'piso');

      await ativarOrg(omLotacao, false);
      assert.equal(await veEmprestado(TS_CONCEDIDO, atlas.id), false, 'OM de lotação morta, dono não age');

      // DISCRIMINAÇÃO: a CONTA continua ativa. Sem esta linha, este caso seria
      // indistinguível do anterior.
      const { rows } = await db.query('SELECT is_active FROM users WHERE id = $1', [dono.id]);
      assert.equal(rows[0].is_active, true, 'a conta do dono não foi tocada: quem caiu foi a OM');

      await ativarOrg(omLotacao, true);
      assert.equal(await veEmprestado(TS_CONCEDIDO, atlas.id), true, 'reativada a OM, o empréstimo volta');
    });

    it('desativar o CONCEDENTE derruba o empréstimo, com o dono vivo e a concessão de pé', async () => {
      // O irmão de baixo do predicado: `og.granted_by IS NULL OR fn_principal_vivo(og.granted_by)`
      // dentro do ramo D4. Desativar quem CONCEDEU ao dono derruba o que ele concedeu, e
      // portanto o empréstimo que aquela concessão sustentava, sem varredura nenhuma.
      assert.equal(await veEmprestado(TS_CONCEDIDO, atlas.id), true, 'piso');
      const { rows: quem } = await db.query(
        'SELECT granted_by FROM resource_grants WHERE resource_id = $1 AND revoked_at IS NULL',
        [TS_CONCEDIDO]
      );
      assert.equal(quem.length, 1, 'piso: uma concessão viva');
      assert.equal(quem[0].granted_by, admin.id, 'e ela foi originada pelo administrador desta suíte');

      await ativarConta(admin.id, false);
      try {
        assert.equal(
          await veEmprestado(TS_CONCEDIDO, atlas.id), false,
          'concedente morto derruba a concessão, e com ela o empréstimo'
        );
        const { rows } = await db.query('SELECT is_active FROM users WHERE id = $1', [dono.id]);
        assert.equal(rows[0].is_active, true, 'o DONO continua vivo: quem caiu foi quem concedeu');
        assert.equal(await concessaoIntacta(TS_CONCEDIDO), 1, 'e a linha de concessão nunca foi revogada');
      } finally {
        await ativarConta(admin.id, true);
      }
      assert.equal(await veEmprestado(TS_CONCEDIDO, atlas.id), true, 'reativado o concedente, volta');
    });

    it('desativar a OM PRODUTORA derruba o empréstimo sustentado por PRODUÇÃO', async () => {
      // O terceiro braço do ramo D4 é `fn_can_produce_resource(a.owner_id, ...)`, e ele
      // não passa por concessão nenhuma: o produtor empresta o acervo da própria OM.
      // Desativar a OM PRODUTORA o derruba por `NOT v_prod_ativa`, que é um termo
      // diferente dos três acima (ele não usa `COALESCE(.., true)`).
      assert.equal(
        await veEmprestado(TS_PRODUZIDO, atlasDoProdutor.id), true,
        'piso: o membro vê o produzido pelo dono do atlas'
      );
      const semConcessao = await concessaoIntacta(TS_PRODUZIDO);
      assert.equal(semConcessao, 0, 'piso: não há concessão nenhuma sobre este recurso');

      await ativarOrg(omProdutora, false);
      assert.equal(
        await veEmprestado(TS_PRODUZIDO, atlasDoProdutor.id), false,
        'OM produtora desativada: o dono deixa de manter o recurso e o atlas deixa de emprestá-lo'
      );

      // DISCRIMINAÇÃO: o produtor continua com conta ativa e com o crachá.
      const { rows } = await db.query(
        'SELECT is_active, producer_org_id FROM users WHERE id = $1', [produtor.id]
      );
      assert.equal(rows[0].is_active, true, 'a conta não foi tocada');
      assert.equal(rows[0].producer_org_id, omProdutora, 'nem o escopo de produção');

      await ativarOrg(omProdutora, true);
      assert.equal(
        await veEmprestado(TS_PRODUZIDO, atlasDoProdutor.id), true,
        'reativada a OM, o empréstimo de produção volta'
      );
    });
  });

  // ==========================================================================
  // 1.2 — "deslogado não é papel, é modo"
  // ==========================================================================
  //
  // The cited test asserts the DOMAIN of the column's CHECK, which says nothing about
  // somebody representing the logged-out visitor by a pseudo-role. The clause itself
  // admitted this. Two halves close it, and they are at different layers: the column
  // refuses the names one would invent, and the middleware answers ABSENCE instead of a
  // value on the anonymous path.
  describe('1.2 — o deslogado é AUSÊNCIA de principal, nunca um papel', () => {
    it('a coluna recusa todo pseudo-papel que alguém inventaria para o deslogado', async () => {
      const alvo = await createUser(db, { username: `parc_pseudo_${SFX}` });
      const inventados = ['anonimo', 'anonymous', 'visitante', 'deslogado', 'guest', 'public'];
      assert.equal(inventados.length, 6, 'a lista de nomes plausíveis, escrita e não derivada');

      for (const pseudo of inventados) {
        await assert.rejects(
          () => db.query('UPDATE users SET role = $1 WHERE id = $2', [pseudo, alvo.id]),
          /users_role_check/,
          `o CHECK precisa recusar o pseudo-papel '${pseudo}'`
        );
      }

      // DISCRIMINAÇÃO: o CHECK não recusa tudo. Sem esta linha, as seis recusas acima
      // seriam o que se mede numa tabela que parou de aceitar escrita.
      await db.query("UPDATE users SET role = 'credenciado' WHERE id = $1", [alvo.id]);
      const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [alvo.id]);
      assert.equal(rows[0].role, 'credenciado');
      await db.query('DELETE FROM users WHERE id = $1', [alvo.id]);
    });

    it('`flexibleAuth` sem credencial deixa `req.user` AUSENTE, e não um papel sintético', async () => {
      // This is the half the column cannot guard: a pseudo-role invented in the
      // APPLICATION would never touch `users.role`. The anonymous path has to answer
      // with absence, because every SQL predicate of the access axis takes the
      // principal as a nullable UUID and reads NULL as "nobody".
      const req = { headers: {}, query: {}, cookies: {}, get: () => undefined, path: '/api/v1/config', method: 'GET' };
      let chamouNext = false;
      await new Promise((resolve) => {
        flexibleAuth(req, {}, () => { chamouNext = true; resolve(); });
      });
      assert.equal(chamouNext, true, 'o middleware nunca bloqueia o caminho anônimo');
      assert.equal(req.user, undefined, 'nenhum principal é sintetizado');
      assert.equal(req.authVia, undefined, 'e nenhuma origem de credencial é carimbada');

      // O PAR: com um Bearer legítimo o MESMO middleware popula `req.user` com o papel
      // real. Sem ele, "não popula" também seria o comportamento de um middleware morto.
      const comBearer = {
        headers: { authorization: `Bearer ${tokenMembro}` },
        query: {}, cookies: {}, get: () => undefined, path: '/api/v1/config', method: 'GET',
      };
      await new Promise((resolve) => { flexibleAuth(comBearer, { cookie: () => {} }, resolve); });
      assert.equal(comBearer.user?.id, membro.id, 'o principal real chega');
      assert.equal(comBearer.user?.role, 'user', 'com o papel global que ele tem no banco');
    });

    it('as funções de acesso leem o principal AUSENTE como "ninguém", nos quatro eixos', async () => {
      // O deslogado chega ao SQL como NULL, e os quatro predicados do eixo respondem
      // false. É o que torna "modo" uma afirmação verificável em vez de uma escolha de
      // vocabulário.
      const { rows } = await db.query(
        `SELECT fn_principal_vivo(NULL)                                        AS vivo,
                fn_has_global_data_access(NULL)                                AS dado,
                fn_is_global_admin(NULL)                                       AS sistema,
                fn_can_produce_resource(NULL, 'tileset', $1)                   AS produz`,
        [TS_PRODUZIDO]
      );
      assert.equal(rows[0].vivo, false);
      assert.equal(rows[0].dado, false);
      assert.equal(rows[0].sistema, false);
      assert.equal(rows[0].produz, false);

      // O PAR, principal a principal: as mesmas quatro funções respondem `true` para
      // quem de fato tem aquilo. Quatro `false` sozinhos passariam idênticos num
      // conjunto de funções que devolvesse `false` sempre.
      const { rows: reais } = await db.query(
        `SELECT fn_principal_vivo($1::uuid)                                    AS vivo,
                fn_has_global_data_access($2::uuid)                            AS dado,
                fn_is_global_admin($2::uuid)                                   AS sistema,
                fn_can_produce_resource($3::uuid, 'tileset', $4)               AS produz`,
        [membro.id, admin.id, produtor.id, TS_PRODUZIDO]
      );
      assert.equal(reais[0].vivo, true);
      assert.equal(reais[0].dado, true);
      assert.equal(reais[0].sistema, true);
      assert.equal(reais[0].produz, true);
    });
  });

  // ==========================================================================
  // 1.2 (adendo) — a chave de API carrega o PAPEL GLOBAL
  // ==========================================================================
  //
  // "A chave é o usuário inteiro: ela resolve para a linha de `users` e carrega o papel
  // global, administrador inclusive." The cited test measures PRECEDENCE only.
  //
  // THE MEASUREMENT HAS TO BE ON A FLEXIBLE-ONLY ROUTE, and that is not a detail: the
  // strict `auth` adopts the live role from the database (`req.user.role = live.role`),
  // so an admin key would answer "admin" there even if the key branch hardcoded `user`.
  // `GET /sv360/projects` is flexible-only and `publicProjectView` decides by
  // `user?.role === 'admin'`, adding `db_filename` to the payload.
  //
  // AND THE OTHER HALF OF THIS TABLE ROW IS STALE, which is worth writing down instead
  // of measuring twice: "o corte de sessão em massa não a alcança" described the state
  // of 2026-08-23. The third amarra of clause 10.7 (2026-08-24) made the cut reach the
  // key by comparing its BIRTH, and that is asserted, with its own negative control, in
  // `tests/integration/chave-de-api-tres-amarras.test.js`.
  describe('1.2 (adendo) — a chave de API resolve com o papel global do titular', () => {
    let projetoSlug;

    before(async () => {
      projetoSlug = `parcial-360-${SFX}`;
      await db.query(
        `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                     center_lat, center_long, photo_count)
         VALUES ($1::uuid, $2, $3, $4, 'enabled', 'public', -30.0, -51.2, 0)`,
        [omProdutora, projetoSlug, `Projeto parcial ${SFX}`, `${projetoSlug}.db`]
      );
    });

    /**
     * The listing item for the seeded project, as this credential sees it.
     *
     * The 360 listing answers a BARE ARRAY, not the `{ data }` envelope of the rest of
     * the API: it is one of the frozen contracts (`backend/CLAUDE.md`), and reading it
     * as `body.data` is how this helper failed on its first run.
     */
    const itemDoProjeto = async (montarPedido) => {
      const res = await montarPedido(supertest(app).get('/api/v1/sv360/projects')).expect(200);
      assert.ok(Array.isArray(res.body), 'a listagem do 360 é um array nu (contrato congelado)');
      const item = res.body.find((p) => p.slug === projetoSlug);
      assert.ok(item, 'o projeto semeado precisa aparecer na listagem');
      return item;
    };

    const emitirChave = async (token, label) => (await supertest(app)
      .post('/api/v1/users/me/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ label, scope: 'full' })
      .expect(201)).body.data.apiKey;

    it('a chave de um ADMINISTRADOR chega ao payload de administração; a de um comum, não', async () => {
      const chaveAdmin = await emitirChave(tokenAdmin, `parcial admin ${SFX}`);
      const chaveComum = await emitirChave(tokenMembro, `parcial comum ${SFX}`);

      const anonimo = await itemDoProjeto((r) => r);
      assert.equal(anonimo.db_filename, undefined, 'piso: o anônimo não recebe o campo de administração');

      const doComum = await itemDoProjeto((r) => r.set('x-api-key', chaveComum));
      assert.equal(doComum.id, anonimo.id, 'a chave comum resolve e lê o mesmo projeto');
      assert.equal(
        doComum.db_filename, undefined,
        'e continua sem o campo: a chave não promove, ela carrega o papel que a conta tem'
      );

      const doAdmin = await itemDoProjeto((r) => r.set('x-api-key', chaveAdmin));
      assert.equal(
        doAdmin.db_filename, `${projetoSlug}.db`,
        'a chave do administrador carrega o papel GLOBAL até um ramo que decide por `user.role`'
      );
      assert.equal(doAdmin.organization_id ?? null, null,
        'e só o que a consulta de listagem seleciona: `organization_id` é das consultas de um projeto só');
    });

    it('o mesmo papel NÃO abre administração: a chave é recusada por CREDENCIAL', async () => {
      // O par que impede a leitura errada do caso acima. Carregar o papel global não é
      // alcançar a administração do sistema: `requireAdmin` recusa TODA chave, inclusive
      // a de um administrador (amarra 2 da cláusula 10.7). Os dois fatos convivem, e é a
      // convivência que descreve o que a chave é.
      const chaveAdmin = await emitirChave(tokenAdmin, `parcial admin gate ${SFX}`);
      await supertest(app)
        .get('/api/v1/users')
        .set('x-api-key', chaveAdmin)
        .expect(403);

      // DISCRIMINAÇÃO: o MESMO administrador, com o Bearer, passa na MESMA rota.
      await supertest(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
    });
  });

  // ==========================================================================
  // 1.3 — "somente o administrador promove alguém a produtor ou a credenciado"
  // ==========================================================================
  //
  // The cited test exercises the bicondicional and the ADMIN path. Its negative control
  // uses a plain `user` only, so the two roles that most invite the mistake, the ones a
  // reader could believe are "almost administrators", were never put in front of the
  // gate. `role !== 'user'` in a gate of administration promotes both in silence, which
  // is the inverse risk the census header names.
  describe('1.3 — nem o produtor nem o credenciado promovem ninguém', () => {
    it('produtor e credenciado levam 403 na promoção, e o alvo não se move', async () => {
      const alvo = await createUser(db, { username: `parc_alvo_${SFX}` });
      const credenciado = await createUser(db, { username: `parc_cred_${SFX}`, role: 'credenciado' });
      const tokenProdutor = await loginUser(app, produtor.username, produtor.password);
      const tokenCredenciado = await loginUser(app, credenciado.username, credenciado.password);

      const tentativas = [
        ['produtor', tokenProdutor, { role: 'credenciado' }],
        ['credenciado', tokenCredenciado, { role: 'producer', producer_org_id: omProdutora }],
        ['credenciado promovendo a administrador', tokenCredenciado, { role: 'admin' }],
      ];
      for (const [quem, token, corpo] of tentativas) {
        const res = await supertest(app)
          .put(`/api/v1/users/${alvo.id}`)
          .set('Authorization', `Bearer ${token}`)
          .send(corpo);
        assert.equal(res.status, 403, `${quem} não administra o sistema`);
      }

      const { rows } = await db.query(
        'SELECT role, producer_org_id FROM users WHERE id = $1', [alvo.id]
      );
      assert.equal(rows[0].role, 'user', 'o alvo continua usuário comum');
      assert.equal(rows[0].producer_org_id, null, 'e sem escopo de produção');

      // O PAR POSITIVO, sobre o MESMO alvo e com o MESMO corpo: o administrador promove.
      // Sem ele, os três 403 seriam compatíveis com uma rota que recusa todo mundo.
      await supertest(app)
        .put(`/api/v1/users/${alvo.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ role: 'producer', producer_org_id: omProdutora })
        .expect(200);
      const { rows: depois } = await db.query(
        'SELECT role, producer_org_id FROM users WHERE id = $1', [alvo.id]
      );
      assert.equal(depois[0].role, 'producer');
      assert.equal(depois[0].producer_org_id, omProdutora);

      await db.query("UPDATE users SET role = 'user', producer_org_id = NULL WHERE id = $1", [alvo.id]);
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[alvo.id, credenciado.id]]);
    });
  });
});
