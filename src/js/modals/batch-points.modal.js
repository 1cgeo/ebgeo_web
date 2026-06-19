// Path: js/modals/batch-points.modal.js

/**
 * @fileoverview Panel for creating multiple points from coordinate input.
 * Renders as a sidebar tool panel (like CSV import).
 * Supports Lat/Long (DD), Lat/Long (DMS), UTM, and MGRS formats.
 */

import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { showSuccess, showError, IDUtils } from '@utils/index.js';
import {
    COORDINATE_FORMATS,
    parseCoordinates,
    getPlaceholderForFormat,
} from '@utils/coordinate_converter.js';
import { addFeature, getActiveLayerIdSync, getControl } from '@store/index.js';

/**
 * Creates a batch points panel for the sidebar tool panel area.
 * Follows the same pattern as createCSVConfigPanel.
 * @param {Object} options - Panel options
 * @param {Function} [options.onSuccess] - Called after points are created successfully
 * @returns {{ element: HTMLElement, cleanup: Function }}
 */
export function createBatchPointsPanel(options = {}) {
    const { onSuccess } = options;
    const ctx = {};
    setupCleanup(ctx);

    let formatId = 'latlong';
    const rows = [];

    // =========================================================================
    // CONTAINER
    // =========================================================================

    const container = document.createElement('div');
    container.className = 'batch-points-panel';

    // =========================================================================
    // FORMAT SELECTOR
    // =========================================================================

    const formatSection = document.createElement('div');
    formatSection.className = 'batch-points-panel__format';

    const formatLabel = document.createElement('label');
    formatLabel.className = 'batch-points-panel__format-label';
    formatLabel.textContent = 'Formato de Coordenadas';
    formatSection.appendChild(formatLabel);

    const formatSelect = document.createElement('select');
    formatSelect.className = 'batch-points-panel__format-select';
    for (const fmt of COORDINATE_FORMATS) {
        const opt = document.createElement('option');
        opt.value = fmt.id;
        opt.textContent = fmt.label;
        formatSelect.appendChild(opt);
    }
    addDomListener(ctx, formatSelect, 'change', () => {
        formatId = formatSelect.value;
        updatePlaceholders();
    });
    formatSection.appendChild(formatSelect);
    container.appendChild(formatSection);

    // =========================================================================
    // ROWS
    // =========================================================================

    const rowsContainer = document.createElement('div');
    rowsContainer.className = 'batch-points-panel__rows';
    container.appendChild(rowsContainer);

    for (let i = 0; i < 3; i++) {
        addRow();
    }

    // =========================================================================
    // ADD ROW BUTTON
    // =========================================================================

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'batch-points-panel__add-btn';
    addBtn.textContent = '+ Adicionar linha';
    addDomListener(ctx, addBtn, 'click', () => addRow());
    container.appendChild(addBtn);

    // =========================================================================
    // CREATE BUTTON
    // =========================================================================

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'batch-points-panel__create-btn';
    createBtn.textContent = 'Criar Pontos';
    addDomListener(ctx, createBtn, 'click', () => handleCreate());
    container.appendChild(createBtn);

    // =========================================================================
    // HELPERS
    // =========================================================================

    function addRow() {
        const index = rows.length;
        const row = document.createElement('div');
        row.className = 'batch-points-panel__row';

        const badge = document.createElement('span');
        badge.className = 'batch-points-panel__badge';
        badge.textContent = `${index + 1}`;

        const coordInput = document.createElement('input');
        coordInput.type = 'text';
        coordInput.className = 'batch-points-panel__coord-input';
        coordInput.placeholder = getPlaceholderForFormat(formatId);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'batch-points-panel__name-input';
        nameInput.placeholder = 'Nome (opcional)';

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'batch-points-panel__remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Remover';
        addDomListener(ctx, removeBtn, 'click', () => {
            const currentIndex = rows.findIndex(r => r.row === row);
            if (currentIndex >= 0) removeRow(currentIndex);
        });

        row.appendChild(badge);
        row.appendChild(coordInput);
        row.appendChild(nameInput);
        row.appendChild(removeBtn);

        rows.push({ row, coordInput, nameInput, badge });
        rowsContainer.appendChild(row);
    }

    function removeRow(index) {
        if (rows.length <= 1) return;
        const { row } = rows[index];
        row.remove();
        rows.splice(index, 1);
        rows.forEach((r, i) => {
            r.badge.textContent = `${i + 1}`;
        });
    }

    function updatePlaceholders() {
        const placeholder = getPlaceholderForFormat(formatId);
        for (const r of rows) {
            r.coordInput.placeholder = placeholder;
        }
    }

    async function handleCreate() {
        // Same pattern as AzimuthDistanceControl._createPointFeatures
        const pointControl = getControl('AddPointControl');
        const map = pointControl?.map;

        if (!map) {
            showError('Mapa não disponível');
            return;
        }

        const defaultProps = pointControl.constructor.DEFAULT_PROPERTIES || {};
        const layerId = getActiveLayerIdSync();
        const currentZoom = map.getZoom();

        // Validate all rows first (collect valid entries before persisting)
        const validEntries = [];
        let errors = 0;

        for (const r of rows) {
            const coordText = r.coordInput.value.trim();
            if (!coordText) continue;

            const parsed = parseCoordinates(coordText, formatId);
            if (!parsed) {
                r.coordInput.classList.add('batch-points-panel__coord-input--error');
                errors++;
                continue;
            }
            r.coordInput.classList.remove('batch-points-panel__coord-input--error');
            validEntries.push({ parsed, customName: r.nameInput.value.trim() });
        }

        if (errors > 0) {
            showError(`${errors} coordenada(s) inválida(s)`);
            return;
        }

        if (validEntries.length === 0) {
            showError('Nenhuma coordenada informada');
            return;
        }

        try {
            const source = map.getSource('points');
            if (!source) {
                showError('Fonte de pontos não disponível');
                return;
            }

            const data = await source.getData();
            const created = [];

            for (const entry of validEntries) {
                const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
                const featureName = entry.customName
                    || await IDUtils.generateFeatureName('point', map);

                // Build feature with explicit properties (same as azimuth tool)
                const feature = {
                    type: 'Feature',
                    id: geoJsonId,
                    properties: {
                        ...defaultProps,
                        layerId,
                        id: featureId,
                        nome: featureName,
                        // Anchor BOTH the marker size and the label to the current zoom —
                        // size was left at the default (0) so the marker ballooned at zoom.
                        sizeCreatedAtZoom: currentZoom,
                        calculatedSize: defaultProps.size || 10,
                        labelCreatedAtZoom: currentZoom,
                        labelCalculatedSize: defaultProps.labelSize || 14,
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [entry.parsed.lng, entry.parsed.lat],
                    },
                };

                // Persist to IndexedDB (per-feature undo + operation logging)
                await addFeature('points', feature);

                // Accumulate in memory for MapLibre source update
                data.features.push(feature);
                created.push(feature);
            }

            // Flush MapLibre source update once after all features
            source.setData(data);

            const word = created.length === 1 ? 'ponto criado' : 'pontos criados';
            showSuccess(`${created.length} ${word} com sucesso`);

            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error creating batch points:', error);
            showError('Erro ao criar pontos');
        }
    }

    return {
        element: container,
        cleanup: () => cleanup(ctx),
    };
}
