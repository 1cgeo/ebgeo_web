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
import { isScreenAnchored } from '@tools/helpers/boundary-zoom.model.js';
// The live map's registry of source → layer name; exporters copy that map's sources.
import { getLayerFailureNotice } from '@js/terrain/layer-failure-notice.js';

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
    { sourceName: 'engineering_symbols', property: 'calculatedSize', baseProperty: 'size', maxValue: 10 },
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
        sourceName: 'coordination_lines',
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
 * Silently does nothing when the boundary control is not registered, and also
 * when what answers is the tool-registry STAND-IN: it has no `geometry`, which
 * is exactly the half this function needs.
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
 * Rebuilds screen-pinned COORDINATION LINES for the export zoom.
 *
 * Same reason as the boundary above, and simpler: a coordination line has no dependent
 * sources, so correcting the feature is the whole job. Only the screen-pinned ones change
 * SHAPE with the zoom (their glyphs are sized in kilometres by `2 ** (createdAtZoom - zoom)`),
 * but `applyZoomCorrections` regenerates every feature, which is also what the map load does.
 *
 * Silently does nothing when the control is not registered, which is the case in an export
 * started before the tool ever ran. The stand-in of `tool-registry.js` answers
 * `applyZoomCorrections` with the numbers only and carries no `geometry`, so the check below
 * asks for BOTH before trusting the call to rebuild anything.
 *
 * @param {maplibregl.Map} hiddenMap - The off-screen map used for rendering
 * @param {number} finalZoom - The target export zoom level
 * @returns {Promise<boolean>} Whether any features were changed
 */
async function correctCoordinationLineGroundGeometry(hiddenMap, finalZoom) {
    try {
        const control = getControl('AddCoordinationLineControl');
        if (typeof control?.applyZoomCorrections !== 'function' || !control.geometry) return false;

        const source = hiddenMap.getSource('coordination_lines');
        if (!source) return false;

        const data = await source.getData();
        if (!data?.features?.length) return false;

        source.setData({ ...data, features: control.applyZoomCorrections(data.features, finalZoom) });
        return true;
    } catch (error) {
        console.error('Error rebuilding screen-pinned coordination lines for export:', error);
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

    // Same shape, no dependent sources: a coordination line is one feature.
    if (await correctCoordinationLineGroundGeometry(hiddenMap, finalZoom)) {
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
            // `pixelRatio` is part of the image's identity, not a detail: a
            // coordination measure is rasterized at ratio 4 so it stays sharp when
            // zoomed. Dropping it here made the hidden map treat those 4x pixels as
            // logical ones and draw the symbol four times too large in the Garmin
            // KMZ and in every page of the PDF mosaic.
            const options = { sdf: image.sdf };
            if (Number.isFinite(image.pixelRatio) && image.pixelRatio > 0) {
                options.pixelRatio = image.pixelRatio;
            }
            targetMap.addImage(id, image.data, options);
        }
    }
}

/**
 * Keeps an off-screen export map rendering past a source whose TileJSON FAILS to load.
 *
 * Call it right after constructing the map, before awaiting `load` or `idle` on it. Without it,
 * those awaits can hang forever: a vector, raster or raster-dem source whose TileJSON request
 * fails marks itself loaded and fires `error`, but no `data` event, so MapLibre schedules no new
 * frame. When that failure is the LAST thing the off-screen map was waiting for, the map has
 * already stopped rendering, never re-evaluates `loaded()`, and never fires `load` nor `idle`.
 * The style of the live map carries every catalog source, visible or not, so a single tile
 * server that is down (or a placeholder URL left by the catalog seed) froze the PDF export on
 * "Enquadrando área..." with no error. One repaint per failure is what lets MapLibre see the
 * settled source and fire the events. Measured in the browser, see
 * `tests/e2e-ui/exportacao-com-fonte-que-falha.spec.js`.
 *
 * The listener dies with the map (`remove()`), which every exporter already calls.
 *
 * It RETURNS the ids of the sources that failed, because a repaint makes the export finish, not
 * the layer appear: the exporter names the visible ones to the person
 * ({@link missingExportLayerNames}), instead of handing over a file silently without them.
 *
 * @param {maplibregl.Map} map - The off-screen map of an export.
 * @returns {Set<string>} Filled as sources fail; read it once the map is drawn.
 */
