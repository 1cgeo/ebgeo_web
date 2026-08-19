// Path: tests/ws/poda-ws-fronteira.test.js
//
// F13 / V1 — O QUARTO RELAY, e a razão de ele ter sobrevivido a duas fases é uma frase escrita num
// comentário: o cabeçalho de `sync/catalog-layer-op.js` afirmava "THREE EXITS, NOT ONE" e concluía
// que um quarto relay estaria "coberto por construção" porque os dois relays conhecidos passavam
// por `broadcastOperations`. Era falso. `collab.handlers.js:handleOperation` — o despacho da
// mensagem WS `operation`, SINGULAR — monta `{ ...data.op, serverVersion }` e chama
// `broadcastToRoom` direto, sem tocar em `broadcastOperations`, então a poda nunca rodava ali. O
// despacho é vivo (`collab.gateway.js`) e o cliente tem o método (`ws-client.js sendOperation`).
//
// O QUE MUDOU, e é o que este arquivo mede: a cobertura deixou de ser uma contagem de relays e
// passou a ser um EMBRULHO POR SOCKET. `installOutboundResourcePrune` substitui `ws.send` na
// primeira linha de `onConnection`, então todo frame que qualquer handler emita — os de hoje e os
// que alguém escrever amanhã — atravessa a poda por conteúdo. Um quinto relay não precisa saber
// que ela existe.
//
// O QUE O VERDE DAQUI PROVA, E O QUE NÃO PROVA, medido com o controle negativo em vez de deduzido.
// O caminho do relay singular tem DUAS defesas independentes: a poda de OBJETO em
// `broadcastToRoom`, antes do fan-out, e o embrulho por socket. Removendo só o embrulho, o caso V1
// abaixo continua VERDE (medido); ele só fica vermelho quando as duas caem juntas. Ou seja: no fio,
// este arquivo prova que a definição não sai, e não prova qual das duas defesas a segurou.
//
// Isso é desenho, não buraco, e saber disso muda onde se procura quando algo quebra. O embrulho
// existe para o relay que AINDA NÃO EXISTE: o quinto, escrito por alguém que não passe por
// `broadcastToRoom`, exatamente como o quarto não passava. Um caminho que ainda não foi escrito não
// tem como ser medido no fio, então quem cobra o embrulho são outros dois guardas, e é a eles que
// se recorre: `tests/unit/saidas-de-conteudo-censo.test.js` afirma que a instalação é a primeira
// linha de `onConnection` (apagá-la reprova aquele caso, medido) e
// `tests/unit/resource-payload-prune.test.js` exercita o embrulho SOZINHO, sobre um socket falso,
// que é a forma exata de um relay que ninguém contou.
//
// A METADE POSITIVA, que é a que uma poda cega reprovaria: o `sync_response` carrega o snapshot
// com as definições que a reidratação resolveu para QUEM PEDIU, e elas precisam chegar. Isso só
// funciona porque `handleSyncRequest` entrega o OBJETO ao `send` em vez de uma string: a
// autorização é registrada por identidade, e identidade não sobrevive a um `JSON.stringify` feito
// antes da fronteira.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const sufixo = randomUUID().slice(0, 8);
const PRIVADA = `f13ws-priv-${sufixo}`;
const PUBLICA = `f13ws-pub-${sufixo}`;

const URL_PRIVADA_VIVA = `/tiles/${sufixo}/privada-viva/{z}/{x}/{y}.pbf`;
const URL_PUBLICA_VIVA = `/tiles/${sufixo}/publica-viva/{z}/{x}/{y}.pbf`;
const URL_COPIADA = `/tiles/${sufixo}/copia-carimbada/{z}/{x}/{y}.pbf`;
const URL_HILLSHADE = `/tiles/${sufixo}/relevo/{z}/{x}/{y}.png`;

const ID_PRIVADA = `analysis-${PRIVADA}`;
const ID_PUBLICA = `analysis-${PUBLICA}`;

const entradaComCopia = (id, resourceId) => ({
  id,
  type: 'analysis_layer',
  name: 'Nome copiado no dia da adição',
  visible: true,
  opacity: 0.6,
  styleOverrides: { raster: { 'raster-opacity': 0.3 } },
  config: { id: resourceId, source: { type: 'vector', url: URL_COPIADA } },
});

const entradaDoRelevo = () => ({
  id: 'hillshade',
  type: 'hillshade',
  name: 'Sombreamento do Relevo',
  visible: true,
  config: { source: { type: 'raster-dem', url: URL_HILLSHADE } },
});

