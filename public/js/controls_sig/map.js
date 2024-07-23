import { getCurrentMapFeatures } from './store.js';
import '../../vendors/maplibre-gl.js';

const map = new maplibregl.Map({
    container: 'map-sig',
    style: {
        version: 8,
        center: [-44.451547555410016, -22.453659018634177],
        zoom: 14,
        "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap Contributors',
                maxzoom: 19
            },
            // Use a different source for terrain and hillshade layers, to improve render quality
            terrainSource: {
                type: 'raster-dem',
                url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',
                tileSize: 256
            },
            hillshadeSource: {
                type: 'raster-dem',
                url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',
                tileSize: 256
            }
        },
        layers: [
            {
                id: 'osm',
                type: 'raster',
                source: 'osm'
            },
            {
                id: 'hills',
                type: 'hillshade',
                source: 'hillshadeSource',
                layout: {visibility: 'visible'},
                paint: {'hillshade-shadow-color': '#473B24'}
            }
        ],
        terrain: {
            source: 'terrainSource',
            exaggeration: 1
        },
        sky: {}
    },
  
    attributionControl: false
});

map.addControl(new maplibregl.AttributionControl({
    customAttribution: 'Diretoria de Serviço Geográfico - Exército Brasileiro',
    compact: true
}), 'bottom-right');

map.on('styledata', () => { 
    const features = getCurrentMapFeatures();

    if (!map.getSource('texts')) {
        map.addSource('texts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.texts
            }
        });
    }

    if (!map.getLayer('text-layer')) {
        map.addLayer({
            id: 'text-layer',
            type: 'symbol',
            source: 'texts',
            layout: {
                'text-field': ['get', 'text'],
                'text-size': ['get', 'size'],
                'text-justify': 'center',
                'text-anchor': 'center',
                'text-rotate': ['get', 'rotation'],
            },
            paint: {
                'text-color': ['get', 'color'],
                'text-halo-color': ['get', 'backgroundColor'],
                'text-halo-width': 2
            }
        });
    }

    // Check if the 'images' source and layer exist before adding them
    if (!map.getSource('images')) {
        map.addSource('images', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.images
            }
        });
    }

    if (!map.getLayer('image-layer')) {
        map.addLayer({
            id: 'image-layer',
            type: 'symbol',
            source: 'images',
            layout: {
                'icon-image': ['get', 'imageId'],
                'icon-size': ['get', 'size'],
                'icon-rotate': ['get', 'rotation'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });
    }

    // Check if the 'highlighted_bbox' source and layer exist before adding them
    if (!map.getSource('highlighted_bbox')) {
        map.addSource('highlighted_bbox', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.images
            }
        });
    }

    if (!map.getLayer('highlighted_bbox-layer')) {
        map.addLayer({
            id: 'highlighted_bbox-layer',
            type: 'line',
            source: 'highlighted_bbox',
            layout: {},
            paint: {
              'line-color': '#ff0000',
              'line-width': 2
            }
        });
    }

    if (!map.getLayer('selection-boxes')) {
        map.addLayer({
            id: 'selection-boxes',
            type: 'line',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            },
            paint: {
                'line-color': '#FF0000',
                'line-width': 2
            }
        });
    }

});

//FIT AMAN
map.fitBounds([
    [-44.4633992903047, -22.46265178239199],
    [-44.439695820515325, -22.444666254876367]
]);

export { map };
