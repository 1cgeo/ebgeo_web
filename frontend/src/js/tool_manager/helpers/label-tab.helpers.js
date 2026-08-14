// Path: js/tool_manager/helpers/label-tab.helpers.js

/**
 * @fileoverview Shared label (Etiqueta) tab builder for shape attribute panels.
 * Reuses the same label pattern established by the point tool.
 */

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernTextarea,
    createSectionDivider,
} from './index.js';
import { formatAreaAuto } from '../../measurement_tool/measurement-geometry.js';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';

export const LABEL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`;

export const STYLE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

/**
 * Default label properties shared by all shape tools.
 */
export const LABEL_DEFAULT_PROPERTIES = {
    showLabel: false,
    labelText: '',
    labelColor: '#ffffff',
    labelSize: 14,
    labelOutlineColor: '#000000',
    labelOutlineWidth: 2,
    labelCreatedAtZoom: 0,
    labelCalculatedSize: 14,
    labelZoomCorrectionEnabled: true,
};

/**
 * Check if any label property changed between current feature and initial state.
 * @param {Object} feature - Current feature
 * @param {Object} initialProperties - Snapshot of initial properties
 * @returns {boolean} True if any label property differs
 */
export function hasLabelChanged(feature, initialProperties) {
    const props = feature.properties;
    return Object.keys(LABEL_DEFAULT_PROPERTIES).some(
        key => props[key] !== initialProperties[key]
    );
}

/**
 * Set of properties that require label size recalculation when changed.
 */
export const LABEL_ZOOM_PROPERTIES = new Set([
    'labelZoomCorrectionEnabled', 'labelCreatedAtZoom', 'labelSize',
]);

export const AREA_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`;

/**
 * Recalculate labelCalculatedSize based on current zoom and feature properties.
 * Backfills legacy features that lack labelCreatedAtZoom.
 * @param {Object} sourceFeature - Feature from the map source (mutated in place)
 * @param {Object} selectedFeature - Corresponding selected feature (mutated in place)
 * @param {number} currentZoom - Current map zoom level
 */
export function recalcLabelSize(sourceFeature, selectedFeature, currentZoom) {
    if (!sourceFeature.properties.labelCreatedAtZoom) {
        sourceFeature.properties.labelCreatedAtZoom = currentZoom;
        selectedFeature.properties.labelCreatedAtZoom = currentZoom;
    }

    const labelSize = sourceFeature.properties.labelSize || 14;
    let newCalculatedSize;

    if (sourceFeature.properties.labelZoomCorrectionEnabled === false) {
        newCalculatedSize = labelSize;
    } else {
        const diff = currentZoom - sourceFeature.properties.labelCreatedAtZoom;
        newCalculatedSize = Math.min(labelSize * Math.pow(2, diff), 255);
    }

    sourceFeature.properties.labelCalculatedSize = newCalculatedSize;
    selectedFeature.properties.labelCalculatedSize = newCalculatedSize;
}

/**
 * Compute the centroid of a polygon's outer ring as a simple coordinate average.
 * @param {Array} coordinates - GeoJSON polygon coordinates ([[ring1], [ring2], ...])
 * @returns {Array|null} [lng, lat] centroid or null if invalid
 */
export function computeShapeCentroid(coordinates) {
    if (!coordinates?.length) return null;
    const ring = coordinates[0];
    if (!ring || ring.length < 3) return null;

    // Skip closing point if ring is closed
    const len = (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])
        ? ring.length - 1
        : ring.length;

    let sumLng = 0, sumLat = 0;
    for (let i = 0; i < len; i++) {
        sumLng += ring[i][0];
        sumLat += ring[i][1];
    }
    return [sumLng / len, sumLat / len];
}

