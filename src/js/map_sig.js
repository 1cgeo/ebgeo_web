// Path: js/map_sig.js

/**
 * @module map_sig
 * @description Application initialization functions.
 *
 * Exports explicit phase functions called by index.js:
 * - createMap()        → Phase 3: MapLibre GL instance + tile error handling
 * - createControls()   → Phase 4: All tools, UI components, registrations
 * - initializeApp()    → Phase 5+6: State loading + map load handler
 * - setupCleanupHandlers() → Cleanup on unload
 *
 * No side-effects at module level — all initialization is explicit.
 */

import { getEventBus, getStateManager, registerControl, initializeWithLastActiveMap } from './store';

import { showConfirm } from './modals';

import { BaseLayerControl } from './baselayers';
import { AddImportControl, ScreenshotControl, DragDropHandler, ExportImportService, PDFExportTab } from './import_export';
import { ToolManager, SelectionManager, UIManager, MoveHandler, ClipboardManager } from './tool_manager';
import { MapManager, DragRotateHandler } from './map';
import { FeaturesTab } from './features_tab';
import { AddStreetViewControl } from './street_view_tool';
import { Add3DModelsViewerControl } from './3d_models_viewer_tool';
import { VectorTileInfoControl } from './vector_info';
import { FeatureSearchControl, SearchBarComponent } from './search';
import { ChipsComponent, SidebarControl } from './sidebar';
import { BaseLayerSelectorControl } from './base-layer-selector';
import { MouseCoordinatesControl } from './coordinates';
import { TerrainControl, AnalysisLayersManager, DataLayersManager } from './terrain';
import { BottomControlsControl } from './bottom-controls';
import { createTemporalController } from './temporal/temporal-controller.js';
import { createTrajectoryEditControl } from './temporal/trajectory-tool/trajectory-edit-control.js';
import { createTemporalDerivationService } from './temporal/temporal-derivation.service.js';
import config from './config.js';
import { getRepository } from './store/repositories/index.js';
import { getAtlasTerrainExaggeration } from './store/atlas/atlas.entity.js';
import baseStyle from './baselayers/carta_topografica.js';
import { hideLoadingScreen } from './ui/loading-screen.js';
import { ContextMenuControl } from './context-menu';
import { RectangleSelectionControl } from './selection_tools';
import { KeyboardShortcuts } from './keyboard';
import { initKeyboardService360 } from './street_view_tool/services/keyboard_service_360.js';
import { initKeyboardService3D } from './3d_models_viewer_tool/services/keyboard-service-3d.js';
import { initKeyboardServiceFp } from './first_person_3d_tool/services/keyboard-service-fp.js';
import { initKeyboardServiceBriefing, BriefingEditorControl, BriefingPresenterControl } from './briefing/index.js';
import { ToolbarControl, ActiveToolChip } from './toolbar';
import { AttributeTableControl } from './attribute_table';
import { PhoneLayout } from './phone';

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
    AddBrushControl,
    AddSectorControl
} from './draw_tools/index.js';

// Azimuth Distance tool (drawing tool - polar construction)
import { AddAzimuthDistanceControl } from './azimuth_distance_tool/index.js';

// Military tools
import {
    AddMilitarySymbolControl,
    AddCoordinationMeasureControl,
    AddArrowControl,
    AddBoundaryControl,
    AddOccupiedFrontControl,
    AddCoordinationLineControl,
    AddDeclinationControl
} from './military_tools/index.js';

// Measurement tools (ephemeral distance/area/angle)
import {
    MeasurementDistanceControl,
    MeasurementAreaControl,
    MeasurementAngleControl,
} from './measurement_tool/index.js';

// Snapping
import { SnappingService } from './snapping/snapping.service.js';

// Analysis tools
import {
    AddLOSControl,
    AddVisibilityControl
} from './analysis_tools/index.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Known tile sources that may have certificate errors */
const CERTIFICATE_ERROR_SOURCES = {
    'bdgex.eb.mil.br': {
        sourceId: 'bdgex',
        name: 'BDGEx',
        url: 'https://bdgex.eb.mil.br'
    }
};

// ============================================================================
// PHASE 3: MAP CREATION
// ============================================================================

