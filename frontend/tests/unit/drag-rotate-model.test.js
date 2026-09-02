// Path: tests/unit/drag-rotate-model.test.js

/**
 * @fileoverview Pins `map/drag-rotate.model.js`, the pure half of the mouse camera
 * gesture: which axis a modifier drives, how many degrees a pixel is worth, and
 * when a drag stops being a click.
 *
 * WHY THE MODEL IS A SEPARATE FILE: until 2026-09-01 the same decisions lived
 * inline in the DOM handler, where node cannot reach them, so "Ctrl also rotated"
 * was only observable by dragging a real map. The three properties this suite
 * exists for, and that a hand test does NOT reliably catch:
 *
 *   1. AXIS LOCKING. Ctrl must move pitch and NOTHING else. A mouse drag always
 *      carries both components (nobody drags a perfectly vertical line), so an
 *      unlocked axis reads as "the map drifts a bit while I tilt" and gets blamed
 *      on the trackpad.
 *   2. NO NaN REACHES THE CAMERA. `setBearing(NaN)` does not throw: MapLibre
 *      renders a blank canvas and the person reloads the page. Every entry point
 *      is therefore exercised with NaN/Infinity/undefined.
 *   3. THE PITCH RANGE IS AN ARGUMENT. `maxPitch` comes from the server
 *      (`config.map2d.maxPitch`, 65 today, up to 85 by schema), so a constant
 *      ceiling here would cap a deployment that allows more, silently.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    DRAG_MODE,
    DRAG_THRESHOLD_PX,
    MOUSE_BEARING_SENSITIVITY,
    MOUSE_PITCH_SENSITIVITY,
    clampPitch,
    computeCameraDelta,
    exceedsDragThreshold,
    resolveDragMode,
} from '../../src/js/map/drag-rotate.model.js';

// ============================================================================
// resolveDragMode
// ============================================================================

describe('resolveDragMode', () => {
    it('maps the full modifier matrix on the left button', () => {
        expect(resolveDragMode({ button: 0 })).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode({ button: 0, ctrlKey: true })).toBe(DRAG_MODE.PITCH);
        expect(resolveDragMode({ button: 0, shiftKey: true })).toBe(DRAG_MODE.BEARING);
        expect(resolveDragMode({ button: 0, ctrlKey: true, shiftKey: true })).toBe(DRAG_MODE.BOTH);
    });

    it('treats metaKey as an alias of ctrlKey (macOS)', () => {
        // On macOS Ctrl+click IS the secondary click, so Cmd is the modifier a
        // person there actually has available.
        expect(resolveDragMode({ button: 0, metaKey: true })).toBe(DRAG_MODE.PITCH);
        expect(resolveDragMode({ button: 0, metaKey: true, shiftKey: true })).toBe(DRAG_MODE.BOTH);
        expect(resolveDragMode({ button: 0, metaKey: true, ctrlKey: true })).toBe(DRAG_MODE.PITCH);
    });

    it('never engages on the right button — it is reserved for the context menu', () => {
        expect(resolveDragMode({ button: 2, ctrlKey: true })).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode({ button: 2, shiftKey: true })).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode({ button: 2, ctrlKey: true, shiftKey: true })).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode({ button: 1, ctrlKey: true })).toBe(DRAG_MODE.NONE);
    });

    it('handles a missing/empty/null event', () => {
        expect(resolveDragMode()).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode({})).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode(null)).toBe(DRAG_MODE.NONE);
    });

    it('requires the button to be exactly 0, not merely falsy', () => {
        // A synthetic event built without `button` must not be read as "left".
        expect(resolveDragMode({ button: undefined, ctrlKey: true })).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode({ button: '0', ctrlKey: true })).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode({ button: null, ctrlKey: true })).toBe(DRAG_MODE.NONE);
    });
});

// ============================================================================
// computeCameraDelta
// ============================================================================

describe('computeCameraDelta', () => {
    it('locks the horizontal axis in PITCH mode', () => {
        const { bearingDelta, pitchDelta } = computeCameraDelta(DRAG_MODE.PITCH, 100, 10);
        expect(bearingDelta).toBe(0);
        expect(pitchDelta).toBeCloseTo(-10 * MOUSE_PITCH_SENSITIVITY, 10);
    });

    it('locks the vertical axis in BEARING mode', () => {
        const { bearingDelta, pitchDelta } = computeCameraDelta(DRAG_MODE.BEARING, 10, 100);
        expect(pitchDelta).toBe(0);
        expect(bearingDelta).toBeCloseTo(-10 * MOUSE_BEARING_SENSITIVITY, 10);
    });

    it('drives both axes in BOTH mode', () => {
        const { bearingDelta, pitchDelta } = computeCameraDelta(DRAG_MODE.BOTH, 20, 30);
        expect(bearingDelta).toBeCloseTo(-10, 10);
        expect(pitchDelta).toBeCloseTo(-9, 10);
    });

    it('returns zeros for NONE and for an unknown mode', () => {
        expect(computeCameraDelta(DRAG_MODE.NONE, 50, 50)).toEqual({ bearingDelta: 0, pitchDelta: 0 });
        expect(computeCameraDelta('nonsense', 50, 50)).toEqual({ bearingDelta: 0, pitchDelta: 0 });
        expect(computeCameraDelta(undefined, 50, 50)).toEqual({ bearingDelta: 0, pitchDelta: 0 });
    });

    it('moving right decreases bearing and moving down decreases pitch', () => {
        expect(computeCameraDelta(DRAG_MODE.BEARING, 10, 0).bearingDelta).toBeLessThan(0);
        expect(computeCameraDelta(DRAG_MODE.BEARING, -10, 0).bearingDelta).toBeGreaterThan(0);
        expect(computeCameraDelta(DRAG_MODE.PITCH, 0, 10).pitchDelta).toBeLessThan(0);
        expect(computeCameraDelta(DRAG_MODE.PITCH, 0, -10).pitchDelta).toBeGreaterThan(0);
    });

    it('never produces NaN from NaN/Infinity/undefined input', () => {
        // `setBearing(NaN)` does not throw; it blanks the canvas.
        for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x']) {
            const both = computeCameraDelta(DRAG_MODE.BOTH, bad, bad);
            expect(Number.isFinite(both.bearingDelta)).toBe(true);
            expect(Number.isFinite(both.pitchDelta)).toBe(true);
            expect(both).toEqual({ bearingDelta: 0, pitchDelta: 0 });
        }
        // Poison on ONE axis must not take the other down with it.
        const mixed = computeCameraDelta(DRAG_MODE.BOTH, NaN, 10);
        expect(mixed.bearingDelta).toBe(0);
        expect(mixed.pitchDelta).toBeCloseTo(-3, 10);
    });

    it('keeps -0 out of the output', () => {
        // `-0 * 0.5` is `-0`, and `-0` survives `toBe(0)` while failing `Object.is`.
        // Callers compare `bearingDelta !== 0` before touching the camera, so a -0
        // would issue a no-op setBearing on every idle mousemove.
        const { bearingDelta, pitchDelta } = computeCameraDelta(DRAG_MODE.BOTH, 0, 0);
        expect(Object.is(bearingDelta, -0)).toBe(false);
        expect(Object.is(pitchDelta, -0)).toBe(false);
        expect(Object.is(bearingDelta, 0)).toBe(true);
        expect(Object.is(pitchDelta, 0)).toBe(true);

        const locked = computeCameraDelta(DRAG_MODE.PITCH, 10, 0);
        expect(Object.is(locked.pitchDelta, -0)).toBe(false);
    });
});

// ============================================================================
// clampPitch
// ============================================================================

describe('clampPitch', () => {
    it('clamps to the map range', () => {
        expect(clampPitch(30, 0, 65)).toBe(30);
        expect(clampPitch(-5, 0, 65)).toBe(0);
        expect(clampPitch(120, 0, 65)).toBe(65);
        expect(clampPitch(0, 0, 65)).toBe(0);
        expect(clampPitch(65, 0, 65)).toBe(65);
    });

    it('honours a range the SERVER widened, instead of a constant ceiling', () => {
        // `config.admin.schemas.js` allows maxPitch up to 85. The handler reads
        // `map.getMaxPitch()`, so 80 must survive when the deployment allows it.
        expect(clampPitch(80, 0, 85)).toBe(80);
        expect(clampPitch(80, 0, 65)).toBe(65);
    });

    it('collapses a non-finite value to the minimum', () => {
        expect(clampPitch(NaN, 0, 65)).toBe(0);
        expect(clampPitch(undefined, 10, 65)).toBe(10);
        // Both infinities collapse to the minimum: the contract is
        // "non-finite means we have no idea", not "saturate towards the sign".
        expect(clampPitch(Infinity, 0, 65)).toBe(0);
        expect(clampPitch(-Infinity, 0, 65)).toBe(0);
    });

    it('falls back when the bounds themselves are broken, and never returns NaN', () => {
        // A map torn down mid-gesture answers `undefined` to getMinPitch/getMaxPitch.
        expect(clampPitch(30, NaN, 65)).toBe(30);
        expect(clampPitch(30, 0, NaN)).toBe(0);
        expect(clampPitch(30, undefined, undefined)).toBe(0);
        for (const [min, max] of [[NaN, NaN], [undefined, 65], [0, Infinity], [null, null]]) {
            expect(Number.isFinite(clampPitch(30, min, max))).toBe(true);
        }
    });

    it('an INVERTED range answers the minimum, not NaN and not the value', () => {
        // Math.max wins the tie-break, so a swapped pair degrades to "flat" rather
        // than to an arbitrary pitch.
        expect(clampPitch(30, 60, 10)).toBe(60);
        expect(clampPitch(5, 60, 10)).toBe(60);
    });
});

// ============================================================================
// exceedsDragThreshold
// ============================================================================

describe('exceedsDragThreshold', () => {
    it('rejects movement shorter than the threshold', () => {
        // This is what keeps Shift+click multi-selection alive: a click with a
        // 2 px hand tremor must NOT be read as a rotation.
        expect(exceedsDragThreshold(0, 0)).toBe(false);
        expect(exceedsDragThreshold(2, 2)).toBe(false); // hypot 2.83
        expect(exceedsDragThreshold(2.9, 0)).toBe(false);
        expect(exceedsDragThreshold(-2, 2)).toBe(false);
    });

    it('accepts movement at or past the threshold', () => {
        expect(exceedsDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(true);
        expect(exceedsDragThreshold(0, -DRAG_THRESHOLD_PX)).toBe(true);
        expect(exceedsDragThreshold(3, 4)).toBe(true);
    });

    it('is false for non-finite input rather than throwing', () => {
        expect(exceedsDragThreshold(NaN, 0)).toBe(false);
        expect(exceedsDragThreshold(0, Infinity)).toBe(false);
        expect(exceedsDragThreshold(undefined, undefined)).toBe(false);
    });
});

// ============================================================================
// Invariants
// ============================================================================

describe('drag-rotate model invariants', () => {
    it('clampPitch always lands inside the range and is idempotent', () => {
        fc.assert(fc.property(
            fc.double({ noNaN: true, min: -1e6, max: 1e6 }),
            (value) => {
                const once = clampPitch(value, 0, 65);
                expect(once).toBeGreaterThanOrEqual(0);
                expect(once).toBeLessThanOrEqual(65);
                expect(clampPitch(once, 0, 65)).toBe(once);
            }
        ));
    });

    it('each mode drives exactly the axes it names', () => {
        fc.assert(fc.property(
            fc.double({ noNaN: true, min: -1000, max: 1000 }),
            fc.double({ noNaN: true, min: -1000, max: 1000 }),
            (dx, dy) => {
                expect(computeCameraDelta(DRAG_MODE.PITCH, dx, dy).bearingDelta).toBe(0);
                expect(computeCameraDelta(DRAG_MODE.BEARING, dx, dy).pitchDelta).toBe(0);
                const both = computeCameraDelta(DRAG_MODE.BOTH, dx, dy);
                expect(both.bearingDelta).toBeCloseTo(-dx * MOUSE_BEARING_SENSITIVITY, 6);
                expect(both.pitchDelta).toBeCloseTo(-dy * MOUSE_PITCH_SENSITIVITY, 6);
            }
        ));
    });

    it('reversing the drag reverses the camera delta', () => {
        fc.assert(fc.property(
            fc.double({ noNaN: true, min: -1000, max: 1000 }),
            fc.double({ noNaN: true, min: -1000, max: 1000 }),
            (dx, dy) => {
                const forward = computeCameraDelta(DRAG_MODE.BOTH, dx, dy);
                const backward = computeCameraDelta(DRAG_MODE.BOTH, -dx, -dy);
                expect(forward.bearingDelta + backward.bearingDelta).toBeCloseTo(0, 6);
                expect(forward.pitchDelta + backward.pitchDelta).toBeCloseTo(0, 6);
            }
        ));
    });

    it('the drag threshold agrees with the euclidean distance', () => {
        fc.assert(fc.property(
            fc.double({ noNaN: true, min: -50, max: 50 }),
            fc.double({ noNaN: true, min: -50, max: 50 }),
            (dx, dy) => {
                expect(exceedsDragThreshold(dx, dy)).toBe(Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX);
            }
        ));
    });
});
