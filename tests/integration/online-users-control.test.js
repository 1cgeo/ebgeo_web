// Path: tests/integration/online-users-control.test.js

/**
 * @fileoverview Render tests for the OnlineUsersControl roster (§A/§B gap +
 * cases C/D/E/G). Asserts the roster DOM renders peer names, the active-map
 * indicator, the away state, the briefing-edit indicator, the temporal instant
 * and the selection count — driven from the presence store via PRESENCE_CHANGED.
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
        temporal: null,
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

    it('case E: renders the temporal instant from the precomputed label ("em D+3")', () => {
        presenceStoreMock.getOthers.mockReturnValue([
            peer({ temporal: { cursor: 12345, label: 'D+3', playing: false } }),
        ]);
        firePresenceChanged();

        const temporal = container.queryAllByTestId('online-user-temporal');
        expect(temporal).toHaveLength(1);
        expect(temporal[0].textContent).toContain('em D+3');
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
                temporal: { cursor: 1, label: 'H+5' },
                selection: { featureIds: ['f1'], mapId: 'm1' },
            }),
        ]);
        firePresenceChanged();

        expect(container.queryAllByTestId('online-user-map')).toHaveLength(1);
        expect(container.queryAllByTestId('online-user-away')).toHaveLength(1);
        expect(container.queryAllByTestId('online-user-briefing')).toHaveLength(1);
        expect(container.queryAllByTestId('online-user-temporal')).toHaveLength(1);
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
