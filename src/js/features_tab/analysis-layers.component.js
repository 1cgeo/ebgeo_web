// Path: js/features_tab/analysis-layers.component.js

/**
 * @fileoverview Analysis layers control component.
 */

import { getMapAnalysisLayersStates } from '../store';
import { FEATURES_TAB_ICONS } from './features_tab.icons.js';

/**
 * Creates the analysis layers control container.
 *
 * @returns {HTMLElement} Analysis layers control container element
 */
export function createAnalysisLayersContainer() {
    const container = document.createElement('div');
    container.className = 'analysis-layers-control';
    container.style.cssText = `
        border-bottom: 1px solid #e0e0e0;
        background-color: #f8f9fa;
        display: none;
    `;
    return container;
}

/**
 * Renders the analysis layers control using the manager.
 *
 * @param {HTMLElement} container - Container element for analysis layers
 * @param {Object} analysisLayersManager - Analysis layers manager instance
 */
export async function renderAnalysisLayersControl(container, analysisLayersManager) {
    if (!container) return;

    if (!analysisLayersManager.isEnabled()) {
        container.style.display = 'none';
        return;
    }

    container.innerHTML = buildAnalysisLayersHTML(analysisLayersManager);

    await attachAnalysisLayersEvents(container, analysisLayersManager);

    container.style.display = 'block';
}

/**
 * Builds analysis layers control HTML with zoom buttons.
 *
 * @param {Object} analysisLayersManager - Analysis layers manager instance
 * @returns {string} HTML string for the control
 */
function buildAnalysisLayersHTML(analysisLayersManager) {
    const layersConfig = analysisLayersManager.getLayersConfig();

    let html = `<div class="analysis-layers-header">Camadas de Análise</div>`;

    layersConfig.forEach((layerConfig) => {
        html += `
            <div class="analysis-layer-item">
                <label class="analysis-layer-label">
                    <input type="checkbox" data-layer-id="${layerConfig.id}">
                    <span title="${layerConfig.description || ''}">${layerConfig.name}</span>
                </label>
                <button class="analysis-layer-zoom" data-layer-id="${layerConfig.id}" title="Zoom para ${layerConfig.name}">
                    ${FEATURES_TAB_ICONS.ZOOM}
                </button>
            </div>
        `;
    });

    html += '<div style="height: 4px;"></div>';

    return html;
}

/**
 * Configures checkbox and zoom button events for analysis layers.
 *
 * @param {HTMLElement} container - Container element for analysis layers
 * @param {Object} analysisLayersManager - Analysis layers manager instance
 */
async function attachAnalysisLayersEvents(container, analysisLayersManager) {
    const layersStates = await getMapAnalysisLayersStates();

    container.querySelectorAll('input[data-layer-id]').forEach((checkbox) => {
        const layerId = checkbox.dataset.layerId;
        const layerConfig = analysisLayersManager
            .getLayersConfig()
            .find((l) => l.id === layerId);

        checkbox.checked = layersStates[layerId] ?? layerConfig?.defaultVisibility ?? false;

        checkbox.onchange = async (e) => {
            await analysisLayersManager.toggleLayer(layerId, e.target.checked);
        };
    });

    container.querySelectorAll('.analysis-layer-zoom').forEach((button) => {
        button.onclick = (e) => {
            e.stopPropagation();
            const layerId = button.dataset.layerId;
            analysisLayersManager.zoomToLayer(layerId);
        };
    });
}
