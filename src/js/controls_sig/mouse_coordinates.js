// Path: js/controls_sig/mouse_coordinates.js
import {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
    formatCoordinates,
    getDisplayFormat
} from './utilities/coordinate_converter.js';
import { getTerrainElevation } from './terrain_control.js';
import GridControl from './grid.js';
import FrameControl from './frame.js';
import config from '../config.js';

class MouseCoordinatesControl {
    constructor(pointControl, coordinationMeasureControl, militarySymbolControl) {
        this._map = null;
        this._container = null;
        this._innerContainer = null;
        this._formatSelector = null;
        this._coordinatesText = null;
        this._currentFormat = 'latlong';
        this._formatOptions = COORDINATE_FORMATS;
        this._modal = null;
        this._currentCoordinates = { lat: 0, lng: 0 };
        this._pointControl = pointControl;
        this._coordinationMeasureControl = coordinationMeasureControl;
        this._militarySymbolControl = militarySymbolControl;

        this._elevationEnabled = false;
        this._terrainAvailable = false;
        this._elevationButton = null;
        this._currentElevation = null;
        this._debounceTimer = null;
        this._elevationAbortController = null;

        this.frameControl = null;
        this.gridControl = null;
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group coordinates-control';

        this._container.style.cssText = `
        position: fixed !important;
        bottom: 10px !important;
        left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 1000 !important;
            margin: 0 !important;
            `;

            this._innerContainer = document.createElement('div');
            this._innerContainer.className = 'coordinates-display';

        this._coordinatesText = document.createElement('div');
        this._coordinatesText.className = 'coordinates-text';

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'coordinates-controls';

        const gridContainer = document.createElement('div');
        gridContainer.className = 'coordinates-controls';

        const flyToButton = document.createElement('div');
        flyToButton.className = 'coordinates-button coordinates-flyto-button';
        flyToButton.title = "Ir para coordenadas";
        flyToButton.innerHTML = `<img src="./images/fly_to_icon.svg" alt="Fly to" width="16" height="16" />`;
        flyToButton.addEventListener('click', this._openFlyToModal.bind(this));

        this._elevationButton = document.createElement('div');
        this._elevationButton.className = 'coordinates-button coordinates-elevation-button';
        this._elevationButton.title = "Mostrar elevação (terreno necessário)";
        this._elevationButton.innerHTML = `<img src="./images/elevation_icon.svg" alt="Elevation" width="16" height="16" />`;
        this._elevationButton.style.fontSize = '14px';
        this._elevationButton.addEventListener('click', this._toggleElevation.bind(this));

        const gearButton = document.createElement('div');
        gearButton.className = 'coordinates-button coordinates-gear-button';
        gearButton.title = "Mudar formato de coordenadas";
        gearButton.innerHTML = `<img src="./images/gear_icon.svg" alt="Settings" width="16" height="16" />`;
        gearButton.addEventListener('click', this._toggleFormatSelector.bind(this));

        if (config.features.grid) {
            this.gridControl = new GridControl(map, gridContainer);
            const gridButton = document.createElement('div');
            gridButton.className = 'coordinates-button coordinates-grid-button';
            gridButton.title = "Ligar/desligar Quadrícula";
            gridButton.innerHTML = `<img src="./images/grid_icon.svg" alt="Toogle grid" width="16" height="16" />`;
            gridButton.addEventListener('click', this.gridControl._showGridMenu.bind(this.gridControl));
            this.gridControl.setButton(gridButton);
            gridContainer.appendChild(gridButton);
        }

        if (config.features.frame){
            this.frameControl = new FrameControl(map, gridContainer);
            const frameButton = document.createElement('div');
            frameButton.className = 'coordinates-button coordinates-grid-button';
            frameButton.title = "Ligar/desligar Produtos";
            frameButton.innerHTML = `<img src="./images/frame_icon.svg" alt="Toogle frame" width="16" height="16" />`;
            frameButton.addEventListener('click', this.frameControl._showFrameMenu.bind(this.frameControl));
            this.frameControl.setButton(frameButton);
            gridContainer.appendChild(frameButton);
        }

        this._formatSelector = document.createElement('div');
        this._formatSelector.className = 'coordinates-format-selector';

        this._formatOptions.forEach(format => {
            const option = document.createElement('div');
            option.className = 'coordinates-format-option';
            if (format.id === this._currentFormat) {
                option.classList.add('active');
            }
            option.textContent = format.label;
            option.dataset.format = format.id;

            option.addEventListener('click', (e) => {
                this._setFormat(format.id);
                this._formatSelector.style.display = 'none';
                e.stopPropagation();
            });
            option.addEventListener('mouseenter', () => {
                if (format.id !== this._currentFormat) {
                    option.style.backgroundColor = '#f0f0f0';
                }
            });
            option.addEventListener('mouseleave', () => {
                if (format.id !== this._currentFormat) {
                    option.style.backgroundColor = '';
                }
            });

            this._formatSelector.appendChild(option);
        });

        controlsContainer.appendChild(flyToButton);
        controlsContainer.appendChild(this._elevationButton);
        controlsContainer.appendChild(gearButton)
        if (config.features.grid || config.features.frame) {
            this._innerContainer.appendChild(gridContainer);
        }
        this._innerContainer.appendChild(this._coordinatesText);
        this._innerContainer.appendChild(controlsContainer);
        this._container.appendChild(this._innerContainer);
        this._container.appendChild(this._formatSelector);

        this._createFlyToModal();

        document.addEventListener('click', this._closeFormatSelector.bind(this));

        this._map.on('mousemove', this._onMouseMove.bind(this));

        this._checkTerrainAvailability();

        this._updateCoordinates(0, 0);

        return this._container;
    }

