class FeatureSearchControl {
    constructor(uiManager) {
      this._apiUrl = 'http://localhost:3000/busca';
      this._marker = null;
      this._uiManager = uiManager;
    }
  
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group feature-search-control';
  
      this._input = document.createElement('input');
      this._input.type = 'text';
      this._input.placeholder = 'Busque por nome';
      this._input.className = 'feature-search-input';
  
      this._suggestionsList = document.createElement('ul');
      this._suggestionsList.className = 'feature-search-suggestions';
  
      this._container.appendChild(this._input);
      this._container.appendChild(this._suggestionsList);
  
      this._input.addEventListener('input', this._debounce(this._getSuggestions.bind(this), 300));
      this._input.addEventListener('focusout', () => {
        setTimeout(() => {
          this._suggestionsList.style.display = 'none';
        }, 200);
      });
  
      return this._container;
    }
  
    _debounce(func, delay) {
      let timeout;
      return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
      };
    }
  
    async _getSuggestions() {
      const query = this._input.value;
      if (query.length < 3) {
        this._suggestionsList.style.display = 'none';
        return;
      }
  
      try {
        const center = this._map.getCenter();
        const response = await fetch(`${this._apiUrl}?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}`);
        const data = await response.json();
        this._displaySuggestions(data);
      } catch (error) {
        console.error('Error fetching suggestions:', error);
      }
    }
  
    _displaySuggestions(suggestions) {
      this._suggestionsList.innerHTML = '';
      if (suggestions.length === 0) {
        this._suggestionsList.style.display = 'none';
        return;
      }
  
      suggestions.forEach(suggestion => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${suggestion.tipo}:</strong> ${suggestion.nome} (${suggestion.municipio}, ${suggestion.estado})`;
        li.addEventListener('click', () => this._selectFeature(suggestion));
        this._suggestionsList.appendChild(li);
      });
  
      this._suggestionsList.style.display = 'block';
    }
  
    _selectFeature(feature) {
      this._input.value = '';
      this._suggestionsList.style.display = 'none';
  
      if (this._marker) {
        this._marker.remove();
      }
  
      this._marker = new maplibregl.Marker()
      .setLngLat([feature.longitude, feature.latitude])
      .addTo(this._map);
  
      this._map.flyTo({
        center: [feature.longitude, feature.latitude],
        zoom: 14,
        essential: true
      });

      this._uiManager.showFeatureSearchPanel(feature);
    }
  
    onRemove() {
      this._container.parentNode.removeChild(this._container);
      this.removeMarker();
      this._map = undefined;
  }

    removeMarker() {
      if (this._marker) {
          this._marker.remove();
          this._marker = null;
      }
  }
  }
  
  export default FeatureSearchControl;