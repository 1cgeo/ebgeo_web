// Definição dos grupos de camadas por formato
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

// Função para adicionar todas as camadas e fontes ao mapa
export function initFrameLayers(map) {

    map.addSource('moldura_25k', {
        type: 'vector',
        url: 'http://IP:PORT/moldura_25k'
    });

    map.addSource('moldura_50k', {
        type: 'vector',
        url: 'http://IP:PORT/moldura_50k'
    });

    map.addSource('moldura_100k', {
        type: 'vector',
        url: 'http://IP:PORT/moldura_100k'
    });

    map.addSource('moldura_250k', {
        type: 'vector',
        url: 'http://IP:PORT/moldura_250k'
    });

    // 25k
    map.addLayer({
        "id": "moldura_fill_25k",
        "type": "fill",
        "source": "moldura_25k",
        "source-layer": "situacao_25k",
        "paint": {
            "fill-color": [
                "case",
                ["==", ["get", "situacao_topo"], "Concluído"],
                "rgba(145,207,96,0.5)",       // verde translúcido
                ["==", ["get", "situacao_topo"], "Múltiplas edições"],
                "rgba(102,178,255,0.5)",        // azul translúcido
                "rgba(255, 0, 0, 0)"        // vermelho translúcido
            ],
            "fill-outline-color": "rgba(0,0,0,0)"
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "moldura_border_25k",
        "type": "line",
        "source": "moldura_25k",
        "source-layer": "situacao_25k",
        "paint": {
            "line-width": [
                'step', ['length', ['get', 'edicoes_orto']],  0.5,  // Tamanho do array = 0
                8, 5, // Tamanho do array >= 1
                14, 5 // Tamanho do array >= 2
            ],
            "line-color": [
                'step', ['length', ['get', 'edicoes_orto']],  '#121211',  // Tamanho do array = 0
                8, 'rgba(145,207,96,1)', // Tamanho do array >= 1
                14, 'rgba(102,178,255,1)' // Tamanho do array >= 2
            ],
            "line-opacity": 1,
            "line-offset": [
                'step', ['length', ['get', 'edicoes_orto']],  1,  // Tamanho do array = 0
                8, 3.5, // Tamanho do array >= 1
                14, 3.5 // Tamanho do array >= 2
            ]
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "moldura_label_25k",
        "type": "symbol",
        "source": "moldura_25k",
        "source-layer": "situacao_25k",
        "layout": {
            "text-field": [
                "concat",
                "MI ", ["get", "identificadorMI"], "\n",
                "INOM ", ["get", "identificadorINOM"],
                "\n",
                [
                    "case",
                    [">", ["length", ["get", "edicoes_topo"]], 0],
                    ["slice", ["get", "edicoes_topo"], 2, 6],
                    ""
                ]
            ],
            "visibility": "none"
        },
        "paint": {
        },
        "minzoom": 9.5,
        "maxzoom": 17
    });

    // 50k
    map.addLayer({
        "id": "moldura_fill_50k",
        "type": "fill",
        "source": "moldura_50k",
        "source-layer": "situacao_50k",
        "paint": {
            "fill-color": [
                "case",
                ["==", ["get", "situacao_topo"], "Concluído"],
                "rgba(145,207,96,0.5)",       // verde translúcido
                ["==", ["get", "situacao_topo"], "Múltiplas edições"],
                "rgba(102,178,255,0.5)",        // azul translúcido
                "rgba(255, 0, 0, 0)"        // vermelho translúcido
            ],
            "fill-outline-color": "rgba(0,0,0,0)"
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "moldura_border_50k",
        "type": "line",
        "source": "moldura_50k",
        "source-layer": "situacao_50k",
        "paint": {
            "line-width": [
                'step', ['length', ['get', 'edicoes_orto']],  0.5,  // Tamanho do array = 0
                8, 5, // Tamanho do array >= 1
                14, 5 // Tamanho do array >= 2
            ],
            "line-color": [
                'step', ['length', ['get', 'edicoes_orto']],  '#121211',  // Tamanho do array = 0
                8, 'rgba(145,207,96,1)', // Tamanho do array >= 1
                14, 'rgba(102,178,255,1)' // Tamanho do array >= 2
            ],
            "line-opacity": 1,
            "line-offset": [
                'step', ['length', ['get', 'edicoes_orto']],  1,  // Tamanho do array = 0
                8, 3.5, // Tamanho do array >= 1
                14, 3.5 // Tamanho do array >= 2
            ]
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "moldura_label_50k",
        "type": "symbol",
        "source": "moldura_50k",
        "source-layer": "situacao_50k",
        "layout": {
            "text-field": [
                "concat",
                "MI ", ["get", "identificadorMI"], "\n",
                "INOM ", ["get", "identificadorINOM"],
                "\n",
                [
                    "case",
                    [">", ["length", ["get", "edicoes_topo"]], 0],
                    ["slice", ["get", "edicoes_topo"], 2, 6],
                    ""
                ]
            ],
            "visibility": "none"
        },
        "paint": {
        },
        "minzoom": 8.5,
        "maxzoom": 17
    });

    // 100k
    map.addLayer({
        "id": "moldura_fill_100k",
        "type": "fill",
        "source": "moldura_100k",
        "source-layer": "situacao_100k",
        "paint": {
            "fill-color": [
                "case",
                ["==", ["get", "situacao_topo"], "Concluído"],
                "rgba(145,207,96,0.5)",       // verde translúcido
                ["==", ["get", "situacao_topo"], "Múltiplas edições"],
                "rgba(102,178,255,0.5)",        // azul translúcido
                "rgba(255, 0, 0, 0)"        // vermelho translúcido
            ],
            "fill-outline-color": "rgba(0,0,0,0)"
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "moldura_border_100k",
        "type": "line",
        "source": "moldura_100k",
        "source-layer": "situacao_100k",
        "paint": {
            "line-width": [
                'step', ['length', ['get', 'edicoes_orto']],  0.5,  // Tamanho do array = 0
                8, 5, // Tamanho do array >= 1
                14, 5 // Tamanho do array >= 2
            ],
            "line-color": [
                'step', ['length', ['get', 'edicoes_orto']],  '#121211',  // Tamanho do array = 0
                8, 'rgba(145,207,96,1)', // Tamanho do array >= 1
                14, 'rgba(102,178,255,1)' // Tamanho do array >= 2
            ],
            "line-opacity": 1,
            "line-offset": [
                'step', ['length', ['get', 'edicoes_orto']],  1,  // Tamanho do array = 0
                8, 3.5, // Tamanho do array >= 1
                14, 3.5 // Tamanho do array >= 2
            ]
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "moldura_label_100k",
        "type": "symbol",
        "source": "moldura_100k",
        "source-layer": "situacao_100k",
        "layout": {
            "text-field": [
                "concat",
                "MI ", ["get", "identificadorMI"], "\n",
                "INOM ", ["get", "identificadorINOM"],
                "\n",
                [
                    "case",
                    [">", ["length", ["get", "edicoes_topo"]], 0],
                    ["slice", ["get", "edicoes_topo"], 2, 6],
                    ""
                ]
            ],
            "symbol-spacing": 10000,
            "visibility": "none"
        },
        "paint": {
        },
        "minzoom": 7.5,
        "maxzoom": 17
    });

    // 250k
    map.addLayer({
        "id": "moldura_fill_250k",
        "type": "fill",
        "source": "moldura_250k",
        "source-layer": "situacao_250k",
        "paint": {
            "fill-color": [
                "case",
                ["==", ["get", "situacao_topo"], "Concluído"],
                "rgba(145,207,96,0.5)",       // verde translúcido
                ["==", ["get", "situacao_topo"], "Múltiplas edições"],
                "rgba(102,178,255,0.5)",        // azul translúcido
                "rgba(255, 0, 0, 0)"        // vermelho translúcido
            ],
            "fill-outline-color": "rgba(0,0,0,0)"
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "moldura_border_250k",
        "type": "line",
        "source": "moldura_250k",
        "source-layer": "situacao_250k",
        "paint": {
            "line-width": [
                'step', ['length', ['get', 'edicoes_orto']],  0.5,  // Tamanho do array = 0
                8, 5, // Tamanho do array >= 1
                14, 5 // Tamanho do array >= 2
            ],
            "line-color": [
                'step', ['length', ['get', 'edicoes_orto']],  '#121211',  // Tamanho do array = 0
                8, 'rgba(145,207,96,1)', // Tamanho do array >= 1
                14, 'rgba(102,178,255,1)' // Tamanho do array >= 2
            ],
            "line-opacity": 1,
            "line-offset": [
                'step', ['length', ['get', 'edicoes_orto']],  1,  // Tamanho do array = 0
                8, 3.5, // Tamanho do array >= 1
                14, 3.5 // Tamanho do array >= 2
            ]
        },
        "layout": {
            "visibility": "none"
        },
        "minzoom": 5,
        "maxzoom": 17
    });

    map.addLayer({
        "id": "moldura_label_250k",
        "type": "symbol",
        "source": "moldura_250k",
        "source-layer": "situacao_250k",
        "layout": {
            "text-field": [
                "concat",
                "MI ", ["get", "identificadorMI"], "\n",
                "INOM ", ["get", "identificadorINOM"],
                "\n",
                [
                    "case",
                    [">", ["length", ["get", "edicoes_topo"]], 0],
                    ["slice", ["get", "edicoes_topo"], 2, 6],
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
