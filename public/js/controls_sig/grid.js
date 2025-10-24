// Path: js\controls_sig\grid.js
import { GRID_LAYERS, initGridLayers } from './gridLayersConfig.js';
import { getCurrentMapNameSync, getGridStyle, setGridStyle } from './store/store.js';

class GridControl {
    constructor(map, buttonContainer) {
        this._map = map;
        this._gridVisible = false;
        this._currentFormat = 'latlong';
        this._buttonContainer = buttonContainer;
        this._gridButton = null;
        this.GRID_LAYERS = GRID_LAYERS;
        this._createContextMenu();

    }

    async _showGridMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        // Se o menu já está visível, fecha
        const isVisible = this._contextMenu.style.display === 'block';

        if (isVisible) {
            this._contextMenu.style.display = 'none';
            return;
        }

        try {
            const mapName = getCurrentMapNameSync();
            const savedGrid = await getGridStyle(mapName);
            if (savedGrid) {
                console.log(savedGrid.visible)
                this._currentFormat = savedGrid.format || 'latlong';
                this._gridVisible = !!savedGrid.visible;
                this._getGrid(this._currentFormat);
            }
        } catch (err) {
            console.warn('Erro ao verificar estado do grid:', err);
        }


        // Atualiza a marcação visual dos itens do menu antes de abrir
        const items = this._contextMenu.querySelectorAll('.coordinates-format-option');
        items.forEach(item => {
            const format = item.dataset.format;

            if (format === 'off' && !this._gridVisible) {
                item.classList.add('active');
                item.style.backgroundColor = '#e6f7ff';
                item.style.fontWeight = 'bold';
            } else if (format === this._currentFormat && this._gridVisible) {
                item.classList.add('active');
                item.style.backgroundColor = '#e6f7ff';
                item.style.fontWeight = 'bold';
            } else {
                item.classList.remove('active');
                item.style.backgroundColor = '';
                item.style.fontWeight = '';
            }
        });

        // Mostra o menu
        this._contextMenu.style.display = 'block';
    }

    _createContextMenu() {
        // Cria o container do menu
        this._contextMenu = document.createElement('div');
        this._contextMenu.className = 'grid-format-selector';

        // Opção Lat/Long
        const latlongOption = this._createMenuItem('Lat/Long', 'latlong');
        this._contextMenu.appendChild(latlongOption);

        // Opção UTM
        const utmOption = this._createMenuItem('UTM', 'utm');
        this._contextMenu.appendChild(utmOption);

        // Opção Desligar
        const offOption = this._createMenuItem('Desligar', 'off');
        this._contextMenu.appendChild(offOption);

        if (this._buttonContainer) {
            this._buttonContainer.appendChild(this._contextMenu);
        } else {
            document.body.appendChild(this._contextMenu);
        }

        // Fecha o menu ao clicar fora
        document.addEventListener('click', (e) => {
            if (!this._contextMenu.contains(e.target)) {
                this._contextMenu.style.display = 'none';
            }
        });
    }

    _createMenuItem(label, format) {
        const item = document.createElement('div');
        item.className = 'coordinates-format-option';
        item.textContent = label;
        item.dataset.format = format;

        // Marca o item ativo
        if (format === this._currentFormat) {
            item.classList.add('active');
        }

        // Marca o item ativo
        if (format === this._currentFormat) {
            item.style.backgroundColor = '#e6f7ff';
            item.style.fontWeight = 'bold';
        }

        // Evento de click
        item.addEventListener('click', async(e) => {
            e.stopPropagation();
            if (format === 'off') {
                this._gridVisible = false;
                this._getGrid(this._currentFormat);
                this._updateButtonState();
            } else {
                this._currentFormat = format;
                this._gridVisible = true;
                this._getGrid(format);
                this._updateButtonState();
            }
            this._contextMenu.style.display = 'none';
            const mapName = getCurrentMapNameSync();
            await setGridStyle(mapName, {
                format: this._currentFormat,
                visible: this._gridVisible
            });
        });



        return item;
    }

    _updateButtonState(gridVisible=this._gridVisible) {
        if (!this._gridButton) return;

        if (gridVisible) {
            // Grid ativo - botão com estilo ativo
            this._gridButton.style.backgroundColor = 'rgba(80, 141, 78, 0.2)';
            this._gridButton.style.opacity = 1;
            this._gridButton.title = `Alterar exibição de quadrícula`;
        } else {
            // Grid inativo - botão com estilo normal
            this._gridButton.style.backgroundColor = '';
            this._gridButton.style.opacity = 0.5;
            this._gridButton.title = "Exibir quadrícula";
        }
    }

    setButton(gridButton) {
        this._gridButton = gridButton;
        this._updateButtonState();
    }


    _initGridLayers() {
        initGridLayers(this._map);
    }

    _getGrid(format, gridVisible=this._gridVisible, zoomin=true) {
        const currentZoom = this._map.getZoom();

        // Se o zoom for menor que 8, ajusta para 8
        if (currentZoom < 8 && gridVisible && zoomin) {
            this._map.setZoom(8);
        }

        Object.keys(this.GRID_LAYERS).forEach(key => {
            this.GRID_LAYERS[key].forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'none');
                }
            });
        });

        if (gridVisible && this.GRID_LAYERS[format]) {
            this.GRID_LAYERS[format].forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'visible');
                }
            });
        }
    }



}

export default GridControl;