class MoveHandler {
    constructor(map, selectionManager, uiManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.uiManager = uiManager;
        this.isDragging = false;
        this.lastPos = null;
        this.debounceTime = 20;
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
            const clickedFeature = this.map.queryRenderedFeatures(e.point)[0];
            if(!clickedFeature){
                return
            }
            clickedFeature.id = clickedFeature.id || clickedFeature.properties.id

            if (allSelectedFeatures.some(f => f.id == clickedFeature.id)) {
                this.isDragging = true;
                this.map.dragPan.disable();
                this.lastPos = e.lngLat;
                this.initialCoordinates = e.lngLat;
                this.setCursorStyle('grabbing');

                this.offsets = allSelectedFeatures.map(item => ({
                    feature: item,
                    source: item.source,
                    offset: this.calculateOffset(item, this.lastPos)
                }));
            }
        }
    }

    onMouseMove(e) {
        if (!this.isDragging) return;

        const currentTime = Date.now();
        if (currentTime - this.lastUpdateTime < this.debounceTime) {
            return;
        }
        this.lastUpdateTime = currentTime;

        const newPos = e.lngLat;
        const dx = newPos.lng - this.lastPos.lng;
        const dy = newPos.lat - this.lastPos.lat;

        this.offsets.forEach(({ feature, source, offset }) => {
            const newCoords = {
                lng: newPos.lng + offset[0],
                lat: newPos.lat + offset[1]
            };
            this.moveFeature(feature, source, dx, dy, newCoords);
        });

        this.lastPos = newPos;

        this.uiManager.updateSelectionHighlight();
    }

    onMouseUp(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.map.dragPan.enable();
        this.setCursorStyle('');

        const dx = e.lngLat.lng - this.initialCoordinates.lng;
        const dy = e.lngLat.lat - this.initialCoordinates.lat;
        const distanceMoved = Math.sqrt(dx * dx + dy * dy);
        const tolerance = 2 / Math.pow(2, this.map.getZoom());
        if (distanceMoved > tolerance) {
            this.selectionManager.updateSelectedFeatures();
            this.uiManager.updateSelectionHighlight();
        }

        this.map.off('mousemove', this.onMouseMove);

    }

    moveFeature(feature, source, dx, dy, newCoords) {
        switch (source) {
            case 'draw':
                this.moveDrawFeature(feature, dx, dy);
                break;
            case 'text':
                this.moveTextFeature(feature, newCoords);
                break;
            case 'image':
                this.moveImageFeature(feature, newCoords);
                break;
            case 'los':
                this.moveLOSFeature(feature, dx, dy);
                break;
            case 'visibility':
                this.moveVisibilityFeature(feature, dx, dy);
                break;
        }
    }

    calculateOffset(feature, referencePoint) {
        const coords = feature.geometry.coordinates;
        return [
            Array.isArray(coords[0]) ? coords[0][0] - referencePoint.lng : coords[0] - referencePoint.lng,
            Array.isArray(coords[0]) ? coords[0][1] - referencePoint.lat : coords[1] - referencePoint.lat
        ];
    }

    moveDrawFeature(feature, dx, dy) {
        const updatedFeature = this.translateFeature(feature, dx, dy);
        this.selectionManager.updateFeature(updatedFeature, 'draw');

    }

    moveLOSFeature(feature, dx, dy) {
        const updatedFeature = this.translateFeature(feature, dx, dy);
        this.selectionManager.updateFeature(updatedFeature, 'los');
    }

    moveVisibilityFeature(feature, dx, dy) {
        const updatedFeature = this.translateFeature(feature, dx, dy);
        this.selectionManager.updateFeature(updatedFeature, 'visibility');
    }

    translateFeature(feature, dx, dy) {
        const translatedFeature = JSON.parse(JSON.stringify(feature));
    
        const translateCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                return [coords[0] + dx, coords[1] + dy];
            }
            return coords.map(translateCoords);
        };
    
        const { type, coordinates } = feature.geometry;
    
        switch (type) {
            case 'Point':
                translatedFeature.geometry.coordinates = translateCoords(coordinates);
                break;
            case 'LineString':
                translatedFeature.geometry.coordinates = coordinates.map(translateCoords);
                break;
            case 'Polygon':
                translatedFeature.geometry.coordinates = coordinates.map(ring => ring.map(translateCoords));
                break;
            default:
                throw new Error(`Unsupported geometry type: ${type}`);
        }
    
        return translatedFeature;
    }

    moveTextFeature(feature, newCoords) {
        feature.geometry.coordinates = [newCoords.lng, newCoords.lat];
        this.selectionManager.updateFeature(feature, 'texts');
    }

    moveImageFeature(feature, newCoords) {
        feature.geometry.coordinates = [newCoords.lng, newCoords.lat];
        this.selectionManager.updateFeature(feature, 'images');
    }

    setCursorStyle(style) {
        this.map.getCanvas().style.cursor = style;
    }
}

export default MoveHandler;