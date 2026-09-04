// Path: tests/integration/perfil-sob-demanda-ao-ligar.test.js

/**
 * @fileoverview A OUTRA METADE da decisão de parar de calcular o perfil na importação: ligar o
 * interruptor "Perfil do terreno" numa linha que nunca teve `profileData` tem de produzir um.
 *
 * O PAR. `tests/unit/importacao-nao-calcula-perfil.test.js` afirma que a linha importada nasce
 * SEM perfil. Sozinha, essa afirmação é compatível com um produto quebrado (a pessoa liga o
 * interruptor e o painel fica vazio para sempre). Este arquivo afirma o outro lado, dirigindo o
 * caminho real da UI: `line_attributes_panel.js` chama
 * `lineControl.updateFeaturesProperty(selecionadas, 'profile', checked)`, e é lá dentro que o
 * recálculo mora.
 *
 * ELE NÃO EXISTIA ANTES DESTA MUDANÇA, e o recálculo tampouco é novo: `updateFeaturesProperty` já
 * recalculava desde antes, a partir de `baseCoordinates`, o que é justamente o motivo de o perfil
 * da importação nunca ter sido lido por ninguém. O que muda é que a propriedade passou a ser
 * LOAD-BEARING: enquanto a importação também calculava, apagar este ramo não quebraria nada de
 * visível numa linha importada.
 *
 * O TERCEIRO SÍTIO entrou depois, no segundo bloco: `createFeature`, o desenho de uma linha
 * nova, era o último ponto do produto que calculava perfil sem perguntar pelo interruptor. Ele
 * mora aqui, e não no arquivo de importação, porque o sujeito é o mesmo controle de linha e os
 * duplos já estavam montados.
 *
 * O QUE ELE NÃO ALCANÇA: o desenho do gráfico (Chart.js), que é de
 * `tests/unit/profile-panel-lazy-gate.test.js`. Aqui o sujeito é a PRODUÇÃO do dado.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { dispatcher } = vi.hoisted(() => ({
    dispatcher: {
        add: vi.fn(),
        patch: vi.fn(),
        remove: vi.fn(),
        flush: vi.fn(async () => {}),
    },
}));

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: vi.fn(() => dispatcher),
    destroyGeoJsonDispatcher: vi.fn(),
}));
// O perfil le o terreno pelo AMOSTRADOR (createTerrainSampler), construido uma vez por
// calculo, com `elevation` sincrona. O duplo mantem o mesmo terreno deterministico.
vi.mock('@js/terrain', () => ({
    createTerrainSampler: vi.fn(() => ({
        elevation: ([lng, lat]) => 100 + ((lng * 37 + lat * 91) % 50),
        fast: true,
        zoom: 12,
    })),
}));
vi.mock('@utils/turf-loader.js', () => ({ ensureTurf: vi.fn(async () => {}) }));

const { default: AddLineControl } = await import('../../src/js/draw_tools/line_tool/add_line_control.js');

// `createFeature` chama `getActiveLayerIdSync()`, e a store real responde por injeção. Injetar
// só o gerente de camadas, POR ARQUIVO, é o que mantém o resto da store real (é ela quem grava a
// feição em `addFeature`, sobre o `fake-indexeddb` do setup) sem precisar dublar o barril
// inteiro, que outros módulos deste grafo também importam.
const { setLayerDependencies } = await import('../../src/js/store/layer.operations.js');
setLayerDependencies({ layerManager: { getActiveLayerIdSync: () => 'layer-1' } });

// `globalThis.turf` com os três métodos que `calculateProfile` usa, e só eles.
const turfStub = {
    lineString: (coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates } }),
    length: (line) => {
        const c = line.geometry.coordinates;
        let total = 0;
        for (let i = 1; i < c.length; i++) total += metros(c[i - 1], c[i]);
        return total;
    },
    along: (line, distancia) => {
        const c = line.geometry.coordinates;
        let restante = distancia;
        for (let i = 1; i < c.length; i++) {
            const trecho = metros(c[i - 1], c[i]);
            if (restante <= trecho || i === c.length - 1) {
                const t = trecho === 0 ? 0 : Math.min(1, restante / trecho);
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [
                            c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t,
                            c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t,
                        ],
                    },
                };
            }
            restante -= trecho;
        }
        return { type: 'Feature', geometry: { type: 'Point', coordinates: c.at(-1) } };
    },
};

/** Equirectangular distance in metres between two [lng, lat] pairs. */
function metros([lng1, lat1], [lng2, lat2]) {
    const R = 6371008.8;
    const x = ((lng2 - lng1) * Math.PI / 180) * Math.cos((lat1 + lat2) * Math.PI / 360);
    const y = (lat2 - lat1) * Math.PI / 180;
    return Math.sqrt(x * x + y * y) * R;
}

