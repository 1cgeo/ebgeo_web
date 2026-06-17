// Path: js/processing/algorithms/voronoi.algorithm.js

/**
 * @fileoverview Voronoi Diagram algorithm.
 * Generates Voronoi cells from points (or centroids) within a user-drawn bbox.
 */

import { getControl } from '@store/control.registry.js';
import { createModernToggle, createSectionDivider } from '@tools/helpers/index.js';
import {
    registerAlgorithm,
    POLYGON_DEFAULTS,
    SUPPORTED_GEOMETRY_TYPES,
    extractBaseCoordinates,
} from '../processing.constants.js';
import { buildAlgorithmPanelScaffold } from './panel-builder.js';
import { mergeTemporalWindows } from '@js/temporal/temporal-model.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const VORONOI_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="22" height="22" rx="1"/><line x1="11.5" y1="1" x2="12.5" y2="11"/><line x1="12.5" y1="11" x2="1" y2="16"/><line x1="12.5" y1="11" x2="23" y2="9"/><line x1="12.5" y1="11" x2="13" y2="23"/><circle cx="6" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="17" r="1.5" fill="currentColor" stroke="none"/><circle cx="7" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>`;

// ============================================================================
// PANEL CREATION
// ============================================================================

/**
 * Creates the Voronoi algorithm panel.
 * @param {import('./algorithm.interface.js').AlgorithmPanelDeps} deps
 * @returns {import('./algorithm.interface.js').AlgorithmPanelResult}
 */
