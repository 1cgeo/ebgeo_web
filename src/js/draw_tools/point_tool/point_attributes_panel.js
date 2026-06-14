// Path: js/draw_tools/point_tool/point_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernTextarea,
    createSectionDivider,
    createInitialPropertiesMap,
    createPanelHeader,
    createActionButtons,
    createMarkerSymbolPicker
} from '../../tool_manager/helpers/index.js';
import { formatCoordinates } from '@utils/coordinate_converter.js';
import { parseCustomMarker } from './point-custom-icons.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const ICONS = {
    STYLE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    LABEL: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    LOCATION: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Add point attributes to the attributes panel with Marcador/Etiqueta tabs.
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected point features
 * @param {Object} pointControl - Point control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addPointAttributesToPanel(panel, selectedFeatures, pointControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    createPanelHeader({
        panel,
        features: selectedFeatures,
        featureType: 'point',
        control: pointControl,
        selectionManager,
        uiManager,
        hideHeader: options.hideHeader
    });

    // Tabs (Marcador / Etiqueta)
    _buildStyleTabs(panel, selectedFeatures, feature, pointControl);

    // Action buttons (below tabs)
    createActionButtons({
        panel,
        features: selectedFeatures,
        control: pointControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons
    });
}

// ============================================================================
// PRIVATE: TABS
// ============================================================================

/**
 * Builds the Marcador / Etiqueta tab structure following the 3D marker pattern.
 */
function _buildStyleTabs(panel, selectedFeatures, feature, pointControl) {
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'feature-tabs-container';

    // Tab buttons
    const tabButtonsContainer = document.createElement('div');
    tabButtonsContainer.className = 'feature-tabs-buttons';

    const markerTabBtn = document.createElement('button');
    markerTabBtn.type = 'button';
    markerTabBtn.className = 'feature-tab-btn active';
    markerTabBtn.innerHTML = `${ICONS.STYLE}<span>Marcador</span>`;
    markerTabBtn.dataset.tabId = 'marker';

    const labelTabBtn = document.createElement('button');
    labelTabBtn.type = 'button';
    labelTabBtn.className = 'feature-tab-btn';
    labelTabBtn.innerHTML = `${ICONS.LABEL}<span>Etiqueta</span>`;
    labelTabBtn.dataset.tabId = 'label';

    tabButtonsContainer.appendChild(markerTabBtn);
    tabButtonsContainer.appendChild(labelTabBtn);
    tabsContainer.appendChild(tabButtonsContainer);

    // Tab contents
    const markerTabContent = document.createElement('div');
    markerTabContent.className = 'feature-tab-content active';
    markerTabContent.dataset.tabId = 'marker';

    const labelTabContent = document.createElement('div');
    labelTabContent.className = 'feature-tab-content';
    labelTabContent.dataset.tabId = 'label';

    // Build tab contents
    _buildMarkerTab(markerTabContent, selectedFeatures, feature, pointControl);
    _buildLabelTab(labelTabContent, selectedFeatures, feature, pointControl);

    tabsContainer.appendChild(markerTabContent);
    tabsContainer.appendChild(labelTabContent);

    // Tab switching
    tabButtonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.feature-tab-btn');
        if (!btn) return;

        const tabId = btn.dataset.tabId;

        tabButtonsContainer.querySelectorAll('.feature-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tabId === tabId);
        });

        markerTabContent.classList.toggle('active', tabId === 'marker');
        labelTabContent.classList.toggle('active', tabId === 'label');
    });

    panel.appendChild(tabsContainer);
}

// ============================================================================
// PRIVATE: MARCADOR TAB
// ============================================================================

/**
 * Builds the Marcador (marker style) tab content.
 */