const COORDS = [[-47.9, -15.8], [-47.89, -15.79], [-47.88, -15.81]];

/** A feição como a importação a entrega hoje: com eixo, sem perfil, interruptor desligado. */
function linhaImportada() {
    return {
        type: 'Feature',
        id: 1,
        properties: {
            id: 'linha-1',
            source: 'line',
            nome: 'Linha #1',
            profile: false,
            profileData: null,
            baseCoordinates: COORDS,
        },
        geometry: { type: 'LineString', coordinates: COORDS },
    };
}

function makeControl() {
    const selectionManager = {
        updateSelectedFeature: vi.fn(),
        getSelectedFeaturesByType: vi.fn(() => []),
        updateProfile: vi.fn(),
        toggleFeatureSelection: vi.fn(async () => {}),
        updateUI: vi.fn(),
    };
    const control = new AddLineControl({ selectionManager, deactivateCurrentTool: vi.fn() });
    control.map = {
        getTerrain: () => ({ exaggeration: 1.5 }),
        queryTerrainElevation: async () => 100,
        getSource: () => null,
    };
    return { control, selectionManager };
}

let documentoAnterior;

beforeEach(() => {
    globalThis.turf = turfStub;
    // `createFeature` termina em `updateFeatureMeasurement`, que chama `removeMeasurement`
    // INCONDICIONALMENTE (a guarda de `measure` vem depois dela) e mexe no DOM. Sem isto o
    // gesto morre no `catch` do próprio método, DEPOIS do despachante, e as asserções do
    // desenho continuariam verdes sobre um gesto que não terminou.
    documentoAnterior = globalThis.document;
    globalThis.document = {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ style: {}, className: '', appendChild: () => {}, remove: () => {} }),
        body: { appendChild: () => {} },
    };
    dispatcher.add.mockClear();
    dispatcher.patch.mockClear();
    dispatcher.flush.mockClear();
});

afterEach(() => {
    globalThis.document = documentoAnterior;
    delete globalThis.turf;
});

