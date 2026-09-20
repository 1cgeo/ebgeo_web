// Path: js/utilities/image_utils.js
/**
 * @fileoverview Image processing utilities.
 * Provides compression, thumbnail generation, and validation for images.
 */

import { blobToDataUrl } from './blob-to-data-url.js';
import { ImageRefusal, imageRefusalNotice } from './image-limit-phrases.js';

/**
 * Configuration for image handling.
 *
 * `maxSizeBytes` MIRRORS THE SERVER: `config.images.maxSizeMb` (`backend/src/config.js`,
 * `MAX_IMAGE_SIZE_MB`, default 10) is the ceiling `images.service.js` enforces, and
 * `allowedTypes` is byte-for-byte its `ALLOWED_MIME_TYPES`. `/api/config` does NOT publish
 * either of them, so this copy cannot be hydrated from the server; keep the two in step by
 * hand, and note that both sides refuse with `>` (a file of EXACTLY the ceiling is accepted).
 *
 * @constant {Object}
 */
export const IMAGE_CONFIG = {
    maxSizeBytes: 10 * 1024 * 1024,  // 10MB max upload (mirrors MAX_IMAGE_SIZE_MB)
    compressionThreshold: 2 * 1024 * 1024,  // Compress above 2MB
    compressionQuality: 0.8,
    maxDimension: 2048,
    thumbnailSize: 150,
    thumbnailQuality: 0.7,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],

    /**
     * Longest decoded side accepted, in pixels.
     *
     * A BYTE CEILING DOES NOT BOUND PIXELS. A solid-colour PNG compresses by three orders of
     * magnitude, so a 300 kB file can decode to 30000x30000 and sail past `maxSizeBytes`; that
     * is a decompression bomb, and before this guard it went straight into a canvas.
     *
     * 8192 is chosen well BELOW where browsers break, not at it: Chrome and Firefox top out
     * near 16384 px of side, Safari lower, and a canvas over the limit fails by returning a
     * blank bitmap rather than by throwing. It is also comfortably above every real camera
     * (a 45 MP body is 8192x5464), so nothing a person actually photographs is refused.
     */
    maxPixelSide: 8192,

    /**
     * Total decoded pixels accepted.
     *
     * The side ceiling alone still admits 8192x8192 = 67 MP, which is 268 MB of RGBA held in
     * memory while the canvas copy is made — enough to kill the tab on a modest machine. 50 MP
     * (200 MB decoded) is the point where this product stops being able to promise the tab
     * survives, and every image this tool keeps is downscaled to 800 px anyway, so nothing
     * above it survives the next step in any case.
     */
    maxPixelCount: 50 * 1000 * 1000,
};

/**
 * Loads a base64 image and returns the HTMLImageElement.
 * @param {string} src - Image source (data URL or path)
 * @returns {Promise<HTMLImageElement>} Loaded image element
 */
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = src;
    });
}

/**
 * Whether a file name ends in one of the allowed image extensions, case-insensitively.
 * @param {string} [name] - File name
 * @returns {boolean} True for e.g. "FOTO.JPG"; false for a missing or extensionless name
 */
function hasAllowedExtension(name) {
    const lower = String(name ?? '').toLowerCase();
    return IMAGE_CONFIG.allowedExtensions.some((ext) => lower.endsWith(ext));
}

/**
 * Validates an image file, BEFORE a single byte is read.
 *
 * `File.size` and `File.type` are metadata the browser already holds, so this answers without
 * touching the bytes — which is the whole point: a `FileReader` on a 400 MB file builds a 530 MB
 * base64 string on the main thread, and by the time anything could refuse it the tab is already
 * gone. Every caller must run this before the read, not after.
 *
 * It does NOT bound pixels: a file can be small in bytes and enormous decoded. That is
 * {@link validateImageDimensions}, which can only answer once the header has been parsed.
 *
 * @param {File} file - File to validate
 * @param {Object} [options]
 * @param {boolean} [options.allowExtensionFallback=false] - Judge an EMPTY MIME by extension
 * @returns {{valid: boolean, reason?: string}} `reason` is the pt-BR sentence to show the person
 */
export function validateImageFile(file, options = {}) {
    if (!file) {
        return { valid: false, reason: imageRefusalNotice(ImageRefusal.AUSENTE) };
    }

    if (file.size > IMAGE_CONFIG.maxSizeBytes) {
        return {
            valid: false,
            reason: imageRefusalNotice(ImageRefusal.PESO, {
                bytes: file.size,
                maxBytes: IMAGE_CONFIG.maxSizeBytes,
            }),
        };
    }

    // An EMPTY MIME is not a wrong MIME. On Windows an extension with no registry mapping, and
    // some drag sources, hand over `type: ''` for a perfectly good .jpg. Doors that re-encode
    // through a canvas (the image tool, the drop) opt into judging those by extension; doors that
    // store the original bytes do not, because the server would refuse the upload by MIME.
    const tipoAceito = IMAGE_CONFIG.allowedTypes.includes(file.type)
        || (options.allowExtensionFallback === true && !file.type && hasAllowedExtension(file.name));
    if (!tipoAceito) {
        return {
            valid: false,
            reason: imageRefusalNotice(ImageRefusal.TIPO, { tipos: IMAGE_CONFIG.allowedTypes }),
        };
    }

    return { valid: true };
}

