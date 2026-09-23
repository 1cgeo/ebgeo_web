// Path: tests/unit/engineering-symbols.test.js
import { describe, it, expect } from 'vitest';
import { ENGINEERING_CATALOG } from '@js/military_tools/engineering_symbol_tool/engineering_catalog.js';
import { engineeringDraft, engineeringItem } from '@js/military_tools/engineering_symbol_tool/engineering_generator.js';
import { engineeringFields, rampChevronCount } from '@js/military_tools/engineering_symbol_tool/engineering_fields.js';
import { errorsFor } from '@js/military_tools/engineering_symbol_tool/engineering_drawing.js';
import { ensureMapDataShape } from '@store/repository.utils.js';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { iconSizeForFeature, hitClassOf, HIT_CLASS } from '@tools/helpers/hit-test.model.js';

describe('engineering symbols: approved scope and editable data', () => {
    it('includes exactly the approved symbols and no reference-road geometry', () => {
        expect(ENGINEERING_CATALOG.map(item => item.number)).toEqual([2,3,5,6,7,8,9,10,11,13,14,15,16,17,18,19,20,21,22,23,26,27,28]);
        for (const item of ENGINEERING_CATALOG) {
            for (const variant of item.variants) {
                expect(variant.body).not.toMatch(/data-role="context"|#d32f2f/);
                expect(variant.anchor).toHaveLength(2);
            }
        }
        expect(engineeringItem(3).variants[0].body.match(/data-part="section-limit"/g)).toHaveLength(1);
        for (const code of [1,4,12,24,25,999]) expect(() => engineeringItem(code)).toThrow();
    });

    it('limits editing to the fields for the chosen symbol, without contour or overhead switches', () => {
        for (const id of [8,9,18]) expect(engineeringFields[id].fields.some(f => f.key === 'contour')).toBe(false);
        expect(engineeringFields[19].fields.map(f => f.key)).toEqual(['height']);
        expect(engineeringDraft(18, { variant: 40, values: { order: '42', height: '9', contour: '11' } })).toEqual({
            variant: 0, values: { order: '42', clearance: '4', length: '800', roadWidth: '5', totalWidth: '6' }
        });
        expect(engineeringDraft(13, { values: { type: 'unknown', access: 'both' } }).values).toMatchObject({ type: 'V', access: 'both' });
        expect(engineeringDraft(2, { values: { order: '1'.repeat(1000) } }).values.order).toHaveLength(40);
    });

    it('allows unknown and empty measurements, preserves zero, and rejects inconsistent dimensions', () => {
        const values = engineeringDraft(18).values;
        for (const clearance of ['?', '', '0', '4,5', '4.5']) expect(errorsFor(engineeringItem(18), { ...values, clearance })).toEqual([]);
        expect(errorsFor(engineeringItem(18), { ...values, clearance: '-1' })).toHaveLength(1);
        expect(errorsFor(engineeringItem(18), { ...values, roadWidth: '7', totalWidth: '6' })).toHaveLength(1);
        expect(errorsFor(engineeringItem(16), { width: '4', minimum: '5', maximum: '4' })).toHaveLength(1);
    });

    it('opens symbols imported with a null optional engineering draft using the catalog defaults', () => {
        for (const item of ENGINEERING_CATALOG) {
            expect(engineeringDraft(item.number, null)).toEqual(engineeringDraft(item.number));
        }
    });

    it('derives slope marks at every boundary without a redundant variant control', () => {
        for (const [value, count] of [['?',0],['',0],['0',0],['4.9',0],['5',1],['7',1],['7,1',2],['10',2],['10.1',3],['14',3],['14.1',4],['17',4]]) {
            expect(rampChevronCount(value), value).toBe(count);
        }
        for (const id of [5,20,21]) expect(engineeringFields[id].variant).toBeUndefined();
    });
});

describe('engineering symbols: persistence and point behavior', () => {
    it('adds the missing collection on legacy reads without mutating the input or existing symbols', () => {
        const original = { features: { coordination_lines: [], points: [] } };
        const shaped = ensureMapDataShape(original);
        expect(shaped.features.engineering_symbols).toEqual([]);
        expect(original.features).not.toHaveProperty('engineering_symbols');
        expect(ensureMapDataShape(shaped)).toBeNull();
    });

    it('keeps engineering data, color and point coordinates when uploading a local atlas', () => {
        const properties = { id: 'aa673e4a-d753-430c-94ae-687a514915bd', source: 'engineering_symbol', pointCode: '9', engineering: engineeringDraft(9, { values: { fillBackground: true } }), fillColor: '#004488', rotation: 45, size: 1.4 };
        const geometry = { type: 'Point', coordinates: [-47, -15] };
        const { payload, stats } = buildServerImportPayload({ maps: { Test: { features: { engineering_symbols: [{ type: 'Feature', properties, geometry }] } } } }, { name: 'Engineering' });
        expect(stats.droppedFeatures).toBe(0);
        expect(payload.maps[0].features[0]).toMatchObject({ feature_type: 'engineering_symbol', geometry, properties });
        expect(hitClassOf('engineering_symbol')).toBe(HIT_CLASS.POINT);
        expect(iconSizeForFeature('engineering-symbols-layer', { size: 1.4, createdAtZoom: 10 }, 11)).toBeCloseTo(2.8);
        expect(iconSizeForFeature('engineering-symbols-layer', { size: 1.4, createdAtZoom: 10, zoomCorrectionEnabled: false }, 11)).toBeCloseTo(1.4);
    });
});
