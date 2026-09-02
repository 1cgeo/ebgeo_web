// Path: tests/integration/defeito-estado-rota.test.js
//
// `PATCH /api/v1/diag/defeitos/:id`: as três transições, as colunas que cada uma escreve, a
// linha de trilha, e o par completo do gate.
//
// AS COLUNAS SÃO ASSERIDAS DIRETO NO BANCO, e não só pelo corpo da resposta. O corpo vem de
// `SELECT_DEFEITO_POR_ID`, que é a MESMA consulta em que o serviço acabou de escrever: um
// mapeador que devolvesse o valor pedido em vez do valor gravado passaria verde. O que só a
// leitura crua prova é o CASE de `UPDATE_ESTADO_DE_DEFEITO`, e sobretudo a metade dele que a
// leitura não mostra: `ignorado` NÃO tocar nas quatro colunas de conserto.
//
// O CASO DE REABRIR EXISTE PORQUE AS QUATRO COLUNAS SÃO O REGISTRO DE UM CONSERTO que a
// reabertura declara sem efeito: deixadas para trás, todo consumidor que as renderize mostra
// "resolvido por fulano na release v1" ao lado do estado `aberto`, e a linha contradiz a si
// mesma. UMA PREMISSA FALSA FOI DESCARTADA AQUI, e ela fica registrada porque era convincente:
// a primeira redação dizia que a limpeza impedia uma REGRESSÃO espúria. Não impede. O CASE de
// `UPSERT_DEFEITO` é gateado em `defeitos.estado = 'resolvido'`, e um defeito reaberto não
// está nesse estado, então a coluna parada nunca chegaria a ser comparada. Medido revertendo
// a limpeza: o caso de ponta a ponta continuou VERDE e só o das colunas cruas ficou vermelho.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - tirar o ramo `WHEN $2 = 'aberto' THEN NULL` de qualquer uma das quatro colunas: o caso
//    de reabrir fica vermelho NOMEANDO a coluna (e o de ponta a ponta NÃO fica, ver acima);
//  - fazer `ignorado` limpar as colunas: o caso de ignorar fica vermelho;
//  - tirar o `createAudit` da transação: o caso da trilha fica vermelho;
//  - trocar `ESTADOS_MANUAIS` por `ESTADOS_DE_DEFEITO` no Joi: o caso do 422 sobre
//    `regrediu` fica vermelho, e a mão passaria a escrever um estado que significa um FATO;
//  - devolver 200 em vez de 404 para id inexistente: o caso do 404 fica vermelho, e a tela
//    diria ao administrador que o ato dele valeu quando ele não mudou nada.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { ACAO_DE_ESTADO } from '../../src/modules/diag/defeitos.service.js';

