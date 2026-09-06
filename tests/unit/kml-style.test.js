// Path: tests/unit/kml-style.test.js

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    toKmlColor,
    resolveOutline,
    resolveFill,
    buildLineStyle,
    buildPolyStyle,
    buildIconStyle,
    buildLabelStyle,
    normalizeHeading,
    iconScale,
    iconHotSpot,
    styleSignature,
    collectDegradedStyle,
} from '@js/import_export/kmz/kml-style.js';

describe('toKmlColor', () => {
    it('reverses RGB into KML aabbggrr byte order', () => {
        // Red -> aa=ff, bb=00, gg=00, rr=ff. The red byte is LAST in KML.
        expect(toKmlColor('#ff0000', 1)).toBe('ff0000ff');
        // Blue lands in the second byte pair, right after alpha.
        expect(toKmlColor('#0000ff', 1)).toBe('ffff0000');
        expect(toKmlColor('#00ff00', 1)).toBe('ff00ff00');
    });

    it('distinguishes red from blue (guards against BGR mix-up)', () => {
        expect(toKmlColor('#ff0000', 1)).not.toBe(toKmlColor('#0000ff', 1));
    });

    it('expands three-digit hex', () => {
        expect(toKmlColor('#f00', 1)).toBe(toKmlColor('#ff0000', 1));
        expect(toKmlColor('#abc', 1)).toBe(toKmlColor('#aabbcc', 1));
    });

    it('accepts uppercase and surrounding whitespace', () => {
        expect(toKmlColor('  #FF0000  ', 1)).toBe('ff0000ff');
    });

    it('maps opacity onto the alpha byte', () => {
        expect(toKmlColor('#ff0000', 0)).toBe('000000ff');
        expect(toKmlColor('#ff0000', 0.5)).toBe('800000ff');
    });

    it('clamps out-of-range opacity', () => {
        expect(toKmlColor('#ff0000', -0.3)).toBe('000000ff');
        expect(toKmlColor('#ff0000', 1.7)).toBe('ff0000ff');
    });

    it('treats non-finite opacity as fully opaque', () => {
        // `value ?? 1` would NOT catch NaN — this pins the isFinite guard.
        expect(toKmlColor('#ff0000', NaN)).toBe('ff0000ff');
        expect(toKmlColor('#ff0000', Infinity)).toBe('ff0000ff');
        expect(toKmlColor('#ff0000', undefined)).toBe('ff0000ff');
    });

    it('parses rgb() and rgba(), composing rgba alpha with the opacity argument', () => {
        expect(toKmlColor('rgb(255, 0, 0)', 1)).toBe('ff0000ff');
        expect(toKmlColor('rgba(255, 0, 0, 0.5)', 1)).toBe('800000ff');
        expect(toKmlColor('rgba(255, 0, 0, 0.5)', 0.5)).toBe('400000ff');
    });

    it('falls back to opaque black for unusable input', () => {
        for (const bad of [null, undefined, '', '   ', 'notacolor', '#12345', 42, {}]) {
            expect(toKmlColor(bad, 1)).toBe('ff000000');
        }
    });

    it('always emits eight lowercase hex characters', () => {
        fc.assert(fc.property(
            fc.integer({ min: 0, max: 0xffffff }),
            fc.double({ min: 0, max: 1, noNaN: true }),
            (rgb, opacity) => {
                const hex = '#' + rgb.toString(16).padStart(6, '0');
                expect(toKmlColor(hex, opacity)).toMatch(/^[0-9a-f]{8}$/);
            }
        ));
    });

    it('round-trips RGB bytes into reversed positions', () => {
        fc.assert(fc.property(
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            (r, g, b) => {
                const hex = '#'
                    + r.toString(16).padStart(2, '0')
                    + g.toString(16).padStart(2, '0')
                    + b.toString(16).padStart(2, '0');
                const kml = toKmlColor(hex, 1);
                expect(kml.slice(0, 2)).toBe('ff');
                expect(kml.slice(2, 4)).toBe(b.toString(16).padStart(2, '0'));
                expect(kml.slice(4, 6)).toBe(g.toString(16).padStart(2, '0'));
                expect(kml.slice(6, 8)).toBe(r.toString(16).padStart(2, '0'));
            }
        ));
    });
});

