// Path: js/import_export/svg-to-png.js

/**
 * @fileoverview Rasterizes an SVG blob into a PNG blob, in the browser, for the ONE crossing where
 * the local disk and the server's allowlist disagree: a custom point icon stored as SVG.
 *
 * WHY IT EXISTS. The server accepts png/jpeg/webp and will never accept SVG (stored XSS vector;
 * see the images module and `ALLOWED_IMAGE_MIME` in `atlas-image-upload.js`). Since 2026-09-19 the
 * three ports that create a server atlas out of a local one refuse the WHOLE send when any image
 * falls outside that allowlist, so an atlas carrying one SVG icon had no path to the server at all.
 * The owner chose to convert instead of to refuse: the bytes that travel become PNG, the id does
 * not change, and the local record is left alone (the disk may keep the SVG).
 *
 * ZERO IMPORTS, on purpose: `atlas-image-upload.js` is store-free because the chooser page boots
 * without the store, and this module is reached from there.
 *
 * FAILS HIGH, NEVER SILENT. Anything that does not decode (malformed markup, an external reference
 * that taints the canvas, a missing DOM) throws, and the caller keeps the id in `skipped` with the
 * reason. Producing an empty PNG would upload a blank icon under a valid id, which no later step
 * could tell apart from a real one.
 *
 * WHAT IT DOES NOT DO. It does not execute script: the SVG is decoded through an `<img>` element,
 * where scripting and external subresource loading are disabled by the browser. An animated SVG is
 * flattened to whatever frame the decoder hands over. An SVG referencing a cross-origin bitmap
 * taints the canvas and `toBlob` throws, which is the fail-high path above.
 */

/** Largest side of the PNG produced, in pixels. */
export const SVG_RASTER_MAX_PX = 256;
/** Smallest side of the PNG produced, in pixels. */
export const SVG_RASTER_MIN_PX = 16;
/**
 * Size used when the markup declares neither an absolute size nor a `viewBox`. It matches
 * `NORMALIZED_SIZE` in `draw_tools/point_tool/point-custom-icons.js`, which is the size every icon
 * uploaded through the picker already has, so the two paths agree on what "no intrinsic size" means.
 */
export const SVG_RASTER_FALLBACK_PX = 96;

/** The opening `<svg>` tag, which is the only part carrying the intrinsic size. */
const SVG_OPEN_TAG = /<svg\b[^>]*>/i;
/** A CSS length this module accepts: unitless or `px`. Percentages and font-relative units are not sizes. */
const ABSOLUTE_LENGTH = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(?:px)?\s*$/i;
/** The four `viewBox` numbers, separated by whitespace and/or a comma. */
const VIEW_BOX = /^\s*([+-]?[\d.]+(?:e[+-]?\d+)?)[\s,]+([+-]?[\d.]+(?:e[+-]?\d+)?)[\s,]+([+-]?[\d.]+(?:e[+-]?\d+)?)[\s,]+([+-]?[\d.]+(?:e[+-]?\d+)?)\s*$/i;

/**
 * Reads one attribute out of an already-isolated opening tag.
 * @param {string} tag
 * @param {string} name
 * @returns {string|null}
 */
function readAttribute(tag, name) {
    const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    if (!match) return null;
    return match[1] ?? match[2] ?? null;
}

/**
 * Parses an absolute length, rejecting `%`, `em` and anything else that is not resolvable without
 * a layout. A percentage is NOT a size: it is a share of a container this rasterization has none of.
 * @param {string|null} raw
 * @returns {number|null} A finite positive number of pixels, or `null`.
 */
