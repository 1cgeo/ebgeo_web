// Path: tests/integration/om-impacto-de-desativacao.test.js
//
// As três contagens que a confirmação de desativação mostra, e o que cada uma NÃO conta.
//
// Por que este arquivo é sobre o que NÃO entra: um `COUNT(*)` sem filtro devolve um número
// plausível para qualquer fixture, e o assert "veio um número" passa com a consulta errada.
// Os três eixos são fáceis de confundir porque duas das colunas têm nomes quase iguais e
// moram na mesma tabela: `users.organization_id` é LOTAÇÃO (o eixo que a desativação
// BLOQUEIA) e `users.producer_org_id` é o escopo de PRODUÇÃO (o eixo que ela desarma). O
// mesmo usuário pode ter as duas apontando para OMs DIFERENTES, e a fixture aqui monta
// exatamente esse caso: se as duas contagens lessem a mesma coluna, uma delas ficaria
// vermelha.
//
// O CONTROLE NEGATIVO é o bloco final: uma OM VIZINHA, com efetivo e acervo próprios,
// existe durante o arquivo inteiro e não pode aparecer em contagem nenhuma da OM medida.
// Ele é o caso que passaria com um `COUNT(*)` sem `WHERE`, que é o erro que essa consulta
// convida a cometer.
//
// A terceira contagem soma CINCO tabelas, e `sv360.projects` entra pela coluna
// `organization_id` e não por `owner_org_id`: ali a OM produtora JÁ É `organization_id`.
// Somar a coluna errada não devolve zero, devolve erro de coluna inexistente.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createUser, loginUser } from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

