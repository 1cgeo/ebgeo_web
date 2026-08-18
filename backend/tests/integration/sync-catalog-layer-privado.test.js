// Path: tests/integration/sync-catalog-layer-privado.test.js
//
// F11 PARTE A — A CAMADA DE CATÁLOGO NO MAPA É REFERÊNCIA, NÃO CÓPIA.
//
// O QUE ESTAVA ABERTO, e por que nenhum gate o pegava. `catalog_layers.data` guardava uma
// CÓPIA da linha de catálogo inteira, `config.source.url` inclusive, escrita pelo cliente no
// instante em que a camada foi acrescentada ao mapa. O snapshot espalhava aquele JSONB verbatim
// (`{ id, ...data, sync }`). Logo: um Gestor que ENXERGA uma camada privada a põe no mapa, o
// atlas é publicado depois, e `GET /atlas/:id/sync/0` — gateado em `read`, que
// `resolvePermission` devolve para userId NULO quando `is_public` — entrega a URL a um chamador
// ANÔNIMO. Nenhum gate de recurso é atravessado no caminho, porque a op nunca passa perto deles.
//
// O censo (`tests/unit/superficies-de-recurso-censo.test.js`) declarava este buraco, e o
// declarava POR BAIXO: dizia "a entrega a todo membro", quando o teto real é o visitante de
// link público, sem credencial nenhuma. Este arquivo é o que o tira do censo.
//
// O SEGUNDO SINTOMA, que ninguém reportou porque não dói: OBSOLESCÊNCIA. A cópia nunca era
// atualizada, então um administrador que corrigisse a URL de uma camada deixava a URL velha
// viva em todo atlas que já a tivesse acrescentado, para sempre. É o mesmo defeito, e é por
// isso que a correção é estrutural (a definição vem do catálogo NA LEITURA) e não um filtro.
//
// A ESTRUTURA É SEMPRE UM PAR, e aqui ela é tripla, porque três coisas podem estar erradas:
//   - POSITIVO: quem alcança o recurso recebe a definição (senão "não vaza" seria o que se mede
//     num snapshot que perdeu a camada);
//   - NEGATIVO: quem não alcança não recebe (o vazamento em si);
//   - DISCRIMINAÇÃO: o PÚBLICO e o HILLSHADE continuam saindo inteiros para todo mundo (senão
//     "não vaza" seria o que se mede num snapshot que apagou tudo — e apagar o hillshade tira o
//     relevo sombreado do mapa de todo mundo, que é a armadilha (i) desta fase).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createMap, createShare, loginUser,
  makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

const sufixo = randomUUID().slice(0, 8);
const PRIVADA = `f11-priv-${sufixo}`;
const PUBLICA = `f11-pub-${sufixo}`;

// A URL VIVA (a que o catálogo tem hoje) e a URL VELHA (a que o cliente copiou quando
// acrescentou a camada). As duas precisam ser distintas: é o par que separa "a definição veio
// do catálogo" de "a definição veio da cópia", e sem ele a asserção de frescor não discrimina.
// E a PRIVADA e a PÚBLICA também têm URLs distintas, e isso não é decoração: procurar a URL
// privada no snapshot inteiro só discrimina se ela não aparecer também pela camada pública.
const URL_VIVA = `/tiles/${sufixo}/viva-privada/{z}/{x}/{y}.pbf`;
const URL_VIVA_PUBLICA = `/tiles/${sufixo}/viva-publica/{z}/{x}/{y}.pbf`;
const URL_VELHA = `/tiles/${sufixo}/velha-copiada-pelo-cliente/{z}/{x}/{y}.pbf`;
const URL_HILLSHADE = `/tiles/${sufixo}/hillshade/{z}/{x}/{y}.png`;

