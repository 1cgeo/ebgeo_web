// Path: js\controls_sig\save_load_control.js
import { saveToFile, loadFromFile } from './utils.js';
import store, { 
    getCurrentBaseLayer, 
    toggleAutoSave, 
    getAutoSaveStatus,
    saveToLocalStorageManually,
    clearLocalStorageManually
} from './store.js';

class SaveLoadControl {
    constructor(mapControl, baseLayerControl) {
        this.mapControl = mapControl;
        this.baseLayerControl = baseLayerControl;
        this.menuVisible = false;
    }
    
    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl save-load-control';
        this.container.innerHTML = `
            <div class="save-load-buttons">
                <button id="save-btn" class="save-load-icon" title="Salvar/Carregar">
                    <img src="./images/icon_save_black.svg" alt="SAVE" />
                </button>
                <button id="save-options-btn" class="save-load-icon">
                    <img src="./images/icon_more_info.svg" alt="OPTIONS" />
                </button>
                <input type="file" id="load-file" accept=".ebgeo" style="display: none;" />
            </div>
            <div id="save-options-menu" class="save-options-menu" style="display: none;">
                <button id="save-file-btn" class="menu-button">
                    <img src="./images/icon_save_black.svg" alt="SAVE" style="height: 16px; margin-right: 5px;">
                    Salvar para arquivo
                </button>
                <button id="load-file-btn" class="menu-button">
                    <img src="./images/icon_load_black.svg" alt="LOAD" style="height: 16px; margin-right: 5px;">
                    Carregar de arquivo
                </button>
                <hr class="menu-divider">
                <button id="autosave-toggle-btn" class="menu-button">
                    <span id="autosave-status-icon">✓</span>
                    Autosave: <span id="autosave-status">Ligado</span>
                </button>
                <button id="save-storage-btn" class="menu-button">
                    <img src="./images/icon_save_black.svg" alt="SAVE" style="height: 16px; margin-right: 5px;">
                    Salvar no navegador
                </button>
                <button id="clear-storage-btn" class="menu-button">
                    <img src="./images/clear_icon.svg" alt="CLEAR" style="height: 16px; margin-right: 5px;">
                    Limpar dados salvos
                </button>
                <div class="storage-info">
                    <small id="last-autosave-time">Último autosave: Nunca</small>
                </div>
            </div>
        `;

