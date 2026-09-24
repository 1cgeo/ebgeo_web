// Path: js/utilities/image-limit-phrases.js

/**
 * @fileoverview The ONE wording of every "this picture was not loaded" refusal.
 *
 * A picture can be refused at five different doors (the image draw tool, a drop on the map, a
 * feature/3D/360 photo gallery, a custom point icon, an atlas cover), and each of them used to
 * write its own sentence, or none at all. Two costs came out of that: a refusal that only reached
 * `console.warn` looked to the person exactly like a click that did nothing, and the doors that
 * did speak disagreed about what the limit even was.
 *
 * ZERO IMPORTS, on purpose. The phrases are the part a person reads, so they have to be testable
 * in plain node, away from DOM, canvas and the store; and the leaf can be imported from the pages
 * that boot without the store without dragging anything behind it.
 *
 * EVERY SENTENCE NAMES BOTH NUMBERS: what was measured and what the ceiling is. "Imagem muito
 * grande" alone teaches nothing — the person cannot tell whether to crop, to re-export or to pick
 * another file. The measured value is optional only because one caller (a file the browser refused
 * to decode) genuinely has no number to show.
 */

/**
 * Why a picture was refused. The vocabulary is CLOSED: a door that needs a sixth reason adds it
 * here, so the sentence is written once instead of being improvised at the call site.
 * @readonly
 * @enum {string}
 */
export const ImageRefusal = Object.freeze({
    /** No file at all (an empty picker, a drop with no file). */
    AUSENTE: 'ausente',
    /** MIME type outside the allowlist. */
    TIPO: 'tipo',
    /** Byte size above the ceiling. */
    PESO: 'peso',
    /** One decoded side above the pixel ceiling. */
    LADO: 'lado',
    /** Total decoded pixels above the megapixel ceiling. */
    AREA: 'area',
    /** The browser could not decode the bytes as an image. */
    ILEGIVEL: 'ilegivel',
});

/** Opening clause shared by every refusal that has a picture to talk about. */
const PREFIXO = 'A imagem não foi carregada';

/**
 * A number as pt-BR prose: decimal comma, at most one decimal, and no trailing ",0".
 *
 * `Intl.NumberFormat` is deliberately not used: this module is loaded by node tests where the
 * full ICU data set is not guaranteed, and a locale-dependent sentence would make the test assert
 * the environment instead of the text.
 *
 * @param {number} valor - Value to render
 * @returns {string} The number in pt-BR, or '?' when it is not finite
 */
function numeroPtBr(valor) {
    if (!Number.isFinite(valor)) return '?';
    const arredondado = Math.round(valor * 10) / 10;
    return String(arredondado).replace('.', ',');
}

/**
 * Bytes as whole or one-decimal megabytes.
 * @param {number} bytes
 * @returns {string} e.g. "37" or "10,5"
 */
function megabytes(bytes) {
    return numeroPtBr(bytes / (1024 * 1024));
}

/**
 * The MEASURED byte size as megabytes, rounded UP to one decimal.
 *
 * Same boundary argument as {@link megapixels}: one byte over a 10 MB ceiling rounds to nearest
 * as "tem 10 MB e o máximo é 10 MB", and the window is wide enough (10,00 to 10,05 MB) for a
 * real photo to land in it. Only the measured side rounds up; the ceiling keeps {@link megabytes}.
 *
 * @param {number} bytes - Measured size
 * @returns {string} e.g. "37" or "10,1"
 */
function megabytesMedidos(bytes) {
    if (!Number.isFinite(bytes)) return '?';
    return String(Math.ceil((bytes / (1024 * 1024)) * 10) / 10).replace('.', ',');
}

/**
 * Megapixels, rounded UP to one decimal.
 *
 * Up, not to nearest, and the reason is the boundary: 8000x6251 is 50,008 MP against a 50 MP
 * ceiling, and rounding to nearest prints "tem 50 MP e o máximo é 50 MP" — a sentence that
 * reads as a bug in the product rather than as a refusal. Rounding up overstates by at most a
 * tenth of a megapixel and always in the direction the refusal already asserts.
 *
 * @param {number} pixels - Total pixel count
 * @returns {string} e.g. "56" or "50,1"
 */
