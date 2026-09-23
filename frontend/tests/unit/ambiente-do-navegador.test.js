// Path: tests/unit/ambiente-do-navegador.test.js

/**
 * @fileoverview THE ONE USER-AGENT PARSER and the environment collector, driven with real
 * User-Agent strings and a fake window.
 *
 * NEGATIVE CONTROLS (checked by reverting the piece and seeing red):
 *   1. **Branch order.** Asking for Chrome before Edge or Opera, or for Safari before Chrome,
 *      turns the family cases red: the three announce themselves as the neighbor.
 *   2. **`HeadlessChrome`.** Removing it from the Chrome regex sends the test harness browser to
 *      the Safari branch, which is what the previous parser did.
 *   3. **The closed cut.** Returning the raw object from `ambienteSeguro` instead of rebuilding it
 *      lets an extra key through, and the route refuses the whole report on that key.
 *   4. **The lost context.** Not calling `loseContext` keeps the probe context alive, and the
 *      browser evicts the OLDEST context past its cap, which is the map's.
 *   5. **The Firefox path.** Asking for the debug extension when `RENDERER` is already a real
 *      name makes Firefox log a deprecation warning on every first report.
 */

import { describe, it, expect } from 'vitest';
import {
    FAMILIAS_DE_NAVEGADOR,
    FAMILIAS_DE_SO,
    TETOS_DE_AMBIENTE,
    TIPOS_DE_DISPOSITIVO,
    ambienteSeguro,
    analisarUserAgent,
    CAMPOS_DE_AMBIENTE,
    cotaArredondadaMb,
    criarColetorDeAmbiente,
    identificarNavegador,
    versaoPrincipal,
} from '@js/session/ambiente-do-navegador.js';

/** The family alone: the branch-order contract. */
const familia = (ua) => analisarUserAgent(ua).navegador;

/** Real User-Agent strings, as the browsers send them in 2026. */
const UA = Object.freeze({
    firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
    firefoxUbuntu: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
    firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
    firefoxWindows7: 'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0',
    chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/140.0.0.0 Safari/537.36',
    chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/140.0.0.0 Safari/537.36',
    chromeHeadless: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'HeadlessChrome/140.0.7339.16 Safari/537.36',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/140.0.0.0 Mobile Safari/537.36',
    chromeAndroidTablet: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/140.0.0.0 Safari/537.36',
    chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/140.0.0.0 Safari/537.36',
    chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 '
        + '(KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1',
    edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.54',
    edgeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/139.0.0.0 Safari/537.36 Edg/139.0.3405.86',
    edgeLegado: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/70.0.3538.102 Safari/537.36 Edge/18.19041',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/139.0.0.0 Safari/537.36 OPR/123.0.0.0',
    operaPresto: 'Opera/9.80 (Windows NT 6.1; WOW64) Presto/2.12.388 Version/12.16',
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) '
        + 'Version/18.5 Safari/605.1.15',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 '
        + '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    safariIpad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
        + 'Version/16.6 Mobile/15E148 Safari/604.1',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
});