/**
 * Creates the MapLibre GL map instance with tile error handling.
 * @returns {{ map: maplibregl.Map, analysisLayersManager: AnalysisLayersManager, dataLayersManager: DataLayersManager }}
 */
export function createMap() {
    const map = new maplibregl.Map({
        container: 'map-sig',
        style: baseStyle,
        attributionControl: false,
        minZoom: config.map2d.minZoom,
        maxZoom: config.map2d.maxZoom,
        maxPitch: config.map2d.maxPitch,
        bounds: config.map2d.bounds,
        validateStyle: false,
        // Handlers we never want. Declared here rather than on 'load' so there
        // is no window in which boxZoom/dragRotate/doubleClickZoom are live.
        boxZoom: false,
        dragRotate: false,
        doubleClickZoom: false,
        // Two-finger pitch fights pinch-zoom: MapLibre's touchPitch engages
        // after 2 px of parallel vertical movement and then locks zoom and
        // rotation out for the rest of the gesture, which is what made pinch
        // on a tablet feel like it tilted instead of zooming.
        touchPitch: false
    });

    // Touch rotation stays ON: MapLibre only engages it past a real twist
    // (~10-19 deg depending on finger spread), the same as Google Maps.
    // If accidental rotation is still reported on tablets, the line to add is:
    //   map.touchZoomRotate.disableRotation();

    map.setSourceTileLodParams(...config.map2d.sourceTileLodParams);
    if (config.map2d.maxBounds) {
        map.setMaxBounds(config.map2d.maxBounds);
    }

    // ===== TILE ERROR HANDLING =====
    // Detect certificate errors and show modal with instructions
    const shownCertificateErrors = new Set();

    map.on('error', async (e) => {
        if (e.error && e.sourceId) {
            const errorMessage = e.error.message || '';
            const url = e.error.url || '';

            if (errorMessage.includes('Failed to fetch') ||
                errorMessage.includes('ERR_CERT') ||
                errorMessage.includes('NetworkError')) {

                for (const [domain, sourceConfig] of Object.entries(CERTIFICATE_ERROR_SOURCES)) {
                    if (url.includes(domain) || e.sourceId === sourceConfig.sourceId) {
                        if (shownCertificateErrors.has(sourceConfig.sourceId)) {
                            break;
                        }
                        shownCertificateErrors.add(sourceConfig.sourceId);

                        const confirmed = await showConfirm(
                            `Erro ao carregar ${sourceConfig.name}`,
                            {
                                message: `O servidor ${sourceConfig.name} possui um certificado nao reconhecido pelo navegador.\n\nPara visualizar este mapa, clique em "Abrir Site", aceite o certificado no navegador e recarregue a pagina.`,
                                confirmText: 'Abrir Site',
                                cancelText: 'Fechar'
                            }
                        );

                        if (confirmed) {
                            window.open(sourceConfig.url, '_blank');
                        }
                        break;
                    }
                }
            }
        }
    });

    const analysisLayersManager = new AnalysisLayersManager(map);
    const dataLayersManager = new DataLayersManager(map);

    return { map, analysisLayersManager, dataLayersManager };
}

// ============================================================================
// PHASE 4: CONTROLS CREATION
// ============================================================================

/**
 * Creates all tool controls, UI managers, and registers them.
 * @param {maplibregl.Map} map - Map instance
 * @param {AnalysisLayersManager} analysisLayersManager
 * @param {DataLayersManager} dataLayersManager
 * @returns {Object} Controls object with baseLayerControl, viewer controls, and destroyables
 */
