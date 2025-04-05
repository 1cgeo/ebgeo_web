// Path: js\controls_sig\draw_tool\draw_styles.js
export default [
    // PONTO ATIVO
    {
        'id': 'gl-draw-point-active',
        'type': 'circle',
        'filter': ['all',
            ['==', 'active', 'true'],
            ['==', '$type', 'Point'],
            ['==', 'meta', 'feature']
        ],
        'paint': {
            'circle-radius': ['coalesce', ['get', 'user_size'], 7],
            'circle-color': ['coalesce', ['get', 'user_color'], '#404040'],
            'circle-opacity': ['coalesce', ['get', 'user_opacity'], 0.5]
        }
    },
    // PONTO INATIVO
    {
        'id': 'gl-draw-point-inactive',
        'type': 'circle',
        'filter': ['all',
            ['==', 'active', 'false'],
            ['==', '$type', 'Point'],
            ['==', 'meta', 'feature']
        ],
        'paint': {
            'circle-radius': ['coalesce', ['get', 'user_size'], 7],
            'circle-color': ['coalesce', ['get', 'user_color'], '#3bb2d0'],
            'circle-opacity': ['coalesce', ['get', 'user_opacity'], 0.5]
        }
    },
    // LINHA ATIVO
    {
        'id': 'gl-draw-line-active',
        'type': 'line',
        'filter': ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
        'layout': {
            'line-cap': 'round',
            'line-join': 'round'
        },
        'paint': {
            'line-color': ['coalesce', ['get', 'user_color'], '#fbb03b'],
            'line-opacity': ['coalesce', ['get', 'user_opacity'], 0.5],
            'line-width': ['coalesce', ['get', 'user_size'], 4]
        }
    },
    // LINHA INATIVO
    {
        'id': 'gl-draw-line-inactive',
        'type': 'line',
        'filter': ['all', ['==', 'active', 'false'],
            ['==', '$type', 'LineString']
        ],
        'layout': {
            'line-cap': 'round',
            'line-join': 'round'
        },
        'paint': {
            'line-color': ['coalesce', ['get', 'user_color'], '#3bb2d0'],
            'line-opacity': ['coalesce', ['get', 'user_opacity'], 0.5],
            'line-width': ['coalesce', ['get', 'user_size'], 4]
        }
    },
    // POLIGONO ATIVO
    {
        'id': 'gl-draw-polygon-fill-active',
        'type': 'fill',
        'filter': ['all', ['==', '$type', 'Polygon'], ['==', 'active', 'true']],
        'paint': {
            'fill-color': ['coalesce', ['get', 'user_color'],'#fbb03b'],
            'fill-opacity': ['coalesce', ['get', 'user_opacity'], 0.5],
            'fill-outline-color': '#fbb03b'
        }
    },
    {
        'id': 'gl-draw-polygon-stroke-active',
        'type': 'line',
        'filter': ['all', ['==', '$type', 'Polygon'], ['==', 'active', 'true']],
        'layout': {
            'line-cap': 'round',
            'line-join': 'round'
        },
        'paint': {
            'line-color': ['coalesce', ['get', 'user_outlinecolor'],'#fbb03b'],
            'line-opacity': ['coalesce', ['get', 'user_opacity'], 0.5],
            'line-width': ['coalesce', ['get', 'user_size'],3]
        }
    },

    // POLIGONO INATIVO
    {
        'id': 'gl-draw-polygon-fill-inactive',
        'type': 'fill',
        'filter': ['all', ['==', 'active', 'false'],
            ['==', '$type', 'Polygon']
        ],
        'paint': {
            'fill-color': ['coalesce', ['get', 'user_color'],'#3bb2d0'],
            'fill-opacity': ['coalesce', ['get', 'user_opacity'],0.5],
            'fill-outline-color': '#3bb2d0'
        }
    },
    {
        'id': 'gl-draw-polygon-stroke-inactive',
        'type': 'line',
        'filter': ['all', ['==', 'active', 'false'],
            ['==', '$type', 'Polygon']
        ],
        'layout': {
            'line-cap': 'round',
            'line-join': 'round'
        },
        'paint': {
            'line-color': ['coalesce', ['get', 'user_outlinecolor'],'#3bb2d0'],
            'line-opacity': ['coalesce', ['get', 'user_opacity'],0.5],
            'line-width': ['coalesce', ['get', 'user_size'],3]
        }
    },

    // VERTICES
    {
        'id': 'gl-draw-polygon-midpoint-active',
        'type': 'circle',
        'filter': ['all', ['==', '$type', 'Point'],
            ['==', 'meta', 'midpoint']
        ],
        'paint': {
            'circle-radius': 5,
            'circle-color': '#d15454'
        }
    },
    {
        'id': 'gl-draw-polygon-and-line-vertex-active',
        'type': 'circle',
        'filter': ['all', ['==', 'meta', 'vertex'],
            ['==', '$type', 'Point']],
        'paint': {
            'circle-radius': 7,
            'circle-color': '#fff'
        }
    },
    {
        'id': 'gl-draw-polygon-and-line-vertex-halo-active',
        'type': 'circle',
        'filter': ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
        'paint': {
            'circle-radius': 5,
            'circle-color': "#D20C0C"
        }
    }

];
