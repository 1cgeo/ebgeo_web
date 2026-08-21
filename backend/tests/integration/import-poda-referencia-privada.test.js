// Path: tests/integration/import-poda-referencia-privada.test.js
// A PODA DA ENTRADA, contra o caso HOSTIL: um `.ebgeo` que este app não produziu.
//
// Com a poda na saída o arquivo que o EBGeo gera já vem limpo. Mas `.ebgeo` é ARQUIVO:
// circula por e-mail e pendrive, pode vir de uma versão anterior e pode ser escrito à mão —
// e é por isso que o payload deste teste é montado literalmente à mão. `POST /atlas/import`
// grava `tileset_id`, `photo_name` e as duas referências de slide VERBATIM, e
// deliberadamente não tem gate de atlas (ela CRIA um). O que ela grava volta a sair no
// SNAPSHOT, servido a `read` — nível que um visitante de link público segura.
//
// O QUE A REFERÊNCIA NÃO ENTREGA é byte: cada tipo tem gate próprio nos bytes. O que ela
// entrega é a IDENTIDADE de um recurso privado, que é a mesma classe do vazamento que a
// poda de definição fechou, um degrau abaixo.
//
// E NÃO É 4xx: recusar o arquivo inteiro por uma referência morta tornaria todo `.ebgeo`
// antigo inimportável. O import responde 201 e conta no `summary` o que caiu.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

const TS_PUBLICO = `ipp-pub-${SFX}`;
const TS_CONCEDIDO = `ipp-conc-${SFX}`;
const TS_ALHEIO = `ipp-alheio-${SFX}`;
const FOTO_ALHEIA = `ipp-foto-alheia-${SFX}.jpg`;
// O `model_id` de slide é validado como UUID na BORDA (`slideSchema`), embora a coluna seja
// VARCHAR(100) e um id de catálogo seja slug. A fixture respeita a borda em vez de contorná-la:
// o assunto aqui é a poda, não a validação. (A divergência entre o Joi e a coluna é anterior a
// este lote e está anotada no relatório.)
const MODELO_ALHEIO = randomUUID();
// AS DUAS FOTOS DO MESMO PROJETO PÚBLICO existem para um caso só, e ele é o único sujeito
// que mede o `Map<chave, string[]>` de `classifyResourceRefs`: DUAS referências DISTINTAS
// que traduzem para o MESMO alvo.
const FOTO_PUB_A = `ipp-foto-pub-a-${SFX}.jpg`;
const FOTO_PUB_B = `ipp-foto-pub-b-${SFX}.jpg`;

