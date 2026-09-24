// Path: tests/unit/style-ready.test.js

/**
 * A espera pelo estilo da MapLibre conta só tempo de aba VISÍVEL (`baselayers/style-ready.js`).
 *
 * O defeito (relato do dono, 2026-09-24): o boot numa aba oculta desistia do estilo depois de 10 s
 * de relógio, com a aba ainda oculta e o estilo parado à espera de um quadro de animação que o
 * navegador não entrega, e montava as camadas da aplicação sobre um estilo que não tinha carregado.
 * O caminho inteiro, com a aba oculta emulada, está em `tests/e2e-ui/boot-em-aba-oculta.spec.js`;
 * aqui fica a regra do relógio e o contrato da MapLibre em que o módulo se apoia, lido da
 * biblioteca INSTALADA, porque `style._loaded` é campo interno e uma atualização pode renomeá-lo.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { styleDoneLoading, waitForMapEvent, waitForStyleDone } from '@js/baselayers/style-ready.js';

function fakeMap(loaded = false) {
    const handlers = new Map();
    return {
        style: { _loaded: loaded },
        on: vi.fn((name, fn) => handlers.set(name, fn)),
        off: vi.fn((name, fn) => {
            if (handlers.get(name) === fn) handlers.delete(name);
        }),
        fire(name) {
            handlers.get(name)?.();
        },
        listening: (name) => handlers.has(name),
    };
}

function fakeDocument(visibilityState = 'visible') {
    const listeners = new Set();
    return {
        visibilityState,
        addEventListener: vi.fn((name, fn) => listeners.add(fn)),
        removeEventListener: vi.fn((name, fn) => listeners.delete(fn)),
        setVisibility(state) {
            this.visibilityState = state;
            for (const fn of [...listeners]) fn();
        },
        listenerCount: () => listeners.size,
    };
}

/** Settles the promise's state without awaiting it forever. */
async function stateOf(promise) {
    const pending = Symbol('pending');
    const winner = await Promise.race([promise, Promise.resolve(pending)]);
    return winner === pending ? 'pending' : winner;
}

describe('styleDoneLoading', () => {
    it('lê a bandeira da MapLibre, e só o verdadeiro literal conta', () => {
        expect(styleDoneLoading(fakeMap(true))).toBe(true);
        expect(styleDoneLoading(fakeMap(false))).toBe(false);
        expect(styleDoneLoading({ style: { _loaded: 1 } })).toBe(false);
    });

    it('mapa sem estilo, ou mapa nenhum, não está carregado e não lança', () => {
        expect(styleDoneLoading({})).toBe(false);
        expect(styleDoneLoading(null)).toBe(false);
        expect(styleDoneLoading(undefined)).toBe(false);
    });
});

describe('waitForMapEvent: o relógio só corre com a aba visível', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('o evento resolve verdadeiro e solta os dois ouvintes', async () => {
        const map = fakeMap();
        const doc = fakeDocument();
        const espera = waitForMapEvent(map, 'styledata', { timeoutMs: 10000, doc });
        map.fire('styledata');
        expect(await espera).toBe(true);
        expect(map.listening('styledata')).toBe(false);
        expect(doc.listenerCount()).toBe(0);
    });

    it('aba visível: desiste depois do tempo, com falso', async () => {
        const map = fakeMap();
        const espera = waitForMapEvent(map, 'styledata', { timeoutMs: 10000, doc: fakeDocument() });
        vi.advanceTimersByTime(9999);
        expect(await stateOf(espera)).toBe('pending');
        vi.advanceTimersByTime(1);
        expect(await espera).toBe(false);
        expect(map.listening('styledata')).toBe(false);
    });

    it('REPRO: aba oculta não desiste nunca, e o evento ainda resolve quando ela aparece', async () => {
        const map = fakeMap();
        const doc = fakeDocument('hidden');
        const espera = waitForMapEvent(map, 'style.load', { timeoutMs: 10000, doc });
        vi.advanceTimersByTime(60 * 60 * 1000);
        expect(await stateOf(espera)).toBe('pending');
        doc.setVisibility('visible');
        map.fire('style.load');
        expect(await espera).toBe(true);
    });

    it('cada trecho visível ganha o tempo inteiro, e ocultar no meio desarma', async () => {
        const map = fakeMap();
        const doc = fakeDocument();
        const espera = waitForMapEvent(map, 'style.load', { timeoutMs: 10000, doc });
        vi.advanceTimersByTime(8000);
        doc.setVisibility('hidden');
        vi.advanceTimersByTime(30000);
        doc.setVisibility('visible');
        vi.advanceTimersByTime(9999);
        expect(await stateOf(espera)).toBe('pending');
        vi.advanceTimersByTime(1);
        expect(await espera).toBe(false);
    });

    it('sem documento (node, worker) o relógio corre como se a aba estivesse visível', async () => {
        const espera = waitForMapEvent(fakeMap(), 'styledata', { timeoutMs: 50, doc: undefined });
        vi.advanceTimersByTime(50);
        expect(await espera).toBe(false);
    });
});

