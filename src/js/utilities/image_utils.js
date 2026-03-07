// Path: js/utilities/image_utils.js
/**
 * @fileoverview Image processing utilities.
 * Provides compression, thumbnail generation, and validation for images.
 */

/**
 * Configuration for image handling.
 * @constant {Object}
 */
export const IMAGE_CONFIG = {
    maxSizeBytes: 10 * 1024 * 1024,  // 10MB max upload
    compressionThreshold: 2 * 1024 * 1024,  // Compress above 2MB
    compressionQuality: 0.8,
    maxDimension: 2048,
    thumbnailSize: 150,
    thumbnailQuality: 0.7,
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
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
 * Validates an image file.
 * @param {File} file - File to validate
 * @returns {Object} Validation result with valid (boolean) and reason (string)
 */
export function validateImageFile(file) {
    if (!file) {
        return { valid: false, reason: 'Nenhum arquivo selecionado' };
    }

    if (file.size > IMAGE_CONFIG.maxSizeBytes) {
        const maxMB = IMAGE_CONFIG.maxSizeBytes / (1024 * 1024);
        return { valid: false, reason: `Arquivo muito grande (máximo ${maxMB}MB)` };
    }

    if (!IMAGE_CONFIG.allowedTypes.includes(file.type)) {
        return { valid: false, reason: 'Tipo de arquivo não suportado (use JPEG, PNG, GIF ou WebP)' };
    }

    return { valid: true };
}

/**
 * Compresses an image using canvas.
 * @param {string} base64Data - Base64 encoded image
 * @param {Object} options - Compression options
 * @param {number} [options.maxDimension] - Max dimension in pixels
 * @param {number} [options.quality] - JPEG quality (0-1)
 * @returns {Promise<string>} Compressed base64 image
 */
export async function compressImage(base64Data, options = {}) {
    const maxDimension = options.maxDimension ?? IMAGE_CONFIG.maxDimension;
    const quality = options.quality ?? IMAGE_CONFIG.compressionQuality;

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

        return canvas.toDataURL('image/jpeg', quality);
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
 * Reads a File as a data URL.
 * @param {File} file - File to read
 * @returns {Promise<string>} Base64 data URL
 */
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
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

    let imageData = await readFileAsDataURL(file);

    if (file.size > threshold) {
        imageData = await compressImage(imageData);
    }

    const thumbnail = await createThumbnail(imageData);

    return { data: imageData, thumbnail };
}
