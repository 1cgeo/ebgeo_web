// Path: tests/unit/catalog-layer-op-poda.test.js
//
// F12 — A PODA DA DEFINIÇÃO NO LOG DE OPERAÇÕES, e ela é o segundo caminho que a F11 não
// alcançou. A reidratação daquela fase mora dentro de `getAtlasSnapshot`; a operação viaja por
// fora, em dois lugares que não passam por lá:
//
//   1. o PULL INCREMENTAL (`GET /atlas/:id/sync/:version` com version > 0), que devolve
//      `operations` cru. `INSERT_OPERATION` grava a carga do cliente verbatim, então toda camada
//      de catálogo acrescentada por cliente pré-F11 está no log com `config.source.url`. E o log
//      não expira sozinho: a limpeza só é alcançável por rota de administrador.
//   2. o RELAY, HTTP e WS, que ecoa a carga do autor para a sala inteira — o visitante de link
//      público incluído, que tem `read`.
//
// O QUE ESTE ARQUIVO PRENDE E O INTEGRADO NÃO PEGA: a forma do id. `operations.entity_id` é
// `UUID NOT NULL` e um id de camada de catálogo não é UUID ('data-<slug>', 'hillshade'), então o
// INSERT substitui pelo id do ATLAS. Uma poda escrita sobre `entityId` não casa NUNCA numa linha
// gravada, e passa verde sem verificar nada. Os casos abaixo medem os dois endereços de propósito.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  pruneCatalogLayerOperation, pruneCatalogLayerOperations,
} from '../../src/modules/sync/catalog-layer-op.js';
import { joinRoom, leaveRoom, broadcastOperations } from '../../src/modules/collab/collab.rooms.js';

const URL_PRIVADA = '/tiles/privada/{z}/{x}/{y}.pbf';

/** A carga que um cliente pré-F11 carimbava ao acrescentar uma camada privada ao mapa. */
const definicaoCopiada = (id = 'data-restrita') => ({
  id,
  type: 'data_layer',
  visible: true,
  opacity: 0.6,
  styleOverrides: { raster: { 'raster-opacity': 0.5 } },
  name: 'Camada restrita',
  config: { id: 'restrita', source: { type: 'vector', url: URL_PRIVADA } },
});

const op = (extra) => ({
  id: randomUUID(),
  entityType: 'catalogLayer',
  operationType: 'create',
  mapId: randomUUID(),
  timestamp: Date.now(),
  clientId: 'c1',
  ...extra,
});

