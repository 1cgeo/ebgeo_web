// Path: js/analysis_tools/los_tool/los_attributes_panel.js

import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';
import { formatCoordinates } from '../../utilities/coordinate_converter.js';

/**
 * Format distance for display
 * @param {number} distanceMeters - Distance in meters
 * @returns {string} Formatted distance string
 */
function formatDistance(distanceMeters) {
    if (distanceMeters === undefined || distanceMeters === null) {
        return '-';
    }
    return distanceMeters >= 1000
        ? `${(distanceMeters / 1000).toFixed(2)} km`
        : `${distanceMeters.toFixed(1)} m`;
}

/**
 * Extract coordinates from LOS geometry
 * @param {Object} geometry - GeoJSON geometry
 * @returns {Object} {start, end, intersection}
 */
function extractLOSCoordinates(geometry) {
    let startCoords = null;
    let endCoords = null;
    let intersectionCoords = null;

    if (geometry.type === 'MultiLineString') {
        // Has obstruction: first line is visible, second is obstructed
        const visibleLine = geometry.coordinates[0];
        const obstructedLine = geometry.coordinates[1];
        startCoords = visibleLine[0];
        endCoords = obstructedLine[obstructedLine.length - 1];
        // Intersection is where visible line ends and obstructed begins
        intersectionCoords = visibleLine[visibleLine.length - 1];
    } else if (geometry.type === 'LineString') {
        // No obstruction: full line is visible
        startCoords = geometry.coordinates[0];
        endCoords = geometry.coordinates[geometry.coordinates.length - 1];
    }

    return { start: startCoords, end: endCoords, intersection: intersectionCoords };
}

/**
 * Create a clickable coordinate row
 * @param {string} label - Row label
 * @param {Array} coords - [lng, lat] coordinates
 * @param {string} color - Color for indicator ('green' or 'red')
 * @returns {HTMLElement}
 */
function createCoordinateRow(label, coords, color) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 12px;';

    // Color indicator
    const indicator = document.createElement('span');
    indicator.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        background-color: ${color === 'green' ? '#00c853' : '#ff5252'};
        box-shadow: 0 0 4px ${color === 'green' ? 'rgba(0, 200, 83, 0.5)' : 'rgba(255, 82, 82, 0.5)'};
    `;
    row.appendChild(indicator);

    // Label
    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = 'font-weight: 500; color: #666; min-width: 65px;';
    labelSpan.textContent = label + ':';
    row.appendChild(labelSpan);

    // Value (clickable)
    const valueSpan = document.createElement('span');
    valueSpan.style.cssText = `
        font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
        color: #333;
        padding: 2px 6px;
        background-color: rgba(255, 255, 255, 0.7);
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    valueSpan.textContent = 'Carregando...';
    valueSpan.title = 'Clique para copiar';

    // Format and display coordinates
    const [lng, lat] = coords;
    formatCoordinates(lat, lng, 'latlong').then(formatted => {
        valueSpan.textContent = formatted;
    });

    // Hover effect
    valueSpan.addEventListener('mouseenter', () => {
        valueSpan.style.backgroundColor = 'var(--primary-light, #e3f2fd)';
        valueSpan.style.color = 'var(--primary-color, #1976d2)';
    });
    valueSpan.addEventListener('mouseleave', () => {
        valueSpan.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
        valueSpan.style.color = '#333';
    });

    // Copy on click
    valueSpan.addEventListener('click', async () => {
        const text = valueSpan.textContent;
        try {
            await navigator.clipboard.writeText(text);
            const original = valueSpan.textContent;
            valueSpan.textContent = 'Copiado!';
            valueSpan.style.backgroundColor = '#00c853';
            valueSpan.style.color = 'white';
            setTimeout(() => {
                valueSpan.textContent = original;
                valueSpan.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
                valueSpan.style.color = '#333';
            }, 1500);
        } catch (e) {
            console.warn('Failed to copy coordinates:', e);
        }
    });

    row.appendChild(valueSpan);
    return row;
}

