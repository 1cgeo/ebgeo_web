// Path: js/processing/algorithms/voronoi.algorithm.js

/**
 * @fileoverview Algoritmo de Diagrama de Voronoi.
 * Gera células de Voronoi a partir de pontos (ou centroides) dentro de um bbox desenhado pelo usuário.
 * @dependencies processing.constants, turf (global), control.registry
 */

import { registerAlgorithm } from '../processing.constants.js';
import { getLayers, getActiveLayerIdSync } from '../../store/layer.operations.js';
import { getControl } from '../../store/control.registry.js';
import {
    createModernSelect,
    createModernToggle,
    createSectionDivider,
} from '../../tool_manager/helpers/index.js';
import {
    setupCleanup,
    cleanup,
} from '../../utilities/event-cleanup.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const VORONOI_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="22" height="22" rx="1"/><line x1="11.5" y1="1" x2="12.5" y2="11"/><line x1="12.5" y1="11" x2="1" y2="16"/><line x1="12.5" y1="11" x2="23" y2="9"/><line x1="12.5" y1="11" x2="13" y2="23"/><circle cx="6" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="17" r="1.5" fill="currentColor" stroke="none"/><circle cx="7" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>`;

const SUPPORTED_TYPES = [
    // Geometrias básicas
    'point', 'line', 'polygon',
    // Formas derivadas (armazenadas como Polygon)
    'circle', 'rectangle', 'ellipse',
    // Tipos ponto (tratados como Point pelo turf)
    'text', 'image', 'military_symbol', 'coordination_measure',
    // Tipos linha (tratados como LineString pelo turf)
    'brush', 'arrow', 'boundary', 'occupied_front',
];

// ============================================================================
// PANEL CREATION
// ============================================================================

/**
 * Cria o formulário do algoritmo de Voronoi.
 * @param {import('./algorithm.interface.js').AlgorithmPanelDeps} deps
 * @returns {import('./algorithm.interface.js').AlgorithmPanelResult}
 */