function megapixels(pixels) {
    if (!Number.isFinite(pixels)) return '?';
    return String(Math.ceil((pixels / 1e6) * 10) / 10).replace('.', ',');
}

/**
 * The notice of a photo that is still large after the reduction (`PHOTO_CONFIG.warnBytes`).
 *
 * It is NOT a refusal: the photo is attached. It says what happened and what the person can do,
 * because every edit of the feature carries its photos again, and on a slow link that is the
 * difference between an edit that leaves at once and one that takes a minute.
 *
 * @param {Object} [medida]
 * @param {string} [medida.nome] - The file name, when there is one
 * @param {number} [medida.bytes] - The stored size
 * @returns {string}
 */
export function photoStillLargeNotice({ nome, bytes } = {}) {
    const rotulo = typeof nome === 'string' && nome.trim() ? `A foto "${nome.trim()}"` : 'A foto';
    return `${rotulo} ficou com ${megabytesMedidos(bytes)} MB mesmo depois de reduzida e pode demorar a `
        + 'sincronizar. Se puder, anexe uma versão menor.';
}

/**
 * The sentence a person reads when a picture is refused.
 *
 * @param {string} motivo - One of {@link ImageRefusal}
 * @param {Object} [medida] - The numbers to quote
 * @param {number} [medida.bytes] - Measured byte size
 * @param {number} [medida.maxBytes] - Byte ceiling
 * @param {number} [medida.width] - Measured decoded width in pixels
 * @param {number} [medida.height] - Measured decoded height in pixels
 * @param {number} [medida.maxSide] - Pixel ceiling per side
 * @param {number} [medida.maxPixels] - Total pixel ceiling
 * @param {string[]} [medida.tipos] - Accepted MIME types, used to name the formats
 * @returns {string} A pt-BR sentence, never empty: an unknown reason degrades to the generic one
 *   rather than to silence, because silence is the defect this module exists to remove.
 */
export function imageRefusalNotice(motivo, medida = {}) {
    const m = medida ?? {};

    switch (motivo) {
        case ImageRefusal.AUSENTE:
            return 'Nenhum arquivo selecionado.';

        case ImageRefusal.TIPO:
            return `${PREFIXO}: tipo de arquivo não suportado (use ${formatosAceitos(m.tipos)}).`;

        case ImageRefusal.PESO:
            return `${PREFIXO}: o arquivo tem ${megabytesMedidos(m.bytes)} MB e o máximo é `
                + `${megabytes(m.maxBytes)} MB.`;

        case ImageRefusal.LADO:
            return `${PREFIXO}: ela tem ${numeroPtBr(m.width)} x ${numeroPtBr(m.height)} px e o `
                + `máximo é ${numeroPtBr(m.maxSide)} px de lado.`;

        case ImageRefusal.AREA:
            return `${PREFIXO}: ela tem ${numeroPtBr(m.width)} x ${numeroPtBr(m.height)} px `
                + `(${megapixels(m.width * m.height)} MP) e o máximo é `
                + `${numeroPtBr(m.maxPixels / 1e6)} MP.`;

        case ImageRefusal.ILEGIVEL:
            return `${PREFIXO}: não foi possível ler este arquivo de imagem.`;

        default:
            return `${PREFIXO}.`;
    }
}

/**
 * The accepted formats as words, from the MIME allowlist itself.
 *
 * Derived, never hand-written: the sentence and the list that the gate actually enforces have
 * already drifted apart once in this product, and a refusal that names a format the gate rejects
 * sends the person to fetch a second file that will also be refused.
 *
 * @param {string[]} [tipos] - Accepted MIME types
 * @returns {string} e.g. "JPEG, PNG ou WebP"
 */
function formatosAceitos(tipos) {
    const nomes = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };
    const lista = (Array.isArray(tipos) ? tipos : [])
        .map((tipo) => nomes[tipo] ?? String(tipo).replace('image/', '').toUpperCase())
        .filter((nome) => nome.length > 0);

    if (lista.length === 0) return 'JPEG, PNG ou WebP';
    if (lista.length === 1) return lista[0];
    return `${lista.slice(0, -1).join(', ')} ou ${lista[lista.length - 1]}`;
}