    async _checkTerrainAvailability() {
        this._map.on('terrain', this._onTerrainChange);
        this._onTerrainChange();
    }

    _onTerrainChange = () => {
        const terrainEnabled = this._map.getTerrain() !== null;

        this._terrainAvailable = terrainEnabled;

        if (terrainEnabled) {
            this._elevationButton.innerHTML = `<img src="./images/elevation_icon.svg" alt="Elevation" width="16" height="16" />`;
            this._elevationButton.title = "Mostrar/ocultar elevação";
            this._elevationButton.disabled = false;
        } else {
            this._elevationButton.innerHTML = `<img src="./images/elevation_icon.svg" alt="Elevation" width="16" height="16" style="opacity: 0.3;" />`;
            this._elevationButton.title = "Elevação indisponível (terreno não carregado)";
            this._elevationButton.disabled = true;

            if (this._elevationEnabled) {
                this._elevationEnabled = false;
                this._currentElevation = null;
                this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
            }
        }
    }

    _toggleElevation() {
        if (!this._terrainAvailable) {
            return;
        }

        this._elevationEnabled = !this._elevationEnabled;

        if (this._elevationEnabled) {
            this._elevationButton.style.backgroundColor = '#4CAF50';
            this._elevationButton.style.color = 'white';
        } else {
            this._elevationButton.style.backgroundColor = '';
            this._elevationButton.style.color = '';
            this._currentElevation = null;
        }

        this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
    }

    async _getElevationDebounced(lat, lng) {
        return new Promise((resolve) => {
            clearTimeout(this._debounceTimer);

            this._debounceTimer = setTimeout(async () => {
                if (this._elevationAbortController) {
                    this._elevationAbortController.abort();
                }

                this._elevationAbortController = new AbortController();
                const signal = this._elevationAbortController.signal;

                try {
                    const elevation = await getTerrainElevation(this._map, lat, lng, signal);
                    resolve(elevation);
                } catch (error) {
                    if (error.name !== 'AbortError') {
                        console.warn('Failed to get elevation:', error);
                    }
                    resolve(null);
                }
            }, 50);
        });
    }