describe('analisarUserAgent — real browsers on real systems', () => {
    const casos = [
        [UA.firefoxWindows, { navegador: 'firefox', navegadorVersao: '143.0', so: 'windows', soVersao: '10.0', dispositivo: 'desktop' }],
        [UA.firefoxLinux, { navegador: 'firefox', navegadorVersao: '128.0', so: 'linux', soVersao: null, dispositivo: 'desktop' }],
        [UA.firefoxUbuntu, { navegador: 'firefox', navegadorVersao: '140.0', so: 'linux', soVersao: null, dispositivo: 'desktop' }],
        [UA.firefoxMac, { navegador: 'firefox', navegadorVersao: '143.0', so: 'macos', soVersao: '10.15', dispositivo: 'desktop' }],
        [UA.firefoxAndroid, { navegador: 'firefox', navegadorVersao: '143.0', so: 'android', soVersao: '14', dispositivo: 'movel' }],
        [UA.firefoxWindows7, { navegador: 'firefox', navegadorVersao: '115.0', so: 'windows', soVersao: '6.1', dispositivo: 'desktop' }],
        [UA.chromeWindows, { navegador: 'chrome', navegadorVersao: '140.0.0.0', so: 'windows', soVersao: '10.0', dispositivo: 'desktop' }],
        [UA.chromeLinux, { navegador: 'chrome', navegadorVersao: '140.0.0.0', so: 'linux', soVersao: null, dispositivo: 'desktop' }],
        [UA.chromeHeadless, { navegador: 'chrome', navegadorVersao: '140.0.7339.16', so: 'windows', soVersao: '10.0', dispositivo: 'desktop' }],
        [UA.chromeAndroid, { navegador: 'chrome', navegadorVersao: '140.0.0.0', so: 'android', soVersao: '10', dispositivo: 'movel' }],
        [UA.chromeAndroidTablet, { navegador: 'chrome', navegadorVersao: '140.0.0.0', so: 'android', soVersao: '10', dispositivo: 'tablet' }],
        [UA.chromeOs, { navegador: 'chrome', navegadorVersao: '140.0.0.0', so: 'chromeos', soVersao: '14541.0.0', dispositivo: 'desktop' }],
        [UA.chromeIphone, { navegador: 'chrome', navegadorVersao: '140.0.7339.101', so: 'ios', soVersao: '17.4', dispositivo: 'movel' }],
        [UA.edgeWindows, { navegador: 'edge', navegadorVersao: '140.0.3485.54', so: 'windows', soVersao: '10.0', dispositivo: 'desktop' }],
        [UA.edgeLinux, { navegador: 'edge', navegadorVersao: '139.0.3405.86', so: 'linux', soVersao: null, dispositivo: 'desktop' }],
        [UA.edgeLegado, { navegador: 'edge', navegadorVersao: '18.19041', so: 'windows', soVersao: '10.0', dispositivo: 'desktop' }],
        [UA.opera, { navegador: 'opera', navegadorVersao: '123.0.0.0', so: 'windows', soVersao: '10.0', dispositivo: 'desktop' }],
        [UA.operaPresto, { navegador: 'opera', navegadorVersao: '12.16', so: 'windows', soVersao: '6.1', dispositivo: 'desktop' }],
        [UA.safariMac, { navegador: 'safari', navegadorVersao: '18.5', so: 'macos', soVersao: '10.15.7', dispositivo: 'desktop' }],
        [UA.safariIphone, { navegador: 'safari', navegadorVersao: '17.4', so: 'ios', soVersao: '17.4', dispositivo: 'movel' }],
        [UA.safariIpad, { navegador: 'safari', navegadorVersao: '16.6', so: 'ios', soVersao: '16.6', dispositivo: 'tablet' }],
        [UA.samsung, { navegador: 'chrome', navegadorVersao: '121.0.0.0', so: 'android', soVersao: '14', dispositivo: 'movel' }],
    ];

    it.each(casos)('%s', (ua, esperado) => {
        expect(analisarUserAgent(ua)).toEqual(esperado);
    });

    it('covers every family and system of the vocabulary except the fallbacks', () => {
        // A table that silently lost a family would keep passing; this pins the coverage.
        const familias = new Set(casos.map(([, e]) => e.navegador));
        const sistemas = new Set(casos.map(([, e]) => e.so));
        expect([...FAMILIAS_DE_NAVEGADOR].filter((f) => !familias.has(f))).toEqual(['outro']);
        expect([...FAMILIAS_DE_SO].filter((s) => !sistemas.has(s))).toEqual(['outro']);
        expect(new Set(casos.map(([, e]) => e.dispositivo))).toEqual(new Set(TIPOS_DE_DISPOSITIVO));
    });

    it('CONTROL 1: Edge and Opera are NOT Chrome, and Chrome is NOT Safari', () => {
        expect(familia(UA.edgeWindows)).toBe('edge');
        expect(familia(UA.opera)).toBe('opera');
        expect(familia(UA.chromeWindows)).toBe('chrome');
        expect(familia(UA.safariMac)).toBe('safari');
    });

    it('CONTROL 2: the headless browser of the test harness is Chrome', () => {
        expect(familia(UA.chromeHeadless)).toBe('chrome');
    });

    it('empty, unknown, non-text and hostile input is `outro`, and nothing throws', () => {
        const vazio = { navegador: 'outro', navegadorVersao: null, so: 'outro', soVersao: null, dispositivo: 'desktop' };
        expect(analisarUserAgent('')).toEqual(vazio);
        expect(analisarUserAgent(null)).toEqual(vazio);
        expect(analisarUserAgent(undefined)).toEqual(vazio);
        expect(analisarUserAgent(42)).toEqual(vazio);
        expect(analisarUserAgent({ toString() { throw new Error('hostil'); } })).toEqual(vazio);
        expect(analisarUserAgent('curl/8.4.0')).toEqual(vazio);
    });

    it('a gigantic UA is read in its first thousand characters, fast and without throwing', () => {
        const gigante = `Mozilla/5.0 (Windows NT 10.0) ${'x'.repeat(200_000)} Firefox/1.0`;
        const inicio = performance.now();
        const r = analisarUserAgent(gigante);
        expect(performance.now() - inicio).toBeLessThan(100);
        expect(FAMILIAS_DE_NAVEGADOR).toContain(r.navegador);
        // The Firefox token is past the cut, so the family is not guessed from it.
        expect(r.navegador).toBe('outro');
        expect(r.so).toBe('windows');
    });

    it('a version out of shape is dropped, never kept half-read', () => {
        expect(analisarUserAgent('Mozilla/5.0 Firefox/143.0a1').navegadorVersao).toBe('143.0');
        expect(analisarUserAgent(`Mozilla/5.0 Firefox/${'9'.repeat(40)}`).navegadorVersao).toBe(null);
    });
});