describe('resolveOutline', () => {
    it('prefers lineColor but falls back to color', () => {
        expect(resolveOutline({ lineColor: '#111111' }).color).toBe('#111111');
        expect(resolveOutline({ color: '#222222' }).color).toBe('#222222');
        expect(resolveOutline({}).color).toBe('#000000');
    });

    it('keeps outlines opaque, matching MapLibre line-opacity 1', () => {
        expect(resolveOutline({ opacity: 0.2 }).opacity).toBe(1);
    });

    it('defaults a non-finite lineWidth', () => {
        expect(resolveOutline({ lineWidth: NaN }).width).toBe(2);
        expect(resolveOutline({ lineWidth: 0 }).width).toBe(0);
    });
});

describe('resolveFill', () => {
    it('uses hatchColor as a solid fill when hatching is enabled', () => {
        const fill = resolveFill({ fillColor: '#ff0000', hatchEnabled: true, hatchColor: '#00ff00' });
        expect(fill.color).toBe('#00ff00');
        expect(fill.degraded).toBe(true);
    });

    it('ignores hatching when no hatch color is set', () => {
        const fill = resolveFill({ fillColor: '#ff0000', hatchEnabled: true });
        expect(fill.color).toBe('#ff0000');
        expect(fill.degraded).toBe(false);
    });

    it('prefers fillOpacity over the generic opacity', () => {
        expect(resolveFill({ fillOpacity: 0.25, opacity: 0.9 }).opacity).toBe(0.25);
        expect(resolveFill({ opacity: 0.9 }).opacity).toBe(0.9);
    });
});

describe('normalizeHeading', () => {
    it('wraps into [0, 360)', () => {
        expect(normalizeHeading(0)).toBe(0);
        expect(normalizeHeading(360)).toBe(0);
        expect(normalizeHeading(-90)).toBe(270);
        expect(normalizeHeading(720.5)).toBe(0.5);
    });

    it('never returns -0', () => {
        expect(Object.is(normalizeHeading(-0), -0)).toBe(false);
        expect(Object.is(normalizeHeading(-360), -0)).toBe(false);
    });

    it('treats non-finite input as zero', () => {
        expect(normalizeHeading(NaN)).toBe(0);
        expect(normalizeHeading(Infinity)).toBe(0);
        expect(normalizeHeading(undefined)).toBe(0);
    });

    it('always lands in [0, 360)', () => {
        fc.assert(fc.property(
            fc.double({ min: -10000, max: 10000, noNaN: true }),
            (deg) => {
                const h = normalizeHeading(deg);
                expect(h).toBeGreaterThanOrEqual(0);
                expect(h).toBeLessThan(360);
            }
        ));
    });
});

describe('iconScale', () => {
    it('is the ratio of desired to native pixels', () => {
        expect(iconScale(24, 48)).toBeCloseTo(0.5);
        expect(iconScale(48, 48)).toBe(1);
    });

    it('never divides by zero or returns Infinity', () => {
        expect(Number.isFinite(iconScale(10, 0))).toBe(true);
        expect(Number.isFinite(iconScale(0, 48))).toBe(true);
        expect(iconScale(10, 0)).toBe(0.05);
    });

    it('clamps extremes', () => {
        expect(iconScale(10000, 1)).toBe(20);
        expect(iconScale(-5, 48)).toBe(0.05);
    });

    it('defaults on non-finite input', () => {
        expect(iconScale(NaN, 48)).toBe(1);
        expect(iconScale(24, undefined)).toBe(1);
    });
});

