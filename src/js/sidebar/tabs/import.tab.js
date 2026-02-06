// Path: js/sidebar/tabs/import.tab.js

/**
 * @fileoverview Import tab component for sidebar.
 * Provides file import functionality for GeoJSON, Shapefile, KML/KMZ, and GPX.
 */

import {
    setupCleanup,
    addDomListener,
    subscribe,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';
import { showSuccess, showError } from '../../utilities/index.js';
import { EventTypes } from '../../events/event_types.js';
import { isViewer3DOpen } from '../../utilities/viewer3d-state.js';
import { isCurrentMapLockedSync } from '../../store/index.js';

/**
 * Import format configurations.
 */
const IMPORT_FORMATS = {
    geojson: {
        id: 'geojson',
        name: 'GeoJSON',
        description: 'Formato padrão para dados geográficos',
        accept: '.geojson,.json',
        color: '#16a34a', // green
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>`,
    },
    shapefile: {
        id: 'shapefile',
        name: 'Shapefile',
        description: 'Arquivo ZIP contendo .shp, .shx, .dbf',
        accept: '.zip',
        color: '#3b82f6', // blue
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`,
    },
    kml: {
        id: 'kml',
        name: 'KML / KMZ',
        description: 'Google Earth / Maps format',
        accept: '.kml,.kmz',
        color: '#f97316', // orange
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
    },
    gpx: {
        id: 'gpx',
        name: 'GPX',
        description: 'GPS Exchange Format',
        accept: '.gpx',
        color: '#8b5cf6', // purple
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    },
};

/**
 * Import tab component.
 */
export class ImportTab {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.importControl - AddImportControl instance
     * @param {Object} dependencies.exportImportService - ExportImportService instance
     * @param {Object} dependencies.eventBus - EventBus instance
     */
    constructor(dependencies) {
        this._importControl = dependencies.importControl;
        this._exportImportService = dependencies.exportImportService;
        this._eventBus = dependencies.eventBus;

        this._container = null;
        this._dropZone = null;
        this._fileInput = null;
        this._currentFormat = null;
        this._optionsContainer = null;
        this._is3DViewerOpen = false;

        setupCleanup(this);
    }

    /**
     * Creates the tab UI.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-tab-content import-tab';

        // Section header
        const header = document.createElement('div');
        header.className = 'sidebar-section-header';
        header.textContent = 'Selecione o Formato';
        this._container.appendChild(header);

        // Import options
        this._optionsContainer = this._createImportOptions();
        this._container.appendChild(this._optionsContainer);

        // Drop zone
        this._dropZone = this._createDropZone();
        this._container.appendChild(this._dropZone);

        // Hidden file input
        this._fileInput = document.createElement('input');
        this._fileInput.type = 'file';
        this._fileInput.style.display = 'none';
        this._fileInput.multiple = false;
        addDomListener(this, this._fileInput, 'change', (e) => this._handleFileSelect(e));
        this._container.appendChild(this._fileInput);

        // Setup 3D viewer state listeners
        this._setup3DViewerListeners();

        // Setup map lock listener
        subscribe(this, this._eventBus, EventTypes.MAP_LOCK_CHANGED,
            () => this._updateMapLockUI());

        // Check initial 3D state
        this._is3DViewerOpen = isViewer3DOpen();
        this._update3DViewerModeUI();

        // Check initial lock state
        this._updateMapLockUI();

        return this._container;
    }

    /**
     * Sets up listeners for 3D viewer state changes.
     * @private
     */
    _setup3DViewerListeners() {
        if (!this._eventBus) return;

        subscribe(this, this._eventBus, EventTypes.VIEWER_3D_OPENED, () => {
            this._is3DViewerOpen = true;
            this._update3DViewerModeUI();
        });

        subscribe(this, this._eventBus, EventTypes.VIEWER_3D_CLOSED, () => {
            this._is3DViewerOpen = false;
            this._update3DViewerModeUI();
        });
    }

    /**
     * Updates UI based on 3D viewer mode.
     * Disables import functionality when 3D viewer is open.
     * @private
     */
    _update3DViewerModeUI() {
        if (!this._container) return;

        if (this._is3DViewerOpen) {
            // Disable import options and drop zone
            if (this._optionsContainer) {
                this._optionsContainer.classList.add('disabled-3d-mode');
            }
            if (this._dropZone) {
                this._dropZone.classList.add('disabled-3d-mode');
            }
        } else {
            // Re-enable import options and drop zone, but only if map is NOT locked
            if (!isCurrentMapLockedSync()) {
                if (this._optionsContainer) {
                    this._optionsContainer.classList.remove('disabled-3d-mode');
                }
                if (this._dropZone) {
                    this._dropZone.classList.remove('disabled-3d-mode');
                }
            }
        }
    }

    /**
     * Updates UI based on map lock state.
     * @private
     */
    _updateMapLockUI() {
        if (!this._container) return;
        const locked = isCurrentMapLockedSync();

        if (this._optionsContainer) {
            this._optionsContainer.classList.toggle('disabled-3d-mode', locked);
        }
        if (this._dropZone) {
            this._dropZone.classList.toggle('disabled-3d-mode', locked);
        }
    }

    /**
     * Creates the import format options.
     * @private
     * @returns {HTMLElement}
     */
    _createImportOptions() {
        const container = document.createElement('div');
        container.className = 'import-options';

        Object.values(IMPORT_FORMATS).forEach(format => {
            const button = this._createFormatButton(format);
            container.appendChild(button);
        });

        return container;
    }

    /**
     * Creates a format button.
     * @private
     * @param {Object} format - Format configuration
     * @returns {HTMLElement}
     */
    _createFormatButton(format) {
        const button = document.createElement('button');
        button.className = 'import-option-btn';
        button.dataset.format = format.id;

        button.innerHTML = `
            <div class="import-option-icon" data-format="${format.id}" style="background: ${format.color}">
                ${format.icon}
            </div>
            <div class="import-option-info">
                <div class="import-option-name">${format.name}</div>
                <div class="import-option-desc">${format.description}</div>
            </div>
        `;

        addDomListener(this, button, 'click', () => this._handleFormatClick(format));

        return button;
    }

    /**
     * Creates the drop zone.
     * @private
     * @returns {HTMLElement}
     */
    _createDropZone() {
        const dropZone = document.createElement('div');
        dropZone.className = 'import-drop-zone';
        dropZone.dataset.dragover = 'false';

        dropZone.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>Arraste arquivos aqui</p>
            <span>ou clique em um formato acima</span>
        `;

        // Drag events
        addDomListener(this, dropZone, 'dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.dataset.dragover = 'true';
        });

        addDomListener(this, dropZone, 'dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.dataset.dragover = 'false';
        });

        addDomListener(this, dropZone, 'drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.dataset.dragover = 'false';
            this._handleFileDrop(e);
        });

        return dropZone;
    }

    /**
     * Handles format button click.
     * @private
     * @param {Object} format - Selected format
     */
    _handleFormatClick(format) {
        // Block import when map is locked
        if (isCurrentMapLockedSync()) {
            showError('Mapa bloqueado');
            return;
        }

        // Block import when 3D viewer is open
        if (this._is3DViewerOpen) {
            showError('Importação desabilitada no modo 3D');
            return;
        }

        this._currentFormat = format;
        this._fileInput.accept = format.accept;
        this._fileInput.click();
    }

    /**
     * Handles file selection from input.
     * @private
     * @param {Event} e - Change event
     */
    async _handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        await this._processFile(file);

        // Reset input
        this._fileInput.value = '';
        this._currentFormat = null;
    }

    /**
     * Handles file drop.
     * @private
     * @param {DragEvent} e - Drop event
     */
    async _handleFileDrop(e) {
        // Block import when map is locked
        if (isCurrentMapLockedSync()) {
            showError('Mapa bloqueado');
            return;
        }

        // Block import when 3D viewer is open
        if (this._is3DViewerOpen) {
            showError('Importação desabilitada no modo 3D');
            return;
        }

        const file = e.dataTransfer?.files[0];
        if (!file) return;

        await this._processFile(file);
    }

    /**
     * Processes an imported file.
     * @private
     * @param {File} file - File to process
     */
    async _processFile(file) {
        if (!this._importControl) {
            showError('Serviço de importação não disponível');
            return;
        }

        try {
            // Use the import control's processFileDirectly method
            if (this._importControl.processFileDirectly) {
                await this._importControl.processFileDirectly(file);
            } else if (this._importControl.processFile) {
                const geoJSON = await this._importControl.processFile(file);
                if (geoJSON) {
                    await this._importControl.importGeoJSON(geoJSON, file.name);
                }
            } else {
                // Fallback: trigger the control's activate method with a synthetic event
                const fakeInput = { target: { files: [file], value: '' } };
                if (this._importControl.handleFileSelect) {
                    await this._importControl.handleFileSelect(fakeInput);
                }
            }
            showSuccess('Arquivo importado com sucesso');
        } catch (error) {
            console.error('Import error:', error);
            showError(`Erro ao importar: ${error.message}`);
        }
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Refreshes the tab content.
     */
    refresh() {
        // No dynamic content to refresh
    }

    /**
     * Destroys the component.
     */
    destroy() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._dropZone = null;
        this._fileInput = null;
        this._optionsContainer = null;
    }
}
