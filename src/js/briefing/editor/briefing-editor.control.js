// Path: js/briefing/editor/briefing-editor.control.js

/**
 * @fileoverview Main briefing editor control.
 * Provides a right-side panel editor for creating and editing briefings.
 * The map stays in its normal DOM position; the editor panel overlays on the right.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────┐
 * │                                    ┌────────────────────┐│
 * │        MAP / 3D / 360              │ EDITOR (520px)     ││
 * │        (normal position)           │ - Header + Name    ││
 * │                                    │ - Slide List       ││
 * │                                    │ - Slide Editor     ││
 * │                                    └────────────────────┘│
 * └──────────────────────────────────────────────────────────┘
 *
 * Position capture auto-detects the active viewer:
 * - If 360 viewer is open -> captures 360 orientation
 * - If 3D viewer is open  -> captures Cesium camera
 * - Otherwise             -> captures 2D map position
 *
 * @module briefing/editor/briefing-editor.control
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
    trackTimer
} from '@utils/event-cleanup.js';
import {
    getBriefingById,
    updateBriefing,
    addSlide,
    removeSlide,
    reorderSlides,
    createEmptySlide,
    SlideMode,
    getAllBriefings,
    getAllMapNamesStore,
    setCurrentMap,
    getCurrentMapNameSync,
    setBriefingLockOverride,
    getControl,
    getEventBus,
    getMapNotes,
    hasMapNotes,
    getMapPosition,
    getAllCameraPositions,
    getAllOrientations
} from '@store/index.js';
import { deepClone } from '@utils/deep-utils.js';
import { generateUUID } from '@utils/uuid.js';
import { createQuillEditor } from '@utils/quill-helpers.js';
import { EventTypes } from '@events/event_types.js';
import { showSuccess, showError, showWarning } from '@utils/index.js';
import { showConfirm, showImportSlidesModal } from '@modals/index.js';
import { getApplicationModeManager, ApplicationMode } from '@js/mode/application-mode.manager.js';
import { getUIVisibilityController, VisibilityProfile } from '@ui/ui-visibility.controller.js';
import { isViewer3DOpen } from '@utils/viewer3d-state.js';
import { isStreetView360Open } from '@utils/streetview360-state.js';
import config from '@js/config.js';
import { createTransitionService } from '../presentation/transition.service.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const EDITOR_CONFIG = {
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

    close: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,

    importNotes: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`,

    savedOrientations: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,

    chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,

    importSlides: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
};

/**
 * Mode labels in Portuguese.
 */
