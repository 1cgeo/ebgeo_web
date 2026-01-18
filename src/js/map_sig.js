// Path: js/map_sig.js
import { initServices } from './store';

// Initialize all application services before any component is created
initServices();

import { BaseLayerControl } from './baselayers';
import { AddImportControl, ScreenshotControl, DragDropHandler } from './import_export';
import { ToolManager, SelectionManager, UIManager, MoveHandler, ClipboardManager } from './tool_manager';
import { MapControl, DragRotateHandler } from './map';
import { AddStreetViewControl } from './street_view_tool';
import { Add3DModelsViewerControl } from './3d_models_viewer_tool';
import { VectorTileInfoControl } from './vector_info';
import { FeatureSearchControl } from './search';
import { MouseCoordinatesControl } from './coordinates';
import { TerrainControl, AnalysisLayersManager } from './terrain';
import config from './config.js';
import baseStyle from './baselayers/carta_topografica.js';
import { hideLoadingScreen } from './index.js';
import { ContextMenuControl } from './context-menu';
import { RectangleSelectionControl } from './selection_tools';
import { KeyboardShortcuts } from './keyboard';
import { SuggestionsModal } from './ui';
import { GridControl } from './grid';
import { FrameControl } from './frame';
import { URLRouter } from './url_router.js';

// Draw tools
import {
    AddPointControl,
    AddLineControl,
    AddPolygonControl,
    AddRectangleControl,
    AddCircleControl,
    AddEllipseControl,
    AddTextControl,
    AddImageControl,
    AddBrushControl
} from './draw_tools/index.js';

// Military tools
import {
    AddMilitarySymbolControl,
    AddCoordinationMeasureControl,
    AddArrowControl,
    AddBoundaryControl,
    AddOccupiedFrontControl
} from './military_tools/index.js';

// Analysis tools
import {
    AddLOSControl,
    AddVisibilityControl
} from './analysis_tools/index.js';

// ===== MAP CREATION AND CONFIGURATION =====

const map = new maplibregl.Map({
    container: 'map-sig',
    style: baseStyle,
    attributionControl: false,
    minZoom: config.map2d.minZoom,
    maxZoom: config.map2d.maxZoom,
    maxPitch: config.map2d.maxPitch,
    bounds: config.map2d.bounds,
    validateStyle: false
});

map.setSourceTileLodParams(...config.map2d.sourceTileLodParams);
if (config.map2d.maxBounds) {
    map.setMaxBounds(config.map2d.maxBounds);
}

const analysisLayersManager = new AnalysisLayersManager(map);

const gridControl = new GridControl(map);
const frameControl = new FrameControl(map);

// ===== MAP LOAD EVENT =====

map.on('load', async () => {
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    await baseLayerControl.switchMap(true);

    if (config.map2d.globe_projection) {
        map.setProjection({ type: 'globe' });
    }
    hideLoadingScreen();

    // Execute URL deep linking after map is ready
    URLRouter.execute({
        modelsControl: add3DModelsViewerControl,
        map: map
    });

    // gridControl._initGridLayers();
    // frameControl._initFrameLayers();
});

// ===== CONTROLS INITIALIZATION =====

const selectionManager = new SelectionManager(map);
const toolManager = new ToolManager();
toolManager.setSelectionManager(selectionManager);

const pointControl = new AddPointControl(toolManager);
const lineControl = new AddLineControl(toolManager);
const polygonControl = new AddPolygonControl(toolManager);

const textControl = new AddTextControl(toolManager);

const imageControl = new AddImageControl(toolManager);

const losControl = new AddLOSControl(toolManager);

const visibilityControl = new AddVisibilityControl(toolManager);

const importControl = new AddImportControl(toolManager);

const add3DModelsViewerControl = new Add3DModelsViewerControl(toolManager);
const addStreetViewControl = new AddStreetViewControl(toolManager);

const circleControl = new AddCircleControl(toolManager);
const rectangleControl = new AddRectangleControl(toolManager);
const ellipseControl = new AddEllipseControl(toolManager);
const arrowControl = new AddArrowControl(toolManager);
const boundaryControl = new AddBoundaryControl(toolManager);
const occupiedFrontControl = new AddOccupiedFrontControl(toolManager);
const militarySymbolControl = new AddMilitarySymbolControl(toolManager);
const brushControl = new AddBrushControl(toolManager);
const coordinationMeasureControl = new AddCoordinationMeasureControl(toolManager);

selectionManager.registerControl('point', pointControl);
selectionManager.registerControl('line', lineControl);
selectionManager.registerControl('polygon', polygonControl);
selectionManager.registerControl('text', textControl);
selectionManager.registerControl('image', imageControl);
selectionManager.registerControl('los', losControl);
selectionManager.registerControl('visibility', visibilityControl);
selectionManager.registerControl('circle', circleControl);
selectionManager.registerControl('rectangle', rectangleControl);
selectionManager.registerControl('ellipse', ellipseControl);
selectionManager.registerControl('arrow', arrowControl);
selectionManager.registerControl('boundary', boundaryControl);
selectionManager.registerControl('occupied_front', occupiedFrontControl);
selectionManager.registerControl('military_symbol', militarySymbolControl);
selectionManager.registerControl('brush', brushControl);
selectionManager.registerControl('coordination_measure', coordinationMeasureControl);