describe('F13 — a fronteira de `ws.send` cobre o relay que ninguém tinha contado', () => {
  let app, db, server;
  let autor, par, tokenAutor, tokenPar, atlas, mapa;
  let abertos;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    autor = await createUser(db, { username: `f13ws_autor_${sufixo}` });
    par = await createUser(db, { username: `f13ws_par_${sufixo}` });
    tokenAutor = await loginUser(app, autor.username, autor.password);
    tokenPar = await loginUser(app, par.username, par.password);

    atlas = await createAtlas(db, autor.id, { name: `F13 WS ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: `Mapa WS ${sufixo}` });
    // O PAR TEM `read` PURO: é o nível do visitante de link público, e o destinatário que o relay
    // alcança sem que ninguém tenha lhe concedido recurso nenhum.
    await createShare(db, atlas.id, par.id, 'read', autor.id);

    for (const [id, nivel, url] of [
      [PRIVADA, 'private', URL_PRIVADA_VIVA], [PUBLICA, 'public', URL_PUBLICA_VIVA],
    ]) {
      await db.query(
        `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
         VALUES ($1, $2, $3::jsonb, 0, $4)`,
        [id, `Camada ${id} (nome vivo)`, JSON.stringify({
          source: { type: 'vector', url },
          bounds: [-50, -25, -40, -15],
        }), nivel],
      );
    }

    for (const entrada of [
      entradaComCopia(ID_PRIVADA, PRIVADA), entradaComCopia(ID_PUBLICA, PUBLICA), entradaDoRelevo(),
    ]) {
      await db.query(
        'INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)',
        [entrada.id, mapa.id, JSON.stringify(entrada)],
      );
    }
  });

  beforeEach(() => { abertos = []; });

  afterEach(() => {
    for (const c of abertos) {
      try {
        if (c.ws && c.ws.readyState <= 1) c.ws.terminate();
      } catch { /* já foi */ }
    }
    abertos = [];
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await db.query('DELETE FROM analysis_layers WHERE id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await teardownTestEnv(db);
  });

  async function conectar(token, clientId) {
    const cliente = await createWsClient(server, atlas.id, token, clientId);
    abertos.push(cliente);
    await cliente.waitForType('connected');
    return cliente;
  }

  it('piso: o recurso é privado e a carga do teste carrega a definição', async () => {
    const { rows } = await db.query(
      'SELECT access_level, active FROM analysis_layers WHERE id = $1', [PRIVADA],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].access_level, 'private');
    assert.equal(rows[0].active, true);
    assert.ok(
      JSON.stringify(entradaComCopia(ID_PRIVADA, PRIVADA)).includes(URL_COPIADA),
      'a carga que os casos enviam precisa ter a definição dentro, senão nada abaixo mede nada',
    );
  });

  it('V1 — o relay SINGULAR (`operation`) não repassa a definição, nem sob carimbo `map`', async () => {
    // O RESIDUAL EM PESSOA, nas suas duas metades de uma vez: a mensagem `operation` (que nunca
    // passou por `broadcastOperations`) carregando uma op carimbada `map` (que a poda por
    // `entityType` deixava passar mesmo quando passava).
    const a = await conectar(tokenAutor, `a-${sufixo}`);
    const b = await conectar(tokenPar, `b-${sufixo}`);
    b.clearMessages();

    a.send({
      type: 'operation',
      op: {
        id: randomUUID(),
        entityType: 'map',
        operationType: 'update',
        entityId: mapa.id,
        mapId: mapa.id,
        changes: {
          name: `Renomeado ${sufixo}`,
          catalogLayers: [entradaComCopia(ID_PRIVADA, PRIVADA), entradaDoRelevo()],
          analysis_layers: { camadas: [entradaComCopia(ID_PRIVADA, PRIVADA)] },
        },
        timestamp: Date.now(),
        clientId: `a-${sufixo}`,
      },
    });

    await a.waitForType('ack');
    const frame = await b.waitForType('operation');

    // POSITIVO: o gesto chegou ao par, inteiro no que não é definição.
    assert.equal(frame.op.entityType, 'map', 'o carimbo do envelope não é reescrito');
    assert.equal(frame.op.changes.name, `Renomeado ${sufixo}`, 'o rename chega');
    const daPrivada = frame.op.changes.catalogLayers.find((c) => c.id === ID_PRIVADA);
    assert.equal(daPrivada.visible, true, 'e o estado por atlas da camada');

    // NEGATIVO: nos dois portadores da mesma op.
    assert.equal(daPrivada.config, undefined, 'a definição saiu de `catalogLayers`');
    assert.equal(daPrivada.name, undefined, 'e o nome copiado também');
    assert.equal(
      frame.op.changes.analysis_layers.camadas[0].config, undefined,
      'e saiu da coluna irmã, que viajava dentro da mesma op',
    );

    // E o HILLSHADE atravessa inteiro: ele não é recurso de catálogo.
    const relevo = frame.op.changes.catalogLayers.find((c) => c.id === 'hillshade');
    assert.equal(relevo.config.source.url, URL_HILLSHADE, 'o relevo sombreado não pode ser podado');

    // A conferência sobre o frame INTEIRO, que é o que pega uma chave nova que ninguém previu.
    const texto = JSON.stringify(frame);
    assert.ok(!texto.includes(URL_COPIADA), 'o relay singular VAZOU a cópia carimbada');
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), 'o relay singular VAZOU a URL viva');
  });

  it('V1 — o relay em LOTE (`operations`) segue podado, e a op vizinha passa inteira', async () => {
    // O relay que já era coberto, aqui como controle de que a troca do pruner por conteúdo não
    // desfez a cobertura antiga — e de que uma op sem nada de recurso continua chegando inteira.
    const a = await conectar(tokenAutor, `a2-${sufixo}`);
    const b = await conectar(tokenPar, `b2-${sufixo}`);
    b.clearMessages();

    const featureId = randomUUID();
    a.send({
      type: 'operations',
      ops: [
        {
          id: randomUUID(),
          entityType: 'map',
          operationType: 'update',
          entityId: mapa.id,
          mapId: mapa.id,
          changes: { catalogLayers: [entradaComCopia(ID_PRIVADA, PRIVADA)] },
          timestamp: Date.now(),
          clientId: `a2-${sufixo}`,
        },
        {
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: featureId,
          mapId: mapa.id,
          data: {
            id: featureId,
            feature_type: 'point',
            geometry: { type: 'Point', coordinates: [-45, -20] },
            properties: { nome: 'Ponto vizinho' },
          },
          timestamp: Date.now(),
          clientId: `a2-${sufixo}`,
        },
      ],
    });

    await a.waitForType('ack_batch');
    const frame = await b.waitForType('operations');
    assert.equal(frame.ops.length, 2, 'as duas ops chegam');

    const daCamada = frame.ops.find((o) => o.entityType === 'map');
    assert.equal(daCamada.changes.catalogLayers[0].config, undefined, 'sem a definição');
    assert.equal(daCamada.changes.catalogLayers[0].id, ID_PRIVADA, 'com a referência');

    const daFeicao = frame.ops.find((o) => o.entityType === 'feature');
    assert.equal(daFeicao.data.properties.nome, 'Ponto vizinho', 'a op vizinha passa inteira');
    assert.ok(!JSON.stringify(frame).includes(URL_COPIADA), 'o lote VAZOU a cópia carimbada');
  });

  it('POSITIVO — o `sync_response` entrega o snapshot COM a definição autorizada', async () => {
    // O CONTROLE QUE UMA PODA CEGA REPROVARIA, e ele é a razão de `handleSyncRequest` entregar o
    // OBJETO ao `send`: se ele serializasse antes, a marca de autorização (identidade) se perderia
    // e a fronteira tiraria as definições que a reidratação acabara de resolver — a camada pública
    // chegaria ao par como "camada indisponível".
    const b = await conectar(tokenPar, `b3-${sufixo}`);
    b.clearMessages();
    b.send({ type: 'sync_request', lastVersion: 0 });

    const resposta = await b.waitForType('sync_response');
    assert.equal(resposta.isSnapshot, true, 'a versão 0 devolve o snapshot');

    const doMapa = resposta.snapshot.maps.find((m) => m.id === mapa.id);
    const publica = doMapa.catalogLayers.find((c) => c.id === ID_PUBLICA);
    assert.ok(publica.config, 'a camada pública chega COM definição');
    assert.equal(publica.config.source.url, URL_PUBLICA_VIVA, 'e é a URL VIVA do catálogo');
    assert.equal(publica.name, `Camada ${PUBLICA} (nome vivo)`, 'com o nome vivo');

    const relevo = doMapa.catalogLayers.find((c) => c.id === 'hillshade');
    assert.equal(relevo.config.source.url, URL_HILLSHADE, 'e o relevo continua inteiro');

    const privada = doMapa.catalogLayers.find((c) => c.id === ID_PRIVADA);
    assert.ok(privada, 'a camada privada continua na lista');
    assert.equal(privada.config, undefined, 'sem a definição, que este par não pode ver');

    const texto = JSON.stringify(resposta);
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), 'o `sync_response` VAZOU a URL viva do privado');
    assert.ok(!texto.includes(URL_COPIADA), 'o `sync_response` VAZOU a cópia carimbada');
    assert.ok(
      texto.includes(URL_PUBLICA_VIVA),
      'e a pública precisa estar lá: sem esta linha, os negativos acima seriam satisfeitos por uma '
      + 'poda que apagasse tudo',
    );
  });
});
