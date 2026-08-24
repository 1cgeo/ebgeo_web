// Path: tests/unit/aviso-de-camada-que-nao-carrega.test.js
//
// O AVISO DE SUPERFICIE QUE NAO CARREGOU, pelo COMPORTAMENTO e nao pelo texto do arquivo.
//
// POR QUE ELE EXISTE. `data-layer-phrases.test.js` cobre as funcoes puras e so elas. As tres
// metades que quebram CALADAS nunca tiveram teste nenhum: o desenho do painel, a agregacao por
// camada (uma rajada de dezenas de tiles falhos tem de virar UMA frase) e a RETIRADA da acusacao
// quando a camada volta a desenhar. As tres moram em `js/terrain/layer-failure-notice.js`, que
// monta DOM e escuta o mapa, e por isso este arquivo instala um `document` minimo e um mapa duplo
// em vez de inspecionar texto de fonte. O molde do duplo de `document` e o de
// `import-progress-overlay.test.js`; o de "falhar alto quando a ancora some" e o de
// `calibracao-escape-e-repeticao.test.js`.
//
// O QUE CADA BLOCO PROVA, e o que ele NAO prova:
//
//  1. AGREGACAO. Prova que N eventos `error` de uma camada viram UMA entrada, que a segunda fonte
//     da mesma camada (`config.labelSource`) dobra sobre ela, e que uma camada ja anunciada nao
//     reagenda o temporizador. NAO prova nada sobre o intervalo escolhido (700 ms e decisao, nao
//     invariante) nem sobre como o MapLibre real emite `error`: o duplo emite o formato
//     `{sourceId, error:{status}}` medido no bundle vendorizado.
//     QUEM PRENDE A AGREGACAO E O CASO DO TEMPORIZADOR, e nao a frase, e isso foi MEDIDO no
//     controle negativo: chavear o mapa de falhas por PEDIDO em vez de por camada deixa a
//     mensagem identica, porque as frases ja deduplicam por NOME (`distinctNames`). O que muda e
//     o reagendamento, entao e la que a asserção discrimina. Pelo mesmo motivo o caso do
//     `labelSource` derruba a fonte de rotulo SOZINHA: com as duas juntas, apagar a dobra nao
//     mudaria uma letra da frase.
//  2. RETIRADA. Prova que `sourcedata` com `isSourceLoaded` derruba a acusacao daquela camada e
//     so dela, e que sem `isSourceLoaded` nao derruba nada. NAO prova que o MapLibre emita
//     `isSourceLoaded: true` no instante certo.
//  3. ANALISE NO MESMO PAINEL. Prova que a camada de analise entra pela mesma agregacao e que
//     continua existindo UM elemento no contêiner. NAO prova a fiacao do catalogo que liga o
//     interruptor.
//  4. MAPA BASE. Prova que uma fonte declarada pelo ESTILO (aprendida em `style.load`) acusa o
//     mapa base, que a frase nao afirma causa, que o codigo HTTP sai sem interpretacao, e que o
//     botao de tentar de novo NAO se desenha quando so o mapa base esta acusado. NAO prova o
//     outro formato de falha do basemap (o documento do estilo que nao carrega), que nao chega a
//     este modulo: o motivo esta no `fileoverview` de `layer-failure-notice.js`.
//  5. ESTILO NOVO ZERA. Prova que `style.load` derruba tudo e libera o `_announced`.
//  6. DISCRIMINACAO. Prova que camada invisivel e fonte desconhecida nao produzem aviso nenhum.
//     E o bloco que impede a cobertura vazia: sem ele, um `_resolve` que devolvesse sempre algo
//     passaria em todos os outros.
//  7. TENTAR DE NOVO. Prova que so o que e retentavel e retentado e que o que NAO e continua
//     acusado na tela (silenciar o mapa base porque a pessoa clicou num botao que nunca falou
//     dele e o mesmo defeito do aviso que sobrevive a falha, so que invertido).
//  8. LIMPEZA. Prova que os tres `map.on` tem `map.off` pareado e que o painel sai do DOM.
//  9. AS DUAS FRASES NOVAS, direto. Prova as bordas que o painel nao produz (nome vazio, nada
//     falhando, a nova tentativa aplicada so a metade das camadas). NAO prova redacao.
//
// CONTROLE NEGATIVO, conferido caso a caso ao escrever (cada reversao deixa VERMELHO o `it`
// nomeado): a dobra de `labelSource` em `_layerIdFromSourceId`, o `_announced`, o
// `if (!e?.isSourceLoaded) return`, o `_snapshotBasemapSources`, o `_clearAll` do `style.load`, o
// `if (!this._isVisible(hit)) return`, o filtro de `retry` em `_retryFailures` e cada
// `this._unsubscribers.push(...)` de `_watchMap`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `settings.operations.js` arrasta a store inteira (IndexedDB, namespace por atlas) e nada dela
// participa deste comportamento: o unico uso e `restoreLayersState`, que nenhum bloco chama.
vi.mock('../../src/js/store/settings.operations.js', () => ({
    getMapAnalysisLayersStates: async () => ({}),
}));

