// Path: tests/unit/tab-lock.test.js

/**
 * @fileoverview Tab-lock protocol: the owner's rule (two tabs collide when, and only when,
 * they hold the SAME atlas), the deterministic resolution of the boot window, the lifecycle
 * of the key, the real handoff, and the degraded path.
 *
 * The rule table has five rows and each one is a test below, each with the negative control
 * that would pass under the OLD rule ("one remote atlas at a time, whatever the ids"). That
 * pairing is the point: a predicate test with only the positive half stays green when the
 * predicate is widened to "always true", which is precisely how the previous rule read.
 *
 * ROW 4 (two DIFFERENT server atlases) asserted the opposite of the rule until the namespace
 * wiring landed, because while every server atlas resolved to one set of databases, letting the
 * second tab in meant letting it wipe the first tab's live map. It now asserts the rule, and the
 * sixth case below is the one the rule needed to be honest about: an ADOPTED slot, where a local
 * atlas and a server atlas are the same ten databases and the kinds disagree with the address.
 *
 * The window-hole case is built, never raced: a fake transport buffers both announcements so
 * the two tabs are, by construction, simultaneously unaware of each other, and only then are
 * the messages released. No timing, no statistics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    createTabLock,
    keysCollide,
    compareClaims,
    findBlockingPeer,
    noneKey,
    localAtlasKey,
    remoteAtlasKey,
    TabLockKeyKind
} from '@utils/tab-lock.js';

/**
 * In-process transport hub standing in for BroadcastChannel: same no-self-echo semantics,
 * plus the ability to HOLD every message so two tabs can be made simultaneously blind.
 */
function createHub() {
    const endpoints = [];
    let held = null;

    function deliver(from, message) {
        if (held) {
            held.push({ from, message });
            return;
        }
        for (const endpoint of endpoints) {
            if (endpoint === from || endpoint.dead || !endpoint.receiver) continue;
            endpoint.receiver(message);
        }
    }

    return {
        connect() {
            const endpoint = { receiver: null, dead: false };
            endpoints.push(endpoint);
            return {
                kind: 'fake',
                post: (message) => deliver(endpoint, message),
                setReceiver: (fn) => {
                    endpoint.receiver = fn;
                },
                close: () => {
                    endpoint.dead = true;
                },
                _endpoint: endpoint
            };
        },
        /** Stops delivering; everything posted from now on is queued. */
        hold() {
            held = [];
        },
        /** Delivers everything queued, in the given order, then goes back to live delivery. */
        flush({ reverse = false } = {}) {
            const queued = reverse ? [...held].reverse() : held;
            held = null;
            for (const { from, message } of queued) deliver(from, message);
        },
        /** Simulates a crash: the tab stops receiving and never says RELEASE. */
        kill(transport) {
            transport._endpoint.dead = true;
            transport._endpoint.receiver = null;
        }
    };
}

/**
 * Um `overlayHost` de mentira, com o vocabulário EXATO que o módulo usa e nada além dele.
 *
 * O ambiente da suíte é node puro, então não há DOM, e o que este arquivo precisa medir não é
 * layout: é se um aviso VISÍVEL aparece, com qual texto, e se ele não aparece quando não deve.
 * O risco de um dublê de DOM é medir o dublê, e o antídoto é o par de casos que vem depois: o
 * MESMO host recebe a sobreposição de bloqueio no modo normal, então "o host consegue receber
 * elementos" e "o aviso degradado não apareceu" deixam de ser a mesma resposta.
 *
 * @returns {object} Um nó raiz com `ownerDocument`, para passar como `overlayHost`.
 */
function createFakeHost() {
    function makeEl(tag) {
        const classes = new Set();
        const el = {
            tagName: tag,
            children: [],
            parent: null,
            listeners: new Map(),
            innerHTML: '',
            textContent: '',
            attributes: {},
            type: '',
            disabled: false,
            classList: {
                add: (name) => classes.add(name),
                remove: (name) => classes.delete(name),
                contains: (name) => classes.has(name)
            },
            get className() {
                return [...classes].join(' ');
            },
            set className(value) {
                classes.clear();
                for (const name of String(value).split(/\s+/u).filter(Boolean)) classes.add(name);
            },
            setAttribute: (key, value) => { el.attributes[key] = value; },
            append: (...kids) => {
                for (const kid of kids) {
                    kid.parent = el;
                    el.children.push(kid);
                }
            },
            appendChild: (kid) => {
                kid.parent = el;
                el.children.push(kid);
                return kid;
            },
            remove: () => {
                if (!el.parent) return;
                el.parent.children = el.parent.children.filter(child => child !== el);
                el.parent = null;
            },
            addEventListener: (type, handler) => {
                if (!el.listeners.has(type)) el.listeners.set(type, []);
                el.listeners.get(type).push(handler);
            },
            removeEventListener: (type, handler) => {
                const bucket = el.listeners.get(type) ?? [];
                el.listeners.set(type, bucket.filter(fn => fn !== handler));
            },
            click: () => {
                for (const handler of el.listeners.get('click') ?? []) handler({});
            }
        };
        return el;
    }

    const host = makeEl('body');
    host.ownerDocument = { createElement: makeEl };
    return host;
}

/**
 * @param {object} node - Nó do host falso.
 * @returns {object[]} O nó e toda a sua descendência, em pré-ordem.
 */
function arvore(node) {
    return [node, ...node.children.flatMap(arvore)];
}

/**
 * @param {object} host - Host falso.
 * @param {string} classe - Classe procurada.
 * @returns {object|undefined} O primeiro nó VISÍVEL com aquela classe.
 */
function achar(host, classe) {
    return arvore(host).find(node => node.classList.contains(classe));
}

/**
 * @param {object} node - Raiz da subárvore.
 * @returns {string} Todo o texto dela, concatenado, que é o que o usuário lê.
 */