/**
 * Sync a separate point-based label source from the main polygon/shape source.
 * Creates a Point feature at each polygon centroid for labeled features,
 * preventing MapLibre tile-based label duplication.
 * @param {Object} map - MapLibre map instance
 * @param {string} labelSourceId - Label source ID (e.g. 'polygon-labels')
 * @param {Object} data - FeatureCollection from the main source
 */
export function syncLabelSource(map, labelSourceId, data) {
    const labelSource = map?.getSource(labelSourceId);
    if (!labelSource) return;

    const labelFeatures = [];
    for (const feature of data.features) {
        const props = feature.properties;
        if (!props.showLabel || !props.labelText) continue;

        const centroid = computeShapeCentroid(feature.geometry?.coordinates);
        if (!centroid) continue;

        labelFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: centroid },
            properties: { ...props },
        });
    }

    labelSource.setData({ type: 'FeatureCollection', features: labelFeatures });
}

/**
 * Create a RAF-throttled zoom handler that recalculates label sizes for all
 * features in a MapLibre source. Each control should create one instance.
 * @param {Function} getMap - Returns the map instance (e.g. () => this.map)
 * @param {string} sourceName - MapLibre source name (e.g. 'circles')
 * @param {string} [labelSourceName] - Optional label source name for syncing
 * @returns {{ handler: Function, cleanup: Function }}
 */
