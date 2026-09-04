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

// O catalogo entra como FONTE, nunca copiado para uma lista literal aqui: uma
// lista a mao envelhece calada quando o catalogo cresce, e foi exatamente o que
// aconteceu quando ele passou de 5 para 10 simbolos.
const { LINEAR_SYMBOLS } = await import(
    '../../src/js/military_tools/coordination_line_tool/coordination_line_catalog.js'
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

    it('o SIMBOLO e o primeiro controle do formulario, antes da aparencia', () => {
        const tipos = montar().map(n => n.tipo);

        // Pedido do chefe em 2026-09-03, e a ordem inverteu de proposito. Qual
        // simbolo do MD33 a linha e decide o que o desenho SIGNIFICA, enquanto cor
        // e espessura decidem so como ele aparece; e a escolha do simbolo ainda
        // determina a pegada do glifo, logo o piso do espacamento e a contagem,
        // que sao justamente os controles abaixo dele.
        const iSelect = tipos.indexOf('select');
        const iCor = tipos.indexOf('cor');

        expect(iSelect).toBeGreaterThanOrEqual(0);
        expect(iCor).toBeGreaterThanOrEqual(0);
        expect(iSelect).toBeLessThan(iCor);

        // Nada interativo antes dele: so o divisor da propria secao.
        expect(tipos.slice(0, iSelect).every(t => t === 'divisor')).toBe(true);

        expect(tipos.filter(t => t === 'slider').length).toBeGreaterThanOrEqual(4);
        expect(tipos).toContain('info');
        expect(tipos).toContain('toggle');
    });

    it('o combobox oferece TODO o catalogo, e o rotulo traz a designacao do manual', () => {
        const select = montar().find(n => n.tipo === 'select');
        const catalogo = Object.values(LINEAR_SYMBOLS);

        expect(catalogo.length).toBeGreaterThan(0);
        expect(select.options).toHaveLength(catalogo.length);
        expect(select.value).toBe('290199');
        expect(select.options.map(o => o.value)).toEqual(catalogo.map(s => s.id));

        // O rotulo e montado AQUI a partir do `code` e do `extension` da entrada,
        // e nao pelo `symbolDesignation` do proprio modulo, ou o teste conferiria
        // a funcao contra ela mesma. A extensao e o unico campo que separa a Sapa
        // da Trincheira, que dividem o codigo 290999: sem ela as duas sairiam com
        // o mesmo rotulo e o combobox ofereceria duas linhas indistinguiveis.
        for (const simbolo of catalogo) {
            const esperado = simbolo.extension
                ? `${simbolo.name} (${simbolo.code}/${simbolo.extension})`
                : `${simbolo.name} (${simbolo.code})`;
            const opcao = select.options.find(o => o.value === simbolo.id);
            expect(opcao, simbolo.id).toBeDefined();
            expect(opcao.label, simbolo.id).toBe(esperado);
        }

        const rotulos = select.options.map(o => o.label);
        expect(rotulos).toContain('Sapa (290999/01)');
        expect(rotulos).toContain('Trincheira (290999/02)');
        expect(rotulos).not.toContain('Sapa (290999)');
        expect(rotulos).not.toContain('Trincheira (290999)');
        // Nenhum rotulo repetido: dois iguais seriam duas linhas que o usuario
        // nao consegue distinguir no menu.
        expect(new Set(rotulos).size).toBe(catalogo.length);
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
