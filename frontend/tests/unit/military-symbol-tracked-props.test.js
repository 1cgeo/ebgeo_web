// Path: tests/unit/military-symbol-tracked-props.test.js

import { describe, it, expect } from 'vitest';
import {
    SIDC_PROPS,
    TEXT_MODIFIER_PROPS,
    TRACKED_PROPS,
    DEFAULTABLE_KEYS,
    buildDefaultSymbolPatch,
    hasTrackedPropsChanged
} from '@js/military_tools/military_symbol_tool/add_military_symbol_control.js';
import AddMilitarySymbolGeometry from '@js/military_tools/military_symbol_tool/add_military_symbol_geometry.js';

const geometry = new AddMilitarySymbolGeometry();

/** Minimal snapshot of a saved symbol, as deepCloned on selection. */
function baseProperties(overrides = {}) {
    return {
        context: '0',
        standardIdentity: '3',
        status: '0',
        symbolSet: '10',
        hqTfDummy: '0',
        echelon: '16',
        mainIcon: '121100',
        modifier1: '00',
        modifier2: '00',
        sidc: '10031000161211000000',
        size: 1.0,
        opacity: 1.0,
        rotation: 0,
        fillColor: null,
        createdAtZoom: 12,
        zoomCorrectionEnabled: true,
        nome: 'Símbolo 1',
        descricao: '',
        visivel: true,
        bloqueado: false,
        uniqueDesignation: null,
        engagementBar: null,
        ...overrides
    };
}

describe('TRACKED_PROPS stays in sync with the geometry predicates', () => {
    it('every SIDC prop is recognized by affectsSIDC', () => {
        const missing = SIDC_PROPS.filter((key) => !geometry.affectsSIDC(key));
        expect(missing).toEqual([]);
    });

    it('every text amplifier is recognized by affectsTextModifiers', () => {
        const missing = TEXT_MODIFIER_PROPS.filter((key) => !geometry.affectsTextModifiers(key));
        expect(missing).toEqual([]);
    });

    it('no property that regenerates the symbol is left out of TRACKED_PROPS', () => {
        // Enumerable proxy for the geometry lists: anything the tool can hold as a
        // property and that triggers regeneration must also trigger persistence.
        const candidates = [
            ...Object.keys(baseProperties()),
            'specialModifier', 'isCommand',
            'mainIconExtension', 'modifier1Extension', 'modifier2Extension',
            'quantity', 'higherFormation', 'reinforcedReduced', 'additionalInformation',
            'credibility', 'type', 'iffSif', 'dateTimeGroup', 'altitudeDepth',
            'equipmentTeardownTime', 'location', 'speed', 'specialHeadquarters',
            'direction', 'engagementBar'
        ];

        const regenerating = candidates.filter(
            (key) => geometry.affectsSIDC(key) || geometry.affectsTextModifiers(key)
        );
        const untracked = regenerating.filter((key) => !TRACKED_PROPS.includes(key));
        expect(untracked).toEqual([]);
    });

    it('leaves render-derived properties out (they change on every zoom)', () => {
        for (const key of ['calculatedSize', 'selectionBox', 'width', 'height']) {
            expect(TRACKED_PROPS, key).not.toContain(key);
        }
    });
});

