// Path: tests/integration/emprestimo-do-produtor-resolve.test.js
//
// O ATLAS DO PRODUTOR EMPRESTA DE FATO O QUE ELE MANTÉM (item 16).
//
// O DEFEITO QUE ESTE ARQUIVO FECHA ERA MUDO. Um produtor dono de um atlas anexava um
// recurso da própria OM, passava nos TRÊS gates do anexo (`manage` no atlas, ver o
// recurso, autoridade de repasse) e o empréstimo não resolvia para NINGUÉM: ele
// continuava vendo pelo ramo de produção de `fn_can_see_resource`, os membros do atlas
// não viam nada, e não havia erro em lugar nenhum — o 201 do anexo era honesto e a
// leitura seguinte, vazia. O braço D4 de `fn_granted_resource_ids` perguntava por papel
// global e por concessão do dono, e nunca se o dono PRODUZ o recurso.
//
// O SEGUNDO CASO É O QUE PRENDE A PROPRIEDADE, e não só o comportamento: D4 é
// REAVALIADO A CADA LEITURA, então o empréstimo morre quando a produção morre, sem
// ninguém tocar em `atlas_resources`. Sem ele, o primeiro caso passaria idêntico numa
// implementação que carimbasse o acesso no INSERT do anexo — que é a forma errada mais
// natural de escrever isto.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('F17 — o empréstimo por atlas reconhece a PRODUÇÃO do dono', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgA, orgB, atlas;

  const ANEXADO = `emp-anexado-${sufixo}`;
  const NAO_ANEXADO = `emp-solto-${sufixo}`;

  /** Os ids de tileset que `quem` enxerga, com ou sem atlas em foco. */
  async function visiveis(quem, atlasId = null) {
    const res = await supertest(app)
      .get(`/api/v1/resource-access/visible${atlasId ? `?atlasId=${atlasId}` : ''}`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.tilesets.map((t) => t.id);
  }

  const anexosVivos = async () => (await db.query(
    `SELECT COUNT(*)::int AS n FROM atlas_resources
      WHERE atlas_id = $1::uuid AND resource_id = $2 AND removed_at IS NULL`,
    [atlas.id, ANEXADO],
  )).rows[0].n;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM emp ${rotulo} ${sufixo}`, `om-emp-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`],
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    atores.admin = await createAdminUser(db, { username: `ep_admin_${sufixo}` });
    atores.produtor = await createProducerUser(db, orgA, { username: `ep_prod_${sufixo}` });
    atores.membro = await createUser(db, { username: `ep_membro_${sufixo}` });
    atores.forasteiro = await createUser(db, { username: `ep_fora_${sufixo}` });
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    for (const id of [ANEXADO, NAO_ANEXADO]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid, 'private')`,
        [id, `Tileset ${id}`, orgA],
      );
    }

    atlas = await createAtlas(db, atores.produtor.id, { name: `Atlas do produtor ${sufixo}` });
    // O membro entra com `read`, o piso da escada: o empréstimo é propriedade do atlas
    // que TODO membro enxerga.
    await createShare(db, atlas.id, atores.membro.id, 'read', atores.produtor.id);

    // O ANEXO PASSA PELA ROTA REAL, e não por um INSERT: é ele que exercita os três
    // gates, e o do REPASSE (`requireResourceRelay`) só deixa o produtor entrar pelo
    // ramo de produção.
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokens.produtor}`)
      .send({ resourceType: 'tileset', resourceId: ANEXADO })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM atlas WHERE id = $1::uuid', [atlas.id]);
    await db.query('DELETE FROM tilesets WHERE id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('o membro do atlas do produtor recebe o recurso que a OM dele mantém', async () => {
    assert.equal(await anexosVivos(), 1, 'piso: o anexo existe e está vivo');
    // O PISO NEGATIVO: sem o atlas em foco o membro não recebe nada, porque ele não
    // tem concessão nenhuma nem papel global. ANTES DO FIX ele não recebia nem COM o
    // atlas em foco, e é esse o verde que este arquivo compra.
    assert.ok(
      !(await visiveis('membro')).includes(ANEXADO),
      'piso: sem `?atlasId=`, o braço de empréstimo não contribui',
    );

    const comAtlas = await visiveis('membro', atlas.id);
    assert.ok(
      comAtlas.includes(ANEXADO),
      'com o atlas em foco, o empréstimo resolve — o braço D4 reconhece a PRODUÇÃO do dono',
    );
    // A DISCRIMINAÇÃO: um SEGUNDO recurso privado da MESMA OM, não anexado, continua
    // ausente na MESMA resposta. Sem ela, "o membro vê" seria compatível com um
    // predicado que abrisse a OM inteira para quem entra no atlas do produtor.
    assert.ok(
      !comAtlas.includes(NAO_ANEXADO),
      'o que NÃO foi anexado continua fora: o empréstimo é por recurso, não por OM',
    );

    // E quem não é membro do atlas não herda nada, nem sabendo o UUID: o `?atlasId=` é
    // gateado por `requireAtlasScopeWhenPresent`.
    await supertest(app)
      .get(`/api/v1/resource-access/visible?atlasId=${atlas.id}`)
      .set('Authorization', `Bearer ${tokens.forasteiro}`)
      .expect(404);
  });

  it('o empréstimo morre quando a PRODUÇÃO morre, sem ninguém tocar em `atlas_resources`', async () => {
    // O PISO é o caso anterior reafirmado no instante imediatamente anterior à
    // mudança: sem isso, "deixou de ver" é o que se mede numa fixture que nunca
    // funcionou.
    assert.ok((await visiveis('membro', atlas.id)).includes(ANEXADO), 'piso: o membro recebe');

    // MUDA SÓ O ESCOPO DE PRODUÇÃO DO DONO DO ATLAS. Nada mais é tocado: nem o anexo,
    // nem a permissão do membro, nem a visibilidade do recurso.
    await db.query('UPDATE users SET producer_org_id = $2::uuid WHERE id = $1', [
      atores.produtor.id, orgB,
    ]);

    assert.ok(
      !(await visiveis('membro', atlas.id)).includes(ANEXADO),
      'a MESMA requisição deixa de trazer o id: D4 é reavaliado a cada leitura',
    );
    assert.equal(
      await anexosVivos(), 1,
      'e o anexo continua vivo — o que caiu foi o predicado, não o vínculo',
    );

    // O CONTROLE DA REVERSÃO: devolver o escopo devolve o empréstimo. Sem ele, "sumiu"
    // seria compatível com a fixture ter sido destruída pelo caminho.
    await db.query('UPDATE users SET producer_org_id = $2::uuid WHERE id = $1', [
      atores.produtor.id, orgA,
    ]);
    assert.ok((await visiveis('membro', atlas.id)).includes(ANEXADO), 'e volta ao restaurar');
  });

  it('desativar a OM PRODUTORA mata o empréstimo, mesmo com a lotação ativa', async () => {
    // O BURACO QUE ESTE CASO FECHA. `fn_can_produce_resource` conferia a vida da conta e a
    // da OM de LOTAÇÃO (`users.organization_id`), nunca a da OM PRODUTORA
    // (`users.producer_org_id`). Como as duas podem ser organizações diferentes, desativar
    // a OM produtora deixava o acervo privado dela sendo mantido — e, desde que o braço D4
    // passou a reconhecer produção, servido a TODO membro do atlas do produtor, inclusive
    // ao visitante anônimo de um atlas público. Desativar OM é kill-switch declarado no
    // produto, e a assimetria não estava escrita em lugar nenhum: era o ramo que ninguém
    // perguntou.
    //
    // A LOTAÇÃO FICA ATIVA DE PROPÓSITO, e é o que faz este caso discriminar: com ela nula
    // ou desativada, o mesmo vermelho apareceria pelo ramo antigo e não provaria nada sobre
    // o novo.
    await db.query('UPDATE users SET organization_id = $2::uuid WHERE id = $1', [
      atores.produtor.id, orgB,
    ]);
    assert.ok(
      (await visiveis('membro', atlas.id)).includes(ANEXADO),
      'piso: com as DUAS OM ativas, o empréstimo resolve',
    );

    await db.query('UPDATE organizations SET is_active = false WHERE id = $1::uuid', [orgA]);
    try {
      assert.ok(
        !(await visiveis('membro', atlas.id)).includes(ANEXADO),
        'OM produtora desativada: o dono deixa de produzir, e o empréstimo cai junto',
      );
      assert.equal(
        await anexosVivos(), 1,
        'e o anexo continua vivo — de novo, o que caiu foi o predicado',
      );
      // A DISCRIMINAÇÃO do outro lado: a OM de LOTAÇÃO segue ativa e não é ela que decide.
      const { rows } = await db.query(
        'SELECT is_active FROM organizations WHERE id = $1::uuid', [orgB],
      );
      assert.equal(rows[0].is_active, true, 'a lotação do produtor continua numa OM ativa');
    } finally {
      await db.query('UPDATE organizations SET is_active = true WHERE id = $1::uuid', [orgA]);
      await db.query('UPDATE users SET organization_id = NULL WHERE id = $1', [atores.produtor.id]);
    }

    assert.ok(
      (await visiveis('membro', atlas.id)).includes(ANEXADO),
      'controle da reversão: reativar a OM devolve o empréstimo',
    );
  });
});