describe('F12 — poda da definição de catálogo na saída do log de operações', () => {
  it('tira `name` e `config` e deixa referência e estado por atlas', () => {
    const podada = pruneCatalogLayerOperation(op({
      entityId: 'data-restrita', data: definicaoCopiada(),
    }));

    assert.equal(podada.data.name, undefined);
    assert.equal(podada.data.config, undefined);
    // Positivo do par: o que NÃO é definição atravessa inteiro.
    assert.equal(podada.data.id, 'data-restrita');
    assert.equal(podada.data.type, 'data_layer');
    assert.equal(podada.data.visible, true);
    assert.equal(podada.data.opacity, 0.6);
    assert.deepEqual(podada.data.styleOverrides, { raster: { 'raster-opacity': 0.5 } });
    // E o envelope não é tocado.
    assert.equal(podada.operationType, 'create');
    assert.equal(podada.clientId, 'c1');
    assert.ok(!JSON.stringify(podada).includes(URL_PRIVADA));
  });

  it('O ENDEREÇO: resolve o id pelo PAYLOAD, não por `entityId`, que na linha gravada é o atlas', () => {
    // A forma real de uma linha de `operations`: `entity_id` carrega o id do ATLAS, porque a
    // coluna é UUID e o id da camada não é. Se a poda dependesse dele, não casaria nunca.
    const atlasId = randomUUID();
    const podada = pruneCatalogLayerOperation(op({
      entityType: 'catalog_layer', // o vocabulário que o pull incremental devolve
      entityId: atlasId,
      data: definicaoCopiada(),
    }));

    assert.equal(podada.data.config, undefined, 'podou mesmo com `entityId` valendo o atlas');
    assert.equal(podada.entityId, atlasId, 'e não mexeu no envelope');
  });

  it('RESGATA a referência pré-prefixo, que só existia dentro de `config`', () => {
    // O TETO declarado da F11: o id não carrega o prefixo, então o único endereço da entrada
    // estava em `config.id`. Podar sem resgatar deixaria uma camada que ninguém resolve.
    const podada = pruneCatalogLayerOperation(op({
      entityId: 'legado-sem-prefixo',
      data: {
        id: 'legado-sem-prefixo', type: 'data_layer', visible: true,
        name: 'Rótulo antigo', config: { id: 'restrita', source: { url: URL_PRIVADA } },
      },
    }));

    assert.equal(podada.data.originalId, 'restrita', 'a referência sobrevive à poda');
    assert.equal(podada.data.config, undefined);
    assert.equal(podada.data.name, undefined);
  });

  it('a forma legada de ARRAY é podada item a item', () => {
    const podada = pruneCatalogLayerOperation(op({
      operationType: 'update',
      entityId: randomUUID(),
      data: {
        catalog_layers: [
          definicaoCopiada('data-restrita'),
          { id: 'wms-a', name: 'Sem tipo', config: { url: '/nao-e-recurso' }, visible: true },
        ],
      },
    }));

    const [recurso, semTipo] = podada.data.catalog_layers;
    assert.equal(recurso.config, undefined, 'a entrada que clama recurso perde a definição');
    // DISCRIMINAÇÃO: a entrada sem `type` não clama recurso nenhum e sai inteira. Sem este par
    // uma poda incondicional passaria idêntica no caso acima.
    assert.equal(semTipo.name, 'Sem tipo');
    assert.deepEqual(semTipo.config, { url: '/nao-e-recurso' });
  });

  it('DISCRIMINAÇÃO — hillshade, entrada sem tipo e op de outra entidade saem por IDENTIDADE', () => {
    // Identidade de objeto, não `deepEqual`: além de não mudar o conteúdo, a poda não pode
    // cobrar uma cópia por op no relay, que é caminho quente.
    const relevo = op({
      entityId: 'hillshade',
      data: { id: 'hillshade', type: 'hillshade', visible: true, name: 'Sombreamento', config: { source: { url: '/dem' } } },
    });
    assert.equal(pruneCatalogLayerOperation(relevo), relevo, 'hillshade não é recurso de catálogo');

    const semTipo = op({ entityId: 'wms-a', data: { id: 'wms-a', name: 'A', config: { url: '/x' } } });
    assert.equal(pruneCatalogLayerOperation(semTipo), semTipo);

    const feicao = op({ entityType: 'feature', entityId: randomUUID(), data: { nome: 'Ponto' } });
    assert.equal(pruneCatalogLayerOperation(feicao), feicao, 'nada de recurso na carga, nada a podar');

    // A LINHA QUE ESTE CASO AFIRMAVA ATÉ A F13, E QUE ERA O BURACO EM PESSOA. Aqui estava escrito
    // que uma op `feature` carregando `{ type: 'data_layer', config: {...} }` saía por IDENTIDADE,
    // com o comentário "só `catalogLayer` é assunto desta poda". O teste não estava errado sobre o
    // código: ele estava CERTO sobre um código que decidia pelo carimbo do envelope, e um teste
    // que fixa o carimbo fixa junto o vazamento. Bastava o cliente stampar outra coisa — e ele
    // stampa: renomear um mapa manda `map` com o documento inteiro dentro. A poda hoje é por
    // CONTEÚDO, então o mesmo objeto muda.
    const carimboErrado = op({
      entityType: 'feature', entityId: randomUUID(),
      data: { type: 'data_layer', config: { url: '/y' } },
    });
    const podadaPeloConteudo = pruneCatalogLayerOperation(carimboErrado);
    assert.notEqual(podadaPeloConteudo, carimboErrado, 'o carimbo do envelope não decide mais nada');
    assert.equal(podadaPeloConteudo.data.config, undefined);
    assert.equal(podadaPeloConteudo.data.type, 'data_layer', 'a referência sobrevive');
    assert.equal(podadaPeloConteudo.entityType, 'feature', 'e o envelope não é reescrito');

    // E o par positivo do teste de identidade: uma op que TEM o que perder muda de objeto.
    const comDefinicao = op({ entityId: 'data-restrita', data: definicaoCopiada() });
    assert.notEqual(pruneCatalogLayerOperation(comDefinicao), comDefinicao);
  });

  it('poda `changes` também, e tolera entrada degenerada', () => {
    const podada = pruneCatalogLayerOperation(op({
      operationType: 'update', entityId: 'data-restrita',
      data: null,
      changes: { id: 'data-restrita', type: 'data_layer', visible: false, config: { source: { url: URL_PRIVADA } } },
    }));
    assert.equal(podada.changes.config, undefined);
    assert.equal(podada.changes.visible, false);
    assert.equal(podada.data, null, '`data` nulo continua nulo');

    assert.equal(pruneCatalogLayerOperation(null), null);
    assert.equal(pruneCatalogLayerOperation('nao-e-op'), 'nao-e-op');
    assert.equal(pruneCatalogLayerOperations('nao-e-lista'), 'nao-e-lista');
  });

  it('o lote devolve o MESMO array quando não há nada a podar, e um novo quando há', () => {
    const limpo = [op({ entityType: 'feature', entityId: randomUUID() })];
    assert.equal(pruneCatalogLayerOperations(limpo), limpo);

    const sujo = [limpo[0], op({ entityId: 'data-restrita', data: definicaoCopiada() })];
    const saida = pruneCatalogLayerOperations(sujo);
    assert.notEqual(saida, sujo);
    assert.equal(saida[0], sujo[0], 'a op que nada perde é a mesma referência');
    assert.equal(saida[1].data.config, undefined);
  });
});

