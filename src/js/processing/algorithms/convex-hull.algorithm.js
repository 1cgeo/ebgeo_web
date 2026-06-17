// Path: js/processing/algorithms/convex-hull.algorithm.js

/**
 * @fileoverview Convex Hull algorithm (Envoltoria Convexa).
 * Generates the smallest convex polygon containing all input features.
 */

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

const CONVEX_HULL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4,16 6,4 14,2 22,8 20,18 10,22" stroke-dasharray="4 2"/><circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none"/><circle cx="14" cy="2" r="1.5" fill="currentColor" stroke="none"/><circle cx="22" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="22" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="13" r="1" fill="currentColor" stroke="none"/></svg>`;

// ============================================================================
// PANEL CREATION
// ============================================================================

/**
 * Creates the convex hull algorithm panel.
 * @param {import('./algorithm.interface.js').AlgorithmPanelDeps} deps
 * @returns {import('./algorithm.interface.js').AlgorithmPanelResult}
 */
function createConvexHullPanel(deps) {
    const { stateManager } = deps;

    const scaffold = buildAlgorithmPanelScaffold({
        stateManager,
        defaultOutputPrefix: 'Envoltória',
    });

    const { container } = scaffold;

    // -- Illustration --
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

    // -- Input section (layer selector + toggle) --
    scaffold.appendInputSection();

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
        return scaffold.validateBase();
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
 * Executes the convex hull on provided features.
 * Pure function: receives features, returns processed features.
 *
 * @param {Object[]} features - Array of GeoJSON features
 * @param {Object} params
 * @param {Function} [params.onProgress] - Callback(current, total)
 * @returns {Object[]} Array with a single polygon (the hull)
 */
function executeConvexHull(features, params) {
    const { onProgress } = params;

    if (features.length < 2) {
        throw new Error('São necessárias pelo menos 2 feições para gerar a envoltória convexa');
    }

    if (onProgress) onProgress(1, 3);

    const collection = window.turf.featureCollection(features);

    if (onProgress) onProgress(2, 3);

    const hull = window.turf.convex(collection);

    if (!hull || !hull.geometry) {
        throw new Error('Não foi possível gerar a envoltória. Verifique se as feições não são colineares.');
    }

    const baseCoordinates = extractBaseCoordinates(hull.geometry.coordinates[0]);

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

    // N:1 → the hull is valid over the UNION of its inputs' validity windows.
    Object.assign(cleanFeature.properties, mergeTemporalWindows(features.map((f) => f.properties)));

    if (onProgress) onProgress(3, 3);

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
    supportedGeometryTypes: SUPPORTED_GEOMETRY_TYPES,
    createPanel: createConvexHullPanel,
    execute: executeConvexHull,
});