const uiManager = new UIManager(map, selectionManager, toolManager);
selectionManager.setUIManager(uiManager);
toolManager.setUiManager(uiManager);

const featureSearchControl = new FeatureSearchControl(uiManager);
uiManager.setFeatureSearchControl(featureSearchControl);

new MoveHandler(map, selectionManager, uiManager);

const vectorTileInfoControl = new VectorTileInfoControl(toolManager, uiManager);

selectionManager.setvectorTileInfoControl(vectorTileInfoControl);
const baseLayerControl = new BaseLayerControl(uiManager, config.map2d.hillshade);

const mapControl = new MapControl(baseLayerControl, analysisLayersManager);
mapControl.setSelectionManager(selectionManager);

baseLayerControl.setMapControl(mapControl);

importControl.setControls(pointControl, lineControl, polygonControl);

const terrainControl = new TerrainControl(config.map2d);
const screenshotControl = new ScreenshotControl();

const mouseCoordinatesControl = new MouseCoordinatesControl(
    pointControl,
    coordinationMeasureControl,
    militarySymbolControl
);
uiManager.setMouseCoordinatesControl(mouseCoordinatesControl);

const contextMenuControl = new ContextMenuControl(mouseCoordinatesControl, toolManager, selectionManager);

const dragRotateHandler = new DragRotateHandler(map);
dragRotateHandler.enable();

const dragDropHandler = new DragDropHandler(
    map.getContainer(),
    toolManager,
    importControl,
    mapControl,
    imageControl
);
dragDropHandler.enable();

const clipboardManager = new ClipboardManager(selectionManager, map);

const rectangleSelectionControl = new RectangleSelectionControl(toolManager);
selectionManager.setRectangleSelectionControl(rectangleSelectionControl);

// ===== KEYBOARD SHORTCUTS =====

const keyboardShortcuts = new KeyboardShortcuts({
    map,
    selectionManager,
    toolManager,
    baseLayerControl,
    clipboardManager,
    addStreetViewControl,
    add3DModelsViewerControl,
    mapControl,
    controls: {
        pointControl,
        lineControl,
        polygonControl,
        textControl,
        imageControl,
        losControl,
        visibilityControl,
        circleControl,
        rectangleControl,
        ellipseControl,
        arrowControl,
        boundaryControl,
        occupiedFrontControl,
        militarySymbolControl,
        brushControl,
        rectangleSelectionControl,
        vectorTileInfoControl,
        coordinationMeasureControl
    }
});

keyboardShortcuts.enable();
keyboardShortcuts.initModal();

const suggestionsModal = new SuggestionsModal();
suggestionsModal.init();

// ===== ADD CONTROLS TO MAP =====
map.addControl(baseLayerControl, 'top-left');
map.addControl(mapControl, 'top-left');
mapControl.loadMenu();

map.addControl(mouseCoordinatesControl, 'bottom-right');

map.addControl(contextMenuControl, 'top-left');

map.addControl(featureSearchControl, 'top-right');
map.addControl(importControl, 'top-right');
map.addControl(screenshotControl, 'top-right');
map.addControl(vectorTileInfoControl, 'top-right');
map.addControl(rectangleSelectionControl, 'top-right');
map.addControl(addStreetViewControl, 'top-right');
map.addControl(add3DModelsViewerControl, 'top-right');
map.addControl(terrainControl, 'top-right');
map.addControl(losControl, 'top-right');
map.addControl(visibilityControl, 'top-right');

map.addControl(pointControl, 'top-right');
map.addControl(lineControl, 'top-right');
map.addControl(polygonControl, 'top-right');
map.addControl(textControl, 'top-right');
map.addControl(imageControl, 'top-right');
map.addControl(rectangleControl, 'top-right');
map.addControl(circleControl, 'top-right');
map.addControl(ellipseControl, 'top-right');
map.addControl(brushControl, 'top-right');
map.addControl(arrowControl, 'top-right');
map.addControl(boundaryControl, 'top-right');
map.addControl(occupiedFrontControl, 'top-right');
map.addControl(militarySymbolControl, 'top-right');
map.addControl(coordinationMeasureControl, 'top-right');

// ===== GLOBAL ERROR HANDLING =====

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled error:', event.reason);
});

window.addEventListener('error', (event) => {
    console.error('JavaScript error:', event.error);
});

window.streetViewControl = addStreetViewControl;
window.modelsViewerControl = add3DModelsViewerControl;

// ===== CLEANUP =====

window.addEventListener('beforeunload', () => {
    keyboardShortcuts.destroy();
    suggestionsModal.destroy();
});