function textoDe(node) {
    return arvore(node).map(item => item.textContent).filter(Boolean).join(' ');
}

const ATLAS_A = '11111111-1111-4111-8111-111111111111';
const ATLAS_B = '22222222-2222-4222-8222-222222222222';

describe('tab-lock: the owner rule as a predicate (one test per row of the table)', () => {
    it('ROW 1 — none x anything: never collides (the three pages without a map)', () => {
        expect(keysCollide(noneKey(), noneKey())).toBe(false);
        expect(keysCollide(noneKey(), remoteAtlasKey(ATLAS_A))).toBe(false);
        expect(keysCollide(localAtlasKey('slot-1'), noneKey())).toBe(false);
        // Negative control: the same arrangement with a real key in place of `none` DOES
        // collide, so the false above comes from the key and not from the predicate being inert.
        expect(keysCollide(localAtlasKey('slot-1'), localAtlasKey('slot-1'))).toBe(true);
    });

    it('ROW 2 — local x local, SAME id: collides', () => {
        expect(keysCollide(localAtlasKey('slot-1'), localAtlasKey('slot-1'))).toBe(true);
        expect(keysCollide(localAtlasKey('slot-1'), localAtlasKey('slot-2'))).toBe(false);
    });

    it('ROW 3 — remote x remote, SAME id: collides, whichever route named it', () => {
        // Two tabs reaching one atlas by two different public links resolve their tokens into
        // the same UUID, which is why the key is the id and never the URL. Two independently
        // built keys, so this is not object identity.
        const byLinkA = remoteAtlasKey(ATLAS_A);
        const byLinkB = remoteAtlasKey(ATLAS_A.slice(0));
        expect(byLinkA).not.toBe(byLinkB);
        expect(keysCollide(byLinkA, byLinkB)).toBe(true);
    });

    // ROW 4 WAS THE HOLD, AND THE HOLD IS GONE (E7, 2026-08-15). This case asserted `true`
    // (every pair of server atlases collided) for as long as one of the four holes named in
    // `keysCollide` was open: a third entry into a server atlas that mounted no namespace, the
    // logout of one tab deregistering the live namespace of the other, the public link erasing
    // what it had just registered, and a GLOBAL outbound queue pushing the operation of one
    // atlas to the server of the other. All four are closed by name, each with its own guard,
    // and the wiring is measured elsewhere (`tests/integration/namespace-remoto-fiacao.test.js`
    // proves two atlases are two blocks of databases), so the predicate now says what the
    // owner's rule always said.
    it('ROW 4 — remote x remote, DIFFERENT ids: does NOT collide', () => {
        expect(keysCollide(remoteAtlasKey(ATLAS_A), remoteAtlasKey(ATLAS_B))).toBe(false);
        expect(keysCollide(remoteAtlasKey(ATLAS_B), remoteAtlasKey(ATLAS_A))).toBe(false);
        // NEGATIVE CONTROL, and it is the whole point of removing a predicate branch: the SAME
        // server atlas still collides. Without this line, "two server atlases pass" is
        // indistinguishable from a predicate that turned into always-false, which is literally
        // the change this case records.
        expect(keysCollide(remoteAtlasKey(ATLAS_B), remoteAtlasKey(ATLAS_B))).toBe(true);
        expect(keysCollide(remoteAtlasKey(ATLAS_A), remoteAtlasKey(ATLAS_A))).toBe(true);
        // ...and local x local keeps both halves too, so nothing else moved with it.
        expect(keysCollide(localAtlasKey('slot-1'), localAtlasKey('slot-2'))).toBe(false);
        expect(keysCollide(localAtlasKey('slot-1'), localAtlasKey('slot-1'))).toBe(true);
    });

    it('ROW 5 — remote x local: never collides, even under the same id string', () => {
        expect(keysCollide(localAtlasKey('slot-1'), remoteAtlasKey(ATLAS_A))).toBe(false);
        expect(keysCollide(remoteAtlasKey(ATLAS_A), localAtlasKey('slot-1'))).toBe(false);
        // `localScope('x')` and `remoteScope('x')` are different database names, so the same id
        // under two kinds is two different atlases.
        expect(keysCollide(localAtlasKey(ATLAS_A), remoteAtlasKey(ATLAS_A))).toBe(false);
    });

    // ROW 6 — THE EXCEPTION TO ROW 5, AND THE ONLY ONE.
    //
    // `adoptRemoteAtlasAsLocal` rescues unsynced work at logout by moving the CLAIM from the
    // remote registry to the local one and ZERO bytes between databases, so the rescued slot
    // keeps the `remote-<atlasId>` suffix. A predicate on (kind, id) reads that pair as ROW 5
    // ("different namespaces") when it is the one pair that IS the same ten databases, and the
    // tab holding the rescue would watch another tab open that server atlas and wipe it on the
    // way in. The address is what is arbitrated, so the adopted slot claims the address of the
    // atlas it came from.
    it('ROW 6 — a local slot ADOPTED from a server atlas collides with that server atlas', () => {
        const rescued = localAtlasKey('slot-resgatado', { adoptedFrom: ATLAS_A });

        expect(keysCollide(rescued, remoteAtlasKey(ATLAS_A))).toBe(true);
        expect(keysCollide(remoteAtlasKey(ATLAS_A), rescued)).toBe(true);
        // ...and with nothing else: another server atlas, another local slot, and the same slot
        // id WITHOUT the adoption (which is the exact key the old derivation produced, i.e. the
        // negative control that shows this test measures `adoptedFrom` and not the slot id).
        expect(keysCollide(rescued, remoteAtlasKey(ATLAS_B))).toBe(false);
        expect(keysCollide(rescued, localAtlasKey('slot-1'))).toBe(false);
        expect(keysCollide(localAtlasKey('slot-resgatado'), remoteAtlasKey(ATLAS_A))).toBe(false);
        // Two tabs on the SAME rescued slot still collide, by slot and by address alike.
        expect(keysCollide(rescued, localAtlasKey('slot-resgatado', { adoptedFrom: ATLAS_A })))
            .toBe(true);
        // The kind stays LOCAL: it is what the overlay wording reads, and the atlas IS local now.
        expect(rescued.kind).toBe(TabLockKeyKind.LOCAL);
    });

    it('an ordinary local key carries no adoption field, and a bogus one is refused', () => {
        // The field is omitted rather than set to null, so every caller and test that compares a
        // local key against `{kind, atlasId}` keeps reading the same object.
        expect(localAtlasKey('slot-1')).toEqual({ kind: 'local', atlasId: 'slot-1' });
        expect(localAtlasKey('slot-1', { adoptedFrom: null })).toEqual({ kind: 'local', atlasId: 'slot-1' });
        expect(() => localAtlasKey('slot-1', { adoptedFrom: '' })).toThrow();
        expect(() => localAtlasKey('slot-1', { adoptedFrom: 42 })).toThrow();
    });

    it('rejects a key without an atlas id on BOTH sides: a nameless claim collides with nothing', () => {
        expect(() => localAtlasKey('')).toThrow();
        expect(() => localAtlasKey(null)).toThrow();
        // The remote key used to default to a nameless claim, which was harmless while every
        // remote collided with every other one and is a silent hole now.
        expect(() => remoteAtlasKey()).toThrow();
        expect(() => remoteAtlasKey('')).toThrow();
    });

    it('FAILS CLOSED on a kind it does not know, because the address is what is arbitrated', () => {
        // A corrupted or future-deploy peer message: same address, so it still blocks.
        const bogus = { kind: 'atlas', atlasId: 'slot-1' };
        expect(keysCollide(bogus, bogus)).toBe(true);
        expect(keysCollide(bogus, { kind: 'atlas', atlasId: 'slot-2' })).toBe(false);
        expect(keysCollide(bogus, localAtlasKey('slot-1'))).toBe(false);
        // ...but a claim carrying no id at all names no databases, so it arbitrates nothing, on
        // BOTH sides now. This line read `true` for the remote pair while all remotes shared one
        // database and an id-less remote claim (a public-link tab before it resolves its UUID)
        // therefore named that one address; with a namespace per atlas it names nothing, and
        // `remoteAtlasKey` refuses to build such a key at all (the case below), which is why the
        // deferred claim of `openPublicAtlasFromUrl` resolves the token first.
        expect(keysCollide({ kind: 'remote', atlasId: null }, remoteAtlasKey(ATLAS_A))).toBe(false);
        expect(keysCollide({ kind: 'local', atlasId: null }, localAtlasKey('slot-1'))).toBe(false);
        // Control for the two lines above: the id is what makes them false, not the shape. Give
        // the same malformed pair an id and it collides again.
        expect(keysCollide({ kind: 'remote', atlasId: ATLAS_A }, remoteAtlasKey(ATLAS_A))).toBe(true);
    });
});

