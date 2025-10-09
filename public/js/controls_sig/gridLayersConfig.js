// Definição dos grupos de camadas por formato
export const GRID_LAYERS = {
  latlong: [
    'grid_vertical_4326_25k',
    'grid_label_vertical_25k',
    'grid_horizontal_4326_25k',
    'grid_label_horizontal_25k',
    'grid_vertical_4326_50k',
    'grid_label_vertical_50k',
    'grid_horizontal_4326_50k',
    'grid_label_horizontal_50k',
    'grid_vertical_4326_100k',
    'grid_label_vertical_100k',
    'grid_horizontal_4326_100k',
    'grid_label_horizontal_100k',
    'grid_vertical_4326_250k',
    'grid_label_vertical_250k',
    'grid_horizontal_4326_250k',
    'grid_label_horizontal_250k'
  ],
  utm: [
    'grid_vertical_utm_25k',
    'grid_label_vertical_utm_25k',
    'grid_horizontal_utm_25k',
    'grid_label_horizontal_utm_25k',
    'grid_vertical_utm_50k',
    'grid_label_vertical_utm_50k',
    'grid_horizontal_utm_50k',
    'grid_label_horizontal_utm_50k',
    'grid_vertical_utm_100k',
    'grid_label_vertical_utm_100k',
    'grid_horizontal_utm_100k',
    'grid_label_horizontal_utm_100k',
    'grid_vertical_utm_250k',
    'grid_label_vertical_utm_250k',
    'grid_horizontal_utm_250k',
    'grid_label_horizontal_utm_250k'
  ]
};

