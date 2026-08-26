// Path: tests/unit/ferramenta-tardia-responde-ao-clique.test.js

/**
 * @fileoverview O CAMINHO QUE NAO TINHA COBERTURA, e que a carga tardia poe em risco.
 *
 * Clicar numa feicao JA DESENHADA num mapa recem carregado procura o controle POR TIPO no
 * SelectionManager, sem gesto de ferramenta nenhum. Enquanto toda ferramenta era instanciada no
 * boot, `this.controls` respondia sempre e nao havia o que testar. Depois de
 * `tool_manager/tool-registry.js`, dezesseis ferramentas so existem depois de alguem as pedir, e
 * a pergunta "quem responde pela seta enquanto `military_tools` ainda nao veio?" passou a ter
 * duas respostas erradas possiveis, as duas SILENCIOSAS:
 *
 *   (a) a varredura de clique nao acha a feicao, e ela vira desenho que nao se pode selecionar;
 *   (b) a varredura ACHA e carrega a ferramenta so para descobrir onde ela guarda as coisas,
 *       o que devolveria o peso ao boot pela porta dos fundos, na primeira renderizacao.
 *
 * A saida foi o DESCRITOR: metadado estatico (fontes e alca de edicao) respondido de forma
 * sincrona, e o modulo resolvido so quando a selecao de fato acontece. Este arquivo prende as
 * duas metades, e prende tambem que a segunda selecao NAO carrega de novo.
 *
 * CONTROLE DE VACUO: o duble de ferramenta conta quantas vezes foi pedido. Sem o contador, um
 * `ensure` que rodasse a cada clique passaria verde em todo caso de selecao aqui.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// A suite roda em ambiente `node`, e o SelectionManager pendura um `keydown` no documento no
// construtor. Nada abaixo depende de DOM de verdade, entao o mínimo basta.
globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} };
afterAll(() => { delete globalThis.document; });

// ---------------------------------------------------------------------------------------------
// A store, reduzida ao que o SelectionManager le nos caminhos exercitados aqui.
// ---------------------------------------------------------------------------------------------

const selecionadas = new Map();

const stateManagerFalso = {
    isFeatureSelected: (tipo, id) => selecionadas.has(`${tipo}:${id}`),
    addToSelection: (tipo, id, feicao) => selecionadas.set(`${tipo}:${id}`, feicao),
    removeFromSelection: (tipo, id) => selecionadas.delete(`${tipo}:${id}`),
    clearSelection: () => selecionadas.clear(),
    getSelectionCount: () => selecionadas.size,
    getSelectedFeatures: () => [...selecionadas.entries()].map(([chave, feicao]) => {
        const [type, id] = chave.split(':');
        return { type, id, feature: feicao };
    }),
    batchUpdate: (fn) => fn(),
    setActiveTool: () => {},
    subscribe: () => () => {}
};

vi.mock('../../src/js/store', () => ({
    getFeatureGroup: () => null,
    getVisibleLayerIds: () => ['default'],
    isFeatureEffectivelyLocked: () => false,
    isCurrentMapLockedSync: () => false,
    getStateManager: () => stateManagerFalso,
    getControl: () => null,
    startBatchUndo: () => {},
    commitBatchUndo: () => {},
    discardBatchUndo: () => {},
    getFeatureIcon: () => '',
    getFeatureById: async () => null,
    getStorageTypeFromSource: (tipo) => tipo
}));

vi.mock('../../src/js/utilities/pointer-utils', () => ({
    createTwoFingerTapHandler: () => () => {}
}));

const { default: SelectionManager } = await import('../../src/js/tool_manager/selection_manager.js');

// ---------------------------------------------------------------------------------------------
// Os dubles
// ---------------------------------------------------------------------------------------------

/** Uma seta desenhada, como o `queryRenderedFeatures` a devolve. */
const SETA_NO_MAPA = Object.freeze({
    source: 'arrows',
    properties: { id: 'seta-1', source: 'arrow', layerId: 'default' },
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
});

/**
 * Mapa falso: devolve a seta desenhada em qualquer clique, e uma fonte que sabe entregar a
 * geometria completa dela.
 * @returns {Object}
 */
function mapaFalso() {
    return {
        queryRenderedFeatures: () => [SETA_NO_MAPA],
        getSource: (nome) => (nome === 'arrows'
            ? { getData: async () => ({ features: [SETA_NO_MAPA] }) }
            : null),
        getZoom: () => 12,
        on: () => {},
        off: () => {},
        getContainer: () => elementoFalso(),
        getCanvasContainer: () => elementoFalso()
    };
}

/**
 * Elemento de DOM reduzido ao que os handlers do SelectionManager penduram nele.
 * @returns {Object}
 */
