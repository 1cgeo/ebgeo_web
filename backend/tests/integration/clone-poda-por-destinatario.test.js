// Path: tests/integration/clone-poda-por-destinatario.test.js
// A PODA DO CLONE É POR DESTINATÁRIO, e é isso que a separa da poda de saída.
//
// O clone FICA no servidor, onde o predicado continua valendo a cada leitura. Logo a
// pergunta certa não é "isto é privado?" (a do `.ebgeo`, onde não há mais ponto de
// imposição), e sim "o NOVO DONO vê isto?". A diferença é medível e o caso que a mede é o
// terceiro abaixo: um recurso privado a que o clonador tem concessão própria SOBREVIVE.
// Sem ele, o podador do servidor poderia ser o de saída — apagando todo privado — e passar.
//
// A QUARTA SITUAÇÃO é a decisão de projeto que mais custa se for esquecida: o recurso que a
// ORIGEM empresta pelo `atlas_resources` dela. O clone não copia empréstimos, então
// classificar com o atlas de origem em foco faria a cópia nascer enxergando o emprestado e
// deixar de enxergar depois, sem ninguém ter revogado nada. Por isso o atlas da
// classificação é NULO, e o controle negativo desta decisão está anotado no último caso.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { classifyResourceRefs } from '../../src/modules/resource-access/resource-access.service.js';

const SFX = randomUUID().slice(0, 8);

const PUBLICO = `pub-${SFX}`;
const SO_DE_A = `soa-${SFX}`;
const CONCEDIDO_A_B = `conc-${SFX}`;
const EMPRESTADO = `empr-${SFX}`;
const DL_PUBLICO = `dlpub-${SFX}`;
const DL_PRIVADO = `dlpriv-${SFX}`;

