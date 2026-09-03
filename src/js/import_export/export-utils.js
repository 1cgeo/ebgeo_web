// Path: js/import_export/export-utils.js

/**
 * @fileoverview Shared utilities for map export (PDF, Garmin KMZ, etc.).
 * Centralizes logic that is common across export implementations.
 */

import { deepClone } from '@utils/deep-utils.js';
// Leaf module (zero imports of its own), so reaching for the boundary control
// here does not pull the store into every exporter.
import { getControl } from '@store/control.registry.js';
// Leaf too (zero imports); `layers/styles/tactical.layers.js` already reaches for
// it from the same side of the graph.
import { isScreenAnchored } from '@js/military_tools/boundary_tool/boundary-zoom.model.js';

/**
 * Source configurations for zoom-invariant feature correction.
 * Each entry describes a GeoJSON source whose features have a
 * `createdAtZoom` property and a size/width that must be scaled
 * to match the export zoom level.
 *
 * `enabledProperty` names a boolean that opts a feature OUT when it is `false`
 * (the feature is pinned to screen pixels, so the export zoom is irrelevant).
 */
const ZOOM_INVARIANT_SOURCES = [
    { sourceName: 'texts', property: 'calculatedSize', baseProperty: 'size', maxValue: 255 },
    { sourceName: 'brushes', property: 'calculatedLineWidth', baseProperty: 'lineWidth', maxValue: Infinity },
    { sourceName: 'images', property: 'calculatedSize', baseProperty: 'size', maxValue: 10 },
    { sourceName: 'military_symbols', property: 'calculatedSize', baseProperty: 'size', maxValue: 10 },
    { sourceName: 'coordination_measures', property: 'calculatedSize', baseProperty: 'size', maxValue: 10 },
    {
        sourceName: 'boundarys',
        property: 'calculatedLineWidth',
        baseProperty: 'lineWidth',
        maxValue: 60,
        enabledProperty: 'zoomCorrectionEnabled',
    },
    {
        sourceName: 'boundary-texts',
        property: 'calculatedTextSize',
        baseProperty: 'text_size',
        maxValue: 255,
        enabledProperty: 'zoomCorrectionEnabled',
    },
    {
        sourceName: 'boundary-circles',
        property: 'calculatedStrokeWidth',
        baseProperty: 'strokeWidth',
        maxValue: 60,
        enabledProperty: 'zoomCorrectionEnabled',
    },
    {
        sourceName: 'barrier_lines',
        property: 'calculatedLineWidth',
        baseProperty: 'lineWidth',
        maxValue: 60,
        enabledProperty: 'zoomCorrectionEnabled',
    },
];

/**
 * Corrects a single GeoJSON source's features for the export zoom level.
 * @param {maplibregl.Map} hiddenMap - The off-screen map used for rendering
 * @param {{ sourceName: string, property: string, baseProperty: string, maxValue: number, enabledProperty?: string }} config
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
            if (config.enabledProperty && feature.properties[config.enabledProperty] === false) continue;

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
 * Rebuilds the boundary geometry for the export zoom.
 *
 * `applyZoomCorrections` redraws EVERY boundary at the target zoom (the echelon
 * of a screen-pinned one is geometry in KILOMETRES sized by
 * `2 ** (createdAtZoom - zoom)`; the others are zoom-invariant but still bounded
 * by the length of their own line). Only the screen-pinned ones change SHAPE
 * with the zoom, so only their circles and labels (both placed in kilometres)
 * have to be rebuilt with them.
 *
 * Silently does nothing when the boundary control is not registered, which is the
 * case in an export started before the tool ever ran.
 *
 * @param {maplibregl.Map} hiddenMap - The off-screen map used for rendering
 * @param {number} finalZoom - The target export zoom level
 * @returns {Promise<boolean>} Whether any features were changed
 */
async function correctBoundaryGroundGeometry(hiddenMap, finalZoom) {
    try {
        const control = getControl('AddBoundaryControl');
        if (typeof control?.applyZoomCorrections !== 'function' || !control.geometry) return false;

        const source = hiddenMap.getSource('boundarys');
        if (!source) return false;

        const data = await source.getData();
        if (!data?.features?.length) return false;

        const corrected = control.applyZoomCorrections(data.features, finalZoom);
        source.setData({ ...data, features: corrected });

        const rebuilt = corrected.filter(feature => isScreenAnchored(feature.properties));
        if (rebuilt.length === 0) return true;

        const rebuiltIds = new Set(rebuilt.map(feature => feature.properties.id));
        // The export zoom goes into the builders too: the label offset and the
        // circle radius ride the echelon's effective size, which is a function of
        // that zoom and NOT of the derived value stored in the feature.
        const dependents = [
            { sourceName: 'boundary-circles', build: (f) => control.geometry.generateBoundaryCircles(f, finalZoom) },
            { sourceName: 'boundary-texts', build: (f) => control.geometry.generateBoundaryTexts(f, finalZoom) },
        ];

        for (const { sourceName, build } of dependents) {
            const dependentSource = hiddenMap.getSource(sourceName);
            if (!dependentSource) continue;

            const dependentData = await dependentSource.getData();
            const kept = (dependentData?.features || []).filter(f => !rebuiltIds.has(f.properties?.parent));
            for (const feature of rebuilt) {
                kept.push(...build(feature));
            }
            dependentSource.setData({ type: 'FeatureCollection', features: kept });
        }

        return true;
    } catch (error) {
        console.error('Error rebuilding screen-pinned boundaries for export:', error);
        return false;
    }
}

/**
 * Rebuilds screen-pinned BARRIER LINES for the export zoom.
 *
 * Same reason as the boundary above, and simpler: a barrier line has no
 * dependent sources, so correcting the feature is the whole job. Only the
 * screen-pinned ones change SHAPE with the zoom (their diamonds are sized in
 * kilometres by `2 ** (createdAtZoom - zoom)`), but `applyZoomCorrections`
 * regenerates every feature, which is also what the map load does.
 *
 * Silently does nothing when the control is not registered, which is the case in
 * an export started before the tool ever ran.
 *
 * @param {maplibregl.Map} hiddenMap - The off-screen map used for rendering
 * @param {number} finalZoom - The target export zoom level
 * @returns {Promise<boolean>} Whether any features were changed
 */
async function correctBarrierLineGroundGeometry(hiddenMap, finalZoom) {
    try {
        const control = getControl('AddBarrierLineControl');
        if (typeof control?.applyZoomCorrections !== 'function') return false;

        const source = hiddenMap.getSource('barrier_lines');
        if (!source) return false;

        const data = await source.getData();
        if (!data?.features?.length) return false;

        source.setData({ ...data, features: control.applyZoomCorrections(data.features, finalZoom) });
        return true;
    } catch (error) {
        console.error('Error rebuilding screen-pinned barrier lines for export:', error);
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

    // Runs first so the generic pass below sees the final set of text and circle
    // features. The two do not overlap: this one only touches the boundaries the
    // generic pass skips (`zoomCorrectionEnabled === false`).
    if (await correctBoundaryGroundGeometry(hiddenMap, finalZoom)) {
        anyChanges = true;
    }

    // Same shape, no dependent sources: a barrier line is one feature.
    if (await correctBarrierLineGroundGeometry(hiddenMap, finalZoom)) {
        anyChanges = true;
    }

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
        // Skip images the target already has (e.g. style sprite images like
        // `etrdg:*`, loaded when the hidden map's style loads). Re-adding them
        // makes MapLibre's addImage fire an "already exists" error per image —
        // thousands of them across a multi-page mosaic export.
        if (targetMap.hasImage(id)) continue;
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
