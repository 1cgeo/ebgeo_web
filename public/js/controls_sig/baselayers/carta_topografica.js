// Path: js\controls_sig\baselayers\carta_topografica.js
export default {
    "version": 8,
    "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    "sources": {
        "osm": {
            "type": "raster",
            "tiles": ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
            "tileSize": 256,
            "attribution": "&copy; OpenStreetMap Contributors",
            "maxzoom": 19
        },
        "terrainSource": {
            "type": 'raster-dem',
            "url": 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',
            "tileSize": 256
        },
    },
    "layers": [
        {
            "id": "osm",
            "type": "raster",
            "source": "osm"
        }
    ],
    "terrain": {
        "source": 'terrainSource',
        "exaggeration": 1
    }
}