// Path: js/sidebar/panels/feature-panel-content.js

/**
 * @fileoverview Feature panel content creation for selected features.
 * Builds the feature panel UI with identification, gallery, tabs, location, and delete sections.
 *
 * @module sidebar/panels/feature-panel-content
 */

import { showConfirm } from '@modals/index.js';
import { createFeatureIdentification, createMultiSelectionHeader } from '../components/feature-identification.js';
import { createPhotoGallery } from '../components/feature-photo-gallery.js';
import { createFeatureTabs } from '../components/feature-tabs.js';
import { createLocationSection } from '../components/feature-location-section.js';
import { createGroupTypeSelector } from '../components/group-type-selector.js';
import { createMultiSelectionActions } from '../components/multi-selection-actions.js';
import { isCurrentMapLockedSync, startBatchUndo, commitBatchUndo, discardBatchUndo, getControl } from '@store/index.js';
import { renderReadOnlyAttributesSection } from '@js/user_data/attributes_tab_renderer.js';
import { createTemporalAttributesSection, createTrajectorySection, createTemporalReadonlySection, releaseTemporalSection } from '@js/temporal/temporal-attributes-section.js';
import { COORDINATE_FORMATS, formatCoordinates } from '@utils/index.js';
import { createModernSelect, createObservationsSection } from '@tools/helpers/index.js';
import {
    calculateSegmentDistance,
    getBearing,
    formatDistanceAuto,
    calculateLineLength
} from '@js/measurement_tool/measurement-geometry.js';
import { calculateMagneticDeclination } from '@utils/geomagnetic/wmm_calculator.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Feature type display names in Portuguese.
 * @constant {Object<string, string>}
 */
