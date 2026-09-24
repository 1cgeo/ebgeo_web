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
 *   2. for XML, a supported encoding named by the XML declaration decides;
 *   3. otherwise the bytes are UTF-8 if they are VALID UTF-8, and Windows-1252 if not.
 *
 * Step 3 is safe in both directions: a valid UTF-8 file stays UTF-8 (an ASCII file is both), and a
 * Windows-1252 file with accents is almost never valid UTF-8, because each of its accented letters
 * is a lone byte above 0x7F. Windows-1252 and not ISO-8859-1 because the WHATWG decoder maps the
 * ISO-8859-1 label to Windows-1252 anyway, and it is what Excel and the Brazilian GIS tools write.
 */

/** The fallback for bytes that are not valid UTF-8. */
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
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
export function codificacaoDeclaradaNoXml(bytes) {
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
 * Are these bytes valid UTF-8?
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
 * @param {{xml?: boolean}} [opcoes] - `xml: true` honors the XML declaration's encoding.
 * @returns {string}
 */
export function decodificarTexto(dados, { xml = false } = {}) {
    const bytes = comoBytes(dados);
    const doBom = codificacaoDoBom(bytes);
    if (doBom) return new TextDecoder(doBom).decode(bytes);

    if (xml) {
        const declarada = codificacaoDeclaradaNoXml(bytes);
        // A declared UTF-8 falls through to the validity test: a file that says UTF-8 and is not
        // is common enough (an editor that kept the header and changed the bytes).
        if (declarada && declarada !== 'utf-8') return new TextDecoder(declarada).decode(bytes);
    }

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder(CODIFICACAO_DE_RESERVA).decode(bytes);
    }
}

/**
 * Does this DBF need a `.cpg` naming Windows-1252 to be read right?
 *
 * The reader decodes a DBF with no `.cpg` as UTF-8. Only the RECORDS are text; the header is
 * binary (counts and lengths above 0x7F are ordinary), so the test skips it, using the header
 * length the file itself declares at bytes 8 and 9.
 * @param {ArrayBuffer|ArrayBufferView} dados - The whole `.dbf`.
 * @returns {boolean} True when the records are not valid UTF-8.
 */
export function dbfPrecisaDeCpg(dados) {
    const bytes = comoBytes(dados);
    if (bytes.length < 32) return false;
    const tamanhoDoCabecalho = bytes[8] | (bytes[9] << 8);
    if (tamanhoDoCabecalho <= 0 || tamanhoDoCabecalho >= bytes.length) return false;
    return !ehUtf8Valido(bytes.subarray(tamanhoDoCabecalho));
}
