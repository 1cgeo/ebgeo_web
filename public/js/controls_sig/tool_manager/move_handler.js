class MoveHandler {
    constructor(map, selectionManager, uiManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.uiManager = uiManager;
        this.isDragging = false;
        this.lastPos = null;
        this.debounceTime = 30;
        this.lastUpdateTime = 0;
        this.map.on('mousedown', this.onMouseDown.bind(this));
    }

    onMouseDown(e) {
        this.startDrag(e);
        this.map.on('mousemove', this.onMouseMove.bind(this));
        this.map.once('mouseup', this.onMouseUp.bind(this));
    }

    startDrag(e) {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();
        if (allSelectedFeatures.length > 0) {
            const clickedFeatures = this.map.queryRenderedFeatures(e.point);
            const sources = ['los', 'visibility', 'mapbox-gl-draw-cold', 'mapbox-gl-draw-hot', 'texts', 'images'];
            
            const filteredFeatures = clickedFeatures.filter(feature => sources.includes(feature.source));
            
            if (filteredFeatures.length === 0) {
                return;
            }

            const isFeatureSelected = filteredFeatures.some(clickedFeature => {
                clickedFeature.id = clickedFeature.id || clickedFeature.properties.id;
                return allSelectedFeatures.some(f => f.id === clickedFeature.id);
            });

            if (isFeatureSelected) {
                this.isDragging = true;
                this.map.dragPan.disable();
                this.uiManager.setDragging(true);
                this.initialCoordinates = e.lngLat;
                this.setCursorStyle('grabbing');

                this.selectedFeatures = allSelectedFeatures;
                this.offsets = new Map(allSelectedFeatures.map(item => [
                    item.id,
                    {
                        feature: item,
                        source: item.properties.source,
                        offset: this.calculateOffset(item, this.initialCoordinates)
                    }
                ]));
            }
        }
    }

    onMouseMove(e) {
        if (!this.isDragging) return;

        const currentTime = performance.now();
        if (currentTime - this.lastUpdateTime < this.debounceTime) {
            return;
        }
        this.lastUpdateTime = currentTime;

        const newPos = e.lngLat;
        const dx = newPos.lng - this.initialCoordinates.lng;
        const dy = newPos.lat - this.initialCoordinates.lat;

        this.uiManager.shiftSelectionBoxes(dx, dy);
    }

    onMouseUp(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.map.dragPan.enable();
        this.setCursorStyle('');

        const newPos = e.lngLat;
        const dx = newPos.lng - this.initialCoordinates.lng;
        const dy = newPos.lat - this.initialCoordinates.lat;
        const distanceMoved = Math.sqrt(dx * dx + dy * dy);
        const tolerance = 2 / Math.pow(2, this.map.getZoom());
        if (distanceMoved > tolerance) {

            const updatedFeatures = this.selectedFeatures.map(feature => {
                const { offset } = this.offsets.get(feature.id);
                const newCoords = {
                    lng: newPos.lng + offset[0],
                    lat: newPos.lat + offset[1]
                };
                return this.calculateUpdatedFeature(feature, feature.properties.source, dx, dy, newCoords);
            });
            this.uiManager.shiftSelectionBoxes(dx, dy, true);

            this.updateSelectionManagerFeatures(updatedFeatures);

            this.selectionManager.updateSelectedFeatures();
        }
        this.uiManager.setDragging(false);
        this.map.off('mousemove', this.onMouseMove);
    }

    calculateUpdatedFeature(feature, source, dx, dy, newCoords) {
        let updatedFeature;
        switch (source) {
            case 'draw':
            case 'los':
            case 'visibility':
                updatedFeature = this.uiManager.translateFeature(feature, dx, dy);
                break;
            case 'text':
            case 'image':
                updatedFeature = { ...feature, geometry: { ...feature.geometry, coordinates: [newCoords.lng, newCoords.lat] } };
                break;
            default:
                console.error('Unknown source type:', source);
                return feature;
        }
        return { ...updatedFeature, source };
    }

    calculateOffset(feature, referencePoint) {
        const coords = feature.geometry.coordinates;
    
        if (feature.geometry.type === "Point") {
            // For Point geometry
            return [
                coords[0] - referencePoint.lng,
                coords[1] - referencePoint.lat
            ];
        } else if (feature.geometry.type === "LineString") {
            // For LineString geometry (offset the first point)
            return [
                coords[0][0] - referencePoint.lng,
                coords[0][1] - referencePoint.lat
            ];
        } else if (feature.geometry.type === "Polygon") {
            // For Polygon geometry (offset the first point of the first ring)
            return [
                coords[0][0][0] - referencePoint.lng,
                coords[0][0][1] - referencePoint.lat
            ];
        } else if (feature.geometry.type === "MultiLineString") {
            // For MultiLineString geometry (offset the first point of the first line)
            return [
                coords[0][0][0] - referencePoint.lng,
                coords[0][0][1] - referencePoint.lat
            ];
        } else if (feature.geometry.type === "MultiPolygon") {
            // For MultiPolygon geometry (offset the first point of the first polygon)
            return [
                coords[0][0][0][0] - referencePoint.lng,
                coords[0][0][0][1] - referencePoint.lat
            ];
        } else {
            throw new Error("Unsupported geometry type: " + feature.geometry.type);
        }
    }

    updateSelectionManagerFeatures(updatedFeatures) {
        const newSelectedFeatures = new Map();
        const newSelectedTextFeatures = new Map();
        const newSelectedImageFeatures = new Map();
        const newSelectedLOSFeatures = new Map();
        const newSelectedVisibilityFeatures = new Map();

        updatedFeatures.forEach(feature => {
            switch (feature.properties.source) {
                case 'draw':
                    newSelectedFeatures.set(feature.id, feature);
                    break;
                case 'text':
                    newSelectedTextFeatures.set(feature.id, feature);
                    break;
                case 'image':
                    newSelectedImageFeatures.set(feature.id, feature);
                    break;
                case 'los':
                    newSelectedLOSFeatures.set(feature.id, feature);
                case 'visibility':
                    newSelectedVisibilityFeatures.set(feature.id, feature);
                    break;
            }
        });

        this.selectionManager.selectedDrawFeatures = newSelectedFeatures;
        this.selectionManager.selectedTextFeatures = newSelectedTextFeatures;
        this.selectionManager.selectedImageFeatures = newSelectedImageFeatures;
        this.selectionManager.selectedLOSFeatures = newSelectedLOSFeatures;
        this.selectionManager.selectedVisibilityFeatures = newSelectedVisibilityFeatures;


    }

    setCursorStyle(style) {
        this.map.getCanvas().style.cursor = style;
    }
}

export default MoveHandler;