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
    const maxDimension = options.maxDimension || IMAGE_CONFIG.maxDimension;
    const quality = options.quality || IMAGE_CONFIG.compressionQuality;

    return new Promise((resolve) => {
        const img = new Image();

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                // Use willReadFrequently for better performance with multiple readback operations
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                let { width, height } = img;

                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = (height / width) * maxDimension;
                        width = maxDimension;
                    } else {
                        width = (width / height) * maxDimension;
                        height = maxDimension;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                const compressed = canvas.toDataURL('image/jpeg', quality);
                resolve(compressed);
            } catch {
                // Fallback to original on compression failure
                console.warn('ImageUtils: Compression failed, using original');
                resolve(base64Data);
            }
        };

        img.onerror = () => {
            console.warn('ImageUtils: Image load failed for compression');
            resolve(base64Data);
        };

        img.src = base64Data;
    });
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
    const size = options.size || IMAGE_CONFIG.thumbnailSize;
    const quality = options.quality || IMAGE_CONFIG.thumbnailQuality;

    return new Promise((resolve) => {
        const img = new Image();

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                // Use willReadFrequently for better performance with multiple readback operations
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                // Create square thumbnail (crop to center)
                const minDimension = Math.min(img.width, img.height);
                const sx = (img.width - minDimension) / 2;
                const sy = (img.height - minDimension) / 2;

                canvas.width = size;
                canvas.height = size;
                ctx.drawImage(img, sx, sy, minDimension, minDimension, 0, 0, size, size);

                const thumbnail = canvas.toDataURL('image/jpeg', quality);
                resolve(thumbnail);
            } catch {
                console.warn('ImageUtils: Thumbnail creation failed');
                resolve(base64Data);
            }
        };

        img.onerror = () => {
            console.warn('ImageUtils: Image load failed for thumbnail');
            resolve(base64Data);
        };

        img.src = base64Data;
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
    const threshold = options.compressionThreshold || IMAGE_CONFIG.compressionThreshold;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                let imageData = e.target.result;

                // Compress if above threshold
                if (file.size > threshold) {
                    imageData = await compressImage(imageData);
                }

                // Generate thumbnail
                const thumbnail = await createThumbnail(imageData);

                resolve({
                    data: imageData,
                    thumbnail: thumbnail,
                });
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}
