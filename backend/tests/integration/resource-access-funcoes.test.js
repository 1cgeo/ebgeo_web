// Path: tests/integration/resource-access-funcoes.test.js
//
// AS TRÊS FUNÇÕES DE RESOLUÇÃO DE ACESSO, CHAMADAS DIRETO POR SQL (fase F1).
//
// A migração 017 cria `fn_has_global_data_access`, `fn_granted_resource_ids` e
// `fn_can_see_resource`, e NADA as consome ainda. Testá-las por HTTP seria
// impossível nesta fase e enganoso na seguinte: o que se quer prender aqui é o
// PREDICADO, não o caminho de rota que um dia o chamará. É também o único nível
// em que "o dado não vaza nem com bug de app" pode ser afirmado, porque é
// exatamente a camada onde o bug de app não existe.
//
// A regra da casa é que todo filtro de acesso tem teste NEGATIVO. Aqui cada caso
// negativo vem ao lado do seu positivo, no mesmo `it`, porque "não vê" sozinho
// passa idêntico se a fixture falhou, se o id está errado ou se a função devolve
// NULL para tudo. O par mede o DELTA, que é a única coisa que discrimina.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas } from '../helpers/fixtures.js';

const TIPO = 'tileset';

describe('F1 — resolução de acesso a recurso privado (as três funções SQL)', () => {
  let db;
  const sufixo = randomUUID().slice(0, 8);
  const recurso = `raf-tileset-${sufixo}`;
  const outroRecurso = `raf-outro-${sufixo}`;

  let admin, dono, beneficiario, estranho, atlas, atlasLixeira;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    admin = await createAdminUser(db, { username: `raf_admin_${sufixo}` });
    dono = await createUser(db, { username: `raf_dono_${sufixo}` });
    beneficiario = await createUser(db, { username: `raf_benef_${sufixo}` });
    estranho = await createUser(db, { username: `raf_estranho_${sufixo}` });

    for (const id of [recurso, outroRecurso]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, access_level)
         VALUES ($1, $2, '{}'::jsonb, 'private')`,
        [id, `Recurso ${id}`]
      );
    }

    atlas = await createAtlas(db, dono.id, { name: `Atlas RAF ${sufixo}` });
    atlasLixeira = await createAtlas(db, dono.id, { name: `Atlas RAF lixo ${sufixo}` });
    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlasLixeira.id]);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[recurso, outroRecurso]]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[recurso, outroRecurso]]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlas.id, atlasLixeira.id]]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[recurso, outroRecurso]]);
    await teardownTestEnv(db);
  });

  /** fn_has_global_data_access($1) */
  const temAcessoGlobal = async (userId) => {
    const { rows } = await db.query('SELECT fn_has_global_data_access($1::uuid) AS ok', [userId]);
    return rows[0].ok;
  };

  /** fn_granted_resource_ids($1, $2, $3) -> string[] */
  const idsConcedidos = async (userId, atlasId, tipo = TIPO) => {
    const { rows } = await db.query(
      'SELECT resource_id FROM fn_granted_resource_ids($1::uuid, $2::uuid, $3::text) ORDER BY resource_id',
      [userId, atlasId, tipo]
    );
    return rows.map((r) => r.resource_id);
  };

  /** fn_can_see_resource($1, $2, $3, $4, $5) */
  const podeVer = async (userId, atlasId, id, nivel = 'private') => {
    const { rows } = await db.query(
      'SELECT fn_can_see_resource($1::uuid, $2::uuid, $3::text, $4::text, $5::text) AS ok',
      [userId, atlasId, TIPO, id, nivel]
    );
    return rows[0].ok;
  };

  const conceder = async ({ para, por = null, pai = null, nivel = 'view', id = recurso }) => {
    const { rows } = await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [TIPO, id, para, nivel, por, pai]
    );
    return rows[0].id;
  };

  it('piso: as três funções existem e o recurso da fixture é privado', async () => {
    const { rows } = await db.query(
      `SELECT proname FROM pg_proc
        WHERE proname = ANY($1::text[]) ORDER BY proname`,
      [['fn_can_see_resource', 'fn_granted_resource_ids', 'fn_has_global_data_access']]
    );
    assert.deepEqual(
      rows.map((r) => r.proname),
      ['fn_can_see_resource', 'fn_granted_resource_ids', 'fn_has_global_data_access'],
      'a migração 017 precisa ter criado as três funções'
    );
    const { rows: r2 } = await db.query('SELECT access_level FROM tilesets WHERE id = $1', [recurso]);
    assert.equal(r2[0].access_level, 'private');
  });

  // O termo 'curator' precisa ser afirmado por INTROSPECÇÃO, e não por
  // comportamento, e a razão é que nesta fase ele é INALCANÇÁVEL: o CHECK de
  // `users.role` só passa a aceitá-lo em F4, então nenhuma linha pode carregá-lo e
  // nenhum teste de comportamento consegue distingui-lo de ausente. Isto foi
  // MEDIDO: trocar `IN ('admin','curator')` por `IN ('admin')` na migração deixava
  // os outros nove casos deste arquivo verdes. Sem este caso, F1 declararia o
  // papel novo e não teria como saber que ele sumiu.
  it('a função de papel global JÁ conhece o curador (inalcançável até F4, por isso por introspecção)', async () => {
    const { rows } = await db.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'fn_has_global_data_access'"
    );
    assert.equal(rows.length, 1, 'esperava exatamente uma definição da função');
    const def = rows[0].def;
    assert.match(def, /'curator'/, "fn_has_global_data_access precisa aceitar o papel 'curator' (D5)");
    assert.match(def, /'admin'/, 'e continuar aceitando admin');
    // Discriminação: a função também precisa continuar exigindo conta e OM vivas,
    // senão "conhece o curador" seria verdade numa função que liberou geral.
    assert.match(def, /is_active/, 'o predicado de liveness não pode ter sumido junto');
  });

  it('PÚBLICO curto-circuita tudo: até o anônimo vê, sem concessão nenhuma', async () => {
    assert.equal(await podeVer(null, null, recurso, 'public'), true, 'público é visível para o anônimo');
    // Discriminação: o MESMO id, marcado privado, não é.
    assert.equal(await podeVer(null, null, recurso, 'private'), false, 'privado NÃO é visível para o anônimo');
  });

  it('papel global: admin vê; usuário comum e anônimo não', async () => {
    assert.equal(await temAcessoGlobal(admin.id), true, 'admin tem acesso global a dado');
    assert.equal(await temAcessoGlobal(estranho.id), false, 'usuário comum NÃO tem');
    assert.equal(await temAcessoGlobal(null), false, 'p_user_id nulo NÃO tem (o anônimo)');

    assert.equal(await podeVer(admin.id, null, recurso), true);
    assert.equal(await podeVer(estranho.id, null, recurso), false);
  });

  it('conta desativada e OM desativada derrubam o papel global', async () => {
    assert.equal(await temAcessoGlobal(admin.id), true, 'guarda: parte de verdadeiro');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [admin.id]);
    assert.equal(await temAcessoGlobal(admin.id), false, 'conta desativada perde o acesso global');
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [admin.id]);
    assert.equal(await temAcessoGlobal(admin.id), true, 'e volta ao reativar (controle da reversão)');

    const orgId = admin.organization_id;
    assert.ok(orgId, 'guarda: a fixture precisa ter OM para este caso significar algo');
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgId]);
    assert.equal(await temAcessoGlobal(admin.id), false, 'OM desativada derruba o acesso global');
    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [orgId]);
    assert.equal(await temAcessoGlobal(admin.id), true);
  });

  it('concessão DIRETA: o beneficiário vê, o estranho não, e a revogação desfaz', async () => {
    assert.deepEqual(await idsConcedidos(beneficiario.id, null), [], 'guarda: parte de vazio');

    const g = await conceder({ para: beneficiario.id, por: admin.id });

    assert.deepEqual(await idsConcedidos(beneficiario.id, null), [recurso]);
    assert.deepEqual(await idsConcedidos(estranho.id, null), [], 'o estranho continua sem nada');
    assert.equal(await podeVer(beneficiario.id, null, recurso), true);
    assert.equal(await podeVer(estranho.id, null, recurso), false);

    // Discriminação por TIPO: a mesma concessão não vaza para outro tipo.
    assert.deepEqual(await idsConcedidos(beneficiario.id, null, 'data_layer'), [], 'a concessão é por tipo');
    // Discriminação por RECURSO: o outro id continua invisível.
    assert.equal(await podeVer(beneficiario.id, null, outroRecurso), false);

    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = $1', [g]);
    assert.deepEqual(await idsConcedidos(beneficiario.id, null), [], 'revogada, some');
    assert.equal(await podeVer(beneficiario.id, null, recurso), false);
  });

  it('EMPRÉSTIMO do atlas: só com o atlas em foco, e só o atlas certo', async () => {
    // O dono do atlas precisa VER o recurso, senão o empréstimo não sustenta (D4).
    const gDono = await conceder({ para: dono.id, por: admin.id, nivel: 'view_share' });
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, $2, $3, $4)`,
      [atlas.id, TIPO, recurso, dono.id]
    );

    // Sem concessão pessoal, o estranho só alcança o recurso COM o atlas em foco.
    assert.deepEqual(await idsConcedidos(estranho.id, atlas.id), [recurso], 'com o atlas em foco, vê');
    assert.deepEqual(await idsConcedidos(estranho.id, null), [], 'sem o parâmetro, NÃO vê');
    assert.deepEqual(await idsConcedidos(estranho.id, atlasLixeira.id), [], 'com OUTRO atlas, NÃO vê');

    // R4: o visitante de link público não tem linha em `users` e passa p_user_id NULL.
    assert.deepEqual(await idsConcedidos(null, atlas.id), [recurso], 'o visitante anônimo herda o empréstimo');
    assert.deepEqual(await idsConcedidos(null, null), [], 'e sem atlas em foco não herda nada');

    // D4: revogar a concessão do DONO derruba o empréstimo para todos.
    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = $1', [gDono]);
    assert.deepEqual(await idsConcedidos(estranho.id, atlas.id), [], 'dono sem acesso, empréstimo cai');
    assert.deepEqual(await idsConcedidos(null, atlas.id), [], 'inclusive para o visitante público');

    await db.query('UPDATE resource_grants SET revoked_at = NULL WHERE id = $1', [gDono]);
    assert.deepEqual(await idsConcedidos(estranho.id, atlas.id), [recurso], 'e volta (controle da reversão)');
  });

  it('atlas na LIXEIRA não empresta, e restaurar devolve o empréstimo', async () => {
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, $2, $3, $4)`,
      [atlasLixeira.id, TIPO, outroRecurso, dono.id]
    );
    const gDono = await conceder({ para: dono.id, por: admin.id, id: outroRecurso });

    assert.deepEqual(await idsConcedidos(estranho.id, atlasLixeira.id), [], 'atlas apagado não empresta');

    await db.query('UPDATE atlas SET deleted_at = NULL WHERE id = $1', [atlasLixeira.id]);
    assert.deepEqual(
      await idsConcedidos(estranho.id, atlasLixeira.id), [outroRecurso],
      'restaurar o atlas restaura o empréstimo'
    );
    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlasLixeira.id]);
    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = $1', [gDono]);
  });

  it('dono do atlas com PAPEL global sustenta o empréstimo sem concessão nenhuma', async () => {
    const atlasDoAdmin = await createAtlas(db, admin.id, { name: `Atlas RAF admin ${sufixo}` });
    try {
      await db.query(
        `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
         VALUES ($1, $2, $3, $4)`,
        [atlasDoAdmin.id, TIPO, outroRecurso, admin.id]
      );
      assert.deepEqual(
        await idsConcedidos(estranho.id, atlasDoAdmin.id), [outroRecurso],
        'o dono é admin, então o empréstimo se sustenta pelo papel'
      );
      // Discriminação: rebaixe o dono e o empréstimo cai.
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [admin.id]);
      assert.deepEqual(await idsConcedidos(estranho.id, atlasDoAdmin.id), [], 'dono sem papel vivo, empréstimo cai');
      await db.query('UPDATE users SET is_active = true WHERE id = $1', [admin.id]);
    } finally {
      await db.query('DELETE FROM atlas_resources WHERE atlas_id = $1', [atlasDoAdmin.id]);
      await db.query('DELETE FROM atlas WHERE id = $1', [atlasDoAdmin.id]);
    }
  });

  it('a UNION não duplica: concessão direta E empréstimo do mesmo id devolvem uma linha', async () => {
    const gDono = await conceder({ para: dono.id, por: admin.id });
    const gEstranho = await conceder({ para: estranho.id, por: admin.id });
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [atlas.id, TIPO, recurso, dono.id]
    );
    try {
      const ids = await idsConcedidos(estranho.id, atlas.id);
      assert.deepEqual(ids, [recurso], 'UNION (não UNION ALL) deduplica as duas origens');
    } finally {
      await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = ANY($1::uuid[])', [[gDono, gEstranho]]);
    }
  });
});
