// Path: js/controls_sig/utilities/feature_navigation_utils.js

/**
 * Utilitário para navegação e zoom em features do mapa
 * Centraliza lógica de zoom, seleção e navegação entre features
 */

/**
 * Mapeamento entre tipos do store (plural) e tipos do SelectionManager (singular)
 */
const FEATURE_TYPE_MAPPING = {
    'arrows': 'arrow',
    'boundarys': 'boundary',
    'brushes': 'brush',
    'circles': 'circle',
    'ellipses': 'ellipse',
    'images': 'image',
    'lines': 'line',
    'los': 'los',
    'military_symbols': 'military_symbol',
    'occupied_fronts': 'occupied_front',
    'points': 'point',
    'polygons': 'polygon',
    'rectangle': 'rectangle',
    'texts': 'text',
    'visibility': 'visibility'
};

export class FeatureNavigationUtils {
    /**
     * Faz zoom para uma feature com padding contextual
     * @param {Object} feature - Feature GeoJSON
     * @param {Object} mapInstance - Instância do mapa
     * @param {Object} options - Opções de zoom
     */
    static async zoomToFeature(feature, mapInstance, options = {}) {
        if (!feature?.geometry) {
            console.warn('Feature inválida para zoom');
            return;
        }
        
        const {
            paddingPercent = 0.2, // 20% de padding da bbox
            minZoom = 10,
            maxZoom = 18,
            duration = 800
        } = options;
        
        try {
            // Detectar se deve usar selectionBox
            const useSelectionBox = this._shouldUseSelectionBox(feature);
            const geometryToUse = useSelectionBox ? feature.properties.selectionBox : feature.geometry;
            
            switch (geometryToUse.type) {
                case 'Point':
                    await this._zoomToPoint(geometryToUse.coordinates, mapInstance, {
                        minZoom: Math.max(mapInstance.getZoom(), 15),
                        duration
                    });
                    break;
                    
                case 'LineString':
                case 'Polygon':
                case 'MultiLineString':
                case 'MultiPolygon':
                    await this._zoomToBounds(geometryToUse, mapInstance, {
                        paddingPercent,
                        minZoom,
                        maxZoom,
                        duration
                    });
                    break;
                    
                default:
                    console.warn('Tipo de geometria não suportado:', geometryToUse.type);
            }
        } catch (error) {
            console.error('Erro ao fazer zoom para feature:', error);
        }
    }

    /**
     * Determina se deve usar selectionBox em vez da geometria principal
     * @param {Object} feature - Feature GeoJSON
     * @returns {boolean} True se deve usar selectionBox
     */
    static _shouldUseSelectionBox(feature) {
        // Tipos que têm selectionBox pré-calculado
        const selectionBoxTypes = ['text', 'image', 'military_symbol'];
        const featureType = feature.properties?.source;
        const hasSelectionBox = feature.properties?.selectionBox?.type === 'Polygon';
        return selectionBoxTypes.includes(featureType) && hasSelectionBox;
    }

    /**
     * Faz zoom para um ponto específico
     */
    static async _zoomToPoint(coordinates, mapInstance, options) {
        return new Promise((resolve) => {
            mapInstance.flyTo({
                center: coordinates,
                zoom: options.minZoom,
                duration: options.duration
            });
            
            // Resolve quando a animação terminar
            setTimeout(resolve, options.duration);
        });
    }

