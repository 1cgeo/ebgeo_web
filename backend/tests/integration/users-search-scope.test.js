// Path: tests/integration/users-search-scope.test.js
// Item 171 — SEARCH_USERS: os ramos OR por posto/organização, o shape da linha e o
// escopo ENTRE organizações.
//
// A query tem quatro ramos OR (username, nome, r.nome, o.nome) e dois LEFT JOIN. Os
// testes existentes (users-admin.test.js, org-identity-gaps.test.js) exercitam apenas
// username/nome, o mínimo de 2 caracteres, o inativo escondido e o teto LIMIT 20:
// apagar os JOINs de ranks/organizations deixava a suíte verde e esvaziava as colunas
// Posto/OM do autocomplete de compartilhamento.
//
// O escopo ENTRE ORGS é hoje acidental (não há filtro por organization_id, ao
// contrário da postura explícita de isolamento de tenant em users.schemas.js). Sem um
// teste que o DECLARE, ninguém sabe se é decisão ou esquecimento — o último caso aqui
// registra a decisão por escrito, para o dia em que alguém propuser escopar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

const U = () => `usrch_${randomUUID().slice(0, 8)}`;

// Shape congelado da linha do autocomplete de compartilhamento.
const CAMPOS = [
  'id', 'nome', 'organizacao_militar', 'organization_id',
  'posto_graduacao', 'rank_id', 'username',
].sort();

describe('GET /users/search — ramos por posto/OM, shape e escopo entre orgs', () => {
  let app, db, quemBusca, token;
  let comPosto, postoNome, orgB, usuarioOrgB, orgBNome, semPosto;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    quemBusca = await createUser(db, { username: U() });
    token = await loginUser(app, quemBusca.username, quemBusca.password);

    // Posto de nome ÚNICO (os postos semeados são compartilhados por quase todo
    // usuário da suíte, e o LIMIT 20 da query cortaria o alvo numa base povoada —
    // um teste que passa sozinho e falha em lote não prova a query, prova a ordem).
    postoNome = `Marechal ${randomUUID().slice(0, 12)}`;
    const { rows: rk } = await db.query(
      'INSERT INTO ranks (code, nome, nome_abrev, sort_order) VALUES (NULL, $1, $2, 900) RETURNING id',
      [postoNome, postoNome.slice(0, 20)]
    );
    comPosto = await createUser(db, { username: U(), nome: `Zulu ${U()}`, rank_id: rk[0].id });

    // Organização de nome ÚNICO, e um usuário nela.
    orgBNome = `Batalhao ${randomUUID().slice(0, 12)}`;
    const slug = `slug${randomUUID().slice(0, 12)}`;
    const { rows } = await db.query(
      'INSERT INTO organizations (nome, sigla, slug) VALUES ($1, $2, $3) RETURNING id',
      [orgBNome, slug.slice(0, 10), slug]
    );
    orgB = rows[0].id;
    usuarioOrgB = await createUser(db, { username: U(), nome: `Yankee ${U()}`, organization_id: orgB });

    // Usuário SEM posto (rank_id NULL): o LEFT JOIN tem de mantê-lo visível.
    semPosto = await createUser(db, { username: U(), nome: `Xray ${U()}`, rank_id: null });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const buscar = (q) =>
    supertest(app)
      .get(`/api/v1/users/search?q=${encodeURIComponent(q)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  it('ramo LOWER(r.nome): buscar pelo posto encontra quem o tem', async () => {
    // O fragmento não aparece em nenhum username nem em nenhum `nome`: só o ramo por
    // posto pode casar.
    const fragmento = postoNome.slice(-10);
    const res = await buscar(fragmento);

    const achou = res.body.data.find((u) => u.id === comPosto.id);
    assert.ok(achou, `buscar por "${fragmento}" tem de achar quem tem o posto ${postoNome}`);
    assert.equal(achou.posto_graduacao, postoNome, 'e a coluna Posto vem preenchida pelo LEFT JOIN');
  });

  it('ramo LOWER(o.nome): buscar por um fragmento do nome da OM encontra o usuário dela', async () => {
    const fragmento = orgBNome.slice(-10);
    const res = await buscar(fragmento);

    const achou = res.body.data.find((u) => u.id === usuarioOrgB.id);
    assert.ok(achou, 'o ramo por organização existe e é alcançável pela rota');
    assert.equal(achou.organizacao_militar, orgBNome);
    assert.equal(achou.organization_id, orgB);
  });

  it('shape: exatamente os sete campos, e nada parecido com credencial', async () => {
    const res = await buscar(postoNome.slice(-10));
    assert.ok(res.body.data.length > 0, 'guarda de lista não-vazia');

    for (const linha of res.body.data) {
      assert.deepEqual(Object.keys(linha).sort(), CAMPOS, `shape inesperado: ${JSON.stringify(linha)}`);
      const suspeitas = Object.keys(linha).filter((k) => /password|hash|api_key|email/i.test(k));
      assert.deepEqual(suspeitas, [], 'a busca é aberta a qualquer autenticado: nada sensível pode sair');
    }
  });

  it('rank_id NULL aparece na busca com posto_graduacao null (LEFT JOIN, não INNER)', async () => {
    const res = await buscar(semPosto.username);

    const achou = res.body.data.find((u) => u.id === semPosto.id);
    assert.ok(achou, 'um INNER JOIN silenciaria TODO usuário sem posto');
    assert.equal(achou.rank_id, null);
    assert.equal(achou.posto_graduacao, null);
  });

  it('CARACTERIZAÇÃO: a busca é deliberadamente GLOBAL — org A encontra org B', async () => {
    // Quem busca está na org default; o alvo está na org B. O compartilhamento entre
    // OMs é o caso de uso (um atlas conjunto entre unidades), então a ausência de
    // filtro por organization_id aqui é DECISÃO, não esquecimento. Escopar por tenant
    // quebra este teste de propósito, e a decisão volta à mesa.
    assert.notEqual(quemBusca.organization_id, orgB, 'as duas orgs são mesmo diferentes');

    const res = await buscar(usuarioOrgB.username);
    const achou = res.body.data.find((u) => u.id === usuarioOrgB.id);
    assert.ok(achou, 'busca entre organizações é permitida por decisão de produto');
  });
});
