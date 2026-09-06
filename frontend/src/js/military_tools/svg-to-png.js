// Path: js/military_tools/svg-to-png.js

/**
 * Shared SVG/image-to-PNG conversion utility used by MilitarySymbolGenerator
 * and CoordinationMeasureGenerator.
 *
 * Both generators need to rasterize SVG content to PNG blobs for MapLibre
 * icon rendering. This module consolidates the canvas-based conversion logic.
 *
 * The canvas is CROPPED to the drawing: the fitted draw size is the canvas size,
 * so a wide symbol no longer carries transparent bands above and below it. The
 * selection box and the click hit-test are the bitmap rectangle, and every
 * transparent pixel in it is a pixel of box that has no drawing under it.
 */

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Loads an image from a source URL or data URL.
 * @param {string} src - Image source (data URL, blob URL, or path)
 * @param {number} [timeoutMs] - Optional timeout in milliseconds
 * @returns {Promise<HTMLImageElement>} Loaded image element
 */
function loadImage(src, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout loading image'));
        }, timeoutMs);

        const img = new Image();
        img.onload = () => {
            clearTimeout(timeout);
            resolve(img);
        };
        img.onerror = (error) => {
            clearTimeout(timeout);
            reject(new Error('Failed to load image: ' + error));
        };
        img.src = src;
    });
}

/**
 * Size the drawing gets inside the target box, preserving the aspect ratio.
 *
 * This is the scale the symbol has always been rendered at; what changed is that
 * the result is now the CANVAS size too, instead of the size of a drawing centred
 * in a larger canvas.
 *
 * @param {number} originalWidth - Intrinsic image width
 * @param {number} originalHeight - Intrinsic image height
 * @param {number} targetWidth - Target box width
 * @param {number} targetHeight - Target box height
 * @returns {{width: number, height: number}} Integer draw size, at least 1x1
 */
export function fitDrawSize(originalWidth, originalHeight, targetWidth, targetHeight) {
    const medidas = [originalWidth, originalHeight, targetWidth, targetHeight];

    if (medidas.some(valor => !Number.isFinite(valor) || valor <= 0)) {
        throw new Error('Invalid image dimensions');
    }

    const aspectRatio = originalWidth / originalHeight;
    const canvasAspectRatio = targetWidth / targetHeight;

    let drawWidth, drawHeight;

    if (Math.abs(aspectRatio - canvasAspectRatio) < 0.01) {
        drawWidth = targetWidth;
        drawHeight = targetHeight;
    } else if (aspectRatio >= canvasAspectRatio) {
        drawWidth = targetWidth;
        drawHeight = targetWidth / aspectRatio;
    } else {
        drawHeight = targetHeight;
        drawWidth = targetHeight * aspectRatio;
    }

    // A sub-pixel canvas would be rounded to zero and the bitmap would be empty.
    return {
        width: Math.max(1, Math.round(drawWidth)),
        height: Math.max(1, Math.round(drawHeight))
    };
}

/**
 * Converts an image source to a PNG blob via canvas rendering.
 * Maintains the aspect ratio and crops the canvas to the drawing.
 *
 * @param {string} imageSrc - Image source (data URL, blob URL)
 * @param {number} targetWidth - Target width in pixels (the drawing fits inside it)
 * @param {number} [targetHeight] - Target height (defaults to targetWidth for square)
 * @returns {Promise<{blob: Blob, width: number, height: number}>} PNG blob and its canvas size
 */
export async function convertImageToPngBlob(imageSrc, targetWidth, targetHeight = null) {
    if (targetHeight === null) {
        targetHeight = targetWidth;
    }

    const img = await loadImage(imageSrc);

    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;

    const { width, height } = fitDrawSize(originalWidth, originalHeight, targetWidth, targetHeight);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
            resultado => resultado ? resolve(resultado) : reject(new Error('Canvas toBlob returned null')),
            'image/png'
        );
    });

    return { blob, width, height };
}

/**
 * Converts an SVG string to a PNG blob.
 * Creates a temporary blob URL from the SVG, renders it via canvas.
 *
 * @param {string} svgString - SVG markup string
 * @param {number} targetWidth - Target width in pixels (the drawing fits inside it)
 * @param {number} [targetHeight] - Target height (defaults to targetWidth for square)
 * @returns {Promise<{blob: Blob, width: number, height: number}>} PNG blob and its canvas size
 */
export async function convertSvgToPngBlob(svgString, targetWidth, targetHeight = null) {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    try {
        return await convertImageToPngBlob(url, targetWidth, targetHeight);
    } finally {
        URL.revokeObjectURL(url);
    }
}
