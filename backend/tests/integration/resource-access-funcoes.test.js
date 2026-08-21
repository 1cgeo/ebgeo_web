// Path: tests/integration/resource-access-funcoes.test.js
//
// AS FUNÇÕES DE RESOLUÇÃO DE ACESSO, CHAMADAS DIRETO POR SQL.
//
// São QUATRO desde esta fase: `fn_can_produce_resource` entrou ao lado das três de
// `008_acesso_a_recurso.sql` e responde a pergunta do eixo de PRODUÇÃO — "esta pessoa MANTÉM este
// recurso?". Ela é a peça que substituiu o ramo `organization_id = $x` que autorizava
// por LOTAÇÃO auto-declarada no auto-cadastro.
//
// `008_acesso_a_recurso.sql` cria `fn_has_global_data_access`, `fn_granted_resource_ids` e
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
import { createUser, createAdminUser, createProducerUser, createAtlas } from '../helpers/fixtures.js';

const TIPO = 'tileset';

describe('F1 — resolução de acesso a recurso privado (as três funções SQL)', () => {
  let db;
  const sufixo = randomUUID().slice(0, 8);
  const recurso = `raf-tileset-${sufixo}`;
  const outroRecurso = `raf-outro-${sufixo}`;

  let admin, dono, beneficiario, estranho, atlas, atlasLixeira;
  let credenciado, produtor, produtorOutra, orgProdutora, orgOutra;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM RAF ${rotulo} ${sufixo}`, `om-raf-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`]
    )).rows[0].id;
    orgProdutora = await criaOrg('p');
    orgOutra = await criaOrg('o');

    admin = await createAdminUser(db, { username: `raf_admin_${sufixo}` });
    credenciado = await createUser(db, { username: `raf_cred_${sufixo}`, role: 'credenciado' });
    produtor = await createProducerUser(db, orgProdutora, { username: `raf_prod_${sufixo}` });
    produtorOutra = await createProducerUser(db, orgOutra, { username: `raf_prodb_${sufixo}` });
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
    // O recurso da OM PRODUTORA, e um par por tipo para o caso dos cinco tipos.
    await db.query(
      `UPDATE tilesets SET owner_org_id = $2::uuid WHERE id = $1`, [recurso, orgProdutora]
    );

    atlas = await createAtlas(db, dono.id, { name: `Atlas RAF ${sufixo}` });
    atlasLixeira = await createAtlas(db, dono.id, { name: `Atlas RAF lixo ${sufixo}` });
    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlasLixeira.id]);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[recurso, outroRecurso]]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[recurso, outroRecurso]]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlas.id, atlasLixeira.id]]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[recurso, outroRecurso]]);
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgProdutora, orgOutra]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgProdutora, orgOutra]]);
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
      '`008_acesso_a_recurso.sql` precisa ter criado as três funções'
    );
    const { rows: r2 } = await db.query('SELECT access_level FROM tilesets WHERE id = $1', [recurso]);
    assert.equal(r2[0].access_level, 'private');
  });

  // A INTROSPECÇÃO CONTINUA VALENDO, e por uma razão que MUDOU. Ela nasceu porque o
  // papel era inalcançável (o CHECK ainda não o aceitava); hoje ele é alcançável e o
  // comportamento é medido logo abaixo. O que só a introspecção prende é a
  // SUBSTITUIÇÃO: uma migração que acrescentasse `credenciado` e deixasse `curator` de
  // pé passaria em todo teste de comportamento deste repositório, e o sistema ficaria
  // com dois papéis para a mesma coisa — um deles fora do vocabulário da UI e do
  // CHECK de `users.role`, portanto morto e invisível.
  it('o papel global é `credenciado`, e `curator` SAIU da função (substituição, não alargamento)', async () => {
    const { rows } = await db.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'fn_has_global_data_access'"
    );
    assert.equal(rows.length, 1, 'esperava exatamente uma definição da função');
    const def = rows[0].def;
    assert.match(def, /'credenciado'/, "fn_has_global_data_access precisa aceitar o papel 'credenciado'");
    assert.doesNotMatch(def, /'curator'/, 'o valor antigo precisa ter MORRIDO, não sido acompanhado');
    assert.match(def, /'admin'/, 'e continuar aceitando admin');
    // Discriminação: a função também precisa continuar exigindo conta e OM vivas,
    // senão "conhece o credenciado" seria verdade numa função que liberou geral.
    assert.match(def, /is_active/, 'o predicado de liveness não pode ter sumido junto');
  });

  it('COMPORTAMENTO — o credenciado tem acesso global a dado; o produtor NÃO', async () => {
    // O par que separa os DOIS eixos globais, e a razão de os quatro papéis não serem
    // uma escada. Sem o segundo termo, "credenciado vê" seria compatível com uma
    // função que devolvesse true para qualquer papel diferente de `user`.
    assert.equal(await temAcessoGlobal(credenciado.id), true);
    assert.equal(await temAcessoGlobal(produtor.id), false, 'produzir não é ler tudo');
    assert.equal(await podeVer(credenciado.id, null, outroRecurso), true, 'inclusive recurso institucional');
    assert.equal(await podeVer(produtor.id, null, outroRecurso), false);
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
  // ==========================================================================
  // fn_can_produce_resource — o eixo de PRODUÇÃO
  // ==========================================================================

  /** fn_can_produce_resource($1, $2, $3) */
  const podeProduzir = async (userId, id = recurso, tipo = TIPO) => {
    const { rows } = await db.query(
      'SELECT fn_can_produce_resource($1::uuid, $2::text, $3::text) AS ok', [userId, tipo, id]
    );
    return rows[0].ok;
  };

  it('produção: o produtor da OM DONA sim; o de outra OM, o credenciado, o comum e o anônimo não', async () => {
    assert.equal(await podeProduzir(produtor.id), true, 'a OM dona mantém o próprio acervo');
    assert.equal(await podeProduzir(produtorOutra.id), false, 'produtor de OUTRA OM não alcança');
    assert.equal(await podeProduzir(credenciado.id), false, 'o credenciado LÊ tudo e não mantém nada');
    assert.equal(await podeProduzir(estranho.id), false);
    assert.equal(await podeProduzir(null), false, 'o anônimo não produz (e não levanta)');
    // O administrador atravessa tudo, que é o outro braço da função.
    assert.equal(await podeProduzir(admin.id), true);
  });

  it('produção: recurso INSTITUCIONAL (`owner_org_id` nulo) não é de produtor nenhum', async () => {
    // O DEGRAU QUE NINGUÉM LEMBRA: se NULL fosse curinga, todo produtor herdaria o
    // acervo legado do sistema inteiro no dia da migração.
    assert.equal(await podeProduzir(produtor.id, outroRecurso), false);
    assert.equal(await podeProduzir(produtorOutra.id, outroRecurso), false);
    // O par: o administrador continua alcançando o institucional.
    assert.equal(await podeProduzir(admin.id, outroRecurso), true);
  });

  it('produção: id inexistente é FALSE, e o id de 360 não-UUID não levanta 22P02', async () => {
    assert.equal(await podeProduzir(produtor.id, `nao-existe-${sufixo}`), false);
    // `sv360_project` compara `id::text = $3`, e não `$3::uuid`: o id de catálogo é
    // slug e o de 360 é UUID, então um chamador que erre o tipo levaria um 22P02 que
    // a borda traduz em 400 ("requisição malformada"), quando a verdade é só "não
    // encontrei". O par positivo do tipo 360 mora em `sv360-privado.test.js`.
    assert.equal(await podeProduzir(produtor.id, 'isto-nao-e-uuid', 'sv360_project'), false);
  });

  it('produção: tipo fora da WHITELIST levanta, e não devolve um FALSE silencioso', async () => {
    // O nome da tabela nunca vem do request; ele é resolvido por um CASE fechado. Um
    // tipo desconhecido precisa QUEBRAR ALTO, senão um erro de chamador viraria "esta
    // pessoa não produz isto" — a resposta errada com cara de resposta.
    await assert.rejects(
      () => db.query(
        'SELECT fn_can_produce_resource($1::uuid, $2::text, $3::text) AS ok',
        [produtor.id, 'tabela_inventada', recurso]
      ),
      /whitelist|invalid_parameter_value|fn_can_produce_resource/i
    );
    // `streetview_marker` ERA legítimo e virou o CONTROLE NEGATIVO desta lista: a tabela
    // saiu do schema e o ramo saiu do `CASE`, então o tipo passa a
    // levantar como qualquer nome inventado. Testá-lo aqui, e não apagá-lo, é o que
    // prova que o ramo saiu MESMO — um `CASE` com o ramo de pé e a tabela ausente
    // levantaria 42P01 (undefined_table), que não casa com este regex.
    await assert.rejects(
      () => db.query(
        'SELECT fn_can_produce_resource($1::uuid, $2::text, $3::text) AS ok',
        [produtor.id, 'streetview_marker', recurso]
      ),
      /whitelist|invalid_parameter_value|fn_can_produce_resource/i
    );
    // Discriminação: os tipos legítimos NÃO levantam.
    for (const tipo of ['basemap', 'data_layer', 'analysis_layer', 'tileset', 'sv360_project']) {
      assert.equal(typeof (await podeProduzir(produtor.id, recurso, tipo)), 'boolean', tipo);
    }
  });

  it('produção: conta desativada e OM de LOTAÇÃO desativada derrubam o crachá', async () => {
    assert.equal(await podeProduzir(produtor.id), true, 'guarda: parte de verdadeiro');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [produtor.id]);
    assert.equal(await podeProduzir(produtor.id), false, 'conta desativada não produz');
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [produtor.id]);
    assert.equal(await podeProduzir(produtor.id), true, 'e volta ao reativar (controle da reversão)');

    const orgLotacao = produtor.organization_id;
    assert.ok(orgLotacao, 'guarda: a fixture precisa ter lotação para este caso significar algo');
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgLotacao]);
    assert.equal(await podeProduzir(produtor.id), false, 'OM de lotação desativada barra a conta inteira');
    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [orgLotacao]);
    assert.equal(await podeProduzir(produtor.id), true);
  });

  it('`fn_can_see_resource` ganhou o ramo de produtor: ele VÊ o privado da própria OM sem concessão', async () => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM resource_grants WHERE grantee_id = $1', [produtor.id]
    );
    assert.equal(rows[0].n, 0, 'piso: o produtor não tem concessão nenhuma — o que ele tem é o crachá');

    assert.equal(await podeVer(produtor.id, null, recurso), true);
    // Os dois negativos do mesmo corpo: outra OM e o recurso institucional.
    assert.equal(await podeVer(produtorOutra.id, null, recurso), false);
    assert.equal(await podeVer(produtor.id, null, outroRecurso), false);
  });
  // ==========================================================================
  // A DEFINIÇÃO VIVA, por introspecção (`011_grupo_com_dono_e_producao.sql` substitui a da baseline)
  // ==========================================================================

  it('a definição VIVA de `fn_granted_resource_ids` é a da migração nova, e é UMA só', async () => {
    // O PISO É `rows.length === 1`, e ele não é formalidade: duas linhas é o modo de
    // falha de quem "redefine" acrescentando parâmetro — cria uma SOBRECARGA, e todo
    // chamador antigo continua resolvendo para o texto velho, em silêncio.
    const { rows } = await db.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'fn_granted_resource_ids'"
    );
    assert.equal(rows.length, 1, 'esperava EXATAMENTE uma definição viva da função de resolução');
    const def = rows[0].def;

    assert.match(
      def, /fn_can_produce_resource\(a\.owner_id/,
      'o braço D4 precisa reconhecer a PRODUÇÃO do dono do atlas (item 16)'
    );
    // A SEGUNDA ASSERÇÃO É A QUE DISCRIMINA: sem ela, "tem o ramo de produção" passaria
    // numa função que TROCOU um ramo pelo outro — o empréstimo do administrador teria
    // quebrado e nada ficaria vermelho.
    assert.match(
      def, /fn_has_global_data_access\(a\.owner_id/,
      'e continuar reconhecendo o papel global do dono'
    );
    assert.match(def, /fn_principal_vivo\(a\.owner_id/, 'e a vida dele no ramo de concessão');
  });

  it('`fn_user_group_ids` exige o DONO do grupo vivo (D8a), e a exigência é UMA linha', async () => {
    // A CHECAGEM MORA NO LUGAR MAIS FUNDO, e é isso que faz as três portas (leitura,
    // repasse e — depois — o eixo de grupo em atlas) fecharem juntas. Pô-la no ramo
    // coletivo de `fn_granted_resource_ids` deixaria as outras duas abertas sem erro em
    // lugar nenhum. O comportamento está medido em `access-groups-dono.test.js`; o que
    // esta introspecção prende é ONDE ela mora.
    const { rows } = await db.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'fn_user_group_ids'"
    );
    assert.equal(rows.length, 1, 'esperava exatamente uma definição de `fn_user_group_ids`');
    assert.match(rows[0].def, /fn_principal_vivo\(ag\.owner_id\)/, 'o dono do grupo precisa estar vivo');
    assert.match(rows[0].def, /deleted_at IS NULL/, 'e o grupo continua precisando não estar apagado');
  });

  // ==========================================================================
  // fn_produced_private_resource_ids — o contraponto de LISTAGEM da produção
  // ==========================================================================

  it('`fn_produced_private_resource_ids` concorda com `fn_can_produce_resource` onde as duas respondem', async () => {
    const publicoDaOm = `raf-publico-${sufixo}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, owner_org_id, access_level)
       VALUES ($1, $2, '{}'::jsonb, $3::uuid, 'public')`,
      [publicoDaOm, `Recurso ${publicoDaOm}`, orgProdutora]
    );
    try {
      const { rows } = await db.query(
        'SELECT resource_type, resource_id FROM fn_produced_private_resource_ids($1::uuid)',
        [produtor.id]
      );
      // O TAMANHO É ASSERIDO ANTES DO LAÇO: laço sobre coleção de tamanho não asserido é
      // cobertura vazia, e a regra de lint `no-unasserted-loop-assert` reprova.
      assert.ok(rows.length >= 1, `esperava >= 1 linha para o produtor, achei ${rows.length}`);
      for (const linha of rows) {
        assert.equal(
          await podeProduzir(produtor.id, linha.resource_id, linha.resource_type), true,
          `${linha.resource_type}:${linha.resource_id} saiu da listagem e o predicado escalar nega`
        );
      }
      assert.ok(
        rows.some((r) => r.resource_id === recurso && r.resource_type === TIPO),
        'o privado da OM do produtor precisa estar na lista'
      );

      // A PRIMEIRA DIVERGÊNCIA DELIBERADA, medida para não virar drift: o
      // ADMINISTRADOR recebe ZERO linhas aqui, e `fn_can_produce_resource` responde
      // true para ele sobre o MESMO recurso. Quem reusar esta função como "o que este
      // ator mantém" recebe resposta errada para admin.
      const { rows: doAdmin } = await db.query(
        'SELECT resource_type, resource_id FROM fn_produced_private_resource_ids($1::uuid)',
        [admin.id]
      );
      assert.deepEqual(doAdmin, [], 'o papel global não entra nesta listagem, de propósito');
      assert.equal(await podeProduzir(admin.id, recurso), true, 'enquanto o predicado escalar diz que sim');

      // A SEGUNDA: só o PRIVADO entra. `shareable` serve à afordância do cartão, que só
      // existe para recurso privado; listar o público seria payload sem leitor.
      assert.ok(
        !rows.some((r) => r.resource_id === publicoDaOm),
        'o recurso PÚBLICO da mesma OM fica fora: "produzido" não é "produzido e privado"'
      );
      assert.equal(
        await podeProduzir(produtor.id, publicoDaOm), true,
        'e o predicado escalar continua dizendo que ele o mantém — a divergência é de escopo'
      );

      // E o produtor de OUTRA OM não recebe nada desta OM.
      const { rows: daOutra } = await db.query(
        'SELECT resource_id FROM fn_produced_private_resource_ids($1::uuid)',
        [produtorOutra.id]
      );
      assert.ok(
        !daOutra.some((r) => r.resource_id === recurso),
        'produtor de outra OM não lista o acervo alheio'
      );
    } finally {
      await db.query('DELETE FROM tilesets WHERE id = $1', [publicoDaOm]);
    }
  });

  it('`fn_produced_private_resource_ids` morre com a conta e com a OM de lotação', async () => {
    // O MESMO LIVENESS DO PREDICADO ESCALAR, e ele precisa estar aqui porque esta função
    // NÃO o chama: ela repete a condição, e duas cópias de uma regra divergem na próxima
    // edição. O piso é a lista não-vazia; a discriminação é a volta ao reativar.
    const cheia = await db.query(
      'SELECT resource_id FROM fn_produced_private_resource_ids($1::uuid)', [produtor.id]
    );
    assert.ok(cheia.rows.length >= 1, 'piso: parte de uma lista não-vazia');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [produtor.id]);
    const vazia = await db.query(
      'SELECT resource_id FROM fn_produced_private_resource_ids($1::uuid)', [produtor.id]
    );
    assert.deepEqual(vazia.rows, [], 'conta desativada não lista nada');

    await db.query('UPDATE users SET is_active = true WHERE id = $1', [produtor.id]);
    const devolta = await db.query(
      'SELECT resource_id FROM fn_produced_private_resource_ids($1::uuid)', [produtor.id]
    );
    assert.equal(devolta.rows.length, cheia.rows.length, 'e volta ao reativar (controle da reversão)');

    // O anônimo não lista nada, e não levanta.
    const { rows: anonimo } = await db.query(
      'SELECT resource_id FROM fn_produced_private_resource_ids($1::uuid)', [null]
    );
    assert.deepEqual(anonimo, []);
  });

  // ==========================================================================
  // A OM PRODUTORA TAMBÉM PRECISA ESTAR VIVA (2026-08-21)
  // ==========================================================================

  it('a OM PRODUTORA desativada corta a produção, e a de LOTAÇÃO continua sendo outro ramo', async () => {
    // O DEFEITO, MEDIDO ANTES DE ESCRITO: as duas funções conferiam a vida da conta e a da
    // OM de LOTAÇÃO (`users.organization_id`), nunca a da OM PRODUTORA
    // (`users.producer_org_id`). Como as duas colunas podem apontar para organizações
    // diferentes, desativar a OM produtora deixava o acervo privado dela sendo mantido,
    // marcado público/privado e listado como repassável.
    //
    // O CASO (c) É O QUE IMPEDE O TESTE DE PASSAR POR CORTE GERAL: o ramo de lotação, que
    // já existia, não pode mudar de cor. Sem ele, uma função que devolvesse `false` para
    // todo produtor ficaria verde nos casos (a) e (b).
    assert.equal(await podeProduzir(produtor.id), true, 'PISO (a): produtora ativa, produz');

    // A LOTAÇÃO VIRA UMA OM ATIVA E DIFERENTE DA PRODUTORA. É o que separa os dois ramos:
    // com lotação nula, o vermelho de (b) seria indistinguível do ramo antigo.
    await db.query('UPDATE users SET organization_id = $2::uuid WHERE id = $1', [produtor.id, orgOutra]);
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1::uuid', [orgProdutora]);
    try {
      assert.equal(
        await podeProduzir(produtor.id), false,
        '(b) produtora INATIVA com lotação ativa: não produz'
      );
      const { rows } = await db.query(
        'SELECT resource_id FROM fn_produced_private_resource_ids($1::uuid)', [produtor.id]
      );
      assert.deepEqual(rows, [], '(b) e a LISTAGEM concorda — as duas repetem a condição');
    } finally {
      await db.query('UPDATE organizations SET is_active = true WHERE id = $1::uuid', [orgProdutora]);
    }

    assert.equal(await podeProduzir(produtor.id), true, 'controle da reversão: reativar devolve');

    // (c) O RAMO ANTIGO NÃO PODE TER MUDADO DE COR: lotação inativa, produtora ativa,
    // continua não produzindo (é liveness, e sempre foi).
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1::uuid', [orgOutra]);
    try {
      assert.equal(
        await podeProduzir(produtor.id), false,
        '(c) lotação INATIVA com produtora ativa: continua sem produzir'
      );
    } finally {
      await db.query('UPDATE organizations SET is_active = true WHERE id = $1::uuid', [orgOutra]);
      await db.query('UPDATE users SET organization_id = NULL WHERE id = $1', [produtor.id]);
    }

    assert.equal(await podeProduzir(produtor.id), true, 'e o piso volta ao fim do caso');
  });

  it('o ADMINISTRADOR não é trancado fora pela checagem nova da OM produtora', async () => {
    // A checagem entra DEPOIS do early return de papel, e este caso é quem cobra isso: um
    // administrador não tem `producer_org_id`, então uma checagem posta no SELECT inicial o
    // deixaria de fora do gate de manutenção do catálogo inteiro, em silêncio.
    assert.equal(await podeProduzir(admin.id), true, 'o administrador mantém qualquer recurso');
    assert.equal(
      await podeProduzir(admin.id, outroRecurso), true,
      'inclusive o institucional, que não tem OM dona'
    );
  });

  // ==========================================================================
  // `fn_is_global_admin` — o sítio de papel global que o censo de papel NÃO alcança
  // ==========================================================================

  it('`fn_is_global_admin` pergunta por UM papel, e ele é `admin`', async () => {
    // POR QUE INTROSPECÇÃO E NÃO SÓ COMPORTAMENTO. O censo de papel global
    // (`tests/unit/papel-global-censo.test.js`) varre `.js`, e este sítio nasceu em SQL de
    // propósito (em JavaScript ele seria papel lido do token, que `flexibleAuth` não
    // reconcilia). A afirmação que aquele censo faz sobre si mesmo — "sítio novo reprova
    // até ser classificado" — deixou de valer para a metade SQL no mesmo commit em que a
    // onda escolheu SQL. Esta asserção é o que cobre o buraco: CONTAGEM de literais, não
    // `includes`, porque `includes('admin')` continuaria verde numa função que aceitasse
    // `admin` E `credenciado`.
    const { rows } = await db.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'fn_is_global_admin'"
    );
    assert.equal(rows.length, 1, 'esperava EXATAMENTE uma definição de `fn_is_global_admin`');
    const def = rows[0].def;
    const papeis = def.match(/'(user|producer|credenciado|admin)'/g) ?? [];
    assert.deepEqual(papeis, ["'admin'"], 'um literal de papel, e ele é `admin`');
    assert.match(def, /is_active/, 'e o liveness continua lá (senão "só admin" seria de graça)');

    // A DISCRIMINAÇÃO: a função IRMÃ do eixo de DADO continua com DOIS papéis. Sem ela,
    // esta suíte passaria verde num mundo em que alguém tivesse estreitado as duas.
    const { rows: dados } = await db.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'fn_has_global_data_access'"
    );
    const papeisDoDado = dados[0].def.match(/'(user|producer|credenciado|admin)'/g) ?? [];
    assert.deepEqual(
      [...papeisDoDado].sort(), ["'admin'", "'credenciado'"],
      'ler todo recurso privado e administrar o sistema são poderes diferentes'
    );
  });

  it('COMPORTAMENTO — `fn_is_global_admin` recusa o credenciado e o produtor', async () => {
    const ehAdminGlobal = async (userId) => (await db.query(
      'SELECT fn_is_global_admin($1::uuid) AS ok', [userId]
    )).rows[0].ok;
    assert.equal(await ehAdminGlobal(admin.id), true, 'piso');
    assert.equal(await ehAdminGlobal(credenciado.id), false, 'ler tudo não é mandar em tudo');
    assert.equal(await ehAdminGlobal(produtor.id), false, 'manter não é mandar');
    assert.equal(await ehAdminGlobal(estranho.id), false);
    assert.equal(await ehAdminGlobal(null), false, 'o anônimo não levanta');
  });

});
