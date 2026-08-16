// Path: js/projects/cover-image.js

/**
 * @module projects/cover-image
 * @description Turns a picture the user picked on disk into the small image a project card can
 * carry — the "capa" that replaces the coloured initials.
 *
 * THE SHRINKING HAPPENS IN THE BROWSER, and that is the whole reason this file exists. A phone
 * photo is 3–8 MB; the card draws it 320 px wide. Uploading the original would cost the user's
 * upload, the server's disk and, every time the page opens, one download per card — for pixels
 * nobody can see. What travels is at most {@link COVER_TARGET_BYTES}.
 *
 * The three pure functions are exported for the same reason they exist separately: this repo's
 * test environment is plain node with no DOM, so the arithmetic (what size to draw at, how big a
 * base64 payload really is) is testable and the canvas part is not.
 */

/** Longest side the stored cover may have. ~2x a card at its widest, which is where it stops paying. */
export const COVER_MAX_WIDTH = 640;
export const COVER_MAX_HEIGHT = 400;

/**
 * What the client aims for, well under the server's 512 kB ceiling. The gap is deliberate: the
 * budget here is per card in a grid the page loads all at once, and the server limit is a
 * last-resort guard against a hand-written request, not a target.
 */
export const COVER_TARGET_BYTES = 120 * 1024;

/** Quality ladder, walked from best to worst until the payload fits the budget. */
const QUALITY_STEPS = Object.freeze([0.82, 0.7, 0.58, 0.45]);

/**
 * Scales `width`x`height` down to fit inside `maxWidth`x`maxHeight`, preserving the aspect ratio.
 * Never scales UP: a 120 px logo stays 120 px rather than being blown up into blur.
 *
 * @param {number} width - Source width in pixels.
 * @param {number} height - Source height in pixels.
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @returns {{width: number, height: number}} Integers, each at least 1.
 * @throws {Error} On a non-finite or non-positive source dimension (a caller bug: an image that
 *   decoded to nothing must not silently become a 1x1 cover).
 */
export function fitWithin(width, height, maxWidth = COVER_MAX_WIDTH, maxHeight = COVER_MAX_HEIGHT) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`fitWithin: invalid source size ${width}x${height}`);
    }
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    return {
        // `Math.max(1, …)` guards the extreme ratio (a 4000x1 panorama scales its height to 0).
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/**
 * The decoded size of a base64 data URI, without allocating the bytes.
 *
 * Used to decide whether to re-encode at a lower quality, which is a decision taken once per
 * attempt on an image that can be megabytes: decoding it just to call `.length` would be the
 * expensive way to ask a question arithmetic answers.
 *
 * @param {string} dataUri
 * @returns {number} Decoded bytes; 0 for anything that is not a base64 data URI.
 */
export function dataUriByteLength(dataUri) {
    const comma = typeof dataUri === 'string' ? dataUri.indexOf(',') : -1;
    if (comma < 0) return 0;
    const base64 = dataUri.slice(comma + 1);
    if (base64.length === 0) return 0;
    const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
    return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * The MIME type a data URI actually declares.
 *
 * IT IS NOT THE ONE THAT WAS ASKED FOR, and that is the trap this exists to catch: a browser
 * without WebP encoding answers `canvas.toDataURL('image/webp')` with a PNG and no error at all.
 * The result would then be a 900 kB "webp" that the server rejects for the one reason the user
 * cannot act on. Reading the answer instead of trusting the request is what makes the JPEG
 * fallback below reachable.
 *
 * @param {string} dataUri
 * @returns {string} e.g. `image/webp`, or '' when the string is not a data URI.
 */
export function dataUriMimeType(dataUri) {
    const match = /^data:([^;,]+)[;,]/.exec(typeof dataUri === 'string' ? dataUri : '');
    return match ? match[1] : '';
}

/**
 * Decodes a file into an `HTMLImageElement`. Object URL, never `FileReader`: a data URI of an
 * 8 MB photo is an 11 MB string the main thread has to build before decoding starts.
 * @param {File|Blob} file
 * @returns {Promise<HTMLImageElement>}
 */
function decodeImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Não foi possível ler esta imagem.'));
        };
        img.src = url;
    });
}

/**
 * Reads a picture from disk and returns the payload for `PUT /atlas/:id/cover`.
 *
 * The image is NOT cropped to the card's shape — it is only scaled down, and the card crops it
 * with `object-fit: cover`. Cropping here would bake one layout's aspect ratio into stored bytes,
 * and the card's shape is a CSS decision that has already changed once.
 *
 * @param {File} file - A png/jpeg/webp the user picked.
 * @returns {Promise<{image: string, width: number, height: number}>}
 * @throws {Error} With a pt-BR sentence, when the file cannot be decoded or cannot be squeezed
 *   under the budget.
 */
export async function fileToCoverPayload(file) {
    const img = await decodeImage(file);
    const source = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
    if (!source.width || !source.height) throw new Error('Esta imagem está vazia.');

    let { width, height } = fitWithin(source.width, source.height);
    const canvas = document.createElement('canvas');

    // Two nested attempts, and the order matters: quality is cheaper than pixels, so it is spent
    // first. Only when the worst quality still overshoots does the size get halved — an image that
    // needs that is a photograph of noise, and half the pixels is what makes it fit at all.
    for (let attempt = 0; attempt < 3; attempt++) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        for (const quality of QUALITY_STEPS) {
            const dataUri = canvas.toDataURL('image/webp', quality);
            // A browser that cannot encode WebP silently hands back a PNG; JPEG is the fallback
            // every one of them encodes, and the card never shows transparency anyway.
            const encoded = dataUriMimeType(dataUri) === 'image/webp'
                ? dataUri
                : canvas.toDataURL('image/jpeg', quality);
            if (dataUriByteLength(encoded) <= COVER_TARGET_BYTES) {
                return { image: encoded, width, height };
            }
        }
        ({ width, height } = fitWithin(width, height, Math.round(width / 2), Math.round(height / 2)));
    }

    throw new Error('Esta imagem é grande demais para virar capa. Tente outra.');
}
