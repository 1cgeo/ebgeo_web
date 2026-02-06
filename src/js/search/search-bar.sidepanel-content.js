// Path: js/search/search-bar.sidepanel-content.js

/**
 * @fileoverview Sidepanel content builders for search results.
 * Extracted from search-bar.component.js for better organization.
 * @module search/search-bar.sidepanel-content
 */

import { SEARCH_ICONS } from './search-bar.icons.js';
import { formatCoordinates, COORDINATE_FORMATS } from '../utilities/coordinate_converter.js';
import { isCurrentMapLockedSync } from '../store/store.js';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Escapes HTML special characters.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Copies text to clipboard and shows feedback.
 * @param {string} text - Text to copy
 * @param {HTMLElement} button - Button element for feedback
 */
async function copyToClipboard(text, button) {
    try {
        await navigator.clipboard.writeText(text);

        // Show success feedback
        const originalHTML = button.innerHTML;
        button.innerHTML = SEARCH_ICONS.check;
        button.classList.add('copied');

        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('copied');
        }, 1500);
    } catch (error) {
        console.warn('[SidepanelContent] Failed to copy to clipboard:', error);
    }
}

// ============================================================================
// COORDINATE RESULT CONTENT
// ============================================================================

/**
 * Populates the conversion list with all coordinate formats.
 * @param {HTMLElement} container - Container element for the list
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 */
async function populateConversionList(container, lat, lng) {
    for (const format of COORDINATE_FORMATS) {
        try {
            const formatted = await formatCoordinates(lat, lng, format.id);

            const item = document.createElement('div');
            item.className = 'coordinate-conversion-item';

            const labelSpan = document.createElement('span');
            labelSpan.className = 'coordinate-conversion-label';
            labelSpan.textContent = format.label;

            const valueContainer = document.createElement('div');
            valueContainer.className = 'coordinate-conversion-value-container';

            const valueSpan = document.createElement('span');
            valueSpan.className = 'coordinate-conversion-value';
            valueSpan.textContent = formatted;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'coordinate-copy-btn';
            copyBtn.title = 'Copiar';
            copyBtn.innerHTML = SEARCH_ICONS.copy;
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                copyToClipboard(formatted, copyBtn);
            };

            valueContainer.appendChild(valueSpan);
            valueContainer.appendChild(copyBtn);

            item.appendChild(labelSpan);
            item.appendChild(valueContainer);

            container.appendChild(item);
        } catch (error) {
            console.warn(`[SidepanelContent] Error formatting coordinate as ${format.id}:`, error);
        }
    }
}

/**
 * Creates sidepanel content for coordinate search results.
 * @param {Object} result - Coordinate search result
 * @param {Object} callbacks - Callback functions for actions
 * @param {Function} callbacks.onCreatePoint - Called when creating a point
 * @param {Function} callbacks.onCreateMilitarySymbol - Called when creating a military symbol
 * @param {Function} callbacks.onCreateCoordinationMeasure - Called when creating a coordination measure
 * @returns {HTMLElement} Sidepanel content element
 */
export function createCoordinateResultContent(result, callbacks) {
    const container = document.createElement('div');
    container.className = 'search-result-sidepanel-content coordinate-result-content';

    // Identification section
    const identification = document.createElement('div');
    identification.className = 'feature-identification';

    // Icon
    const iconContainer = document.createElement('div');
    iconContainer.className = 'feature-identification-icon feature-icon-bg-blue';
    iconContainer.innerHTML = SEARCH_ICONS.coordinate;

    // Info
    const info = document.createElement('div');
    info.className = 'feature-identification-info';

    const nameContainer = document.createElement('div');
    nameContainer.className = 'feature-identification-name-container';

    const name = document.createElement('div');
    name.className = 'feature-identification-name';
    name.textContent = 'Coordenada';
    nameContainer.appendChild(name);

    const typeText = document.createElement('div');
    typeText.className = 'feature-identification-type';
    typeText.textContent = result.formatLabel || 'Coordenada';

    const layerText = document.createElement('div');
    layerText.className = 'feature-identification-layer';
    layerText.textContent = result.name || '';

    info.appendChild(nameContainer);
    info.appendChild(typeText);
    info.appendChild(layerText);

    identification.appendChild(iconContainer);
    identification.appendChild(info);
    container.appendChild(identification);

    // Coordinate conversion section
    const conversionSection = document.createElement('div');
    conversionSection.className = 'coordinate-conversion-section';

    const conversionHeader = document.createElement('div');
    conversionHeader.className = 'search-result-section-header';
    conversionHeader.textContent = 'Converter para outros formatos';
    conversionSection.appendChild(conversionHeader);

    const conversionList = document.createElement('div');
    conversionList.className = 'coordinate-conversion-list';

    // Add conversion items for all formats (async)
    populateConversionList(conversionList, result.original.lat, result.original.lng);

    conversionSection.appendChild(conversionList);
    container.appendChild(conversionSection);

    // Create feature section
    // Create feature section (hidden when map is locked)
    if (!isCurrentMapLockedSync()) {
        const createSection = document.createElement('div');
        createSection.className = 'coordinate-create-section';

        const createHeader = document.createElement('div');
        createHeader.className = 'search-result-section-header';
        createHeader.textContent = 'Criar feição nesta coordenada';
        createSection.appendChild(createHeader);

        const createButtons = document.createElement('div');
        createButtons.className = 'coordinate-create-buttons';

        // Create Point button
        const createPointBtn = document.createElement('button');
        createPointBtn.className = 'coordinate-create-btn';
        createPointBtn.innerHTML = `${SEARCH_ICONS.point}<span>Ponto</span>`;
        createPointBtn.title = 'Criar ponto nesta coordenada';
        createPointBtn.onclick = () => callbacks.onCreatePoint?.(result);
        createButtons.appendChild(createPointBtn);

        // Create Military Symbol button
        const createMilitaryBtn = document.createElement('button');
        createMilitaryBtn.className = 'coordinate-create-btn';
        createMilitaryBtn.innerHTML = `${SEARCH_ICONS.military}<span>Simbologia Militar</span>`;
        createMilitaryBtn.title = 'Criar simbologia militar nesta coordenada';
        createMilitaryBtn.onclick = () => callbacks.onCreateMilitarySymbol?.(result);
        createButtons.appendChild(createMilitaryBtn);

        // Create Coordination Measure button
        const createCoordMeasureBtn = document.createElement('button');
        createCoordMeasureBtn.className = 'coordinate-create-btn';
        createCoordMeasureBtn.innerHTML = `${SEARCH_ICONS.crosshair}<span>Medida de Coordenação</span>`;
        createCoordMeasureBtn.title = 'Criar medida de coordenação nesta coordenada';
        createCoordMeasureBtn.onclick = () => callbacks.onCreateCoordinationMeasure?.(result);
        createButtons.appendChild(createCoordMeasureBtn);

        createSection.appendChild(createButtons);
        container.appendChild(createSection);
    }

    return container;
}

