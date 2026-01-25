// Path: js/sidebar/tabs/export.tab.js

/**
 * @fileoverview Export tab component for sidebar.
 * Provides export functionality for PDF, screenshots, and project files.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';
import { showSuccess as _showSuccess, showError } from '../../utilities/index.js';

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
    image: {
        id: 'image',
        name: 'Exportar Imagem',
        description: 'Capturar screenshot do mapa atual',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    },
};

/**
 * Export tab component.
 */
export class ExportTab {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.pdfExportTab - PDFExportTab instance
     * @param {Object} dependencies.screenshotControl - ScreenshotControl instance
     * @param {Object} dependencies.exportImportService - ExportImportService instance
     * @param {Object} dependencies.eventBus - EventBus instance
     */
    constructor(dependencies) {
        this._pdfExportTab = dependencies.pdfExportTab;
        this._screenshotControl = dependencies.screenshotControl;
        this._exportImportService = dependencies.exportImportService;
        this._eventBus = dependencies.eventBus;

        this._container = null;
        this._pdfContentExpanded = false;
        this._pdfContentContainer = null;

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
        const pdfOption = this._createExportOption(EXPORT_OPTIONS.pdf, () => this._togglePdfContent());
        container.appendChild(pdfOption);

        // PDF expanded content container
        this._pdfContentContainer = document.createElement('div');
        this._pdfContentContainer.className = 'export-pdf-content';
        this._pdfContentContainer.dataset.visible = 'false';
        container.appendChild(this._pdfContentContainer);

        // Image Export option
        const imageOption = this._createExportOption(EXPORT_OPTIONS.image, () => this._handleImageExport());
        container.appendChild(imageOption);

        return container;
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
     * Toggles the PDF export content.
     * @private
     */
    _togglePdfContent() {
        this._pdfContentExpanded = !this._pdfContentExpanded;
        this._pdfContentContainer.dataset.visible = this._pdfContentExpanded.toString();

        // Update arrow direction
        const pdfBtn = this._container.querySelector('#export-option-pdf');
        const arrow = pdfBtn?.querySelector('.export-option-arrow svg');
        if (arrow) {
            arrow.style.transform = this._pdfContentExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
        }

        if (this._pdfContentExpanded && this._pdfExportTab) {
            this._renderPdfContent();
        } else if (!this._pdfContentExpanded && this._pdfExportTab) {
            // Hide the PDF preview on map when collapsing
            if (this._pdfExportTab.hide) {
                this._pdfExportTab.hide();
            }
        }
    }

    /**
     * Renders the PDF export content.
     * @private
     */
    _renderPdfContent() {
        if (!this._pdfExportTab || !this._pdfContentContainer) return;

        // Clear existing content
        this._pdfContentContainer.innerHTML = '';

        // Try to get UI from PDFExportTab
        if (this._pdfExportTab.createUI) {
            const pdfUIString = this._pdfExportTab.createUI();
            // createUI returns HTML string, need to parse it
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = pdfUIString;
            this._pdfContentContainer.appendChild(tempDiv);

            // Activate the PDF preview on map
            if (this._pdfExportTab.show) {
                this._pdfExportTab.show();
            }

            // Setup event listeners for the PDF controls
            this._setupPdfControls();
        } else {
            // Fallback: create simple export button
            this._createFallbackPdfUI();
        }
    }

    /**
     * Sets up event listeners for PDF export controls.
     * @private
     */
    _setupPdfControls() {
        // Orientation buttons
        const orientationBtns = this._pdfContentContainer.querySelectorAll('.orientation-button');
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

        // Scale select
        const scaleSelect = this._pdfContentContainer.querySelector('#pdf-scale-select, .scale-select');
        if (scaleSelect) {
            addDomListener(this, scaleSelect, 'change', (e) => {
                if (this._pdfExportTab) {
                    this._pdfExportTab.scale = e.target.value;
                    if (this._pdfExportTab.updatePreview) {
                        this._pdfExportTab.updatePreview();
                    }
                }
            });
        }

        // Export button
        const exportBtn = this._pdfContentContainer.querySelector('.export-button, #pdf-export-btn');
        if (exportBtn) {
            addDomListener(this, exportBtn, 'click', () => {
                if (this._pdfExportTab.onExportClick) {
                    this._pdfExportTab.onExportClick();
                }
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
                    <div class="pdf-orientation-btns" style="display: flex; gap: var(--space-2); margin-bottom: var(--space-3);">
                        <button class="sidebar-action-btn orientation-btn active" data-orientation="landscape" style="flex: 1; justify-content: center;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/></svg>
                            <span>Paisagem</span>
                        </button>
                        <button class="sidebar-action-btn orientation-btn" data-orientation="portrait" style="flex: 1; justify-content: center;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/></svg>
                            <span>Retrato</span>
                        </button>
                    </div>
                </div>
                <div class="pdf-option-group" style="margin-bottom: var(--space-3);">
                    <label class="pdf-option-label" style="font-size: var(--font-size-sm); color: var(--gray-600); margin-bottom: var(--space-1); display: block;">Escala</label>
                    <select class="pdf-scale-select" style="width: 100%; padding: var(--space-2); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
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
                <button class="sidebar-action-btn pdf-export-btn" id="pdf-export-btn" style="width: 100%; justify-content: center; background: var(--primary); color: white; border-color: var(--primary);">
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
     * @private
     */
    async _handleImageExport() {
        if (!this._screenshotControl) {
            showError('Serviço de captura não disponível');
            return;
        }

        // Check if screenshotControl has a valid map reference
        if (!this._screenshotControl.map) {
            showError('Mapa não disponível para captura');
            return;
        }

        try {
            await this._screenshotControl.takeScreenshot();
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
     * Destroys the component.
     */
    destroy() {
        // Hide PDF preview if it was active
        if (this._pdfExportTab && this._pdfExportTab.hide) {
            this._pdfExportTab.hide();
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._pdfContentContainer = null;
    }
}
