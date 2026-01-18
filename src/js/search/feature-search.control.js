// Path: js/search/feature-search.control.js
import config from '../config.js';
import { showError } from '../utilities';

// Maximum number of 3D model results to display
const MAX_3D_MODEL_RESULTS = 5;

class FeatureSearchControl {
  constructor(uiManager) {
    this._apiUrl = config.search.apiUrl;
    this._marker = null;
    this._uiManager = uiManager;
    this._isExpanded = false;

    // Disable only if no API and no tilesets
    const hasTilesets = config.tilesets && config.tilesets.length > 0;
    this._disabled = !this._apiUrl && !hasTilesets;
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

  /**
   * Search for 3D models locally in config.tilesets
   * @param {string} query - Search query (case-insensitive substring match)
   * @returns {Array} Array of matching 3D model results
   */
  _search3DModels(query) {
    if (!config.tilesets || config.tilesets.length === 0) {
      return [];
    }

    const normalizedQuery = query.toLowerCase();

    return config.tilesets
      .filter(tileset => {
        if (!tileset.name || !tileset.id || !tileset.locate) {
          return false;
        }
        return tileset.name.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, MAX_3D_MODEL_RESULTS)
      .map(tileset => ({
        type: '3d-model',
        tilesetId: tileset.id,
        nome: tileset.name,
        dataCaptura: tileset.data_captura || null,
        longitude: tileset.locate.lon,
        latitude: tileset.locate.lat
      }));
  }

  async _getSuggestions() {
    const query = this._input.value.trim();
    if (query.length < 3) {
      this._suggestionsList.style.display = 'none';
      return;
    }

    // Search local 3D models immediately (synchronous)
    let models3D = [];
    try {
      models3D = this._search3DModels(query);
    } catch (error) {
      console.warn('[Search] Error searching 3D models:', error);
    }

    // Display 3D results immediately if available
    if (models3D.length > 0) {
      this._displaySuggestions(models3D);
    }

    // Search API in parallel (don't block on failure)
    if (this._apiUrl) {
      this._container.classList.add('searching');

      try {
        const center = this._map.getCenter();
        const response = await fetch(`${this._apiUrl}?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}`);

        if (response.ok) {
          const data = await response.json();
          const apiResults = Array.isArray(data) ? data : [];
          const combinedResults = [...models3D, ...apiResults];

          if (combinedResults.length > 0) {
            this._displaySuggestions(combinedResults);
          } else {
            this._suggestionsList.style.display = 'none';
          }
        } else if (models3D.length === 0) {
          // API failed and no 3D models
          this._suggestionsList.style.display = 'none';
        }
      } catch (error) {
        // API failed - if no 3D models, hide suggestions
        if (models3D.length === 0) {
          this._suggestionsList.style.display = 'none';
        }
      } finally {
        this._container.classList.remove('searching');
      }
    } else if (models3D.length === 0) {
      // No API configured and no 3D models
      this._suggestionsList.style.display = 'none';
    }
  }

  _filterValidSuggestions(suggestions) {
    if (!Array.isArray(suggestions)) {
      return [];
    }

    return suggestions.filter(suggestion => {
      // 3D models have different structure and are already validated
      if (suggestion.type === '3d-model') {
        return true;
      }

      // API results validation
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
    console.log(`[Search] Valid suggestions after filter: ${validSuggestions.length}`);

    if (validSuggestions.length === 0) {
      this._suggestionsList.style.display = 'none';
      return;
    }

    validSuggestions.forEach(suggestion => {
      const li = document.createElement('li');
      li.className = 'feature-search-suggestion';

      // Different display for 3D models vs API results
      if (suggestion.type === '3d-model') {
        li.classList.add('suggestion-3d-model');
        li.innerHTML = `
          <svg class="suggestion-3d-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          <span><strong>Modelo 3D:</strong> ${suggestion.nome}</span>
        `;
      } else {
        li.innerHTML = `<strong>${suggestion.tipo}:</strong> ${suggestion.nome} (${suggestion.municipio}, ${suggestion.estado})`;
      }

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

    // Handle 3D model selection
    if (feature.type === '3d-model') {
      if (window.modelsViewerControl) {
        window.modelsViewerControl.navigateToModel(feature.tilesetId);
      }
      return;
    }

    // Handle API result selection (existing behavior)
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