describe('styleSignature', () => {
    it('matches for identical styles and differs for distinct ones', () => {
        const a = { lineColor: '#ff0000', lineWidth: 2, fillColor: '#00ff00', opacity: 0.5 };
        const b = { ...a };
        const c = { ...a, opacity: 0.6 };

        expect(styleSignature('polygon', a)).toBe(styleSignature('polygon', b));
        expect(styleSignature('polygon', a)).not.toBe(styleSignature('polygon', c));
    });

    it('separates feature types and icon identities', () => {
        const props = { lineColor: '#ff0000' };
        expect(styleSignature('point', props)).not.toBe(styleSignature('line', props));
        expect(styleSignature('point', props, 'star')).not.toBe(styleSignature('point', props, 'cross'));
    });
});

describe('collectDegradedStyle', () => {
    it('records dash styles that KML cannot express natively', () => {
        expect(collectDegradedStyle({ lineStyle: 'dashed' })).toEqual({ lineStyle: 'dashed' });
    });

    it('ignores solid lines and absent hatching', () => {
        expect(collectDegradedStyle({ lineStyle: 'solid' })).toEqual({});
        expect(collectDegradedStyle({})).toEqual({});
    });

    it('records hatch settings', () => {
        const degraded = collectDegradedStyle({
            hatchEnabled: true,
            hatchType: 'diagonal',
            hatchColor: '#123456',
            hatchSpacing: 8,
        });
        expect(degraded.hatchEnabled).toBe('true');
        expect(degraded.hatchType).toBe('diagonal');
        expect(degraded.hatchSpacing).toBe('8');
    });
});

describe('style fragment builders', () => {
    it('emit well-formed KML elements', () => {
        expect(buildLineStyle({ lineColor: '#ff0000', lineWidth: 3 }))
            .toBe('<LineStyle><color>ff0000ff</color><width>3</width></LineStyle>');

        expect(buildPolyStyle({ fillColor: '#ff0000', opacity: 1 }))
            .toContain('<fill>1</fill>');

        expect(buildPolyStyle({ fillColor: '#ff0000', opacity: 0 }))
            .toContain('<fill>0</fill>');
    });

    it('omits the Icon element when no href is given', () => {
        expect(buildIconStyle({ scale: 1 })).not.toContain('<Icon>');
        expect(buildIconStyle({ href: 'files/a.png' })).toContain('<href>files/a.png</href>');
    });

    it('normalizes heading inside IconStyle', () => {
        expect(buildIconStyle({ heading: -90 })).toContain('<heading>270</heading>');
    });

    it('builds a label style with a positive scale', () => {
        expect(buildLabelStyle({ color: '#ffffff', scale: 0 })).toContain('<scale>1</scale>');
    });
});

/**
 * O `<hotSpot>` do KML e o unico lugar onde a ancora de um icone existe no arquivo
 * exportado. Enquanto ele foi fixo em 0.5/0.5, toda medida de coordenacao com
 * `anchor: 'bottom'` saia meio simbolo deslocada no Google Earth, e o nucleo passou
 * a carregar tambem um `iconOffset` que ninguem traduzia. Nada reprova isso: o KML
 * e valido, o icone so aparece no lugar errado.
 *
 * Convencao: o MapLibre mede do CANTO SUPERIOR ESQUERDO, o KML mede da esquerda e
 * de BAIXO. O eixo y e invertido, e e nele que um erro de sinal se esconde.
 */