export function createLabelZoomHandler(getMap, sourceName, labelSourceName) {
    let pendingUpdate = false;
    let rafId = null;

    const update = async () => {
        const map = getMap();
        const source = map?.getSource(sourceName);
        if (!source) { pendingUpdate = false; return; }

        // `sourceName` is always one of the dispatcher-owned shape sources (circles, ellipses,
        // polygons, rectangles, setores), so this read-modify-write has to bracket itself with the
        // queue: drain before reading, or the copy is missing whatever is queued, and write back
        // through the dispatcher, or the whole-collection `setData` replaces MapLibre's
        // pending-update slot and the queued diff disappears with no error.
        const dispatcher = getGeoJsonDispatcher(map, sourceName);
        await dispatcher.flush();

        const currentZoom = map.getZoom();
        const data = await source.getData();
        let hasChanges = false;

        for (const feature of data.features) {
            if (!feature.properties.showLabel) continue;

            if (!feature.properties.labelCreatedAtZoom) {
                feature.properties.labelCreatedAtZoom = currentZoom;
                hasChanges = true;
            }

            const labelSize = feature.properties.labelSize || 14;
            let newCalc;

            if (feature.properties.labelZoomCorrectionEnabled === false) {
                newCalc = labelSize;
            } else {
                const diff = currentZoom - feature.properties.labelCreatedAtZoom;
                newCalc = Math.min(labelSize * Math.pow(2, diff), 255);
            }

            if (feature.properties.labelCalculatedSize !== newCalc) {
                feature.properties.labelCalculatedSize = newCalc;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            dispatcher.setData(data);
            if (labelSourceName) syncLabelSource(map, labelSourceName, data);
        }
        pendingUpdate = false;
    };

    return {
        handler: () => {
            if (!pendingUpdate) {
                pendingUpdate = true;
                rafId = requestAnimationFrame(update);
            }
        },
        cleanup: () => {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            pendingUpdate = false;
        },
    };
}

/**
 * Create a fill-area button config for the label tab.
 * @param {Function} computeArea - Returns the area in m², or null/0 if invalid
 * @returns {Object} Fill button config compatible with buildShapeTabsWithLabel's fillButton param
 */
export function createFillAreaButton(computeArea) {
    return {
        label: 'Preencher com área',
        icon: AREA_ICON,
        onClick: (textarea, selectedFeatures, control) => {
            const area = computeArea();
            if (area == null || area <= 0) return;
            const text = formatAreaAuto(area);
            textarea.value = text;
            control.updateFeaturesProperty(selectedFeatures, 'labelText', text);
        },
    };
}

/**
 * Wraps existing panel content in a two-tab layout (Símbolo/Estilo + Etiqueta).
 * Returns the tabs container to be appended to the panel.
 * @param {Object} params
 * @param {Function} params.buildStyleContent - Callback that receives a container and populates style controls
 * @param {Array} params.selectedFeatures - Selected features
 * @param {Object} params.feature - First selected feature
 * @param {Object} params.control - Tool control instance
 * @param {string} [params.styleLabel='Estilo'] - Label for the style tab button
 * @param {Object} [params.fillButton] - Optional fill button config for the label tab
 * @param {string} params.fillButton.label - Button text
 * @param {string} params.fillButton.icon - Button icon SVG
 * @param {Function} params.fillButton.onClick - Callback receiving (textarea, selectedFeatures, control)
 * @returns {HTMLElement} Tabs container element
 */
export function buildShapeTabsWithLabel({ buildStyleContent, selectedFeatures, feature, control, styleLabel = 'Estilo', fillButton }) {
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'feature-tabs-container';

    // Restore previously active inner tab from control instance
    const savedTab = control?._activeInnerTab || 'style';

    // Tab buttons
    const tabButtonsContainer = document.createElement('div');
    tabButtonsContainer.className = 'feature-tabs-buttons';

    const styleTabBtn = document.createElement('button');
    styleTabBtn.type = 'button';
    styleTabBtn.className = `feature-tab-btn ${savedTab === 'style' ? 'active' : ''}`;
    styleTabBtn.innerHTML = `${STYLE_ICON}<span>${styleLabel}</span>`;
    styleTabBtn.dataset.tabId = 'style';

    const labelTabBtn = document.createElement('button');
    labelTabBtn.type = 'button';
    labelTabBtn.className = `feature-tab-btn ${savedTab === 'label' ? 'active' : ''}`;
    labelTabBtn.innerHTML = `${LABEL_ICON}<span>Etiqueta</span>`;
    labelTabBtn.dataset.tabId = 'label';

    tabButtonsContainer.appendChild(styleTabBtn);
    tabButtonsContainer.appendChild(labelTabBtn);
    tabsContainer.appendChild(tabButtonsContainer);

    // Tab contents
    const styleTabContent = document.createElement('div');
    styleTabContent.className = `feature-tab-content ${savedTab === 'style' ? 'active' : ''}`;
    styleTabContent.dataset.tabId = 'style';

    const labelTabContent = document.createElement('div');
    labelTabContent.className = `feature-tab-content ${savedTab === 'label' ? 'active' : ''}`;
    labelTabContent.dataset.tabId = 'label';

    // Build style tab via callback
    buildStyleContent(styleTabContent);

    // Build label tab
    _buildLabelTab(labelTabContent, selectedFeatures, feature, control, fillButton);

    tabsContainer.appendChild(styleTabContent);
    tabsContainer.appendChild(labelTabContent);

    // Tab switching (uses direct refs instead of querySelectorAll)
    tabButtonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.feature-tab-btn');
        if (!btn) return;

        const tabId = btn.dataset.tabId;
        if (control) control._activeInnerTab = tabId;
        styleTabBtn.classList.toggle('active', tabId === 'style');
        labelTabBtn.classList.toggle('active', tabId === 'label');
        styleTabContent.classList.toggle('active', tabId === 'style');
        labelTabContent.classList.toggle('active', tabId === 'label');
    });

    return tabsContainer;
}

/**
 * Builds the label tab content for shapes.
 * Includes zoom correction controls matching the point tool pattern.
 */