describe('tab-lock: the total order that replaces the timing window', () => {
    const claim = (tabId, claimedAt, key = remoteAtlasKey(ATLAS_A)) => ({ tabId, claimedAt, key });

    it('orders by claim age first', () => {
        expect(compareClaims(claim('zzz', 10), claim('aaa', 20))).toBeLessThan(0);
        expect(compareClaims(claim('aaa', 20), claim('zzz', 10))).toBeGreaterThan(0);
    });

    it('breaks a same-millisecond tie by tab id, and is antisymmetric', () => {
        const a = claim('aaa', 10);
        const b = claim('bbb', 10);
        expect(compareClaims(a, b)).toBeLessThan(0);
        expect(compareClaims(b, a)).toBeGreaterThan(0);
        expect(compareClaims(a, a)).toBe(0);
    });

    it('picks the earliest colliding peer, ignoring the ones that do not collide', () => {
        const self = claim('ddd', 40);
        const peers = [
            claim('bbb', 20),
            claim('aaa', 10),
            claim('ccc', 30, localAtlasKey('slot-9')),
            claim('eee', 50)
        ];
        expect(findBlockingPeer(self, peers).tabId).toBe('aaa');
    });

    it('returns null when every colliding peer follows self', () => {
        const self = claim('aaa', 10);
        expect(findBlockingPeer(self, [claim('bbb', 20), claim('ccc', 30)])).toBeNull();
    });
});

