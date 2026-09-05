// Path: tests/unit/selection-highlight-passe-de-zoom.test.js

/**
 * @fileoverview O passe de zoom da caixa de selecao, DIRIGIDO por quadros.
 *
 * A caixa de selecao e geometria em PIXELS ao redor da feicao, entao as coordenadas
 * geograficas dela mudam a cada passo de zoom, e o `SelectionHighlightManager` se
 * registra em `zoom` para redesenha-la. Ate 2026-09-05 ele NAO redesenhava: medido no
 * Chromium sobre `npm run dev` na linha `integracao_backend`, que tem este mesmo
 * gerente, um gesto de `easeTo` de 1,5 nivel em 1,5 s emitiu 92 eventos `zoom`, chamou
 * o handler 92 vezes e rodou `updateSelectionHighlight` DUAS, as duas depois do gesto.
 *
 * A causa e a ORDEM dentro do quadro, e e isso que o relogio deste arquivo modela: o
 * MapLibre pede o quadro seguinte (`Map._requestRenderFrame`, que passa por `_update`
 * -> `triggerRepaint`) ANTES de a callback de animacao aplicar o zoom e emitir o
 * evento. A entrada dele fica na frente da do ouvinte na lista do quadro seguinte,
 * entao, quando ele roda e emite `zoom`, um handler que CANCELA e reagenda mata a
 * propria callback, que ainda esta na fila do MESMO quadro. Repete-se a cada quadro, e
 * a callback nunca roda.
 *
 * Sem modelar essa ordem um teste de quadro NAO ve o defeito: agendar e chamar
 * `quadro()` faz a callback rodar, e o arquivo sai verde sobre um app que nao redesenha
 * nada. Por isso o relogio aqui obedece o algoritmo do navegador (lote tirado no
 * inicio, cancelada durante a iteracao e PULADA, pedida durante a iteracao vai para o
 * quadro seguinte) e o mapa falso obedece a ordem do MapLibre.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const estadoDoStore = vi.hoisted(() => ({
    arrastando: false,
    selecionadas: [],
    leiturasDeSelecao: 0,
}));

vi.mock('@store', () => ({
    getStateManager: () => ({
        getUnsafe: (chave) => {
            if (chave === 'ui.isDragging') return estadoDoStore.arrastando;
            if (chave === 'selection.features') {
                estadoDoStore.leiturasDeSelecao += 1;
                return estadoDoStore.selecionadas;
            }
            return undefined;
        },
    }),
}));

const { SelectionHighlightManager } = await import('@tools/managers/selection-highlight.manager.js');

// ---------------------------------------------------------------------------
// O relogio: o algoritmo de "run the animation frame callbacks" do navegador.
// ---------------------------------------------------------------------------
const relogio = {
    entradas: new Map(),
    proximoId: 0,
    instalar() {
        this.entradas = new Map();
        this.proximoId = 0;
        globalThis.requestAnimationFrame = (cb) => {
            const id = ++this.proximoId;
            this.entradas.set(id, cb);
            return id;
        };
        globalThis.cancelAnimationFrame = (id) => { this.entradas.delete(id); };
    },
    /**
     * Um quadro: o lote sai no INICIO, e uma callback cancelada durante a iteracao e
     * pulada (nao roda), enquanto uma pedida durante a iteracao cai no quadro seguinte.
     * @returns {number} quantas callbacks de fato rodaram
     */
    quadro() {
        const lote = [...this.entradas.keys()];
        let rodaram = 0;
        for (const id of lote) {
            if (!this.entradas.has(id)) continue;
            const cb = this.entradas.get(id);
            this.entradas.delete(id);
            rodaram += 1;
            cb(0);
        }
        return rodaram;
    },
};

const rafOriginal = globalThis.requestAnimationFrame;
const cancelOriginal = globalThis.cancelAnimationFrame;

// ---------------------------------------------------------------------------
// O mapa falso, na ordem do MapLibre. A fonte e lida por referencia e escrita por
// `setData`, que e o modelo desta arvore.
// ---------------------------------------------------------------------------
function montarMapa() {
    const ouvintes = new Map();
    const escritas = [];
    let fonte = { setData: (dados) => escritas.push(dados) };
    const mapa = {
        zoom: 6,
        escritas,
        // Um `setStyle` (troca de mapa base ou de mapa do atlas) reconstroi o objeto de
        // fonte, e no modo de reconstrucao completa ele volta VAZIO.
        trocarFonte() { fonte = { setData: (dados) => escritas.push(dados) }; },
        on(tipo, cb) { if (!ouvintes.has(tipo)) ouvintes.set(tipo, []); ouvintes.get(tipo).push(cb); },
        off(tipo, cb) {
            const lista = ouvintes.get(tipo) || [];
            const i = lista.indexOf(cb);
            if (i >= 0) lista.splice(i, 1);
        },
        emitir(tipo) { for (const cb of [...(ouvintes.get(tipo) || [])]) cb(); },
        getZoom() { return this.zoom; },
        getCenter() { return { lng: 0, lat: 0 }; },
        getSource(id) { return id === 'selection-boxes' ? fonte : null; },
        project([lng, lat]) { return { x: lng * 1000, y: lat * 1000 }; },
        unproject([x, y]) { return { lng: x / 1000, lat: y / 1000 }; },
    };
    return mapa;
}

