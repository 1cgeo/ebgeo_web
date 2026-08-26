// Path: tests/integration/auth-om-lida-uma-vez.test.js
//
// A OM DE LOTACAO E LIDA UMA VEZ SO no login e na renovacao, e a isencao de quem nao
// tem OM continua valendo.
//
// O QUE ESTE ARQUIVO PRENDE, e por que ele existe alem do `auth-org-gate.test.js`.
// Aquele arquivo cobra o EFEITO do portao O1 (403 para membro de OM desativada). Ele
// passa verde tanto com uma consulta quanto com duas, porque status HTTP nao conta
// round-trip. O custo era invisivel: `FIND_USER_BY_USERNAME` ja juntava `organizations`
// (projetava so `o.nome`), e logo depois `orgIsActive` abria OUTRA consulta na MESMA
// linha. Junção paga, resultado jogado fora, segunda ida ao banco.
//
// MEDIDO com `installPoolQueryCounter` antes do conserto, em 2026-08-25:
//   login   5 consultas, a segunda delas `SELECT is_active FROM organizations WHERE id = $1`
//   refresh 4 consultas, a terceira delas a mesma consulta isolada
// Depois: 4 e 3, sem a consulta isolada. A queda e de exatamente uma em cada caminho.
//
// A ISENCAO E O CASO QUE NENHUM TESTE COBRIA. `orgIsActive` comeca com
// `if (!organizationId) return true`: usuario SEM OM passa, porque nao ha OM para
// desativar. Trocando a chamada por um teste sobre a coluna nova, o jeito ingenuo
// (`if (!user.org_ativa) throw`) BARRA esse usuario, e nenhum caso de login exercitava
// `organization_id` NULL — a isencao so era medida pela funcao isolada, em teste de
// unidade. Os dois casos NULO abaixo sao a regressao que faltava vigiar.
//
// A CONTAGEM PRECISA DA LISTA. Um `assert.equal(count, 4)` sozinho passaria verde se
// alguem trocasse a consulta isolada por outra igualmente supérflua, entao a afirmação
// forte e a NEGATIVA sobre os statements: nenhuma leitura solta de `organizations` no
// caminho. A contagem fica como guarda contra a consulta nova que ninguem previu.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';
import { installPoolQueryCounter } from '../helpers/query-counter.js';
import { query as queryDoApp } from '../../src/database/index.js';

const SFX = randomUUID().slice(0, 8);

/** Custo medido do POST /auth/login depois do conserto: usuario, last_login, refresh, trilha. */
const CONSULTAS_DO_LOGIN = 4;
/** Custo medido do POST /auth/refresh depois do conserto: claim, usuario, novo refresh. */
const CONSULTAS_DO_REFRESH = 3;

/** A leitura solta que o conserto elimina. */
const LEITURA_SOLTA_DE_OM = /^SELECT is_active FROM organizations/i;