function elementoFalso() {
    return { addEventListener: () => {}, removeEventListener: () => {}, style: {} };
}

/**
 * A ferramenta tardia mais o descritor que a representa antes de existir.
 * @returns {{descritor: Object, controle: Object, cargas: {n: number}}}
 */
function ferramentaTardia() {
    const cargas = { n: 0 };
    const controle = {
        selecionadas: [],
        deselecionadas: [],
        onFeatureSelected(feicao) { this.selecionadas.push(feicao); },
        onFeatureDeselected(feicao) { this.deselecionadas.push(feicao); },
        getSourceNames: () => ['arrows'],
        getEditHandleSource: () => 'arrow-edit-handles'
    };
    const descritor = {
        getSourceNames: () => ['arrows'],
        getEditHandleSource: () => 'arrow-edit-handles',
        ensure: async () => { cargas.n += 1; return controle; }
    };
    return { descritor, controle, cargas };
}

// ---------------------------------------------------------------------------------------------
// Os casos
// ---------------------------------------------------------------------------------------------

describe('SelectionManager com ferramenta ainda nao carregada', () => {
    let sm;
    let tardia;

    beforeEach(() => {
        selecionadas.clear();
        sm = new SelectionManager(mapaFalso());
        tardia = ferramentaTardia();
        sm.registerControlFactory('arrow', tardia.descritor);
    });

    it('a varredura de clique acha a feicao SEM carregar a ferramenta', () => {
        const achadas = sm.getAllClickedCustomFeatures([10, 10]);

        expect(achadas.map(f => f.toolType)).toEqual(['arrow']);
        // O outro lado, e o que impede a economia de se desfazer sozinha: detectar o clique NAO
        // pode ser motivo para baixar a ferramenta.
        expect(tardia.cargas.n, 'a varredura carregou a ferramenta so para enxergar a feicao')
            .toBe(0);
    });

    it('a alca de edicao de uma ferramenta nao carregada continua reconhecida', () => {
        const mapa = mapaFalso();
        mapa.queryRenderedFeatures = () => ([
            { source: 'arrow-edit-handles', properties: { user_isEditingHandle: true } }
        ]);
        const outro = new SelectionManager(mapa);
        outro.registerControlFactory('arrow', tardia.descritor);

        expect(outro.isClickOnEditHandle([10, 10])).toBe(true);
        expect(tardia.cargas.n).toBe(0);
    });

    it('selecionar a feicao CARREGA a ferramenta e a avisa', async () => {
        await sm.selectFeature('arrow', 'seta-1', SETA_NO_MAPA);

        expect(tardia.cargas.n).toBe(1);
        expect(tardia.controle.selecionadas).toHaveLength(1);
        expect(tardia.controle.selecionadas[0].properties.id).toBe('seta-1');
        expect(stateManagerFalso.isFeatureSelected('arrow', 'seta-1')).toBe(true);
    });

    it('a segunda selecao NAO carrega de novo', async () => {
        await sm.selectFeature('arrow', 'seta-1', SETA_NO_MAPA);
        selecionadas.clear();
        await sm.selectFeature('arrow', 'seta-1', SETA_NO_MAPA);

        expect(tardia.cargas.n, 'a ferramenta foi carregada duas vezes').toBe(1);
        // E a instancia passou a viver no registro de instancias, nao mais no de descritores.
        expect(sm.controls.get('arrow')).toBe(tardia.controle);
        expect(sm.controlFactories.has('arrow')).toBe(false);
    });

    it('a geometria completa vem da fonte sem carregar a ferramenta', async () => {
        const completa = await sm.getCompleteFeatureFromSource('arrow', 'seta-1');

        expect(completa?.properties?.id).toBe('seta-1');
        expect(tardia.cargas.n).toBe(0);
    });

    it('uma ferramenta que falha ao carregar nao derruba a selecao', async () => {
        const quebrada = new SelectionManager(mapaFalso());
        quebrada.registerControlFactory('arrow', {
            getSourceNames: () => ['arrows'],
            getEditHandleSource: () => null,
            ensure: async () => { throw new Error('rede caiu'); }
        });

        await quebrada.selectFeature('arrow', 'seta-1', SETA_NO_MAPA);

        // A feicao entra na selecao mesmo assim: o painel e o realce vivem no StateManager, e
        // so o que a FERRAMENTA faria (alcas de edicao) se perde.
        expect(stateManagerFalso.isFeatureSelected('arrow', 'seta-1')).toBe(true);
    });

    it('registerControl sobre um tipo com descritor aposenta o descritor', () => {
        sm.registerControl('arrow', tardia.controle);

        expect(sm.controlFactories.has('arrow')).toBe(false);
        expect(sm.getAllClickedCustomFeatures([10, 10]).map(f => f.toolType)).toEqual(['arrow']);
    });
});