const { default: config } = await import('../../src/js/config.js');
const { default: DataLayersManager } = await import('../../src/js/terrain/data-layers.manager.js');
const { default: AnalysisLayersManager } = await import('../../src/js/terrain/analysis-layers.manager.js');
const { FAILURE_COALESCE_MS } = await import('../../src/js/terrain/layer-failure-notice.js');
const { basemapLoadFailureNotice, loadFailureHeadline } = await import('../../src/js/terrain/data-layer-phrases.js');

// ---------------------------------------------------------------------------
// Duplos
// ---------------------------------------------------------------------------

/** Elemento minimo: so o que `_ensureNotice` e `_renderNotice` tocam. */
function makeElement(tagName) {
    const el = {
        tagName,
        className: '',
        textContent: '',
        type: '',
        hidden: false,
        dataset: {},
        attributes: {},
        children: [],
        parentNode: null,
        _listeners: {},
        setAttribute(name, value) { el.attributes[name] = value; },
        getAttribute(name) { return el.attributes[name]; },
        appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
        append(...kids) { for (const kid of kids) el.appendChild(kid); },
        addEventListener(type, handler) {
            (el._listeners[type] = el._listeners[type] || []).push(handler);
        },
        removeEventListener(type, handler) {
            const bucket = el._listeners[type];
            if (!bucket) return;
            const i = bucket.indexOf(handler);
            if (i >= 0) bucket.splice(i, 1);
        },
        click() { for (const handler of (el._listeners.click || []).slice()) handler(); },
        remove() {
            if (!el.parentNode) return;
            const i = el.parentNode.children.indexOf(el);
            if (i >= 0) el.parentNode.children.splice(i, 1);
            el.parentNode = null;
        },
    };
    return el;
}

/** Todos os descendentes com um `data-testid`, em profundidade. */
function allByTestId(root, testid) {
    const found = [];
    const walk = (node) => {
        if (node.dataset?.testid === testid) found.push(node);
        for (const child of node.children || []) walk(child);
    };
    walk(root);
    return found;
}

/**
 * O UNICO no com aquele `data-testid`, falhando alto quando ele sumiu ou duplicou.
 *
 * A forma ingenua (pegar o primeiro) fica verde quando um segundo painel nasce, que e exatamente
 * o defeito que este arquivo existe para impedir; e fica verde tambem quando o `data-testid` e
 * renomeado, porque `undefined` nunca casa e o teste passa a nao verificar nada.
 */
function unico(root, testid) {
    const found = allByTestId(root, testid);
    expect(found.length, `esperado UM no com data-testid="${testid}", achados ${found.length}`).toBe(1);
    return found[0];
}

