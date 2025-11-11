// Path: js\controls_sig\keyboard_shortcuts.js
import { undoLastAction, redoLastAction } from './store/store.js';

/**
 * Gerenciador de atalhos de teclado para o mapa SIG
 * Centraliza todos os shortcuts e suas respectivas ações
 * Inclui modal para exibir os atalhos disponíveis
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
     * Ativa os atalhos de teclado
     */
    enable() {
        if (!this.enabled) {
            document.addEventListener('keydown', this.handleKeyDown);
            this.enabled = true;
        }
    }

    /**
     * Desativa os atalhos de teclado
     */
    disable() {
        if (this.enabled) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.enabled = false;
        }
    }

    /**
     * Inicializa o modal de atalhos
     */
    initModal() {
        if (this.modalInitialized) {
            return;
        }

        const button = document.getElementById('shortcuts-button');
        if (!button) {
            console.warn('Botão de atalhos não encontrado');
            return;
        }

        this.modal = document.getElementById('shortcuts-modal');
        if (!this.modal) {
            console.warn('Modal de atalhos não encontrado');
            return;
        }

        this.setupModalEventListeners();
        this.modalInitialized = true;
    }

    /**
     * Configura os event listeners do modal
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
     * Mostra o modal de atalhos
     */
    showModal() {
        if (!this.modal) {
            console.warn('Modal não inicializado');
            return;
        }

        this.populateModal();
        this.modal.style.display = 'block';
        this.modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Esconde o modal de atalhos
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
     * Popula o modal com os atalhos
     */
    populateModal() {
        const shortcutsInfo = this.getShortcutsInfo();
        
        const systemGrid = document.getElementById('system-shortcuts');
        const toolsGrid = document.getElementById('tools-shortcuts');
        
        if (!systemGrid || !toolsGrid) {
            console.warn('Elementos do grid do modal não encontrados');
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
     * Adiciona um atalho ao grid
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
     * Handler para teclas do modal
     */
    handleModalKeyDown(e) {
        if (e.key === 'Escape' && this.modal && this.modal.style.display === 'block') {
            this.hideModal();
        }
    }

    /**
     * Verifica se o usuário está digitando em um campo de entrada
     */
    isTypingInInput(target) {
        return ['INPUT', 'TEXTAREA'].includes(target.tagName);
    }

    /**
     * Verifica se o Street View está aberto
     */
    isStreetViewOpen() {
        return this.addStreetViewControl.isOpen;
    }

    /**
     * Verifica se o modal de sugestões está aberto
     */
    isSuggestionsModalOpen() {
        const suggestionsModal = document.getElementById('suggestions-modal');
        return suggestionsModal && suggestionsModal.style.display === 'block';
    }

    /**
     * Handler principal para eventos de teclado
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
     * Processa o atalho baseado na tecla e modificadores
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
     * Manipula atalhos de sistema (Delete, Escape, Undo/Redo)
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
     * Manipula atalhos de ativação de ferramentas
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
     * Manipula atalhos com Ctrl (Copy/Paste)
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
     * Retorna informações sobre todos os atalhos disponíveis
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
     * Cleanup - remove event listeners e fecha modal
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