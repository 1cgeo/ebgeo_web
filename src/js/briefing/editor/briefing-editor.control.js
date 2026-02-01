// Path: js/briefing/editor/briefing-editor.control.js

/**
 * @fileoverview Main briefing editor control.
 * Provides full-screen editor for creating and editing briefings.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────┐
 * │ HEADER: [Briefing Name Input] [Salvar] [Voltar]          │
 * ├────────────────────┬─────────────────────────────────────┤
 * │ LEFT PANEL (400px) │ RIGHT PANEL (flex)                  │
 * │ - Settings         │ - Preview (map/3D/360)              │
 * │ - Slide List       │ - Capture Position Button           │
 * │ - Slide Editor     │                                     │
 * └────────────────────┴─────────────────────────────────────┘
 *
 * @module briefing/editor/briefing-editor.control
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
    trackTimer
} from '../../utilities/event-cleanup.js';
import {
    getBriefingById,
    updateBriefing,
    addSlide,
    removeSlide,
    reorderSlides,
    createEmptySlide,
    SlideMode,
    getAllMapNamesStore
} from '../../store/index.js';
import { EventTypes } from '../../events/event_types.js';
import { getEventBus } from '../../store/services.js';
import { showSuccess, showError, showWarning } from '../../utilities/index.js';
import { showConfirm } from '../../modals/index.js';
import { getApplicationModeManager, ApplicationMode } from '../../mode/application-mode.manager.js';
import { isViewer3DOpen } from '../../utilities/viewer3d-state.js';
import { isStreetView360Open } from '../../utilities/streetview360-state.js';
import config from '../../config.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const EDITOR_CONFIG = {
    LEFT_PANEL_WIDTH: 400,
    AUTOSAVE_DELAY: 1500,
    MIN_PANEL_WIDTH: 280,
    MAX_PANEL_WIDTH: 500
};

const EDITOR_ICONS = {
    back: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,

    save: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,

    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,

    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,

    grip: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`,

    map2d: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,

    viewer3d: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,

    viewer360: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,

    warning: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,

    capture: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,

    crosshair: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
};

/**
 * Mode labels in Portuguese.
 */
const MODE_LABELS = {
    [SlideMode.MAP_2D]: 'Mapa 2D',
    [SlideMode.VIEWER_3D]: 'Visualizador 3D',
    [SlideMode.VIEWER_360]: 'Foto 360°'
};

/**
 * Mode icons mapping.
 */
const MODE_ICONS = {
    [SlideMode.MAP_2D]: EDITOR_ICONS.map2d,
    [SlideMode.VIEWER_3D]: EDITOR_ICONS.viewer3d,
    [SlideMode.VIEWER_360]: EDITOR_ICONS.viewer360
};

// ============================================================================
// BRIEFING EDITOR CONTROL
// ============================================================================

/**
 * Briefing editor control class.
 * Manages the full-screen editor interface for briefings.
 */
export class BriefingEditorControl {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.map - MapLibre map instance
     * @param {Object} [dependencies.eventBus] - EventBus instance
     */
    constructor(dependencies = {}) {
        this._map = dependencies.map;
        this._eventBus = dependencies.eventBus || getEventBus();

        // State
        this._briefing = null;
        this._selectedSlideId = null;
        this._hasUnsavedChanges = false;
        this._isOpen = false;

        // DOM elements
        this._container = null;
        this._leftPanel = null;
        this._rightPanel = null;
        this._slideListEl = null;
        this._slideEditorEl = null;
        this._previewEl = null;
        this._nameInput = null;

        // Child components (will be created lazily)
        this._quillEditor = null;
        this._sortableInstance = null;

        // Timers
        this._autosaveTimer = null;

        // Callbacks
        this._onClose = null;

        setupCleanup(this);
    }

    /**
     * Sets callback for when editor closes.
     * @param {Function} callback - Callback function
     */
    setOnClose(callback) {
        this._onClose = callback;
    }

    /**
     * Opens the editor with a briefing.
     * @param {string} briefingId - Briefing ID to edit
     */
    async open(briefingId) {
        if (this._isOpen) {
            await this.close();
        }

        try {
            // Close 3D and 360 viewers if open
            await this._closeActiveViewers();

            // Load briefing data
            this._briefing = await getBriefingById(briefingId);
            if (!this._briefing) {
                showError('Briefing não encontrado');
                return;
            }

            // Enter edit mode
            const modeManager = getApplicationModeManager();
            modeManager.enterMode(ApplicationMode.BRIEFING_EDIT, {
                briefingId: this._briefing.id
            });

            // Create UI
            this._createUI();
            this._render();

            // Embed the map in the preview panel
            this._embedMapInPreview();

            // Select first slide if exists
            if (this._briefing.slides?.length > 0) {
                this._selectSlide(this._briefing.slides[0].id);
            }

            this._isOpen = true;

            // Emit event
            this._eventBus.emit(EventTypes.BRIEFING_EDIT_STARTED, {
                briefingId: this._briefing.id
            });

        } catch (error) {
            console.error('Error opening briefing editor:', error);
            showError('Erro ao abrir editor de briefing');
        }
    }

