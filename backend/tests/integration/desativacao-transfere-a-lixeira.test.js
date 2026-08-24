// Path: tests/integration/desativacao-transfere-a-lixeira.test.js
//
// A TRANSFERÊNCIA DA DESATIVAÇÃO ALCANÇA A LIXEIRA (achado A5, decisão do dono em
// 2026-08-24). `COUNT_USER_ATLAS` e `TRANSFER_ATLAS_OWNERSHIP` carregavam `deleted_at IS
// NULL`, e o efeito era duplo:
//
//  (1) quem só tinha atlas descartados contava ZERO, então a pergunta de transferência nem
//      chegava a ser feita e a conta era desativada direto. É a metade silenciosa: nenhum
//      erro, nenhuma confirmação, e um atlas que passa a não ter titular capaz de nada;
//  (2) mesmo na transferência bem-sucedida, os atlas na lixeira ficavam com DONO MORTO, e
//      conta inativa é recusada com 401 em toda rota. Ninguém que consegue autenticar era o
//      dono, e a lixeira é escopada por posse, então aquele atlas sumia de toda tela — a
//      única porta que restava era a do administrador global.
//
// O QUE MUDA DE SIGNIFICADO, e é por isso que o número da lixeira viaja separado: "transferi
// os atlas dele" passou a incluir uma lixeira que não é do novo dono. `atlasTransferred`
// engordou, e um total que engorda em silêncio é a mesma mudança sem o aviso; por isso a
// recusa NOMEIA a parcela e a resposta a devolve em campo próprio, para a tela poder dizê-lo
// antes do clique.
//
// CONTROLE NEGATIVO (rode ao mexer nas duas consultas): reponha `AND deleted_at IS NULL` em
// `COUNT_USER_ATLAS` e o primeiro caso deste arquivo fica vermelho com um 200 no lugar do 409
// — que é literalmente o defeito (1). Reponha-o só em `TRANSFER_ATLAS_OWNERSHIP` e os casos
// de posse ficam vermelhos com o atlas ainda no nome da conta desativada, que é o defeito
// (2). Repare que os dois controles são independentes: consertar uma consulta e não a outra
// deixa metade do achado de pé, com a outra metade verde.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('desativação de conta: a transferência alcança a lixeira', () => {
  let app, db, admin, tokenAdmin, herdeiro, tokenHerdeiro;
  const sufixo = randomUUID().slice(0, 8);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `lix_admin_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    herdeiro = await createUser(db, { username: `lix_herdeiro_${sufixo}` });
    tokenHerdeiro = await loginUser(app, herdeiro.username, herdeiro.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Uma conta nova com token, para que cada caso desative a sua. */
  async function contaComToken(marca) {
    const u = await createUser(db, { username: `lix_${marca}_${sufixo}` });
    return { u, token: await loginUser(app, u.username, u.password) };
  }

  /** Um atlas dessa pessoa, já DESCARTADO pela rota (soft-delete de verdade). */
  async function atlasNaLixeira(userId, token) {
    const atlas = await createAtlas(db, userId, { name: `lix ${randomUUID().slice(0, 6)}` });
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    return atlas;
  }

  const desativar = (userId, transferTo) => supertest(app)
    .delete(`/api/v1/users/${userId}${transferTo ? `?transferTo=${transferTo}` : ''}`)
    .set('Authorization', `Bearer ${tokenAdmin}`);

  const donoDe = async (atlasId) => {
    const { rows } = await db.query('SELECT owner_id, deleted_at FROM atlas WHERE id = $1', [atlasId]);
    return rows[0];
  };

  it('quem SÓ tem atlas na lixeira já não é desativado sem destinatário', async () => {
    const { u, token } = await contaComToken('so_lixo');
    const descartado = await atlasNaLixeira(u.id, token);

    // O CASO QUE O ACHADO É. Antes, a contagem dava zero e este mesmo pedido respondia 200,
    // desativando a conta e deixando o atlas para trás sem que ninguém tivesse sido
    // perguntado. O 409 é a pergunta voltando a existir.
    const res = await desativar(u.id).expect(409);

    assert.match(
      res.body.error.message, /1 atlas, sendo 1 na lixeira/,
      'a recusa nomeia a parcela: sem isso o total não bate com nenhuma tela e o leitor '
      + 'conclui que o servidor conta errado'
    );

    const antes = await donoDe(descartado.id);
    assert.equal(antes.owner_id, u.id, 'a recusa não mexeu em nada');
    const { rows } = await db.query('SELECT is_active FROM users WHERE id = $1', [u.id]);
    assert.equal(rows[0].is_active, true, 'e a conta continua ativa');
  });

  it('o atlas descartado muda de dono, e continua descartado', async () => {
    const { u, token } = await contaComToken('transf');
    const vivo = await createAtlas(db, u.id, { name: `lix vivo ${randomUUID().slice(0, 6)}` });
    const descartado = await atlasNaLixeira(u.id, token);

    const res = await desativar(u.id, herdeiro.id).expect(200);

    assert.equal(res.body.data.atlasTransferred, 2, 'o total passou a incluir a lixeira');
    assert.equal(
      res.body.data.atlasTransferredFromTrash, 1,
      'e a parcela viaja à parte, porque o novo dono herda uma lixeira que não é dele'
    );

    assert.equal((await donoDe(vivo.id)).owner_id, herdeiro.id);
    const depois = await donoDe(descartado.id);
    assert.equal(depois.owner_id, herdeiro.id, 'o descartado também trocou de dono');
    assert.notEqual(
      depois.deleted_at, null,
      'TRANSFERIR NÃO É RESTAURAR: o estado de lixeira é do atlas e sobrevive à troca de dono'
    );
  });

  it('sem nada na lixeira, a parcela é ZERO e não uma cópia do total', async () => {
    const { u } = await contaComToken('sem_lixo');
    await createAtlas(db, u.id, { name: `lix vivo2 ${randomUUID().slice(0, 6)}` });

    const res = await desativar(u.id, herdeiro.id).expect(200);

    assert.equal(res.body.data.atlasTransferred, 1);
    // A DISCRIMINAÇÃO DO CAMPO NOVO. Um `atlasTransferredFromTrash` implementado como
    // sinônimo do total passaria o caso anterior inteiro e mentiria aqui, que é o caso comum
    // (a esmagadora maioria das desativações não envolve lixeira nenhuma).
    assert.equal(res.body.data.atlasTransferredFromTrash, 0);
  });

  it('o herdeiro alcança a lixeira que recebeu, e consegue restaurar de lá', async () => {
    const { u, token } = await contaComToken('alcance');
    const descartado = await atlasNaLixeira(u.id, token);

    await desativar(u.id, herdeiro.id).expect(200);

    // ESTE É O DEFEITO DE FUNDO, e ele não se mede pela coluna `owner_id`: o que estava
    // quebrado era o ALCANCE. Com dono inativo, a lixeira escopada por posse não listava o
    // atlas para ninguém que pudesse autenticar, e a rota de restaurar (`WHERE owner_id = $2`)
    // recusava todo mundo. Só o administrador global entrava.
    const lixeira = await supertest(app)
      .get('/api/v1/atlas/trash')
      .set('Authorization', `Bearer ${tokenHerdeiro}`)
      .expect(200);
    assert.ok(
      lixeira.body.data.some((a) => a.id === descartado.id),
      'o atlas herdado aparece na lixeira de quem o herdou'
    );

    await supertest(app)
      .post(`/api/v1/atlas/${descartado.id}/restore`)
      .set('Authorization', `Bearer ${tokenHerdeiro}`)
      .expect(200);
    assert.equal((await donoDe(descartado.id)).deleted_at, null, 'e ele volta pelas mãos do dono novo');
  });

  it('a trilha registra a parcela da lixeira, e não só o total', async () => {
    const { u, token } = await contaComToken('trilha');
    await atlasNaLixeira(u.id, token);
    await createAtlas(db, u.id, { name: `lix vivo3 ${randomUUID().slice(0, 6)}` });

    await desativar(u.id, herdeiro.id).expect(200);

    const { rows } = await db.query(
      `SELECT details FROM audit_trail
       WHERE action = 'USER_DELETE' AND target_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [u.id]
    );
    assert.equal(rows.length, 1, 'piso: a desativação escreveu a linha de trilha');
    assert.equal(Number(rows[0].details.atlasTransferred), 2);
    // Sem a parcela na trilha, a pergunta "o que o novo dono herdou que ele nunca viu?" fica
    // sem resposta possível depois do ato: o total sozinho não a separa.
    assert.equal(Number(rows[0].details.atlasTransferredFromTrash), 1);
  });
});
