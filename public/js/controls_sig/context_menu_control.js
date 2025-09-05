// Path: js\controls_sig\context_menu_control.js
import { formatCoordinates } from './utilities/coordinate_converter.js';
import { showSuccess } from './utilities/toast_service.js';
import { 
    getFeatureGroup, 
    createGroup, 
    combineGroups, 
    ungroupFeatures 
} from './store/store.js';

class ContextMenuControl {
    constructor(mouseCoordinatesControl, toolManager, selectionManager) {
        this._map = null;
        this._mouseCoordinatesControl = mouseCoordinatesControl;
        this._toolManager = toolManager;
        this._selectionManager = selectionManager;
        this._contextMenu = null;
        this._lastCoordinates = null;
        
        this._onRightClick = this._onRightClick.bind(this);
        this._onMapClick = this._onMapClick.bind(this);
        this._onDocumentClick = this._onDocumentClick.bind(this);
        this._onCopyCoordinates = this._onCopyCoordinates.bind(this);
    }

    onAdd(map) {
        this._map = map;
        this._createContextMenu();
        
        // Add event listeners
        this._map.getCanvas().addEventListener('contextmenu', this._onRightClick);
        this._map.on('click', this._onMapClick);
        document.addEventListener('click', this._onDocumentClick);
        
        return document.createElement('div'); // Empty container as this is not a UI control
    }

    onRemove() {
        if (this._map) {
            this._map.getCanvas().removeEventListener('contextmenu', this._onRightClick);
            this._map.off('click', this._onMapClick);
        }
        document.removeEventListener('click', this._onDocumentClick);
        
        if (this._contextMenu && this._contextMenu.parentNode) {
            this._contextMenu.parentNode.removeChild(this._contextMenu);
        }
        
        this._map = null;
    }

