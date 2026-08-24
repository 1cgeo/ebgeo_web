// Path: tests/integration/chave-de-api-exige-om-ativa.test.js
//
// A chave de API valia com a OM de lotação DESATIVADA, e o buraco só existia nas rotas
// SÓ-FLEXÍVEIS — que são justamente as leituras de recurso privado (sv360, nomes,
// assets3d).
//
// POR QUE A ASSIMETRIA SOBREVIVEU: numa rota de `auth` ESTRITO o principal de chave passa
// pela reconciliação viva (`LIVE_AUTH_STATE`) e leva 403 'Organization is inactive', então
// toda medição feita por `/auth/me` — que é como a suíte inteira exercitava este
// middleware — mostrava a porta FECHADA. `FIND_USER_BY_API_KEY` filtrava só
// `u.is_active`, e o ramo de chave de `flexible-auth.js` devolve `next()` sem consultar
// organização nenhuma, então numa rota sem o estrito o principal continuava de pé.
//
// A SUPERFÍCIE MEDIDA aqui é a listagem do 360 com atlas em foco, e ela foi escolhida por
// ser o único ramo do predicado de acesso que NÃO confere a liveness de quem pergunta: o
// EMPRÉSTIMO do atlas (o terceiro braço de `fn_granted_resource_ids`) amarra o acesso ao
// DONO do atlas, não ao beneficiário. Os outros ramos (papel global, produção, concessão
// direta) já chamavam `fn_principal_vivo` e portanto já estavam fechados no SQL — medir
// por eles daria verde com e sem o conserto, que é a cobertura vazia da constituição.
//
// O CONTROLE NEGATIVO é o bloco final, e ele é o mais importante do arquivo: a conta e a
// chave continuam INTACTAS no banco (a mesma consulta SEM o termo de organização devolve
// a linha), de modo que o zero da consulta corrigida vem do termo novo e não de uma
// fixture que se desfez. Sem esse par, "não achou o usuário" e "recusou o usuário" são
// indistinguíveis.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createUser, createAtlas, createShare } from '../helpers/fixtures.js';
import { FIND_USER_BY_API_KEY } from '../../src/modules/users/users.queries.js';

const SFX = randomUUID().slice(0, 8);
const SLUG_PRIVADO = `chave-360-privado-${SFX}`;

