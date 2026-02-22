// Path: js/attribute_table/components/table-renderer.js

/**
 * @fileoverview Renders the attribute table (headers, rows, cells).
 */

import {
    ATTRIBUTE_TABLE,
    ATTRIBUTE_TABLE_ICONS,
    EMPTY_CELL_PLACEHOLDER,
} from '../attribute-table.constants.js';
import {
    FEATURE_TYPE_ICONS,
    FEATURE_DISPLAY_NAMES,
} from '../../store/store.constants.js';
import { tableDataService } from '../services/table-data.service.js';

/**
 * @typedef {Object} TableCallbacks
 * @property {Function} onRowClick - Row click callback (feature, event)
 * @property {Function} onCheckboxChange - Checkbox change callback (featureId, checked, event)
 * @property {Function} onSelectAll - Select all callback (checked)
 * @property {Function} onCellEdit - Cell edit callback (featureId, featureType, columnKey, newValue)
 * @property {Function} onZoomToFeature - Zoom callback (feature)
 * @property {Function} onRowHover - Row hover callback (feature, isHovering)
 * @property {Function} onColumnSort - Column sort callback (columnKey)
 * @property {Function} onColumnContextMenu - Column context menu callback (columnKey, event)
 */

/**
 * @typedef {Object} SortState
 * @property {string|null} column - Sorted column key
 * @property {'asc'|'desc'|null} direction - Sort direction
 */

/**
 * Renders the complete table into a container.
 * @param {HTMLElement} container - Container element
 * @param {Object} options - Render options
 * @param {Array} options.features - Features to display
 * @param {string[]} options.attributeColumns - Attribute column keys
 * @param {Set<string>} options.selectedIds - Selected feature IDs
 * @param {SortState} options.sortState - Current sort state
 * @param {Object<string, number>} options.columnWidths - Custom column widths
 * @param {TableCallbacks} options.callbacks - Event callbacks
 */
export function renderTable(container, options) {
    const {
        features,
        attributeColumns,
        selectedIds = new Set(),
        sortState = {},
        columnWidths = {},
        callbacks = {},
    } = options;

    container.innerHTML = '';

    // Create table
    const table = document.createElement('table');
    table.className = ATTRIBUTE_TABLE.CSS_CLASSES.TABLE;
    table.setAttribute('role', 'grid');

    // Create header
    const thead = createTableHeader({
        attributeColumns,
        sortState,
        columnWidths,
        allSelected: features.length > 0 && selectedIds.size === features.length,
        callbacks,
    });
    table.appendChild(thead);

    // Create body
    const tbody = document.createElement('tbody');
    tbody.className = ATTRIBUTE_TABLE.CSS_CLASSES.BODY;

    if (features.length === 0) {
        const emptyRow = createEmptyRow(attributeColumns.length);
        tbody.appendChild(emptyRow);
    } else {
        features.forEach((feature, index) => {
            const isSelected = selectedIds.has(feature.properties?.id);
            const row = createTableRow({
                feature,
                attributeColumns,
                isSelected,
                rowIndex: index,
                columnWidths,
                callbacks,
            });
            tbody.appendChild(row);
        });
    }

    table.appendChild(tbody);
    container.appendChild(table);
}

/**
 * Creates the table header.
 * @param {Object} options - Header options
 * @returns {HTMLElement} Thead element
 */
function createTableHeader(options) {
    const { attributeColumns, sortState, columnWidths, allSelected, callbacks } = options;

    const thead = document.createElement('thead');
    thead.className = ATTRIBUTE_TABLE.CSS_CLASSES.HEAD;

    const row = document.createElement('tr');

    // Checkbox column
    const checkboxTh = document.createElement('th');
    checkboxTh.className = 'attribute-table-col-checkbox';
    checkboxTh.style.width = `${ATTRIBUTE_TABLE.COLUMN_WIDTHS.checkbox}px`;

    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.className = 'attribute-table-select-all';
    selectAllCheckbox.checked = allSelected;
    selectAllCheckbox.title = 'Selecionar todas';
    selectAllCheckbox.addEventListener('change', () => {
        if (callbacks.onSelectAll) {
            callbacks.onSelectAll(selectAllCheckbox.checked);
        }
    });
    checkboxTh.appendChild(selectAllCheckbox);
    row.appendChild(checkboxTh);

    // Type column
    const typeTh = createSortableHeader('type', 'Tipo', sortState, columnWidths, callbacks);
    typeTh.classList.add('attribute-table-col-type');
    typeTh.style.width = `${ATTRIBUTE_TABLE.COLUMN_WIDTHS.type}px`;
    row.appendChild(typeTh);

    // Name column
    const nameTh = createSortableHeader('nome', 'Nome', sortState, columnWidths, callbacks);
    nameTh.classList.add('attribute-table-col-name');
    nameTh.style.width = `${columnWidths.nome || ATTRIBUTE_TABLE.COLUMN_WIDTHS.name}px`;
    row.appendChild(nameTh);

    // Description column (fixed, after name)
    const descTh = createSortableHeader('descricao', 'Descrição', sortState, columnWidths, callbacks);
    descTh.classList.add('attribute-table-col-desc');
    descTh.style.width = `${columnWidths.descricao || ATTRIBUTE_TABLE.COLUMN_WIDTHS.name}px`;
    row.appendChild(descTh);

    // Attribute columns
    attributeColumns.forEach((key) => {
        const th = createSortableHeader(key, key, sortState, columnWidths, callbacks, true);
        th.classList.add('attribute-table-col-attr');
        th.style.width = `${columnWidths[key] || ATTRIBUTE_TABLE.COLUMN_WIDTHS.attribute}px`;
        row.appendChild(th);
    });

    // Actions column
    const actionsTh = document.createElement('th');
    actionsTh.className = 'attribute-table-col-actions';
    actionsTh.style.width = `${ATTRIBUTE_TABLE.COLUMN_WIDTHS.actions}px`;
    actionsTh.textContent = 'Ações';
    actionsTh.title = 'Ações';
    row.appendChild(actionsTh);

    thead.appendChild(row);
    return thead;
}

