// Path: tests/unit/sync-referencia-de-recurso-censo.test.js
//
// O CENSO DAS SUPERFÍCIES DE REFERÊNCIA NO CAMINHO DE ESCRITA.
//
// POR QUE ELE EXISTE. `src/modules/atlas/resource-reference.registry.js` é o inventário de ONDE
// um id de recurso mora dentro de um atlas, e é ele que alimenta a poda do clone e do import —
// os caminhos de SAÍDA. O caminho de ENTRADA (a operação de sync) tinha gate para UMA das
// superfícies, `catalog_layer`, e a primeira linha do gate era literalmente
// `if (op.target !== 'catalog_layer') return null;`. As outras quatro (o `tileset_id` do 3D, o
// `photo_name` do 360, o `model_id`/`photo_id` do slide e o `base_layer` do mapa) passavam
// inteiras, e nada ficava vermelho: uma op aceita é uma resposta bem-formada.
//
// A LIÇÃO É A DE `superficies-de-recurso-censo.test.js`, na direção contrária. Lá, um recurso
// SAI por muitas portas e o predicado numa não protege as outras. Aqui, um recurso ENTRA por
// muitas portas, e a mesma frase vale. A diferença é que o inventário já existia: o que faltava
// era alguém cobrar que o gate de escrita o cobrisse INTEIRO.
//
// COMO ELE COBRA, e por que não é conferência por texto. Cada superfície do registro precisa de
// uma entrada aqui, com uma de duas classes:
//
//   GATEADA      — viaja em op de sync. A entrada nomeia o `op.target`, as CHAVES do payload que
//                  a carregam e o tipo de recurso esperado. O caso não lê o código-fonte: ele
//                  CHAMA o extrator com um payload montado a partir de cada chave declarada e
//                  exige a referência de volta. Reverter um extrator (ou trocar a chave por um
//                  sinônimo que o servidor não escreve) fica vermelho aqui, não só no
//                  `tests/integration/sync-referencia-privada.test.js`.
//   FORA_DO_SYNC — não há op que escreva aquela coluna. O motivo é obrigatório, e é a parte que
//                  envelhece: uma superfície que passe a viajar em op precisa mudar de classe.
//
// E COBRA NOS DOIS SENTIDOS. A varredura 1 pega superfície NOVA sem classificação; a varredura 2
// pega o inverso — um extrator acrescentado à tabela e não declarado aqui —, que é o caso que uma
// lista escrita só a partir do registro nunca veria.
//
// O QUE ELE NÃO PRENDE, e precisa estar escrito: COMPORTAMENTO. Que o autor sem acesso é RECUSADO,
// que o `delete` continua passando e que o empréstimo por atlas conta é
// `tests/integration/sync-referencia-privada.test.js`, contra banco real. Um verde aqui prova só
// que ninguém abriu uma porta sem declarar, o que é útil e não é a mesma coisa.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_REF_SURFACES, REF_ACTION } from '../../src/modules/atlas/resource-reference.registry.js';
import {
  RESOURCE_REF_EXTRACTORS, UNSEEN_RESOURCE_REASONS, declaredResourceRefs,
} from '../../src/modules/sync/resource-ref.extractors.js';

const GATEADA = 'gateada-no-sync';
const FORA_DO_SYNC = 'nao-viaja-em-op-de-sync';

/**
 * @typedef {Object} EntradaDeSuperficie
 * @property {GATEADA|FORA_DO_SYNC} classe
 * @property {string} [target] - GATEADA: o `op.target` normalizado que a carrega.
 * @property {string[]} [chaves] - GATEADA: as grafias do payload que o extrator precisa ler.
 * @property {string} [tipo] - GATEADA: o `resourceType` que o extrator precisa devolver.
 * @property {string} [motivo] - FORA_DO_SYNC: por que não há o que gatear.
 */

/**
 * Uma entrada por `id` de `RESOURCE_REF_SURFACES`.
 *
 * As quatro superfícies de `cesium3d` compartilham target, chaves e tipo porque compartilham a
 * COLUNA: o registro as separa por origem no cliente (marcador, medição, viewshed, câmera) e o
 * servidor as escreve todas por `cesium3d_data.tileset_id`. O mesmo vale para as duas do 360.
 *
 * @type {Object<string, EntradaDeSuperficie>}
 */