describe('a chave de API exige a OM de lotação ATIVA', () => {
  let app, db;
  let orgDoPortador, orgProdutora;
  let portadorId, chave, adminId, atlasId, projetoId;

  async function criarOrg(tag) {
    const { rows } = await db.query(
      'INSERT INTO organizations (nome, sigla, slug) VALUES ($1, $2, $3) RETURNING id',
      [`OM ${tag} ${SFX}`, `${tag}${SFX}`.slice(0, 10), `om-chave-${tag}-${SFX}`.toLowerCase()]
    );
    return rows[0].id;
  }

  const setOrgAtiva = (id, ativa) =>
    db.query('UPDATE organizations SET is_active = $1 WHERE id = $2', [ativa, id]);

  /** A listagem do 360 COM atlas em foco, autenticada só pela chave. */
  const listar360 = () => supertest(app)
    .get(`/api/v1/sv360/projects?atlasId=${atlasId}`)
    .set('x-api-key', chave);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgDoPortador = await criarOrg('portador');
    orgProdutora = await criarOrg('produtora');

    // O DONO DO ATLAS É ADMINISTRADOR de propósito: o braço do empréstimo exige que o
    // DONO alcance o recurso, e `fn_has_global_data_access` é a forma mais curta de
    // garantir isso sem montar uma cadeia de concessões que não é o assunto aqui.
    const admin = await createAdminUser(db, { username: `chave_dono_${SFX}` });
    adminId = admin.id;

    const portador = await createUser(db, {
      username: `chave_portador_${SFX}`,
      organization_id: orgDoPortador,
    });
    portadorId = portador.id;
    const { rows: k } = await db.query(
      'UPDATE users SET api_key = gen_random_uuid() WHERE id = $1 RETURNING api_key',
      [portadorId]
    );
    chave = k[0].api_key;

    const atlas = await createAtlas(db, adminId, { name: `Atlas chave ${SFX}` });
    atlasId = atlas.id;
    await createShare(db, atlasId, portadorId, 'read', adminId);

    // Projeto 360 PRIVADO de uma terceira OM, emprestado ao atlas. `enabled` porque o
    // eixo de status é ortogonal ao de privacidade e `disabled` esconderia de todos,
    // inclusive de quem tem o empréstimo — o teste mediria a coluna errada.
    const { rows: p } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'private', -30.0, -51.0, 0) RETURNING id`,
      [orgProdutora, SLUG_PRIVADO, `Projeto chave ${SFX}`, `${orgProdutora}__${SLUG_PRIVADO}.db`]
    );
    projetoId = p[0].id;
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, 'sv360_project', $2, $3)`,
      [atlasId, projetoId, adminId]
    );
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE atlas_id = $1', [atlasId]);
    await db.query('DELETE FROM sv360.projects WHERE id = $1', [projetoId]);
    await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1', [atlasId]);
    await db.query('DELETE FROM atlas WHERE id = $1', [atlasId]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[portadorId, adminId]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])',
      [[orgDoPortador, orgProdutora]]);
    await teardownTestEnv(db);
  });

  it('CONTROLE POSITIVO — com a OM ativa a chave enxerga o privado emprestado', async () => {
    const res = await listar360();
    assert.equal(res.status, 200);
    const slugs = res.body.map((p) => p.slug);
    // O positivo do par: sem ele, o negativo abaixo passaria idêntico com a fixture
    // quebrada, com a rota renomeada ou com o predicado negando tudo.
    assert.ok(slugs.includes(SLUG_PRIVADO));
  });

  it('desativada a OM de lotação, a chave deixa de autenticar na rota só-flexível', async () => {
    await setOrgAtiva(orgDoPortador, false);

    const res = await listar360();
    // 404, e não uma lista vazia: sem principal, o pedido vira anônimo e morre no
    // `requireAtlasPermission('read')` do atlas, que responde 404 para quem não tem
    // relação nenhuma com ele. O recurso emprestado nem chega a ser consultado.
    assert.equal(res.status, 404);
  });

  it('e a mesma chave, na rota ESTRITA, deixa de ser 403 e passa a ser 401', async () => {
    // Este é o assert que mostra POR QUE o buraco durou: a porta estrita já estava
    // fechada, só que por outra guarda (a reconciliação viva, que respondia 403). Agora
    // o principal nem chega a existir, então o estrito reclama da credencial ausente.
    //
    // O estado é posto AQUI, e não herdado do caso anterior: caso que depende da ordem
    // de execução vira verde-por-acaso no dia em que o corredor mudar de ordem.
    await setOrgAtiva(orgDoPortador, false);
    const res = await supertest(app).get('/api/v1/auth/me').set('x-api-key', chave);
    assert.equal(res.status, 401);
  });

  it('reativada a OM, a mesma chave volta a valer: a recusa é de ESTADO, não de chave', async () => {
    await setOrgAtiva(orgDoPortador, true);
    const res = await listar360();
    assert.equal(res.status, 200);
    assert.ok(res.body.map((p) => p.slug).includes(SLUG_PRIVADO));
  });

  it('conta SEM lotação continua valendo: linha ausente conta como ativa', async () => {
    // A regra do `COALESCE` de `utils/org-status.js`, repetida na consulta. Trancar quem
    // não tem OM seria inventar uma revogação que ninguém pediu.
    const semOm = await createUser(db, {
      username: `chave_sem_om_${SFX}`,
      organization_id: null,
    });
    const { rows: k } = await db.query(
      'UPDATE users SET api_key = gen_random_uuid() WHERE id = $1 RETURNING api_key',
      [semOm.id]
    );
    const { rows } = await db.query(FIND_USER_BY_API_KEY, [k[0].api_key]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, semOm.id);
    await db.query('DELETE FROM users WHERE id = $1', [semOm.id]);
  });

  // ==========================================================================
  // CONTROLE NEGATIVO — o caso que passaria se o termo novo não existisse.
  // ==========================================================================
  describe('CONTROLE NEGATIVO — a linha continua lá, só o termo novo a exclui', () => {
    before(async () => {
      await setOrgAtiva(orgDoPortador, false);
    });

    after(async () => {
      await setOrgAtiva(orgDoPortador, true);
    });

    it('a consulta SEM o termo de organização ainda devolve o portador', async () => {
      // Byte a byte o predicado antigo. Ele achar a linha é o que prova que a conta está
      // ativa, que a chave é a certa e que nada da fixture se desfez.
      const { rows } = await db.query(
        'SELECT u.id FROM users u WHERE u.api_key = $1 AND u.is_active = true',
        [chave]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, portadorId);
    });

    it('e a consulta VIGENTE não devolve nada, pela OM e por mais nada', async () => {
      const { rows } = await db.query(FIND_USER_BY_API_KEY, [chave]);
      assert.equal(rows.length, 0);
    });
  });
});
