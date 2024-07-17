import 'https://unpkg.com/@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.js';
import drawStyles from './draw_styles.js';
import { addFeature, updateFeature, removeFeature } from '../store.js';

class DrawControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.defaultProperties = {
            color: '#fbb03b',
            opacity: 0.5,
            size: 3,
            outlinecolor: '#fbb03b',
            measure: false
        };
        this.controlPosition = 'top-right';
    }

    onAdd = (map) => {
        try {
            this.map = map;
            this.container = document.createElement('div');
            this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl draw-control';

            this.draw = new MapboxDraw({
                displayControlsDefault: false,
                userProperties: true,
                controls: {
                    polygon: true,
                    line_string: true,
                    point: true,
                    trash: false
                },
                styles: drawStyles
            });



            this.map.addControl(this.draw, this.controlPosition);

            this.setupEventListeners();

            this.changeButtonColors()
            $('input[name="base-layer"]').on('change', this.changeButtonColors);

            return this.container;
        } catch (error) {
            console.error('Error adding DrawControl:', error);
            throw error;
        }
    }

    changeButtonColors = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        $('.mapbox-gl-draw_point').html(
            `
                <img src="./images/icon_point_${color}.svg" alt="POINT" />
            `
        )

        $('.mapbox-gl-draw_line').html(
            `
                <img src="./images/icon_line_${color}.svg" alt="LINE" />
            `
        )

        $('.mapbox-gl-draw_polygon').html(
            `
                <img src="./images/icon_polygon_${color}.svg" alt="POLYGON" />
            `
        )

        const currentBtn = {
            'draw_point': '.mapbox-gl-draw_point',
            'draw_line_string': '.mapbox-gl-draw_line',
            'draw_polygon': '.mapbox-gl-draw_polygon'
        }[this.draw.getMode()]

        if (!(currentBtn && this.isActive)) return
        const imageName = {
            'draw_point': 'icon_point_',
            'draw_line_string': 'icon_line_',
            'draw_polygon': 'icon_polygon_'
        }[this.draw.getMode()]

        $(currentBtn).html(
            `
                <img src="./images/${imageName}red.svg" />
            `
        )
    }

    onRemove = () => {
        try {
            this.map.removeControl(this.draw);
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing DrawControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        this.map.on('draw.create', this.handleDrawCreate);
        this.map.on('draw.update', this.handleDrawUpdate);
        this.map.on('draw.delete', this.handleDrawDelete);
        this.map.on('draw.modechange', this.handleDrawModeChange);
    }

    removeEventListeners = () => {
        this.map.off('draw.create', this.handleDrawCreate);
        this.map.off('draw.update', this.handleDrawUpdate);
        this.map.off('draw.delete', this.handleDrawDelete);
        this.map.off('draw.modechange', this.handleDrawModeChange);
    }

    handleDrawCreate = (e) => {
        e.features.forEach(f => {
            const properties = { ...this.defaultProperties, ...f.properties };
            f.properties = properties
            Object.keys(properties).forEach(key => {
                this.draw.setFeatureProperty(f.id, key, properties[key]);
            });
            const type = f.geometry.type.toLowerCase() + 's';
            addFeature(type, f);
            this.updateFeatureMeasurement(f);
        });

        this.toolManager.deactivateCurrentTool();
    }

    handleDrawUpdate = (e) => {
        e.features.forEach(f => {
            const type = f.geometry.type.toLowerCase() + 's';
            updateFeature(type, f);
            this.updateFeatureMeasurement(f);
        });

        this.map.on('draw.modechange', (e) => {
            const mode = e.mode;
            if (mode === 'draw_polygon' || mode === 'draw_line_string' || mode === 'draw_point') {
                this.toolManager.setActiveTool(this);
                this.map.getCanvas().style.cursor = 'crosshair';
            } else {
                this.map.getCanvas().style.cursor = '';
            }
        });

        const pixelsToDegrees = (pixels, latitude, zoom) => {
            const earthCircumference = 40075017; // Circunferência da Terra em metros
            const metersPerPixel = earthCircumference * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom + 8);
            const degreesPerMeter = 360 / earthCircumference;
            return pixels * metersPerPixel * degreesPerMeter;
        }

        const calculateBuffer = (feature, zoom, latitude, pixelBuffer) => {
            const bufferSize = pixelsToDegrees(pixelBuffer, latitude, zoom);
            const buffered = turf.buffer(feature, bufferSize, { units: 'degrees' });
            return buffered;
          }

        const updateSelectedBBoxSource = () => {
            const selectedFeatures = this.draw.getSelected().features;
            if (selectedFeatures.length) {
                const zoom = map.getZoom();
                const center = map.getCenter();
                const latitude = center.lat;
                const pixelBuffer = 10;
              
                const boundsFeatures = selectedFeatures.map(feature => calculateBuffer(feature, zoom, latitude, pixelBuffer));
              
                this.map.getSource('highlighted_bbox').setData({
                    type: 'FeatureCollection',
                    features: boundsFeatures
                });
            
            } else {
                this.map.getSource('highlighted_bbox').setData({
                  type: 'FeatureCollection',
                  features: []
                });
            }
        }

        this.map.on('zoomend', updateSelectedBBoxSource);
        this.map.on('draw.render', updateSelectedBBoxSource);

        this.map.on('click', (e) => {
            const features = this.draw.getSelected().features;
            if (features.length > 0) {
                const feature = features[0];
                createFeatureAttributesPanel(feature, this.map, this.defaultProperties);
            } else {
                let panel = document.querySelector('.feature-attributes-panel');
                if (panel) {
                    const saveButton = panel.querySelector('button[id="SalvarFeat"]');
                    if (saveButton) {
                        saveButton.click();
                    }
                    panel.remove();
                }
            }
        });

        return this.container;
    }

    handleDrawDelete = (e) => {
        e.features.forEach(f => {
            this.removeFeatureMeasurement(f.id);
            const type = f.geometry.type.toLowerCase() + 's';
            removeFeature(type, f.id);
        });
    }

    handleDrawModeChange = (e) => {
        const mode = e.mode;
        if (['draw_polygon', 'draw_line_string', 'draw_point'].includes(mode)) {
            this.toolManager.setActiveTool(this);
        }
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColors()
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        $('input[name="base-layer"]').off('change', this.changeButtonColors);
        this.changeButtonColors()
    }

    handleMapClick = () => {
        //nothing to do here
    }

    updateFeaturesProperty = (features, property, value) => {
        features.forEach(feature => {
            feature.properties[property] = value;
            this.draw.setFeatureProperty(feature.id, property, value);
            const feat = this.draw.get(feature.id);
            this.draw.add(feat);
            this.updateFeatureMeasurement(feature);
        });
    }

    updateFeatures = (features, save = false) => {
        features.forEach(feature => {
            Object.keys(feature.properties).forEach(key => {
                this.draw.setFeatureProperty(feature.id, key, feature.properties[key]);
            });
            const feat = this.draw.get(feature.id);
            this.draw.add(feat);
            const type = feat.geometry.type.toLowerCase() + 's';
            if (save) {
                updateFeature(type, feat);
            }
        });
    }

    saveFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                const type = f.geometry.type.toLowerCase() + 's';
                updateFeature(type, f);
            }
        });
    }

    discardChangeFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        this.updateFeatures(features);
    }

    deleteFeatures = (features) => {
        features.forEach(f => {
            this.draw.delete(f.id);
            const type = f.geometry.type.toLowerCase() + 's';
            removeFeature(type, f.id);
        });
    }

    setDefaultProperties = (properties, commonAttributes) => {
        commonAttributes.forEach(attr => {
            this.defaultProperties[attr] = properties[attr];
        });
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.outlinecolor !== initialProperties.outlinecolor
        );
    }
};
export default DrawControl;