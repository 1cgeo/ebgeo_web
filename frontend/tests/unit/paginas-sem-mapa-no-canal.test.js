// Path: tests/unit/paginas-sem-mapa-no-canal.test.js

/**
 * @fileoverview The three pages WITHOUT a map join the tab-lock channel holding NOTHING.
 *
 * `atlas.html`, `admin.html` and `calibracao.html` hold no atlas: they have no store, no
 * `initServices()` and no map. By the owner's rule (two tabs collide only when they hold the SAME
 * atlas) a tab holding NOTHING collides with nobody, and blocking them would break a flow people use on
 * purpose, which is opening the Painel do Administrador in a second tab while the map stays in
 * the first.
 *
 * So there are two halves to check, and only one of them is behavior:
 *
 *  - BEHAVIOR: a participant holding `noneKey()` neither blocks nor is blocked, survives a
 *    TAKEOVER aimed at the atlas holders, and IS listed in everybody's roster. The last one is
 *    what makes "join the channel" mean something instead of being a no-op with a warm feeling.
 *  - STRUCTURE: the three entry modules actually wire it, with the none key, with the overlay
 *    disabled, and by importing the FILE (`@utils/tab-lock.js`) rather than the `@utils` barrel,
 *    which reaches `@store` transitively and would drag the whole map foundation into a page
 *    that measures ~140 kB. None of that is observable from the outside: the entry modules boot
 *    themselves on import and talk to a backend, so the file is the evidence here.
 *
 * Every behavior case below carries its own negative control: the SAME arrangement with a remote
 * key in place of the none key does block, which is what proves the none key is doing the work
 * and not the fake transport.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    createTabLock,
    noneKey,
    remoteAtlasKey,
    TabLockKeyKind
} from '@utils/tab-lock.js';

const ATLAS = '11111111-1111-4111-8111-111111111111';

/** The three entry modules, read once: label -> source text. */
const PAGINAS = ['projects/projects-page', 'admin/admin-page', 'calibration/calibracao-page']
    .map((rel) => ({
        nome: `src/js/${rel}.js`,
        texto: readFileSync(fileURLToPath(new URL(`../../src/js/${rel}.js`, import.meta.url)), 'utf8')
    }));

/**
 * Blanks out comment CONTENT while preserving line count, so an assertion about what the code
 * CALLS is not tripped by prose that names the very thing it is explaining.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

/**
 * In-process stand-in for BroadcastChannel: same no-self-echo semantics, no timing.
 * @returns {{connect: () => Object}}
 */
function createHub() {
    const endpoints = [];
    return {
        connect() {
            const endpoint = { receiver: null, dead: false };
            endpoints.push(endpoint);
            return {
                kind: 'fake',
                post: (message) => {
                    for (const other of endpoints) {
                        if (other === endpoint || other.dead || !other.receiver) continue;
                        other.receiver(message);
                    }
                },
                setReceiver: (fn) => { endpoint.receiver = fn; },
                close: () => { endpoint.dead = true; }
            };
        }
    };
}