// ============================================================================
// API RESULT CONTENT
// ============================================================================

/**
 * Creates sidepanel content for API search results.
 * @param {Object} result - API search result
 * @param {Object} callbacks - Callback functions for actions
 * @param {Function} callbacks.onSaveAsFeature - Called when saving as feature
 * @returns {HTMLElement} Sidepanel content element
 */
export function createApiResultContent(result, callbacks) {
    const container = document.createElement('div');
    container.className = 'search-result-sidepanel-content';

    // Identification section (similar to feature-identification)
    const identification = document.createElement('div');
    identification.className = 'feature-identification';

    // Icon
    const iconContainer = document.createElement('div');
    iconContainer.className = 'feature-identification-icon feature-icon-bg-orange';
    iconContainer.innerHTML = SEARCH_ICONS.place;

    // Info
    const info = document.createElement('div');
    info.className = 'feature-identification-info';

    const nameContainer = document.createElement('div');
    nameContainer.className = 'feature-identification-name-container';

    const name = document.createElement('div');
    name.className = 'feature-identification-name';
    name.textContent = result.name || 'Resultado da Busca';
    nameContainer.appendChild(name);

    const typeText = document.createElement('div');
    typeText.className = 'feature-identification-type';
    typeText.textContent = result.original?.tipo || 'Local';

    const layerText = document.createElement('div');
    layerText.className = 'feature-identification-layer';
    layerText.textContent = result.description || '';

    info.appendChild(nameContainer);
    info.appendChild(typeText);
    info.appendChild(layerText);

    identification.appendChild(iconContainer);
    identification.appendChild(info);
    container.appendChild(identification);

    // Properties section
    const propertiesSection = document.createElement('div');
    propertiesSection.className = 'search-result-properties-section';

    const propertiesHeader = document.createElement('div');
    propertiesHeader.className = 'search-result-section-header';
    propertiesHeader.textContent = 'Informações';
    propertiesSection.appendChild(propertiesHeader);

    const propertiesList = document.createElement('ul');
    propertiesList.className = 'search-result-properties-list';

    const original = result.original || {};
    const infoItems = [
        { label: 'Classe', value: original.tipo },
        { label: 'Município', value: original.municipio },
        { label: 'Estado', value: original.estado },
        { label: 'Latitude', value: result.coordinates?.[1]?.toFixed(6) },
        { label: 'Longitude', value: result.coordinates?.[0]?.toFixed(6) }
    ].filter(item => item.value);

    infoItems.forEach(item => {
        const li = document.createElement('li');
        li.className = 'search-result-property-item';
        li.innerHTML = `
            <span class="search-result-property-label">${item.label}</span>
            <span class="search-result-property-value">${escapeHtml(String(item.value))}</span>
        `;
        propertiesList.appendChild(li);
    });

    propertiesSection.appendChild(propertiesList);
    container.appendChild(propertiesSection);

    // Save as feature button section (hidden when map is locked)
    if (!isCurrentMapLockedSync()) {
        const saveSection = document.createElement('div');
        saveSection.className = 'search-result-save-section';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'search-result-save-btn';
        saveBtn.innerHTML = `${SEARCH_ICONS.save} Salvar como Feição`;
        saveBtn.title = 'Salvar este resultado como uma feição ponto no mapa';
        saveBtn.onclick = () => callbacks.onSaveAsFeature?.(result);

        saveSection.appendChild(saveBtn);
        container.appendChild(saveSection);
    }

    return container;
}