/**
 * Liga o motor de animacao do mapa. Cada volta faz, NESTA ordem: pedir o quadro
 * seguinte, aplicar o passo de zoom, emitir `zoom`. E a ordem do MapLibre real, e e o
 * que poe a entrada do mapa na frente da do ouvinte na lista do quadro seguinte.
 * @param {Object} mapa - Mapa falso
 * @param {number} passo - Quanto de zoom por quadro
 */
function ligarMotor(mapa, passo) {
    const volta = () => {
        mapa.__motor = requestAnimationFrame(volta);
        mapa.zoom += passo;
        mapa.emitir('zoom');
    };
    mapa.__motor = requestAnimationFrame(volta);
}

/**
 * Controle no contrato que o gerente exige, com uma caixa que DEPENDE do zoom, como
 * as de verdade: o lado em graus e o lado em pixels dividido pela escala.
 * @returns {Object} Controle falso
 */
function montarControle() {
    const chamadas = [];
    return {
        chamadas,
        getSelectionBoxStrategy: () => 'bbox',
        createSelectionBox(feature) {
            chamadas.push(feature.properties.id);
            const escala = 2 ** this.__zoomAtual;
            const meio = 20 / escala;
            const [lng, lat] = feature.geometry.coordinates;
            return {
                type: 'Polygon',
                coordinates: [[
                    [lng - meio, lat - meio], [lng + meio, lat - meio],
                    [lng + meio, lat + meio], [lng - meio, lat + meio],
                    [lng - meio, lat - meio],
                ]],
            };
        },
    };
}

function feicao(id, lng = 0, lat = 0) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { id, source: 'points', size: 10 },
    };
}

function montarGerente(mapa, controle) {
    const selectionManager = {
        controls: new Map([['point', controle]]),
        hasSelectedFeatures: () => estadoDoStore.selecionadas.length > 0,
    };
    return new SelectionHighlightManager(mapa, selectionManager);
}

/** Quantas geometrias DISTINTAS a fonte recebeu (JSON das caixas). */
function distintas(escritas) {
    return new Set(escritas.map((fc) => JSON.stringify(fc.features.map((f) => f.geometry)))).size;
}

beforeEach(() => {
    relogio.instalar();
    estadoDoStore.arrastando = false;
    estadoDoStore.selecionadas = [];
    estadoDoStore.leiturasDeSelecao = 0;
});

afterEach(() => {
    globalThis.requestAnimationFrame = rafOriginal;
    globalThis.cancelAnimationFrame = cancelOriginal;
});