        // Adicionar listeners para o menu de opções
        this.container.querySelector('#save-options-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleOptionsMenu();
        });

        // Adicionar listener para o botão de salvar arquivo
        this.container.querySelector('#save-file-btn').addEventListener('click', () => {
            this.saveToFile();
            this.toggleOptionsMenu();
        });

        // Shortcut: Clique no ícone de salvar também salva arquivo
        this.container.querySelector('#save-btn').addEventListener('click', () => {
            this.saveToFile();
        });

        // Adicionar listener para o botão de carregar arquivo
        this.container.querySelector('#load-file-btn').addEventListener('click', () => {
            this.container.querySelector('#load-file').click();
            this.toggleOptionsMenu();
        });

        // Adicionar listener para carregar arquivo
        this.container.querySelector('#load-file').addEventListener('change', (event) => {
            const fileInput = event.target;
            const file = event.target.files[0];
            this.loadFromFile(file, fileInput);
        });

        // Adicionar listener para toggle de autosave
        this.container.querySelector('#autosave-toggle-btn').addEventListener('click', () => {
            this.toggleAutoSave();
        });

        // Adicionar listener para salvar no localStorage
        this.container.querySelector('#save-storage-btn').addEventListener('click', () => {
            this.saveToLocalStorage();
            this.toggleOptionsMenu();
        });

        // Adicionar listener para limpar localStorage
        this.container.querySelector('#clear-storage-btn').addEventListener('click', () => {
            this.clearLocalStorage();
            this.toggleOptionsMenu();
        });

        // Adicionar listener para fechar o menu quando clicar fora
        document.addEventListener('click', this.handleDocumentClick = (e) => {
            if (!this.container.contains(e.target)) {
                this.closeOptionsMenu();
            }
        });

        // Atualizar o status inicial do autosave
        this.updateAutoSaveStatus();

        $('input[name="base-layer"]').on('change', this.changeButtonColors);
        this.changeButtonColors();

        // Atualizar informações de storage a cada 30 segundos
        this.updateStorageInfo();
        this.storageInfoInterval = setInterval(() => this.updateStorageInfo(), 30000);

        return this.container;
    }

    toggleOptionsMenu() {
        const menu = this.container.querySelector('#save-options-menu');
        if (menu.style.display === 'none') {
            menu.style.display = 'block';
            this.menuVisible = true;
            // Atualizar informações antes de mostrar o menu
            this.updateAutoSaveStatus();
            this.updateStorageInfo();
        } else {
            menu.style.display = 'none';
            this.menuVisible = false;
        }
    }

    closeOptionsMenu() {
        if (this.menuVisible) {
            const menu = this.container.querySelector('#save-options-menu');
            menu.style.display = 'none';
            this.menuVisible = false;
        }
    }

    updateAutoSaveStatus() {
        const autoSaveStatus = getAutoSaveStatus();
        const statusElement = this.container.querySelector('#autosave-status');
        const statusIcon = this.container.querySelector('#autosave-status-icon');
        
        if (statusElement && statusIcon) {
            statusElement.textContent = autoSaveStatus.enabled ? 'Ligado' : 'Desligado';
            statusIcon.textContent = autoSaveStatus.enabled ? '✓' : '✗';
            statusIcon.style.color = autoSaveStatus.enabled ? 'green' : 'red';
        }
    }

    updateStorageInfo() {
        const autoSaveStatus = getAutoSaveStatus();
        const lastSaveElement = this.container.querySelector('#last-autosave-time');
        
        if (lastSaveElement) {
            if (autoSaveStatus.lastSave) {
                const options = { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                };
                lastSaveElement.textContent = `Último salvamento: ${autoSaveStatus.lastSave.toLocaleDateString('pt-BR', options)}`;
            } else {
                lastSaveElement.textContent = 'Último salvamento: Nunca';
            }
        }
    }

    saveToFile() {
        const allData = {
            maps: {},
            currentMap: store.currentMap,
        };
    
        Object.keys(store.maps).forEach(key => {
            const { undoStack, redoStack, ...mapData } = store.maps[key];
            
            // Ensure all features have required properties
            if (mapData.features) {
                Object.keys(mapData.features).forEach(featureType => {
                    mapData.features[featureType].forEach(feature => {
                        if (feature.properties) {
                            if (!feature.properties.customAttributes) {
                                feature.properties.customAttributes = {};
                            }
                            // Garantir que name e images existam
                            if (feature.properties.name === undefined) {
                                feature.properties.name = '';
                            }
                            if (!feature.properties.images) {
                                feature.properties.images = [];
                            }
                        }
                    });
                });
            }
            
            allData.maps[key] = mapData;
        });
        
        saveToFile(allData, 'maps_data.ebgeo');
    }

    loadFromFile(file, fileInput) {
        if (file) {
            loadFromFile(file, (data) => {
                // Ensure all features have required properties for backward compatibility
                Object.keys(data.maps).forEach(mapName => {
                    const mapData = data.maps[mapName];
                    if (mapData.features) {
                        Object.keys(mapData.features).forEach(featureType => {
                            mapData.features[featureType].forEach(feature => {
                                if (feature.properties) {
                                    if (!feature.properties.customAttributes) {
                                        feature.properties.customAttributes = {};
                                    }
                                    // Garantir que name e images existam
                                    if (feature.properties.name === undefined) {
                                        feature.properties.name = '';
                                    }
                                    if (!feature.properties.images) {
                                        feature.properties.images = [];
                                    }
                                }
                            });
                        });
                    }
                });
                
                // Atualize o store com os dados carregados
                store.maps = data.maps;
                store.currentMap = data.currentMap;

                Object.keys(store.maps).forEach(key => {
                    store.maps[key].undoStack = [];
                    store.maps[key].redoStack = [];
                });

                // Atualize o mapa para refletir os dados carregados
                const baseLayer = getCurrentBaseLayer();
                this.baseLayerControl.switchLayer(baseLayer);     

                // Atualize a lista de mapas no mapControl
                this.mapControl.updateMapList();
                fileInput.value = '';
                
                // Salvar os novos dados no localStorage se o autosave estiver ativado
                if (getAutoSaveStatus().enabled) {
                    saveToLocalStorageManually();
                }
            });
        }
    }

    toggleAutoSave() {
        const newStatus = toggleAutoSave();
        this.updateAutoSaveStatus();
        
        // Notificar o usuário
        alert(`Autosave ${newStatus ? 'ativado' : 'desativado'}`);
    }

    saveToLocalStorage() {
        const success = saveToLocalStorageManually();
        if (success) {
            this.updateStorageInfo();
            alert('Dados salvos no armazenamento do navegador');
        } else {
            alert('Erro ao salvar dados no armazenamento do navegador');
        }
    }

    clearLocalStorage() {
        if (confirm('Tem certeza que deseja remover todos os dados salvos no navegador?')) {
            const success = clearLocalStorageManually();
            if (success) {
                this.updateStorageInfo();
                alert('Dados removidos do armazenamento do navegador');
            } else {
                alert('Erro ao remover dados do armazenamento do navegador');
            }
        }
    }

    changeButtonColors = () => {
        // const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        // $("#load-btn").html(`<img src="./images/icon_load_${color}.svg" alt="LOAD" />`);
        // $("#save-btn").html(`<img src="./images/icon_save_${color}.svg" alt="SAVE" />`);
    }

    onRemove() {
        document.removeEventListener('click', this.handleDocumentClick);
        if (this.storageInfoInterval) {
            clearInterval(this.storageInfoInterval);
        }
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

export default SaveLoadControl;