export function repaintOnSourceError(map) {
    const failed = new Set();
    map.on('error', (event) => {
        // Only a SOURCE that failed (its TileJSON), never one tile of it: MapLibre stamps `tile` on
        // a tile's error, and one tile missing at the edge of a basemap's coverage is not a layer
        // missing from the file.
        if (typeof event?.sourceId === 'string' && event.sourceId && !event.tile) failed.add(event.sourceId);
        // A listener silences MapLibre's own console.error for the event; keep it visible.
        console.warn('Export map: a source failed to load:', event?.error?.message ?? event);
        map.triggerRepaint();
    });
    return failed;
}

/** How long an export waits for its off-screen map before drawing what it already has, in ms. */
export const EXPORT_MAP_DEADLINE_MS = 30000;

/**
 * Waits for `load` or `idle` on an off-screen export map, and NEVER forever.
 *
 * {@link repaintOnSourceError} covers a source that fails; this covers the one that never
 * answers at all (a tile server that accepts the connection and goes quiet), and the person who
 * gives up: "Cancelar" used to close the modal while the export stayed parked on this await, with
 * `_exporting` true and the export button disabled until a reload. Resolves with WHY it stopped,
 * so the caller can tell a map that finished from one that was cut short.
 *
 * @param {maplibregl.Map} map
 * @param {'load'|'idle'} event
 * @param {Object} [options]
 * @param {() => boolean} [options.isCancelled] - Polled; true ends the wait at once.
 * @param {number} [options.deadlineMs]
 * @returns {Promise<'ok'|'deadline'|'cancelled'>}
 */
export function waitForExportMap(map, event, { isCancelled = () => false, deadlineMs = EXPORT_MAP_DEADLINE_MS } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (outcome) => {
            if (done) return;
            done = true;
            clearTimeout(deadline);
            clearInterval(poll);
            map.off(event, onEvent);
            resolve(outcome);
        };
        const onEvent = () => finish('ok');
        const deadline = setTimeout(() => finish('deadline'), deadlineMs);
        const poll = setInterval(() => { if (isCancelled()) finish('cancelled'); }, 200);
        map.on(event, onEvent);
    });
}

/**
 * The layers the person SEES on the live map that did not make it into the export: the sources
 * that failed plus those still loading when the wait gave up. Named by the live map's failure
 * notice, which already maps a source id to its layer and knows whether it is switched on; a
 * hidden layer draws nothing either way, so it is not news.
 *
 * @param {maplibregl.Map} liveMap
 * @param {maplibregl.Map} exportMap
 * @param {Set<string>} failedSourceIds - From {@link repaintOnSourceError}.
 * @returns {string[]} Distinct names, in style order.
 */
export function missingExportLayerNames(liveMap, exportMap, failedSourceIds) {
    const notice = getLayerFailureNotice(liveMap);
    const sources = Object.keys(exportMap?.getStyle?.()?.sources ?? {});
    const names = [];
    for (const sourceId of sources) {
        const missing = failedSourceIds.has(sourceId) || exportMap.isSourceLoaded?.(sourceId) === false;
        if (!missing) continue;
        const name = notice.visibleLayerNameOf(sourceId);
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
}

/**
 * The sentence for {@link missingExportLayerNames}: what came out without what, and what to do.
 * @param {string[]} names
 * @param {string} [what='O PDF']
 * @returns {string|null} Null when nothing is missing.
 */
export function missingExportLayersNotice(names, what = 'O PDF') {
    if (!Array.isArray(names) || names.length === 0) return null;
    const lista = names.map((n) => `"${n}"`).join(', ');
    const sujeito = names.length === 1 ? `a camada ${lista}, que não carregou` : `as camadas ${lista}, que não carregaram`;
    return `${what} saiu sem ${sujeito}. Confira no mapa e exporte de novo.`;
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
