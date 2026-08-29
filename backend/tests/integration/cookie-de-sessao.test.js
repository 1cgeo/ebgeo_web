// Path: tests/integration/cookie-de-sessao.test.js
//
// O COOKIE DE SESSÃO: emitido no login, aceito na LEITURA, recusado na ESCRITA.
//
// POR QUE ELE EXISTE. Há pedidos que o NAVEGADOR faz e que não aceitam cabeçalho
// nenhum: o tile do MapLibre, o `img.src` de uma cena 3D, o `<video src>` de uma
// prévia. Sem cookie, a única credencial que os alcança é a chave de API na URL, que é
// portadora, permanente até a rotação, e aparece no log de acesso do nginx e no
// `Referer` de tudo o que a página carregar depois. É a decisão 3 d// docs/wiki/tile-privado.md: o cookie carrega o MESMO JWT, sem credencial nova.
//
// O RISCO QUE ELE ABRE, e é metade deste arquivo. O middleware `auth` estrito REUSA o
// `req.user` que o `flexibleAuth` global já populou, e o `flexibleAuth` lê o cookie.
// Logo, um cookie permanente autorizaria ESCRITA, e CSRF deixaria de ser hipótese: são
// 87 rotas de escrita atrás do estrito, e CINCO delas aceitam `multipart/form-data`,
// que é Content-Type CORS-simples e portanto postável por formulário cross-site SEM
// preflight. A defesa é recusar, no estrito, o principal que chegou por cookie.
//
// A RECUSA É SÓ NOS MÉTODOS QUE ESCREVEM, e a proporção é o assunto do terceiro bloco:
// uma leitura disparada de outro site até sai com o cookie, mas o CORS impede o
// atacante de LER a resposta, então não há o que colher. A primeira versão da amarra
// recusava TODA rota estrita, e onze casos ficaram vermelhos apontando isso — entre
// eles `GET /auth/me` por cookie, que já funcionava desde antes, porque a renovação
// deslizante emitia o cookie perto da expiração.
//
// O PAR POSITIVO ACOMPANHA CADA NEGATIVO. Sem ele, um servidor que recusasse toda
// escrita passaria neste arquivo inteiro.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

/** O valor do cookie `token` numa resposta, ou null. */
function cookieDaResposta(res) {
  const cabecalhos = res.headers['set-cookie'] || [];
  const linha = cabecalhos.find((c) => c.startsWith('token='));
  if (!linha) return null;
  const valor = linha.split(';')[0].slice('token='.length);
  return { linha, valor };
}

