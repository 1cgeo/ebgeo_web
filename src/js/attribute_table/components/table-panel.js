// Path: js/attribute_table/components/table-panel.js

/**
 * @fileoverview Main panel container for the attribute table.
 */

import { ATTRIBUTE_TABLE, ATTRIBUTE_TABLE_ICONS } from '../attribute-table.constants.js';

/**
 * Creates the main table panel container element.
 * @param {Object} options - Panel options
 * @param {string} options.layerName - Name of the layer
 * @param {number} options.featureCount - Number of features
 * @param {number} options.filteredCount - Number of filtered features
 * @param {number} [options.height] - Initial panel height
 * @param {Function} options.onClose - Close callback
 * @param {Function} options.onMinimize - Minimize callback
 * @param {Function} options.onAddColumn - Add column callback
 * @param {Function} [options.onCsvExport] - CSV export callback
 * @param {Function} options.onResize - Resize callback (height)
 * @returns {HTMLElement} Panel element
 */
export function createTablePanel(options) {
    const {
        layerName,
        featureCount,
        filteredCount,
        height,
        onClose,
        onMinimize,
        onAddColumn,
        onCsvExport,
        onResize,
    } = options;

    const panel = document.createElement('div');
    panel.className = ATTRIBUTE_TABLE.CSS_CLASSES.PANEL;
    panel.dataset.state = ATTRIBUTE_TABLE.STATES.EXPANDED;

    if (height) {
        panel.style.height = `${height}px`;
    }

    // Create resize handle
    const resizeHandle = createResizeHandle(panel, onResize);
    panel.appendChild(resizeHandle);

    // Create toolbar
    const toolbar = createToolbar({
        layerName,
        featureCount,
        filteredCount,
        onClose,
        onMinimize,
        onAddColumn,
        onCsvExport,
    });
    panel.appendChild(toolbar);

    // Create filters container (will be populated by table-filters.js)
    const filtersContainer = document.createElement('div');
    filtersContainer.className = ATTRIBUTE_TABLE.CSS_CLASSES.FILTERS;
    panel.appendChild(filtersContainer);

    // Create table container
    const tableContainer = document.createElement('div');
    tableContainer.className = ATTRIBUTE_TABLE.CSS_CLASSES.CONTAINER;
    panel.appendChild(tableContainer);

    return panel;
}

/**
 * Creates the resize handle for the panel.
 * @param {HTMLElement} panel - Panel element
 * @param {Function} onResize - Resize callback
 * @returns {HTMLElement} Resize handle element
 */
function createResizeHandle(panel, onResize) {
    const handle = document.createElement('div');
    handle.className = ATTRIBUTE_TABLE.CSS_CLASSES.RESIZE_HANDLE;

    let startY = 0;
    let startHeight = 0;
    let isResizing = false;

    const handleMouseMove = (e) => {
        if (!isResizing) return;

        const deltaY = startY - e.clientY;
        let newHeight = startHeight + deltaY;

        // Apply constraints
        const minHeight = ATTRIBUTE_TABLE.MIN_HEIGHT;
        const maxHeight = Math.round(window.innerHeight * (ATTRIBUTE_TABLE.MAX_HEIGHT_PERCENT / 100));

        newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

        panel.style.height = `${newHeight}px`;
    };

    const handleMouseUp = () => {
        if (!isResizing) return;

        isResizing = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // Notify about resize
        const finalHeight = panel.offsetHeight;
        if (onResize) {
            onResize(finalHeight);
        }
    };

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();

        isResizing = true;
        startY = e.clientY;
        startHeight = panel.offsetHeight;

        handle.classList.add('active');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });

    return handle;
}

/**
 * Creates the toolbar element.
 * @param {Object} options - Toolbar options
 * @returns {HTMLElement} Toolbar element
 */
