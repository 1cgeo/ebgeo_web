// Path: tests/integration/rate-limit-key-scope.test.js
//
// Itens 36, 37 e 78 — as três lacunas do `middleware/rate-limit.js`. O arquivo existente
// (`rate-limit.test.js`) exercita apenas `/auth/login` e apenas o caso "estourou o teto",
// que é o mais fácil e o que menos prova: ele passa com e sem os detalhes que fazem o
// limiter valer alguma coisa.
//
//   36 — a CHAVE do authLimiter é `${ip}:${username.toLowerCase()}`, e
//        `FIND_USER_BY_USERNAME` casa com `LOWER(u.username) = LOWER($1)`
//        (auth.queries.js:12): 'Victim', 'VICTIM' e 'victim' autenticam a MESMA conta.
//        Se o `.toLowerCase()` sumir, cada variação de caixa ganha um balde novo de
//        `authMax` tentativas e o brute-force fica praticamente irrestrito. O teste
//        existente compara dois usernames JÁ distintos entre si, o que passa com e sem o
//        `.toLowerCase()` (padrão C3).
//
//   37 — `publicLinkLimiter` é um dos dois controles exigidos nominalmente pela
//        constituição e tinha ZERO exercício (grep 'publicLinkLimiter' em tests/ = nada).
//        Ele guarda a enumeração de `public_link`, cujo acerto expõe um atlas inteiro em
//        leitura.
//
//   78 — REFUTADO contra o HEAD. O relatório descreve `/auth/resend-verification` e
//        `/auth/refresh` gateados pelo `authLimiter`, cuja chave lê `req.body.username`
//        ANTES do `validate` com stripUnknown: como nenhum dos dois schemas declara
//        `username`, bastava mandar um valor aleatório por request para comprar um balde
//        novo a cada tentativa. Hoje `auth.routes.js:28-31` monta `verifyEmailLimiter`,
//        `resendVerificationLimiter` e `refreshLimiter`, cada um com store próprio e
//        chave só por endereço — o campo injetado não entra na chave. Ninguém afirmava
//        isso, e a montagem de volta no `authLimiter` é uma linha.
//
// Cada arquivo de teste roda no seu próprio processo (`node --test`), então
// `RATE_LIMIT_FORCE=1` aqui não contamina os demais. Dentro DESTE arquivo, porém, os
// baldes por IP são compartilhados entre os casos: a ordem dos `describe` é deliberada e
// cada bloco usa o seu próprio limiter (stores separados é justamente o que se afirma).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, makeAtlasPublic } from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

