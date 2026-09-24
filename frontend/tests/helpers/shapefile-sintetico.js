// Path: tests/helpers/shapefile-sintetico.js

/**
 * @fileoverview A POINT shapefile written byte by byte, for import tests. No shapefile writer is
 * installed in this repository, and the formats are small: `.shp` (100-byte header plus one 28-byte
 * record per point) and `.dbf` (dBASE III: 32-byte header, 32 bytes per field, fixed-width records).
 * The `.shx` is not written because the reader (`shpjs`) never reads it.
 *
 * THE DBF CARRIES WHATEVER BYTES THE CALLER'S ENCODING PRODUCES, which is the point: a Brazilian
 * DBF is usually Windows-1252 with no `.cpg` beside it, and that is the case the import has to
 * survive. `latin1` here is `Buffer`'s single-byte encoding, byte-identical to Windows-1252 on
 * every accented letter of Portuguese.
 *
 * Plain Node, no DOM: usable from vitest and from a Playwright spec (which hands the bytes to the
 * page as a file).
 */

import { Buffer } from 'node:buffer';

/**
 * @param {Array<[number, number]>} pontos - [lng, lat] pairs.
 * @returns {Buffer} The `.shp` bytes.
 */
export function shpDePontos(pontos) {
    const tamanho = 100 + pontos.length * 28;
    const buf = Buffer.alloc(tamanho);
    buf.writeInt32BE(9994, 0);
    buf.writeInt32BE(tamanho / 2, 24);
    buf.writeInt32LE(1000, 28);
    buf.writeInt32LE(1, 32);
    const xs = pontos.map((p) => p[0]);
    const ys = pontos.map((p) => p[1]);
    buf.writeDoubleLE(Math.min(...xs), 36);
    buf.writeDoubleLE(Math.min(...ys), 44);
    buf.writeDoubleLE(Math.max(...xs), 52);
    buf.writeDoubleLE(Math.max(...ys), 60);
    pontos.forEach(([x, y], i) => {
        const base = 100 + i * 28;
        buf.writeInt32BE(i + 1, base);
        buf.writeInt32BE(10, base + 4);
        buf.writeInt32LE(1, base + 8);
        buf.writeDoubleLE(x, base + 12);
        buf.writeDoubleLE(y, base + 20);
    });
    return buf;
}

/**
 * @param {Array<{nome: string, tamanho: number}>} campos - Character fields only.
 * @param {Array<Object<string, string>>} linhas - One object per record, keyed by field name.
 * @param {{codificacao?: BufferEncoding, idioma?: number}} [opcoes] - `codificacao` of the values
 *   (`latin1` or `utf8`); `idioma` is the language driver byte at offset 29 (0x57 = ANSI 1252).
 * @returns {Buffer} The `.dbf` bytes.
 */
export function dbfDeTexto(campos, linhas, { codificacao = 'latin1', idioma = 0 } = {}) {
    const tamanhoDoRegistro = 1 + campos.reduce((s, c) => s + c.tamanho, 0);
    const tamanhoDoCabecalho = 32 + 32 * campos.length + 1;
    const buf = Buffer.alloc(tamanhoDoCabecalho + tamanhoDoRegistro * linhas.length + 1, 0);
    buf.writeUInt8(0x03, 0);
    buf.writeUInt8(126, 1);
    buf.writeUInt8(9, 2);
    buf.writeUInt8(23, 3);
    buf.writeUInt32LE(linhas.length, 4);
    buf.writeUInt16LE(tamanhoDoCabecalho, 8);
    buf.writeUInt16LE(tamanhoDoRegistro, 10);
    buf.writeUInt8(idioma, 29);
    campos.forEach((campo, i) => {
        const base = 32 + i * 32;
        buf.write(campo.nome.slice(0, 10), base, 'ascii');
        buf.write('C', base + 11, 'ascii');
        buf.writeUInt8(campo.tamanho, base + 16);
    });
    buf.writeUInt8(0x0d, tamanhoDoCabecalho - 1);
    linhas.forEach((linha, r) => {
        let pos = tamanhoDoCabecalho + r * tamanhoDoRegistro;
        buf.write(' ', pos, 'ascii');
        pos += 1;
        for (const campo of campos) {
            const valor = Buffer.from(String(linha[campo.nome] ?? ''), codificacao).subarray(0, campo.tamanho);
            buf.fill(0x20, pos, pos + campo.tamanho);
            valor.copy(buf, pos);
            pos += campo.tamanho;
        }
    });
    buf.writeUInt8(0x1a, buf.length - 1);
    return buf;
}
