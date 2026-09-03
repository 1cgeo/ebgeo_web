// Path: js/import_export/kmz/kmz-assets.js

/**
 * @fileoverview Collects the binary assets a KMZ needs — icon PNGs, symbol
 * images and attachment photos — and deduplicates them by identity.
 *
 * All canvas / IndexedDB / Blob work is isolated here so the KML builders stay
 * pure and node-testable.
 *
 * @module import_export/kmz/kmz-assets
 */

import { getImage, getCustomIconBlob } from '@store';
import { generatePointImage, POINT_IMAGE_HALF_SIZE } from '@js/draw_tools/point_tool/point-marker-symbols.js';
import { parseDataUrl, sanitizePathSegment } from './kml-balloon.js';
import { hashString } from './kml-document.js';

/** Folder holding icon and symbol images inside the KMZ. */
const ICON_FOLDER = 'files';

/** Folder holding user attachment photos inside the KMZ. */
const PHOTO_FOLDER = 'files/fotos';

/** Native pixel size of a generated point icon, in CSS pixels. */
export const POINT_ICON_NATIVE_PX = POINT_IMAGE_HALF_SIZE * 2;

/**
 * Registry that writes assets into a JSZip instance exactly once each and
 * hands back the relative href to reference them by.
 */
export class AssetRegistry {
    /**
     * @param {import('jszip')} zip - Target zip archive
     */
    constructor(zip) {
        this._zip = zip;
        /** @type {Map<string, {href: string, width: number, height: number}>} */
        this._assets = new Map();
    }

    /**
     * Whether an asset with this key has already been written.
     *
     * @param {string} key - Dedupe key
     * @returns {boolean} True when the asset exists
     */
    has(key) {
        return this._assets.has(key);
    }

    /**
     * Returns a previously registered asset.
     *
     * @param {string} key - Dedupe key
     * @returns {{href: string, width: number, height: number}|undefined} Asset record
     */
    get(key) {
        return this._assets.get(key);
    }

    /**
     * Registers a binary asset, writing it to the archive on first sight.
     *
     * @param {string} key - Dedupe key
     * @param {Blob|Uint8Array} data - Binary payload
     * @param {Object} [meta={}] - Asset metadata
     * @param {number} [meta.width] - Intrinsic width in pixels
     * @param {number} [meta.height] - Intrinsic height in pixels
     * @param {string} [meta.extension='png'] - File extension
     * @param {string} [meta.folder] - Destination folder inside the KMZ
     * @returns {{href: string, width: number, height: number}} Asset record
     */
    add(key, data, { width = 0, height = 0, extension = 'png', folder = ICON_FOLDER } = {}) {
        const existing = this._assets.get(key);
        if (existing) return existing;

        const href = `${folder}/${hashString(key)}.${extension}`;
        this._zip.file(href, data);

        const record = { href, width, height };
        this._assets.set(key, record);
        return record;
    }

    /**
     * Registers a base64 payload (used for inline attachment photos).
     *
     * @param {string} key - Dedupe key
     * @param {string} base64 - Base64-encoded payload
     * @param {Object} [meta={}] - Asset metadata
     * @param {string} [meta.extension='jpg'] - File extension
     * @param {string} [meta.folder] - Destination folder inside the KMZ
     * @returns {{href: string, width: number, height: number}} Asset record
     */
    addBase64(key, base64, { extension = 'jpg', folder = PHOTO_FOLDER } = {}) {
        const existing = this._assets.get(key);
        if (existing) return existing;

        const href = `${folder}/${hashString(key)}.${extension}`;
        this._zip.file(href, base64, { base64: true });

        const record = { href, width: 0, height: 0 };
        this._assets.set(key, record);
        return record;
    }
}

/**
 * Converts raw RGBA pixel data into a PNG blob via an offscreen canvas.
 *
 * @param {Uint8Array|Uint8ClampedArray} rgba - Pixel data
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {Promise<Blob|null>} PNG blob, or null when encoding fails
 */
export async function rgbaToPngBlob(rgba, width, height) {
    if (!rgba || !Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba));
    ctx.putImageData(imageData, 0, 0);

    return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
}

/**
 * Resolves the icon PNG for a point feature, generating it when needed.
 *
 * Built-in marker symbols are re-rendered from the shared canvas generator so
 * fill/border colors are baked in; custom icons come straight from IndexedDB.
 *
 * @param {AssetRegistry} registry - Asset registry to write into
 * @param {Object} properties - Point feature properties
 * @returns {Promise<{href: string, width: number, height: number}|null>} Asset record
 */
