// Path: tests/unit/new-map-basemap.test.js
import { afterEach, describe, expect, it } from 'vitest';
import config from '../../src/js/config.js';
import { initConfigHelpers } from '../../src/js/config.helpers.js';
import { mintMapDocument } from '../../src/js/store/repositories/index.js';

const original = config.basemaps;
initConfigHelpers();
afterEach(() => { config.basemaps = original; });

describe('new map chooses from the current accessible catalog', () => {
    it('replaces the unavailable historical default before persistence', () => {
        config.basemaps = { osm: { enabled: true, priority: 2 }, imagery: { enabled: true, priority: 3 } };
        expect(mintMapDocument('Novo mapa').document.baseLayer).toBe('osm');
    });

    it('rechecks the catalog for every map instead of caching a previous account choice', () => {
        config.basemaps = { 'carta-topografica': { enabled: true, priority: 1 } };
        expect(mintMapDocument('Primeiro').document.baseLayer).toBe('carta-topografica');
        config.basemaps = { osm: { enabled: true, priority: 2 } };
        expect(mintMapDocument('Segundo').document.baseLayer).toBe('osm');
    });

    it('skips disabled defaults and chooses by priority', () => {
        config.basemaps = {
            'carta-topografica': { enabled: false, priority: 0 },
            imagery: { enabled: true, priority: 20 },
            osm: { enabled: true, priority: 2 },
        };
        expect(mintMapDocument('Novo mapa').document.baseLayer).toBe('osm');
    });

    it('does not invent access when no basemap is available', () => {
        config.basemaps = {};
        expect(mintMapDocument('Sem acervo').document.baseLayer).toBe('');
    });

    it('preserves explicit imported data rather than migrating it as a side effect', () => {
        config.basemaps = { osm: { enabled: true } };
        const data = { name: 'Importado', baseLayer: 'custom-original', features: { points: [{ id: 'p1' }] } };
        expect(mintMapDocument('Importado', data).document).toMatchObject(data);
        expect(data.baseLayer).toBe('custom-original');
    });
});
