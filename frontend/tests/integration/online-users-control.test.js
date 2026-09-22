// Path: tests/integration/online-users-control.test.js

/**
 * @fileoverview Render tests for the OnlineUsersControl roster (§A/§B gap +
 * cases C/D/G). Asserts the roster DOM renders peer names, the active-map
 * indicator, the away state, the briefing-edit indicator and the selection
 * count — driven from the presence store via PRESENCE_CHANGED.
 *
 * O INSTANTE DA LINHA DO TEMPO ("em D+3") SAIU EM 2026-09-21, por decisão do dono, junto com o
 * quadro de presença que o alimentava. O caso que o afirmava virou o caso que afirma a AUSÊNCIA,
 * alimentado com o campo que um servidor antigo ainda produziria.
 *
 * The vitest env is `node` (no jsdom), so a minimal DOM stub stands in for the
 * handful of element APIs the control touches (createElement, setAttribute,
 * appendChild/replaceChildren, classList.add, textContent, hidden,
 * addEventListener). Assertions traverse the stub tree by data-testid.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Minimal DOM stub (node env — no jsdom)
// ============================================================================

class FakeEl {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.attributes = {};
        this.className = '';
        this._classes = new Set();
        this._textContent = '';
        this.hidden = false;
        this.type = '';
        this.listeners = {};
        this.classList = {
            add: (c) => this._classes.add(c),
            remove: (c) => this._classes.delete(c),
            contains: (c) => this._classes.has(c),
        };
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
    removeEventListener(ev, fn) {
        if (this.listeners[ev]) this.listeners[ev] = this.listeners[ev].filter((f) => f !== fn);
    }
    get textContent() { return this._textContent; }
    set textContent(v) { this._textContent = String(v); this.children = []; }

    /** Test helper: depth-first collect descendants matching a data-testid. */
    queryAllByTestId(testid) {
        const out = [];
        const walk = (node) => {
            for (const c of node.children) {
                if (c.getAttribute && c.getAttribute('data-testid') === testid) out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    /** Test helper: full concatenated text of this subtree. */
    get allText() {
        if (this.children.length === 0) return this._textContent;
        return this.children.map((c) => c.allText ?? '').join('');
    }
}

// The control now attaches document-level listeners (outside-click / Esc to
// close the dropdown), so the stub must accept add/removeEventListener.
const documentStub = {
    createElement: (tag) => new FakeEl(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
};

// ============================================================================
// Mocks
// ============================================================================

const { presenceStoreMock, sessionContextMock, eventBusMock, busRegistry } = vi.hoisted(() => {
    const registry = {};
    return {
        presenceStoreMock: { getOthers: vi.fn(() => []) },
        sessionContextMock: { clientId: 'self' },
        eventBusMock: {
            on: vi.fn((event, handler) => {
                (registry[event] ||= new Set()).add(handler);
                return () => registry[event].delete(handler);
            }),
            off: vi.fn(),
            emit: vi.fn(),
        },
        busRegistry: registry,
    };
});

vi.mock('@js/presence/presence-store.js', () => ({ presenceStore: presenceStoreMock }));
vi.mock('@store/sync/session-context.js', () => ({ sessionContext: sessionContextMock }));
vi.mock('@store/services.js', () => ({ getEventBus: () => eventBusMock }));

import { OnlineUsersControl } from '@js/presence/online-users.control.js';
import { EventTypes } from '@events/event_types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Builds a complete PresenceUser with overridable awareness fields. */
function peer(overrides = {}) {
    return {
        userId: 'u1',
        clientId: 'c1',
        userName: 'Alice',
        cursor: null,
        selection: null,
        away: false,
        currentMap: null,
        briefingEdit: null,
        ...overrides,
    };
}

function firePresenceChanged() {
    for (const cb of busRegistry[EventTypes.PRESENCE_CHANGED] || []) cb({});
}

// ============================================================================
// Tests
// ============================================================================

describe('OnlineUsersControl — roster render', () => {
    /** @type {OnlineUsersControl} */
    let control;
    /** @type {FakeEl} */
    let container;
    let originalDocument;

    beforeEach(() => {
        originalDocument = globalThis.document;
        globalThis.document = documentStub;
        for (const k of Object.keys(busRegistry)) delete busRegistry[k];
        presenceStoreMock.getOthers.mockReset();
        presenceStoreMock.getOthers.mockReturnValue([]);
        control = new OnlineUsersControl();
        container = control.onAdd(/* map */ {});
        // Expand so the list is rendered (not hidden) for assertions.
        const toggle = container.queryAllByTestId('online-users-toggle')[0];
        for (const fn of toggle.listeners.click || []) fn();
    });

    afterEach(() => {
        globalThis.document = originalDocument;
    });

    function rosterItems() {
        return container.queryAllByTestId('online-user-item');
    }

    it('hides the control when there are no other users', () => {
        presenceStoreMock.getOthers.mockReturnValue([]);
        firePresenceChanged();
        expect(container.hidden).toBe(true);
        expect(container.getAttribute('data-count')).toBe('0');
    });

    it('renders a row with the peer name', () => {
        presenceStoreMock.getOthers.mockReturnValue([peer({ userName: 'Alice' })]);
        firePresenceChanged();

        expect(container.hidden).toBe(false);
        expect(container.getAttribute('data-count')).toBe('1');
        const names = container.queryAllByTestId('online-user-name');
        expect(names).toHaveLength(1);
        expect(names[0].textContent).toBe('Alice');
    });

    it('a linha escreve POSTO mais nome de guerra, e a inicial continua sendo a do NOME (dono, 2026-09-20)', () => {
        presenceStoreMock.getOthers.mockReturnValue([
            peer({ clientId: 'c1', userId: 'u1', userName: 'Diniz', rank: 'Maj' }),
            peer({ clientId: 'c2', userId: 'u2', userName: 'Marcel', rank: '1º Ten' }),
            // O visitante de link público não tem posto: o servidor manda nulo.
            peer({ clientId: 'c3', userId: 'public-x', userName: 'Visitante', rank: null }),
            // Posto sem nome não vira rótulo: a linha cai no id, como sempre caiu.
            peer({ clientId: 'c4', userId: 'u4', userName: null, rank: 'Cap' }),
        ]);
        firePresenceChanged();

        const names = container.queryAllByTestId('online-user-name').map((n) => n.textContent);
        expect(names).toEqual(['Maj Diniz', '1º Ten Marcel', 'Visitante', 'u4']);
        // QUATRO linhas: o visitante CONTA, com ou sem cursor.
        expect(container.getAttribute('data-count')).toBe('4');
    });

    it('caps the avatar stack at 3 and shows a "+N" overflow chip for many users', () => {
        const many = Array.from({ length: 5 }, (_, i) =>
            peer({ userId: `u${i}`, clientId: `c${i}`, userName: `User ${i}` }));
        presenceStoreMock.getOthers.mockReturnValue(many);
        firePresenceChanged();

        // The visible total count reflects everyone.
        expect(container.getAttribute('data-count')).toBe('5');
        const count = container.queryAllByTestId('online-users-count');
        expect(count[0].textContent).toBe('5');
        // The compact stack overflows past 3 avatars into a "+2" chip.
        const overflow = container.queryAllByTestId('online-users-overflow');
        expect(overflow).toHaveLength(1);
        expect(overflow[0].textContent).toBe('+2');
        // The detailed dropdown still lists every user (it scrolls when long).
        expect(rosterItems()).toHaveLength(5);
    });

    it('case C: renders the active-map name as-is, with NO redundant "Mapa" prefix', () => {
        // currentMap already holds the full map name; the indicator must show it verbatim
        // (regression: it used to render `Mapa ${name}` → "Mapa Mapa Tático").
        presenceStoreMock.getOthers.mockReturnValue([peer({ currentMap: 'Mapa Tático' })]);
        firePresenceChanged();

        const maps = container.queryAllByTestId('online-user-map');
        expect(maps).toHaveLength(1);
        expect(maps[0].textContent).toBe('Mapa Tático');
    });

    it('case V: diz em qual visualizador o colega está, e sem nome quando o recurso não chegou (dono, 2026-09-22)', () => {
        presenceStoreMock.getOthers.mockReturnValue([
            peer({
                clientId: 'c1', userId: 'u1', currentMap: 'Mapa Tático',
                viewer: { surface: '360', recurso: { tipo: 'sv360_project', id: 'p1', nome: 'Quartel', foto: 'IMG_7.jpg' } },
            }),
            // Um privado que ESTE cliente não lê: o servidor mandou o tipo de visualizador sem o recurso.
            peer({ clientId: 'c2', userId: 'u2', userName: 'Bruno', viewer: { surface: '3d', recurso: null } }),
            peer({ clientId: 'c3', userId: 'u3', userName: 'Carla', viewer: null }),
        ]);
        firePresenceChanged();

        const vistos = container.queryAllByTestId('online-user-viewer').map((el) => el.textContent);
        expect(vistos).toEqual(['no 360°: Quartel, foto IMG_7.jpg', 'no visualizador 3D']);
        // O colega que está no mapa continua com o mapa e sem linha de visualizador.
        expect(container.queryAllByTestId('online-user-map').map((el) => el.textContent)).toEqual(['Mapa Tático']);
    });

    it('case G: renders the away state (dimmed + "ausente")', () => {
        presenceStoreMock.getOthers.mockReturnValue([peer({ away: true })]);
        firePresenceChanged();

        const item = rosterItems()[0];
        expect(item.classList.contains('online-users__item--away')).toBe(true);
        expect(item.getAttribute('data-away')).toBe('true');
        const away = container.queryAllByTestId('online-user-away');
        expect(away).toHaveLength(1);
        expect(away[0].textContent).toContain('ausente');
    });

    it('case D: renders the briefing-edit indicator', () => {
        presenceStoreMock.getOthers.mockReturnValue([
            peer({ briefingEdit: { briefingId: 'b1', userName: 'Alice' } }),
        ]);
        firePresenceChanged();

        const edits = container.queryAllByTestId('online-user-briefing');
        expect(edits).toHaveLength(1);
        expect(edits[0].textContent).toContain('editando briefing');
    });

    it('O INSTANTE DA LINHA DO TEMPO NÃO É DESENHADO, nem com o campo presente (dono, 2026-09-21)', () => {
        // A lista escrevia "em D+3" a partir do quadro de presença que carregava o instante do
        // par. O quadro saiu dos dois pacotes, e a linha saiu da lista. O campo é passado aqui de
        // propósito (é o que um servidor antigo ainda produziria) para provar que a ausência é
        // da REGRA e não do dado; o PISO ao lado mostra que a mesma pessoa continua rendendo as
        // outras afordâncias de consciência.
        presenceStoreMock.getOthers.mockReturnValue([
            peer({ temporal: { cursor: 12345, label: 'D+3', playing: false }, currentMap: 'Mapa B' }),
        ]);
        firePresenceChanged();

        expect(container.queryAllByTestId('online-user-temporal')).toHaveLength(0);
        expect(rosterItems()[0].allText).not.toContain('D+3');
        expect(container.queryAllByTestId('online-user-map')).toHaveLength(1);
    });

    it('case F: renders a selection count indicator', () => {
        presenceStoreMock.getOthers.mockReturnValue([
            peer({ selection: { featureIds: ['f1', 'f2', 'f3'], mapId: 'm1' } }),
        ]);
        firePresenceChanged();

        const sel = container.queryAllByTestId('online-user-selection');
        expect(sel).toHaveLength(1);
        expect(sel[0].textContent).toContain('selecionou 3');
    });

    it('renders multiple awareness indicators together for one peer', () => {
        presenceStoreMock.getOthers.mockReturnValue([
            peer({
                userName: 'Bravo',
                currentMap: 'Mapa B',
                away: true,
                briefingEdit: { briefingId: 'b9', userName: 'Bravo' },
                selection: { featureIds: ['f1'], mapId: 'm1' },
            }),
        ]);
        firePresenceChanged();

        expect(container.queryAllByTestId('online-user-map')).toHaveLength(1);
        expect(container.queryAllByTestId('online-user-away')).toHaveLength(1);
        expect(container.queryAllByTestId('online-user-briefing')).toHaveLength(1);
        expect(container.queryAllByTestId('online-user-selection')).toHaveLength(1);
        const item = rosterItems()[0];
        expect(item.allText).toContain('Bravo');
    });

    it('renders one row per online peer', () => {
        presenceStoreMock.getOthers.mockReturnValue([
            peer({ clientId: 'c1', userName: 'Alice' }),
            peer({ clientId: 'c2', userName: 'Bob' }),
        ]);
        firePresenceChanged();

        expect(container.getAttribute('data-count')).toBe('2');
        expect(rosterItems()).toHaveLength(2);
    });
});
