// Path: tests/unit/borda-de-escrita-livre.test.js
//
// F14 / V-B — O CAMPO JSONB LIVRE ERA UM CANAL DE REPUBLICAÇÃO POR CONSTRUÇÃO.
//
// O que a F13 fechou foi a SAÍDA, e ela decide pelo CARIMBO que o cliente escreve (`node.type`).
// Um objeto com a forma exata de uma linha de catálogo e SEM o carimbo — `{name, config:{source:
// {url}}}` — atravessa a poda de saída intocado, de propósito: alargar o predicado de saída
// derrubaria o hillshade e a listagem REST do catálogo, que têm essa mesma forma por direito.
//
// A saída é a doutrina que a casa já aplica no resto: RESTRINGIR O QUE SE ACEITA ESCREVER. Não se
// varre da resposta o que não devia ter entrado, porque uma cópia de dado é apenas dado com forma
// de dado. Este arquivo mede a borda de entrada sozinha, sem banco: o que ela recusa, o que ela
// deixa passar (que é a metade que uma borda cega reprovaria), e que ela DESCARTA em vez de
// rejeitar.
//
// O PAR É OBRIGATÓRIO EM TODO CASO. Um teste que só afirmasse "a definição sumiu" ficaria verde
// numa borda que apagasse o payload inteiro, e poda demais é regressão tão real quanto vazamento,
// só que mais difícil de notar.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  carriesResourceDefinition, scrubResourceDefinitions,
} from '../../src/modules/catalog/resource-definition.scrub.js';
import { scrubEntityPayload, scrubOperationPayloads } from '../../src/modules/sync/free-field.schemas.js';
import { pushSchema } from '../../src/modules/sync/sync.schemas.js';
import { VALIDATION_OPTIONS } from '../../src/middleware/validate.js';
import { MAX_PRUNE_DEPTH } from '../../src/modules/catalog/resource-payload.prune.js';

const URL_PRIVADA = '/tiles/segredo-da-om/{z}/{x}/{y}.pbf';

/** A definição NUA: a forma que a poda de saída não alcança, e que é o alvo desta borda. */
const definicaoNua = () => ({ name: 'Camada restrita', config: { source: { type: 'vector', url: URL_PRIVADA } } });

const contem = (v, texto) => JSON.stringify(v).includes(texto);

describe('F14 — o predicado de forma, e o que ele NÃO acusa', () => {
  it('acusa a linha de catálogo, com e sem o carimbo `type`', () => {
    assert.equal(carriesResourceDefinition(definicaoNua()), true, 'a forma nua');
    assert.equal(
      carriesResourceDefinition({ type: 'data_layer', ...definicaoNua() }), true,
      'e a carimbada, senão a borda dependeria do mesmo carimbo que a saída',
    );
    assert.equal(carriesResourceDefinition({ config: { tiles: ['/a/{z}'] } }), true, '`config.tiles`');
    assert.equal(carriesResourceDefinition({ config: { url: '/x' } }), true, '`config.url`');
  });

  it('NÃO acusa estado de domínio, que é o custo de um predicado largo', () => {
    // Cada um destes é uma forma medida no produto. Um predicado do tipo "qualquer coisa com um
    // `config`" derrubaria os dois últimos sem nenhum sinal.
    const naoSao = [
      null, 42, 'texto', [],
      { nome: 'Ponto', descricao: 'texto livre com http://algo' },
      { name: 'Modelo 3D', escala: 2 },
      { config: { escala: 2, cor: '#fff' } },
      { source: { url: '/x' } },
    ];
    for (const v of naoSao) {
      assert.equal(carriesResourceDefinition(v), false, `${JSON.stringify(v)} não é definição`);
    }
  });

  it('tira a definição em QUALQUER profundidade, e devolve por IDENTIDADE quando não há o que tirar', () => {
    const carga = {
      a: { b: [{ c: { ninho: { ...definicaoNua(), visible: true } } }] },
      raiz: 'intacta',
    };
    const limpa = scrubResourceDefinitions(carga);
    assert.ok(!contem(limpa, URL_PRIVADA), 'a definição funda saiu');
    assert.equal(limpa.a.b[0].c.ninho.visible, true, 'e o estado ao redor dela ficou');
    assert.equal(limpa.raiz, 'intacta');

    const nada = { x: 1, y: [{ z: 'a' }] };
    assert.equal(scrubResourceDefinitions(nada), nada, 'nada a tirar: o MESMO objeto, sem cópia');
  });

  it('TETO DE PROFUNDIDADE: aninhar mais fundo que o caminhador não é contorno', () => {
    let fundo = definicaoNua();
    for (let i = 0; i < MAX_PRUNE_DEPTH + 5; i += 1) fundo = { dentro: fundo };
    assert.ok(!contem(scrubResourceDefinitions(fundo), URL_PRIVADA));
  });

  it('`__proto__` é descartado em vez de copiado', () => {
    const carga = JSON.parse('{"__proto__":{"poluido":true},"ok":1}');
    const limpa = scrubResourceDefinitions(carga);
    assert.equal(limpa.ok, 1);
    assert.equal(Object.hasOwn(limpa, '__proto__'), false);
    assert.equal({}.poluido, undefined, 'e nada foi para o Object.prototype');
  });
});

