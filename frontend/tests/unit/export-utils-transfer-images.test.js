// Path: tests/unit/export-utils-transfer-images.test.js

/**
 * `transferMapImages` copies the runtime images of the visible map into the hidden
 * map every export renders into (PDF page, PDF mosaic tile, Garmin KMZ).
 *
 * The bug this pins is invisible in code review and silent at runtime: a MapLibre
 * image carries a `pixelRatio`, and a coordination measure is registered at ratio 4
 * so it stays sharp when the layer's `icon-size` grows with zoom. `addImage` without
 * that option defaults to 1, so the hidden map reads those 4x pixels as logical ones
 * and draws the symbol FOUR TIMES too large. No error, no warning — just a wrong
 * export, on a map the user never sees.
 *
 * The map doubles below are the two methods the function actually uses.
 */

import { describe, it, expect } from 'vitest';
import { transferMapImages } from '@js/import_export/export-utils.js';

/**
 * Minimal stand-in for a MapLibre map's image registry.
 * @param {Object<string, Object>} images - Images keyed by id
 * @returns {Object} Map double, with the calls it received on `added`
 */
function mapDouble(images = {}) {
    return {
        added: [],
        listImages: () => Object.keys(images),
        getImage: (id) => images[id],
        hasImage: (id) => Object.prototype.hasOwnProperty.call(images, id),
        addImage(id, data, options) {
            images[id] = data;
            this.added.push({ id, data, options });
        },
    };
}

describe('transferMapImages', () => {
    it('carries the pixelRatio of a high-resolution symbol across', () => {
        const source = mapDouble({
            medida: { data: 'px', sdf: false, pixelRatio: 4 },
        });
        const target = mapDouble();

        transferMapImages(source, target);

        expect(target.added).toHaveLength(1);
        expect(target.added[0].options).toEqual({ sdf: false, pixelRatio: 4 });
    });

    it('leaves the key out for an image that has no ratio, so MapLibre defaults to 1', () => {
        const source = mapDouble({ simbolo: { data: 'px', sdf: false } });
        const target = mapDouble();

        transferMapImages(source, target);

        expect(target.added[0].options).toEqual({ sdf: false });
        expect('pixelRatio' in target.added[0].options).toBe(false);
    });

    it('keeps carrying the sdf flag', () => {
        const source = mapDouble({ icone: { data: 'px', sdf: true, pixelRatio: 2 } });
        const target = mapDouble();

        transferMapImages(source, target);

        expect(target.added[0].options).toEqual({ sdf: true, pixelRatio: 2 });
    });

    it('WORST CASE: a corrupt ratio is dropped instead of poisoning addImage', () => {
        // `image.pixelRatio ?? 1` would NOT catch NaN, and MapLibre divides by it.
        const source = mapDouble({
            a: { data: 'px', pixelRatio: NaN },
            b: { data: 'px', pixelRatio: 0 },
            c: { data: 'px', pixelRatio: -2 },
            d: { data: 'px', pixelRatio: Infinity },
            e: { data: 'px', pixelRatio: '4' },
        });
        const target = mapDouble();

        transferMapImages(source, target);

        expect(target.added).toHaveLength(5);
        for (const call of target.added) {
            expect('pixelRatio' in call.options, call.id).toBe(false);
        }
    });

    it('skips an image the target already has', () => {
        const source = mapDouble({ compartilhada: { data: 'px', pixelRatio: 4 } });
        const target = mapDouble({ compartilhada: 'ja tenho' });

        transferMapImages(source, target);

        expect(target.added).toHaveLength(0);
    });

    it('skips an id that lists but does not resolve', () => {
        const source = {
            listImages: () => ['fantasma'],
            getImage: () => undefined,
        };
        const target = mapDouble();

        expect(() => transferMapImages(source, target)).not.toThrow();
        expect(target.added).toHaveLength(0);
    });
});
