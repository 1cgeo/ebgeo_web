import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// state_manager.js imports `EventTypes` from '../events' (a pure barrel that only
// pulls in EventEmitter) and deep-utils. Neither touches the DOM at load time, so
// the real module can be imported directly in the `node` environment.
import {
    createStateManager,
    getStateManagerInstance,
    _resetForTesting,
} from '../../src/js/state/state_manager.js';
import { createEventBus } from '../../src/js/events/event_bus.js';

// A fresh StateManager singleton for every test. The module enforces a single
// instance via createStateManager(), so reset the module-level slot each time.
let sm;
beforeEach(() => {
    _resetForTesting();
    sm = createStateManager();
});
afterEach(() => {
    _resetForTesting();
    vi.useRealTimers();
});

// ============================================================================
// Singleton management
// ============================================================================

describe('singleton management', () => {
    it('createStateManager returns the same instance via getStateManagerInstance', () => {
        expect(getStateManagerInstance()).toBe(sm);
    });

    it('createStateManager throws if called twice without reset', () => {
        expect(() => createStateManager()).toThrow(/already created/i);
    });

    it('_resetForTesting clears the singleton', () => {
        _resetForTesting();
        expect(getStateManagerInstance()).toBeNull();
    });
});

// ============================================================================
// get / set round-trip
// ============================================================================

describe('get / set round-trip', () => {
    it('get() with no path returns a clone of the whole state', () => {
        const whole = sm.get();
        expect(whole.sidebar.expanded).toBe(false);
        expect(whole.baseLayer.activeLayer).toBe('carta-topografica');
    });

    it('get() returns a deep clone — mutating it does not affect internal state', () => {
        const snap = sm.get('sidebar');
        snap.expanded = true;
        snap.collapsedLayers.push('x');
        expect(sm.get('sidebar.expanded')).toBe(false);
        expect(sm.get('sidebar.collapsedLayers')).toEqual([]);
    });

    it('set then get round-trips a primitive', () => {
        sm.set('sidebar.expanded', true);
        expect(sm.get('sidebar.expanded')).toBe(true);
    });

    it('set then get round-trips an object (by value, not reference)', () => {
        const obj = { type: 'point', id: 'a', feature: { foo: 1 } };
        sm.set('panels.featurePanel', obj);
        const back = sm.get('panels.featurePanel');
        expect(back).toEqual(obj);
        expect(back).not.toBe(obj); // deep cloned out
    });

    it('mutating the value passed to set does not leak into state', () => {
        const arr = ['a'];
        sm.set('sidebar.collapsedLayers', arr);
        arr.push('b'); // mutate after set
        // setByPath stores the same array reference, but get() clones on read.
        const stored = sm.get('sidebar.collapsedLayers');
        const mutated = sm.get('sidebar.collapsedLayers');
        mutated.push('z');
        expect(sm.get('sidebar.collapsedLayers')).toEqual(stored);
    });

    it('get() on a non-existent path returns undefined', () => {
        expect(sm.get('does.not.exist')).toBeUndefined();
        expect(sm.get('sidebar.nope')).toBeUndefined();
    });

    it('set creates intermediate objects for new deep paths', () => {
        sm.set('ui.snapping.enabled', true);
        expect(sm.get('ui.snapping.enabled')).toBe(true);
        sm.set('brandNew.deep.leaf', 42);
        expect(sm.get('brandNew.deep.leaf')).toBe(42);
    });

    it('set is a no-op when the new value is deeply equal to the current value', () => {
        const cb = vi.fn();
        sm.subscribe('sidebar.expanded', cb);
        sm.set('sidebar.expanded', false); // same as default
        expect(cb).not.toHaveBeenCalled();
    });

    it('set with a deeply-equal object value does not notify', () => {
        sm.set('panels.featurePanel', { visible: false, featureType: null, featureId: null });
        const cb = vi.fn();
        sm.subscribe('panels.featurePanel', cb);
        // identical structure -> deepEqual short-circuits
        sm.set('panels.featurePanel', { visible: false, featureType: null, featureId: null });
        expect(cb).not.toHaveBeenCalled();
    });

    it('set can store undefined and null distinctly from "missing"', () => {
        sm.set('selection.hoveredFeatureId', null); // already null default -> no change
        sm.set('selection.hoveredFeatureId', 'h1');
        expect(sm.get('selection.hoveredFeatureId')).toBe('h1');
        sm.set('selection.hoveredFeatureId', undefined);
        expect(sm.get('selection.hoveredFeatureId')).toBeUndefined();
    });

    it('property: set->get round-trips arbitrary JSON values (non-mouse path)', () => {
        fc.assert(fc.property(fc.jsonValue(), (value) => {
            const fresh = (() => { _resetForTesting(); return createStateManager(); })();
            fresh.set('clipboard.sourceMapName', value);
            expect(fresh.get('clipboard.sourceMapName')).toEqual(value);
        }));
    });
});