    _createFlyToModal() {
        this._modal = document.createElement('div');
        this._modal.className = 'coordinates-modal';
        this._modal.style.display = 'none';

        const modalContent = document.createElement('div');
        modalContent.className = 'coordinates-modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 'coordinates-modal-header';
        const modalTitle = document.createElement('h3');
        modalTitle.textContent = 'Ir para coordenadas';
        const closeButton = document.createElement('span');
        closeButton.className = 'coordinates-modal-close';
        closeButton.innerHTML = '&times;';
        closeButton.addEventListener('click', () => {
            this._modal.style.display = 'none';
        });
        modalHeader.appendChild(modalTitle);
        modalHeader.appendChild(closeButton);

        const formatContainer = document.createElement('div');
        formatContainer.className = 'coordinates-modal-format';
        const formatLabel = document.createElement('label');
        formatLabel.textContent = 'Formato:';
        const formatSelect = document.createElement('select');
        formatSelect.id = 'coordinates-format-select';

        this._formatOptions.forEach(format => {
            const option = document.createElement('option');
            option.value = format.id;
            option.textContent = format.label;
            if (format.id === this._currentFormat) {
                option.selected = true;
            }
            formatSelect.appendChild(option);
        });

        formatContainer.appendChild(formatLabel);
        formatContainer.appendChild(formatSelect);

        const inputContainer = document.createElement('div');
        inputContainer.className = 'coordinates-modal-input';
        const inputLabel = document.createElement('label');
        inputLabel.textContent = 'Coordenadas:';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'coordinates-input';
        input.placeholder = getPlaceholderForFormat(this._currentFormat);

        formatSelect.addEventListener('change', (e) => {
            input.placeholder = getPlaceholderForFormat(e.target.value);
        });

        inputContainer.appendChild(inputLabel);
        inputContainer.appendChild(input);

        const validationMessage = document.createElement('div');
        validationMessage.className = 'coordinates-validation-message';
        validationMessage.id = 'coordinates-validation';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'coordinates-modal-buttons';

        const flyButton = document.createElement('button');
        flyButton.textContent = 'Ir para';
        flyButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        flyButton.addEventListener('click', () => {
            const formatId = formatSelect.value;
            const inputValue = input.value.trim();
            const coordinates = parseCoordinates(inputValue, formatId);

            if (coordinates) {
                this._flyToCoordinates(coordinates.lng, coordinates.lat);
                this._modal.style.display = 'none';
                input.value = '';
                validationMessage.textContent = '';
                validationMessage.className = 'coordinates-validation-message';
            } else {
                validationMessage.textContent = 'Coordenadas inválidas para o formato selecionado';
                validationMessage.className = 'coordinates-validation-message error';
            }
        });

        const createTypeSelect = document.createElement('select');
        createTypeSelect.id = 'coordinates-create-type';
        createTypeSelect.style.cssText = 'margin-left: 8px; padding: 8px; border-radius: 4px; border: 1px solid #ccc;';

        const pointOption = document.createElement('option');
        pointOption.value = 'point';
        pointOption.textContent = 'Ponto';

        const militaryOption = document.createElement('option');
        militaryOption.value = 'military';
        militaryOption.textContent = 'Simbologia militar';

        const coordinationOption = document.createElement('option');
        coordinationOption.value = 'coordination';
        coordinationOption.textContent = 'Medida de coordenação';

        createTypeSelect.appendChild(pointOption);
        createTypeSelect.appendChild(militaryOption);
        createTypeSelect.appendChild(coordinationOption);

        const createButton = document.createElement('button');
        createButton.textContent = 'Criar';
        createButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        createButton.addEventListener('click', () => {
            const formatId = formatSelect.value;
            const inputValue = input.value.trim();
            const coordinates = parseCoordinates(inputValue, formatId);

            if (!coordinates) {
                validationMessage.textContent = 'Coordenadas inválidas para o formato selecionado';
                validationMessage.className = 'coordinates-validation-message error';
                return;
            }

            const createType = createTypeSelect.value;

            switch (createType) {
                case 'point':
                    this._createPointAtCoordinates(coordinates.lng, coordinates.lat);
                    break;
                case 'military':
                    this._createMilitarySymbolAtCoordinates(coordinates.lng, coordinates.lat);
                    break;
                case 'coordination':
                    this._createCoordinationMeasureAtCoordinates(coordinates.lng, coordinates.lat);
                    break;
            }

            this._modal.style.display = 'none';
            input.value = '';
            validationMessage.textContent = '';
            validationMessage.className = 'coordinates-validation-message';
        });

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancelar';
        cancelButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        cancelButton.addEventListener('click', () => {
            this._modal.style.display = 'none';
            input.value = '';
            validationMessage.textContent = '';
            validationMessage.className = 'coordinates-validation-message';
        });

        buttonContainer.appendChild(flyButton);
        buttonContainer.appendChild(createButton);
        buttonContainer.appendChild(createTypeSelect);
        buttonContainer.appendChild(cancelButton);

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(formatContainer);
        modalContent.appendChild(inputContainer);
        modalContent.appendChild(validationMessage);
        modalContent.appendChild(buttonContainer);
        this._modal.appendChild(modalContent);

        document.body.appendChild(this._modal);

        this._modal.addEventListener('click', (e) => {
            if (e.target === this._modal) {
                this._modal.style.display = 'none';
            }
        });
    }

    async _createPointAtCoordinates(lng, lat) {
        const feature = await this._pointControl.createPointAtCoordinates(lng, lat);
        if (feature) {
            this._flyToCoordinates(lng, lat);
        }
    }

    async _createCoordinationMeasureAtCoordinates(lng, lat) {
        const lngLat = { lng, lat };
        const feature = await this._coordinationMeasureControl.createCoordinationMeasureFeature(lngLat);
        if (feature) {
            this._flyToCoordinates(lng, lat);
        }
    }

    async _createMilitarySymbolAtCoordinates(lng, lat) {
        const lngLat = { lng, lat };
        const feature = await this._militarySymbolControl.createMilitarySymbolFeature(lngLat);
        if (feature) {
            this._flyToCoordinates(lng, lat);
        }
    }

