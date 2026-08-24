// Path: tests/unit/brazilian-svg-postprocessing.test.js

/**
 * @fileoverview Closes the last mil-symbol gap the backlog left open:
 * `military_tools/military_symbol_tool/brazilian_svg_postprocessing.js`.
 * (`buildSIDC`/`parseSIDC`/`validateSIDC` live in
 * `tests/unit/military-symbol-generator.test.js`; the SIDC extension itself in
 * `tests/unit/brazilian-sidc.test.js`.)
 *
 * WHAT THIS SUITE HOLDS
 *  - the module-private `hexToRgb`, exercised through the ONLY door it has, the
 *    `customColor` argument of `applyBrazilianModifications`. It has NO validation:
 *    a short or non-hex colour is written into the SVG as `rgb(...,NaN)`, silently.
 *    Contrast with `CoordinationMeasureGenerator.hexToRgb`, which returns null and
 *    makes its caller a no-op (pinned in tests/unit/coordination-measure-generator.test.js);
 *  - that the colour substitution runs on BOTH exits of the function (the early
 *    return taken when the SIDC carries no Brazilian extension, and the full path);
 *  - the four engagement-bar colours it targets, and that it targets no others;
 *  - `applyBrazilianLabelsToSVG`: mainIcon translation, the '00' skip on modifiers,
 *    the font-size rewrite, and the guards;
 *  - `applyGraphicAdaptations` and `checkCatalogWarnings` guards and outputs.
 *
 * WHAT IT DOES NOT REACH
 *  - the milsymbol `ms` global and the PNG pipeline (canvas, Phase 2);
 *  - the CONTENT of `brazilian_extension_catalog.js`: the fixtures below name real
 *    catalog entries (symbol set 10, main icon 110200, special modifiers 1-4), so a
 *    catalog edit can turn these red. That is deliberate: the mapping is the contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    applyBrazilianModifications,
    applyBrazilianLabelsToSVG,
    applyGraphicAdaptations,
    checkCatalogWarnings,
} from '@js/military_tools/military_symbol_tool/brazilian_svg_postprocessing.js';
import { hasSection, hasExtensions, supportsCommand } from
    '@js/military_tools/military_symbol_tool/brazilian_extension_catalog.js';
import { BrazilianSIDCExtension } from
    '@js/military_tools/military_symbol_tool/brazilian_sidc_extension.js';

/** SIDC 20 whose main icon (chars 10..16) is the catalogued 110200, no modifiers. */
const SIDC20 = `1003100016${'110200'}0000`;

/** Extension block that decodes to "no Brazilian extension" (country code != 076). */
const NO_EXTENSION = '1230000001';

/** Extension block that decodes to the all-zero Brazilian extension. */
const NULL_EXTENSION = '0760000000';

/** SVG carrying the four engagement-bar colours the substitution targets. */
const BAR_SVG = '<svg>'
    + '<rect fill="rgb(128,224,255)"/>'
    + '<rect fill="rgb(255,255,128)"/>'
    + '<rect fill="rgb(170,255,170)"/>'
    + '<rect fill="rgb(255,128,128)"/>'
    + '</svg>';

let warn;
let error;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
});

// ============================================================================
// applyBrazilianModifications — guards
// ============================================================================

describe('applyBrazilianModifications guards', () => {
    it('returns the SVG untouched, and logs, when symbolSetCode is missing', () => {
        expect(applyBrazilianModifications(BAR_SVG, SIDC20 + NO_EXTENSION, '', '#11FF00'))
            .toBe(BAR_SVG);
        expect(applyBrazilianModifications(BAR_SVG, SIDC20 + NO_EXTENSION, null, '#11FF00'))
            .toBe(BAR_SVG);
        expect(error).toHaveBeenCalled();
    });

    it('THROWS on a null SIDC, because sidc30.substring is called before any guard', () => {
        expect(() => applyBrazilianModifications(BAR_SVG, null, '10')).toThrow(TypeError);
    });

    it('leaves the SVG alone when no custom colour is given', () => {
        expect(applyBrazilianModifications(BAR_SVG, SIDC20 + NO_EXTENSION, '10')).toBe(BAR_SVG);
        expect(applyBrazilianModifications(BAR_SVG, SIDC20 + NULL_EXTENSION, '10')).toBe(BAR_SVG);
    });
});

