// Path: js\controls_sig\mouse_coordinates.js
import {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
    formatCoordinates,
    getDisplayFormat
} from './utilities/coordinate_converter.js';
import { getTerrainElevation } from './terrain_control.js';

class MouseCoordinatesControl {
    constructor(drawControl) {
        this._map = null;
        this._container = null;
        this._innerContainer = null;
        this._formatSelector = null;
        this._coordinatesText = null;
        this._currentFormat = 'latlong'; // Default format
        this._formatOptions = COORDINATE_FORMATS;
        this._modal = null;
        this._currentCoordinates = { lat: 0, lng: 0 };
        this._drawControl = drawControl; // Referência ao DrawControl para criar pontos
        
        // Elevation properties
        this._elevationEnabled = false;
        this._terrainAvailable = false;
        this._elevationButton = null;
        this._currentElevation = null;
        this._debounceTimer = null;
        this._elevationAbortController = null;
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group coordinates-control';

        // CSS para centralizar na parte inferior
        this._container.style.cssText = `
            position: fixed !important;
            bottom: 10px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 1000 !important;
            margin: 0 !important;
        `;

        // Create inner container for the coordinates display
        this._innerContainer = document.createElement('div');
        this._innerContainer.className = 'coordinates-display';

        // Create element for coordinates display
        this._coordinatesText = document.createElement('div');
        this._coordinatesText.className = 'coordinates-text';

        // Create controls container
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'coordinates-controls';

        // Create fly-to button
        const flyToButton = document.createElement('div');
        flyToButton.className = 'coordinates-button coordinates-flyto-button';
        flyToButton.title = "Ir para coordenadas";
        flyToButton.innerHTML = `<img src="./images/fly_to_icon.svg" alt="Fly to" width="16" height="16" />`;
        flyToButton.addEventListener('click', this._openFlyToModal.bind(this));

        // Create copy button
        const copyButton = document.createElement('div');
        copyButton.className = 'coordinates-button coordinates-copy-button';
        copyButton.title = "Copiar coordenadas";
        copyButton.innerHTML = `📋`;
        copyButton.style.fontSize = '14px';
        copyButton.addEventListener('click', this._copyCoordinates.bind(this));

        // Create elevation toggle button
        this._elevationButton = document.createElement('div');
        this._elevationButton.className = 'coordinates-button coordinates-elevation-button';
        this._elevationButton.title = "Mostrar elevação (terreno necessário)";
        this._elevationButton.innerHTML = `⛰️`;
        this._elevationButton.style.fontSize = '14px';
        this._elevationButton.addEventListener('click', this._toggleElevation.bind(this));

        // Create gear icon button
        const gearButton = document.createElement('div');
        gearButton.className = 'coordinates-button coordinates-gear-button';
        gearButton.title = "Mudar formato de coordenadas";
        gearButton.innerHTML = `<img src="./images/gear_icon.svg" alt="Settings" width="16" height="16" />`;
        gearButton.addEventListener('click', this._toggleFormatSelector.bind(this));

        // Create format selector dropdown (initially hidden)
        this._formatSelector = document.createElement('div');
        this._formatSelector.className = 'coordinates-format-selector';

        // Add format options to the selector
        this._formatOptions.forEach(format => {
            const option = document.createElement('div');
            option.className = 'coordinates-format-option';
            if (format.id === this._currentFormat) {
                option.classList.add('active');
            }
            option.textContent = format.label;
            option.dataset.format = format.id;

            // Event listeners for the option
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

        controlsContainer.appendChild(copyButton);
        controlsContainer.appendChild(flyToButton);
        controlsContainer.appendChild(this._elevationButton);
        controlsContainer.appendChild(gearButton);
        this._innerContainer.appendChild(this._coordinatesText);
        this._innerContainer.appendChild(controlsContainer);
        this._container.appendChild(this._innerContainer);
        this._container.appendChild(this._formatSelector);

        // Create the fly-to modal (hidden initially)
        this._createFlyToModal();

        // Add click listener to close the dropdown when clicking outside
        document.addEventListener('click', this._closeFormatSelector.bind(this));

        // Bind mousemove event to update coordinates
        this._map.on('mousemove', this._onMouseMove.bind(this));

        // Check terrain availability and setup elevation button
        this._checkTerrainAvailability();

        // Initial coordinates display
        this._updateCoordinates(0, 0);

        return this._container;
    }

    async _checkTerrainAvailability() {
        try {
            // Test if terrain is available by querying a known coordinate
            const testCoords = [0, 0];
            await getTerrainElevation(this._map, testCoords);
            this._terrainAvailable = true;
            this._elevationButton.style.opacity = '1';
            this._elevationButton.style.cursor = 'pointer';
            this._elevationButton.title = "Mostrar/ocultar elevação";
        } catch (error) {
            console.warn('Terrain not available:', error);
            this._terrainAvailable = false;
            this._elevationButton.style.opacity = '0.3';
            this._elevationButton.style.cursor = 'not-allowed';
            this._elevationButton.title = "Elevação indisponível (terreno necessário)";
        }
    }

    _toggleElevation() {
        if (!this._terrainAvailable) {
            return; // Don't toggle if terrain is not available
        }

        this._elevationEnabled = !this._elevationEnabled;
        
        // Update button appearance
        if (this._elevationEnabled) {
            this._elevationButton.style.backgroundColor = '#508D4E';
            this._elevationButton.style.color = 'white';
        } else {
            this._elevationButton.style.backgroundColor = '';
            this._elevationButton.style.color = '';
            this._currentElevation = null;
        }

        // Update coordinates display immediately
        this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
    }

    async _getElevationDebounced(lat, lng) {
        // Cancel previous request
        if (this._elevationAbortController) {
            this._elevationAbortController.abort();
        }

        // Clear previous timer
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }

        return new Promise((resolve) => {
            this._debounceTimer = setTimeout(async () => {
                try {
                    this._elevationAbortController = new AbortController();
                    const elevation = await getTerrainElevation(this._map, [lng, lat]);
                    
                    // Check if request was aborted
                    if (this._elevationAbortController.signal.aborted) {
                        return;
                    }

                    resolve(elevation);
                } catch (error) {
                    console.warn('Error getting elevation:', error);
                    // Fallback: disable elevation on error
                    this._elevationEnabled = false;
                    this._elevationButton.style.backgroundColor = '';
                    this._elevationButton.style.color = '';
                    resolve(null);
                }
            }, 300); // 300ms debounce
        });
    }

    _createFlyToModal() {
        // Create modal container
        this._modal = document.createElement('div');
        this._modal.className = 'coordinates-modal';
        this._modal.style.display = 'none';

        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.className = 'coordinates-modal-content';

        // Create modal header
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

        // Create format selector
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

        // Create input field
        const inputContainer = document.createElement('div');
        inputContainer.className = 'coordinates-modal-input';
        const inputLabel = document.createElement('label');
        inputLabel.textContent = 'Coordenadas:';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'coordinates-input';
        input.placeholder = getPlaceholderForFormat(this._currentFormat);

        // Update placeholder when format changes
        formatSelect.addEventListener('change', (e) => {
            input.placeholder = getPlaceholderForFormat(e.target.value);
        });

        inputContainer.appendChild(inputLabel);
        inputContainer.appendChild(input);

        // Create validation message area
        const validationMessage = document.createElement('div');
        validationMessage.className = 'coordinates-validation-message';
        validationMessage.id = 'coordinates-validation';

        // Create buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'coordinates-modal-buttons';

        const flyButton = document.createElement('button');
        flyButton.textContent = 'Ir para';
        flyButton.className = 'coordinates-fly-button';
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

        const createPointButton = document.createElement('button');
        createPointButton.textContent = 'Criar ponto';
        createPointButton.className = 'coordinates-create-point-button';
        createPointButton.addEventListener('click', () => {
            const formatId = formatSelect.value;
            const inputValue = input.value.trim();
            const coordinates = parseCoordinates(inputValue, formatId);

            if (coordinates) {
                this._createPointAtCoordinates(coordinates.lng, coordinates.lat);
                this._modal.style.display = 'none';
                input.value = '';
                validationMessage.textContent = '';
                validationMessage.className = 'coordinates-validation-message';
            } else {
                validationMessage.textContent = 'Coordenadas inválidas para o formato selecionado';
                validationMessage.className = 'coordinates-validation-message error';
            }
        });

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancelar';
        cancelButton.className = 'coordinates-cancel-button';
        cancelButton.addEventListener('click', () => {
            this._modal.style.display = 'none';
            input.value = '';
            validationMessage.textContent = '';
            validationMessage.className = 'coordinates-validation-message';
        });

        buttonContainer.appendChild(flyButton);
        buttonContainer.appendChild(createPointButton);
        buttonContainer.appendChild(cancelButton);

        // Assemble modal
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(formatContainer);
        modalContent.appendChild(inputContainer);
        modalContent.appendChild(validationMessage);
        modalContent.appendChild(buttonContainer);
        this._modal.appendChild(modalContent);

        // Add modal to document body
        document.body.appendChild(this._modal);

        // Close modal when clicking outside
        this._modal.addEventListener('click', (e) => {
            if (e.target === this._modal) {
                this._modal.style.display = 'none';
            }
        });
    }

    _createPointAtCoordinates(lng, lat) {
        this._drawControl.addPointFeatureAtCoordinates(lng, lat);
        this._flyToCoordinates(lng, lat);
    }

    _copyCoordinates() {
        const { lat, lng } = this._currentCoordinates;
        const textToCopy = formatCoordinates(lat, lng, this._currentFormat);

        if (!textToCopy || textToCopy.trim() === '') return;

        // Try modern clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                this._showCopyFeedback();
            }).catch(() => {
                this._fallbackCopyTextToClipboard(textToCopy);
            });
        } else {
            this._fallbackCopyTextToClipboard(textToCopy);
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
            this._showCopyFeedback();
        } catch (err) {
            console.error('Error copying text:', err);
        }
        
        document.body.removeChild(textArea);
    }

    _showCopyFeedback() {
        const copyButton = this._container.querySelector('.coordinates-copy-button');
        const originalContent = copyButton.innerHTML;

        // Show check mark briefly
        copyButton.innerHTML = '✅';
        copyButton.style.color = '#28a745';

        setTimeout(() => {
            copyButton.innerHTML = originalContent;
            copyButton.style.color = '';
        }, 1000);
    }

    _openFlyToModal() {
        if (this._modal) {
            // Set input to current format
            const formatSelect = document.getElementById('coordinates-format-select');
            formatSelect.value = this._currentFormat;

            // Clear any previous input
            const input = document.getElementById('coordinates-input');
            input.placeholder = getPlaceholderForFormat(this._currentFormat);
            input.value = '';

            // Clear validation message
            const validationMessage = document.getElementById('coordinates-validation');
            validationMessage.textContent = '';
            validationMessage.className = 'coordinates-validation-message';

            // Show the modal
            this._modal.style.display = 'block';

            // Focus the input
            setTimeout(() => {
                input.focus();
            }, 100);
        }
    }

    _flyToCoordinates(lng, lat) {
        // Configurações do zoom para ponto criado
        const zoomOptions = {
            center: [lng, lat],
            zoom: Math.max(this._map.getZoom(), 14),
            duration: 1500, // Animação de 1.5 segundos
            essential: true // Não cancelar por outras interações
        };

        // Executar a navegação
        this._map.easeTo(zoomOptions);
    }

    _toggleFormatSelector(e) {
        e.stopPropagation();
        const isVisible = this._formatSelector.style.display === 'block';
        this._formatSelector.style.display = isVisible ? 'none' : 'block';
    }

    _closeFormatSelector(e) {
        // Check if the click is outside the format selector and gear button
        if (this._formatSelector &&
            !this._formatSelector.contains(e.target) &&
            !e.target.closest('.coordinates-gear-button')) {
            this._formatSelector.style.display = 'none';
        }
    }

    _setFormat(formatId) {
        if (this._currentFormat === formatId) return;

        this._currentFormat = formatId;

        // Update the dropdown to highlight the selected option
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

        // Update the coordinates display with the new format
        if (this._map) {
            this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
        }
    }

    async _onMouseMove(e) {
        this._currentCoordinates = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        
        // Get elevation if enabled
        if (this._elevationEnabled && this._terrainAvailable) {
            this._currentElevation = await this._getElevationDebounced(e.lngLat.lat, e.lngLat.lng);
        }
        
        this._updateCoordinates(e.lngLat.lat, e.lngLat.lng);
    }

    _updateCoordinates(lat, lng) {
        this._coordinatesText.innerHTML = '';

        try {
            const displayFormat = getDisplayFormat(lat, lng, this._currentFormat);

            displayFormat.parts.forEach(part => {
                const span = document.createElement('span');
                span.textContent = `${part.label}: ${part.value}`;
                this._coordinatesText.appendChild(span);
            });

            // Add elevation if enabled and available
            if (this._elevationEnabled && this._currentElevation !== null) {
                const elevSpan = document.createElement('span');
                elevSpan.textContent = `Elev: ${Math.round(this._currentElevation)}m`;
                this._coordinatesText.appendChild(elevSpan);
            }
        } catch (error) {
            console.error('Error converting coordinates:', error);
            // Fallback to lat/long if conversion fails
            const latSpan = document.createElement('span');
            latSpan.textContent = `Lat: ${lat.toFixed(5)}°`;

            const lngSpan = document.createElement('span');
            lngSpan.textContent = `Lon: ${lng.toFixed(5)}°`;

            this._coordinatesText.appendChild(latSpan);
            this._coordinatesText.appendChild(lngSpan);

            // Add elevation in fallback too
            if (this._elevationEnabled && this._currentElevation !== null) {
                const elevSpan = document.createElement('span');
                elevSpan.textContent = `Elev: ${Math.round(this._currentElevation)}m`;
                this._coordinatesText.appendChild(elevSpan);
            }
        }
    }

    onRemove() {
        // Clean up timers and controllers
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        if (this._elevationAbortController) {
            this._elevationAbortController.abort();
        }

        document.removeEventListener('click', this._closeFormatSelector);
        this._map.off('mousemove', this._onMouseMove);

        if (this._modal && this._modal.parentNode) {
            this._modal.parentNode.removeChild(this._modal);
        }

        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

export default MouseCoordinatesControl;