describe('paginas sem mapa: participam do canal segurando NADA', () => {
    let hub;
    let clock;
    let locks;

    /**
     * A participant configured exactly as the three pages configure theirs: no overlay host, and
     * the heartbeat driven by the test rather than by a timer.
     * @param {Object} [options]
     * @returns {Object}
     */
    function makeLock(options = {}) {
        const lock = createTabLock({
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 200,
            ...options
        });
        locks.push(lock);
        return lock;
    }

    beforeEach(() => {
        hub = createHub();
        clock = 1000;
        locks = [];
    });

    afterEach(() => {
        for (const lock of locks) lock.destroy();
    });

    it('o arranjo real (mapa remoto + as tres paginas) deixa as quatro abas vivas', async () => {
        const bloqueios = [vi.fn(), vi.fn(), vi.fn()];
        const paginas = bloqueios.map((onBlocked) => makeLock({ onBlocked }));
        for (const pagina of paginas) await pagina.acquire(noneKey());

        clock += 5;
        const mapa = makeLock();
        const resultado = await mapa.acquire(remoteAtlasKey(ATLAS));

        expect(resultado.granted).toBe(true);
        expect(mapa.blocked).toBe(false);
        for (const pagina of paginas) expect(pagina.blocked).toBe(false);
        for (const onBlocked of bloqueios) expect(onBlocked).not.toHaveBeenCalled();
    });

    it('CONTROLE NEGATIVO: a mesma abertura com chave remota reprova a quarta aba', async () => {
        // Three tabs holding a REMOTE atlas instead of nothing, everything else identical. If the
        // arrangement above passed for any reason other than the none key, this would pass too.
        for (let i = 0; i < 3; i += 1) {
            await makeLock().acquire(remoteAtlasKey(ATLAS));
        }
        clock += 5;
        const mapa = makeLock();
        const resultado = await mapa.acquire(remoteAtlasKey(ATLAS));

        expect(resultado.granted).toBe(false);
        expect(mapa.blocked).toBe(true);
    });

    it('a aba do mapa VE as paginas no roster (e o que da sentido a "participar")', async () => {
        const pagina = makeLock();
        await pagina.acquire(noneKey());
        clock += 5;
        const mapa = makeLock();
        await mapa.acquire(remoteAtlasKey(ATLAS));

        const vistos = mapa.peers();
        expect(vistos.map((p) => p.tabId)).toContain(pagina.tabId);
        expect(vistos.find((p) => p.tabId === pagina.tabId).key.kind).toBe(TabLockKeyKind.NONE);

        // And the page sees the map tab too: the channel is not one-way.
        expect(pagina.peers().map((p) => p.tabId)).toContain(mapa.tabId);
    });

    it('"Usar aqui" de outra aba nao encosta numa pagina que nao segura atlas', async () => {
        const onBlocked = vi.fn();
        const pagina = makeLock({ onBlocked });
        await pagina.acquire(noneKey());

        clock += 5;
        const primeiroMapa = makeLock();
        await primeiroMapa.acquire(remoteAtlasKey(ATLAS));
        clock += 5;
        const segundoMapa = makeLock();
        await segundoMapa.acquire(remoteAtlasKey(ATLAS));
        expect(segundoMapa.blocked).toBe(true);

        await segundoMapa.requestTakeover();

        // The takeover reached the holder, which is the control that this case ran at all.
        expect(primeiroMapa.blocked).toBe(true);
        // And went past the page without touching it.
        expect(pagina.blocked).toBe(false);
        expect(pagina.key.kind).toBe(TabLockKeyKind.NONE);
        expect(onBlocked).not.toHaveBeenCalled();
    });

    it('fechar uma pagina sem mapa nao mexe em quem segura o atlas', async () => {
        const pagina = makeLock();
        await pagina.acquire(noneKey());
        clock += 5;
        const mapa = makeLock();
        await mapa.acquire(remoteAtlasKey(ATLAS));

        pagina.destroy();
        mapa.pulse();

        expect(mapa.blocked).toBe(false);
        expect(mapa.peers().map((p) => p.tabId)).not.toContain(pagina.tabId);
    });
});

describe('paginas sem mapa: a fiacao nos tres modulos de entrada', () => {
    it('coleta os tres modulos (guarda contra a lista esvaziar em silencio)', () => {
        expect(PAGINAS).toHaveLength(3);
        for (const { nome, texto } of PAGINAS) {
            expect(texto.length, `${nome} veio vazio`).toBeGreaterThan(1000);
        }
    });

    it('cada pagina importa tab-lock pelo ARQUIVO, nunca pelo barril @utils', () => {
        for (const { nome, texto } of PAGINAS) {
            const codigo = semComentarios(texto);
            expect(codigo, `${nome} nao importa @utils/tab-lock.js`)
                .toMatch(/from\s+'@utils\/tab-lock\.js'/);

            // The barrels reach `@store` transitively (`@utils` -> feature_navigation_utils ->
            // `@store`), which is how a ~140 kB page silently regains the whole map foundation.
            const barris = [...codigo.matchAll(/from\s+'(@utils|@modals)'/g)].map((m) => m[1]);
            expect(barris, `${nome} importa o barril ${barris.join(', ')}`).toEqual([]);
        }
    });

    it('cada pagina anuncia a chave NULA e desliga o overlay', () => {
        for (const { nome, texto } of PAGINAS) {
            const codigo = semComentarios(texto);
            expect(codigo, `${nome} nao importa initTabLock/noneKey`)
                .toMatch(/\{[^}]*\binitTabLock\b[^}]*\bnoneKey\b[^}]*\}\s*from\s+'@utils\/tab-lock\.js'/s);

            const chamada = codigo.match(/initTabLock\(\s*\{[^}]*\}\s*\)/s);
            expect(chamada, `${nome} nao chama initTabLock com opcoes`).not.toBeNull();
            expect(chamada[0], `${nome} nao anuncia noneKey()`).toMatch(/key:\s*noneKey\(\)/);
            // A page that cannot be blocked has nothing to render, and none of the three loads
            // `tab-lock.css` (it is imported by `style.css`, which only the map page pulls in).
            expect(chamada[0], `${nome} nao desliga o overlay`).toMatch(/overlayHost:\s*null/);
        }
    });

    it('nenhuma pagina reivindica atlas nenhum', () => {
        // The whole point of the owner's rule for these three: they never take a key, so they can
        // never be the tab that loses an atlas, and Mapa + Administracao keep working side by side.
        for (const { nome, texto } of PAGINAS) {
            const codigo = semComentarios(texto);
            const proibidos = ['acquireTabLock', 'setTabLockKey', 'localAtlasKey', 'remoteAtlasKey']
                .filter((simbolo) => new RegExp(`\\b${simbolo}\\b`).test(codigo));
            expect(proibidos, `${nome} reivindica atlas: ${proibidos.join(', ')}`).toEqual([]);
        }
    });
});