function createToolbar(options) {
    const { layerName, featureCount, filteredCount, onClose, onMinimize, onAddColumn, onCsvExport } = options;

    const toolbar = document.createElement('div');
    toolbar.className = ATTRIBUTE_TABLE.CSS_CLASSES.TOOLBAR;

    // Info section
    const info = document.createElement('div');
    info.className = 'attribute-table-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'attribute-table-layer-name';
    nameSpan.textContent = layerName;
    nameSpan.title = layerName;

    const countSpan = document.createElement('span');
    countSpan.className = 'attribute-table-count';
    updateCountDisplay(countSpan, featureCount, filteredCount);

    info.appendChild(nameSpan);
    info.appendChild(countSpan);

    // Actions section
    const actions = document.createElement('div');
    actions.className = 'attribute-table-actions';

    // CSV export button
    const csvExportBtn = document.createElement('button');
    csvExportBtn.className = 'attribute-table-csv-export-btn';
    csvExportBtn.innerHTML = ATTRIBUTE_TABLE_ICONS.CSV_EXPORT;
    csvExportBtn.title = 'Exportar CSV';
    csvExportBtn.onclick = (e) => {
        e.stopPropagation();
        if (onCsvExport) onCsvExport();
    };

    // Add column button
    const addColumnBtn = document.createElement('button');
    addColumnBtn.className = 'attribute-table-add-column-btn';
    addColumnBtn.innerHTML = ATTRIBUTE_TABLE_ICONS.ADD_COLUMN;
    addColumnBtn.title = 'Adicionar atributo';
    addColumnBtn.onclick = (e) => {
        e.stopPropagation();
        if (onAddColumn) onAddColumn();
    };

    // Minimize button
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'attribute-table-minimize-btn';
    minimizeBtn.innerHTML = ATTRIBUTE_TABLE_ICONS.MINIMIZE;
    minimizeBtn.title = 'Minimizar';
    minimizeBtn.onclick = (e) => {
        e.stopPropagation();
        if (onMinimize) onMinimize();
    };

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'attribute-table-close-btn';
    closeBtn.innerHTML = ATTRIBUTE_TABLE_ICONS.CLOSE;
    closeBtn.title = 'Fechar';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        if (onClose) onClose();
    };

    actions.appendChild(csvExportBtn);
    actions.appendChild(addColumnBtn);
    actions.appendChild(minimizeBtn);
    actions.appendChild(closeBtn);

    toolbar.appendChild(info);
    toolbar.appendChild(actions);

    return toolbar;
}

/**
 * Updates the count display in the toolbar.
 * @param {HTMLElement} countSpan - Count span element
 * @param {number} total - Total feature count
 * @param {number} filtered - Filtered feature count
 */
export function updateCountDisplay(countSpan, total, filtered) {
    if (filtered !== total) {
        countSpan.textContent = `(${filtered} de ${total} feições)`;
    } else {
        countSpan.textContent = `(${total} feições)`;
    }
}

/**
 * Sets the panel state.
 * @param {HTMLElement} panel - Panel element
 * @param {'closed'|'minimized'|'expanded'} state - New state
 */
export function setPanelState(panel, state) {
    panel.dataset.state = state;

    const minimizeBtn = panel.querySelector('.attribute-table-minimize-btn');
    if (minimizeBtn) {
        if (state === ATTRIBUTE_TABLE.STATES.MINIMIZED) {
            minimizeBtn.innerHTML = ATTRIBUTE_TABLE_ICONS.MAXIMIZE;
            minimizeBtn.title = 'Expandir';
        } else {
            minimizeBtn.innerHTML = ATTRIBUTE_TABLE_ICONS.MINIMIZE;
            minimizeBtn.title = 'Minimizar';
        }
    }
}

/**
 * Gets the table container element from the panel.
 * @param {HTMLElement} panel - Panel element
 * @returns {HTMLElement|null} Table container element
 */
export function getTableContainer(panel) {
    return panel.querySelector(`.${ATTRIBUTE_TABLE.CSS_CLASSES.CONTAINER}`);
}

/**
 * Gets the filters container element from the panel.
 * @param {HTMLElement} panel - Panel element
 * @returns {HTMLElement|null} Filters container element
 */
export function getFiltersContainer(panel) {
    return panel.querySelector(`.${ATTRIBUTE_TABLE.CSS_CLASSES.FILTERS}`);
}

/**
 * Updates the layer name in the toolbar.
 * @param {HTMLElement} panel - Panel element
 * @param {string} layerName - New layer name
 */
export function updateLayerName(panel, layerName) {
    const nameSpan = panel.querySelector('.attribute-table-layer-name');
    if (nameSpan) {
        nameSpan.textContent = layerName;
        nameSpan.title = layerName;
    }
}

/**
 * Updates the feature count in the toolbar.
 * @param {HTMLElement} panel - Panel element
 * @param {number} total - Total feature count
 * @param {number} filtered - Filtered feature count
 */
export function updateFeatureCount(panel, total, filtered) {
    const countSpan = panel.querySelector('.attribute-table-count');
    if (countSpan) {
        updateCountDisplay(countSpan, total, filtered);
    }
}