describe('cookie de sessão: emissão, leitura e a porta fechada da escrita', () => {
  let app, db, usuario, senha;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    usuario = await createUser(db, { username: `cookie_${SFX}` });
    senha = usuario.password;
  });

  after(async () => {
    await db.query('DELETE FROM audit_trail WHERE actor_id = $1', [usuario.id]);
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [usuario.id]);
    await db.query('DELETE FROM users WHERE id = $1', [usuario.id]);
    await teardownTestEnv(db);
  });

  const entrar = () => supertest(app).post('/api/v1/auth/login')
    .send({ username: usuario.username, password: senha });

  describe('emissão', () => {
    it('o LOGIN emite o cookie, e ele carrega o MESMO token do corpo', async () => {
      // O token continua no corpo de propósito: o cliente guarda o par e manda
      // `Authorization` nas escritas, que é o que o estrito passou a exigir. Tirá-lo do
      // corpo tornaria toda escrita impossível.
      const res = await entrar().expect(200);
      const cookie = cookieDaResposta(res);
      assert.ok(cookie, 'o login tem de emitir o cookie `token`');
      assert.equal(cookie.valor, res.body.data.accessToken, 'é o MESMO token, não um segundo');
    });

    it('o cookie vem com HttpOnly e SameSite', async () => {
      // `HttpOnly` impede o script da página de lê-lo, e `SameSite` é a primeira das
      // duas camadas contra CSRF (a segunda é a recusa do estrito, medida abaixo).
      const { linha } = cookieDaResposta(await entrar().expect(200));
      assert.match(linha, /HttpOnly/i);
      assert.match(linha, /SameSite/i);
    });

    it('o REFRESH também emite, senão a sessão renovada perde o transporte de leitura', async () => {
      // Sem esta linha, as camadas privadas sumiriam do mapa quinze minutos depois de
      // entrar — a classe de defeito que só aparece em uso prolongado.
      const login = await entrar().expect(200);
      const res = await supertest(app).post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.data.refreshToken })
        .expect(200);
      const cookie = cookieDaResposta(res);
      assert.ok(cookie, 'o refresh tem de emitir o cookie');
      assert.equal(cookie.valor, res.body.data.accessToken);
    });

    it('o LOGOUT apaga o cookie', async () => {
      // É a única saída que tem o cliente na mão. Sem ela, o cookie sobreviveria ao
      // logout até o `maxAge`, e o cliente se acharia anônimo (o estado dele é
      // in-memory) enquanto o servidor continuaria vendo um principal.
      const login = await entrar().expect(200);
      const res = await supertest(app).post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .send({ refreshToken: login.body.data.refreshToken })
        .expect(204);
      const cookie = cookieDaResposta(res);
      assert.ok(cookie, 'o logout tem de mandar o Set-Cookie de limpeza');
      assert.equal(cookie.valor, '', 'o valor tem de vir vazio');
    });
  });

  describe('o cookie AUTENTICA a leitura', () => {
    it('GET de conta só com o cookie, sem Authorization', async () => {
      const login = await entrar().expect(200);
      const { valor } = cookieDaResposta(login);
      const res = await supertest(app).get('/api/v1/auth/me')
        .set('Cookie', `token=${valor}`)
        .expect(200);
      assert.equal(res.body.data.username, usuario.username);
    });
  });

  describe('o cookie NÃO autoriza a escrita', () => {
    it('POST com o cookie apenas: 401', async () => {
      const login = await entrar().expect(200);
      const { valor } = cookieDaResposta(login);
      const res = await supertest(app).post('/api/v1/atlas')
        .set('Cookie', `token=${valor}`)
        .send({ name: `atlas cookie ${SFX}` });
      assert.equal(res.status, 401);
    });

    it('e o MESMO token, no cabeçalho, escreve — o par que impede a leitura "recusa tudo"', async () => {
      const login = await entrar().expect(200);
      const { valor } = cookieDaResposta(login);
      // O mesmo valor, a mesma rota, o mesmo corpo: só a PORTA muda.
      const res = await supertest(app).post('/api/v1/atlas')
        .set('Authorization', `Bearer ${valor}`)
        .send({ name: `atlas cabecalho ${SFX}` })
        .expect(201);
      await db.query('DELETE FROM atlas WHERE id = $1', [res.body.data.id]);
    });

    it('DELETE e PUT também recusam o cookie', async () => {
      // A amarra é por MÉTODO, não por rota, e a lista dela é de métodos SEGUROS: um
      // verbo novo cai no ramo restritivo por construção.
      const login = await entrar().expect(200);
      const { valor } = cookieDaResposta(login);
      const alvo = randomUUID();
      for (const pedido of [
        supertest(app).delete(`/api/v1/atlas/${alvo}`).set('Cookie', `token=${valor}`),
        supertest(app).put(`/api/v1/atlas/${alvo}`).set('Cookie', `token=${valor}`).send({ name: 'x' }),
      ]) {
        const res = await pedido;
        assert.equal(res.status, 401, 'escrita por cookie tem de ser recusada antes de qualquer gate de recurso');
      }
    });

    it('COOKIE + BEARER JUNTOS escrevem, que é como o navegador de verdade pede', async () => {
      // O CASO QUE FALTAVA, e a falta dele quase custou o app inteiro. O cliente logado
      // manda `Authorization` E carrega o cookie, que o navegador envia sozinho na mesma
      // origem. Como o cookie tem precedência de RESOLUÇÃO em `flexibleAuth`, `authVia` é
      // `'cookie'` nessa requisição, e a primeira versão da amarra a recusava: toda
      // escrita de todo usuário respondia 401. Quem pegou foi a captura de UI, não a
      // suíte, porque todos os casos daqui mandavam UMA credencial por vez.
      //
      // O que autoriza é a PRESENÇA do cabeçalho: um formulário de outro site não
      // consegue pô-lo (exige preflight, que o CORS recusa).
      const login = await entrar().expect(200);
      const { valor } = cookieDaResposta(login);
      const res = await supertest(app).post('/api/v1/atlas')
        .set('Cookie', `token=${valor}`)
        .set('Authorization', `Bearer ${valor}`)
        .send({ name: `atlas cookie+bearer ${SFX}` })
        .expect(201);
      await db.query('DELETE FROM atlas WHERE id = $1', [res.body.data.id]);
    });

    it('a rota MULTIPART, que é a postável cross-site sem preflight, também recusa', async () => {
      // São CINCO rotas assim no backend, e elas são a razão de a amarra não poder
      // depender só do preflight: `multipart/form-data` é Content-Type CORS-simples.
      const login = await entrar().expect(200);
      const { valor } = cookieDaResposta(login);
      const res = await supertest(app)
        .post('/api/v1/sv360/admin/projects/upload')
        .set('Cookie', `token=${valor}`);
      assert.equal(res.status, 401);
    });
  });
});