describe('hasTrackedPropsChanged', () => {
    it('reports a change in a text amplifier', () => {
        const initial = baseProperties();
        const current = baseProperties({ uniqueDesignation: '1ª Bda Inf Sl' });
        expect(hasTrackedPropsChanged(current, initial)).toBe(true);
    });

    it.each([
        ['sidc', '10031000201211000000'],
        ['symbolSet', '15'],
        ['specialModifier', '1'],
        ['isCommand', true],
        ['mainIconExtension', 3],
        ['engagementBar', '1/2/3'],
        ['quantity', '4'],
        ['direction', '270'],
        ['zoomCorrectionEnabled', false]
    ])('reports a change in %s', (key, value) => {
        const initial = baseProperties();
        const current = baseProperties({ [key]: value });
        expect(hasTrackedPropsChanged(current, initial)).toBe(true);
    });

    it('reports no change when nothing was edited', () => {
        expect(hasTrackedPropsChanged(baseProperties(), baseProperties())).toBe(false);
    });

    it('treats null, undefined and empty string as the same empty value', () => {
        // The modal writes '' where the feature was created with null; without this
        // normalization every Apply would persist and enqueue a sync op for nothing.
        const initial = baseProperties({ uniqueDesignation: null });
        const current = baseProperties({ uniqueDesignation: '' });
        expect(hasTrackedPropsChanged(current, initial)).toBe(false);

        const undefinedCurrent = baseProperties();
        delete undefinedCurrent.uniqueDesignation;
        expect(hasTrackedPropsChanged(undefinedCurrent, initial)).toBe(false);
    });

    it('does not confuse the falsy values that are real content', () => {
        // 0 and false are values, not emptiness — `?? ''` keeps them (unlike `|| ''`).
        expect(hasTrackedPropsChanged(
            baseProperties({ rotation: 0 }),
            baseProperties({ rotation: null })
        )).toBe(true);

        expect(hasTrackedPropsChanged(
            baseProperties({ visivel: false }),
            baseProperties({ visivel: true })
        )).toBe(true);
    });

    it('ignores properties outside the tracked list', () => {
        const initial = baseProperties();
        const current = baseProperties({ calculatedSize: 4.2, selectionBox: [1, 2, 3, 4] });
        expect(hasTrackedPropsChanged(current, initial)).toBe(false);
    });

    it('reports changed when there is no snapshot, and survives missing properties', () => {
        expect(hasTrackedPropsChanged(baseProperties(), null)).toBe(true);
        expect(hasTrackedPropsChanged(baseProperties(), undefined)).toBe(true);
        expect(hasTrackedPropsChanged(undefined, baseProperties())).toBe(true);
        expect(hasTrackedPropsChanged(undefined, {})).toBe(false);
    });
});

describe('buildDefaultSymbolPatch', () => {
    it('copies the style and identity keys', () => {
        const patch = buildDefaultSymbolPatch(baseProperties({ fillColor: '#ff0000', echelon: '18' }));
        expect(patch.fillColor).toBe('#ff0000');
        expect(patch.echelon).toBe('18');
        expect(patch.symbolSet).toBe('10');
    });

    it('never copies per-feature state into the new-symbol defaults', () => {
        const patch = buildDefaultSymbolPatch(baseProperties({
            id: 'feat-1',
            layerId: 'layer-1',
            nome: 'Símbolo 1',
            descricao: 'algo',
            bloqueado: true,
            visivel: false,
            quantity: '4',
            uniqueDesignation: '1ª Bda Inf Sl',
            trajetoria: [{ t: 1, lng: -43, lat: -22 }],
            temporalInicio: 1000,
            temporalFim: 2000,
            _temporalHome: [-43, -22],
            calculatedSize: 4.2,
            selectionBox: [1, 2, 3, 4],
            width: 320,
            height: 240
        }));

        for (const key of [
            'id', 'layerId', 'nome', 'descricao', 'bloqueado', 'visivel', 'quantity',
            'uniqueDesignation', 'trajetoria', 'temporalInicio', 'temporalFim',
            '_temporalHome', 'calculatedSize', 'selectionBox', 'width', 'height'
        ]) {
            expect(Object.prototype.hasOwnProperty.call(patch, key), key).toBe(false);
        }
    });

    it('never copies the sidc (it is rebuilt from the defaults)', () => {
        const patch = buildDefaultSymbolPatch(baseProperties());
        expect(Object.prototype.hasOwnProperty.call(patch, 'sidc')).toBe(false);
        expect(DEFAULTABLE_KEYS).not.toContain('sidc');
    });

    it('copies no amplifier at all', () => {
        const leaked = TEXT_MODIFIER_PROPS.filter((key) => DEFAULTABLE_KEYS.includes(key));
        expect(leaked).toEqual([]);
    });

    it('omits absent keys instead of writing undefined over a default', () => {
        const patch = buildDefaultSymbolPatch({ fillColor: '#00ff00' });
        expect(patch).toEqual({ fillColor: '#00ff00' });
    });

    it('returns an empty patch for empty, null and undefined input', () => {
        expect(buildDefaultSymbolPatch({})).toEqual({});
        expect(buildDefaultSymbolPatch(null)).toEqual({});
        expect(buildDefaultSymbolPatch(undefined)).toEqual({});
    });
});
