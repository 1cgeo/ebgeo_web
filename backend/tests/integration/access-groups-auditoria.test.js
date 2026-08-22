// Path: tests/integration/access-groups-auditoria.test.js
//
// A TRILHA DO GRUPO DE ACESSO.
//
// "Ação declarada no CHECK sem emissor lê como 'isto é auditado' e não é": foi assim
// que `LOGIN`, `LOGOUT` e `ATLAS_DELETE` viveram desde o primeiro dia.
// `002_auditoria.sql` declara cinco ações de grupo e o `target_type` `ACCESS_GROUP`, e o que este arquivo mede é que as
// cinco TÊM EMISSOR e que a linha emitida responde às perguntas que a investigação
// faz. Sem isto, o CHECK alargado é vocabulário sem falante.
//
// AS TRÊS PERGUNTAS QUE A LINHA PRECISA RESPONDER, e cada uma custa um campo que o
// caminho feliz não usa:
//
//   - "quem renomeou este grupo" só é útil com o nome ANTERIOR junto, senão a
//     investigação de "o grupo Alfa sumiu" não liga Alfa ao grupo que hoje se chama
//     outra coisa;
//   - "o que se perdeu ao apagar" é a contagem de concessões VIVAS, lida ANTES da
//     exclusão, porque depois dela é irrecuperável;
//   - "por que Fulano viu este recurso" precisa de UMA linha por movimento de membro,
//     e de NENHUMA linha quando o clique repetido não mudou estado nenhum.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: o alcance dos gates (`access-groups-crud.test.js`) e
// o efeito da concessão coletiva sobre o que se enxerga
// (`resource-grants-grupo.test.js`).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('F16 — a trilha de auditoria do grupo de acesso', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let serie = 0;

  /** Uma camada de dados PRIVADA, nova a cada caso. */
  async function novaCamada(rotulo) {
    serie += 1;
    const id = `aud-${rotulo}-${sufixo}-${serie}`;
    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [id, `Camada ${id}`],
    );
    return id;
  }

  /** Um grupo novo, pela rota. */
  async function novoGrupo(rotulo, description) {
    serie += 1;
    const corpo = { name: `Grupo ${rotulo} ${sufixo} ${serie}` };
    if (description !== undefined) corpo.description = description;
    const res = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send(corpo)
      .expect(201);
    return res.body.data;
  }

  /** As linhas de trilha cujo alvo é ESTE grupo, na ordem em que foram escritas. */
  async function trilhaDoGrupo(groupId) {
    const { rows } = await db.query(
      `SELECT action, actor_id, target_type, target_id, target_name, details
         FROM audit_trail
        WHERE target_type = 'ACCESS_GROUP' AND target_id = $1
        ORDER BY created_at, id`,
      [groupId],
    );
    return rows;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    atores.admin = await createAdminUser(db, { username: `aud_admin_${sufixo}` });
    atores.membro = await createUser(db, { username: `aud_membro_${sufixo}` });
    for (const nome of ['admin', 'membro']) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM data_layers WHERE id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM access_groups WHERE name LIKE $1', [`%${sufixo}%`]);
    await teardownTestEnv(db);
  });

  it('as CINCO ações têm emissor, e todas apontam para o GRUPO como alvo', async () => {
    // O ALVO DE UMA AÇÃO DE MEMBRO É O GRUPO, nunca o usuário movido: investiga-se
    // pela coisa cujo acesso mudou, por `idx_audit_target`. E o `target_type` é
    // 'ACCESS_GROUP' e não 'GROUP', que pertence aos grupos de FEIÇÃO de um mapa —
    // reusá-lo misturaria duas histórias no mesmo balde do índice.
    const grupo = await novoGrupo('ciclo');

    await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: `${grupo.name} renomeado` })
      .expect(200);
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: atores.membro.id })
      .expect(200);
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.membro.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    const linhas = await trilhaDoGrupo(grupo.id);
    assert.deepEqual(
      linhas.map((l) => l.action),
      [
        'ACCESS_GROUP_CREATE',
        'ACCESS_GROUP_UPDATE',
        'ACCESS_GROUP_MEMBER_ADD',
        'ACCESS_GROUP_MEMBER_REMOVE',
        'ACCESS_GROUP_DELETE',
      ],
      'as cinco ações da migração 009, na ordem do ciclo de vida',
    );
    assert.equal(linhas.length, 5, 'as cinco linhas existem antes de percorrê-las');

    for (const linha of linhas) {
      assert.equal(linha.target_type, 'ACCESS_GROUP');
      assert.equal(linha.target_id, grupo.id, 'o alvo é sempre o GRUPO');
      assert.equal(linha.actor_id, atores.admin.id);
      assert.ok(linha.target_name, 'a linha precisa continuar legível sem um JOIN');
    }

    // A composição desce para `details` COM O NOME junto, pela mesma razão.
    const entrou = linhas.find((l) => l.action === 'ACCESS_GROUP_MEMBER_ADD');
    assert.equal(entrou.details.userId, atores.membro.id);
    assert.equal(entrou.details.username, atores.membro.username);
    const saiu = linhas.find((l) => l.action === 'ACCESS_GROUP_MEMBER_REMOVE');
    assert.equal(saiu.details.userId, atores.membro.id);
    assert.equal(saiu.details.username, atores.membro.username);
  });

  it('`ACCESS_GROUP_UPDATE` guarda o nome ANTERIOR', async () => {
    // SEM O ANTES, A LINHA NÃO RESPONDE A PERGUNTA QUE ELA EXISTE PARA RESPONDER: com
    // só o nome novo, "o grupo Alfa sumiu" não se liga ao grupo que hoje se chama
    // outra coisa. É a mesma razão de a exclusão ser soft.
    const grupo = await novoGrupo('rename');
    const novoNome = `${grupo.name} MK2`;

    await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: novoNome })
      .expect(200);

    const linhas = (await trilhaDoGrupo(grupo.id))
      .filter((l) => l.action === 'ACCESS_GROUP_UPDATE');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].details.nomeAnterior, grupo.name);
    assert.equal(linhas[0].details.name, novoNome, 'e o depois, na mesma linha');
    assert.equal(linhas[0].target_name, novoNome);

    // Um PATCH que mexe SÓ na descrição também registra, e aí os dois nomes coincidem
    // de propósito: a linha diz que houve uma escrita, não que houve um rename.
    await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ description: 'nova descrição' })
      .expect(200);
    const depois = (await trilhaDoGrupo(grupo.id))
      .filter((l) => l.action === 'ACCESS_GROUP_UPDATE');
    assert.equal(depois.length, 2);
    assert.equal(depois[1].details.nomeAnterior, novoNome);
    assert.equal(depois[1].details.name, novoNome);
  });

  it('`ACCESS_GROUP_DELETE` guarda `grantsAffected` com a contagem REAL de concessões vivas', async () => {
    // A CONTAGEM É O ALCANCE DO ATO, e ela é lida ANTES da exclusão porque depois é
    // irrecuperável sem reconstruir o estado do grupo. Sem ela a linha diria "apagou
    // um grupo" quando o que aconteceu foi "tirou o acesso de N pessoas a M recursos".
    //
    // A DISCRIMINAÇÃO ESTÁ NA TERCEIRA CONCESSÃO: ela é REVOGADA antes da exclusão, e
    // não pode entrar na conta. Sem esse controle, um `COUNT(*)` sem
    // `revoked_at IS NULL` passaria verde.
    const grupo = await novoGrupo('alcance');
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: atores.membro.id })
      .expect(200);

    const camadas = [
      await novaCamada('alcance-a'),
      await novaCamada('alcance-b'),
      await novaCamada('alcance-c'),
    ];
    assert.equal(camadas.length, 3);

    const concessoes = [];
    for (const layer of camadas) {
      const res = await supertest(app)
        .post(`/api/v1/resource-access/data_layer/${layer}/grants`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ granteeGroupId: grupo.id, grantLevel: 'view' })
        .expect(201);
      concessoes.push(res.body.data.id);
    }
    assert.equal(concessoes.length, 3, 'piso: as três concessões nasceram');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${concessoes[2]}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    const apagado = await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.equal(apagado.body.data.grantsAffected, 2, 'a REVOGADA não conta');
    assert.equal(apagado.body.data.memberCount, 1);

    const linhas = (await trilhaDoGrupo(grupo.id))
      .filter((l) => l.action === 'ACCESS_GROUP_DELETE');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].details.grantsAffected, 2, 'a trilha carrega a mesma contagem');
    assert.equal(linhas[0].details.memberCount, 1);
  });

  it('conceder a grupo grava `PERMISSION_GRANT` no RECURSO, com o grupo em campo próprio', async () => {
    // NÃO EXISTE AÇÃO DE CONCESSÃO NOVA, e a ausência é deliberada: o fato auditado é
    // o mesmo (o acesso a ESTA coisa mudou), e separar por tipo de beneficiário
    // partiria a história de um acesso em duas listas que não se cruzam.
    //
    // O BENEFICIÁRIO COLETIVO OCUPA CAMPOS PRÓPRIOS: reusar `granteeId` para grupo
    // obrigaria toda leitura da trilha a consultar uma segunda coluna para saber o que
    // aquele UUID significa, e um filtro por pessoa casaria grupos por coincidência.
    const layer = await novaCamada('grant');
    const grupo = await novoGrupo('grant');

    const concedida = await supertest(app)
      .post(`/api/v1/resource-access/data_layer/${layer}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeGroupId: grupo.id, grantLevel: 'view_share' })
      .expect(201);

    const { rows } = await db.query(
      `SELECT action, target_type, target_id, details FROM audit_trail
        WHERE action = 'PERMISSION_GRANT' AND details->>'grantId' = $1`,
      [concedida.body.data.id],
    );
    assert.equal(rows.length, 1);
    // O ALVO CONTINUA SENDO O RECURSO, não o grupo.
    assert.equal(rows[0].target_type, 'DATA_LAYER');
    assert.equal(rows[0].target_id, layer);
    assert.equal(rows[0].details.granteeGroupId, grupo.id);
    assert.equal(rows[0].details.granteeGroupName, grupo.name);
    assert.equal(rows[0].details.granteeId, null, 'o campo da PESSOA fica nulo');
    assert.equal(rows[0].details.granteeUsername, null);
    assert.equal(rows[0].details.grantLevel, 'view_share');

    // E NENHUMA linha de grupo foi escrita por este ato: o alvo do `idx_audit_target`
    // é o recurso, e a história do grupo não ganha um evento que não é dele.
    const doGrupo = await trilhaDoGrupo(grupo.id);
    assert.equal(doGrupo.length, 1, 'só a criação do grupo');
    assert.equal(doGrupo[0].action, 'ACCESS_GROUP_CREATE');

    // A DISCRIMINAÇÃO, no mesmo corpo: a concessão a PESSOA preenche o outro campo, e
    // não o de grupo. Sem ela, um par de campos sempre nulos passaria igual.
    const pessoal = await supertest(app)
      .post(`/api/v1/resource-access/data_layer/${layer}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.membro.id, grantLevel: 'view' })
      .expect(201);
    const { rows: pessoais } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'PERMISSION_GRANT' AND details->>'grantId' = $1`,
      [pessoal.body.data.id],
    );
    assert.equal(pessoais.length, 1);
    assert.equal(pessoais[0].details.granteeId, atores.membro.id);
    assert.equal(pessoais[0].details.granteeUsername, atores.membro.username);
    assert.equal(pessoais[0].details.granteeGroupId, null);
    assert.equal(pessoais[0].details.granteeGroupName, null);
  });

  it('pôr o mesmo membro duas vezes NÃO grava a segunda linha', async () => {
    // A IDEMPOTÊNCIA NÃO PODE POLUIR A TRILHA: uma linha por clique repetido encheria
    // a investigação de eventos que não são eventos, e "desde quando o Fulano estava
    // neste grupo" passaria a ter várias respostas.
    const grupo = await novoGrupo('repetido');

    const primeira = await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: atores.membro.id })
      .expect(200);
    assert.equal(primeira.body.data.added, true, 'piso: a primeira MUDOU o estado');

    const entradas = () => trilhaDoGrupo(grupo.id)
      .then((l) => l.filter((r) => r.action === 'ACCESS_GROUP_MEMBER_ADD'));
    assert.equal((await entradas()).length, 1);

    const segunda = await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: atores.membro.id })
      .expect(200);
    assert.equal(segunda.body.data.added, false);
    assert.equal((await entradas()).length, 1, 'a repetição não escreveu nada');

    // A DISCRIMINAÇÃO: sair e voltar SÃO eventos, e cada um grava o seu — a trilha só
    // cala quando o estado não muda.
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.membro.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: atores.membro.id })
      .expect(200);
    assert.equal((await entradas()).length, 2, 'a reentrada é um evento novo');

    // E a remoção que NÃO removeu nada (404) também não deixa rastro.
    const outro = await createUser(db, { username: `aud_outro_${sufixo}` });
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${outro.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(404);
    const saidas = (await trilhaDoGrupo(grupo.id))
      .filter((l) => l.action === 'ACCESS_GROUP_MEMBER_REMOVE');
    assert.equal(saidas.length, 1, 'só a remoção que de fato removeu');
  });
});