describe('F14 — a borda por entidade: o que fecha, o que só se limpa, e o teto', () => {
  it('catalogLayer: o contrabando sob `styleOverrides` some, e a chave inventada sobrevive', () => {
    // A POSIÇÃO EXATA DA REVISÃO ADVERSARIAL DA F13: uma definição carimbada corretamente, plantada
    // sob `styleOverrides` de uma entrada que o visitante tem direito de ver.
    const guardado = scrubEntityPayload('catalogLayer', {
      id: 'analysis-publica',
      type: 'analysis_layer',
      visible: true,
      opacity: 0.6,
      status: 'active',
      sourceId: 'hidro-src',
      nome: 'Hidrografia',
      umaChaveQueOServidorNaoConhece: 42,
      styleOverrides: {
        raster: { 'raster-opacity': 0.5 },
        line: { 'line-width': 2 },
        alguma: 'coisa',
        fill: { 'fill-color': ['match', ['get', 'x'], 'a', '#fff', '#000'] },
        contrabando: { type: 'data_layer', ...definicaoNua() },
      },
    });

    assert.ok(!contem(guardado, URL_PRIVADA), 'a definição plantada no estilo não pode ser guardada');

    // O PAR POSITIVO, e ele é grande de propósito: dois testes de contrato existem para PROIBIR
    // uma poda por allowlist de chave aqui.
    assert.equal(guardado.sourceId, 'hidro-src', '`sourceId` é chave inventada pelo cliente e volta');
    assert.equal(guardado.nome, 'Hidrografia', 'o `nome` em pt-BR do achado 42 também');
    assert.equal(guardado.umaChaveQueOServidorNaoConhece, 42, 'e o valor de uma chave desconhecida');
    assert.deepEqual(guardado.styleOverrides.raster, { 'raster-opacity': 0.5 });
    assert.deepEqual(guardado.styleOverrides.line, { 'line-width': 2 }, 'sub-chave que o schema de estilo nem define');
    assert.equal(guardado.styleOverrides.alguma, 'coisa', 'e um escalar no primeiro nível');
    assert.deepEqual(
      guardado.styleOverrides.fill['fill-color'], ['match', ['get', 'x'], 'a', '#fff', '#000'],
      'a expressão MapLibre atravessa inteira: ela é ARRAY, e o que se proíbe é OBJETO na folha',
    );
  });

  it('catalogLayer: o TETO ESCRITO — `name`/`config` do PRÓPRIO topo continuam entrando', () => {
    // Isto NÃO é um esquecimento, é contrato: a entrada do hillshade é literalmente
    // `{name, config.source.url}`, todo documento pré-F11 também, e dois testes de contrato exigem
    // os dois de volta. Para a entrada que RECLAMA um tipo de catálogo a poda de saída os tira de
    // qualquer forma; para a que não reclama nenhum, eles são estado opaco do cliente e viajam.
    const relevo = scrubEntityPayload('catalogLayer', {
      id: 'hillshade', type: 'hillshade', visible: true,
      name: 'Sombreamento do Relevo', config: { source: { type: 'raster-dem', url: '/dem' } },
    });
    assert.equal(relevo.config.source.url, '/dem', 'o relevo sombreado não pode sair do mapa de ninguém');
    assert.equal(relevo.name, 'Sombreamento do Relevo');
  });

  it('map: a entrada de catálogo é a mesma entrada sob qualquer carimbo, e o resto é varrido', () => {
    // Renomear um mapa reenvia o DOCUMENTO INTEIRO carimbado `map`, com `catalogLayers` dentro.
    const doc = scrubEntityPayload('map', {
      name: 'Mapa renomeado',
      catalogLayers: [
        { id: 'hillshade', type: 'hillshade', name: 'Relevo', config: { source: { url: '/dem' } } },
        { id: 'x', type: 'data_layer', visible: true, styleOverrides: { s: { p: definicaoNua() } } },
      ],
      analysis_layers: { camadas: [{ id: 'y', visible: true, ...definicaoNua() }], los_result_1: { visible: true, data: {} } },
      grid_style: { format: 'utm', visible: true, lixo: { name: 'a', config: { url: '/b' } } },
    });

    assert.ok(!contem(doc, URL_PRIVADA), 'nenhum dos três portadores aceita a definição');
    assert.equal(doc.name, 'Mapa renomeado', 'o rename continua sendo o gesto');
    assert.equal(doc.catalogLayers[0].config.source.url, '/dem', 'e o hillshade continua entrando');
    assert.equal(doc.catalogLayers[1].visible, true, 'o estado por atlas da camada fica');
    assert.equal(doc.analysis_layers.camadas[0].visible, true, 'e o da coluna irmã também');
    assert.deepEqual(
      doc.analysis_layers.los_result_1, { visible: true, data: {} },
      'a coluna irmã é VARRIDA e não fechada: seu contrato tem valor aninhado dentro',
    );
    assert.deepEqual(doc.grid_style, { format: 'utm', visible: true }, '`grid_style` é FECHADO a escalares');
  });

  it('as colunas FECHADAS: escalar entra, objeto não', () => {
    const casos = [
      ['gridStyle', { grid_style: { format: 'utm', visible: true, x: { name: 'a', config: { url: '/b' } } } },
        (v) => assert.deepEqual(v.grid_style, { format: 'utm', visible: true })],
      ['mapTemporal', { temporal_config: { ativo: true, modo: 'relativo', unidade: 'h', inicio: 1, fim: 2, origem: null, x: {} } },
        (v) => assert.deepEqual(v.temporal_config, { ativo: true, modo: 'relativo', unidade: 'h', inicio: 1, fim: 2, origem: null })],
      ['briefing', { name: 'B', settings: { panelPosition: 'left', panelWidth: 320, x: definicaoNua() } },
        (v) => assert.deepEqual(v.settings, { panelPosition: 'left', panelWidth: 320 })],
      ['slide', { position: { longitude: -45, latitude: -20, zoom: 10, x: definicaoNua() }, orientation: { bearing: 0, pitch: 30 } },
        (v) => { assert.deepEqual(v.position, { longitude: -45, latitude: -20, zoom: 10 }); assert.deepEqual(v.orientation, { bearing: 0, pitch: 30 }); }],
      ['layer', { name: 'L', style: { color: '#fff', x: definicaoNua() } },
        (v) => assert.deepEqual(v.style, { color: '#fff' })],
      ['group', { name: 'G', style: { color: '#fff', x: definicaoNua() } },
        (v) => assert.deepEqual(v.style, { color: '#fff' })],
      ['comment', { id: 'c1', lng: 1, lat: 2, text: 'oi', status: 'open', authorColor: null, x: definicaoNua() },
        (v) => { assert.equal(v.text, 'oi'); assert.equal(v.authorColor, null); assert.equal(v.x, undefined); }],
    ];
    for (const [entidade, carga, conferir] of casos) {
      const saida = scrubEntityPayload(entidade, carga);
      assert.ok(!contem(saida, URL_PRIVADA), `${entidade}: a definição não pode ser guardada`);
      conferir(saida);
    }
  });

  it('as colunas VARRIDAS do domínio: a feição e o 3D/360 chegam inteiros, menos a definição', () => {
    const feicao = scrubEntityPayload('feature', {
      id: 'f1',
      feature_type: 'polygon',
      geometry: { type: 'MultiPolygon', coordinates: [[[[-45, -20], [-44, -20], [-44, -19], [-45, -20]]]] },
      properties: { nome: 'Área', descricao: null, visivel: true, contrabando: definicaoNua() },
    });
    assert.ok(!contem(feicao, URL_PRIVADA));
    assert.equal(feicao.geometry.coordinates[0][0][0][0], -45, 'a geometria não é tocada');
    assert.equal(feicao.properties.nome, 'Área');
    assert.equal(feicao.properties.descricao, null, '`null` continua sendo `null`, e não some');
    assert.equal(feicao.properties.visivel, true);

    const marcador = scrubEntityPayload('marker3d', {
      data: { position: { x: 1, y: 2, z: 3 }, label: 'Alvo', contrabando: definicaoNua() },
    });
    assert.ok(!contem(marcador, URL_PRIVADA));
    assert.deepEqual(marcador.data.position, { x: 1, y: 2, z: 3 }, 'o objeto aninhado do domínio fica');
    assert.equal(marcador.data.label, 'Alvo');
  });

  it('a RAIZ do payload também é julgada, que é onde um andar acima ficaria cego', () => {
    const solta = scrubEntityPayload('feature', { ...definicaoNua(), properties: { nome: 'P' } });
    assert.ok(!contem(solta, URL_PRIVADA), 'a definição no topo de um payload de feição não entra');
    assert.equal(solta.properties.nome, 'P');
  });

  it('mapPosition: o regime FECHADO derruba `sync`, e o que sobra é a posição inteira', () => {
    // O UNICO PONTO EM QUE O REGIME FECHADO TIRA ALGO DE UM ESCRITOR REAL, e ele está escrito no
    // cabeçalho porque foi MEDIDO, não suposto: `updateMapPosition` (`map.operations.js`) monta
    // `{id, center_lat, center_long, zoom, bearing, pitch, savedAt, sync}` e `sync` é objeto
    // (`createSyncMetadata`). Este caso existe para que a queda seja um fato afirmado e não uma
    // frase de comentário, que foi a classe de defeito que abriu esta fase (V-C).
    const posicao = scrubEntityPayload('mapPosition', {
      id: 'pos-1',
      center_lat: -22.9,
      center_long: -43.2,
      zoom: 12,
      bearing: 0,
      pitch: 45,
      savedAt: 1700000000000,
      sync: {
        createdAt: 1, updatedAt: 1, version: 1, ownerId: null,
        dirty: true, deleted: false, deletedAt: null,
      },
    });

    assert.equal(posicao.sync, undefined, '`sync` é objeto e o regime fechado não o guarda');

    // O PAR POSITIVO, e é ele que diz que a queda é inerte: as cinco colunas que
    // `MAP_SUBTYPE_FIELDS.position` realmente grava chegam intactas, e `id`/`savedAt` também.
    // Nem `sync` nem `id` nem `savedAt` jamais foram gravados (a whitelist de coluna já os
    // descartava) nem devolvidos (`GET_ATLAS_MAPS` seleciona só as cinco colunas planas), então
    // depois de qualquer reload os dois pares já estavam sem `sync`.
    assert.equal(posicao.center_lat, -22.9);
    assert.equal(posicao.center_long, -43.2);
    assert.equal(posicao.zoom, 12);
    assert.equal(posicao.bearing, 0, '`0` é valor, não ausência');
    assert.equal(posicao.pitch, 45);
    assert.equal(posicao.id, 'pos-1');
    assert.equal(posicao.savedAt, 1700000000000);
  });
});

