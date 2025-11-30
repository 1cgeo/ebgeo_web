// Path: js/controls_sig/baselayers/imagens_layer.js
export default {
    "version": 8,
    "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    "sources": {
        "satellite": {
            "type": "raster",
            "tiles": [
                "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
                "https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
                "https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
            ],
            "tileSize": 256,
            "attribution": "&copy; Google",
            "maxzoom": 20
        }
    },
    "layers": [
        {
            "id": "satellite",
            "type": "raster",
            "source": "satellite"
        }
    ]
}