    _createContextMenu() {
        this._contextMenu = document.createElement('div');
        this._contextMenu.className = 'context-menu';
        this._contextMenu.style.cssText = `
            position: absolute;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 8px 0;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            min-width: 150px;
            display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        document.body.appendChild(this._contextMenu);
    }

    _rebuildContextMenu() {
        if (!this._contextMenu) return;

        // Limpar menu atual
        this._contextMenu.innerHTML = '';

        // Analisar seleção atual para opções de agrupamento
        const groupingAnalysis = this._analyzeSelectionForGrouping();
        const hasGroupingOptions = groupingAnalysis.canCreateGroup || 
                                 groupingAnalysis.canCombineGroups || 
                                 groupingAnalysis.canUngroup;

        // NOVO: Adicionar opções de agrupamento no início (se há seleção)
        if (hasGroupingOptions) {
            this._addGroupingOptions(groupingAnalysis);
            
            // Separador
            const separator = this._createSeparator();
            this._contextMenu.appendChild(separator);
        }

        // Opções padrão (sempre presentes)
        this._addDefaultOptions();
    }

    /**
     * NOVO: Adiciona opções de agrupamento ao menu
     */
    _addGroupingOptions(analysis) {
        // Opção "Criar Grupo"
        if (analysis.canCreateGroup) {
            const createGroupItem = this._createMenuItem(
                'Criar Grupo', 
                () => this._handleCreateGroup(analysis.ungroupedFeatures)
            );
            this._contextMenu.appendChild(createGroupItem);
        }

        // Opção "Combinar Grupos"
        if (analysis.canCombineGroups) {
            const combineText = analysis.groupIds.length > 1 ? 'Combinar Grupos' : 'Adicionar ao Grupo';
            const combineGroupsItem = this._createMenuItem(
                combineText,
                () => this._handleCombineGroups(analysis.groupIds, analysis.ungroupedFeatures)
            );
            this._contextMenu.appendChild(combineGroupsItem);
        }

        // Opção "Desagrupar"
        if (analysis.canUngroup) {
            const ungroupItem = this._createMenuItem(
                'Desagrupar',
                () => this._handleUngroup(analysis.groupIds[0])
            );
            this._contextMenu.appendChild(ungroupItem);
        }
    }

    /**
     * NOVO: Adiciona opções padrão do menu
     */
    _addDefaultOptions() {
        // Copiar coordenadas
        const copyItem = this._createMenuItem('Copiar Coordenadas', this._onCopyCoordinates);
        this._contextMenu.appendChild(copyItem);

        // Orientar para norte
        const resetNorthItem = this._createMenuItem('Orientar para Norte', this._onResetNorth.bind(this));
        this._contextMenu.appendChild(resetNorthItem);
    }

    _createMenuItem(text, clickHandler) {
        const item = document.createElement('div');
        item.className = 'context-menu-item';
        item.textContent = text;
        item.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            user-select: none;
            transition: background-color 0.2s;
        `;
        
        // Hover effects
        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = '#f5f5f5';
        });
        
        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = '';
        });
        
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                clickHandler();
                this._hideMenu();
            } catch (error) {
                console.error('Erro na operação do menu:', error);
                alert('Erro: ' + error.message);
            }
        });

        return item;
    }

    /**
     * NOVO: Cria separador visual
     */
    _createSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: #e0e0e0;
            margin: 4px 0;
        `;
        return separator;
    }

    /**
     * NOVO: Analisa seleção atual para determinar opções de agrupamento
     */
    _analyzeSelectionForGrouping() {
        if (!this._selectionManager) {
            return {
                canCreateGroup: false,
                canCombineGroups: false,
                canUngroup: false,
                groupIds: [],
                ungroupedFeatures: []
            };
        }

        const selected = this._selectionManager.getAllSelectedFeatures();
        const groups = new Set();
        const ungroupedFeatures = [];

        selected.forEach(feature => {
            const group = getFeatureGroup(feature.properties.source, feature.properties.id);
            if (group) {
                groups.add(group.id);
            } else {
                ungroupedFeatures.push(feature);
            }
        });

        return {
            canCreateGroup: ungroupedFeatures.length > 1,
            canCombineGroups: groups.size > 0 && (groups.size > 1 || ungroupedFeatures.length > 0),
            canUngroup: groups.size === 1 && ungroupedFeatures.length === 0,
            groupIds: Array.from(groups),
            ungroupedFeatures: ungroupedFeatures
        };
    }

    /**
     * NOVO: Manipula criação de grupo
     */
    _handleCreateGroup(features) {
        if (features.length < 2) {
            throw new Error('É necessário pelo menos 2 feições para criar um grupo.');
        }

        const newGroup = createGroup(features);
        
        // Manter seleção das features agrupadas
        if (this._selectionManager) {
            this._selectionManager.deselectAllFeatures();
            this._selectGroup(newGroup);
            this._selectionManager.updateUI();
        }
    }

    /**
     * NOVO: Manipula combinação de grupos
     */
    _handleCombineGroups(groupIds, ungroupedFeatures) {
        if (groupIds.length === 0 && ungroupedFeatures.length < 2) {
            throw new Error('É necessário pelo menos 2 feições ou 1 grupo para combinar.');
        }

        const combinedGroup = combineGroups(groupIds, ungroupedFeatures);
        
        // Selecionar o grupo combinado
        if (this._selectionManager) {
            this._selectionManager.deselectAllFeatures();
            this._selectGroup(combinedGroup);
            this._selectionManager.updateUI();
        }
    }

    /**
     * NOVO: Manipula desagrupamento
     */
    _handleUngroup(groupId) {
        const features = ungroupFeatures(groupId);
        
        // Manter features selecionadas após desagrupar
        // (elas já estão selecionadas, então não precisa fazer nada)
        if (this._selectionManager) {
            this._selectionManager.updateUI();
        }
    }

    /**
     * NOVO: Seleciona todas as features de um grupo
     */
    _selectGroup(group) {
        if (!this._selectionManager) return;

        group.features.forEach(featureRef => {
            // Buscar feature completa do source
            const completeFeature = this._selectionManager.getCompleteFeatureFromSource(featureRef.type, featureRef.id);
            if (completeFeature) {
                this._selectionManager.toggleFeatureSelection(featureRef.type, featureRef.id, completeFeature, false);
            }
        });
    }

    _onRightClick(e) {
        e.preventDefault();
        
        // Check if there's an active tool - block context menu if there is
        if (this._toolManager && this._toolManager.hasActiveTool()) {
            return;
        }
        
        // Get coordinates from the click position
        const coordinates = this._map.unproject([e.offsetX, e.offsetY]);
        this._lastCoordinates = { lat: coordinates.lat, lng: coordinates.lng };
        
        this._rebuildContextMenu();
        
        this._showMenu(e.clientX, e.clientY);
    }

    _onMapClick() {
        this._hideMenu();
    }

    _onDocumentClick(e) {
        if (this._contextMenu && !this._contextMenu.contains(e.target)) {
            this._hideMenu();
        }
    }

    _showMenu(x, y) {
        if (!this._contextMenu) return;
        
        this._contextMenu.style.left = `${x}px`;
        this._contextMenu.style.top = `${y}px`;
        this._contextMenu.style.display = 'block';
        
        // Adjust position if menu would be off-screen
        const rect = this._contextMenu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        if (rect.right > windowWidth) {
            this._contextMenu.style.left = `${x - rect.width}px`;
        }
        
        if (rect.bottom > windowHeight) {
            this._contextMenu.style.top = `${y - rect.height}px`;
        }
    }

    _hideMenu() {
        if (this._contextMenu) {
            this._contextMenu.style.display = 'none';
        }
    }

    _onCopyCoordinates() {
        if (!this._lastCoordinates || !this._mouseCoordinatesControl) {
            this._hideMenu();
            return;
        }
        
        const { lat, lng } = this._lastCoordinates;
        const currentFormat = this._mouseCoordinatesControl.getCurrentFormat();
        const textToCopy = formatCoordinates(lat, lng, currentFormat);
        
        this._copyToClipboard(textToCopy);
        this._hideMenu();
    }

    _onResetNorth() {
        if (this._map) {
            this._map.easeTo({
                pitch: 0,
                bearing: 0
            });
        }
        this._hideMenu();
    }

    _copyToClipboard(text) {
        if (!text || text.trim() === '') return;

        // Try modern clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                showSuccess('Coordenadas copiadas!');
            }).catch(() => {
                this._fallbackCopyTextToClipboard(text);
            });
        } else {
            this._fallbackCopyTextToClipboard(text);
        }
    }

    _fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
            showSuccess('Coordenadas copiadas!');
        } catch (err) {
            console.error('Error copying text:', err);
        }

        document.body.removeChild(textArea);
    }
}

export default ContextMenuControl;