describe('F14 — a borda DESCARTA, nunca rejeita, e as duas portas concordam', () => {
  const op = (extra) => ({
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType: 'create',
    entityId: 'analysis-x',
    mapId: randomUUID(),
    timestamp: Date.now(),
    clientId: 'c-1',
    ...extra,
  });

  it('uma op com definição plantada é ACEITA, e chega ao serviço sem a definição', () => {
    // 400 numa op de sync não devolve uma op: ele congela a fila de saída inteira do cliente, que
    // é defeito conhecido desta casa. O descarte silencioso é a única direção de falha aceitável.
    const bruta = op({ data: { type: 'analysis_layer', visible: true, styleOverrides: { s: { p: definicaoNua() } } } });
    const { error, value } = pushSchema.validate({ operations: [bruta] }, VALIDATION_OPTIONS);
    assert.equal(error, undefined, 'nada é rejeitado');
    assert.ok(!contem(value.operations[0], URL_PRIVADA), 'e nada da definição sobrou');
    assert.equal(value.operations[0].data.visible, true, 'com o resto da op de pé');
    assert.equal(value.operations[0].id, bruta.id, 'e a identidade da op intacta');
  });

  it('`traceId`, `atlasId` e `scopeSuffix` continuam atravessando (o custo de um `.custom` desatento)', () => {
    const bruta = op({ data: { visible: true }, traceId: 't-1', atlasId: 'a-1', scopeSuffix: 'remote-a-1' });
    const { error, value } = pushSchema.validate({ operations: [bruta] }, VALIDATION_OPTIONS);
    assert.equal(error, undefined);
    assert.equal(value.operations[0].traceId, 't-1');
    assert.equal(value.operations[0].atlasId, 'a-1');
    assert.equal(value.operations[0].scopeSuffix, 'remote-a-1');
  });

  it('`previousData` é varrido junto: ele não é guardado, mas VIAJA para os pares no relay', () => {
    const bruta = op({
      entityType: 'feature',
      data: { properties: { nome: 'Ponto' } },
      previousData: { properties: { nome: 'Ponto', antigo: definicaoNua() } },
    });
    const { value } = pushSchema.validate({ operations: [bruta] }, VALIDATION_OPTIONS);
    assert.ok(!contem(value.operations[0], URL_PRIVADA));
  });

  it('uma op sem nada a limpar sai por IDENTIDADE do envelope', () => {
    const bruta = op({ entityType: 'feature', data: { properties: { nome: 'Ponto' } } });
    assert.equal(scrubOperationPayloads(bruta), bruta);
  });

  it('o vocabulário LEGADO (`target`) escolhe a mesma regra que `entityType`', () => {
    // O envelope aceita os dois vocabulários, e uma regra que só olhasse `entityType` deixaria a
    // metade legada sem borda nenhuma.
    const legada = {
      id: randomUUID(), target: 'catalogLayer', type: 'create', targetId: 'analysis-x',
      mapId: randomUUID(), timestamp: Date.now(), clientId: 'c-1',
      data: { type: 'analysis_layer', visible: true, styleOverrides: { s: { p: definicaoNua() } } },
    };
    const { error, value } = pushSchema.validate({ operations: [legada] }, VALIDATION_OPTIONS);
    assert.equal(error, undefined);
    assert.ok(!contem(value.operations[0], URL_PRIVADA));
    assert.equal(value.operations[0].data.visible, true);
  });
});
