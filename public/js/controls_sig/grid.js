import { GRID_LAYERS, initGridLayers } from './gridLayersConfig.js';

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

    _showGridMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        // Se o menu já está visível, fecha
        const isVisible = this._contextMenu.style.display === 'block';

        if (isVisible) {
            this._contextMenu.style.display = 'none';
            return;
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
        item.addEventListener('click', (e) => {
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
        });

        return item;
    }

    _updateButtonState() {
        if (!this._gridButton) return;

        if (this._gridVisible) {
            // Grid ativo - botão com estilo ativo
            this._gridButton.style.backgroundColor = 'rgba(80, 141, 78, 0.2)';
            this._gridButton.style.opacity = 1;
            this._gridButton.title = `Grid ${this._currentFormat.toUpperCase()} ativo - Clique para alterar`;
        } else {
            // Grid inativo - botão com estilo normal
            this._gridButton.style.backgroundColor = '';
            this._gridButton.style.opacity = 0.5;
            this._gridButton.title = "Ativar grid - Clique para selecionar";
        }
    }

    setButton(gridButton) {
        this._gridButton = gridButton;
        this._updateButtonState();
    }


    _initGridLayers() {
        initGridLayers(this._map);
    }

    _getGrid(format) {

        Object.keys(this.GRID_LAYERS).forEach(key => {
            this.GRID_LAYERS[key].forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'none');
                }
            });
        });

        if (this._gridVisible && this.GRID_LAYERS[format]) {
            this.GRID_LAYERS[format].forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'visible');
                }
            });
        }
    }



}

export default GridControl;