function createVoronoiPanel(deps) {
    const { stateManager } = deps;
    const cleanupContext = {};
    setupCleanup(cleanupContext);

    const container = document.createElement('div');
    container.className = 'processing-panel';

    // -- Ilustração --
    const illustration = document.createElement('div');
    illustration.className = 'processing-panel__illustration';
    illustration.innerHTML = `
        <svg width="180" height="100" viewBox="0 0 180 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Bbox externo (área de recorte) -->
            <rect x="8" y="8" width="164" height="84" rx="2" fill="#dcfce7" fill-opacity="0.15" stroke="#16a34a" stroke-width="1.2" stroke-dasharray="5 3"/>
            <!-- Células de Voronoi (calculadas geometricamente) -->
            <polygon points="86.35,8 88.35,41.87 8,61 8,8" fill="#bbf7d0" fill-opacity="0.45" stroke="#16a34a" stroke-width="1"/>
            <polygon points="86.35,8 172,8 172,39.28 97.14,55.91 88.35,41.87" fill="#86efac" fill-opacity="0.35" stroke="#16a34a" stroke-width="1"/>
            <polygon points="172,39.28 172,92 97.99,92 97.14,55.91" fill="#dcfce7" fill-opacity="0.55" stroke="#16a34a" stroke-width="1"/>
            <polygon points="8,61 88.35,41.87 97.14,55.91 97.99,92 8,92" fill="#86efac" fill-opacity="0.45" stroke="#16a34a" stroke-width="1"/>
            <!-- Pontos geradores -->
            <circle cx="45" cy="30" r="3" fill="#16a34a"/>
            <circle cx="130" cy="25" r="3" fill="#16a34a"/>
            <circle cx="140" cy="70" r="3" fill="#16a34a"/>
            <circle cx="55" cy="72" r="3" fill="#16a34a"/>
        </svg>
    `;
    container.appendChild(illustration);

    // -- Seção: Dados de Entrada --
    container.appendChild(createSectionDivider('Dados de Entrada'));

    // -- Seletor de camada --
    const layers = getLayers();
    const activeLayerId = getActiveLayerIdSync();
    const layerOptions = layers.map(l => ({
        value: l.id,
        label: l.name,
    }));

    let selectedLayerId = activeLayerId;

    const layerSelect = createModernSelect({
        label: 'Camada de origem',
        value: activeLayerId,
        options: layerOptions,
        onChange: (value) => {
            selectedLayerId = value;
            _updateOutputName();
            _validateForm();
        },
    });
    container.appendChild(layerSelect);

    // -- Toggle feições selecionadas --
    const selectedFeatures = stateManager ? stateManager.getSelectedFeatures() : [];
    const selectedCount = selectedFeatures.length;
    let useSelectedOnly = false;

    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'processing-panel__toggle-section';

    const toggle = createModernToggle({
        label: 'Apenas feições selecionadas',
        checked: false,
        onChange: (checked) => {
            useSelectedOnly = checked;
            _validateForm();
        },
    });
    toggleContainer.appendChild(toggle);

    const selectionHint = document.createElement('div');
    selectionHint.className = 'processing-panel__hint';
    selectionHint.textContent = selectedCount > 0
        ? `${selectedCount} ${selectedCount === 1 ? 'feição selecionada' : 'feições selecionadas'}`
        : 'Nenhuma feição selecionada';
    toggleContainer.appendChild(selectionHint);

    if (selectedCount === 0) {
        toggle.style.opacity = '0.5';
        toggle.style.pointerEvents = 'none';
    }

    container.appendChild(toggleContainer);

    // -- Toggle apenas pontos --
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

    // -- Seção: Área de Recorte --
    container.appendChild(createSectionDivider('Área de Recorte'));

    // -- Bbox picker --
    let bboxValue = null; // [minX, minY, maxX, maxY]

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

        // Limpa preview
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
            // Primeiro clique: registra canto 1
            drawPoints.push(point);
            const map = _getMap();
            if (map) {
                map.on('mousemove', _handleMouseMove);
            }
            drawBtn.querySelector('span').textContent = 'Clique no 2º canto...';
        } else if (drawPoints.length === 1) {
            // Segundo clique: completa bbox
            drawPoints.push(point);

            const [corner1, corner2] = drawPoints;
            const minX = Math.min(corner1[0], corner2[0]);
            const minY = Math.min(corner1[1], corner2[1]);
            const maxX = Math.max(corner1[0], corner2[0]);
            const maxY = Math.max(corner1[1], corner2[1]);

            bboxValue = [minX, minY, maxX, maxY];

            // Atualiza display
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

        const corner1 = drawPoints[0];
        const corner2 = lastPreviewPosition;

        const [x1, y1] = corner1;
        const [x2, y2] = corner2;

        const rectGeometry = {
            type: 'Polygon',
            coordinates: [[
                [x1, y1],
                [x2, y1],
                [x2, y2],
                [x1, y2],
                [x1, y1],
            ]],
        };

        const source = map.getSource('rectangle-selection-preview');
        if (source) {
            source.setData({
                type: 'Feature',
                geometry: rectGeometry,
                properties: { isPreview: true },
            });
        }

        pendingPreviewUpdate = false;
    }

    function _clearPreview(map) {
        const source = map?.getSource('rectangle-selection-preview');
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: [],
            });
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

    // -- Seção: Resultado --
    container.appendChild(createSectionDivider('Resultado'));

    // -- Nome da camada de saída --
    const outputNameContainer = document.createElement('div');
    outputNameContainer.className = 'attr-modern-textarea';

    const outputNameLabel = document.createElement('label');
    outputNameLabel.className = 'attr-modern-textarea-label';
    outputNameLabel.textContent = 'Nome da nova camada';
    outputNameContainer.appendChild(outputNameLabel);

    const outputNameInput = document.createElement('input');
    outputNameInput.type = 'text';
    outputNameInput.className = 'attr-modern-textarea-input';
    outputNameInput.style.minHeight = 'auto';
    outputNameInput.style.resize = 'none';

    const _getDefaultOutputName = () => {
        const layer = layers.find(l => l.id === selectedLayerId);
        return `Voronoi - ${layer ? layer.name : 'Camada'}`;
    };
    outputNameInput.value = _getDefaultOutputName();

    outputNameContainer.appendChild(outputNameInput);
    container.appendChild(outputNameContainer);

    function _updateOutputName() {
        outputNameInput.value = _getDefaultOutputName();
    }

    // -- Botão Executar --
    const executeBtn = document.createElement('button');
    executeBtn.className = 'processing-panel__execute-btn';
    executeBtn.textContent = 'EXECUTAR';
    executeBtn.disabled = true; // Bbox obrigatório
    container.appendChild(executeBtn);

    // -- Progresso --
    const progressContainer = document.createElement('div');
    progressContainer.className = 'processing-panel__progress';
    progressContainer.style.display = 'none';

    const progressText = document.createElement('div');
    progressText.className = 'processing-panel__progress-text';
    progressContainer.appendChild(progressText);

    const progressBar = document.createElement('div');
    progressBar.className = 'processing-panel__progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'processing-panel__progress-fill';
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressBar);

    container.appendChild(progressContainer);

    // -- Resultado --
    const resultContainer = document.createElement('div');
    resultContainer.className = 'processing-panel__result';
    resultContainer.style.display = 'none';
    container.appendChild(resultContainer);

    // ========================================================================
    // VALIDATION
    // ========================================================================

    function _validateForm() {
        const validation = validate();
        executeBtn.disabled = !validation.valid;
        return validation;
    }

    function validate() {
        if (!selectedLayerId) {
            return { valid: false, message: 'Selecione uma camada' };
        }
        if (!bboxValue) {
            return { valid: false, message: 'Desenhe a área de recorte no mapa' };
        }
        if (useSelectedOnly && selectedCount === 0) {
            return { valid: false, message: 'Nenhuma feição selecionada' };
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
                sourceLayerId: selectedLayerId,
                useSelectedOnly,
                pointsOnly,
                bbox: bboxValue,
                outputLayerName: outputNameInput.value.trim() || _getDefaultOutputName(),
            };
        },

        validate,

        /**
         * Referências para UI de progresso/resultado.
         * Usadas pelo processing-panel.js para atualizar durante execução.
         */
        ui: {
            executeBtn,
            progressContainer,
            progressText,
            progressFill,
            resultContainer,
        },

        cleanup() {
            // Para desenho em andamento
            if (isDrawing) {
                _stopDrawing();
            }
            // Limpa preview residual
            const map = _getMap();
            if (map) {
                _clearPreview(map);
            }
            cleanup(cleanupContext);
        },
    };
}

