// Path: js/import_export/apng-to-png.js

/**
 * @fileoverview Flattens an ANIMATED PNG into a still PNG, in the browser, for the one crossing where
 * the local disk and the server's allowlist disagree about it: a picture that must travel as a blob.
 *
 * WHY IT EXISTS (2026-09-24, second review of the attached photos). The server accepts png/jpeg/webp,
 * and its detector calls a PNG with an `acTL` chunk before the first image data `image/apng`, which is
 * none of the three. The client used to declare such a file `image/png`: the upload was refused as a
 * type the bytes contradict, the blob queue kept the picture's operation waiting, and the atomic
 * import refused the WHOLE atlas for that one picture. An attached photo held INLINE simply stays
 * inline (`mimeDeFotoInlineQueSobe`); a picture that only exists as a blob (an image placed on the
 * map, a photo by reference restored from a file) has no inline form, and it is flattened here under
 * the SAME id, as the SVG icon is (`svg-to-png.js`).
 *
 * NOTHING VISIBLE IS LOST ON THE MAP: MapLibre decodes an image source into a single bitmap, so the map
 * already showed one still frame of such a file. The frame kept is the one `createImageBitmap` hands
 * over, which for an animated image is its default image (the first frame when there is none).
 *
 * ZERO IMPORTS, like `svg-to-png.js`: `atlas-image-upload.js` is reached from the chooser page, which
 * boots without the store.
 *
 * FAILS HIGH, NEVER SILENT. Without a decoder or a canvas it throws, and the caller keeps the id in
 * `skipped` with the reason, instead of uploading an empty picture under a valid id.
 */

/**
 * The first frame of an animated PNG, as a still PNG.
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
export async function achatarApngEmPng(blob) {
    if (typeof createImageBitmap !== 'function') {
        throw new Error('Este navegador não consegue preparar a imagem animada para o envio.');
    }
    const quadro = await createImageBitmap(blob);
    try {
        const { width, height } = quadro;
        if (!width || !height) throw new Error('A imagem animada não pôde ser lida.');
        let canvas;
        if (typeof OffscreenCanvas === 'function') {
            canvas = new OffscreenCanvas(width, height);
        } else if (typeof document !== 'undefined') {
            canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
        } else {
            throw new Error('Este navegador não consegue preparar a imagem animada para o envio.');
        }
        canvas.getContext('2d').drawImage(quadro, 0, 0);
        const png = typeof canvas.convertToBlob === 'function'
            ? await canvas.convertToBlob({ type: 'image/png' })
            : await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!png) throw new Error('A imagem animada não pôde ser convertida.');
        return png;
    } finally {
        quadro.close?.();
    }
}
