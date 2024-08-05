class FeatureSearchControl {
    constructor(apiUrl) {
      this._apiUrl = apiUrl;
    }
  
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
  
      this._input = document.createElement('input');
      this._input.type = 'text';
      this._input.placeholder = 'Busque por nome';
      this._input.style.width = '200px';
  
      this._suggestionsList = document.createElement('ul');
      this._suggestionsList.style.display = 'none';
      this._suggestionsList.style.position = 'absolute';
      this._suggestionsList.style.backgroundColor = 'white';
      this._suggestionsList.style.listStyleType = 'none';
      this._suggestionsList.style.padding = '5px';
      this._suggestionsList.style.margin = '0';
      this._suggestionsList.style.border = '1px solid #ccc';
  
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
        const center = map.getCenter();
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
        li.textContent = `${suggestion.tipo}: ${suggestion.nome} (${suggestion.municipio}, ${suggestion.estado})`;
        li.addEventListener('click', () => this._selectFeature(suggestion));
        this._suggestionsList.appendChild(li);
      });
  
      this._suggestionsList.style.display = 'block';
    }
  
    _selectFeature(feature) {
      this._input.value = feature.nome;
      this._suggestionsList.style.display = 'none';
  
      new maplibregl.Marker()
        .setLngLat([feature.longitude, feature.latitude])
        .addTo(this._map);
  
      this._map.flyTo({
        center: [feature.longitude, feature.latitude],
        zoom: 14,
        essential: true
      });
    }
  
    onRemove() {
      this._container.parentNode.removeChild(this._container);
      this._map = undefined;
    }
  }
  
  export default FeatureSearchControl;