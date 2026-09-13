import { describe, it, expect } from 'vitest';
import {
    parseAtlasParams,
    buildAtlasSearch,
    setPendingAtlasLink,
    consumePendingAtlasLink,
} from '../../src/js/deep-link/atlas-link.js';

const ATLAS = '550e8400-e29b-41d4-a716-446655440000';
const MAP = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('parseAtlasParams', () => {
    it('parses ?atlas=<uuid> with no map', () => {
        expect(parseAtlasParams(`?atlas=${ATLAS}`)).toEqual({ atlasId: ATLAS, mapId: null });
    });

    it('parses ?atlas=<uuid>&map=<uuid>', () => {
        expect(parseAtlasParams(`?atlas=${ATLAS}&map=${MAP}`)).toEqual({ atlasId: ATLAS, mapId: MAP });
    });

    it('tolerates the leading "?" being absent', () => {
        expect(parseAtlasParams(`atlas=${ATLAS}`)).toEqual({ atlasId: ATLAS, mapId: null });
    });

    it('returns null when there is no atlas param', () => {
        expect(parseAtlasParams('?map=' + MAP)).toBeNull();
        expect(parseAtlasParams('')).toBeNull();
        expect(parseAtlasParams(undefined)).toBeNull();
    });

    it('returns null for a non-UUID atlas (no leaking arbitrary ids into connect)', () => {
        expect(parseAtlasParams('?atlas=Principal')).toBeNull();
        expect(parseAtlasParams('?atlas=123')).toBeNull();
    });

    it('drops an invalid map id but still opens the atlas', () => {
        expect(parseAtlasParams(`?atlas=${ATLAS}&map=notauuid`)).toEqual({ atlasId: ATLAS, mapId: null });
    });
});

describe('buildAtlasSearch', () => {
    it('writes atlas + map from an empty search', () => {
        expect(buildAtlasSearch('', ATLAS, MAP)).toBe(`?atlas=${ATLAS}&map=${MAP}`);
    });

    it('writes only atlas when mapId is null and there is no existing map', () => {
        expect(buildAtlasSearch('', ATLAS, null)).toBe(`?atlas=${ATLAS}`);
    });

    it('PRESERVES an existing map param when mapId is null (no UUID→name downgrade)', () => {
        const out = buildAtlasSearch(`?atlas=${ATLAS}&map=${MAP}`, ATLAS, null);
        expect(new URLSearchParams(out).get('map')).toBe(MAP);
    });

    // A PRESERVACAO ACIMA VALE SO DENTRO DO MESMO ATLAS. Numa troca AO VIVO (`switchAtlas`, sem
    // recarga) o `?atlas=` muda e o `?map=` de origem e um UUID valido, entao ele sobrevivia ao
    // teste de "bom" e a barra publicava um par impossivel: atlas novo, mapa do anterior. Como a
    // URL e a fonte da verdade do roteamento do boot, um F5 ali abre o atlas certo pedindo o mapa
    // errado.
    it('DESCARTA o map do atlas ANTERIOR quando o atlas muda e mapId e nulo', () => {
        const OUTRO = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
        const out = buildAtlasSearch(`?atlas=${ATLAS}&map=${MAP}`, OUTRO, null);
        expect(new URLSearchParams(out).get('atlas')).toBe(OUTRO);
        expect(new URLSearchParams(out).get('map')).toBeNull();
    });

    it('e o map pedido EXPLICITAMENTE vence na troca de atlas', () => {
        const OUTRO = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
        const MAPA_NOVO = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
        const out = buildAtlasSearch(`?atlas=${ATLAS}&map=${MAP}`, OUTRO, MAPA_NOVO);
        expect(new URLSearchParams(out).get('map')).toBe(MAPA_NOVO);
    });

    it('sem atlas anterior na URL, o map existente continua preservado', () => {
        // A PRIMEIRA escrita da URL: um `?map=` sozinho so pode ter vindo do link que trouxe a
        // pessoa, entao descarta-lo perderia o mapa que ela pediu.
        const out = buildAtlasSearch(`?map=${MAP}`, ATLAS, null);
        expect(new URLSearchParams(out).get('map')).toBe(MAP);
    });

    it('drops the one-shot/anonymous params (atlasPublico, verify)', () => {
        const out = buildAtlasSearch('?atlasPublico=abc&verify=tok', ATLAS, null);
        expect(out).toBe(`?atlas=${ATLAS}`);
    });

    it('preserves an unrelated param', () => {
        const out = buildAtlasSearch('?debug=1', ATLAS, MAP);
        const params = new URLSearchParams(out);
        expect(params.get('debug')).toBe('1');
        expect(params.get('atlas')).toBe(ATLAS);
        expect(params.get('map')).toBe(MAP);
    });

    it('strips atlas + map when atlasId is falsy (logout/disconnect)', () => {
        expect(buildAtlasSearch(`?atlas=${ATLAS}&map=${MAP}`, null, null)).toBe('');
        expect(buildAtlasSearch(`?atlas=${ATLAS}&keep=1`, null, null)).toBe('?keep=1');
    });

    it('PRESERVES atlasPublico when clearing — an anonymous public viewer must keep its link', () => {
        expect(buildAtlasSearch('?atlasPublico=abc123', null, null)).toBe('?atlasPublico=abc123');
        // atlas/map still go; the public link stays.
        expect(buildAtlasSearch(`?atlas=${ATLAS}&atlasPublico=abc`, null, null)).toBe('?atlasPublico=abc');
    });

    it('replaces a stale map when switching maps', () => {
        const out = buildAtlasSearch(`?atlas=${ATLAS}&map=${MAP}`, ATLAS, ATLAS);
        expect(new URLSearchParams(out).get('map')).toBe(ATLAS);
    });
});

describe('pending atlas link (login resume)', () => {
    it('returns the stored link once, then null', () => {
        setPendingAtlasLink({ atlasId: ATLAS, mapId: MAP });
        expect(consumePendingAtlasLink()).toEqual({ atlasId: ATLAS, mapId: MAP });
        expect(consumePendingAtlasLink()).toBeNull();
    });

    it('starts empty', () => {
        // (after the consume above) — defensive: a fresh consume with nothing set is null.
        setPendingAtlasLink(null);
        expect(consumePendingAtlasLink()).toBeNull();
    });
});