export async function createControls(map, analysisLayersManager, dataLayersManager) {

    // ===== PREFLIGHT DOS SERVICOS, ANTES DE QUALQUER COISA QUE LEIA O CATALOGO
    //
    // A POSICAO AQUI E O CONTRATO. Estes dois blocos ja estiveram mais abaixo,
    // logo antes do `map.addControl` de cada visualizador, e ali era tarde: o
    // `ChipsComponent`, criado no meio desta funcao, pergunta ao
    // `CatalogService.hasItems()` se ha algo a mostrar, e ESCONDE o chip
    // "Catalogo" quando nao ha. Com o catalogo 3D vindo do servico, ele so
    // existe depois do preflight, e o chip sumia da barra inteira.
    //
    // O sintoma nao tinha erro no console: o chip simplesmente nao era criado.
    // Foi o chefe quem viu, na tela, em 2026-08-22.
    //
    // Quem entrar aqui com preflight novo: ponha junto, e nao perto do controle
    // que consome. O catalogo le TODAS as fontes.

    // ===== STREET VIEW 360 PREFLIGHT =====
    // Must run BEFORE map.addControl(addStreetViewControl) so onAdd() sees the
    // correct flag and avoids loading PMTiles sources for a service that is
    // unreachable — and before ChipsComponent, which asks the catalog whether
    // there is anything to show.
    if (config.features.imagens_panoramicas) {
        if (!config.streetView360?.serviceUrl) {
            config.features.imagens_panoramicas = false;
        } else {
            try {
                const { preflightCheck } = await import('./street_view_tool/streetview-api.service.js');
                if (!(await preflightCheck())) {
                    config.features.imagens_panoramicas = false;
                }
            } catch {
                config.features.imagens_panoramicas = false;
            }
        }
    }

    // ===== MODELOS 3D PREFLIGHT =====
    // Preenche `config.tilesets` e `config.firstPerson3d.scenes` a partir do
    // servico ebgeo_3d. Dois consumidores dependem de ele ter rodado: o
    // `ChipsComponent`, mais abaixo, e o `onAdd()` do controle do visualizador.
    //
    // A FORMA E A MESMA DO 360 ACIMA, e isso e decisao do chefe: sem
    // `serviceUrl`, com o preflight negativo ou com excecao, a feature CAI.
    //
    // Desligar `map_3d` e seguro, e a razao merece registro: essa flag governa
    // so o botao "Modelos 3D" do rodape. O terreno tem toggle proprio
    // (`map2d.terrainSource`), e as ferramentas 3D vivem DENTRO do visualizador
    // de modelo, que nao abre sem modelo nenhum. Nao ha o que esconder.
    //
    // O criterio antigo era o array cheio ou vazio, e ele continua valendo por
    // outro caminho: o toggle do rodape tambem checa `config.hasTilesets?.()`.
    // O que muda e a feature cair de uma vez, em vez de o botao aparecer
    // desabilitado.
    if (config.features.map_3d) {
        if (!config.models3d?.serviceUrl) {
            config.features.map_3d = false;
        } else {
            try {
                const { preflightCheck: preflightModelos3d } =
                    await import('./3d_models_viewer_tool/services/models-api.service.js');
                if (!(await preflightModelos3d())) {
                    config.features.map_3d = false;
                }
            } catch {
                config.features.map_3d = false;
            }
        }
    }


    // ===== TOOL CONTROLS =====

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
    const coordinationLineControl = new AddCoordinationLineControl(toolManager);
    const militarySymbolControl = new AddMilitarySymbolControl(toolManager);
    const brushControl = new AddBrushControl(toolManager);
    const coordinationMeasureControl = new AddCoordinationMeasureControl(toolManager);
    const declinationControl = new AddDeclinationControl(toolManager);
    const azimuthDistanceControl = new AddAzimuthDistanceControl(toolManager);
    const sectorControl = new AddSectorControl(toolManager);

    // Measurement tools (ephemeral, read-only — no selection registration)
    const measureDistanceControl = new MeasurementDistanceControl(toolManager);
    const measureAreaControl = new MeasurementAreaControl(toolManager);
    const measureAngleControl = new MeasurementAngleControl(toolManager);

    // ===== SELECTION MANAGER REGISTRATIONS (declarative) =====

    const SELECTION_CONTROLS = [
        ['point', pointControl],
        ['line', lineControl],
        ['polygon', polygonControl],
        ['text', textControl],
        ['image', imageControl],
        ['los', losControl],
        ['visibility', visibilityControl],
        ['circle', circleControl],
        ['rectangle', rectangleControl],
        ['ellipse', ellipseControl],
        ['arrow', arrowControl],
        ['boundary', boundaryControl],
        ['occupied_front', occupiedFrontControl],
        ['coordination_line', coordinationLineControl],
        ['military_symbol', militarySymbolControl],
        ['brush', brushControl],
        ['coordination_measure', coordinationMeasureControl],
        ['magnetic_declination', declinationControl],
        ['azimuth_distance', azimuthDistanceControl],
        ['sector', sectorControl],
    ];

    for (const [type, ctrl] of SELECTION_CONTROLS) {
        selectionManager.registerControl(type, ctrl);
    }

    // ===== UI MANAGERS =====

    const uiManager = new UIManager(map, selectionManager, toolManager);
    selectionManager.setUIManager(uiManager);
    toolManager.setUiManager(uiManager);

    const featureSearchControl = new FeatureSearchControl(uiManager);
    uiManager.setFeatureSearchControl(featureSearchControl);

    const moveHandler = new MoveHandler(map, selectionManager, uiManager);

    const vectorTileInfoControl = new VectorTileInfoControl(toolManager, uiManager);

    selectionManager.setvectorTileInfoControl(vectorTileInfoControl);
    const baseLayerControl = new BaseLayerControl(uiManager, config.map2d.hillshade);

    const mapManager = new MapManager(baseLayerControl, selectionManager);
    const exportImportService = new ExportImportService(baseLayerControl, toolManager, mapManager, getEventBus());

    baseLayerControl.setDependencies({
        selectionManager,
        toolManager,
        analysisLayersManager,
        dataLayersManager
    });

    importControl.setControls(pointControl, lineControl, polygonControl);

    const terrainControl = new TerrainControl(config.map2d);
    // Load persisted terrain exaggeration from Atlas
    const repo = getRepository();
    const atlas = await repo.getAtlas();
    terrainControl.initExaggeration(getAtlasTerrainExaggeration(atlas));

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
        exportImportService,
        imageControl
    );
    dragDropHandler.enable();

    const clipboardManager = new ClipboardManager(selectionManager, map);

    const rectangleSelectionControl = new RectangleSelectionControl(toolManager);
    selectionManager.setRectangleSelectionControl(rectangleSelectionControl);

    // ===== SNAPPING SERVICE =====

    const snappingService = new SnappingService({ stateManager: getStateManager() });

    // ===== KEYBOARD SHORTCUTS =====

    const keyboardShortcuts = new KeyboardShortcuts({
        map,
        selectionManager,
        toolManager,
        baseLayerControl,
        clipboardManager,
        addStreetViewControl,
        add3DModelsViewerControl,
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
            coordinationLineControl,
            militarySymbolControl,
            brushControl,
            rectangleSelectionControl,
            vectorTileInfoControl,
            coordinationMeasureControl,
            declinationControl,
            azimuthDistanceControl,
            sectorControl,
            measureDistanceControl,
            measureAreaControl,
            measureAngleControl,
        }
    });

    // NOTE: keyboardShortcuts.enable() is called after toolbar controls are initialized
    // to ensure controls have map reference when shortcuts are triggered

    // ===== ADD BASE LAYER CONTROL TO MAP =====
    map.addControl(baseLayerControl, 'top-left');

    // ===== CREATE UI COMPONENTS (require map reference) =====
    mapManager.setMap(map);
    const featuresTab = new FeaturesTab(map, selectionManager, analysisLayersManager, dataLayersManager, getEventBus());
    const pdfExportTab = new PDFExportTab(map);

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
        coordinationLineControl,
        militarySymbolControl,
        coordinationMeasureControl,
        declinationControl,
        azimuthDistanceControl,
        sectorControl,
        losControl,
        visibilityControl,
        vectorTileInfoControl,
        rectangleSelectionControl,
        measureDistanceControl,
        measureAreaControl,
        measureAngleControl,
    ];

    toolbarManagedControls.forEach(control => {
        if (control && typeof control.onAdd === 'function') {
            control.onAdd(map);
        }
    });

    // Enable keyboard shortcuts after controls have map reference
    keyboardShortcuts.enable();

    // Initialize viewer keyboard services with global shortcuts reference
    // This allows them to disable/re-enable global shortcuts when activated
    initKeyboardService360(keyboardShortcuts);
    initKeyboardService3D(keyboardShortcuts);
    initKeyboardServiceFp(keyboardShortcuts);
    initKeyboardServiceBriefing(keyboardShortcuts);

    // ===== BRIEFING EDITOR CONTROL =====

    const briefingEditorControl = new BriefingEditorControl({
        map: map,
        eventBus: getEventBus(),
    });

    // ===== BRIEFING PRESENTER CONTROL =====

    const briefingPresenterControl = new BriefingPresenterControl({
        map: map,
        eventBus: getEventBus(),
    });

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
            declinationControl,
            arrowControl,
            boundaryControl,
            occupiedFrontControl,
            coordinationLineControl,
            azimuthDistanceControl,
            sectorControl,
            losControl,
            visibilityControl,
            vectorTileInfoControl,
            measureDistanceControl,
            measureAreaControl,
            measureAngleControl,
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
    const searchBarComponent = new SearchBarComponent({
        stateManager: getStateManager(),
        eventBus: getEventBus(),
        map: map,
        uiManager: uiManager,
        selectionManager: selectionManager,
    });
    searchBarComponent.init(document.body);

    // Standalone controls managed by BottomControlsControl
    // Still need to be added to the map for their functionality (sources, layers, etc.)
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

    // ===== TEMPORAL CONTROL (per-map timeline bar at bottom of map) =====
    // Docks the mouse-coordinates readout into itself while enabled, replacing
    // the floating coordinates panel.
    const temporalController = createTemporalController(
        {
            map: map,
            eventBus: getEventBus(),
            uiManager: uiManager,
            coordinatesControl: mouseCoordinatesControl,
        },
        document.body
    );
    const trajectoryEditControl = createTrajectoryEditControl(map, toolManager);
    createTemporalDerivationService({ map, eventBus: getEventBus() });

    // ===== BASE LAYER SELECTOR (Thumbnail-based layer switcher) =====
    const baseLayerSelectorControl = new BaseLayerSelectorControl({
        baseLayerControl: baseLayerControl,
        eventBus: getEventBus(),
        stateManager: getStateManager(),
    });
    baseLayerSelectorControl.init(document.body);

    // ===== REGISTER CONTROLS IN CONTROL REGISTRY (declarative) =====
    // This allows other modules (like layer_setup.js) to access controls by name

    const CONTROL_REGISTRY = [
        // Draw tools
        ['AddPointControl', pointControl],
        ['AddLineControl', lineControl],
        ['AddPolygonControl', polygonControl],
        ['AddTextControl', textControl],
        ['AddImageControl', imageControl],
        ['AddCircleControl', circleControl],
        ['AddRectangleControl', rectangleControl],
        ['AddEllipseControl', ellipseControl],
        ['AddBrushControl', brushControl],
        ['AddAzimuthDistanceControl', azimuthDistanceControl],
        ['AddSectorControl', sectorControl],
        // Military tools
        ['AddMilitarySymbolControl', militarySymbolControl],
        ['AddCoordinationMeasureControl', coordinationMeasureControl],
        ['AddDeclinationControl', declinationControl],
        ['AddArrowControl', arrowControl],
        ['AddBoundaryControl', boundaryControl],
        ['AddOccupiedFrontControl', occupiedFrontControl],
        ['AddCoordinationLineControl', coordinationLineControl],
        // Analysis tools
        ['AddLOSControl', losControl],
        ['AddVisibilityControl', visibilityControl],
        // Measurement tools
        ['MeasurementDistanceControl', measureDistanceControl],
        ['MeasurementAreaControl', measureAreaControl],
        ['MeasurementAngleControl', measureAngleControl],
        // Infrastructure
        ['TerrainControl', terrainControl],
        ['MouseCoordinatesControl', mouseCoordinatesControl],
        ['Add3DModelsViewerControl', add3DModelsViewerControl],
        ['AddStreetViewControl', addStreetViewControl],
        ['RectangleSelectionControl', rectangleSelectionControl],
        ['VectorTileInfoControl', vectorTileInfoControl],
        ['MapManager', mapManager],
        ['BaseLayerControl', baseLayerControl],
        // UI
        ['sidebarControl', sidebarControl],
        ['briefingEditor', briefingEditorControl],
        ['briefingPresenter', briefingPresenterControl],
        // Aliases (for catalog, search, etc.)
        ['streetView', addStreetViewControl],
        ['modelsViewer', add3DModelsViewerControl],
        ['ClipboardManager', clipboardManager],
        // UI components accessed by phone layout
        ['chipsComponent', chipsComponent],
    ];

    for (const [name, ctrl] of CONTROL_REGISTRY) {
        registerControl(name, ctrl);
    }

    // ===== PHONE LAYOUT (<=480px responsive) =====

    const phoneLayout = new PhoneLayout({ map });
    phoneLayout.init();

    // Return everything needed by later phases
    return {
        baseLayerControl,
        add3DModelsViewerControl,
        addStreetViewControl,
        destroyables: {
            keyboardShortcuts,
            snappingService,
            chipsComponent,
            sidebarControl,
            toolbarControl,
            activeToolChip,
            searchBarComponent,
            bottomControlsControl,
            temporalController,
            trajectoryEditControl,
            baseLayerSelectorControl,
            attributeTableControl,
            moveHandler,
            featuresTab,
            dragDropHandler,
            dragRotateHandler,
            phoneLayout,
        }
    };
}