// ============================================================================
// hexToRgb, reached through customColor
// ============================================================================

describe('applyBrazilianModifications custom colour (the private hexToRgb)', () => {
    /**
     * @param {string} color - Value handed to the customColor argument
     * @param {string} [extension] - Trailing 10-digit block of the SIDC
     * @returns {string} Resulting SVG
     */
    function colored(color, extension = NO_EXTENSION) {
        return applyBrazilianModifications(BAR_SVG, SIDC20 + extension, '10', color);
    }

    it('replaces all FOUR engagement-bar colours with a valid 6-digit hex', () => {
        const out = colored('#11FF00');

        expect(out.match(/rgb\(17,255,0\)/g)).toHaveLength(4);
        expect(out).not.toContain('rgb(128,224,255)');
        expect(out).not.toContain('rgb(255,128,128)');
    });

    it('accepts the hex with or without the leading #, and is case-insensitive', () => {
        expect(colored('11FF00')).toBe(colored('#11FF00'));
        expect(colored('#11ff00')).toBe(colored('#11FF00'));
    });

    it('leaves any colour that is not one of the four alone', () => {
        const svg = '<svg><rect fill="rgb(0,0,0)"/><rect fill="rgb(128, 224, 255)"/></svg>';
        const out = applyBrazilianModifications(svg, SIDC20 + NO_EXTENSION, '10', '#11FF00');

        // The spaced form is NOT matched: the four patterns are literal and unspaced.
        expect(out).toBe(svg);
    });

    it('DEFECT: the 3-digit shorthand #fff yields rgb(255,15,NaN), not white', () => {
        // substring(0,2)='ff'->255, substring(2,4)='f'->15, substring(4,6)=''->NaN.
        // The backlog predicted rgb(255,NaN,NaN); the middle channel is 15, not NaN.
        const out = colored('#fff');

        expect(out.match(/rgb\(255,15,NaN\)/g)).toHaveLength(4);
    });

    it('DEFECT: a non-hex colour is written straight in as rgb(NaN,NaN,NaN)', () => {
        expect(colored('zzzzzz').match(/rgb\(NaN,NaN,NaN\)/g)).toHaveLength(4);
    });

    it('DEFECT: it even parses PART of a word, so "vermelho" becomes rgb(NaN,NaN,14)', () => {
        // 've' and 'rm' are not hex, but 'el' parses as the leading 'e' -> 14.
        expect(colored('vermelho').match(/rgb\(NaN,NaN,14\)/g)).toHaveLength(4);
    });

    it('skips the substitution entirely for the empty string (falsy customColor)', () => {
        expect(colored('')).toBe(BAR_SVG);
    });

    // CONTROL for the it.fails below: the colour path is reachable and it DOES
    // discriminate between a good and a bad hex. Without this, the it.fails would
    // go green on any throw, an import failure included.
    it('control: the colour path is reachable and discriminates good from bad hex', () => {
        expect(colored('#11FF00')).toContain('rgb(17,255,0)');
        expect(colored('#11FF00')).not.toContain('NaN');
        expect(colored('vermelho')).toContain('NaN');
    });

    it.fails(
        'DEFECT (expected red): an invalid custom colour should leave the SVG '
        + 'untouched, as CoordinationMeasureGenerator.applyCustomColor does; instead '
        + 'the private hexToRgb has no validation and emits NaN channels',
        () => {
            expect(colored('zzzzzz')).toBe(BAR_SVG);
        }
    );

    it('applies the colour on BOTH exits: with and without a Brazilian extension', () => {
        // The substitution block is duplicated, once before the early return and
        // once at the end. Both must behave the same for the same colour.
        expect(colored('#11FF00', NO_EXTENSION)).toBe(colored('#11FF00', NULL_EXTENSION));
    });
});

// ============================================================================
// applyBrazilianModifications — extension elements
// ============================================================================

