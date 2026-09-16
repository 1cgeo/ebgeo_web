// Path: tests/integration/posto-abreviado.test.js
//
// O POSTO QUE VIAJA PARA A TELA É A ABREVIATURA, e não o nome por extenso.
//
// POR QUE ISTO É REGRA DE DOMÍNIO, e não preferência de estilo: no Exército o posto se escreve
// abreviado (`1º Ten`, `Cap`, `TC`, `Gen Bda`), e a forma por extenso ("Primeiro Tenente") não
// é a que aparece em documento, em assinatura nem em lista de pessoal. A tabela `ranks` já
// carrega as duas, `nome` e `nome_abrev`, e a semente traz a abreviatura certa nas 19 linhas;
// o que estava errado era a ESCOLHA: dezesseis consultas em quatro módulos projetavam
// `r.nome AS posto_graduacao` (decisão do chefe, 2026-09-16).
//
// A QUEDA PARA O NOME É DE PROPÓSITO. `nome_abrev` é anulável (`ranks.schemas.js` aceita null e
// o painel permite limpar), e um posto sem abreviatura tem de aparecer por extenso em vez de
// sumir da tela. Por isso `COALESCE(r.nome_abrev, r.nome)`, e por isso o segundo caso deste
// arquivo mede justamente esse ramo: uma régua que só olhasse a abreviatura passaria com um
// `posto_graduacao` vazio.
//
// A FAMÍLIA É DE QUATRO MÓDULOS, e este arquivo cobre os quatro (`users`, `auth`,
// `access-groups`, `atlas`): medir só o `/users/me` deixaria três superfícies livres para
// divergir no dia seguinte.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('o posto viaja abreviado', () => {
  let app, db, admin, adminToken, tenente, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // `1º Ten` é o caso que o chefe nomeou, e é também o que separa as duas formas de maneira
    // inconfundível: "Primeiro Tenente" não se parece com "1º Ten" por acidente de prefixo.
    const { rows } = await db.query(
      "SELECT id, nome, nome_abrev FROM ranks WHERE nome = 'Primeiro Tenente' LIMIT 1"
    );
    assert.ok(rows[0], 'fixture: o posto semeado "Primeiro Tenente" tem de existir');
    assert.equal(rows[0].nome_abrev, '1º Ten', 'fixture: a semente já traz a abreviatura certa');
    const posto = rows[0];

    admin = await createUser(db, { username: 'posto_admin', role: 'admin' });
    adminToken = await loginUser(app, admin.username, admin.password);

    tenente = await createUser(db, { username: 'posto_tenente' });
    await db.query('UPDATE users SET rank_id = $1 WHERE id = $2', [posto.id, tenente.id]);

    atlas = await createAtlas(db, tenente.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('/users/me devolve a abreviatura', async () => {
    const token = await loginUser(app, tenente.username, tenente.password);
    const res = await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.data.posto_graduacao, '1º Ten');
  });

  it('o login devolve a abreviatura no mesmo campo', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: tenente.username, password: tenente.password })
      .expect(200);

    assert.equal(res.body.data.user.posto_graduacao, '1º Ten');
  });

  it('a lista de usuários do administrador devolve a abreviatura', async () => {
    const res = await supertest(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const linhas = res.body.data.users ?? res.body.data;
    const alvo = linhas.find((u) => u.username === tenente.username);
    assert.ok(alvo, 'o usuário do posto tem de estar na lista');
    assert.equal(alvo.posto_graduacao, '1º Ten');
  });

  it('o resumo do atlas devolve a abreviatura do dono', async () => {
    const token = await loginUser(app, tenente.username, tenente.password);
    const res = await supertest(app)
      .get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // O resumo não traz um `owner` próprio: cada atlas traz `members[]`, e o dono é o membro
    // com `permission: 'owner'`. É essa consulta (`atlas.queries.js`) que projeta o posto aqui.
    const alvo = res.body.data.atlases.find((a) => a.id === atlas.id);
    assert.ok(alvo, 'o atlas do usuário tem de estar no resumo');
    const dono = alvo.members.find((m) => m.permission === 'owner');
    assert.ok(dono, 'o resumo tem de nomear o dono entre os membros');
    assert.equal(dono.posto_graduacao, '1º Ten');
  });

  it('um posto SEM abreviatura cai para o nome por extenso, em vez de vir vazio', async () => {
    // O RAMO DA QUEDA, e o que ele protege: `nome_abrev` é anulável, e um posto recém-criado
    // pelo painel pode não ter uma. Sem o COALESCE, a tela mostraria o campo vazio, que é pior
    // que o nome comprido.
    const { rows } = await db.query(
      `INSERT INTO ranks (code, nome, nome_abrev, sort_order)
       VALUES (901, 'Posto Sem Abreviatura', NULL, 901) RETURNING id`
    );
    const semAbrev = rows[0].id;
    const outro = await createUser(db, { username: 'posto_sem_abrev' });
    await db.query('UPDATE users SET rank_id = $1 WHERE id = $2', [semAbrev, outro.id]);

    const token = await loginUser(app, outro.username, outro.password);
    const res = await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.data.posto_graduacao, 'Posto Sem Abreviatura');
  });

  it('o catálogo de postos do /api/config continua trazendo as DUAS formas', async () => {
    // O CONTROLE do outro lado: a tela de administração de pessoal edita `nome` e `nome_abrev`,
    // e o seletor de posto precisa da abreviatura para rotular. Abreviar a projeção não pode
    // fazer o nome por extenso desaparecer do catálogo.
    const res = await supertest(app).get('/api/v1/config').expect(200);
    const postos = res.body.data.postos;
    const alvo = postos.find((p) => p.name === 'Primeiro Tenente');
    assert.ok(alvo, 'o nome por extenso continua no catálogo');
    assert.equal(alvo.abrev, '1º Ten');
  });
});
