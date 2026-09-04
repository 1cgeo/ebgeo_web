// Path: tests/unit/coordination-line-passe-de-zoom.test.js

import { beforeAll, describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';

/**
 * O CUSTO DO GESTO DE ZOOM DA LINHA DE COORDENACAO, contado, nao estimado.
 *
 * A regua deste ramo tem duas linhas, e as duas sao sobre a FONTE `coordination_lines`,
 * que e uma das dezesseis governadas por `layers/geojson-dispatcher.js`:
 *
 *   1. ZERO leituras (`getData`) por quadro do gesto, com a correcao de zoom LIGADA.
 *   2. No maximo UMA escrita na fonte por gesto, e ela acontece no `zoomend`.
 *
 * Por que a primeira linha importa aqui mais do que na main: nesta arvore ler a colecao
 * de volta e uma ida ao worker (`source.getData()` e assincrono), e escrever e um
 * `updateData` que precisa esperar o sinal de assentamento da fonte. O passe antigo
 * pagava uma leitura E uma escrita por quadro, para TODA linha, porque
 * `calculatedLineWidth` muda a cada passo de zoom e era ele que a camada lia. Agora a
 * camada calcula a largura na GPU (`buildCoordinationLineWidthExpression`), entao o
 * passe por quadro fica so com o que nenhuma expressao faz: a geometria em quilometros
 * das linhas FIXADAS NA TELA. Sem nenhuma delas, ele nao le nada.
 *
 * A contagem e feita em duas fases separadas (os quadros, e depois o `zoomend`), porque
 * um total unico esconderia justamente a distincao que a regua faz.
 *
 * DUAS COISAS SAO CONTADAS COMO LEITURA, de proposito: a leitura do proprio passe e a
 * que o despachante faz quando tem algo para escrever. Nenhuma das duas e de graca, e
 * separa-las deixaria passar uma versao que so trocasse uma pela outra.
 */

// O despachante real espera um sinal de assentamento que um mapa falso nunca manda.
// O substituto aplica cada `add` direto na fonte, pelo mesmo `setData` que o mapa
// registra, entao a colecao que o teste le de volta e a que o controle pediu.
vi.mock('@layers/geojson-dispatcher.js', async () => {
    const { makeFakeDispatcherModule } = await import('../helpers/fake-geojson-dispatcher.js');
    return makeFakeDispatcherModule();
});

vi.mock('../../src/js/snapping/snapping.service.js', () => ({
    getSnappingService: () => ({
        resolve: (map, point, lngLat) => ({ lng: lngLat.lng, lat: lngLat.lat, snapped: false, snapType: null }),
        showIndicator: () => {},
        hideIndicator: () => {},
    }),
    SnappingService: class {},
}));

/**
 * A primeira importacao do controle puxa o grafo inteiro da store, e numa maquina
 * ocupada isso passa dos 5 s que um teste tem; pago dentro do primeiro `it` ele morre, e
 * o teste morto ainda derrama trabalho assincrono na contagem do SEGUINTE. Um `beforeAll`
 * tem orcamento proprio, entao o custo sai da medida.
 */
const CONTROLE = '../../src/js/military_tools/coordination_line_tool/add_coordination_line_control.js';

const require = createRequire(import.meta.url);

beforeAll(async () => {
    // O turf REAL, o mesmo que o app carrega por `<script>`. Sem ele a geometria cai
    // no caminho degradado e as asercoes sobre o desenho refeito ficariam vazias:
    // o passe escreveria a mesma espinha nua a cada quadro e ninguem notaria.
    if (!globalThis.turf) {
        runInThisContext(readFileSync(require.resolve('../../public/vendors/turf.min.js'), 'utf8'));
    }
    await import(/* @vite-ignore */ CONTROLE);
}, 120000);

/** rAF dirigido a mao: nada roda sem o teste mandar. */
const clock = {
    scheduled: new Map(),
    nextId: 0,
    install() {
        this.scheduled = new Map();
        this.nextId = 0;
        globalThis.requestAnimationFrame = (callback) => {
            const id = ++this.nextId;
            this.scheduled.set(id, callback);
            return id;
        };
        globalThis.cancelAnimationFrame = (id) => { this.scheduled.delete(id); };
    },
    /** Roda o que estiver agendado agora, sem rodar o que esses callbacks agendarem. */
    run() {
        const due = [...this.scheduled.entries()];
        this.scheduled.clear();
        for (const [, callback] of due) callback();
    },
};

const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

beforeEach(() => clock.install());

afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
});