/**
 * Creates a sortable header cell.
 * @param {string} key - Column key
 * @param {string} label - Column label
 * @param {SortState} sortState - Current sort state
 * @param {Object<string, number>} columnWidths - Column widths
 * @param {TableCallbacks} callbacks - Callbacks
 * @param {boolean} [isAttribute=false] - Whether this is an attribute column
 * @returns {HTMLElement} Th element
 */
function createSortableHeader(key, label, sortState, columnWidths, callbacks, isAttribute = false) {
    const th = document.createElement('th');
    th.dataset.columnKey = key;

    // Content wrapper
    const content = document.createElement('div');
    content.className = 'attribute-table-header-content';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'attribute-table-header-label';
    labelSpan.textContent = label;
    labelSpan.title = label;
    content.appendChild(labelSpan);

    // Sort indicator
    const sortIndicator = document.createElement('span');
    sortIndicator.className = 'attribute-table-sort-indicator';

    if (sortState.column === key) {
        th.dataset.sort = sortState.direction;
        if (sortState.direction === 'asc') {
            sortIndicator.innerHTML = ATTRIBUTE_TABLE_ICONS.SORT_ASC;
        } else if (sortState.direction === 'desc') {
            sortIndicator.innerHTML = ATTRIBUTE_TABLE_ICONS.SORT_DESC;
        }
    }

    content.appendChild(sortIndicator);
    th.appendChild(content);

    // Click to sort
    th.addEventListener('click', () => {
        if (callbacks.onColumnSort) {
            callbacks.onColumnSort(key);
        }
    });

    // Right-click for attribute columns
    if (isAttribute) {
        th.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (callbacks.onColumnContextMenu) {
                callbacks.onColumnContextMenu(key, e);
            }
        });
    }

    return th;
}

/**
 * Creates a table row for a feature.
 * @param {Object} options - Row options
 * @returns {HTMLElement} Tr element
 */