    /**
     * Closes the editor.
     * @param {boolean} [skipConfirm=false] - Skip unsaved changes confirmation
     */
    async close(skipConfirm = false) {
        if (!this._isOpen) return;

        // Check for unsaved changes
        if (this._hasUnsavedChanges && !skipConfirm) {
            const confirmed = await showConfirm(
                'Existem alterações não salvas. Deseja sair mesmo assim?',
                { destructive: true }
            );
            if (!confirmed) return;
        }

        // Clear autosave timer
        if (this._autosaveTimer) {
            clearTimeout(this._autosaveTimer);
            this._autosaveTimer = null;
        }

        // Exit edit mode
        const modeManager = getApplicationModeManager();
        modeManager.exitMode();

        // Destroy Sortable
        if (this._sortableInstance) {
            this._sortableInstance.destroy();
            this._sortableInstance = null;
        }

        // Restore map to original position
        this._restoreMapPosition();

        // Emit event
        this._eventBus.emit(EventTypes.BRIEFING_EDIT_ENDED, {
            briefingId: this._briefing?.id
        });

        // Cleanup UI
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._briefing = null;
        this._selectedSlideId = null;
        this._hasUnsavedChanges = false;
        this._isOpen = false;

        // Call close callback
        if (this._onClose) {
            this._onClose();
        }
    }

    /**
     * Closes any active 3D or 360 viewers before opening the editor.
     * @private
     */
    async _closeActiveViewers() {
        try {
            // Close 3D viewer if open
            if (isViewer3DOpen()) {
                const { closeViewer } = await import('../../3d_models_viewer_tool/map_3d.js');
                await closeViewer();
            }

            // Close 360 viewer if open
            if (isStreetView360Open()) {
                const { closeViewer360 } = await import('../../street_view_tool/street_view_viewer.js');
                await closeViewer360();
            }
        } catch (error) {
            console.warn('Error closing viewers:', error);
        }
    }

    /**
     * Creates the editor UI structure.
     * @private
     */
    _createUI() {
        // Main container
        this._container = document.createElement('div');
        this._container.className = 'briefing-editor';
        this._container.id = 'briefing-editor';

        // Prevent interactions from passing through
        addDomListener(this, this._container, 'click', (e) => e.stopPropagation());

        document.body.appendChild(this._container);
    }

    /**
     * Renders the editor content.
     * @private
     */
    _render() {
        this._container.innerHTML = '';

        // Content area (left + right panels) - no separate header
        const content = document.createElement('div');
        content.className = 'briefing-editor-content';

        // Left panel
        this._leftPanel = this._createLeftPanel();
        content.appendChild(this._leftPanel);

        // Right panel (preview)
        this._rightPanel = this._createRightPanel();
        content.appendChild(this._rightPanel);

        this._container.appendChild(content);

        // Initialize Sortable for slide list
        this._initSortable();
    }

    /**
     * Creates the panel header (inside left panel).
     * @private
     * @returns {HTMLElement}
     */
    _createPanelHeader() {
        const header = document.createElement('div');
        header.className = 'briefing-editor-panel-header';

        // Back button
        const backBtn = document.createElement('button');
        backBtn.className = 'briefing-editor-back-btn';
        backBtn.innerHTML = EDITOR_ICONS.back;
        backBtn.title = 'Voltar';
        addDomListener(this, backBtn, 'click', () => this.close());
        header.appendChild(backBtn);

        // Name input
        this._nameInput = document.createElement('input');
        this._nameInput.type = 'text';
        this._nameInput.className = 'briefing-editor-name-input';
        this._nameInput.value = this._briefing.name || '';
        this._nameInput.placeholder = 'Nome do Briefing';
        addDomListener(this, this._nameInput, 'input', () => this._onNameChange());
        addDomListener(this, this._nameInput, 'blur', () => this._save());
        header.appendChild(this._nameInput);

        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.className = 'briefing-editor-save-btn';
        saveBtn.innerHTML = EDITOR_ICONS.save;
        saveBtn.title = 'Salvar';
        addDomListener(this, saveBtn, 'click', () => this._save(true));
        header.appendChild(saveBtn);

        return header;
    }

    /**
     * Creates the left panel (header + scrollable content).
     * @private
     * @returns {HTMLElement}
     */
    _createLeftPanel() {
        const panel = document.createElement('div');
        panel.className = 'briefing-editor-left-panel';

        // Panel header with back button, name input, and save button
        const panelHeader = this._createPanelHeader();
        panel.appendChild(panelHeader);

        // Scrollable content container
        const scrollableContent = document.createElement('div');
        scrollableContent.className = 'briefing-editor-scrollable';

        // Settings section (collapsed for now, can expand later)
        const settingsSection = this._createSettingsSection();
        scrollableContent.appendChild(settingsSection);

        // Slides section
        const slidesSection = document.createElement('div');
        slidesSection.className = 'briefing-editor-slides-section';

        // Slides header
        const slidesHeader = document.createElement('div');
        slidesHeader.className = 'briefing-editor-section-header';

        const slidesTitle = document.createElement('span');
        slidesTitle.textContent = 'Slides';
        slidesHeader.appendChild(slidesTitle);

        const addSlideBtn = document.createElement('button');
        addSlideBtn.className = 'briefing-editor-add-slide-btn';
        addSlideBtn.innerHTML = EDITOR_ICONS.plus;
        addSlideBtn.title = 'Adicionar slide';
        addDomListener(this, addSlideBtn, 'click', () => this._handleAddSlide());
        slidesHeader.appendChild(addSlideBtn);

        slidesSection.appendChild(slidesHeader);

        // Slide list
        this._slideListEl = document.createElement('div');
        this._slideListEl.className = 'briefing-editor-slide-list';
        this._renderSlideList();
        slidesSection.appendChild(this._slideListEl);

        scrollableContent.appendChild(slidesSection);

        // Slide editor section
        this._slideEditorEl = document.createElement('div');
        this._slideEditorEl.className = 'briefing-editor-slide-editor';
        scrollableContent.appendChild(this._slideEditorEl);

        panel.appendChild(scrollableContent);

        return panel;
    }