describe('import: o payload perde a referência que o IMPORTADOR não vê', () => {
  let app, db, importador, terceiro, token, tokenTerceiro, atlasId, projeto360, projeto360Publico;

  const payload = () => ({
    atlas: { name: `IPP hostil ${SFX}` },
    maps: [{
      id: randomUUID(),
      name: 'Mapa hostil',
      base_layer: 'osm',
      center_lat: -22.9,
      center_long: -43.2,
      zoom: 10,
      cesium3dData: [
        { id: randomUUID(), data_type: 'marker', tileset_id: TS_PUBLICO, data: { t: 1 } },
        { id: randomUUID(), data_type: 'marker', tileset_id: TS_CONCEDIDO, data: { t: 2 } },
        { id: randomUUID(), data_type: 'marker', tileset_id: TS_ALHEIO, data: { t: 3 } },
      ],
      streetview360Data: [
        { id: randomUUID(), data_type: 'orientation', photo_name: FOTO_ALHEIA, data: { heading: 0 } },
        // DUAS fotos DISTINTAS do MESMO projeto público: ver o caso do desdobramento.
        { id: randomUUID(), data_type: 'orientation', photo_name: FOTO_PUB_A, data: { heading: 1 } },
        { id: randomUUID(), data_type: 'marker', photo_name: FOTO_PUB_B, data: { heading: 2 } },
      ],
    }],
    briefings: [{
      id: randomUUID(),
      name: 'Briefing hostil',
      slides: [{
        id: randomUUID(),
        title: 'Prosa que não pode se perder',
        content: 'Texto escrito à mão',
        mode: '3d',
        model_id: MODELO_ALHEIO,
      }],
    }],
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    importador = await createUser(db, { username: `ipp_imp_${SFX}` });
    terceiro = await createUser(db, { username: `ipp_ter_${SFX}` });
    token = await loginUser(app, importador.username, importador.password);
    tokenTerceiro = await loginUser(app, terceiro.username, terceiro.password);

    const dono = await createUser(db, { username: `ipp_dono_${SFX}` });
    for (const [id, nivel] of [[TS_PUBLICO, 'public'], [TS_CONCEDIDO, 'private'],
      [TS_ALHEIO, 'private'], [MODELO_ALHEIO, 'private']]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{}'::jsonb, 0, $3)`,
        [id, `Tileset ${id}`, nivel]
      );
    }
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level,
                                    granted_by, expires_at)
       VALUES ('tileset', $1, $2, 'view', $3, NOW() + INTERVAL '30 days')`,
      [TS_CONCEDIDO, importador.id, dono.id]
    );

    // O projeto 360 PRIVADO da foto alheia: sem linha, "não existe" e "privado" seriam
    // indistinguíveis e o caso não mediria o predicado, só a ausência.
    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM IPP ${SFX}`, `om-ipp-${SFX}`, 'IPP']
    );
    const { rows: projs } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'private', -22.9, -43.2, 1) RETURNING id`,
      [orgs[0].id, `ipp-${SFX}`, `Projeto IPP ${SFX}`, `${orgs[0].id}__ipp-${SFX}.db`]
    );
    projeto360 = projs[0].id;
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
       VALUES ($1, $2, $3, 1, -22.9, -43.2)`,
      [randomUUID(), projs[0].id, FOTO_ALHEIA]
    );

    // O SEGUNDO PROJETO, PÚBLICO, com DUAS fotos. Ele existe para o caso do desdobramento:
    // as duas referências traduzem para o mesmo `project_id`, e é essa colisão que exige
    // que o índice de origem seja uma LISTA e não um escalar.
    const { rows: pubs } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'public', -22.9, -43.2, 2) RETURNING id`,
      [orgs[0].id, `ipp-pub-${SFX}`, `Projeto IPP publico ${SFX}`, `${orgs[0].id}__ipp-pub-${SFX}.db`]
    );
    projeto360Publico = pubs[0].id;
    for (const [i, nome] of [FOTO_PUB_A, FOTO_PUB_B].entries()) {
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, $4, -22.9, -43.2)`,
        [randomUUID(), pubs[0].id, nome, i + 1]
      );
    }
  });

  after(async () => {
    // Mesma razao do arquivo irmao: linha de catalogo PRIVADA esquecida na tabela
    // compartilhada reprova um caso de outra suite, longe da causa.
    const ids = [TS_PUBLICO, TS_CONCEDIDO, TS_ALHEIO, MODELO_ALHEIO];
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [ids]);
    if (projeto360) await db.query('DELETE FROM sv360.projects WHERE id = $1', [projeto360]);
    if (projeto360Publico) {
      await db.query('DELETE FROM sv360.projects WHERE id = $1', [projeto360Publico]);
    }
    await teardownTestEnv(db);
  });

  it('PISO: os cinco literais estão no JSON do payload antes do import', () => {
    // A fixture é o sujeito da medição: um erro de digitação aqui faria todas as asserções
    // de "sumiu" passarem verdes sem nada ter sido podado.
    const json = JSON.stringify(payload());
    for (const literal of [TS_PUBLICO, TS_CONCEDIDO, TS_ALHEIO, FOTO_ALHEIA, MODELO_ALHEIO]) {
      assert.ok(json.includes(literal), `a fixture precisa citar ${literal}`);
    }
  });

  it('responde 201, mantém os dois legítimos e perde os três alheios', async () => {
    const res = await supertest(app)
      .post('/api/v1/atlas/import')
      .set('Authorization', `Bearer ${token}`)
      .send(payload())
      .expect(201);

    atlasId = res.body.data.id;

    const { rows: c3d } = await db.query(
      `SELECT c.tileset_id FROM cesium3d_data c JOIN maps m ON m.id = c.map_id
        WHERE m.atlas_id = $1 ORDER BY c.tileset_id`, [atlasId]
    );
    assert.deepEqual(c3d.map((r) => r.tileset_id), [TS_CONCEDIDO, TS_PUBLICO].sort());

    const { rows: sv } = await db.query(
      `SELECT photo_name FROM streetview360_data s JOIN maps m ON m.id = s.map_id
        WHERE m.atlas_id = $1 ORDER BY photo_name`, [atlasId]
    );
    // O DESDOBRAMENTO DA TRADUÇÃO 360, e este é o único sujeito da suíte que o mede: as
    // duas fotos públicas são referências DISTINTAS que traduzem para o MESMO projeto.
    // `classifyResourceRefs` indexa a origem por alvo, e com um valor ESCALAR só a última
    // recebia veredito — as anteriores caiam no fecha-fechado do fim, e um projeto 360
    // público perdia todas as fotos menos uma, silenciosamente. Com uma foto só (o estado
    // anterior da fixture) o defeito é invisível: reverter o `Map` para escalar deixava a
    // suíte inteira verde.
    assert.deepEqual(sv.map((r) => r.photo_name), [FOTO_PUB_A, FOTO_PUB_B].sort());
    assert.ok(!sv.some((r) => r.photo_name === FOTO_ALHEIA),
      'a orientação da foto de projeto privado alheio não entra');

    // O slide é REBAIXADO, não apagado: a prosa escrita à mão não existe em outro lugar.
    const { rows: sl } = await db.query(
      `SELECT s.title, s.mode, s.model_id FROM slides s JOIN briefings b ON b.id = s.briefing_id
        WHERE b.atlas_id = $1`, [atlasId]
    );
    assert.equal(sl.length, 1);
    assert.equal(sl[0].title, 'Prosa que não pode se perder');
    assert.equal(sl[0].model_id, null);
    assert.equal(sl[0].mode, '2d');

    // O resumo CONTA por superfície, e não carrega id nem nome.
    assert.deepEqual(res.body.data.summary.prunedResourceRefs, {
      'cesium3d.markers': 1,
      'sv360.orientations': 1,
      'briefing.slide.modelId': 1,
    });
    // E a contagem NÃO cresceu com as duas fotos públicas: elas sobreviveram inteiras.
    assert.ok(!JSON.stringify(res.body.data.summary).includes(TS_ALHEIO));
  });

  it('a referência escondida DENTRO de `data` também é podada', async () => {
    // O BYPASS QUE A PODA DE ENTRADA DEIXAVA ABERTO, e ele é exatamente o modelo de ameaça
    // declarado no cabeçalho deste arquivo. O snapshot monta
    // `{tilesetId: item.tileset_id, ...item.data}` (`sync.service.js`), então o valor DENTRO
    // de `data` vence a coluna na saída; o podador olhava só a coluna. Um `.ebgeo` escrito
    // à mão com a coluna NULA e o id restrito no JSONB atravessava inteiro e voltava a sair
    // no snapshot, servido a `read`.
    const hostil = payload();
    hostil.atlas.name = `IPP jsonb ${SFX}`;
    hostil.maps[0].id = randomUUID();
    hostil.maps[0].cesium3dData = [
      { id: randomUUID(), data_type: 'marker', tileset_id: null, data: { tilesetId: TS_ALHEIO } },
      // DISCRIMINAÇÃO: o mesmo formato, com um id que o importador VÊ, sobrevive. Sem ela,
      // "toda linha com `data` cai" passaria na asserção de cima.
      { id: randomUUID(), data_type: 'marker', tileset_id: null, data: { tilesetId: TS_PUBLICO } },
    ];
    hostil.maps[0].streetview360Data = [];
    hostil.briefings = [];

    const res = await supertest(app)
      .post('/api/v1/atlas/import')
      .set('Authorization', `Bearer ${token}`)
      .send(hostil)
      .expect(201);

    const { rows } = await db.query(
      `SELECT c.data FROM cesium3d_data c JOIN maps m ON m.id = c.map_id
        WHERE m.atlas_id = $1`, [res.body.data.id]
    );
    const json = JSON.stringify(rows);
    assert.ok(!json.includes(TS_ALHEIO), 'o id restrito não pode sobreviver dentro de `data`');
    assert.ok(json.includes(TS_PUBLICO), 'e o visível, no MESMO formato, tem de sobreviver');
    assert.equal(res.body.data.summary.prunedResourceRefs['cesium3d.markers'], 1);
  });

  it('as allowlists de `settings` do payload também são podadas', async () => {
    // `POST /atlas/import` funde `atlas.settings` do arquivo sobre o documento padrão
    // (`settings || $2::jsonb`). Sem poda, um `.ebgeo` escrito à mão replantava a identidade
    // de recurso restrito num atlas novo, servida depois por `GET /atlas/:id/settings` a
    // qualquer um com `read`.
    const hostil = payload();
    hostil.atlas.name = `IPP settings ${SFX}`;
    hostil.atlas.settings = { available_3d_models: [TS_PUBLICO, TS_ALHEIO] };
    hostil.maps[0].id = randomUUID();
    hostil.maps[0].cesium3dData = [];
    hostil.maps[0].streetview360Data = [];
    hostil.briefings = [];

    const res = await supertest(app)
      .post('/api/v1/atlas/import')
      .set('Authorization', `Bearer ${token}`)
      .send(hostil)
      .expect(201);

    const { rows } = await db.query('SELECT settings FROM atlas WHERE id = $1', [res.body.data.id]);
    assert.deepEqual(rows[0].settings.available_3d_models, [TS_PUBLICO]);
    assert.equal(res.body.data.summary.prunedResourceRefs['settings.available_3d_models'], 1);
  });

  it('o SNAPSHOT lido por um TERCEIRO não contém nenhum dos três', async () => {
    // A superfície pela qual o vazamento se realizaria, e a única que prova que a poda
    // alcançou o que o snapshot serve. Sem este caso, a poda poderia estar certa nas tabelas
    // e o snapshot montar a referência de outra fonte.
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
       VALUES ($1, $2, 'read', $3)`,
      [atlasId, terceiro.id, importador.id]
    );
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${tokenTerceiro}`)
      .expect(200);

    const json = JSON.stringify(res.body);
    for (const literal of [TS_ALHEIO, FOTO_ALHEIA, MODELO_ALHEIO]) {
      assert.ok(!json.includes(literal), `o snapshot não pode citar ${literal}`);
    }
    // DISCRIMINAÇÃO: o público sobreviveu até aqui. Sem esta linha, um snapshot vazio (ou
    // uma rota quebrada) passaria as três asserções acima sem verificar nada.
    assert.ok(json.includes(TS_PUBLICO), 'o snapshot precisa continuar servindo o público');
  });
});