function createVoronoiPanel(deps) {
    const { stateManager } = deps;

    const scaffold = buildAlgorithmPanelScaffold({
        stateManager,
        defaultOutputPrefix: 'Proximidade',
    });

    const { container } = scaffold;

    // Start with execute disabled (bbox required)
    scaffold.executeBtn.disabled = true;

    // -- Illustration --
    const illustration = document.createElement('div');
    illustration.className = 'processing-panel__illustration';
    illustration.innerHTML = `
        <svg width="180" height="100" viewBox="0 0 180 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Bbox (clipping area) -->
            <rect x="8" y="8" width="164" height="84" rx="2" fill="#dcfce7" fill-opacity="0.15" stroke="#16a34a" stroke-width="1.2" stroke-dasharray="5 3"/>
            <!-- Voronoi cells -->
            <polygon points="86.35,8 88.35,41.87 8,61 8,8" fill="#bbf7d0" fill-opacity="0.45" stroke="#16a34a" stroke-width="1"/>
            <polygon points="86.35,8 172,8 172,39.28 97.14,55.91 88.35,41.87" fill="#86efac" fill-opacity="0.35" stroke="#16a34a" stroke-width="1"/>
            <polygon points="172,39.28 172,92 97.99,92 97.14,55.91" fill="#dcfce7" fill-opacity="0.55" stroke="#16a34a" stroke-width="1"/>
            <polygon points="8,61 88.35,41.87 97.14,55.91 97.99,92 8,92" fill="#86efac" fill-opacity="0.45" stroke="#16a34a" stroke-width="1"/>
            <!-- Generator points -->
            <circle cx="45" cy="30" r="3" fill="#16a34a"/>
            <circle cx="130" cy="25" r="3" fill="#16a34a"/>
            <circle cx="140" cy="70" r="3" fill="#16a34a"/>
            <circle cx="55" cy="72" r="3" fill="#16a34a"/>
        </svg>
    `;
    container.appendChild(illustration);

    // -- Input section (layer selector + toggle) --
    scaffold.appendInputSection();

    // -- Points-only toggle --
    let pointsOnly = false;

    const pointsToggleContainer = document.createElement('div');
    pointsToggleContainer.className = 'processing-panel__toggle-section';

    const pointsToggle = createModernToggle({
        label: 'Apenas pontos',
        checked: false,
        onChange: (checked) => {
            pointsOnly = checked;
            _validateForm();
        },
    });
    pointsToggleContainer.appendChild(pointsToggle);

    const pointsHint = document.createElement('div');
    pointsHint.className = 'processing-panel__hint';
    pointsHint.textContent = 'Ignora outras geometrias (sem centroide)';
    pointsToggleContainer.appendChild(pointsHint);

    container.appendChild(pointsToggleContainer);

    // -- Clipping area section --
    container.appendChild(createSectionDivider('Área de Recorte'));

    let bboxValue = null;

    const bboxSection = document.createElement('div');
    bboxSection.className = 'processing-panel__bbox-section';

    const drawBtn = document.createElement('button');
    drawBtn.className = 'processing-panel__draw-btn';
    drawBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <span>Desenhar Retângulo</span>
    `;
    bboxSection.appendChild(drawBtn);

    const bboxDisplay = document.createElement('div');
    bboxDisplay.className = 'processing-panel__bbox-display';
    bboxDisplay.textContent = 'Área não definida';
    bboxSection.appendChild(bboxDisplay);

    container.appendChild(bboxSection);

    // -- Bbox drawing state --
    let isDrawing = false;
    let drawPoints = [];
    let previewRafId = null;
    let pendingPreviewUpdate = false;
    let lastPreviewPosition = null;

    function _getMap() {
        const polygonControl = getControl('AddPolygonControl');
        return polygonControl?.map || null;
    }

    function _startDrawing() {
        const map = _getMap();
        if (!map) return;

        isDrawing = true;
        drawPoints = [];
        drawBtn.classList.add('processing-panel__draw-btn--active');
        drawBtn.querySelector('span').textContent = 'Clique no 1º canto...';

        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', _handleMapClick);
        document.addEventListener('keydown', _handleKeyDown);
    }

    function _stopDrawing(restoreCursor = true) {
        const map = _getMap();
        if (!map) return;

        isDrawing = false;
        drawPoints = [];

        if (restoreCursor) {
            map.getCanvas().style.cursor = '';
        }
        map.off('click', _handleMapClick);
        map.off('mousemove', _handleMouseMove);
        document.removeEventListener('keydown', _handleKeyDown);

        _cancelPendingUpdates();
        _clearPreview(map);

        drawBtn.classList.remove('processing-panel__draw-btn--active');
        drawBtn.querySelector('span').textContent = bboxValue
            ? 'Redesenhar Retângulo'
            : 'Desenhar Retângulo';
    }

    function _handleMapClick(e) {
        if (!isDrawing || !e.lngLat) return;

        const point = [e.lngLat.lng, e.lngLat.lat];

        if (drawPoints.length === 0) {
            drawPoints.push(point);
            const map = _getMap();
            if (map) {
                map.on('mousemove', _handleMouseMove);
            }
            drawBtn.querySelector('span').textContent = 'Clique no 2º canto...';
        } else if (drawPoints.length === 1) {
            drawPoints.push(point);

            const [corner1, corner2] = drawPoints;
            const minX = Math.min(corner1[0], corner2[0]);
            const minY = Math.min(corner1[1], corner2[1]);
            const maxX = Math.max(corner1[0], corner2[0]);
            const maxY = Math.max(corner1[1], corner2[1]);

            bboxValue = [minX, minY, maxX, maxY];

            bboxDisplay.className = 'processing-panel__bbox-display processing-panel__bbox-display--set';
            bboxDisplay.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span>${minX.toFixed(4)}, ${minY.toFixed(4)} / ${maxX.toFixed(4)}, ${maxY.toFixed(4)}</span>
            `;

            _stopDrawing();
            _validateForm();
        }
    }

    function _handleMouseMove(e) {
        if (drawPoints.length !== 1) return;

        lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!pendingPreviewUpdate) {
            pendingPreviewUpdate = true;
            previewRafId = requestAnimationFrame(_performPreviewUpdate);
        }
    }

    function _performPreviewUpdate() {
        if (!lastPreviewPosition || drawPoints.length !== 1) {
            pendingPreviewUpdate = false;
            return;
        }

        const map = _getMap();
        if (!map) {
            pendingPreviewUpdate = false;
            return;
        }

        const [x1, y1] = drawPoints[0];
        const [x2, y2] = lastPreviewPosition;

        const source = map.getSource('rectangle-selection-preview');
        if (source) {
            source.setData({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
                },
                properties: { isPreview: true },
            });
        }

        pendingPreviewUpdate = false;
    }

    function _clearPreview(map) {
        const source = map?.getSource('rectangle-selection-preview');
        if (source) {
            source.setData({ type: 'FeatureCollection', features: [] });
        }
    }

    function _cancelPendingUpdates() {
        if (previewRafId) {
            cancelAnimationFrame(previewRafId);
            previewRafId = null;
        }
        pendingPreviewUpdate = false;
        lastPreviewPosition = null;
    }

    function _handleKeyDown(e) {
        if (e.key === 'Escape') {
            _stopDrawing();
        }
    }

    drawBtn.addEventListener('click', () => {
        if (isDrawing) {
            _stopDrawing();
        } else {
            _startDrawing();
        }
    });

    // -- Output section (name + execute + progress + result) --
    scaffold.appendOutputSection();

    // ========================================================================
    // VALIDATION
    // ========================================================================

    function _validateForm() {
        const validation = validate();
        scaffold.executeBtn.disabled = !validation.valid;
        return validation;
    }

    scaffold.onLayerChangeCallbacks.push(_validateForm);

    function validate() {
        const baseValidation = scaffold.validateBase();
        if (!baseValidation.valid) return baseValidation;

        if (!bboxValue) {
            return { valid: false, message: 'Desenhe a área de recorte no mapa' };
        }
        return { valid: true };
    }

    // ========================================================================
    // PUBLIC INTERFACE
    // ========================================================================

    return {
        element: container,

        getParams() {
            return {
                sourceLayerId: scaffold.getSelectedLayerId(),
                useSelectedOnly: scaffold.getUseSelectedOnly(),
                pointsOnly,
                bbox: bboxValue,
                outputLayerName: scaffold.getOutputLayerName(),
            };
        },

        validate,
        ui: scaffold.ui,

        cleanup() {
            if (isDrawing) {
                _stopDrawing();
            }
            const map = _getMap();
            if (map) {
                _clearPreview(map);
            }
            scaffold.cleanupFn();
        },
    };
}

