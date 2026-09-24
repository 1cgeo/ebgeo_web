// Path: tests/unit/csv-aspas-no-meio-do-campo.repro.test.js

/**
 * REPRO: a CSV of GMS coordinates imported ZERO points, because the parser read the seconds mark
 * (`"`) as the start of a quoted field.
 *
 * THE CAUSE. `import_export/csv/csv-parser.js` opened a quoted section on ANY `"` of an unquoted
 * field, in three places (`_parseLine`, `_splitLines`, `detectSeparator`). RFC 4180 opens quoting
 * only at the START of a field; in the middle of one the quote is a literal. The "Lat/Long (GMS)"
 * format the panel offers is written exactly that way (`22°57'6.898"S`, the shape of the
 * converter's own unit tests), so in `22°57'6.898"S;43°12'37.753"W` the text between the two marks,
 * separator included, became one field: every row lost a column, every coordinate was invalid, and
 * the import brought nothing. With ONE mark per line (a single GMS column) the line splitter also
 * stayed "inside quotes" across the newline and glued the rows together.
 *
 * The converter tests never saw it because they feed rows to `convertRowToLatLng` directly, not
 * through the parser. Measured on 2026-09-24 through the Importar tab in real Chromium
 * (`tests/e2e-ui/cobertura-importar-csv-coordenadas.spec.js`): 0 of 2 points.
 */

import { describe, it, expect } from 'vitest';
import { parseCSV, parseCSVPreview, detectSeparator } from '@js/import_export/csv/csv-parser.js';

const GMS = 'nome;lat;lon;Obs\n'
    + 'Cristo;22°57\'6.898"S;43°12\'37.753"W;x\n'
    + 'Praça;22°48\'0.000"S;43°54\'0.000"W;y\n';

describe('CSV: a quote in the MIDDLE of a field is a literal', () => {
    it('GMS with the seconds mark keeps its four columns per row', () => {
        const { headers, rows } = parseCSV(GMS, ';');
        expect(headers).toEqual(['nome', 'lat', 'lon', 'Obs']);
        expect(rows).toEqual([
            { nome: 'Cristo', lat: '22°57\'6.898"S', lon: '43°12\'37.753"W', Obs: 'x' },
            { nome: 'Praça', lat: '22°48\'0.000"S', lon: '43°54\'0.000"W', Obs: 'y' },
        ]);
    });

    it('one mark per line does not glue the lines together', () => {
        const texto = 'nome;lat\nA;22°57\'6.898"S\nB;22°48\'0"S\nC;10°0\'0"N\n';
        const { rows } = parseCSV(texto, ';');
        expect(rows.map((r) => [r.nome, r.lat])).toEqual([['A', '22°57\'6.898"S'], ['B', '22°48\'0"S'], ['C', '10°0\'0"N']]);
        expect(parseCSVPreview(texto, ';').totalRows).toBe(3);
    });

    it('the separator is detected with the marks in the fields', () => {
        expect(detectSeparator(GMS)).toBe(';');
    });

    it('CONTROL: a field that STARTS with a quote is still a quoted field (RFC 4180)', () => {
        const texto = 'a,b,c\n"x, com vírgula","linha\nquebrada","com ""aspas"""\n  "com espaço antes",2,3\n';
        const { rows } = parseCSV(texto, ',');
        expect(rows[0]).toEqual({ a: 'x, com vírgula', b: 'linha\nquebrada', c: 'com "aspas"' });
        expect(rows[1]).toEqual({ a: 'com espaço antes', b: '2', c: '3' });
    });
});
