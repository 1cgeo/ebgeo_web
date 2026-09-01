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
        expect(resolveDragMode({ button: undefined, ctrlKey: true })).toBe(DRAG_MODE.NONE);
        expect(resolveDragMode({ button: '0', ctrlKey: true })).toBe(DRAG_MODE.NONE);
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
        for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x']) {
            const both = computeCameraDelta(DRAG_MODE.BOTH, bad, bad);
            expect(Number.isFinite(both.bearingDelta)).toBe(true);
            expect(Number.isFinite(both.pitchDelta)).toBe(true);
            expect(both).toEqual({ bearingDelta: 0, pitchDelta: 0 });
        }
        const mixed = computeCameraDelta(DRAG_MODE.BOTH, NaN, 10);
        expect(mixed.bearingDelta).toBe(0);
        expect(mixed.pitchDelta).toBeCloseTo(-3, 10);
    });

    it('keeps -0 out of the output', () => {
        const { bearingDelta, pitchDelta } = computeCameraDelta(DRAG_MODE.BOTH, 0, 0);
        expect(Object.is(bearingDelta, -0)).toBe(false);
        expect(Object.is(pitchDelta, -0)).toBe(false);
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

    it('collapses a non-finite value to the minimum', () => {
        expect(clampPitch(NaN, 0, 65)).toBe(0);
        expect(clampPitch(undefined, 10, 65)).toBe(10);
        // Both infinities collapse to the minimum: the contract is
        // "non-finite means we have no idea", not "saturate towards the sign".
        expect(clampPitch(Infinity, 0, 65)).toBe(0);
        expect(clampPitch(-Infinity, 0, 65)).toBe(0);
    });

    it('falls back when the bounds themselves are broken', () => {
        expect(clampPitch(30, NaN, 65)).toBe(30);
        expect(clampPitch(30, 0, NaN)).toBe(0);
        expect(clampPitch(30, undefined, undefined)).toBe(0);
    });
});

// ============================================================================
// exceedsDragThreshold
// ============================================================================

describe('exceedsDragThreshold', () => {
    it('rejects movement shorter than the threshold', () => {
        expect(exceedsDragThreshold(0, 0)).toBe(false);
        expect(exceedsDragThreshold(2, 2)).toBe(false); // hypot 2.83
        expect(exceedsDragThreshold(2.9, 0)).toBe(false);
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
