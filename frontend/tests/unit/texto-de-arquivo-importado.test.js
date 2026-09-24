// Path: tests/unit/texto-de-arquivo-importado.test.js

/**
 * The decoding rule of imported text files (`src/js/import_export/texto-de-arquivo.js`).
 *
 * The browser half of the defect (a Windows-1252 CSV, DBF or KML arriving with U+FFFD in place of
 * every accent, and a ZIP with two shapefiles importing one) is proven end to end by
 * `tests/e2e-ui/importar-arquivo-codificacao-e-camadas.spec.js`. This file pins the rule itself,
 * edges included, in node.
 */

import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import fc from 'fast-check';
import {
    decodificarTexto,
    ehUtf8Valido,
    dbfPrecisaDeCpg,
    codificacaoDeclaradaNoXml,
    CODIFICACAO_DE_RESERVA,
} from '../../src/js/import_export/texto-de-arquivo.js';
import { dbfDeTexto } from '../helpers/shapefile-sintetico.js';

const ACENTOS = 'Brasília, São João, Ação, Área, Pôr, açaí, Ü, ç, Ç, º, ª';

describe('decodificarTexto', () => {
    it('Windows-1252 (Excel pt-BR) comes out with its accents', () => {
        const texto = decodificarTexto(Buffer.from(ACENTOS, 'latin1'));
        expect(texto).toBe(ACENTOS);
        expect(texto).not.toContain('�');
    });

    it('CONTROL: valid UTF-8 stays UTF-8 (a fix that forced 1252 would mangle it)', () => {
        expect(decodificarTexto(Buffer.from(ACENTOS, 'utf8'))).toBe(ACENTOS);
    });

    it('the UTF-8 BOM decides and is not part of the text', () => {
        const comBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('lat;lon', 'utf8')]);
        expect(decodificarTexto(comBom)).toBe('lat;lon');
    });

    it('UTF-16 LE and BE with BOM (Excel "texto Unicode") decode', () => {
        const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('São', 'utf16le')]);
        expect(decodificarTexto(le)).toBe('São');
        const be = Buffer.from(le);
        be[0] = 0xfe; be[1] = 0xff;
        for (let i = 2; i < be.length; i += 2) [be[i], be[i + 1]] = [le[i + 1], le[i]];
        expect(decodificarTexto(be)).toBe('São');
    });

    it('ASCII and empty input', () => {
        expect(decodificarTexto(Buffer.from('abc'))).toBe('abc');
        expect(decodificarTexto(new Uint8Array(0))).toBe('');
    });

    it('accepts ArrayBuffer, Uint8Array and a view with an offset', () => {
        const buf = Buffer.from(`xx${ACENTOS}`, 'latin1');
        const vista = new DataView(buf.buffer, buf.byteOffset + 2, buf.byteLength - 2);
        expect(decodificarTexto(vista)).toBe(ACENTOS);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        expect(decodificarTexto(ab)).toBe(`xx${ACENTOS}`);
    });

    it('refuses what is not bytes, instead of decoding "[object Object]"', () => {
        expect(() => decodificarTexto('texto')).toThrow(TypeError);
        expect(() => decodificarTexto(null)).toThrow(TypeError);
    });

    it('XML: a declared ISO-8859-1 is honored even when the bytes would pass as UTF-8 elsewhere', () => {
        const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><a>Região</a>';
        expect(decodificarTexto(Buffer.from(xml, 'latin1'), { xml: true })).toContain('Região');
    });

    it('XML: a declared UTF-8 that is not UTF-8 falls back instead of producing U+FFFD', () => {
        const xml = '<?xml version="1.0" encoding="UTF-8"?><a>Região</a>';
        expect(decodificarTexto(Buffer.from(xml, 'latin1'), { xml: true })).toContain('Região');
    });

    it('XML: an unknown label is ignored, and the validity rule decides', () => {
        const xml = '<?xml version="1.0" encoding="x-inventado"?><a>Região</a>';
        expect(decodificarTexto(Buffer.from(xml, 'utf8'), { xml: true })).toContain('Região');
    });

    it('PROPERTY: any string survives both encodings it fits in', () => {
        fc.assert(fc.property(fc.string({ unit: 'grapheme' }), (s) => {
            expect(decodificarTexto(Buffer.from(s, 'utf8'))).toBe(s);
        }));
        // Portuguese text in Windows-1252: ASCII plus the accented letters, all of which are
        // bytes >= 0xC0, so no letter can be read as a UTF-8 continuation byte.
        const letras = 'abcçdefghijklmnopqrstuvwxyz ÁÂÃÀÉÊÍÓÔÕÚÇáâãàéêíóôõúü0123456789,;.';
        const portugues = fc.string({ unit: fc.constantFrom(...letras) });
        fc.assert(fc.property(portugues, (s) => {
            expect(decodificarTexto(Buffer.from(s, 'latin1'))).toBe(s);
        }));
    });

    it('KNOWN LIMIT: a lead byte followed by a symbol byte is valid UTF-8 and reads as UTF-8', () => {
        // Found by the property above with the whole Latin-1 range: "Â" + NBSP is C2 A0, which
        // is the UTF-8 of NBSP. The rule cannot tell them apart and no rule can without a
        // declaration; in Portuguese text a letter is never followed by 0x80..0xBF, which is why
        // the property is written over letters. Pinned so the limit is a fact, not a surprise.
        expect(decodificarTexto(Buffer.from('Â ', 'latin1'))).toBe(' ');
    });
});

describe('codificacaoDeclaradaNoXml', () => {
    it('reads the label and normalizes it', () => {
        const b = Buffer.from("<?xml version='1.0' encoding='iso-8859-1'?><x/>");
        expect(codificacaoDeclaradaNoXml(b)).toBe(CODIFICACAO_DE_RESERVA);
    });
    it('null without a declaration or with an unknown label', () => {
        expect(codificacaoDeclaradaNoXml(Buffer.from('<x/>'))).toBeNull();
        expect(codificacaoDeclaradaNoXml(Buffer.from('<?xml encoding="nada"?>'))).toBeNull();
    });
});

describe('dbfPrecisaDeCpg', () => {
    const campos = [{ nome: 'MUNICIPIO', tamanho: 20 }];

    it('a Windows-1252 DBF needs one', () => {
        expect(dbfPrecisaDeCpg(dbfDeTexto(campos, [{ MUNICIPIO: 'Brasília' }], { codificacao: 'latin1' })))
            .toBe(true);
    });

    it('CONTROL: a UTF-8 DBF and an ASCII DBF do not', () => {
        expect(dbfPrecisaDeCpg(dbfDeTexto(campos, [{ MUNICIPIO: 'Brasília' }], { codificacao: 'utf8' })))
            .toBe(false);
        expect(dbfPrecisaDeCpg(dbfDeTexto(campos, [{ MUNICIPIO: 'Brasilia' }]))).toBe(false);
    });

    it('CONTROL: the binary header is not judged (a record count above 0x7F is ordinary)', () => {
        const linhas = Array.from({ length: 200 }, () => ({ MUNICIPIO: 'Rio' }));
        const dbf = dbfDeTexto(campos, linhas);
        expect(dbf[4]).toBeGreaterThan(0x7f);
        expect(ehUtf8Valido(dbf)).toBe(false);
        expect(dbfPrecisaDeCpg(dbf)).toBe(false);
    });

    it('a truncated or degenerate buffer answers false instead of throwing', () => {
        expect(dbfPrecisaDeCpg(new Uint8Array(10))).toBe(false);
        expect(dbfPrecisaDeCpg(new Uint8Array(64))).toBe(false);
    });
});
