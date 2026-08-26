import { describe, it, expect } from 'vitest';
import { BrazilianSIDCExtension } from '../../src/js/military_tools/military_symbol_tool/brazilian_sidc_extension.js';
import { applyBrazilianModifications } from '../../src/js/military_tools/military_symbol_tool/brazilian_svg_postprocessing.js';

/**
 * Regression: the "Modificador Transversal" drew Mecanizado and Motorizado
 * swapped. Value 2 (Mecanizado) got the plain vertical bar and value 3
 * (Motorizado) got the wheeled-armour glyph.
 *
 * The bar and the wheels come straight from milsymbol's 2525D icon set:
 * GR.IC.FF.MOTORIZED is "M100,y1 L100,y2" and GR.IC.ARMOR, WHEELED is the
 * armour oval over three wheels. The tool contradicted itself, because main
 * icon 121104 "Infantaria Motorizada" already renders that same bar through
 * milsymbol. Doctrine agrees: mecanizado rides wheeled armour (Guarani,
 * Cascavel), motorizado rides unarmoured trucks.
 *
 * The value is persisted in SIDC digits 21-30, so the glyphs were swapped and
 * the codes left alone: whoever picked "Mecanizado" stored a 2 and meant a 2.
 */
describe('special modifier glyphs (Symbol Set 10)', () => {
    // Friend unit, Infantry (121100), no modifiers.
    const SIDC_20 = '10031000001211000000';
    const BASE_SVG = '<svg></svg>';

    const OVAL = 'M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z';
    const BAR = 'M100,50L100,150';
    const ARC = 'M25,150 C45,110 155,110 175,150';

    function render(specialModifier) {
        const sidc30 = SIDC_20 + BrazilianSIDCExtension.encode({ specialModifier });
        return applyBrazilianModifications(BASE_SVG, sidc30, '10');
    }

    function wheels(svg) {
        return (svg.match(/<circle/g) || []).length;
    }

    it('draws Blindado as the bare armour oval', () => {
        const svg = render(1);
        expect(svg).toContain(OVAL);
        expect(wheels(svg)).toBe(0);
        expect(svg).not.toContain(BAR);
    });

    it('draws Mecanizado as the armour oval over three wheels', () => {
        const svg = render(2);
        expect(svg).toContain(OVAL);
        expect(wheels(svg)).toBe(3);
        expect(svg).not.toContain(BAR);
    });

    it('draws Motorizado as the vertical bar, with no armour', () => {
        const svg = render(3);
        expect(svg).toContain(BAR);
        expect(svg).not.toContain(OVAL);
        expect(wheels(svg)).toBe(0);
    });

    it('draws Defesa Aerea as the arc', () => {
        const svg = render(4);
        expect(svg).toContain(ARC);
        expect(svg).not.toContain(BAR);
        expect(wheels(svg)).toBe(0);
    });
});
