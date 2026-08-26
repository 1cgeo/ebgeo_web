// Path: tests/unit/deep-link-vista-adiada.test.js

/**
 * @fileoverview O ADIAMENTO DA VISTA COMPARTILHADA, que só existe neste pacote.
 *
 * Os outros três arquivos de deep link são IDÊNTICOS aos do `main`, de propósito: os
 * vetores dourados só provam estabilidade entre versões se forem os mesmos dos dois
 * lados. Este não é compartilhado, porque a coisa que ele mede não existe lá.
 *
 * O QUE ELE MEDE, e por que ela é a diferença entre os dois pacotes. Aqui o boot
 * move a câmera 2D DEPOIS do manipulador de `load`: `openRemoteAtlas` termina em
 * `switchMap`, que termina em `applyMapSavedPosition`. Uma vista compartilhada
 * aplicada dentro do manipulador seria sobrescrita, sem erro nenhum e sem nada no
 * console: a pessoa veria a última vista dela onde deveria estar a de quem mandou o
 * link. O `deferSharedView` é o que impede isso, e um sinalizador que nada verifica
 * é um sinalizador que a próxima refatoração apaga.
 *
 * O par disto no `main` não existe porque lá o `switchMap(true)` já roda ANTES do
 * `handleDeepLink`, dentro do mesmo manipulador.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getControl = vi.fn();
const showError = vi.fn();
const showSuccess = vi.fn();

vi.mock('@store', () => ({ getControl: (...a) => getControl(...a) }));
vi.mock('@utils', () => ({
    showError: (...a) => showError(...a),
    showSuccess: (...a) => showSuccess(...a),
}));

const original = globalThis.window;

/** Dublê do controle de camada base e do mapa. */
function dublarControle() {
    const map = { jumpTo: vi.fn() };
    const control = { map, applySharedBasemap: vi.fn(async (pedida) => pedida) };
    getControl.mockImplementation((nome) => (nome === 'BaseLayerControl' ? control : null));
    return { control, map };
}

/** Instala o endereço e devolve o módulo de deep link. */
async function comHash(hash) {
    globalThis.window = {
        location: { hash, search: '', pathname: '/', origin: 'https://ebgeo.exemplo' },
    };
    globalThis.history = { replaceState: vi.fn() };
    return import('@js/deep-link/deep-link.js');
}

beforeEach(() => {
    getControl.mockReset();
    showError.mockReset();
    showSuccess.mockReset();
});
afterEach(() => { globalThis.window = original; });

const HASH = '#view=base&base=bdgex&lon=-43.18&lat=-22.97&z=14.5';

describe('vista compartilhada: quem aplica, e quando', () => {
    it('com deferSharedView, o manipulador de load NÃO toca no mapa', async () => {
        const { control, map } = dublarControle();
        const { handleDeepLink } = await comHash(HASH);

        await handleDeepLink({ deferSharedView: true });

        expect(control.applySharedBasemap).not.toHaveBeenCalled();
        expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it('mas o hash é limpo mesmo assim, porque quem adia já capturou o descritor', async () => {
        dublarControle();
        const { handleDeepLink } = await comHash(HASH);

        await handleDeepLink({ deferSharedView: true });

        // `index.js` lê o descritor no TOPO do boot, antes de qualquer await. Deixar
        // o hash de pé aqui o faria sobreviver a um F5 e reaplicar a vista de alguém
        // toda vez que a pessoa recarregasse.
        expect(globalThis.history.replaceState).toHaveBeenCalled();
    });

    it('sem o sinalizador, aplica na hora: é o caminho do link colado em aba aberta', async () => {
        const { control, map } = dublarControle();
        const { handleDeepLink } = await comHash(HASH);

        await handleDeepLink();

        expect(control.applySharedBasemap).toHaveBeenCalledWith('bdgex');
        expect(map.jumpTo).toHaveBeenCalledWith({ center: [-43.18, -22.97], zoom: 14.5 });
    });

    it('o adiamento vale SÓ para a vista 2D: os outros três não são adiáveis', async () => {
        // O 360, o 3D e a primeira pessoa são donos da própria câmera, então nada no
        // boot os sobrescreve. Se `deferSharedView` começasse a valer para eles, um
        // link de foto 360 pararia de abrir e este caso é o que acusa.
        dublarControle();
        const { handleDeepLink } = await comHash('#view=360&photo=foto.jpg&lon=1&lat=2&fov=75');

        await handleDeepLink({ deferSharedView: true });

        // `getControl('streetView')` é consultado pelo abridor do 360: ele foi
        // chamado, logo o caminho não foi adiado.
        expect(getControl).toHaveBeenCalledWith('streetView');
    });

    it('applySharedView é exportada, porque o boot a chama de fora', async () => {
        const { control } = dublarControle();
        const { applySharedView } = await comHash('');

        await applySharedView({
            basemap: 'osm', lon: null, lat: null, zoom: null, bearing: null, pitch: null,
        });

        expect(control.applySharedBasemap).toHaveBeenCalledWith('osm');
    });
});
