// public/js/map.js
import 'https://unpkg.com/maplibre-gl/dist/maplibre-gl.js';

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/style.json',
    center: [-74.5, 40],
    zoom: 9,
});

export { map };
