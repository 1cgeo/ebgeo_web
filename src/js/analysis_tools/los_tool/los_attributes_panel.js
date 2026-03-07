// Path: js/analysis_tools/los_tool/los_attributes_panel.js

import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '@tools/helpers/index.js';
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
 * Copy text to clipboard with visual feedback on the element.
 * @param {string} text - Text to copy
 * @param {HTMLElement} element - Element to show feedback on
 * @param {string} originalText - Original text to restore after feedback
 */
async function copyToClipboard(text, element, originalText) {
    const showFeedback = (message, duration = 1500) => {
        element.textContent = message;
        setTimeout(() => { element.textContent = originalText; }, duration);
    };

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            showFeedback('Copiado!');
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.className = 'sr-only';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            showFeedback(successful ? 'Copiado!' : 'Erro ao copiar', successful ? 1500 : 2000);
        }
    } catch (err) {
        console.warn('Failed to copy coordinates:', err);
        showFeedback('Erro ao copiar', 2000);
    }
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
    row.className = 'los-coord-row';

    const indicator = document.createElement('span');
    indicator.className = `los-coord-row__indicator los-coord-row__indicator--${color}`;
    row.appendChild(indicator);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'los-coord-row__label';
    labelSpan.textContent = label + ':';
    row.appendChild(labelSpan);

    const valueSpan = document.createElement('span');
    valueSpan.className = 'los-coord-row__value';
    valueSpan.title = 'Clique para copiar';

    const [lng, lat] = coords;
    const formatted = formatCoordinates(lat, lng, 'latlong');
    valueSpan.textContent = formatted;

    valueSpan.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyToClipboard(formatted, valueSpan, formatted);
    });

    row.appendChild(valueSpan);
    return row;
}

/**
 * Create LOS length info section (to be displayed before tabs)
 * @param {Object} feature - LOS feature
 * @returns {HTMLElement} Info section element
 */
/**
 * Build a length info row with optional color dot indicator.
 * @param {string} label - Row label text
 * @param {number} length - Distance in meters
 * @param {string} [dotClass] - Optional BEM modifier for color dot (e.g. 'visible', 'obstructed')
 * @param {string} [valueClass] - Optional BEM modifier for value styling
 * @returns {HTMLElement}
 */
function createLengthRow(label, length, dotClass, valueClass) {
    const row = document.createElement('div');
    row.className = 'los-info-section__row';

    const labelEl = document.createElement('span');
    labelEl.className = 'los-info-section__row-label';

    if (dotClass) {
        const dot = document.createElement('span');
        dot.className = `los-info-section__color-dot los-info-section__color-dot--${dotClass}`;
        labelEl.appendChild(dot);
    }

    const labelText = document.createTextNode(label);
    labelEl.appendChild(labelText);

    const valueEl = document.createElement('span');
    valueEl.className = valueClass
        ? `los-info-section__row-value los-info-section__row-value--${valueClass}`
        : 'los-info-section__row-value';
    valueEl.textContent = formatDistance(length);

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
}

export function createLOSInfoSection(feature) {
    const section = document.createElement('div');
    section.className = 'los-info-section';

    section.appendChild(createSectionDivider('Informações'));

    const container = document.createElement('div');
    container.className = 'los-info-section__container';

    const coords = extractLOSCoordinates(feature.geometry);

    if (coords.start && coords.end) {
        const coordsTitle = document.createElement('div');
        coordsTitle.className = 'los-info-section__subtitle';
        coordsTitle.textContent = 'Coordenadas';
        container.appendChild(coordsTitle);

        const coordsGrid = document.createElement('div');
        coordsGrid.className = 'los-info-section__coords-grid';

        coordsGrid.appendChild(createCoordinateRow('Inicial', coords.start, 'green'));

        if (coords.intersection) {
            coordsGrid.appendChild(createCoordinateRow('Interseção', coords.intersection, 'red'));
        }

        coordsGrid.appendChild(createCoordinateRow('Final', coords.end, coords.intersection ? 'red' : 'green'));
        container.appendChild(coordsGrid);

        const separator = document.createElement('div');
        separator.className = 'los-info-section__separator';
        container.appendChild(separator);
    }

    container.appendChild(createLengthRow('Comprimento Total', feature.properties.totalLength));
    container.appendChild(createLengthRow('Visível', feature.properties.visibleLength, 'visible', 'visible'));
    container.appendChild(createLengthRow('Obstruído', feature.properties.obstructedLength, 'obstructed', 'obstructed'));

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

    const terrainDependentSliders = [];

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

    const onTerrainChange = () => {
        const terrainActive = losControl.geometry.isTerrainAvailable(losControl.map);
        for (const slider of terrainDependentSliders) {
            if (slider.setDisabled) {
                slider.setDisabled(!terrainActive, disabledMessage);
            }
        }
    };

    losControl.map.on('terrain', onTerrainChange);

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

    panel.appendChild(createSectionDivider('Opções'));

    panel.appendChild(createModernToggle({
        label: 'Mostrar Medição',
        checked: feature.properties.measure || false,
        onChange: (checked) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
        }
    }));

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