describe('login e refresh leem a OM de lotacao uma vez so', () => {
  let app, db, contador;

  const login = (u, p) => supertest(app).post('/api/v1/auth/login').send({ username: u, password: p });
  const refresh = (t) => supertest(app).post('/api/v1/auth/refresh').send({ refreshToken: t });

  async function criarOm(tag, ativa = true) {
    const { rows } = await db.query(
      `INSERT INTO organizations (nome, sigla, slug, is_active) VALUES ($1,$2,$3,$4) RETURNING id`,
      [`Om ${tag} ${SFX}`, `M${tag}${SFX.slice(0, 3)}`, `om-${tag}-${SFX}`.toLowerCase(), ativa]
    );
    return rows[0].id;
  }

  const soltas = (estado) => estado.statements.filter((s) => LEITURA_SOLTA_DE_OM.test(s));
  const lista = (estado) => estado.statements.join(' | ');

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    // O contador entra DEPOIS das fixturas, que escrevem e legitimamente.
    contador = installPoolQueryCounter();
  });

  after(async () => {
    if (contador) contador.restore();
    await teardownTestEnv(db);
  });

  it('discriminacao: o contador ENXERGA a leitura solta que o conserto tirou', async () => {
    // Sem este caso, toda lista vazia abaixo passaria verde tambem com o contador cego.
    contador.reset();
    await queryDoApp('SELECT is_active FROM organizations WHERE id = $1', [
      '00000000-0000-0000-0000-000000000001',
    ]);
    assert.equal(soltas(contador.state).length, 1, 'o contador precisa ver a consulta isolada');
  });

  it('login custa 4 consultas e nenhuma delas le `organizations` sozinha', async () => {
    const om = await criarOm('l1');
    const u = await createUser(db, { username: `om1_${SFX}`, organization_id: om });

    contador.reset();
    const res = await login(u.username, u.password);
    assert.equal(res.status, 200);

    assert.deepEqual(
      soltas(contador.state), [],
      `o JOIN de FIND_USER_BY_USERNAME ja traz a vivacidade: ${lista(contador.state)}`
    );
    assert.equal(
      contador.state.count, CONSULTAS_DO_LOGIN,
      `login deveria custar ${CONSULTAS_DO_LOGIN} consultas, custou ${contador.state.count}: `
      + lista(contador.state)
    );
  });

  it('refresh custa 3 consultas e nenhuma delas le `organizations` sozinha', async () => {
    const om = await criarOm('r1');
    const u = await createUser(db, { username: `om2_${SFX}`, organization_id: om });
    const entrada = await login(u.username, u.password);
    assert.equal(entrada.status, 200);

    contador.reset();
    const res = await refresh(entrada.body.data.refreshToken);
    assert.equal(res.status, 200);

    assert.deepEqual(
      soltas(contador.state), [],
      `FIND_USER_BY_ID ja projeta a vivacidade da lotacao: ${lista(contador.state)}`
    );
    assert.equal(
      contador.state.count, CONSULTAS_DO_REFRESH,
      `refresh deveria custar ${CONSULTAS_DO_REFRESH} consultas, custou ${contador.state.count}: `
      + lista(contador.state)
    );
  });

  // ==========================================================================
  // A isencao: sem OM nao ha OM para desativar.
  // ==========================================================================
  it('usuario SEM organizacao entra normalmente (a isencao de `orgIsActive`)', async () => {
    const u = await createUser(db, { username: `om3_${SFX}`, organization_id: null });
    const res = await login(u.username, u.password);
    assert.equal(
      res.status, 200,
      'organization_id NULL nao e OM inativa: barrar aqui e a regressao obvia do conserto'
    );
    assert.equal(res.body.data.user.organization_id, null);
  });

  it('usuario SEM organizacao tambem RENOVA normalmente', async () => {
    const u = await createUser(db, { username: `om4_${SFX}`, organization_id: null });
    const entrada = await login(u.username, u.password);
    assert.equal(entrada.status, 200);
    const res = await refresh(entrada.body.data.refreshToken);
    assert.equal(res.status, 200, 'o mesmo buraco existe no caminho do refresh');
  });

  // ==========================================================================
  // O portao continua fechando: o conserto nao pode afrouxar O1.
  // ==========================================================================
  it('OM desativada continua barrando o login com 403', async () => {
    const om = await criarOm('l2', false);
    const u = await createUser(db, { username: `om5_${SFX}`, organization_id: om });
    const res = await login(u.username, u.password);
    assert.equal(res.status, 403, 'a coluna nova tem de recusar onde a funcao recusava');
  });

  it('OM desativada DEPOIS da entrada barra a renovacao com 403', async () => {
    const om = await criarOm('r2');
    const u = await createUser(db, { username: `om6_${SFX}`, organization_id: om });
    const entrada = await login(u.username, u.password);
    assert.equal(entrada.status, 200);

    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [om]);
    const res = await refresh(entrada.body.data.refreshToken);
    assert.equal(res.status, 403, 'a renovacao le o banco vivo, nunca a claim do token');
  });
});