// Função para adicionar todas as camadas e fontes ao mapa
export function initGridLayers(map) {

    map.addSource('grid_4326_25k', {
        type: 'vector',
        url: 'http://IP:PORT:4000/grid_4326_25k'
    });

    map.addSource('grid_utm_25k', {
        type: 'vector',
        url: 'http://IP:PORT:4000/grid_utm_25k'
    });

    map.addSource('grid_4326_50k', {
        type: 'vector',
        url: 'http://IP:PORT:4000/grid_4326_50k'
    });

    map.addSource('grid_utm_50k', {
        type: 'vector',
        url: 'http://IP:PORT:4000/grid_utm_50k'
    });

    map.addSource('grid_4326_100k', {
        type: 'vector',
        url: 'http://IP:PORT:4000/grid_4326_100k'
    });

    map.addSource('grid_utm_100k', {
        type: 'vector',
        url: 'http://IP:PORT:4000/grid_utm_100k'
    });

    map.addSource('grid_4326_250k', {
        type: 'vector',
        url: 'http://IP:PORT:4000/grid_4326_250k'
    });

    map.addSource('grid_utm_250k', {
        type: 'vector',
        url: 'http://IP:PORT:4000/grid_utm_250k'
    });

    // Grid 4326 (latlong)
    map.addLayer({
        "id": "grid_vertical_4326_25k",
        "type": "line",
        "source": "grid_4326_25k",
        "source-layer": "grid_linha_4326_vertical_25k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 14,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "grid_label_vertical_25k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_4326_25k",
        "source-layer": "grid_linha_4326_vertical_25k",
        "layout": {
            "text-field": "{right}",
            "symbol-placement": "line",
            "symbol-spacing": 700,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 14,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "grid_horizontal_4326_25k",
        "type": "line",
        "source": "grid_4326_25k",
        "source-layer": "grid_linha_4326_horizontal_25k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 14,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "grid_label_horizontal_25k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_4326_25k",
        "source-layer": "grid_linha_4326_horizontal_25k",
        "layout": {
            "text-field": "{top}",
            "symbol-placement": "line",
            "symbol-spacing": 750,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 14,
        "maxzoom": 17
    });

    // Grid UTM
    map.addLayer({
        "id": "grid_vertical_utm_25k",
        "type": "line",
        "source": "grid_utm_25k",
        "source-layer": "grid_linha_utm_vertical_25k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 14,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "grid_label_vertical_utm_25k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_utm_25k",
        "source-layer": "grid_linha_utm_vertical_25k",
        "layout": {
            "text-field": "{right}",
            "symbol-placement": "line",
            "symbol-spacing": 700,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 14,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "grid_horizontal_utm_25k",
        "type": "line",
        "source": "grid_utm_25k",
        "source-layer": "grid_linha_utm_horizontal_25k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 14,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "grid_label_horizontal_utm_25k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_utm_25k",
        "source-layer": "grid_linha_utm_horizontal_25k",
        "layout": {
            "text-field": "{top}",
            "symbol-placement": "line",
            "symbol-spacing": 750,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 14,
        "maxzoom": 17
    });
    // Grid 4326 (latlong)
    map.addLayer({
        "id": "grid_vertical_4326_50k",
        "type": "line",
        "source": "grid_4326_50k",
        "source-layer": "grid_linha_4326_vertical_50k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 13,
        "maxzoom": 14
    });

    map.addLayer({
        "id": "grid_label_vertical_50k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_4326_50k",
        "source-layer": "grid_linha_4326_vertical_50k",
        "layout": {
            "text-field": "{right}",
            "symbol-placement": "line",
            "symbol-spacing": 700,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 13,
        "maxzoom": 14
    });

    map.addLayer({
        "id": "grid_horizontal_4326_50k",
        "type": "line",
        "source": "grid_4326_50k",
        "source-layer": "grid_linha_4326_horizontal_50k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 13,
        "maxzoom": 14
    });

    map.addLayer({
        "id": "grid_label_horizontal_50k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_4326_50k",
        "source-layer": "grid_linha_4326_horizontal_50k",
        "layout": {
            "text-field": "{top}",
            "symbol-placement": "line",
            "symbol-spacing": 750,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 13,
        "maxzoom": 14
    });

    // Grid UTM
    map.addLayer({
        "id": "grid_vertical_utm_50k",
        "type": "line",
        "source": "grid_utm_50k",
        "source-layer": "grid_linha_utm_vertical_50k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 13,
        "maxzoom": 14
    });

    map.addLayer({
        "id": "grid_label_vertical_utm_50k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_utm_50k",
        "source-layer": "grid_linha_utm_vertical_50k",
        "layout": {
            "text-field": "{right}",
            "symbol-placement": "line",
            "symbol-spacing": 700,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 13,
        "maxzoom": 14
    });

    map.addLayer({
        "id": "grid_horizontal_utm_50k",
        "type": "line",
        "source": "grid_utm_50k",
        "source-layer": "grid_linha_utm_horizontal_50k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 13,
        "maxzoom": 14
    });

    map.addLayer({
        "id": "grid_label_horizontal_utm_50k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_utm_50k",
        "source-layer": "grid_linha_utm_horizontal_50k",
        "layout": {
            "text-field": "{top}",
            "symbol-placement": "line",
            "symbol-spacing": 750,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 13,
        "maxzoom": 14
    });
    // Grid 4326 (latlong)
    map.addLayer({
        "id": "grid_vertical_4326_100k",
        "type": "line",
        "source": "grid_4326_100k",
        "source-layer": "grid_linha_4326_vertical_100k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 12,
        "maxzoom": 13
    });

    map.addLayer({
        "id": "grid_label_vertical_100k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_4326_100k",
        "source-layer": "grid_linha_4326_vertical_100k",
        "layout": {
            "text-field": "{right}",
            "symbol-placement": "line",
            "symbol-spacing": 700,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 12,
        "maxzoom": 13
    });

    map.addLayer({
        "id": "grid_horizontal_4326_100k",
        "type": "line",
        "source": "grid_4326_100k",
        "source-layer": "grid_linha_4326_horizontal_100k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 12,
        "maxzoom": 13
    });

    map.addLayer({
        "id": "grid_label_horizontal_100k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_4326_100k",
        "source-layer": "grid_linha_4326_horizontal_100k",
        "layout": {
            "text-field": "{top}",
            "symbol-placement": "line",
            "symbol-spacing": 750,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 12,
        "maxzoom": 13
    });

    // Grid UTM
    map.addLayer({
        "id": "grid_vertical_utm_100k",
        "type": "line",
        "source": "grid_utm_100k",
        "source-layer": "grid_linha_utm_vertical_100k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 12,
        "maxzoom": 13
    });

    map.addLayer({
        "id": "grid_label_vertical_utm_100k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_utm_100k",
        "source-layer": "grid_linha_utm_vertical_100k",
        "layout": {
            "text-field": "{right}",
            "symbol-placement": "line",
            "symbol-spacing": 700,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 12,
        "maxzoom": 13
    });

    map.addLayer({
        "id": "grid_horizontal_utm_100k",
        "type": "line",
        "source": "grid_utm_100k",
        "source-layer": "grid_linha_utm_horizontal_100k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 12,
        "maxzoom": 13
    });

    map.addLayer({
        "id": "grid_label_horizontal_utm_100k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_utm_100k",
        "source-layer": "grid_linha_utm_horizontal_100k",
        "layout": {
            "text-field": "{top}",
            "symbol-placement": "line",
            "symbol-spacing": 750,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 12,
        "maxzoom": 13
    });
    // Grid 4326 (latlong)
    map.addLayer({
        "id": "grid_vertical_4326_250k",
        "type": "line",
        "source": "grid_4326_250k",
        "source-layer": "grid_linha_4326_vertical_250k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 7,
        "maxzoom": 12
    });

    map.addLayer({
        "id": "grid_label_vertical_250k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_4326_250k",
        "source-layer": "grid_linha_4326_vertical_250k",
        "layout": {
            "text-field": "{right}",
            "symbol-placement": "line",
            "symbol-spacing": 700,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 7,
        "maxzoom": 12
    });

    map.addLayer({
        "id": "grid_horizontal_4326_250k",
        "type": "line",
        "source": "grid_4326_250k",
        "source-layer": "grid_linha_4326_horizontal_250k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 7,
        "maxzoom": 12
    });

    map.addLayer({
        "id": "grid_label_horizontal_250k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_4326_250k",
        "source-layer": "grid_linha_4326_horizontal_250k",
        "layout": {
            "text-field": "{top}",
            "symbol-placement": "line",
            "symbol-spacing": 750,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 7,
        "maxzoom": 12
    });

    // Grid UTM
    map.addLayer({
        "id": "grid_vertical_utm_250k",
        "type": "line",
        "source": "grid_utm_250k",
        "source-layer": "grid_linha_utm_vertical_250k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 7,
        "maxzoom": 12
    });

    map.addLayer({
        "id": "grid_label_vertical_utm_250k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_utm_250k",
        "source-layer": "grid_linha_utm_vertical_250k",
        "layout": {
            "text-field": "{right}",
            "symbol-placement": "line",
            "symbol-spacing": 700,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 7,
        "maxzoom": 12
    });

    map.addLayer({
        "id": "grid_horizontal_utm_250k",
        "type": "line",
        "source": "grid_utm_250k",
        "source-layer": "grid_linha_utm_horizontal_250k",
        "layout": {
            "line-cap": "round",
            "line-join": "round",
            "visibility": "none"
        },
        "paint": {
            "line-color": "#241f21",
            "line-width": 1.5
        },
        "minzoom": 7,
        "maxzoom": 12
    });

    map.addLayer({
        "id": "grid_label_horizontal_utm_250k",
        "type": "symbol",
        "metadata": {
            "IHM:overlay": true
        },
        "source": "grid_utm_250k",
        "source-layer": "grid_linha_utm_horizontal_250k",
        "layout": {
            "text-field": "{top}",
            "symbol-placement": "line",
            "symbol-spacing": 750,
            "text-font": ["Noto Sans Bold"],
            "text-size": 16,
            "symbol-avoid-edges": true,
            "text-rotation-alignment": "map",
            "text-letter-spacing": 0.15,
            "text-keep-upright": true,
            "visibility": "none"
        },
        "paint": {
            "text-color": "rgba(0, 0, 0, 1)",
            "text-halo-color": "rgba(255, 255, 255, 0.8)",
            "text-halo-width": 7.5,
            "text-halo-blur": 1.5
        },
        "minzoom": 7,
        "maxzoom": 12
    });
}