/**
 * Create LOS length info section (to be displayed before tabs)
 * @param {Object} feature - LOS feature
 * @returns {HTMLElement} Info section element
 */
export function createLOSInfoSection(feature) {
    const section = document.createElement('div');
    section.className = 'los-info-section';

    // Section divider
    const divider = createSectionDivider('Informações');
    section.appendChild(divider);

    // Info container
    const container = document.createElement('div');
    container.className = 'los-length-info';
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        background: #f8f9fa;
        border-radius: 6px;
        margin-bottom: 12px;
    `;

    // Extract coordinates from geometry
    const coords = extractLOSCoordinates(feature.geometry);

    // Coordinates section (before length info)
    if (coords.start && coords.end) {
        const coordsTitle = document.createElement('div');
        coordsTitle.style.cssText = `
            font-size: 11px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        `;
        coordsTitle.textContent = 'Coordenadas';
        container.appendChild(coordsTitle);

        const coordsGrid = document.createElement('div');
        coordsGrid.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;';

        // Start coordinate
        coordsGrid.appendChild(createCoordinateRow('Inicial', coords.start, 'green'));

        // Intersection coordinate (if exists)
        if (coords.intersection) {
            coordsGrid.appendChild(createCoordinateRow('Interseção', coords.intersection, 'red'));
        }

        // End coordinate
        coordsGrid.appendChild(createCoordinateRow('Final', coords.end, coords.intersection ? 'red' : 'green'));

        container.appendChild(coordsGrid);

        // Separator between coordinates and lengths
        const separator = document.createElement('div');
        separator.style.cssText = 'border-top: 1px solid rgba(0,0,0,0.08); margin: 4px 0;';
        container.appendChild(separator);
    }

    const totalLength = feature.properties.totalLength;
    const visibleLength = feature.properties.visibleLength;
    const obstructedLength = feature.properties.obstructedLength;

    // Total length
    const totalRow = document.createElement('div');
    totalRow.className = 'los-info__row';
    const totalLabel = document.createElement('span');
    totalLabel.className = 'los-info__label';
    totalLabel.textContent = 'Comprimento Total';
    const totalValue = document.createElement('span');
    totalValue.className = 'los-info__value';
    totalValue.textContent = formatDistance(totalLength);
    totalRow.appendChild(totalLabel);
    totalRow.appendChild(totalValue);
    container.appendChild(totalRow);

    // Visible length (green)
    const visibleRow = document.createElement('div');
    visibleRow.className = 'los-info__row';
    const visibleLabel = document.createElement('span');
    visibleLabel.className = 'los-info__label';
    const visibleIndicator = document.createElement('span');
    visibleIndicator.className = 'los-info__color-indicator los-info__color-indicator--visible';
    visibleLabel.appendChild(visibleIndicator);
    visibleLabel.appendChild(document.createTextNode('Visível'));
    const visibleValue = document.createElement('span');
    visibleValue.className = 'los-info__value los-info__value--visible';
    visibleValue.textContent = formatDistance(visibleLength);
    visibleRow.appendChild(visibleLabel);
    visibleRow.appendChild(visibleValue);
    container.appendChild(visibleRow);

    // Obstructed length (red)
    const obstructedRow = document.createElement('div');
    obstructedRow.className = 'los-info__row';
    const obstructedLabel = document.createElement('span');
    obstructedLabel.className = 'los-info__label';
    const obstructedIndicator = document.createElement('span');
    obstructedIndicator.className = 'los-info__color-indicator los-info__color-indicator--obstructed';
    obstructedLabel.appendChild(obstructedIndicator);
    obstructedLabel.appendChild(document.createTextNode('Obstruído'));
    const obstructedValue = document.createElement('span');
    obstructedValue.className = 'los-info__value los-info__value--obstructed';
    obstructedValue.textContent = formatDistance(obstructedLength);
    obstructedRow.appendChild(obstructedLabel);
    obstructedRow.appendChild(obstructedValue);
    container.appendChild(obstructedRow);

    section.appendChild(container);
    return section;
}

/**
 * Create LOS parameters panel content (for Parameters tab)
 * @param {HTMLElement} container - Container to add parameters to
 * @param {Array} selectedFeatures - Selected LOS features
 * @param {Object} losControl - LOS control instance
 */
export function addLOSParametersToPanel(container, selectedFeatures, losControl) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    // Observer height slider
    container.appendChild(createModernSlider({
        label: 'Altura do Observador',
        min: 0,
        max: 50,
        step: 0.1,
        value: feature.properties.observerHeight ?? 1.5,
        unit: 'm',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
        }
    }));

    // Target height slider
    container.appendChild(createModernSlider({
        label: 'Altura do Alvo',
        min: 0,
        max: 50,
        step: 0.1,
        value: feature.properties.targetHeight ?? 0,
        unit: 'm',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'targetHeight', value);
        }
    }));

    // Sample points slider
    container.appendChild(createModernSlider({
        label: 'Pontos de Amostragem',
        min: 10,
        max: 500,
        step: 10,
        value: feature.properties.samplePoints ?? 100,
        unit: '',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'samplePoints', value);
        }
    }));
}

/**
 * Add LOS style attributes to the panel (for Style tab)
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected LOS features
 * @param {Object} losControl - LOS control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addLOSAttributesToPanel(panel, selectedFeatures, losControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // Only show header if not hidden (for sidebar integration)
    if (!options.hideHeader) {
        if (selectedFeatures.length === 1) {
            const headerComponent = createFeatureHeaderWithOptions(
                feature.properties.nome,
                (newName) => {
                    losControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                    uiManager.updateSelectionHighlight();
                },
                selectedFeatures,
                selectionManager,
                uiManager
            );
            panel.appendChild(headerComponent);
        } else if (selectedFeatures.length > 1) {
            const multiSelectHeader = document.createElement('div');
            multiSelectHeader.className = 'feature-header-with-options';

            const infoText = document.createElement('div');
            infoText.className = 'feature-name-wrapper';

            infoText.textContent = `${selectedFeatures.length} linhas de visada selecionadas`;

            const optionsButton = createFeatureOptionsButton(
                selectedFeatures,
                selectionManager,
                uiManager
            );

            multiSelectHeader.appendChild(infoText);
            multiSelectHeader.appendChild(optionsButton);
            panel.appendChild(multiSelectHeader);
        }
    }

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 1) * 100),
        unit: '%',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Width slider
    panel.appendChild(createModernSlider({
        label: 'Largura',
        min: 1,
        max: 30,
        step: 1,
        value: feature.properties.width || 3,
        unit: 'px',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'width', value);
        }
    }));

    // Options section
    panel.appendChild(createSectionDivider('Opções'));

    // Show measure toggle (view-only: allowed in locked mode, not persisted)
    panel.appendChild(createModernToggle({
        label: 'Mostrar Medição',
        className: 'attr-toggle--view-only',
        checked: feature.properties.measure || false,
        onChange: (checked) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
        }
    }));

    // Show profile toggle (view-only: allowed in locked mode, not persisted)
    if (selectedFeatures.length === 1) {
        panel.appendChild(createModernToggle({
            id: 'profile-toggle',
            label: 'Mostrar Perfil',
            className: 'attr-toggle--view-only',
            checked: feature.properties.profile || false,
            onChange: async (checked) => {
                await losControl.updateFeaturesProperty(selectedFeatures, 'profile', checked);
                selectionManager.updateProfile();
            }
        }));
    }

    // Action buttons (no set default for LOS)
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: losControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null,
        hidden: options.hideButtons
    }));
}
