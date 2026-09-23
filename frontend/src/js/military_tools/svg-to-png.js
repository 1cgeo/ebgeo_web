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

/** Crop transparent margins, retaining the old image centre as the map anchor. */
export async function cropPngToDrawing(blob, pixelRatio = 1) {
    const bitmap = await createImageBitmap(blob);
    const originalWidth = bitmap.width, originalHeight = bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = originalWidth; canvas.height = originalHeight;
    const context = canvas.getContext('2d');
    try { context.drawImage(bitmap, 0, 0); } finally { bitmap.close(); }
    const pixels = context.getImageData(0, 0, originalWidth, originalHeight).data;
    let left = originalWidth, top = originalHeight, right = -1, bottom = -1;
    for (let y = 0; y < originalHeight; y++) {
        for (let x = 0; x < originalWidth; x++) {
            if (pixels[(y * originalWidth + x) * 4 + 3] === 0) continue;
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
    }
    if (right < left) throw new Error('Cannot crop an empty diagram');
    const padding = Math.ceil(2 * pixelRatio);
    left = Math.max(0, left - padding); top = Math.max(0, top - padding);
    right = Math.min(originalWidth - 1, right + padding);
    bottom = Math.min(originalHeight - 1, bottom + padding);
    const width = right - left + 1, height = bottom - top + 1;
    const cropped = document.createElement('canvas');
    cropped.width = width; cropped.height = height;
    cropped.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, width, height);
    const croppedBlob = await new Promise((resolve, reject) => cropped.toBlob(
        value => value ? resolve(value) : reject(new Error('Canvas toBlob returned null')), 'image/png'
    ));
    return {
        blob: croppedBlob, width: width / pixelRatio, height: height / pixelRatio, pixelRatio,
        anchor: 'center',
        iconOffset: [(left + width / 2 - originalWidth / 2) / pixelRatio, (top + height / 2 - originalHeight / 2) / pixelRatio],
    };
}
