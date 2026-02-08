// Path: js/processing/algorithms/buffer.algorithm.js

/**
 * @fileoverview Algoritmo de Buffer (Zona de Influência).
 * Cria uma área de contorno ao redor das feições selecionadas.
 * @dependencies processing.constants, turf (global)
 */

import { registerAlgorithm } from '../processing.constants.js';
import { getLayers, getActiveLayerIdSync } from '../../store/layer.operations.js';
import {
    createModernSelect,
    createModernToggle,
    createModernNumericInput,
    createSectionDivider,
} from '../../tool_manager/helpers/index.js';
import {
    setupCleanup,
    cleanup,
} from '../../utilities/event-cleanup.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const BUFFER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="10" stroke-dasharray="4 2"/></svg>`;

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

const DEFAULT_DISTANCE = 500;

// ============================================================================
// PANEL CREATION
// ============================================================================

/**
 * Cria o formulário do algoritmo de buffer.
 * @param {import('./algorithm.interface.js').AlgorithmPanelDeps} deps
 * @returns {import('./algorithm.interface.js').AlgorithmPanelResult}
 */
function createBufferPanel(deps) {
    const { stateManager } = deps;
    const cleanupContext = {};
    setupCleanup(cleanupContext);

    const container = document.createElement('div');
    container.className = 'processing-panel';

    // -- Ilustração --
    const illustration = document.createElement('div');
    illustration.className = 'processing-panel__illustration';
    illustration.innerHTML = `
        <svg width="160" height="90" viewBox="0 0 160 90" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon points="50,30 80,20 100,40 90,65 55,60" fill="#dcfce7" stroke="#16a34a" stroke-width="1.5"/>
            <path d="M30,28 Q35,12 55,14 L78,10 Q100,12 106,28 L108,42 Q108,62 95,72 L78,75 Q50,78 38,70 L30,58 Q24,44 30,28 Z" fill="#dcfce7" fill-opacity="0.4" stroke="#16a34a" stroke-width="1.2" stroke-dasharray="5 3"/>
            <line x1="90" y1="38" x2="106" y2="30" stroke="#374151" stroke-width="1" stroke-dasharray="2 2"/>
            <text x="108" y="28" font-size="9" fill="#374151" font-style="italic">d</text>
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

    // -- Seção: Parâmetros --
    container.appendChild(createSectionDivider('Parâmetros'));

    // -- Distância --
    let distance = DEFAULT_DISTANCE;

    const distanceInput = createModernNumericInput({
        label: 'Distância (metros)',
        min: 1,
        max: 100000,
        step: 1,
        value: DEFAULT_DISTANCE,
        unit: 'm',
        onChange: (value) => {
            distance = parseFloat(value) || 0;
            _validateForm();
        },
    });
    container.appendChild(distanceInput);

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
        return `Zona de Influência - ${layer ? layer.name : 'Camada'}`;
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
    executeBtn.disabled = false;
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
        if (distance <= 0) {
            return { valid: false, message: 'Distância deve ser maior que zero' };
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
                distance,
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
            cleanup(cleanupContext);
        },
    };
}

// ============================================================================
// EXECUTE
// ============================================================================

/**
 * Propriedades padrão para polígonos gerados pelo buffer.
 * Segue exatamente o padrão de AddPolygonControl.DEFAULT_PROPERTIES
 * e azimuth_distance_geometry.js (OUTPUT_MODE.AREA).
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
 * Executa o buffer nas feições fornecidas.
 * Função pura: recebe features, retorna features processadas.
 * Cada feature retornada segue a estrutura de polígono do EBGeo
 * (mesma de AddPolygonControl / azimute e distância).
 *
 * @param {Object[]} features - Array de GeoJSON features
 * @param {Object} params
 * @param {number} params.distance - Distância do buffer em metros
 * @param {Function} [params.onProgress] - Callback(current, total)
 * @returns {Object[]} Features com buffer aplicado (sempre polígonos)
 */
function executeBuffer(features, params) {
    const { distance, onProgress } = params;
    const results = [];

    for (let i = 0; i < features.length; i++) {
        const feature = features[i];

        try {
            const buffered = window.turf.buffer(feature, distance, { units: 'meters' });

            if (buffered && buffered.geometry) {
                // Extrai coordenadas do anel externo (sem ponto de fechamento)
                const coords = buffered.geometry.coordinates[0];
                const baseCoordinates = (coords && coords.length > 1 &&
                    coords[0][0] === coords[coords.length - 1][0] &&
                    coords[0][1] === coords[coords.length - 1][1])
                    ? coords.slice(0, -1)
                    : coords;

                // Propriedades: defaults de polígono + dados preservados do original
                const props = {
                    ...POLYGON_DEFAULTS,
                    source: 'polygon',
                    nome: feature.properties?.nome || '',
                    descricao: feature.properties?.descricao || '',
                    visivel: true,
                    bloqueado: false,
                    baseCoordinates,
                };

                // Preserva atributos do usuário (somente se existirem)
                if (feature.properties?.attributes) {
                    props.attributes = structuredClone(feature.properties.attributes);
                }
                if (feature.properties?.images) {
                    props.images = structuredClone(feature.properties.images);
                }

                // Constrói feature limpa (sem metadata do turf como bbox)
                const cleanFeature = {
                    type: 'Feature',
                    properties: props,
                    geometry: {
                        type: buffered.geometry.type,
                        coordinates: buffered.geometry.coordinates,
                    },
                };
                results.push(cleanFeature);
            }
        } catch (error) {
            console.warn(`Buffer falhou para feição ${feature.properties?.id}:`, error);
        }

        if (onProgress) {
            onProgress(i + 1, features.length);
        }
    }

    return results;
}

// ============================================================================
// REGISTRATION
// ============================================================================

registerAlgorithm({
    id: 'buffer',
    name: 'Zona de Influência',
    description: 'Cria uma área ao redor de um ponto, linha ou polígono a uma distância determinada, representando uma faixa de abrangência em torno da feição original.',
    icon: BUFFER_ICON,
    category: 'geometry',
    supportedGeometryTypes: SUPPORTED_TYPES,
    createPanel: createBufferPanel,
    execute: executeBuffer,
});
