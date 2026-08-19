// Path: tests/integration/catalog-layer-cadeia-de-vazamento.test.js
//
// A CADEIA INTEIRA DO VAZAMENTO, DO GESTO ATÉ O ANÔNIMO, e ela é o caso mais importante da
// F11 porque nenhum dos elos é um bug: cada um faz exatamente o que foi escrito para fazer.
//
//   1. o administrador marca uma camada de dados como PRIVADA e concede `view` a alguém;
//   2. esse alguém, que só tem `view` (o degrau MAIS FRACO da concessão, sem autoridade de
//      repasse), acrescenta a camada a um mapa — gesto legítimo, e o gate de escrita desta
//      fase precisa aceitá-lo, senão a concessão de leitura não serve para nada;
//   3. o cliente de então carimbava a linha de catálogo INTEIRA dentro de `catalog_layers.data`,
//      `config.source.url` inclusive;
//   4. o dono do atlas gera um LINK PÚBLICO, gesto que não menciona recurso nenhum;
//   5. o visitante do link, que não tem conta, pede `GET /atlas/:id/sync/0`. A rota é gateada
//      em `read`, e `resolvePermission` devolve `read` para userId NULO quando `is_public`.
//
// A URL privada sai no passo 5 sem que NENHUM gate de recurso tenha sido atravessado, porque a
// cópia nunca passou perto de um. Não há autorização a corrigir: o que estava errado era o dado
// estar lá. Daí a correção ser estrutural (a linha guarda referência; a definição vem do
// catálogo na LEITURA, pelo predicado do chamador).
//
// O QUE ESTE ARQUIVO ACRESCENTA ao `sync-catalog-layer-privado.test.js`, que mede a mesma
// propriedade pelo lado do Gestor com `view_share`:
//   - a FAMÍLIA `data_layer` (prefixo `data-`, o outro ramo do UNION), que lá não é exercitada
//     de ponta a ponta em nenhum caso;
//   - o degrau `view` PURO, que é o par certo do gate de escrita: ele afirma que o gate cobra
//     visibilidade e NÃO repasse (cobrar repasse aqui quebraria o uso normal da concessão);
//   - a REVOGAÇÃO, que vira o predicado no MESMO principal. Comparar duas pessoas deixa em
//     aberto se o que discrimina é o acesso ou a identidade; virar a chave de uma só fecha isso;
//   - a linha PRÉ-F11 escrita direto na tabela e nunca mais tocada, que é o estado real do banco
//     de produção no dia do deploy: nada migra, e mesmo assim ela não vaza;
//   - o formato PRÉ-PREFIXO, mais antigo ainda, que foi o TETO da F11 e que a F12 FECHOU: o
//     servidor resolvia a referência só pelo prefixo do id, então uma entrada que a carrega em
//     `originalId` atravessava verbatim, cópia inclusive. Hoje ele lê os três carregadores do
//     cliente e PRESERVA a referência ao podar, que era a metade que faltava;
//   - e o LOG DE OPERAÇÕES, o segundo caminho, que a reidratação do snapshot nunca vê: o pull
//     incremental (`GET /sync/:version` com version > 0) devolve a carga do cliente como ela foi
//     gravada. Fechado na F12 por poda na saída (`sync/catalog-layer-op.js`).

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
const PRIVADA = `f11cad-priv-${sufixo}`;
const PUBLICA = `f11cad-pub-${sufixo}`;

// Três URLs distintas, e a distinção é o que dá poder de discriminação às buscas por substring
// no snapshot inteiro: a viva privada (o segredo), a viva pública (o controle que prova que o
// snapshot não foi apagado inteiro) e a cópia velha (a forma que o segredo tinha de sair).
const URL_PRIVADA = `/tiles/${sufixo}/privada-viva/{z}/{x}/{y}.pbf`;
const URL_PUBLICA = `/tiles/${sufixo}/publica-viva/{z}/{x}/{y}.pbf`;
const URL_COPIADA = `/tiles/${sufixo}/copia-carimbada-pelo-cliente/{z}/{x}/{y}.pbf`;