    /**
     * Creates the settings section.
     * @private
     * @returns {HTMLElement}
     */
    _createSettingsSection() {
        const section = document.createElement('div');
        section.className = 'briefing-editor-settings-section';

        // Ensure settings object exists
        if (!this._briefing.settings) {
            this._briefing.settings = {
                panelPosition: 'left',
                panelBackgroundColor: '#ffffff'
            };
        }

        // Description input
        const descGroup = document.createElement('div');
        descGroup.className = 'briefing-editor-form-group';

        const descLabel = document.createElement('label');
        descLabel.textContent = 'Descrição';
        descGroup.appendChild(descLabel);

        const descInput = document.createElement('textarea');
        descInput.className = 'briefing-editor-description-input';
        descInput.value = this._briefing.description || '';
        descInput.placeholder = 'Descrição opcional do briefing...';
        descInput.rows = 2;
        addDomListener(this, descInput, 'input', () => {
            this._briefing.description = descInput.value;
            this._scheduleAutosave();
        });
        descGroup.appendChild(descInput);
        section.appendChild(descGroup);

        // Panel Position (left/right)
        const positionGroup = document.createElement('div');
        positionGroup.className = 'briefing-editor-form-group';

        const positionLabel = document.createElement('label');
        positionLabel.textContent = 'Posição do Painel';
        positionGroup.appendChild(positionLabel);

        const positionSelector = document.createElement('div');
        positionSelector.className = 'briefing-editor-position-selector';

        ['left', 'right'].forEach(pos => {
            const radio = document.createElement('label');
            radio.className = 'briefing-editor-radio-label';

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'panelPosition';
            input.value = pos;
            input.checked = this._briefing.settings.panelPosition === pos;
            addDomListener(this, input, 'change', () => {
                this._briefing.settings.panelPosition = pos;
                this._scheduleAutosave();
            });

            radio.appendChild(input);
            radio.appendChild(document.createTextNode(pos === 'left' ? 'Esquerda' : 'Direita'));
            positionSelector.appendChild(radio);
        });

        positionGroup.appendChild(positionSelector);
        section.appendChild(positionGroup);

        // Panel Background Color (standard color picker)
        const colorGroup = document.createElement('div');
        colorGroup.className = 'briefing-editor-form-group';

        const colorLabel = document.createElement('label');
        colorLabel.textContent = 'Cor de Fundo do Painel';
        colorGroup.appendChild(colorLabel);

        const colorWrapper = document.createElement('div');
        colorWrapper.className = 'briefing-editor-color-picker-wrapper';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'briefing-editor-color-picker';
        colorInput.value = this._rgbaToHex(this._briefing.settings.panelBackgroundColor) || '#ffffff';
        addDomListener(this, colorInput, 'input', () => {
            this._briefing.settings.panelBackgroundColor = colorInput.value;
            this._scheduleAutosave();
        });

        colorWrapper.appendChild(colorInput);
        colorGroup.appendChild(colorWrapper);
        section.appendChild(colorGroup);

        return section;
    }