    _openFlyToModal() {
        if (this._modal) {
            const formatSelect = document.getElementById('coordinates-format-select');
            formatSelect.value = this._currentFormat;

            const input = document.getElementById('coordinates-input');
            input.placeholder = getPlaceholderForFormat(this._currentFormat);
            input.value = '';

            const validationMessage = document.getElementById('coordinates-validation');
            validationMessage.textContent = '';
            validationMessage.className = 'coordinates-validation-message';

            this._modal.style.display = 'block';

            setTimeout(() => {
                input.focus();
            }, 100);
        }
    }

    _flyToCoordinates(lng, lat) {
        const zoomOptions = {
            center: [lng, lat],
            zoom: Math.max(this._map.getZoom(), 14),
            duration: 1500,
            essential: true
        };

        this._map.easeTo(zoomOptions);
    }

    _toggleFormatSelector(e) {
        e.stopPropagation();
        const isVisible = this._formatSelector.style.display === 'block';
        this._formatSelector.style.display = isVisible ? 'none' : 'block';
    }

    _closeFormatSelector(e) {
        if (this._formatSelector &&
            !this._formatSelector.contains(e.target) &&
            !e.target.closest('.coordinates-gear-button')) {
            this._formatSelector.style.display = 'none';
        }
    }

    _setFormat(formatId) {
        if (this._currentFormat === formatId) return;

        this._currentFormat = formatId;

        const options = this._formatSelector.querySelectorAll('.coordinates-format-option');
        options.forEach(option => {
            if (option.dataset.format === formatId) {
                option.classList.add('active');
                option.style.backgroundColor = '#f0f0f0';
                option.style.fontWeight = 'bold';
            } else {
                option.classList.remove('active');
                option.style.backgroundColor = '';
                option.style.fontWeight = '';
            }
        });

        if (this._map) {
            this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
        }
    }

    async _onMouseMove(e) {
        this._currentCoordinates = { lat: e.lngLat.lat, lng: e.lngLat.lng };

        if (this._elevationEnabled && this._terrainAvailable) {
            this._currentElevation = await this._getElevationDebounced(e.lngLat.lat, e.lngLat.lng);
        }

        this._updateCoordinates(e.lngLat.lat, e.lngLat.lng);
    }

    async _updateCoordinates(lat, lng) {
        this._coordinatesText.innerHTML = '';

        try {
            const zoomSpan = document.createElement('span');
            zoomSpan.textContent = `Z${this._map.getZoom().toFixed(1)}`;
            this._coordinatesText.appendChild(zoomSpan);

            const displayFormat = await getDisplayFormat(lat, lng, this._currentFormat);

            displayFormat.parts.forEach(part => {
                const span = document.createElement('span');
                span.textContent = `${part.label}: ${part.value}`;
                this._coordinatesText.appendChild(span);
            });

            if (this._elevationEnabled && this._currentElevation !== null) {
                const elevSpan = document.createElement('span');
                elevSpan.textContent = `Elev: ${Math.round(this._currentElevation)}m`;
                this._coordinatesText.appendChild(elevSpan);
            }
        } catch (error) {
            console.error('Error converting coordinates:', error);
            const zoomSpan = document.createElement('span');
            zoomSpan.textContent = `Z${this._map.getZoom().toFixed(1)}`;
            this._coordinatesText.appendChild(zoomSpan);

            const latSpan = document.createElement('span');
            latSpan.textContent = `Lat: ${lat.toFixed(5)}°`;

            const lngSpan = document.createElement('span');
            lngSpan.textContent = `Lon: ${lng.toFixed(5)}°`;

            this._coordinatesText.appendChild(latSpan);
            this._coordinatesText.appendChild(lngSpan);

            if (this._elevationEnabled && this._currentElevation !== null) {
                const elevSpan = document.createElement('span');
                elevSpan.textContent = `Elev: ${Math.round(this._currentElevation)}m`;
                this._coordinatesText.appendChild(elevSpan);
            }
        }
    }

    getCurrentFormat() {
        return this._currentFormat;
    }

    getCurrentCoordinatesText() {
        const { lat, lng } = this._currentCoordinates;
        return formatCoordinates(lat, lng, this._currentFormat);
    }

    onRemove() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        if (this._elevationAbortController) {
            this._elevationAbortController.abort();
        }

        document.removeEventListener('click', this._closeFormatSelector);
        this._map.off('mousemove', this._onMouseMove);
        this._map.off('terrain', this._onTerrainChange);

        if (this._modal && this._modal.parentNode) {
            this._modal.parentNode.removeChild(this._modal);
        }

        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

export default MouseCoordinatesControl;
