// Path: js/briefing/editor/briefing-editor.control.js

/**
 * @fileoverview Main briefing editor control.
 * Provides full-screen editor for creating and editing briefings.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────┐
 * ├─────────────────────────────────┬────────────────────────┤
 * │ LEFT PANEL (flex)               │ RIGHT PANEL (400px)    │
 * │ - Preview (map/3D/360)          │ - Header + Name/Save   │
 * │                                 │ - Slide List           │
 * │                                 │ - Slide Editor         │
 * └─────────────────────────────────┴────────────────────────┘
 *
 * The preview panel shows the correct viewer based on slide mode:
 * - MAP_2D: embeds #map-sig (MapLibre GL)
 * - VIEWER_3D: embeds #map-3d-container (Cesium)
 * - VIEWER_360: embeds #street-view-container (Three.js)
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
    getAllMapNamesStore,
    setCurrentMap,
    getControl
} from '../../store/index.js';
import {
    getAllMarkers,
    getMeasurements,
    getViewsheds,
    getCameraPosition
} from '../../store/cesium3d.operations.js';
import { getAllOrientations } from '../../store/streetview360.operations.js';
import { createQuillEditor } from '../../utilities/quill-helpers.js';
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

    close: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
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

        // Viewer embedding state
        this._activePreviewMode = null; // Current mode shown in preview: '2d' | '3d' | '360' | null
        this._originalMapParent = null;
        this._originalMapNextSibling = null;
        this._original3DParent = null;
        this._original3DNextSibling = null;
        this._original360Parent = null;
        this._original360NextSibling = null;

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

            // Ensure default settings (position=left, color=white)
            this._ensureDefaultSettings();

            // Enter edit mode
            const modeManager = getApplicationModeManager();
            modeManager.enterMode(ApplicationMode.BRIEFING_EDIT, {
                briefingId: this._briefing.id
            });

            // Create UI
            this._createUI();
            this._render();

            // Select first slide if exists — this will embed the correct viewer
            if (this._briefing.slides?.length > 0) {
                this._selectSlide(this._briefing.slides[0].id);
            } else {
                // No slides: show 2D map as default preview
                await this._switchPreviewMode(SlideMode.MAP_2D);
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

        // Restore all viewers to original positions
        await this._restoreAllViewers();

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
     * Closes any active 3D or 360 viewers before opening the editor.
     * @private
     */
    async _closeActiveViewers() {
        try {
            if (isViewer3DOpen()) {
                const { closeViewer } = await import('../../3d_models_viewer_tool/map_3d.js');
                await closeViewer();
            }

            if (isStreetView360Open()) {
                const { closeViewer360 } = await import('../../street_view_tool/street_view_viewer.js');
                await closeViewer360();
            }
        } catch (error) {
            console.warn('Error closing viewers:', error);
        }
    }

    /**
     * Switches the preview panel to show the viewer for the given mode.
     * Handles embedding/un-embedding of containers.
     *
     * @private
     * @param {string} mode - SlideMode value ('2d', '3d', '360')
     * @param {Object} [options] - Viewer-specific options
     * @param {string} [options.tilesetId] - Tileset ID for 3D mode
     * @param {string} [options.photoId] - Photo ID for 360 mode
     */
    async _switchPreviewMode(mode, options = {}) {
        // Skip if already showing the correct mode
        if (this._activePreviewMode === mode) {
            // But still load the resource if provided
            if (mode === SlideMode.VIEWER_3D && options.tilesetId) {
                await this._load3DTileset(options.tilesetId);
            } else if (mode === SlideMode.VIEWER_360 && options.photoId) {
                await this._load360Photo(options.photoId);
            }
            return;
        }

        // 1. Close the current viewer
        await this._closeCurrentPreview();

        // 2. Open the new viewer
        this._activePreviewMode = mode;

        switch (mode) {
        case SlideMode.MAP_2D:
            this._embedMapInPreview();
            break;

        case SlideMode.VIEWER_3D:
            if (options.tilesetId) {
                await this._openAndEmbed3D(options.tilesetId);
            } else {
                // No tileset selected yet — show placeholder in 3D area
                this._showPreviewPlaceholder('Selecione um modelo 3D');
            }
            break;

        case SlideMode.VIEWER_360:
            if (options.photoId) {
                await this._openAndEmbed360(options.photoId);
            } else {
                this._showPreviewPlaceholder('Selecione uma foto 360°');
            }
            break;
        }
    }

    /**
     * Closes/restores the currently active preview viewer.
     * @private
     */
    async _closeCurrentPreview() {
        if (!this._activePreviewMode) return;

        switch (this._activePreviewMode) {
        case SlideMode.MAP_2D:
            this._restoreMapFromPreview();
            break;

        case SlideMode.VIEWER_3D:
            await this._restore3DFromPreview();
            break;

        case SlideMode.VIEWER_360:
            await this._restore360FromPreview();
            break;
        }

        // Clear any placeholder
        this._clearPreviewPlaceholder();

        this._activePreviewMode = null;
    }

    /**
     * Restores all viewers to their original DOM positions.
     * Called when the editor closes.
     * @private
     */
    async _restoreAllViewers() {
        await this._closeCurrentPreview();

        // Safety: make sure all containers are back and visible
        const mapSig = document.getElementById('map-sig');
        if (mapSig) {
            mapSig.style.display = '';
        }
    }

    // -- 2D Map Embedding --

    /**
     * Moves #map-sig into the preview panel.
     * @private
     */
    _embedMapInPreview() {
        const mapContainer = document.getElementById('map-sig');
        if (!mapContainer || !this._previewEl) return;

        // Store original parent for restoration (only once)
        if (!this._originalMapParent) {
            this._originalMapParent = mapContainer.parentElement;
            this._originalMapNextSibling = mapContainer.nextSibling;
        }

        mapContainer.style.display = 'block';
        this._previewEl.appendChild(mapContainer);

        if (this._map) {
            setTimeout(() => this._map.resize(), 100);
        }
    }

    /**
     * Restores #map-sig to its original DOM position.
     * @private
     */
    _restoreMapFromPreview() {
        const mapContainer = document.getElementById('map-sig');
        if (!mapContainer || !this._originalMapParent) return;

        if (this._originalMapNextSibling) {
            this._originalMapParent.insertBefore(mapContainer, this._originalMapNextSibling);
        } else {
            this._originalMapParent.appendChild(mapContainer);
        }

        if (this._map) {
            setTimeout(() => this._map.resize(), 100);
        }

        this._originalMapParent = null;
        this._originalMapNextSibling = null;
    }

    // -- 3D Cesium Embedding --

    /**
     * Initializes Cesium with a tileset and embeds the container in preview.
     * @private
     * @param {string} tilesetId - Tileset to load
     */
    async _openAndEmbed3D(tilesetId) {
        try {
            const { openViewerWithTileset } = await import('../../3d_models_viewer_tool/map_3d.js');
            await openViewerWithTileset(tilesetId);

            const map3dContainer = document.getElementById('map-3d-container');
            if (!map3dContainer || !this._previewEl) return;

            // Store original parent (only once)
            if (!this._original3DParent) {
                this._original3DParent = map3dContainer.parentElement;
                this._original3DNextSibling = map3dContainer.nextSibling;
            }

            // Hide 2D map (should already be restored, but ensure)
            const mapSig = document.getElementById('map-sig');
            if (mapSig) mapSig.style.display = 'none';

            // Show and embed 3D container
            map3dContainer.style.display = 'block';
            map3dContainer.classList.add('briefing-editor-embedded');
            this._previewEl.appendChild(map3dContainer);

            // Hide 3D toolbar and close button (not needed in editor context)
            this._hide3DChrome();
        } catch (error) {
            console.error('Error opening 3D viewer:', error);
            showError('Erro ao abrir visualizador 3D');
        }
    }

    /**
     * Loads a different tileset without re-embedding.
     * @private
     * @param {string} tilesetId - Tileset to switch to
     */
    async _load3DTileset(tilesetId) {
        try {
            const { openViewerWithTileset } = await import('../../3d_models_viewer_tool/map_3d.js');
            await openViewerWithTileset(tilesetId);
        } catch (error) {
            console.error('Error switching tileset:', error);
        }
    }

    /**
     * Hides 3D toolbar and close button for editor context.
     * @private
     */
    _hide3DChrome() {
        const toolbar3d = document.getElementById('toolbar-3d');
        const closeBtn3d = document.getElementById('close-3d-viewer-button');
        if (toolbar3d) toolbar3d.style.display = 'none';
        if (closeBtn3d) closeBtn3d.style.display = 'none';
    }

    /**
     * Restores #map-3d-container to its original DOM position and closes 3D.
     * @private
     */
    async _restore3DFromPreview() {
        const map3dContainer = document.getElementById('map-3d-container');

        // Close 3D viewer (pause rendering, remove cesium-active class)
        try {
            const { closeViewer } = await import('../../3d_models_viewer_tool/map_3d.js');
            closeViewer();
        } catch (error) {
            console.warn('Error closing 3D viewer:', error);
        }

        if (map3dContainer) {
            map3dContainer.classList.remove('briefing-editor-embedded');
            map3dContainer.style.display = 'none';

            if (this._original3DParent) {
                if (this._original3DNextSibling) {
                    this._original3DParent.insertBefore(map3dContainer, this._original3DNextSibling);
                } else {
                    this._original3DParent.appendChild(map3dContainer);
                }
            }
        }

        // Restore 3D toolbar to default state
        const toolbar3d = document.getElementById('toolbar-3d');
        if (toolbar3d) toolbar3d.style.display = '';

        // Unhide 2D map
        const mapSig = document.getElementById('map-sig');
        if (mapSig) mapSig.style.display = '';

        this._original3DParent = null;
        this._original3DNextSibling = null;
    }

    // -- 360 Three.js Embedding --

    /**
     * Initializes Three.js 360 viewer with a photo and embeds the container in preview.
     * @private
     * @param {string} photoId - Photo to load
     */
    async _openAndEmbed360(photoId) {
        try {
            const { openViewer360WithPhoto } = await import('../../street_view_tool/street_view_viewer.js');
            await openViewer360WithPhoto(photoId);

            const streetViewContainer = document.getElementById('street-view-container');
            if (!streetViewContainer || !this._previewEl) return;

            // Store original parent (only once)
            if (!this._original360Parent) {
                this._original360Parent = streetViewContainer.parentElement;
                this._original360NextSibling = streetViewContainer.nextSibling;
            }

            // Hide 2D map
            const mapSig = document.getElementById('map-sig');
            if (mapSig) mapSig.style.display = 'none';

            // Show and embed 360 container
            streetViewContainer.style.display = 'block';
            streetViewContainer.classList.add('briefing-editor-embedded');
            this._previewEl.appendChild(streetViewContainer);

            // Hide 360 toolbar, close button, mini-map (not needed in editor)
            this._hide360Chrome();
        } catch (error) {
            console.error('Error opening 360 viewer:', error);
            showError('Erro ao abrir visualizador 360°');
        }
    }

    /**
     * Loads a different photo without re-embedding.
     * @private
     * @param {string} photoId - Photo to load
     */
    async _load360Photo(photoId) {
        try {
            const { openViewer360WithPhoto } = await import('../../street_view_tool/street_view_viewer.js');
            await openViewer360WithPhoto(photoId);
        } catch (error) {
            console.error('Error loading 360 photo:', error);
        }
    }

    /**
     * Hides 360 toolbar, close button, mini-map for editor context.
     * @private
     */
    _hide360Chrome() {
        const toolbar360 = document.getElementById('toolbar-360');
        const closeBtn360 = document.getElementById('close-street-view-button');
        const miniMap = document.getElementById('mini-map-street-view');
        if (toolbar360) toolbar360.style.display = 'none';
        if (closeBtn360) closeBtn360.style.display = 'none';
        if (miniMap) miniMap.style.display = 'none';
    }

    /**
     * Restores #street-view-container to its original DOM position and closes 360.
     * @private
     */
    async _restore360FromPreview() {
        const streetViewContainer = document.getElementById('street-view-container');

        // Close 360 viewer (pause rendering, remove streetview-active class)
        try {
            const { closeViewer360 } = await import('../../street_view_tool/street_view_viewer.js');
            await closeViewer360();
        } catch (error) {
            console.warn('Error closing 360 viewer:', error);
        }

        if (streetViewContainer) {
            streetViewContainer.classList.remove('briefing-editor-embedded');
            streetViewContainer.style.display = 'none';

            if (this._original360Parent) {
                if (this._original360NextSibling) {
                    this._original360Parent.insertBefore(streetViewContainer, this._original360NextSibling);
                } else {
                    this._original360Parent.appendChild(streetViewContainer);
                }
            }
        }

        // Restore 360 toolbar to default state
        const toolbar360 = document.getElementById('toolbar-360');
        if (toolbar360) toolbar360.style.display = '';

        // Unhide 2D map
        const mapSig = document.getElementById('map-sig');
        if (mapSig) mapSig.style.display = '';

        this._original360Parent = null;
        this._original360NextSibling = null;
    }

    // -- Preview Placeholder --

    /**
     * Shows a placeholder message in the preview panel.
     * @private
     * @param {string} message - Message to display
     */
    _showPreviewPlaceholder(message) {
        this._clearPreviewPlaceholder();

        // Still need to embed the map so background is visible
        this._embedMapInPreview();

        const placeholder = document.createElement('div');
        placeholder.className = 'briefing-editor-preview-placeholder-overlay';
        placeholder.innerHTML = `<p>${message}</p>`;
        this._previewEl.appendChild(placeholder);
    }

    /**
     * Removes any preview placeholder.
     * @private
     */
    _clearPreviewPlaceholder() {
        if (!this._previewEl) return;
        const existing = this._previewEl.querySelector('.briefing-editor-preview-placeholder-overlay');
        if (existing) {
            existing.remove();
        }
    }

    // =========================================================================
    // UI CREATION
    // =========================================================================

    /**
     * Creates the editor UI structure.
     * @private
     */
    _createUI() {
        this._container = document.createElement('div');
        this._container.className = 'briefing-editor';
        this._container.id = 'briefing-editor';

        addDomListener(this, this._container, 'click', (e) => e.stopPropagation());

        document.body.appendChild(this._container);
    }

    /**
     * Renders the editor content.
     * @private
     */
    _render() {
        this._container.innerHTML = '';

        const content = document.createElement('div');
        content.className = 'briefing-editor-content';

        // Preview panel on the left (takes remaining space)
        this._leftPanel = this._createPreviewPanel();
        content.appendChild(this._leftPanel);

        // Editing panel on the right (fixed width)
        this._rightPanel = this._createEditingPanel();
        content.appendChild(this._rightPanel);

        this._container.appendChild(content);

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
     * Creates the editing panel (right side: header + slides + slide editor).
     * @private
     * @returns {HTMLElement}
     */
    _createEditingPanel() {
        const panel = document.createElement('div');
        panel.className = 'briefing-editor-editing-panel';

        const panelHeader = this._createPanelHeader();
        panel.appendChild(panelHeader);

        const scrollableContent = document.createElement('div');
        scrollableContent.className = 'briefing-editor-scrollable';

        const slidesSection = document.createElement('div');
        slidesSection.className = 'briefing-editor-slides-section';

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

        this._slideListEl = document.createElement('div');
        this._slideListEl.className = 'briefing-editor-slide-list';
        this._renderSlideList();
        slidesSection.appendChild(this._slideListEl);

        scrollableContent.appendChild(slidesSection);

        this._slideEditorEl = document.createElement('div');
        this._slideEditorEl.className = 'briefing-editor-slide-editor';
        scrollableContent.appendChild(this._slideEditorEl);

        panel.appendChild(scrollableContent);

        return panel;
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
    // SLIDE EDITOR – RESOURCE DROPDOWNS
    // =========================================================================

    /**
     * Populates the map selection dropdown.
     * @private
     */
    async _populateMapSelect(select, slide) {
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Selecione um mapa...';
        defaultOption.disabled = true;
        if (!slide.mapId) defaultOption.selected = true;
        select.appendChild(defaultOption);

        try {
            const mapNames = await getAllMapNamesStore();
            mapNames.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                if (slide.mapId === name) option.selected = true;
                select.appendChild(option);
            });
        } catch (error) {
            console.warn('Error loading map names:', error);
        }
    }

    /**
     * Populates the tileset/3D model dropdown.
     * @private
     */
    async _populateTilesetSelect(select, slide) {
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Selecione um modelo 3D...';
        defaultOption.disabled = true;
        if (!slide.modelId) defaultOption.selected = true;
        select.appendChild(defaultOption);

        if (!slide.mapId) return;

        try {
            const tilesets = config.tilesets || [];

            for (const tileset of tilesets) {
                const [markers, measurements, viewsheds, camera] = await Promise.all([
                    getAllMarkers(slide.mapId),
                    getMeasurements(tileset.id, slide.mapId),
                    getViewsheds(tileset.id, slide.mapId),
                    getCameraPosition(tileset.id, slide.mapId)
                ]);

                const tilesetMarkers = markers.filter(m => m.tilesetId === tileset.id);
                const hasData = tilesetMarkers.length > 0 ||
                               measurements.length > 0 ||
                               viewsheds.length > 0 ||
                               camera !== null;

                if (hasData) {
                    const option = document.createElement('option');
                    option.value = tileset.id;
                    option.textContent = tileset.name || tileset.id;
                    if (slide.modelId === tileset.id) option.selected = true;
                    select.appendChild(option);
                }
            }
        } catch (error) {
            console.warn('Error loading tilesets:', error);
        }
    }

    /**
     * Populates the 360 photo dropdown.
     * @private
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
            const orientations = await getAllOrientations(slide.mapId);

            for (const photoName of Object.keys(orientations)) {
                const orientation = orientations[photoName];
                if (orientation && (!orientation.sync || !orientation.sync.deleted)) {
                    const option = document.createElement('option');
                    option.value = photoName;
                    option.textContent = photoName;
                    if (slide.photoId === photoName) option.selected = true;
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
     */
    async _render3DResourceSection(slide) {
        const modelGroup = document.createElement('div');
        modelGroup.className = 'briefing-editor-form-group';

        const modelLabel = document.createElement('label');
        modelLabel.textContent = 'Modelo 3D';
        modelGroup.appendChild(modelLabel);

        const modelSelect = document.createElement('select');
        modelSelect.className = 'briefing-editor-select';
        await this._populateTilesetSelect(modelSelect, slide);

        const hasOptions = modelSelect.options.length > 1;

        if (!hasOptions && slide.mapId) {
            const warningDiv = document.createElement('div');
            warningDiv.className = 'briefing-editor-resource-warning';
            warningDiv.innerHTML = `${EDITOR_ICONS.warning}<span>Nenhum modelo 3D salvo para este mapa</span>`;
            modelGroup.appendChild(warningDiv);
            slide._validationError = 'NO_3D_DATA';
        } else {
            modelGroup.appendChild(modelSelect);
            addDomListener(this, modelSelect, 'change', async () => {
                slide.modelId = modelSelect.value || null;
                if (slide.modelId) {
                    await this._switchPreviewMode(SlideMode.VIEWER_3D, { tilesetId: slide.modelId });
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
            const warningDiv = document.createElement('div');
            warningDiv.className = 'briefing-editor-resource-warning';
            warningDiv.innerHTML = `${EDITOR_ICONS.warning}<span>Nenhuma foto 360° salva para este mapa</span>`;
            photoGroup.appendChild(warningDiv);
            slide._validationError = 'NO_360_DATA';
        } else {
            photoGroup.appendChild(photoSelect);
            addDomListener(this, photoSelect, 'change', async () => {
                slide.photoId = photoSelect.value || null;
                if (slide.photoId) {
                    await this._switchPreviewMode(SlideMode.VIEWER_360, { photoId: slide.photoId });
                }
                this._scheduleAutosave();
            });
            delete slide._validationError;
        }

        this._slideEditorEl.appendChild(photoGroup);
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

            // switchMap() renders features on the map (setupMapFeatures)
            const baseLayerControl = getControl('BaseLayerControl');
            if (baseLayerControl) {
                await baseLayerControl.switchMap(false);
            }

            if (this._map) {
                setTimeout(() => this._map.resize(), 100);
            }
        } catch (error) {
            console.warn('Error switching map:', error);
        }
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

        // Warning icon
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

    // =========================================================================
    // RIGHT PANEL
    // =========================================================================

    /**
     * Creates the preview panel (left side: map/3D/360 viewer).
     * @private
     * @returns {HTMLElement}
     */
    _createPreviewPanel() {
        const panel = document.createElement('div');
        panel.className = 'briefing-editor-preview-panel';

        this._previewEl = document.createElement('div');
        this._previewEl.className = 'briefing-editor-preview';
        this._previewEl.id = 'briefing-editor-preview';

        panel.appendChild(this._previewEl);

        return panel;
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
            // Targeted update: only update the title text in the slide card
            this._updateSlideCardTitle(slide.id, slide.title);
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
            addDomListener(this, modeBtn, 'click', async () => {
                slide.mode = mode;
                // Clear position when mode changes (different coordinate systems)
                slide.position = { longitude: null, latitude: null, zoom: null, altitude: null };
                slide.orientation = { bearing: 0, pitch: 0, heading: null };
                this._scheduleAutosave();
                // Full re-render needed: form structure changes based on mode
                await this._renderSlideEditor();
                this._renderSlideList();
                // Switch viewer to match new mode
                await this._updatePreviewForSlide();
            });
            modeSelector.appendChild(modeBtn);
        });

        modeGroup.appendChild(modeSelector);
        this._slideEditorEl.appendChild(modeGroup);

        // Map selection (for all modes)
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
            slide.modelId = null;
            slide.photoId = null;

            await this._handleMapChange(slide.mapId);

            this._scheduleAutosave();
            this._renderSlideEditor();
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

        const captureBtn = document.createElement('button');
        captureBtn.className = 'briefing-editor-capture-btn';
        captureBtn.innerHTML = `${EDITOR_ICONS.crosshair}<span>Capturar</span>`;
        captureBtn.title = 'Captura a posição atual do visualizador';
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
     * Initializes the Quill editor for slide content.
     * @private
     */
    async _initQuillEditor(container, slide) {
        try {
            if (this._quillEditor) {
                this._quillEditor = null;
            }

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

            if (slide.content) {
                this._quillEditor.root.innerHTML = slide.content;
            }

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

                    this._briefing = await getBriefingById(this._briefing.id);
                    this._renderSlideList();
                }
            });
        });
    }

    // =========================================================================
    // SLIDE SELECTION & PREVIEW UPDATE
    // =========================================================================

    /**
     * Selects a slide for editing and updates the preview to match its mode.
     * @private
     * @param {string} slideId - Slide ID
     */
    _selectSlide(slideId) {
        this._selectedSlideId = slideId;

        // Update visual selection in list
        const cards = this._slideListEl.querySelectorAll('.briefing-editor-slide-card');
        cards.forEach(card => {
            card.dataset.selected = (card.dataset.slideId === slideId).toString();
        });

        // Render the slide editor form
        this._renderSlideEditor();

        // Switch preview to the correct viewer for this slide's mode
        this._updatePreviewForSlide();
    }

    /**
     * Updates the preview panel to match the selected slide's mode and resource.
     * This is the central method that switches between 2D map, 3D Cesium, and 360 Three.js.
     * @private
     */
    async _updatePreviewForSlide() {
        const slide = this._getSelectedSlide();
        if (!slide) {
            await this._switchPreviewMode(SlideMode.MAP_2D);
            return;
        }

        switch (slide.mode) {
        case SlideMode.MAP_2D:
            await this._switchPreviewMode(SlideMode.MAP_2D);
            // Navigate map to slide position if available
            this._flyMapToSlidePosition(slide);
            break;

        case SlideMode.VIEWER_3D:
            await this._switchPreviewMode(SlideMode.VIEWER_3D, {
                tilesetId: slide.modelId
            });
            // Navigate Cesium camera if position saved
            if (slide.modelId && slide.position?.longitude !== null) {
                this._flyCesiumToSlidePosition(slide);
            }
            break;

        case SlideMode.VIEWER_360:
            await this._switchPreviewMode(SlideMode.VIEWER_360, {
                photoId: slide.photoId
            });
            // Set 360 camera orientation if saved
            if (slide.photoId && slide.orientation?.lon !== undefined) {
                this._set360CameraOrientation(slide);
            }
            break;
        }
    }

    /**
     * Flies the MapLibre map to the slide's saved position.
     * @private
     */
    _flyMapToSlidePosition(slide) {
        if (!slide.position || slide.position.longitude === null || !this._map) return;

        const flyOptions = {
            center: [slide.position.longitude, slide.position.latitude],
            zoom: slide.position.zoom || 12,
            duration: 1000
        };

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

    /**
     * Flies the Cesium camera to the slide's saved position.
     * @private
     */
    async _flyCesiumToSlidePosition(slide) {
        if (!slide.position || slide.position.longitude === null) return;

        try {
            const { getCesiumViewer } = await import('../../3d_models_viewer_tool/map_3d.js');
            const viewer = getCesiumViewer();
            if (!viewer || !viewer.camera) return;

            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(
                    slide.position.longitude,
                    slide.position.latitude,
                    slide.position.altitude || 1000
                ),
                orientation: {
                    heading: Cesium.Math.toRadians(slide.orientation?.heading || 0),
                    pitch: Cesium.Math.toRadians(slide.orientation?.pitch || -90),
                    roll: 0
                },
                duration: 1.5
            });
        } catch (error) {
            console.warn('Error flying Cesium camera:', error);
        }
    }

    /**
     * Sets the 360 camera orientation from slide data.
     * @private
     */
    async _set360CameraOrientation(slide) {
        if (!slide.orientation) return;

        try {
            const { setCameraRotation, setCameraFOV } = await import('../../street_view_tool/street_view_viewer.js');

            if (typeof slide.orientation.lon === 'number' && typeof slide.orientation.lat === 'number') {
                setCameraRotation(slide.orientation.lon, slide.orientation.lat);
            }
            if (typeof slide.orientation.fov === 'number' && setCameraFOV) {
                setCameraFOV(slide.orientation.fov);
            }
        } catch (error) {
            console.warn('Error setting 360 camera orientation:', error);
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

    // =========================================================================
    // TARGETED DOM UPDATES (avoid full re-renders)
    // =========================================================================

    /**
     * Updates only the position display in the slide editor without re-rendering.
     * @private
     * @param {Object} slide - Slide data
     */
    _updatePositionDisplay(slide) {
        if (!this._slideEditorEl) return;

        const positionDisplay = this._slideEditorEl.querySelector('.briefing-editor-position-display');
        if (!positionDisplay) return;

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
    }

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

    /**
     * Updates the warning icon in a slide card without rebuilding the list.
     * @private
     * @param {Object} slide - Slide data
     */
    _updateSlideCardWarnings(slide) {
        if (!this._slideListEl) return;

        const card = this._slideListEl.querySelector(`[data-slide-id="${slide.id}"]`);
        if (!card) return;

        // Remove existing warning
        const existingWarning = card.querySelector('.briefing-editor-slide-warning');
        if (existingWarning) existingWarning.remove();

        const hasPositionWarning = !slide.position || slide.position.longitude === null;
        const hasResourceWarning = !!slide._validationError;

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

            // Insert before the delete button
            const deleteBtn = card.querySelector('.briefing-editor-slide-delete-btn');
            if (deleteBtn) {
                card.insertBefore(warning, deleteBtn);
            } else {
                card.appendChild(warning);
            }
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
            const newSlide = await addSlide(this._briefing.id, createEmptySlide());

            this._briefing = await getBriefingById(this._briefing.id);
            this._renderSlideList();

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

            this._briefing = await getBriefingById(this._briefing.id);
            this._renderSlideList();

            if (this._selectedSlideId === slideId) {
                this._selectedSlideId = null;
                if (this._briefing.slides.length > 0) {
                    this._selectSlide(this._briefing.slides[0].id);
                } else {
                    this._renderSlideEditor();
                    await this._switchPreviewMode(SlideMode.MAP_2D);
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
     * Each mode captures from its own active viewer.
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
                if (!this._map || this._activePreviewMode !== SlideMode.MAP_2D) {
                    showWarning('Mapa 2D não está ativo');
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
                    heading: null
                };

            } else if (slide.mode === SlideMode.VIEWER_3D) {
                if (this._activePreviewMode !== SlideMode.VIEWER_3D || !isViewer3DOpen()) {
                    showWarning('Visualizador 3D não está ativo. Selecione um modelo 3D primeiro.');
                    return;
                }

                const { getCesiumViewer } = await import('../../3d_models_viewer_tool/map_3d.js');
                const viewer = getCesiumViewer();
                if (!viewer?.camera) {
                    showWarning('Câmera 3D não disponível');
                    return;
                }

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

            } else if (slide.mode === SlideMode.VIEWER_360) {
                if (this._activePreviewMode !== SlideMode.VIEWER_360 || !isStreetView360Open()) {
                    showWarning('Visualizador 360° não está ativo. Selecione uma foto primeiro.');
                    return;
                }

                const { getCurrentPhotoName, getCameraRotation, getCameraFOV } =
                    await import('../../street_view_tool/street_view_viewer.js');

                const photoName = getCurrentPhotoName();
                const rotation = getCameraRotation();
                const fov = getCameraFOV();

                if (!photoName || !rotation) {
                    showWarning('Orientação 360° não disponível');
                    return;
                }

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
            }

            this._scheduleAutosave();
            // Targeted updates: only update position display and warning icon
            this._updatePositionDisplay(slide);
            this._updateSlideCardWarnings(slide);
            showSuccess('Posição capturada');

        } catch (error) {
            console.error('Error capturing position:', error);
            showError('Erro ao capturar posição');
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
