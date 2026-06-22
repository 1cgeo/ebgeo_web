import { describe, it, expect, beforeEach } from 'vitest';
import {
    intersectAvailability,
    applyAtlasSettings,
    revertAtlasSettings,
    _resetAtlasSettingsBaseline,
} from '../../src/js/store/sync/atlas-settings.service.js';
import config from '../../src/js/config.js';

// The per-atlas config overlay must be a strict INTERSECTION (deploy ∩ atlas): it can only
// RESTRICT availability, never ENABLE what the deployment disabled (P1/P12). These tests pin
// the pure intersection logic and the apply→revert round-trip on the config singleton.

const DEPLOY = Object.freeze({
    map_3d: true,
    imagens_panoramicas: true,
    terrain_3d: true,
    basemaps: { a: true, b: true, c: false }, // 'c' disabled at deploy level
});

describe('intersectAvailability (pure)', () => {
    it('keeps everything when the atlas allows everything', () => {
        const out = intersectAvailability(DEPLOY, { features: { map_3d: true, panoramic_images: true }, basemaps: [] });
        expect(out.map_3d).toBe(true);
        expect(out.imagens_panoramicas).toBe(true);
        expect(out.basemaps).toEqual({ a: true, b: true, c: false });
    });

    it('RESTRICTS 3D / 360 when the atlas turns them off', () => {
        const out = intersectAvailability(DEPLOY, { features: { map_3d: false, panoramic_images: false } });
        expect(out.map_3d).toBe(false);
        expect(out.imagens_panoramicas).toBe(false);
    });

    it('NEVER enables what the deploy disabled (intersection, not union)', () => {
        const baseline = { map_3d: false, imagens_panoramicas: false, basemaps: { a: false } };
        const out = intersectAvailability(baseline, { features: { map_3d: true, panoramic_images: true }, basemaps: ['a'] });
        expect(out.map_3d).toBe(false);
        expect(out.imagens_panoramicas).toBe(false);
        expect(out.basemaps.a).toBe(false); // deploy-disabled basemap stays off even if allowlisted
    });

    it('restricts basemaps to the allowlist (within the deploy-enabled set)', () => {
        const out = intersectAvailability(DEPLOY, { basemaps: ['a', 'c'] });
        expect(out.basemaps).toEqual({ a: true, b: false, c: false }); // b dropped (not listed), c stays off (deploy)
    });

    it('an empty allowlist does NOT restrict basemaps (keeps the deploy set)', () => {
        const out = intersectAvailability(DEPLOY, { basemaps: [] });
        expect(out.basemaps).toEqual({ a: true, b: true, c: false });
    });

    it('treats absent settings as "no restriction"', () => {
        expect(intersectAvailability(DEPLOY, undefined)).toEqual({
            map_3d: true, imagens_panoramicas: true, terrain_3d: true, basemaps: { a: true, b: true, c: false },
        });
    });
});

describe('applyAtlasSettings / revertAtlasSettings (config singleton round-trip)', () => {
    beforeEach(() => {
        _resetAtlasSettingsBaseline();
        // Establish a known deploy baseline on the shared singleton for this file.
        if (!config.features) config.features = {};
        config.features.map_3d = true;
        config.features.imagens_panoramicas = true;
    });

    it('apply restricts the live config; revert restores the deploy baseline', () => {
        applyAtlasSettings({ features: { map_3d: false, panoramic_images: false } });
        expect(config.features.map_3d).toBe(false);
        expect(config.features.imagens_panoramicas).toBe(false);

        revertAtlasSettings();
        expect(config.features.map_3d).toBe(true);
        expect(config.features.imagens_panoramicas).toBe(true);
    });

    it('apply is idempotent — re-applying recomputes from the baseline (never compounds)', () => {
        applyAtlasSettings({ features: { map_3d: false } });
        // A second apply that re-allows 3D must restore it from the baseline (deploy had it on).
        applyAtlasSettings({ features: { map_3d: true } });
        expect(config.features.map_3d).toBe(true);
        revertAtlasSettings();
    });
});