describe('tab-lock: two tabs', () => {
    let hub;
    let clock;
    let locks;

    /**
     * @param {Object} [options]
     * @returns {import('@utils/tab-lock.js').default|Object} A lock bound to the shared hub.
     */
    function makeLock(options = {}) {
        const lock = createTabLock({
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 500,
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

    // ---------------------------------------------------------------- window hole

    it('BURACO DA JANELA: two tabs that announce while blind still end with exactly one active', async () => {
        const blockedA = vi.fn();
        const blockedB = vi.fn();
        const a = makeLock({ onBlocked: blockedA });
        const b = makeLock({ onBlocked: blockedB });

        // By construction, neither announcement reaches the other tab: this is the old probe
        // window made deterministic, with no clock involved. Both claim the SAME atlas, which
        // is what a collision means now.
        hub.hold();
        const [resA, resB] = await Promise.all([
            a.acquire(remoteAtlasKey(ATLAS_A)),
            b.acquire(remoteAtlasKey(ATLAS_A))
        ]);

        // Both were granted, which is exactly why a settle window can never be the guarantee.
        expect(resA.granted).toBe(true);
        expect(resB.granted).toBe(true);

        hub.flush();

        // The order decides, and it decides once: one blocked, one active.
        expect([a.blocked, b.blocked].filter(Boolean)).toHaveLength(1);
        const loser = a.blocked ? a : b;
        const winner = a.blocked ? b : a;
        expect(compareClaims(
            { tabId: winner.tabId, claimedAt: 1000, key: winner.key },
            { tabId: loser.tabId, claimedAt: 1000, key: loser.key }
        )).toBeLessThan(0);
        expect(loser === a ? blockedA : blockedB).toHaveBeenCalledTimes(1);
        expect(loser === a ? blockedB : blockedA).not.toHaveBeenCalled();
    });

    it('BURACO DA JANELA: the same tab loses whichever announcement is delivered first', async () => {
        const outcomes = [];
        for (const reverse of [false, true]) {
            hub = createHub();
            const a = makeLock();
            const b = makeLock();
            hub.hold();
            await Promise.all([
                a.acquire(remoteAtlasKey(ATLAS_A)),
                b.acquire(remoteAtlasKey(ATLAS_A))
            ]);
            hub.flush({ reverse });
            expect([a.blocked, b.blocked].filter(Boolean)).toHaveLength(1);
            outcomes.push(a.blocked ? 'a' : 'b');
            // Same ids and same claim instant on both runs: the two tabs are rebuilt with the
            // same clock, so only the delivery order differs.
            outcomes.push(compareClaims(
                { tabId: a.tabId, claimedAt: 1000, key: a.key },
                { tabId: b.tabId, claimedAt: 1000, key: b.key }
            ) < 0 ? 'a-precedes' : 'b-precedes');
        }
        // Whoever precedes wins, in both delivery orders.
        expect(outcomes[0]).not.toBe(outcomes[1].slice(0, 1));
        expect(outcomes[2]).not.toBe(outcomes[3].slice(0, 1));
    });

    // ---------------------------------------------------------------- acquire before the wipe

    it('denies the second tab BEFORE it can act, when the first is already in that atlas', async () => {
        const a = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;

        const b = makeLock();
        const result = await b.acquire(remoteAtlasKey(ATLAS_A));

        // openRemoteAtlas asks here, before clearAllDataStore, so the loser never wipes the
        // databases the winner is using.
        expect(result.granted).toBe(false);
        expect(result.blockedBy.tabId).toBe(a.tabId);
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(true);
    });

    // PROMOVIDO EM E7 (era `it.todo` ao lado de um caso que afirmava a recusa). O par de baixo e
    // o portao da etapa: sem o segundo caso, "as duas abas passaram" nao se distingue de um
    // predicado que virou sempre-falso, que e exatamente a linha que E7 apagou.
    it('concede DUAS abas em atlas de servidor DIFERENTES, e nenhuma delas e parada', async () => {
        const blockedA = vi.fn();
        const blockedB = vi.fn();
        const a = makeLock({ onBlocked: blockedA });
        const resultA = await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;

        const b = makeLock({ onBlocked: blockedB });
        const resultB = await b.acquire(remoteAtlasKey(ATLAS_B));

        expect(resultA.granted).toBe(true);
        expect(resultB.granted).toBe(true);
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(false);
        // O freio e a metade que destroi dado: se ele rodou, a aba parou de drenar um atlas que
        // ninguem disputa. `granted` sozinho nao veria isso.
        expect(blockedA).not.toHaveBeenCalled();
        expect(blockedB).not.toHaveBeenCalled();
        // As duas se enxergam: o silencio acima e arbitragem, nao um barramento morto.
        expect(a.peers().map(peer => peer.tabId)).toEqual([b.tabId]);
        expect(b.peers().map(peer => peer.tabId)).toEqual([a.tabId]);
    });

    it('CONTROLE NEGATIVO da promocao: duas abas no MESMO atlas de servidor ainda colidem', async () => {
        const blockedB = vi.fn();
        const a = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_B));
        clock += 5;

        const b = makeLock({ onBlocked: blockedB });
        const result = await b.acquire(remoteAtlasKey(ATLAS_B));

        expect(result.granted).toBe(false);
        expect(result.blockedBy.tabId).toBe(a.tabId);
        expect(b.blocked).toBe(true);
        expect(a.blocked).toBe(false);
        expect(blockedB).toHaveBeenCalled();
    });

    it('blocks a tab that opens the server atlas a RESCUED local slot is sitting on', async () => {
        // The logout rescue (`adoptRemoteAtlasAsLocal`) leaves this tab on a LOCAL atlas whose
        // databases are still `remote-<ATLAS_A>`. A tab opening that server atlas wipes on the
        // way in, so it must be the one that is stopped.
        const a = makeLock();
        await a.acquire(localAtlasKey('slot-resgatado', { adoptedFrom: ATLAS_A }));
        clock += 5;

        const b = makeLock();
        expect((await b.acquire(remoteAtlasKey(ATLAS_A))).granted).toBe(false);
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(true);

        // Control 1, same arrangement: a tab opening ANOTHER SERVER atlas passes. It is the
        // control that names the cause, and it only became usable again with the ROW 4 hold out
        // (while two remotes collided by kind, this tab was refused by the hold rather than by
        // the adoption, and the control measured the wrong thing). Another LOCAL slot alongside
        // it, so the pass is not a property of remotes.
        clock += 5;
        const c = makeLock();
        expect((await c.acquire(remoteAtlasKey(ATLAS_B))).granted).toBe(true);
        clock += 5;
        const cLocal = makeLock();
        expect((await cLocal.acquire(localAtlasKey('slot-outro'))).granted).toBe(true);

        // Control 2, the one that names the cause: with the other tabs gone, the SAME slot id
        // WITHOUT the adoption (the key the old derivation built) lets the same open through.
        a.destroy();
        b.destroy();
        c.destroy();
        cLocal.destroy();
        clock += 5;
        const d = makeLock();
        await d.acquire(localAtlasKey('slot-resgatado'));
        clock += 5;
        const e = makeLock();
        expect((await e.acquire(remoteAtlasKey(ATLAS_A))).granted).toBe(true);
        expect(d.blocked).toBe(false);
    });

    it('grants two tabs in DIFFERENT local atlases', async () => {
        const a = makeLock();
        const b = makeLock();
        const resA = await a.acquire(localAtlasKey('slot-1'));
        clock += 5;
        const resB = await b.acquire(localAtlasKey('slot-2'));

        expect(resA.granted).toBe(true);
        expect(resB.granted).toBe(true);
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(false);
    });

    it('denies a second tab in the SAME local atlas', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(localAtlasKey('slot-1'));
        clock += 5;
        expect((await b.acquire(localAtlasKey('slot-1'))).granted).toBe(false);
    });

    it('grants a local tab next to a remote tab', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        expect((await b.acquire(localAtlasKey('slot-1'))).granted).toBe(true);
    });

    it('never blocks a page that holds nothing, and never blocks anybody either', async () => {
        const painel = makeLock();
        const mapa = makeLock();
        await painel.acquire(noneKey());
        clock += 5;
        const result = await mapa.acquire(remoteAtlasKey(ATLAS_A));

        expect(result.granted).toBe(true);
        expect(painel.blocked).toBe(false);
        expect(mapa.blocked).toBe(false);
    });

    // ---------------------------------------------------------------- lifecycle of the key

    it('re-evaluates on a LIVE key change: logout (remote to local) frees the blocked tab', async () => {
        const resumed = vi.fn();
        const a = makeLock();
        const b = makeLock({ onResumed: resumed });
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        clock += 5;
        a.setKey(localAtlasKey('slot-1'));

        expect(b.blocked).toBe(false);
        expect(resumed).toHaveBeenCalledTimes(1);
    });

    it('RETRACTS the key on a 403/404 revert, which frees the blocked tab', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        a.release();

        expect(a.key.kind).toBe(TabLockKeyKind.NONE);
        expect(b.blocked).toBe(false);
    });

    it('releases the claim when the owner tab closes cleanly', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        a.destroy();

        expect(b.blocked).toBe(false);
    });

    it('detects a tab that died WITHOUT saying anything, by absence', async () => {
        const resumed = vi.fn();
        const a = makeLock();
        const b = makeLock({ onResumed: resumed, peerTtlMs: 7000 });
        const transportA = a._transport;
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        hub.kill(transportA);

        // Still within the TTL: the peer is presumed alive, the tab stays blocked.
        clock += 3000;
        b.pulse();
        expect(b.blocked).toBe(true);

        // Past the TTL: no heartbeat, no claim.
        clock += 5000;
        b.pulse();
        expect(b.blocked).toBe(false);
        expect(resumed).toHaveBeenCalledTimes(1);
    });

    it('keeps the claim alive across TTLs while the owner heartbeats', async () => {
        const a = makeLock({ peerTtlMs: 7000 });
        const b = makeLock({ peerTtlMs: 7000 });
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));

        for (let i = 0; i < 10; i += 1) {
            clock += 2000;
            a.pulse();
            b.pulse();
        }
        expect(b.blocked).toBe(true);
        expect(a.blocked).toBe(false);
    });

    // ---------------------------------------------------------------- handoff

    it('"Usar aqui" is a real handoff: the holder STOPS before the requester resumes', async () => {
        const order = [];
        // `onBlocked` is async on purpose: it stands for stopAutoFlush() + disconnect(), and the
        // whole point of the handoff is that the retraction waits for it to FINISH. A
        // synchronous spy would pass even against an implementation that retracts first.
        const a = makeLock({
            onBlocked: async () => {
                await Promise.resolve();
                await Promise.resolve();
                order.push('a-stopped');
            }
        });
        const b = makeLock({ onResumed: () => { order.push('b-resumed'); } });
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        const taken = await b.requestTakeover();

        expect(taken).toBe(true);
        expect(a.blocked).toBe(true);
        expect(b.blocked).toBe(false);
        expect(order).toEqual(['a-stopped', 'b-resumed']);
        // The holder retracted, so it does not immediately win the order back.
        expect(a.key.kind).toBe(TabLockKeyKind.NONE);
    });

    it('a takeover with nobody answering leaves the requester BLOCKED', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));

        // The holder freezes: it neither yields nor heartbeats, and the clock advances past
        // the takeover deadline but not past the TTL.
        hub.kill(a._transport);
        const pending = b.requestTakeover();
        clock += 600;
        const taken = await pending;

        expect(taken).toBe(false);
        expect(b.blocked).toBe(true);
    });

    it('the yielded tab can take the claim back, and the other side stops in turn', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        await b.requestTakeover();
        expect(a.blocked).toBe(true);

        clock += 10;
        const back = await a.requestTakeover();

        expect(back).toBe(true);
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(true);
    });

    // ---------------------------------------------------------------- unmount notice

    // O SUFIXO DE BANCO É ESCRITO À MÃO, e não derivado de `remoteScope()`. Este arquivo mede o
    // protocolo, que não conhece o store; derivar o endereço do módulo que o produz faria sujeito
    // e instrumento concordarem por construção. Que a string tenha esta forma é medido do outro
    // lado, em `tests/unit/tab-lock-sync-brake.test.js`, com a fábrica de namespace real.
    const ENDERECO_A = `remote-${ATLAS_A}`;
    const ENDERECO_B = `remote-${ATLAS_B}`;

    it('PORTÃO: a aba avisada FREIA mesmo sem colisão de chaves', async () => {
        // O par exato do expurgo de logout: quem sai da conta segurando um slot LOCAL, e a irmã
        // segurando um atlas de SERVIDOR. As duas chaves não colidem — hoje, e ainda menos depois
        // de E7 — e é por isso que o aviso não pode ser endereçado por `keysCollide`.
        const recebidos = [];
        const emissor = makeLock({ key: localAtlasKey('slot-a') });
        const irma = makeLock({
            key: remoteAtlasKey(ATLAS_B),
            onTeardown: async (enderecos) => {
                recebidos.push(enderecos);
                return enderecos.includes(ENDERECO_B);
            }
        });
        // A premissa do caso, asserida em vez de suposta: sem esta linha o teste passaria também
        // contra um aviso endereçado por colisão.
        expect(keysCollide(emissor.key, irma.key)).toBe(false);

        const relatorio = await emissor.announceTeardown([ENDERECO_B]);

        expect(recebidos).toEqual([[ENDERECO_B]]);
        expect(relatorio).toMatchObject({
            peers: 1, acked: 1, frozen: 1, timedOut: false, degraded: false
        });
        expect(irma.frozen).toBe(true);
        expect(irma.blocked).toBe(true);
        // Retratou: a aba não segura mais atlas nenhum, então ninguém fica trancado do lado de fora.
        expect(irma.key.kind).toBe(TabLockKeyKind.NONE);
    });

    it('o aviso chega a TODA aba viva, e só freia quem tem o endereço montado', async () => {
        const vistos = new Map();
        const observar = (nome, meu) => async (enderecos) => {
            vistos.set(nome, enderecos);
            return meu !== null && enderecos.includes(meu);
        };
        const emissor = makeLock({ key: localAtlasKey('slot-a') });
        const semMapa = makeLock({ key: noneKey(), onTeardown: observar('semMapa', null) });
        const outroLocal = makeLock({
            key: localAtlasKey('slot-b'), onTeardown: observar('outroLocal', 'slot-b')
        });
        const remota = makeLock({
            key: remoteAtlasKey(ATLAS_B), onTeardown: observar('remota', ENDERECO_B)
        });

        const relatorio = await emissor.announceTeardown([ENDERECO_A, ENDERECO_B]);

        // Entregue às três, incluindo a página sem mapa, que nunca colide com nada.
        expect([...vistos.keys()].sort()).toEqual(['outroLocal', 'remota', 'semMapa']);
        expect(vistos.get('semMapa')).toEqual([ENDERECO_A, ENDERECO_B]);
        expect(relatorio).toMatchObject({ peers: 3, acked: 3, frozen: 1 });
        // Uma só freou, e foi a do endereço citado: a decisão é do ENDEREÇO, não do recebimento.
        expect(remota.frozen).toBe(true);
        expect(outroLocal.frozen).toBe(false);
        expect(semMapa.frozen).toBe(false);
        expect(outroLocal.key.atlasId).toBe('slot-b');
    });

    it('o ack é EVIDÊNCIA: o emissor espera o freio TERMINAR, não começar', async () => {
        let liberar;
        const parando = new Promise((resolve) => { liberar = resolve; });
        const ordem = [];
        const emissor = makeLock({ key: localAtlasKey('slot-a') });
        makeLock({
            key: remoteAtlasKey(ATLAS_B),
            onTeardown: async () => {
                await parando;
                ordem.push('irma-parou');
                return true;
            }
        });

        const pendente = emissor.announceTeardown([ENDERECO_B], { timeoutMs: 2000 })
            .then((relatorio) => { ordem.push('emissor-seguiu'); return relatorio; });
        await new Promise((resolve) => setTimeout(resolve, 60));
        // Passaram-se duas rodadas de espera e o emissor NÃO seguiu: um ack postado no início do
        // freio (em vez de no fim) apareceria aqui, e o expurgo esvaziaria sob uma aba escrevendo.
        expect(ordem).toEqual([]);

        liberar();
        const relatorio = await pendente;

        expect(ordem).toEqual(['irma-parou', 'emissor-seguiu']);
        expect(relatorio).toMatchObject({ acked: 1, frozen: 1, timedOut: false });
    });

    it('uma aba que não responde custa o tempo limite, e nada mais', async () => {
        const emissor = makeLock({ key: localAtlasKey('slot-a') });
        const muda = makeLock({
            key: remoteAtlasKey(ATLAS_B),
            onTeardown: () => new Promise(() => {})   // nunca resolve
        });

        const relatorio = await emissor.announceTeardown([ENDERECO_B], { timeoutMs: 60 });

        // Silêncio degrada para o comportamento de hoje: a irmã segue montada, o lock exclusivo do
        // expurgo é recusado, o namespace é POUPADO. O logout não fica refém dela.
        expect(relatorio).toMatchObject({ peers: 1, acked: 0, frozen: 0, timedOut: true });
        expect(muda.frozen).toBe(false);
    });

    it('a aba freada NÃO volta: nem por o emissor sumir, nem por "Usar aqui"', async () => {
        const retomou = vi.fn();
        const emissor = makeLock({ key: localAtlasKey('slot-a') });
        const irma = makeLock({
            key: remoteAtlasKey(ATLAS_B),
            onTeardown: async () => true,
            onResumed: retomou
        });
        await emissor.announceTeardown([ENDERECO_B]);
        expect(irma.frozen).toBe(true);

        // O emissor fecha a aba, e o tempo passa: o caminho normal de desbloqueio.
        emissor.destroy();
        clock += 10000;
        irma.pulse();

        expect(irma.blocked).toBe(true);
        expect(retomou).not.toHaveBeenCalled();
        // E o botão do overlay não serve de saída: não há o que retomar de uma destruição.
        expect(await irma.requestTakeover()).toBe(false);
        expect(irma.blocked).toBe(true);
    });

    it('CONTROLE NEGATIVO do freio: sem `onTeardown` a aba responde e NÃO para', async () => {
        // A mesma montagem do portão, com o efeito ausente (é o estado de uma aba antes de
        // `installTabLockSyncBrake`). O ack sai mesmo assim, senão o emissor pagaria o tempo
        // limite inteiro por uma aba que já respondeu que não é com ela.
        const emissor = makeLock({ key: localAtlasKey('slot-a') });
        const irma = makeLock({ key: remoteAtlasKey(ATLAS_B) });

        const relatorio = await emissor.announceTeardown([ENDERECO_B]);

        expect(relatorio).toMatchObject({ peers: 1, acked: 1, frozen: 0, timedOut: false });
        expect(irma.frozen).toBe(false);
        expect(irma.key.atlasId).toBe(ATLAS_B);
    });

    it('um `onTeardown` que LANÇA responde "não parei", em vez de mentir que parou', async () => {
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        const emissor = makeLock({ key: localAtlasKey('slot-a') });
        const irma = makeLock({
            key: remoteAtlasKey(ATLAS_B),
            onTeardown: async () => { throw new Error('freio quebrado'); }
        });

        const relatorio = await emissor.announceTeardown([ENDERECO_B]);

        expect(relatorio).toMatchObject({ acked: 1, frozen: 0 });
        expect(irma.frozen).toBe(false);
        expect(erro).toHaveBeenCalled();
        erro.mockRestore();
    });

    it('lista vazia ou lixo não anuncia nada', async () => {
        const emissor = makeLock({ key: localAtlasKey('slot-a') });
        const irma = makeLock({ key: remoteAtlasKey(ATLAS_B), onTeardown: async () => true });

        for (const entrada of [[], null, undefined, [null, 42, {}]]) {
            const relatorio = await emissor.announceTeardown(entrada);
            expect(relatorio.addresses).toEqual([]);
            expect(relatorio.peers).toBe(0);
        }
        expect(irma.frozen).toBe(false);
    });

    it('um aviso do dialeto ANTIGO é ignorado, em vez de ser lido pela metade', async () => {
        const irma = makeLock({ key: remoteAtlasKey(ATLAS_B), onTeardown: async () => true });
        const emissor = makeLock({ key: localAtlasKey('slot-a') });

        emissor._transport.post({
            v: 2, type: 'TEARDOWN', tabId: emissor.tabId, addresses: [ENDERECO_B]
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(irma.frozen).toBe(false);
        // Controle positivo: o MESMO aviso na versão corrente freia, então o falso acima é a
        // versão e não o arranjo.
        expect((await emissor.announceTeardown([ENDERECO_B])).frozen).toBe(1);
        expect(irma.frozen).toBe(true);
    });

    // ---------------------------------------------------------------- degraded path

    it('anunciar sem transporte nenhum resolve na hora, declarando-se degradado', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const lock = createTabLock({
            createTransport: () => null,
            overlayHost: null,
            autoPulse: false
        });
        locks.push(lock);

        const relatorio = await lock.announceTeardown([ENDERECO_A]);

        // Sem canal não há a quem avisar, e o expurgo do lado do store já destrói em vez de
        // poupar quando não há Web Lock. O aviso não pode ser o que trava um logout.
        expect(relatorio).toMatchObject({ degraded: true, peers: 0, acked: 0, timedOut: false });
        warn.mockRestore();
    });

    it('degrades LOUDLY when there is no transport at all', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const lock = createTabLock({
            createTransport: () => null,
            overlayHost: null,
            autoPulse: false
        });
        locks.push(lock);

        const result = await lock.acquire(remoteAtlasKey(ATLAS_A));

        expect(warn).toHaveBeenCalledTimes(1);
        expect(result.degraded).toBe(true);
        expect(result.granted).toBe(true);
        expect(lock.degraded).toBe(true);
        expect(lock.transportKind).toBe('none');
        warn.mockRestore();
    });

    // ------------------------------------------- degraded: o aviso que o usuário precisa VER
    //
    // O modo degradado concede a todos (fail-open deliberado), e por uma fase inteira o único
    // sinal foi um `console.warn`: "off and audible" para quem tem o devtools aberto, e off e
    // MUDO para o usuário. Com a retenção remoto x remoto removida, este é o único mecanismo que
    // separa duas abas do MESMO atlas, então um degradado silencioso é um usuário com duas abas
    // gravando nos mesmos dados sem saber.
    //
    // Os quatro casos abaixo são um conjunto, e três deles existem para que o primeiro não possa
    // ficar verde por acaso: um aviso sempre presente, ou um host que aceita qualquer coisa,
    // passariam no primeiro e reprovariam nos outros.

    it('DEGRADADO: segurando um atlas, o aviso aparece e diz o que FAZER', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const host = createFakeHost();
        const lock = makeLock({ createTransport: () => null, overlayHost: host });

        await lock.acquire(remoteAtlasKey(ATLAS_A));

        const aviso = achar(host, 'tab-lock-degraded--visible');
        expect(aviso).toBeDefined();
        const texto = textoDe(aviso);
        // O QUE ACONTECEU e, principalmente, O QUE FAZER. A segunda metade é a que falta com mais
        // facilidade, e um aviso que só descreve a falha deixa a pessoa sem jogada nenhuma.
        expect(texto).toContain('Feche as outras abas');
        expect(texto).toContain('trabalhe em uma só');
        // E ele NÃO é a sobreposição de bloqueio: aquela tira o app do ar, e aqui a trava falha
        // ABERTA de propósito, então roubar o mapa transformaria falta de recurso em pane.
        expect(achar(host, 'tab-lock-overlay--visible')).toBeUndefined();
        warn.mockRestore();
    });

    it('CONTROLE: no modo NORMAL o aviso não aparece, e o host não é surdo', async () => {
        const host = createFakeHost();
        const a = makeLock();
        const b = makeLock({ overlayHost: host });

        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));

        // Sem este par o caso acima passaria contra um aviso pendurado incondicionalmente.
        expect(b.degraded).toBe(false);
        expect(achar(host, 'tab-lock-degraded--visible')).toBeUndefined();
        // ...e o host RECEBE elementos, o que separa "o aviso não apareceu" de "nada aparece
        // neste host": a mesma aba, no mesmo host, perdeu a disputa e ganhou a sobreposição.
        expect(b.blocked).toBe(true);
        expect(achar(host, 'tab-lock-overlay--visible')).toBeDefined();
    });

    it('CONTROLE: degradado SEM atlas nenhum não avisa nada', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const host = createFakeHost();
        const lock = makeLock({ createTransport: () => null, overlayHost: host });

        // As três páginas sem mapa vivem assim (`noneKey`), e uma chave `none` não colide com
        // ninguém: avisar ali seria ruído exatamente onde a mensagem precisa ser levada a sério.
        expect(lock.degraded).toBe(true);
        expect(achar(host, 'tab-lock-degraded--visible')).toBeUndefined();

        // CONTROLE do controle: a MESMA trava, no MESMO host, avisa assim que segura um atlas.
        await lock.acquire(localAtlasKey('slot-1'));
        expect(achar(host, 'tab-lock-degraded--visible')).toBeDefined();
        warn.mockRestore();
    });

    it('o aviso some quando a aba larga o atlas, e não volta depois de reconhecido', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const host = createFakeHost();
        const lock = makeLock({ createTransport: () => null, overlayHost: host });

        await lock.acquire(remoteAtlasKey(ATLAS_A));
        expect(achar(host, 'tab-lock-degraded--visible')).toBeDefined();

        lock.release();
        expect(achar(host, 'tab-lock-degraded--visible')).toBeUndefined();

        // Reconhecer é definitivo: a condição não tem conserto a partir daqui (o navegador não
        // tem nenhum dos dois transportes), então re-exibir a cada troca de atlas seria insistir
        // sobre algo que o usuário já sabe e não pode mudar.
        await lock.acquire(remoteAtlasKey(ATLAS_A));
        achar(host, 'tab-lock-degraded__button').click();
        expect(achar(host, 'tab-lock-degraded--visible')).toBeUndefined();

        await lock.acquire(remoteAtlasKey(ATLAS_B));
        expect(achar(host, 'tab-lock-degraded--visible')).toBeUndefined();
        warn.mockRestore();
    });

    it('ignores messages from a different protocol version instead of misreading them', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        // An old deploy speaking the previous dialect must not release the claim.
        a._transport.post({ type: 'RELEASE', tabId: a.tabId });
        b.pulse();
        expect(b.blocked).toBe(true);
    });
});