function absoluteLength(raw) {
    if (typeof raw !== 'string') return null;
    const match = ABSOLUTE_LENGTH.exec(raw);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Reads the intrinsic size an SVG document declares.
 *
 * THE THREE SOURCES, in the order the rendering engines use them: an absolute `width`/`height`
 * pair wins; a `viewBox` supplies whichever of the two is missing (or both); nothing at all yields
 * `null`, and the caller substitutes the fallback square.
 *
 * @param {string} text - The SVG markup.
 * @returns {{width: number, height: number}|null} The declared size, or `null` when none is declared.
 */
export function parseSvgSize(text) {
    if (typeof text !== 'string') return null;
    const tag = SVG_OPEN_TAG.exec(text)?.[0];
    if (!tag) return null;

    const width = absoluteLength(readAttribute(tag, 'width'));
    const height = absoluteLength(readAttribute(tag, 'height'));
    if (width && height) return { width, height };

    const box = VIEW_BOX.exec(readAttribute(tag, 'viewBox') ?? '');
    const boxWidth = box ? Number(box[3]) : NaN;
    const boxHeight = box ? Number(box[4]) : NaN;
    const hasBox = Number.isFinite(boxWidth) && boxWidth > 0 && Number.isFinite(boxHeight) && boxHeight > 0;

    if (!hasBox) {
        // One absolute side and no box: a square is the only aspect ratio available.
        if (width) return { width, height: width };
        if (height) return { width: height, height };
        return null;
    }
    if (width) return { width, height: (width * boxHeight) / boxWidth };
    if (height) return { width: (height * boxWidth) / boxHeight, height };
    return { width: boxWidth, height: boxHeight };
}

/**
 * Turns a declared size into the pixel size of the PNG, preserving the aspect ratio.
 *
 * THE CAP IS WHAT KEEPS AN ICON AN ICON: a 2048px drawing rasterized verbatim would upload
 * megabytes of PNG for a marker drawn at a few dozen pixels. The floor keeps a 4px glyph from
 * becoming an unreadable smudge on the peer. Between the two the size is taken VERBATIM, so an
 * icon that already declares a sane size draws on the peer at exactly the size its author sees.
 *
 * @param {{width: number, height: number}|null} declared - From {@link parseSvgSize}.
 * @returns {{width: number, height: number}} Integer pixels, both at least 1.
 */
export function rasterTargetSize(declared) {
    const width = Number(declared?.width);
    const height = Number(declared?.height);
    const usable = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
    const w = usable ? width : SVG_RASTER_FALLBACK_PX;
    const h = usable ? height : SVG_RASTER_FALLBACK_PX;

    const largest = Math.max(w, h);
    let scale = 1;
    if (largest > SVG_RASTER_MAX_PX) scale = SVG_RASTER_MAX_PX / largest;
    else if (largest < SVG_RASTER_MIN_PX) scale = SVG_RASTER_MIN_PX / largest;

    return {
        width: Math.max(1, Math.round(w * scale)),
        height: Math.max(1, Math.round(h * scale)),
    };
}

/**
 * Decodes a blob through an `<img>` element, which is the decoder that refuses script and external
 * subresources inside SVG.
 * @param {Blob} blob
 * @returns {Promise<HTMLImageElement>}
 */
function decodeBlob(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('O SVG não pôde ser decodificado.')); };
        img.src = url;
    });
}

/**
 * Promise wrapper around `canvas.toBlob`. A tainted canvas throws here, synchronously.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('O canvas não produziu um PNG.'));
        }, 'image/png');
    });
}

/**
 * Rasterizes an SVG blob into a PNG blob.
 *
 * THE BLOB IS RE-STAMPED BEFORE DECODING, and that is not cosmetic: a blob restored from a `.ebgeo`
 * ZIP can reach here with an EMPTY type (JSZip drops it), and an `<img>` fed a typeless object URL
 * does not decode SVG. The bytes are untouched; only the declared type is supplied.
 *
 * @param {Blob} blob - The SVG bytes.
 * @returns {Promise<Blob>} A `image/png` blob.
 * @throws {Error} When the DOM is unavailable, the markup does not decode, or the canvas is tainted.
 */
export async function rasterizeSvgToPng(blob) {
    if (typeof document === 'undefined' || typeof Image === 'undefined'
        || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        throw new Error('A conversão de SVG exige um navegador.');
    }

    const bytes = await blob.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const size = rasterTargetSize(parseSvgSize(text));

    const typed = blob.type === 'image/svg+xml' ? blob : new Blob([bytes], { type: 'image/svg+xml' });
    const img = await decodeBlob(typed);

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('O canvas 2D não está disponível.');
    ctx.drawImage(img, 0, 0, size.width, size.height);

    return canvasToPng(canvas);
}
