// Path: js\config.js
const config = {
  app: {
    title: "EBGeo Op. Arandu",
    subtitle: "Op. Arandu"
  },

  search: {
    apiUrl: "http://localhost:3000/busca"
  },

  map2d: {
    bounds: [
      [-44.4633992903047, -22.46265178239199],
      [-44.439695820515325, -22.444666254876367]
    ],
    minZoom: 1,
    maxZoom: 17.9,
    maxPitch: 65,
    //maxBounds: [
    //  [-45.82515, -22.69950],
    //  [-43.92333, -21.30216]
    //],
    sourceTileLodParams: [5, 6.0]
  },

  map3d: {
    bounds: {
      west: -44.449656,
      south: -22.455922,
      east: -44.449654,
      north: -22.455920
    },
    initialCamera: {
      longitude: -44.4481491,
      latitude: -22.4546061,
      height: 424.7,
      heading: 164,
      pitch: -2,
      roll: -1
    },
    viewer: {
      infoBox: false,
      shouldAnimate: false,
      vrButton: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: true,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity
    }
  },

  tilesets: [
    {
      url: "/3d/PCL/tileset.json",
      heightOffset: 35,
      id: "PCL",
      name: "PCL",
      locate: { lon: -44.47332385414955, lat: -22.43976556982974, height: 1000 }
    }
  ]
};

config.hasTilesets = () => config.tilesets && config.tilesets.length > 0;

config.getDefaultTileset = () => config.tilesets.find(t => t.default) || config.tilesets[0];

export default config;