// Path: js/draw_tools/point_tool/point-custom-icons.js

/**
 * @fileoverview Runtime helpers for user-uploaded custom point icons.
 *
 * A custom marker is stored on a point as `markerSymbol = 'custom:<iconId>'`.
 * Uploaded files are normalized once (rasterized, contain-fit) to a square PNG so
 * `icon-size` scaling matches the built-in marker images, sidestepping tainted-canvas
 * issues with SVG at render time. Decoded images are cached and registered per
 * feature under the feature id, keeping the `point-marker-layer` (`icon-image:
 * ['get','id']`) unchanged.
 */

import { IMAGE_CONFIG } from '@utils/image_utils.js';
import { showError } from '@utils/toast_service.js';
import { getCustomIconBlob, getEventBus } from '../../store';
import { EventTypes } from '../../events/event_types.js';

const CUSTOM_PREFIX = 'custom:';

/** Normalized icon canvas size + pixel ratio — must match the built-in marker
 *  images (ICON_SIZE 96 / PIXEL_RATIO 2) so `icon-size` scaling is identical. */
const NORMALIZED_SIZE = 96;
const PIXEL_RATIO = 2;

// png/jpeg/webp match the backend upload allowlist; svg is accepted only as a
// rasterization *input* — `normalizeIconFile` always emits an `image/png` blob
// (canvasToBlob below), so raw SVG never reaches storage. gif is excluded to
// stay aligned with the backend (it rejects gif).
const ALLOWED_TYPES = new Set([
    'image/png', 'image/webp', 'image/jpeg', 'image/svg+xml',
]);

/** Decoded normalized images, keyed by icon id, reused across features. */
const imageCache = new Map();

/** Clear decoded images when the project is wiped, so a new/imported project
 *  never serves a previous project's decoded pixels for a reused icon id (the
 *  registry cache in customIcons.operations.js resets on the same event). */
let _cacheEventSubscribed = false;
function subscribeCacheReset() {
    if (_cacheEventSubscribed) return;
    try {
        getEventBus().on(EventTypes.ALL_DATA_CLEARED, () => imageCache.clear());
        _cacheEventSubscribed = true;
    } catch {
        // EventBus not ready yet — will retry on the next icon access.
    }
}

/**
 * Extract the icon id from a custom marker symbol.
 * @param {string} markerSymbol
 * @returns {string|null} The icon id, or null if not a custom marker
 */
export function parseCustomMarker(markerSymbol) {
    if (typeof markerSymbol !== 'string' || !markerSymbol.startsWith(CUSTOM_PREFIX)) {
        return null;
    }
    return markerSymbol.slice(CUSTOM_PREFIX.length) || null;
}

/**
 * Build the marker symbol value for a custom icon id.
 * @param {string} iconId
 * @returns {string}
 */
export function customMarkerSymbol(iconId) {
    return CUSTOM_PREFIX + iconId;
}

/**
 * Load an image from a File/Blob via an object URL.
 * @param {Blob} blob
 * @returns {Promise<HTMLImageElement>}
 */
function blobToImage(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image decode failed')); };
        img.src = url;
    });
}

/**
 * Convert a canvas to a Blob (Promise wrapper around toBlob).
 * @param {HTMLCanvasElement} canvas
 * @param {string} type
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, type) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob failed'));
        }, type);
    });
}

/**
 * Validate and normalize an uploaded icon file into a square PNG (contain-fit,
 * transparent background) plus a small thumbnail data URL. Shows a toast and
 * returns null on validation/processing failure.
 * @param {File} file
 * @returns {Promise<{blob: Blob, thumbnail: string, type: string}|null>}
 */
export async function normalizeIconFile(file) {
    if (!file) {
        showError('Nenhum arquivo selecionado');
        return null;
    }
    if (!ALLOWED_TYPES.has(file.type)) {
        showError('Tipo não suportado (use PNG, WebP, JPEG ou SVG)');
        return null;
    }
    if (file.size > IMAGE_CONFIG.maxSizeBytes) {
        const maxMB = IMAGE_CONFIG.maxSizeBytes / (1024 * 1024);
        showError(`Arquivo muito grande (máximo ${maxMB}MB)`);
        return null;
    }

    try {
        const img = await blobToImage(file);

        const canvas = document.createElement('canvas');
        canvas.width = NORMALIZED_SIZE;
        canvas.height = NORMALIZED_SIZE;
        const ctx = canvas.getContext('2d');

        // `|| NORMALIZED_SIZE` also catches the 0×0 case of SVGs without intrinsic size.
        const natW = img.naturalWidth || NORMALIZED_SIZE;
        const natH = img.naturalHeight || NORMALIZED_SIZE;
        const scale = Math.min(NORMALIZED_SIZE / natW, NORMALIZED_SIZE / natH);
        const w = Math.max(1, Math.round(natW * scale));
        const h = Math.max(1, Math.round(natH * scale));
        ctx.drawImage(img, (NORMALIZED_SIZE - w) / 2, (NORMALIZED_SIZE - h) / 2, w, h);

        const blob = await canvasToBlob(canvas, 'image/png');
        const thumbnail = canvas.toDataURL('image/png');
        return { blob, thumbnail, type: 'image/png' };
    } catch (error) {
        console.warn('normalizeIconFile failed:', error);
        showError('Não foi possível processar este arquivo de imagem');
        return null;
    }
}

/**
 * Ensure the decoded image for a custom icon is cached, loading it from the store
 * blob on first use.
 * @param {string} iconId
 * @returns {Promise<HTMLImageElement|null>}
 */
export async function ensureCustomIconImage(iconId) {
    subscribeCacheReset();
    if (imageCache.has(iconId)) return imageCache.get(iconId);
    const blob = await getCustomIconBlob(iconId);
    if (!blob) return null;
    try {
        const img = await blobToImage(blob);
        imageCache.set(iconId, img);
        return img;
    } catch (error) {
        console.warn(`Failed to decode custom icon ${iconId}:`, error);
        return null;
    }
}

/**
 * Register a custom icon image for a feature (keyed by feature id, matching the
 * built-in per-feature image scheme so the layer stays unchanged).
 * @param {Object} map - MapLibre map instance
 * @param {string} featureId
 * @param {string} iconId
 * @returns {Promise<boolean>} True if the image was registered
 */
export async function registerCustomFeatureImage(map, featureId, iconId) {
    const img = await ensureCustomIconImage(iconId);
    if (!img) return false;
    if (map.hasImage(featureId)) map.removeImage(featureId);
    map.addImage(featureId, img, { pixelRatio: PIXEL_RATIO });
    return true;
}
