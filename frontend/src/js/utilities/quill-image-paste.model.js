// Path: js/utilities/quill-image-paste.model.js

/**
 * @fileoverview The decisions behind "a picture just arrived in the rich-text editor", as pure
 * functions.
 *
 * THERE ARE THREE WAYS A PICTURE GETS INTO A QUILL EDITOR AND THE BUTTON IS ONLY ONE OF THEM.
 * Quill 2 wires the other two itself: `modules/uploader.js` listens for `drop` on the editor root
 * and `modules/clipboard.js` hands it every pasted FILE, and whatever the uploader takes is
 * inserted as a raw base64 data URL with no ceiling of any kind. A briefing slide's HTML travels
 * through sync on every edit, so a pasted 20 MB screenshot is a 27 MB base64 string inside a sync
 * operation — the ceiling the button has always had was a ceiling on the least-used door.
 *
 * The THIRD way is the one that never reaches the uploader: pasted HTML that already carries
 * `<img src="data:...">` (copying a picture out of a web page, or a rich document). Quill routes
 * that through the clipboard matchers instead, so it needs its own verdict, and that verdict has
 * to be SYNCHRONOUS — a matcher returns a Delta, it cannot await a decode. So this door is judged
 * on BYTES ONLY, which is exactly what {@link dataUrlByteCount} can answer without decoding.
 *
 * ZERO IMPORTS beyond the phrase leaf, on purpose: this is the half that can be pinned down in
 * plain node, away from Quill, DOM and canvas.
 */

import { ImageRefusal, imageRefusalNotice } from './image-limit-phrases.js';

/**
 * The MIME types the paste and drop doors take.
 *
 * WIDER THAN THE SERVER ALLOWLIST, and legitimately so: every picture that comes through here is
 * redrawn into a canvas and re-encoded as JPEG before it is embedded, exactly like the image tool
 * on the map. Nothing here is ever uploaded in the format it arrived in.
 *
 * It also has to be wider than Quill's own default (`['image/png', 'image/jpeg']`), which is what
 * made a pasted WebP screenshot vanish with no message at all: `Uploader.upload` drops a file
 * whose type is not on the list and calls no handler, so there is nothing left to refuse WITH.
 * @type {string[]}
 */
export const QUILL_PASTE_MIME_TYPES = Object.freeze([
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp',
]);

/** The same list as an `accept` attribute, so the button and the paste door cannot drift. */
export const QUILL_IMAGE_ACCEPT = QUILL_PASTE_MIME_TYPES.join(',');

/**
 * How many bytes a `data:` URL actually carries.
 *
 * BASE64 LENGTH IS NOT BYTE COUNT: it is 4 characters per 3 bytes, and the trailing `=` padding
 * stands for bytes that are not there. Treating the string length as the size overstates by a
 * third, which at a 5 MB ceiling refuses pictures of 3,75 MB — a refusal the person cannot
 * explain, since the sentence would quote a number their file does not have.
 *
 * Answers `null`, never 0, for anything that is not a `data:` URL. Zero would read as "an empty
 * picture" and sail under every ceiling; `null` forces the caller to say what it does with a
 * source it cannot measure, which for an `https://` picture is to leave it alone (no bytes are
 * being embedded).
 *
 * BOTH SPELLINGS OF A DATA URL CARRY BYTES. `data:image/svg+xml,%3Csvg…` has no `;base64` and is
 * perfectly legal: the payload is percent-encoded, and it is the most common way an inline SVG
 * sits in a web page. Reading "no `;base64`" as "no inline bytes" put it in the same branch as
 * `https://`, so it stayed in the pasted Delta whole: no byte ceiling, no pixel ceiling, no MIME
 * check, and a 20 MB SVG copied out of a page would have travelled through sync on every edit.
 *
 * @param {string} [src] - The `src` attribute of a pasted `<img>`
 * @returns {number|null} Decoded byte count, or `null` when the source carries no inline bytes
 */
export function dataUrlByteCount(src) {
    const texto = typeof src === 'string' ? src : '';
    const virgula = texto.indexOf(',');
    if (virgula < 0) return null;

    const cabecalho = texto.slice(0, virgula).toLowerCase();
    if (!cabecalho.startsWith('data:')) return null;

    const corpo = texto.slice(virgula + 1);
    if (corpo.length === 0) return 0;

    if (!cabecalho.includes(';base64')) {
        // Percent-encoded: every `%XX` is ONE byte written with three characters.
        const escapes = corpo.match(/%[0-9a-f]{2}/gi);
        return corpo.length - 2 * (escapes ? escapes.length : 0);
    }

    // Whitespace is legal inside base64 and some sources wrap the payload at 76 columns.
    const limpo = corpo.replace(/\s+/g, '');
    const preenchimento = limpo.endsWith('==') ? 2 : (limpo.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor((limpo.length * 3) / 4) - preenchimento);
}

