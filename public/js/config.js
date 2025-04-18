// Path: js\config.js
// Main configuration file for EBGEO application
const config = {
    // Application settings
    app: {
        title: "EBGeo Op Fogo",
        subtitle: "Op Fogo",
    },
    // 3D Map Configuration
    map3d: {
        // Initial map extent
        defaultExtent: {
            west: -44.449656,
            south: -22.455922,
            east: -44.449654,
            north: -22.455920
        },
        // Viewer configuration
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
            fullscreenButton: false
        },
        // Default camera position
        defaultCamera: {
            position: {
                longitude: -44.4481491,
                latitude: -22.4546061,
                height: 424.7
            },
            heading: 164,
            pitch: -2,
            roll: -1
        },
        // 3D models configuration
        tilesets: [
            {
                url: "/3d/AMAN/tileset.json",
                heightOffset: 50, // -360 for ellipsoid, 40 for terrain
                id: "AMAN",
                default: true,
                maximumScreenSpaceError: 16,
                locate: {
                    lat: -22.455921,
                    lon: -44.449655,
                    height: 2200
                },
                title: "AMAN" // Title to display on buttons
            },
            {
                url: "/3d/ESA/tileset.json",
                heightOffset: 75,
                id: "ESA",
                maximumScreenSpaceError: 12,
                locate: {
                    lon: -45.25666459926732,
                    lat: -21.703613735103637,
                    height: 1500
                },
                title: "ESA" // Title to display on buttons
            },
            {
                url: "/3d/PCL/tileset.json",
                heightOffset: 35,
                id: "PCL",
                maximumScreenSpaceError: 14,
                locate: {
                    lon: -44.47332385414955,
                    lat: -22.43976556982974,
                    height: 1000
                },
                title: "AMAN PCL" // Title to display on buttons
            }
        ],
        // Identify tool configuration
        identifyTool: {
            apiUrl: "http://localhost:3000/feicoes"
        },
        // Viewshed tool configuration
        viewshed: {
            horizontalAngle: 150,
            verticalAngle: 120,
            distance: 10
        }
    },
    
    // 2D SIG Map Configuration
    mapSig: {
        // Map initialization
        mapInit: {
            minZoom: 11,
            maxZoom: 17.9,
            maxPitch: 65,
            bounds: [
                [-45.82515, -22.69950],
                [-43.92333, -21.30216]
            ],
            initialView: {
                bounds: [
                    [-44.4633992903047, -22.46265178239199],
                    [-44.439695820515325, -22.444666254876367]
                ]
            }
        },
        // Feature search API
        featureSearch: {
            apiUrl: "http://localhost:3000/busca"
        },
        // Terrain settings
        terrain: {
            elevationAdjustmentFactor: 1.5
        }
    }
};

export default config;