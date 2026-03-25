// Path: js/import_export/export-utils.js

/**
 * @fileoverview Shared utilities for map export (PDF, Garmin KMZ, etc.).
 * Centralizes logic that is common across export implementations.
 */

import { deepClone } from '@utils/deep-utils.js';

/**
 * Source configurations for zoom-invariant feature correction.
 * Each entry describes a GeoJSON source whose features have a
 * `createdAtZoom` property and a size/width that must be scaled
 * to match the export zoom level.
 */
const ZOOM_INVARIANT_SOURCES = [
    { sourceName: 'texts', property: 'calculatedSize', baseProperty: 'size', maxValue: 255 },
    { sourceName: 'brushes', property: 'calculatedLineWidth', baseProperty: 'lineWidth', maxValue: Infinity },
    { sourceName: 'images', property: 'calculatedSize', baseProperty: 'size', maxValue: 10 },
    { sourceName: 'military_symbols', property: 'calculatedSize', baseProperty: 'size', maxValue: 10 },
    { sourceName: 'coordination-measures-source', property: 'calculatedSize', baseProperty: 'size', maxValue: 10 },
];

/**
 * Corrects a single GeoJSON source's features for the export zoom level.
 * @param {maplibregl.Map} hiddenMap - The off-screen map used for rendering
 * @param {{ sourceName: string, property: string, baseProperty: string, maxValue: number }} config
 * @param {number} finalZoom - The target export zoom level
 * @returns {Promise<boolean>} Whether any features were changed
 */
async function correctSourceFeatures(hiddenMap, config, finalZoom) {
    try {
        const source = hiddenMap.getSource(config.sourceName);
        if (!source) return false;

        const data = await source.getData();
        if (!data?.features?.length) return false;

        let hasChanges = false;

        for (const feature of data.features) {
            if (!feature?.properties) continue;
            if (typeof feature.properties.createdAtZoom !== 'number') continue;
            if (typeof feature.properties[config.baseProperty] !== 'number') continue;

            const zoomDiff = finalZoom - feature.properties.createdAtZoom;
            const scale = Math.pow(2, zoomDiff);
            const baseVal = feature.properties[config.baseProperty];
            if (baseVal <= 0) continue;

            const newVal = Math.min(baseVal * scale, config.maxValue);
            if (Math.abs(feature.properties[config.property] - newVal) > 0.001) {
                feature.properties[config.property] = newVal;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            source.setData(data);
        }

        return hasChanges;
    } catch (error) {
        console.error(`Error correcting features from source ${config.sourceName}:`, error);
        return false;
    }
}

/**
 * Adjusts zoom-dependent feature sizes for the export zoom level.
 * Features whose `createdAtZoom` differs from the export zoom get their
 * calculated size/width scaled so they render at the correct visual size.
 *
 * @param {maplibregl.Map} hiddenMap - The off-screen map used for rendering
 * @param {number} finalZoom - The target export zoom level
 * @returns {Promise<boolean>} Whether any features were changed
 */
export async function correctZoomInvariantFeatures(hiddenMap, finalZoom) {
    let anyChanges = false;

    for (const config of ZOOM_INVARIANT_SOURCES) {
        const changed = await correctSourceFeatures(hiddenMap, config, finalZoom);
        if (changed) anyChanges = true;
    }

    return anyChanges;
}

/**
 * Copies all custom images from one MapLibre map to another.
 * Used when creating a hidden map for off-screen rendering.
 *
 * @param {maplibregl.Map} sourceMap - The map to copy images from
 * @param {maplibregl.Map} targetMap - The map to copy images to
 */
export function transferMapImages(sourceMap, targetMap) {
    const loadedImages = sourceMap.listImages();
    for (const id of loadedImages) {
        const image = sourceMap.getImage(id);
        if (image) {
            targetMap.addImage(id, image.data, { sdf: image.sdf });
        }
    }
}

// ===== EXPORT PROGRESS MODAL =====

/**
 * Creates a progress modal for long-running export operations.
 * All three export flows (PDF, Garmin KMZ, Briefing PDF) share this UI.
 *
 * @param {Object} options
 * @param {string} options.title - Modal title (e.g. 'Exportando mapa...')
 * @param {Function} options.onCancel - Called when the user clicks "Cancelar"
 * @returns {{ modal: HTMLElement, updateProgress: (percent: number, text: string) => void, remove: () => void }}
 */
export function createExportProgressModal({ title, onCancel }) {
    const modal = document.createElement('div');
    modal.className = 'pdf-export-modal';

    const content = document.createElement('div');
    content.className = 'pdf-export-modal__content';

    const titleEl = document.createElement('div');
    titleEl.className = 'pdf-export-modal__title';
    titleEl.textContent = title;

    const progressText = document.createElement('div');
    progressText.className = 'pdf-export-modal__progress-text';
    progressText.textContent = 'Preparando...';

    const barContainer = document.createElement('div');
    barContainer.className = 'pdf-export-modal__bar-container';

    const bar = document.createElement('div');
    bar.className = 'pdf-export-modal__bar';
    barContainer.appendChild(bar);

    const hint = document.createElement('div');
    hint.className = 'pdf-export-modal__hint';
    hint.textContent = 'Isso pode levar alguns segundos...';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pdf-export-modal__cancel-btn';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', () => {
        onCancel();
        remove();
    });

    content.appendChild(titleEl);
    content.appendChild(progressText);
    content.appendChild(barContainer);
    content.appendChild(hint);
    content.appendChild(cancelBtn);
    modal.appendChild(content);

    document.body.appendChild(modal);

    /** Updates the progress bar width and status text. */
    function updateProgress(percent, text) {
        bar.style.width = `${percent}%`;
        progressText.textContent = text;
    }

    /** Removes the modal from the DOM (idempotent). */
    function remove() {
        if (modal.parentNode) {
            document.body.removeChild(modal);
        }
    }

    return { modal, updateProgress, remove };
}

// ===== CLEAN STYLE =====

/**
 * Known preview source/layer IDs used by export tools.
 * Any export that creates a hidden map should strip these
 * so one exporter's preview doesn't bleed into another's output.
 */
const PREVIEW_LAYER_IDS = [
    // PDF export preview
    'pdf-export-preview-fill',
    'pdf-export-preview-stroke',
    'pdf-export-usable-stroke',
    // Garmin KMZ export preview
    'garmin-kmz-preview-fill',
    'garmin-kmz-preview-stroke',
    'garmin-kmz-preview-grid',
];

const PREVIEW_SOURCE_IDS = [
    'pdf-export-preview',
    'garmin-kmz-preview',
];

/**
 * Returns a deep clone of the map style with all export preview
 * layers and sources removed. Both PDF and Garmin previews are
 * stripped regardless of which exporter calls this.
 *
 * @param {maplibregl.Map} map - The main map instance
 * @returns {Object} Clean MapLibre style object
 */
export function getCleanMapStyle(map) {
    const style = deepClone(map.getStyle());

    style.layers = style.layers.filter(l => !PREVIEW_LAYER_IDS.includes(l.id));

    for (const sourceId of PREVIEW_SOURCE_IDS) {
        if (style.sources?.[sourceId]) {
            delete style.sources[sourceId];
        }
    }

    return style;
}
