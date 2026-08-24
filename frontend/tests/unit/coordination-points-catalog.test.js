// Path: tests/unit/coordination-points-catalog.test.js

/**
 * @fileoverview Structural invariants of
 * `military_tools/coordination_measure_tool/coordination_points_catalog.js`, the
 * single place a coordination-measure point type is born.
 *
 * WHY STRUCTURAL AND NOT EXAMPLE-BY-EXAMPLE
 * Two thirds of the catalog is GENERATED (`ECHELON_*`, `ECHELON_FT_*`, `SUPPLY_*`)
 * from `ECHELON_CODES` / `SUPPLY_CLASSES`, and the generators interpolate the symbol
 * table with a template literal: a code present in the code table but missing from
 * the symbol table produces the LITERAL string "undefined" as the SVG, with no error
 * anywhere. The count and no-"undefined" checks below are what would catch that.
 *
 * WHAT THIS SUITE HOLDS
 *  - one entry per echelon code (twice: plain and Forca-Tarefa) and per supply class,
 *    with the family counts asserted against the source tables, never hardcoded;
 *  - `code === key` for every entry, and a parseable four-token viewBox in every SVG,
 *    which is what `extractDimensions` needs to avoid its silent 40x40 fallback;
 *  - the text-field descriptor shape (position, anchor, fontSize) the generator reads
 *    without guarding;
 *  - the CROSS-MODULE invariant that every text field name the catalog declares is
 *    also classified by `AddCoordinationMeasureGeometry.affectsTextModifiers`,
 *    otherwise editing that field never regenerates the symbol.
 *
 * WHAT IT DOES NOT REACH
 *  - whether any SVG DRAWS the right military symbol: that is a picture, not a
 *    property, and no node test can see it.
 */

import { describe, it, expect, vi } from 'vitest';

import {
    COORDINATION_POINTS_CATALOG,
    getTextFieldsConfig,
    getAvailableTextFields,
} from '@js/military_tools/coordination_measure_tool/coordination_points_catalog.js';
import {
    ECHELON_CODES,
    SUPPLY_CLASSES,
} from '@js/military_tools/coordination_measure_tool/coordination_measure_constants.js';

vi.mock('@tools', () => ({
    BaseGeometry: class { constructor(properties = {}) { this.properties = properties; } },
}));

const { default: AddCoordinationMeasureGeometry } = await import(
    '../../src/js/military_tools/coordination_measure_tool/add_coordination_measure_geometry.js'
);

const entries = Object.entries(COORDINATION_POINTS_CATALOG);
const geom = new AddCoordinationMeasureGeometry();

// ============================================================================
// Size and composition
// ============================================================================

describe('COORDINATION_POINTS_CATALOG composition', () => {
    it('is not empty (guards every "for each entry" loop below)', () => {
        expect(entries.length).toBeGreaterThan(50);
    });

    it('carries exactly one plain and one Forca-Tarefa entry per echelon code', () => {
        const codes = Object.keys(ECHELON_CODES);

        expect(codes.length).toBeGreaterThan(0);
        codes.forEach((code) => {
            expect(COORDINATION_POINTS_CATALOG[`ECHELON_${code}`]).toBeDefined();
            expect(COORDINATION_POINTS_CATALOG[`ECHELON_FT_${code}`]).toBeDefined();
        });

        const plain = entries.filter(([key]) => /^ECHELON_\d/.test(key));
        const forcaTarefa = entries.filter(([key]) => key.startsWith('ECHELON_FT_'));

        expect(plain).toHaveLength(codes.length);
        expect(forcaTarefa).toHaveLength(codes.length);
    });

    it('carries exactly one entry per supply class', () => {
        const classes = Object.keys(SUPPLY_CLASSES);

        expect(classes.length).toBeGreaterThan(0);
        classes.forEach((classCode) => {
            expect(COORDINATION_POINTS_CATALOG[`SUPPLY_${classCode}`]).toBeDefined();
        });
        expect(entries.filter(([key]) => key.startsWith('SUPPLY_'))).toHaveLength(classes.length);
    });

    it('adds up: base + 2 * echelons + supplies', () => {
        const generated = 2 * Object.keys(ECHELON_CODES).length + Object.keys(SUPPLY_CLASSES).length;
        const base = entries.filter(
            ([key]) => !key.startsWith('ECHELON_') && !key.startsWith('SUPPLY_')
        );

        expect(base.length + generated).toBe(entries.length);
    });
});

// ============================================================================
// Per-entry invariants
// ============================================================================

describe('COORDINATION_POINTS_CATALOG entries', () => {
    it('keys its own code, so catalog[x].code === x everywhere', () => {
        const mismatched = entries.filter(([key, point]) => point.code !== key).map(([key]) => key);

        expect(entries.length).toBeGreaterThan(0);
        expect(mismatched).toEqual([]);
    });

    it('gives every entry a name, a category and an anchor', () => {
        const incomplete = entries
            .filter(([, p]) => !p.name || !p.category || !p.anchor)
            .map(([key]) => key);

        expect(incomplete).toEqual([]);
    });

    it('uses only the two anchors the selection box knows how to shift', () => {
        const anchors = new Set(entries.map(([, p]) => p.anchor));

        expect([...anchors].sort()).toEqual(['bottom', 'center']);
    });

    it('never interpolates a missing symbol into the SVG as the string "undefined"', () => {
        const broken = entries
            .filter(([, p]) => typeof p.svg !== 'string' || p.svg.includes('undefined'))
            .map(([key]) => key);

        expect(entries.length).toBeGreaterThan(0);
        expect(broken).toEqual([]);
    });

    it('opens every SVG with an <svg> tag carrying a four-token viewBox', () => {
        const bad = entries.filter(([, p]) => {
            const match = p.svg.match(/viewBox="([^"]+)"/);

            if (!match || !p.svg.trim().startsWith('<svg')) return true;

            // Four tokens is what extractDimensions requires; a leading space makes
            // it five and silently drops the whole SVG onto the 40x40 default.
            return match[1].split(/\s+/).length !== 4;
        }).map(([key]) => key);

        expect(bad).toEqual([]);
    });
});

