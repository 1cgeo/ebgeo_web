// Path: tests/integration/catalogo-referencias-de-recurso.test.js
//
// INVARIANTE PRESA AQUI (achado A6, decisão do dono em 2026-08-24): existe uma leitura que diz
// QUANTOS atlas referenciam um item de catálogo, e ela conta pelo INVENTÁRIO de superfícies, não
// pelas duas ou três que alguém lembrou.
//
// O buraco: `deleteCatalogItem` é `UPDATE ... SET active = false` e não consulta referência
// nenhuma. A tela ganhou a frase de aviso (`frontend/src/js/admin/catalog-delete-phrases.js`) e o
// cabeçalho dela declara por extenso que NÃO traz o número porque isso "exigiria uma rota nova".
//
// O QUE ESTE ARQUIVO PRECISA PROVAR, e é mais do que "o número aparece":
//
//   1. QUE O NÚMERO É DE ATLAS, não de linhas. Um atlas que cita o mesmo recurso em três
//      superfícies é UM atlas. Sem isso a confirmação assusta com um número inflado.
//   2. QUE A COBERTURA É O REGISTRO. `resource-reference.registry.js` é o inventário, a consulta é
//      uma materialização escrita à mão, e materialização à mão envelhece calada: superfície nova
//      sem perna devolve um número MENOR que o verdadeiro, com a resposta bem-formada, empurrando
//      para o lado do "pode apagar". O caso estrutural no fim confronta os dois conjuntos.
//   3. QUE A CAMADA DE CATÁLOGO É RESOLVIDA EM JS. O SQL só ESTREITA (o id termina com o alvo), e
//      quem decide é `catalogLayerReference`. O caso do ISCA prova a metade que o SQL não faz.
//   4. QUE O GATE É O DA EXCLUSÃO. O número serve à confirmação do `DELETE`, então quem conta é
//      quem exclui — nunca todo chamador autenticado, o que faria da rota um censo de uso do
//      acervo.
//
// CONTROLE NEGATIVO (copie os arquivos de lado, nunca `git checkout`: outros agentes compartilham
// esta árvore):
//   1. Apague a entrada `settings.default_basemap` de `REF_COUNT_SURFACES`: o módulo do catálogo
//      RECUSA CARREGAR e o arquivo inteiro fica vermelho com o nome da superfície na mensagem
//      (medido em 2026-08-24). O confronto vive no load, não no pedido, porque a condição é
//      estática — e é por isso que o caso estrutural do fim nunca chega a falhar sozinho: ele
//      documenta a regra e cobre o sentido inverso (perna declarada para id que o registro já
//      não conhece), que o load NÃO checa.
//   1b. Apague só a PERNA do SQL, deixando a declaração: o módulo carrega, tudo fica verde menos
//      o caso do mapa base, que acusa `settings.default_basemap` zerado. É a forma silenciosa, e
//      é a razão de o `bySurface` ser asserido campo a campo em vez de só pelo total.
//   2. Troque a resolução em JS por um `cl.id = 'data-' || $1` no SQL: o caso do ISCA fica verde
//      (é a forma que passa) mas o caso da forma LEGADA (`originalId`) fica vermelho — as duas
//      metades existem por isso.
//   3. Deixe a filtragem em JS de fora (conte toda linha que o SQL devolve): o caso do ISCA fica
//      vermelho, com o número inflado que ele existe para pegar.
//   4. Troque `fn_can_produce_resource` por nada na consulta de existência: os casos de recusa por
//      OM ficam vermelhos e todos os de contagem seguem verdes.
//   5. Tire o `a.deleted_at IS NULL` de uma perna: o caso da lixeira fica vermelho.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, createMap, createBriefing,
  createCesium3dData, loginUser,
} from '../helpers/fixtures.js';
import { REF_COUNT_SURFACES } from '../../src/modules/atlas/atlas.queries.js';
import {
  RESOURCE_REF_SURFACES, REF_ACTION,
} from '../../src/modules/atlas/resource-reference.registry.js';
import { CATALOG_TABLES } from '../../src/modules/catalog/catalog.tables.js';
import { TYPE_BY_TABLE } from '../../src/modules/resource-access/resource-access.types.js';