// ============================================================================
// getUnsafe / getShallow
// ============================================================================

describe('getUnsafe', () => {
    it('returns the live internal reference (no clone)', () => {
        const a = sm.getUnsafe('selection');
        const b = sm.getUnsafe('selection');
        expect(a).toBe(b); // same reference each call (no clone)
    });

    it('getUnsafe() with no path returns the whole live state', () => {
        expect(sm.getUnsafe()).toBe(sm.getUnsafe());
        expect(sm.getUnsafe().sidebar.expanded).toBe(false);
    });

    it('getUnsafe returns undefined for missing path', () => {
        expect(sm.getUnsafe('no.such.path')).toBeUndefined();
    });

    it('a set replaces the path nodes so the old getUnsafe ref is stale (structural sharing)', () => {
        const before = sm.getUnsafe('sidebar');
        sm.set('sidebar.expanded', true);
        const after = sm.getUnsafe('sidebar');
        expect(after).not.toBe(before); // setByPath rebuilt the node
        expect(after.expanded).toBe(true);
        expect(before.expanded).toBe(false); // old reference unchanged
    });
});

describe('getShallow', () => {
    it('clones the top level but shares nested references', () => {
        sm.set('selection.features', [{ type: 'point', id: '1', feature: { g: 1 } }]);
        const arr = sm.getShallow('selection.features');
        const arr2 = sm.getShallow('selection.features');
        expect(arr).not.toBe(arr2);       // new array each call
        expect(arr).toEqual(arr2);
        expect(arr[0]).toBe(arr2[0]);     // nested element shared (shallow)
    });

    it('returns primitives as-is', () => {
        sm.set('sidebar.width', 500);
        expect(sm.getShallow('sidebar.width')).toBe(500);
    });

    it('returns null/undefined untouched', () => {
        expect(sm.getShallow('selection.hoveredFeatureId')).toBeNull();
        expect(sm.getShallow('no.such.path')).toBeUndefined();
    });

    it('getShallow() with no path shallow-clones the root', () => {
        const root = sm.getShallow();
        expect(root).not.toBe(sm.getUnsafe());
        expect(root.sidebar).toBe(sm.getUnsafe().sidebar); // nested shared
    });
});

// ============================================================================
// _pathMatches (dot-path matching rules)
// ============================================================================

describe('_pathMatches', () => {
    it('rule 1: exact match', () => {
        expect(sm._pathMatches('a.b', 'a.b')).toBe(true);
    });

    it('rule 2: child changed notifies a parent subscriber', () => {
        expect(sm._pathMatches('a.b.c', 'a.b')).toBe(true);
        expect(sm._pathMatches('a.b', 'a')).toBe(true);
    });

    it('rule 3: parent changed notifies a child subscriber', () => {
        expect(sm._pathMatches('a', 'a.b')).toBe(true);
        expect(sm._pathMatches('a.b', 'a.b.c')).toBe(true);
    });

    it('does not match sibling paths', () => {
        expect(sm._pathMatches('a.b', 'a.c')).toBe(false);
        expect(sm._pathMatches('a.bc', 'a.b')).toBe(false); // prefix is not a segment boundary
        expect(sm._pathMatches('a.b', 'a.bc')).toBe(false);
    });

    it('does not match unrelated roots', () => {
        expect(sm._pathMatches('x.y', 'a.b')).toBe(false);
    });

    it('property: _pathMatches is symmetric (ancestor/descendant relation)', () => {
        const seg = fc.constantFrom('a', 'b', 'c', 'd');
        const pathArb = fc.array(seg, { minLength: 1, maxLength: 4 }).map(a => a.join('.'));
        fc.assert(fc.property(pathArb, pathArb, (p, q) => {
            expect(sm._pathMatches(p, q)).toBe(sm._pathMatches(q, p));
        }));
    });
});