const FEATURE_TYPE_NAMES = {
    'point': 'Ponto',
    'line': 'Linha',
    'polygon': 'Polígono',
    'circle': 'Círculo',
    'ellipse': 'Elipse',
    'rectangle': 'Retângulo',
    'text': 'Texto',
    'image': 'Imagem',
    'brush': 'Pincel',
    'arrow': 'Seta',
    'boundary': 'Limite',
    'occupied_front': 'Frente Ocupada',
    'barrier_line': 'Linha de Barreiras',
    'military_symbol': 'Símbolo Militar',
    'coordination_measure': 'Medida de Coordenação',
    'magnetic_declination': 'Declinação Magnética',
    'los': 'Linha de Visada',
    'visibility': 'Visibilidade',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets a display name for the feature type.
 *
 * @param {string} featureType - Feature type
 * @returns {string} Display name in Portuguese
 */
export function getFeatureTypeName(featureType) {
    return FEATURE_TYPE_NAMES[featureType] || 'Feição';
}

/**
 * Creates the delete section with delete button.
 *
 * @param {Object} options - Options
 * @param {boolean} options.isSingleSelection - Whether single feature is selected
 * @param {number} options.featureCount - Number of selected features
 * @param {Object} options.selectionManager - Selection manager instance
 * @returns {HTMLElement} Delete section element
 */
function createDeleteSection({ isSingleSelection, featureCount, selectionManager }) {
    const deleteSection = document.createElement('div');
    deleteSection.className = 'feature-panel-delete-section';

    const deleteButton = document.createElement('button');
    deleteButton.className = 'feature-panel-delete-btn';
    const deleteLabel = isSingleSelection ? 'Deletar' : `Deletar ${featureCount} feições`;
    deleteButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        ${deleteLabel}
    `;

    const confirmTitle = isSingleSelection
        ? 'Deletar esta feição?'
        : `Deletar ${featureCount} feições?`;

    deleteButton.onclick = async () => {
        const confirmed = await showConfirm(confirmTitle, { destructive: true });
        if (confirmed) {
            await selectionManager?.deleteSelectedFeatures();
        }
    };

    deleteSection.appendChild(deleteButton);
    return deleteSection;
}

/**
 * Creates global save/discard buttons for mixed type editing.
 *
 * @param {Object} options - Options
 * @param {Map} options.editedTypesState - State map for edited types
 * @param {Object} options.selectionManager - Selection manager instance
 * @returns {HTMLElement} Buttons container element
 */
function createGlobalButtons({ editedTypesState, selectionManager }) {
    const saveAllEditedTypes = async () => {
        // Batch all saves so they produce a single undo entry
        const needsBatch = editedTypesState.size > 1;
        if (needsBatch) startBatchUndo();
        try {
            for (const [_type, state] of editedTypesState) {
                const { control, features, initialPropertiesMap } = state;
                if (control && typeof control.saveFeatures === 'function') {
                    await control.saveFeatures(features, initialPropertiesMap);
                }
            }
            if (needsBatch) commitBatchUndo();
        } catch (error) {
            if (needsBatch) discardBatchUndo();
            console.error('Error during batch save:', error);
        }
    };

    const discardAllEditedTypes = async () => {
        for (const [_type, state] of editedTypesState) {
            const { control, features, initialPropertiesMap } = state;
            if (control && typeof control.discardChangeFeatures === 'function') {
                await control.discardChangeFeatures(features, initialPropertiesMap);
            }
        }
    };

    const globalButtonsContainer = document.createElement('div');
    globalButtonsContainer.className = 'group-type-global-buttons';

    const globalButtonsRow = document.createElement('div');
    globalButtonsRow.className = 'attr-modern-buttons-row';

    const globalSaveButton = document.createElement('button');
    globalSaveButton.textContent = 'Salvar';
    globalSaveButton.className = 'group-type-btn-save';
    globalSaveButton.type = 'button';
    globalSaveButton.addEventListener('click', async () => {
        await saveAllEditedTypes();
        // skipSave: saveAllEditedTypes() already persisted — avoid double undo entry
        selectionManager?.deselectAllFeatures({ skipSave: true });
    });
    globalButtonsRow.appendChild(globalSaveButton);

    const globalDiscardButton = document.createElement('button');
    globalDiscardButton.textContent = 'Descartar';
    globalDiscardButton.className = 'group-type-btn-discard';
    globalDiscardButton.type = 'button';
    globalDiscardButton.addEventListener('click', async () => {
        await discardAllEditedTypes();
        // skipSave: discard reverted changes — nothing to save
        selectionManager?.deselectAllFeatures({ skipSave: true });
    });
    globalButtonsRow.appendChild(globalDiscardButton);

    globalButtonsContainer.appendChild(globalButtonsRow);

    return {
        element: globalButtonsContainer,
        saveAll: saveAllEditedTypes
    };
}

// ============================================================================
// AZIMUTES TAB CONTENT
// ============================================================================

/**
 * Normalizes a bearing (-180 to 180) to an azimuth (0 to 360).
 * @param {number} bearing - Bearing in degrees
 * @returns {number} Azimuth in degrees (0-360)
 */
function normalizeAzimuth(bearing) {
    return bearing < 0 ? bearing + 360 : bearing;
}

/**
 * Copies text to clipboard with a brief "Copiado!" visual feedback on the target element.
 * @param {string} text - Text to copy
 * @param {HTMLElement} el - Element to show feedback on (textContent temporarily replaced)
 */
async function copyCoordToClipboard(text, el) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    if (el) {
        const originalText = el.textContent;
        el.textContent = 'Copiado!';
        el.classList.add('azimutes-tab__coord-copied');
        setTimeout(() => {
            el.textContent = originalText;
            el.classList.remove('azimutes-tab__coord-copied');
        }, 1500);
    }
}


// Copy icon SVG shared by vertex table and azimutes tab
const COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

/**
 * Builds a vertex coordinates table with copy buttons.
 * Shared by the azimutes tab (lines/polygons) and the coordinates tab (rectangles/arrows).
 *
 * @param {Array<Array<number>>} coords - Array of [lng, lat] vertex coordinates
 * @param {string} initialFormat - Initial coordinate format ID
 * @returns {{ element: HTMLElement, updateFormat: Function }}
 */
function buildVertexTable(coords, initialFormat) {
    let currentFormat = initialFormat;

    const wrapper = document.createElement('div');
    wrapper.className = 'coords-table';

    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'azimutes-tab__section-label';
    sectionLabel.textContent = 'Coordenadas dos Vértices';
    wrapper.appendChild(sectionLabel);

    // Header
    const header = document.createElement('div');
    header.className = 'coords-table__header';
    const hNum = document.createElement('span');
    hNum.textContent = '#';
    const hCoord = document.createElement('span');
    hCoord.textContent = 'Coordenada';
    const hAction = document.createElement('span');
    header.appendChild(hNum);
    header.appendChild(hCoord);
    header.appendChild(hAction);
    wrapper.appendChild(header);

    // Scrollable body
    const body = document.createElement('div');
    body.className = 'coords-table__body';
    wrapper.appendChild(body);

    // Build rows once, store value cells for efficient format updates
    const valueCells = [];
    for (let i = 0; i < coords.length; i++) {
        const [lng, lat] = coords[i];
        let formatted;
        try {
            formatted = formatCoordinates(lat, lng, currentFormat);
        } catch {
            formatted = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }

        const row = document.createElement('div');
        row.className = 'coords-table__row';

        const numCell = document.createElement('span');
        numCell.className = 'coords-table__num';
        numCell.textContent = `${i + 1}`;

        const valueCell = document.createElement('span');
        valueCell.className = 'coords-table__value';
        valueCell.textContent = formatted;
        valueCells.push(valueCell);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'coords-table__copy-btn';
        copyBtn.title = 'Copiar coordenada';
        copyBtn.innerHTML = COPY_ICON_SVG;
        copyBtn.addEventListener('click', () => {
            copyCoordToClipboard(valueCell.textContent, valueCell);
        });

        row.appendChild(numCell);
        row.appendChild(valueCell);
        row.appendChild(copyBtn);
        body.appendChild(row);
    }

    return {
        element: wrapper,
        updateFormat(formatId) {
            currentFormat = formatId;
            for (let i = 0; i < coords.length; i++) {
                const [lng, lat] = coords[i];
                try {
                    valueCells[i].textContent = formatCoordinates(lat, lng, currentFormat);
                } catch {
                    valueCells[i].textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                }
            }
        }
    };
}

/**
 * Builds the read-only azimutes tab content showing vertex coordinates,
 * per-leg azimuth/distance, and total distance.
 * Includes:
 *  - Vertex coordinates table with copy buttons
 *  - Optional magnetic declination correction (NM/NV toggle + auto WMM2025)
 *
 * @param {HTMLElement} container - Tab content container
 * @param {Object} feature - Selected line feature (GeoJSON)
 */
function buildAzimutesTabContent(container, feature) {
    const coords = feature.geometry?.coordinates;

    // Edge case: line with insufficient vertices
    if (!coords || coords.length < 2) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'azimutes-tab__empty';
        emptyMsg.textContent = 'A linha precisa de pelo menos 2 vértices para calcular azimutes.';
        container.appendChild(emptyMsg);
        return;
    }

    // ── State ────────────────────────────────────────────────────────────────
    let currentFormat = 'latlong';
    let useMagnetic = false;          // NM toggle
    let declination = 0;             // magnetic declination in degrees
    let autoDeclinationValue = null; // last WMM-calculated value

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Returns azimuth with magnetic correction if NM is active */
    function applyDeclination(trueBearing) {
        if (!useMagnetic) return trueBearing;
        // Compass bearing  = true azimuth − declination
        // (E decl > 0, W decl < 0 – same convention as WMM output)
        return normalizeAzimuth(trueBearing - declination);
    }

    // ── Vertex coordinates table ────────────────────────────────────────────
    const vertexTable = buildVertexTable(coords, currentFormat);

    // ── Legs body (built / rebuilt when declination changes) ─────────────────
    const legsBody = document.createElement('div');
    legsBody.className = 'azimutes-tab__legs-body';

    function buildLegsBody() {
        legsBody.innerHTML = '';
        for (let i = 0; i < coords.length - 1; i++) {
            const bearing = getBearing(coords[i], coords[i + 1]);
            const azimuth = applyDeclination(normalizeAzimuth(bearing));
            const distance = calculateSegmentDistance(coords[i], coords[i + 1]);

            const row = document.createElement('div');
            row.className = 'azimutes-tab__leg-row';

            const numCell = document.createElement('span');
            numCell.className = 'azimutes-tab__leg-num';
            numCell.textContent = `${i + 1}`;

            const azCell = document.createElement('span');
            azCell.className = 'azimutes-tab__leg-az';
            azCell.textContent = `${azimuth.toFixed(2)}°`;

            const distCell = document.createElement('span');
            distCell.className = 'azimutes-tab__leg-dist';
            distCell.textContent = formatDistanceAuto(distance);

            row.appendChild(numCell);
            row.appendChild(azCell);
            row.appendChild(distCell);
            legsBody.appendChild(row);
        }
    }

    // ── Declination status line ───────────────────────────────────────────────
    const declStatus = document.createElement('div');
    declStatus.className = 'azimutes-tab__decl-status';

    function updateDeclStatus() {
        if (!useMagnetic) {
            declStatus.textContent = '';
            return;
        }
        const sign = declination > 0 ? '+' : '';
        const autoTip = autoDeclinationValue != null
            ? ` (auto WMM2025: ${autoDeclinationValue > 0 ? '+' : ''}${autoDeclinationValue.toFixed(2)}°)`
            : '';
        declStatus.textContent = `▸ Correção magnética ativa: ${sign}${declination.toFixed(2)}°${autoTip}`;
    }

    // ── 1. Coordinate format selector ────────────────────────────────────────
    const formatSelect = createModernSelect({
        label: 'Formato de Coordenadas',
        value: currentFormat,
        options: COORDINATE_FORMATS.map(f => ({ value: f.id, label: f.label })),
        onChange: (formatId) => {
            currentFormat = formatId;
            vertexTable.updateFormat(formatId);
        }
    });
    container.appendChild(formatSelect);

    // ── 2. Vertex coordinates table ──────────────────────────────────────────
    container.appendChild(vertexTable.element);

    // ── 3. Magnetic Declination section ──────────────────────────────────────
    const declSection = document.createElement('div');
    declSection.className = 'azimutes-tab__decl-section';

    const declHeaderRow = document.createElement('div');
    declHeaderRow.className = 'azimutes-tab__decl-header';

    const declTitleLabel = document.createElement('div');
    declTitleLabel.className = 'azimutes-tab__section-label';
    declTitleLabel.textContent = 'Declinação Magnética';
    declHeaderRow.appendChild(declTitleLabel);

    // NM / NV toggle buttons
    const northToggle = document.createElement('div');
    northToggle.className = 'azimutes-tab__north-toggle';

    const nmBtn = document.createElement('button');
    nmBtn.type = 'button';
    nmBtn.className = 'azimutes-tab__north-btn azimutes-tab__north-btn--nm';
    nmBtn.title = 'Norte Magnético (aplicar declinação)';
    nmBtn.textContent = 'NM';

    const nvBtn = document.createElement('button');
    nvBtn.type = 'button';
    nvBtn.className = 'azimutes-tab__north-btn azimutes-tab__north-btn--nv active';
    nvBtn.title = 'Norte Verdadeiro (sem correção)';
    nvBtn.textContent = 'NV';

    northToggle.appendChild(nmBtn);
    northToggle.appendChild(nvBtn);
    declHeaderRow.appendChild(northToggle);
    declSection.appendChild(declHeaderRow);

    // Declination input row (visible only when NM is active)
    const declInputRow = document.createElement('div');
    declInputRow.className = 'azimutes-tab__decl-input-row azimutes-tab__decl-input-row--hidden';

    const declLabel2 = document.createElement('span');
    declLabel2.className = 'azimutes-tab__decl-label';
    declLabel2.textContent = 'Decl:';
    declInputRow.appendChild(declLabel2);

    const declInput = document.createElement('input');
    declInput.type = 'number';
    declInput.className = 'azimutes-tab__decl-input';
    declInput.value = 0;
    declInput.step = '0.5';
    declInput.title = 'Oeste (−) / Leste (+) em graus';
    declInputRow.appendChild(declInput);

    const declUnit = document.createElement('span');
    declUnit.className = 'azimutes-tab__decl-unit';
    declUnit.textContent = '°';
    declInputRow.appendChild(declUnit);

    // Auto-calculate button (WMM2025)
    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'azimutes-tab__auto-decl-btn';
    autoBtn.title = 'Calcular declinação automática pelo modelo WMM2025';
    autoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`;
    declInputRow.appendChild(autoBtn);

    declSection.appendChild(declInputRow);
    declSection.appendChild(declStatus);
    container.appendChild(declSection);

    // ── Declination interaction ───────────────────────────────────────────────

    function setMagnetic(active) {
        useMagnetic = active;
        nmBtn.classList.toggle('active', active);
        nvBtn.classList.toggle('active', !active);
        declInputRow.classList.toggle('azimutes-tab__decl-input-row--hidden', !active);
        declSection.classList.toggle('azimutes-tab__decl-section--active', active && declination !== 0);
        buildLegsBody();
        updateDeclStatus();
    }

    nmBtn.addEventListener('click', () => setMagnetic(true));
    nvBtn.addEventListener('click', () => setMagnetic(false));

    declInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            declination = Math.max(-45, Math.min(45, val));
            declSection.classList.toggle('azimutes-tab__decl-section--active', useMagnetic && declination !== 0);
            buildLegsBody();
            updateDeclStatus();
        }
    });

    autoBtn.addEventListener('click', async () => {
        const [lng, lat] = coords[0];
        try {
            autoBtn.disabled = true;
            autoBtn.style.opacity = '0.5';
            const result = calculateMagneticDeclination(lat, lng);
            if (!result) throw new Error('Coordenadas inválidas para WMM');
            autoDeclinationValue = result.declination; // already a number
            declination = autoDeclinationValue;
            declInput.value = declination;
            declSection.classList.toggle('azimutes-tab__decl-section--active', useMagnetic && declination !== 0);
            buildLegsBody();
            updateDeclStatus();
        } catch (err) {
            console.warn('[AzimutesTab] WMM calculation failed:', err);
        } finally {
            autoBtn.disabled = false;
            autoBtn.style.opacity = '';
        }
    });

    // ── 4. Legs table ─────────────────────────────────────────────────────────
    const legsContainer = document.createElement('div');
    legsContainer.className = 'azimutes-tab__legs';

    // Header row
    const headerRow = document.createElement('div');
    headerRow.className = 'azimutes-tab__legs-header';

    const headerNum = document.createElement('span');
    headerNum.textContent = 'Perna';
    const headerAz = document.createElement('span');
    headerAz.textContent = 'Azimute';
    const headerDist = document.createElement('span');
    headerDist.textContent = 'Distância';

    headerRow.appendChild(headerNum);
    headerRow.appendChild(headerAz);
    headerRow.appendChild(headerDist);
    legsContainer.appendChild(headerRow);

    buildLegsBody();
    legsContainer.appendChild(legsBody);
    container.appendChild(legsContainer);

    // ── 5. Total distance ─────────────────────────────────────────────────────
    const totalContainer = document.createElement('div');
    totalContainer.className = 'azimutes-tab__total';

    const totalLabel = document.createElement('span');
    totalLabel.className = 'azimutes-tab__total-label';
    totalLabel.textContent = 'Distância Total';

    const totalValue = document.createElement('span');
    totalValue.className = 'azimutes-tab__total-value';
    totalValue.textContent = formatDistanceAuto(calculateLineLength(coords));

    totalContainer.appendChild(totalLabel);
    totalContainer.appendChild(totalValue);
    container.appendChild(totalContainer);
}