// ============================================================================
// PHASE 5+6: STATE LOADING + MAP LOAD HANDLER
// ============================================================================

/**
 * Starts IndexedDB state loading and sets up the map load event handler.
 * Must be called synchronously after createMap() — before the map 'load' event fires.
 *
 * @param {maplibregl.Map} map - Map instance
 * @param {Promise<Object>} controlsPromise - Promise that resolves to controls from createControls()
 */
export function initializeApp(map, controlsPromise) {
    // Start loading state from IndexedDB (fast, ~10-50ms).
    const statePromise = initializeWithLastActiveMap();

    // Map load handler — fires when MapLibre finishes rendering tiles.
    // Must be registered synchronously to avoid race with async createControls().
    map.on('load', async () => {
        // boxZoom / dragRotate / doubleClickZoom / touchPitch are off from the
        // Map constructor (see createMap), not from here.

        // Wait for both IndexedDB state and controls to be ready
        const [, controls] = await Promise.all([statePromise, controlsPromise]);
        const { baseLayerControl } = controls;

        // The loading screen must come down even if the base layer fails: a
        // rejection here used to escape the async handler as an unhandled
        // rejection, leaving the app stuck on the loading screen forever.
        try {
            await baseLayerControl.switchMap(true);

            if (config.map2d.globe_projection) {
                map.setProjection({ type: 'globe' });
            }

            // Disable sky/fog - universe background is set via CSS on #map-sig container
            map.setSky(undefined);
        } catch (error) {
            console.error('Failed to apply the base layer:', error);
        } finally {
            hideLoadingScreen();
        }

        // Handle deep link from URL hash (opens 360/3D viewer if hash present)
        try {
            const { handleDeepLink, initDeepLinkListener } = await import('./deep-link/deep-link.js');
            await handleDeepLink();
            // Start listening for future hash changes so pasting a shared URL
            // into an already-open tab also opens the correct viewer.
            initDeepLinkListener();
        } catch (error) {
            console.warn('[deep-link] Failed to handle deep link:', error);
        }
    });
}