/** Mapa duplo: estilo, fontes, camadas e o barramento de eventos que o aviso escuta. */
function makeMap() {
    const handlers = {};
    const container = makeElement('div');
    return {
        container,
        styleSources: {},
        sources: new Map(),
        layers: new Map(),
        images: new Set(),
        addedSources: [],
        getContainer() { return container; },
        getStyle() { return { sources: this.styleSources }; },
        on(type, handler) { (handlers[type] = handlers[type] || []).push(handler); },
        off(type, handler) {
            const bucket = handlers[type];
            if (!bucket) return;
            const i = bucket.indexOf(handler);
            if (i >= 0) bucket.splice(i, 1);
        },
        listenerCount(type) { return (handlers[type] || []).length; },
        emit(type, event) { for (const handler of (handlers[type] || []).slice()) handler(event); },
        getSource(id) { return this.sources.get(id) || null; },
        addSource(id, cfg) { this.sources.set(id, cfg); this.addedSources.push(id); },
        removeSource(id) { this.sources.delete(id); },
        getLayer(id) { return this.layers.get(id) || null; },
        addLayer(layer) { this.layers.set(layer.id, layer); },
        removeLayer(id) { this.layers.delete(id); },
        setLayoutProperty(id, prop, value) {
            const layer = this.layers.get(id);
            if (layer) (layer.layout = layer.layout || {})[prop] = value;
        },
        getLayoutProperty(id, prop) { return this.layers.get(id)?.layout?.[prop]; },
        hasImage(id) { return this.images.has(id); },
        addImage(id) { this.images.add(id); },
        removeImage(id) { this.images.delete(id); },
    };
}

// ---------------------------------------------------------------------------
// Cenario
// ---------------------------------------------------------------------------

const DATA_LAYERS = [
    {
        id: 'molduras',
        name: 'Molduras',
        source: { type: 'vector', tiles: ['https://x/{z}/{x}/{y}.pbf'] },
        // A SEGUNDA fonte da MESMA camada: e ela que o bloco 1 exige que dobre.
        labelSource: { type: 'vector', tiles: ['https://x/rot/{z}/{x}/{y}.pbf'] },
        sourceLayer: 'molduras',
        style: { border: { color: '#333' }, label: { textField: ['get', 'nome'] } },
    },
    {
        id: 'cidades',
        name: 'Cidades',
        source: { type: 'vector', tiles: ['https://x/cid/{z}/{x}/{y}.pbf'] },
        sourceLayer: 'cidades',
        style: { border: { color: '#666' } },
    },
];

const ANALYSIS_LAYERS = [
    {
        id: 'declividade',
        name: 'Declividade',
        bounds: [-50, -20, -40, -10],
        source: { type: 'raster', tiles: ['https://x/dec/{z}/{x}/{y}.png'] },
    },
];

let map;
let dataManager;
let analysisManager;
let originalDocument;
let originalDataLayers;
let originalAnalysisLayers;

/** Um `error` do MapLibre no formato medido no bundle vendorizado. */
function falhaDeTile(sourceId, status) {
    map.emit('error', { sourceId, error: status === undefined ? {} : { status } });
}

/** Deixa o temporizador de coalescencia estourar. */
function passaARajada() {
    vi.advanceTimersByTime(FAILURE_COALESCE_MS);
}

function mensagem() {
    return unico(map.container, 'camada-inacessivel-mensagem').textContent;
}

function detalhe() {
    return unico(map.container, 'camada-inacessivel-detalhe').textContent;
}

function aviso() {
    return unico(map.container, 'camada-inacessivel-aviso');
}

beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = { createElement: makeElement };
    originalDataLayers = config.dataLayers;
    originalAnalysisLayers = config.analysisLayers;
    config.dataLayers = { enabled: true, layers: DATA_LAYERS.map((l) => ({ ...l })) };
    config.analysisLayers = { enabled: true, layers: ANALYSIS_LAYERS.map((l) => ({ ...l })) };

    vi.useFakeTimers();
    map = makeMap();
    dataManager = new DataLayersManager(map);
    analysisManager = new AnalysisLayersManager(map);
});

afterEach(() => {
    vi.useRealTimers();
    globalThis.document = originalDocument;
    config.dataLayers = originalDataLayers;
    config.analysisLayers = originalAnalysisLayers;
});

/** Liga uma camada de dado, que e o que torna a falha dela digna de palavra. */
async function ligaDado(layerId) {
    dataManager.addDataLayer(layerId);
    await dataManager.toggleLayer(layerId, true);
}

