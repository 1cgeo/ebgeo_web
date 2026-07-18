// Path: js/utilities/map-image-loader.js

/**
 * @fileoverview Shared utility for loading blob images into a MapLibre map instance.
 * Used by military symbols, coordination measures, declination diagrams, and user images.
 */

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Load a blob as a MapLibre image, with optional replace-existing behaviour.
 *
 * @param {Object}  map                    - MapLibre map instance
 * @param {string}  imageId                - Unique image ID for the map
 * @param {Blob}    blob                   - PNG/image blob to load
 * @param {Object}  [options]
 * @param {boolean} [options.replaceExisting=false] - Remove existing image before adding (needed when SVG is regenerated)
 * @param {number}  [options.timeout=10000]         - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export function loadImageToMap(map, imageId, blob, { replaceExisting = false, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
        const image = new Image();

        const timeoutId = setTimeout(() => {
            URL.revokeObjectURL(url);
            reject(new Error(`Timeout loading map image ${imageId}`));
        }, timeout);

        image.onload = () => {
            clearTimeout(timeoutId);
            try {
                if (replaceExisting && map.hasImage(imageId)) {
                    map.removeImage(imageId);
                }
                if (!map.hasImage(imageId)) {
                    map.addImage(imageId, image);
                }
                URL.revokeObjectURL(url);
                resolve();
            } catch (error) {
                URL.revokeObjectURL(url);
                reject(error);
            }
        };

        image.onerror = () => {
            clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            reject(new Error(`Failed to load map image ${imageId}`));
        };

        image.src = url;
    });
}