    /**
     * Converts rgba string to hex color.
     * @private
     * @param {string} rgba - Color string (rgba or hex)
     * @returns {string} Hex color
     */
    _rgbaToHex(rgba) {
        if (!rgba) return '#ffffff';
        if (rgba.startsWith('#')) return rgba;

        // Parse rgba(r, g, b, a) format
        const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const r = parseInt(match[1], 10);
            const g = parseInt(match[2], 10);
            const b = parseInt(match[3], 10);
            return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        }
        return '#ffffff';
    }

    /**
     * Populates the map selection dropdown.
     * @private
     * @param {HTMLSelectElement} select - Select element
     * @param {Object} slide - Current slide
     */
    async _populateMapSelect(select, slide) {
        // Add placeholder option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Selecione um mapa...';
        defaultOption.disabled = true;
        if (!slide.mapId) {
            defaultOption.selected = true;
        }
        select.appendChild(defaultOption);

        try {
            const mapNames = await getAllMapNamesStore();
            mapNames.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                if (slide.mapId === name) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        } catch (error) {
            console.warn('Error loading map names:', error);
        }
    }

    /**
     * Populates the tileset/3D model selection dropdown.
     * Only shows tilesets that have saved data for the selected map.
     * @private
     * @param {HTMLSelectElement} select - Select element
     * @param {Object} slide - Current slide
     */
    async _populateTilesetSelect(select, slide) {
        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Selecione um modelo 3D...';
        defaultOption.disabled = true;
        if (!slide.tilesetId) defaultOption.selected = true;
        select.appendChild(defaultOption);

        if (!slide.mapId) return; // No map selected yet

        try {
            // Import required functions
            const { getAllMarkers, getMeasurements, getViewsheds, getCameraPosition } =
                await import('../../store/cesium3d.operations.js');

            const tilesets = config.tilesets || [];

            // Check which tilesets have any saved data for this map
            for (const tileset of tilesets) {
                const [markers, measurements, viewsheds, camera] = await Promise.all([
                    getAllMarkers(slide.mapId),
                    getMeasurements(tileset.id, slide.mapId),
                    getViewsheds(tileset.id, slide.mapId),
                    getCameraPosition(tileset.id, slide.mapId)
                ]);

                // Filter markers by tileset
                const tilesetMarkers = markers.filter(m => m.tilesetId === tileset.id);

                const hasData = tilesetMarkers.length > 0 ||
                               measurements.length > 0 ||
                               viewsheds.length > 0 ||
                               camera !== null;

                if (hasData) {
                    const option = document.createElement('option');
                    option.value = tileset.id;
                    option.textContent = tileset.name || tileset.id;
                    if (slide.tilesetId === tileset.id) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                }
            }
        } catch (error) {
            console.warn('Error loading tilesets:', error);
        }
    }

    /**
     * Populates the 360 photo selection dropdown.
     * Only shows photos that have saved orientations for the selected map.
     * @private
     * @param {HTMLSelectElement} select - Select element
     * @param {Object} slide - Current slide
     */
    async _populate360PhotoSelect(select, slide) {
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Selecione uma foto 360°...';
        defaultOption.disabled = true;
        if (!slide.photoId) defaultOption.selected = true;
        select.appendChild(defaultOption);

        if (!slide.mapId) return;

        try {
            const { getAllOrientations } = await import('../../store/streetview360.operations.js');

            // Get all saved orientations for this map
            const orientations = await getAllOrientations(slide.mapId);

            // Create options for each photo with saved orientation
            for (const photoName of Object.keys(orientations)) {
                const orientation = orientations[photoName];
                // Only include active (non-deleted) orientations
                if (orientation && (!orientation.sync || !orientation.sync.deleted)) {
                    const option = document.createElement('option');
                    option.value = photoName;
                    option.textContent = photoName;
                    if (slide.photoId === photoName) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                }
            }
        } catch (error) {
            console.warn('Error loading 360 photos:', error);
        }
    }

    /**
     * Renders the 3D resource section in the slide editor.
     * @private
     * @param {Object} slide - Current slide
     */
    async _render3DResourceSection(slide) {
        const modelGroup = document.createElement('div');
        modelGroup.className = 'briefing-editor-form-group';

        const modelLabel = document.createElement('label');
        modelLabel.textContent = 'Modelo 3D';
        modelGroup.appendChild(modelLabel);

        const modelSelect = document.createElement('select');
        modelSelect.className = 'briefing-editor-select';

        // Populate with only tilesets that have data for the selected map
        await this._populateTilesetSelect(modelSelect, slide);

        // Check if any options were added (besides the placeholder)
        const hasOptions = modelSelect.options.length > 1;

        if (!hasOptions && slide.mapId) {
            // Show warning - no 3D data for this map
            const warningDiv = document.createElement('div');
            warningDiv.className = 'briefing-editor-resource-warning';
            warningDiv.innerHTML = `
                ${EDITOR_ICONS.warning}
                <span>Nenhum modelo 3D salvo para este mapa</span>
            `;
            modelGroup.appendChild(warningDiv);
            // Mark slide as invalid
            slide._validationError = 'NO_3D_DATA';
        } else {
            modelGroup.appendChild(modelSelect);
            addDomListener(this, modelSelect, 'change', async () => {
                slide.tilesetId = modelSelect.value || null;
                // Open 3D viewer with selected tileset
                if (slide.tilesetId) {
                    await this._openViewer3D(slide.tilesetId);
                }
                this._scheduleAutosave();
            });
            delete slide._validationError;
        }

        this._slideEditorEl.appendChild(modelGroup);
    }

    /**
     * Renders the 360 resource section in the slide editor.
     * @private
     * @param {Object} slide - Current slide
     */
    async _render360ResourceSection(slide) {
        const photoGroup = document.createElement('div');
        photoGroup.className = 'briefing-editor-form-group';

        const photoLabel = document.createElement('label');
        photoLabel.textContent = 'Foto 360°';
        photoGroup.appendChild(photoLabel);

        const photoSelect = document.createElement('select');
        photoSelect.className = 'briefing-editor-select';

        await this._populate360PhotoSelect(photoSelect, slide);

        const hasOptions = photoSelect.options.length > 1;

        if (!hasOptions && slide.mapId) {
            // Show warning - no 360 data for this map
            const warningDiv = document.createElement('div');
            warningDiv.className = 'briefing-editor-resource-warning';
            warningDiv.innerHTML = `
                ${EDITOR_ICONS.warning}
                <span>Nenhuma foto 360° salva para este mapa</span>
            `;
            photoGroup.appendChild(warningDiv);
            slide._validationError = 'NO_360_DATA';
        } else {
            photoGroup.appendChild(photoSelect);
            addDomListener(this, photoSelect, 'change', async () => {
                slide.photoId = photoSelect.value || null;
                // Open 360 viewer with selected photo
                if (slide.photoId) {
                    await this._openViewer360(slide.photoId);
                }
                this._scheduleAutosave();
            });
            delete slide._validationError;
        }

        this._slideEditorEl.appendChild(photoGroup);
    }

    /**
     * Handles map change for a slide.
     * Switches to the selected map and refreshes features.
     * @private
     * @param {string} mapId - Map ID to switch to
     */
    async _handleMapChange(mapId) {
        if (!mapId) return;

        try {
            const { setCurrentMap } = await import('../../store/index.js');

            // Switch to the selected map
            await setCurrentMap(mapId);

            // Resize map after switch
            if (this._map) {
                setTimeout(() => this._map.resize(), 100);
            }
        } catch (error) {
            console.warn('Error switching map:', error);
        }
    }

    /**
     * Opens the 3D viewer with a specific tileset.
     * @private
     * @param {string} tilesetId - Tileset ID to open
     */
    async _openViewer3D(tilesetId) {
        try {
            const { openViewerWithTileset } = await import('../../3d_models_viewer_tool/map_3d.js');
            await openViewerWithTileset(tilesetId);
        } catch (error) {
            console.error('Error opening 3D viewer:', error);
            showError('Erro ao abrir visualizador 3D');
        }
    }

    /**
     * Opens the 360 viewer with a specific photo.
     * @private
     * @param {string} photoId - Photo ID to open
     */
    async _openViewer360(photoId) {
        try {
            const { openViewer360WithPhoto } = await import('../../street_view_tool/street_view_viewer.js');
            await openViewer360WithPhoto(photoId);
        } catch (error) {
            console.error('Error opening 360 viewer:', error);
            showError('Erro ao abrir visualizador 360');
        }
    }

    /**
     * Renders the slide list.
     * @private
     */
    _renderSlideList() {
        this._slideListEl.innerHTML = '';

        if (!this._briefing.slides || this._briefing.slides.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'briefing-editor-slide-list-empty';
            emptyMsg.textContent = 'Nenhum slide. Clique em + para adicionar.';
            this._slideListEl.appendChild(emptyMsg);
            return;
        }

        this._briefing.slides.forEach((slide, index) => {
            const card = this._createSlideCard(slide, index);
            this._slideListEl.appendChild(card);
        });
    }

    /**
     * Creates a slide card element.
     * @private
     * @param {Object} slide - Slide data
     * @param {number} index - Slide index
     * @returns {HTMLElement}
     */
    _createSlideCard(slide, index) {
        const card = document.createElement('div');
        card.className = 'briefing-editor-slide-card';
        card.dataset.slideId = slide.id;

        if (slide.id === this._selectedSlideId) {
            card.dataset.selected = 'true';
        }

        // Check for warnings
        const hasPositionWarning = !slide.position || slide.position.longitude === null;
        const hasResourceWarning = !!slide._validationError;

        // Drag handle
        const handle = document.createElement('div');
        handle.className = 'briefing-editor-slide-handle';
        handle.innerHTML = EDITOR_ICONS.grip;
        card.appendChild(handle);

        // Slide info
        const info = document.createElement('div');
        info.className = 'briefing-editor-slide-info';

        const number = document.createElement('span');
        number.className = 'briefing-editor-slide-number';
        number.textContent = `${index + 1}`;
        info.appendChild(number);

        const title = document.createElement('span');
        title.className = 'briefing-editor-slide-title';
        title.textContent = slide.title || `Slide ${index + 1}`;
        info.appendChild(title);

        card.appendChild(info);

        // Mode icon
        const modeIcon = document.createElement('span');
        modeIcon.className = 'briefing-editor-slide-mode-icon';
        modeIcon.innerHTML = MODE_ICONS[slide.mode] || MODE_ICONS[SlideMode.MAP_2D];
        modeIcon.title = MODE_LABELS[slide.mode] || MODE_LABELS[SlideMode.MAP_2D];
        card.appendChild(modeIcon);

        // Warning icon - includes position and resource validation errors
        if (hasPositionWarning || hasResourceWarning) {
            const warning = document.createElement('span');
            warning.className = 'briefing-editor-slide-warning';
            warning.innerHTML = EDITOR_ICONS.warning;

            if (hasResourceWarning) {
                const messages = {
                    'NO_3D_DATA': 'Nenhum modelo 3D disponível para este mapa',
                    'NO_360_DATA': 'Nenhuma foto 360° disponível para este mapa'
                };
                warning.title = messages[slide._validationError] || 'Recurso não disponível';
                warning.classList.add('briefing-editor-slide-warning--error');
            } else {
                warning.title = 'Posição não definida';
            }

            card.appendChild(warning);
        }

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'briefing-editor-slide-delete-btn';
        deleteBtn.innerHTML = EDITOR_ICONS.trash;
        deleteBtn.title = 'Excluir slide';
        addDomListener(this, deleteBtn, 'click', (e) => {
            e.stopPropagation();
            this._handleDeleteSlide(slide.id);
        });
        card.appendChild(deleteBtn);

        // Click to select
        addDomListener(this, card, 'click', () => this._selectSlide(slide.id));

        return card;
    }

    /**
     * Creates the right panel (preview with embedded map).
     * @private
     * @returns {HTMLElement}
     */
    _createRightPanel() {
        const panel = document.createElement('div');
        panel.className = 'briefing-editor-right-panel';

        // Preview container - will contain the main map
        this._previewEl = document.createElement('div');
        this._previewEl.className = 'briefing-editor-preview';
        this._previewEl.id = 'briefing-editor-preview';

        // Move the map container into the preview
        // The map will be repositioned when the editor opens
        panel.appendChild(this._previewEl);

        return panel;
    }

    /**
     * Moves the main map into the preview panel.
     * @private
     */
    _embedMapInPreview() {
        const mapContainer = document.getElementById('map-sig');
        if (mapContainer && this._previewEl) {
            // Store original parent for restoration
            this._originalMapParent = mapContainer.parentElement;
            this._originalMapNextSibling = mapContainer.nextSibling;

            // Move map to preview
            this._previewEl.appendChild(mapContainer);

            // Resize the map to fit the new container
            if (this._map) {
                setTimeout(() => {
                    this._map.resize();
                }, 100);
            }
        }
    }

    /**
     * Restores the map to its original position.
     * @private
     */
    _restoreMapPosition() {
        const mapContainer = document.getElementById('map-sig');
        if (mapContainer && this._originalMapParent) {
            if (this._originalMapNextSibling) {
                this._originalMapParent.insertBefore(mapContainer, this._originalMapNextSibling);
            } else {
                this._originalMapParent.appendChild(mapContainer);
            }

            // Resize the map
            if (this._map) {
                setTimeout(() => {
                    this._map.resize();
                }, 100);
            }

            this._originalMapParent = null;
            this._originalMapNextSibling = null;
        }
    }

    /**
     * Renders the slide editor for the selected slide.
     * @private
     */
    async _renderSlideEditor() {
        this._slideEditorEl.innerHTML = '';

        const slide = this._getSelectedSlide();
        if (!slide) {
            this._slideEditorEl.innerHTML = `
                <div class="briefing-editor-no-slide">
                    <p>Selecione um slide para editar</p>
                </div>
            `;
            return;
        }

        // Title input
        const titleGroup = document.createElement('div');
        titleGroup.className = 'briefing-editor-form-group';

        const titleLabel = document.createElement('label');
        titleLabel.textContent = 'Título';
        titleGroup.appendChild(titleLabel);

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'briefing-editor-slide-title-input';
        titleInput.value = slide.title || '';
        titleInput.placeholder = 'Título do slide';
        addDomListener(this, titleInput, 'input', () => {
            slide.title = titleInput.value;
            this._scheduleAutosave();
            this._renderSlideList();
        });
        titleGroup.appendChild(titleInput);

        this._slideEditorEl.appendChild(titleGroup);

        // Mode selector
        const modeGroup = document.createElement('div');
        modeGroup.className = 'briefing-editor-form-group';

        const modeLabel = document.createElement('label');
        modeLabel.textContent = 'Modo de Visualização';
        modeGroup.appendChild(modeLabel);

        const modeSelector = document.createElement('div');
        modeSelector.className = 'briefing-editor-mode-selector';

        Object.entries(MODE_LABELS).forEach(([mode, label]) => {
            const modeBtn = document.createElement('button');
            modeBtn.className = 'briefing-editor-mode-btn';
            modeBtn.dataset.mode = mode;
            if (slide.mode === mode) {
                modeBtn.dataset.selected = 'true';
            }
            modeBtn.innerHTML = `${MODE_ICONS[mode]}<span>${label}</span>`;
            addDomListener(this, modeBtn, 'click', () => {
                slide.mode = mode;
                this._scheduleAutosave();
                this._renderSlideEditor();
                this._renderSlideList();
            });
            modeSelector.appendChild(modeBtn);
        });

        modeGroup.appendChild(modeSelector);
        this._slideEditorEl.appendChild(modeGroup);

        // Map selection (for all modes - base map)
        const mapGroup = document.createElement('div');
        mapGroup.className = 'briefing-editor-form-group';

        const mapLabel = document.createElement('label');
        mapLabel.textContent = 'Mapa';
        mapGroup.appendChild(mapLabel);

        const mapSelect = document.createElement('select');
        mapSelect.className = 'briefing-editor-select';
        this._populateMapSelect(mapSelect, slide);
        addDomListener(this, mapSelect, 'change', async () => {
            slide.mapId = mapSelect.value || null;

            // Clear previous resource selections when map changes
            slide.tilesetId = null;
            slide.photoId = null;

            // Switch to the selected map's features
            await this._handleMapChange(slide.mapId);

            this._scheduleAutosave();
            this._renderSlideEditor(); // Re-render to update resource dropdowns
        });
        mapGroup.appendChild(mapSelect);
        this._slideEditorEl.appendChild(mapGroup);

        // Resource selection based on mode
        if (slide.mode === SlideMode.VIEWER_3D) {
            await this._render3DResourceSection(slide);
        } else if (slide.mode === SlideMode.VIEWER_360) {
            await this._render360ResourceSection(slide);
        }

        // Position indicator
        const positionGroup = document.createElement('div');
        positionGroup.className = 'briefing-editor-form-group';

        const positionLabel = document.createElement('label');
        positionLabel.textContent = 'Posição';
        positionGroup.appendChild(positionLabel);

        const positionWrapper = document.createElement('div');
        positionWrapper.className = 'briefing-editor-position-wrapper';

        const positionDisplay = document.createElement('div');
        positionDisplay.className = 'briefing-editor-position-display';

        if (slide.position && slide.position.longitude !== null) {
            positionDisplay.innerHTML = `
                <span class="briefing-editor-position-set">
                    Lat: ${slide.position.latitude?.toFixed(6)},
                    Lng: ${slide.position.longitude?.toFixed(6)}
                    ${slide.position.zoom ? `, Zoom: ${slide.position.zoom.toFixed(1)}` : ''}
                </span>
            `;
        } else {
            positionDisplay.innerHTML = `
                <span class="briefing-editor-position-warning">
                    ${EDITOR_ICONS.warning}
                    Posição não definida
                </span>
            `;
        }
        positionWrapper.appendChild(positionDisplay);

        // Capture position button (moved here from right panel)
        const captureBtn = document.createElement('button');
        captureBtn.className = 'briefing-editor-capture-btn';
        captureBtn.innerHTML = `${EDITOR_ICONS.crosshair}<span>Capturar</span>`;
        captureBtn.title = 'Captura a posição atual do mapa';
        addDomListener(this, captureBtn, 'click', () => this._handleCapturePosition());
        positionWrapper.appendChild(captureBtn);

        positionGroup.appendChild(positionWrapper);
        this._slideEditorEl.appendChild(positionGroup);

        // Content editor with Quill
        const contentGroup = document.createElement('div');
        contentGroup.className = 'briefing-editor-form-group briefing-editor-content-group';

        const contentLabel = document.createElement('label');
        contentLabel.textContent = 'Conteúdo';
        contentGroup.appendChild(contentLabel);

        // Quill editor container
        const quillContainer = document.createElement('div');
        quillContainer.className = 'briefing-editor-quill-container';
        quillContainer.id = `briefing-quill-${slide.id}`;
        contentGroup.appendChild(quillContainer);

        this._slideEditorEl.appendChild(contentGroup);

        // Initialize Quill editor
        this._initQuillEditor(quillContainer, slide);
    }

    /**
     * Initializes the Quill editor for slide content.
     * @private
     * @param {HTMLElement} container - Container element
     * @param {Object} slide - Current slide
     */
    async _initQuillEditor(container, slide) {
        try {
            const { createQuillEditor } = await import('../../utilities/quill-helpers.js');

            // Destroy previous editor if exists
            if (this._quillEditor) {
                this._quillEditor = null;
            }

            // Create new editor (createQuillEditor returns a Promise)
            this._quillEditor = await createQuillEditor(container, {
                placeholder: 'Digite o conteúdo do slide...',
                theme: 'snow',
                toolbar: [
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['link'],
                    ['clean']
                ],
                enableImageCompression: false
            });

            // Set initial content
            if (slide.content) {
                this._quillEditor.root.innerHTML = slide.content;
            }

            // Listen for changes
            this._quillEditor.on('text-change', () => {
                slide.content = this._quillEditor.root.innerHTML;
                this._scheduleAutosave();
            });

        } catch (error) {
            console.error('Error initializing Quill editor:', error);
            container.innerHTML = '<p class="briefing-editor-quill-error">Erro ao carregar editor</p>';
        }
    }

    /**
     * Initializes Sortable for drag-drop reordering.
     * @private
     */
    _initSortable() {
        if (this._sortableInstance) {
            this._sortableInstance.destroy();
        }

        // Dynamic import to avoid loading Sortable if not needed
        import('sortablejs').then(({ default: Sortable }) => {
            this._sortableInstance = Sortable.create(this._slideListEl, {
                animation: 150,
                handle: '.briefing-editor-slide-handle',
                ghostClass: 'sortable-ghost',
                onEnd: async () => {
                    const newOrder = Array.from(this._slideListEl.children)
                        .map(el => el.dataset.slideId)
                        .filter(Boolean);

                    await reorderSlides(this._briefing.id, newOrder);

                    // Reload briefing
                    this._briefing = await getBriefingById(this._briefing.id);
                    this._renderSlideList();
                }
            });
        });
    }

    /**
     * Selects a slide for editing.
     * @private
     * @param {string} slideId - Slide ID
     */
    _selectSlide(slideId) {
        this._selectedSlideId = slideId;

        // Update selection in list
        const cards = this._slideListEl.querySelectorAll('.briefing-editor-slide-card');
        cards.forEach(card => {
            card.dataset.selected = (card.dataset.slideId === slideId).toString();
        });

        // Render slide editor
        this._renderSlideEditor();

        // Update preview (placeholder for now)
        this._updatePreview();
    }

    /**
     * Updates the preview panel.
     * Navigates the map to the slide's saved position.
     * @private
     */
    _updatePreview() {
        const slide = this._getSelectedSlide();
        if (!slide || !this._map) {
            return;
        }

        // If slide has a saved position, navigate to it
        if (slide.position && slide.position.longitude !== null && slide.position.latitude !== null) {
            const flyOptions = {
                center: [slide.position.longitude, slide.position.latitude],
                zoom: slide.position.zoom || 12,
                duration: 1000
            };

            // Add bearing and pitch if available
            if (slide.orientation) {
                if (typeof slide.orientation.bearing === 'number') {
                    flyOptions.bearing = slide.orientation.bearing;
                }
                if (typeof slide.orientation.pitch === 'number') {
                    flyOptions.pitch = slide.orientation.pitch;
                }
            }

            this._map.flyTo(flyOptions);
        }
    }

    /**
     * Gets the currently selected slide.
     * @private
     * @returns {Object|null}
     */
    _getSelectedSlide() {
        if (!this._selectedSlideId || !this._briefing?.slides) {
            return null;
        }
        return this._briefing.slides.find(s => s.id === this._selectedSlideId);
    }

    /**
     * Handles adding a new slide.
     * @private
     */
    async _handleAddSlide() {
        try {
            const newSlide = await addSlide(this._briefing.id, createEmptySlide());

            // Reload briefing
            this._briefing = await getBriefingById(this._briefing.id);
            this._renderSlideList();

            // Select the new slide
            if (newSlide) {
                this._selectSlide(newSlide.id);
            }

            showSuccess('Slide adicionado');
        } catch (error) {
            console.error('Error adding slide:', error);
            showError('Erro ao adicionar slide');
        }
    }

    /**
     * Handles deleting a slide.
     * @private
     * @param {string} slideId - Slide ID
     */
    async _handleDeleteSlide(slideId) {
        const slide = this._briefing.slides.find(s => s.id === slideId);
        const confirmed = await showConfirm(
            `Excluir slide "${slide?.title || 'Sem título'}"?`,
            { destructive: true }
        );

        if (!confirmed) return;

        try {
            await removeSlide(this._briefing.id, slideId);

            // Reload briefing
            this._briefing = await getBriefingById(this._briefing.id);
            this._renderSlideList();

            // Clear selection if deleted slide was selected
            if (this._selectedSlideId === slideId) {
                this._selectedSlideId = null;
                if (this._briefing.slides.length > 0) {
                    this._selectSlide(this._briefing.slides[0].id);
                } else {
                    this._renderSlideEditor();
                    this._updatePreview();
                }
            }

            showSuccess('Slide excluído');
        } catch (error) {
            console.error('Error deleting slide:', error);
            showError('Erro ao excluir slide');
        }
    }

    /**
     * Handles capturing the current position based on slide mode.
     * @private
     */
    async _handleCapturePosition() {
        const slide = this._getSelectedSlide();
        if (!slide) {
            showWarning('Selecione um slide primeiro');
            return;
        }

        try {
            if (slide.mode === SlideMode.MAP_2D) {
                // Capture from 2D map
                if (this._map) {
                    const center = this._map.getCenter();
                    slide.position = {
                        longitude: center.lng,
                        latitude: center.lat,
                        zoom: this._map.getZoom(),
                        altitude: null
                    };
                    slide.orientation = {
                        bearing: this._map.getBearing(),
                        pitch: this._map.getPitch(),
                        heading: null
                    };
                } else {
                    showWarning('Mapa não disponível');
                    return;
                }
            } else if (slide.mode === SlideMode.VIEWER_3D) {
                // Capture from 3D viewer
                if (!isViewer3DOpen()) {
                    showWarning('Abra o visualizador 3D primeiro');
                    return;
                }

                const { getCesiumViewer } = await import('../../3d_models_viewer_tool/map_3d.js');
                const viewer = getCesiumViewer();
                if (viewer && viewer.camera) {
                    const camera = viewer.camera;
                    const cartographic = Cesium.Cartographic.fromCartesian(camera.position);

                    slide.position = {
                        longitude: Cesium.Math.toDegrees(cartographic.longitude),
                        latitude: Cesium.Math.toDegrees(cartographic.latitude),
                        altitude: cartographic.height,
                        zoom: null
                    };
                    slide.orientation = {
                        heading: Cesium.Math.toDegrees(camera.heading),
                        pitch: Cesium.Math.toDegrees(camera.pitch),
                        bearing: null
                    };
                } else {
                    showWarning('Câmera 3D não disponível');
                    return;
                }
            } else if (slide.mode === SlideMode.VIEWER_360) {
                // Capture from 360 viewer
                if (!isStreetView360Open()) {
                    showWarning('Abra o visualizador 360 primeiro');
                    return;
                }

                const { getCurrentPhotoName, getCameraRotation, getCameraFOV } =
                    await import('../../street_view_tool/street_view_viewer.js');

                const photoName = getCurrentPhotoName();
                const rotation = getCameraRotation(); // { lon, lat }
                const fov = getCameraFOV();

                if (photoName && rotation) {
                    slide.photoId = photoName;
                    slide.position = {
                        longitude: rotation.lon,
                        latitude: rotation.lat,
                        fov: fov,
                        zoom: null,
                        altitude: null
                    };
                    slide.orientation = {
                        lon: rotation.lon,
                        lat: rotation.lat,
                        fov: fov,
                        bearing: null,
                        pitch: null,
                        heading: null
                    };
                } else {
                    showWarning('Orientação 360 não disponível');
                    return;
                }
            }

            this._scheduleAutosave();
            this._renderSlideEditor();
            this._renderSlideList();
            showSuccess('Posição capturada');

        } catch (error) {
            console.error('Error capturing position:', error);
            showError('Erro ao capturar posição');
        }
    }

    /**
     * Handles name change.
     * @private
     */
    _onNameChange() {
        this._briefing.name = this._nameInput.value;
        this._scheduleAutosave();
    }

    /**
     * Schedules autosave after a delay.
     * @private
     */
    _scheduleAutosave() {
        this._hasUnsavedChanges = true;

        if (this._autosaveTimer) {
            clearTimeout(this._autosaveTimer);
        }

        this._autosaveTimer = setTimeout(() => {
            this._save();
        }, EDITOR_CONFIG.AUTOSAVE_DELAY);

        trackTimer(this, this._autosaveTimer);
    }

    /**
     * Saves the briefing.
     * @private
     * @param {boolean} [showFeedback=false] - Show success message
     */
    async _save(showFeedback = false) {
        if (!this._briefing) return;

        try {
            await updateBriefing(this._briefing.id, {
                name: this._briefing.name,
                description: this._briefing.description,
                slides: this._briefing.slides,
                settings: this._briefing.settings
            });

            this._hasUnsavedChanges = false;

            // Emit event
            this._eventBus.emit(EventTypes.BRIEFING_UPDATED, {
                briefingId: this._briefing.id,
                briefing: this._briefing
            });

            if (showFeedback) {
                showSuccess('Briefing salvo');
            }
        } catch (error) {
            console.error('Error saving briefing:', error);
            if (showFeedback) {
                showError('Erro ao salvar briefing');
            }
        }
    }

    /**
     * Checks if the editor is open.
     * @returns {boolean}
     */
    isOpen() {
        return this._isOpen;
    }

    /**
     * Destroys the editor control.
     */
    destroy() {
        if (this._isOpen) {
            this.close(true);
        }
        cleanup(this);
    }
}
