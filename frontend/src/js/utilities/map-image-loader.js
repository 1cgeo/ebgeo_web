// Path: js/utilities/map-image-loader.js

/**
 * @fileoverview Shared utility for loading blob images into a MapLibre map instance.
 * Used by military symbols, coordination measures, declination diagrams, and user images.
 */

const DEFAULT_TIMEOUT_MS = 10000;
const loads = new WeakMap();

import { captureImageContext } from '../store/image-context.js';

/**
 * Registers a count badge as a symbol image. Circle-layer translations are projected
 * against the map even with a viewport anchor; symbol offsets stay with their text.
 * @param {Object} map - MapLibre map.
 * @param {string} id - Style image id.
 * @param {Object} options - Badge appearance in CSS pixels.
 * @param {string} options.color - Fill color.
 * @param {number} options.radius - Fill radius.
 * @param {number} options.strokeWidth - White outline width.
 */
export function ensureCountBadgeImage(map, id, { color, radius, strokeWidth }) {
    if (map.hasImage(id)) return;
    const pixelRatio = 2;
    const size = Math.ceil((radius + strokeWidth + 1) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * pixelRatio;
    const context = canvas.getContext('2d');
    context.scale(pixelRatio, pixelRatio);
    context.beginPath();
    context.arc(size / 2, size / 2, radius + strokeWidth / 2, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = strokeWidth;
    context.stroke();
    map.addImage(id, context.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio });
}

/**
 * Load a blob as a MapLibre image, with optional replace-existing behaviour.
 *
 * @param {Object}  map                    - MapLibre map instance
 * @param {string}  imageId                - Unique image ID for the map
 * @param {Blob}    blob                   - PNG/image blob to load
 * @param {Object}  [options]
 * @param {boolean} [options.replaceExisting=false] - Remove existing image before adding (needed when SVG is regenerated)
 * @param {number}  [options.timeout=10000]         - Timeout in milliseconds
 * @param {number}  [options.pixelRatio=1]          - Bitmap pixels per pixel de tela. Quem rasteriza acima do
 *                                                    tamanho logico passa o fator aqui, e o simbolo ocupa o MESMO
 *                                                    espaco na tela, so que com mais detalhe. Sem isto o
 *                                                    `icon-size` da camada amplia o bitmap e o desenho borra.
 * @returns {Promise<void>}
 */
export function loadImageToMap(map, imageId, blob, { replaceExisting = false, timeout = DEFAULT_TIMEOUT_MS, pixelRatio = 1, isCurrent = captureImageContext() } = {}) {
    let pending = loads.get(map);
    if (!pending) loads.set(map, pending = new Map());
    const token = {};
    pending.set(imageId, token);
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
        const image = new Image();
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            if (pending.get(imageId) === token) pending.delete(imageId);
            if (error) reject(error);
            else resolve();
        };

        const timeoutId = setTimeout(() => {
            finish(new Error(`Timeout loading map image ${imageId}`));
        }, timeout);

        image.onload = () => {
            if (settled) return;
            if (!isCurrent() || pending.get(imageId) !== token) {
                finish(new DOMException('Carregamento de imagem substituído.', 'AbortError'));
                return;
            }
            try {
                if (replaceExisting && map.hasImage(imageId)) {
                    map.removeImage(imageId);
                }
                if (!map.hasImage(imageId)) {
                    map.addImage(imageId, image, { pixelRatio });
                }
                finish();
            } catch (error) {
                finish(error);
            }
        };

        image.onerror = () => {
            finish(new Error(`Failed to load map image ${imageId}`));
        };

        image.src = url;
    });
}
