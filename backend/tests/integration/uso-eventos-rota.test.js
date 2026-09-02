// Path: tests/integration/uso-eventos-rota.test.js
/**
 * @fileoverview A BORDA de `POST /uso/eventos`: quem passa, quem é recusado, e de onde sai a
 * identidade.
 *
 * ELA É O SEGUNDO ENDPOINT ANÔNIMO DESTE SERVIDOR QUE ESCREVE NO BANCO, e é por isso que a
 * borda vale um arquivo só dela. O primeiro (`POST /diag/erro-cliente`) tem o par deste teste
 * em `diag-erro-de-cliente.test.js`, e as duas listas de controle negativo se parecem de
 * propósito.
 *
 * CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
 *  - montar `auth` estrito na rota: o caso do anônimo passa a 401, e o produto perde a única
 *    medida do visitante deslogado, que é justamente quem ninguém está olhando;
 *  - ler `userId` do corpo em vez de `req.user`: o caso "anônimo tentando se passar por outro"
 *    passa a gravar o id que o corpo mandou, e "usuários distintos" da instalação vira um
 *    número que qualquer um escreve;
 *  - tirar o `.unknown(false)` dos objetos aninhados: os dois casos de chave desconhecida
 *    passam a 204 com o campo descartado em silêncio, ou seja telemetria que chega pela
 *    metade sem ninguém saber;
 *  - trocar a regra de qualificador por um descarte silencioso: os dois casos de 422 de `prop`
 *    passam a 204, e a linha resultante é bem formada, entra na contagem e some no total;
 *  - tirar o teto de 50 eventos: o lote gigante deixa de ser 422 e vira uma transação de
 *    tamanho escolhido pelo chamador.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

describe('Uso do produto — a borda de POST /uso/eventos', () => {
  let app, db, comum, comumToken;
  const sessoes = [];

  /** Uma sessão irrepetível: as tabelas são compartilhadas pela rodada inteira. */
  function novaSessao() {
    const id = randomUUID();
    sessoes.push(id);
    return id;
  }

  const linhaDe = (id) => db.query('SELECT * FROM uso_sessoes WHERE sessao_id = $1', [id])
    .then((r) => r.rows[0]);

  /** O corpo mínimo aceitável, para que cada caso só mexa no que está medindo. */
  const corpo = (sessaoId, extra = {}) => ({
    sessaoId,
    pagina: 'mapa',
    inicio: Date.now() - 60_000,
    ultimoSinal: Date.now() - 1_000,
    eventos: [],
    ...extra,
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    comum = await createUser(db, { username: `uso_user_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
  });

  after(async () => {
    await db.query('DELETE FROM uso_sessoes WHERE sessao_id = ANY($1::uuid[])', [sessoes]);
    await teardownTestEnv(db);
  });

  // ── quem passa ──
  it('o ANÔNIMO passa: 204 e a linha nasce sem usuário', async () => {
    const id = novaSessao();
    await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(id, {
        eventos: [{ evento: 'pagina.vista', contagem: 1 }],
        release: 'dev',
        navegador: 'Chrome',
      }))
      .expect(204);

    const linha = await linhaDe(id);
    assert.ok(linha, 'a linha de sessão precisa existir');
    assert.equal(linha.user_id, null);
    assert.equal(linha.pagina_inicial, 'mapa');
    assert.equal(linha.release, 'dev');
    assert.equal(linha.navegador, 'Chrome');
    assert.equal(linha.eventos, 1);
    assert.equal(linha.erros, 0);
  });

  it('o AUTENTICADO passa, e o `user_id` sai do TOKEN, nunca do corpo', async () => {
    const id = novaSessao();
    await supertest(app)
      .post('/api/v1/uso/eventos')
      .set('Authorization', `Bearer ${comumToken}`)
      .send(corpo(id, {
        // O campo não existe no schema: `stripUnknown` o descarta ANTES de o controller ver.
        // O descarte (em vez de um 422) é o que mantém a rota tolerante a cliente de outra
        // versão, e o gate de identidade é a AUSÊNCIA do campo, não a recusa dele.
        userId: '00000000-0000-4000-8000-000000000000',
      }))
      .expect(204);

    const linha = await linhaDe(id);
    assert.equal(linha.user_id, comum.id, 'a identidade tem de vir do token');
  });

  it('o ANÔNIMO que MANDA um userId no corpo continua anônimo', async () => {
    // O par negativo do caso acima, e é ele que discrimina: sem ele, "sai do token" passaria
    // verde num código que lesse o corpo, porque no caso autenticado os dois coincidiriam se
    // o cliente mandasse o próprio id.
    const id = novaSessao();
    await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(id, { userId: comum.id }))
      .expect(204);

    assert.equal((await linhaDe(id)).user_id, null, 'o corpo não pode atribuir sessão a ninguém');
  });

  it('lote com `eventos` VAZIO é aceito: a aba que só ficou aberta ainda tem duração', async () => {
    const id = novaSessao();
    await supertest(app).post('/api/v1/uso/eventos').send(corpo(id)).expect(204);
    const linha = await linhaDe(id);
    assert.ok(linha);
    assert.equal(linha.eventos, 0);
  });

  // ── quem é recusado ──
  it('evento fora do vocabulário é 422 e nomeia o campo', async () => {
    const r = await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(novaSessao(), { eventos: [{ evento: 'inventado', contagem: 1 }] }))
      .expect(422);
    assert.match(JSON.stringify(r.body), /evento/);
  });

  it('qualificador PROIBIDO para o evento é 422 e NOMEIA o evento', async () => {
    const r = await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(novaSessao(), {
        eventos: [{ evento: 'medicao.aberta', prop: 'area', contagem: 1 }],
      }))
      .expect(422);
    // Nomear o evento não é enfeite: num lote de cinquenta entradas, "prop inválido" sem o
    // evento não diz qual delas consertar.
    assert.match(JSON.stringify(r.body), /medicao\.aberta/);
  });

  it('qualificador FORA DA LISTA do evento é 422 e nomeia o evento', async () => {
    const r = await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(novaSessao(), {
        eventos: [{ evento: 'atlas.aberto', prop: 'nuvem', contagem: 1 }],
      }))
      .expect(422);
    assert.match(JSON.stringify(r.body), /atlas\.aberto/);
  });

  it('qualificador LIVRE fora da FORMA é 422 (e dentro dela passa)', async () => {
    await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(novaSessao(), {
        eventos: [{ evento: 'ferramenta.ativada', prop: 'PONTO COM ESPAÇO', contagem: 1 }],
      }))
      .expect(422);

    // O POSITIVO DO MESMO PAR: sem ele, um gate que recusasse TODO qualificador livre
    // passaria neste arquivo inteiro.
    const id = novaSessao();
    await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(id, {
        eventos: [{ evento: 'ferramenta.ativada', prop: 'point_tool', contagem: 2 }],
      }))
      .expect(204);
    assert.equal((await linhaDe(id)).eventos, 2);
  });

  it('chave desconhecida DENTRO de um evento recusa o lote inteiro com 422', async () => {
    const r = await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(novaSessao(), {
        eventos: [{ evento: 'pagina.vista', contagem: 1, quando: 123 }],
      }))
      .expect(422);
    assert.match(JSON.stringify(r.body), /quando/);
  });

  it('chave desconhecida DENTRO de `vitais` recusa o lote inteiro com 422', async () => {
    const r = await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(novaSessao(), { vitais: { lcpMs: 1200, ttfbMs: 90 } }))
      .expect(422);
    assert.match(JSON.stringify(r.body), /ttfb/i);
  });

  it('cinquenta eventos passam e cinquenta e um são 422', async () => {
    // A FRONTEIRA EXATA, nos dois lados: um teto testado só por cima passaria verde com o
    // limite escrito em qualquer número maior que o do caso.
    const cinquenta = Array.from({ length: 50 }, (_, i) => ({
      evento: 'ferramenta.ativada', prop: `t${i}`, contagem: 1,
    }));
    const id = novaSessao();
    await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(id, { eventos: cinquenta }))
      .expect(204);
    assert.equal((await linhaDe(id)).eventos, 50);

    await supertest(app)
      .post('/api/v1/uso/eventos')
      .send(corpo(novaSessao(), {
        eventos: [...cinquenta, { evento: 'pagina.vista', contagem: 1 }],
      }))
      .expect(422);
  });

  it('sem `sessaoId` é 422: sem ele cada descarga viraria uma sessão nova', async () => {
    const semId = corpo(novaSessao());
    delete semId.sessaoId;
    const r = await supertest(app).post('/api/v1/uso/eventos').send(semId).expect(422);
    assert.match(JSON.stringify(r.body), /sessaoId/);
  });

  it('`sessaoId` que não é UUID é 422 na BORDA, e não 22P02 no driver', async () => {
    // Sem o `guid()`, a recusa viria do banco como um 500 na rota que existe para medir.
    await supertest(app)
      .post('/api/v1/uso/eventos')
      .send({ ...corpo(novaSessao()), sessaoId: 'aba-1' })
      .expect(422);
  });

  it('página fora das quatro é 422', async () => {
    await supertest(app)
      .post('/api/v1/uso/eventos')
      .send({ ...corpo(novaSessao()), pagina: 'relatorios' })
      .expect(422);
  });

  it('contagem zero, negativa ou acima do teto é 422', async () => {
    for (const contagem of [0, -1, 100_001]) {
      await supertest(app)
        .post('/api/v1/uso/eventos')
        .send(corpo(novaSessao(), { eventos: [{ evento: 'pagina.vista', contagem }] }))
        .expect(422);
    }
  });
});