describe('versaoPrincipal', () => {
    it('the first number, within the ceiling, or null', () => {
        expect(versaoPrincipal('143.0.1')).toBe(143);
        expect(versaoPrincipal(140)).toBe(140);
        expect(versaoPrincipal('0.9')).toBe(0);
        expect(versaoPrincipal('10000.0')).toBe(null);
        expect(versaoPrincipal(TETOS_DE_AMBIENTE.versaoPrincipal)).toBe(TETOS_DE_AMBIENTE.versaoPrincipal);
        for (const ruim of [null, undefined, '', 'beta', '14 3', NaN, -1, {}]) {
            expect(versaoPrincipal(ruim), String(ruim)).toBe(null);
        }
    });
});

/**
 * A fake window with what the collector reads. Each piece can be removed or made hostile.
 * @param {Object} [opcoes]
 */
function criarJanela({
    ua = UA.firefoxWindows,
    renderer = 'NVIDIA GeForce GTX 980, or similar',
    webgl2 = true,
    semCanvas = false,
    uaData = null,
    storage = null,
    maxTouchPoints = 0,
} = {}) {
    const chamadas = { extensao: 0, perdido: 0, contextos: 0 };
    const gl = {
        RENDERER: 0x1F01,
        MAX_TEXTURE_SIZE: 0x0D33,
        getParameter(p) {
            if (p === 0x1F01) return renderer;
            if (p === 0x0D33) return 16384;
            if (p === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return null;
        },
        getExtension(nome) {
            if (nome === 'WEBGL_debug_renderer_info') {
                chamadas.extensao++;
                return { UNMASKED_RENDERER_WEBGL: 0x9246 };
            }
            if (nome === 'WEBGL_lose_context') return { loseContext: () => { chamadas.perdido++; } };
            return null;
        },
    };
    const janela = {
        navigator: {
            userAgent: ua,
            language: 'pt-BR',
            hardwareConcurrency: 8,
            maxTouchPoints,
            onLine: true,
            cookieEnabled: true,
            ...(uaData ? { userAgentData: uaData } : {}),
            ...(storage ? { storage } : {}),
        },
        screen: { width: 1920, height: 1080 },
        devicePixelRatio: 1.25,
        innerWidth: 1536,
        innerHeight: 730,
        isSecureContext: false,
        indexedDB: {},
        Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Sao_Paulo' }) }) },
        document: semCanvas ? undefined : {
            createElement: () => ({
                getContext: (tipo) => {
                    if (tipo === 'webgl2' && !webgl2) return null;
                    chamadas.contextos++;
                    return gl;
                },
            }),
        },
    };
    return { janela, chamadas };
}

describe('criarColetorDeAmbiente — the environment block of a report', () => {
    it('collects the closed block from a Firefox on Windows', () => {
        const { janela } = criarJanela();
        const ambiente = criarColetorDeAmbiente({ alvo: janela }).coletar();
        expect(ambiente).toEqual({
            navegador: 'firefox',
            navegadorVersao: '143.0',
            so: 'windows',
            soVersao: '10.0',
            dispositivo: 'desktop',
            toque: 0,
            telaLargura: 1920,
            telaAltura: 1080,
            escala: 1.25,
            janelaLargura: 1536,
            janelaAltura: 730,
            idioma: 'pt-BR',
            fuso: 'America/Sao_Paulo',
            nucleos: 8,
            webgl: 'webgl2',
            gpu: 'NVIDIA GeForce GTX 980, or similar',
            texturaMax: 16384,
            online: true,
            cookies: true,
            contextoSeguro: false,
            indexedDB: true,
        });
    });

    it('CONTROL 4 and 5: ONE context, lost at once, and Firefox never asks for the extension', () => {
        const { janela, chamadas } = criarJanela();
        const coletor = criarColetorDeAmbiente({ alvo: janela });
        coletor.coletar();
        coletor.coletar();
        coletor.coletar();
        expect(chamadas.contextos).toBe(1);
        expect(chamadas.perdido).toBe(1);
        expect(chamadas.extensao).toBe(0);
    });

    it('Chromium says "WebKit WebGL" and the extension names the GPU', () => {
        const { janela, chamadas } = criarJanela({ ua: UA.chromeWindows, renderer: 'WebKit WebGL' });
        const ambiente = criarColetorDeAmbiente({ alvo: janela }).coletar();
        expect(chamadas.extensao).toBe(1);
        expect(ambiente.gpu).toBe('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)');
    });

    it('WebGL 1 only, and no canvas at all, are answers too', () => {
        const um = criarColetorDeAmbiente({ alvo: criarJanela({ webgl2: false }).janela }).coletar();
        expect(um.webgl).toBe('webgl');
        const sem = criarColetorDeAmbiente({ alvo: criarJanela({ semCanvas: true }).janela }).coletar();
        expect(Object.hasOwn(sem, 'webgl')).toBe(false);
        expect(sem.navegador).toBe('firefox');
    });

    it('the Client Hints arrive later and refine the next report: Windows 11 and the full version', async () => {
        const uaData = {
            mobile: false,
            getHighEntropyValues: async () => ({
                platformVersion: '15.0.0',
                fullVersionList: [{ brand: 'Not=A?Brand', version: '24.0.0.0' },
                    { brand: 'Google Chrome', version: '140.0.7339.128' }],
            }),
        };
        const { janela } = criarJanela({ ua: UA.chromeWindows, renderer: 'WebKit WebGL', uaData });
        const coletor = criarColetorDeAmbiente({ alvo: janela });
        coletor.iniciar();
        // Before the promise settles the report carries what the UA said.
        expect(coletor.coletar().navegadorVersao).toBe('140.0.0.0');
        await Promise.resolve();
        await Promise.resolve();
        const depois = coletor.coletar();
        expect(depois.soVersaoCh).toBe('15.0.0');
        expect(depois.navegadorVersao).toBe('140.0.7339.128');
    });

    it('the storage estimate arrives later, in megabytes, with the persistence flag', async () => {
        const storage = {
            estimate: async () => ({ usage: 12 * 1048576, quota: 2048 * 1048576 }),
            persisted: async () => false,
        };
        const { janela } = criarJanela({ storage });
        const coletor = criarColetorDeAmbiente({ alvo: janela });
        coletor.iniciar();
        await new Promise((r) => setTimeout(r, 0));
        const a = coletor.coletar();
        expect(a.armazenamentoUsoMb).toBe(12);
        expect(a.armazenamentoCotaMb).toBe(2048);
        expect(a.armazenamentoPersistente).toBe(false);
    });

    it('an iPad in desktop mode says "Macintosh" and is told apart by touch', () => {
        const { janela } = criarJanela({ ua: UA.safariMac, maxTouchPoints: 5 });
        const a = identificarNavegador({ alvo: janela });
        expect(a.so).toBe('ios');
        expect(a.dispositivo).toBe('tablet');
        expect(a.soVersao).toBe(null);
    });

    it('without a navigator there is no block, and hostile getters never throw', () => {
        expect(criarColetorDeAmbiente({ alvo: {} }).coletar()).toBe(null);
        const hostil = new Proxy({}, { get() { throw new Error('hostil'); } });
        expect(() => criarColetorDeAmbiente({ alvo: hostil }).iniciar()).not.toThrow();
        expect(criarColetorDeAmbiente({ alvo: hostil }).coletar()).toBe(null);
        const { janela } = criarJanela();
        Object.defineProperty(janela, 'indexedDB', { get() { throw new Error('SecurityError'); } });
        Object.defineProperty(janela, 'screen', { get() { throw new Error('hostil'); } });
        const a = criarColetorDeAmbiente({ alvo: janela }).coletar();
        // The Firefox with cookies blocked THROWS on `indexedDB`, and that is exactly `false`.
        expect(a.indexedDB).toBe(false);
        expect(Object.hasOwn(a, 'telaLargura')).toBe(false);
    });
});

describe('ambienteSeguro — the closed shape the route accepts', () => {
    it('CONTROL 3: an extra key never survives, and nothing out of shape is kept', () => {
        const a = ambienteSeguro({
            navegador: 'firefox',
            modelo: 'Pixel 7',
            so: 'Windows 11',
            gpu: 'Placa com acentuação',
            idioma: 'pt BR',
            fuso: 'America/São_Paulo',
            telaLargura: -1,
            janelaLargura: 1e9,
            escala: 0,
            memoriaGb: 8,
            online: 'sim',
            webgl: 'webgpu',
        });
        expect(a).toEqual({ navegador: 'firefox', memoriaGb: 8 });
    });

    it('the fractions are ROUNDED FIRST and range-checked AFTER: a tiny value is dropped, never sent as zero', () => {
        // `0.0001` passed a `> 0` check made before rounding and went out as `0`, which the route
        // refuses with `greater(0)`, and the refusal is of the whole report.
        expect(ambienteSeguro({ escala: 0.0001 })).toBe(null);
        expect(ambienteSeguro({ memoriaGb: 0.004 })).toBe(null);
        expect(ambienteSeguro({ escala: 0.0006 })).toEqual({ escala: 0.001 });
        expect(ambienteSeguro({ memoriaGb: 0.25 })).toEqual({ memoriaGb: 0.25 });
        expect(ambienteSeguro({ escala: TETOS_DE_AMBIENTE.escala + 0.0001 })).toEqual({ escala: TETOS_DE_AMBIENTE.escala });
        expect(ambienteSeguro({ escala: TETOS_DE_AMBIENTE.escala + 0.01 })).toBe(null);
    });

    it('the storage quota travels rounded to the nearest power of two, in log scale', () => {
        // PRIVACY: the exact Chromium quota derives from the disk size.
        expect(cotaArredondadaMb(6144)).toBe(8192);
        expect(cotaArredondadaMb(300)).toBe(256);
        expect(cotaArredondadaMb(2048)).toBe(2048);
        expect(cotaArredondadaMb(1)).toBe(1);
        for (const ruim of [0, 0.5, -4, NaN, Infinity, null, '2048']) {
            expect(cotaArredondadaMb(ruim), String(ruim)).toBe(null);
        }
        expect(ambienteSeguro({ armazenamentoCotaMb: 10240, armazenamentoUsoMb: 12 }))
            .toEqual({ armazenamentoUsoMb: 12, armazenamentoCotaMb: 8192 });
    });

    it('only the listed fields can come out, and the list is frozen', () => {
        // Every field set to a value that SOME rule accepts, plus an extra key: what comes out is
        // a subset of the list, never the extra key.
        const tudo = Object.fromEntries(CAMPOS_DE_AMBIENTE.map((c) => [c, true]));
        const saida = ambienteSeguro({ ...tudo, extra: true });
        expect(Object.keys(saida).length).toBeGreaterThan(0);
        expect(Object.keys(saida).filter((c) => !CAMPOS_DE_AMBIENTE.includes(c))).toEqual([]);
        expect(Object.isFrozen(CAMPOS_DE_AMBIENTE)).toBe(true);
    });

    it('nothing left is null, so the field does not travel', () => {
        expect(ambienteSeguro({ modelo: 'x' })).toBe(null);
        expect(ambienteSeguro(null)).toBe(null);
        expect(ambienteSeguro([])).toBe(null);
        expect(ambienteSeguro('firefox')).toBe(null);
    });

    it('the text ceilings cut before the shape is checked', () => {
        const longa = 'x'.repeat(TETOS_DE_AMBIENTE.gpu + 50);
        expect(ambienteSeguro({ gpu: longa }).gpu).toHaveLength(TETOS_DE_AMBIENTE.gpu);
        expect(ambienteSeguro({ gpu: '  ANGLE   (Intel)  ' }).gpu).toBe('ANGLE (Intel)');
    });
});
