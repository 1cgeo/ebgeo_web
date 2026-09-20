// Path: tests/integration/mapa-base-e-vista-da-pessoa.repro.test.js
//
// O MAPA BASE NA TELA É ESTADO DE VISTA DA PESSOA, COMO A CÂMERA (decisão do dono, 2026-09-20).
//
// OS TRÊS DEFEITOS QUE ESTE ARQUIVO PRENDE, todos da mesma raiz (escolher base era ESCRITA no
// documento do mapa, com op `baseLayer` enfileirada):
//
//   1. O FALLBACK REGRAVAVA A BASE DE TODOS. `switchMap` saneava a base que o catálogo de quem
//      entra não oferece e PERSISTIA o fallback. Um Editor sem concessão a uma base privada abria
//      o mapa e, sem clicar em nada, trocava a base salva para o atlas inteiro. É a causa raiz
//      documentada neste `.repro`: a leitura de um mapa nunca pode ser uma escrita.
//   2. O GOSTO DE UMA PESSOA REPINTAVA A TELA DAS OUTRAS. Cada clique no seletor viajava, e desde
//      2026-09-16 o par aplicava o estilo recebido na própria tela.
//   3. O LEITOR E O MAPA TRAVADO NÃO ESCOLHIAM BASE NENHUMA, porque a escolha morria no guarda.
//
// O SINAL MEDIDO. A prova de "não grava" é dupla, por caminhos independentes: o espião de
// `setBaseLayer` no barril da store nunca é chamado, E a FONTE do controle não importa mais
// aquele nome (o espião sozinho passaria verde se o controle escrevesse por outra porta). A prova
// de "desenha" é o `setStyle` no mapa falso, que é o gesto que troca o que está na tela.
//
// ELE DIRIGE O CONTROLE DE VERDADE, no molde de `tests/unit/troca-de-base-decide-pelo-mapa.test.js`.
// O QUE NÃO ALCANÇA: MapLibre real, sync real e DOM; isso é do Playwright.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const chamadas = { setBaseLayer: [], setupMapFeatures: [], vistaTemporal: [] };
const barramento = criarBarramento();
const estado = {
    mapaAtivo: 'mapa-1',
    crenca: undefined,
    baseSalva: 'carta-topografica',
    temPosicaoSalva: false,
    meuCatalogo: ['carta-topografica', 'imagens', 'osm'],
};

function criarBarramento() {
    const registro = new Map();
    return {
        on(evento, handler) {
            if (!registro.has(evento)) registro.set(evento, new Set());
            registro.get(evento).add(handler);
            return () => registro.get(evento).delete(handler);
        },
        off(evento, handler) { registro.get(evento)?.delete(handler); },
        emitidos: [],
        emit(evento, payload) {
            this.emitidos.push({ evento, payload });
            for (const handler of [...(registro.get(evento) ?? [])]) handler(payload);
        },
        async disparar(evento, payload) {
            await Promise.all([...(registro.get(evento) ?? [])].map((h) => h(payload)));
        },
        ouvintes(evento) { return registro.get(evento)?.size ?? 0; },
    };
}

vi.mock('../../src/js/store', () => ({
    // Fica no barril de propósito: se o controle voltar a escrever, é por aqui que ele passa.
    setBaseLayer: async (id) => { chamadas.setBaseLayer.push(id); },
    getCurrentMapName: async () => estado.mapaAtivo,
    getCurrentBaseLayer: async () => estado.baseSalva,
    hasMapSavedPosition: async () => estado.temPosicaoSalva,
    getMapPosition: async () => ({ center_lat: -15, center_long: -47, zoom: 9, bearing: 0, pitch: 0 }),
    applySavedMapTemporalView: async (mapName) => { chamadas.vistaTemporal.push(mapName); return true; },
    getCatalogLayers: async () => [],
    getEventBus: () => barramento,
    getStateManager: () => ({
        get: (chave) => (chave === 'baseLayer.activeLayer' ? estado.crenca : undefined),
        set: (chave, valor) => { if (chave === 'baseLayer.activeLayer') estado.crenca = valor; },
    }),
    getControl: () => null,
}));

