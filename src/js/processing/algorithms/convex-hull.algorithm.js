// Path: js/processing/algorithms/convex-hull.algorithm.js

/**
 * @fileoverview Algoritmo de Envoltória Convexa (Convex Hull).
 * Gera o menor polígono convexo que contém todas as feições de entrada.
 * @dependencies processing.constants, turf (global)
 */

import { registerAlgorithm } from '../processing.constants.js';
import { getLayers, getActiveLayerIdSync } from '../../store/layer.operations.js';
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

const CONVEX_HULL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4,16 6,4 14,2 22,8 20,18 10,22" stroke-dasharray="4 2"/><circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none"/><circle cx="14" cy="2" r="1.5" fill="currentColor" stroke="none"/><circle cx="22" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="22" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="13" r="1" fill="currentColor" stroke="none"/></svg>`;

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
 * Cria o formulário do algoritmo de envoltória convexa.
 * @param {import('./algorithm.interface.js').AlgorithmPanelDeps} deps
 * @returns {import('./algorithm.interface.js').AlgorithmPanelResult}
 */
function createConvexHullPanel(deps) {
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
            <polygon points="25,65 30,20 70,10 130,15 140,50 120,75 50,80" fill="#dcfce7" fill-opacity="0.4" stroke="#16a34a" stroke-width="1.5"/>
            <circle cx="30" cy="20" r="3" fill="#16a34a"/>
            <circle cx="70" cy="10" r="3" fill="#16a34a"/>
            <circle cx="130" cy="15" r="3" fill="#16a34a"/>
            <circle cx="140" cy="50" r="3" fill="#16a34a"/>
            <circle cx="120" cy="75" r="3" fill="#16a34a"/>
            <circle cx="50" cy="80" r="3" fill="#16a34a"/>
            <circle cx="25" cy="65" r="3" fill="#16a34a"/>
            <!-- Interior points -->
            <circle cx="65" cy="40" r="2.5" fill="#16a34a" opacity="0.5"/>
            <circle cx="90" cy="35" r="2.5" fill="#16a34a" opacity="0.5"/>
            <circle cx="80" cy="55" r="2.5" fill="#16a34a" opacity="0.5"/>
            <circle cx="100" cy="50" r="2.5" fill="#16a34a" opacity="0.5"/>
            <circle cx="55" cy="55" r="2.5" fill="#16a34a" opacity="0.5"/>
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
            _updateSelectionHint();
            _updateOutputName();
            _validateForm();
        },
    });
    container.appendChild(layerSelect);

    // -- Toggle feições selecionadas --
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
    toggleContainer.appendChild(selectionHint);

    // Count selected features filtered by the current source layer
    function _getSelectedCountForLayer(layerId) {
        const allSelected = stateManager ? stateManager.getSelectedFeatures() : [];
        return allSelected.filter(item => {
            const fLayerId = item.feature?.properties?.layerId || 'default';
            return fLayerId === layerId;
        }).length;
    }

    function _updateSelectionHint() {
        const count = _getSelectedCountForLayer(selectedLayerId);
        selectionHint.textContent = count > 0
            ? `${count} ${count === 1 ? 'feição selecionada' : 'feições selecionadas'} na camada`
            : 'Nenhuma feição selecionada na camada';

        if (count === 0) {
            toggle.classList.add('processing-panel__toggle--disabled');
            if (useSelectedOnly) {
                useSelectedOnly = false;
                const switchEl = toggle.querySelector('.attr-modern-toggle-switch');
                if (switchEl) switchEl.classList.remove('active');
            }
        } else {
            toggle.classList.remove('processing-panel__toggle--disabled');
        }
    }

    _updateSelectionHint();

    container.appendChild(toggleContainer);

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
        return `Envoltória - ${layer ? layer.name : 'Camada'}`;
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
        if (useSelectedOnly && _getSelectedCountForLayer(selectedLayerId) === 0) {
            return { valid: false, message: 'Nenhuma feição selecionada na camada' };
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
 * Propriedades padrão para o polígono gerado pela envoltória convexa.
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
 * Executa a envoltória convexa nas feições fornecidas.
 * Função pura: recebe features, retorna features processadas.
 * turf.convex() aceita qualquer FeatureCollection e extrai
 * todos os vértices internamente para calcular o hull.
 *
 * @param {Object[]} features - Array de GeoJSON features
 * @param {Object} params
 * @param {Function} [params.onProgress] - Callback(current, total)
 * @returns {Object[]} Array com um único polígono (a envoltória)
 */
function executeConvexHull(features, params) {
    const { onProgress } = params;

    if (features.length < 2) {
        throw new Error('São necessárias pelo menos 2 feições para gerar a envoltória convexa');
    }

    if (onProgress) {
        onProgress(1, 3);
    }

    // 1. Criar FeatureCollection com todas as feições
    const collection = window.turf.featureCollection(features);

    if (onProgress) {
        onProgress(2, 3);
    }

    // 2. Executar turf.convex — extrai coordenadas de todas as geometrias
    const hull = window.turf.convex(collection);

    if (!hull || !hull.geometry) {
        throw new Error('Não foi possível gerar a envoltória. Verifique se as feições não são colineares.');
    }

    // 3. Converter para formato EBGeo (polígono padrão)
    const coords = hull.geometry.coordinates[0];
    const baseCoordinates = (coords && coords.length > 1 &&
        coords[0][0] === coords[coords.length - 1][0] &&
        coords[0][1] === coords[coords.length - 1][1])
        ? coords.slice(0, -1)
        : coords;

    const cleanFeature = {
        type: 'Feature',
        properties: {
            ...POLYGON_DEFAULTS,
            source: 'polygon',
            nome: 'Envoltória Convexa',
            descricao: `Gerada a partir de ${features.length} feições`,
            visivel: true,
            bloqueado: false,
            baseCoordinates,
        },
        geometry: {
            type: hull.geometry.type,
            coordinates: hull.geometry.coordinates,
        },
    };

    if (onProgress) {
        onProgress(3, 3);
    }

    return [cleanFeature];
}

// ============================================================================
// REGISTRATION
// ============================================================================

registerAlgorithm({
    id: 'convex-hull',
    name: 'Envoltória Convexa',
    description: 'Gera o menor polígono convexo que contém todas as feições selecionadas, útil para delimitar perímetros e áreas de abrangência.',
    icon: CONVEX_HULL_ICON,
    category: 'geometry',
    supportedGeometryTypes: SUPPORTED_TYPES,
    createPanel: createConvexHullPanel,
    execute: executeConvexHull,
});
