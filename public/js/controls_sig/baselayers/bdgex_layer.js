// Path: js/controls_sig/baselayers/bdgex_layer.js

export default {
    "version": 8,
    "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    "sources": {
        "bdgex": {
            "type": "raster",
            "tiles": [
                "https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ctmmultiescalas_mercator&TILED=true&WIDTH=256&HEIGHT=256&SRS=EPSG%3A3857&STYLES=&BBOX={bbox-epsg-3857}"
            ],
            "tileSize": 256,
            "attribution": "BDGEx - Exército Brasileiro",
            "maxzoom": 18
        }
    },
    "layers": [
        {
            "id": "bdgex",
            "type": "raster",
            "source": "bdgex"
        }
    ]
}
