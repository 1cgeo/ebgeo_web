// Path: js/grid/grid.control.js
import { GRID_LAYERS } from './grid-layers.config.js';
import { getCurrentMapNameSync, getGridStyle, setGridStyle } from '../store/index.js';

const ACTIVE_BTN_CLASS = 'coordinates-grid-button--active';
const VISIBLE_MENU_CLASS = 'grid-format-selector--visible';

class GridControl {
    constructor(map, buttonContainer) {
        this._map = map;
        this._gridVisible = false;
        this._currentFormat = 'latlong';
        this._buttonContainer = buttonContainer;
        this._gridButton = null;
        this._createContextMenu();
    }

    async _showGridMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        if (this._contextMenu.classList.contains(VISIBLE_MENU_CLASS)) {
            this._contextMenu.classList.remove(VISIBLE_MENU_CLASS);
            return;
        }

        const mapName = getCurrentMapNameSync();
        const savedGrid = await getGridStyle(mapName);
        if (savedGrid) {
            this._currentFormat = savedGrid.format || 'latlong';
            this._gridVisible = !!savedGrid.visible;
        }

        const items = this._contextMenu.querySelectorAll('.grid-format-option');
        for (const item of items) {
            const format = item.dataset.format;
            const isActive = (format === 'off' && !this._gridVisible) ||
                             (format === this._currentFormat && this._gridVisible);
            item.classList.toggle('active', isActive);
        }

        this._contextMenu.classList.add(VISIBLE_MENU_CLASS);
    }

    _createContextMenu() {
        this._contextMenu = document.createElement('div');
        this._contextMenu.className = 'grid-format-selector';

        this._contextMenu.appendChild(this._createMenuItem('Lat/Long', 'latlong'));
        this._contextMenu.appendChild(this._createMenuItem('UTM', 'utm'));
        this._contextMenu.appendChild(this._createMenuItem('Desligar', 'off'));

        const parent = this._buttonContainer || document.body;
        parent.appendChild(this._contextMenu);

        document.addEventListener('click', (e) => {
            if (!this._contextMenu.contains(e.target)) {
                this._contextMenu.classList.remove(VISIBLE_MENU_CLASS);
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

        item.addEventListener('click', async (e) => {
            e.stopPropagation();

            if (format === 'off') {
                this._gridVisible = false;
            } else {
                this._currentFormat = format;
                this._gridVisible = true;
            }

            this._getGrid(this._currentFormat);
            this._updateButtonState();
            this._contextMenu.classList.remove(VISIBLE_MENU_CLASS);

            const mapName = getCurrentMapNameSync();
            await setGridStyle(mapName, {
                format: this._currentFormat,
                visible: this._gridVisible,
            });
        });

        return item;
    }

    _updateButtonState(gridVisible = this._gridVisible) {
        if (!this._gridButton) return;

        this._gridButton.classList.toggle(ACTIVE_BTN_CLASS, gridVisible);
        this._gridButton.title = gridVisible
            ? 'Alterar exibição de quadrícula'
            : 'Exibir quadrícula';
    }

    setButton(gridButton) {
        this._gridButton = gridButton;
        this._updateButtonState();
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

    /**
     * Shows/hides grid layers for the given format.
     * @param {string} format - Grid format key
     * @param {boolean} [gridVisible] - Override visibility state
     * @param {boolean} [zoomin] - Whether to auto-zoom when below min zoom
     */
    _getGrid(format, gridVisible = this._gridVisible, zoomin = true) {
        if (gridVisible && zoomin && this._map.getZoom() < 8) {
            this._map.setZoom(8);
        }

        // Hide all grid layers
        for (const key of Object.keys(GRID_LAYERS)) {
            for (const layerId of GRID_LAYERS[key]) {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'none');
                }
            }
        }

        // Show requested format layers
        if (gridVisible && GRID_LAYERS[format]) {
            for (const layerId of GRID_LAYERS[format]) {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'visible');
                }
            }
        }
    }

}

export default GridControl;
