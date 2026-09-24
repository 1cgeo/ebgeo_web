// Path: js/import_export/texto-de-arquivo.js

/**
 * @fileoverview How the bytes of an imported text file become text. ZERO imports, testable in node.
 *
 * WHY IT EXISTS. Every reader used to decode as UTF-8 whatever the file was (`file.text()`,
 * `FileReader.readAsText`, JSZip's `'string'`, and the DBF decoder of `shpjs` when no `.cpg` is
 * present). The files people bring are often not UTF-8: a CSV saved by Excel in pt-BR is
 * Windows-1252, a Brazilian DBF is Windows-1252 with no `.cpg`, and an older KML or GPX declares
 * `encoding="ISO-8859-1"`. Decoded as UTF-8, every accented byte of those files became U+FFFD
 * ("Bras�lia"), which is irreversible once the feature is saved.
 *
 * THE RULE, in order:
 *   1. a byte order mark decides (UTF-8, UTF-16 LE, UTF-16 BE), and it is not part of the text;
 *   2. otherwise the bytes are UTF-8 when they LOOK like UTF-8 ({@link pareceUtf8}): more valid
 *      multibyte sequences than invalid bytes, or no byte above 0x7F at all;
 *   3. otherwise a single-byte encoding: the one an XML declaration names, when the decoder
 *      supports it and it is not UTF-16, and Windows-1252 when there is none.
 *
 * WHY THE VALIDITY OF THE BYTES BEATS THE DECLARATION (review of 2026-09-23, three regressions of
 * the first version, which honored the declaration first and treated ONE bad byte as "not UTF-8"):
 *   - an XML that declares ISO-8859-1 and carries valid UTF-8 bytes (an editor that kept the
 *     header) came out "SÃ£o Paulo"; before any of this it was read right;
 *   - an XML that declares `encoding="utf-16"` with 8-bit bytes (a known defect of .NET's
 *     XmlWriter over a StringWriter) was decoded as UTF-16 into CJK garbage. If the ASCII test
 *     could read the declaration at all, the file is not UTF-16: that label is ignored;
 *   - a UTF-8 file with ONE broken byte (a truncated file, a DBF field cut in the middle of a
 *     character by its fixed width) turned whole into Windows-1252, mojibaking every correct
 *     accent, where before only that one character was lost. Counting decides now: a real
 *     Windows-1252 text has accented letters as lone bytes and almost no valid multibyte
 *     sequence, a real UTF-8 text has many and at most a few broken ones.
 * Windows-1252 and not ISO-8859-1 because the WHATWG decoder maps the ISO-8859-1 label to
 * Windows-1252 anyway, and it is what Excel and the Brazilian GIS tools write.
 */

/** The fallback for bytes that are not UTF-8 and name no other encoding. */
export const CODIFICACAO_DE_RESERVA = 'windows-1252';

/**
 * @param {ArrayBuffer|ArrayBufferView} dados
 * @returns {Uint8Array}
 */
function comoBytes(dados) {
    if (dados instanceof Uint8Array) return dados;
    if (ArrayBuffer.isView(dados)) return new Uint8Array(dados.buffer, dados.byteOffset, dados.byteLength);
    if (dados instanceof ArrayBuffer) return new Uint8Array(dados);
    throw new TypeError('decodificarTexto: esperava bytes (ArrayBuffer ou TypedArray)');
}

/**
 * @param {Uint8Array} bytes
 * @returns {string|null} The encoding a byte order mark names, or null.
 */
function codificacaoDoBom(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    return null;
}

/**
 * The encoding named by an XML declaration, when the decoder supports it.
 * @param {ArrayBuffer|ArrayBufferView} dados
 * @returns {string|null} The decoder's canonical name, or null.
 */
export function codificacaoDeclaradaNoXml(dados) {
    const bytes = comoBytes(dados);
    // The declaration is ASCII by definition, so reading the head as single bytes is exact.
    const cabeca = String.fromCharCode(...bytes.subarray(0, 200));
    const achado = /^\s*<\?xml\b[^>]*?\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(cabeca);
    if (!achado) return null;
    try {
        return new TextDecoder(achado[1]).encoding;
    } catch {
        return null;
    }
}