describe('F11 — camada de catálogo no snapshot: referência, e a definição pelo predicado', () => {
  let app, db;
  let admin, gestor, membro, visitante;
  let tokenAdmin, tokenGestor, tokenMembro, tokenVisitante;
  let atlas, mapa;

  // --- helpers ---------------------------------------------------------------

  /** O snapshot completo, pelo token dado (sem token = anônimo puro). */
  const snapshot = async (token, esperado = 200) => {
    const req = supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/0`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(esperado);
    return esperado === 200 ? res.body.data.snapshot : null;
  };

  /** Uma camada de catálogo do mapa, pelo id, dentro de um snapshot. */
  const camada = (snap, id) => snap.maps
    .find((m) => m.id === mapa.id).catalogLayers
    .find((c) => c.id === id);

  /** Empurra ops pelo sync e devolve os acks. */
  const push = async (token, operations, esperado = 200) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(esperado);
    return res.body.data;
  };

  /** A op que o cliente REAL emite ao acrescentar uma camada de catálogo ao mapa. */
  const opDeCamada = (idDeCamada, tipo, definicaoCopiada, operationType = 'create') => ({
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType,
    entityId: idDeCamada,
    mapId: mapa.id,
    data: {
      id: idDeCamada,
      type: tipo,
      name: definicaoCopiada.name,
      visible: true,
      opacity: 1,
      status: 'active',
      styleOverrides: { alguma: 'coisa' },
      config: definicaoCopiada,
    },
    timestamp: Date.now(),
    clientId: `c-${sufixo}`,
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `f11_admin_${sufixo}` });
    gestor = await createUser(db, { username: `f11_gestor_${sufixo}` });
    membro = await createUser(db, { username: `f11_membro_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenGestor = await loginUser(app, gestor.username, gestor.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);

    atlas = await createAtlas(db, gestor.id, { name: `F11 atlas ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: 'Mapa F11' });
    // `write`, e não `read`: o membro precisa poder EMPURRAR para que o gate de escrita seja
    // medido nele. O eixo que este arquivo mede não é o de atlas.
    await createShare(db, atlas.id, membro.id, 'write', gestor.id);

    // As duas linhas de catálogo, cada uma com a SUA url viva.
    for (const [id, nivel, url] of [
      [PRIVADA, 'private', URL_VIVA], [PUBLICA, 'public', URL_VIVA_PUBLICA],
    ]) {
      await db.query(
        `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
         VALUES ($1, $2, $3::jsonb, 0, $4)`,
        [id, `Camada ${id} (nome vivo)`, JSON.stringify({
          source: { type: 'vector', url },
          bounds: [-50, -25, -40, -15],
          legend: { items: [{ label: 'viva' }] },
        }), nivel],
      );
    }

    // O Gestor RECEBE a privada com autoridade de repasse: é o que o torna capaz de pôr a
    // camada no mapa e, mais tarde, de emprestá-la pelo atlas.
    await supertest(app)
      .post(`/api/v1/resource-access/analysis_layer/${PRIVADA}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: gestor.id, grantLevel: 'view_share' })
      .expect(201);

    // E acrescenta as três camadas ao mapa, carimbando a cópia VELHA, como o cliente de hoje.
    await push(tokenGestor, [
      opDeCamada(`analysis-${PRIVADA}`, 'analysis_layer', {
        id: PRIVADA, name: 'nome velho copiado', source: { type: 'vector', url: URL_VELHA },
      }),
      opDeCamada(`analysis-${PUBLICA}`, 'analysis_layer', {
        id: PUBLICA, name: 'nome velho copiado', source: { type: 'vector', url: URL_VELHA },
      }),
      // O hillshade NÃO é recurso de catálogo: embutido, estático, sem linha em tabela nenhuma.
      opDeCamada('hillshade', 'hillshade', {
        name: 'Sombreamento do Relevo', source: { type: 'raster-dem', url: URL_HILLSHADE },
      }),
    ]);

    tokenVisitante = await getPublicToken(app, await makeAtlasPublic(db, atlas.id));
    visitante = { token: tokenVisitante };
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM analysis_layers WHERE id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // 1. PISO — o dado de teste é o que o teste supõe
  // ==========================================================================

  it('piso: as três camadas foram gravadas com a cópia VELHA no JSONB', async () => {
    const { rows } = await db.query(
      `SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id`,
      [mapa.id],
    );
    assert.equal(rows.length, 3, 'as três camadas precisam ter sido gravadas');
    assert.deepEqual(rows.map((r) => r.id), [`analysis-${PRIVADA}`, `analysis-${PUBLICA}`, 'hillshade']);
    // SEM ESTA LINHA todo o resto do arquivo passaria verde sobre um banco que nunca teve a
    // cópia: "a URL velha não sai" é trivialmente verdade quando ela nunca entrou.
    for (const r of rows) {
      assert.ok(
        JSON.stringify(r.data).includes(r.id === 'hillshade' ? URL_HILLSHADE : URL_VELHA),
        `a linha ${r.id} precisa carregar a cópia velha no banco`,
      );
    }
    assert.ok(visitante.token, 'piso: o token de visitante de link público precisa existir');
  });

  // ==========================================================================
  // 2. POSITIVO — quem alcança recebe a definição, e ela é a VIVA
  // ==========================================================================

  it('POSITIVO — o Gestor recebe a definição, e ela vem do catálogo (não da cópia velha)', async () => {
    const snap = await snapshot(tokenGestor);
    const c = camada(snap, `analysis-${PRIVADA}`);

    assert.ok(c, 'a camada privada precisa estar no snapshot de quem a enxerga');
    assert.equal(c.config.source.url, URL_VIVA, 'a URL entregue é a do catálogo, agora');
    assert.equal(c.name, `Camada ${PRIVADA} (nome vivo)`, 'e o nome também');
    // A OBSOLESCÊNCIA FECHADA, dita como asserção e não como comentário.
    assert.ok(
      !JSON.stringify(c).includes(URL_VELHA),
      'a cópia velha não pode sobreviver ao lado da definição fresca',
    );
    // O SHAPE NÃO MUDOU: referência, estado local e envelope continuam no TOPO do item.
    assert.equal(c.type, 'analysis_layer');
    assert.equal(c.visible, true);
    assert.equal(c.status, 'active');
    assert.deepEqual(c.styleOverrides, { alguma: 'coisa' });
    assert.equal(typeof c.sync.version, 'number');
    // `config.id` é REFERÊNCIA e é a chave mais consumida do `config` pelo cliente
    // (`innerId`): sem ela a camada some do desenho mesmo para quem tem acesso.
    assert.equal(c.config.id, PRIVADA);
  });

  it('POSITIVO — corrigir a URL no catálogo alcança o atlas que já tinha a camada', async () => {
    const CORRIGIDA = `${URL_VIVA}?corrigida`;
    await db.query(
      `UPDATE analysis_layers SET config = jsonb_set(config, '{source,url}', $2::jsonb) WHERE id = $1`,
      [PRIVADA, JSON.stringify(CORRIGIDA)],
    );
    try {
      const c = camada(await snapshot(tokenGestor), `analysis-${PRIVADA}`);
      assert.equal(c.config.source.url, CORRIGIDA, 'a correção precisa chegar sem tocar no atlas');
    } finally {
      await db.query(
        `UPDATE analysis_layers SET config = jsonb_set(config, '{source,url}', $2::jsonb) WHERE id = $1`,
        [PRIVADA, JSON.stringify(URL_VIVA)],
      );
    }
  });

  // ==========================================================================
  // 3. NEGATIVO — o vazamento, nos dois tetos
  // ==========================================================================

  it('NEGATIVO — o membro do atlas SEM concessão recebe a referência e nenhuma definição', async () => {
    const snap = await snapshot(tokenMembro);
    const c = camada(snap, `analysis-${PRIVADA}`);

    assert.ok(c, 'a camada continua no snapshot: omiti-la destruiria o estado local do atlas');
    assert.equal(c.config, undefined, 'sem definição');
    assert.equal(c.name, undefined, 'nem o nome, que também é da linha de catálogo');
    // E o estado LOCAL sobrevive, que é a razão de entregar a referência em vez de omitir.
    assert.equal(c.visible, true);
    assert.deepEqual(c.styleOverrides, { alguma: 'coisa' });

    assert.ok(
      !JSON.stringify(snap).includes(URL_VIVA),
      'a URL da camada privada não pode aparecer em NENHUM ponto do snapshot',
    );
  });

  it('NEGATIVO — e o visitante de LINK PÚBLICO, que é o teto real, tampouco', async () => {
    // ESTE É O CASO QUE O CENSO DESCREVIA POR BAIXO. `resolvePermission` devolve `read` para
    // userId nulo num atlas `is_public`, então este chamador não tem credencial nenhuma.
    const snap = await snapshot(visitante.token);
    const c = camada(snap, `analysis-${PRIVADA}`);

    assert.ok(c, 'a referência continua saindo');
    assert.equal(c.config, undefined);
    assert.equal(c.name, undefined);
    assert.ok(
      !JSON.stringify(snap).includes(URL_VIVA),
      'a URL privada não pode sair para o anônimo — é o vazamento que a fase fecha',
    );
    assert.ok(
      !JSON.stringify(snap).includes(URL_VELHA),
      'nem a cópia velha, que era a forma que ela tinha de sair',
    );
  });

  // ==========================================================================
  // 4. DISCRIMINAÇÃO — o público e o hillshade continuam inteiros
  // ==========================================================================

  it('DISCRIMINAÇÃO — a camada PÚBLICA sai com definição para o visitante anônimo', async () => {
    // Sem este caso, todos os negativos acima seriam o que se mede num snapshot que apagou a
    // definição de TODA camada — o que é "não vazar" e também "não funcionar".
    const c = camada(await snapshot(visitante.token), `analysis-${PUBLICA}`);
    assert.ok(c, 'a camada pública precisa estar lá');
    assert.equal(c.config.source.url, URL_VIVA_PUBLICA, 'com a definição VIVA, para todo mundo');
    assert.equal(c.name, `Camada ${PUBLICA} (nome vivo)`);
  });

  it('DISCRIMINAÇÃO — o HILLSHADE atravessa intacto: não é recurso de catálogo', async () => {
    // A ARMADILHA (i) DA FASE. `CATALOG_ITEM_TYPES` tem `hillshade`, e ele NÃO tem linha em
    // tabela de catálogo nenhuma (a definição é estática, `config.static.js` + HILLSHADE_URL).
    // Aplicar o predicado a ele tira o relevo sombreado do mapa de TODO MUNDO.
    for (const token of [tokenGestor, tokenMembro, visitante.token]) {
      const c = camada(await snapshot(token), 'hillshade');
      assert.ok(c, 'o hillshade precisa continuar no snapshot');
      assert.equal(c.config.source.url, URL_HILLSHADE, 'com a cópia dele intacta');
      assert.equal(c.name, 'Sombreamento do Relevo');
    }
  });

  it('DISCRIMINAÇÃO — a linha semeada `analysis_layers.hillshade` NÃO é usada como junção', async () => {
    // A SEGUNDA DEFESA, e ela existe porque a primeira poderia falhar por uma porta diferente:
    // a migração 003 semeou uma linha `analysis_layers` cujo id é literalmente 'hillshade', com
    // `config = {}`. Uma junção por `catalog_layers.id = analysis_layers.id` casaria com ela e
    // devolveria config VAZIO para a camada de relevo. O prefixo é o que impede: 'hillshade' não
    // produz chave de junção nenhuma.
    const { rows } = await db.query(`SELECT id, config FROM analysis_layers WHERE id = 'hillshade'`);
    assert.equal(rows.length, 1, 'piso: a linha semeada precisa existir para esta medição valer');
    assert.deepEqual(rows[0].config, {}, 'e ela é a de config vazio');

    // A ASSERÇÃO É SOBRE A URL, não sobre "o config não está vazio": a reidratação reprojeta
    // `{ id, name, ...config }`, então uma junção com a linha semeada devolveria um config com
    // duas chaves — não vazio, e ainda assim sem a fonte do relevo. Medir a ausência da URL é o
    // que discrimina; medir a forma não é.
    const c = camada(await snapshot(tokenGestor), 'hillshade');
    assert.equal(
      c.config.source.url, URL_HILLSHADE,
      'a camada de relevo não pode ser reescrita pela linha semeada: ela perderia a fonte',
    );
  });

  // ==========================================================================
  // 5. O EMPRÉSTIMO POR ATLAS alcança o visitante (R4), e a retirada o desfaz
  // ==========================================================================

  it('EMPRÉSTIMO — anexada ao atlas, a definição privada passa a alcançar o visitante; retirada, para', async () => {
    const anexar = () => supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenGestor}`)
      .send({ resourceType: 'analysis_layer', resourceId: PRIVADA });

    await anexar().expect(201);
    try {
      const c = camada(await snapshot(visitante.token), `analysis-${PRIVADA}`);
      assert.equal(
        c.config.source.url, URL_VIVA,
        'o visitante de link público HERDA o empréstimo do atlas (R4), e o snapshot precisa '
        + 'concordar com o payload aditivo de /resource-access/visible',
      );
    } finally {
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/resources/analysis_layer/${PRIVADA}`)
        .set('Authorization', `Bearer ${tokenGestor}`)
        .expect(200);
    }

    const depois = camada(await snapshot(visitante.token), `analysis-${PRIVADA}`);
    assert.equal(depois.config, undefined, 'retirado o empréstimo, a definição some de novo');
    assert.ok(!JSON.stringify(await snapshot(visitante.token)).includes(URL_VIVA));
  });

  // ==========================================================================
  // 6. O GATE DE ESCRITA — endurecimento, medido dos dois lados
  // ==========================================================================

  it('ESCRITA — o membro sem acesso ao recurso tem a op RECUSADA, e o lote sobrevive', async () => {
    const idDaCamada = `analysis-${PRIVADA}`;
    const alvo = opDeCamada(idDaCamada, 'analysis_layer', {
      id: PRIVADA, name: 'forjada', source: { type: 'vector', url: '/forjada' },
    }, 'update');
    const vizinha = opDeCamada(`analysis-${PUBLICA}`, 'analysis_layer', {
      id: PUBLICA, name: 'ok', source: { type: 'vector', url: '/ok' },
    }, 'update');

    const data = await push(tokenMembro, [alvo, vizinha]);
    const ackAlvo = data.acks.find((a) => a.opId === alvo.id);
    const ackVizinha = data.acks.find((a) => a.opId === vizinha.id);

    assert.equal(ackAlvo.rejected, true, 'a op sobre o recurso invisível precisa ser recusada');
    assert.match(ackAlvo.reason, /não tem acesso/);
    // RECUSA POR OPERAÇÃO, nunca por lote: um lançamento aqui abortaria a transação inteira e
    // congelaria a fila daquele cliente para sempre (é a lição das outras quatro recusas).
    assert.equal(ackVizinha.rejected, undefined, 'a irmã do mesmo lote precisa ter passado');

    const { rows } = await db.query(
      `SELECT data FROM catalog_layers WHERE map_id = $1 AND id = $2`, [mapa.id, idDaCamada],
    );
    assert.ok(!JSON.stringify(rows[0].data).includes('/forjada'), 'e nada foi escrito');
  });

  it('ESCRITA — o Gestor, que ENXERGA o recurso, continua escrevendo (o par do caso acima)', async () => {
    const op = opDeCamada(`analysis-${PRIVADA}`, 'analysis_layer', {
      id: PRIVADA, name: 'nome velho copiado', source: { type: 'vector', url: URL_VELHA },
    }, 'update');
    op.data.visible = false;

    const data = await push(tokenGestor, [op]);
    assert.equal(data.acks[0].rejected, undefined, 'quem enxerga o recurso não pode ser recusado');

    const c = camada(await snapshot(tokenGestor), `analysis-${PRIVADA}`);
    assert.equal(c.visible, false, 'e o estado local dele chegou');
  });

  it('ESCRITA — o gate NÃO alcança o DELETE: quem perdeu acesso precisa poder remover a camada', async () => {
    // Sem esta exceção o membro ficaria com uma camada morta e sem botão que funcione, que é o
    // beco sem saída que este arquivo já corrigiu três vezes em outras formas.
    const mapaProprio = await createMap(db, atlas.id, { name: `Descarte ${sufixo}` });
    await db.query(
      `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
      [`analysis-${PRIVADA}`, mapaProprio.id, JSON.stringify({ type: 'analysis_layer', visible: true })],
    );

    const data = await push(tokenMembro, [{
      id: randomUUID(),
      entityType: 'catalogLayer',
      operationType: 'delete',
      entityId: `analysis-${PRIVADA}`,
      mapId: mapaProprio.id,
      data: {},
      timestamp: Date.now(),
      clientId: `c-del-${sufixo}`,
    }]);
    assert.equal(data.acks[0].rejected, undefined, 'o delete não pode ser recusado pelo gate de recurso');

    const { rows } = await db.query(
      `SELECT deleted_at FROM catalog_layers WHERE map_id = $1 AND id = $2`,
      [mapaProprio.id, `analysis-${PRIVADA}`],
    );
    assert.ok(rows[0].deleted_at !== null, 'e a remoção aconteceu de verdade');
  });

  it('ESCRITA — o HILLSHADE e a forma legada de ARRAY passam pelo gate sem serem tocados', async () => {
    // Os dois casos que o resolvedor de referência devolve como "não é recurso": sem esta
    // medição, um gate que recusasse tudo o que não conhece tiraria o relevo sombreado de quem
    // não é administrador, e quebraria o import/clone que ainda escreve o array.
    const doHillshade = await push(tokenMembro, [
      opDeCamada('hillshade', 'hillshade', {
        name: 'Sombreamento do Relevo', source: { type: 'raster-dem', url: URL_HILLSHADE },
      }, 'update'),
    ]);
    assert.equal(doHillshade.acks[0].rejected, undefined, 'o hillshade não é recurso e não é gateado');

    const doArray = await push(tokenMembro, [{
      id: randomUUID(),
      entityType: 'catalogLayer',
      operationType: 'update',
      entityId: mapa.id,
      mapId: mapa.id,
      data: { catalog_layers: [{ id: `analysis-${PRIVADA}`, visible: true }] },
      timestamp: Date.now(),
      clientId: `c-arr-${sufixo}`,
    }]);
    assert.equal(doArray.acks[0].rejected, undefined, 'a forma legada de array não carrega tipo por camada');
  });

  // ==========================================================================
  // 7. A COLUNA LEGADA `maps.catalog_layers` — a outra metade do mesmo buraco
  // ==========================================================================

  it('A COLUNA LEGADA recebe o mesmo tratamento: ela também sai no snapshot', async () => {
    // O levantamento nomeou isto: fechar só a tabela dedicada deixa metade do buraco aberto,
    // porque `GET_ATLAS_MAPS` lista `catalog_layers` entre as colunas e o cliente a recebe
    // dentro do `...rest` de `reshapeSnapshotMap`.
    await db.query(
      `UPDATE maps SET catalog_layers = $1::jsonb WHERE id = $2`,
      [JSON.stringify([
        { id: `analysis-${PRIVADA}`, type: 'analysis_layer', visible: true, name: 'velho', config: { id: PRIVADA, source: { url: URL_VELHA } } },
        { id: 'legacy-sem-tipo', name: 'Camada legada', visible: false },
      ]), mapa.id],
    );
    try {
      const snapMembro = await snapshot(tokenMembro);
      const legadas = snapMembro.maps.find((m) => m.id === mapa.id).catalog_layers;
      assert.equal(legadas.length, 2, 'a coluna legada continua saindo, com os mesmos itens');
      assert.equal(legadas[0].config, undefined, 'sem a definição, para quem não alcança o recurso');
      assert.ok(!JSON.stringify(snapMembro).includes(URL_VELHA));

      // DISCRIMINAÇÃO: a entrada legada SEM `type` não referencia recurso nenhum e passa inteira.
      assert.equal(legadas[1].name, 'Camada legada');
      assert.equal(legadas[1].visible, false);

      const legadasDoGestor = (await snapshot(tokenGestor)).maps
        .find((m) => m.id === mapa.id).catalog_layers;
      assert.equal(legadasDoGestor[0].config.source.url, URL_VIVA, 'e reidratada para quem alcança');
    } finally {
      await db.query(`UPDATE maps SET catalog_layers = '[]'::jsonb WHERE id = $1`, [mapa.id]);
    }
  });

  // ==========================================================================
  // 8. O CUSTO — a reidratação é UMA consulta, nunca uma por camada
  // ==========================================================================

  it('CUSTO — o número de consultas do snapshot NÃO cresce com o número de camadas', async () => {
    // O CONTROLE DE PERFORMANCE, no molde de `snapshot-n-mais-1.repro.test.js`: não mede tempo
    // (ruído em suíte), conta as idas ao banco pelo hook do pg-promise e afirma a propriedade
    // que interessa. Uma reidratação por camada seria N+1 pela porta nova.
    const { db: pool } = await import('../../src/database/index.js');
    const { getAtlasSnapshot } = await import('../../src/modules/sync/sync.service.js');

    const mapaCheio = await createMap(db, atlas.id, { name: `Custo ${sufixo}` });
    const contar = async (fn) => {
      const opts = pool.$config.options;
      const original = opts.query;
      let n = 0;
      opts.query = () => { n += 1; };
      try { await fn(); } finally { opts.query = original; }
      return n;
    };

    await db.query(
      `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
      [`analysis-${PUBLICA}`, mapaCheio.id, JSON.stringify({ type: 'analysis_layer', visible: true })],
    );
    const comUma = await contar(() => getAtlasSnapshot(atlas.id, 'owner', gestor.id));

    for (let i = 0; i < 8; i += 1) {
      await db.query(
        `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{"bounds":[-50,-25,-40,-15]}'::jsonb, 0, 'public')`,
        [`f11-carga-${i}-${sufixo}`, `Carga ${i}`],
      );
      await db.query(
        `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
        [`analysis-f11-carga-${i}-${sufixo}`, mapaCheio.id, JSON.stringify({ type: 'analysis_layer', visible: true })],
      );
    }
    const comNove = await contar(() => getAtlasSnapshot(atlas.id, 'owner', gestor.id));

    await db.query(`DELETE FROM analysis_layers WHERE id LIKE $1`, [`f11-carga-%-${sufixo}`]);

    assert.ok(comUma > 0, 'guarda: contagem zero passaria verde sem medir nada');
    assert.equal(
      comNove, comUma,
      `a reidratação precisa custar o MESMO com 1 e com 9 camadas de catálogo; `
      + `deu ${comUma} e ${comNove} (delta ${comNove - comUma})`,
    );
  });
});