export async function resolvePointIcon(registry, properties = {}) {
    const symbol = properties.markerSymbol || 'circle';

    if (symbol.startsWith('custom:')) {
        const iconId = symbol.slice('custom:'.length);
        const key = `ci|${iconId}`;
        if (registry.has(key)) return registry.get(key);

        const blob = await getCustomIconBlob(iconId);
        if (!blob) return null;
        return registry.add(key, blob, {
            width: POINT_ICON_NATIVE_PX,
            height: POINT_ICON_NATIVE_PX,
        });
    }

    const fillColor = properties.fillColor || '#000000';
    const lineColor = properties.lineColor || '#ffffff';
    const lineWidth = Number.isFinite(properties.lineWidth) ? properties.lineWidth : 2;

    const key = `pt|${symbol}|${fillColor}|${lineColor}|${lineWidth}`;
    if (registry.has(key)) return registry.get(key);

    const generated = generatePointImage(symbol, fillColor, lineColor, lineWidth);
    if (!generated) return null;

    const blob = await rgbaToPngBlob(generated.data, generated.width, generated.height);
    if (!blob) return null;

    return registry.add(key, blob, {
        width: POINT_ICON_NATIVE_PX,
        height: POINT_ICON_NATIVE_PX,
    });
}

/**
 * Resolves the PNG for a feature whose image was already rendered and stored
 * (military symbols, coordination measures, declination diagrams, image features).
 *
 * Reads the persisted blob first — it matches exactly what the user sees and
 * works even for a map that was never rendered this session — and only falls
 * back to regenerating when nothing was stored.
 *
 * @param {AssetRegistry} registry - Asset registry to write into
 * @param {string} featureId - Feature id, which is also the image store key
 * @param {Object} [options={}] - Fallback options
 * @param {Function} [options.regenerate] - Async fallback returning `{blob, width, height}`
 * @param {string} [options.keyPrefix='fi'] - Dedupe key prefix
 * @returns {Promise<{href: string, width: number, height: number}|null>} Asset record
 */
export async function resolveStoredImage(registry, featureId, { regenerate, keyPrefix = 'fi' } = {}) {
    if (!featureId) return null;

    const key = `${keyPrefix}|${featureId}`;
    if (registry.has(key)) return registry.get(key);

    const stored = await getImage(featureId);
    if (stored) {
        return registry.add(key, stored, { extension: extensionForBlob(stored) });
    }

    if (typeof regenerate !== 'function') return null;

    const generated = await regenerate();
    if (!generated?.blob) return null;

    // `width` e `height` do registro sao a medida do ARQUIVO, que e o que o `<scale>` do
    // KML toma por base. O gerador devolve o tamanho LOGICO mais a razao de pixels com que
    // rasterizou, entao a conversao acontece aqui: gravar o logico faria o icone sair
    // `pixelRatio` vezes maior no Google Earth.
    const razao = Number.isFinite(generated.pixelRatio) && generated.pixelRatio > 0
        ? generated.pixelRatio
        : 1;

    return registry.add(key, generated.blob, {
        width: generated.width * razao,
        height: generated.height * razao,
    });
}

/**
 * Writes a feature's attachment photos into the archive.
 *
 * Photos live inline on the feature as base64 data URLs, so no store lookup is
 * needed — only decoding and deduplication.
 *
 * @param {AssetRegistry} registry - Asset registry to write into
 * @param {Object} feature - GeoJSON feature
 * @returns {Array<{href: string, name: string}>} References for the balloon
 */
export function collectPhotos(registry, feature) {
    const images = feature?.properties?.images;
    if (!Array.isArray(images) || images.length === 0) return [];

    const featureId = sanitizePathSegment(feature.properties?.id, 'feicao');
    const refs = [];

    for (const image of images) {
        if (!image?.data) continue;

        const parsed = parseDataUrl(image.data);
        if (!parsed) continue;

        const key = `photo|${featureId}|${image.id ?? refs.length}`;
        const record = registry.addBase64(key, parsed.base64, { extension: parsed.extension });
        refs.push({ href: record.href, name: image.name || '' });
    }

    return refs;
}

/**
 * Picks a file extension for a stored blob based on its MIME type.
 *
 * @param {Blob} blob - Stored image blob
 * @returns {string} File extension without the dot
 */
function extensionForBlob(blob) {
    switch (blob?.type) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        case 'image/svg+xml':
            return 'svg';
        default:
            return 'png';
    }
}