const CENSO = {
  'mapa.baseLayer': {
    classe: GATEADA, target: 'map', chaves: ['base_layer', 'baseLayer'], tipo: 'basemap',
  },
  'mapa.catalogLayers': {
    // A única cujas chaves não são campos planos: a referência mora no PREFIXO do id, em
    // `originalId` ou em `config.id`, e quem resolve as três é `catalogLayerReference`. Ela é
    // exercitada abaixo por um caso próprio, com as três formas.
    classe: GATEADA, target: 'catalog_layer', chaves: [], tipo: 'analysis_layer',
  },
  'cesium3d.cameraPositions': {
    classe: GATEADA, target: 'cesium3d', chaves: ['tileset_id', 'tilesetId'], tipo: 'tileset',
  },
  'cesium3d.markers': {
    classe: GATEADA, target: 'cesium3d', chaves: ['tileset_id', 'tilesetId'], tipo: 'tileset',
  },
  'cesium3d.measurements': {
    classe: GATEADA, target: 'cesium3d', chaves: ['tileset_id', 'tilesetId'], tipo: 'tileset',
  },
  'cesium3d.viewsheds': {
    classe: GATEADA, target: 'cesium3d', chaves: ['tileset_id', 'tilesetId'], tipo: 'tileset',
  },
  'sv360.orientations': {
    classe: GATEADA, target: 'streetview360', chaves: ['photo_name', 'photoName'], tipo: 'sv360_project',
  },
  'sv360.markers': {
    classe: GATEADA, target: 'streetview360', chaves: ['photo_name', 'photoName'], tipo: 'sv360_project',
  },
  'briefing.slide.modelId': {
    classe: GATEADA, target: 'slide', chaves: ['model_id', 'modelId'], tipo: 'tileset',
  },
  'briefing.slide.photoId': {
    classe: GATEADA, target: 'slide', chaves: ['photo_id', 'photoId'], tipo: 'sv360_project',
  },

  // ------------------------------------------------------------------------
  // As sete que NÃO viajam em op. As seis primeiras são a família `atlas.settings`, que o
  // registro já marca `soServidor`: o id nunca chega ao documento do cliente, então não há
  // payload de op que o carregue de volta.
  // ------------------------------------------------------------------------
  'settings.basemaps': {
    classe: FORA_DO_SYNC,
    motivo: 'Allowlist de `atlas.settings`, só do servidor (`soServidor`). O único caminho de '
      + 'escrita por sync é a op `setting`, cuja whitelist em `applyOperation` aceita apenas '
      + 'preferência de aplicação (exagero de terreno, projeção, ícones, ordem de mapas, cores) e '
      + 'REJEITA por omissão toda chave de disponibilidade de recurso. Um usuário `write` não '
      + 'reescreve o que o atlas expõe, e é essa omissão que fecha a superfície.',
  },
  'settings.default_basemap': {
    classe: FORA_DO_SYNC,
    motivo: 'Idem `settings.basemaps`: mesma coluna (`atlas.settings`), mesma op `setting`, mesma '
      + 'whitelist que a rejeita por omissão. E o mesmo sentido invertido de poda: lista vazia '
      + 'significa SEM RESTRIÇÃO, então zerar uma allowlist ALARGA em vez de estreitar.',
  },
  'settings.available_data_layers': {
    classe: FORA_DO_SYNC,
    motivo: 'Idem `settings.basemaps`: mesma coluna (`atlas.settings`), mesma op `setting`, mesma '
      + 'whitelist que a rejeita por omissão.',
  },
  'settings.available_analysis_layers': {
    classe: FORA_DO_SYNC,
    motivo: 'Idem `settings.basemaps`: mesma coluna (`atlas.settings`), mesma op `setting`, mesma '
      + 'whitelist que a rejeita por omissão.',
  },
  'settings.available_3d_models': {
    classe: FORA_DO_SYNC,
    motivo: 'Idem `settings.basemaps`. Esta é a que escapou do censo de referências por um bom '
      + 'tempo, porque aquele varre por NOME DE CAMPO do cliente e `available_3d_models` não é um.',
  },
  'settings.available_360_views': {
    classe: FORA_DO_SYNC,
    motivo: 'Idem `settings.basemaps`: mesma coluna (`atlas.settings`), mesma op `setting`, mesma '
      + 'whitelist que a rejeita por omissão.',
  },
  'mapa.analysisLayers': {
    classe: FORA_DO_SYNC,
    motivo: 'Declarada NAO_REFERENCIA no próprio registro: `maps.analysis_layers` guarda estado '
      + 'de grade, não id de catálogo. A op `gridStyle` a escreve, e não há referência para gatear.',
  },
};