// ============================================================================
// COORDINATES TAB CONTENT (rectangles, arrows)
// ============================================================================

/**
 * Extracts vertex coordinates for the coordinates tab based on feature type.
 * @param {Object} feature - GeoJSON feature
 * @param {string} featureType - Feature type identifier
 * @returns {Array<Array<number>>|null} Array of [lng, lat] or null
 */
function extractVertexCoords(feature, featureType) {
    if (featureType === 'rectangle') {
        const ring = feature.geometry?.coordinates?.[0];
        if (!ring || ring.length < 4) return null;
        // Remove closing point (last = first)
        return ring.slice(0, -1);
    }
    if (featureType === 'arrow') {
        const baseCoords = feature.properties?.baseCoordinates;
        if (Array.isArray(baseCoords) && baseCoords.length >= 2) return baseCoords;
        return null;
    }
    return null;
}

/**
 * Builds the coordinates tab content for rectangles and arrows.
 * Shows a vertex coordinates table with format selector and copy buttons.
 *
 * @param {HTMLElement} container - Tab content container
 * @param {Object} feature - Selected feature (GeoJSON)
 * @param {string} featureType - Feature type ('rectangle' or 'arrow')
 */
function buildCoordinatesTabContent(container, feature, featureType) {
    const isMerged = featureType === 'arrow' && feature.properties?.isMerged && Array.isArray(feature.properties?.branches);

    // Collect all vertex tables to update on format change
    const tables = [];
    let currentFormat = 'latlong';

    // Format selector
    const formatSelect = createModernSelect({
        label: 'Formato de Coordenadas',
        value: currentFormat,
        options: COORDINATE_FORMATS.map(f => ({ value: f.id, label: f.label })),
        onChange: (formatId) => {
            currentFormat = formatId;
            tables.forEach(t => t.updateFormat(formatId));
        }
    });
    container.appendChild(formatSelect);

    if (isMerged) {
        // Merged arrows: show per-branch vertex tables
        const branches = feature.properties.branches;
        branches.forEach((branch, idx) => {
            const branchCoords = branch.baseCoordinates;
            if (!Array.isArray(branchCoords) || branchCoords.length < 2) return;

            const branchLabel = document.createElement('div');
            branchLabel.className = 'azimutes-tab__section-label coords-table__branch-label';
            branchLabel.textContent = `Ramo ${idx + 1}`;
            container.appendChild(branchLabel);

            const table = buildVertexTable(branchCoords, currentFormat);
            tables.push(table);
            container.appendChild(table.element);
        });
    } else {
        const coords = extractVertexCoords(feature, featureType);
        if (!coords) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'azimutes-tab__empty';
            emptyMsg.textContent = 'Sem vértices suficientes para exibir coordenadas.';
            container.appendChild(emptyMsg);
            return;
        }

        const table = buildVertexTable(coords, currentFormat);
        tables.push(table);
        container.appendChild(table.element);
    }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Creates feature panel content for selected features.
 * Uses component-based structure:
 * - Identification section
 * - Photo gallery
 * - Tabs (Estilo / Atributos)
 * - Location section
 * - Delete button
 *
 * @param {Object} options - Options
 * @param {Array<Object>} options.selectedFeatures - Selected features
 * @param {string} options.featureType - Feature type
 * @param {Object} options.selectionManager - Selection manager instance
 * @param {Object} options.uiManager - UI manager instance
 * @param {Object} [options.map] - MapLibre map instance (for location section)
 * @param {string} [options.activeTab] - Previously active tab ID to restore after rebuild
 * @returns {Promise<{ element: HTMLElement, cleanup: Function } | null>}
 */