describe('waitForStyleDone', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('estilo já carregado: resolve na hora, sem ouvir nada (o caso comum não espera)', async () => {
        const map = fakeMap(true);
        expect(await waitForStyleDone(map, { timeoutMs: 10000, doc: fakeDocument() })).toBe(true);
        expect(map.on).not.toHaveBeenCalled();
    });

    it('estilo carregando: espera o style.load', async () => {
        const map = fakeMap(false);
        const espera = waitForStyleDone(map, { timeoutMs: 10000, doc: fakeDocument() });
        map.style._loaded = true;
        map.fire('style.load');
        expect(await espera).toBe(true);
    });

    it('estouro com o estilo ainda carregando responde falso; se ele terminou calado, verdadeiro', async () => {
        const parado = fakeMap(false);
        const espera1 = waitForStyleDone(parado, { timeoutMs: 100, doc: fakeDocument() });
        vi.advanceTimersByTime(100);
        expect(await espera1).toBe(false);

        const calado = fakeMap(false);
        const espera2 = waitForStyleDone(calado, { timeoutMs: 100, doc: fakeDocument() });
        calado.style._loaded = true;
        vi.advanceTimersByTime(100);
        expect(await espera2).toBe(true);
    });
});

describe('o contrato da MapLibre instalada', () => {
    const dist = (file) => readFileSync(
        fileURLToPath(new URL(`../../node_modules/maplibre-gl/dist/${file}`, import.meta.url)),
        'utf8',
    );
    const legivel = dist('maplibre-gl-dev.mjs');

    it('um estilo novo espera um QUADRO de animação, que a aba oculta não recebe', () => {
        expect(legivel).toMatch(/loadJSON\(json[^)]*\)\s*\{[\s\S]{0,300}?browser\.frameAsync\(/);
        expect(legivel).toMatch(/frame\(abortController, fn, reject, targetWindow\)\s*\{[\s\S]{0,120}?requestAnimationFrame/);
    });

    it('"not done loading" é a bandeira `_loaded`, e `_load` a liga antes de disparar style.load', () => {
        expect(legivel).toMatch(/_checkLoaded\(\)\s*\{\s*if \(!this\._loaded\) throw new Error\("Style is not done loading\."\)/);
        const corpo = legivel.slice(legivel.indexOf('\t_load(json, options, previousStyle) {'));
        const liga = corpo.indexOf('this._loaded = true;');
        const dispara = corpo.indexOf('this.fire(new MapStyleLoadEvent());');
        expect(liga).toBeGreaterThan(0);
        expect(dispara).toBeGreaterThan(liga);
        expect(legivel).toMatch(/MapStyleLoadEvent = class extends MapLibreEvent \{[\s\S]{0,200}?super\("style\.load"/);
    });

    it('o build que o app importa mantém o nome do campo', () => {
        // Minified as `_checkLoaded(){if(!this._loaded)throw Error(`Style is not done loading.`)}`.
        expect(dist('maplibre-gl.mjs')).toMatch(/_checkLoaded\(\)\{if\(!this\._loaded\)throw (new )?Error\(.Style is not done loading\../);
    });
});