describe('applyBrazilianModifications extension elements', () => {
    /**
     * Build a 30-digit SIDC, encoding the extension block with the production
     * encoder rather than by hand (it has its own suite: brazilian-sidc.test.js).
     * @param {string} mainIcon - Six-digit main icon
     * @param {Object} ext - Fields accepted by BrazilianSIDCExtension.encode
     * @returns {string} SIDC30
     */
    function sidc30(mainIcon, ext) {
        return `1003100016${mainIcon}0000${BrazilianSIDCExtension.encode(ext)}`;
    }

    it('control: the helper encodes what it claims (round-trips through decode)', () => {
        const built = sidc30('110200', { specialModifier: 5 });

        expect(built).toHaveLength(30);
        expect(BrazilianSIDCExtension.decode(built.substring(20)))
            .toMatchObject({ specialModifier: 5, entityExtension: 0, isCommand: false });
    });

    it('warns, without throwing, for an uncatalogued special modifier', () => {
        const out = applyBrazilianModifications(
            '<svg></svg>', sidc30('110200', { specialModifier: 5 }), '10'
        );

        expect(out).toBe('<svg></svg>');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Special Modifier 5'));
    });

    it('appends the special-modifier element before </svg> when it IS catalogued', () => {
        const out = applyBrazilianModifications(
            '<svg></svg>', sidc30('110200', { specialModifier: 1 }), '10'
        );

        expect(out.startsWith('<svg>')).toBe(true);
        expect(out.endsWith('</svg>')).toBe(true);
        expect(out.length).toBeGreaterThan('<svg></svg>'.length);
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns when the command element is asked of a symbol set that has none', () => {
        expect(supportsCommand('15')).toBe(false);

        applyBrazilianModifications('<svg></svg>', sidc30('110300', { isCommand: 1 }), '15');

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Command element'));
    });

    it('warns for an uncatalogued entity extension on an icon that HAS extensions', () => {
        expect(hasExtensions('10', 'mainIcon', '121899')).toBe(true);

        applyBrazilianModifications('<svg></svg>', sidc30('121899', { entityExtension: 7 }), '10');

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Entity Extension 7'));
    });

    it('stays quiet for an icon with no extensions at all', () => {
        expect(hasExtensions('10', 'mainIcon', '999999')).toBe(false);

        applyBrazilianModifications('<svg></svg>', sidc30('999999', { entityExtension: 7 }), '10');

        expect(warn).not.toHaveBeenCalled();
    });
});

// ============================================================================
// applyBrazilianLabelsToSVG
// ============================================================================

describe('applyBrazilianLabelsToSVG', () => {
    const LABELLED = '<svg><text font-size="30" x="1">CA</text></svg>';

    it('translates the catalogued main-icon label and rewrites its font size', () => {
        expect(applyBrazilianLabelsToSVG(LABELLED, SIDC20, '10'))
            .toBe('<svg><text font-size="45" x="1">Civ</text></svg>');
    });

    it('returns the input unchanged for a main icon with no mapping', () => {
        expect(applyBrazilianLabelsToSVG(LABELLED, `1003100016${'999999'}0000`, '10'))
            .toBe(LABELLED);
    });

    it('returns the input unchanged when any of the three arguments is falsy', () => {
        expect(applyBrazilianLabelsToSVG(LABELLED, SIDC20, '')).toBe(LABELLED);
        expect(applyBrazilianLabelsToSVG(LABELLED, '', '10')).toBe(LABELLED);
        expect(applyBrazilianLabelsToSVG('', SIDC20, '10')).toBe('');
        expect(applyBrazilianLabelsToSVG(null, SIDC20, '10')).toBeNull();
    });

    it('skips modifier lookups when the modifier code is the "00" placeholder', () => {
        // SIDC20 above already carries 00/00, and the result is the main-icon
        // translation alone: no modifier text was touched.
        const out = applyBrazilianLabelsToSVG('<svg><text x="1">00</text></svg>', SIDC20, '10');

        expect(out).toBe('<svg><text x="1">00</text></svg>');
    });

    it('honours the modifier2 section gate', () => {
        // Both catalogued sets declare the section; the gate is what stops a set
        // without one from being queried at all.
        expect(hasSection('10', 'modifier2')).toBe(true);
        expect(hasSection('99', 'modifier2')).toBe(false);
        expect(applyBrazilianLabelsToSVG(LABELLED, SIDC20, '99')).toBe(LABELLED);
    });

    it('replaces only the FIRST occurrence, because the pattern is a plain string', () => {
        const twice = '<svg><text x="1">CA</text><text x="2">CA</text></svg>';
        const out = applyBrazilianLabelsToSVG(twice, SIDC20, '10');

        expect(out.match(/>Civ</g)).toHaveLength(1);
        expect(out).toContain('>CA</text>');
    });
});