vi.mock('../../src/js/store/atlas-appearance.service.js', () => ({
    currentGlobeProjection: () => false,
    refreshAtlasAppearance: async () => {},
    reapplyAtlasAppearance: async () => {},
}));

vi.mock('../../src/js/terrain/layer-failure-notice.js', () => ({
    getLayerFailureNotice: () => ({ reportBasemapFailure: () => {}, clearBasemapFailure: () => {} }),
}));

vi.mock('../../src/js/layers', () => ({
    setupMapFeatures: async (_map, _a, _d, _bus, options) => { chamadas.setupMapFeatures.push(options); },
}));

vi.mock('../../src/js/layers/layer_setup.js', () => ({ clearFeatureSources: () => {} }));
vi.mock('../../src/js/layers/remote-feature-render.js', () => ({ wireRemoteFeatureRender: () => () => {} }));
vi.mock('../../src/js/utilities', () => ({ showError: () => {} }));

vi.mock('../../src/js/config.js', () => ({
    default: {
        validateBasemapsConfig: () => {},
        getEnabledBasemaps: () => estado.meuCatalogo.map((id) => [id, { name: id }]),
        getBasemapLayoutClass: () => 'layout',
        // O catálogo DESTA pessoa: um id que ele não oferece cai na primeira base oferecida.
        getValidBasemapFallback: (id) => (estado.meuCatalogo.includes(id) ? id : estado.meuCatalogo[0]),
        get basemaps() { return Object.fromEntries(estado.meuCatalogo.map((id) => [id, { name: id, enabled: true }])); },
        get basemapStyles() { return {}; },
        map2d: { minZoom: 2, maxZoom: 21 },
        features: { grid: false },
    },
}));

const { EventTypes } = await import('../../src/js/events/event_types.js');
const { default: BaseLayerControl } = await import('../../src/js/baselayers/base-layer.control.js');
const { default: cartaTopografica } = await import('../../src/js/baselayers/carta_topografica.js');

/** Mapa falso: registra os `setStyle` e os `jumpTo`, que são os gestos que mudam a tela. */
function mapaFalso(estiloInicial) {
    const ouvintes = new Map();
    return {
        _estilo: JSON.parse(JSON.stringify(estiloInicial)),
        _setStyles: [],
        _jumps: [],
        getStyle() { return this._estilo; },
        getLayer(id) { return (this._estilo?.layers || []).find((l) => l.id === id) || null; },
        getSource(id) { return this._estilo?.sources?.[id] || null; },
        setStyle(proximo, opcoes = {}) {
            this._setStyles.push(proximo);
            const alvo = opcoes.transformStyle ? opcoes.transformStyle(this._estilo, proximo) : proximo;
            this._estilo = JSON.parse(JSON.stringify(alvo));
            queueMicrotask(() => { for (const fn of ouvintes.get('styledata') || []) fn({}); });
        },
        jumpTo(camera) { this._jumps.push(camera); },
        setSky() {}, setProjection() {},
        on(evt, fn) { if (!ouvintes.has(evt)) ouvintes.set(evt, new Set()); ouvintes.get(evt).add(fn); },
        off(evt, fn) { ouvintes.get(evt)?.delete(fn); },
        getMinZoom: () => 2, getMaxZoom: () => 21, setMinZoom() {}, setMaxZoom() {},
    };
}

const vivos = [];

/** O controle ligado como `map_sig.js` o liga, já com a primeira pintura feita. */
async function controleJaPintado(map) {
    const c = new BaseLayerControl(undefined, undefined);
    c.map = map;
    c.container = { querySelectorAll: () => [], querySelector: () => null, remove: () => {} };
    c.setDependencies({
        selectionManager: { deselectAllFeatures: () => {} },
        toolManager: { deactivateCurrentTool: () => {} },
    });
    vivos.push(c);
    await c.switchMap(true);
    map._setStyles.length = 0;
    map._jumps.length = 0;
    chamadas.vistaTemporal.length = 0;
    return c;
}