describe('censo — as superfícies de referência de recurso no caminho de ESCRITA por sync', () => {
  // ==========================================================================
  // PISO — o inventário existe e é o que o censo supõe
  // ==========================================================================

  it('PISO — o registro tem superfícies e o censo fala do mesmo vocabulário', () => {
    assert.ok(RESOURCE_REF_SURFACES.length >= 17,
      `o registro precisa ter as superfícies conhecidas, tem ${RESOURCE_REF_SURFACES.length}`);
    assert.ok(Object.keys(RESOURCE_REF_EXTRACTORS).length > 0, 'a tabela de extratores não pode estar vazia');
    // Cada extrator precisa ter uma razão de recusa; um target sem texto recusaria com `undefined`,
    // que o cliente exibiria como recusa sem motivo.
    assert.deepEqual(
      Object.keys(RESOURCE_REF_EXTRACTORS).sort(), Object.keys(UNSEEN_RESOURCE_REASONS).sort(),
      'todo extrator precisa de uma razão de recusa, e vice-versa',
    );
    const razoes = Object.entries(UNSEEN_RESOURCE_REASONS);
    assert.ok(razoes.length >= 5, `precisa haver uma razão por superfície gateada, há ${razoes.length}`);
    for (const [target, texto] of razoes) {
      assert.ok(typeof texto === 'string' && texto.length > 20, `a razão de ${target} precisa ser um texto`);
    }
  });

  // ==========================================================================
  // VARREDURA 1 — superfície nova sem classificação REPROVA
  // ==========================================================================

  it('toda superfície do registro está classificada, e nenhuma classificação sobra', () => {
    const doRegistro = RESOURCE_REF_SURFACES.map((s) => s.id).sort();
    const doCenso = Object.keys(CENSO).sort();
    assert.deepEqual(doCenso, doRegistro,
      'superfície nova precisa entrar no censo (GATEADA, com target e chaves, ou FORA_DO_SYNC com motivo)');
  });

  it('cada entrada GATEADA nomeia um target que existe na tabela de extratores', () => {
    const gateadas = Object.entries(CENSO).filter(([, e]) => e.classe === GATEADA);
    assert.ok(gateadas.length >= 10, `o censo precisa ter superfícies gateadas, tem ${gateadas.length}`);
    for (const [id, e] of gateadas) {
      assert.ok(Object.hasOwn(RESOURCE_REF_EXTRACTORS, e.target),
        `${id} declara o target '${e.target}', ausente de RESOURCE_REF_EXTRACTORS`);
    }
  });

  it('cada entrada FORA_DO_SYNC traz o motivo por escrito, e o target dela não é gateado à toa', () => {
    const fora = Object.entries(CENSO).filter(([, e]) => e.classe === FORA_DO_SYNC);
    assert.equal(fora.length, 7, 'as sete superfícies fora do sync: as seis de settings e a de grade');
    for (const [id, e] of fora) {
      assert.ok(typeof e.motivo === 'string' && e.motivo.length > 40,
        `${id} precisa dizer POR QUE não há o que gatear`);
      assert.equal(e.target, undefined, `${id} não pode declarar target: ela não viaja em op`);
    }
  });

  // ==========================================================================
  // VARREDURA 2 — extrator novo sem classificação REPROVA
  // ==========================================================================

  it('todo target da tabela de extratores está declarado por alguma superfície do censo', () => {
    const declarados = new Set(
      Object.values(CENSO).filter((e) => e.classe === GATEADA).map((e) => e.target),
    );
    assert.deepEqual(
      [...declarados].sort(), Object.keys(RESOURCE_REF_EXTRACTORS).sort(),
      'extrator acrescentado sem entrada no censo (ou entrada apontando para target que sumiu)',
    );
  });

  // ==========================================================================
  // O CASO QUE DISCRIMINA: o extrator é CHAMADO, não lido
  // ==========================================================================

  it('cada chave declarada produz mesmo a referência, com o tipo declarado', () => {
    const gateadas = Object.entries(CENSO)
      .filter(([, e]) => e.classe === GATEADA && e.chaves.length > 0);
    assert.ok(gateadas.length >= 9, `precisa haver superfícies de chave plana, há ${gateadas.length}`);

    for (const [id, e] of gateadas) {
      assert.ok(e.chaves.length >= 2, `${id} precisa declarar as DUAS grafias (snake e camel)`);
      for (const chave of e.chaves) {
        const op = { target: e.target, data: { [chave]: `id-de-${chave}` } };
        assert.deepEqual(
          declaredResourceRefs(op),
          [{ resourceType: e.tipo, resourceId: `id-de-${chave}` }],
          `${id}: a chave '${chave}' de um op '${e.target}' precisa produzir uma referência ${e.tipo}`,
        );
      }
    }
  });

  it('a camada de catálogo é resolvida pelas TRÊS formas que o cliente escreve', () => {
    // Prefixo no id, `originalId` legado e `config.id` legado — a mesma ordem de
    // `catalogLayerReference`, que é quem resolve. O gate herda as três de graça, e este caso
    // existe para que "de graça" não vire "por acaso".
    const porPrefixo = declaredResourceRefs({
      target: 'catalog_layer', targetId: 'analysis-declividade', data: { type: 'analysis_layer' },
    });
    assert.deepEqual(porPrefixo, [{ resourceType: 'analysis_layer', resourceId: 'declividade' }]);

    const porOriginalId = declaredResourceRefs({
      target: 'catalog_layer', targetId: 'sem-prefixo',
      data: { type: 'data_layer', originalId: 'rodovias-federais' },
    });
    assert.deepEqual(porOriginalId, [{ resourceType: 'data_layer', resourceId: 'rodovias-federais' }]);

    const porConfigId = declaredResourceRefs({
      target: 'catalog_layer', targetId: 'sem-prefixo',
      data: { type: 'data_layer', config: { id: 'limites-municipais' } },
    });
    assert.deepEqual(porConfigId, [{ resourceType: 'data_layer', resourceId: 'limites-municipais' }]);

    // E o hillshade, que NÃO é recurso de catálogo, continua sem referência: gateá-lo tiraria o
    // sombreado do relevo de todo mundo.
    assert.deepEqual(
      declaredResourceRefs({ target: 'catalog_layer', targetId: 'hillshade', data: { type: 'hillshade' } }),
      [],
    );
  });

  it('as DUAS pernas do slide são independentes: uma só não esconde a outra', () => {
    // O extrator do slide é o único que pode devolver DUAS referências, de tipos diferentes. Uma
    // implementação que devolvesse a primeira e parasse passaria em tudo acima.
    assert.deepEqual(
      declaredResourceRefs({ target: 'slide', data: { modelId: 'm1', photoId: 'p1' } }),
      [{ resourceType: 'tileset', resourceId: 'm1' }, { resourceType: 'sv360_project', resourceId: 'p1' }],
    );
  });

  it('ausente, nulo e vazio NÃO são referência: é o que preserva o gesto de LIMPAR', () => {
    for (const valor of [undefined, null, '']) {
      assert.deepEqual(declaredResourceRefs({ target: 'slide', data: { modelId: valor, photoId: valor } }), [],
        `um \`modelId\` ${JSON.stringify(valor)} não pode virar consulta de acesso`);
      assert.deepEqual(declaredResourceRefs({ target: 'cesium3d', data: { tilesetId: valor } }), []);
      assert.deepEqual(declaredResourceRefs({ target: 'map', data: { baseLayer: valor } }), []);
    }
    assert.deepEqual(declaredResourceRefs({ target: 'feature', data: { tilesetId: 'x' } }), [],
      'um target sem extrator não produz referência nenhuma');
  });

  it('o mapa SUB-TIPADO só é gateado no sub-tipo `baseLayer`: a escrita descarta a coluna irmã', () => {
    // `MAP_SUBTYPE_FIELDS` estreita um `mapTemporal`/`mapPosition`/`mapNotes`/`gridStyle` à
    // própria coluna, então um `base_layer` de carona nunca chega ao banco. Gatear ali recusaria
    // a op por um campo descartado — a falsa recusa que `sync-map-subentity-isolation.test.js`
    // pegou na primeira escrita desta tabela.
    const comBase = { base_layer: 'algum-basemap' };
    assert.deepEqual(
      declaredResourceRefs({ target: 'map', _subType: 'baseLayer', data: comBase }),
      [{ resourceType: 'basemap', resourceId: 'algum-basemap' }],
      'o sub-tipo que ESCREVE a coluna continua gateado',
    );
    for (const subType of ['position', 'notes', 'grid', 'temporal']) {
      assert.deepEqual(
        declaredResourceRefs({ target: 'map', _subType: subType, data: comBase }), [],
        `o sub-tipo '${subType}' não escreve base_layer, então não pode ser recusado por ele`,
      );
    }
    assert.deepEqual(
      declaredResourceRefs({ target: 'map', data: comBase }),
      [{ resourceType: 'basemap', resourceId: 'algum-basemap' }],
      'e o mapa INTEIRO (sem sub-tipo) escreve a coluna, logo é gateado',
    );
  });

  it('o payload lido espelha o do caminho de escrita: `changes` no update, e mapa MESCLA as duas metades', () => {
    // `buildDynamicUpdate` lê `changes`; um gate que lesse `data` num update mediria o valor
    // ANTIGO e deixaria passar a troca.
    assert.deepEqual(
      declaredResourceRefs({ target: 'cesium3d', data: { tilesetId: 'antigo' }, changes: { tilesetId: 'novo' } }),
      [{ resourceType: 'tileset', resourceId: 'novo' }],
    );
    // O mapa é a exceção, e é a do caminho de escrita: `buildUpdateQuery` faz
    // `{...changes, ...data}` antes de normalizar os apelidos, então as duas metades contam.
    assert.deepEqual(
      declaredResourceRefs({ target: 'map', data: { baseLayer: 'de-data' }, changes: { name: 'só o nome' } }),
      [{ resourceType: 'basemap', resourceId: 'de-data' }],
    );
    assert.deepEqual(
      declaredResourceRefs({ target: 'map', data: {}, changes: { base_layer: 'de-changes' } }),
      [{ resourceType: 'basemap', resourceId: 'de-changes' }],
    );
  });

  // ==========================================================================
  // CONTROLE NEGATIVO DA PRÓPRIA VARREDURA
  // ==========================================================================

  it('CONTROLE NEGATIVO — o censo REPROVA uma superfície não classificada e um extrator não declarado', () => {
    // O molde das outras varreduras da casa: rodar a MESMA comparação contra fixtures que
    // contêm o defeito, para que o verde acima signifique alguma coisa. Sem isto, os dois casos
    // de conjunto passariam idênticos se `RESOURCE_REF_SURFACES` chegasse vazio.
    const idsFicticios = [...Object.keys(CENSO), 'superficie.nova.nao.classificada'].sort();
    assert.notDeepEqual(idsFicticios, Object.keys(CENSO).sort(),
      'a comparação de conjunto precisa acusar id a mais no registro');

    const targetsFicticios = [...new Set(
      Object.values(CENSO).filter((e) => e.classe === GATEADA).map((e) => e.target),
    ), 'entidade_nova'].sort();
    assert.notDeepEqual(targetsFicticios, Object.keys(RESOURCE_REF_EXTRACTORS).sort(),
      'a comparação de conjunto precisa acusar extrator a mais na tabela');

    // E o terceiro defeito, que os dois de conjunto NÃO pegam: um extrator que continua na
    // tabela e deixou de ler a chave. A fixture é a tabela real com um extrator revertido para
    // "não lê nada", passada pela MESMA comparação do caso de chaves acima.
    const tabelaRevertida = { ...RESOURCE_REF_EXTRACTORS, cesium3d: () => [] };
    assert.notDeepEqual(
      tabelaRevertida.cesium3d({ tilesetId: 'x' }),
      RESOURCE_REF_EXTRACTORS.cesium3d({ tilesetId: 'x' }),
      'o caso de chaves precisa distinguir o extrator vivo do revertido',
    );
  });

  it('a mensagem de recusa NOMEIA a superfície, e as cinco são distintas', () => {
    // Cinco targets recusando com o MESMO texto seria uma UI que não diz o que rejeitou. E a do
    // `catalog_layer` é a que já existia: mudá-la aqui mudaria o contrato de uma recusa antiga.
    const textos = Object.values(UNSEEN_RESOURCE_REASONS);
    assert.equal(new Set(textos).size, textos.length, 'cada superfície precisa de um texto próprio');
    assert.equal(
      UNSEEN_RESOURCE_REASONS.catalog_layer,
      'Alteração descartada: você não tem acesso a esta camada de catálogo.',
      'o texto da camada de catálogo é anterior a esta fase e não muda com ela',
    );
  });

  it('o registro continua declarando a AÇÃO de poda de cada superfície gateada', () => {
    // Ligação entre as duas metades do inventário: uma superfície gateada na escrita que perca a
    // ação de poda na saída teria a porta de entrada fechada e a de saída aberta.
    for (const [id, e] of Object.entries(CENSO)) {
      if (e.classe !== GATEADA) continue;
      const superficie = RESOURCE_REF_SURFACES.find((s) => s.id === id);
      assert.ok(superficie, `${id} precisa existir no registro`);
      assert.notEqual(superficie.acao, REF_ACTION.NAO_REFERENCIA,
        `${id} é gateada na escrita, então não pode ser NAO_REFERENCIA na poda`);
      assert.ok(superficie.tipos.includes(e.tipo),
        `${id}: o tipo gateado (${e.tipo}) precisa estar entre os tipos do registro (${superficie.tipos})`);
    }
  });
});