describe('F11 — a cadeia do vazamento: do gesto de quem só tem `view` até o visitante anônimo', () => {
  let app, db;
  let admin, espectador, estranho, dono;
  let tokenAdmin, tokenEspectador, tokenEstranho, tokenVisitante;
  let atlas, mapa, mapaDoEstranho;
  let ackDaAdicao;

  const idDaCamadaPrivada = `data-${PRIVADA}`;
  const idDaCamadaPublica = `data-${PUBLICA}`;

  // --- helpers ---------------------------------------------------------------

  const snapshot = async (token, esperado = 200) => {
    const req = supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/0`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(esperado);
    return esperado === 200 ? res.body.data.snapshot : null;
  };

  const camada = (snap, id, mapId = mapa.id) => snap.maps
    .find((m) => m.id === mapId).catalogLayers
    .find((c) => c.id === id);

  const push = async (token, operations) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);
    return res.body.data;
  };

  /** A op que o cliente PRÉ-F11 emitia: referência, estado por atlas e a cópia da linha. */
  const opComCopia = (id, resourceId, mapId, operationType = 'create') => ({
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType,
    entityId: id,
    mapId,
    data: {
      id,
      type: 'data_layer',
      name: 'Nome copiado no dia da adição',
      visible: true,
      opacity: 0.6,
      status: 'active',
      styleOverrides: { line: { 'line-width': 3 } },
      config: { id: resourceId, source: { type: 'vector', url: URL_COPIADA } },
    },
    timestamp: Date.now(),
    clientId: `c-cad-${sufixo}`,
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `f11cad_admin_${sufixo}` });
    dono = await createUser(db, { username: `f11cad_dono_${sufixo}` });
    espectador = await createUser(db, { username: `f11cad_espectador_${sufixo}` });
    estranho = await createUser(db, { username: `f11cad_estranho_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);

    tokenEspectador = await loginUser(app, espectador.username, espectador.password);
    tokenEstranho = await loginUser(app, estranho.username, estranho.password);

    atlas = await createAtlas(db, dono.id, { name: `F11 cadeia ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: 'Mapa da cadeia' });
    mapaDoEstranho = await createMap(db, atlas.id, { name: 'Mapa do estranho' });
    // `write` no ATLAS para os dois: o eixo medido aqui é o do RECURSO, e sem permissão de
    // atlas nenhum dos dois alcançaria a rota de push, o que faria os dois serem recusados
    // pelo mesmo motivo errado.
    await createShare(db, atlas.id, espectador.id, 'write', dono.id);
    await createShare(db, atlas.id, estranho.id, 'write', dono.id);

    for (const [id, nivel, url] of [
      [PRIVADA, 'private', URL_PRIVADA], [PUBLICA, 'public', URL_PUBLICA],
    ]) {
      await db.query(
        `INSERT INTO data_layers (id, name, config, sort_order, access_level)
         VALUES ($1, $2, $3::jsonb, 0, $4)`,
        [id, `Camada ${id} (nome vivo)`, JSON.stringify({
          source: { type: 'vector', url },
          bounds: [-50, -25, -40, -15],
        }), nivel],
      );
    }

    // O degrau MAIS FRACO: `view`, sem repasse. É o que a maioria das concessões é.
    await supertest(app)
      .post(`/api/v1/resource-access/data_layer/${PRIVADA}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: espectador.id, grantLevel: 'view' })
      .expect(201);

    // O passo 2 e o passo 3 da cadeia, no mesmo gesto.
    ackDaAdicao = await push(tokenEspectador, [
      opComCopia(idDaCamadaPrivada, PRIVADA, mapa.id),
      opComCopia(idDaCamadaPublica, PUBLICA, mapa.id),
    ]);

    // O passo 4: o dono publica o atlas. O gesto não menciona recurso nenhum.
    tokenVisitante = await getPublicToken(app, await makeAtlasPublic(db, atlas.id));
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM data_layers WHERE id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // PISO — sem isto, todo verde abaixo poderia ser o de um banco vazio
  // ==========================================================================

  it('piso: o recurso é privado e a linha do mapa carrega a CÓPIA velha', async () => {
    const { rows: recurso } = await db.query(
      `SELECT access_level, active FROM data_layers WHERE id = $1`, [PRIVADA],
    );
    assert.equal(recurso[0].access_level, 'private', 'o recurso precisa estar marcado privado');
    assert.equal(recurso[0].active, true, 'e ativo, senão a ausência da definição não diria nada');

    const { rows } = await db.query(
      `SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id`,
      [mapa.id],
    );
    assert.deepEqual(rows.map((r) => r.id), [idDaCamadaPrivada, idDaCamadaPublica]);
    // A CÓPIA ESTÁ NO BANCO. "A URL não sai" é trivialmente verdade se ela nunca entrou, e
    // esta é a linha que separa a medição da tautologia.
    assert.ok(
      JSON.stringify(rows[0].data).includes(URL_COPIADA),
      'a linha precisa carregar a cópia velha: é o dado que a leitura tem de neutralizar',
    );
    assert.equal(rows[0].data.config.id, PRIVADA, 'e a cópia aponta para o recurso privado');
  });

  // ==========================================================================
  // O GATE DE ESCRITA — o par completo, cobrando VISIBILIDADE e não repasse
  // ==========================================================================

  it('ESCRITA/POSITIVO — `view` puro basta para pôr a camada no mapa (não se cobra repasse)', () => {
    // O elo 2 da cadeia. Se este caso ficar vermelho o gate está cobrando autoridade de
    // REPASSE, que é o que `requireResourceRelay` cobra para EMPRESTAR ao atlas — outra
    // pergunta. Quem recebeu `view` pode usar a camada; só não pode redistribuí-la.
    const acks = ackDaAdicao.acks;
    assert.equal(acks.length, 2, 'as duas ops precisam ter sido processadas');
    for (const ack of acks) {
      assert.equal(ack.rejected, undefined, `a op ${ack.opId} não podia ser recusada: ${ack.reason}`);
    }
  });

  it('ESCRITA/NEGATIVO — quem NÃO enxerga o recurso não consegue acrescentá-lo', async () => {
    // O mesmo gesto, o mesmo nível de atlas (`write`), a mesma família de recurso: a ÚNICA
    // diferença com o caso acima é a concessão. Nada é escrito, e o resto do lote passa.
    const alvo = opComCopia(idDaCamadaPrivada, PRIVADA, mapaDoEstranho.id);
    const vizinha = opComCopia(idDaCamadaPublica, PUBLICA, mapaDoEstranho.id);

    const data = await push(tokenEstranho, [alvo, vizinha]);
    const ackAlvo = data.acks.find((a) => a.opId === alvo.id);
    const ackVizinha = data.acks.find((a) => a.opId === vizinha.id);

    assert.equal(ackAlvo.rejected, true, 'a op sobre o recurso invisível precisa ser recusada');
    assert.match(ackAlvo.reason, /não tem acesso/);
    assert.equal(ackVizinha.rejected, undefined, 'e a recusa é POR OP: a irmã pública passou');

    const { rows } = await db.query(
      `SELECT id FROM catalog_layers WHERE map_id = $1 ORDER BY id`, [mapaDoEstranho.id],
    );
    assert.deepEqual(
      rows.map((r) => r.id), [idDaCamadaPublica],
      'a camada privada não pode ter sido gravada nem com a cópia dentro',
    );
  });

  // ==========================================================================
  // O VAZAMENTO — os dois tetos, e o controle que impede a leitura preguiçosa
  // ==========================================================================

  it('VAZAMENTO/NEGATIVO — o visitante do LINK PÚBLICO não recebe a definição privada', async () => {
    // O elo 5, e o teto real da cadeia: este chamador não tem conta, não tem concessão e não
    // foi mencionado por ninguém. Antes da F11 ele recebia `config.source.url`.
    const snap = await snapshot(tokenVisitante);
    const c = camada(snap, idDaCamadaPrivada);

    assert.ok(c, 'a REFERÊNCIA continua saindo: omitir destruiria o estado por atlas');
    assert.equal(c.config, undefined, 'a definição não sai');
    assert.equal(c.name, undefined, 'nem o nome, que também é da linha de catálogo');
    // O estado por atlas sobrevive inteiro, que é a razão de entregar a referência.
    assert.equal(c.visible, true);
    assert.equal(c.opacity, 0.6);
    assert.deepEqual(c.styleOverrides, { line: { 'line-width': 3 } });

    // A BUSCA NO SNAPSHOT INTEIRO, não só no item: a mesma cópia viaja por mais de uma
    // superfície (a tabela dedicada e a coluna legada de `maps`), e checar só o item já deixou
    // metade de um buraco aberto nesta fase.
    const texto = JSON.stringify(snap);
    assert.ok(!texto.includes(URL_PRIVADA), 'a URL viva do recurso privado não pode aparecer');
    assert.ok(!texto.includes(URL_COPIADA), 'nem a cópia velha, que era a forma que ela tinha de sair');
  });

  it('VAZAMENTO/NEGATIVO — e sem credencial nenhuma a rota nem responde', async () => {
    // Completa a leitura da cadeia: o vazamento exigia o link público, não era a rota aberta.
    await snapshot(null, 401);
  });

  it('VAZAMENTO/POSITIVO — quem tem a concessão recebe a definição, e ela é a VIVA', async () => {
    // O par obrigatório. Sem ele, "não vaza" é o que se mede num snapshot que perdeu a camada.
    const c = camada(await snapshot(tokenEspectador), idDaCamadaPrivada);

    assert.equal(c.config.source.url, URL_PRIVADA, 'a URL entregue é a do catálogo');
    assert.equal(c.name, `Camada ${PRIVADA} (nome vivo)`);
    assert.equal(c.config.id, PRIVADA, 'e `config.id` continua lá: é o que o desenho endereça');
    assert.ok(
      !JSON.stringify(c).includes(URL_COPIADA),
      'a cópia velha não sobrevive ao lado da definição fresca',
    );
  });

  it('DISCRIMINAÇÃO — a camada PÚBLICA chega inteira ao visitante anônimo', async () => {
    // O controle contra o falso positivo mais fácil desta fase: um snapshot que apagasse a
    // definição de TODA camada passaria em todos os negativos acima e quebraria o produto.
    const c = camada(await snapshot(tokenVisitante), idDaCamadaPublica);
    assert.equal(c.config.source.url, URL_PUBLICA, 'a pública sai com a definição viva');
    assert.equal(c.name, `Camada ${PUBLICA} (nome vivo)`);
    assert.deepEqual(c.config.bounds, [-50, -25, -40, -15], 'com o resto da linha junto');
  });

  // ==========================================================================
  // A REVOGAÇÃO — a mesma pessoa, dos dois lados do predicado
  // ==========================================================================

  it('REVOGAÇÃO — revogar a concessão tira a definição do MESMO principal, e devolvê-la a traz', async () => {
    // Comparar duas pessoas deixa em aberto se o que discrimina é o acesso ou a identidade.
    // Aqui só a concessão muda, e ela muda nos dois sentidos.
    const antes = camada(await snapshot(tokenEspectador), idDaCamadaPrivada);
    assert.equal(antes.config.source.url, URL_PRIVADA, 'piso: com a concessão viva, ele enxerga');

    await db.query(
      `UPDATE resource_grants SET revoked_at = NOW()
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [PRIVADA, espectador.id],
    );
    try {
      const durante = await snapshot(tokenEspectador);
      const c = camada(durante, idDaCamadaPrivada);
      assert.equal(c.config, undefined, 'revogada a concessão, a definição para de sair');
      assert.equal(c.visible, true, 'e o estado por atlas dele continua intacto');
      assert.ok(!JSON.stringify(durante).includes(URL_PRIVADA));
    } finally {
      await db.query(
        `UPDATE resource_grants SET revoked_at = NULL
          WHERE resource_id = $1 AND grantee_id = $2`,
        [PRIVADA, espectador.id],
      );
    }

    const depois = camada(await snapshot(tokenEspectador), idDaCamadaPrivada);
    assert.equal(depois.config.source.url, URL_PRIVADA, 'devolvida, a definição volta');
  });

  // ==========================================================================
  // A LINHA PRÉ-F11 — o banco de produção no dia do deploy
  // ==========================================================================

  it('PRÉ-F11 — a linha antiga, nunca tocada por cliente novo, também não vaza', async () => {
    // NADA foi migrado nesta fase (decisão registrada: a cópia guardada é inerte e apagá-la
    // seria irreversível para nada). Esta é a asserção que compra aquela decisão: a linha
    // continua com a cópia dentro e mesmo assim a leitura a neutraliza. Ela é escrita direto
    // na tabela de propósito — o gate de escrita novo não existia quando ela nasceu.
    const mapaAntigo = await createMap(db, atlas.id, { name: `Pré-F11 ${sufixo}` });
    await db.query(
      `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
      [idDaCamadaPrivada, mapaAntigo.id, JSON.stringify({
        id: idDaCamadaPrivada,
        type: 'data_layer',
        name: 'Rótulo de 2025',
        visible: true,
        config: { id: PRIVADA, source: { type: 'vector', url: URL_COPIADA }, bounds: [0, 0, 1, 1] },
      })],
    );

    const doVisitante = await snapshot(tokenVisitante);
    const c = camada(doVisitante, idDaCamadaPrivada, mapaAntigo.id);
    assert.ok(c, 'a linha antiga continua aparecendo');
    assert.equal(c.config, undefined, 'sem definição para quem não alcança o recurso');
    assert.equal(c.name, undefined);
    assert.ok(!JSON.stringify(doVisitante).includes(URL_COPIADA), 'e a cópia não sai');

    // O par: para quem alcança, a linha antiga é servida com a definição VIVA, não com a que
    // está gravada nela. É o mesmo mecanismo que fecha a obsolescência.
    const doEspectador = camada(await snapshot(tokenEspectador), idDaCamadaPrivada, mapaAntigo.id);
    assert.equal(doEspectador.config.source.url, URL_PRIVADA);
    assert.deepEqual(
      doEspectador.config.bounds, [-50, -25, -40, -15],
      'inclusive o resto da linha: o bounds entregue é o do catálogo, não o de 2025',
    );

    // E o banco NÃO foi reescrito: a correção é de leitura, não uma varredura.
    const { rows } = await db.query(
      `SELECT data FROM catalog_layers WHERE map_id = $1 AND id = $2`,
      [mapaAntigo.id, idDaCamadaPrivada],
    );
    assert.ok(
      JSON.stringify(rows[0].data).includes(URL_COPIADA),
      'a cópia continua gravada: nada foi migrado, e é isso que a torna recuperável',
    );
  });

  // ==========================================================================
  // O DOCUMENTO PRÉ-PREFIXO — o formato mais antigo, e o TETO desta fase
  // ==========================================================================

  it('FORMATO PRÉ-PREFIXO — a referência sobrevive à poda, e a cópia não sai (F12)', async () => {
    // O id prefixado (`data-<id>`) é o carregador de referência MODERNO. Antes dele o documento
    // guardava um id qualquer e punha a referência em `originalId` (ou só em `config.id`), forma
    // que o cliente ainda lê: `catalogLayerReferenceId` (frontend) tem os três degraus, nesta
    // ordem. O servidor resolve SÓ pelo prefixo, então uma entrada dessas não produz referência
    // nenhuma para ele e atravessa verbatim.
    //
    // ERA O TETO DA F11, E A F12 O FECHOU, com as duas metades que o censo exigia: o servidor
    // adotou os três degraus do cliente (prefixo, `originalId`, `config.id`) e PRESERVA a
    // referência ao podar, como `pruneCatalogLayerDefinition` faz do outro lado. Sem a segunda,
    // a entrada que perde a definição perde junto o único endereço que tinha.
    //
    // As duas propriedades antigas continuam medidas (não quebra, não contamina) porque valem nos
    // dois estados do mundo; o que mudou é que agora a cópia também não sai.
    const mapaPreFixo = await createMap(db, atlas.id, { name: `Pré-prefixo ${sufixo}` });
    const idSemPrefixo = `legado-sem-prefixo-${sufixo}`;
    await db.query(
      `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
      [idSemPrefixo, mapaPreFixo.id, JSON.stringify({
        id: idSemPrefixo,
        type: 'data_layer',
        originalId: PRIVADA,
        name: 'Rótulo pré-prefixo',
        visible: true,
        opacity: 0.4,
        config: { id: PRIVADA, source: { type: 'vector', url: URL_COPIADA } },
      })],
    );
    // A vizinha MODERNA, no MESMO mapa: é ela que transforma este caso de descritivo em
    // discriminante. Uma entrada que o resolvedor não entende não pode desligar a reidratação
    // do mapa inteiro, e "não quebra" só significa alguma coisa se o vizinho continuar filtrado.
    await db.query(
      `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
      [idDaCamadaPrivada, mapaPreFixo.id, JSON.stringify({
        id: idDaCamadaPrivada,
        type: 'data_layer',
        visible: true,
        config: { id: PRIVADA, source: { type: 'vector', url: URL_COPIADA } },
      })],
    );

    // 1. NÃO QUEBRA: a rota responde, a entrada aparece e o estado por atlas dela sobrevive
    //    inteiro. Vale antes e depois de o teto fechar.
    const doVisitante = await snapshot(tokenVisitante);
    const antiga = camada(doVisitante, idSemPrefixo, mapaPreFixo.id);
    assert.ok(antiga, 'a entrada pré-prefixo continua no snapshot');
    assert.equal(antiga.visible, true, 'com o estado por atlas dela');
    assert.equal(antiga.opacity, 0.4);
    assert.equal(antiga.originalId, PRIVADA, 'e com a referência que ela carrega, que é o originalId');

    // 1b. E A CÓPIA NÃO SAI: o teto fechado. A entrada pré-prefixo é resolvida pelos três
    //     carregadores, o visitante anônimo não alcança o recurso, e a definição fica.
    assert.equal(antiga.config, undefined, 'a entrada pré-prefixo perdeu a definição');
    assert.equal(antiga.name, undefined, 'e o rótulo copiado junto');
    assert.ok(
      !JSON.stringify(doVisitante).includes(URL_COPIADA),
      'a URL copiada não aparece em lugar nenhum do snapshot do visitante',
    );

    // 2. NÃO CONTAMINA: a vizinha moderna, no mesmo mapa e apontando para o mesmo recurso,
    //    continua sem definição para quem não alcança o recurso.
    const moderna = camada(doVisitante, idDaCamadaPrivada, mapaPreFixo.id);
    assert.equal(moderna.config, undefined, 'a vizinha moderna continua filtrada');
    assert.equal(moderna.name, undefined);

    // E o par positivo da vizinha, no mesmo mapa: para quem alcança, ela é reidratada com a
    // definição VIVA mesmo tendo uma entrada não resolvível ao lado.
    const doEspectador = await snapshot(tokenEspectador);
    const modernaDoEspectador = camada(doEspectador, idDaCamadaPrivada, mapaPreFixo.id);
    assert.equal(modernaDoEspectador.config.source.url, URL_PRIVADA);

    // 3. E O PAR POSITIVO DA PRÓPRIA ENTRADA PRÉ-PREFIXO: quem ALCANÇA o recurso a recebe
    //    reidratada, pela referência que estava em `originalId`. Sem este par, "a cópia não sai"
    //    seria também o que se mede numa poda que simplesmente apagou tudo.
    const antigaDoEspectador = camada(doEspectador, idSemPrefixo, mapaPreFixo.id);
    assert.equal(antigaDoEspectador.config.source.url, URL_PRIVADA, 'a definição VIVA, não a cópia');
    assert.equal(antigaDoEspectador.name, `Camada ${PRIVADA} (nome vivo)`);
  });

  // ==========================================================================
  // O LOG DE OPERAÇÕES — o segundo caminho, que a reidratação nunca vê
  // ==========================================================================

  it('O PULL INCREMENTAL não entrega a cópia ao visitante anônimo (F12)', async () => {
    // O elo 5 tem uma variante que a F11 não alcançou. `GET /atlas/:id/sync/0` devolve o
    // SNAPSHOT, que reidrata; `GET /atlas/:id/sync/N` com N > 0 devolve o LOG, que
    // `INSERT_OPERATION` gravou com a carga do cliente verbatim — `config.source.url` inclusive,
    // e em QUALQUER formato, o ATUAL inclusive, que é o caso comum. A rota é a mesma, o gate é o
    // mesmo (`read`), e ela não tem LIMIT: pedir a versão 1 devolve o log inteiro. O visitante do
    // link chega nela sem conta, e o log não expira sozinho (a limpeza só é alcançável por rota
    // de administrador).
    const antes = (await snapshot(tokenVisitante)).currentVersion;

    // O gesto de um cliente PRÉ-F11 ainda aberto numa aba: ele carimba a cópia na op que escreve.
    await push(tokenEspectador, [opComCopia(idDaCamadaPrivada, PRIVADA, mapa.id, 'update')]);

    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/${antes}`)
      .set('Authorization', `Bearer ${tokenVisitante}`)
      .expect(200);

    const { operations, isSnapshot } = res.body.data;
    assert.equal(isSnapshot, false, 'é o ramo incremental, não o snapshot');
    // Positivo: o log foi mesmo entregue (uma resposta vazia passaria em todo o resto).
    assert.ok(operations.length > 0, 'o log do atlas sai por esta rota');
    const daCamada = operations.find(
      (o) => (o.entityType === 'catalogLayer' || o.entityType === 'catalog_layer')
        && o.data?.id === idDaCamadaPrivada,
    );
    assert.ok(daCamada, 'e a op que acrescentou a camada privada está nele');
    // Negativo: a referência e o estado por atlas ficam; a definição não.
    assert.equal(daCamada.data.id, idDaCamadaPrivada);
    assert.equal(daCamada.data.visible, true);
    assert.deepEqual(daCamada.data.styleOverrides, { line: { 'line-width': 3 } });
    assert.equal(daCamada.data.config, undefined);
    assert.equal(daCamada.data.name, undefined);

    // E o LOG INTEIRO, que é o que a rota entrega a quem pede a versão 1: nenhuma op dele carrega
    // a URL copiada, seja qual for o formato em que ela foi gravada.
    const tudo = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/1`)
      .set('Authorization', `Bearer ${tokenVisitante}`)
      .expect(200);
    assert.ok(tudo.body.data.operations.length > 0, 'o log histórico sai inteiro por esta rota');
    assert.ok(
      !JSON.stringify(tudo.body.data.operations).includes(URL_COPIADA),
      'a URL copiada não sai por nenhuma op do log',
    );
  });
});
