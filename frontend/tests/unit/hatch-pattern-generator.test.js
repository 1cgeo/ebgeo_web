import { describe, it, expect, vi, beforeEach } from 'vitest';

// The generator draws on a canvas and reads it back; a fake document is enough
// to count how many times that read-back happens.
const readbacks = { n: 0 };
globalThis.document = {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
            strokeStyle: '', lineWidth: 0, fillStyle: '', lineCap: '', lineJoin: '',
            beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, fillRect() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, setLineDash() {},
            getImageData: (x, y, w, h) => { readbacks.n++; return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
        }),
    }),
};

const { HatchPatternGenerator, getHatchPatternGenerator } = await import('../../src/js/tool_manager/hatch_pattern_generator.js');

function fakeMap() {
    const images = new Map();
    return {
        images,
        hasImage: (id) => images.has(id),
        addImage: vi.fn((id, data) => { images.set(id, data); }),
        updateImage: vi.fn((id, data) => { images.set(id, data); }),
    };
}
// `diagonal-right` is a type the generator actually draws (see the switch in
// createPatternImageData), and it is the default `getConfigFromProperties` falls
// back to, so the fixture exercises a real branch instead of a name that draws nothing.
const hatched = (i, extra = {}) => ({
    type: 'Feature',
    properties: { id: 'f' + i, hatchEnabled: true, hatchType: 'diagonal-right', hatchSpacing: 8, hatchLineWidth: 1, hatchColor: '#123456', ...extra },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

describe('HatchPatternGenerator', () => {
    beforeEach(() => { readbacks.n = 0; });

    it('is shared across callers, so the cache survives a style rebuild', () => {
        expect(getHatchPatternGenerator()).toBe(getHatchPatternGenerator());
    });

    it('draws a pattern once per session, not once per setup pass', () => {
        const gen = new HatchPatternGenerator();
        const map = fakeMap();
        gen.loadPatternsToMap(map, [hatched(1), hatched(2)]);
        expect(readbacks.n).toBe(1);
        expect(map.addImage).toHaveBeenCalledTimes(1);

        // A second pass (base-map switch) with the same features: no new draw,
        // and no re-upload of an image the map already holds.
        gen.loadPatternsToMap(map, [hatched(1), hatched(2)]);
        expect(readbacks.n).toBe(1);
        expect(map.addImage).toHaveBeenCalledTimes(1);
        expect(map.updateImage).not.toHaveBeenCalled();
    });

    it('re-adds the image when a new style dropped it, without redrawing', () => {
        const gen = new HatchPatternGenerator();
        const a = fakeMap();
        gen.loadPatternsToMap(a, [hatched(1)]);
        const b = fakeMap();
        gen.loadPatternsToMap(b, [hatched(1)]);
        expect(readbacks.n).toBe(1);
        expect(b.addImage).toHaveBeenCalledTimes(1);
    });

    it('keys the cache on every field that changes the drawing', () => {
        const gen = new HatchPatternGenerator();
        const base = gen.getConfigFromProperties(hatched(1).properties);
        const ids = new Set([
            gen.getCacheKey(base),
            gen.getCacheKey({ ...base, type: 'horizontal' }),
            gen.getCacheKey({ ...base, spacing: base.spacing + 1 }),
            gen.getCacheKey({ ...base, lineWidth: base.lineWidth + 1 }),
            gen.getCacheKey({ ...base, color: '#654321' }),
        ]);
        expect(ids.size).toBe(5);
    });
});