/**
 * Percent-decodes a data URL payload into raw bytes.
 *
 * By hand, not `decodeURIComponent`: that one decodes to a STRING and throws on any byte sequence
 * that is not valid UTF-8, which is every binary picture. A `%` that is not followed by two hex
 * digits is kept as a literal, which is what browsers do.
 *
 * @param {string} corpo - The part of the data URL after the comma
 * @returns {Uint8Array}
 */
function percentDecode(corpo) {
    const saida = [];
    for (let i = 0; i < corpo.length; i += 1) {
        const hex = corpo[i] === '%' ? corpo.slice(i + 1, i + 3) : '';
        if (/^[0-9a-f]{2}$/i.test(hex)) {
            saida.push(parseInt(hex, 16));
            i += 2;
        } else {
            saida.push(corpo.charCodeAt(i) & 0xff);
        }
    }
    return Uint8Array.from(saida);
}

/**
 * Decodes a `data:` URL, in either spelling, into its MIME type and raw bytes.
 *
 * This is what lets the pasted-HTML door stop being the odd one out: with the bytes in hand the
 * caller builds a `File` and sends it down the SAME asynchronous path as a pasted file, so the
 * picture is compressed and meets the pixel ceiling instead of entering whole.
 *
 * `atob` and not `fetch(dataUrl)`: a fetch of a `data:` URL is subject to `connect-src`, and a
 * deployment that tightens its CSP would turn every pasted picture into a silent failure.
 *
 * @param {string} [src] - The `src` attribute of a pasted `<img>`
 * @returns {{type: string, bytes: Uint8Array}|null} `null` for anything that is not a data URL,
 *   or whose base64 payload does not decode
 */
export function dataUrlToBytes(src) {
    const texto = typeof src === 'string' ? src : '';
    const virgula = texto.indexOf(',');
    if (virgula < 0) return null;

    const cabecalho = texto.slice(0, virgula);
    const minusculo = cabecalho.toLowerCase();
    if (!minusculo.startsWith('data:')) return null;

    const type = minusculo.slice('data:'.length).split(';')[0].trim();
    if (!minusculo.includes(';base64')) return { type, bytes: percentDecode(texto.slice(virgula + 1)) };
    try {
        const binario = atob(texto.slice(virgula + 1).replace(/\s+/g, ''));
        const bytes = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
        return { type, bytes };
    } catch {
        return null;
    }
}

/**
 * Whether an `<img>` that arrived inside PASTED HTML may stay, and what to say if it may not.
 *
 * THE PIXEL CEILING CANNOT BE ASKED HERE, and pretending otherwise would be the worse bug: the
 * clipboard matcher runs inside `convert`, which must return a Delta synchronously, so there is
 * no decode to measure. The byte ceiling is the one that is answerable without decoding, so it is
 * the EARLY refusal: it spares decoding tens of megabytes of base64 just to refuse them later.
 * A picture that passes it is NOT thereby accepted: the caller takes it out of the Delta anyway
 * and sends it through the asynchronous path, where the pixel ceiling and the compression live
 * (`keep: true` WITH a `bytes` count means "measured, not over": re-route it).
 *
 * A source with no inline bytes (`https://…`, a `blob:` URL) is KEPT: nothing is being embedded,
 * so there is no payload to bound, and refusing it would delete a picture for a reason the person
 * cannot act on.
 *
 * @param {string} [src] - The `src` attribute of the pasted `<img>`
 * @param {number} maxBytes - Byte ceiling for an embedded picture
 * @returns {{keep: boolean, reason?: string, bytes?: number}} `reason` is the pt-BR sentence
 */
export function pastedHtmlImageVerdict(src, maxBytes) {
    const bytes = dataUrlByteCount(src);
    if (bytes === null) return { keep: true };
    if (!Number.isFinite(maxBytes) || bytes <= maxBytes) return { keep: true, bytes };

    return {
        keep: false,
        bytes,
        reason: imageRefusalNotice(ImageRefusal.PESO, { bytes, maxBytes }),
    };
}

/**
 * Drops from a clipboard Delta every image embed the verdict refused.
 *
 * It rebuilds through `delta.constructor` rather than importing `quill-delta`: that package is a
 * transitive dependency of Quill and is not declared here, so importing it by name would work
 * today and break the day Quill vendorises it. The instance in hand already IS the right class.
 *
 * @param {Object} delta - The Delta the matchers have built for this node
 * @param {function(string): boolean} refuse - True for a `src` that must not stay
 * @returns {Object} The same Delta when nothing was dropped, a new one otherwise
 */
export function withoutRefusedImages(delta, refuse) {
    const ops = Array.isArray(delta?.ops) ? delta.ops : [];
    const mantidas = ops.filter((op) => {
        const embutido = op?.insert;
        if (!embutido || typeof embutido !== 'object') return true;
        if (typeof embutido.image !== 'string') return true;
        return !refuse(embutido.image);
    });

    if (mantidas.length === ops.length) return delta;
    const Delta = delta.constructor;
    return new Delta(mantidas);
}