/**
 * Counts the valid UTF-8 multibyte sequences and the bytes that cannot start or continue one.
 * @param {Uint8Array} bytes
 * @returns {{validas: number, invalidos: number}}
 */
export function contarSequenciasUtf8(bytes) {
    let validas = 0;
    let invalidos = 0;
    const cont = (b) => b >= 0x80 && b <= 0xbf;
    for (let i = 0; i < bytes.length;) {
        const b = bytes[i];
        if (b < 0x80) { i++; continue; }
        let n = 0;
        let min2 = 0x80;
        let max2 = 0xbf;
        if (b >= 0xc2 && b <= 0xdf) {
            n = 2;
        } else if (b >= 0xe0 && b <= 0xef) {
            n = 3;
            if (b === 0xe0) min2 = 0xa0;
            if (b === 0xed) max2 = 0x9f;
        } else if (b >= 0xf0 && b <= 0xf4) {
            n = 4;
            if (b === 0xf0) min2 = 0x90;
            if (b === 0xf4) max2 = 0x8f;
        }
        let ok = n > 0 && i + n <= bytes.length && bytes[i + 1] >= min2 && bytes[i + 1] <= max2;
        for (let k = 2; ok && k < n; k++) ok = cont(bytes[i + k]);
        if (ok) { validas++; i += n; } else { invalidos++; i++; }
    }
    return { validas, invalidos };
}

/**
 * Do these bytes look like UTF-8? True for pure ASCII, and when valid multibyte sequences
 * outnumber the bytes that are not UTF-8.
 * @param {ArrayBuffer|ArrayBufferView} dados
 * @returns {boolean}
 */
export function pareceUtf8(dados) {
    const { validas, invalidos } = contarSequenciasUtf8(comoBytes(dados));
    return invalidos === 0 || validas > invalidos;
}

/**
 * Are these bytes strictly valid UTF-8?
 * @param {ArrayBuffer|ArrayBufferView} dados
 * @returns {boolean}
 */
export function ehUtf8Valido(dados) {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(comoBytes(dados));
        return true;
    } catch {
        return false;
    }
}

/**
 * Decodes the bytes of an imported text file (see the `@fileoverview` for the rule).
 * @param {ArrayBuffer|ArrayBufferView} dados
 * @param {{xml?: boolean}} [opcoes] - `xml: true` lets an XML declaration name the single-byte
 *   encoding of a file that is not UTF-8.
 * @returns {string}
 */
export function decodificarTexto(dados, { xml = false } = {}) {
    const bytes = comoBytes(dados);
    const doBom = codificacaoDoBom(bytes);
    if (doBom) return new TextDecoder(doBom).decode(bytes);

    if (pareceUtf8(bytes)) return new TextDecoder('utf-8').decode(bytes);

    let alternativa = CODIFICACAO_DE_RESERVA;
    if (xml) {
        const declarada = codificacaoDeclaradaNoXml(bytes);
        if (declarada && declarada !== 'utf-8' && !declarada.startsWith('utf-16')) alternativa = declarada;
    }
    return new TextDecoder(alternativa).decode(bytes);
}

/**
 * Does this DBF need a `.cpg` naming Windows-1252 to be read right?
 *
 * The reader decodes a DBF with no `.cpg` as UTF-8. Only the RECORDS are text; the header is
 * binary (counts and lengths above 0x7F are ordinary), so the test skips it, using the header
 * length the file itself declares at bytes 8 and 9. The same counting rule as the text files: a
 * UTF-8 DBF with a field cut in the middle of a character stays UTF-8.
 * @param {ArrayBuffer|ArrayBufferView} dados - The whole `.dbf`.
 * @returns {boolean} True when the records do not look like UTF-8.
 */
export function dbfPrecisaDeCpg(dados) {
    const bytes = comoBytes(dados);
    if (bytes.length < 32) return false;
    const tamanhoDoCabecalho = bytes[8] | (bytes[9] << 8);
    if (tamanhoDoCabecalho <= 0 || tamanhoDoCabecalho >= bytes.length) return false;
    return !pareceUtf8(bytes.subarray(tamanhoDoCabecalho));
}
