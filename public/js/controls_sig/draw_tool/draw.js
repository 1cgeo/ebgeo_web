// Path: js\controls_sig\draw_tool\draw.js
import drawStyles from './draw_styles.js';
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { getTerrainElevation } from '../terrain_control.js';

class DrawControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = null;
        this.isActive = false;
        this.defaultProperties = {
            polygon: {
                color: '#fbb03b',
                opacity: 0.5,
                size: 3,
                outlinecolor: '#fbb03b',
                measure: false,
                profile: false,
                profileData: null,
                source: 'draw',
                customAttributes: {}
            },
            linestring: {
                color: '#fbb03b',
                opacity: 0.7,
                size: 7,
                outlinecolor: '#fbb03b',
                measure: false,
                profile: false,
                profileData: null,
                source: 'draw',
                customAttributes: {}
            },
            point: {
                color: '#fbb03b',
                opacity: 1,
                size: 10,
                outlinecolor: '#fbb03b',
                measure: false,
                profile: false,
                profileData: null,
                source: 'draw',
                customAttributes: {}
            }
        };
        this.controlPosition = 'top-right';
    }

    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
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
                modes: {
                    ...MapboxDraw.modes,
                    simple_select: { ...MapboxDraw.modes.simple_select, dragMove() {} },
                    direct_select: { ...MapboxDraw.modes.direct_select, dragFeature() {} },
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

    handleDrawCreate = async (e) => {
        for (const f of e.features) {
            const geomtype = f.geometry.type.toLowerCase();
            const properties = { ...this.defaultProperties[geomtype], ...f.properties };
            f.properties = properties

            if (geomtype === 'linestring') {
                f.properties.profileData = JSON.stringify(await this.calculateProfile(f.geometry.coordinates));
            }

            Object.keys(properties).forEach(key => {
                this.draw.setFeatureProperty(f.id, key, properties[key]);
            });
            const type = geomtype + 's';



            addFeature(type, f);
            this.updateFeatureMeasurement(f);
        };

        this.toolManager.deactivateCurrentTool();
    }

    handleDrawUpdate = async (e) => {
        for (const f of e.features) {
            const type = f.geometry.type.toLowerCase() + 's';
            
            if (f.geometry.type === 'LineString') {
                f.properties.profileData = JSON.stringify(await this.calculateProfile(f.geometry.coordinates));
            }
            
            updateFeature(type, f);
            this.updateFeatureMeasurement(f);
        }
        this.selectionManager.handleDrawSelectionChange();
    }

    updateFeatureMeasurement = (feature) => {
        this.removeFeatureMeasurement(feature.id);

        if (feature.properties.measure) {
            if (feature.geometry.type === 'LineString') {
                const line = turf.lineString(feature.geometry.coordinates);
                const lengthInMeters = turf.length(line, { units: 'meters' });
                const lengthFormatted = lengthInMeters >= 1000 
                    ? `${(lengthInMeters / 1000).toFixed(2)} km`
                    : `${lengthInMeters.toFixed(2)} m`;
                const midpoint = turf.along(line, lengthInMeters / 2, { units: 'meters' });
                this.displayMeasurement(midpoint.geometry.coordinates, lengthFormatted, feature.id);
            } else if (feature.geometry.type === 'Polygon') {
                const polygon = turf.polygon(feature.geometry.coordinates);
                const areaInSquareMeters = turf.area(polygon);
                const areaFormatted = areaInSquareMeters >= 100000 
                    ? `${(areaInSquareMeters / 1000000).toFixed(2)} km²`
                    : `${areaInSquareMeters.toFixed(2)} m²`;
                const centroid = turf.centroid(polygon);
                this.displayMeasurement(centroid.geometry.coordinates, areaFormatted, feature.id);
            }
        }
    }

    removeFeatureMeasurement = (featureId) => {
        const measurementLabel = document.querySelector(`.measurement-label[data-feature-id="${featureId}"]`);
        if (measurementLabel) {
            measurementLabel.remove();
        }
    }

    displayMeasurement = (coordinates, measurement, featureId) => {
        const markerElement = this.createMeasurementLabel(measurement, featureId);
        new maplibregl.Marker({ element: markerElement })
            .setLngLat(coordinates)
            .addTo(this.map);
    }

    createMeasurementLabel = (measurement, featureId) => {
        const label = document.createElement('div');
        label.className = 'measurement-label';
        label.innerText = measurement;
        label.dataset.featureId = featureId;
        return label;
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

    deleteFeatures = (features) => {
        features.forEach(f => {
            this.removeFeatureMeasurement(f.id);
            this.draw.delete(f.id);
            const type = f.geometry.type.toLowerCase() + 's';
            removeFeature(type, f.id);
        });
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.outlinecolor !== initialProperties.outlinecolor ||
            JSON.stringify(feature.properties.customAttributes) !== JSON.stringify(initialProperties.customAttributes)
        );
    }

    updateFeatures = (features, save = false, onlyUpdateProperties = false) => {
        features.forEach(feature => {
            const existingFeature = this.draw.get(feature.id);
            if (existingFeature) {
                if (!onlyUpdateProperties) {
                    this.draw.add(feature);
                } else {
                    Object.assign(existingFeature.properties, feature.properties);
                    this.draw.add(existingFeature);
                }
                
                if (save) {
                    const featureToUpdate = onlyUpdateProperties ? existingFeature : feature;
                    const type = featureToUpdate.geometry.type.toLowerCase() + 's';
                    updateFeature(type, featureToUpdate);
                }
            }
            this.updateFeatureMeasurement(feature);
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
        this.updateFeatures(features, true, true);
    }

    setDefaultProperties = (properties, commonAttributes) => {
        Object.keys(this.defaultProperties).forEach(geometryType => {
            commonAttributes.forEach(attr => {
                this.defaultProperties[geometryType][attr] = properties[attr];
            });
        });
    }

    changeButtonColors = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        $('.mapbox-gl-draw_point').html(
            `
            <img src="./images/icon_point_${color}.svg" alt="Adicionar ponto" title="Adicionar ponto" />
            `
        )

        $('.mapbox-gl-draw_line').html(
            `
            <img src="./images/icon_line_${color}.svg" alt="Adicionar linha" title="Adicionar linha" />
            `
        )

        $('.mapbox-gl-draw_polygon').html(
            `
            <img src="./images/icon_polygon_${color}.svg" alt="Adicionar polígono" title="Adicionar polígono" />
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
            <img src="./images/${imageName}red.svg" alt="Ferramenta ativa" title="Ferramenta ativa" />
            `
        )
    }

    async calculateProfile(coordinates) {
        const line = turf.lineString(coordinates);
        const length = turf.length(line, { units: 'meters' });
        const steps = 25;
        const stepLength = length / steps;

        let profileData = [];

        for (let i = 0; i <= steps; i++) {
            const point = turf.along(line, i * stepLength, { units: 'meters' });
            const elevation = await getTerrainElevation(this.map, point.geometry.coordinates);
            profileData.push({
                distance: i * stepLength,
                elevation: elevation
            });
        }

        return profileData;
    }
};
export default DrawControl;