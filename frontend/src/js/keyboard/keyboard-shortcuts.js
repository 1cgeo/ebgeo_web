// Path: js/keyboard/keyboard-shortcuts.js

/**
 * @fileoverview Keyboard shortcuts manager for the 2D SIG map.
 * Centralizes all 2D map shortcuts and their respective actions.
 *
 * Note: 3D viewer shortcuts are now handled by keyboard-service-3d.js
 * Note: 360 viewer shortcuts are handled by keyboard_service_360.js
 * Both services disable this handler when active and re-enable when closed.
 */

import { undoLastAction, redoLastAction, getStateManager, isCurrentMapLockedSync } from '@store';
import { showConfirm } from '@modals/index.js';
import { showInChannel, showWarning } from '@utils/toast_service.js';
import { describeUndoRedoAction } from '@store/undo-redo-messages.js';
import { getViewModeController } from '@ui/view-mode.controller.js';
import { ensureControl } from '@tools/tool-registry.js';

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

        this.controls = config.controls;

        this.handleKeyDown = this.handleKeyDown.bind(this);

        this.enabled = false;

        /** @type {boolean} Lock to prevent concurrent undo/redo when key is held */
        this._isProcessingUndoRedo = false;
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
     * Check if keyboard shortcuts are enabled
     * @returns {boolean} True if enabled
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Check if user is typing in an input field or rich text editor
     * @param {HTMLElement} target - Event target
     * @returns {boolean} True if typing in input
     */
    isTypingInInput(target) {
        // Standard form inputs
        if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
            return true;
        }
        // Rich text editors (Quill uses contenteditable)
        if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
            return true;
        }
        // Quill editor container
        if (target.closest('.ql-editor')) {
            return true;
        }
        return false;
    }

    /**
     * Check if Street View is open
     * @returns {boolean} True if Street View is open
     */
    isStreetViewOpen() {
        return this.addStreetViewControl.isOpen;
    }

    /**
     * Main keyboard event handler
     * Note: When 3D viewer or 360 viewer is open, this handler is disabled
     * by their respective keyboard services.
     * @param {KeyboardEvent} e - Keyboard event
     */
    async handleKeyDown(e) {
        if (this.isTypingInInput(e.target)) {
            return;
        }

        // Street View 360 has its own keyboard service that disables this one,
        // but we keep this check as a safety fallback
        if (this.isStreetViewOpen()) {
            return;
        }

        await this.processShortcut(e);
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

        // Shift+C toggles spatial-comment placement. The single-letter keys are all taken by draw
        // tools (c = circle), so the comment tool — a collaboration annotation, not a draw tool —
        // uses a Shift combo. The actual write is permission-gated when the comment is created.
        if (hasShift && !hasCtrl && key === 'c') {
            e.preventDefault();
            this.controls.commentOverlay?.togglePlacement?.();
            return;
        }

        // Shift+E toggles the safe "view" mode for users who can edit (à la Felt's "Editar mapa").
        // A no-edit role is already locked to the view, so the toggle just hints there.
        if (hasShift && !hasCtrl && key === 'e') {
            e.preventDefault();
            getViewModeController().toggleManualView();
            return;
        }

        if (!hasCtrl && !hasShift) {
            await this.handleToolShortcuts(e, key);
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
                // A no-edit role (safe view) must not even reach the destructive confirm dialog — the
                // hidden toolbars aren't enough, since Delete is a bare keystroke. The map lock is the
                // pre-existing gate; both are belt-and-suspenders over the store-level guardWrite.
                if (!isCurrentMapLockedSync() && getViewModeController().canEdit()) {
                    await this._confirmAndDeleteSelectedFeatures();
                }
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
                    if (!isCurrentMapLockedSync() && !this._isProcessingUndoRedo) {
                        this._isProcessingUndoRedo = true;
                        try {
                            // skipSave: undo should revert state, not save pending edits first
                            // (saving would create a phantom undo entry before the actual undo)
                            this.selectionManager.deselectAllFeatures({ skipSave: true });
                            const action = await undoLastAction();
                            if (action) {
                                const message = describeUndoRedoAction(action, 'undo');
                                showInChannel('undo-redo', message, 'info', { duration: 1500 });
                                await this.baseLayerControl.switchMap(false);
                            } else {
                                showInChannel('undo-redo', 'Nada para desfazer', 'info', { duration: 1500 });
                            }
                        } finally {
                            this._isProcessingUndoRedo = false;
                        }
                    }
                    return true;
                }
                break;

            case 'y':
                if (hasCtrl && !hasShift) {
                    e.preventDefault();
                    if (!isCurrentMapLockedSync() && !this._isProcessingUndoRedo) {
                        this._isProcessingUndoRedo = true;
                        try {
                            // skipSave: redo should restore state, not save pending edits first
                            this.selectionManager.deselectAllFeatures({ skipSave: true });
                            const action = await redoLastAction();
                            if (action) {
                                const message = describeUndoRedoAction(action, 'redo');
                                showInChannel('undo-redo', message, 'info', { duration: 1500 });
                                await this.baseLayerControl.switchMap(false);
                            } else {
                                showInChannel('undo-redo', 'Nada para refazer', 'info', { duration: 1500 });
                            }
                        } finally {
                            this._isProcessingUndoRedo = false;
                        }
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
    async handleToolShortcuts(e, key) {
        // Snapping toggle (not a tool activation)
        if (key === 'g') {
            if (isCurrentMapLockedSync()) return;
            e.preventDefault();
            const sm = getStateManager();
            sm.set('ui.snapping.enabled', !sm.getUnsafe('ui.snapping.enabled'));
            return;
        }

        // Tools allowed even when locked (read-only utilities)
        const readOnlyTools = {
            'q': 'rectangleSelectionControl',
            'n': 'vectorTileInfoControl',
            'j': 'measureDistanceControl',
            'h': 'measureAreaControl',
            'x': 'measureAngleControl',
        };

        // Tools that require write access
        const writeTools = {
            'p': 'pointControl',
            'l': 'lineControl',
            'a': 'polygonControl',
            't': 'textControl',
            'i': 'imageControl',
            'c': 'circleControl',
            'e': 'ellipseControl',
            's': 'arrowControl',
            'd': 'boundaryControl',
            'f': 'occupiedFrontControl',
            'm': 'militarySymbolControl',
            'r': 'rectangleControl',
            'b': 'brushControl',
            'k': 'coordinationMeasureControl',
            'z': 'azimuthDistanceControl',
            'u': 'sectorControl',
            'w': 'declinationControl'
        };

        const locked = isCurrentMapLockedSync();

        if (key === 'v') {
            if (locked) return;
            e.preventDefault();
            if (this.map.getTerrain()) {
                await this._ativarPorChave('visibilityControl');
            } else {
                showWarning('Ative o terreno 3D para usar esta ferramenta');
            }
            return;
        }

        if (key === 'o') {
            if (locked) return;
            e.preventDefault();
            if (this.map.getTerrain()) {
                await this._ativarPorChave('losControl');
            } else {
                showWarning('Ative o terreno 3D para usar esta ferramenta');
            }
            return;
        }

        // Read-only tools always allowed
        const readOnlyTool = readOnlyTools[key];
        if (readOnlyTool) {
            e.preventDefault();
            await this._ativarPorChave(readOnlyTool);
            return;
        }

        // Write tools blocked when locked
        if (locked) return;

        const writeTool = writeTools[key];
        if (writeTool) {
            e.preventDefault();
            await this._ativarPorChave(writeTool);
        }
    }

    /**
     * Ativa uma ferramenta pelo `controlKey`, carregando o módulo dela se preciso.
     *
     * O `preventDefault()` DE QUEM CHAMA TEM DE VIR ANTES do await, e não é detalhe de estilo:
     * depois do primeiro `await` o evento já foi despachado, e cancelar o padrão do navegador
     * deixa de ter efeito. Por isso a chamada acima cancela primeiro e só então espera.
     *
     * A REPETIÇÃO DE TECLA é coberta pelo memo de `ensureControl`: segurar a tecla dispara um
     * `keydown` por autorrepetição, e todos compartilham a MESMA promessa de carga, então
     * nasce uma instância só. O `setActiveTool` repetido sobre a mesma instância é idempotente.
     *
     * @param {string} controlKey
     * @private
     */
    async _ativarPorChave(controlKey) {
        try {
            const control = await ensureControl(controlKey);
            this.toolManager.setActiveTool(control);
        } catch (erro) {
            console.error(`Falha ao carregar a ferramenta ${controlKey}:`, erro);
            showWarning('Não foi possível carregar a ferramenta');
        }
    }

    /**
     * Handle Ctrl shortcuts (Copy/Paste)
     * @param {KeyboardEvent} e - Keyboard event
     * @param {string} key - Pressed key
     */
    async handleCtrlShortcuts(e, key) {
        switch (key) {
            case 'c': {
                // Only hijack Ctrl+C for feature copy when a feature is selected AND the user is
                // NOT copying a native text selection (label, coordinate readout, list text, …).
                // Otherwise fall through to the browser so normal copy keeps working. (Inputs are
                // already handled upstream by isTypingInInput.)
                const hasFeatureSelection = this.selectionManager.getAllSelectedFeatures().length > 0;
                const sel = window.getSelection();
                const hasTextSelection = !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
                if (!hasFeatureSelection || hasTextSelection) return;
                e.preventDefault();
                this.clipboardManager.copy();
                break;
            }

            case 'v': {
                // Only hijack Ctrl+V when we actually hold copied feature data; otherwise let the
                // browser paste natively.
                if (!this.clipboardManager.hasClipboardData()) return;
                e.preventDefault();
                if (!isCurrentMapLockedSync()) {
                    await this.clipboardManager.paste();
                }
                break;
            }
        }
    }

    /**
     * Confirm and delete selected features.
     * Shows a confirmation dialog before deleting.
     * @private
     */
    async _confirmAndDeleteSelectedFeatures() {
        const selectedFeatures = this.selectionManager.getAllSelectedFeatures();
        if (selectedFeatures.length === 0) return;

        const isSingleSelection = selectedFeatures.length === 1;
        const confirmTitle = isSingleSelection
            ? 'Deletar esta feição?'
            : `Deletar ${selectedFeatures.length} feições?`;

        const confirmed = await showConfirm(confirmTitle, { destructive: true });
        if (confirmed) {
            await this.selectionManager.deleteSelectedFeatures();
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
