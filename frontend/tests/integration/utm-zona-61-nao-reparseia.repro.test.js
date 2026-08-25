// Path: tests/integration/utm-zona-61-nao-reparseia.repro.test.js

/**
 * @fileoverview Repro: the coordinate converter wrote a UTM string it could not read back.
 *
 * ROOT CAUSE. `getUtmZone` (`js/utilities/coordinate_converter.js`) was
 * `Math.floor((lng + 180) / 6) + 1` with no clamp. At longitude exactly 180, a legal
 * value everywhere else in the module, that is 61, and UTM zone 61 does not exist.
 *
 * WHAT IT COST. `formatCoordinates(0, 180, 'utm_wgs84')` produced `61N 166021 0`, and
 * `parseCoordinates` of that very string returned null, because `parseUTMWGS84` refuses
 * zone > 60. The app showed a coordinate the app itself could not accept back: whoever
 * copied what was on screen got nothing.
 *
 * FIX. Clamp to [1, 60], the same shape `_utmZone` in the PDF module already used.
 *
 * The placeholder half of this file is here too, because it is the same contract seen
 * from the other side: the four format hints must be the SAME place, and each must
 * parse in its own format. The UTM hint used to advertise the MGRS band letter
 * (`23K ...`), which `parseUTMWGS84` does not accept, so copying the hint verbatim
 * also produced nothing.
 */

import { describe, it, expect } from 'vitest';
import {
    COORDINATE_FORMATS,
    formatCoordinates,
    parseCoordinates,
    getPlaceholderForFormat,
} from '../../src/js/utilities/coordinate_converter.js';

describe('o que a UTM escreve, a UTM le de volta', () => {
    it('o antimeridiano exato nao produz mais a zona 61', () => {
        const written = formatCoordinates(0, 180, 'utm_wgs84');
        const zone = Number(written.match(/^(\d+)/)[1]);
        expect(zone).toBe(60);

        const back = parseCoordinates(written, 'utm_wgs84');
        expect(back).not.toBeNull();
        expect(back.lat).toBeCloseTo(0, 4);
        // Volta como -179.999996: a zona 60 tem o proprio embrulho, e as duas
        // grafias sao o mesmo ponto fisico.
        expect(Math.abs(back.lng)).toBeGreaterThan(179.999);
    });

    it('o extremo inferior tambem esta preso, e nao produz a zona 0', () => {
        const zone = Number(formatCoordinates(0, -180, 'utm_wgs84').match(/^(\d+)/)[1]);
        expect(zone).toBe(1);
        expect(Number(formatCoordinates(0, -180.5, 'utm_wgs84').match(/^(\d+)/)[1])).toBe(1);
    });

    it('CONTROLE: o clamp nao achatou as zonas legitimas', () => {
        // Sem isto "sempre 60" passaria no caso acima e destruiria todo o resto.
        expect(formatCoordinates(0, -45, 'utm_wgs84').startsWith('23N ')).toBe(true);
        expect(formatCoordinates(0, 0, 'utm_wgs84').startsWith('31N ')).toBe(true);
        expect(formatCoordinates(0, 179.9999999, 'utm_wgs84').startsWith('60N ')).toBe(true);
    });

    it('o ida e volta se fecha ao longo de todo o intervalo de longitude', () => {
        for (let lng = -180; lng <= 180; lng += 7.5) {
            const written = formatCoordinates(-22.5, lng, 'utm_wgs84');
            const back = parseCoordinates(written, 'utm_wgs84');
            expect(back, String(lng)).not.toBeNull();
            expect(Number.isFinite(back.lat), String(lng)).toBe(true);
        }
    });
});

describe('as quatro dicas de formato apontam para o mesmo lugar e parseiam nele', () => {
    const RESENDE = { lat: -22.455921, lng: -44.449655 };

    it('cada dica e exatamente o que o formatador escreve para Resende', () => {
        for (const { id } of COORDINATE_FORMATS) {
            expect(formatCoordinates(RESENDE.lat, RESENDE.lng, id), id)
                .toBe(getPlaceholderForFormat(id));
        }
        // Cobertura vazia passaria verde se a lista estivesse vazia.
        expect(COORDINATE_FORMATS.length).toBe(4);
    });

    it('cada dica parseia no PROPRIO formato e cai no mesmo ponto', () => {
        for (const { id } of COORDINATE_FORMATS) {
            const point = parseCoordinates(getPlaceholderForFormat(id), id);
            expect(point, id).not.toBeNull();
            expect(Math.abs(point.lat - RESENDE.lat), id).toBeLessThan(1e-3);
            expect(Math.abs(point.lng - RESENDE.lng), id).toBeLessThan(1e-3);
        }
    });
});