describe('PATCH /diag/defeitos/:id — o ciclo de vida do defeito', () => {
  let app, db, admin, adminToken, comum, comumToken;
  const marca = randomUUID().slice(0, 8);
  const PAGINA = `estado-${marca}`;

  /** Semeia um defeito, com controle sobre o estado e as colunas de conserto. */
  async function semear(nome, campos = {}) {
    const {
      estado = 'aberto', release = 'v1', resolvidoPor = null,
      resolvidoNaRelease = null, resolvidoNoCommit = null,
    } = campos;
    const { rows } = await db.query(
      `INSERT INTO defeitos
         (assinatura, mensagem, pagina, estado, release, primeira_release, ultima_release,
          ocorrencias, resolvido_em, resolvido_por, resolvido_na_release, resolvido_no_commit)
       VALUES ($1, $2, $3, $4, $5, $5, $5, 3,
               CASE WHEN $6::uuid IS NULL THEN NULL ELSE NOW() END, $6, $7, $8)
       RETURNING id`,
      [`TypeError | ${nome} | ${marca}`, `mensagem de ${nome}`, PAGINA, estado, release,
        resolvidoPor, resolvidoNaRelease, resolvidoNoCommit]
    );
    return rows[0].id;
  }

  /** As colunas CRUAS, que é onde o CASE do UPDATE se prova. */
  async function cru(id) {
    const { rows } = await db.query(
      `SELECT estado, resolvido_em, resolvido_por, resolvido_na_release, resolvido_no_commit
         FROM defeitos WHERE id = $1`,
      [id]
    );
    return rows[0];
  }

  const patch = (id, corpo, token = adminToken) => supertest(app)
    .patch(`/api/v1/diag/defeitos/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(corpo);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: `de_adm_${randomUUID().slice(0, 6)}` });
    comum = await createUser(db, { username: `de_usr_${randomUUID().slice(0, 6)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    comumToken = await loginUser(app, comum.username, comum.password);
  });

  after(async () => {
    await db.query('DELETE FROM audit_trail WHERE action = $1 AND target_name LIKE $2', [ACAO_DE_ESTADO, `%${marca}%`]);
    await db.query('DELETE FROM defeitos WHERE pagina = $1', [PAGINA]);
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------- o gate
  it('anônimo leva 401 e usuário comum leva 403', async () => {
    const id = await semear('gate');
    await supertest(app).patch(`/api/v1/diag/defeitos/${id}`).send({ estado: 'ignorado' }).expect(401);
    await patch(id, { estado: 'ignorado' }, comumToken).expect(403);
    // O POSITIVO DO MESMO PAR, sem o qual o negativo passaria idêntico se a rota sumisse:
    // o estado tem de continuar intocado depois das duas recusas.
    assert.equal((await cru(id)).estado, 'aberto');
    await patch(id, { estado: 'ignorado' }).expect(200);
    assert.equal((await cru(id)).estado, 'ignorado');
  });

  // ------------------------------------------------------------ as três transições
  it('RESOLVER escreve as quatro colunas de conserto', async () => {
    const id = await semear('resolver');
    const res = await patch(id, { estado: 'resolvido', commit: 'abc1234' }).expect(200);

    const l = await cru(id);
    assert.equal(l.estado, 'resolvido');
    assert.ok(l.resolvido_em instanceof Date, 'resolvido_em é NOW(), não nulo');
    assert.equal(l.resolvido_por, admin.id, 'o ator vem de req.user, nunca do corpo');
    assert.equal(l.resolvido_no_commit, 'abc1234');
    // `resolvido_na_release` é `config.release`, que em teste é `undefined` -> NULL. É o
    // desfecho NORMAL em desenvolvimento, e o teste o afirma em vez de fingir que não existe.
    // O QUE ELE CUSTA É O INVERSO DA LEITURA NATURAL: NULA, a coluna faz o
    // `IS DISTINCT FROM` do CASE de `UPSERT_DEFEITO` ser verdadeiro contra qualquer valor,
    // então a próxima ocorrência que TRAGA release reabre o defeito como `regrediu` (é o
    // desfecho conservador certo, e `defeito-ciclo-de-vida.test.js` já o prende). Ocorrência
    // SEM release não move nada.
    assert.equal(l.resolvido_na_release, null);

    // A resposta é o item INTEIRO, no shape da listagem, para a tela redesenhar a linha sem
    // um segundo GET (que abriria a janela em que outro relato chega no meio).
    assert.equal(res.body.data.id, id);
    assert.equal(res.body.data.estado, 'resolvido');
    assert.equal(res.body.data.resolvidoPor, admin.id);
    assert.equal(res.body.data.resolvidoPorUsername, admin.username, 'o LEFT JOIN traz o nome');
    assert.equal(typeof res.body.data.resolvidoEm, 'number', 'epoch ms, como toda data desta família');
    assert.equal(res.body.data.resolvidoNoCommit, 'abc1234');
  });

  it('IGNORAR muda o estado e NÃO toca nas quatro colunas de conserto', async () => {
    // A metade do CASE que só a leitura crua prova. Ignorar um defeito que já foi resolvido
    // não desfaz o fato de ele ter sido resolvido, e apagar quem resolveu jogaria fora a
    // única evidência de autoria que a linha tem.
    const id = await semear('ignorar', {
      estado: 'resolvido', resolvidoPor: admin.id, resolvidoNaRelease: 'v9', resolvidoNoCommit: 'deadbee',
    });
    const antes = await cru(id);

    await patch(id, { estado: 'ignorado' }).expect(200);

    const depois = await cru(id);
    assert.equal(depois.estado, 'ignorado');
    assert.deepEqual(depois.resolvido_em, antes.resolvido_em);
    assert.equal(depois.resolvido_por, admin.id);
    assert.equal(depois.resolvido_na_release, 'v9');
    assert.equal(depois.resolvido_no_commit, 'deadbee');
  });

  it('REABRIR limpa as quatro colunas de conserto', async () => {
    const id = await semear('reabrir', {
      estado: 'resolvido', resolvidoPor: admin.id, resolvidoNaRelease: 'v9', resolvidoNoCommit: 'deadbee',
    });
    await patch(id, { estado: 'aberto' }).expect(200);

    const l = await cru(id);
    assert.equal(l.estado, 'aberto');
    assert.equal(l.resolvido_em, null, 'resolvido_em');
    assert.equal(l.resolvido_por, null, 'resolvido_por');
    assert.equal(l.resolvido_na_release, null, 'resolvido_na_release: é ELA que decide regressão');
    assert.equal(l.resolvido_no_commit, null, 'resolvido_no_commit');
  });

  it('reaberto NÃO volta sozinho para `regrediu` na próxima ocorrência de outra build', async () => {
    // O QUE ESTE CASO PROVA, exatamente: a única transição automática do produto é gateada em
    // `defeitos.estado = 'resolvido'`, então uma ocorrência nova sobre um defeito REABERTO
    // não o marca como regressão. É a garantia de que a máquina não contradiz o operador.
    // O que ele NÃO prova é a limpeza das colunas (ver o cabeçalho): revertida a limpeza,
    // este caso continua verde, porque o gate de estado já basta. Quem prova a limpeza é o
    // caso anterior, que lê as colunas cruas.
    const assinatura = `TypeError | reabrir-upsert | ${marca}`;
    await db.query(
      `INSERT INTO defeitos (assinatura, mensagem, pagina, estado, release, primeira_release,
                             ultima_release, ocorrencias, resolvido_em, resolvido_por,
                             resolvido_na_release)
       VALUES ($1, 'm', $2, 'resolvido', 'v1', 'v1', 'v1', 1, NOW(), $3, 'v1')`,
      [assinatura, PAGINA, admin.id]
    );
    const { rows: [{ id }] } = await db.query('SELECT id FROM defeitos WHERE assinatura = $1', [assinatura]);

    await patch(id, { estado: 'aberto' }).expect(200);

    // Uma ocorrência nova, numa release DIFERENTE da do conserto antigo.
    await supertest(app).post('/api/v1/diag/erro-cliente').send({
      assinatura, mensagem: 'm', release: 'v2', pagina: PAGINA,
    }).expect(204);

    assert.equal((await cru(id)).estado, 'aberto', 'o defeito reaberto continua ABERTO');
  });

  // -------------------------------------------------------------------- a trilha
  it('a transição deixa UMA linha na trilha, com a ação, o alvo e o de/para', async () => {
    const id = await semear('trilha');
    await patch(id, { estado: 'resolvido', commit: 'cafe123' }).expect(200);

    const { rows } = await db.query(
      'SELECT action, actor_id, target_type, target_id, target_name, details, target_org_id FROM audit_trail WHERE target_id = $1',
      [id]
    );
    assert.equal(rows.length, 1, 'uma linha por ato, nem zero nem duas');
    const l = rows[0];
    assert.equal(l.action, ACAO_DE_ESTADO);
    assert.equal(l.actor_id, admin.id);
    assert.equal(l.target_type, 'SYSTEM');
    assert.equal(l.target_id, id, 'o id do defeito, e NÃO nulo: é o que faz idx_audit_target responder');
    assert.match(l.target_name, /trilha/, 'a assinatura, truncada');
    assert.equal(l.details.de, 'aberto');
    assert.equal(l.details.para, 'resolvido');
    assert.equal(l.details.commit, 'cafe123');
    assert.equal(l.target_org_id, null, 'um defeito não pertence a OM nenhuma');
  });

  it('o `de` da trilha é o estado ANTERIOR de verdade, e não o pedido', async () => {
    const id = await semear('de-para', { estado: 'ignorado' });
    await patch(id, { estado: 'aberto' }).expect(200);
    const { rows } = await db.query('SELECT details FROM audit_trail WHERE target_id = $1', [id]);
    assert.deepEqual(rows[0].details, { de: 'ignorado', para: 'aberto', commit: null });
  });

  // ------------------------------------------------------------------ as recusas
  it('id inexistente é 404, e NÃO 200 sobre nada', async () => {
    // A assimetria com `GET /defeitos/:id/ocorrencias` (lista vazia) é deliberada: aqui a
    // pergunta é de ESCRITA, e responder 200 diria que o ato valeu quando ele não mudou nada.
    await patch(randomUUID(), { estado: 'ignorado' }).expect(404);
  });

  it('id malformado é 422, e não um 22P02 do driver', async () => {
    await patch('nao-e-uuid', { estado: 'ignorado' }).expect(422);
  });

  it('`regrediu` é 422: ele NUNCA se escreve à mão', async () => {
    // `regrediu` está no CHECK do banco (a máquina o escreve, pelo CASE do UPSERT) e é
    // recusado na borda. Marcado à mão, seria um rótulo sem os dois `release` por trás.
    const id = await semear('regrediu-mao');
    const res = await patch(id, { estado: 'regrediu' }).expect(422);
    assert.match(JSON.stringify(res.body), /estado/, 'o 422 nomeia o campo');
    assert.equal((await cru(id)).estado, 'aberto', 'e nada foi escrito');

    // NÃO-VACUIDADE: o mesmo valor é aceito pelo BANCO, o que prova que a recusa é da borda
    // e não do CHECK, e que os outros três passam pela mesma borda.
    await db.query('UPDATE defeitos SET estado = $2 WHERE id = $1', [id, 'regrediu']);
    assert.equal((await cru(id)).estado, 'regrediu');
  });

  it('estado desconhecido e corpo sem estado são 422', async () => {
    const id = await semear('422');
    await patch(id, { estado: 'zumbi' }).expect(422);
    await patch(id, {}).expect(422);
    await patch(id, { estado: 'aberto', commit: 'x'.repeat(65) }).expect(422);
    assert.equal((await cru(id)).estado, 'aberto');
  });

  it('toda transição é permitida a partir de qualquer estado (o administrador conserta o próprio erro)', async () => {
    // A ausência de máquina de estados é decisão: proibir "ignorar o que já está ignorado"
    // não ganha nada, e transformaria o conserto de um clique errado num 409 sem saída.
    const id = await semear('livre');
    for (const estado of ['resolvido', 'ignorado', 'aberto', 'ignorado', 'resolvido']) {
      const res = await patch(id, { estado }).expect(200);
      assert.equal(res.body.data.estado, estado);
    }
  });
});