async function ligaAnalise(layerId) {
    await analysisManager.toggleLayer(layerId, true);
}

describe('1. a rajada de tiles falhos vira UMA frase, contada por camada', () => {
    it('dezenas de eventos de duas camadas produzem um painel so, com contagem 2', async () => {
        await ligaDado('molduras');
        await ligaDado('cidades');

        for (let i = 0; i < 20; i += 1) falhaDeTile('data-molduras');
        for (let i = 0; i < 3; i += 1) falhaDeTile('data-cidades');
        passaARajada();

        // UM painel, e nao um por gerente nem um por pedido.
        expect(allByTestId(map.container, 'camada-inacessivel-aviso')).toHaveLength(1);
        expect(aviso().hidden).toBe(false);
        expect(mensagem()).toBe('2 camadas não puderam ser carregadas: "Molduras" e "Cidades".');
    });

    it('a SEGUNDA fonte da mesma camada (labelSource) dobra sobre ela, e nao vira uma terceira', async () => {
        await ligaDado('molduras');

        // A fonte de RÓTULO SOZINHA, e a ordem aqui e a metade que discrimina: com as duas fontes
        // falhando juntas, apagar a dobra deixaria a frase IDENTICA (a camada ja estaria acusada
        // pela fonte principal, e as frases deduplicam por nome), e o controle negativo passaria
        // verde. Com so a fonte de rotulo, sem a dobra nao ha aviso nenhum.
        falhaDeTile('data-molduras-label-source');
        passaARajada();

        expect(aviso().hidden).toBe(false);
        expect(mensagem()).toBe('A camada "Molduras" não pôde ser carregada.');
        expect(mensagem()).not.toContain('Camada sem nome');

        // E as duas juntas continuam UMA camada.
        falhaDeTile('data-molduras');
        passaARajada();
        expect(mensagem()).toBe('A camada "Molduras" não pôde ser carregada.');
    });

    it('camada JA anunciada nao reagenda o temporizador; camada nova reagenda', async () => {
        await ligaDado('molduras');
        await ligaDado('cidades');

        falhaDeTile('data-molduras');
        expect(vi.getTimerCount()).toBe(1);
        passaARajada();
        expect(vi.getTimerCount()).toBe(0);

        // A mesma camada de novo: mesma noticia, nenhum trabalho novo.
        falhaDeTile('data-molduras');
        falhaDeTile('data-molduras');
        expect(vi.getTimerCount()).toBe(0);

        // Camada AINDA nao anunciada: noticia nova, agenda de novo.
        falhaDeTile('data-cidades');
        expect(vi.getTimerCount()).toBe(1);
        passaARajada();
        expect(mensagem()).toBe('2 camadas não puderam ser carregadas: "Molduras" e "Cidades".');
    });

    it('o codigo HTTP sai medido e sem interpretacao, e a frase nao afirma causa', async () => {
        await ligaDado('molduras');

        falhaDeTile('data-molduras', 403);
        falhaDeTile('data-molduras', 500);
        // 0 nao e resposta: e o que o fetch reporta para pedido bloqueado ou abortado.
        falhaDeTile('data-molduras', 0);
        passaARajada();

        // Ancorado no INICIO e fechado no ponto: `not.toContain('0')` ficaria vermelho pelo zero
        // de 500, e uma asserção que confunde os dois nao discrimina o caso que interessa.
        expect(detalhe()).toMatch(/^O servidor respondeu 403, 500\. /);
        // A restricao de acesso e UMA hipotese entre tres, e nunca uma afirmacao. Este perfil
        // (credenciado) le todo recurso privado: "voce nao tem acesso" seria mentira sobre o
        // proprio papel dele.
        expect(detalhe()).toContain('pode ser a rede');
        expect(detalhe()).toContain('restrição de acesso');
        expect(detalhe().toLowerCase()).not.toContain('você não tem acesso');
        expect(mensagem().toLowerCase()).not.toContain('acesso');
    });
});