// ============================================================================
// EXECUTE
// ============================================================================

/**
 * Executes the Voronoi diagram on provided features.
 * Pure function: receives features, returns processed features.
 *
 * @param {Object[]} features - Array of GeoJSON features
 * @param {Object} params
 * @param {number[]} params.bbox - Bounding box [minX, minY, maxX, maxY]
 * @param {boolean} [params.pointsOnly] - If true, ignores non-point features
 * @param {Function} [params.onProgress] - Callback(current, total)
 * @returns {Object[]} Voronoi cell features (always polygons)
 */
function executeVoronoi(features, params) {
    const { bbox, pointsOnly, onProgress } = params;

    // Convert features to points
    const points = [];
    const pointSources = [];

    for (const feature of features) {
        const geomType = feature.geometry?.type;

        if (pointsOnly && geomType !== 'Point') {
            continue;
        }

        if (geomType === 'Point') {
            points.push(feature);
            pointSources.push(feature);
        } else {
            try {
                const centroid = window.turf.centroid(feature);
                centroid.properties = { ...feature.properties };
                points.push(centroid);
                pointSources.push(feature);
            } catch (error) {
                console.warn(`Centroide falhou para feição ${feature.properties?.id}:`, error);
            }
        }
    }

    if (points.length < 2) {
        throw new Error('São necessários pelo menos 2 pontos para gerar o diagrama de Voronoi');
    }

    const collection = window.turf.featureCollection(points);
    const voronoi = window.turf.voronoi(collection, { bbox });

    if (!voronoi || !voronoi.features || voronoi.features.length === 0) {
        throw new Error('O algoritmo não produziu resultados');
    }

    const results = [];

    for (let i = 0; i < voronoi.features.length; i++) {
        const cell = voronoi.features[i];

        if (!cell || !cell.geometry) {
            if (onProgress) onProgress(i + 1, voronoi.features.length);
            continue;
        }

        try {
            const baseCoordinates = extractBaseCoordinates(cell.geometry.coordinates[0]);

            const sourceName = pointSources[i]?.properties?.nome;
            const cellName = sourceName
                ? `Proximidade - ${sourceName}`
                : `Célula ${i + 1}`;

            const props = {
                ...POLYGON_DEFAULTS,
                source: 'polygon',
                nome: cellName,
                descricao: '',
                visivel: true,
                bloqueado: false,
                baseCoordinates,
            };

            if (pointSources[i]?.properties?.attributes) {
                props.attributes = structuredClone(pointSources[i].properties.attributes);
            }
            if (pointSources[i]?.properties?.images) {
                props.images = structuredClone(pointSources[i].properties.images);
            }
            // Inherit the generator point's temporal validity (1:1 cell → point).
            Object.assign(props, mergeTemporalWindows([pointSources[i]?.properties]));

            results.push({
                type: 'Feature',
                properties: props,
                geometry: {
                    type: cell.geometry.type,
                    coordinates: cell.geometry.coordinates,
                },
            });
        } catch (error) {
            console.warn(`Voronoi falhou para célula ${i}:`, error);
        }

        if (onProgress) {
            onProgress(i + 1, voronoi.features.length);
        }
    }

    return results;
}

// ============================================================================
// REGISTRATION
// ============================================================================

registerAlgorithm({
    id: 'voronoi',
    name: 'Diagrama de Proximidade',
    description: 'Divide uma região em áreas onde cada ponto do terreno é associado ao ponto de referência mais próximo, formando um mosaico de zonas de proximidade.',
    icon: VORONOI_ICON,
    category: 'geometry',
    supportedGeometryTypes: SUPPORTED_GEOMETRY_TYPES,
    createPanel: createVoronoiPanel,
    execute: executeVoronoi,
});
