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
        this.map.on('mousemove', this.onMouseMove.bind(this));
        this.map.on('mouseup', this.onMouseUp.bind(this));
    }

    onMouseDown(e) {
        const selectedTextFeatures = Array.from(this.selectionManager.selectedTextFeatures).map(feature => ({ feature, source: 'text' }));
        const selectedImageFeatures = Array.from(this.selectionManager.selectedImageFeatures).map(feature => ({ feature, source: 'image' }));
        const selectedDrawFeatures = Array.from(this.selectionManager.selectedFeatures).map(feature => ({ feature, source: 'draw' }));
        const selectedLOSFeatures = Array.from(this.selectionManager.selectedLOSFeatures).map(feature => ({ feature, source: 'los' }));
        const selectedVisibilityFeatures = Array.from(this.selectionManager.selectedVisibilityFeatures).map(feature => ({ feature, source: 'visibility' }));

        const allSelectedFeatures = [
            ...selectedTextFeatures,
            ...selectedImageFeatures,
            ...selectedDrawFeatures,
            ...selectedLOSFeatures,
            ...selectedVisibilityFeatures
        ];

        if (allSelectedFeatures.length > 0) {
            this.isDragging = true;
            this.map.dragPan.disable();
            this.lastPos = e.lngLat;
            this.initialCoordinates = e.lngLat;
            this.map.getCanvas().style.cursor = 'grabbing';

            this.offsets = allSelectedFeatures.map(item => ({
                feature: item.feature,
                source: item.source,
                offset: this.calculateOffset(item.feature, this.lastPos)
            }));
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
            if (source === 'draw') {
                this.moveDrawFeature(feature, dx, dy);
            } else if (source === 'text') {
                this.moveTextFeature(feature, newCoords);
            } else if (source === 'image') {
                this.moveImageFeature(feature, newCoords);
            } else if (source === 'los') {
                this.moveLOSFeature(feature, dx, dy);
            } else if (source === 'visibility') {
                this.moveVisibilityFeature(feature, dx, dy);
            }
        });

        this.lastPos = newPos;

        this.uiManager.updateSelectionHighlight();
    }

    onMouseUp(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';

        const dx = e.lngLat.lng - this.initialCoordinates.lng;
        const dy = e.lngLat.lat - this.initialCoordinates.lat;
        const distanceMoved = Math.sqrt(dx * dx + dy * dy);
        const tolerance = 2 / Math.pow(2, this.map.getZoom());
        if (distanceMoved > tolerance) {
            this.selectionManager.updateSelectedFeatures();
            this.uiManager.updateSelectionHighlight();
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
        const translateCoords = coords => {
            if (typeof coords[0] === 'number') {
                return [coords[0] + dx, coords[1] + dy];
            }
            return coords.map(translateCoords);
        };
        translatedFeature.geometry.coordinates = translateCoords(feature.geometry.coordinates);
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
}

export default MoveHandler;