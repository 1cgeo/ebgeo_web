// Path: tests/integration/atlas-emprestimo-nomeia-recurso.test.js
//
// A LISTA DO QUE UM ATLAS EMPRESTA NOMEIA CADA ITEM (cláusula 6.6).
//
// POR QUE ESTE ARQUIVO EXISTE. A cláusula 6.6 da CONSTITUICAO.md (aberta em 2026-08-29)
// decide o empréstimo ao visitante de link público por CONSENTIMENTO INFORMADO: o
// empréstimo é mantido, e o que resolve é a tela NOMEAR, no instante da ativação do link,
// os recursos PRIVADOS que aquele atlas empresta. `GET /atlas/:atlasId/resources`
// devolvia `{ id, resource_type, resource_id, added_by, added_at, added_by_username }`, e
// com isso a tela não tem como nomear nada: `resource_id` é slug (ou UUID, no 360) e nada
// ali diz se o item é público ou privado. `name` e `access_level` são esses dois campos.
//
// O QUE ELE MEDE, e cada caso existe porque o defeito correspondente passaria verde:
//
//   1. O PAR COMPLETO, privado E público, no MESMO atlas. Só o privado seria vácuo: uma
//      consulta que carimbasse `'private'` em tudo passaria. Só o público, idem ao
//      contrário. É o par que prova que a coluna vem da LINHA e não do código.
//   2. TRÊS TABELAS DIFERENTES numa listagem só (`data_layer`, `tileset`, `sv360_project`),
//      porque `atlas_resources.resource_type` aponta para cinco vocabulários e a união
//      despacha por tipo. O 360 é o ramo que mais quebra: chave UUID contra o TEXT de
//      `atlas_resources.resource_id`.
//   3. O ÓRFÃO, nas DUAS formas. Um empréstimo cuja linha de catálogo não existe mais
//      volta com `name`/`access_level` nulos e CONTINUA NA LISTA. Um `JOIN` interno o
//      faria sumir, e sumir esconde um empréstimo VIVO — o oposto do que a cláusula quer.
//      A segunda forma é o órfão de tipo `sv360_project` com `resource_id` que NÃO é UUID:
//      ela é o controle de que a junção compara `id::text`, e não `resource_id::uuid`, que
//      levantaria `22P02` e derrubaria a listagem inteira.
//   4. A DISCRIMINAÇÃO POR TIPO: dois recursos de tipos diferentes com o MESMO id, um
//      privado e um público. Uma junção escrita só por `resource_id` casaria os dois e
//      escolheria um nome ao acaso; ela é a forma mais fácil de escrever esta consulta
//      errado, e sem este caso ela passaria verde nos outros três.
//   5. OS CAMPOS ANTIGOS CONTINUAM LÁ. O cliente já consome os seis, e o enunciado da
//      mudança é "acrescenta", nunca "troca".
//
// O QUE ELE NÃO MEDE, e precisa estar escrito: o gate. Que a rota siga sendo `auth`
// estrito mais `requireAtlasPermission('read')` é do censo de superfícies
// (`tests/unit/superficies-de-recurso-censo.test.js`, varredura 2), que compara a
// declaração da rota com o gate declarado. Aqui todo pedido é do DONO do atlas.
//
// A ORDEM DE LIMPEZA NO `after` NÃO É ESTILO. `resource_grants.grantee_id`/`granted_by` e
// `atlas_resources.added_by` são FK sem `ON DELETE`: apagar as contas primeiro derruba a
// limpeza inteira com violação de chave estrangeira, o que aparece como o describe PAI
// vermelho com todos os casos verdes e não se parece nada com o assunto do arquivo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