describe('2. a retirada da acusacao vale tanto quanto a acusacao', () => {
    it('sourcedata com isSourceLoaded derruba o aviso da camada que voltou', async () => {
        await ligaDado('molduras');
        falhaDeTile('data-molduras');
        passaARajada();
        expect(aviso().hidden).toBe(false);

        map.emit('sourcedata', { sourceId: 'data-molduras', isSourceLoaded: true });

        expect(aviso().hidden).toBe(true);
    });

    it('derruba SO a que voltou: a outra continua nomeada, no singular', async () => {
        await ligaDado('molduras');
        await ligaDado('cidades');
        falhaDeTile('data-molduras');
        falhaDeTile('data-cidades');
        passaARajada();

        map.emit('sourcedata', { sourceId: 'data-cidades', isSourceLoaded: true });

        expect(aviso().hidden).toBe(false);
        expect(mensagem()).toBe('A camada "Molduras" não pôde ser carregada.');
    });

    it('BORDA: sourcedata sem isSourceLoaded nao derruba nada', async () => {
        await ligaDado('molduras');
        falhaDeTile('data-molduras');
        passaARajada();

        map.emit('sourcedata', { sourceId: 'data-molduras' });
        map.emit('sourcedata', { sourceId: 'data-molduras', isSourceLoaded: false });

        expect(aviso().hidden).toBe(false);
    });

    it('desligar a camada retira a acusacao, para que a proxima falha possa falar de novo', async () => {
        await ligaDado('molduras');
        falhaDeTile('data-molduras');
        passaARajada();

        await dataManager.toggleLayer('molduras', false);
        expect(aviso().hidden).toBe(true);

        await dataManager.toggleLayer('molduras', true);
        falhaDeTile('data-molduras');
        expect(vi.getTimerCount()).toBe(1);
        passaARajada();
        expect(aviso().hidden).toBe(false);
    });
});

describe('3. a camada de analise entra pelo MESMO painel', () => {
    it('a falha de uma fonte analysis- e nomeada, sem abrir um segundo painel', async () => {
        await ligaAnalise('declividade');

        falhaDeTile('analysis-declividade');
        passaARajada();

        expect(allByTestId(map.container, 'camada-inacessivel-aviso')).toHaveLength(1);
        expect(mensagem()).toBe('A camada "Declividade" não pôde ser carregada.');
    });

    it('dado e analise falhando juntos sao UMA frase de duas camadas', async () => {
        await ligaDado('molduras');
        await ligaAnalise('declividade');

        falhaDeTile('data-molduras');
        falhaDeTile('analysis-declividade');
        passaARajada();

        expect(allByTestId(map.container, 'camada-inacessivel-aviso')).toHaveLength(1);
        expect(mensagem()).toBe('2 camadas não puderam ser carregadas: "Molduras" e "Declividade".');
    });
});