describe('quantos atlas referenciam um recurso de catálogo', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgDona, orgOutra;

  // Os três recursos medidos, um por eixo de superfície.
  const bm = `bm-${sufixo}`;
  const dl = `dl-${sufixo}`;
  const ts = `ts-${sufixo}`;
  const morto = `mt-${sufixo}`;

  const atlasIds = {};

  // O caminho montado NÃO é o nome da tabela: `data_layers` é servida em `/data-layers`
  // (`src/app.js`). Escrever o nome da tabela aqui devolvia 404, e um 404 de rota inexistente é
  // indistinguível do 404 que esta própria rota usa para esconder a linha alheia — a leitura
  // errada mais barata de cometer numa suíte de acesso.
  const contar = (tabela, id, token) => supertest(app)
    .get(`/api/v1/${tabela}/${id}/references`)
    .set('Authorization', `Bearer ${token}`);

  const criarOrg = async (rotulo) => (await db.query(
    `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
    [`OM ${rotulo} ${sufixo}`, `om-${rotulo}-${sufixo}`, `${rotulo.slice(0, 2)}${sufixo.slice(0, 3)}`],
  )).rows[0].id;

  const criarItem = async (tabela, id, orgId, ativo = true) => db.query(
    `INSERT INTO ${tabela} (id, name, config, sort_order, access_level, owner_org_id, active)
     VALUES ($1, $2, '{}'::jsonb, 900, 'public', $3::uuid, $4)`,
    [id, `Fixture ${id}`, orgId, ativo],
  );

  const camadaDeCatalogo = (mapId, layerId, payload) => db.query(
    `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
    [layerId, mapId, JSON.stringify(payload)],
  );

  const settings = (atlasId, doc) => db.query(
    'UPDATE atlas SET settings = settings || $2::jsonb WHERE id = $1',
    [atlasId, JSON.stringify(doc)],
  );

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgDona = await criarOrg('dona');
    orgOutra = await criarOrg('outra');

    atores.admin = await createAdminUser(db, { username: `rf_admin_${sufixo}` });
    atores.produtor = await createProducerUser(db, orgDona, { username: `rf_prod_${sufixo}` });
    atores.produtorAlheio = await createProducerUser(db, orgOutra, {
      username: `rf_prodx_${sufixo}`,
    });
    atores.comum = await createUser(db, { username: `rf_comum_${sufixo}` });
    atores.credenciado = await createUser(db, {
      username: `rf_cred_${sufixo}`, role: 'credenciado',
    });
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    await criarItem('basemaps', bm, orgDona);
    await criarItem('data_layers', dl, orgDona);
    await criarItem('tilesets', ts, orgDona);
    await criarItem('tilesets', morto, orgDona, false);

    // ── atlas A: o mapa base, MAIS as duas superfícies de `settings`. Três citações do mesmo
    //    recurso num atlas só, que é o caso que separa "conta atlas" de "conta linhas".
    const atlasA = await createAtlas(db, atores.comum.id, { name: `RefA ${sufixo}` });
    atlasIds.A = atlasA.id;
    await createMap(db, atlasA.id, { name: 'MA', base_layer: bm });
    await settings(atlasA.id, { basemaps: [bm], default_basemap: bm });

    // ── atlas B: a camada de catálogo pela forma de PREFIXO, a única escrita desde F11.
    const atlasB = await createAtlas(db, atores.comum.id, { name: `RefB ${sufixo}` });
    atlasIds.B = atlasB.id;
    const mapaB = await createMap(db, atlasB.id, { name: 'MB' });
    await camadaDeCatalogo(mapaB.id, `data-${dl}`, { type: 'data_layer', nome: 'Camada' });

    // ── atlas C: as três superfícies de tileset.
    const atlasC = await createAtlas(db, atores.comum.id, { name: `RefC ${sufixo}` });
    atlasIds.C = atlasC.id;
    const mapaC = await createMap(db, atlasC.id, { name: 'MC' });
    await createCesium3dData(db, mapaC.id, { tileset_id: ts });
    const briefingC = await createBriefing(db, atlasC.id, { name: `BC ${sufixo}` });
    await db.query(
      `INSERT INTO slides (briefing_id, title, mode, model_id) VALUES ($1, $2, '3d', $3)`,
      [briefingC.id, 'Slide 3D', ts],
    );
    await settings(atlasC.id, { available_3d_models: [ts] });

    // ── atlas D: a ISCA. O id TERMINA com o do recurso e não é referência a ele; o SQL o traz e
    //    só `catalogLayerReference` sabe recusá-lo. Atlas SEPARADO de propósito: dentro do B, a
    //    falha de filtragem não mudaria a contagem e o teste passaria verde sem provar nada.
    const atlasD = await createAtlas(db, atores.comum.id, { name: `RefD ${sufixo}` });
    atlasIds.D = atlasD.id;
    const mapaD = await createMap(db, atlasD.id, { name: 'MD' });
    await camadaDeCatalogo(mapaD.id, `data-outra${dl}`, { type: 'data_layer' });

    // ── atlas E: a forma LEGADA (pré-prefixo), que carrega a referência em `originalId`.
    const atlasE = await createAtlas(db, atores.comum.id, { name: `RefE ${sufixo}` });
    atlasIds.E = atlasE.id;
    const mapaE = await createMap(db, atlasE.id, { name: 'ME' });
    await camadaDeCatalogo(mapaE.id, 'camada-sem-prefixo', {
      type: 'data_layer', originalId: dl,
    });

    // ── atlas F: na LIXEIRA, citando o mapa base. Não pode entrar em contagem nenhuma.
    const atlasF = await createAtlas(db, atores.comum.id, { name: `RefF ${sufixo}` });
    atlasIds.F = atlasF.id;
    await createMap(db, atlasF.id, { name: 'MF', base_layer: bm });
    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlasF.id]);
  });

  after(async () => {
    await db.query('DELETE FROM atlas WHERE owner_id = $1', [atores.comum.id]);
    await db.query('DELETE FROM basemaps WHERE id = $1', [bm]);
    await db.query('DELETE FROM data_layers WHERE id = $1', [dl]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[ts, morto]]);
    await db.query('DELETE FROM users WHERE username LIKE $1', [`rf_%${sufixo}`]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgDona, orgOutra]]);
    await teardownTestEnv(db);
  });

  // ── o número, e o que ele conta ────────────────────────────────────────────
  it('conta ATLAS, não citações: três superfícies do mesmo atlas somam um', async () => {
    const res = await contar('basemaps', bm, tokens.admin).expect(200);

    assert.equal(res.body.data.resourceId, bm);
    assert.equal(res.body.data.resourceType, 'basemap');
    assert.equal(res.body.data.atlasCount, 1, 'o atlas A cita o mapa base três vezes e é um só');
    assert.equal(res.body.data.bySurface['mapa.baseLayer'], 1);
    assert.equal(res.body.data.bySurface['settings.basemaps'], 1);
    assert.equal(res.body.data.bySurface['settings.default_basemap'], 1);
  });

  it('`bySurface` traz TODAS as superfícies do tipo, zeradas inclusive', async () => {
    const res = await contar('tilesets', ts, tokens.admin).expect(200);

    // Chave ausente e chave zerada são indistinguíveis para quem consome, e só uma delas é
    // verdade. As quatro do tipo `tileset` nascem presentes.
    assert.deepEqual(
      Object.keys(res.body.data.bySurface).sort(),
      ['briefing.slide.modelId', 'cesium3d', 'mapa.catalogLayers', 'settings.available_3d_models'],
    );
    assert.equal(res.body.data.atlasCount, 1, 'o atlas C, três superfícies, um atlas');
    assert.equal(res.body.data.bySurface.cesium3d, 1);
    assert.equal(res.body.data.bySurface['briefing.slide.modelId'], 1);
    assert.equal(res.body.data.bySurface['settings.available_3d_models'], 1);
    assert.equal(
      res.body.data.bySurface['mapa.catalogLayers'], 0,
      'tileset não tem prefixo de camada de catálogo: zero legítimo, não perna morta',
    );
  });

  it('a camada de catálogo é resolvida em JS: o ISCA não conta, a forma LEGADA conta', async () => {
    const res = await contar('data-layers', dl, tokens.admin).expect(200);

    // O atlas D tem `data-outra<dl>`, que o SQL traz (o id TERMINA com o alvo) e que
    // `catalogLayerReference` recusa (o resto do prefixo não é o recurso). O atlas E tem a forma
    // pré-prefixo, com a referência em `originalId`, que só o JS acha.
    assert.equal(res.body.data.atlasCount, 2, 'atlas B (prefixo) e E (legado); o D é isca');
    assert.equal(res.body.data.bySurface['mapa.catalogLayers'], 2);
    assert.equal(
      res.body.data.bySurface['settings.available_data_layers'], 0,
      'nenhuma allowlist de camada de dados cita este id',
    );
  });

  it('atlas na LIXEIRA não entra na conta', async () => {
    const res = await contar('basemaps', bm, tokens.admin).expect(200);
    assert.equal(
      res.body.data.bySurface['mapa.baseLayer'], 1,
      'o atlas F também tem base_layer = este mapa base, e está soft-deletado',
    );
  });

  // ── o gate: quem conta é quem exclui ──────────────────────────────────────
  it('o PRODUTOR da OM dona conta o próprio acervo', async () => {
    const res = await contar('basemaps', bm, tokens.produtor).expect(200);
    assert.equal(res.body.data.atlasCount, 1, 'o mesmo número que o administrador vê');
  });

  it('o produtor de OUTRA OM leva 404, não 403: a linha alheia é indistinguível de inexistente',
    async () => {
      await contar('basemaps', bm, tokens.produtorAlheio).expect(404);
    });

  it('usuário comum e credenciado levam 403: nenhum dos dois mantém acervo', async () => {
    await contar('basemaps', bm, tokens.comum).expect(403);
    await contar('basemaps', bm, tokens.credenciado).expect(403);
  });

  it('sem credencial é 401', async () => {
    await supertest(app).get(`/api/v1/basemaps/${bm}/references`).expect(401);
  });

  it('item inexistente e item já excluído levam 404, como a leitura e a exclusão', async () => {
    await contar('tilesets', `nao-existe-${sufixo}`, tokens.admin).expect(404);
    await contar('tilesets', morto, tokens.admin).expect(404);
  });

  // ── a cobertura, confrontada com o inventário ─────────────────────────────
  it('toda superfície do REGISTRO que vale para tabela de catálogo tem perna na consulta',
    async () => {
      const declarados = new Set(REF_COUNT_SURFACES.flatMap((s) => s.registro));
      const tipos = CATALOG_TABLES.map((t) => TYPE_BY_TABLE[t]);
      const esperados = RESOURCE_REF_SURFACES
        .filter((s) => s.acao !== REF_ACTION.NAO_REFERENCIA)
        .filter((s) => s.tipos.some((t) => tipos.includes(t)))
        .map((s) => s.id);

      assert.ok(esperados.length > 0, 'o registro precisa declarar superfícies para o catálogo');
      assert.deepEqual(
        esperados.filter((id) => !declarados.has(id)), [],
        'superfície do registro sem perna: a contagem a ignora e devolve número MENOR que o real',
      );
      assert.deepEqual(
        [...declarados].filter((id) => !RESOURCE_REF_SURFACES.some((s) => s.id === id)), [],
        'perna declarada para um id que o registro não conhece mais',
      );
    });
});