describe('6.6 — o que o atlas empresta sai NOMEADO, com o nível de acesso', () => {
  let app, db, dono, tokenDono, atlas, orgId, projeto360;

  // O id COMPARTILHADO entre dois tipos: é ele que prova que a junção é por (tipo, id).
  const idHomonimo = `homonimo-${SFX}`;
  const idPrivado = `emp-priv-${SFX}`;
  const idPublico = `emp-pub-${SFX}`;
  const idOrfao = `emp-orfao-${SFX}`;
  const orfao360 = `nao-e-uuid-${SFX}`;

  /** A lista da rota, indexada por (tipo, id), que é a chave real do vínculo. */
  const listar = async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .expect(200);
    return new Map(res.body.data.map((i) => [`${i.resource_type}:${i.resource_id}`, i]));
  };

  /** Empresta direto no banco: é o único caminho que consegue criar o ÓRFÃO. */
  const emprestar = (tipo, id) => db.query(
    `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
     VALUES ($1::uuid, $2, $3, $4::uuid)`,
    [atlas.id, tipo, id, dono.id]
  );

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `emp_nome_dono_${SFX}` });
    tokenDono = await loginUser(app, dono.username, dono.password);
    atlas = await createAtlas(db, dono.id, { name: `Atlas 6.6 ${SFX}` });

    const { rows: orgs } = await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM 6.6 ${SFX}`, `om-66-${SFX}`, `O66${SFX.slice(0, 3)}`]
    );
    orgId = orgs[0].id;

    // A CAMADA PRIVADA e a CAMADA PÚBLICA: o par que a cláusula obriga a distinguir.
    await db.query(
      `INSERT INTO data_layers (id, name, access_level, config)
       VALUES ($1, $2, 'private', '{}'::jsonb), ($3, $4, 'public', '{}'::jsonb)`,
      [idPrivado, `Camada reservada ${SFX}`, idPublico, `Camada aberta ${SFX}`]
    );
    // O HOMÔNIMO: mesmo id, tipos diferentes, níveis OPOSTOS. Os níveis precisam ser
    // opostos, senão uma junção só por id devolveria o mesmo valor e o caso seria vácuo.
    await db.query(
      `INSERT INTO tilesets (id, name, access_level, config) VALUES ($1, $2, 'public', '{}'::jsonb)`,
      [idHomonimo, `Modelo aberto ${SFX}`]
    );
    await db.query(
      `INSERT INTO analysis_layers (id, name, access_level, config)
       VALUES ($1, $2, 'private', '{}'::jsonb)`,
      [idHomonimo, `Analise reservada ${SFX}`]
    );
    // O 360, cuja chave é UUID: o ramo da união que o `::text` existe para salvar.
    const { rows: projs } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, access_level)
       VALUES ($1::uuid, $2, $3, $4, 'private') RETURNING id`,
      [orgId, `proj-66-${SFX}`, `Projeto 360 reservado ${SFX}`, `proj-66-${SFX}_tiles.db`]
    );
    projeto360 = projs[0].id;

    // O DONO ALCANÇA A PRIVADA por concessão própria: é isso que sustenta o empréstimo
    // (braço D4 de `fn_granted_resource_ids`). Sem ela, todo caso abaixo mediria a lista
    // de um empréstimo MORTO, que é um caso mais raro e não o que a cláusula 6.6 endereça.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('data_layer', $1, $2::uuid, 'view', $2::uuid)`,
      [idPrivado, dono.id]
    );

    await emprestar('data_layer', idPrivado);
    await emprestar('data_layer', idPublico);
    await emprestar('tileset', idHomonimo);
    await emprestar('sv360_project', projeto360);
    await emprestar('analysis_layer', idOrfao);
    await emprestar('sv360_project', orfao360);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE atlas_id = $1::uuid', [atlas.id]);
    await db.query('DELETE FROM audit_trail WHERE actor_id = $1::uuid', [dono.id]);
    // AS CONCESSÕES E OS EMPRÉSTIMOS ANTES DAS CONTAS: ver o cabeçalho.
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[idPrivado]]);
    await db.query('DELETE FROM data_layers WHERE id = ANY($1::text[])', [[idPrivado, idPublico]]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [idHomonimo]);
    await db.query('DELETE FROM analysis_layers WHERE id = $1', [idHomonimo]);
    await db.query('DELETE FROM sv360.projects WHERE id = $1::uuid', [projeto360]);
    await db.query('DELETE FROM atlas WHERE id = $1::uuid', [atlas.id]);
    await db.query('DELETE FROM users WHERE id = $1::uuid', [dono.id]);
    await db.query('DELETE FROM organizations WHERE id = $1::uuid', [orgId]);
    await teardownTestEnv(db);
  });

  it('piso: a listagem devolve os SEIS empréstimos, e a fixture não se desfez', async () => {
    // Sem este caso, todo `deepEqual` sobre um item ausente viraria "undefined não tem
    // name", que é a mensagem de uma fixture quebrada lida como regressão de código.
    const itens = await listar();
    assert.equal(itens.size, 6, 'os seis empréstimos precisam estar na lista');
    for (const chave of [
      `data_layer:${idPrivado}`, `data_layer:${idPublico}`, `tileset:${idHomonimo}`,
      `sv360_project:${projeto360}`, `analysis_layer:${idOrfao}`, `sv360_project:${orfao360}`,
    ]) {
      assert.ok(itens.has(chave), `faltou o empréstimo ${chave}`);
    }
  });

  it('O PAR: o privado sai nomeado e marcado `private`; o público, nomeado e `public`', async () => {
    const itens = await listar();

    const privado = itens.get(`data_layer:${idPrivado}`);
    assert.equal(privado.name, `Camada reservada ${SFX}`);
    assert.equal(privado.access_level, 'private');

    const publico = itens.get(`data_layer:${idPublico}`);
    assert.equal(publico.name, `Camada aberta ${SFX}`);
    assert.equal(publico.access_level, 'public');

    // A METADE QUE FAZ O PAR VALER: os dois vêm da MESMA tabela e do MESMO atlas, então
    // a única coisa que os separa é a coluna da linha. Uma consulta que carimbasse um
    // valor fixo passaria em qualquer um dos dois sozinho e reprova aqui.
    assert.notEqual(privado.access_level, publico.access_level);
    assert.notEqual(privado.name, publico.name);
  });

  it('o 360, de chave UUID, sai nomeado pelo MESMO caminho das tabelas de catálogo', async () => {
    const item = (await listar()).get(`sv360_project:${projeto360}`);
    assert.equal(item.name, `Projeto 360 reservado ${SFX}`);
    assert.equal(item.access_level, 'private');
  });

  it('O ÓRFÃO CONTINUA NA LISTA, com `name` e `access_level` nulos', async () => {
    // Esconder o órfão esconderia um empréstimo VIVO: a linha de `atlas_resources` segue
    // de pé, segue contando em `ATLASES_LENDING_RESOURCE` e é justamente o vínculo que
    // quem administra o atlas precisa ver para desfazer.
    const item = (await listar()).get(`analysis_layer:${idOrfao}`);
    assert.ok(item, 'o empréstimo órfão não pode sumir da lista');
    assert.equal(item.name, null);
    assert.equal(item.access_level, null);
    // E ele continua identificável: sem estes dois, "está na lista" seria uma linha muda.
    assert.equal(item.resource_type, 'analysis_layer');
    assert.equal(item.resource_id, idOrfao);
  });

  it('o órfão de 360 com id que NÃO é UUID também volta nulo, e não derruba a consulta', async () => {
    // O CONTROLE DO CAST. `atlas_resources.resource_id` é TEXT e a chave do 360 é UUID.
    // Escrita como `r.id = ar.resource_id::uuid`, a junção levantaria `22P02` e a rota
    // inteira responderia 500 — e responderia por causa de UMA linha suja. A união casa
    // `id::text` dos dois lados, então o não-UUID simplesmente não encontra par.
    const itens = await listar();
    const item = itens.get(`sv360_project:${orfao360}`);
    assert.ok(item, 'a linha com id fora do formato precisa aparecer, não explodir');
    assert.equal(item.name, null);
    assert.equal(item.access_level, null);
    // E ela não pode contaminar as outras: a listagem inteira continua respondendo.
    assert.equal(itens.size, 6);
  });

  it('DISCRIMINAÇÃO: mesmo id em dois tipos não se confunde — a junção é por (tipo, id)', async () => {
    // `tilesets` e `analysis_layers` carregam o MESMO id, com níveis opostos. Só o
    // `tileset` está emprestado, então uma junção escrita por `resource_id` sozinho
    // devolveria dois candidatos e poderia trazer o nome e o nível da OUTRA tabela.
    const itens = await listar();
    const item = itens.get(`tileset:${idHomonimo}`);
    assert.equal(item.name, `Modelo aberto ${SFX}`);
    assert.equal(item.access_level, 'public');
    assert.ok(
      !itens.has(`analysis_layer:${idHomonimo}`),
      'o homônimo NÃO emprestado não pode aparecer: senão a junção multiplicou linhas'
    );
  });

  it('os campos ANTIGOS continuam todos lá: a mudança acrescenta, não troca', async () => {
    // O cliente já consome os seis. Renomear ou remover qualquer um quebraria a tela sem
    // que nada mais neste arquivo ficasse vermelho.
    const item = (await listar()).get(`data_layer:${idPrivado}`);
    assert.deepEqual(
      Object.keys(item).sort(),
      ['access_level', 'added_at', 'added_by', 'added_by_username', 'id', 'name',
        'resource_id', 'resource_type'].sort(),
      'a forma do item mudou: os seis campos antigos mais `name` e `access_level`'
    );
    assert.equal(item.added_by, dono.id);
    assert.equal(item.added_by_username, dono.username);
    assert.ok(item.added_at, 'a data do empréstimo precisa continuar viajando');
    assert.ok(item.id, 'e o id da própria linha de empréstimo, que é o que a tela remove');
  });
});
