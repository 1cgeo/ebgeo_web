// Path: js/tool_manager/helpers/coordinate-editor.helpers.js

/**
 * @fileoverview Coordinate editor component for attribute panels.
 */

import {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
    formatCoordinates
} from '../../utilities';

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
    container.style.cssText = 'margin-bottom: 10px;';

    const label = document.createElement('label');
    label.textContent = 'Coordenadas:';
    label.style.cssText = 'display: block; font-weight: 500; color: #333; font-size: 13px; margin-bottom: 4px;';
    container.appendChild(label);

    const displayRow = document.createElement('div');
    displayRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const coordsText = document.createElement('input');
    coordsText.type = 'text';
    coordsText.readOnly = true;
    coordsText.style.cssText = `
        flex-grow: 1;
        padding: 6px 8px;
        border: 1px solid #ccc;
        border-radius: 3px;
        font-size: 12px;
        background: #f9f9f9;
        font-family: monospace;
        cursor: text;
    `;
    coordsText.value = 'Carregando...';
    formatCoordinates(lat, lng, currentFormat).then(formatted => {
        coordsText.value = formatted;
    });

    const editButton = document.createElement('button');
    editButton.className = 'tool-button';
    editButton.innerHTML = `<img src="./images/gear_icon.svg" alt="Editar" width="16" height="16" />`;
    editButton.title = 'Editar coordenadas';
    editButton.style.cssText = 'padding: 6px 8px; min-width: auto;';
    editButton.disabled = disabled;

    displayRow.appendChild(coordsText);
    displayRow.appendChild(editButton);
    container.appendChild(displayRow);

    editButton.onclick = () => {
        openCoordinateEditModal(lat, lng, currentFormat, (newLat, newLng) => {
            onCoordinateChange(newLat, newLng);
        });
    };

    container.updateCoordinates = (newLat, newLng) => {
        formatCoordinates(newLat, newLng, currentFormat).then(formatted => {
            coordsText.value = formatted;
        });
    };
    return container;
}

/**
 * Opens coordinate edit modal.
 *
 * @param {number} currentLat - Current latitude
 * @param {number} currentLng - Current longitude
 * @param {string} currentFormat - Current coordinate format
 * @param {Function} onConfirm - Callback when confirmed
 */
function openCoordinateEditModal(currentLat, currentLng, currentFormat, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'coordinate-edit-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.3);
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const content = document.createElement('div');
    content.className = 'coordinate-edit-modal-content';
    content.style.cssText = `
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        padding: 20px;
        min-width: 320px;
        max-width: 400px;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 20px; font-weight: 600; font-size: 16px; color: #333;';
    header.textContent = 'Editar Coordenadas';
    content.appendChild(header);

    const formatContainer = document.createElement('div');
    formatContainer.style.cssText = 'margin-bottom: 15px;';

    const formatLabel = document.createElement('label');
    formatLabel.textContent = 'Formato:';
    formatLabel.style.cssText = 'display: block; font-weight: 500; margin-bottom: 5px; font-size: 13px;';
    formatContainer.appendChild(formatLabel);

    const formatSelect = document.createElement('select');
    formatSelect.style.cssText = `
        width: 100%;
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 13px;
    `;

    COORDINATE_FORMATS.forEach(format => {
        const option = document.createElement('option');
        option.value = format.id;
        option.textContent = format.label;
        if (format.id === currentFormat) {
            option.selected = true;
        }
        formatSelect.appendChild(option);
    });

    formatContainer.appendChild(formatSelect);
    content.appendChild(formatContainer);

    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = 'margin-bottom: 15px;';

    const inputLabel = document.createElement('label');
    inputLabel.textContent = 'Coordenadas:';
    inputLabel.style.cssText = 'display: block; font-weight: 500; margin-bottom: 5px; font-size: 13px;';
    inputContainer.appendChild(inputLabel);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'Carregando...';
    formatCoordinates(currentLat, currentLng, currentFormat).then(formatted => {
        input.value = formatted;
    });
    input.placeholder = getPlaceholderForFormat(currentFormat);
    input.style.cssText = `
        width: 100%;
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 13px;
        box-sizing: border-box;
    `;
    inputContainer.appendChild(input);

    const validationMsg = document.createElement('div');
    validationMsg.style.cssText = 'color: #dc3545; font-size: 12px; margin-top: 5px; min-height: 18px;';
    inputContainer.appendChild(validationMsg);

    content.appendChild(inputContainer);

    formatSelect.onchange = () => {
        const newFormat = formatSelect.value;
        input.placeholder = getPlaceholderForFormat(newFormat);
        input.value = 'Carregando...';
        formatCoordinates(currentLat, currentLng, newFormat).then(formatted => {
            input.value = formatted;
        });
        validationMsg.textContent = '';
    };

    const closeModal = () => {
        if (modal && modal.parentNode) {
            document.removeEventListener('keydown', escapeHandler);
            modal.parentNode.removeChild(modal);
        }
    };

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancelar';
    cancelButton.className = 'tool-button pure-material-tool-button-contained';
    cancelButton.style.cssText = `
        padding: 8px 16px;
        min-height: 32px;
        font-size: 13px;
        font-weight: 500;
    `;
    cancelButton.onclick = () => {
        closeModal();
    };

    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Confirmar';
    confirmButton.className = 'tool-button pure-material-button-contained';
    confirmButton.style.cssText = `
        padding: 8px 16px;
        min-height: 32px;
        font-size: 13px;
        font-weight: 500;
    `;
    confirmButton.onclick = async () => {
        const coords = await parseCoordinates(input.value.trim(), formatSelect.value);
        if (coords) {
            onConfirm(coords.lat, coords.lng);
            closeModal();
        } else {
            validationMsg.textContent = 'Coordenadas inválidas para o formato selecionado';
        }
    };

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(confirmButton);
    content.appendChild(buttonContainer);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    document.addEventListener('keydown', escapeHandler);

    modal.appendChild(content);
    document.body.appendChild(modal);

    setTimeout(() => input.focus(), 100);
}
