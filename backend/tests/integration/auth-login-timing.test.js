// Path: tests/integration/auth-login-timing.test.js
//
// Item 8. `auth-hardening.test.js:30` se chama "timing-safe login" e compara apenas as
// duas MENSAGENS de erro. Trocando `auth.service.js:79-85` por um curto-circuito
// (`if (!user) throw new UnauthorizedError('Usuário ou senha inválidos')`), a mensagem
// continua idêntica, aquele teste continua verde, e o oráculo de tempo volta: usuário
// inexistente responde em ~2 ms, senha errada em ~250 ms (bcrypt custo 12), o que
// permite enumerar contas em massa. A propriedade que dá nome ao teste não tinha teste.
//
// ARMADILHA DO HARNESS, e é a razão de este arquivo criar os próprios usuários:
// `tests/helpers/fixtures.js` hasheia com SALT_ROUNDS = 4 "for test speed". Um usuário
// de fixture responde em ~5 ms enquanto o DUMMY_HASH do serviço é custo 12 (~250 ms),
// de modo que a razão medida contra um fixture acusaria assimetria ENORME — e no
// sentido inverso do defeito real. Medir a propriedade de produção exige um hash de
// produção; os usuários abaixo são criados com custo 12 de propósito.
//
// As margens são folgadas por desenho: o piso de 50 ms fica ~5x abaixo do bcrypt custo
// 12 real e ~10x acima do curto-circuito quebrado (<5 ms), então nem o CI lento nem a
// máquina rápida transformam isso em teste instável.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const SFX = randomUUID().slice(0, 8);
const PROD_ROUNDS = 12;      // o mesmo SALT_ROUNDS de auth.service.js
const PASSWORD = 'Test@1234';
const SAMPLES = 5;
const WARMUP = 2;
const FLOOR_MS = 50;

/** Median of a numeric array. */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

describe('login is timing-safe: the username does not change the response time (8)', () => {
  let app, db, realUser;

  /** POST /auth/login and return the elapsed milliseconds plus the status. */
  async function timedLogin(username, password) {
    const t0 = process.hrtime.bigint();
    const res = await supertest(app).post('/api/v1/auth/login').send({ username, password });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return { ms, status: res.status, body: res.body };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // Usuário com hash de PRODUÇÃO (custo 12) — ver a nota do cabeçalho.
    const hash = await bcrypt.hash(PASSWORD, PROD_ROUNDS);
    const { rows: r } = await db.query("SELECT id FROM ranks WHERE nome_abrev = 'Cap' LIMIT 1");
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, nome, rank_id, organization_id, role)
       VALUES ($1,$2,$3,$4,$5,'user') RETURNING *`,
      [`tm_real_${SFX}`, hash, 'Timing User', r[0]?.id ?? null, '00000000-0000-0000-0000-000000000001']
    );
    realUser = rows[0];

    // O limiter fica DESLIGADO (default em teste): RATE_LIMIT_FORCE não é setado aqui,
    // senão a rajada de amostras viraria 429 e a medição mediria o limiter.
    delete process.env.RATE_LIMIT_FORCE;

    // Warm-up: JIT + primeira conexão do pool não podem entrar nas amostras.
    for (let i = 0; i < WARMUP; i++) {
      await timedLogin(`tm_warm_${SFX}_${i}`, PASSWORD);
      await timedLogin(realUser.username, 'senha-errada');
    }
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('guard: the fixture user really carries a cost-12 hash (senão a medição é sobre outra coisa)', async () => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [realUser.id]);
    assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/, 'o hash precisa ser custo 12');
  });

  it('guard: the rate limiter is OFF (um 429 responderia em ~1 ms e falsearia tudo)', async () => {
    const res = await timedLogin(`tm_guard_${SFX}`, PASSWORD);
    assert.equal(res.status, 401, `esperado 401, obtive ${res.status}`);
  });

  it('a NONEXISTENT username still costs a full bcrypt compare (mediana >= 50 ms)', async () => {
    // Este é o assert que morre com o curto-circuito: sem o DUMMY_HASH a resposta sai
    // em poucos milissegundos porque nada é comparado.
    const amostras = [];
    for (let i = 0; i < SAMPLES; i++) {
      const r = await timedLogin(`tm_ghost_${SFX}_${i}`, PASSWORD);
      assert.equal(r.status, 401);
      amostras.push(r.ms);
    }
    const med = median(amostras);
    assert.ok(
      med >= FLOOR_MS,
      `usuário inexistente respondeu em ${med.toFixed(1)} ms (< ${FLOOR_MS}): o oráculo de tempo voltou. Amostras: ${amostras.map((x) => x.toFixed(0)).join(', ')}`
    );
  });

  it('control do instrumento: a WRONG PASSWORD on a real account is also >= 50 ms', async () => {
    // Sem isto, o teste de razão abaixo passaria vazio caso o instrumento medisse ~0
    // nos dois lados (por exemplo se o limiter estivesse ligado).
    const amostras = [];
    for (let i = 0; i < SAMPLES; i++) {
      const r = await timedLogin(realUser.username, 'senha-errada');
      assert.equal(r.status, 401);
      amostras.push(r.ms);
    }
    const med = median(amostras);
    assert.ok(med >= FLOOR_MS, `senha errada respondeu em ${med.toFixed(1)} ms`);
  });

  it('a razão mediana(inexistente)/mediana(senha-errada) fica dentro de [0.4, 2.5]', async () => {
    const ghost = [];
    const wrong = [];
    // Intercalado de propósito: uma máquina que fica lenta no meio da execução
    // deslocaria as duas séries juntas em vez de enviesar uma delas.
    for (let i = 0; i < SAMPLES; i++) {
      ghost.push((await timedLogin(`tm_mix_${SFX}_${i}`, PASSWORD)).ms);
      wrong.push((await timedLogin(realUser.username, 'senha-errada')).ms);
    }
    const mg = median(ghost);
    const mw = median(wrong);
    const razao = mg / mw;

    assert.ok(mw > 0, 'o instrumento precisa medir algo');
    assert.ok(
      razao >= 0.4 && razao <= 2.5,
      `razão ${razao.toFixed(2)} fora de [0.4, 2.5] — inexistente ${mg.toFixed(0)} ms vs senha errada ${mw.toFixed(0)} ms`
    );
  });

  it('as duas respostas continuam indistinguíveis também no corpo (o teste antigo, preservado)', async () => {
    const a = await timedLogin(`tm_msg_${SFX}`, PASSWORD);
    const b = await timedLogin(realUser.username, 'senha-errada');
    assert.equal(a.status, b.status);
    assert.deepEqual(a.body, b.body, 'mensagem/código idênticos: nenhum oráculo textual');
  });

  it('control: a senha CORRETA entra (o 401 acima não é um login quebrado)', async () => {
    const r = await timedLogin(realUser.username, PASSWORD);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.accessToken);
  });
});