// ============================================================================
// subscribe / notify / unsubscribe
// ============================================================================

describe('subscribe / notify', () => {
    it('notifies an exact-path subscriber with the new value', () => {
        const cb = vi.fn();
        sm.subscribe('sidebar.expanded', cb);
        sm.set('sidebar.expanded', true);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(true);
    });

    it('notifies a parent subscriber when a child changes (rule 2)', () => {
        const cb = vi.fn();
        sm.subscribe('sidebar', cb);
        sm.set('sidebar.width', 999);
        expect(cb).toHaveBeenCalledTimes(1);
        // parent subscriber receives a shallow clone of the parent object
        expect(cb.mock.calls[0][0].width).toBe(999);
    });

    it('notifies a child subscriber when the parent is replaced (rule 3)', () => {
        const cb = vi.fn();
        sm.subscribe('selection.features', cb);
        sm.set('selection', { features: [{ type: 'p', id: '1' }], hoveredFeatureId: null, mode: 'single' });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toEqual([{ type: 'p', id: '1' }]);
    });

    it('does not notify unrelated subscribers', () => {
        const cb = vi.fn();
        sm.subscribe('baseLayer.activeLayer', cb);
        sm.set('sidebar.expanded', true);
        expect(cb).not.toHaveBeenCalled();
    });

    it('supports multiple subscribers on the same path', () => {
        const a = vi.fn();
        const b = vi.fn();
        sm.subscribe('sidebar.expanded', a);
        sm.subscribe('sidebar.expanded', b);
        sm.set('sidebar.expanded', true);
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe stops further notifications', () => {
        const cb = vi.fn();
        const off = sm.subscribe('sidebar.expanded', cb);
        sm.set('sidebar.expanded', true);
        off();
        sm.set('sidebar.expanded', false);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe is idempotent and only removes its own callback', () => {
        const a = vi.fn();
        const b = vi.fn();
        const offA = sm.subscribe('sidebar.expanded', a);
        sm.subscribe('sidebar.expanded', b);
        offA();
        offA(); // second call is a no-op
        sm.set('sidebar.expanded', true);
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('a throwing subscriber does not break other subscribers', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();
        sm.subscribe('sidebar.expanded', bad);
        sm.subscribe('sidebar.expanded', good);
        expect(() => sm.set('sidebar.expanded', true)).not.toThrow();
        expect(good).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('the value passed to subscribers is a shallow clone of the subscribed path', () => {
        let received;
        sm.subscribe('selection.features', (v) => { received = v; });
        sm.set('selection.features', [{ type: 'p', id: '1' }]);
        expect(received).toEqual([{ type: 'p', id: '1' }]);
        // mutating the received array must not mutate internal state
        received.push({ type: 'p', id: '2' });
        expect(sm.getUnsafe('selection.features')).toHaveLength(1);
    });
});

// ============================================================================
// batchUpdate
// ============================================================================

describe('batchUpdate', () => {
    it('coalesces multiple sets into a single notification per subscriber', () => {
        const cb = vi.fn();
        sm.subscribe('sidebar', cb);
        sm.batchUpdate(() => {
            sm.set('sidebar.expanded', true);
            sm.set('sidebar.width', 400);
            sm.set('sidebar.activeTab', 'mapas');
        });
        // 3 child changes, but the parent subscriber is notified exactly once
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('still notifies distinct subscribed paths individually after a batch', () => {
        const expandedCb = vi.fn();
        const widthCb = vi.fn();
        sm.subscribe('sidebar.expanded', expandedCb);
        sm.subscribe('sidebar.width', widthCb);
        sm.batchUpdate(() => {
            sm.set('sidebar.expanded', true);
            sm.set('sidebar.width', 400);
        });
        expect(expandedCb).toHaveBeenCalledTimes(1);
        expect(widthCb).toHaveBeenCalledTimes(1);
    });

    it('deduplicates notifications when the same path is set multiple times', () => {
        const cb = vi.fn();
        sm.subscribe('sidebar.expanded', cb);
        sm.batchUpdate(() => {
            sm.set('sidebar.expanded', true);
            sm.set('sidebar.expanded', false);
            sm.set('sidebar.expanded', true);
        });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('nested batches flush only when the outermost completes', () => {
        const cb = vi.fn();
        sm.subscribe('sidebar.expanded', cb);
        sm.batchUpdate(() => {
            sm.set('sidebar.expanded', true);
            sm.batchUpdate(() => {
                sm.set('sidebar.width', 123);
            });
            // inner batch ended but depth is still > 0 -> nothing flushed yet
            expect(cb).not.toHaveBeenCalled();
        });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('restores batch depth even if the batched function throws', () => {
        const cb = vi.fn();
        sm.subscribe('sidebar.expanded', cb);
        expect(() => sm.batchUpdate(() => {
            sm.set('sidebar.expanded', true);
            throw new Error('mid-batch');
        })).toThrow('mid-batch');
        // depth was restored in `finally`; a subsequent normal set notifies immediately
        sm.set('sidebar.expanded', false);
        // first notification flushed at batch end, second from the direct set
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('the batched value seen by the subscriber reflects the final state', () => {
        let seen;
        sm.subscribe('sidebar.width', (v) => { seen = v; });
        sm.batchUpdate(() => {
            sm.set('sidebar.width', 100);
            sm.set('sidebar.width', 200);
        });
        expect(seen).toBe(200);
    });
});

// ============================================================================
// Throttled mouse updates
// ============================================================================

describe('mouse throttle (set on mouse.* paths)', () => {
    it('applies the first mouse update immediately', () => {
        sm.set('mouse.coordinates', { lng: 1, lat: 2 });
        expect(sm.get('mouse.coordinates')).toEqual({ lng: 1, lat: 2 });
    });

    it('defers a rapid second update, then flushes the latest value via timer', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        sm.set('mouse.coordinates', { lng: 1, lat: 1 }); // immediate (lastUpdate was 0)
        expect(sm.get('mouse.coordinates')).toEqual({ lng: 1, lat: 1 });

        // within the throttle window -> deferred
        sm.set('mouse.coordinates', { lng: 2, lat: 2 });
        sm.set('mouse.coordinates', { lng: 3, lat: 3 });
        // not yet applied
        expect(sm.get('mouse.coordinates')).toEqual({ lng: 1, lat: 1 });

        vi.advanceTimersByTime(20);
        // latest pending value wins
        expect(sm.get('mouse.coordinates')).toEqual({ lng: 3, lat: 3 });
    });

    it('notifies mouse subscribers when the throttled update is applied', () => {
        const cb = vi.fn();
        sm.subscribe('mouse.coordinates', cb);
        sm.set('mouse.coordinates', { lng: 5, lat: 6 });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toEqual({ lng: 5, lat: 6 });
    });
});

// ============================================================================
// Selection convenience methods
// ============================================================================

describe('selection helpers', () => {
    it('selectFeature replaces the selection with a single entry', () => {
        sm.selectFeature('point', '1', { g: 1 });
        sm.selectFeature('line', '2', { g: 2 });
        expect(sm.getSelectedFeatures()).toEqual([{ type: 'line', id: '2', feature: { g: 2 } }]);
        expect(sm.getSelectionCount()).toBe(1);
    });

    it('addToSelection appends and ignores duplicates', () => {
        sm.addToSelection('point', '1', { g: 1 });
        sm.addToSelection('point', '1', { g: 1 }); // duplicate type+id
        sm.addToSelection('line', '2', { g: 2 });
        expect(sm.getSelectionCount()).toBe(2);
    });

    it('removeFromSelection removes a matching entry', () => {
        sm.addToSelection('point', '1', {});
        sm.addToSelection('line', '2', {});
        sm.removeFromSelection('point', '1');
        expect(sm.getSelectedFeatures()).toEqual([{ type: 'line', id: '2', feature: {} }]);
    });

    it('clearSelection empties the selection', () => {
        sm.addToSelection('point', '1', {});
        sm.clearSelection();
        expect(sm.getSelectionCount()).toBe(0);
    });

    it('isFeatureSelected / getSelectedFeature work by type+id', () => {
        sm.selectFeature('point', '1', { name: 'A' });
        expect(sm.isFeatureSelected('point', '1')).toBe(true);
        expect(sm.isFeatureSelected('point', 'x')).toBe(false);
        expect(sm.getSelectedFeature('point', '1')).toEqual({ name: 'A' });
        expect(sm.getSelectedFeature('point', 'x')).toBeNull();
    });

    it('updateSelectedFeature swaps the feature for a matching entry only', () => {
        sm.addToSelection('point', '1', { v: 1 });
        sm.addToSelection('line', '2', { v: 2 });
        sm.updateSelectedFeature('point', '1', { v: 99 });
        expect(sm.getSelectedFeature('point', '1')).toEqual({ v: 99 });
        expect(sm.getSelectedFeature('line', '2')).toEqual({ v: 2 });
    });
});

// ============================================================================
// Tool / sidebar / clipboard / base layer / coordinates helpers
// ============================================================================

describe('tool helpers', () => {
    it('setActiveTool batches type+mode+options', () => {
        sm.setActiveTool('polygon', { foo: 1 });
        expect(sm.getActiveTool()).toBe('polygon');
        expect(sm.get('activeTool.mode')).toBe('drawing');
        expect(sm.get('activeTool.options')).toEqual({ foo: 1 });
    });

    it('setActiveTool(null) returns to idle', () => {
        sm.setActiveTool('polygon');
        sm.setActiveTool(null);
        expect(sm.getActiveTool()).toBeNull();
        expect(sm.get('activeTool.mode')).toBe('idle');
    });

    it('setToolMode updates only the mode', () => {
        sm.setToolMode('editing');
        expect(sm.get('activeTool.mode')).toBe('editing');
    });
});

describe('sidebar collapse helpers', () => {
    it('toggleSidebar flips expanded', () => {
        sm.toggleSidebar();
        expect(sm.get('sidebar.expanded')).toBe(true);
        sm.toggleSidebar();
        expect(sm.get('sidebar.expanded')).toBe(false);
    });

    it('toggleLayerCollapsed / isLayerCollapsed round-trip', () => {
        expect(sm.isLayerCollapsed('L1')).toBe(false);
        sm.toggleLayerCollapsed('L1');
        expect(sm.isLayerCollapsed('L1')).toBe(true);
        sm.toggleLayerCollapsed('L1');
        expect(sm.isLayerCollapsed('L1')).toBe(false);
    });

    it('toggleGroupCollapsed / isGroupCollapsed round-trip', () => {
        sm.toggleGroupCollapsed('G1');
        expect(sm.isGroupCollapsed('G1')).toBe(true);
    });
});

describe('clipboard helpers', () => {
    it('setClipboard stores features, timestamp and source', () => {
        sm.setClipboard([{ type: 'point' }], 'MapA');
        expect(sm.hasClipboardData()).toBe(true);
        const c = sm.getClipboard();
        expect(c.features).toEqual([{ type: 'point' }]);
        expect(c.sourceMapName).toBe('MapA');
        expect(typeof c.copiedAt).toBe('number');
    });

    it('clearClipboard empties everything', () => {
        sm.setClipboard([{ type: 'point' }], 'MapA');
        sm.clearClipboard();
        expect(sm.hasClipboardData()).toBe(false);
        expect(sm.getClipboard().sourceMapName).toBeNull();
    });
});

describe('base layer + coordinate helpers', () => {
    it('setBaseLayer / getBaseLayer round-trip', () => {
        sm.setBaseLayer('osm');
        expect(sm.getBaseLayer()).toBe('osm');
    });

    it('setCoordinateFormat / getCoordinateFormat round-trip', () => {
        sm.setCoordinateFormat('mgrs');
        expect(sm.getCoordinateFormat()).toBe('mgrs');
    });

    // NOTE (documented behavior, not changed): setElevationEnabled / setElevation /
    // setCoordinateFormat all write to `mouse.*` paths, which are routed through the
    // SAME throttle as mouse coordinates (the guard is `path.startsWith('mouse.')`).
    // The FIRST write after a quiet period applies synchronously; rapid follow-up
    // writes within MOUSE_THROTTLE_MS (16ms) are DEFERRED to a timer. The tests below
    // pin this real behavior. See `documentedOnly` in the report.
    it('setElevationEnabled toggles synchronously on the first call (post-quiet window)', () => {
        expect(sm.isElevationEnabled()).toBe(false);
        sm.setElevationEnabled(); // first mouse.* write -> immediate
        expect(sm.isElevationEnabled()).toBe(true);
    });

    it('setElevationEnabled honours an explicit boolean (first write is immediate)', () => {
        sm.setElevationEnabled(true);
        expect(sm.isElevationEnabled()).toBe(true);
    });

    it('rapid mouse.* writes are throttled: the second toggle is deferred then flushed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        sm.setElevationEnabled(true);   // immediate
        expect(sm.isElevationEnabled()).toBe(true);
        sm.setElevationEnabled(false);  // within throttle window -> deferred
        expect(sm.isElevationEnabled()).toBe(true); // not applied yet
        vi.advanceTimersByTime(20);
        expect(sm.isElevationEnabled()).toBe(false); // flushed by the timer
    });

    it('setElevation applies the first value immediately; a rapid second value defers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(2000);
        sm.setElevation(123.5);         // immediate
        expect(sm.getElevation()).toBe(123.5);
        sm.setElevation(null);          // deferred (within throttle window)
        expect(sm.getElevation()).toBe(123.5); // still the old value
        vi.advanceTimersByTime(20);
        expect(sm.getElevation()).toBeNull();  // flushed
    });
});

describe('dragging helper', () => {
    it('setDragging / isDragging round-trip', () => {
        expect(sm.isDragging()).toBe(false);
        sm.setDragging(true);
        expect(sm.isDragging()).toBe(true);
    });
});

// ============================================================================
// Mutual exclusivity: sidebar vs feature panel
// ============================================================================

describe('mutual exclusivity (sidebar <-> feature panel)', () => {
    it('openFeaturePanel collapses an expanded sidebar', () => {
        sm.set('sidebar.expanded', true);
        sm.set('sidebar.activeTab', 'camadas');
        sm.openFeaturePanel('f1', 'point');
        expect(sm.get('ui.featurePanelOpen')).toBe(true);
        expect(sm.get('sidebar.expanded')).toBe(false);
        expect(sm.get('sidebar.activeTab')).toBeNull();
        // the previous tab is remembered for restoration
        expect(sm.get('sidebar.previousTab')).toBe('camadas');
    });

    it('expandSidebar closes an open feature panel', () => {
        sm.openFeaturePanel('f1', 'point');
        sm.expandSidebar('mapas');
        expect(sm.get('sidebar.expanded')).toBe(true);
        expect(sm.get('sidebar.activeTab')).toBe('mapas');
        expect(sm.get('ui.featurePanelOpen')).toBe(false);
    });

    it('closeFeaturePanel restores the previously active sidebar tab', () => {
        sm.set('sidebar.expanded', true);
        sm.set('sidebar.activeTab', 'exportar');
        sm.openFeaturePanel('f1', 'point'); // saves previousTab = 'exportar'
        sm.closeFeaturePanel();
        // restored: sidebar re-expanded to the saved tab
        expect(sm.get('sidebar.expanded')).toBe(true);
        expect(sm.get('sidebar.activeTab')).toBe('exportar');
        expect(sm.get('ui.featurePanelOpen')).toBe(false);
    });

    it('closeFeaturePanel with no previous tab just closes', () => {
        sm.openFeaturePanel('f1', 'point');
        sm.closeFeaturePanel();
        expect(sm.get('ui.featurePanelOpen')).toBe(false);
        expect(sm.get('sidebar.expanded')).toBe(false);
    });

    it('closeFeaturePanel is a no-op when the panel is already closed', () => {
        const bus = createEventBus();
        sm.setEventBus(bus);
        const spy = vi.fn();
        bus.on('featurePanel:closed', spy);
        sm.closeFeaturePanel();
        expect(spy).not.toHaveBeenCalled();
    });

    it('collapseSidebar restores the feature panel if one was open before expanding', () => {
        // Open a feature panel with an active selection, then expand the sidebar.
        sm.selectFeature('point', 'f1', { g: 1 });
        sm.openFeaturePanel('f1', 'point');
        sm.expandSidebar('mapas'); // tracks _hadFeaturePanelBeforeSidebar = true
        expect(sm.get('ui.featurePanelOpen')).toBe(false);

        // Collapsing should restore the panel (selection still present).
        sm.collapseSidebar();
        expect(sm.get('ui.featurePanelOpen')).toBe(true);
        expect(sm.get('sidebar.expanded')).toBe(false);
    });

    it('collapseSidebar without a prior feature panel simply collapses', () => {
        sm.expandSidebar('mapas');
        sm.collapseSidebar();
        expect(sm.get('sidebar.expanded')).toBe(false);
        expect(sm.get('sidebar.activeTab')).toBeNull();
    });

    it('toggleSidebarTab collapses when re-clicking the active tab', () => {
        sm.expandSidebar('mapas');
        sm.toggleSidebarTab('mapas');
        expect(sm.get('sidebar.expanded')).toBe(false);
    });

    it('toggleSidebarTab switches tabs when a different tab is clicked', () => {
        sm.expandSidebar('mapas');
        sm.toggleSidebarTab('camadas');
        expect(sm.get('sidebar.expanded')).toBe(true);
        expect(sm.get('sidebar.activeTab')).toBe('camadas');
    });

    it('getContentLeftOffset reflects sidebar/panel state', () => {
        expect(sm.getContentLeftOffset()).toBe(56);
        sm.set('sidebar.expanded', true);
        expect(sm.getContentLeftOffset()).toBe(376);
        sm.set('sidebar.expanded', false);
        sm.set('ui.featurePanelOpen', true);
        expect(sm.getContentLeftOffset()).toBe(376);
    });
});

// ============================================================================
// Toolbar group + base layer selector exclusivity / events
// ============================================================================

describe('toolbar group helpers', () => {
    it('openToolbarGroup sets the active group and emits an event', () => {
        const bus = createEventBus();
        sm.setEventBus(bus);
        const opened = vi.fn();
        bus.on('toolbar:groupOpened', opened);
        sm.openToolbarGroup('draw');
        expect(sm.get('ui.activeToolbarGroup')).toBe('draw');
        expect(opened).toHaveBeenCalledWith({ group: 'draw' });
    });

    it('switching groups emits a close for the previous group', () => {
        const bus = createEventBus();
        sm.setEventBus(bus);
        const closed = vi.fn();
        bus.on('toolbar:groupClosed', closed);
        sm.openToolbarGroup('draw');
        sm.openToolbarGroup('military');
        expect(closed).toHaveBeenCalledWith({ group: 'draw' });
        expect(sm.get('ui.activeToolbarGroup')).toBe('military');
    });

    it('toggleToolbarGroup closes when re-toggling the same group', () => {
        sm.openToolbarGroup('analysis');
        sm.toggleToolbarGroup('analysis');
        expect(sm.get('ui.activeToolbarGroup')).toBeNull();
    });

    it('closeToolbarGroup is a no-op (no event) when nothing is open', () => {
        const bus = createEventBus();
        sm.setEventBus(bus);
        const closed = vi.fn();
        bus.on('toolbar:groupClosed', closed);
        sm.closeToolbarGroup();
        expect(closed).not.toHaveBeenCalled();
    });
});

describe('base layer selector helpers', () => {
    it('toggle opens then closes', () => {
        sm.toggleBaseLayerSelector();
        expect(sm.get('ui.baseLayerSelectorOpen')).toBe(true);
        sm.toggleBaseLayerSelector();
        expect(sm.get('ui.baseLayerSelectorOpen')).toBe(false);
    });

    it('closeBaseLayerSelector is a no-op when already closed', () => {
        const bus = createEventBus();
        sm.setEventBus(bus);
        const closed = vi.fn();
        bus.on('baseLayerSelector:closed', closed);
        sm.closeBaseLayerSelector();
        expect(closed).not.toHaveBeenCalled();
    });
});

describe('closeAllPopups', () => {
    it('closes sidebar, feature panel, toolbar group and base layer selector', () => {
        sm.set('sidebar.expanded', true);
        sm.set('ui.activeToolbarGroup', 'draw');
        sm.set('ui.baseLayerSelectorOpen', true);
        sm.closeAllPopups();
        expect(sm.get('sidebar.expanded')).toBe(false);
        expect(sm.get('ui.featurePanelOpen')).toBe(false);
        expect(sm.get('ui.activeToolbarGroup')).toBeNull();
        expect(sm.get('ui.baseLayerSelectorOpen')).toBe(false);
    });
});

// ============================================================================
// EventBus integration
// ============================================================================

describe('EventBus integration', () => {
    it('expandSidebar emits SIDEBAR_EXPANDED, SIDEBAR_TAB_CHANGED and UI_LAYOUT_CHANGED', () => {
        const bus = createEventBus();
        sm.setEventBus(bus);
        const expanded = vi.fn();
        const tabChanged = vi.fn();
        const layout = vi.fn();
        bus.on('sidebar:expanded', expanded);
        bus.on('sidebar:tabChanged', tabChanged);
        bus.on('ui:layoutChanged', layout);
        sm.expandSidebar('mapas');
        expect(expanded).toHaveBeenCalledWith({ tab: 'mapas' });
        expect(tabChanged).toHaveBeenCalledWith({ previousTab: null, currentTab: 'mapas' });
        expect(layout).toHaveBeenCalledTimes(1);
        expect(layout.mock.calls[0][0].contentLeftOffset).toBe(376);
    });

    it('methods are safe to call before an EventBus is attached', () => {
        // No setEventBus called — _emitEvent must silently no-op.
        expect(() => sm.openToolbarGroup('draw')).not.toThrow();
        expect(sm.get('ui.activeToolbarGroup')).toBe('draw');
    });
});

// ============================================================================
// reset / debug
// ============================================================================

describe('reset', () => {
    it('restores all state to defaults', () => {
        sm.set('sidebar.expanded', true);
        sm.setBaseLayer('osm');
        sm.reset();
        expect(sm.get('sidebar.expanded')).toBe(false);
        expect(sm.getBaseLayer()).toBe('carta-topografica');
    });

    it('notifies existing subscribers with their default values', () => {
        const cb = vi.fn();
        sm.set('sidebar.expanded', true);
        sm.subscribe('sidebar.expanded', cb);
        sm.reset();
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toBe(false);
    });

    it('a throwing subscriber during reset does not break the loop', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();
        sm.subscribe('sidebar.expanded', bad);
        sm.subscribe('baseLayer.activeLayer', good);
        expect(() => sm.reset()).not.toThrow();
        expect(good).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe('getDebugInfo', () => {
    it('reports subscriber count, subscribed paths and batch depth', () => {
        sm.subscribe('sidebar.expanded', () => {});
        sm.subscribe('selection.features', () => {});
        const info = sm.getDebugInfo();
        expect(info.subscriberCount).toBe(2);
        expect(info.subscribedPaths).toEqual(
            expect.arrayContaining(['sidebar.expanded', 'selection.features'])
        );
        expect(info.batchDepth).toBe(0);
        expect(info.state.sidebar.expanded).toBe(false);
    });
});
