// Path: tests/integration/defeito-ocorrencias.test.js
// AS OCORRÊNCIAS: o teto estrutural de vinte, o cascade, e o contrato das MIGALHAS na borda.
//
// O QUE ELAS MUDAM NA PERGUNTA. A linha agregada responde "qual defeito e quantas vezes", e
// sobrescreve `sessao_id`, `user_id` e `contexto` a cada relato: ela conta a ÚLTIMA vez e
// nada sobre a distribuição. "Quantas ABAS diferentes viram isto" e "só acontece com este
// contexto?" são as duas primeiras perguntas de quem diagnostica, e nenhuma tem resposta a
// partir de uma linha só.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - tirar o `DELETE_OCORRENCIAS_EXCEDENTES` da transação: o caso do teto passa a deixar 25
//    linhas, e a tabela que cresce com a REPETIÇÃO (que não tem limite) vira o incidente;
//  - tirar o `ORDER BY em DESC` do subselect do teto: o caso do teto passa a apagar linhas
//    arbitrárias, e o que sobra deixa de ser "as mais recentes";
//  - trocar o `ON DELETE CASCADE` por `ON DELETE SET NULL` ou por FK sem ação: o caso do
//    cascade fica vermelho, e a poda por idade passaria a deixar órfãs que nada acha;
//  - tirar o `unknown(false)` do item de migalha: o caso da chave desconhecida passa de 422
//    a 204 com o campo descartado em silêncio, que é telemetria chegando pela metade sem
//    ninguém saber;
//  - tirar o `.max(30)`: o caso das 31 migalhas passa a 204, e um cliente com defeito manda
//    a sessão inteira num JSONB por ocorrência, com vinte ocorrências por defeito.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { TETO_DE_OCORRENCIAS } from '../../src/modules/diag/defeitos.service.js';