/** Deixa o laco de eventos rodar o suficiente para as promessas do passe assentarem. */
async function drenar() {
    for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

/** Uma linha de coordenacao pronta, com espinha de uns 10 km. */
function linha(id, extras = {}) {
    const baseCoordinates = [[-53, -30], [-52.9, -30]];
    return {
        type: 'Feature',
        properties: {
            id,
            source: 'coordination_line',
            type: 'coordination_line',
            color: '#000000',
            opacity: 1,
            visivel: true,
            lineWidth: 4,
            symbol_code: '290199',
            symbol_size: 0.5,
            symbol_spacing: 1.5,
            createdAtZoom: 10,
            zoomCorrectionEnabled: true,
            calculatedLineWidth: 4,
            calculatedSymbolSize: 0.5,
            calculatedSymbolSpacing: 1.5,
            baseCoordinates,
            ...extras,
        },
        geometry: { type: 'LineString', coordinates: baseCoordinates },
    };
}

/**
 * Um controle real sobre um mapa falso que CONTA as idas a fonte.
 * @param {Array} features - Colecao inicial de `coordination_lines`
 * @returns {Promise<Object>} `{ control, contador, quadro, zoomend, zoom }`
 */
async function montar(features) {
    const { default: Control } = await import(/* @vite-ignore */ CONTROLE);

    const contador = { getData: 0, setData: 0 };
    let colecao = { type: 'FeatureCollection', features };

    const source = {
        // Assincrono como o de verdade: e uma ida ao worker, e devolve uma COPIA,
        // porque a fonte migrada reconstroi a colecao em vez de entregar a dela.
        getData: async () => {
            contador.getData++;
            return JSON.parse(JSON.stringify(colecao));
        },
        setData: (data) => {
            contador.setData++;
            colecao = data;
        },
    };

    const canvas = { style: {}, addEventListener() {}, removeEventListener() {} };
    const listeners = new Map();
    let zoom = 10;

    const map = {
        getZoom: () => zoom,
        getSource: (id) => (id === 'coordination_lines' ? source : undefined),
        getCanvas: () => canvas,
        getCanvasContainer: () => canvas,
        queryRenderedFeatures: () => [],
        getLayer: () => undefined,
        dragPan: { enable() {}, disable() {} },
        on: (event, handler) => listeners.set(event, handler),
        off: (event, handler) => { if (listeners.get(event) === handler) listeners.delete(event); },
    };

    const control = new Control({
        selectionManager: { getSelectedFeaturesByType: () => [], uiManager: {} },
    });
    control.onAdd(map);

    return {
        control,
        contador,
        colecaoAtual: () => colecao,
        /** Um quadro do gesto: novo zoom, evento `zoom`, o rAF que ele agendou. */
        async quadro(novoZoom) {
            zoom = novoZoom;
            listeners.get('zoom')?.();
            clock.run();
            await drenar();
        },
        /** O fim do gesto. */
        async zoomend() {
            listeners.get('zoomend')?.();
            clock.run();
            await drenar();
        },
        /** O que a ferramenta faz na carga, que e onde ela aprende o que ha na colecao. */
        carregar() {
            return control.applyZoomCorrections(features, zoom);
        },
    };
}

/** Um gesto de zoom de dois niveis, em oito quadros. */
const GESTO = [10.25, 10.5, 10.75, 11, 11.25, 11.5, 11.75, 12];

describe('o gesto de zoom com a correcao LIGADA (o caso comum)', () => {
    it('nao le a colecao NENHUMA vez nos quadros, e escreve uma vez so no zoomend', async () => {
        const cena = await montar([linha('a'), linha('b'), linha('c')]);
        cena.carregar();

        const antes = { ...cena.contador };
        for (const z of GESTO) await cena.quadro(z);
        const nosQuadros = {
            getData: cena.contador.getData - antes.getData,
            setData: cena.contador.setData - antes.setData,
        };

        // A linha 1 da regua. Oito quadros, tres linhas, zero idas ao worker: a
        // largura desenhada vem da expressao da camada, e nenhuma das tres esta
        // fixada na tela, entao nao ha geometria para refazer.
        expect(nosQuadros).toEqual({ getData: 0, setData: 0 });

        const meio = { ...cena.contador };
        await cena.zoomend();
        const noFim = {
            getData: cena.contador.getData - meio.getData,
            setData: cena.contador.setData - meio.setData,
        };

        // A linha 2. UMA escrita: o passe completo le a colecao, atualiza os
        // `calculated*` que a exportacao e o cabecalho leem, e entrega tudo num
        // lote so. A segunda leitura e a do proprio despachante, na hora de
        // aplicar o lote.
        expect(noFim.setData).toBe(1);
        expect(noFim.getData).toBe(2);
    });

    it('o zoomend deixa o `calculatedLineWidth` de TODAS as linhas no zoom final', async () => {
        // Sem esta asercao a primeira poderia passar num controle que simplesmente
        // parou de fazer o passe, e a exportacao sairia com a largura do zoom errado.
        const cena = await montar([linha('a'), linha('b')]);
        cena.carregar();

        for (const z of GESTO) await cena.quadro(z);
        await cena.zoomend();

        // Ancorada em 10, vista em 12: 4 * 2^2.
        for (const feature of cena.colecaoAtual().features) {
            expect(feature.properties.calculatedLineWidth, feature.properties.id).toBeCloseTo(16, 10);
        }
    });

    it('uma colecao vazia nao custa nem a leitura do zoomend', async () => {
        const cena = await montar([]);
        cena.carregar();

        for (const z of GESTO) await cena.quadro(z);
        await cena.zoomend();

        expect(cena.contador.setData).toBe(0);
    });
});

describe('o gesto de zoom com uma linha FIXADA NA TELA', () => {
    it('refaz a geometria dela por quadro, que e o unico trabalho que sobrou', async () => {
        const cena = await montar([
            linha('a'),
            linha('presa', { zoomCorrectionEnabled: false }),
        ]);
        cena.carregar();

        const antes = { ...cena.contador };
        for (const z of GESTO) await cena.quadro(z);

        // Aqui o passe por quadro TEM trabalho, e o custo volta: e por isso que o
        // interruptor existe e que o padrao e ficar ligado.
        expect(cena.contador.setData - antes.setData).toBeGreaterThan(0);

        // E o desenho acompanha: o tamanho do glifo em km encolhe pelo reciproco.
        await cena.zoomend();
        const presa = cena.colecaoAtual().features.find(f => f.properties.id === 'presa');
        expect(presa.properties.calculatedSymbolSize).toBeCloseTo(0.5 / 4, 10);

        // A vizinha ancorada no terreno NAO foi remexida por quadro: o passe por
        // quadro so toca as fixadas na tela.
        const solta = cena.colecaoAtual().features.find(f => f.properties.id === 'a');
        expect(solta.properties.calculatedSymbolSize).toBeCloseTo(0.5, 10);
    });

    it('PIOR CASO: uma linha fixada na tela que chega DEPOIS da carga ainda e vista', async () => {
        // O atalho que faz a linha 1 da regua valer e uma bandeira, e uma bandeira
        // pode ficar velha. Este e o caso que a envelhece: a colecao carrega sem
        // nenhuma linha presa a tela (bandeira em `false`), e o interruptor e
        // virado pelo painel depois. O caminho da escrita de propriedade le a
        // colecao inteira, entao a bandeira tem de sair de la corrigida.
        const cena = await montar([linha('a')]);
        cena.carregar();
        expect(cena.control._hasScreenAnchored).toBe(false);

        await cena.control.updateFeaturesProperty(
            [linha('a')], 'zoomCorrectionEnabled', false,
        );
        expect(cena.control._hasScreenAnchored).toBe(true);

        const antes = { ...cena.contador };
        for (const z of GESTO) await cena.quadro(z);
        expect(cena.contador.setData - antes.setData).toBeGreaterThan(0);
    });

    it('a bandeira nasce DESCONHECIDA, e enquanto for o passe le como lia antes', async () => {
        // Conservadora por construcao: sem nunca ter lido a colecao, o passe nao
        // tem o direito de dizer que nao ha nada a fazer.
        const cena = await montar([linha('presa', { zoomCorrectionEnabled: false })]);

        expect(cena.control._hasScreenAnchored).toBeNull();

        const antes = { ...cena.contador };
        await cena.quadro(10.5);
        expect(cena.contador.getData - antes.getData).toBeGreaterThan(0);
        expect(cena.control._hasScreenAnchored).toBe(true);
    });
});

describe('a disciplina dos dois passes', () => {
    it('os quadros de um gesto NAO empilham passes, e o ultimo zoom nao se perde', async () => {
        const cena = await montar([linha('presa', { zoomCorrectionEnabled: false })]);
        cena.carregar();

        // Tres eventos `zoom` antes de qualquer rAF: so um passe pode nascer.
        cena.control.handleZoomChange();
        cena.control.handleZoomChange();
        cena.control.handleZoomChange();

        expect(cena.control.pendingZoomUpdate).toBe(true);
        expect(cena.control.missedZoomUpdate).toBe(true);
        expect(clock.scheduled.size).toBe(1);
    });

    it('o zoomend tem gate PROPRIO, senao um deles calaria o outro', async () => {
        const cena = await montar([linha('a')]);
        cena.carregar();

        cena.control.handleZoomChange();
        cena.control.handleZoomEnd();

        // Dois rAF, um de cada passe. Um gate compartilhado deixaria o `zoomend`
        // de fora, e os `calculated*` congelariam no zoom em que o gesto comecou.
        expect(clock.scheduled.size).toBe(2);
        expect(cena.control.pendingZoomUpdate).toBe(true);
        expect(cena.control.pendingZoomEndUpdate).toBe(true);
    });

    it('o fim de um arraste replica os DOIS passes que ficaram de fora', async () => {
        const cena = await montar([linha('a')]);
        cena.carregar();

        cena.control.missedZoomUpdate = true;
        cena.control.missedZoomEndUpdate = true;
        cena.control.replayMissedZoomUpdate();

        expect(clock.scheduled.size).toBe(2);
    });

    it('o passe por quadro se afasta enquanto uma alca esta sendo arrastada', async () => {
        const cena = await montar([linha('presa', { zoomCorrectionEnabled: false })]);
        cena.carregar();

        cena.control.isDraggingHandle = true;
        const antes = { ...cena.contador };
        await cena.quadro(11);

        // Nada escrito, e a bandeira de quadro perdido levantada para o fim do
        // arraste replicar.
        expect(cena.contador.setData - antes.setData).toBe(0);
        expect(cena.control.missedZoomUpdate).toBe(true);
    });
});
