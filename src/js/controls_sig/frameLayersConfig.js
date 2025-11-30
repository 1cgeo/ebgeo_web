// Path: src/js/controls_sig/frameLayersConfig.js
export const FRAME_LAYERS = {
  scale_25k: [
    'moldura_fill_25k',
    'moldura_border_25k',
    'moldura_label_25k'
  ],
  scale_50k: [
    'moldura_fill_50k',
    'moldura_border_50k',
    'moldura_label_50k'
  ],
  scale_100k: [
    'moldura_fill_100k',
    'moldura_border_100k',
    'moldura_label_100k'
  ],
  scale_250k: [
    'moldura_fill_250k',
    'moldura_border_250k',
    'moldura_label_250k'
  ],
};

/**
 * Initializes all frame layers and sources on the map
 * @param {Object} map - MapLibre map instance
 */
export function initFrameLayers(map) {

    if (!map.getSource('moldura_25k')){
        map.addSource('moldura_25k', {
            type: 'vector',
            url: 'http://IP:PORT/moldura_25k'
        });
    }

    if (!map.getSource('moldura_ponto_25k')){
        map.addSource('moldura_ponto_25k', {
            type: 'vector',
            url: 'http://IP:PORT/moldura_ponto_25k'
        });
    }

    if (!map.getSource('moldura_50k')){
        map.addSource('moldura_50k', {
            type: 'vector',
            url: 'http://IP:PORT/moldura_50k'
        });
    }

    if (!map.getSource('moldura_ponto_50k')){
        map.addSource('moldura_ponto_50k', {
            type: 'vector',
            url: 'http://IP:PORT/moldura_ponto_50k'
        });
    }

    if (!map.getSource('moldura_100k')){
        map.addSource('moldura_100k', {
            type: 'vector',
            url: 'http://IP:PORT/moldura_100k'
        });
    }

    if (!map.getSource('moldura_ponto_100k')){
        map.addSource('moldura_ponto_100k', {
            type: 'vector',
            url: 'http://IP:PORT/moldura_ponto_100k'
        });
    }

    if (!map.getSource('moldura_250k')){
        map.addSource('moldura_250k', {
            type: 'vector',
            url: 'http://IP:PORT/moldura_250k'
        });
    }

    if (!map.getSource('moldura_ponto_250k')){
        map.addSource('moldura_ponto_250k', {
            type: 'vector',
            url: 'http://IP:PORT/moldura_ponto_250k'
        });
    }

    // 25k

    if (!map.getLayer("moldura_fill_25k")){
    map.addLayer({
        "id": "moldura_fill_25k",
        "type": "fill",
        "source": "moldura_25k",
        "source-layer": "situacao_25k",
        "paint": {
            "fill-color": [
                "case",
                ["==", ["get", "situacao_topo"], "Concluído"],
                "rgba(145,207,96,0.5)",
                ["==", ["get", "situacao_topo"], "Múltiplas edições"],
                "rgba(102,178,255,0.5)",
                "rgba(255, 0, 0, 0)"
            ],
            "fill-outline-color": "rgba(0,0,0,0)"
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });
    }


    if (!map.getLayer("moldura_border_25k")){
    map.addLayer({
        "id": "moldura_border_25k",
        "type": "line",
        "source": "moldura_25k",
        "source-layer": "situacao_25k",
        "paint": {
            "line-width": [
                'step', ['length', ['get', 'edicoes_orto']],  0.5,
                8, 5,
                14, 5
            ],
            "line-color": [
                'step', ['length', ['get', 'edicoes_orto']],  '#aaaaaaff',
                8, 'rgba(145,207,96,1)',
                14, 'rgba(102,178,255,1)'
            ],
            "line-opacity": 1,
            "line-offset": [
                'step', ['length', ['get', 'edicoes_orto']],  1,
                8, 3.5,
                14, 3.5
            ]
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });
    }


    if (!map.getLayer("moldura_label_25k")){
    map.addLayer({
        "id": "moldura_label_25k",
        "type": "symbol",
        "source": "moldura_ponto_25k",
        "source-layer": "situacao_ponto_25k",
        "layout": {
            "text-field": [
                "concat",
                "MI ", ["get", "identificadorMI"], "\n",
                "INOM ", ["get", "identificadorINOM"],
                "\n",
                [
                    "case",
                    [">", ["length", ["get", "edicoes_topo"]], 0],
                    ["slice", ["get", "edicoes_topo"], 0, 4],
                    ""
                ]
            ],
            "visibility": "none"
        },
        "paint": {
        },
        "minzoom": 9.8,
        "maxzoom": 17
    });

    }
    // 50k

    if (!map.getLayer("moldura_fill_50k")){
    map.addLayer({
        "id": "moldura_fill_50k",
        "type": "fill",
        "source": "moldura_50k",
        "source-layer": "situacao_50k",
        "paint": {
            "fill-color": [
                "case",
                ["==", ["get", "situacao_topo"], "Concluído"],
                "rgba(145,207,96,0.5)",
                ["==", ["get", "situacao_topo"], "Múltiplas edições"],
                "rgba(102,178,255,0.5)",
                "rgba(255, 0, 0, 0)"
            ],
            "fill-outline-color": "rgba(0,0,0,0)"
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });
    }


    if (!map.getLayer("moldura_border_50k")){
    map.addLayer({
        "id": "moldura_border_50k",
        "type": "line",
        "source": "moldura_50k",
        "source-layer": "situacao_50k",
        "paint": {
            "line-width": [
                'step', ['length', ['get', 'edicoes_orto']],  0.5,
                8, 5,
                14, 5
            ],
            "line-color": [
                'step', ['length', ['get', 'edicoes_orto']],  '#aaaaaaff',
                8, 'rgba(145,207,96,1)',
                14, 'rgba(102,178,255,1)'
            ],
            "line-opacity": 1,
            "line-offset": [
                'step', ['length', ['get', 'edicoes_orto']],  1,
                8, 3.5,
                14, 3.5
            ]
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });
    }


    if (!map.getLayer("moldura_label_50k")){
    map.addLayer({
        "id": "moldura_label_50k",
        "type": "symbol",
        "source": "moldura_ponto_50k",
        "source-layer": "situacao_ponto_50k",
        "layout": {
            "text-field": [
                "concat",
                "MI ", ["get", "identificadorMI"], "\n",
                "INOM ", ["get", "identificadorINOM"],
                "\n",
                [
                    "case",
                    [">", ["length", ["get", "edicoes_topo"]], 0],
                    ["slice", ["get", "edicoes_topo"], 0, 4],
                    ""
                ]
            ],
            "visibility": "none"
        },
        "paint": {
        },
        "minzoom": 8.8,
        "maxzoom": 17
    });

    }
    // 100k

    if (!map.getLayer("moldura_fill_100k")){
    map.addLayer({
        "id": "moldura_fill_100k",
        "type": "fill",
        "source": "moldura_100k",
        "source-layer": "situacao_100k",
        "paint": {
            "fill-color": [
                "case",
                ["==", ["get", "situacao_topo"], "Concluído"],
                "rgba(145,207,96,0.5)",
                ["==", ["get", "situacao_topo"], "Múltiplas edições"],
                "rgba(102,178,255,0.5)",
                "rgba(255, 0, 0, 0)"
            ],
            "fill-outline-color": "rgba(0,0,0,0)"
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });
    }


    if (!map.getLayer("moldura_border_100k")){
    map.addLayer({
        "id": "moldura_border_100k",
        "type": "line",
        "source": "moldura_100k",
        "source-layer": "situacao_100k",
        "paint": {
            "line-width": [
                'step', ['length', ['get', 'edicoes_orto']],  0.5,
                8, 5,
                14, 5
            ],
            "line-color": [
                'step', ['length', ['get', 'edicoes_orto']],  '#aaaaaaff',
                8, 'rgba(145,207,96,1)',
                14, 'rgba(102,178,255,1)'
            ],
            "line-opacity": 1,
            "line-offset": [
                'step', ['length', ['get', 'edicoes_orto']],  1,
                8, 3.5,
                14, 3.5
            ]
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });
    }


    if (!map.getLayer("moldura_label_100k")){
    map.addLayer({
        "id": "moldura_label_100k",
        "type": "symbol",
        "source": "moldura_ponto_100k",
        "source-layer": "situacao_ponto_100k",
        "layout": {
            "text-field": [
                "concat",
                "MI ", ["get", "identificadorMI"], "\n",
                "INOM ", ["get", "identificadorINOM"],
                "\n",
                [
                    "case",
                    [">", ["length", ["get", "edicoes_topo"]], 0],
                    ["slice", ["get", "edicoes_topo"], 0, 4],
                    ""
                ]
            ],
            // "symbol-spacing": 1,
            "visibility": "none",
            "text-allow-overlap": true
        },
        "paint": {
        },
        "minzoom": 7.8,
        "maxzoom": 17
    });

    }
    // 250k

    if (!map.getLayer("moldura_fill_250k")){
    map.addLayer({
        "id": "moldura_fill_250k",
        "type": "fill",
        "source": "moldura_250k",
        "source-layer": "situacao_250k",
        "paint": {
            "fill-color": [
                "case",
                ["==", ["get", "situacao_topo"], "Concluído"],
                "rgba(145,207,96,0.5)",
                ["==", ["get", "situacao_topo"], "Múltiplas edições"],
                "rgba(102,178,255,0.5)",
                "rgba(255, 0, 0, 0)"
            ],
            "fill-outline-color": "rgba(0,0,0,0)"
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });
    }


    if (!map.getLayer("moldura_border_250k")){
    map.addLayer({
        "id": "moldura_border_250k",
        "type": "line",
        "source": "moldura_250k",
        "source-layer": "situacao_250k",
        "paint": {
            "line-width": [
                'step', ['length', ['get', 'edicoes_orto']],  0.5,
                8, 5,
                14, 5
            ],
            "line-color": [
                'step', ['length', ['get', 'edicoes_orto']],  '#aaaaaaff',
                8, 'rgba(145,207,96,1)',
                14, 'rgba(102,178,255,1)'
            ],
            "line-opacity": 1,
            "line-offset": [
                'step', ['length', ['get', 'edicoes_orto']],  1,
                8, 3.5,
                14, 3.5
            ]
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });
    }


    if (!map.getLayer("moldura_label_250k")){
    map.addLayer({
        "id": "moldura_label_250k",
        "type": "symbol",
        "source": "moldura_ponto_250k",
        "source-layer": "situacao_ponto_250k",
        "layout": {
            "text-field": [
                "concat",
                "MI ", ["get", "identificadorMI"], "\n",
                "INOM ", ["get", "identificadorINOM"],
                "\n",
                [
                    "case",
                    [">", ["length", ["get", "edicoes_topo"]], 0],
                    ["slice", ["get", "edicoes_topo"], 0, 4],
                    ""
                ]
            ],
            "visibility": "none"
        },
        "paint": {
        },
        "minzoom": 6,
        "maxzoom": 17
    });
    }

}