// ============================================================================
// Generated families
// ============================================================================

describe('generated echelon entries', () => {
    const echelons = entries.filter(([, p]) => p.isEchelon);

    it('flags isEchelon and echoes the echelon code in the key', () => {
        expect(echelons).toHaveLength(2 * Object.keys(ECHELON_CODES).length);
        echelons.forEach(([key, point]) => {
            expect(point.echelonCode).toBeTruthy();
            expect(key.endsWith(`_${point.echelonCode}`)).toBe(true);
        });
    });

    it('marks ONLY the Forca-Tarefa half with isForcaTarefa', () => {
        const flagged = echelons.filter(([, p]) => p.isForcaTarefa);

        expect(flagged).toHaveLength(Object.keys(ECHELON_CODES).length);
        flagged.forEach(([key]) => expect(key.startsWith('ECHELON_FT_')).toBe(true));
    });

    it('declares NO text fields, so the unit name never travels as an SVG label', () => {
        echelons.forEach(([key]) => expect(getAvailableTextFields(key)).toEqual([]));
    });
});

describe('generated supply entries', () => {
    const supplies = entries.filter(([, p]) => p.hasSupplyIcon);

    it('flags hasSupplyIcon and keys itself by the supply class', () => {
        expect(supplies).toHaveLength(Object.keys(SUPPLY_CLASSES).length);
        supplies.forEach(([key, point]) => {
            expect(key).toBe(`SUPPLY_${point.supplyClass}`);
            expect(SUPPLY_CLASSES[point.supplyClass]).toBeDefined();
        });
    });

    it('shares the same three text fields across every class', () => {
        supplies.forEach(([key]) => {
            expect(getAvailableTextFields(key)).toEqual(['identificacao', 'gdhIni', 'gdhFim']);
        });
    });
});

// ============================================================================
// Text field descriptors
// ============================================================================

describe('text field descriptors', () => {
    const withFields = entries.filter(([, p]) => Object.keys(p.textFields || {}).length > 0);

    it('at least one point declares text fields (guards the loops below)', () => {
        expect(withFields.length).toBeGreaterThan(0);
    });

    it('always carries numeric position.x / position.y and a numeric fontSize', () => {
        const bad = [];

        withFields.forEach(([key, point]) => {
            Object.entries(point.textFields).forEach(([field, config]) => {
                const ok = config.position
                    && typeof config.position.x === 'number'
                    && typeof config.position.y === 'number'
                    && typeof config.fontSize === 'number';

                if (!ok) bad.push(`${key}.${field}`);
            });
        });

        expect(bad).toEqual([]);
    });

    it('uses only the three anchors calculateDynamicViewBox distinguishes', () => {
        const anchors = new Set();

        withFields.forEach(([, point]) => {
            Object.values(point.textFields).forEach((config) => anchors.add(config.anchor));
        });

        expect(anchors.size).toBeGreaterThan(0);
        [...anchors].forEach((anchor) => {
            expect(['start', 'end', 'middle']).toContain(anchor);
        });
    });

    it('every declared field name is classified by affectsTextModifiers', () => {
        // Otherwise editing that field never triggers symbol regeneration, and the
        // change is only visible after a reload.
        const names = new Set();

        withFields.forEach(([, point]) => Object.keys(point.textFields).forEach(n => names.add(n)));

        expect(names.size).toBeGreaterThan(0);
        const unclassified = [...names].filter((name) => !geom.affectsTextModifiers(name));

        expect(unclassified).toEqual([]);
    });
});

// ============================================================================
// getTextFieldsConfig / getAvailableTextFields
// ============================================================================

describe('getTextFieldsConfig', () => {
    it('returns the live descriptor object for a point that has one', () => {
        expect(getTextFieldsConfig('SUPPLY_I'))
            .toBe(COORDINATION_POINTS_CATALOG.SUPPLY_I.textFields);
    });

    it('falls back to an empty object for unknown, null and undefined codes', () => {
        expect(getTextFieldsConfig('nao-existe')).toEqual({});
        expect(getTextFieldsConfig(null)).toEqual({});
        expect(getTextFieldsConfig(undefined)).toEqual({});
    });

    it('returns {} for a point that declares no fields, never undefined', () => {
        expect(getTextFieldsConfig('ECHELON_16')).toEqual({});
    });

    it('LEAKS Object.prototype keys: "toString" resolves to a function, not {}', () => {
        // `COORDINATION_POINTS_CATALOG[pointCode]` is a plain object lookup with no
        // hasOwnProperty guard, so an inherited key is treated as a catalog entry.
        // `point?.textFields || {}` then saves it, but only by luck.
        expect(COORDINATION_POINTS_CATALOG.toString).toBeTypeOf('function');
        expect(getTextFieldsConfig('toString')).toEqual({});
    });
});

describe('getAvailableTextFields', () => {
    it('lists the keys of the descriptor, in declaration order', () => {
        expect(getAvailableTextFields('SUPPLY_III'))
            .toEqual(Object.keys(COORDINATION_POINTS_CATALOG.SUPPLY_III.textFields));
    });

    it('returns [] for unknown codes and for field-less points', () => {
        expect(getAvailableTextFields('nao-existe')).toEqual([]);
        expect(getAvailableTextFields('ECHELON_11')).toEqual([]);
    });
});
