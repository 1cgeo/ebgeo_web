// Path: js\controls_sig\mouse_coordinates.js
class MouseCoordinatesControl {
    constructor(drawControl) {
        this._map = null;
        this._container = null;
        this._innerContainer = null;
        this._formatSelector = null;
        this._coordinatesText = null;
        this._currentFormat = 'latlong'; // Default format
        this._formatOptions = [
            { id: 'latlong', label: 'Lat/Long (graus)' },
            { id: 'utm', label: 'UTM (metros)' },
            { id: 'mgrs', label: 'MGRS' }
        ];
        this._modal = null;
        this._currentCoordinates = { lat: 0, lng: 0 };
        this._drawControl = drawControl; // Referência ao DrawControl para criar pontos
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group coordinates-control';
        
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
            option.addEventListener('click', (e) => {
                this._setFormat(format.id);
                this._formatSelector.style.display = 'none';
                e.stopPropagation();
            });
            this._formatSelector.appendChild(option);
        });
        
        // Assemble the components
        controlsContainer.appendChild(flyToButton);
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
        
        // Initial coordinates display
        this._updateCoordinates(0, 0);
        
        return this._container;
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
        modalTitle.textContent = 'Fly to Coordinates';
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
        input.placeholder = this._getPlaceholderForFormat(this._currentFormat);
        
        // Update placeholder when format changes
        formatSelect.addEventListener('change', (e) => {
            input.placeholder = this._getPlaceholderForFormat(e.target.value);
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
            const coordinates = this._parseCoordinates(inputValue, formatId);
            
            if (coordinates) {
                this._flyToCoordinates(coordinates.lng, coordinates.lat);
                this._modal.style.display = 'none';
                input.value = '';
                validationMessage.textContent = '';
                validationMessage.className = 'coordinates-validation-message';
            } else {
                validationMessage.textContent = 'Invalid coordinates for the selected format';
                validationMessage.className = 'coordinates-validation-message error';
            }
        });

        const createPointButton = document.createElement('button');
        createPointButton.textContent = 'Criar ponto';
        createPointButton.className = 'coordinates-create-point-button';
        createPointButton.addEventListener('click', () => {
            const formatId = formatSelect.value;
            const inputValue = input.value.trim();
            const coordinates = this._parseCoordinates(inputValue, formatId);
            
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
        buttonContainer.appendChild(createPointButton); // Adiciona o novo botão
        buttonContainer.appendChild(cancelButton);
        
        // Assemble modal content
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(formatContainer);
        modalContent.appendChild(inputContainer);
        modalContent.appendChild(validationMessage);
        modalContent.appendChild(buttonContainer);
        
        this._modal.appendChild(modalContent);
        document.body.appendChild(this._modal);
        
        // Close when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === this._modal) {
                this._modal.style.display = 'none';
            }
        });
    }
    
    _createPointAtCoordinates(lng, lat) {
        if (this._drawControl) {
            const lngLat = { lng, lat };
            this._drawControl.addPointFeatureAtCoordinates(lngLat);
        } else {
            console.warn('DrawControl não está disponível para criar pontos');
        }
    }
    
    _getPlaceholderForFormat(formatId) {
        switch (formatId) {
            case 'latlong':
                return '-22.455921, -44.449655';
            case 'utm':
                return '23K 680834 7516602';
            case 'mgrs':
                return '23K TP 80834 16602';
            default:
                return 'Entrar coordenadas';
        }
    }
    
    _parseCoordinates(input, formatId) {
        try {
            switch (formatId) {
                case 'latlong':
                    return this._parseLatLong(input);
                case 'utm':
                    return this._parseUTM(input);
                case 'mgrs':
                    return this._parseMGRS(input);
                default:
                    return null;
            }
        } catch (error) {
            console.error('Error parsing coordinates:', error);
            return null;
        }
    }
    
    _parseLatLong(input) {
        // Try different formats: "lat, lng", "lat lng", "lat,lng"
        const patterns = [
            /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/,  // lat, lng
            /^\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*$/,      // lat lng
            /^\s*(-?\d+\.?\d*),(-?\d+\.?\d*)\s*$/         // lat,lng
        ];
        
        for (const pattern of patterns) {
            const match = input.match(pattern);
            if (match) {
                const lat = parseFloat(match[1]);
                const lng = parseFloat(match[2]);
                
                // Validate latitude/longitude ranges
                if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    return { lat, lng };
                }
            }
        }
        
        return null;
    }
    
    _parseUTM(input) {
        if (typeof proj4 === 'undefined') {
            console.warn('UTM conversion requires proj4 library');
            return null;
        }
        
        // Match format: "zone[N/S] easting northing"
        // e.g., "18N 500000 4000000" or "18 N 500000 4000000"
        const utmPattern = /^\s*(\d{1,2})\s*([NS])?\s+(\d+)\s+(\d+)\s*$/i;
        const match = input.match(utmPattern);
        
        if (match) {
            const zone = parseInt(match[1], 10);
            const hemisphere = (match[2] || 'N').toUpperCase();
            const easting = parseInt(match[3], 10);
            const northing = parseInt(match[4], 10);
            
            // Validate UTM values
            if (zone >= 1 && zone <= 60 && 
                (hemisphere === 'N' || hemisphere === 'S') &&
                easting >= 160000 && easting <= 840000 &&
                northing >= 0) {
                
                // Convert from UTM to lat/lng
                const utmProjection = `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
                const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
                
                const result = proj4(utmProjection, wgs84, [easting, northing]);
                return { lng: result[0], lat: result[1] };
            }
        }
        
        return null;
    }
    
    _parseMGRS(input) {
        if (typeof mgrs === 'undefined') {
            console.warn('MGRS conversion requires mgrs library');
            return null;
        }
        
        // Remove any spaces and check if it's a valid MGRS string
        const mgrsString = input.replace(/\s+/g, '');
        
        try {
            const result = mgrs.toPoint(mgrsString);
            return { lng: result[0], lat: result[1] };
        } catch (e) {
            return null;
        }
    }
    
    _openFlyToModal() {
        if (this._modal) {
            // Set input to current format
            const formatSelect = document.getElementById('coordinates-format-select');
            formatSelect.value = this._currentFormat;
            
            // Clear any previous input
            const input = document.getElementById('coordinates-input');
            input.placeholder = this._getPlaceholderForFormat(this._currentFormat);
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
        if (this._map) {
            this._map.flyTo({
                center: [lng, lat],
                zoom: 14,
                essential: true
            });
        }
    }
    
    _toggleFormatSelector(e) {
        e.stopPropagation();
        const isVisible = this._formatSelector.style.display === 'block';
        this._formatSelector.style.display = isVisible ? 'none' : 'block';
    }
    
    _closeFormatSelector() {
        this._formatSelector.style.display = 'none';
    }
    
    _setFormat(formatId) {
        if (this._currentFormat === formatId) return;
        
        this._currentFormat = formatId;
        
        // Update the dropdown to highlight the selected option
        const options = this._formatSelector.querySelectorAll('.coordinates-format-option');
        options.forEach(option => {
            if (option.dataset.format === formatId) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
        
        // Update the coordinates display with the new format
        if (this._map) {
            this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
        }
    }
    
    _onMouseMove(e) {
        this._currentCoordinates = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        this._updateCoordinates(e.lngLat.lat, e.lngLat.lng);
    }
    
    _updateCoordinates(lat, lng) {
        this._coordinatesText.innerHTML = '';
        
        try {
            switch (this._currentFormat) {
                case 'latlong':
                    this._displayLatLong(lat, lng);
                    break;
                case 'utm':
                    this._displayUTM(lat, lng);
                    break;
                case 'mgrs':
                    this._displayMGRS(lat, lng);
                    break;
                default:
                    this._displayLatLong(lat, lng);
            }
        } catch (error) {
            console.error('Error converting coordinates:', error);
            // Fallback to lat/long if conversion fails
            this._displayLatLong(lat, lng);
        }
    }
    
    _displayLatLong(lat, lng) {
        const latSpan = document.createElement('span');
        latSpan.textContent = `Lat: ${lat.toFixed(5)}°`;
        
        const lngSpan = document.createElement('span');
        lngSpan.textContent = `Lon: ${lng.toFixed(5)}°`;
        
        this._coordinatesText.appendChild(latSpan);
        this._coordinatesText.appendChild(lngSpan);
    }
    
    _displayUTM(lat, lng) {
        // Check if proj4 is available
        if (typeof proj4 === 'undefined') {
            this._displayLatLong(lat, lng);
            console.warn('UTM conversion requires proj4 library. Defaulting to Lat/Long.');
            return;
        }
        
        // Determine UTM zone based on longitude
        const zone = Math.floor((lng + 180) / 6) + 1;
        const hemisphere = lat >= 0 ? 'N' : 'S';
        
        // Define UTM projection for the specific zone
        const utmProjection = `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
        
        // Convert from WGS84 to UTM
        const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
        const utmCoords = proj4(wgs84, utmProjection, [lng, lat]);
        
        // Create display elements
        const zoneSpan = document.createElement('span');
        zoneSpan.textContent = `Zona: ${zone}${hemisphere}`;
        
        const eastingSpan = document.createElement('span');
        eastingSpan.textContent = `E: ${Math.round(utmCoords[0])}m`;
        
        const northingSpan = document.createElement('span');
        northingSpan.textContent = `N: ${Math.round(utmCoords[1])}m`;
        
        this._coordinatesText.appendChild(zoneSpan);
        this._coordinatesText.appendChild(eastingSpan);
        this._coordinatesText.appendChild(northingSpan);
    }
    
    _displayMGRS(lat, lng) {
        // Check if mgrs is available
        if (typeof mgrs === 'undefined') {
            this._displayLatLong(lat, lng);
            console.warn('MGRS conversion requires mgrs library. Defaulting to Lat/Long.');
            return;
        }
        
        // Convert to MGRS with 5-digit precision (1m resolution)
        const mgrsString = mgrs.forward([lng, lat], 5);
        
        const mgrsSpan = document.createElement('span');
        mgrsSpan.textContent = `MGRS: ${mgrsString}`;
        
        this._coordinatesText.appendChild(mgrsSpan);
    }
    
    onRemove() {
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