class MouseCoordinatesControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group coordinates-control';
        
        // Criar um container interno para o conteúdo
        this._innerContainer = document.createElement('div');
        this._innerContainer.style.cssText = `
            padding: 6px 10px;
            font-family: monospace;
            font-size: 12px;
            pointer-events: none;
            display: flex;
            gap: 10px;
            white-space: nowrap;
            background: rgba(255, 255, 255, 0.9);
        `;

        // Create elements for coordinates
        this._lat = document.createElement('span');
        this._lng = document.createElement('span');
        
        this._innerContainer.appendChild(this._lat);
        this._innerContainer.appendChild(this._lng);
        this._container.appendChild(this._innerContainer);
        
        // Bind mousemove event
        this._map.on('mousemove', this._onMouseMove.bind(this));
        
        // Initial text
        this._updateCoordinates(0, 0);
        
        return this._container;
    }
    
    _onMouseMove(e) {
        this._updateCoordinates(e.lngLat.lat, e.lngLat.lng);
    }
    
    _updateCoordinates(lat, lng) {
        this._lat.textContent = `Lat: ${lat.toFixed(5)}°`;
        this._lng.textContent = `Lon: ${lng.toFixed(5)}°`;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map.off('mousemove', this._onMouseMove);
        this._map = undefined;
    }
}

export default MouseCoordinatesControl;