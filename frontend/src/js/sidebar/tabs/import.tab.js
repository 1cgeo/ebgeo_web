// Path: js/sidebar/tabs/import.tab.js

/**
 * @fileoverview Import tab component for sidebar.
 * Provides file import functionality for GeoJSON, Shapefile, KML/KMZ, GPX, and CSV.
 *
 * O `.ebgeo` NÃO É IMPORTADO AQUI, e mesmo assim é nomeado aqui: a ação vive na aba Mapas
 * (aditiva ao atlas atual) e no arrastar-e-soltar, e esta aba carrega só um PONTEIRO até ela
 * ({@link ImportTab#_createEbgeoPointerButton}). O formato próprio do produto estar ausente da
 * aba chamada "Importar" é um buraco de descoberta, não de funcionalidade, e reimplementar a
 * ação para fechá-lo criaria duas portas que divergem.
 */

import {
    setupCleanup,
    addDomListener,
    subscribe,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { showSuccess, showError } from '@utils/index.js';
import { EventTypes } from '@events/event_types.js';
import { isViewer3DOpen } from '@utils/viewer3d-state.js';
import { isCurrentMapLockedSync } from '@store/index.js';
import { SIDEBAR_TABS } from '@sidebar/sidebar.constants.js';
import { getStateManager } from '@store/services.js';

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
    csv: {
        id: 'csv',
        name: 'CSV',
        description: 'Tabela com coordenadas em colunas',
        accept: '.csv,.txt,.tsv',
        color: '#0ea5e9', // sky blue
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/></svg>`,
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
     * @param {Function} [dependencies.onShowToolPanel] - Callback(element, title, cleanup, onClose) to show a tool panel
     * @param {Function} [dependencies.onHideToolPanel] - Callback() to hide the tool panel
     */
    constructor(dependencies) {
        this._importControl = dependencies.importControl;
        this._exportImportService = dependencies.exportImportService;
        this._eventBus = dependencies.eventBus;
        this._onShowToolPanel = dependencies.onShowToolPanel || null;
        this._onHideToolPanel = dependencies.onHideToolPanel || null;

        this._container = null;
        this._fileInput = null;
        this._currentFormat = null;
        this._optionsContainer = null;
        this._is3DViewerOpen = false;
        this._pendingCSVImport = false;

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

        // Import options (includes batch-points button)
        this._optionsContainer = this._createImportOptions();
        this._container.appendChild(this._optionsContainer);

        // Hidden file input
        this._fileInput = document.createElement('input');
        this._fileInput.type = 'file';
        this._fileInput.className = 'sidebar-hidden-file-input';
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
            if (this._optionsContainer) {
                this._optionsContainer.classList.add('disabled-3d-mode');
            }
        } else {
            if (!isCurrentMapLockedSync()) {
                if (this._optionsContainer) {
                    this._optionsContainer.classList.remove('disabled-3d-mode');
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

        // Batch points button (same styling as format buttons)
        container.appendChild(this._createBatchPointsButton());

        // The `.ebgeo` pointer, last: it is the only entry here that does not import anything
        // by itself.
        container.appendChild(this._createEbgeoPointerButton());

        return container;
    }

    /**
     * O ponteiro para onde o formato PRÓPRIO do produto mora.
     *
     * ISTO É DESCOBERTA, NÃO FUNCIONALIDADE, e a distinção decide o que este botão faz. A ação
     * de importar um `.ebgeo` já existe e é aditiva ao atlas atual (aba Mapas, "Importar"),
     * mais o arrastar-e-soltar; o que faltava é que a aba chamada "Importar" listava cinco
     * formatos e nenhum deles era o do EBGeo, de modo que quem procurava o próprio arquivo do
     * produto procurava exatamente onde ele não está. Uma segunda implementação da ação aqui
     * seria duas portas que divergem na primeira revisão: este botão só LEVA à porta.
     *
     * Sem ícone de propósito: os cinco formatos acima colorem o quadrado pelo formato, e um
     * quadrado a mais sem cor própria prometeria um sexto formato de arquivo em vez de um
     * atalho.
     * @private
     * @returns {HTMLElement}
     */
    _createEbgeoPointerButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'import-option-btn';
        btn.dataset.testid = 'import-ebgeo-pointer';
        btn.title = 'Ir para a aba Mapas, onde o arquivo .ebgeo é importado';

        const info = document.createElement('div');
        info.className = 'import-option-info';

        const nome = document.createElement('div');
        nome.className = 'import-option-name';
        nome.textContent = 'Arquivo do EBGeo (.ebgeo)';

        const desc = document.createElement('div');
        desc.className = 'import-option-desc';
        desc.textContent = 'Fica na aba Mapas, em "Importar". Toque para ir até lá.';

        info.appendChild(nome);
        info.appendChild(desc);
        btn.appendChild(info);

        addDomListener(this, btn, 'click', () => this._goToMapsTab());

        return btn;
    }

    /**
     * Leva para a aba Mapas.
     *
     * O ESTADO É QUEM TROCA DE ABA, não a barra: `expandSidebar` emite `SIDEBAR_TAB_CHANGED`, e
     * é isso que a barra (colapsada inclusive) escuta. Mexer no DOM da barra daqui deixaria o
     * estado dizendo "importar" com a tela mostrando "mapas".
     *
     * `getStateManager()` LANÇA quando os serviços não subiram (não devolve nulo), e um clique
     * que estoura em silêncio é pior do que um que recusa dizendo o motivo.
     * @private
     */
    _goToMapsTab() {
        try {
            getStateManager().expandSidebar(SIDEBAR_TABS.MAPAS);
        } catch (error) {
            console.error('Failed to open the maps tab:', error);
            showError('Não foi possível abrir a aba Mapas');
        }
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

        // CSV needs a config panel after file selection
        this._pendingCSVImport = format.id === 'csv';

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

        if (this._pendingCSVImport) {
            this._pendingCSVImport = false;
            await this._processCSVFile(file);
        } else {
            await this._processFile(file);
        }

        // Reset input
        this._fileInput.value = '';
        this._currentFormat = null;
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
     * Processes a CSV file by showing the configuration panel.
     * @private
     * @param {File} file - CSV file to process
     */
    async _processCSVFile(file) {
        if (!this._onShowToolPanel) {
            showError('Painel de configuração não disponível');
            return;
        }

        try {
            const csvText = await file.text();

            if (!csvText.trim()) {
                showError('Arquivo CSV vazio');
                return;
            }

            const { createCSVConfigPanel } = await import('../../import_export/csv/index.js');

            const panelResult = createCSVConfigPanel({
                csvText,
                fileName: file.name.replace(/\.[^/.]+$/, ''),
                onImport: async (geoJSON, layerName) => {
                    const count = await this._importControl.importGeoJSON(geoJSON, layerName);
                    const word = count === 1 ? 'ponto importado' : 'pontos importados';
                    showSuccess(`${count} ${word} com sucesso`);
                    if (this._onHideToolPanel) {
                        this._onHideToolPanel();
                    }
                },
            });

            this._onShowToolPanel(
                panelResult.element,
                'Importar CSV',
                panelResult.cleanup,
                () => panelResult.cleanup()
            );
        } catch (error) {
            console.error('CSV import error:', error);
            showError(`Erro ao processar CSV: ${error.message}`);
        }
    }

    /**
     * Creates a button to open the batch points panel in the sidebar.
     * @private
     * @returns {HTMLElement}
     */
    _createBatchPointsButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'import-option-btn';

        btn.innerHTML = `
            <div class="import-option-icon" style="background: #ec4899">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div class="import-option-info">
                <div class="import-option-name">Pontos por Coordenadas</div>
                <div class="import-option-desc">Criar vários pontos informando coordenadas</div>
            </div>
        `;

        addDomListener(this, btn, 'click', async () => {
            if (isCurrentMapLockedSync()) {
                showError('Mapa bloqueado');
                return;
            }
            if (this._is3DViewerOpen) {
                showError('Importação desabilitada no modo 3D');
                return;
            }
            await this._openBatchPointsPanel();
        });

        return btn;
    }

    /**
     * Opens the batch points panel in the sidebar tool panel area.
     * @private
     */
    async _openBatchPointsPanel() {
        if (!this._onShowToolPanel) {
            showError('Painel não disponível');
            return;
        }

        try {
            const { createBatchPointsPanel } = await import('@modals/batch-points.modal.js');

            const panelResult = createBatchPointsPanel({
                onSuccess: () => {
                    if (this._onHideToolPanel) {
                        this._onHideToolPanel();
                    }
                },
            });

            this._onShowToolPanel(
                panelResult.element,
                'Pontos por Coordenadas',
                panelResult.cleanup,
                () => panelResult.cleanup()
            );
        } catch (error) {
            console.error('Batch points panel error:', error);
            showError('Erro ao abrir painel');
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
        this._fileInput = null;
        this._optionsContainer = null;
    }
}
