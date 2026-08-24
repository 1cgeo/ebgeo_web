// Path: tests/integration/auditoria-postos.test.js
//
// OS TRÊS BURACOS QUE SOBRAVAM ALÉM DO CLEANUP DE SYNC: o CRUD de postos e graduações.
//
// `POST /ranks`, `PUT /ranks/:id` e `DELETE /ranks/:id` são as três escritas de uma
// tabela de domínio administrada por admin, e não emitiam NADA — zero `createAudit` no
// módulo inteiro — enquanto a irmã organizações emitia as três. O censo
// (`tests/unit/auditoria-censo.test.js`) as declarava como buraco com motivo escrito
// desde a fase de auditoria, e o que as manteve abertas foi o preço: vocabulário novo no
// CHECK de `audit_trail.action` custa migração com par DROP/ADD CONSTRAINT.
//
// O CENSO PRENDE A EXISTÊNCIA DA TRILHA; ESTE ARQUIVO PRENDE O CONTEÚDO DELA. Ele existe
// porque a metade que engana é a segunda: uma linha gravada com `target_name` nulo passa
// verde em qualquer contagem e devolve um UUID cru para quem investiga, que é
// exatamente o estado de `ORG_DELETE` hoje (o DEACTIVATE de organizações só faz
// `RETURNING id`). O defeito conhecido da irmã NÃO foi copiado, e é este arquivo que
// impede que ele volte por descuido.
//
// CONTROLE NEGATIVO no fim: uma escrita RECUSADA (não-admin, 403) não pode deixar linha.
// Sem ele, um emissor solto em qualquer ponto do módulo satisfaria os casos de cima.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('Auditoria — o CRUD de postos deixa trilha, e ela NOMEIA o posto', () => {
  let app, db, admin, comum, adminToken, userToken;
  let posto;
  const sufixo = randomUUID().slice(0, 8);
  const nomeInicial = `Posto trilha ${sufixo}`;
  const nomeRenomeado = `Posto renomeado ${sufixo}`;

  /** As linhas de trilha do posto criado por este arquivo, na ordem em que nasceram. */
  const linhasDoPosto = async () => (await db.query(
    `SELECT * FROM audit_trail
      WHERE target_type = 'RANK' AND target_id = $1
      ORDER BY created_at, action`,
    [posto.id],
  )).rows;

  const linhasDaAcao = async (acao) => (await linhasDoPosto()).filter((l) => l.action === acao);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: `posto_admin_${sufixo}` });
    comum = await createUser(db, { username: `posto_user_${sufixo}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, comum.username, comum.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('criar um posto emite RANK_CREATE com ator, alvo e NOME', async () => {
    const res = await supertest(app)
      .post('/api/v1/ranks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: nomeInicial, nome_abrev: 'PTr', sort_order: 900 })
      .expect(201);
    posto = res.body.data;

    const achadas = await linhasDaAcao('RANK_CREATE');
    assert.equal(achadas.length, 1, 'uma criação, uma linha');
    assert.equal(achadas[0].actor_id, admin.id);
    assert.equal(achadas[0].target_id, posto.id);
    assert.equal(achadas[0].target_name, nomeInicial);
    assert.equal(
      achadas[0].target_org_id, null,
      'posto é vocabulário institucional e não tem OM dona: carimbar a lotação do ator '
      + 'faria o filtro por OM devolver atos que não são do acervo daquela OM',
    );
  });

  it('renomear emite RANK_UPDATE com o nome NOVO, que é o do momento do ato', async () => {
    await supertest(app)
      .put(`/api/v1/ranks/${posto.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: nomeRenomeado })
      .expect(200);

    const achadas = await linhasDaAcao('RANK_UPDATE');
    assert.equal(achadas.length, 1);
    assert.equal(achadas[0].target_name, nomeRenomeado);
  });

  it('um PATCH que NÃO manda `nome` ainda nomeia o posto (a linha lê a linha, não o corpo)', async () => {
    // A ARMADILHA QUE ESTE CASO PRENDE: `updateRankSchema` tem `.min(1)`, então desativar
    // um posto é um corpo com `is_active` e mais nada. Um emissor que lesse
    // `req.body.nome` gravaria `target_name` nulo AQUI e só aqui — o caso de cima
    // continuaria verde, e a trilha ficaria muda justamente no ato mais consequente,
    // que é o que tira o posto do cadastro.
    await supertest(app)
      .put(`/api/v1/ranks/${posto.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false })
      .expect(200);

    const achadas = await linhasDaAcao('RANK_UPDATE');
    assert.equal(achadas.length, 2, 'dois PUT, duas linhas');
    assert.equal(achadas[1].target_name, nomeRenomeado);
  });

  it('excluir emite RANK_DELETE COM o nome, que é onde a irmã organizações falha', async () => {
    await supertest(app)
      .delete(`/api/v1/ranks/${posto.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const achadas = await linhasDaAcao('RANK_DELETE');
    assert.equal(achadas.length, 1);
    assert.equal(achadas[0].actor_id, admin.id);
    assert.equal(achadas[0].target_id, posto.id);
    assert.equal(
      achadas[0].target_name, nomeRenomeado,
      'o DEACTIVATE devolve `id, nome` justamente para esta linha: sem o nome, quem lê a '
      + 'trilha recebe um UUID e precisa ir procurar em outro lugar o que foi apagado',
    );
  });

  it('as três ações estão na trilha do MESMO posto, e nenhuma outra', async () => {
    // A soma, e não três casos isolados: é ela que mostra que o alvo `RANK` amarra os
    // três atos ao mesmo posto, que é o que `idx_audit_target` existe para servir.
    const acoes = (await linhasDoPosto()).map((l) => l.action);
    assert.deepEqual(
      acoes.filter((a, i) => acoes.indexOf(a) === i).sort(),
      ['RANK_CREATE', 'RANK_DELETE', 'RANK_UPDATE'],
    );
    assert.equal(acoes.length, 4, 'uma criação, dois PUT e uma exclusão');
  });

  it('CONTROLE NEGATIVO: escrita RECUSADA (não-admin) não deixa linha nenhuma', async () => {
    // A CONTAGEM É POR (ATOR, ALVO), e as DUAS metades da chave são necessárias. O banco
    // de teste é ÚNICO para o processo e os arquivos rodam em paralelo, com outras
    // suítes criando e apagando postos pela mesma API: um antes/depois global mediria o
    // paralelismo, não o gate. E só o ator não basta, porque `loginUser` já gravou uma
    // linha de `LOGIN` para as duas contas — contar tudo do ator daria 1 e o caso
    // reprovaria por um motivo que não tem nada a ver com postos.
    const porAtor = async (id) => (await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_trail WHERE actor_id = $1 AND target_type = 'RANK'`,
      [id],
    )).rows[0].n;

    await supertest(app)
      .post('/api/v1/ranks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nome: `Posto proibido ${sufixo}` })
      .expect(403);

    assert.equal(
      await porAtor(comum.id), 0,
      'a trilha registra o ato consumado, nunca a tentativa barrada no gate',
    );

    // A DISCRIMINAÇÃO, sem a qual o zero acima seria o resultado de uma consulta que não
    // acha nada por qualquer motivo (coluna errada, ator errado, tabela vazia).
    const doAdmin = await porAtor(admin.id);
    assert.ok(doAdmin >= 4, `a MESMA consulta precisa achar os atos do admin; achou ${doAdmin}`);
  });
});