/**
 * Validates the DECODED size of an image, in pixels.
 *
 * Pure on purpose (no DOM, no canvas): it is the half of the guard that can be pinned down in
 * node, and the half whose edge cases are the ones that bite. It answers about numbers the
 * caller has just read off a decoded image, so it must survive everything an image element can
 * hand back — `naturalWidth` reads 0 for an SVG with no intrinsic size, and a failed decode
 * leaves NaN. `Number.isFinite` is the test, never `x ?? 0` (which lets NaN through) nor
 * `x || fallback` (which lets Infinity through).
 *
 * CALL IT BEFORE `drawImage`, not after. `load` fires once the header is parsed and the
 * dimensions are known, while browsers defer the full raster decode until something draws the
 * image, so refusing here is what actually avoids allocating the bitmap and the canvas copy.
 *
 * @param {number} width - Decoded width in pixels
 * @param {number} height - Decoded height in pixels
 * @returns {{valid: boolean, reason?: string}} `reason` is the pt-BR sentence to show the person
 */
export function validateImageDimensions(width, height) {
    const legivel = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    if (!legivel) {
        return { valid: false, reason: imageRefusalNotice(ImageRefusal.ILEGIVEL) };
    }

    if (width > IMAGE_CONFIG.maxPixelSide || height > IMAGE_CONFIG.maxPixelSide) {
        return {
            valid: false,
            reason: imageRefusalNotice(ImageRefusal.LADO, {
                width, height, maxSide: IMAGE_CONFIG.maxPixelSide,
            }),
        };
    }

    if (width * height > IMAGE_CONFIG.maxPixelCount) {
        return {
            valid: false,
            reason: imageRefusalNotice(ImageRefusal.AREA, {
                width, height, maxPixels: IMAGE_CONFIG.maxPixelCount,
            }),
        };
    }

    return { valid: true };
}

/**
 * The byte/MIME gate AND the pixel gate, for a door that only holds a `File`.
 *
 * The photo galleries hand a file straight to `processImageFile`, which decodes it twice (once
 * to compress, once for the thumbnail) with no chance to look at it in between. So the decode
 * happens here, once, only for a file that already passed the cheap tests — a 300 kB PNG of
 * 30000x30000 is exactly the shape that survives a byte ceiling and then allocates gigabytes.
 *
 * An object URL, never `FileReader`: a data URI of an 8 MB photo is an 11 MB string the main
 * thread has to build before decoding even starts. A file the browser cannot decode is refused
 * rather than let through, because everything downstream assumes an image.
 *
 * @param {File} file - File the person picked
 * @returns {Promise<{valid: boolean, reason?: string}>} `reason` is the pt-BR sentence to show
 */
export async function validateImagePayload(file) {
    const basica = validateImageFile(file);
    if (!basica.valid) return basica;

    let url;
    try {
        url = URL.createObjectURL(file);
        const img = await loadImage(url);
        return validateImageDimensions(img.naturalWidth, img.naturalHeight);
    } catch {
        return { valid: false, reason: imageRefusalNotice(ImageRefusal.ILEGIVEL) };
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

/**
 * Compresses an image using canvas.
 * @param {string} base64Data - Base64 encoded image
 * @param {Object} options - Compression options
 * @param {number} [options.maxDimension] - Max dimension in pixels
 * @param {number} [options.quality] - Output quality (0-1)
 * @param {string} [options.mimeType='image/jpeg'] - Output type ('image/webp' preserves transparency)
 * @returns {Promise<string>} Compressed base64 image
 */
export async function compressImage(base64Data, options = {}) {
    const maxDimension = options.maxDimension ?? IMAGE_CONFIG.maxDimension;
    const quality = options.quality ?? IMAGE_CONFIG.compressionQuality;
    const mimeType = options.mimeType ?? 'image/jpeg';

    try {
        const img = await loadImage(base64Data);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        return canvas.toDataURL(mimeType, quality);
    } catch {
        console.warn('ImageUtils: Compression failed, using original');
        return base64Data;
    }
}

/**
 * Creates a thumbnail from an image.
 * @param {string} base64Data - Base64 encoded image
 * @param {Object} options - Thumbnail options
 * @param {number} [options.size] - Thumbnail size in pixels (square)
 * @param {number} [options.quality] - JPEG quality (0-1)
 * @returns {Promise<string>} Thumbnail as base64
 */
export async function createThumbnail(base64Data, options = {}) {
    const size = options.size ?? IMAGE_CONFIG.thumbnailSize;
    const quality = options.quality ?? IMAGE_CONFIG.thumbnailQuality;

    try {
        const img = await loadImage(base64Data);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Crop to center square
        const minDimension = Math.min(img.width, img.height);
        const sx = (img.width - minDimension) / 2;
        const sy = (img.height - minDimension) / 2;

        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, sx, sy, minDimension, minDimension, 0, 0, size, size);

        return canvas.toDataURL('image/jpeg', quality);
    } catch {
        console.warn('ImageUtils: Thumbnail creation failed');
        return base64Data;
    }
}

/**
 * Processes an image file - compresses if needed and generates thumbnail.
 * @param {File} file - Image file
 * @param {Object} options - Processing options
 * @param {number} [options.compressionThreshold] - Size threshold for compression
 * @returns {Promise<Object>} Object with data (base64) and thumbnail (base64)
 */
export async function processImageFile(file, options = {}) {
    const threshold = options.compressionThreshold ?? IMAGE_CONFIG.compressionThreshold;

    let imageData = await blobToDataUrl(file);

    if (file.size > threshold) {
        imageData = await compressImage(imageData);
    }

    const thumbnail = await createThumbnail(imageData);

    return { data: imageData, thumbnail };
}