describe('4. o mapa base, que e o estilo inteiro e nao uma fonte somada a ele', () => {
    /** O que o `style.load` faz: as fontes do mapa naquele instante sao as do estilo. */
    function estiloCarrega(sourceIds) {
        map.styleSources = Object.fromEntries(sourceIds.map((id) => [id, {}]));
        map.emit('style.load', {});
    }

    it('uma fonte DECLARADA PELO ESTILO acusa o mapa base, sem prefixo nenhum para reconhece-la', () => {
        estiloCarrega(['osm']);

        falhaDeTile('osm', 403);
        passaARajada();

        expect(mensagem()).toBe('O mapa base não pôde ser carregado.');
        expect(detalhe()).toContain('O servidor respondeu 403.');
        expect(detalhe()).toContain('O motivo não é conhecido daqui');
    });

    it('o botao de tentar de novo NAO se desenha quando so o mapa base esta acusado', () => {
        estiloCarrega(['osm']);
        falhaDeTile('osm');
        passaARajada();

        expect(unico(map.container, 'camada-inacessivel-tentar-de-novo').hidden).toBe(true);
        // Dispensar continua: silenciar e uma acao que a pessoa PODE executar aqui.
        expect(unico(map.container, 'camada-inacessivel-dispensar').hidden).toBe(false);
    });

    it('com uma camada retentavel junto, o botao volta, e o mapa base vem PRIMEIRO na frase', async () => {
        estiloCarrega(['osm']);
        await ligaDado('molduras');

        falhaDeTile('osm');
        falhaDeTile('data-molduras');
        passaARajada();

        expect(unico(map.container, 'camada-inacessivel-tentar-de-novo').hidden).toBe(false);
        expect(mensagem()).toBe(
            'O mapa base não pôde ser carregado. A camada "Molduras" não pôde ser carregada.'
        );
    });

    it('o mapa base que volta a desenhar retira a propria acusacao', () => {
        estiloCarrega(['osm']);
        falhaDeTile('osm');
        passaARajada();
        expect(aviso().hidden).toBe(false);

        map.emit('sourcedata', { sourceId: 'osm', isSourceLoaded: true });

        expect(aviso().hidden).toBe(true);
    });

    it('a fonte do estilo NAO rouba a fonte de uma camada nossa homonima', async () => {
        // Se um estilo declarasse `data-molduras`, o instantaneo o incluiria; as superficies
        // registradas sao consultadas ANTES, entao a camada continua sendo a camada.
        estiloCarrega(['osm', 'data-molduras']);
        await ligaDado('molduras');

        falhaDeTile('data-molduras');
        passaARajada();

        expect(mensagem()).toBe('A camada "Molduras" não pôde ser carregada.');
        expect(mensagem()).not.toContain('mapa base');
    });
});

describe('5. estilo novo e mapa novo: tudo o que estava acusado cai', () => {
    it('style.load derruba o painel E libera o anuncio, para a falha seguinte poder falar', async () => {
        await ligaDado('molduras');
        falhaDeTile('data-molduras');
        passaARajada();
        expect(aviso().hidden).toBe(false);

        map.styleSources = { satellite: {} };
        map.emit('style.load', {});

        expect(aviso().hidden).toBe(true);
        // `_announced` tambem foi liberado: a mesma camada reagenda.
        falhaDeTile('data-molduras');
        expect(vi.getTimerCount()).toBe(1);
    });
});

describe('6. discriminacao: o que NAO deve produzir aviso nenhum', () => {
    it('camada que ninguem ligou nao e acusada', () => {
        dataManager.addDataLayer('molduras');

        falhaDeTile('data-molduras');
        passaARajada();

        expect(vi.getTimerCount()).toBe(0);
        expect(allByTestId(map.container, 'camada-inacessivel-aviso')).toHaveLength(0);
    });

    it('fonte que nao e de ninguem (feicoes, terreno, 3D) e ignorada', async () => {
        await ligaDado('molduras');

        falhaDeTile('features-source');
        falhaDeTile('hillshade');
        falhaDeTile(undefined);
        falhaDeTile(null);
        passaARajada();

        expect(allByTestId(map.container, 'camada-inacessivel-aviso')).toHaveLength(0);
    });

    it('dispensar silencia sem apagar o estado, entao o proximo tile falho nao ressuscita o aviso', async () => {
        await ligaDado('molduras');
        falhaDeTile('data-molduras');
        passaARajada();

        unico(map.container, 'camada-inacessivel-dispensar').click();
        expect(aviso().hidden).toBe(true);

        falhaDeTile('data-molduras');
        passaARajada();
        expect(aviso().hidden).toBe(true);
    });
});

