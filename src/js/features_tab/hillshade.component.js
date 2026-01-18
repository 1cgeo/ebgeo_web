// Path: js/features_tab/hillshade.component.js

/**
 * @fileoverview Hillshade toggle control component.
 */

import { getMapHillshadeState, setMapHillshadeState } from '../store';
import config from '../config.js';

/**
 * Creates the hillshade toggle control UI element.
 *
 * @param {Object} map - MapLibre map instance
 * @returns {HTMLElement|null} Hillshade control element or null if disabled
 */
export function createHillshadeControl(map) {
    if (!config.map2d?.hillshade?.enabled) {
        return null;
    }

    const hillshadeContainer = document.createElement('div');
    hillshadeContainer.className = 'hillshade-control';
    hillshadeContainer.style.cssText = `
        padding: 8px 12px;
        border-bottom: 1px solid #e0e0e0;
        background-color: #f8f9fa;
    `;

    hillshadeContainer.innerHTML = `
        <label style="display: flex; align-items: center; font-size: 12px; cursor: pointer;">
            <input type="checkbox" id="hillshade-toggle" style="margin-right: 6px;">
            Sombreamento
        </label>
    `;

    const checkbox = hillshadeContainer.querySelector('#hillshade-toggle');
    checkbox.onchange = (event) => handleHillshadeToggle(event, map);

    return hillshadeContainer;
}

/**
 * Handles hillshade toggle change event.
 *
 * @param {Event} event - Change event from checkbox
 * @param {Object} map - MapLibre map instance
 */
async function handleHillshadeToggle(event, map) {
    const enabled = event.target.checked;

    await setMapHillshadeState(enabled);
    applyHillshadeState(map, enabled);
}

/**
 * Applies hillshade visibility state to the map.
 *
 * @param {Object} map - MapLibre map instance
 * @param {boolean} enabled - Whether hillshade should be visible
 */
export function applyHillshadeState(map, enabled) {
    const terrainControl = map._controls?.find(
        (control) => control.constructor.name === 'TerrainControl'
    );

    if (terrainControl && terrainControl.setHillshadeVisibility) {
        terrainControl.setHillshadeVisibility(enabled);
    }
}

/**
 * Loads and applies the saved hillshade state.
 *
 * @param {HTMLElement} container - Container element with hillshade control
 * @param {Object} map - MapLibre map instance
 */
export async function loadHillshadeState(container, map) {
    const enabled = await getMapHillshadeState();
    const checkbox = container.querySelector('#hillshade-toggle');

    if (checkbox) {
        checkbox.checked = enabled;
        applyHillshadeState(map, enabled);
    }
}