// ============================================================================
// EXECUTE
// ============================================================================

/**
 * Propriedades padrão para polígonos gerados pelo Voronoi.
 * Segue exatamente o padrão de AddPolygonControl.DEFAULT_PROPERTIES.
 */
const POLYGON_DEFAULTS = {
    fillColor: '#3f4fb5',
    lineColor: '#3f4fb5',
    lineWidth: 2,
    opacity: 0.5,
    lineStyle: 'solid',
    measure: false,
    hatchEnabled: false,
    hatchType: 'none',
    hatchColor: '#000000',
    hatchSpacing: 8,
    hatchLineWidth: 2,
};

/**
 * Executa o diagrama de Voronoi nas feições fornecidas.
 * Função pura: recebe features, retorna features processadas.
 *
 * @param {Object[]} features - Array de GeoJSON features
 * @param {Object} params
 * @param {number[]} params.bbox - Bounding box [minX, minY, maxX, maxY]
 * @param {boolean} [params.pointsOnly] - Se true, ignora features não-ponto
 * @param {Function} [params.onProgress] - Callback(current, total)
 * @returns {Object[]} Features com células de Voronoi (sempre polígonos)
 */
function executeVoronoi(features, params) {
    const { bbox, pointsOnly, onProgress } = params;

    // 1. Converter features para pontos
    const points = [];
    const pointSources = []; // Referência ao feature original (para nome)

    for (const feature of features) {
        const geomType = feature.geometry?.type;

        if (pointsOnly && geomType !== 'Point') {
            continue;
        }

        if (geomType === 'Point') {
            points.push(feature);
            pointSources.push(feature);
        } else {
            // Centroide para geometrias não-ponto
            try {
                const centroid = window.turf.centroid(feature);
                // Preserva propriedades do original no centroide
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

    // 2. Criar FeatureCollection
    const collection = window.turf.featureCollection(points);

    // 3. Executar turf.voronoi
    const voronoi = window.turf.voronoi(collection, { bbox });

    if (!voronoi || !voronoi.features || voronoi.features.length === 0) {
        throw new Error('O algoritmo não produziu resultados');
    }

    // 4. Converter para formato EBGeo (polígono padrão)
    const results = [];

    for (let i = 0; i < voronoi.features.length; i++) {
        const cell = voronoi.features[i];

        if (!cell || !cell.geometry) {
            if (onProgress) onProgress(i + 1, voronoi.features.length);
            continue;
        }

        try {
            // Extrai coordenadas do anel externo (sem ponto de fechamento)
            const coords = cell.geometry.coordinates[0];
            const baseCoordinates = (coords && coords.length > 1 &&
                coords[0][0] === coords[coords.length - 1][0] &&
                coords[0][1] === coords[coords.length - 1][1])
                ? coords.slice(0, -1)
                : coords;

            // Nome baseado no ponto de origem
            const sourceName = pointSources[i]?.properties?.nome;
            const cellName = sourceName
                ? `Voronoi - ${sourceName}`
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

            // Preserva atributos do ponto de origem (somente se existirem)
            if (pointSources[i]?.properties?.attributes) {
                props.attributes = structuredClone(pointSources[i].properties.attributes);
            }
            if (pointSources[i]?.properties?.images) {
                props.images = structuredClone(pointSources[i].properties.images);
            }

            // Constrói feature limpa (sem metadata do turf)
            const cleanFeature = {
                type: 'Feature',
                properties: props,
                geometry: {
                    type: cell.geometry.type,
                    coordinates: cell.geometry.coordinates,
                },
            };
            results.push(cleanFeature);
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
    name: 'Diagrama de Voronoi',
    description: 'Gera células de Voronoi a partir de pontos dentro de uma área',
    icon: VORONOI_ICON,
    category: 'geometry',
    supportedGeometryTypes: SUPPORTED_TYPES,
    createPanel: createVoronoiPanel,
    execute: executeVoronoi,
});