describe('SelectionHighlightManager: o passe de zoom por quadro', () => {
    it('o passe roda ao longo do gesto, e nao passa fome no proprio debounce', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);
        // O controle precisa saber o zoom do momento para montar a caixa.
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });

        estadoDoStore.leiturasDeSelecao = 0;
        ligarMotor(mapa, 0.05);
        const QUADROS = 30;
        for (let i = 0; i < QUADROS; i++) relogio.quadro();

        // UMA PASSADA A CADA DOIS QUADROS, e o numero e o certo, nao um teto por
        // desleixo. A callback pedida no quadro N roda no quadro N+1, e no quadro N+1
        // o mapa emite ANTES dela: o handler ve o pedido ainda pendente e sai. So no
        // quadro N+2 ele pede de novo. O Chromium mediu a mesma razao no app: 47
        // passadas em 92 quadros. O que o defeito antigo dava era ZERO.
        //
        // A contagem e de PASSADAS (uma leitura do store por passada), nao de escritas:
        // a escrita tem guarda propria, no caso de baixo.
        expect(estadoDoStore.leiturasDeSelecao).toBeGreaterThanOrEqual(Math.floor(QUADROS / 2) - 1);
        expect(estadoDoStore.leiturasDeSelecao).toBeLessThanOrEqual(QUADROS);
        gerente.destroy();
    });

    it('k eventos `zoom` dentro de UM quadro dao UMA passada', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        for (let i = 0; i < 5; i++) { mapa.zoom += 0.01; mapa.emitir('zoom'); }
        expect(mapa.escritas.length).toBe(0);
        relogio.quadro();
        expect(mapa.escritas.length).toBe(1);
        gerente.destroy();
    });

    it('a passada que nao muda nada NAO escreve a fonte', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        for (let i = 0; i < 10; i++) gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(1);

        // Mas uma mudanca de verdade sai: invalidar o cache monta caixa nova.
        gerente.invalidateCache('f1');
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(2);
        gerente.destroy();
    });

    it('mudar a SELECAO escreve, mesmo sem tocar no cache', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(1);
        expect(mapa.escritas[0].features.length).toBe(1);

        // Uma segunda feicao entra na selecao: a colecao muda de tamanho.
        estadoDoStore.selecionadas = [
            { type: 'point', feature: feicao('f1') },
            { type: 'point', feature: feicao('f2', 1, 1) },
        ];
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(2);
        expect(mapa.escritas[1].features.length).toBe(2);

        // E sair da selecao tambem escreve, senao a caixa fica na tela sem dono.
        estadoDoStore.selecionadas = [];
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(3);
        expect(mapa.escritas[2].features.length).toBe(0);
        gerente.destroy();
    });

    it('mudar a GEOMETRIA da feicao escreve, pelo hash e pela notificacao do controle', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        const alvo = feicao('f1');
        estadoDoStore.selecionadas = [{ type: 'point', feature: alvo }];
        const gerente = montarGerente(mapa, controle);

        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(1);

        // A feicao andou. O hash de geometria muda, entao o cache reprova sozinho e a
        // caixa e remontada, sem ninguem avisar o gerente.
        alvo.geometry.coordinates = [2, 3];
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(2);

        // E a notificacao explicita do controle continua valendo como invalidacao.
        gerente.notifyGeometryChange('f1');
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(3);
        gerente.destroy();
    });

    it('depois de um arrasto deslocar as caixas, a passada seguinte volta a escrever', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        gerente.updateSelectionHighlight();
        const depoisDaPrimeira = mapa.escritas.length;

        // O arrasto escreve a fonte por fora do passe (caixas deslocadas por delta).
        gerente.shiftSelectionBoxes(0.001, 0.001);
        expect(mapa.escritas.length).toBe(depoisDaPrimeira + 1);

        // A passada seguinte monta as MESMAS caixas de antes do arrasto, e mesmo assim
        // tem de escrever: o que esta na fonte e o deslocado, nao o que ela montou.
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(depoisDaPrimeira + 2);
        gerente.destroy();
    });

    it('limpar o cache inteiro faz a proxima passada escrever, porque a fonte fica desconhecida', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(1);
        gerente.invalidateAllCache();
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(2);
        gerente.destroy();
    });

    it('a fonte recriada por um `setStyle` volta a receber a escrita, com o cache quente', () => {
        // O pior caso da guarda de IDENTIDADE, e ele nao e teorico: `ensureSource` em
        // `layers/styles/auxiliary.layers.js` recria `selection-boxes` VAZIA na
        // reconstrucao completa, enquanto o cache de caixas deste gerente continua
        // devolvendo os MESMOS objetos. Sem comparar tambem a fonte, a guarda concluiria
        // "nada mudou" e a caixa sumiria da tela ate o zoom cruzar de faixa.
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        gerente.updateSelectionHighlight();
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(1);

        mapa.trocarFonte();
        gerente.updateSelectionHighlight();
        expect(mapa.escritas.length).toBe(2);
        expect(mapa.escritas[1].features.length).toBe(1);
        gerente.destroy();
    });

    it('a caixa ACOMPANHA o zoom: o gesto escreve uma geometria por faixa de 0,5 nivel', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        // 1,5 nivel em 30 quadros, de 6,05 a 7,50. A chave de cache quantiza em
        // `Math.round(zoom * 2) / 2`, entao as faixas visitadas sao 6,0 / 6,5 / 7,0 /
        // 7,5: QUATRO geometrias distintas, nao trinta e nao uma. E a quantizacao que
        // decide isso, e por isso o numero se deriva dela aqui em vez de ser digitado.
        ligarMotor(mapa, 0.05);
        for (let i = 0; i < 30; i++) relogio.quadro();

        expect(mapa.zoom).toBeCloseTo(7.5, 6);
        const faixasVisitadas = new Set();
        for (let z = 6.05; z <= 7.5000001; z += 0.05) faixasVisitadas.add(Math.round(z * 2) / 2);
        expect(distintas(mapa.escritas)).toBe(faixasVisitadas.size);
        // E o gesto escreveu UMA vez por faixa, nao uma por passada: a guarda de
        // identidade engole o quadro que monta a mesma colecao.
        expect(mapa.escritas.length).toBe(faixasVisitadas.size);
        // E a ultima escrita nao pode ser a primeira: a caixa mudou de tamanho.
        const primeira = JSON.stringify(mapa.escritas[0].features[0].geometry);
        const ultima = JSON.stringify(mapa.escritas.at(-1).features[0].geometry);
        expect(ultima).not.toBe(primeira);
        gerente.destroy();
    });

    it('destroy cancela o quadro pendente e larga o ouvinte', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        mapa.emitir('zoom');
        gerente.destroy();
        relogio.quadro();
        expect(mapa.escritas.length).toBe(0);

        mapa.emitir('zoom');
        relogio.quadro();
        expect(mapa.escritas.length).toBe(0);
    });

    it('arrastando, o quadro sai sem escrever (a guarda de arrasto continua valendo)', () => {
        const mapa = montarMapa();
        const controle = montarControle();
        Object.defineProperty(controle, '__zoomAtual', { get: () => mapa.zoom });
        estadoDoStore.selecionadas = [{ type: 'point', feature: feicao('f1') }];
        const gerente = montarGerente(mapa, controle);

        estadoDoStore.arrastando = true;
        ligarMotor(mapa, 0.05);
        for (let i = 0; i < 10; i++) relogio.quadro();
        expect(mapa.escritas.length).toBe(0);
        gerente.destroy();
    });
});