describe('Ocorrências de um defeito: teto, cascade e migalhas', () => {
  let app, db, admin, adminToken, comum, comumToken;
  const marca = randomUUID().slice(0, 8);
  const assinaturas = [];

  function assinatura(nome) {
    const a = `TypeError | ${nome} | ${marca}`;
    assinaturas.push(a);
    return a;
  }

  const linhaDe = (a) => db.query('SELECT * FROM defeitos WHERE assinatura = $1', [a])
    .then((r) => r.rows[0]);

  const ocorrenciasDe = (defeitoId) => db.query(
    'SELECT * FROM defeito_ocorrencias WHERE defeito_id = $1 ORDER BY em DESC, id DESC',
    [defeitoId]
  ).then((r) => r.rows);

  const relatar = (corpo, esperado = 204) => supertest(app)
    .post('/api/v1/diag/erro-cliente')
    .send(corpo)
    .expect(esperado);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    comum = await createUser(db, { username: `oc_user_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `oc_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
  });

  it('um relato escreve UMA ocorrência ao lado do defeito, na mesma transação', async () => {
    const a = assinatura('uma-ocorrencia');
    const sessao = randomUUID();
    await relatar({
      assinatura: a,
      mensagem: 'quebrou',
      pagina: 'atlas',
      url: 'https://ebgeo/atlas.html',
      release: 'v1',
      origem: 'store',
      sessaoId: sessao,
      contexto: { atlasKind: 'local', conexao: 'offline' },
      migalhas: [{ t: 1_756_000_000_000, tipo: 'clique', texto: 'abriu o atlas' }],
    });

    const defeito = await linhaDe(a);
    const ocs = await ocorrenciasDe(defeito.id);
    assert.equal(ocs.length, 1);
    assert.equal(ocs[0].sessao_id, sessao);
    assert.equal(ocs[0].pagina, 'atlas');
    assert.equal(ocs[0].release, 'v1');
    assert.equal(ocs[0].origem, 'store');
    assert.deepEqual(ocs[0].contexto, { atlasKind: 'local', conexao: 'offline' });
    assert.deepEqual(ocs[0].migalhas, [
      { t: 1_756_000_000_000, tipo: 'clique', texto: 'abriu o atlas' },
    ]);
    // O caminho do NAVEGADOR não tem requisição do servidor por trás.
    assert.equal(ocs[0].req_id, null);
    assert.equal(ocs[0].status_code, null);
  });

  it('a ABA de cada relato é preservada, que é o que a linha agregada NÃO responde', async () => {
    const a = assinatura('abas-distintas');
    const sessoes = [randomUUID(), randomUUID(), randomUUID()];
    for (const sessaoId of sessoes) {
      await relatar({ assinatura: a, mensagem: 'x', sessaoId });
    }

    const defeito = await linhaDe(a);
    assert.equal(defeito.ocorrencias, 3);
    // A linha agregada guarda o `COALESCE(EXCLUDED.x, atual)`, ou seja, a sessão do relato
    // MAIS RECENTE (o antigo só sobrevive quando o novo vem vazio). Ela responde "a última
    // vez", e é exatamente por isso que a distribuição precisava de outra tabela.
    assert.equal(defeito.sessao_id, sessoes[sessoes.length - 1]);
    // As ocorrências guardam as três, que é a resposta a "quantas abas viram isto".
    const ocs = await ocorrenciasDe(defeito.id);
    assert.equal(ocs.length, 3);
    assert.deepEqual(new Set(ocs.map((o) => o.sessao_id)), new Set(sessoes));
  });

  it('25 relatos de 25 abas deixam EXATAMENTE 20 ocorrências, e são as mais recentes', async () => {
    const a = assinatura('teto-de-vinte');
    const sessoes = [];
    for (let i = 0; i < 25; i += 1) {
      const sessaoId = randomUUID();
      sessoes.push(sessaoId);
      // Em SÉRIE de propósito: cada relato é uma transação própria, e é isso que dá o `em`
      // estritamente crescente de que a asserção de "as mais recentes" depende.
      await relatar({ assinatura: a, mensagem: 'em laço', sessaoId });
    }

    const defeito = await linhaDe(a);
    assert.equal(defeito.ocorrencias, 25, 'a CONTAGEM não é podada: ela é o total real');

    const ocs = await ocorrenciasDe(defeito.id);
    assert.equal(ocs.length, TETO_DE_OCORRENCIAS, 'o teto é estrutural, não aproximado');
    assert.equal(TETO_DE_OCORRENCIAS, 20, 'guarda: o teto declarado é o que a tabela mostra');

    // As que sobraram são as ÚLTIMAS vinte, na ordem inversa da escrita.
    const esperadas = sessoes.slice(-TETO_DE_OCORRENCIAS).reverse();
    assert.deepEqual(ocs.map((o) => o.sessao_id), esperadas);
    // E as cinco primeiras sumiram: sem o `ORDER BY` do subselect, quem cai é arbitrário.
    const caidas = sessoes.slice(0, 5);
    assert.equal(caidas.length, 5, 'guarda: laço sobre coleção vazia é zero asserção');
    for (const antiga of caidas) {
      assert.equal(ocs.some((o) => o.sessao_id === antiga), false, `a ${antiga} devia ter caído`);
    }
  });

  it('apagar o defeito leva as ocorrências junto (o cascade que mantém UMA definição de podar)', async () => {
    const a = assinatura('cascade');
    await relatar({ assinatura: a, mensagem: 'x', sessaoId: randomUUID() });
    await relatar({ assinatura: a, mensagem: 'x', sessaoId: randomUUID() });

    const defeito = await linhaDe(a);
    assert.equal((await ocorrenciasDe(defeito.id)).length, 2, 'guarda: havia o que apagar');

    await db.query('DELETE FROM defeitos WHERE id = $1', [defeito.id]);
    assert.equal((await ocorrenciasDe(defeito.id)).length, 0, 'ocorrência sem defeito não existe');
  });

  // ── a borda das migalhas ──

  it('migalha com chave DESCONHECIDA é 422 nomeando o campo, e não escreve nada', async () => {
    const a = assinatura('migalha-chave-extra');
    const res = await relatar({
      assinatura: a,
      mensagem: 'x',
      migalhas: [{ t: 1_756_000_000_000, tipo: 'clique', texto: 'ok', extra: 'inventado' }],
    }, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(
      res.body.error.details.some((d) => String(d.field).startsWith('migalhas')),
      `o 422 precisa nomear o campo: ${JSON.stringify(res.body.error.details)}`
    );
    assert.equal(await linhaDe(a), undefined, 'nada foi escrito');
  });

  it('31 migalhas é 422: o teto de ITENS é o que segura a sessão inteira num JSONB', async () => {
    const a = assinatura('migalha-31');
    const trinta = Array.from({ length: 30 }, (_, i) => ({ t: 1_756_000_000_000 + i, tipo: 'x', texto: 'y' }));
    await relatar({ assinatura: a, mensagem: 'x', migalhas: [...trinta, { t: 1, tipo: 'z', texto: 'w' }] }, 422);
    assert.equal(await linhaDe(a), undefined);

    // E o teto é INCLUSIVO: exatamente trinta passa. Sem este par, `max(30)` e `max(29)`
    // seriam indistinguíveis pelo caso de cima.
    const b = assinatura('migalha-30');
    await relatar({ assinatura: b, mensagem: 'x', migalhas: trinta });
    const defeito = await linhaDe(b);
    const ocs = await ocorrenciasDe(defeito.id);
    assert.equal(ocs[0].migalhas.length, 30);
  });

  it('migalha com texto acima do teto é 422, e o teto de cada campo é o declarado', async () => {
    const a = assinatura('migalha-texto-gigante');
    await relatar({ assinatura: a, mensagem: 'x', migalhas: [{ texto: 'y'.repeat(121) }] }, 422);
    await relatar({ assinatura: a, mensagem: 'x', migalhas: [{ tipo: 'z'.repeat(21) }] }, 422);
    assert.equal(await linhaDe(a), undefined);

    const b = assinatura('migalha-no-teto');
    await relatar({
      assinatura: b,
      mensagem: 'x',
      migalhas: [{ t: 1_756_000_000_000, tipo: 'z'.repeat(20), texto: 'y'.repeat(120) }],
    });
    assert.ok(await linhaDe(b), 'exatamente no teto passa');
  });

  it('`t` é EPOCH MS ABSOLUTO: o negativo é recusado e o instante real passa', async () => {
    // É o mesmo relógio do `time` das linhas do `.jsonl`, e é isso que permite pôr a migalha
    // lado a lado com o que o servidor escreveu naquele instante. Relativo à carga da página
    // seria mais barato de produzir e não casaria com nada.
    const a = assinatura('migalha-t-negativo');
    await relatar({ assinatura: a, mensagem: 'x', migalhas: [{ t: -1 }] }, 422);
    await relatar({ assinatura: a, mensagem: 'x', migalhas: [{ t: 1.5 }] }, 422);
    assert.equal(await linhaDe(a), undefined);

    const b = assinatura('migalha-t-epoch');
    const agora = Date.now();
    await relatar({ assinatura: b, mensagem: 'x', migalhas: [{ t: agora, texto: 'agora' }] });
    const defeito = await linhaDe(b);
    assert.equal((await ocorrenciasDe(defeito.id))[0].migalhas[0].t, agora);
  });

  it('relato SEM migalhas continua sendo aceito: o contrato da rota anônima não mudou', async () => {
    const a = assinatura('sem-migalhas');
    await relatar({ assinatura: a, mensagem: 'x' });
    const defeito = await linhaDe(a);
    assert.equal((await ocorrenciasDe(defeito.id))[0].migalhas, null, 'ausente é NULL, não []');
  });

  // ── a rota de leitura ──

  it('GET /diag/defeitos/:id/ocorrencias: anônimo 401, comum 403, administrador 200', async () => {
    const a = assinatura('rota-de-ocorrencias');
    await relatar({ assinatura: a, mensagem: 'x', sessaoId: randomUUID(), pagina: 'index' });
    const defeito = await linhaDe(a);

    await supertest(app).get(`/api/v1/diag/defeitos/${defeito.id}/ocorrencias`).expect(401);
    await supertest(app).get(`/api/v1/diag/defeitos/${defeito.id}/ocorrencias`)
      .set('Authorization', `Bearer ${comumToken}`).expect(403);

    const res = await supertest(app)
      .get(`/api/v1/diag/defeitos/${defeito.id}/ocorrencias`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    assert.equal(res.body.data.itens.length, 1);
    const item = res.body.data.itens[0];
    assert.equal(item.defeitoId, defeito.id);
    assert.equal(item.pagina, 'index');
    assert.equal(typeof item.em, 'number', 'epoch ms, como toda data desta família');
    assert.equal(item.username, null, 'anônimo aparece, sem nome');
  });

  it('a listagem vem da mais RECENTE para a mais antiga, e nunca passa de vinte', async () => {
    const a = assinatura('rota-ordem');
    const sessoes = [];
    for (let i = 0; i < 22; i += 1) {
      const sessaoId = randomUUID();
      sessoes.push(sessaoId);
      await relatar({ assinatura: a, mensagem: 'x', sessaoId });
    }
    const defeito = await linhaDe(a);

    const res = await supertest(app)
      .get(`/api/v1/diag/defeitos/${defeito.id}/ocorrencias`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    assert.equal(res.body.data.itens.length, 20);
    assert.equal(res.body.data.itens[0].sessaoId, sessoes[sessoes.length - 1], 'a mais recente vem antes');
  });

  it('id que não é UUID é 422; defeito inexistente é lista VAZIA, nunca 404', async () => {
    await supertest(app).get('/api/v1/diag/defeitos/nao-e-uuid/ocorrencias')
      .set('Authorization', `Bearer ${adminToken}`).expect(422);

    // A poda por idade pode ter passado entre a listagem que o administrador está lendo e o
    // clique dele; um 404 ali leria como "a rota quebrou" em vez de "isto envelheceu".
    const res = await supertest(app)
      .get(`/api/v1/diag/defeitos/${randomUUID()}/ocorrencias`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.deepEqual(res.body.data.itens, []);
  });

  it('o `user_id` da ocorrência vem do TOKEN, como o do defeito', async () => {
    const a = assinatura('ocorrencia-com-sessao');
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .set('Authorization', `Bearer ${comumToken}`)
      .send({ assinatura: a, mensagem: 'x', userId: admin.id })
      .expect(204);

    const defeito = await linhaDe(a);
    const ocs = await ocorrenciasDe(defeito.id);
    assert.equal(ocs[0].user_id, comum.id, 'o corpo não decide identidade, nem aqui');

    const res = await supertest(app)
      .get(`/api/v1/diag/defeitos/${defeito.id}/ocorrencias`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.equal(res.body.data.itens[0].username, comum.username, 'o LEFT JOIN traz o nome');
  });
});