describe('7. tentar de novo: so o retentavel, e o resto continua acusado', () => {
    it('a camada de dado e reconstruida (fonte derrubada e re-adicionada)', async () => {
        await ligaDado('molduras');
        falhaDeTile('data-molduras');
        passaARajada();

        map.addedSources.length = 0;
        unico(map.container, 'camada-inacessivel-tentar-de-novo').click();

        // Derrubar a fonte E o ponto: o MapLibre guarda o tile falho pela vida dela.
        expect(map.addedSources).toContain('data-molduras');
        expect(map.getSource('data-molduras')).not.toBeNull();
        // E a camada volta VISIVEL, porque era visivel antes.
        expect(dataManager.isLayerVisible('molduras')).toBe(true);
    });

    it('o mapa base, que nao e retentavel, CONTINUA acusado depois do clique', async () => {
        map.styleSources = { osm: {} };
        map.emit('style.load', {});
        await ligaDado('molduras');

        falhaDeTile('osm');
        falhaDeTile('data-molduras');
        passaARajada();

        unico(map.container, 'camada-inacessivel-tentar-de-novo').click();

        expect(aviso().hidden).toBe(false);
        expect(mensagem()).toBe('O mapa base não pôde ser carregado.');
        // Sobrou so o nao-retentavel: o botao some.
        expect(unico(map.container, 'camada-inacessivel-tentar-de-novo').hidden).toBe(true);
    });

    it('a segunda falha da mesma camada NOMEIA a nova tentativa, em vez de repetir a frase', async () => {
        await ligaDado('molduras');
        falhaDeTile('data-molduras');
        passaARajada();

        unico(map.container, 'camada-inacessivel-tentar-de-novo').click();
        falhaDeTile('data-molduras');
        passaARajada();

        expect(mensagem()).toBe('A camada "Molduras" continua sem carregar após a nova tentativa.');
    });
});

describe('8. limpeza: nenhum map.on sem o map.off, nenhum painel orfao', () => {
    it('os tres sinais do mapa sao assinados uma vez so, pelos dois gerentes juntos', () => {
        expect(map.listenerCount('error')).toBe(1);
        expect(map.listenerCount('sourcedata')).toBe(1);
        expect(map.listenerCount('style.load')).toBe(1);
    });

    it('destruir os dois gerentes solta os listeners e tira o painel do DOM', async () => {
        await ligaDado('molduras');
        falhaDeTile('data-molduras');
        passaARajada();
        expect(map.container.children.length).toBe(1);

        dataManager.destroy();
        // O primeiro destroy nao pode levar o painel: a analise ainda usa o mesmo aviso.
        expect(map.listenerCount('error')).toBe(1);

        analysisManager.destroy();

        expect(map.listenerCount('error')).toBe(0);
        expect(map.listenerCount('sourcedata')).toBe(0);
        expect(map.listenerCount('style.load')).toBe(0);
        expect(map.container.children.length).toBe(0);
    });
});

describe('9. as duas frases novas, nas bordas que o painel nao alcanca', () => {
    it('basemapLoadFailureNotice: com nome e sem nome, e o vazio NAO vira aspas vazias', () => {
        expect(basemapLoadFailureNotice('Carta Ortoimagem'))
            .toBe('O mapa base "Carta Ortoimagem" não pôde ser carregado.');
        expect(basemapLoadFailureNotice(null)).toBe('O mapa base não pôde ser carregado.');
        expect(basemapLoadFailureNotice(undefined)).toBe('O mapa base não pôde ser carregado.');
        expect(basemapLoadFailureNotice('   ')).toBe('O mapa base não pôde ser carregado.');
        expect(basemapLoadFailureNotice('  BDGEx  ')).toBe('O mapa base "BDGEx" não pôde ser carregado.');
    });

    it('loadFailureHeadline: nada falhou devolve string VAZIA, para nao existir aviso sobre nada', () => {
        expect(loadFailureHeadline()).toBe('');
        expect(loadFailureHeadline({})).toBe('');
        expect(loadFailureHeadline({ layerNames: [] })).toBe('');
        expect(loadFailureHeadline({ layerNames: [], basemapFailed: false })).toBe('');
    });

    it('loadFailureHeadline: a nova tentativa vale so para a metade das camadas', () => {
        // O mapa base nao e re-pedido por este aviso, entao dizer "após a nova tentativa" sobre
        // ele descreveria uma tentativa que nunca aconteceu.
        expect(loadFailureHeadline({
            layerNames: ['Molduras'], basemapFailed: true, retried: true,
        })).toBe(
            'O mapa base não pôde ser carregado. '
            + 'A camada "Molduras" continua sem carregar após a nova tentativa.'
        );
    });
});
