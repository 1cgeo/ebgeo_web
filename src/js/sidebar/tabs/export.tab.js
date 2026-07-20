// Path: js/sidebar/tabs/export.tab.js

/**
 * @fileoverview Export tab component for sidebar.
 * Provides export functionality for PDF, screenshots, and project files.
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
import { isStreetView360Open } from '@utils/streetview360-state.js';

/**
 * Export option configurations.
 */
const EXPORT_OPTIONS = {
    pdf: {
        id: 'pdf',
        name: 'Exportar PDF',
        description: 'Gerar documento PDF do mapa',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    },
    garmin: {
        id: 'garmin',
        name: 'Exportar para Garmin',
        description: 'Gerar mapa para GPS Garmin',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/><path d="M2 16l3 3 3-3"/><path d="M22 16l-3 3-3-3"/></svg>`,
    },
    kmz: {
        id: 'kmz',
        name: 'Exportar KMZ',
        description: 'Mapa vetorial para Google Earth',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    },
    image: {
        id: 'image',
        name: 'Exportar Imagem',
        description: 'Capturar imagem do mapa atual',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    },
};

/**
 * Export tab component.
 */
export class ExportTab {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {maplibregl.Map} dependencies.map - The main MapLibre map instance
     * @param {Object} dependencies.pdfExportTab - PDFExportTab instance
     * @param {Object} dependencies.screenshotControl - ScreenshotControl instance
     * @param {Object} dependencies.exportImportService - ExportImportService instance
     * @param {Object} dependencies.eventBus - EventBus instance
     */
    constructor(dependencies) {
        this._map = dependencies.map;
        this._pdfExportTab = dependencies.pdfExportTab;
        this._screenshotControl = dependencies.screenshotControl;
        this._exportImportService = dependencies.exportImportService;
        this._eventBus = dependencies.eventBus;

        this._container = null;
        this._pdfContentExpanded = false;
        this._pdfContentContainer = null;
        this._pdfOptionButton = null;
        this._imageOptionButton = null;
        this._garminOptionButton = null;
        this._garminContentExpanded = false;
        this._garminContentContainer = null;
        this._garminExport = null;
        this._kmzOptionButton = null;
        this._kmzContentExpanded = false;
        this._kmzContentContainer = null;
        this._kmzSection = null;
        this._is3DViewerOpen = false;
        this._is360ViewerOpen = false;

        setupCleanup(this);
    }

    /**
     * Creates the tab UI.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-tab-content export-tab';

        // Export options
        const optionsContainer = this._createExportOptions();
        this._container.appendChild(optionsContainer);

        return this._container;
    }

    /**
     * Creates the export options.
     * @private
     * @returns {HTMLElement}
     */
    _createExportOptions() {
        const container = document.createElement('div');
        container.className = 'export-options';

        // PDF Export option
        this._pdfOptionButton = this._createExportOption(EXPORT_OPTIONS.pdf, () => this._togglePdfContent());
        container.appendChild(this._pdfOptionButton);

        // PDF expanded content container
        this._pdfContentContainer = document.createElement('div');
        this._pdfContentContainer.className = 'export-pdf-content';
        this._pdfContentContainer.dataset.visible = 'false';
        container.appendChild(this._pdfContentContainer);

        // Garmin KMZ Export option
        this._garminOptionButton = this._createExportOption(EXPORT_OPTIONS.garmin, () => this._toggleGarminContent());
        container.appendChild(this._garminOptionButton);

        // Garmin expanded content container
        this._garminContentContainer = document.createElement('div');
        this._garminContentContainer.className = 'export-garmin-content';
        this._garminContentContainer.dataset.visible = 'false';
        container.appendChild(this._garminContentContainer);

        // KMZ Export option
        this._kmzOptionButton = this._createExportOption(EXPORT_OPTIONS.kmz, () => this._toggleKmzContent());
        container.appendChild(this._kmzOptionButton);

        // KMZ expanded content container
        this._kmzContentContainer = document.createElement('div');
        this._kmzContentContainer.className = 'export-kmz-content';
        this._kmzContentContainer.dataset.visible = 'false';
        container.appendChild(this._kmzContentContainer);

        // Image Export option
        this._imageOptionButton = this._createExportOption(EXPORT_OPTIONS.image, () => this._handleImageExport());
        container.appendChild(this._imageOptionButton);

        // Setup 3D viewer state listeners
        this._setup3DViewerListeners();

        // Setup 360 viewer state listeners
        this._setup360ViewerListeners();

        // Check initial 3D and 360 state
        this._is3DViewerOpen = isViewer3DOpen();
        this._is360ViewerOpen = isStreetView360Open();
        this._updateViewerModeUI();

        return container;
    }

    /**
     * Sets up listeners for 3D viewer state changes.
     * @private
     */
    _setup3DViewerListeners() {
        if (!this._eventBus) return;

        subscribe(this, this._eventBus, EventTypes.VIEWER_3D_OPENED, () => {
            this._is3DViewerOpen = true;
            this._updateViewerModeUI();
        });

        subscribe(this, this._eventBus, EventTypes.VIEWER_3D_CLOSED, () => {
            this._is3DViewerOpen = false;
            this._updateViewerModeUI();
        });
    }

    /**
     * Sets up listeners for 360 viewer state changes.
     * @private
     */
    _setup360ViewerListeners() {
        if (!this._eventBus) return;

        subscribe(this, this._eventBus, EventTypes.STREETVIEW_360_OPENED, () => {
            this._is360ViewerOpen = true;
            this._updateViewerModeUI();
        });

        subscribe(this, this._eventBus, EventTypes.STREETVIEW_360_CLOSED, () => {
            this._is360ViewerOpen = false;
            this._updateViewerModeUI();
        });
    }

    /**
     * Updates UI based on 3D or 360 viewer mode.
     * Disables PDF export when either viewer is open.
     * Updates image export description based on mode.
     * @private
     */
    _updateViewerModeUI() {
        if (!this._pdfOptionButton) return;

        const isSpecialViewerOpen = this._is3DViewerOpen || this._is360ViewerOpen;

        // Update image export description based on viewer state
        if (this._imageOptionButton) {
            const descElement = this._imageOptionButton.querySelector('.export-option-desc');
            if (descElement) {
                if (this._is3DViewerOpen) {
                    descElement.textContent = 'Capturar imagem do modelo 3D';
                } else if (this._is360ViewerOpen) {
                    descElement.textContent = 'Capturar imagem da visualização 360';
                } else {
                    descElement.textContent = 'Capturar imagem do mapa atual';
                }
            }
        }

        if (isSpecialViewerOpen) {
            // Disable PDF export option
            this._pdfOptionButton.classList.add('disabled-3d-mode');

            // If PDF content was expanded, collapse it
            if (this._pdfContentExpanded) {
                this._collapsePdfContent();
            }

            // Disable Garmin export option
            if (this._garminOptionButton) {
                this._garminOptionButton.classList.add('disabled-3d-mode');
            }
            if (this._garminContentExpanded) {
                this._collapseGarminContent();
            }

            // Disable vector KMZ export option
            if (this._kmzOptionButton) {
                this._kmzOptionButton.classList.add('disabled-3d-mode');
            }
            if (this._kmzContentExpanded) {
                this._collapseKmzContent();
            }
        } else {
            // Re-enable PDF export option
            this._pdfOptionButton.classList.remove('disabled-3d-mode');
            // Re-enable Garmin export option
            if (this._garminOptionButton) {
                this._garminOptionButton.classList.remove('disabled-3d-mode');
            }
            // Re-enable vector KMZ export option
            if (this._kmzOptionButton) {
                this._kmzOptionButton.classList.remove('disabled-3d-mode');
            }
        }
    }

    /**
     * Creates an export option button.
     * @private
     * @param {Object} option - Option configuration
     * @param {Function} handler - Click handler
     * @returns {HTMLElement}
     */
    _createExportOption(option, handler) {
        const button = document.createElement('button');
        button.className = 'export-option-btn';
        button.id = `export-option-${option.id}`;

        button.innerHTML = `
            <div class="export-option-icon">
                ${option.icon}
            </div>
            <div class="export-option-info">
                <div class="export-option-name">${option.name}</div>
                <div class="export-option-desc">${option.description}</div>
            </div>
            <div class="export-option-arrow">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
        `;

        addDomListener(this, button, 'click', handler);

        return button;
    }

    /**
     * Checks if a 3D or 360 viewer is open, blocking export.
     * @param {string} exportName - Export type name for the error message
     * @returns {boolean} true if blocked
     * @private
     */
    _isViewerBlocked(exportName) {
        if (this._is3DViewerOpen) {
            showError(`Exportar ${exportName} desabilitado no modo 3D`);
            return true;
        }
        if (this._is360ViewerOpen) {
            showError(`Exportar ${exportName} desabilitado no modo 360`);
            return true;
        }
        return false;
    }

    /**
     * Toggles the PDF export content.
     * @private
     */
    _togglePdfContent() {
        if (this._isViewerBlocked('PDF')) return;

        this._pdfContentExpanded = !this._pdfContentExpanded;
        this._pdfContentContainer.dataset.visible = this._pdfContentExpanded.toString();

        // Update arrow direction
        const arrow = this._pdfOptionButton?.querySelector('.export-option-arrow svg');
        if (arrow) {
            arrow.style.transform = this._pdfContentExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
        }

        if (this._pdfContentExpanded && this._pdfExportTab) {
            this._renderPdfContent();
        } else if (!this._pdfContentExpanded && this._pdfExportTab) {
            this._hidePdfPreview();
        }
    }

    /**
     * Collapses PDF content and hides preview.
     * @private
     */
    _collapsePdfContent() {
        this._pdfContentExpanded = false;
        if (this._pdfContentContainer) {
            this._pdfContentContainer.dataset.visible = 'false';
        }
        const arrow = this._pdfOptionButton?.querySelector('.export-option-arrow svg');
        if (arrow) {
            arrow.style.transform = 'rotate(0deg)';
        }
        this._hidePdfPreview();
    }

    /**
     * Hides the PDF preview from the map.
     * @private
     */
    _hidePdfPreview() {
        if (!this._pdfExportTab || !this._pdfExportTab.map) return;

        this._pdfExportTab.isVisible = false;
        if (this._pdfExportTab.hidePreview) {
            this._pdfExportTab.hidePreview();
        }
        this._pdfExportTab.map.off('move', this._pdfExportTab.onMapMove);
    }

    // ===== VECTOR KMZ EXPORT =====

    /**
     * Toggles the vector KMZ export content.
     * @private
     */
    _toggleKmzContent() {
        if (this._isViewerBlocked('KMZ')) return;

        this._kmzContentExpanded = !this._kmzContentExpanded;
        this._kmzContentContainer.dataset.visible = this._kmzContentExpanded.toString();

        const arrow = this._kmzOptionButton?.querySelector('.export-option-arrow svg');
        if (arrow) {
            arrow.style.transform = this._kmzContentExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
        }

        if (this._kmzContentExpanded) {
            this._renderKmzContent();
        }
    }

    /**
     * Builds the KMZ panel on first expansion.
     * @private
     */
    async _renderKmzContent() {
        if (this._kmzSection) return;

        const { KmzExportSection } = await import('./kmz-export.section.js');
        this._kmzSection = new KmzExportSection({ container: this._kmzContentContainer });
        await this._kmzSection.render();
    }

    /**
     * Collapses the KMZ content.
     * @private
     */
    _collapseKmzContent() {
        this._kmzContentExpanded = false;
        if (this._kmzContentContainer) {
            this._kmzContentContainer.dataset.visible = 'false';
        }
        const arrow = this._kmzOptionButton?.querySelector('.export-option-arrow svg');
        if (arrow) {
            arrow.style.transform = 'rotate(0deg)';
        }
    }

    // ===== GARMIN KMZ EXPORT =====

    /**
     * Toggles the Garmin KMZ export content.
     * @private
     */
    _toggleGarminContent() {
        if (this._isViewerBlocked('Garmin')) return;

        this._garminContentExpanded = !this._garminContentExpanded;
        this._garminContentContainer.dataset.visible = this._garminContentExpanded.toString();

        const arrow = this._garminOptionButton?.querySelector('.export-option-arrow svg');
        if (arrow) {
            arrow.style.transform = this._garminContentExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
        }

        if (this._garminContentExpanded) {
            this._renderGarminContent();
        } else {
            this._hideGarminPreview();
        }
    }

    /**
     * Collapses Garmin content and hides preview.
     * @private
     */
    _collapseGarminContent() {
        this._garminContentExpanded = false;
        if (this._garminContentContainer) {
            this._garminContentContainer.dataset.visible = 'false';
        }
        const arrow = this._garminOptionButton?.querySelector('.export-option-arrow svg');
        if (arrow) {
            arrow.style.transform = 'rotate(0deg)';
        }
        this._hideGarminPreview();
    }

    /**
     * Renders the Garmin export panel content.
     * @private
     */
    _renderGarminContent() {
        if (!this._garminContentContainer) return;

        this._garminContentContainer.innerHTML = `
            <div class="garmin-export-container">
                <div class="garmin-export-instructions">
                    Clique em "Selecionar Area" e depois clique dois pontos no mapa
                    para definir a area de exportacao.
                </div>

                <button class="garmin-export-select-btn" id="garmin-select-area-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>
                    <span>Selecionar Area</span>
                </button>

                <div class="garmin-export-info" id="garmin-tile-info">
                </div>

                <div class="garmin-export-actions" id="garmin-export-actions">
                    <button class="garmin-export-btn" id="garmin-export-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        <span>Exportar KMZ</span>
                    </button>
                    <button class="garmin-export-clear-btn" id="garmin-clear-btn">
                        Limpar
                    </button>
                </div>
            </div>
        `;

        this._setupGarminEventListeners();
    }

    /**
     * Sets up event listeners for Garmin export controls.
     * @private
     */
    _setupGarminEventListeners() {
        const selectBtn = this._garminContentContainer.querySelector('#garmin-select-area-btn');
        if (selectBtn) {
            addDomListener(this, selectBtn, 'click', () => this._handleGarminSelectArea());
        }

        const exportBtn = this._garminContentContainer.querySelector('#garmin-export-btn');
        if (exportBtn) {
            addDomListener(this, exportBtn, 'click', () => this._handleGarminExport());
        }

        const clearBtn = this._garminContentContainer.querySelector('#garmin-clear-btn');
        if (clearBtn) {
            addDomListener(this, clearBtn, 'click', () => this._handleGarminClear());
        }
    }

    /**
     * Ensures the GarminKmzExport instance exists.
     * @private
     * @returns {Promise<import('../../import_export/garmin-kmz-export.js').GarminKmzExport>}
     */
    async _ensureGarminExport() {
        if (!this._garminExport) {
            if (!this._map) {
                showError('Mapa nao disponivel');
                return null;
            }
            const { GarminKmzExport } = await import('../../import_export/garmin-kmz-export.js');
            this._garminExport = new GarminKmzExport(this._map);
        }
        return this._garminExport;
    }

    /**
     * Handles the "Selecionar Area" button click.
     * @private
     */
    async _handleGarminSelectArea() {
        const exporter = await this._ensureGarminExport();
        if (!exporter) return;

        const selectBtn = this._garminContentContainer.querySelector('#garmin-select-area-btn');

        if (exporter.isDrawing()) {
            exporter.cancelDrawing();
            if (selectBtn) {
                selectBtn.querySelector('span').textContent = 'Selecionar Area';
            }
            return;
        }

        if (selectBtn) {
            selectBtn.querySelector('span').textContent = 'Cancelar Selecao';
        }

        // Hide existing info while redrawing
        const infoEl = this._garminContentContainer.querySelector('#garmin-tile-info');
        const actionsEl = this._garminContentContainer.querySelector('#garmin-export-actions');
        if (infoEl) infoEl.classList.remove('garmin-export-info--visible');
        if (actionsEl) actionsEl.classList.remove('garmin-export-actions--visible');

        exporter.startBboxDrawing(() => {
            if (selectBtn) {
                selectBtn.querySelector('span').textContent = 'Redesenhar Area';
            }
            this._updateGarminTileInfo();
        });
    }

    /**
     * Updates the tile info display after bbox selection.
     * @private
     */
    _updateGarminTileInfo() {
        if (!this._garminExport?.hasBbox()) return;

        const info = this._garminExport.getTileInfo();
        if (!info) return;

        const infoEl = this._garminContentContainer.querySelector('#garmin-tile-info');
        const actionsEl = this._garminContentContainer.querySelector('#garmin-export-actions');

        if (infoEl) {
            infoEl.classList.add('garmin-export-info--visible');
            infoEl.innerHTML = `
                <div class="garmin-info-row">
                    <span class="garmin-info-label">Tiles:</span>
                    <span class="garmin-info-value">${info.cols} x ${info.rows} (${info.total} de 100)</span>
                </div>
            `;
        }

        if (actionsEl) {
            actionsEl.classList.add('garmin-export-actions--visible');
        }
    }

    /**
     * Handles the "Exportar KMZ" button click.
     * @private
     */
    async _handleGarminExport() {
        if (!this._garminExport?.hasBbox()) {
            showError('Selecione uma area no mapa primeiro');
            return;
        }
        await this._garminExport.exportKmz();
    }

    /**
     * Handles the "Limpar" button click.
     * @private
     */
    _handleGarminClear() {
        if (this._garminExport) {
            this._garminExport.clearBbox();
        }

        const selectBtn = this._garminContentContainer.querySelector('#garmin-select-area-btn');
        if (selectBtn) {
            selectBtn.querySelector('span').textContent = 'Selecionar Area';
        }

        const infoEl = this._garminContentContainer.querySelector('#garmin-tile-info');
        const actionsEl = this._garminContentContainer.querySelector('#garmin-export-actions');
        if (infoEl) infoEl.classList.remove('garmin-export-info--visible');
        if (actionsEl) actionsEl.classList.remove('garmin-export-actions--visible');
    }

    /**
     * Hides the Garmin preview from the map.
     * @private
     */
    _hideGarminPreview() {
        if (this._garminExport) {
            this._garminExport.destroy();
            this._garminExport = null;
        }
    }

    // ===== PDF EXPORT =====

    /**
     * Renders the PDF export content.
     * @private
     */
    _renderPdfContent() {
        if (!this._pdfExportTab || !this._pdfContentContainer) return;

        // Reset cartographic state so fresh checkboxes match the state
        this._pdfExportTab.showTitle = false;
        this._pdfExportTab.mapTitle = '';
        this._pdfExportTab.showLegend = false;
        this._pdfExportTab.showScaleBar = false;
        this._pdfExportTab.showNorthArrow = false;
        this._pdfExportTab.showLatLongGrid = false;
        this._pdfExportTab.showUTMGrid = false;
        this._pdfExportTab.dpi = 300;
        this._pdfExportTab.rows = 1;
        this._pdfExportTab.cols = 1;

        // Clear existing content
        this._pdfContentContainer.innerHTML = '';

        // Try to get UI from PDFExportTab
        if (this._pdfExportTab.createUI) {
            const pdfUIString = this._pdfExportTab.createUI();
            // createUI returns HTML string, insert directly without wrapper
            this._pdfContentContainer.innerHTML = pdfUIString;

            // Show the preview on the map (adds source and layers)
            this._pdfExportTab.isVisible = true;
            this._pdfExportTab.showPreview();

            // Calculate bounds using visible center from the start
            // This ensures the polygon appears in the correct position immediately
            this._pdfExportTab.updateBounds();
            this._pdfExportTab.zoomToPreviewArea();

            this._pdfExportTab.map.on('move', this._pdfExportTab.onMapMove);

            // Setup event listeners manually since we control the DOM here
            this._setupPdfEventListeners();

            // Sync mosaic-dependent UI (count, hint, disabled options) with state
            this._pdfExportTab._updateMosaicUIState();
        } else {
            // Fallback: create simple export button
            this._createFallbackPdfUI();
        }
    }

    /**
     * Sets up event listeners for PDF export controls.
     * @private
     */
    _setupPdfEventListeners() {
        // Scale select
        const scaleSelect = this._pdfContentContainer.querySelector('#pdf-scale-select');
        if (scaleSelect) {
            addDomListener(this, scaleSelect, 'change', (e) => {
                if (this._pdfExportTab) {
                    this._pdfExportTab.scale = e.target.value;
                    this._pdfExportTab._enforceUTMGridAvailability();
                    this._pdfExportTab.updateBounds();
                    this._pdfExportTab.zoomToPreviewArea();
                }
            });
        }

        // DPI quality select
        const dpiSelect = this._pdfContentContainer.querySelector('#pdf-dpi-select');
        if (dpiSelect) {
            addDomListener(this, dpiSelect, 'change', (e) => {
                if (this._pdfExportTab) {
                    this._pdfExportTab.dpi = parseInt(e.target.value, 10);
                }
            });
        }

        // Orientation radio buttons
        const orientationInputs = this._pdfContentContainer.querySelectorAll('input[name="pdf-orientation"]');
        orientationInputs.forEach(input => {
            addDomListener(this, input, 'change', (e) => {
                if (this._pdfExportTab) {
                    this._pdfExportTab.orientation = e.target.value;
                    this._pdfExportTab.updateBounds();
                    this._pdfExportTab.zoomToPreviewArea();
                }
            });
        });

        // Mosaic rows / columns
        const rowsSelect = this._pdfContentContainer.querySelector('#pdf-rows-select');
        if (rowsSelect) {
            addDomListener(this, rowsSelect, 'change', (e) => {
                if (this._pdfExportTab) this._pdfExportTab.onRowsChange(e);
            });
        }
        const colsSelect = this._pdfContentContainer.querySelector('#pdf-cols-select');
        if (colsSelect) {
            addDomListener(this, colsSelect, 'change', (e) => {
                if (this._pdfExportTab) this._pdfExportTab.onColsChange(e);
            });
        }

        // Export button
        const exportBtn = this._pdfContentContainer.querySelector('#pdf-export-btn');
        if (exportBtn) {
            addDomListener(this, exportBtn, 'click', () => {
                if (this._pdfExportTab && this._pdfExportTab.onExportClick) {
                    this._pdfExportTab.onExportClick();
                } else {
                    showError('Serviço de exportação PDF não disponível');
                }
            });
        }

        // Cartographic element checkboxes
        this._setupCartographicListeners();
    }

    /**
     * Sets up event listeners for cartographic layout options.
     * @private
     */
    _setupCartographicListeners() {
        if (!this._pdfExportTab || !this._pdfContentContainer) return;

        const titleCheckbox = this._pdfContentContainer.querySelector('#pdf-show-title');
        const titleInput = this._pdfContentContainer.querySelector('#pdf-map-title');
        const legendCheckbox = this._pdfContentContainer.querySelector('#pdf-show-legend');
        const scalebarCheckbox = this._pdfContentContainer.querySelector('#pdf-show-scalebar');
        const northCheckbox = this._pdfContentContainer.querySelector('#pdf-show-north');

        if (titleCheckbox) {
            addDomListener(this, titleCheckbox, 'change', (e) => {
                this._pdfExportTab.showTitle = e.target.checked;
                if (titleInput) {
                    titleInput.disabled = !e.target.checked;
                    if (e.target.checked) titleInput.focus();
                }
            });
        }
        if (titleInput) {
            addDomListener(this, titleInput, 'input', (e) => {
                this._pdfExportTab.mapTitle = e.target.value;
            });
        }
        if (legendCheckbox) {
            addDomListener(this, legendCheckbox, 'change', (e) => {
                this._pdfExportTab.showLegend = e.target.checked;
            });
        }
        if (scalebarCheckbox) {
            addDomListener(this, scalebarCheckbox, 'change', (e) => {
                this._pdfExportTab.showScaleBar = e.target.checked;
            });
        }
        if (northCheckbox) {
            addDomListener(this, northCheckbox, 'change', (e) => {
                this._pdfExportTab.showNorthArrow = e.target.checked;
            });
        }

        const latlongGridCheckbox = this._pdfContentContainer.querySelector('#pdf-show-latlong-grid');
        const utmGridCheckbox = this._pdfContentContainer.querySelector('#pdf-show-utm-grid');

        if (latlongGridCheckbox) {
            addDomListener(this, latlongGridCheckbox, 'change', (e) => {
                this._pdfExportTab.showLatLongGrid = e.target.checked;
            });
        }
        if (utmGridCheckbox) {
            addDomListener(this, utmGridCheckbox, 'change', (e) => {
                this._pdfExportTab.showUTMGrid = e.target.checked;
            });
        }

    }

    /**
     * Creates fallback PDF export UI when PDFExportTab doesn't provide createUI.
     * @private
     */
    _createFallbackPdfUI() {
        this._pdfContentContainer.innerHTML = `
            <div class="pdf-export-fallback">
                <div class="pdf-option-group">
                    <label class="pdf-option-label">Orientação</label>
                    <div class="pdf-orientation-btns">
                        <button class="sidebar-action-btn orientation-btn active" data-orientation="landscape">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/></svg>
                            <span>Paisagem</span>
                        </button>
                        <button class="sidebar-action-btn orientation-btn" data-orientation="portrait">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/></svg>
                            <span>Retrato</span>
                        </button>
                    </div>
                </div>
                <div class="pdf-option-group pdf-option-group--spaced">
                    <label class="pdf-option-label pdf-option-label--block">Escala</label>
                    <select class="pdf-scale-select">
                        <option value="1:1000">1:1.000</option>
                        <option value="1:5000">1:5.000</option>
                        <option value="1:10000">1:10.000</option>
                        <option value="1:25000" selected>1:25.000</option>
                        <option value="1:50000">1:50.000</option>
                        <option value="1:100000">1:100.000</option>
                        <option value="1:250000">1:250.000</option>
                        <option value="1:500000">1:500.000</option>
                        <option value="1:1000000">1:1.000.000</option>
                    </select>
                </div>
                <button class="sidebar-action-btn pdf-export-btn--full" id="pdf-export-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>Gerar PDF</span>
                </button>
            </div>
        `;

        // Setup orientation buttons
        const orientationBtns = this._pdfContentContainer.querySelectorAll('.orientation-btn');
        orientationBtns.forEach(btn => {
            addDomListener(this, btn, 'click', () => {
                orientationBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (this._pdfExportTab) {
                    this._pdfExportTab.orientation = btn.dataset.orientation;
                    if (this._pdfExportTab.updatePreview) {
                        this._pdfExportTab.updatePreview();
                    }
                }
            });
        });

        // Setup scale select
        const scaleSelect = this._pdfContentContainer.querySelector('.pdf-scale-select');
        if (scaleSelect) {
            addDomListener(this, scaleSelect, 'change', (e) => {
                if (this._pdfExportTab) {
                    this._pdfExportTab.scale = e.target.value;
                    this._pdfExportTab._enforceUTMGridAvailability();
                    if (this._pdfExportTab.updatePreview) {
                        this._pdfExportTab.updatePreview();
                    }
                }
            });
        }

        // Setup export button
        const exportBtn = this._pdfContentContainer.querySelector('#pdf-export-btn');
        if (exportBtn) {
            addDomListener(this, exportBtn, 'click', () => {
                if (this._pdfExportTab && this._pdfExportTab.onExportClick) {
                    this._pdfExportTab.onExportClick();
                } else {
                    showError('Serviço de exportação PDF não disponível');
                }
            });
        }

        // Show PDF preview on map
        if (this._pdfExportTab && this._pdfExportTab.show) {
            this._pdfExportTab.show();
        }
    }

    /**
     * Handles image/screenshot export.
     * Uses 3D screenshot when 3D viewer is open, 360 screenshot when 360 viewer is open,
     * otherwise uses 2D map screenshot.
     * @private
     */
    async _handleImageExport() {
        try {
            if (this._is3DViewerOpen) {
                // Use 3D screenshot - dynamically import to avoid circular dependency
                const { take3DScreenshot } = await import('../../3d_models_viewer_tool/map_3d.js');
                const success = await take3DScreenshot();
                if (success) {
                    showSuccess('Screenshot 3D capturado com sucesso');
                } else {
                    showError('Erro ao capturar screenshot 3D');
                }
            } else if (this._is360ViewerOpen) {
                // Use 360 screenshot - dynamically import to avoid circular dependency
                // Note: takeScreenshot360 handles its own success/error messages
                const { takeScreenshot360 } = await import('../../street_view_tool/tools/screenshot_tool_360.js');
                await takeScreenshot360();
            } else {
                // Use 2D map screenshot
                if (!this._screenshotControl) {
                    showError('Serviço de captura não disponível');
                    return;
                }

                if (!this._screenshotControl.map) {
                    showError('Mapa não disponível para captura');
                    return;
                }

                await this._screenshotControl.takeScreenshot();
            }
        } catch (error) {
            console.error('Screenshot error:', error);
            showError('Erro ao capturar imagem');
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
        // Refresh PDF content if expanded
        if (this._pdfContentExpanded) {
            this._renderPdfContent();
        }
    }

    /**
     * Called when the tab is deactivated (switching to another tab or sidebar closes).
     * Hides the PDF preview if it was active.
     */
    onDeactivate() {
        if (this._pdfContentExpanded) {
            this._collapsePdfContent();
        }
        if (this._garminContentExpanded) {
            this._collapseGarminContent();
        }
        if (this._kmzContentExpanded) {
            this._collapseKmzContent();
        }
    }

    /**
     * Destroys the component.
     */
    destroy() {
        // Hide PDF preview if it was active
        this._hidePdfPreview();

        // Cleanup Garmin export
        this._hideGarminPreview();

        // Cleanup vector KMZ panel listeners
        this._kmzSection?.destroy();
        this._kmzSection = null;

        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._pdfContentContainer = null;
        this._pdfOptionButton = null;
        this._imageOptionButton = null;
        this._garminOptionButton = null;
        this._garminContentContainer = null;
        this._kmzOptionButton = null;
        this._kmzContentContainer = null;
    }
}
