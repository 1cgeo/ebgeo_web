// Path: tests/integration/access-groups-exclusao-cascata.test.js
//
// APAGAR O GRUPO, E TIRAR ALGUÉM DELE, PASSARAM A PODAR.
//
// Até 2026-08-20 a exclusão de um grupo não escrevia uma linha em `resource_grants`, e
// o argumento estava certo pela METADE: `fn_user_group_ids` exige `deleted_at IS NULL`,
// então marcar a data corta o acesso DOS MEMBROS no mesmo instante. O que ele não via é
// o que os membros REPASSARAM a partir daquela concessão — linhas que apontam para
// terceiros que nunca estiveram no grupo, que o predicado não alcança, e que sobreviviam
// penduradas numa concessão viva cuja justificativa já não existia.
//
// O QUE A PODA PRECISA SEGUIR É A ARESTA `parent_grant_id`, e não "tudo o que o membro
// concedeu". A diferença é a autoridade: quem repassou por uma concessão PESSOAL
// continua com a justificativa de pé, e esse repasse não cai. Os dois casos de baixo
// medem exatamente esse corte, com as duas cadeias nascendo no MESMO recurso — sem
// isso, "não caiu" seria explicável por recorte de recurso e não por seguir a aresta.
//
// A EXPECTATIVA GANHOU UMA SEGUNDA METADE EM 2026-08-21, com a preservação de
// alcançabilidade (D3): o repasse que NASCEU pendurado na concessão coletiva também
// sobrevive, REPAI-ADO na concessão pessoal, quando o membro tem `view_share` próprio
// vivo sobre o mesmo recurso. Ou seja "apagar o grupo derruba o que os membros
// repassaram a partir dele" passou a ter dois desfechos, e o caso
// `o repasse feito PELO grupo sobrevive REPAI-ADO` é quem mede o desfecho novo. Os
// quatro casos anteriores continuam válidos SEM edição, porque neles o repasse do
// membro com dupla autoridade já nascia na concessão pessoal (`LIVE_GRANTS_OF_ACTOR`
// escolhe o `view_share` mais ANTIGO) e nunca esteve no alcance da poda.
//
// O QUE SE PRESERVA, e é a outra metade da decisão: a linha do GRUPO fica na tabela
// (soft) e a concessão fica REVOGADA (soft, com `revoked_by`). As duas juntas são a
// resposta de auditoria "por que o grupo X tinha acesso ao recurso Y". O que some de
// verdade é o ROSTER, e é por isso que ele é copiado para os detalhes da trilha.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('F17 — apagar o grupo e tirar membro PODAM a subárvore', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let serie = 0;

  async function novaCamada(rotulo) {
    serie += 1;
    const id = `casc-${rotulo}-${sufixo}-${serie}`;
    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [id, `Camada ${id}`],
    );
    return id;
  }

  async function novoGrupo(quem, rotulo) {
    serie += 1;
    const res = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .send({ name: `Grupo ${rotulo} ${sufixo} ${serie}` })
      .expect(201);
    return res.body.data;
  }

  const porMembro = (quem, grupoId, userId) => supertest(app)
    .post(`/api/v1/access-groups/${grupoId}/members`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send({ userId })
    .expect(200);

  const conceder = (quem, layer, corpo) => supertest(app)
    .post(`/api/v1/resource-access/data_layer/${layer}/grants`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(corpo);

  async function camadasVisiveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.dataLayers.map((l) => l.id);
  }

  const apagarGrupo = (quem, grupoId) => supertest(app)
    .delete(`/api/v1/access-groups/${grupoId}`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .expect(200);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    atores.admin = await createAdminUser(db, { username: `cs_admin_${sufixo}` });
    for (const nome of ['dono', 'membro1', 'membro2', 'terceiro', 'terceiro2', 'forasteiro']) {
      atores[nome] = await createUser(db, { username: `cs_${nome}_${sufixo}` });
    }
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM data_layers WHERE id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM access_groups WHERE name LIKE $1', [`%${sufixo}%`]);
    await teardownTestEnv(db);
  });

  it('apagar o grupo REVOGA o que ele recebeu e ESVAZIA a composição; a linha sobrevive', async () => {
    const layer = await novaCamada('basico');
    const grupo = await novoGrupo('dono', 'basico');
    await porMembro('dono', grupo.id, atores.membro1.id);
    await porMembro('dono', grupo.id, atores.membro2.id);

    const coletiva = (await conceder('admin', layer, {
      granteeGroupId: grupo.id, grantLevel: 'view',
    }).expect(201)).body.data;
    // A DISCRIMINAÇÃO nasce aqui: uma concessão PESSOAL do MESMO recurso ao membro1.
    const pessoal = (await conceder('admin', layer, {
      granteeId: atores.membro1.id, grantLevel: 'view',
    }).expect(201)).body.data;

    // O PISO, medido no banco E pela API.
    const { rows: antesGrant } = await db.query(
      'SELECT revoked_at FROM resource_grants WHERE id = $1', [coletiva.id],
    );
    assert.equal(antesGrant[0].revoked_at, null, 'piso: a concessão ao grupo está viva');
    const { rows: antesMembros } = await db.query(
      'SELECT COUNT(*)::int AS n FROM access_group_members WHERE group_id = $1', [grupo.id],
    );
    assert.equal(antesMembros[0].n, 2, 'piso: os dois membros estão dentro');
    assert.ok((await camadasVisiveis('membro1')).includes(layer), 'piso: membro1 vê');
    assert.ok((await camadasVisiveis('membro2')).includes(layer), 'piso: membro2 vê');

    const apagado = await apagarGrupo('dono', grupo.id);
    assert.equal(apagado.body.data.grantsAffected, 1, 'a resposta traz o alcance da PODA');
    assert.equal(apagado.body.data.directGrants, 1, 'e o número que a listagem já sabia');
    assert.equal(apagado.body.data.memberCount, 2);

    const { rows: depoisGrant } = await db.query(
      'SELECT revoked_at, revoked_by FROM resource_grants WHERE id = $1', [coletiva.id],
    );
    assert.ok(depoisGrant[0].revoked_at, 'a concessão ao grupo foi REVOGADA');
    assert.equal(depoisGrant[0].revoked_by, atores.dono.id, 'com autor, que é o que a auditoria pede');

    const { rows: depoisMembros } = await db.query(
      'SELECT COUNT(*)::int AS n FROM access_group_members WHERE group_id = $1', [grupo.id],
    );
    assert.equal(depoisMembros[0].n, 0, 'a composição foi esvaziada');

    assert.ok(!(await camadasVisiveis('membro2')).includes(layer), 'membro2 perde o acesso');
    // A DISCRIMINAÇÃO: a poda mirou o GRUPO, não o RECURSO. Sem ela, um `UPDATE` sem
    // cláusula em `resource_grants` passaria verde.
    const { rows: aPessoal } = await db.query(
      'SELECT revoked_at FROM resource_grants WHERE id = $1', [pessoal.id],
    );
    assert.equal(aPessoal[0].revoked_at, null, 'a concessão PESSOAL do mesmo recurso não caiu');
    assert.ok(
      (await camadasVisiveis('membro1')).includes(layer),
      'e o membro1 continua enxergando por ela',
    );

    // O QUE SE PRESERVA: a linha do grupo continua legível na tabela.
    const { rows: linhaGrupo } = await db.query(
      'SELECT name, deleted_at FROM access_groups WHERE id = $1', [grupo.id],
    );
    assert.equal(linhaGrupo.length, 1, 'o grupo NÃO some da tabela');
    assert.equal(linhaGrupo[0].name, grupo.name, 'e continua com o nome legível');
    assert.ok(linhaGrupo[0].deleted_at, 'só marcado como apagado');
  });

  it('apagar o grupo derruba o que os membros repassaram A PARTIR dele, e só isso', async () => {
    // AS DUAS CADEIAS NASCEM NO MESMO RECURSO, e é isso que torna o corte visível: uma
    // passa pela concessão AO GRUPO e a outra pela concessão PESSOAL do membro1. A
    // ordem de criação importa e é deliberada — `LIVE_GRANTS_OF_ACTOR` ordena por
    // `view_share` primeiro e depois por `created_at`, então a concessão pessoal criada
    // ANTES é a que o membro1 usa como pai.
    const layer = await novaCamada('aresta');
    const grupo = await novoGrupo('dono', 'aresta');
    await porMembro('dono', grupo.id, atores.membro1.id);
    await porMembro('dono', grupo.id, atores.membro2.id);

    const pessoal = (await conceder('admin', layer, {
      granteeId: atores.membro1.id, grantLevel: 'view_share',
    }).expect(201)).body.data;
    const coletiva = (await conceder('admin', layer, {
      granteeGroupId: grupo.id, grantLevel: 'view_share',
    }).expect(201)).body.data;

    // O membro2 só tem o grupo: o repasse dele nasce pendurado na concessão COLETIVA.
    const viaGrupo = (await conceder('membro2', layer, {
      granteeId: atores.terceiro.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(
      viaGrupo.parent_grant_id, coletiva.id,
      'piso: o pai é a concessão AO GRUPO, lido da resposta e não presumido',
    );

    // O membro1 tem os dois, e o pai escolhido é a PESSOAL (a mais antiga).
    const viaPessoal = (await conceder('membro1', layer, {
      granteeId: atores.terceiro2.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(
      viaPessoal.parent_grant_id, pessoal.id,
      'piso: o outro repasse nasce na concessão PESSOAL, no MESMO recurso',
    );

    assert.ok((await camadasVisiveis('terceiro')).includes(layer), 'piso: o terceiro vê');
    assert.ok((await camadasVisiveis('terceiro2')).includes(layer), 'piso: o terceiro2 vê');

    const apagado = await apagarGrupo('dono', grupo.id);
    assert.equal(
      apagado.body.data.grantsAffected, 2,
      'a poda alcança a raiz coletiva E o descendente dela',
    );
    assert.equal(
      apagado.body.data.directGrants, 1,
      'enquanto a contagem DIRETA, que é a que a tela sabia, continua sendo 1',
    );

    assert.ok(
      !(await camadasVisiveis('terceiro')).includes(layer),
      'quem recebeu por autoridade do GRUPO cai junto',
    );
    // A DISCRIMINAÇÃO: a outra cadeia, no MESMO recurso, sobrevive inteira.
    assert.ok(
      (await camadasVisiveis('terceiro2')).includes(layer),
      'quem recebeu por autoridade PESSOAL do membro NÃO cai — a poda segue a aresta',
    );
    const { rows: viva } = await db.query(
      'SELECT revoked_at FROM resource_grants WHERE id = $1', [viaPessoal.id],
    );
    assert.equal(viva[0].revoked_at, null);

    // A TRILHA NOMEIA A PODA, e sem ela a cascata seria silenciosa: uma linha por
    // concessão derrubada, com a raiz e a ORIGEM do ato.
    const { rows: trilha } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'PERMISSION_REVOKE' AND details->>'grantId' = $1`,
      [viaGrupo.id],
    );
    assert.equal(trilha.length, 1, 'exatamente uma linha para a concessão derrubada por tabela');
    assert.equal(trilha[0].details.rootGrantId, coletiva.id, 'a raiz da poda');
    assert.equal(trilha[0].details.origem, 'ACCESS_GROUP_DELETE', 'e por que ela aconteceu');

    // E o roster morto sobrevive nos detalhes do ato — é a única cópia que resta.
    const { rows: doDelete } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'ACCESS_GROUP_DELETE' AND target_id = $1`,
      [grupo.id],
    );
    assert.equal(doDelete.length, 1);
    assert.deepEqual(
      doDelete[0].details.membros.map((m) => m.userId).sort(),
      [atores.membro1.id, atores.membro2.id].sort(),
      'quem estava dentro quando o grupo morreu',
    );
  });

  it('o repasse feito PELO grupo sobrevive REPAI-ADO quando o membro tem view_share pessoal vivo', async () => {
    // A EXPECTATIVA DESTE ARQUIVO MUDOU EM 2026-08-21, e este caso é onde ela mudou.
    // Antes da preservação de alcançabilidade (D3), apagar o grupo derrubava TODO repasse
    // pendurado na concessão coletiva. Agora ele só cai se o membro perdeu toda a
    // autorização: quem também tem `view_share` PESSOAL vivo sobre o MESMO recurso
    // continua autorizado, e o repasse é RE-PENDURADO nele em vez de revogado.
    //
    // OS QUATRO CASOS ACIMA CONTINUAM VÁLIDOS SEM EDIÇÃO, e o motivo é a ORDEM de
    // criação: `LIVE_GRANTS_OF_ACTOR` ordena `view_share` primeiro e depois por
    // `created_at`, então lá o repasse do membro1 já nascia pendurado na concessão
    // PESSOAL (a mais antiga) e nunca esteve no alcance da poda. Aqui a coletiva vem
    // ANTES, de propósito: é a única montagem em que o repasse nasce pendurado no grupo e
    // o membro tem, mesmo assim, outra autoridade sobre aquele recurso.
    const layer = await novaCamada('repai');
    const grupo = await novoGrupo('dono', 'repai');
    await porMembro('dono', grupo.id, atores.membro1.id);
    await porMembro('dono', grupo.id, atores.membro2.id);

    const coletiva = (await conceder('admin', layer, {
      granteeGroupId: grupo.id, grantLevel: 'view_share',
    }).expect(201)).body.data;

    // O repasse do membro1 nasce AQUI, quando o grupo é a única autoridade dele.
    const doMembro1 = (await conceder('membro1', layer, {
      granteeId: atores.terceiro.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(
      doMembro1.parent_grant_id, coletiva.id,
      'piso: o repasse pendura na concessão AO GRUPO, lido da resposta e não presumido',
    );
    // O repasse do membro2, que NÃO tem outra autoridade: é a discriminação interna.
    const doMembro2 = (await conceder('membro2', layer, {
      granteeId: atores.terceiro2.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(doMembro2.parent_grant_id, coletiva.id, 'piso: e o do outro membro também');

    // SÓ AGORA o membro1 ganha autoridade PRÓPRIA sobre o mesmo recurso.
    const pessoalDoMembro1 = (await conceder('admin', layer, {
      granteeId: atores.membro1.id, grantLevel: 'view_share',
    }).expect(201)).body.data;

    assert.ok((await camadasVisiveis('terceiro')).includes(layer), 'piso: o terceiro vê');
    assert.ok((await camadasVisiveis('terceiro2')).includes(layer), 'piso: o terceiro2 vê');

    const apagado = await apagarGrupo('dono', grupo.id);
    assert.equal(
      apagado.body.data.grantsAffected, 2,
      'CAEM a raiz coletiva e o repasse de quem só tinha o grupo — e NÃO o do membro1',
    );

    // A METADE NOVA: o repasse do membro1 sobreviveu, com outra origem.
    const { rows: salvo } = await db.query(
      'SELECT parent_grant_id, revoked_at FROM resource_grants WHERE id = $1', [doMembro1.id],
    );
    assert.equal(salvo[0].revoked_at, null, 'o repasse do membro1 NÃO foi revogado');
    assert.equal(
      salvo[0].parent_grant_id, pessoalDoMembro1.id,
      'ele foi RE-PENDURADO na concessão pessoal viva do membro1',
    );
    assert.ok(
      (await camadasVisiveis('terceiro')).includes(layer),
      'e o terceiro continua vendo: "se B não caiu, D não deve cair"',
    );

    // A DISCRIMINAÇÃO, no mesmo ato: quem só tinha o grupo cai. Sem ela, um resgate que
    // salvasse tudo passaria verde.
    const { rows: caido } = await db.query(
      'SELECT revoked_at FROM resource_grants WHERE id = $1', [doMembro2.id],
    );
    assert.ok(caido[0].revoked_at, 'o repasse de quem só tinha o grupo foi revogado');
    assert.ok(
      !(await camadasVisiveis('terceiro2')).includes(layer),
      'e o terceiro2 perde o acesso',
    );

    // E A TRILHA CONTA AS DUAS HISTÓRIAS, com a mesma `origem`.
    const { rows: trilha } = await db.query(
      `SELECT action, details FROM audit_trail
        WHERE details->>'rootGrantId' = $1 ORDER BY action`,
      [coletiva.id],
    );
    assert.equal(trilha.length, 3, 'uma linha por concessão tocada: duas revogadas, uma repai-ada');
    const porGrant = new Map(trilha.map((l) => [l.details.grantId, l]));
    assert.equal(porGrant.size, 3, 'e nenhum grantId em duas linhas');
    assert.equal(porGrant.get(doMembro1.id).action, 'PERMISSION_REPARENT');
    assert.equal(porGrant.get(doMembro1.id).details.kind, 'reparent');
    assert.equal(porGrant.get(doMembro2.id).action, 'PERMISSION_REVOKE');
    for (const l of trilha) {
      assert.equal(
        l.details.origem, 'ACCESS_GROUP_DELETE',
        'a origem vale para as TRÊS classes, e não só para os revogados',
      );
    }
    assert.equal(
      apagado.body.data.grantsAffected, 2,
      'e a contagem da resposta continua sendo a dos que CAÍRAM',
    );
  });

  it('tirar um membro poda o que ELE alimentou PELO grupo, e nada mais', async () => {
    const layer = await novaCamada('saida');
    const outraLayer = await novaCamada('saida-pessoal');
    const grupo = await novoGrupo('dono', 'saida');
    await porMembro('dono', grupo.id, atores.membro1.id);
    await porMembro('dono', grupo.id, atores.membro2.id);

    const coletiva = (await conceder('admin', layer, {
      granteeGroupId: grupo.id, grantLevel: 'view_share',
    }).expect(201)).body.data;
    // A autoridade PRÓPRIA do membro1, sobre OUTRO recurso: ela não passa pelo grupo.
    await conceder('admin', outraLayer, {
      granteeId: atores.membro1.id, grantLevel: 'view_share',
    }).expect(201);

    const doMembro1 = (await conceder('membro1', layer, {
      granteeId: atores.terceiro.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(doMembro1.parent_grant_id, coletiva.id);
    const doMembro2 = (await conceder('membro2', layer, {
      granteeId: atores.terceiro2.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(doMembro2.parent_grant_id, coletiva.id);
    const pessoalDoMembro1 = (await conceder('membro1', outraLayer, {
      granteeId: atores.forasteiro.id, grantLevel: 'view',
    }).expect(201)).body.data;

    assert.ok((await camadasVisiveis('membro1')).includes(layer), 'piso: membro1 vê');
    assert.ok((await camadasVisiveis('terceiro')).includes(layer), 'piso: o terceiro vê');
    assert.ok((await camadasVisiveis('terceiro2')).includes(layer), 'piso: o terceiro2 vê');
    assert.ok((await camadasVisiveis('forasteiro')).includes(outraLayer), 'piso: o forasteiro vê');

    const saida = await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.membro1.id}`)
      .set('Authorization', `Bearer ${tokens.dono}`)
      .expect(200);
    assert.equal(saida.body.data.grantsAffected, 1, 'a resposta diz quantas concessões caíram');

    assert.ok(!(await camadasVisiveis('membro1')).includes(layer), 'quem saiu perde o próprio acesso');
    assert.ok(
      !(await camadasVisiveis('terceiro')).includes(layer),
      'e o que ELE alimentou pelo grupo cai junto — sem isso, seria acesso órfão',
    );

    // AS TRÊS DISCRIMINAÇÕES, que juntas separam "quem saiu" de "por qual autoridade".
    assert.ok(
      (await camadasVisiveis('membro2')).includes(layer),
      'quem ficou não perde nada: a saída de um não é a revogação do grupo',
    );
    assert.ok(
      (await camadasVisiveis('terceiro2')).includes(layer),
      'e o repasse do OUTRO membro, pelo mesmo grupo, não é alcançado',
    );
    assert.ok(
      (await camadasVisiveis('forasteiro')).includes(outraLayer),
      'nem o repasse que o membro1 fez por autoridade PRÓPRIA',
    );
    const { rows: viva } = await db.query(
      'SELECT revoked_at FROM resource_grants WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL',
      [[doMembro2.id, pessoalDoMembro1.id]],
    );
    assert.equal(viva.length, 2, 'as duas linhas que não podiam cair continuam vivas');

    // E o `grantsAffected` da saída aparece na trilha do MEMBRO, não numa contagem
    // solta: é o que responde "o que se perdeu quando o Fulano saiu".
    const { rows: doRemove } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'ACCESS_GROUP_MEMBER_REMOVE' AND target_id = $1
          AND details->>'userId' = $2`,
      [grupo.id, atores.membro1.id],
    );
    assert.equal(doRemove.length, 1);
    assert.equal(doRemove[0].details.grantsAffected, 1);
  });

  it('o roster da trilha inclui o membro DESATIVADO, e a contagem concorda com a lista', async () => {
    // O DEFEITO, MEDIDO: o serviço montava os detalhes com `LIST_MEMBERS`, cuja junção é
    // `JOIN users u ON ... AND u.is_active = true` — de propósito, porque aquela consulta
    // alimenta a TELA e não pode prometer um acesso que o predicado não entrega. Ao lado
    // dela, `memberCount` vinha de `GET_GROUP_REACH`, que conta TODAS as linhas de
    // composição. Resultado: a mesma linha de auditoria saía com `memberCount: 2` e
    // `membros: [um]`, e a pessoa desativada tinha a linha apagada FISICAMENTE sem ficar
    // registrada em lugar nenhum. É o oposto exato do que o docblock do serviço promete
    // ("a única cópia que resta de quem estava dentro quando ele morreu").
    //
    // O PISO é a igualdade `memberCount === membros.length`; a DISCRIMINAÇÃO é o membro
    // ATIVO, que continua aparecendo — sem ela, uma lista vazia satisfaria a igualdade.
    const grupo = await novoGrupo('dono', 'desativado');
    await porMembro('dono', grupo.id, atores.membro1.id);
    await porMembro('dono', grupo.id, atores.membro2.id);

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [atores.membro2.id]);
    try {
      const apagado = await apagarGrupo('dono', grupo.id);
      assert.equal(apagado.body.data.memberCount, 2, 'piso: a contagem conhece os dois');

      const { rows } = await db.query(
        `SELECT details FROM audit_trail
          WHERE action = 'ACCESS_GROUP_DELETE' AND target_id = $1`,
        [grupo.id],
      );
      assert.equal(rows.length, 1);
      const detalhes = rows[0].details;
      assert.equal(
        detalhes.membros.length, detalhes.memberCount,
        'a lista e a contagem da MESMA linha de auditoria precisam falar do mesmo conjunto',
      );
      assert.deepEqual(
        detalhes.membros.map((m) => m.userId).sort(),
        [atores.membro1.id, atores.membro2.id].sort(),
        'o desativado estava dentro quando o grupo morreu, e é aqui que isso fica escrito',
      );
      // E o nome também sobrevive: o `RETURNING` junta `users` sem filtrar `is_active`.
      const desativado = detalhes.membros.find((m) => m.userId === atores.membro2.id);
      assert.equal(desativado.username, atores.membro2.username);
    } finally {
      await db.query('UPDATE users SET is_active = true WHERE id = $1', [atores.membro2.id]);
    }
  });
});