// ============================================================================
// CLEANUP HANDLERS
// ============================================================================

/**
 * Sets up global error handlers and beforeunload cleanup.
 * @param {Object} destroyables - Components that need cleanup on unload
 */
export function setupCleanupHandlers(destroyables) {
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled error:', event.reason);
    });

    window.addEventListener('error', (event) => {
        console.error('JavaScript error:', event.error);
    });

    window.addEventListener('beforeunload', async () => {
        destroyables.keyboardShortcuts.destroy();
        destroyables.snappingService.destroy();
        destroyables.chipsComponent.destroy();
        destroyables.sidebarControl.destroy();
        destroyables.toolbarControl.destroy();
        destroyables.activeToolChip.destroy();
        destroyables.searchBarComponent.destroy();
        destroyables.bottomControlsControl.destroy();
        destroyables.temporalController.destroy();
        destroyables.trajectoryEditControl.destroy();
        destroyables.baseLayerSelectorControl.destroy();
        destroyables.attributeTableControl.destroy();
        destroyables.moveHandler.destroy();
        destroyables.featuresTab.destroy();
        destroyables.dragDropHandler.disable();
        destroyables.dragRotateHandler.disable();
        destroyables.phoneLayout.destroy();
        try {
            const { destroyDeepLinkListener } = await import('./deep-link/deep-link.js');
            destroyDeepLinkListener();
        } catch { /* ignore */ }
    });
}
