// Path: js/map_sig.js
import { initServices, getEventBus, getStateManager, registerControl } from './store';

// Initialize all application services before any component is created
initServices();

import { BaseLayerControl } from './baselayers';
import { AddImportControl, ScreenshotControl, DragDropHandler } from './import_export';
import { ToolManager, SelectionManager, UIManager, MoveHandler, ClipboardManager } from './tool_manager';
import { MapControl, DragRotateHandler } from './map';
import { AddStreetViewControl } from './street_view_tool';
import { Add3DModelsViewerControl } from './3d_models_viewer_tool';
import { VectorTileInfoControl } from './vector_info';
import { FeatureSearchControl, SearchBarComponent } from './search';
import { ChipsComponent, SidebarControl } from './sidebar';
import { BaseLayerSelectorControl } from './base-layer-selector';
import { MouseCoordinatesControl } from './coordinates';
import { TerrainControl, AnalysisLayersManager, DataLayersManager } from './terrain';
import { BottomControlsControl } from './bottom-controls';
import config from './config.js';
import baseStyle from './baselayers/carta_topografica.js';
import { hideLoadingScreen } from './index.js';
import { ContextMenuControl } from './context-menu';
import { RectangleSelectionControl } from './selection_tools';
import { KeyboardShortcuts } from './keyboard';
import { URLRouter } from './url_router.js';
import { ToolbarControl, ActiveToolChip } from './toolbar';
import { AttributeTableControl } from './attribute_table';

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
const dataLayersManager = new DataLayersManager(map);

// Promise to track when IndexedDB initialization is complete.
// This prevents a race condition where map.on('load') could call switchMap()
// before the store is fully initialized, causing features to not load.
let resolveStoreInitialized;
const storeInitializedPromise = new Promise(resolve => {
    resolveStoreInitialized = resolve;
});

// ===== MAP LOAD EVENT =====