// ---------------------------------------------------------------------------
// O RELAY — o outro caminho, e o que faz a poda valer AO VIVO
// ---------------------------------------------------------------------------

/** Cliente falso com a superfície que o fan-out toca (molde de `collab-backpressure.test.js`). */
function clienteFalso(permission = 'read') {
  const c = {
    readyState: 1,
    bufferedAmount: 0,
    permission,
    clientId: `c_${randomUUID().slice(0, 8)}`,
    sent: [],
    send(payload) { c.sent.push(payload); },
    terminate() {},
  };
  return c;
}

describe('F12 — o relay não repassa a definição que o autor carimbou', () => {
  it('a sala recebe a op sem `config`, e a op vizinha da mesma batelada passa inteira', () => {
    // `sync.controller.js` (HTTP) e `collab.handlers.js` (WS) espalham a carga do autor VERBATIM.
    // Um cliente pré-F11 ainda aberto numa aba carimba a definição na op que escreve, e o
    // visitante de link público na mesma sala a receberia ao vivo. `broadcastOperations` é o
    // ponto por onde os dois passam.
    const leitor = clienteFalso('read');
    const atlasId = `atlas_${randomUUID()}`;
    joinRoom(atlasId, leitor);
    try {
      broadcastOperations(atlasId, [
        op({ entityId: 'data-restrita', data: definicaoCopiada() }),
        op({ entityType: 'feature', entityId: randomUUID(), data: { nome: 'Ponto' } }),
      ], { userId: 'autor' });
    } finally {
      leaveRoom(atlasId, leitor);
    }

    assert.equal(leitor.sent.length, 1, 'o leitor recebeu a batelada');
    const payload = JSON.parse(leitor.sent[0]);
    assert.equal(payload.ops.length, 2, 'as duas ops chegaram');
    const daCamada = payload.ops.find((o) => o.entityType === 'catalogLayer');
    assert.equal(daCamada.data.config, undefined, 'sem a definição');
    assert.equal(daCamada.data.id, 'data-restrita', 'com a referência');
    assert.equal(daCamada.data.visible, true, 'e o estado por atlas');
    // DISCRIMINAÇÃO: a poda não é um filtro de ops.
    assert.equal(payload.ops.find((o) => o.entityType === 'feature').data.nome, 'Ponto');
    assert.ok(!leitor.sent[0].includes(URL_PRIVADA));
  });
});
