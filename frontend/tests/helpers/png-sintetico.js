// Path: tests/helpers/png-sintetico.js

/**
 * PNG files built chunk by chunk, still or ANIMATED, for the tests of the type the client decides
 * for a PNG (`tipoDePng`, `src/js/utilities/image_utils.js`). The chunks carry real CRCs and real
 * zlib data, so the same bytes are decoded by a browser (the Playwright specs) and read by the
 * server's detector (the contract spec), not only by the walk under test.
 *
 * Node only (`node:zlib`); a browser spec builds the file here and hands it to the page as base64.
 */

import { deflateSync, crc32 } from 'node:zlib';
import { Buffer } from 'node:buffer';

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * One chunk: length, type, data, CRC of type and data.
 * @param {string} tipo - Four latin1 characters
 * @param {Uint8Array|Buffer} [dados]
 * @param {Object} [opcoes]
 * @param {number} [opcoes.comprimento] - A length that lies about the data, for malformed files
 * @returns {Buffer}
 */
export function pedacoPng(tipo, dados = Buffer.alloc(0), { comprimento } = {}) {
    const t = Buffer.from(tipo, 'latin1');
    const d = Buffer.from(dados);
    const cabeca = Buffer.alloc(4);
    cabeca.writeUInt32BE((comprimento ?? d.length) >>> 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, d])) >>> 0);
    return Buffer.concat([cabeca, t, d, crc]);
}

/** @returns {Buffer} The IHDR of an 8-bit RGBA image. */
function ihdr(largura, altura) {
    const b = Buffer.alloc(13);
    b.writeUInt32BE(largura, 0);
    b.writeUInt32BE(altura, 4);
    b[8] = 8;
    b[9] = 6;
    return pedacoPng('IHDR', b);
}

/** @returns {Buffer} zlib data of a solid RGBA image, one filter byte per scanline. */
function pixels(largura, altura, [r, g, b, a]) {
    const linha = Buffer.alloc(1 + largura * 4);
    for (let x = 0; x < largura; x++) linha.set([r, g, b, a], 1 + x * 4);
    return deflateSync(Buffer.concat(Array.from({ length: altura }, () => linha)));
}

/** @returns {Buffer} An fcTL chunk for a full-size frame of 0.5 s. */
function fctl(sequencia, largura, altura) {
    const b = Buffer.alloc(26);
    b.writeUInt32BE(sequencia, 0);
    b.writeUInt32BE(largura, 4);
    b.writeUInt32BE(altura, 8);
    b.writeUInt16BE(1, 20);
    b.writeUInt16BE(2, 22);
    return pedacoPng('fcTL', b);
}

/**
 * A PNG file, still or animated (two frames: red, then blue).
 * @param {Object} [opcoes]
 * @param {number} [opcoes.largura]
 * @param {number} [opcoes.altura]
 * @param {boolean} [opcoes.animado] - An `acTL` before the first IDAT: the server calls it image/apng
 * @param {Array<[string, Uint8Array|Buffer]>} [opcoes.antes] - Chunks between IHDR and the animation
 *   control (a big `tEXt` puts the `acTL` beyond any fixed-size head)
 * @param {boolean} [opcoes.acTLDepoisDoIdat] - The animation control AFTER the image data, which the
 *   server does not see
 * @returns {Uint8Array}
 */
export function pngSintetico({ largura = 8, altura = 8, animado = false, antes = [], acTLDepoisDoIdat = false } = {}) {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    const partes = [ASSINATURA, ihdr(largura, altura), ...antes.map(([tipo, dados]) => pedacoPng(tipo, dados))];
    if (animado && !acTLDepoisDoIdat) partes.push(pedacoPng('acTL', actl), fctl(0, largura, altura));
    partes.push(pedacoPng('IDAT', pixels(largura, altura, [220, 30, 30, 255])));
    if (animado) {
        const seq = Buffer.alloc(4);
        seq.writeUInt32BE(acTLDepoisDoIdat ? 1 : 2);
        partes.push(fctl(acTLDepoisDoIdat ? 0 : 1, largura, altura),
            pedacoPng('fdAT', Buffer.concat([seq, pixels(largura, altura, [30, 30, 220, 255])])));
    }
    if (acTLDepoisDoIdat) partes.push(pedacoPng('acTL', actl));
    partes.push(pedacoPng('IEND'));
    return new Uint8Array(Buffer.concat(partes));
}

