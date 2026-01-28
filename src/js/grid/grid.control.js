// Path: js/grid/grid.control.js
import { GRID_LAYERS, initGridLayers } from './grid-layers.config.js';
import { getCurrentMapNameSync, getGridStyle, setGridStyle } from '../store';

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

        const isVisible = this._contextMenu.style.display === 'block';

        if (isVisible) {
            this._contextMenu.style.display = 'none';
            return;
        }

        // Sync internal state from saved state (without changing visibility)
        try {
            const mapName = getCurrentMapNameSync();
            const savedGrid = await getGridStyle(mapName);
            if (savedGrid) {
                this._currentFormat = savedGrid.format || 'latlong';
                this._gridVisible = !!savedGrid.visible;
            }
        } catch (err) {
            console.warn('Error checking grid state:', err);
        }
        const items = this._contextMenu.querySelectorAll('.grid-format-option');
        items.forEach(item => {
            const format = item.dataset.format;
            const isActive = (format === 'off' && !this._gridVisible) ||
                           (format === this._currentFormat && this._gridVisible);

            item.classList.toggle('active', isActive);
        });

        this._contextMenu.style.display = 'block';
    }

    _createContextMenu() {
        this._contextMenu = document.createElement('div');
        this._contextMenu.className = 'grid-format-selector';

        const latlongOption = this._createMenuItem('Lat/Long', 'latlong');
        this._contextMenu.appendChild(latlongOption);

        const utmOption = this._createMenuItem('UTM', 'utm');
        this._contextMenu.appendChild(utmOption);

        const offOption = this._createMenuItem('Desligar', 'off');
        this._contextMenu.appendChild(offOption);

        if (this._buttonContainer) {
            this._buttonContainer.appendChild(this._contextMenu);
        } else {
            document.body.appendChild(this._contextMenu);
        }

        document.addEventListener('click', (e) => {
            if (!this._contextMenu.contains(e.target)) {
                this._contextMenu.style.display = 'none';
            }
        });
    }

    _createMenuItem(label, format) {
        const item = document.createElement('div');
        item.className = 'grid-format-option';
        item.textContent = label;
        item.dataset.format = format;

        if (format === this._currentFormat && this._gridVisible) {
            item.classList.add('active');
        }

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
            this._gridButton.style.backgroundColor = 'rgba(80, 141, 78, 0.2)';
            this._gridButton.style.opacity = 1;
            this._gridButton.title = `Alterar exibição de quadrícula`;
        } else {
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

    /**
     * Synchronizes internal state with provided values.
     * Used when restoring grid state from storage.
     * @param {string} format - Grid format ('latlong' or 'utm')
     * @param {boolean} visible - Whether grid is visible
     */
    syncState(format, visible) {
        this._currentFormat = format;
        this._gridVisible = visible;
    }

    _getGrid(format, gridVisible=this._gridVisible, zoomin=true) {
        const currentZoom = this._map.getZoom();

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