describe('GET /organizations/:id/deactivation-impact', () => {
  let app, db;
  let orgMedida, orgVizinha, orgDoAdmin;
  let adminToken, adminId, contaComum;
  const usuariosCriados = [];
  const camadasCriadas = [];
  const projetosCriados = [];

  async function criarOrg(tag) {
    const { rows } = await db.query(
      'INSERT INTO organizations (nome, sigla, slug) VALUES ($1, $2, $3) RETURNING id',
      [`OM ${tag} ${SFX}`, `${tag}${SFX}`.slice(0, 10), `om-imp-${tag}-${SFX}`.toLowerCase()]
    );
    return rows[0].id;
  }

  async function criarConta(tag, campos) {
    const u = await createUser(db, { username: `imp_${tag}_${SFX}`, ...campos });
    usuariosCriados.push(u.id);
    return u;
  }

  async function criarCamadaDeAnalise(tag, ownerOrgId) {
    const id = `imp-camada-${tag}-${SFX}`;
    await db.query(
      `INSERT INTO analysis_layers (id, name, config, sort_order, owner_org_id)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid)`,
      [id, `Camada ${tag} ${SFX}`, ownerOrgId]
    );
    camadasCriadas.push(id);
    return id;
  }

  async function criarProjeto360(tag, orgId) {
    const slug = `imp-360-${tag}-${SFX}`;
    const { rows } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'public', -30.0, -51.0, 0) RETURNING id`,
      [orgId, slug, `Projeto ${tag} ${SFX}`, `${orgId}__${slug}.db`]
    );
    projetosCriados.push(rows[0].id);
    return rows[0].id;
  }

  const impacto = (orgId, token) => supertest(app)
    .get(`/api/v1/organizations/${orgId}/deactivation-impact`)
    .set('Authorization', `Bearer ${token}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgMedida = await criarOrg('medida');
    orgVizinha = await criarOrg('vizinha');
    orgDoAdmin = await criarOrg('doadmin');

    const admin = await createAdminUser(db, {
      username: `imp_admin_${SFX}`,
      organization_id: orgDoAdmin,
    });
    adminId = admin.id;
    adminToken = await loginUser(app, admin.username, admin.password);

    // LOTAÇÃO na OM medida: duas contas ativas e uma INATIVA.
    await criarConta('lot1', { organization_id: orgMedida });
    await criarConta('lot2', { organization_id: orgMedida });
    const inativa = await criarConta('lot_inativa', { organization_id: orgMedida });
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [inativa.id]);

    // PRODUÇÃO para a OM medida, LOTADO na vizinha. É a conta que separa os dois eixos:
    // ela conta em `activeProducers` e NÃO em `activeMembers`.
    await criarConta('prod', {
      organization_id: orgVizinha,
      role: 'producer',
      producer_org_id: orgMedida,
    });

    // Acervo da OM medida: uma camada de análise e um projeto 360.
    await criarCamadaDeAnalise('medida', orgMedida);
    await criarProjeto360('medida', orgMedida);

    // Acervo e efetivo da VIZINHA, que existem só para não serem contados.
    await criarConta('viz', { organization_id: orgVizinha });
    // A conta sem papel do caso de gate nasce aqui, e não dentro do `it`, porque as
    // contagens absolutas do controle negativo dependem dela: fixture criada no meio do
    // arquivo faz o número mudar conforme a ORDEM em que os casos rodam.
    contaComum = await criarConta('comum', { organization_id: orgVizinha });
    await criarCamadaDeAnalise('vizinha', orgVizinha);
    await criarProjeto360('vizinha', orgVizinha);
  });

  after(async () => {
    await db.query('DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])', [projetosCriados]);
    await db.query('DELETE FROM analysis_layers WHERE id = ANY($1::text[])', [camadasCriadas]);
    await db.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])',
      [[...usuariosCriados, adminId]]);
    await db.query('DELETE FROM audit_trail WHERE actor_id = $1', [adminId]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[...usuariosCriados, adminId]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])',
      [[orgMedida, orgVizinha, orgDoAdmin]]);
    await teardownTestEnv(db);
  });

  it('conta a LOTAÇÃO ativa, e só a ativa', async () => {
    const res = await impacto(orgMedida, adminToken);
    assert.equal(res.status, 200);
    // Absoluto, não "maior que zero": são três contas lotadas, uma delas inativa.
    assert.equal(res.body.data.activeMembers, 2);
  });

  it('conta o escopo de PRODUÇÃO pela outra coluna, e ele não é a lotação', async () => {
    const res = await impacto(orgMedida, adminToken);
    // A conta produtora está lotada na vizinha: se as duas contagens lessem
    // `organization_id`, este número seria 0 e o de cima seria 2; se as duas lessem
    // `producer_org_id`, este seria 1 e o de cima também.
    assert.equal(res.body.data.activeProducers, 1);
  });

  it('soma o acervo das cinco tabelas, inclusive sv360.projects', async () => {
    const res = await impacto(orgMedida, adminToken);
    assert.equal(res.body.data.catalogItems, 2);
  });

  it('devolve NÚMERO, não a string que COUNT entrega pelo driver', async () => {
    const res = await impacto(orgMedida, adminToken);
    // O bug que este assert pega: `bigint` chega como string, e a tela que compara
    // `=== 0` para dizer "nenhum impacto" nunca acerta.
    assert.equal(typeof res.body.data.activeMembers, 'number');
    assert.equal(typeof res.body.data.activeProducers, 'number');
    assert.equal(typeof res.body.data.catalogItems, 'number');
  });

  it('avisa quando a OM medida é a do próprio requisitante', async () => {
    const alheia = await impacto(orgMedida, adminToken);
    assert.equal(alheia.body.data.requesterIsMember, false);

    const propria = await impacto(orgDoAdmin, adminToken);
    assert.equal(propria.body.data.requesterIsMember, true);
  });

  it('404 para OM inexistente, antes de contar qualquer coisa', async () => {
    const res = await impacto(randomUUID(), adminToken);
    assert.equal(res.status, 404);
  });

  it('não é rota de leitor comum: conta sem papel de administrador leva 403', async () => {
    const token = await loginUser(app, contaComum.username, contaComum.password);
    const res = await impacto(orgMedida, token);
    assert.equal(res.status, 403);
  });

  // ==========================================================================
  // CONTROLE NEGATIVO — o caso que passaria com COUNT(*) sem WHERE.
  // ==========================================================================
  describe('CONTROLE NEGATIVO — a OM vizinha tem seus próprios números', () => {
    it('a vizinha é contada à parte, então nenhuma das duas conta a outra', async () => {
      const res = await impacto(orgVizinha, adminToken);
      assert.equal(res.status, 200);
      // Lotados na vizinha: 'viz', 'prod' (lotada aqui, produtora lá) e 'comum'. O
      // produtor da vizinha é ZERO: ninguém produz para ela.
      assert.equal(res.body.data.activeMembers, 3);
      assert.equal(res.body.data.activeProducers, 0);
      assert.equal(res.body.data.catalogItems, 2);
    });
  });
});