describe('iconHotSpot', () => {
    it('um bitmap ancorado pelo centro fica no centro', () => {
        expect(iconHotSpot({ width: 100, height: 100 })).toEqual({ x: 0.5, y: 0.5 });
        expect(iconHotSpot({ anchor: 'center', width: 78, height: 53 }))
            .toEqual({ x: 0.5, y: 0.5 });
    });

    it("anchor 'bottom' leva o ponto para a base do bitmap (y = 0 no KML)", () => {
        expect(iconHotSpot({ anchor: 'bottom', width: 40, height: 100 }))
            .toEqual({ x: 0.5, y: 0 });
    });

    it("anchor 'top' leva o ponto para o topo (y = 1 no KML)", () => {
        expect(iconHotSpot({ anchor: 'top', width: 40, height: 100 }))
            .toEqual({ x: 0.5, y: 1 });
    });

    it('as ancoras compostas valem nos dois eixos', () => {
        expect(iconHotSpot({ anchor: 'bottom-left', width: 100, height: 100 }))
            .toEqual({ x: 0, y: 0 });
        expect(iconHotSpot({ anchor: 'top-right', width: 100, height: 100 }))
            .toEqual({ x: 1, y: 1 });
    });

    it('o iconOffset do nucleo desce o ponto de ancoragem', () => {
        // Nucleo: offset [0, 12] em 100 px logicos de altura, ancora no centro.
        // y = 1 - (0.5 - 12/100) = 0.62
        expect(iconHotSpot({ iconOffset: [0, 12], width: 100, height: 100 }))
            .toEqual({ x: 0.5, y: 0.62 });
    });

    it('o deslocamento horizontal anda para a ESQUERDA quando dx e positivo', () => {
        // dx positivo move o ICONE para a direita, logo o ponto fica mais a esquerda
        // dentro do bitmap.
        expect(iconHotSpot({ iconOffset: [25, 0], width: 100, height: 100 }))
            .toEqual({ x: 0.25, y: 0.5 });
    });

    it('ancora e deslocamento se somam', () => {
        // bottom + dy 10 em 100: y = 1 - (1 - 0.1) = 0.1
        expect(iconHotSpot({ anchor: 'bottom', iconOffset: [0, 10], width: 100, height: 100 }))
            .toEqual({ x: 0.5, y: 0.1 });
    });

    it('WORST CASE: sem tamanho utilizavel volta ao centro', () => {
        const degenerados = [
            {},
            { width: 0, height: 100 },
            { width: 100, height: 0 },
            { width: NaN, height: 100 },
            { width: Infinity, height: 100 },
            { width: -10, height: 100 },
            { width: '100', height: '100' },
            { iconOffset: [0, 12] },
        ];

        for (const entrada of degenerados) {
            expect(iconHotSpot(entrada), JSON.stringify(entrada))
                .toEqual({ x: 0.5, y: 0.5 });
        }
        expect(iconHotSpot()).toEqual({ x: 0.5, y: 0.5 });
    });

    it('WORST CASE: um iconOffset corrompido vale zero, nao NaN', () => {
        const lixos = [null, 'nao sou array', [1], [NaN, NaN], ['a', 'b'], [Infinity, 0]];

        for (const iconOffset of lixos) {
            expect(iconHotSpot({ iconOffset, width: 100, height: 100 }), String(iconOffset))
                .toEqual({ x: 0.5, y: 0.5 });
        }
    });

    it('um deslocamento absurdo e cortado em [0, 1], sem -0', () => {
        const alto = iconHotSpot({ iconOffset: [500, -500], width: 100, height: 100 });
        expect(alto).toEqual({ x: 0, y: 0 });
        expect(Object.is(alto.x, -0)).toBe(false);
        expect(iconHotSpot({ iconOffset: [-500, 500], width: 100, height: 100 }))
            .toEqual({ x: 1, y: 1 });
    });
});

describe('buildIconStyle e o hotSpot', () => {
    it('sem hotSpot mantem o centro, como sempre foi', () => {
        expect(buildIconStyle({ href: 'files/a.png' }))
            .toContain('<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>');
    });

    it('escreve o hotSpot recebido', () => {
        expect(buildIconStyle({ hotSpot: { x: 0.5, y: 0.62 } }))
            .toContain('<hotSpot x="0.5" y="0.62"');
    });

    it('WORST CASE: um hotSpot invalido nao vaza NaN para o XML', () => {
        expect(buildIconStyle({ hotSpot: { x: NaN, y: 3 } }))
            .toContain('<hotSpot x="0.5" y="1"');
    });
});