afterEach(() => {
    while (vivos.length) vivos.pop().onRemove();
});

beforeEach(() => {
    chamadas.setBaseLayer.length = 0;
    chamadas.setupMapFeatures.length = 0;
    chamadas.vistaTemporal.length = 0;
    barramento.emitidos.length = 0;
    estado.mapaAtivo = 'mapa-1';
    estado.crenca = undefined;
    estado.baseSalva = 'carta-topografica';
    estado.temPosicaoSalva = false;
    estado.meuCatalogo = ['carta-topografica', 'imagens', 'osm'];
});

describe('REPRO: abrir um mapa não regrava a base salva dele', () => {
    it('o Editor SEM acesso à base privada do mapa desenha o fallback e NÃO escreve nada', async () => {
        // A base salva do mapa é privada e não está no catálogo de quem entra.
        estado.baseSalva = 'base-privada-da-om';
        const map = mapaFalso(cartaTopografica);
        const c = new BaseLayerControl(undefined, undefined);
        c.map = map;
        c.container = { querySelectorAll: () => [], querySelector: () => null, remove: () => {} };
        c.setDependencies({
            selectionManager: { deselectAllFeatures: () => {} },
            toolManager: { deactivateCurrentTool: () => {} },
        });
        vivos.push(c);

        await c.switchMap(true);

        // A tela degrada para uma base que esta pessoa pode ver...
        expect(c.currentLayer).toBe('carta-topografica');
        // ...e o documento do mapa fica como estava: era aqui que o fallback era persistido, com
        // op `baseLayer` enfileirada, e a base privada sumia para o atlas inteiro.
        expect(chamadas.setBaseLayer).toEqual([]);
    });

    it('a FONTE do controle não importa mais a operação de escrita (caminho independente do espião)', () => {
        const fonte = readFileSync(new URL('../../src/js/baselayers/base-layer.control.js', import.meta.url), 'utf8');
        const importsDaStore = fonte.slice(fonte.indexOf('import {'), fonte.indexOf("from '../store'"));
        expect(importsDaStore).toContain('getCurrentBaseLayer');
        expect(importsDaStore).not.toContain('setBaseLayer');
        expect(fonte).not.toMatch(/\bawait setBaseLayer\(/);
    });
});

describe('escolher base no seletor só desenha', () => {
    it('troca o estilo, anuncia a base nova e NÃO grava nem enfileira', async () => {
        const map = mapaFalso(cartaTopografica);
        const c = await controleJaPintado(map);

        await c.executeLayerChange('imagens');

        expect(map._setStyles.length).toBeGreaterThan(0);
        expect(c.currentLayer).toBe('imagens');
        expect(chamadas.setBaseLayer).toEqual([]);
        const anunciados = barramento.emitidos.filter((e) => e.evento === EventTypes.BASE_LAYER_CHANGED);
        expect(anunciados.at(-1)?.payload).toEqual({ layer: 'imagens' });
        // O conteúdo desenhado é mantido: mesmo mapa do atlas, só a base mudou.
        expect(chamadas.setupMapFeatures.at(-1)).toEqual({ contentPreserved: true });
    });

    it('não mexe na câmera nem no interruptor temporal: a pessoa só trocou a base', async () => {
        estado.temPosicaoSalva = true;
        const map = mapaFalso(cartaTopografica);
        const c = await controleJaPintado(map);

        await c.executeLayerChange('osm');

        expect(map._jumps).toEqual([]);
        expect(chamadas.vistaTemporal).toEqual([]);
    });
});

describe('entrar num mapa', () => {
    it('COM vista salva: aplica a base salva, a câmera salva e o interruptor temporal salvo', async () => {
        const map = mapaFalso(cartaTopografica);
        const c = await controleJaPintado(map);
        await c.executeLayerChange('osm');
        map._setStyles.length = 0;

        estado.mapaAtivo = 'mapa-2';
        estado.baseSalva = 'imagens';
        estado.temPosicaoSalva = true;
        await c.switchMap(true);

        expect(c.currentLayer).toBe('imagens');
        expect(map._jumps).toHaveLength(1);
        expect(chamadas.vistaTemporal).toEqual(['mapa-2']);
        expect(chamadas.setBaseLayer).toEqual([]);
    });

    it('SEM vista salva: a base que está na tela fica, como a câmera fica', async () => {
        const map = mapaFalso(cartaTopografica);
        const c = await controleJaPintado(map);
        await c.executeLayerChange('osm');
        map._setStyles.length = 0;

        estado.mapaAtivo = 'mapa-2';
        estado.baseSalva = 'imagens';
        estado.temPosicaoSalva = false;
        await c.switchMap(true);

        expect(c.currentLayer).toBe('osm');
        expect(map._jumps).toEqual([]);
        expect(chamadas.vistaTemporal).toEqual([]);
    });

    it('a PRIMEIRA pintura lê a base do documento mesmo sem vista salva: ainda não há tela a manter', async () => {
        estado.baseSalva = 'imagens';
        const map = mapaFalso(cartaTopografica);
        const c = new BaseLayerControl(undefined, undefined);
        c.map = map;
        c.container = { querySelectorAll: () => [], querySelector: () => null, remove: () => {} };
        c.setDependencies({
            selectionManager: { deselectAllFeatures: () => {} },
            toolManager: { deactivateCurrentTool: () => {} },
        });
        vivos.push(c);

        await c.switchMap(true);

        expect(c.currentLayer).toBe('imagens');
    });

    it('depois de um WIPE da store a próxima entrada volta a ler o documento', async () => {
        const map = mapaFalso(cartaTopografica);
        const c = await controleJaPintado(map);
        await c.executeLayerChange('osm');

        await barramento.disparar(EventTypes.ALL_DATA_CLEARED, { rebuild: true });
        estado.baseSalva = 'imagens';
        await c.switchMap(true);

        // A tela era do atlas que saiu: `osm` não sobrevive ao wipe.
        expect(c.currentLayer).toBe('imagens');
    });

    it('desfazer/refazer e busca (`switchMap(false)`) mantêm a base da tela', async () => {
        const map = mapaFalso(cartaTopografica);
        const c = await controleJaPintado(map);
        await c.executeLayerChange('osm');

        estado.baseSalva = 'imagens';
        estado.temPosicaoSalva = true;
        await c.switchMap(false);

        expect(c.currentLayer).toBe('osm');
        expect(map._jumps).toEqual([]);
    });

    it('uma base pedida pelo NOME (slide de briefing) vence a da tela, sem gravar', async () => {
        const map = mapaFalso(cartaTopografica);
        const c = await controleJaPintado(map);

        await c.switchMap(false, { baseLayer: 'imagens' });

        expect(c.currentLayer).toBe('imagens');
        expect(chamadas.setBaseLayer).toEqual([]);
    });
});

describe('a base salva por um colega não chega à tela de ninguém', () => {
    it('o controle não tem mais ouvinte de troca remota, e o vocabulário perdeu o evento', async () => {
        const map = mapaFalso(cartaTopografica);
        await controleJaPintado(map);

        expect(EventTypes.BASE_LAYER_REMOTE_CHANGED).toBeUndefined();
        // Quem reinventar o evento com outro nome cai aqui: depois de ligado, o controle só ouve
        // o wipe da store. Um segundo ouvinte é um segundo jeito de alguém mexer nesta tela.
        const eventosDeBase = Object.values(EventTypes).filter((nome) => String(nome).startsWith('baseLayer:'));
        for (const evento of eventosDeBase) {
            expect(barramento.ouvintes(evento), `o controle passou a OUVIR ${evento}`).toBe(0);
        }
    });
});
