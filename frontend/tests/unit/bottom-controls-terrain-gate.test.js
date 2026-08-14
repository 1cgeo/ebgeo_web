// Path: tests/unit/bottom-controls-terrain-gate.test.js
/**
 * @fileoverview The terrain toggle of the bottom bar is gated by TWO independent conditions and
 * they are not interchangeable:
 *   - `features.terrain_3d` is the per-atlas RESTRICTION overlay (a Gestor forbidding terrain);
 *   - `map2d.terrainSource` is the DEPLOYMENT capability (`GET /api/config` omits the raster-dem
 *     source when no terrain URL is configured).
 * Collapsing the AND into either half is a real regression in both directions: keeping only the
 * capability check reopens the tool in an atlas that forbids it, keeping only the atlas check
 * renders a toggle that can never do anything. Both directions are pinned below.
 */

import { describe, it, expect } from 'vitest';
import { isTerrainToggleEnabled } from '../../src/js/bottom-controls/bottom-controls.control.js';

const SOURCE = Object.freeze({ type: 'raster-dem', tiles: ['/t/{z}/{x}/{y}'] });

describe('isTerrainToggleEnabled (pure gate)', () => {
    it('renders when the deployment has a terrain source and the atlas says nothing', () => {
        expect(isTerrainToggleEnabled({ features: {}, map2d: { terrainSource: SOURCE } })).toBe(true);
    });

    it('renders when the atlas explicitly allows terrain', () => {
        expect(
            isTerrainToggleEnabled({ features: { terrain_3d: true }, map2d: { terrainSource: SOURCE } })
        ).toBe(true);
    });

    it('does NOT render when the deployment has no terrain source', () => {
        expect(isTerrainToggleEnabled({ features: {}, map2d: {} })).toBe(false);
        expect(isTerrainToggleEnabled({ features: {}, map2d: { terrainSource: undefined } })).toBe(false);
        expect(isTerrainToggleEnabled({ features: {}, map2d: { terrainSource: null } })).toBe(false);
    });

    it('does NOT render when the atlas forbids terrain, even with a terrain source configured', () => {
        // Negative control for the trap: replacing the atlas gate by the capability gate would
        // return true here and silently reopen a tool the atlas restricts.
        expect(
            isTerrainToggleEnabled({ features: { terrain_3d: false }, map2d: { terrainSource: SOURCE } })
        ).toBe(false);
    });

    it('does NOT render when both gates are closed', () => {
        expect(isTerrainToggleEnabled({ features: { terrain_3d: false }, map2d: {} })).toBe(false);
    });

    it('survives a config with the branches missing entirely', () => {
        expect(isTerrainToggleEnabled({})).toBe(false);
        expect(isTerrainToggleEnabled(null)).toBe(false);
        expect(isTerrainToggleEnabled(undefined)).toBe(false);
    });

    it('treats a falsy-but-present source as present (only null/undefined close the gate)', () => {
        // `!= null` is deliberate: an empty object is still a (broken) configured source, and the
        // availability check downstream is what disables the button in that case.
        expect(isTerrainToggleEnabled({ features: {}, map2d: { terrainSource: {} } })).toBe(true);
    });
});