describe('updateFeaturesProperty — o perfil se calcula quando o interruptor liga', () => {
    // SÓ AQUI. `updateFeaturesProperty` agenda `selectionManager.updateProfile()` com um
    // `setTimeout` de 100 ms, e sem relógio falso ele fica pendente no fim do caso. O relógio
    // falso NÃO pode subir para o `beforeEach` do arquivo: os casos de `createFeature` gravam
    // pela store real sobre `fake-indexeddb`, que depende de temporizador de verdade, e com o
    // relógio falso eles estouram o timeout em vez de terminar.
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

    it('linha SEM profileData ganha um perfil ao ligar `profile`', async () => {
        const { control } = makeControl();
        const feicao = linhaImportada();
        expect(feicao.properties.profileData).toBeNull();

        await control.updateFeaturesProperty([feicao], 'profile', true);

        expect(feicao.properties.profile).toBe(true);
        expect(typeof feicao.properties.profileData).toBe('string');
        const perfil = JSON.parse(feicao.properties.profileData);
        expect(perfil).toHaveLength(26);
        expect(perfil[0].distance).toBe(0);
        expect(perfil.every(p => Number.isFinite(p.elevation))).toBe(true);

        // O par das duas chaves que `ProfilePanelManager.showProfilePanel` exige, agora completo.
        expect(Boolean(feicao.properties.profileData && feicao.properties.profile)).toBe(true);
    });

    it('o perfil recalculado viaja no patch, não só no objeto em memória', async () => {
        const { control } = makeControl();
        const feicao = linhaImportada();

        await control.updateFeaturesProperty([feicao], 'profile', true);

        expect(dispatcher.patch).toHaveBeenCalledTimes(1);
        const [id, changes] = dispatcher.patch.mock.calls[0];
        expect(id).toBe('linha-1');
        expect(changes.setProps.profile).toBe(true);
        expect(changes.setProps.profileData).toBe(feicao.properties.profileData);
        expect(dispatcher.flush).toHaveBeenCalled();
    });

    it('CONTROLE NEGATIVO: desligar `profile` não calcula perfil nenhum', async () => {
        const { control } = makeControl();
        const feicao = linhaImportada();
        feicao.properties.profile = true;

        let calculos = 0;
        const real = control.calculateProfile.bind(control);
        control.calculateProfile = async (...a) => { calculos++; return real(...a); };

        await control.updateFeaturesProperty([feicao], 'profile', false);

        expect(calculos).toBe(0);
        expect(feicao.properties.profileData).toBeNull();
    });
});

/**
 * O TERCEIRO sítio, e o último deste arquivo que calculava perfil sem perguntar: desenhar uma
 * linha nova. `createFeature` montava `profileData` dentro do literal de propriedades, logo
 * depois de espalhar `DEFAULT_PROPERTIES`, que traz `profile: false`. Medido antes da correção
 * com este mesmo duplo: a feição chegava ao despachante com 26 pontos de perfil e o interruptor
 * desligado, ou seja, um perfil que o painel não desenha e que `updateFeaturesProperty`
 * recalcula quando alguém liga o interruptor.
 */
describe('createFeature — a linha recém-desenhada nasce sem perfil', () => {
    it('com `profile: false` nos padrões não calcula nada e o despachante recebe profileData nulo', async () => {
        const { control, selectionManager } = makeControl();
        control.drawPoints = [...COORDS];

        let calculos = 0;
        const real = control.calculateProfile.bind(control);
        control.calculateProfile = async (...a) => { calculos++; return real(...a); };

        await control.createFeature();

        expect(calculos).toBe(0);
        expect(dispatcher.add).toHaveBeenCalledTimes(1);
        const criada = dispatcher.add.mock.calls[0][0];
        expect(criada.properties.profile).toBe(false);
        expect(criada.properties.profileData).toBeNull();
        // O eixo, que é do que o cálculo sob demanda parte depois.
        expect(criada.properties.baseCoordinates).toEqual(COORDS);
        // O gesto terminou: sem isso um `createFeature` que lançasse antes do despachante
        // deixaria as asserções acima passando por ausência.
        expect(selectionManager.toggleFeatureSelection).toHaveBeenCalled();
    });

    it('CONTROLE POSITIVO: a mesma linha com `profile: true` ganha um perfil de verdade', async () => {
        const { control } = makeControl();
        control.drawPoints = [...COORDS];
        const padroesOriginais = AddLineControl.DEFAULT_PROPERTIES;
        AddLineControl.DEFAULT_PROPERTIES = { ...padroesOriginais, profile: true };

        try {
            await control.createFeature();
        } finally {
            AddLineControl.DEFAULT_PROPERTIES = padroesOriginais;
        }

        const criada = dispatcher.add.mock.calls[0][0];
        expect(criada.properties.profile).toBe(true);
        const perfil = JSON.parse(criada.properties.profileData);
        expect(perfil).toHaveLength(26);
        expect(perfil[0].distance).toBe(0);
        expect(perfil.every(p => Number.isFinite(p.elevation))).toBe(true);
    });
});