describe('tab-lock: o transporte REAL, sem o hub em processo', () => {
    // TODO SITIO DE TESTE DESTE MODULO INJETA UM HUB, entao o transporte que a producao usa nunca
    // tinha sido exercitado uma vez: um `post` que nao atravessasse, um `onmessage` que o
    // BroadcastChannel nao aceitasse, ou um envelope que o clone estruturado recusasse passariam
    // verdes em todos eles. Aqui a fabrica e a `defaultCreateTransport` (nenhum `createTransport`
    // e passado), com o BroadcastChannel do node.
    //
    // O RELOGIO CONTINUA INJETADO de proposito: o sujeito deste caso e o transporte, e um relogio
    // real faria as duas reivindicacoes cairem no mesmo milissegundo, onde quem bloqueia vira
    // sorteio pelo sufixo aleatorio do `tabId` (foi assim que o flake do sync-brake nasceu).
    const uniqueChannel = () => `ebgeo-tab-lock-teste-${Math.random().toString(36).slice(2)}`;

    it('usa o BroadcastChannel de verdade, e arbitra por ele', async () => {
        expect(typeof BroadcastChannel).toBe('function');
        const channelName = uniqueChannel();
        const built = [];
        let clock = 1000;
        const mk = () => {
            const lock = createTabLock({
                channelName,
                now: () => clock,
                overlayHost: null,
                autoPulse: false,
                settleMs: 30
            });
            built.push(lock);
            return lock;
        };

        try {
            const a = mk();
            expect(a.transportKind).toBe('broadcast-channel');
            expect(a.degraded).toBe(false);
            expect((await a.acquire(remoteAtlasKey(ATLAS_A))).granted).toBe(true);

            // MESMO atlas: a segunda aba perde, e o que prova que a mensagem atravessou o canal
            // (em vez de a aba simplesmente nao ter ouvido nada) e o `blockedBy` nomear a primeira.
            clock += 5;
            const b = mk();
            const disputa = await b.acquire(remoteAtlasKey(ATLAS_A));
            expect(disputa.granted).toBe(false);
            expect(disputa.blockedBy?.tabId).toBe(a.tabId);
            expect(b.blocked).toBe(true);

            // Controle negativo no MESMO canal: outro atlas de servidor passa...
            clock += 5;
            const c = mk();
            expect((await c.acquire(remoteAtlasKey(ATLAS_B))).granted).toBe(true);
            expect(c.blocked).toBe(false);
            // ...e as tres se enxergam mesmo, senao o `granted` acima seria surdez e nao
            // arbitragem: o roster de `a` tem as outras duas, vindas so pelo canal real.
            expect(a.peers().map(peer => peer.tabId).sort())
                .toEqual([b.tabId, c.tabId].sort());
        } finally {
            for (const lock of built) lock.destroy();
        }
    });
});

describe('tab-lock: what the module must NOT reach for', () => {
    const source = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js/utilities/tab-lock.js'),
        'utf8'
    );
    // The protocol NAMES these symbols in prose (that is the point of the fileoverview), so the
    // guard has to read the code, not the documentation about the code.
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    it('never imports the store, so blocking cannot erase data and the mapless pages stay light', () => {
        expect(code).not.toMatch(/from\s+'@store/);
        expect(code).not.toMatch(/from\s+'@js\/store/);
        expect(code).toMatch(/from\s+'\.\/event-cleanup\.js'/);
    });

    it('never clears or drops storage', () => {
        expect(code).not.toMatch(/clearAllDataStore|dropAtlasDatabases|dropInstance/);
        expect(code).not.toMatch(/localforage/);
    });
});