    /**
     * Faz zoom para bounds de uma geometria
     */
    static async _zoomToBounds(geometry, mapInstance, options) {
        const coordinates = this.extractAllCoordinates(geometry);
        
        if (coordinates.length === 0) {
            console.warn('Nenhuma coordenada encontrada na geometria');
            return;
        }

        const bounds = new maplibregl.LngLatBounds();
        coordinates.forEach(coord => bounds.extend(coord));
        
        if (bounds.isEmpty()) {
            console.warn('Bounds vazio para feature');
            return;
        }

        // Calcular padding baseado no tamanho da bbox
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const width = Math.abs(ne.lng - sw.lng);
        const height = Math.abs(ne.lat - sw.lat);
        
        // Padding baseado no maior lado da bbox
        const bboxSize = Math.max(width, height);
        const paddingMeters = this._calculatePaddingFromBbox(bboxSize, options.paddingPercent);

        return new Promise((resolve) => {
            mapInstance.fitBounds(bounds, { 
                padding: paddingMeters,
                duration: options.duration,
                maxZoom: options.maxZoom
            });
            
            // Resolve quando a animação terminar
            setTimeout(resolve, options.duration);
        });
    }

    /**
     * Calcula padding em pixels baseado no tamanho da bbox
     */
    static _calculatePaddingFromBbox(bboxSize, paddingPercent) {
        // Conversão aproximada: graus para pixels (depende do zoom, mas é uma aproximação)
        const basePixelSize = bboxSize * 100000; // Aproximação grosseira
        const padding = Math.max(50, Math.min(200, basePixelSize * paddingPercent));
        return Math.round(padding);
    }

    /**
     * Extrai todas as coordenadas de uma geometria
     * @param {Object} geometry - Geometria GeoJSON
     * @returns {Array} Array de coordenadas [lng, lat]
     */
    static extractAllCoordinates(geometry) {
        const coords = [];
        
        function extract(coordArray) {
            if (Array.isArray(coordArray)) {
                if (typeof coordArray[0] === 'number' && coordArray.length >= 2) {
                    // É uma coordenada [lng, lat]
                    coords.push(coordArray);
                } else {
                    // É um array de coordenadas ou sub-arrays
                    coordArray.forEach(extract);
                }
            }
        }
        
        extract(geometry.coordinates);
        return coords;
    }

    /**
     * Obtém o ponto central de uma feature
     * @param {Object} feature - Feature GeoJSON
     * @returns {Array|null} Coordenadas [lng, lat] do centro ou null
     */
    static getFeatureCenterPoint(feature) {
        if (!feature?.geometry) return null;

        const geometry = feature.geometry;
        
        switch (geometry.type) {
            case 'Point':
                return geometry.coordinates;
                
            case 'LineString':
            case 'Polygon':
            case 'MultiLineString':
            case 'MultiPolygon':
                const coordinates = this.extractAllCoordinates(geometry);
                if (coordinates.length === 0) return null;
                
                // Calcular centróide simples
                const sumLng = coordinates.reduce((sum, coord) => sum + coord[0], 0);
                const sumLat = coordinates.reduce((sum, coord) => sum + coord[1], 0);
                
                return [sumLng / coordinates.length, sumLat / coordinates.length];
                
            default:
                return null;
        }
    }

    /**
     * Converte tipo de feature do store para tipo do SelectionManager
     */
    static mapFeatureType(storeType) {
        return FEATURE_TYPE_MAPPING[storeType] || storeType;
    }

    /**
     * Integra zoom com seleção de feature
     * @param {Object} feature - Feature para zoom e seleção
     * @param {Object} mapInstance - Instância do mapa
     * @param {Object} selectionManager - Manager de seleção
     * @param {string} featureType - Tipo da feature (formato do store)
     * @param {string} featureId - ID da feature
     */
    static async zoomAndSelectFeature(feature, mapInstance, selectionManager, featureType, featureId) {
        try {
            selectionManager.deselectAllFeatures();

            const selectionManagerType = this.mapFeatureType(featureType);
            selectionManager.selectFeature(selectionManagerType, featureId, feature);

            await this.zoomToFeature(feature, mapInstance, {
                paddingPercent: 0.25, // 25% de padding para bom contexto
                minZoom: 12,
                maxZoom: 18
            });

        } catch (error) {
            console.error('Erro ao fazer zoom e selecionar feature:', error);
        }
    }
}