map.on('load', async () => {
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();

    // Wait for store initialization before loading features
    await storeInitializedPromise;

    await baseLayerControl.switchMap(true);

    if (config.map2d.globe_projection) {
        map.setProjection({ type: 'globe' });
    }

    // Always disable sky/fog
    map.setSky(undefined);

    hideLoadingScreen();

    // Execute URL deep linking after map is ready
    URLRouter.execute({
        modelsControl: add3DModelsViewerControl,
        map: map
    });
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
importControl.setMap(map);

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

const mapControl = new MapControl(baseLayerControl, analysisLayersManager, dataLayersManager);
mapControl.setSelectionManager(selectionManager);

baseLayerControl.setMapControl(mapControl);

importControl.setControls(pointControl, lineControl, polygonControl);

const terrainControl = new TerrainControl(config.map2d);
const screenshotControl = new ScreenshotControl();
screenshotControl.setMap(map);

const mouseCoordinatesControl = new MouseCoordinatesControl();
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

// NOTE: keyboardShortcuts.enable() is called after toolbar controls are initialized
// to ensure controls have map reference when shortcuts are triggered

// ===== ADD CONTROLS TO MAP (MUST BE FIRST - creates dependencies) =====
// MapControl.onAdd() creates featuresTab and pdfExportTab, so it must run
// before we create SidebarControl which depends on these
map.addControl(baseLayerControl, 'top-left');
map.addControl(mapControl, 'top-left');
// Load menu and then signal that store initialization is complete.
// map.on('load') waits for this before calling switchMap() to prevent
// a race condition that could cause features to not load.
mapControl.loadMenu().then(() => {
    resolveStoreInitialized();
});

// ===== EXTRACT DEPENDENCIES FROM MAP CONTROL =====
// These are created inside MapControl's onAdd() method and must be extracted
// AFTER mapControl is added to the map
const featuresTab = mapControl.featuresTab;
const pdfExportTab = mapControl.pdfExportTab;
const exportImportService = mapControl.exportImportService;
const mapManager = mapControl.mapManager;

// ===== CHIPS COMPONENT (Quick Actions) =====

const chipsComponent = new ChipsComponent({
    stateManager: getStateManager(),
    eventBus: getEventBus(),
    map: map,
    toolManager: toolManager
});
chipsComponent.init(document.body);

// ===== SIDEBAR CONTROL (New UI) =====

const sidebarControl = new SidebarControl({
    stateManager: getStateManager(),
    eventBus: getEventBus(),
    mapManager: mapManager,
    featuresTab: featuresTab,
    exportImportService: exportImportService,
    pdfExportTab: pdfExportTab,
    baseLayerControl: baseLayerControl,
    importControl: importControl,
    screenshotControl: screenshotControl,
    selectionManager: selectionManager,
    uiManager: uiManager,
});
sidebarControl.init(document.body);

// ===== ATTRIBUTE TABLE CONTROL =====

const attributeTableControl = new AttributeTableControl({
    map: map,
    eventBus: getEventBus(),
    stateManager: getStateManager(),
    selectionManager: selectionManager,
});

// Connect attribute table to features tab
if (featuresTab) {
    featuresTab.setAttributeTableControl(attributeTableControl);
}

// ===== INITIALIZE MAP REFERENCE FOR TOOLBAR-MANAGED CONTROLS =====
// These controls are not added to the map via addControl() anymore,
// but they still need the map reference for their functionality.
// We call onAdd() manually BEFORE creating ToolbarControl to ensure
// controls have the map reference when toolbar buttons are clicked.
const toolbarManagedControls = [
    pointControl,
    lineControl,
    polygonControl,
    textControl,
    imageControl,
    circleControl,
    rectangleControl,
    ellipseControl,
    brushControl,
    arrowControl,
    boundaryControl,
    occupiedFrontControl,
    militarySymbolControl,
    coordinationMeasureControl,
    losControl,
    visibilityControl,
    vectorTileInfoControl,
    rectangleSelectionControl,
];

toolbarManagedControls.forEach(control => {
    if (control && typeof control.onAdd === 'function') {
        control.onAdd(map);
    }
});

// Enable keyboard shortcuts after controls have map reference
keyboardShortcuts.enable();

// ===== TOOLBAR CONTROL (Reorganized tool groups) =====

const toolbarControl = new ToolbarControl({
    toolManager: toolManager,
    controls: {
        rectangleSelectionControl,
        pointControl,
        lineControl,
        polygonControl,
        rectangleControl,
        circleControl,
        ellipseControl,
        textControl,
        imageControl,
        brushControl,
        militarySymbolControl,
        coordinationMeasureControl,
        arrowControl,
        boundaryControl,
        occupiedFrontControl,
        losControl,
        visibilityControl,
        vectorTileInfoControl,
    },
    eventBus: getEventBus(),
    stateManager: getStateManager(),
    map: map,
});
toolbarControl.init(document.body);

// ===== ACTIVE TOOL CHIP (Central indicator) =====

const activeToolChip = new ActiveToolChip({
    stateManager: getStateManager(),
    eventBus: getEventBus(),
    toolManager: toolManager,
});
activeToolChip.init(document.body);

map.addControl(mouseCoordinatesControl, 'bottom-right');

map.addControl(contextMenuControl, 'top-left');

// ===== SEARCH BAR (Redesigned - Google Maps style) =====
// Note: FeatureSearchControl is no longer added to map as its UI is replaced
// by the new SearchBarComponent which has its own search functionality
const searchBarComponent = new SearchBarComponent({
    stateManager: getStateManager(),
    eventBus: getEventBus(),
    map: map,
    uiManager: uiManager,
    selectionManager: selectionManager,
});
searchBarComponent.init(document.body);

// NOTE: Import and Screenshot moved to sidebar tabs per Phase 7 spec
// map.addControl(importControl, 'top-right');
// map.addControl(screenshotControl, 'top-right');

// NOTE: These controls below are now managed by ToolbarControl
// They remain instantiated for keyboard shortcuts and internal functionality
// but their toolbar buttons are now rendered by the new toolbar component

// NOTE: Standalone controls (streetView, 3DModels, terrain) are now managed by BottomControlsControl
// They still need to be added to the map for their functionality (sources, layers, etc.)
// but their buttons are hidden via CSS since BottomControlsControl provides the toggle UI
map.addControl(addStreetViewControl, 'top-right');
map.addControl(add3DModelsViewerControl, 'top-right');
map.addControl(terrainControl, 'top-right');

// ===== BOTTOM CONTROLS (Feature toggles + Navigation) =====
const bottomControlsControl = new BottomControlsControl({
    map: map,
    toolManager: toolManager,
    eventBus: getEventBus(),
    terrainControl: terrainControl,
    modelsViewerControl: add3DModelsViewerControl,
    streetViewControl: addStreetViewControl,
});
bottomControlsControl.init(document.body);

// ===== BASE LAYER SELECTOR (Thumbnail-based layer switcher) =====
const baseLayerSelectorControl = new BaseLayerSelectorControl({
    baseLayerControl: baseLayerControl,
    eventBus: getEventBus(),
    stateManager: getStateManager(),
});
baseLayerSelectorControl.init(document.body);

// ===== REGISTER CONTROLS IN CONTROL REGISTRY =====
// This allows other modules (like layer_setup.js) to access controls by name
// without using mapInstance._controls.find() which no longer works
registerControl('AddPointControl', pointControl);
registerControl('AddLineControl', lineControl);
registerControl('AddPolygonControl', polygonControl);
registerControl('AddTextControl', textControl);
registerControl('AddImageControl', imageControl);
registerControl('AddLOSControl', losControl);
registerControl('AddVisibilityControl', visibilityControl);
registerControl('AddCircleControl', circleControl);
registerControl('AddRectangleControl', rectangleControl);
registerControl('AddEllipseControl', ellipseControl);
registerControl('AddArrowControl', arrowControl);
registerControl('AddBoundaryControl', boundaryControl);
registerControl('AddOccupiedFrontControl', occupiedFrontControl);
registerControl('AddMilitarySymbolControl', militarySymbolControl);
registerControl('AddBrushControl', brushControl);
registerControl('AddCoordinationMeasureControl', coordinationMeasureControl);
registerControl('TerrainControl', terrainControl);
registerControl('MouseCoordinatesControl', mouseCoordinatesControl);
registerControl('Add3DModelsViewerControl', add3DModelsViewerControl);
registerControl('AddStreetViewControl', addStreetViewControl);
registerControl('RectangleSelectionControl', rectangleSelectionControl);
registerControl('VectorTileInfoControl', vectorTileInfoControl);
registerControl('MapControl', mapControl);

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
    chipsComponent.destroy();
    sidebarControl.destroy();
    toolbarControl.destroy();
    activeToolChip.destroy();
    searchBarComponent.destroy();
    bottomControlsControl.destroy();
    baseLayerSelectorControl.destroy();
    attributeTableControl.destroy();
});
