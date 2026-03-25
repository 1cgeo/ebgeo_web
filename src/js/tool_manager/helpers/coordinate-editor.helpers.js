// Path: js/tool_manager/helpers/coordinate-editor.helpers.js

/**
 * @fileoverview Coordinate editor component for attribute panels.
 */

import { formatCoordinates } from '../../utilities';
import { showCoordinateEditModal } from '../../modals/coordinate-edit.modal.js';

/**
 * Creates coordinate editor for Point geometries.
 *
 * @param {Object} feature - Feature with Point geometry
 * @param {Object} uiManager - UIManager instance
 * @param {Function} onCoordinateChange - Callback(lat, lng)
 * @param {boolean} [disabled=false] - Disable editing for multiple selections
 * @returns {HTMLElement} Coordinate editor container
 */
export function createCoordinateEditor(feature, uiManager, onCoordinateChange, disabled = false) {
    if (!feature || feature.geometry.type !== 'Point') {
        return document.createElement('div');
    }

    const mouseCoordinatesControl = uiManager?.mouseCoordinatesControl;
    if (!mouseCoordinatesControl) {
        console.warn('MouseCoordinatesControl not available in UIManager');
        return document.createElement('div');
    }

    const [lng, lat] = feature.geometry.coordinates;
    const currentFormat = mouseCoordinatesControl.getCurrentFormat();

    const container = document.createElement('div');
    container.className = 'coordinate-editor-container';

    const label = document.createElement('label');
    label.textContent = 'Coordenadas:';
    label.className = 'coordinate-editor-label';
    container.appendChild(label);

    const displayRow = document.createElement('div');
    displayRow.className = 'coordinate-editor-display';

    const coordsText = document.createElement('input');
    coordsText.type = 'text';
    coordsText.readOnly = true;
    coordsText.className = 'coordinate-editor-input';
    coordsText.value = 'Carregando...';
    formatCoordinates(lat, lng, currentFormat).then(formatted => {
        coordsText.value = formatted;
    });

    const editButton = document.createElement('button');
    editButton.className = 'tool-button coordinate-editor-btn';
    editButton.innerHTML = `<img src="./images/gear_icon.svg" alt="Editar" width="16" height="16" />`;
    editButton.title = 'Editar coordenadas';
    editButton.disabled = disabled;

    displayRow.appendChild(coordsText);
    displayRow.appendChild(editButton);
    container.appendChild(displayRow);

    editButton.onclick = () => {
        showCoordinateEditModal({
            lat,
            lng,
            currentFormat,
            onConfirm: (newLat, newLng) => {
                onCoordinateChange(newLat, newLng);
            }
        });
    };

    container.updateCoordinates = (newLat, newLng) => {
        formatCoordinates(newLat, newLng, currentFormat).then(formatted => {
            coordsText.value = formatted;
        });
    };
    return container;
}
