// Path: js/controls_sig/keyboard_shortcuts.js
import { undoLastAction, redoLastAction } from './store/store.js';

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
        this.handleModalKeyDown = this.handleModalKeyDown.bind(this);

        this.enabled = false;

        this.modal = null;
        this.modalInitialized = false;
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
     * Initialize shortcuts modal
     */
    initModal() {
        if (this.modalInitialized) {
            return;
        }

        const button = document.getElementById('shortcuts-button');
        if (!button) {
            console.warn('Shortcuts button not found');
            return;
        }

        this.modal = document.getElementById('shortcuts-modal');
        if (!this.modal) {
            console.warn('Shortcuts modal not found');
            return;
        }

        this.setupModalEventListeners();
        this.modalInitialized = true;
    }

    /**
     * Setup modal event listeners
     */
    setupModalEventListeners() {
        const button = document.getElementById('shortcuts-button');
        const closeBtn = document.querySelector('.shortcuts-modal-close');

        if (button) {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                this.showModal();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hideModal();
            });
        }

        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.hideModal();
                }
            });
        }

        document.addEventListener('keydown', this.handleModalKeyDown);
    }

    /**
     * Show shortcuts modal
     */
    showModal() {
        if (!this.modal) {
            console.warn('Modal not initialized');
            return;
        }

        this.populateModal();
        this.modal.style.display = 'block';
        this.modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hide shortcuts modal
     */
    hideModal() {
        if (!this.modal) {
            return;
        }

        this.modal.style.display = 'none';
        this.modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = 'auto';
    }

    /**
     * Populate modal with shortcuts
     */
    populateModal() {
        const shortcutsInfo = this.getShortcutsInfo();

        const systemGrid = document.getElementById('system-shortcuts');
        const toolsGrid = document.getElementById('tools-shortcuts');

        if (!systemGrid || !toolsGrid) {
            console.warn('Modal grid elements not found');
            return;
        }

        systemGrid.innerHTML = '';
        toolsGrid.innerHTML = '';

        Object.entries(shortcutsInfo.system).forEach(([key, description]) => {
            this.addShortcutToGrid(systemGrid, key, description);
        });

        Object.entries(shortcutsInfo.tools).forEach(([key, description]) => {
            this.addShortcutToGrid(toolsGrid, key, description);
        });
    }

    /**
     * Add shortcut to grid
     * @param {HTMLElement} grid - Grid element
     * @param {string} key - Shortcut key
     * @param {string} description - Shortcut description
     */
    addShortcutToGrid(grid, key, description) {
        const keyElement = document.createElement('div');
        keyElement.className = 'shortcut-key';
        keyElement.textContent = key;

        const descElement = document.createElement('div');
        descElement.className = 'shortcut-description';
        descElement.textContent = description;

        grid.appendChild(keyElement);
        grid.appendChild(descElement);
    }

    /**
     * Handle modal key down events
     * @param {KeyboardEvent} e - Keyboard event
     */
    handleModalKeyDown(e) {
        if (e.key === 'Escape' && this.modal && this.modal.style.display === 'block') {
            this.hideModal();
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
     * Check if suggestions modal is open
     * @returns {boolean} True if suggestions modal is open
     */
    isSuggestionsModalOpen() {
        const suggestionsModal = document.getElementById('suggestions-modal');
        return suggestionsModal && suggestionsModal.style.display === 'block';
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

        if (this.modal && this.modal.style.display === 'block') {
            return;
        }

        if (this.isSuggestionsModalOpen()) {
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

            case 'escape':
                e.preventDefault();
                const map3dContainer = document.getElementById('map-3d-container');
                if (map3dContainer && map3dContainer.style.display !== 'none') {
                    const close3dBtn = document.getElementById('close-3d-viewer-button');
                    if (close3dBtn) close3dBtn.click();
                    return true;
                }
                this.toolManager.deactivateCurrentTool();
                this.selectionManager.deselectAllFeatures();
                return true;

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
     * Get information about all available shortcuts
     * @returns {Object} Object containing system and tools shortcuts
     */
    getShortcutsInfo() {
        return {
            system: {
                'Delete/Backspace': 'Deletar elementos selecionados',
                'Escape': 'Desativar ferramenta atual e desselecionar',
                'Ctrl+Z': 'Desfazer última ação',
                'Ctrl+Y': 'Refazer última ação',
                'Ctrl+C': 'Copiar elementos selecionados',
                'Ctrl+V': 'Colar elementos',
                'Ctrl+S': 'Salvar notas do mapa (quando no painel de notas)'
            },
            tools: {
                'Q': 'Seleção retangular',
                'N': 'Informações da carta topográfica',
                'P': 'Ferramenta de ponto',
                'L': 'Ferramenta de linha',
                'A': 'Ferramenta de polígono',
                'T': 'Ferramenta de texto',
                'I': 'Ferramenta de imagem',
                'C': 'Ferramenta de círculo',
                'E': 'Ferramenta de elipse',
                'V': 'Análise de visibilidade (requer terreno)',
                'O': 'Linha de visada (requer terreno)',
                'S': 'Ferramenta de seta',
                'D': 'Ferramenta de fronteira',
                'F': 'Frente ocupada',
                'M': 'Símbolo militar',
                'R': 'Ferramenta de retângulo',
                'B': 'Ferramenta de pincel',
                'K': 'Medidas de Coordenação'
            }
        };
    }

    /**
     * Cleanup - remove event listeners and close modal
     */
    destroy() {
        this.disable();

        if (this.modalInitialized) {
            document.removeEventListener('keydown', this.handleModalKeyDown);
        }

        this.hideModal();
    }
}

export default KeyboardShortcuts;
