import { describe, it, expect, vi } from 'vitest';

/**
 * O painel de atributos e ACIONADO aqui, com dubles, em vez de apenas lido.
 *
 * O `createAttributePanel` do controle envolve a chamada num try/catch que so faz
 * `console.error`. Entao um lance dentro do painel nao aparece como erro na tela:
 * a aba Estilo abre VAZIA, ou pela metade, e o usuario ve "sumiu a cor" sem que
 * nada acuse. Este arquivo e o unico lugar onde esse lance vira uma falha.
 *
 * Os helpers de UI sao dublados porque o barril `@tools/helpers` puxa modulos
 * acoplados ao DOM e ao MapLibre, que nao carregam no ambiente `node`. O que
 * importa aqui nao e o que cada controle desenha, e sim a ORDEM em que o painel
 * os monta e o fato de ele chegar ao fim sem lancar.
 */

/** Cada helper devolve uma marca, para o teste conferir a ordem de montagem. */
const marca = (tipo) => (config = {}) => ({
    tipo,
    label: config.label,
    value: config.value,
    options: config.options,
    onChange: config.onChange,
    classList: { add() {}, remove() {}, toggle() {} },
    replaceWith() {},
});

vi.mock('@tools/helpers/index.js', () => ({
    createModernSlider: marca('slider'),
    createModernColorPicker: marca('cor'),
    createModernToggle: marca('toggle'),
    createModernSelect: marca('select'),
    createModernInfoBox: marca('info'),
    createSectionDivider: (titulo) => ({ tipo: 'divisor', label: titulo }),
    createInitialPropertiesMap: (features) => new Map(features.map(f => [f.properties.id, { ...f.properties }])),
    createPanelHeader: () => {},
    createActionButtons: () => {},
}));

const { addCoordinationLineAttributesToPanel } = await import(
    '../../src/js/military_tools/coordination_line_tool/coordination_line_attributes_panel.js'
);

/** Painel de mentira que so guarda o que recebe. */
const fakePanel = () => {
    const filhos = [];
    return { filhos, appendChild: (n) => filhos.push(n) };
};

/** Controle de mentira com o minimo que o painel consulta. */
const fakeControl = (overrides = {}) => ({
    getCurrentZoom: () => 12,
    maxGlyphs: 120,
    geometry: {
        normalizeBaseCoordinates: (c) => (Array.isArray(c) ? c : null),
        measureLengthKm: () => 10,
        describeLayout: () => ({ count: 5, capped: false }),
    },
    updateFeaturesProperty: vi.fn(async () => {}),
    ...overrides,
});

const feature = (extra = {}) => ({
    properties: {
        id: 'cl-1',
        source: 'coordination_line',
        nome: 'Barreira Sul',
        color: '#112233',
        lineWidth: 4,
        opacity: 1,
        symbol_code: '290199',
        symbol_size: 0.5,
        symbol_spacing: 1.5,
        createdAtZoom: 12,
        zoomCorrectionEnabled: true,
        baseCoordinates: [[-53, -30], [-52.9, -30]],
        ...extra,
    },
});

const montar = (f = feature(), control = fakeControl()) => {
    const panel = fakePanel();
    addCoordinationLineAttributesToPanel(panel, [f], control, {}, {}, {});
    return panel.filhos;
};

describe('painel da linha de coordenacao', () => {
    it('monta sem lancar e chega ao fim', () => {
        expect(() => montar()).not.toThrow();
        expect(montar().length).toBeGreaterThan(5);
    });

    it('TEM o seletor de cor, com o valor da feicao', () => {
        const cor = montar().find(n => n.tipo === 'cor');

        expect(cor).toBeDefined();
        expect(cor.label).toBe('Cor');
        expect(cor.value).toBe('#112233');
    });

    it('monta a aparencia ANTES do simbolo, e o seletor de cor e o primeiro controle', () => {
        const tipos = montar().map(n => n.tipo);

        expect(tipos[0]).toBe('cor');
        expect(tipos.indexOf('cor')).toBeLessThan(tipos.indexOf('divisor'));
        expect(tipos.filter(t => t === 'slider').length).toBeGreaterThanOrEqual(4);
        expect(tipos).toContain('select');
        expect(tipos).toContain('info');
        expect(tipos).toContain('toggle');
    });

    it('o combobox oferece os cinco simbolos do catalogo', () => {
        const select = montar().find(n => n.tipo === 'select');

        expect(select.options).toHaveLength(5);
        expect(select.value).toBe('290199');
        expect(select.options.map(o => o.value)).toEqual(
            ['290100', '290199', '290302', '290303', '290307'],
        );
    });

    it('trocar a cor escreve a propriedade `color` no controle', async () => {
        const control = fakeControl();
        const panel = fakePanel();
        addCoordinationLineAttributesToPanel(panel, [feature()], control, {}, {}, {});

        panel.filhos.find(n => n.tipo === 'cor').onChange('#ff0000');

        expect(control.updateFeaturesProperty).toHaveBeenCalledWith(
            expect.any(Array), 'color', '#ff0000',
        );
    });

    it('WORST CASE: monta mesmo com a feicao sem nenhuma propriedade de estilo', () => {
        // Uma feicao vinda de importacao antiga, ou de colagem, pode chegar magra.
        // O painel nao pode lancar por isso, ou a aba Estilo abre vazia e o usuario
        // ve "sumiu a cor" sem nada acusar.
        const magra = { properties: { id: 'x', source: 'coordination_line', baseCoordinates: [[-53, -30], [-52.9, -30]] } };

        expect(() => montar(magra)).not.toThrow();
        expect(montar(magra).find(n => n.tipo === 'cor')).toBeDefined();
    });

    it('WORST CASE: monta com a espinha ausente, sem comprimento para medir', () => {
        const semEspinha = feature({ baseCoordinates: undefined });
        const control = fakeControl({
            geometry: {
                normalizeBaseCoordinates: () => null,
                measureLengthKm: () => NaN,
                describeLayout: () => ({ count: 0, capped: false }),
            },
        });

        expect(() => montar(semEspinha, control)).not.toThrow();
        expect(montar(semEspinha, control).find(n => n.tipo === 'cor')).toBeDefined();
    });
});
