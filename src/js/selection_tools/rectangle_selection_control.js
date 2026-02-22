// Path: js/selection_tools/rectangle_selection_control.js
import { getSelectionControlConfig } from '../store';

class RectangleSelectionControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        this.isActive = false;

        // Two-click selection state
        this.drawPoints = [];
        this.previewFeature = null;

        // Performance optimization
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;

    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
    }

    onRemove = () => {
        this.deactivate();
        this.map = undefined;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this.handleMapClick);
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.clearPreview();
        this.cancelPendingUpdates();
        this.map.off('click', this.handleMapClick);
    }

    // ===== TWO-CLICK SELECTION LOGIC =====

    handleMapClick = (e) => {
        if (!this.isActive || !e.lngLat) return;

        const point = [e.lngLat.lng, e.lngLat.lat];

        if (this.drawPoints.length === 0) {
            // First click: start selection
            this.drawPoints.push(point);
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 1) {
            // Second click: complete selection
            this.drawPoints.push(point);
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.executeRectangleSelection(e);
            this.resetSelectionState();
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
            }
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition || this.drawPoints.length !== 1) {
            this.pendingPreviewUpdate = false;
            return;
        }

        const corner1 = this.drawPoints[0];
        const corner2 = this.lastPreviewPosition;

        // Create rectangle geometry for preview
        const rectGeometry = this.createRectangleGeometry(corner1, corner2);
        this.showPreview(rectGeometry);

        this.pendingPreviewUpdate = false;
    }

    createRectangleGeometry = (corner1, corner2) => {
        const [x1, y1] = corner1;
        const [x2, y2] = corner2;

        // Create rectangle coordinates (closed polygon)
        const coordinates = [[
            [x1, y1], // bottom-left
            [x2, y1], // bottom-right
            [x2, y2], // top-right
            [x1, y2], // top-left
            [x1, y1]  // close polygon
        ]];

        return {
            type: 'Polygon',
            coordinates: coordinates
        };
    }

    showPreview = (geometry) => {
        this.map.getSource('rectangle-selection-preview').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true
            }
        });
    }

    clearPreview = () => {
        if (this.map.getSource('rectangle-selection-preview')) {
            this.map.getSource('rectangle-selection-preview').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        this.cancelPendingUpdates();
    }

    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
    }

    resetSelectionState = () => {
        this.drawPoints = [];
        this.clearPreview();
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    // ===== RECTANGLE SELECTION EXECUTION =====

    executeRectangleSelection = async (event) => {
        if (this.drawPoints.length !== 2) return;

        const [corner1, corner2] = this.drawPoints;
        const bbox = this.createBboxFromCorners(corner1, corner2);

        // Query all features within the bounding box
        const featuresInArea = this.queryFeaturesInBbox(bbox);

        // Apply Shift key logic
        if (!event.originalEvent.shiftKey) {
            this.selectionManager.deselectAllFeatures();
        }

        // Select found features - await all selections
        const selectionPromises = featuresInArea
            .filter(feature => {
                // Skip blocked features
                if (feature.properties.bloqueado === true) return false;

                const type = feature.toolType;
                const featureId = feature.properties.id;

                // Only select if not already selected (avoid duplicates)
                return !this.selectionManager.isFeatureSelected(type, featureId);
            })
            .map(feature => {
                const type = feature.toolType;
                const featureId = feature.properties.id;
                return this.selectionManager.toggleFeatureSelection(type, featureId, feature, false);
            });

        await Promise.all(selectionPromises);

        // Update UI and provide feedback
        this.selectionManager.updateUI();


        // Deactivate tool after successful selection
        this.toolManager.deactivateCurrentTool();
    }

    createBboxFromCorners = (corner1, corner2) => {
        const [x1, y1] = corner1;
        const [x2, y2] = corner2;

        return [
            Math.min(x1, x2), // minX
            Math.min(y1, y2), // minY
            Math.max(x1, x2), // maxX
            Math.max(y1, y2)  // maxY
        ];
    }

    queryFeaturesInBbox = (bbox) => {
        // Convert bbox to screen coordinates for querying
        const sw = this.map.project([bbox[0], bbox[1]]); // southwest
        const ne = this.map.project([bbox[2], bbox[3]]); // northeast

        // Query all rendered features in the rectangle area
        const allFeatures = this.map.queryRenderedFeatures([
            [sw.x, ne.y], // top-left screen coords
            [ne.x, sw.y]  // bottom-right screen coords
        ]);

        const CONTROL_CONFIG = getSelectionControlConfig();

        const customFeatures = [];

        // Filter custom features using the same logic as SelectionManager
        for (const [type, config] of Object.entries(CONTROL_CONFIG)) {
            for (const sourceName of config.sourceNames) {
                const matchingFeatures = allFeatures.filter(f =>
                    f.source === sourceName && f.properties.source === type
                );

                matchingFeatures.forEach(feature => {
                    customFeatures.push({ ...feature, toolType: type });
                });
            }
        }

        // Remove duplicates based on type + id
        const uniqueFeatures = [];
        const seenKeys = new Set();

        customFeatures.forEach(feature => {
            const key = `${feature.toolType}:${feature.properties.id}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueFeatures.push(feature);
            }
        });

        return uniqueFeatures;
    }
}

export default RectangleSelectionControl;
