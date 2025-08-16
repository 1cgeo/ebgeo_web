// Path: js\controls_sig\feature_search_control.js
import config from '../config.js';

class FeatureSearchControl {
    constructor(uiManager) {
      this._apiUrl = config.search.apiUrl;
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
      this._input.addEventListener('focus', () => {
        if (this._input.value.length >= 3) {
          this._getSuggestions();
        }
      });
      this._input.addEventListener('blur', () => {
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
      const query = this._input.value.trim();
      if (query.length < 3) {
        this._suggestionsList.style.display = 'none';
        return;
      }
  
      try {
        // Adicionar indicador de carregamento
        this._container.classList.add('searching');
        
        const center = this._map.getCenter();
        const response = await fetch(`${this._apiUrl}?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        this._displaySuggestions(data);
        
      } catch (error) {
        console.error('Error fetching suggestions:', error);
        this._displayError();
      } finally {
        // Remover indicador de carregamento
        this._container.classList.remove('searching');
      }
    }
  
    _displaySuggestions(suggestions) {
      this._suggestionsList.innerHTML = '';
      
      if (!suggestions || suggestions.length === 0) {
        this._suggestionsList.style.display = 'none';
        return;
      }
  
      suggestions.forEach(suggestion => {
        const li = document.createElement('li');
        li.className = 'feature-search-suggestion';
        li.innerHTML = `<strong>${suggestion.tipo}:</strong> ${suggestion.nome} (${suggestion.municipio}, ${suggestion.estado})`;
        
        li.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._selectFeature(suggestion);
        });
        
        li.addEventListener('mouseenter', () => {
          li.style.backgroundColor = 'rgba(80, 141, 78, 0.1)';
        });
        
        li.addEventListener('mouseleave', () => {
          li.style.backgroundColor = '';
        });
        
        this._suggestionsList.appendChild(li);
      });
  
      // Mostrar dropdown
      this._suggestionsList.style.display = 'block';
    }
    
    _displayError() {
      this._suggestionsList.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'feature-search-suggestion error';
      li.innerHTML = '<strong>Erro:</strong> Não foi possível buscar sugestões';
      li.style.color = '#dc3545';
      li.style.cursor = 'default';
      this._suggestionsList.appendChild(li);
      this._suggestionsList.style.display = 'block';
    }
  
    _selectFeature(feature) {
      this._input.value = '';
      this._suggestionsList.style.display = 'none';
  
      this._uiManager.saveChangesAndClosePanel();
  
      // Remover marcador anterior se existir
      this.removeMarker();
      
      // Criar novo marcador
      this._marker = new maplibregl.Marker()
        .setLngLat([feature.longitude, feature.latitude])
        .addTo(this._map);
  
      // Fazer zoom para a localização
      this._map.flyTo({
        center: [feature.longitude, feature.latitude],
        zoom: 14,
        essential: true
      });

      // Mostrar painel com informações da feature
      this._uiManager.showFeatureSearchPanel(feature);
    }
  
    onRemove() {
      if (this._container && this._container.parentNode) {
        this._container.parentNode.removeChild(this._container);
      }
      this.removeMarker();
      this._map = undefined;
    }

    removeMarker() {
      if (this._marker) {
        this._marker.remove();
        this._marker = null;
      }
    }
    
    // Método público para limpar a busca
    clearSearch() {
      this._input.value = '';
      this._suggestionsList.style.display = 'none';
      this.removeMarker();
    }
}
  
export default FeatureSearchControl;