function createTableRow(options) {
    const { feature, attributeColumns, isSelected, columnWidths, callbacks } = options;

    const tr = document.createElement('tr');
    tr.className = ATTRIBUTE_TABLE.CSS_CLASSES.ROW;
    tr.dataset.featureId = feature.properties?.id || '';
    tr.dataset.featureType = feature.properties?.source || '';
    tr.dataset.selected = isSelected.toString();
    tr.setAttribute('role', 'row');
    tr.setAttribute('aria-selected', isSelected.toString());

    // Hover events
    tr.addEventListener('mouseenter', () => {
        if (callbacks.onRowHover) {
            callbacks.onRowHover(feature, true);
        }
    });

    tr.addEventListener('mouseleave', () => {
        if (callbacks.onRowHover) {
            callbacks.onRowHover(feature, false);
        }
    });

    // Row click removed - selection is now only via checkbox

    // Checkbox cell
    const checkboxTd = document.createElement('td');
    checkboxTd.className = 'attribute-table-cell-checkbox';
    checkboxTd.setAttribute('role', 'gridcell');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'attribute-table-row-checkbox';
    checkbox.checked = isSelected;
    checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        if (callbacks.onCheckboxChange) {
            callbacks.onCheckboxChange(feature.properties?.id, checkbox.checked, e);
        }
    });
    checkboxTd.appendChild(checkbox);
    tr.appendChild(checkboxTd);

    // Type cell
    const typeTd = document.createElement('td');
    typeTd.className = 'attribute-table-cell-type';
    typeTd.setAttribute('role', 'gridcell');

    const sourceType = feature.properties?.source;
    const iconPath = FEATURE_TYPE_ICONS[sourceType];
    const displayName = FEATURE_DISPLAY_NAMES[sourceType] || sourceType;

    if (iconPath) {
        const icon = document.createElement('img');
        icon.src = iconPath;
        icon.alt = displayName;
        icon.title = displayName;
        icon.className = 'attribute-table-type-icon';
        typeTd.appendChild(icon);
    } else {
        typeTd.textContent = displayName;
    }
    tr.appendChild(typeTd);

    // Name cell (editable)
    const nameTd = createEditableCell({
        feature,
        columnKey: 'nome',
        value: feature.properties?.nome || EMPTY_CELL_PLACEHOLDER,
        callbacks,
    });
    nameTd.classList.add('attribute-table-cell-name');
    nameTd.style.width = `${columnWidths.nome || ATTRIBUTE_TABLE.COLUMN_WIDTHS.name}px`;
    tr.appendChild(nameTd);

    // Description cell (editable)
    const descTd = createEditableCell({
        feature,
        columnKey: 'descricao',
        value: tableDataService.getCellValue(feature, 'descricao'),
        callbacks,
    });
    descTd.classList.add('attribute-table-cell-desc');
    descTd.style.width = `${columnWidths.descricao || ATTRIBUTE_TABLE.COLUMN_WIDTHS.name}px`;
    tr.appendChild(descTd);

    // Attribute cells (editable)
    attributeColumns.forEach((key) => {
        const value = tableDataService.getCellValue(feature, key);
        const td = createEditableCell({
            feature,
            columnKey: key,
            value,
            isAttribute: true,
            callbacks,
        });
        td.classList.add('attribute-table-cell-attr');
        td.dataset.attrKey = key;
        td.style.width = `${columnWidths[key] || ATTRIBUTE_TABLE.COLUMN_WIDTHS.attribute}px`;
        tr.appendChild(td);
    });

    // Actions cell
    const actionsTd = document.createElement('td');
    actionsTd.className = 'attribute-table-cell-actions';
    actionsTd.setAttribute('role', 'gridcell');

    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'attribute-table-zoom-btn';
    zoomBtn.innerHTML = ATTRIBUTE_TABLE_ICONS.ZOOM;
    zoomBtn.title = 'Zoom para feição';
    zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (callbacks.onZoomToFeature) {
            callbacks.onZoomToFeature(feature);
        }
    });
    actionsTd.appendChild(zoomBtn);
    tr.appendChild(actionsTd);

    return tr;
}

/**
 * Creates an editable cell.
 * @param {Object} options - Cell options
 * @returns {HTMLElement} Td element
 */
function createEditableCell(options) {
    const { feature, columnKey, value, isAttribute = false, callbacks } = options;

    const td = document.createElement('td');
    td.className = ATTRIBUTE_TABLE.CSS_CLASSES.CELL;
    td.setAttribute('role', 'gridcell');
    td.dataset.columnKey = columnKey;

    const isEmpty = tableDataService.isEmptyValue(value);

    const valueSpan = document.createElement('span');
    valueSpan.className = 'attribute-table-cell-value';
    if (isEmpty) {
        valueSpan.classList.add(ATTRIBUTE_TABLE.CSS_CLASSES.CELL_EMPTY);
    }
    valueSpan.textContent = value;
    td.appendChild(valueSpan);

    // Double-click to edit
    td.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startCellEditing(td, feature, columnKey, isAttribute, callbacks);
    });

    return td;
}

/**
 * Starts inline editing of a cell.
 * @param {HTMLElement} td - Table cell element
 * @param {Object} feature - Feature data
 * @param {string} columnKey - Column key
 * @param {boolean} isAttribute - Whether this is an attribute column
 * @param {TableCallbacks} callbacks - Callbacks
 */