// ============================================================================
// applyGraphicAdaptations
// ============================================================================

describe('applyGraphicAdaptations', () => {
    it('returns the input unchanged when any required argument is falsy', () => {
        expect(applyGraphicAdaptations('<x/>', '', 'mainIcon', '10')).toBe('<x/>');
        expect(applyGraphicAdaptations('<x/>', '110200', '', '10')).toBe('<x/>');
        expect(applyGraphicAdaptations('<x/>', '110200', 'mainIcon', '')).toBe('<x/>');
        expect(applyGraphicAdaptations('', '110200', 'mainIcon', '10')).toBe('');
    });

    it('returns the input unchanged for a code with no adaptation', () => {
        expect(applyGraphicAdaptations('<x/>', '999999', 'mainIcon', '10')).toBe('<x/>');
    });

    it('is a no-op when the adaptation target is absent from the SVG', () => {
        // The adaptation exists for 111001 in set 10, but its `find` string is not
        // present here, so String.replace leaves the input alone.
        expect(applyGraphicAdaptations('<svg></svg>', '111001', 'mainIcon', '10'))
            .toBe('<svg></svg>');
    });
});

// ============================================================================
// checkCatalogWarnings
// ============================================================================

describe('checkCatalogWarnings', () => {
    /**
     * @param {Object} [overrides] - Extension fields to override
     * @returns {Object} Decoded-extension shape
     */
    function extension(overrides = {}) {
        return {
            entityExtension: 0,
            isCommand: false,
            specialModifier: 0,
            mod1Extension: 0,
            mod2Extension: 0,
            ...overrides,
        };
    }

    it('returns [] for a null or undefined extension', () => {
        expect(checkCatalogWarnings(null, '10', SIDC20)).toEqual([]);
        expect(checkCatalogWarnings(undefined, '10', SIDC20)).toEqual([]);
    });

    it('returns [] for a fully catalogued, all-zero extension', () => {
        expect(checkCatalogWarnings(extension(), '10', SIDC20)).toEqual([]);
    });

    it('reports an uncatalogued special modifier', () => {
        expect(checkCatalogWarnings(extension({ specialModifier: 5 }), '10', SIDC20))
            .toEqual(['Special Modifier 5 not cataloged for Symbol Set 10']);
    });

    it('does NOT report special modifier 0, because the check is `> 0`', () => {
        expect(checkCatalogWarnings(extension({ specialModifier: 0 }), '10', SIDC20)).toEqual([]);
    });

    it('reports an uncatalogued entity extension on an icon that has extensions', () => {
        expect(checkCatalogWarnings(extension({ entityExtension: 7 }), '10', `1003100016${'121899'}0000`))
            .toEqual(['Entity Extension 7 not cataloged for icon 121899']);
    });

    it('reports a modifier2 extension aimed at a symbol set with no modifier2 section', () => {
        expect(checkCatalogWarnings(extension({ mod2Extension: 3 }), '99', SIDC20))
            .toEqual(['Modifier 2 not applicable for Symbol Set 99']);
    });

    it('stays silent for mod2Extension 0 even on a set with no modifier2 section', () => {
        expect(checkCatalogWarnings(extension({ mod2Extension: 0 }), '99', SIDC20)).toEqual([]);
    });

    it('returns [] when sidc20 is missing, since every code guard is null-checked', () => {
        expect(checkCatalogWarnings(extension({ entityExtension: 7 }), '10', null)).toEqual([]);
    });

    it('accumulates independent warnings instead of short-circuiting', () => {
        const warnings = checkCatalogWarnings(
            extension({ entityExtension: 7, specialModifier: 5 }),
            '10',
            `1003100016${'121899'}0000`
        );

        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toContain('Entity Extension 7');
        expect(warnings[1]).toContain('Special Modifier 5');
    });
});