export async function createFeaturePanelContent({
    selectedFeatures,
    featureType,
    selectionManager,
    uiManager,
    map,
    activeTab
}) {
    if (!selectedFeatures || selectedFeatures.length === 0) return null;

    const control = selectionManager?.controls.get(featureType);
    const feature = selectedFeatures[0];
    const featureId = feature?.properties?.id;
    const isSingleSelection = selectedFeatures.length === 1;

    // Check if all selected features are the same type
    const types = new Set(selectedFeatures.map(f => f.properties?.source));
    const isMixedTypes = types.size > 1;

    // Main container
    const mapLocked = isCurrentMapLockedSync();
    const container = document.createElement('div');
    container.className = 'feature-panel-sections';
    if (mapLocked) {
        container.classList.add('feature-panel--locked');
    }

    // Array to store cleanup functions
    const cleanupFunctions = [];

    // 1. Identification section
    let identificationSection;
    if (isSingleSelection) {
        if (!control) {
            console.warn(`Control not found for type: ${featureType}`);
            return null;
        }
        identificationSection = await createFeatureIdentification({
            feature,
            featureType,
            selectedFeatures,
            selectionManager,
            uiManager,
            onNameChange: (newName) => {
                control.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager?.updateSelectionHighlight();
            },
            onDescriptionChange: (newDescription) => {
                control.updateFeaturesProperty(selectedFeatures, 'descricao', newDescription);
            }
        });
    } else {
        identificationSection = createMultiSelectionHeader({
            selectedFeatures,
            featureType,
            selectionManager,
            uiManager
        });
    }
    container.appendChild(identificationSection);

    // 1b. Multi-selection action buttons (lock/hide) — only for multi-selection when map not locked
    if (!isSingleSelection && !mapLocked) {
        const actionsSection = createMultiSelectionActions({
            selectedFeatures,
            selectionManager,
            uiManager
        });
        container.appendChild(actionsSection);
    }

    // 2. Photo gallery (only for single selection)
    if (isSingleSelection) {
        const photoGallery = await createPhotoGallery({
            featureId,
            featureType,
            compact: true
        });
        container.appendChild(photoGallery.element);
        cleanupFunctions.push(photoGallery.cleanup);
    }

    // When map is locked: skip tabs/style/parameters, show read-only attributes directly
    if (mapLocked) {
        // Read-only attributes section (only if attributes exist)
        if (isSingleSelection) {
            const readOnlyAttrsContainer = document.createElement('div');
            readOnlyAttrsContainer.className = 'feature-readonly-attributes-section';
            await renderReadOnlyAttributesSection(readOnlyAttrsContainer, featureId, featureType);
            container.appendChild(readOnlyAttrsContainer);

            // Read-only temporal summary (validity window + trajectory), only when
            // the feature actually carries temporal data.
            const temporalReadonly = createTemporalReadonlySection({ feature });
            if (temporalReadonly) {
                container.appendChild(temporalReadonly);
                cleanupFunctions.push(() => releaseTemporalSection(temporalReadonly));
            }
        }

        // For mixed types in locked mode: show read-only type summary
        if (!isSingleSelection && isMixedTypes) {
            const typeSelector = createGroupTypeSelector({
                selectedFeatures,
                readOnly: true,
                onTypeSelect: () => { }
            });
            container.appendChild(typeSelector.element);
            cleanupFunctions.push(typeSelector.cleanup);
        }
    } else {
        // 3. Info section before tabs (for LOS and similar analysis tools)
        if (isSingleSelection && control && typeof control.createInfoSection === 'function') {
            try {
                const infoSection = control.createInfoSection(selectedFeatures[0]);
                if (infoSection) {
                    container.appendChild(infoSection);
                }
            } catch (error) {
                console.error(`Error creating info section for ${featureType}:`, error);
            }
        }

        // 4. Tabs (Estilo / Parâmetros / Atributos) - only show for single selection or multiple same-type
        // For mixed types, show group type selector to edit by type
        if (!isMixedTypes) {
            const featureTabs = createFeatureTabs({
                featureId,
                featureType,
                singleSelection: isSingleSelection,
                activeTab
            });
            container.appendChild(featureTabs.container);
            cleanupFunctions.push(featureTabs.cleanup);

            // Inject tool-specific style controls into the Style tab
            if (control && control.hasAttributePanel && control.hasAttributePanel()) {
                try {
                    control.createAttributePanel(
                        featureTabs.styleTab,
                        selectedFeatures,
                        selectionManager,
                        uiManager,
                        { hideHeader: true }
                    );
                } catch (error) {
                    console.error(`Error creating attribute panel for ${featureType}:`, error);
                }
            }

            // Inject parameters controls into Parameters tab (for LOS and similar tools)
            if (featureTabs.parametersTab && control && typeof control.createParametersPanel === 'function') {
                try {
                    control.createParametersPanel(
                        featureTabs.parametersTab,
                        selectedFeatures,
                        selectionManager,
                        uiManager
                    );
                    // Register cleanup for terrain listener attached by parameters panel
                    if (featureTabs.parametersTab._parametersCleanup) {
                        cleanupFunctions.push(featureTabs.parametersTab._parametersCleanup);
                    }
                } catch (error) {
                    console.error(`Error creating parameters panel for ${featureType}:`, error);
                }
            }

            // Inject azimutes content into Azimutes tab (for line/polygon features, single selection only)
            if (featureTabs.azimutesTab && isSingleSelection) {
                try {
                    const azFeature = selectedFeatures[0];
                    if (featureType === 'polygon') {
                        // Polygon coords are [[[lng,lat],...]], extract outer ring as line-like coords
                        const ring = azFeature.geometry?.coordinates?.[0];
                        if (ring) {
                            const syntheticFeature = {
                                ...azFeature,
                                geometry: { type: 'LineString', coordinates: ring }
                            };
                            buildAzimutesTabContent(featureTabs.azimutesTab, syntheticFeature);
                        }
                    } else {
                        buildAzimutesTabContent(featureTabs.azimutesTab, azFeature);
                    }

                    // Per-segment observations + QAN export (inside azimutes tab)
                    if (control) {
                        const obsSection = createObservationsSection({
                            feature: azFeature,
                            selectedFeatures,
                            control,
                        });
                        featureTabs.azimutesTab.appendChild(obsSection);
                    }
                } catch (error) {
                    console.error(`Error creating azimutes tab for ${featureType}:`, error);
                }
            }

            // Inject coordinates content into Coordinates tab (for rectangle/arrow, single selection only)
            if (featureTabs.coordinatesTab && isSingleSelection) {
                try {
                    buildCoordinatesTabContent(featureTabs.coordinatesTab, selectedFeatures[0], featureType);
                } catch (error) {
                    console.error(`Error creating coordinates tab for ${featureType}:`, error);
                }
            }
        } else {
            // Mixed types: show group type selector
            const typeTabsContainer = document.createElement('div');
            typeTabsContainer.className = 'group-type-tabs-container';

            // Track state for each type that was edited
            const editedTypesState = new Map();

            const typeSelector = createGroupTypeSelector({
                selectedFeatures,
                onTypeSelect: (selectedType, featuresOfType) => {
                    // Clear previous tabs content
                    typeTabsContainer.innerHTML = '';

                    // Get control for this type
                    const typeControl = selectionManager?.controls.get(selectedType);

                    // Store initial properties for this type if not already stored
                    if (!editedTypesState.has(selectedType)) {
                        editedTypesState.set(selectedType, {
                            control: typeControl,
                            features: featuresOfType,
                            initialPropertiesMap: new Map(
                                featuresOfType.map(f => [f.properties.id, { ...f.properties }])
                            )
                        });
                    }

                    // Create tabs for this type (multi-selection mode)
                    const typeTabs = createFeatureTabs({
                        featureId: featuresOfType[0]?.properties?.id,
                        featureType: selectedType,
                        singleSelection: false
                    });
                    typeTabsContainer.appendChild(typeTabs.container);

                    // Inject style controls for this type (hide buttons, we'll add global ones)
                    if (typeControl && typeControl.hasAttributePanel && typeControl.hasAttributePanel()) {
                        try {
                            typeControl.createAttributePanel(
                                typeTabs.styleTab,
                                featuresOfType,
                                selectionManager,
                                uiManager,
                                { hideHeader: true, hideButtons: true }
                            );
                        } catch (error) {
                            console.error(`Error creating attribute panel for ${selectedType}:`, error);
                        }
                    }
                }
            });

            container.appendChild(typeSelector.element);
            container.appendChild(typeTabsContainer);

            // Create global Save/Discard buttons for all types
            const globalButtons = createGlobalButtons({
                editedTypesState,
                selectionManager
            });
            container.appendChild(globalButtons.element);

            // Cleanup: save all edited types before destroying
            cleanupFunctions.push(async () => {
                await globalButtons.saveAll();
                typeSelector.cleanup();
            });
        }
    }

    // 5. Location section (only for single selection)
    if (isSingleSelection && map) {
        const locationSection = await createLocationSection({
            feature,
            featureType,
            map,
            control,
            uiManager
        });
        container.appendChild(locationSection);
    }

    // 5b. Temporal sections (single selection, editable map): validity window for
    // all types + trajectory editor for point / military_symbol / coordination_measure.
    // Clear any previously-shown trajectory first; the section re-shows it for
    // trajectory features (so selecting a non-trajectory feature hides it).
    getControl('TrajectoryEditControl')?.hide();
    if (isSingleSelection && !mapLocked) {
        const temporalSection = createTemporalAttributesSection({ feature, featureType, selectedFeatures, control });
        container.appendChild(temporalSection);
        // Release the time-context subscriptions with the panel: the sidebar runs
        // this chain on every rebuild, and a handle drop rebuilds the panel.
        cleanupFunctions.push(() => releaseTemporalSection(temporalSection));
        const trajectorySection = createTrajectorySection({ feature, featureType, map });
        if (trajectorySection) {
            container.appendChild(trajectorySection);
            cleanupFunctions.push(() => releaseTemporalSection(trajectorySection));
        }
    }

    // 6. Delete button (hidden when map locked)
    if (!mapLocked) {
        const deleteSection = createDeleteSection({
            isSingleSelection,
            featureCount: selectedFeatures.length,
            selectionManager
        });
        container.appendChild(deleteSection);
    }

    // Cleanup function
    const cleanup = async () => {
        for (const fn of cleanupFunctions) {
            try {
                await fn();
            } catch (e) {
                console.warn('Cleanup error:', e);
            }
        }
    };

    return {
        element: container,
        cleanup
    };
}
