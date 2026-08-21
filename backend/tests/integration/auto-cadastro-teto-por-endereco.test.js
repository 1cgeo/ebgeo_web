// Path: tests/integration/auto-cadastro-teto-por-endereco.test.js
//
// O TETO DE `/auth/register` POR ENDEREÇO, e por que o limitador que já existia não
// bastava.
//
// `authLimiter` chaveia por `${ip}:${username}`. Isso estrangula força-bruta em
// `/login`, onde o alvo É o campo que compõe a chave. Em `/register` o `username` é
// escolhido pelo chamador e por definição ainda não existe, então cada tentativa com um
// nome novo compra um BALDE NOVO: N cadastros do mesmo endereço passavam todos. Isso é
// criação de conta em massa e, pior, amplificador de e-mail (`sendAccountExistsEmail`
// sai para um endereço escolhido por quem chama, no ramo de colisão).
//
// DUAS MEDIÇÕES NO MESMO ARQUIVO, e é o par que separa "existe teto" de "existe teto
// ÚTIL": o caso 1 prova que o limitador por username funciona (mesmo nome, teto batido)
// e o caso 2 prova que ele não alcança o que importa (nomes distintos passando até o
// teto por ENDEREÇO os cortar).
//
// ISOLAMENTO, medido antes de escrever: `RATE_LIMIT_FORCE=1` é lido a cada requisição
// pelo `skip` de rate-limit.js, e o runner (`node --test`) dá UM PROCESSO POR ARQUIVO —
// verificado com uma sonda de dois arquivos, em que o segundo não enxergou a env que o
// primeiro setou. Logo ligar o forcing aqui não contamina vizinho.
//
// Os tetos são baixados por env ANTES de o config congelar, e por isso os imports do app
// são dinâmicos: `config.js` lê `process.env` na avaliação do módulo, e um `import`
// estático seria içado para antes das linhas abaixo.

process.env.RATE_LIMIT_FORCE = '1';
process.env.RATE_LIMIT_REGISTER_MAX = '9';
process.env.RATE_LIMIT_REGISTER_WINDOW_MS = '3600000';
process.env.RATE_LIMIT_AUTH_MAX = '3';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const { default: config } = await import('../../src/config.js');

const SFX = randomUUID().slice(0, 8);
const PW = 'Sup3r-Secret-Pw!';

/** Teto por ENDEREÇO e teto por (endereço, username), como o config os congelou. */
const REG_MAX = config.rateLimit.registerMax;
const AUTH_MAX = config.rateLimit.authMax;

describe('POST /auth/register — o teto por endereço, e o balde que ele NÃO drena', () => {
  let app, db;
  let gastos = 0; // requisições já contadas no balde por ENDEREÇO

  const register = (username) => {
    gastos++;
    return supertest(app).post('/api/v1/auth/register').send({
      username, password: PW, nome: 'Teto', email: `${username}@example.mil`,
    });
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    assert.equal(config.security.allowSelfRegistration, true, 'fixture: a rota precisa estar montada');
    assert.equal(REG_MAX, 9, 'fixture: os tetos vêm das envs setadas no topo deste arquivo');
    assert.equal(AUTH_MAX, 3, 'fixture: idem');
    assert.equal(
      process.env.RATE_LIMIT_FORCE, '1',
      'fixture: sem o forcing o `skip` desliga TODO limitador em NODE_ENV=test e nada abaixo mede nada'
    );
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('PISO — com o MESMO username o teto por (endereço, username) corta', async () => {
    // Isto é o limitador que já existia, e ele funciona. AUTH_MAX tentativas passam a
    // porta dele; a seguinte é 429. As três primeiras são colisões de username depois da
    // primeira, o que não importa: o limitador roda ANTES do `validate` e do serviço.
    const username = `teto_mesmo_${SFX}`;
    for (let i = 0; i < AUTH_MAX; i++) {
      const res = await register(username);
      assert.equal(res.status, 201, `tentativa ${i + 1} deveria passar, veio ${res.status}`);
    }
    const cortada = await register(username);
    assert.equal(cortada.status, 429, 'a tentativa AUTH_MAX+1 com o mesmo nome é recusada');
    assert.equal(cortada.body.error.code, 'TOO_MANY_REQUESTS');
  });

  it('O QUE IMPORTA — com usernames DISTINTOS quem corta é o teto por ENDEREÇO', async () => {
    // Cada nome novo compra um balde novo no `authLimiter` (a chave é escolhida pelo
    // chamador), então nenhuma destas seria recusada por ele: AUTH_MAX é 3 e passam mais
    // do que isso. Quem as conta é o balde por endereço, e é ele que fecha em REG_MAX.
    const restantes = REG_MAX - gastos;
    assert.ok(restantes >= 3, `o arquivo precisa de folga no balde por endereço (restam ${restantes})`);

    for (let i = 0; i < restantes; i++) {
      const res = await register(`teto_dist_${SFX}_${i}`);
      assert.equal(
        res.status, 201,
        `nome distinto ${i + 1} deveria passar (o authLimiter não os alcança), veio ${res.status}`
      );
    }
    assert.ok(
      restantes > AUTH_MAX,
      `passaram ${restantes} nomes distintos contra um teto por username de ${AUTH_MAX}: `
      + 'é isto que prova que a chave composta não estrangula esta rota'
    );

    const cortada = await register(`teto_dist_${SFX}_final`);
    assert.equal(cortada.status, 429, 'passado REG_MAX, o endereço é cortado mesmo com nome inédito');
    assert.equal(cortada.body.error.code, 'TOO_MANY_REQUESTS');

    // E a recusa é ANTES de escrever: nenhuma conta com o nome cortado.
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE username = $1', [`teto_dist_${SFX}_final`]
    );
    assert.equal(rows[0].n, 0);
  });

  it('DISCRIMINAÇÃO — com o cadastro em 429, login e resend-verification do MESMO endereço respondem normalmente',
    async () => {
      // O store é próprio, como o de todo limitador deste arquivo. Balde compartilhado é
      // o defeito que o cabeçalho de rate-limit.js documenta ter pago uma vez: três rotas
      // sem `username` dividindo uma cota. Se o registerLimiter drenasse o dos vizinhos,
      // estas duas linhas viriam 429.
      const semConta = `nunca_existiu_${SFX}`;
      const entrada = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: semConta, password: PW });
      assert.equal(entrada.status, 401, `login deveria responder 401, veio ${entrada.status}`);

      const reenvio = await supertest(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: `${semConta}@example.mil` });
      assert.equal(reenvio.status, 200, `resend deveria responder 200, veio ${reenvio.status}`);
    });
});
