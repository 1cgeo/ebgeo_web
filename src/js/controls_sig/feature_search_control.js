// Path: js/controls_sig/feature_search_control.js
import config from '../config.js';
import { showError } from './utilities/toast_service.js';

class FeatureSearchControl {
  constructor(uiManager) {
    this._apiUrl = config.search.apiUrl;
    this._marker = null;
    this._uiManager = uiManager;
    this._isExpanded = false;
    this._disabled = !this._apiUrl;
  }

  onAdd(map) {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group feature-search-control controls-column-left';

    this._button = document.createElement('button');
    this._button.type = 'button';
    this._button.className = 'mapbox-gl-draw_ctrl-draw-btn';
    this._button.setAttribute("id", "feature-search-tool");
    this._button.title = 'Buscar';

    const strokeColor = this._disabled ? '#999' : '#333';
    const cursorStyle = this._disabled ? 'not-allowed' : 'pointer';

    this._button.innerHTML = `
        <svg class="icon-sig-tool" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2">
            <circle cx="11" cy="11" r="6"></circle>
            <path d="m21 21-4.35-4.35"></path>
        </svg>
    `;

    this._button.style.cursor = cursorStyle;
    this._button.disabled = this._disabled;

    if (this._disabled) {
      this._container.classList.add('disabled');
    }

    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.placeholder = 'Busque por nome';
    this._input.className = 'feature-search-input';
    this._input.style.display = 'none';

    this._suggestionsList = document.createElement('ul');
    this._suggestionsList.className = 'feature-search-suggestions';

    this._container.appendChild(this._button);
    this._container.appendChild(this._input);
    this._container.appendChild(this._suggestionsList);

    this._button.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this._disabled) {
        this._toggleSearch();
      }
    });
    this._input.addEventListener('input', this._debounce(this._getSuggestions.bind(this), 300));
    this._input.addEventListener('focus', () => {
      if (this._input.value.length >= 3) {
        this._getSuggestions();
      }
    });

    this._input.addEventListener('blur', () => {
      setTimeout(() => {
        this._suggestionsList.style.display = 'none';
      }, 300);
    });

    return this._container;
  }

  _toggleSearch() {
    if (this._isExpanded) {
      this._collapseSearch();
    } else {
      this._expandSearch();
    }
  }

  _expandSearch() {
    this._isExpanded = true;
    this._input.style.display = 'block';
    this._container.classList.add('expanded');

    setTimeout(() => {
      this._input.focus();
    }, 100);
  }

  _collapseSearch() {
    this._isExpanded = false;
    this._input.style.display = 'none';
    this._input.value = '';
    this._suggestionsList.style.display = 'none';
    this._container.classList.remove('expanded');
    this.removeMarker();
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
      this._container.classList.remove('searching');
    }
  }

  _filterValidSuggestions(suggestions) {
    if (!Array.isArray(suggestions)) {
      return [];
    }

    return suggestions.filter(suggestion => {
      const requiredFields = ['tipo', 'nome', 'municipio', 'estado', 'longitude', 'latitude'];

      return requiredFields.every(field => {
        const value = suggestion[field];

        if (value === null || value === undefined) {
          return false;
        }

        if (typeof value === 'string' && value.trim() === '') {
          return false;
        }

        if ((field === 'longitude' || field === 'latitude') && (isNaN(value) || !isFinite(value))) {
          return false;
        }

        return true;
      });
    });
  }

  _displaySuggestions(suggestions) {
    this._suggestionsList.innerHTML = '';

    const validSuggestions = this._filterValidSuggestions(suggestions);

    if (validSuggestions.length === 0) {
      this._suggestionsList.style.display = 'none';
      return;
    }

    validSuggestions.forEach(suggestion => {
      const li = document.createElement('li');
      li.className = 'feature-search-suggestion';
      li.innerHTML = `<strong>${suggestion.tipo}:</strong> ${suggestion.nome} (${suggestion.municipio}, ${suggestion.estado})`;

      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._selectFeature(suggestion);
      });

      li.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._selectFeature(suggestion);
      });

      li.addEventListener('mouseenter', () => {
        if (!this._isTouchDevice()) {
          li.style.backgroundColor = 'rgba(80, 141, 78, 0.1)';
        }
      });

      li.addEventListener('mouseleave', () => {
        li.style.backgroundColor = '';
      });

      this._suggestionsList.appendChild(li);
    });

    this._suggestionsList.style.display = 'block';
  }

  _isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  _displayError() {
    this._suggestionsList.style.display = 'none';
    showError('Não foi possível buscar sugestões. Verifique sua conexão.');
  }

  _selectFeature(feature) {
    this._input.value = '';
    this._suggestionsList.style.display = 'none';

    this._uiManager.saveChangesAndClosePanel();

    this.removeMarker();

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

  clearSearch() {
    this._collapseSearch();
  }
}

export default FeatureSearchControl;