function startCellEditing(td, feature, columnKey, isAttribute, callbacks) {
    // Don't start editing if already editing or if read-only
    if (td.classList.contains(ATTRIBUTE_TABLE.CSS_CLASSES.CELL_EDITING)) {
        return;
    }
    if (callbacks.readOnly) {
        return;
    }

    const currentValue =
        columnKey === 'nome'
            ? feature.properties?.nome || ''
            : columnKey === 'descricao'
                ? feature.properties?.descricao || ''
                : feature.properties?.attributes?.[columnKey] || '';

    const originalHTML = td.innerHTML;

    // Create input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'attribute-table-cell-input';
    input.value = currentValue;

    td.innerHTML = '';
    td.classList.add(ATTRIBUTE_TABLE.CSS_CLASSES.CELL_EDITING);
    td.appendChild(input);

    input.focus();
    input.select();

    const finishEditing = (save) => {
        if (!td.classList.contains(ATTRIBUTE_TABLE.CSS_CLASSES.CELL_EDITING)) {
            return;
        }

        td.classList.remove(ATTRIBUTE_TABLE.CSS_CLASSES.CELL_EDITING);
        const newValue = input.value.trim();

        if (save && newValue !== currentValue) {
            // Update display
            const valueSpan = document.createElement('span');
            valueSpan.className = 'attribute-table-cell-value';

            if (newValue === '') {
                valueSpan.classList.add(ATTRIBUTE_TABLE.CSS_CLASSES.CELL_EMPTY);
                valueSpan.textContent = EMPTY_CELL_PLACEHOLDER;
            } else {
                valueSpan.textContent = newValue;
            }

            td.innerHTML = '';
            td.appendChild(valueSpan);

            // Update feature reference with new value
            if (columnKey === 'nome') {
                feature.properties.nome = newValue;
            } else if (columnKey === 'descricao') {
                feature.properties.descricao = newValue;
            } else {
                if (!feature.properties.attributes) {
                    feature.properties.attributes = {};
                }
                feature.properties.attributes[columnKey] = newValue;
            }

            // Notify callback
            if (callbacks.onCellEdit) {
                callbacks.onCellEdit(
                    feature.properties?.id,
                    feature.properties?.source,
                    columnKey,
                    newValue
                );
            }
        } else {
            // Restore original
            td.innerHTML = originalHTML;
        }
    };

    // Event handlers
    input.addEventListener('blur', () => finishEditing(true));

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishEditing(false);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            finishEditing(true);
            // Move to next editable cell
            moveToNextEditableCell(td, e.shiftKey);
        }
    });
}

/**
 * Moves focus to the next editable cell.
 * @param {HTMLElement} currentTd - Current cell
 * @param {boolean} reverse - Move backwards
 */
function moveToNextEditableCell(currentTd, reverse = false) {
    const row = currentTd.closest('tr');
    const table = currentTd.closest('table');

    if (!row || !table) return;

    const editableCells = Array.from(
        table.querySelectorAll('td.attribute-table-cell-name, td.attribute-table-cell-desc, td.attribute-table-cell-attr')
    );

    const currentIndex = editableCells.indexOf(currentTd);
    if (currentIndex === -1) return;

    const nextIndex = reverse ? currentIndex - 1 : currentIndex + 1;

    if (nextIndex >= 0 && nextIndex < editableCells.length) {
        const nextCell = editableCells[nextIndex];
        nextCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }
}

/**
 * Creates an empty row message.
 * @param {number} columnCount - Number of attribute columns
 * @returns {HTMLElement} Tr element
 */
function createEmptyRow(columnCount) {
    const tr = document.createElement('tr');
    tr.className = 'attribute-table-empty-row';

    const td = document.createElement('td');
    // Total columns: checkbox + type + name + description + attributes + actions
    td.colSpan = 5 + columnCount;
    td.className = 'attribute-table-empty-message';
    td.textContent = 'Nenhuma feição encontrada';

    tr.appendChild(td);
    return tr;
}

/**
 * Updates the selection state of rows.
 * @param {HTMLElement} tbody - Table body element
 * @param {Set<string>} selectedIds - Selected feature IDs
 */
export function updateRowSelections(tbody, selectedIds) {
    const rows = tbody.querySelectorAll(`.${ATTRIBUTE_TABLE.CSS_CLASSES.ROW}`);

    rows.forEach((row) => {
        const featureId = row.dataset.featureId;
        const isSelected = selectedIds.has(featureId);

        row.dataset.selected = isSelected.toString();
        row.setAttribute('aria-selected', isSelected.toString());

        const checkbox = row.querySelector('.attribute-table-row-checkbox');
        if (checkbox) {
            checkbox.checked = isSelected;
        }
    });

    // Update select all checkbox
    const selectAllCheckbox = tbody
        .closest('table')
        ?.querySelector('.attribute-table-select-all');

    if (selectAllCheckbox) {
        const totalRows = rows.length;
        const selectedRows = Array.from(rows).filter(
            (r) => r.dataset.selected === 'true'
        ).length;

        selectAllCheckbox.checked = totalRows > 0 && selectedRows === totalRows;
        selectAllCheckbox.indeterminate =
            selectedRows > 0 && selectedRows < totalRows;
    }
}

/**
 * Updates hover state for a row.
 * @param {HTMLElement} tbody - Table body element
 * @param {string} featureId - Feature ID
 * @param {boolean} isHovered - Whether hovered
 */
export function updateRowHover(tbody, featureId, isHovered) {
    const row = tbody.querySelector(
        `.${ATTRIBUTE_TABLE.CSS_CLASSES.ROW}[data-feature-id="${featureId}"]`
    );

    if (row) {
        row.dataset.hovered = isHovered.toString();
    }
}