function _buildLabelTab(container, selectedFeatures, feature, control, fillButton) {
    // Show label toggle
    const showLabelToggle = createModernToggle({
        label: 'Mostrar Etiqueta',
        checked: feature.properties.showLabel === true,
        onChange: (checked) => {
            control.updateFeaturesProperty(selectedFeatures, 'showLabel', checked);
            toggleLabelControls(checked);
        }
    });
    container.appendChild(showLabelToggle);

    // Label text
    const textField = createModernTextarea({
        label: 'Texto da Etiqueta',
        value: feature.properties.labelText || '',
        rows: 1,
        placeholder: 'Texto visível no mapa',
        onChange: (text) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelText', text);
        }
    });
    const textarea = textField.getTextarea();
    textarea.classList.add('attr-modern-textarea-input--single-line');
    container.appendChild(textField);

    // Optional fill button (e.g. "Preencher com área" for polygon)
    let fillBtnWrapper = null;
    if (fillButton) {
        fillBtnWrapper = document.createElement('div');
        fillBtnWrapper.className = 'point-label-coord-btn-wrapper';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'attr-modern-btn attr-modern-btn-secondary';
        btn.innerHTML = `${fillButton.icon}<span>${fillButton.label}</span>`;

        btn.addEventListener('click', () => {
            fillButton.onClick(textarea, selectedFeatures, control);
        });

        fillBtnWrapper.appendChild(btn);
        container.appendChild(fillBtnWrapper);
    }

    container.appendChild(createSectionDivider('Estilo do Texto'));

    // Label color
    const labelColorPicker = createModernColorPicker({
        label: 'Cor do Texto',
        value: feature.properties.labelColor || '#ffffff',
        onChange: (color) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelColor', color);
        }
    });
    container.appendChild(labelColorPicker);

    // Label size
    const labelSizeSlider = createModernSlider({
        label: 'Tamanho da Fonte',
        min: 8,
        max: 32,
        step: 1,
        value: feature.properties.labelSize || 14,
        unit: 'px',
        onChange: (value) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelSize', value);
        }
    });
    container.appendChild(labelSizeSlider);

    // Zoom correction toggle
    const zoomCorrectionToggle = createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.labelZoomCorrectionEnabled !== false,
        onChange: (enabled) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelZoomCorrectionEnabled', enabled);
            zoomSlider.style.display = enabled ? '' : 'none';
        }
    });
    container.appendChild(zoomCorrectionToggle);

    // Reference zoom slider
    const zoomSlider = createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round((feature.properties.labelCreatedAtZoom || 0) * 10) / 10,
        unit: '',
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            control.updateFeaturesProperty(selectedFeatures, 'labelCreatedAtZoom', roundedValue);
        }
    });

    if (feature.properties.labelZoomCorrectionEnabled === false) {
        zoomSlider.style.display = 'none';
    }

    container.appendChild(zoomSlider);

    container.appendChild(createSectionDivider('Contorno do Texto'));

    // Outline color
    const outlineColorPicker = createModernColorPicker({
        label: 'Cor do Contorno',
        value: feature.properties.labelOutlineColor || '#000000',
        onChange: (color) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelOutlineColor', color);
        }
    });
    container.appendChild(outlineColorPicker);

    // Outline width
    const outlineWidthSlider = createModernSlider({
        label: 'Espessura do Contorno',
        min: 0,
        max: 5,
        step: 1,
        value: feature.properties.labelOutlineWidth ?? 2,
        unit: 'px',
        onChange: (value) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelOutlineWidth', value);
        }
    });
    container.appendChild(outlineWidthSlider);

    // Toggle controls on/off based on showLabel
    const controlElements = [textField, labelColorPicker, labelSizeSlider, zoomCorrectionToggle, zoomSlider, outlineColorPicker, outlineWidthSlider];
    if (fillBtnWrapper) controlElements.splice(1, 0, fillBtnWrapper);

    function toggleLabelControls(enabled) {
        controlElements.forEach(el => {
            const inputs = el.querySelectorAll('input, button, textarea');
            inputs.forEach(input => {
                input.disabled = !enabled;
            });
            el.classList.toggle('feature-tab-control--disabled', !enabled);
        });
    }

    // Initialize state
    toggleLabelControls(feature.properties.showLabel === true);
}