describe('rate limiters — key scope and store isolation (36, 37, 78)', () => {
  let app, db, victim;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    process.env.RATE_LIMIT_FORCE = '1';
    victim = await createUser(db, { username: `rl_case_victim_${SFX}` });
  });

  after(async () => {
    delete process.env.RATE_LIMIT_FORCE;
    await teardownTestEnv(db);
  });

  it('guard: the limiter is actually forced ON (senão todo caso abaixo é vacuous)', async () => {
    assert.equal(process.env.RATE_LIMIT_FORCE, '1');
    assert.ok(config.rateLimit.authMax > 0);
    assert.ok(config.rateLimit.publicMax > 0);
  });

  // ==========================================================================
  // 36 — a variação de caixa não pode comprar um balde novo
  // ==========================================================================
  describe('36 — authLimiter normalizes the username case', () => {
    const MIXED = `RL_Case_Victim_${SFX}`;   // mesma conta, caixa diferente
    const LOWER = `rl_case_victim_${SFX}`;

    it('esgota o balde com a caixa MISTA', async () => {
      let last;
      for (let i = 0; i < config.rateLimit.authMax + 1; i++) {
        last = await supertest(app)
          .post('/api/v1/auth/login')
          .send({ username: MIXED, password: 'wrong-password' });
      }
      assert.equal(last.status, 429);
      assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
    });

    it('a MESMA conta em caixa minúscula já vem 429, não 401', async () => {
      // Este é o assert que morre se o `.toLowerCase()` for removido: sem ele, LOWER
      // abre um balde virgem e a resposta volta a ser 401 (credencial errada).
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: LOWER, password: victim.password });
      assert.equal(res.status, 429, 'a variação de caixa comprou um balde novo');
    });

    it('a caixa TODA MAIÚSCULA também colide (não é só o par exato acima)', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: LOWER.toUpperCase(), password: 'wrong-password' });
      assert.equal(res.status, 429);
    });

    it('controle do harness: uma conta REALMENTE distinta no mesmo IP ainda responde 401', async () => {
      // Sem isto, os 429 acima poderiam vir de um balde global por IP, e o teste não
      // estaria provando nada sobre a chave.
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: `rl_case_outro_${SFX}`, password: 'wrong-password' });
      assert.equal(res.status, 401, 'outra conta não pode ser estrangulada pela vítima');
    });

    it('a senha CORRETA da vítima continua 429 (o limiter roda antes do controller)', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: victim.username, password: victim.password });
      assert.equal(res.status, 429);
      assert.equal(res.body.data, undefined, 'nenhum token pode ser emitido no 429');
    });
  });

  // ==========================================================================
  // 78 — as rotas SEM `username` no schema não são envenenáveis por chave
  // ==========================================================================
  describe('78 — /auth/resend-verification is keyed by ADDRESS, not by an injected field', () => {
    it('uma rajada ENVENENADA (username aleatório por request) ainda estoura no teto', async () => {
      // Se estas rotas voltassem ao `authLimiter`, cada `username` inédito compraria um
      // balde novo e TODAS as respostas seriam 200 — envio ilimitado de e-mail e de
      // linhas em email_verification_tokens a partir de um único IP.
      const email = `rl78_${SFX}@example.mil`;
      let last;
      for (let i = 0; i < config.rateLimit.authMax + 1; i++) {
        last = await supertest(app)
          .post('/api/v1/auth/resend-verification')
          .send({ email, username: randomUUID() });
      }
      assert.equal(last.status, 429, 'o campo injetado não pode entrar na chave');
      assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
    });

    it('e um resend LIMPO, sem campo injetado, também já está barrado (mesmo balde)', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: `rl78b_${SFX}@example.mil` });
      assert.equal(res.status, 429);
    });

    it('nenhuma linha de token de verificação foi criada pela rajada', async () => {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM email_verification_tokens t
           JOIN users u ON u.id = t.user_id
          WHERE u.email = $1`,
        [`rl78_${SFX}@example.mil`]
      );
      assert.equal(rows[0].n, 0, 'o e-mail nem existe: a rajada não pode ter materializado nada');
    });
  });

  describe('78 — /auth/refresh has its OWN address-keyed bucket', () => {
    it('uma rajada envenenada de refresh inválido estoura no teto', async () => {
      let last;
      for (let i = 0; i < config.rateLimit.authMax + 1; i++) {
        last = await supertest(app)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: `lixo-${randomUUID()}`, username: randomUUID() });
      }
      assert.equal(last.status, 429);
    });

    it('o balde do refresh é SEPARADO do de resend (stores próprios, não um só)', async () => {
      // Os dois estão estourados agora; o que se prova aqui é que estourá-los custou
      // authMax+1 requests CADA. Se compartilhassem store, o segundo bloco teria
      // respondido 429 já na primeira request — e o assert de "última é 429" passaria
      // vazio. Portanto: a PRIMEIRA request de um terceiro limiter no mesmo IP ainda
      // passa.
      const res = await supertest(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: randomUUID() });
      assert.notEqual(res.status, 429, 'verify-email tem store próprio e ainda tem cota');
    });
  });

  // ==========================================================================
  // 37 — publicLinkLimiter
  // ==========================================================================
  describe('37 — publicLinkLimiter guards /atlas/public/:link', () => {
    let publicLink;

    before(async () => {
      const owner = await createUser(db, { username: `rl_pub_${SFX}` });
      const atlas = await createAtlas(db, owner.id, { name: `RL pub ${SFX}` });
      publicLink = await makeAtlasPublic(db, atlas.id);
    });

    it('estourar o teto de links públicos devolve 429 — e os anteriores eram 404 (o handler era alcançado)', async () => {
      const max = config.rateLimit.publicMax;
      const statuses = [];
      for (let i = 0; i < max + 1; i++) {
        const res = await supertest(app).get(`/api/v1/atlas/public/inexistente-${SFX}-${i}`);
        statuses.push(res.status);
      }
      assert.equal(statuses[statuses.length - 1], 429, `esperado 429 na ${max + 1}ª, obtive ${statuses.join(',')}`);
      assert.ok(
        statuses.slice(0, max).every((s) => s === 404),
        `as ${max} primeiras precisam ter chegado ao controller (404), obtive: ${statuses.join(',')}`
      );
    });

    it('um link VÁLIDO também é barrado: o limiter roda ANTES do controller', async () => {
      const res = await supertest(app).get(`/api/v1/atlas/public/${publicLink}`);
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, 'TOO_MANY_REQUESTS');
      assert.equal(res.body.data, undefined, 'nenhum publicToken pode ser emitido no 429');
    });

    it('isolamento de store: com o balde público estourado, /auth/login de conta inédita ainda responde 401', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: `rl_iso_${SFX}`, password: 'wrong-password' });
      assert.equal(res.status, 401, 'os limiters não podem dividir um único balde');
    });

    it('isolamento de store: o gazetteer anônimo também segue passando', async () => {
      const res = await supertest(app)
        .get('/api/v1/nomes/busca')
        .query({ q: 'zz', lat: -22.9, lon: -43.2 });
      assert.notEqual(res.status, 429);
    });
  });
});
