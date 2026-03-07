// Path: js/import_export/csv/csv-config-panel.js

/**
 * @fileoverview Configuration panel for CSV import.
 * Shows in sidebar via showToolPanel(). User configures separator,
 * coordinate format, and column mapping before importing.
 * @dependencies csv-parser, csv-coordinate-converter, csv-to-geojson,
 *   form-controls.helpers, section-divider.helpers, event-cleanup
 */

import { parseCSVPreview, detectSeparator, CSV_SEPARATORS } from './csv-parser.js';
import {
    CSV_COORDINATE_FORMATS,
    autoDetectColumnMapping,
} from './csv-coordinate-converter.js';
import { csvToGeoJSON } from './csv-to-geojson.js';
import {
    createModernSelect,
    createSectionDivider,
} from '@tools/helpers/index.js';
import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { showWarning } from '@utils/toast_service.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const NONE_OPTION = { value: '', label: '— Selecione —' };

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Creates the CSV configuration panel.
 * @param {Object} options
 * @param {string} options.csvText - Raw CSV file content
 * @param {string} options.fileName - Original file name (without extension)
 * @param {Function} options.onImport - Callback(geoJSON, fileName) when user clicks import
 * @returns {{ element: HTMLElement, cleanup: Function }}
 */
export function createCSVConfigPanel(options) {
    const { csvText, fileName, onImport } = options;
    const cleanupContext = {};
    setupCleanup(cleanupContext);

    // ========================================================================
    // STATE
    // ========================================================================

    let currentSeparator = detectSeparator(csvText);
    let currentFormat = 'latlong_dd';
    let currentMapping = {};
    let currentFixedValues = {};
    let utmZoneSource = 'fixed'; // 'fixed' or 'column'
    let preview = parseCSVPreview(csvText, currentSeparator);

    // ========================================================================
    // CONTAINER
    // ========================================================================

    const container = document.createElement('div');
    container.className = 'csv-config-panel';

    // ========================================================================
    // SEPARATOR SECTION
    // ========================================================================

    container.appendChild(createSectionDivider('Separador'));

    const separatorSelect = createModernSelect({
        label: 'Separador de colunas',
        value: currentSeparator,
        options: CSV_SEPARATORS,
        onChange: (value) => {
            currentSeparator = value;
            preview = parseCSVPreview(csvText, currentSeparator);
            _rebuildPreview();
            _resetMapping();
            _rebuildMapping();
            _validate();
        },
    });
    container.appendChild(separatorSelect);

    // ========================================================================
    // PREVIEW SECTION
    // ========================================================================

    container.appendChild(createSectionDivider('Pré-visualização'));

    const previewContainer = document.createElement('div');
    previewContainer.className = 'csv-config-panel__preview';
    container.appendChild(previewContainer);

    const rowCountInfo = document.createElement('div');
    rowCountInfo.className = 'csv-config-panel__info-text';
    container.appendChild(rowCountInfo);

    // ========================================================================
    // COORDINATE FORMAT SECTION
    // ========================================================================

    container.appendChild(createSectionDivider('Formato de Coordenadas'));

    const formatSelect = createModernSelect({
        label: 'Formato',
        value: currentFormat,
        options: CSV_COORDINATE_FORMATS.map(f => ({ value: f.id, label: f.label })),
        onChange: (value) => {
            currentFormat = value;
            _resetMapping();
            _rebuildMapping();
            _validate();
        },
    });
    container.appendChild(formatSelect);

    // ========================================================================
    // COLUMN MAPPING SECTION
    // ========================================================================

    container.appendChild(createSectionDivider('Mapeamento de Colunas'));

    const mappingContainer = document.createElement('div');
    mappingContainer.className = 'csv-config-panel__mapping';
    container.appendChild(mappingContainer);

    const attributeInfo = document.createElement('div');
    attributeInfo.className = 'csv-config-panel__info-text';
    container.appendChild(attributeInfo);

    // ========================================================================
    // IMPORT BUTTON
    // ========================================================================

    const importBtn = document.createElement('button');
    importBtn.className = 'csv-config-panel__import-btn';
    importBtn.textContent = 'IMPORTAR';
    importBtn.disabled = true;
    container.appendChild(importBtn);

    // ========================================================================
    // RESULT AREA
    // ========================================================================

    const resultContainer = document.createElement('div');
    resultContainer.className = 'csv-config-panel__result';
    container.appendChild(resultContainer);

    // ========================================================================
    // IMPORT HANDLER
    // ========================================================================

    addDomListener(cleanupContext, importBtn, 'click', async () => {
        if (!_validate()) return;

        importBtn.disabled = true;
        importBtn.textContent = 'Importando...';
        resultContainer.className = 'csv-config-panel__result';
        resultContainer.textContent = '';

        try {
            const config = {
                csvText,
                separator: currentSeparator,
                coordinateFormat: currentFormat,
                columnMapping: { ...currentMapping },
                fixedValues: { ...currentFixedValues },
            };

            const { geoJSON, skippedCount } = csvToGeoJSON(config);

            if (skippedCount > 0) {
                const word = skippedCount === 1 ? 'linha ignorada' : 'linhas ignoradas';
                showWarning(`${skippedCount} ${word} por coordenadas inválidas`);
            }

            await onImport(geoJSON, fileName);

        } catch (error) {
            _showResult(error.message || 'Erro ao importar CSV', false);
            importBtn.disabled = false;
            importBtn.textContent = 'IMPORTAR';
        }
    });

    // ========================================================================
    // INTERNAL FUNCTIONS
    // ========================================================================

    function _rebuildPreview() {
        previewContainer.replaceChildren();

        if (preview.headers.length === 0) {
            previewContainer.textContent = 'Nenhuma coluna detectada';
            rowCountInfo.textContent = '';
            return;
        }

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'csv-config-panel__table-wrapper';

        const table = document.createElement('table');
        table.className = 'csv-config-panel__preview-table';

        // Header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (const header of preview.headers) {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Data rows
        const tbody = document.createElement('tbody');
        for (const row of preview.previewRows) {
            const tr = document.createElement('tr');
            for (let i = 0; i < preview.headers.length; i++) {
                const td = document.createElement('td');
                td.textContent = i < row.length ? row[i] : '';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        tableWrapper.appendChild(table);
        previewContainer.appendChild(tableWrapper);

        const rowWord = preview.totalRows === 1 ? 'linha' : 'linhas';
        const colWord = preview.headers.length === 1 ? 'coluna' : 'colunas';
        rowCountInfo.textContent = `${preview.totalRows} ${rowWord} de dados, ${preview.headers.length} ${colWord}`;
    }

    function _resetMapping() {
        currentMapping = {};
        currentFixedValues = {};
        utmZoneSource = 'fixed';
    }

    function _rebuildMapping() {
        mappingContainer.replaceChildren();

        const format = CSV_COORDINATE_FORMATS.find(f => f.id === currentFormat);
        if (!format) return;

        // Auto-detect column mapping
        const autoMapping = autoDetectColumnMapping(preview.headers, currentFormat);
        currentMapping = { ...autoMapping };

        const columnOptions = [
            NONE_OPTION,
            ...preview.headers.map(h => ({ value: h, label: h })),
        ];

        // Create selects for required columns
        for (const role of format.requiredColumns) {
            const label = format.columnLabels[role] || role;
            const select = createModernSelect({
                label: `Coluna: ${label}`,
                value: currentMapping[role] || '',
                options: columnOptions,
                onChange: (value) => {
                    if (value) {
                        currentMapping[role] = value;
                    } else {
                        delete currentMapping[role];
                    }
                    _updateAttributeInfo();
                    _validate();
                },
            });
            mappingContainer.appendChild(select);
        }

        // UTM zone: column or fixed value
        if (format.hasFixedZone) {
            _buildZoneSelector(columnOptions);
        }

        _updateAttributeInfo();
    }

    function _buildZoneSelector(columnOptions) {
        const zoneContainer = document.createElement('div');
        zoneContainer.className = 'csv-config-panel__zone-section';

        const zoneLabel = document.createElement('div');
        zoneLabel.className = 'csv-config-panel__zone-label';
        zoneLabel.textContent = 'Zona UTM';
        zoneContainer.appendChild(zoneLabel);

        // Radio options
        const radioGroup = document.createElement('div');
        radioGroup.className = 'csv-config-panel__zone-radios';

        // Fixed value option
        const fixedOption = _createRadioOption(
            'zone-source', 'fixed', 'Valor fixo', utmZoneSource === 'fixed'
        );
        radioGroup.appendChild(fixedOption);

        // Column option
        const columnOption = _createRadioOption(
            'zone-source', 'column', 'Coluna do CSV', utmZoneSource === 'column'
        );
        radioGroup.appendChild(columnOption);

        zoneContainer.appendChild(radioGroup);

        // Fixed zone input
        const fixedInputContainer = document.createElement('div');
        fixedInputContainer.className = 'csv-config-panel__zone-fixed';

        const fixedInput = document.createElement('input');
        fixedInput.type = 'text';
        fixedInput.className = 'csv-config-panel__zone-input';
        fixedInput.placeholder = '23S';
        fixedInput.value = currentFixedValues.zone || '';
        addDomListener(cleanupContext, fixedInput, 'input', () => {
            currentFixedValues.zone = fixedInput.value.trim();
            _validate();
        });
        fixedInputContainer.appendChild(fixedInput);

        // Column zone select
        const columnSelectContainer = document.createElement('div');
        columnSelectContainer.className = 'csv-config-panel__zone-column';

        const autoZone = autoDetectColumnMapping(preview.headers, 'utm');
        const zoneSelect = createModernSelect({
            label: '',
            value: autoZone.zone || '',
            options: columnOptions,
            onChange: (value) => {
                if (value) {
                    currentMapping.zone = value;
                } else {
                    delete currentMapping.zone;
                }
                _updateAttributeInfo();
                _validate();
            },
        });
        columnSelectContainer.appendChild(zoneSelect);

        zoneContainer.appendChild(fixedInputContainer);
        zoneContainer.appendChild(columnSelectContainer);

        // Toggle visibility based on radio
        function updateZoneVisibility() {
            if (utmZoneSource === 'fixed') {
                fixedInputContainer.classList.remove('csv-config-panel--hidden');
                columnSelectContainer.classList.add('csv-config-panel--hidden');
                delete currentMapping.zone;
            } else {
                fixedInputContainer.classList.add('csv-config-panel--hidden');
                columnSelectContainer.classList.remove('csv-config-panel--hidden');
                currentFixedValues.zone = '';
                if (autoZone.zone) {
                    currentMapping.zone = autoZone.zone;
                }
            }
            _updateAttributeInfo();
            _validate();
        }

        addDomListener(cleanupContext, fixedOption.querySelector('input'), 'change', () => {
            utmZoneSource = 'fixed';
            updateZoneVisibility();
        });
        addDomListener(cleanupContext, columnOption.querySelector('input'), 'change', () => {
            utmZoneSource = 'column';
            updateZoneVisibility();
        });

        updateZoneVisibility();
        mappingContainer.appendChild(zoneContainer);
    }

    function _createRadioOption(name, value, label, checked) {
        const wrapper = document.createElement('label');
        wrapper.className = 'csv-config-panel__radio-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = value;
        input.checked = checked;
        wrapper.appendChild(input);

        const span = document.createElement('span');
        span.textContent = label;
        wrapper.appendChild(span);

        return wrapper;
    }

    function _updateAttributeInfo() {
        const coordinateColumns = new Set(Object.values(currentMapping));
        const attrColumns = preview.headers.filter(h => !coordinateColumns.has(h));

        if (attrColumns.length > 0) {
            // textContent is XSS-safe, no need for escapeHtml
            attributeInfo.textContent = `Colunas que serão atributos: ${attrColumns.join(', ')}`;
        } else {
            attributeInfo.textContent = 'Todas as colunas mapeadas como coordenadas';
        }
    }

    function _validate() {
        const isValid = _checkValidity();
        importBtn.disabled = !isValid;
        return isValid;
    }

    function _checkValidity() {
        const format = CSV_COORDINATE_FORMATS.find(f => f.id === currentFormat);
        if (!format) return false;

        // Check all required columns are mapped
        const allMapped = format.requiredColumns.every(role => currentMapping[role]);
        if (!allMapped) return false;

        // Check UTM zone
        if (currentFormat === 'utm') {
            if (utmZoneSource === 'fixed') {
                if (!currentFixedValues.zone?.trim()) return false;
            } else if (!currentMapping.zone) {
                return false;
            }
        }

        // Check no duplicate column assignments
        const assignedColumns = Object.values(currentMapping).filter(v => v);
        if (new Set(assignedColumns).size !== assignedColumns.length) return false;

        // Check we have data
        return preview.totalRows > 0;
    }

    function _showResult(message, success) {
        resultContainer.className = `csv-config-panel__result ${success ? 'csv-config-panel__result--success' : 'csv-config-panel__result--error'}`;
        resultContainer.textContent = message;
    }

    // ========================================================================
    // INITIAL RENDER
    // ========================================================================

    _rebuildPreview();
    _rebuildMapping();
    _validate();

    // ========================================================================
    // RETURN
    // ========================================================================

    return {
        element: container,
        cleanup() {
            cleanup(cleanupContext);
        },
    };
}