describe('clone: a cópia perde o que o NOVO DONO não vê', () => {
  let app, db, dono, benef, tokenB, atlas, mapa, atlas2, mapa2, orgId, projeto360Publico;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `cpd_a_${SFX}` });
    benef = await createUser(db, { username: `cpd_b_${SFX}` });
    tokenB = await loginUser(app, benef.username, benef.password);

    for (const [id, nivel] of [[PUBLICO, 'public'], [SO_DE_A, 'private'],
      [CONCEDIDO_A_B, 'private'], [EMPRESTADO, 'private']]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{}'::jsonb, 0, $3)`,
        [id, `Tileset ${id}`, nivel]
      );
    }

    // AS DUAS CONCESSÕES PESSOAIS, uma para cada ator, e é a assimetria delas que faz a
    // poda ser POR DESTINATÁRIO em vez de "todo privado sai": o MESMO atlas de origem
    // produz cópias DIFERENTES para A e para B.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level,
                                    granted_by, expires_at)
       VALUES ('tileset', $1, $2, 'view', $3, NOW() + INTERVAL '30 days'),
              ('tileset', $4, $5, 'view', $3, NOW() + INTERVAL '30 days'),
              ('tileset', $6, $5, 'view', $3, NOW() + INTERVAL '30 days')`,
      [CONCEDIDO_A_B, benef.id, dono.id, SO_DE_A, dono.id, EMPRESTADO]
    );
    // A TERCEIRA concessão é o que torna o empréstimo REAL: o braço D4 de
    // `fn_granted_resource_ids` empresta enquanto o DONO DO ATLAS vir o recurso, então um
    // `atlas_resources` sobre um recurso que o dono não alcança não empresta nada — e um
    // empréstimo inerte faria o controle negativo do último caso passar verde sem medir
    // decisão nenhuma.

    atlas = await createAtlas(db, dono.id, { name: `CPD origem ${SFX}` });
    mapa = await createMap(db, atlas.id, { name: 'Origem' });

    // O EMPRÉSTIMO DO ATLAS DE ORIGEM: é ele que a cópia não pode herdar.
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, 'tileset', $2, $3)`,
      [atlas.id, EMPRESTADO, dono.id]
    );

    for (const id of [PUBLICO, SO_DE_A, CONCEDIDO_A_B, EMPRESTADO]) {
      await db.query(
        `INSERT INTO cesium3d_data (map_id, data_type, tileset_id, data)
         VALUES ($1, 'marker', $2, '{"t":1}'::jsonb)`,
        [mapa.id, id]
      );
    }

    // B precisa poder LER o atlas de origem para clonar (o gate da rota é `read`).
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
       VALUES ($1, $2, 'read', $3)`,
      [atlas.id, benef.id, dono.id]
    );

    // ---------------------------------------------------------------------------------
    // O SEGUNDO ATLAS existe para não mexer nas contagens do primeiro (o `pruneReport` dele
    // é asserido por extenso). Ele carrega as DUAS superfícies que o primeiro não toca:
    // `atlas.settings` e uma camada de catálogo em forma LEGADA.
    // ---------------------------------------------------------------------------------
    for (const [id, nivel] of [[DL_PUBLICO, 'public'], [DL_PRIVADO, 'private']]) {
      await db.query(
        `INSERT INTO data_layers (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{}'::jsonb, 0, $3)`,
        [id, `Camada ${id}`, nivel]
      );
    }

    atlas2 = await createAtlas(db, dono.id, { name: `CPD settings ${SFX}` });
    mapa2 = await createMap(db, atlas2.id, { name: 'Settings' });

    // O PROJETO 360 PÚBLICO existe só para a sexta lista: sem um id que o destinatário
    // ENXERGUE, a perna de `available_360_views` só poderia ser medida pela negativa — e uma
    // perna de SQL que não colhe nada produz exatamente o mesmo resultado que uma que colhe
    // e reprova, porque a classificação ausente fecha fechado. Sem o id público, o caso não
    // distinguiria "a perna funciona" de "a perna nunca rodou".
    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM CPD ${SFX}`, `om-cpd-${SFX}`, 'CPD']
    );
    orgId = orgs[0].id;
    const { rows: projs } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'public', -22.9, -43.2, 0) RETURNING id`,
      [orgId, `cpd-${SFX}`, `Projeto CPD ${SFX}`, `${orgId}__cpd-${SFX}.db`]
    );
    projeto360Publico = projs[0].id;

    // AS SEIS LISTAS DE `atlas.settings`, cada uma com pelo menos um id que o destinatário
    // ENXERGA: é a metade positiva que prova que cada perna da coleta SQL existe e casa. Duas
    // delas levam também um id restrito, que é a metade negativa.
    // (`osm`, `carta-topografica` e `declividade` são semeados públicos por `005_catalogo.sql`.)
    await db.query(
      `UPDATE atlas SET settings = settings || $2::jsonb WHERE id = $1`,
      [atlas2.id, JSON.stringify({
        basemaps: ['osm', 'carta-topografica'],
        default_basemap: 'osm',
        available_analysis_layers: ['declividade'],
        available_360_views: [projeto360Publico],
        available_3d_models: [PUBLICO, SO_DE_A],
        available_data_layers: [DL_PRIVADO],
        features: { map_3d: true, data_layers: true, analysis_layers: true },
      })]
    );

    // AS DUAS CAMADAS EM FORMA LEGADA: id SEM prefixo, referência em `originalId`. É a
    // forma que o documento pré-F11 produz, e a que a coleta do clone deixava de enxergar.
    for (const [sufixo, alvo] of [['pub', DL_PUBLICO], ['priv', DL_PRIVADO]]) {
      await db.query(
        `INSERT INTO catalog_layers (id, map_id, data)
         VALUES ($1, $2, $3::jsonb)`,
        [`legado-${sufixo}-${SFX}`, mapa2.id,
          JSON.stringify({ type: 'data_layer', originalId: alvo, visible: true })]
      );
    }

    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
       VALUES ($1, $2, 'read', $3)`,
      [atlas2.id, benef.id, dono.id]
    );
  });

  after(async () => {
    // As tabelas de catalogo sao COMPARTILHADAS pela suite inteira, e ha casos que comparam
    // a lista INTEIRA de tilesets entre um admin e um usuario comum: uma linha PRIVADA
    // deixada para tras reprova la, longe da causa.
    const ids = [PUBLICO, SO_DE_A, CONCEDIDO_A_B, EMPRESTADO, DL_PUBLICO, DL_PRIVADO];
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM data_layers WHERE id = ANY($1::text[])', [ids]);
    if (projeto360Publico) {
      await db.query('DELETE FROM sv360.projects WHERE id = $1', [projeto360Publico]);
    }
    await teardownTestEnv(db);
  });

  const tilesetsDoAtlas = async (atlasId) => {
    const { rows } = await db.query(
      `SELECT c.tileset_id FROM cesium3d_data c
         JOIN maps m ON m.id = c.map_id
        WHERE m.atlas_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.tileset_id`,
      [atlasId]
    );
    return rows.map((r) => r.tileset_id);
  };

  /** Os ids de recurso que as camadas de catálogo de um atlas referenciam. */
  const camadasDoAtlas = async (atlasId) => {
    const { rows } = await db.query(
      `SELECT cl.data->>'originalId' AS ref FROM catalog_layers cl
         JOIN maps m ON m.id = cl.map_id
        WHERE m.atlas_id = $1 AND cl.deleted_at IS NULL
        ORDER BY ref`,
      [atlasId]
    );
    return rows.map((r) => r.ref);
  };

  it('PISO: a origem carrega as quatro situações e empresta pelo menos um recurso', async () => {
    // Sem este piso, uma origem vazia passaria a poda com louvor e as asserções de "sumiu"
    // não provariam nada.
    assert.deepEqual(await tilesetsDoAtlas(atlas.id),
      [CONCEDIDO_A_B, EMPRESTADO, PUBLICO, SO_DE_A].sort());

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM atlas_resources WHERE atlas_id = $1`, [atlas.id]
    );
    assert.ok(rows[0].n >= 1, 'a origem precisa emprestar ao menos um recurso');
  });

  it('o clone de B mantém o público e o CONCEDIDO A ELE, e perde os outros dois', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({})
      .expect(201);

    const clone = res.body.data.id;
    const sobreviventes = await tilesetsDoAtlas(clone);

    // A DISCRIMINAÇÃO INTEIRA numa asserção: se o podador apagasse todo privado, o
    // concedido cairia; se não podasse nada, os outros dois ficariam.
    assert.deepEqual(sobreviventes, [CONCEDIDO_A_B, PUBLICO].sort());

    // E o clone não herda empréstimo nenhum: o `atlas_resources` da origem não é copiado.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM atlas_resources WHERE atlas_id = $1`, [clone]
    );
    assert.equal(rows[0].n, 0);

    // O relatório conta por SUPERFÍCIE e não carrega id nem nome.
    assert.deepEqual(res.body.data.pruneReport, { 'cesium3d.markers': 2 });
    assert.ok(!JSON.stringify(res.body.data.pruneReport).includes(SO_DE_A));
  });

  it('a ORIGEM não é tocada: podar a cópia não pode podar quem foi copiado', async () => {
    assert.deepEqual(await tilesetsDoAtlas(atlas.id),
      [CONCEDIDO_A_B, EMPRESTADO, PUBLICO, SO_DE_A].sort());
  });

  it('DISCRIMINAÇÃO: o MESMO atlas dá cópias DIFERENTES para A e para B', async () => {
    // É o caso que separa "poda por destinatário" de "poda de todo privado" pelo outro lado.
    // A vê `SO_DE_A` e não vê `CONCEDIDO_A_B`; B, o inverso. Um podador que apagasse todo
    // privado devolveria a MESMA lista para os dois, e esta asserção é a única que nota.
    const tokenA = await loginUser(app, dono.username, dono.password);
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(201);

    // A leva o que ELE alcança por concessão própria (`SO_DE_A` e `EMPRESTADO`); B leva o
    // que ELE alcança (`CONCEDIDO_A_B`). Nenhuma das duas listas é a outra.
    assert.deepEqual(await tilesetsDoAtlas(res.body.data.id),
      [EMPRESTADO, PUBLICO, SO_DE_A].sort());
  });

  it('o classificador responde o MESMO fora de transação, e é assim que o próximo chamador o usa', async () => {
    // O CAMINHO QUE O CLONE NÃO EXERCITA. `classifyResourceRefs` aceita o contexto de
    // transação para poder rodar dentro do `tx` do clone (classificar fora e escrever dentro
    // deixaria uma janela em que uma revogação concorrente produziria uma cópia com o recurso
    // que ela acabou de tirar), mas o argumento é OPCIONAL: sem ele a consulta sai pelo pool.
    // Todo chamador futuro que não seja uma cópia de entidade inteira vai entrar por aí, e
    // até aqui nenhum teste passava por esse braço.
    //
    // O caso também mede o predicado SEM a rota no meio, que é o que separa "o clone podou"
    // de "o classificador respondeu certo".
    const refs = [
      { type: 'tileset', resourceId: PUBLICO },
      { type: 'tileset', resourceId: SO_DE_A },
      { type: 'tileset', resourceId: CONCEDIDO_A_B },
      { type: 'tileset', resourceId: EMPRESTADO },
    ];
    const chave = (id) => `tileset\u0000${id}`;

    const paraB = await classifyResourceRefs({ userId: benef.id, refs });
    assert.equal(paraB.size, 4, 'PISO: uma resposta por referência, sem transação');
    assert.deepEqual(
      [...paraB.entries()].filter(([, ok]) => ok).map(([k]) => k).sort(),
      [chave(PUBLICO), chave(CONCEDIDO_A_B)].sort()
    );

    // DISCRIMINAÇÃO: o MESMO conjunto, outro ator, outra resposta. Sem ela, "quatro linhas"
    // passaria idêntico num classificador que respondesse `true` (ou `false`) para todo mundo.
    const paraA = await classifyResourceRefs({ userId: dono.id, refs });
    assert.deepEqual(
      [...paraA.entries()].filter(([, ok]) => ok).map(([k]) => k).sort(),
      [chave(PUBLICO), chave(SO_DE_A), chave(EMPRESTADO)].sort()
    );

    // E o ANÔNIMO (sem principal) alcança só o público: o braço de concessão morre com ele.
    const anonimo = await classifyResourceRefs({ userId: null, refs });
    assert.deepEqual(
      [...anonimo.entries()].filter(([, ok]) => ok).map(([k]) => k),
      [chave(PUBLICO)]
    );
  });

  it('as ALLOWLISTS de `atlas.settings` perdem o restrito, e a origem não muda', async () => {
    // A DÉCIMA SEGUNDA SUPERFÍCIE, e a que um inventário por NOME DE CAMPO não enxergava:
    // `settings` carrega seis listas de id de catálogo e o clone as copiava VERBATIM. Um
    // destinatário sem concessão nenhuma recebia a identidade de tileset e de camada
    // privados por `GET /atlas/:id` e `GET /atlas/:id/settings`, no MESMO objeto em que o
    // `pruneReport` dizia que nada tinha sido podado.
    const antes = (await db.query('SELECT settings FROM atlas WHERE id = $1', [atlas2.id])).rows[0].settings;
    assert.deepEqual(antes.available_3d_models, [PUBLICO, SO_DE_A], 'PISO: a origem lista os dois');
    assert.deepEqual(antes.available_data_layers, [DL_PRIVADO], 'PISO: e a lista que vai esvaziar');
    assert.deepEqual(antes.basemaps, ['osm', 'carta-topografica'], 'PISO: as seis listas povoadas');
    assert.equal(antes.default_basemap, 'osm');

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas2.id}/clone`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({})
      .expect(201);

    const depois = (await db.query('SELECT settings FROM atlas WHERE id = $1', [res.body.data.id])).rows[0].settings;
    assert.deepEqual(depois.available_3d_models, [PUBLICO], 'o restrito sai, o público fica');

    // A ARMADILHA DA LISTA VAZIA: `[]` significa SEM RESTRIÇÃO, então podar até zero e
    // parar ali ALARGARIA a cópia. O que a poda faz é desligar a CATEGORIA.
    assert.deepEqual(depois.available_data_layers, []);
    assert.equal(depois.features.data_layers, false);
    // DISCRIMINAÇÃO no mesmo objeto: a categoria que ninguém podou continua ligada. Sem
    // esta linha, um podador que zerasse `features` inteiro passaria acima.
    assert.equal(depois.features.analysis_layers, true);
    assert.equal(depois.features.map_3d, true);

    // AS QUATRO PERNAS RESTANTES DA COLETA SQL, pela METADE POSITIVA. Uma perna que não
    // colhesse nada produziria o mesmo efeito de uma que colhesse e reprovasse (a
    // classificação ausente fecha fechado), então só a sobrevivência do id PÚBLICO
    // distingue "a perna existe" de "a perna nunca rodou". É aqui que uma quebra de SQL
    // apareceria como um atlas que perde a camada de base padrão ao ser clonado.
    assert.deepEqual(depois.basemaps, ['osm', 'carta-topografica']);
    assert.equal(depois.default_basemap, 'osm');
    assert.deepEqual(depois.available_analysis_layers, ['declividade']);
    assert.deepEqual(depois.available_360_views, [projeto360Publico]);
    for (const superficie of ['settings.basemaps', 'settings.default_basemap',
      'settings.available_analysis_layers', 'settings.available_360_views']) {
      assert.equal(res.body.data.pruneReport[superficie], undefined,
        `${superficie} não pode aparecer no relatório: nada dela foi podado`);
    }

    // O relatório NOMEIA a superfície e conta — nunca o id.
    assert.equal(res.body.data.pruneReport['settings.available_3d_models'], 1);
    assert.equal(res.body.data.pruneReport['settings.available_data_layers'], 1);
    assert.ok(!JSON.stringify(res.body.data.pruneReport).includes(SO_DE_A));

    // E A ORIGEM NÃO MUDA: podar a cópia não pode podar quem foi copiado.
    const origemDepois = (await db.query('SELECT settings FROM atlas WHERE id = $1', [atlas2.id])).rows[0].settings;
    assert.deepEqual(origemDepois.available_3d_models, [PUBLICO, SO_DE_A]);
    assert.deepEqual(origemDepois.available_data_layers, [DL_PRIVADO]);
  });

  it('a camada de catálogo LEGADA e PÚBLICA SOBREVIVE ao clone (e a legada privada, não)', async () => {
    // A METADE POSITIVA É O ACHADO. A coleta do clone chamava `catalogLayerRef` sem o
    // documento, então toda entrada pré-prefixo (referência em `originalId`) produzia ZERO
    // pares; mas o aplicador, que recebe `data`, ACHAVA a referência e perguntava por uma
    // chave nunca classificada — fecha-fechado. Resultado: a camada morria no clone MESMO
    // SENDO PÚBLICA, sem aviso, num caminho irreversível.
    const daOrigem = await camadasDoAtlas(atlas2.id);
    assert.deepEqual(daOrigem.sort(), [DL_PRIVADO, DL_PUBLICO].sort(), 'PISO: a origem tem as duas');

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas2.id}/clone`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({})
      .expect(201);

    // A pública fica (era o dado que se perdia) e a privada sai (era o vazamento).
    assert.deepEqual(await camadasDoAtlas(res.body.data.id), [DL_PUBLICO]);
    assert.equal(res.body.data.pruneReport['mapa.catalogLayers'], 1);
  });

  it('duplicar um MAPA não poda nada: quem duplica é o dono, e não se cruza fronteira', async () => {
    // `cloneMapSubEntities` é COMPARTILHADA por `cloneAtlas` e `duplicateMap`, e o segundo a
    // chama com `pruner = null`. Isso é a decisão, e não um esquecimento: duplicar um mapa
    // não muda de dono nem sai do servidor, então podar ali faria o usuário perder o
    // PRÓPRIO acervo ao duplicar. Nada prendia essa decisão até aqui, e passar o pruner por
    // engano seria perda de dado silenciosa com a suite verde.
    const tokenA = await loginUser(app, dono.username, dono.password);
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}/duplicate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(201);

    const novoMapa = res.body.data.id;
    const { rows } = await db.query(
      `SELECT tileset_id FROM cesium3d_data WHERE map_id = $1 AND deleted_at IS NULL
        ORDER BY tileset_id`,
      [novoMapa]
    );
    // AS QUATRO, inclusive `CONCEDIDO_A_B`, que o próprio dono NÃO enxerga: é justamente
    // essa linha que morreria se alguém passasse o pruner aqui.
    assert.deepEqual(rows.map((r) => r.tileset_id),
      [CONCEDIDO_A_B, EMPRESTADO, PUBLICO, SO_DE_A].sort());
  });

  it('o que B alcança SÓ pelo empréstimo da origem não viaja na cópia dele', async () => {
    // A DECISÃO DE PROJETO, medida no único sujeito que a mede: B alcança `EMPRESTADO`
    // exclusivamente pelo `atlas_resources` do atlas de A (ele não tem concessão própria
    // sobre ele), e o clone não copia empréstimo. A classificação roda com atlas em foco
    // NULO justamente por isso: com o atlas de ORIGEM no lugar do nulo, `EMPRESTADO`
    // sobreviveria — e a cópia nasceria enxergando o que a origem emprestava, para deixar de
    // enxergar depois, sem ninguém ter revogado nada.
    //
    // O sujeito não pode ser A: ele TEM concessão própria sobre `EMPRESTADO` (é o que torna
    // o empréstimo real, porque o braço D4 empresta enquanto o DONO do atlas vir o recurso),
    // então a cópia dele leva o recurso por outro caminho e o caso não mediria a decisão.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [EMPRESTADO, benef.id]
    );
    assert.equal(rows[0].n, 0, 'PISO: B não pode ter concessão própria sobre o emprestado');

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({})
      .expect(201);
    assert.ok(
      !(await tilesetsDoAtlas(res.body.data.id)).includes(EMPRESTADO),
      'o recurso emprestado pelo atlas de origem não pode viajar na cópia'
    );
  });
});
