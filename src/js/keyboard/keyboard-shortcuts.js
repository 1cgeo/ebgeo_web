// Path: js/keyboard/keyboard-shortcuts.js
import { undoLastAction, redoLastAction } from '../store';

/**
 * Keyboard shortcuts manager for the SIG map
 * Centralizes all shortcuts and their respective actions
 * Includes modal to display available shortcuts
 */
class KeyboardShortcuts {
    constructor(config) {
        this.map = config.map;
        this.selectionManager = config.selectionManager;
        this.toolManager = config.toolManager;
        this.baseLayerControl = config.baseLayerControl;
        this.clipboardManager = config.clipboardManager;
        this.addStreetViewControl = config.addStreetViewControl;
        this.mapControl = config.mapControl;

        this.controls = config.controls;

        this.handleKeyDown = this.handleKeyDown.bind(this);

        this.enabled = false;
    }

    /**
     * Enable keyboard shortcuts
     */
    enable() {
        if (!this.enabled) {
            document.addEventListener('keydown', this.handleKeyDown);
            this.enabled = true;
        }
    }

    /**
     * Disable keyboard shortcuts
     */
    disable() {
        if (this.enabled) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.enabled = false;
        }
    }

    /**
     * Check if user is typing in an input field
     * @param {HTMLElement} target - Event target
     * @returns {boolean} True if typing in input
     */
    isTypingInInput(target) {
        return ['INPUT', 'TEXTAREA'].includes(target.tagName);
    }

    /**
     * Check if Street View is open
     * @returns {boolean} True if Street View is open
     */
    isStreetViewOpen() {
        return this.addStreetViewControl.isOpen;
    }

    /**
     * Check if 3D viewer is open
     * @returns {boolean} True if 3D viewer is open
     */
    is3DViewerOpen() {
        const map3dContainer = document.getElementById('map-3d-container');
        return map3dContainer && map3dContainer.style.display !== 'none';
    }

    /**
     * Main keyboard event handler
     * @param {KeyboardEvent} e - Keyboard event
     */
    async handleKeyDown(e) {
        if (this.isTypingInInput(e.target)) {
            return;
        }

        if (this.isStreetViewOpen()) {
            return;
        }

        // Block shortcuts when 3D viewer is open
        if (this.is3DViewerOpen()) {
            return;
        }

        if (this.isNotesPanel() && !(e.ctrlKey && e.key.toLowerCase() === 's')) {
            return;
        }

        await this.processShortcut(e);
    }

    isNotesPanel() {
        return this.mapControl && this.mapControl.isNotesPanel && this.mapControl.isNotesPanel();
    }

    /**
     * Process shortcut based on key and modifiers
     * @param {KeyboardEvent} e - Keyboard event
     */
    async processShortcut(e) {
        const key = e.key.toLowerCase();
        const hasCtrl = e.ctrlKey;
        const hasShift = e.shiftKey;

        if (await this.handleSystemShortcuts(e, key, hasCtrl, hasShift)) {
            return;
        }

        if (!hasCtrl && !hasShift) {
            this.handleToolShortcuts(e, key);
        }

        if (hasCtrl && !hasShift) {
            await this.handleCtrlShortcuts(e, key);
        }
    }

    /**
     * Handle system shortcuts (Delete, Escape, Undo/Redo)
     * @param {KeyboardEvent} e - Keyboard event
     * @param {string} key - Pressed key
     * @param {boolean} hasCtrl - Ctrl key pressed
     * @param {boolean} hasShift - Shift key pressed
     * @returns {boolean} True if shortcut was handled
     */
    async handleSystemShortcuts(e, key, hasCtrl, hasShift) {
        switch (key) {
            case 'delete':
            case 'backspace':
                e.preventDefault();
                this.selectionManager.deleteSelectedFeatures();
                return true;

            case 'escape': {
                e.preventDefault();
                this.toolManager.deactivateCurrentTool();
                this.selectionManager.deselectAllFeatures();
                return true;
            }

            case 'z':
                if (hasCtrl && !hasShift) {
                    e.preventDefault();
                    if (undoLastAction()) {
                        this.baseLayerControl.switchMap(false);
                    }
                    return true;
                }
                break;

            case 'y':
                if (hasCtrl && !hasShift) {
                    e.preventDefault();
                    if (redoLastAction()) {
                        this.baseLayerControl.switchMap(false);
                    }
                    return true;
                }
                break;
        }
        return false;
    }

    /**
     * Handle tool activation shortcuts
     * @param {KeyboardEvent} e - Keyboard event
     * @param {string} key - Pressed key
     */
    handleToolShortcuts(e, key) {
        const toolMapping = {
            'q': this.controls.rectangleSelectionControl,
            'n': this.controls.vectorTileInfoControl,
            'p': this.controls.pointControl,
            'l': this.controls.lineControl,
            'a': this.controls.polygonControl,
            't': this.controls.textControl,
            'i': this.controls.imageControl,
            'c': this.controls.circleControl,
            'e': this.controls.ellipseControl,
            's': this.controls.arrowControl,
            'd': this.controls.boundaryControl,
            'f': this.controls.occupiedFrontControl,
            'm': this.controls.militarySymbolControl,
            'r': this.controls.rectangleControl,
            'b': this.controls.brushControl,
            'k': this.controls.coordinationMeasureControl
        };

        if (key === 'v') {
            if (this.map.getTerrain()) {
                e.preventDefault();
                this.toolManager.setActiveTool(this.controls.visibilityControl);
            }
            return;
        }

        if (key === 'o') {
            if (this.map.getTerrain()) {
                e.preventDefault();
                this.toolManager.setActiveTool(this.controls.losControl);
            }
            return;
        }

        const tool = toolMapping[key];
        if (tool) {
            e.preventDefault();
            this.toolManager.setActiveTool(tool);
        }
    }

    /**
     * Handle Ctrl shortcuts (Copy/Paste/Save)
     * @param {KeyboardEvent} e - Keyboard event
     * @param {string} key - Pressed key
     */
    async handleCtrlShortcuts(e, key) {
        switch (key) {
            case 'c':
                if (!this.isNotesPanel()) {
                    e.preventDefault();
                    this.clipboardManager.copy();
                }
                break;

            case 'v':
                if (!this.isNotesPanel()) {
                    e.preventDefault();
                    await this.clipboardManager.paste();
                }
                break;

            case 's':
                if (this.isNotesPanel()) {
                    e.preventDefault();
                    if (this.mapControl && this.mapControl.saveCurrentMapNotes) {
                        await this.mapControl.saveCurrentMapNotes();
                    }
                }
                break;
        }
    }

    /**
     * Cleanup - remove event listeners
     */
    destroy() {
        this.disable();
    }
}

export default KeyboardShortcuts;