const MODE_LABELS = {
    [SlideMode.MAP_2D]: 'Mapa 2D',
    [SlideMode.VIEWER_3D]: 'Visualizador 3D',
    [SlideMode.VIEWER_360]: 'Foto 360\u00B0'
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
 * Manages a right-side panel editor for briefings.
 * The map/3D/360 viewers stay in their normal DOM positions.
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
        this._slideListEl = null;
        this._slideEditorEl = null;
        this._nameInput = null;

        // Child components (created lazily)
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
            // Load briefing data
            this._briefing = await getBriefingById(briefingId);
            if (!this._briefing) {
                showError('Briefing n\u00E3o encontrado');
                return;
            }

            // Ensure default settings (position=left, color=white)
            this._ensureDefaultSettings();

            // Force all maps to appear locked without persisting
            setBriefingLockOverride(true);

            // Enter edit mode
            const modeManager = getApplicationModeManager();
            modeManager.enterMode(ApplicationMode.BRIEFING_EDIT, {
                briefingId: this._briefing.id
            });

            // Apply locked 2D visibility profile (hides toolbars and sidebar)
            const visController = getUIVisibilityController();
            visController.applyProfile(VisibilityProfile.BRIEFING_LOCKED_2D);

            // Offset map/3D/360 containers so the panel doesn't overlap them
            document.body.classList.add('briefing-panel-active');

            // Create the right-side panel UI
            this._createUI();

            // Create transition service for slide preview navigation
            this._transitionService = createTransitionService(this._map);

            this._isOpen = true;

            // MapLibre needs a resize to fill the new available space
            if (this._map) {
                setTimeout(() => this._map.resize(), 50);
            }

            // Emit event
            this._eventBus.emit(EventTypes.BRIEFING_EDIT_STARTED, {
                briefingId: this._briefing.id
            });

            // Select first slide (triggers preview navigation after map resize)
            if (this._briefing.slides?.length > 0) {
                await this._selectSlide(this._briefing.slides[0].id);
            }

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
                'Existem altera\u00E7\u00F5es n\u00E3o salvas. Deseja sair mesmo assim?',
                { destructive: true }
            );
            if (!confirmed) return;
        }

        // Clear autosave timer
        if (this._autosaveTimer) {
            clearTimeout(this._autosaveTimer);
            this._autosaveTimer = null;
        }

        // Close any open dropdown
        this._closeSavedOrientationsDropdown();

        // Close any open 3D/360 viewers via transition service
        if (this._transitionService) {
            await this._transitionService.resetTo2D();
            this._transitionService.destroy();
            this._transitionService = null;
        }

        // Safety net: close viewers that may have been opened outside the transition service
        await this._closeActiveViewers();

        // Restore lock state (maps become editable again based on their persisted state)
        setBriefingLockOverride(false);

        // Remove layout offset from map/3D/360 containers
        document.body.classList.remove('briefing-panel-active');

        // MapLibre needs a resize to fill the restored space
        if (this._map) {
            setTimeout(() => this._map.resize(), 50);
        }

        // Restore normal UI visibility profile
        const visController = getUIVisibilityController();
        visController.applyProfile(VisibilityProfile.NORMAL);

        // Exit edit mode
        const modeManager = getApplicationModeManager();
        modeManager.exitMode();

        // Destroy Sortable
        if (this._sortableInstance) {
            this._sortableInstance.destroy();
            this._sortableInstance = null;
        }

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

    // =========================================================================
    // VIEWER MANAGEMENT
    // =========================================================================

    /**
     * Closes any active 3D or 360 viewers.
     * Uses registered controls (not raw module imports) so that
     * container visibility (setFullMap) and close-button cleanup
     * are handled properly.
     * @private
     */
    async _closeActiveViewers() {
        try {
            if (isViewer3DOpen()) {
                const modelsViewer = getControl('modelsViewer');
                if (modelsViewer) {
                    await modelsViewer.closeViewer();
                } else {
                    // Fallback: hide container directly
                    const container = document.getElementById('map-3d-container');
                    if (container) container.classList.add('hidden');
                    const mapSig = document.getElementById('map-sig');
                    if (mapSig) mapSig.classList.remove('hidden');
                }
            }
        } catch (error) {
            console.warn('Error closing 3D viewer:', error);
        }

        try {
            if (isStreetView360Open()) {
                const { closeViewer360 } = await import('@js/street_view_tool/street_view_viewer.js');
                await closeViewer360();
            }
        } catch (error) {
            console.warn('Error closing 360 viewer:', error);
        }
    }

    // =========================================================================
    // UI CREATION
    // =========================================================================

    /**
     * Creates the editor UI structure (right-side panel).
     * @private
     */
    _createUI() {
        this._container = document.createElement('div');
        this._container.className = 'briefing-editor';
        this._container.id = 'briefing-editor';

        addDomListener(this, this._container, 'click', (e) => e.stopPropagation());

        // Header
        const header = this._createPanelHeader();
        this._container.appendChild(header);

        // Scrollable content area
        const scrollableContent = document.createElement('div');
        scrollableContent.className = 'briefing-editor-scrollable';

        // Slides section
        const slidesSection = document.createElement('div');
        slidesSection.className = 'briefing-editor-slides-section';

        const slidesHeader = document.createElement('div');
        slidesHeader.className = 'briefing-editor-section-header';

        const slidesTitle = document.createElement('span');
        slidesTitle.textContent = 'Slides';
        slidesHeader.appendChild(slidesTitle);

        const slidesActions = document.createElement('div');
        slidesActions.className = 'briefing-editor-slide-actions';

        const importSlidesBtn = document.createElement('button');
        importSlidesBtn.className = 'briefing-editor-add-slide-btn';
        importSlidesBtn.innerHTML = EDITOR_ICONS.importSlides;
        importSlidesBtn.title = 'Importar slides de outros briefings';
        addDomListener(this, importSlidesBtn, 'click', () => this._handleImportSlides());
        slidesActions.appendChild(importSlidesBtn);

        const addSlideBtn = document.createElement('button');
        addSlideBtn.className = 'briefing-editor-add-slide-btn';
        addSlideBtn.innerHTML = EDITOR_ICONS.plus;
        addSlideBtn.title = 'Adicionar slide';
        addDomListener(this, addSlideBtn, 'click', () => this._handleAddSlide());
        slidesActions.appendChild(addSlideBtn);

        slidesHeader.appendChild(slidesActions);

        slidesSection.appendChild(slidesHeader);

        this._slideListEl = document.createElement('div');
        this._slideListEl.className = 'briefing-editor-slide-list';
        this._renderSlideList();
        slidesSection.appendChild(this._slideListEl);

        scrollableContent.appendChild(slidesSection);

        // Slide editor area
        this._slideEditorEl = document.createElement('div');
        this._slideEditorEl.className = 'briefing-editor-slide-editor';
        scrollableContent.appendChild(this._slideEditorEl);

        this._container.appendChild(scrollableContent);

        document.body.appendChild(this._container);

        this._initSortable();
    }

    /**
     * Creates the panel header (close button, name input, save button).
     * @private
     * @returns {HTMLElement}
     */
    _createPanelHeader() {
        const header = document.createElement('div');
        header.className = 'briefing-editor-panel-header';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'briefing-editor-back-btn';
        closeBtn.innerHTML = EDITOR_ICONS.close;
        closeBtn.title = 'Fechar';
        addDomListener(this, closeBtn, 'click', () => this.close());
        header.appendChild(closeBtn);

        this._nameInput = document.createElement('input');
        this._nameInput.type = 'text';
        this._nameInput.className = 'briefing-editor-name-input';
        this._nameInput.value = this._briefing.name || '';
        this._nameInput.placeholder = 'Nome do Briefing';
        addDomListener(this, this._nameInput, 'input', () => this._onNameChange());
        addDomListener(this, this._nameInput, 'blur', () => this._save());
        header.appendChild(this._nameInput);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'briefing-editor-save-btn';
        saveBtn.innerHTML = EDITOR_ICONS.save;
        saveBtn.title = 'Salvar';
        addDomListener(this, saveBtn, 'click', () => this._save(true));
        header.appendChild(saveBtn);

        return header;
    }

    /**
     * Ensures briefing settings have default values.
     * Settings are hardcoded: panelPosition='left', panelBackgroundColor='#ffffff'.
     * @private
     */
    _ensureDefaultSettings() {
        if (!this._briefing.settings) {
            this._briefing.settings = {};
        }
        this._briefing.settings.panelPosition = 'left';
        this._briefing.settings.panelBackgroundColor = '#ffffff';
    }

    // =========================================================================
    // SLIDE LIST
    // =========================================================================

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
     * Shows a mode badge with icon and label instead of just a mode icon.
     * @private
     */
    _createSlideCard(slide, index) {
        const card = document.createElement('div');
        card.className = 'briefing-editor-slide-card';
        card.dataset.slideId = slide.id;

        if (slide.id === this._selectedSlideId) {
            card.dataset.selected = 'true';
        }

        const hasPositionWarning = !slide.position || slide.position.longitude === null;

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

        // Mode badge (icon + label)
        const modeBadge = document.createElement('span');
        modeBadge.className = 'briefing-editor-slide-mode-badge';
        modeBadge.innerHTML = MODE_ICONS[slide.mode] || MODE_ICONS[SlideMode.MAP_2D];
        const badgeLabel = document.createElement('span');
        badgeLabel.className = 'briefing-editor-slide-mode-badge__label';
        badgeLabel.textContent = MODE_LABELS[slide.mode] || MODE_LABELS[SlideMode.MAP_2D];
        modeBadge.appendChild(badgeLabel);
        card.appendChild(modeBadge);

        // Warning icon — position
        if (hasPositionWarning) {
            const warning = document.createElement('span');
            warning.className = 'briefing-editor-slide-warning';
            warning.innerHTML = EDITOR_ICONS.warning;
            warning.title = 'Posi\u00E7\u00E3o n\u00E3o definida';
            card.appendChild(warning);
        }

        // Warning icon — unavailable 3D model
        if (slide.mode === SlideMode.VIEWER_3D && slide.modelId) {
            const tilesetExists = config.tilesets?.some(t => t.id === slide.modelId);
            if (!tilesetExists) {
                const warning = document.createElement('span');
                warning.className = 'briefing-editor-slide-warning';
                warning.innerHTML = EDITOR_ICONS.warning;
                warning.title = `Modelo 3D indispon\u00EDvel (${slide.modelId})`;
                card.appendChild(warning);
            }
        }

        // Warning icon — unavailable 360 photo
        if (slide.mode === SlideMode.VIEWER_360 && slide.photoId) {
            if (!config.features.imagens_panoramicas) {
                const warning = document.createElement('span');
                warning.className = 'briefing-editor-slide-warning';
                warning.innerHTML = EDITOR_ICONS.warning;
                warning.title = 'Servi\u00E7o de imagens 360 indispon\u00EDvel';
                card.appendChild(warning);
            }
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
        addDomListener(this, card, 'click', async () => this._selectSlide(slide.id));

        return card;
    }

    // =========================================================================
    // SLIDE EDITOR
    // =========================================================================

    /**
     * Renders the slide editor for the selected slide.
     * Preserves scroll position of the parent scrollable container.
     * @private
     */
    async _renderSlideEditor() {
        // Preserve scroll position before re-render
        const scrollable = this._slideEditorEl?.closest('.briefing-editor-scrollable');
        const savedScrollTop = scrollable ? scrollable.scrollTop : 0;

        this._slideEditorEl.innerHTML = '';

        const slide = this._getSelectedSlide();
        if (!slide) {
            const noSlide = document.createElement('div');
            noSlide.className = 'briefing-editor-no-slide';
            const noSlideText = document.createElement('p');
            noSlideText.textContent = 'Selecione um slide para editar';
            noSlide.appendChild(noSlideText);
            this._slideEditorEl.appendChild(noSlide);
            return;
        }

        // Title input
        const titleGroup = document.createElement('div');
        titleGroup.className = 'briefing-editor-form-group';

        const titleLabel = document.createElement('label');
        titleLabel.textContent = 'T\u00EDtulo';
        titleGroup.appendChild(titleLabel);

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'briefing-editor-slide-title-input';
        titleInput.value = slide.title || '';
        titleInput.placeholder = 'T\u00EDtulo do slide';
        addDomListener(this, titleInput, 'input', () => {
            slide.title = titleInput.value;
            this._scheduleAutosave();
            // Targeted update: only update the title text in the slide card
            this._updateSlideCardTitle(slide.id, slide.title);
        });
        titleGroup.appendChild(titleInput);

        this._slideEditorEl.appendChild(titleGroup);

        // Map selection
        const mapGroup = document.createElement('div');
        mapGroup.className = 'briefing-editor-form-group';

        const mapLabel = document.createElement('label');
        mapLabel.textContent = 'Mapa';
        mapGroup.appendChild(mapLabel);

        const mapSelect = document.createElement('select');
        mapSelect.className = 'briefing-editor-select';
        await this._populateMapSelect(mapSelect, slide);
        addDomListener(this, mapSelect, 'change', async () => {
            const previousMapId = slide.mapId;
            slide.mapId = mapSelect.value || null;

            // Clear saved position when switching maps
            if (slide.mapId !== previousMapId) {
                slide.position = { longitude: null, latitude: null, zoom: null, altitude: null };
                slide.orientation = { bearing: null, pitch: null, heading: null, lon: null, lat: null, fov: null };
                slide.mode = SlideMode.MAP_2D;
                slide.modelId = null;
                slide.photoId = null;
            }

            await this._handleMapChange(slide.mapId);

            this._scheduleAutosave();
            this._renderSlideEditor();
        });
        mapGroup.appendChild(mapSelect);
        this._slideEditorEl.appendChild(mapGroup);

        // Position section
        const positionGroup = document.createElement('div');
        positionGroup.className = 'briefing-editor-form-group';

        const positionLabel = document.createElement('label');
        positionLabel.textContent = 'Posi\u00E7\u00E3o';
        positionGroup.appendChild(positionLabel);

        const positionWrapper = document.createElement('div');
        positionWrapper.className = 'briefing-editor-position-wrapper';

        const positionDisplay = document.createElement('div');
        positionDisplay.className = 'briefing-editor-position-display';

        if (slide.position && slide.position.longitude !== null) {
            const posSpan = document.createElement('span');
            posSpan.className = 'briefing-editor-position-set';
            let posText = `Lat: ${slide.position.latitude?.toFixed(6)}, Lng: ${slide.position.longitude?.toFixed(6)}`;
            if (slide.position.zoom) {
                posText += `, Zoom: ${slide.position.zoom.toFixed(1)}`;
            }
            posSpan.textContent = posText;
            positionDisplay.appendChild(posSpan);
        } else {
            const warningSpan = document.createElement('span');
            warningSpan.className = 'briefing-editor-position-warning';
            warningSpan.innerHTML = EDITOR_ICONS.warning;
            const warningText = document.createTextNode(' Posi\u00E7\u00E3o n\u00E3o definida');
            warningSpan.appendChild(warningText);
            positionDisplay.appendChild(warningSpan);
        }
        positionWrapper.appendChild(positionDisplay);

        const captureBtn = document.createElement('button');
        captureBtn.className = 'briefing-editor-capture-btn';
        captureBtn.innerHTML = `${EDITOR_ICONS.crosshair}`;
        const captureBtnLabel = document.createElement('span');
        captureBtnLabel.textContent = 'Salvar Posi\u00E7\u00E3o';
        captureBtn.appendChild(captureBtnLabel);

        captureBtn.title = 'Salva a posição atual do visualizador ativo';
        addDomListener(this, captureBtn, 'click', () => this._handleCapturePosition());

        positionWrapper.appendChild(captureBtn);

        // Saved orientations dropdown button
        if (slide.mapId) {
            const savedBtn = document.createElement('button');
            savedBtn.className = 'briefing-editor-saved-orientations-btn';
            savedBtn.innerHTML = EDITOR_ICONS.savedOrientations;
            savedBtn.title = 'Usar orientação salva';
            addDomListener(this, savedBtn, 'click', () => this._openSavedOrientationsDropdown(savedBtn, slide));
            positionWrapper.appendChild(savedBtn);
        }

        positionGroup.appendChild(positionWrapper);

        // Resource availability warnings
        if (slide.mode === SlideMode.VIEWER_3D && slide.modelId) {
            const tilesetExists = config.tilesets?.some(t => t.id === slide.modelId);
            if (!tilesetExists) {
                const warn = document.createElement('div');
                warn.className = 'briefing-editor-resource-warning';
                const warnText = document.createTextNode(
                    `\u26A0 Modelo 3D "${slide.modelId}" n\u00E3o est\u00E1 dispon\u00EDvel nesta inst\u00E2ncia.`
                );
                warn.appendChild(warnText);
                positionGroup.appendChild(warn);
            }
        }
        if (slide.mode === SlideMode.VIEWER_360 && !config.features.imagens_panoramicas) {
            const warn = document.createElement('div');
            warn.className = 'briefing-editor-resource-warning';
            const warnText = document.createTextNode(
                '\u26A0 Servi\u00E7o de imagens 360 indispon\u00EDvel.'
            );
            warn.appendChild(warnText);
            positionGroup.appendChild(warn);
        }

        this._slideEditorEl.appendChild(positionGroup);

        // Content editor with Quill
        const contentGroup = document.createElement('div');
        contentGroup.className = 'briefing-editor-form-group briefing-editor-content-group';

        const contentLabelRow = document.createElement('div');
        contentLabelRow.className = 'briefing-editor-content-label-row';

        const contentLabel = document.createElement('label');
        contentLabel.textContent = 'Conte\u00FAdo';
        contentLabelRow.appendChild(contentLabel);

        if (slide.mapId) {
            const importNotesBtn = document.createElement('button');
            importNotesBtn.className = 'briefing-editor-import-notes-btn';
            importNotesBtn.innerHTML = EDITOR_ICONS.importNotes;
            importNotesBtn.title = 'Importar nota do mapa';
            addDomListener(this, importNotesBtn, 'click', () => this._handleImportNotes(slide));
            contentLabelRow.appendChild(importNotesBtn);
        }

        contentGroup.appendChild(contentLabelRow);

        const quillContainer = document.createElement('div');
        quillContainer.className = 'briefing-editor-quill-container';
        quillContainer.id = `briefing-quill-${slide.id}`;
        contentGroup.appendChild(quillContainer);

        this._slideEditorEl.appendChild(contentGroup);

        this._initQuillEditor(quillContainer, slide);

        // Restore scroll position after re-render
        if (scrollable && savedScrollTop > 0) {
            requestAnimationFrame(() => {
                scrollable.scrollTop = savedScrollTop;
            });
        }
    }

    /**
     * Populates the map selection dropdown.
     * @private
     */
    async _populateMapSelect(select, slide) {
        try {
            const mapNames = await getAllMapNamesStore();
            mapNames.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                if (slide.mapId === name) option.selected = true;
                select.appendChild(option);
            });

            // If slide has no map, auto-select the first available map
            if (!slide.mapId && mapNames.length > 0) {
                slide.mapId = mapNames[0];
                select.value = mapNames[0];
                this._scheduleAutosave();
            }
        } catch (error) {
            console.warn('Error loading map names:', error);
        }
    }

    /**
     * Handles map change for a slide.
     * Calls setCurrentMap and then switchMap to reload features on the map.
     * @private
     */
    async _handleMapChange(mapId) {
        if (!mapId) return;

        try {
            await setCurrentMap(mapId);

            // switchMap() renders 2D features on the map (setupMapFeatures)
            const baseLayerControl = getControl('BaseLayerControl');
            if (baseLayerControl) {
                await baseLayerControl.switchMap(false);
            }

            // Notify listeners (360 viewer reloads markers, saved photos update)
            this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });

            // Reload 3D features if the Cesium viewer is currently open
            // (3D markers/measurements/viewsheds are stored per-map)
            if (isViewer3DOpen()) {
                try {
                    const viewer3d = await import('@js/3d_models_viewer_tool/map_3d.js');
                    const cesiumViewer = viewer3d.getCesiumViewer?.();
                    const tilesetId = viewer3d.getCurrentTilesetId?.();
                    if (cesiumViewer && tilesetId) {
                        await viewer3d.reloadFeaturesForTileset(cesiumViewer, tilesetId);
                    }
                } catch (err) {
                    console.warn('Error reloading 3D features after map change:', err);
                }
            }

            if (this._map) {
                setTimeout(() => this._map.resize(), 100);
            }
        } catch (error) {
            console.warn('Error switching map:', error);
        }
    }

    /**
     * Initializes the Quill editor for slide content.
     * @private
     */
    async _initQuillEditor(container, slide) {
        try {
            if (this._quillEditor) {
                this._quillEditor = null;
            }

            this._quillEditor = await createQuillEditor(container, {
                placeholder: 'Digite o conte\u00FAdo do slide...',
                theme: 'snow',
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    [{ 'indent': '-1' }, { 'indent': '+1' }],
                    [{ 'align': [] }],
                    ['link', 'image'],
                    ['clean']
                ],
                enableImageCompression: true
            });

            if (slide.content) {
                this._quillEditor.root.innerHTML = slide.content;
            }

            this._quillEditor.on('text-change', () => {
                slide.content = this._quillEditor.root.innerHTML;
                this._scheduleAutosave();
            });

        } catch (error) {
            console.error('Error initializing Quill editor:', error);
            const errorMsg = document.createElement('p');
            errorMsg.className = 'briefing-editor-quill-error';
            errorMsg.textContent = 'Erro ao carregar editor';
            container.replaceChildren(errorMsg);
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

        import('sortablejs').then(({ default: Sortable }) => {
            this._sortableInstance = Sortable.create(this._slideListEl, {
                animation: 150,
                handle: '.briefing-editor-slide-handle',
                ghostClass: 'sortable-ghost',
                onEnd: async () => {
                    await this._flushAutosave();

                    const newOrder = Array.from(this._slideListEl.children)
                        .map(el => el.dataset.slideId)
                        .filter(Boolean);

                    await reorderSlides(this._briefing.id, newOrder);

                    this._briefing = await getBriefingById(this._briefing.id);
                    this._renderSlideList();
                }
            });
        });
    }

    // =========================================================================
    // SLIDE SELECTION
    // =========================================================================

    /**
     * Selects a slide for editing.
     * Uses instant transitions (no flyTo): opens/closes viewers as needed,
     * jumps to 2D position, and switches map if the slide references a different map.
     * @private
     * @param {string} slideId - Slide ID
     */
    async _selectSlide(slideId) {
        this._selectedSlideId = slideId;

        // Update visual selection in list
        const cards = this._slideListEl.querySelectorAll('.briefing-editor-slide-card');
        cards.forEach(card => {
            card.dataset.selected = (card.dataset.slideId === slideId).toString();
        });

        // Render the slide editor form
        this._renderSlideEditor();

        // Navigate to slide: instant transition (no flyTo)
        const slide = this._getSelectedSlide();
        if (slide && this._transitionService) {
            // Check resource availability — fall back to 2D if resource is missing
            const effectiveMode = this._getEffectiveSlideMode(slide);
            const transitionSlide = effectiveMode !== slide.mode
                ? { ...slide, mode: effectiveMode }
                : slide;

            await this._transitionService.transitionToSlideInstant(transitionSlide);
            this._applyLockedVisibilityProfile(effectiveMode);
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
     * Returns the effective viewer mode for a slide, falling back to MAP_2D
     * when the required resource (3D tileset or 360 service) is unavailable.
     * This prevents the editor from attempting to open viewers that will fail.
     * @private
     * @param {Object} slide - Slide object
     * @returns {string} Effective SlideMode
     */
    _getEffectiveSlideMode(slide) {
        if (slide.mode === SlideMode.VIEWER_3D && slide.modelId) {
            const tilesetExists = config.tilesets?.some(t => t.id === slide.modelId);
            if (!tilesetExists) return SlideMode.MAP_2D;
        }
        if (slide.mode === SlideMode.VIEWER_360) {
            if (!config.features.imagens_panoramicas) return SlideMode.MAP_2D;
        }
        return slide.mode || SlideMode.MAP_2D;
    }

    /**
     * Applies the locked visibility profile matching the given viewer mode.
     * @private
     * @param {string} mode - Effective SlideMode
     */
    _applyLockedVisibilityProfile(mode) {
        const visController = getUIVisibilityController();

        switch (mode) {
            case SlideMode.VIEWER_3D:
                visController.applyProfile(VisibilityProfile.BRIEFING_LOCKED_3D);
                break;
            case SlideMode.VIEWER_360:
                visController.applyProfile(VisibilityProfile.BRIEFING_LOCKED_360);
                break;
            default:
                visController.applyProfile(VisibilityProfile.BRIEFING_LOCKED_2D);
                break;
        }
    }

    // =========================================================================
    // POSITION CAPTURE (auto-detects active viewer)
    // =========================================================================

    /**
     * Auto-detects the active viewer mode and captures the current position.
     * Priority: 360 > 3D > 2D map (checks in that order).
     * @private
     */
    async _handleCapturePosition() {
        const slide = this._getSelectedSlide();
        if (!slide) {
            showWarning('Selecione um slide primeiro');
            return;
        }

        try {
            if (isStreetView360Open()) {
                // Capture from 360 viewer
                slide.mode = SlideMode.VIEWER_360;

                const {
                    getCurrentPhotoGeoPosition,
                    getCameraRotation,
                    getCameraFOV,
                    getCurrentPhotoName
                } = await import('@js/street_view_tool/street_view_viewer.js');

                const geoPos = await getCurrentPhotoGeoPosition();
                slide.position = {
                    longitude: geoPos?.longitude ?? null,
                    latitude: geoPos?.latitude ?? null,
                    zoom: null,
                    altitude: null
                };

                const rotation = getCameraRotation();
                const fov = getCameraFOV();
                slide.orientation = {
                    bearing: null,
                    pitch: null,
                    heading: null,
                    lon: rotation.lon,
                    lat: rotation.lat,
                    fov
                };

                slide.photoId = getCurrentPhotoName();
                slide.modelId = null;

            } else if (isViewer3DOpen()) {
                // Capture from live Cesium 3D viewer camera
                slide.mode = SlideMode.VIEWER_3D;

                const { getCesiumViewer, getCurrentTilesetId } = await import('@js/3d_models_viewer_tool/map_3d.js');
                const viewer = getCesiumViewer();

                if (viewer) {
                    const Cesium = window.Cesium;
                    const camera = viewer.camera;
                    const cartographic = camera.positionCartographic;
                    slide.position = {
                        longitude: Cesium.Math.toDegrees(cartographic.longitude),
                        latitude: Cesium.Math.toDegrees(cartographic.latitude),
                        zoom: null,
                        altitude: cartographic.height
                    };
                    slide.orientation = {
                        bearing: null,
                        pitch: Cesium.Math.toDegrees(camera.pitch),
                        heading: Cesium.Math.toDegrees(camera.heading),
                        lon: null,
                        lat: null,
                        fov: null
                    };
                }

                slide.modelId = getCurrentTilesetId() || slide.modelId;
                slide.photoId = null;

            } else {
                // Capture from 2D map
                slide.mode = SlideMode.MAP_2D;

                if (!this._map) {
                    showWarning('Mapa 2D n\u00E3o dispon\u00EDvel');
                    return;
                }

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
                    heading: null,
                    lon: null,
                    lat: null,
                    fov: null
                };

                slide.modelId = null;
                slide.photoId = null;
            }

            // Auto-capture current map
            slide.mapId = getCurrentMapNameSync();

            this._scheduleAutosave();
            this._renderSlideEditor();
            this._renderSlideList();
            showSuccess('Posi\u00E7\u00E3o salva');

        } catch (error) {
            console.error('Error capturing position:', error);
            showError('Erro ao salvar posi\u00E7\u00E3o');
        }
    }

    // =========================================================================
    // MAP NOTES IMPORT
    // =========================================================================

    /**
     * Imports map notes into the current slide content.
     * Replaces the Quill editor content with the map's notes.
     * @private
     * @param {Object} slide - Current slide
     */
    async _handleImportNotes(slide) {
        if (!slide.mapId) {
            showWarning('Este slide não possui um mapa associado');
            return;
        }

        try {
            const notesExist = await hasMapNotes(slide.mapId);
            if (!notesExist) {
                showWarning('Este mapa não possui notas');
                return;
            }

            const notes = await getMapNotes(slide.mapId);
            if (!notes) return;

            const html = notes.description?.trim() || '';

            if (!html) {
                showWarning('Este mapa não possui notas');
                return;
            }

            if (this._quillEditor) {
                this._quillEditor.root.innerHTML = html;
                slide.content = this._quillEditor.root.innerHTML;
                this._scheduleAutosave();
                showSuccess('Nota importada');
            }
        } catch (error) {
            console.error('Error importing map notes:', error);
            showError('Erro ao importar nota do mapa');
        }
    }

    // =========================================================================
    // SAVED ORIENTATIONS DROPDOWN
    // =========================================================================

    /**
     * Opens a dropdown with saved orientations (map 2D, 3D cameras, 360 orientations)
     * for the slide's associated map.
     * @private
     * @param {HTMLElement} anchorEl - Button element to anchor the dropdown
     * @param {Object} slide - Current slide
     */
    async _openSavedOrientationsDropdown(anchorEl, slide) {
        // Close any existing dropdown
        this._closeSavedOrientationsDropdown();

        if (!slide.mapId) return;

        try {
            const items = await this._loadSavedOrientations(slide.mapId);

            if (items.length === 0) {
                showWarning('Nenhuma orientação salva neste mapa');
                return;
            }

            const dropdown = document.createElement('div');
            dropdown.className = 'briefing-editor-orientations-dropdown';
            this._orientationsDropdown = dropdown;

            for (const item of items) {
                const btn = document.createElement('button');
                btn.className = 'briefing-editor-orientations-dropdown__item';

                const icon = document.createElement('span');
                icon.className = 'briefing-editor-orientations-dropdown__icon';
                icon.innerHTML = MODE_ICONS[item.mode] || EDITOR_ICONS.map2d;
                btn.appendChild(icon);

                const label = document.createElement('span');
                label.className = 'briefing-editor-orientations-dropdown__label';
                label.textContent = item.label;
                btn.appendChild(label);

                const type = document.createElement('span');
                type.className = 'briefing-editor-orientations-dropdown__type';
                type.textContent = item.typeLabel;
                btn.appendChild(type);

                addDomListener(this, btn, 'click', (e) => {
                    e.stopPropagation();
                    this._closeSavedOrientationsDropdown();
                    this._applySavedOrientation(slide, item);
                });

                dropdown.appendChild(btn);
            }

            // Position dropdown below the anchor button
            const wrapper = anchorEl.closest('.briefing-editor-position-wrapper');
            if (wrapper) {
                wrapper.appendChild(dropdown);
            }

            // Close on outside click
            const outsideHandler = (e) => {
                if (!dropdown.contains(e.target) && e.target !== anchorEl) {
                    this._closeSavedOrientationsDropdown();
                }
            };
            // Delay registering to prevent the current click from closing it
            requestAnimationFrame(() => {
                this._orientationsOutsideHandler = outsideHandler;
                document.addEventListener('mousedown', outsideHandler);
            });

        } catch (error) {
            console.error('Error loading saved orientations:', error);
            showError('Erro ao carregar orientações salvas');
        }
    }

    /**
     * Closes the saved orientations dropdown.
     * @private
     */
    _closeSavedOrientationsDropdown() {
        if (this._orientationsDropdown) {
            this._orientationsDropdown.remove();
            this._orientationsDropdown = null;
        }
        if (this._orientationsOutsideHandler) {
            document.removeEventListener('mousedown', this._orientationsOutsideHandler);
            this._orientationsOutsideHandler = null;
        }
    }

    /**
     * Loads saved orientations for a map: 2D position, 3D camera positions, 360 orientations.
     * @private
     * @param {string} mapName - Map name
     * @returns {Promise<Array<{mode: string, label: string, typeLabel: string, data: Object}>>}
     */
    async _loadSavedOrientations(mapName) {
        const items = [];

        // 1. Map 2D saved position
        try {
            const mapPos = await getMapPosition(mapName);
            if (mapPos.center_lat != null && mapPos.center_long != null && mapPos.zoom != null) {
                items.push({
                    mode: SlideMode.MAP_2D,
                    label: 'Posição do mapa',
                    typeLabel: 'Mapa 2D',
                    data: {
                        position: {
                            longitude: mapPos.center_long,
                            latitude: mapPos.center_lat,
                            zoom: mapPos.zoom,
                            altitude: null
                        },
                        orientation: {
                            bearing: mapPos.bearing || 0,
                            pitch: mapPos.pitch || 0,
                            heading: null,
                            lon: null,
                            lat: null,
                            fov: null
                        },
                        modelId: null,
                        photoId: null
                    }
                });
            }
        } catch {
            // Map position not available
        }

        // 2. 3D camera positions
        try {
            const cameraPositions = await getAllCameraPositions(mapName);
            for (const [tilesetId, cam] of Object.entries(cameraPositions)) {
                const tilesetConfig = config.tilesets?.find(t => t.id === tilesetId);
                // Only show if tileset is available in this instance
                if (!tilesetConfig) continue;

                const displayName = tilesetConfig.name || tilesetId;
                items.push({
                    mode: SlideMode.VIEWER_3D,
                    label: displayName,
                    typeLabel: '3D',
                    data: {
                        position: {
                            longitude: cam.position.longitude,
                            latitude: cam.position.latitude,
                            zoom: null,
                            altitude: cam.position.height
                        },
                        orientation: {
                            bearing: null,
                            pitch: cam.orientation.pitch,
                            heading: cam.orientation.heading,
                            lon: null,
                            lat: null,
                            fov: null
                        },
                        modelId: tilesetId,
                        photoId: null
                    }
                });
            }
        } catch {
            // 3D data not available
        }

        // 3. 360 orientations
        try {
            const orientations = await getAllOrientations(mapName);
            const photoNames = Object.keys(orientations);

            if (photoNames.length > 0) {
                const {
                    fetchPhotoMetadata,
                    getPhotoDisplayName
                } = await import('@js/street_view_tool/streetview-api.service.js');

                for (const photoName of photoNames) {
                    const ori = orientations[photoName];

                    // Fetch geo position and display name from API
                    let longitude = null;
                    let latitude = null;
                    let displayName = photoName;
                    try {
                        const [metadata, name] = await Promise.all([
                            fetchPhotoMetadata(photoName),
                            getPhotoDisplayName(photoName)
                        ]);
                        if (metadata?.camera?.lon != null && metadata?.camera?.lat != null) {
                            longitude = metadata.camera.lon;
                            latitude = metadata.camera.lat;
                        }
                        displayName = name || photoName;
                    } catch {
                        // API unavailable, use photoName as fallback
                    }

                    items.push({
                        mode: SlideMode.VIEWER_360,
                        label: displayName,
                        typeLabel: '360°',
                        data: {
                            position: {
                                longitude,
                                latitude,
                                zoom: null,
                                altitude: null
                            },
                            orientation: {
                                bearing: null,
                                pitch: null,
                                heading: null,
                                lon: ori.lon,
                                lat: ori.lat,
                                fov: ori.fov
                            },
                            modelId: null,
                            photoId: photoName
                        }
                    });
                }
            }
        } catch {
            // 360 data not available
        }

        return items;
    }

    /**
     * Applies a saved orientation to the slide and navigates to it.
     * @private
     * @param {Object} slide - Current slide
     * @param {Object} item - Saved orientation item from _loadSavedOrientations
     */
    async _applySavedOrientation(slide, item) {
        const { data, mode } = item;

        slide.mode = mode;
        slide.position = { ...data.position };
        slide.orientation = { ...data.orientation };
        slide.modelId = data.modelId;
        slide.photoId = data.photoId;

        // Keep current mapId (the orientation belongs to this map)
        this._scheduleAutosave();
        this._renderSlideEditor();
        this._renderSlideList();

        // Navigate to the new position
        if (this._transitionService) {
            const effectiveMode = this._getEffectiveSlideMode(slide);
            const transitionSlide = effectiveMode !== slide.mode
                ? { ...slide, mode: effectiveMode }
                : slide;

            await this._transitionService.transitionToSlideInstant(transitionSlide);
            this._applyLockedVisibilityProfile(effectiveMode);
        }

        showSuccess('Orientação aplicada');
    }

    // =========================================================================
    // TARGETED DOM UPDATES (avoid full re-renders)
    // =========================================================================

    /**
     * Updates only the title text in a slide card without rebuilding the list.
     * @private
     * @param {string} slideId - Slide ID
     * @param {string} title - New title
     */
    _updateSlideCardTitle(slideId, title) {
        if (!this._slideListEl) return;

        const card = this._slideListEl.querySelector(`[data-slide-id="${slideId}"]`);
        if (!card) return;

        const titleEl = card.querySelector('.briefing-editor-slide-title');
        if (titleEl) {
            const index = Array.from(this._slideListEl.children).indexOf(card);
            titleEl.textContent = title || `Slide ${index + 1}`;
        }
    }

    // =========================================================================
    // SLIDE ACTIONS
    // =========================================================================

    /**
     * Handles adding a new slide.
     * @private
     */
    async _handleAddSlide() {
        try {
            // Flush pending autosave so addSlide() reads up-to-date data from IndexedDB
            // (prevents losing position changes on the current slide)
            await this._flushAutosave();

            const emptySlide = createEmptySlide();
            // Pre-select the current map so the slide is ready for position capture
            emptySlide.mapId = getCurrentMapNameSync();
            const newSlide = await addSlide(this._briefing.id, emptySlide);

            this._briefing = await getBriefingById(this._briefing.id);
            this._renderSlideList();

            if (newSlide) {
                await this._selectSlide(newSlide.id);
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
     */
    async _handleDeleteSlide(slideId) {
        const slide = this._briefing.slides.find(s => s.id === slideId);
        const confirmed = await showConfirm(
            `Excluir slide "${slide?.title || 'Sem t\u00EDtulo'}"?`,
            { destructive: true }
        );

        if (!confirmed) return;

        try {
            await this._flushAutosave();
            await removeSlide(this._briefing.id, slideId);

            this._briefing = await getBriefingById(this._briefing.id);
            this._renderSlideList();

            if (this._selectedSlideId === slideId) {
                this._selectedSlideId = null;
                if (this._briefing.slides.length > 0) {
                    await this._selectSlide(this._briefing.slides[0].id);
                } else {
                    this._renderSlideEditor();
                }
            }

            showSuccess('Slide exclu\u00EDdo');
        } catch (error) {
            console.error('Error deleting slide:', error);
            showError('Erro ao excluir slide');
        }
    }

    /**
     * Opens modal to import slides from other briefings.
     * @private
     */
    async _handleImportSlides() {
        try {
            await this._flushAutosave();

            const allBriefings = await getAllBriefings();
            const availableBriefings = allBriefings
                .filter(b => b.id !== this._briefing.id)
                .map(b => ({
                    id: b.id,
                    name: b.name,
                    slideCount: b.slides?.length || 0
                }));

            if (availableBriefings.length === 0) {
                showWarning('Não há outros briefings para importar slides');
                return;
            }

            showImportSlidesModal(
                this._briefing.name,
                availableBriefings,
                (selectedIds) => this._importSlidesFromBriefings(selectedIds)
            );
        } catch (error) {
            console.error('Error opening import slides modal:', error);
            showError('Erro ao abrir importação de slides');
        }
    }

    /**
     * Copies slides from selected source briefings into the current one.
     * @private
     * @param {string[]} briefingIds - Source briefing IDs
     */
    async _importSlidesFromBriefings(briefingIds) {
        try {
            const sourceBriefings = await Promise.all(
                briefingIds.map(id => getBriefingById(id))
            );

            const newSlides = [];
            for (const sourceBriefing of sourceBriefings) {
                if (!sourceBriefing?.slides?.length) continue;

                for (const sourceSlide of sourceBriefing.slides) {
                    const cloned = deepClone(sourceSlide);
                    cloned.id = generateUUID();
                    delete cloned.sync;
                    delete cloned.order;
                    newSlides.push(cloned);
                }
            }

            if (newSlides.length === 0) {
                showWarning('Nenhum slide encontrado nos briefings selecionados');
                return;
            }

            const existingSlides = this._briefing.slides.map(s => ({ ...s }));
            const allSlides = [...existingSlides, ...newSlides];
            for (let i = 0; i < allSlides.length; i++) {
                allSlides[i].order = i;
            }

            await updateBriefing(this._briefing.id, { slides: allSlides });

            this._briefing = await getBriefingById(this._briefing.id);
            this._renderSlideList();

            showSuccess(`${newSlides.length} slide(s) importado(s)`);
        } catch (error) {
            console.error('Error importing slides:', error);
            showError('Erro ao importar slides');
        }
    }

    // =========================================================================
    // AUTOSAVE & PERSISTENCE
    // =========================================================================

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
     * Flushes any pending autosave immediately.
     * Must be called before store operations that read from IndexedDB
     * to avoid overwriting in-memory changes (e.g. captured positions).
     * @private
     */
    async _flushAutosave() {
        if (this._autosaveTimer) {
            clearTimeout(this._autosaveTimer);
            this._autosaveTimer = null;
            await this._save();
        }
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
                slides: this._briefing.slides,
                settings: this._briefing.settings
            });

            this._hasUnsavedChanges = false;

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

    // =========================================================================
    // PUBLIC API
    // =========================================================================

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
