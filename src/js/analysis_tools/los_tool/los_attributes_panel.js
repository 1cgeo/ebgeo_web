// Path: js/analysis_tools/los_tool/los_attributes_panel.js

import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';
import { formatCoordinates } from '@utils/coordinate_converter.js';

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
        user-select: text;
    `;
    valueSpan.textContent = 'Carregando...';
    valueSpan.title = 'Clique para copiar';

    // Store formatted coordinate for reliable copying
    let formattedCoordinate = null;

    // Format and display coordinates
    const [lng, lat] = coords;
    formatCoordinates(lat, lng, 'latlong').then(formatted => {
        formattedCoordinate = formatted;
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
    valueSpan.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Use stored coordinate or current text content
        const text = formattedCoordinate || valueSpan.textContent;

        // Don't copy if still loading
        if (text === 'Carregando...') {
            return;
        }

        const showFeedback = (message, bgColor, textColor, duration = 1500) => {
            const original = formattedCoordinate || valueSpan.textContent;
            valueSpan.textContent = message;
            valueSpan.style.backgroundColor = bgColor;
            valueSpan.style.color = textColor;
            setTimeout(() => {
                valueSpan.textContent = original;
                valueSpan.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
                valueSpan.style.color = '#333';
            }, duration);
        };

        try {
            // Try modern Clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                showFeedback('Copiado!', '#00c853', 'white');
            } else {
                // Fallback for older browsers or insecure contexts
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.cssText = 'position: fixed; left: -9999px; top: -9999px;';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (successful) {
                    showFeedback('Copiado!', '#00c853', 'white');
                } else {
                    showFeedback('Erro ao copiar', '#ff5252', 'white', 2000);
                }
            }
        } catch (err) {
            console.warn('Failed to copy coordinates:', err);
            showFeedback('Erro ao copiar', '#ff5252', 'white', 2000);
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
    totalRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    totalRow.innerHTML = `
        <span style="font-size: 12px; color: #666;">Comprimento Total</span>
        <span style="font-size: 13px; font-weight: 600; color: #333;">${formatDistance(totalLength)}</span>
    `;
    container.appendChild(totalRow);

    // Visible length (green)
    const visibleRow = document.createElement('div');
    visibleRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    visibleRow.innerHTML = `
        <span style="font-size: 12px; color: #666; display: flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; background: #00FF00; border-radius: 2px;"></span>
            Visível
        </span>
        <span style="font-size: 13px; font-weight: 600; color: #00AA00;">${formatDistance(visibleLength)}</span>
    `;
    container.appendChild(visibleRow);

    // Obstructed length (red)
    const obstructedRow = document.createElement('div');
    obstructedRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    obstructedRow.innerHTML = `
        <span style="font-size: 12px; color: #666; display: flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; background: #FF0000; border-radius: 2px;"></span>
            Obstruído
        </span>
        <span style="font-size: 13px; font-weight: 600; color: #CC0000;">${formatDistance(obstructedLength)}</span>
    `;
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
    const isTerrainAvailable = losControl.geometry.isTerrainAvailable(losControl.map);
    const disabledMessage = 'Ative o terreno para modificar este parâmetro';

    // Collect sliders for reactive terrain toggle
    const terrainDependentSliders = [];

    // Observer height slider
    const observerSlider = createModernSlider({
        label: 'Altura do Observador',
        min: 0,
        max: 50,
        step: 0.1,
        value: feature.properties.observerHeight ?? 1.5,
        unit: 'm',
        disabled: !isTerrainAvailable,
        disabledMessage,
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
        }
    });
    terrainDependentSliders.push(observerSlider);
    container.appendChild(observerSlider);

    // Target height slider
    const targetSlider = createModernSlider({
        label: 'Altura do Alvo',
        min: 0,
        max: 50,
        step: 0.1,
        value: feature.properties.targetHeight ?? 0,
        unit: 'm',
        disabled: !isTerrainAvailable,
        disabledMessage,
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'targetHeight', value);
        }
    });
    terrainDependentSliders.push(targetSlider);
    container.appendChild(targetSlider);

    // Sample points slider
    const sampleSlider = createModernSlider({
        label: 'Pontos de Amostragem',
        min: 10,
        max: 500,
        step: 10,
        value: feature.properties.samplePoints ?? 100,
        unit: '',
        disabled: !isTerrainAvailable,
        disabledMessage,
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'samplePoints', value);
        }
    });
    terrainDependentSliders.push(sampleSlider);
    container.appendChild(sampleSlider);

    // Reactively update slider disabled state when terrain is toggled
    const onTerrainChange = () => {
        const terrainActive = losControl.geometry.isTerrainAvailable(losControl.map);
        for (const slider of terrainDependentSliders) {
            if (slider.setDisabled) {
                slider.setDisabled(!terrainActive, disabledMessage);
            }
        }
    };

    losControl.map.on('terrain', onTerrainChange);

    // Store cleanup on the container so it can be called when the panel is destroyed
    const previousCleanup = container._parametersCleanup;
    container._parametersCleanup = () => {
        losControl.map.off('terrain', onTerrainChange);
        if (previousCleanup) previousCleanup();
    };
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
            infoText.style.cssText = 'font-size: 14px; color: #666; padding: 6px;';
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

    // Show measure toggle
    panel.appendChild(createModernToggle({
        label: 'Mostrar Medição',
        checked: feature.properties.measure || false,
        onChange: (checked) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
        }
    }));

    // Show profile toggle (single selection only)
    if (selectedFeatures.length === 1) {
        panel.appendChild(createModernToggle({
            id: 'profile-toggle',
            label: 'Mostrar Perfil',
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
