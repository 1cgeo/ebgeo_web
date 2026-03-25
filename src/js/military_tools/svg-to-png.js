// Path: js/military_tools/svg-to-png.js

/**
 * Shared SVG/image-to-PNG conversion utility used by MilitarySymbolGenerator
 * and CoordinationMeasureGenerator.
 *
 * Both generators need to rasterize SVG content to PNG blobs for MapLibre
 * icon rendering. This module consolidates the canvas-based conversion logic.
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
 * Converts an image source to a PNG blob via canvas rendering.
 * Maintains aspect ratio and centers the image within the target dimensions.
 *
 * @param {string} imageSrc - Image source (data URL, blob URL)
 * @param {number} targetWidth - Target canvas width in pixels
 * @param {number} [targetHeight] - Target canvas height (defaults to targetWidth for square)
 * @returns {Promise<Blob>} PNG blob
 */
export async function convertImageToPngBlob(imageSrc, targetWidth, targetHeight = null) {
    if (targetHeight === null) {
        targetHeight = targetWidth;
    }

    const img = await loadImage(imageSrc);

    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;

    if (originalWidth === 0 || originalHeight === 0) {
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
        drawHeight = Math.round(targetWidth / aspectRatio);
    } else {
        drawHeight = targetHeight;
        drawWidth = Math.round(targetHeight * aspectRatio);
    }

    const offsetX = (targetWidth - drawWidth) / 2;
    const offsetY = (targetHeight - drawHeight) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null')),
            'image/png'
        );
    });
}

/**
 * Converts an SVG string to a PNG blob.
 * Creates a temporary blob URL from the SVG, renders it via canvas.
 *
 * @param {string} svgString - SVG markup string
 * @param {number} targetWidth - Target canvas width in pixels
 * @param {number} [targetHeight] - Target canvas height (defaults to targetWidth for square)
 * @returns {Promise<Blob>} PNG blob
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
