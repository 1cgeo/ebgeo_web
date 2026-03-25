// Path: js/processing/algorithms/buffer.algorithm.js

/**
 * @fileoverview Buffer algorithm (Zona de Influencia).
 * Creates a contour area around selected features at a given distance.
 */

import { createModernNumericInput, createSectionDivider } from '@tools/helpers/index.js';
import {
    registerAlgorithm,
    POLYGON_DEFAULTS,
    SUPPORTED_GEOMETRY_TYPES,
    extractBaseCoordinates,
} from '../processing.constants.js';
import { buildAlgorithmPanelScaffold } from './panel-builder.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const BUFFER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="10" stroke-dasharray="4 2"/></svg>`;

const DEFAULT_DISTANCE = 500;

// ============================================================================
// PANEL CREATION
// ============================================================================

/**
 * Creates the buffer algorithm panel.
 * @param {import('./algorithm.interface.js').AlgorithmPanelDeps} deps
 * @returns {import('./algorithm.interface.js').AlgorithmPanelResult}
 */
function createBufferPanel(deps) {
    const { stateManager } = deps;

    const scaffold = buildAlgorithmPanelScaffold({
        stateManager,
        defaultOutputPrefix: 'Zona de Influência',
    });

    const { container } = scaffold;

    // -- Illustration --
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

    // -- Input section (layer selector + toggle) --
    scaffold.appendInputSection();

    // -- Parameters section --
    container.appendChild(createSectionDivider('Parâmetros'));

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

    // Re-validate when layer changes
    scaffold.onLayerChangeCallbacks.push(_validateForm);

    function validate() {
        const baseValidation = scaffold.validateBase();
        if (!baseValidation.valid) return baseValidation;

        if (distance <= 0) {
            return { valid: false, message: 'Distância deve ser maior que zero' };
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
                distance,
                outputLayerName: scaffold.getOutputLayerName(),
            };
        },

        validate,
        ui: scaffold.ui,

        cleanup() {
            scaffold.cleanupFn();
        },
    };
}

// ============================================================================
// EXECUTE
// ============================================================================

/**
 * Executes the buffer on provided features.
 * Pure function: receives features, returns processed features.
 *
 * @param {Object[]} features - Array of GeoJSON features
 * @param {Object} params
 * @param {number} params.distance - Buffer distance in meters
 * @param {Function} [params.onProgress] - Callback(current, total)
 * @returns {Object[]} Buffered features (always polygons)
 */
function executeBuffer(features, params) {
    const { distance, onProgress } = params;
    const results = [];

    for (let i = 0; i < features.length; i++) {
        const feature = features[i];

        try {
            const buffered = window.turf.buffer(feature, distance, { units: 'meters' });

            if (buffered && buffered.geometry) {
                const baseCoordinates = extractBaseCoordinates(buffered.geometry.coordinates[0]);

                const props = {
                    ...POLYGON_DEFAULTS,
                    source: 'polygon',
                    nome: feature.properties?.nome || '',
                    descricao: feature.properties?.descricao || '',
                    visivel: true,
                    bloqueado: false,
                    baseCoordinates,
                };

                if (feature.properties?.attributes) {
                    props.attributes = structuredClone(feature.properties.attributes);
                }
                if (feature.properties?.images) {
                    props.images = structuredClone(feature.properties.images);
                }

                results.push({
                    type: 'Feature',
                    properties: props,
                    geometry: {
                        type: buffered.geometry.type,
                        coordinates: buffered.geometry.coordinates,
                    },
                });
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
    supportedGeometryTypes: SUPPORTED_GEOMETRY_TYPES,
    createPanel: createBufferPanel,
    execute: executeBuffer,
});