function _buildMarkerTab(container, selectedFeatures, feature, pointControl) {
    // Color/border controls do not apply to custom (uploaded) icons, which are
    // rendered as-is. Keep refs so the picker can hide them for custom markers.
    const colorOnlyControls = [];

    // Marker symbol picker
    container.appendChild(createMarkerSymbolPicker({
        value: feature.properties.markerSymbol || 'circle',
        onChange: (symbolId) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'markerSymbol', symbolId);
            setColorControlsVisible(!parseCustomMarker(symbolId));
        }
    }));

    // Fill color picker
    const fillPicker = createModernColorPicker({
        label: 'Cor',
        value: feature.properties.fillColor,
        onChange: (color) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
        }
    });
    container.appendChild(fillPicker);
    colorOnlyControls.push(fillPicker);

    // Border color picker
    const borderPicker = createModernColorPicker({
        label: 'Borda',
        value: feature.properties.lineColor || '#000000',
        onChange: (color) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
        }
    });
    container.appendChild(borderPicker);
    colorOnlyControls.push(borderPicker);

    // Border width slider
    const borderWidthSlider = createModernSlider({
        label: 'Espessura da Borda',
        min: 0,
        max: 5,
        step: 1,
        value: feature.properties.lineWidth ?? 0,
        unit: 'px',
        onChange: (value) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
        }
    });
    container.appendChild(borderWidthSlider);
    colorOnlyControls.push(borderWidthSlider);

    function setColorControlsVisible(visible) {
        colorOnlyControls.forEach((el) => { el.style.display = visible ? '' : 'none'; });
    }

    // Hide color/border for custom icons on initial render
    setColorControlsVisible(!parseCustomMarker(feature.properties.markerSymbol));

    // Size slider
    container.appendChild(createModernSlider({
        label: 'Tamanho',
        min: 6,
        max: 50,
        step: 1,
        value: feature.properties.size || 10,
        unit: 'px',
        onChange: (newValue) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    }));

    // Size zoom correction toggle
    container.appendChild(createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.sizeZoomCorrectionEnabled !== false,
        onChange: (enabled) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'sizeZoomCorrectionEnabled', enabled);
            sizeZoomSlider.style.display = enabled ? '' : 'none';
        }
    }));

    // Size reference zoom slider
    const sizeZoomSlider = createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round((feature.properties.sizeCreatedAtZoom || 0) * 10) / 10,
        unit: '',
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            pointControl.updateFeaturesProperty(selectedFeatures, 'sizeCreatedAtZoom', roundedValue);
        }
    });

    if (feature.properties.sizeZoomCorrectionEnabled === false) {
        sizeZoomSlider.style.display = 'none';
    }

    container.appendChild(sizeZoomSlider);

    // Opacity slider
    container.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 1) * 100),
        unit: '%',
        onChange: (value) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));
}

// ============================================================================
// PRIVATE: ETIQUETA TAB
// ============================================================================

/**
 * Builds the Etiqueta (label) tab content following the 3D marker pattern.
 */
function _buildLabelTab(container, selectedFeatures, feature, pointControl) {
    // Show label toggle
    const showLabelToggle = createModernToggle({
        label: 'Mostrar Etiqueta',
        checked: feature.properties.showLabel === true,
        onChange: (checked) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'showLabel', checked);
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
            pointControl.updateFeaturesProperty(selectedFeatures, 'labelText', text);
        }
    });
    // Single-line style
    const textarea = textField.getTextarea();
    textarea.classList.add('attr-modern-textarea-input--single-line');
    container.appendChild(textField);

    // Fill with coordinates button
    const coordBtn = _buildCoordinateButton(feature, selectedFeatures, pointControl, textarea);
    container.appendChild(coordBtn);

    container.appendChild(createSectionDivider('Estilo do Texto'));

    // Label color
    const labelColorPicker = createModernColorPicker({
        label: 'Cor do Texto',
        value: feature.properties.labelColor || '#ffffff',
        onChange: (color) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'labelColor', color);
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
            pointControl.updateFeaturesProperty(selectedFeatures, 'labelSize', value);
        }
    });
    container.appendChild(labelSizeSlider);

    // Zoom correction toggle
    const zoomCorrectionToggle = createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.labelZoomCorrectionEnabled !== false,
        onChange: (enabled) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'labelZoomCorrectionEnabled', enabled);
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
            pointControl.updateFeaturesProperty(selectedFeatures, 'labelCreatedAtZoom', roundedValue);
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
            pointControl.updateFeaturesProperty(selectedFeatures, 'labelOutlineColor', color);
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
            pointControl.updateFeaturesProperty(selectedFeatures, 'labelOutlineWidth', value);
        }
    });
    container.appendChild(outlineWidthSlider);

    // Store control references for toggling
    const controlElements = [textField, coordBtn, labelColorPicker, labelSizeSlider, zoomCorrectionToggle, zoomSlider, outlineColorPicker, outlineWidthSlider];

    function toggleLabelControls(enabled) {
        controlElements.forEach(el => {
            const inputs = el.querySelectorAll('input, button, textarea');
            inputs.forEach(input => {
                input.disabled = !enabled;
            });
            el.style.opacity = enabled ? '1' : '0.5';
            el.style.pointerEvents = enabled ? 'auto' : 'none';
        });
    }

    // Initialize state
    toggleLabelControls(feature.properties.showLabel === true);
}

// ============================================================================
// PRIVATE: COORDINATE BUTTON
// ============================================================================

/**
 * Builds a button that fills the label text with the point's coordinates.
 */
function _buildCoordinateButton(feature, selectedFeatures, pointControl, textarea) {
    const wrapper = document.createElement('div');
    wrapper.className = 'point-label-coord-btn-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'attr-modern-btn attr-modern-btn-secondary';
    btn.innerHTML = `${ICONS.LOCATION}<span>Preencher com coordenadas</span>`;

    btn.addEventListener('click', async () => {
        const coords = feature.geometry?.coordinates;
        if (!coords || coords.length < 2) return;

        const [lng, lat] = coords;
        const text = await formatCoordinates(lat, lng, 'latlong');

        // Update the textarea visually and persist the property
        textarea.value = text;
        pointControl.updateFeaturesProperty(selectedFeatures, 'labelText', text);
    });

    wrapper.appendChild(btn);
    return wrapper;
}