/** The eight-byte PNG signature, for building malformed files by hand. */
export const ASSINATURA_PNG = new Uint8Array(ASSINATURA);

/**
 * The corpus both sides are held to: `esperado` is the type the SERVER's detector gives each file
 * (`fileTypeFromBuffer`, asserted against the real server by
 * `tests/e2e/tipo-de-png-como-o-servidor.e2e.test.js`), and the client's walk must give the same
 * (`tests/unit/tipo-de-png.test.js`). Null is "no type": the server refuses any declared type for it.
 * @returns {Array<{nome: string, bytes: Uint8Array, esperado: (string|null)}>}
 */
export function corpusDoTipoDePng() {
    const texto = (n) => ['tEXt', Buffer.alloc(n, 0x61)];
    const juntar = (...partes) => new Uint8Array(Buffer.concat(partes.map((p) => Buffer.from(p))));
    const semIhdr = pngSintetico().subarray(33);
    const ihdrDe = pngSintetico().subarray(8, 33);
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    const pedacosAntes = (n) => Array.from({ length: n }, () => texto(1));
    return [
        { nome: 'PNG parado', bytes: pngSintetico(), esperado: 'image/png' },
        { nome: 'APNG', bytes: pngSintetico({ animado: true }), esperado: 'image/apng' },
        { nome: 'APNG com 5 KB de texto antes do acTL', bytes: pngSintetico({ animado: true, antes: [texto(5000)] }), esperado: 'image/apng' },
        { nome: 'acTL depois do IDAT', bytes: pngSintetico({ animado: true, acTLDepoisDoIdat: true }), esperado: 'image/png' },
        { nome: 'o primeiro pedaço não é IHDR', bytes: juntar(ASSINATURA, pedacoPng(...texto(4)), ihdrDe, semIhdr), esperado: null },
        { nome: 'IHDR de 12 bytes', bytes: juntar(ASSINATURA, pedacoPng('IHDR', Buffer.alloc(12)), semIhdr), esperado: null },
        { nome: 'CgBI antes do IHDR', bytes: juntar(ASSINATURA, pedacoPng('CgBI', Buffer.alloc(4)), ihdrDe, semIhdr), esperado: 'image/png' },
        {
            nome: 'cortado no meio de um pedaço antes do IDAT',
            bytes: juntar(ASSINATURA, ihdrDe, pedacoPng('tEXt', Buffer.alloc(10), { comprimento: 5000 }).subarray(0, 18)),
            esperado: 'image/png',
        },
        { nome: 'comprimento negativo', bytes: juntar(ASSINATURA, ihdrDe, pedacoPng('tEXt', Buffer.alloc(4), { comprimento: 0x80000000 }), semIhdr), esperado: null },
        { nome: 'APNG cortado logo depois do acTL', bytes: juntar(ASSINATURA, ihdrDe, pedacoPng('acTL', actl)), esperado: 'image/apng' },
        // O LIMITE DE 512 PEDAÇOS do detector: o IHDR é o primeiro, então 510 textos põem o acTL no
        // 512º (ainda lido) e 511 o põem no 513º (não lido, e o arquivo é um PNG parado).
        { nome: 'acTL como o 512º pedaço', bytes: pngSintetico({ animado: true, antes: pedacosAntes(510) }), esperado: 'image/apng' },
        { nome: 'acTL como o 513º pedaço', bytes: pngSintetico({ animado: true, antes: pedacosAntes(511) }), esperado: 'image/png' },
    ];
}
