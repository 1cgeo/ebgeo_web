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
// Direct module imports instead of the './import_export' barrel: the barrel ALSO re-exports
// garmin-kmz-export.js, which export.tab.js already loads with `await import()`. Reaching it
// statically from here pins it (and its own JSZip edge) into the eager payload of index.html
// and makes that dynamic import a no-op split.
import AddImportControl from './import_export/import.control.js';
import { ExportImportService } from './import_export/export-import.service.js';
import DragDropHandler from './import_export/drag-drop.handler.js';
import ScreenshotControl from './import_export/screenshot.control.js';
import PDFExportTab from './import_export/pdf-export.tab.js';
import { ToolManager, SelectionManager, UIManager, MoveHandler, ClipboardManager } from './tool_manager';
import { initToolRegistry, seedControl } from './tool_manager/tool-registry.js';
import { MapManager, DragRotateHandler } from './map';
import { FeaturesTab } from './features_tab';
import { AddStreetViewControl } from './street_view_tool';
// Static, and it costs no eager weight: the barrel above already pulls
// add_street_view_control.js, which imports this same module statically.
// O carimbo cobre o 360 E o servidor de tiles desde 2026-08-29: sem ele o visitante de
// link publico nao ve a camada privada que o atlas lhe empresta (clausula 6.3), porque o
// token dele e efemero e nao vira cookie. Ver `map/credencial-de-tile.js`.
import { credencialDeTile } from './map/credencial-de-tile.js';
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
import { refreshAtlasAppearance, reapplyAtlasAppearance } from './store/atlas-appearance.service.js';
import baseStyle from './baselayers/carta_topografica.js';
import { hideLoadingScreen } from './ui/loading-screen.js';
import { ContextMenuControl } from './context-menu';
import { RectangleSelectionControl } from './selection_tools';
import { KeyboardShortcuts } from './keyboard';
import { initKeyboardService360 } from './street_view_tool/services/keyboard_service_360.js';
import { initKeyboardService3D } from './3d_models_viewer_tool/services/keyboard-service-3d.js';
import { initKeyboardServiceFp } from '@js/first_person_3d_tool/services/keyboard-service-fp.js';
import { initKeyboardServiceBriefing, BriefingEditorControl, BriefingPresenterControl } from './briefing/index.js';
import { ToolbarControl, ActiveToolChip } from './toolbar';
import { AttributeTableControl } from './attribute_table';
import { PhoneLayout } from './phone';
import { AccountControl, SyncStatusControl, AtlasNameControl } from '@js/account/index.js';
import { OnlineUsersControl, RemoteCursorsLayer, RemoteSelectionsLayer, startPresence } from '@js/presence/index.js';
import { CommentOverlay } from '@js/comment_tool/index.js';
import { mapLockController } from '@js/locking/index.js';
import { EventTypes } from '@events/event_types.js';
import { ConnectionStates } from '@store/sync/connection-state.js';

// ---------------------------------------------------------------------------------------------
// FERRAMENTAS: as SEIS que ficam, e as dezesseis que sairam.
//
// As dezesseis restantes (retangulo, circulo, elipse, setor, azimute, as seis militares, as duas
// de analise e as tres de medida) entram por `tool_manager/tool-registry.js`, com `await import()`
// no primeiro gesto que as pede. Elas somavam 47 modulos de `military_tools`, 10 de
// `azimuth_distance_tool`, 8 de `measurement_tool` e 7 de `analysis_tools` no payload do boot,
// sem um clique.
//
// Estas seis ficam, e o motivo e um so: o BOOT DESENHA O QUE JA ESTAVA NO MAPA, e o desenho
// chama estes controles de forma SINCRONA e usando o valor de volta.
//   - `layers/styles/point.layers.js`, `content.layers.js` e `line.layers.js` chamam
//     `applyZoomCorrections` de ponto, texto, imagem e pincel no setup das camadas. O de ponto
//     tem conta propria (tamanho do rotulo), que nenhum stand-in reproduz sem copiar.
//   - `layer_setup.js` remede linha e poligono (`restoreMeasurements`), e `import.control.js` le
//     `DEFAULT_PROPERTIES` das classes de ponto, linha e poligono ao importar arquivo.
// Os tres arquivos ficaram fora da superficie desta onda. Custo medido do que ficou: 24 modulos
// e 355 kB de fonte, contra 72 modulos e 1169 kB que sairam.
//
// Import DIRETO de cada arquivo, nunca pelo barril `./draw_tools/index.js`: o barril reexporta as
// dez ferramentas de desenho, e alcanca-lo por qualquer nome traz as dez de volta ao payload
// ansioso, desfazendo o corte em silencio.
import AddPointControl from './draw_tools/point_tool/add_point_control.js';
import AddLineControl from './draw_tools/line_tool/add_line_control.js';
import AddPolygonControl from './draw_tools/polygon_tool/add_polygon_control.js';
import AddTextControl from './draw_tools/text_tool/add_text_control.js';
import AddImageControl from './draw_tools/image_tool/add_image_control.js';
import AddBrushControl from './draw_tools/brush_tool/add_brush_control.js';

// Snapping
import { SnappingService } from './snapping/snapping.service.js';

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
        // Handlers we never want. Declared HERE and not on 'load' so there is no
        // window in which boxZoom/dragRotate/doubleClickZoom are live: the person
        // can already drag before the first tile finishes painting.
        boxZoom: false,
        // Mouse rotation is ours (`map/drag-rotate.handler.js`): Ctrl tilts, Shift
        // rotates. MapLibre's dragRotate would run on the same buttons and sum.
        dragRotate: false,
        doubleClickZoom: false,
        // Two-finger pitch fights pinch-zoom: MapLibre's touchPitch engages after
        // 2 px of parallel vertical movement and then locks zoom and rotation out
        // for the rest of the gesture, which is what made a pinch on a tablet feel
        // like it tilted instead of zooming.
        touchPitch: false,
        // What stamps the credential on the 360 tiles, and on NOTHING else. The MVT
        // route is flexibleAuth: with no principal it answers 200 with the PUBLIC
        // subset, so serving the 360 from another origin (SV360_SERVICE_URL) makes the
        // user's private projects vanish from the layer with no error at all. The
        // predicate compares ORIGIN, never a string prefix, and returns falsy for
        // everything else (basemap, glyphs, BDGEx) — MapLibre's "leave it alone".
        transformRequest: credencialDeTile
    });

    // Touch ROTATION stays ON, and that is a decision, not an omission: MapLibre only
    // engages it past a real twist (~10-19 deg depending on how far apart the fingers
    // are), which is the same bar Google Maps uses. If accidental rotation is still
    // reported on tablets, the single line to add is:
    //   map.touchZoomRotate.disableRotation();
    // It preserves pinch-zoom; only the twist goes away.

    map.setSourceTileLodParams(...config.map2d.sourceTileLodParams);
    if (config.map2d.maxBounds) {
        map.setMaxBounds(config.map2d.maxBounds);
    }

    // Test/E2E hook: expose the 2D map instance so Playwright specs can assert real
    // map state (zoom/bearing/pitch/center). Harmless in production — the map is
    // already client-side state, mirroring `window.map` used by the 3D viewer.
    globalThis.__ebgeoMap = map;

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

    // ===== TOOL CONTROLS =====

    const selectionManager = new SelectionManager(map);
    const toolManager = new ToolManager();
    toolManager.setSelectionManager(selectionManager);

    const pointControl = new AddPointControl(toolManager);
    const lineControl = new AddLineControl(toolManager);
    const polygonControl = new AddPolygonControl(toolManager);

    const textControl = new AddTextControl(toolManager);

    const imageControl = new AddImageControl(toolManager);

    const importControl = new AddImportControl(toolManager);
    importControl.setMap(map);

    const add3DModelsViewerControl = new Add3DModelsViewerControl(toolManager);
    const addStreetViewControl = new AddStreetViewControl(toolManager);

    const brushControl = new AddBrushControl(toolManager);

    // ===== SELECTION MANAGER REGISTRATIONS (declarative) =====
    // Só as ferramentas ANSIOSAS entram aqui. As tardias entram por descritor em
    // `initToolRegistry`, logo abaixo, e o SelectionManager resolve o módulo delas na primeira
    // seleção de uma feição daquele tipo.

    const SELECTION_CONTROLS = [
        ['point', pointControl],
        ['line', lineControl],
        ['polygon', polygonControl],
        ['text', textControl],
        ['image', imageControl],
        ['brush', brushControl],
    ];

    for (const [type, ctrl] of SELECTION_CONTROLS) {
        selectionManager.registerControl(type, ctrl);
    }

    // ===== REGISTRO DE FERRAMENTAS (carga tardia) =====
    // Instala TUDO que precisa existir antes do primeiro clique: o descritor de seleção de cada
    // ferramenta tardia, o stand-in que responde por ela no registro global (`getControl`), e a
    // closure de regeneração de imagem que o caminho de snapshot remoto consulta sem clique
    // nenhum. O registro é ansioso, o módulo não. Ver `tool_manager/tool-registry.js`.
    initToolRegistry({ toolManager, selectionManager, map });

    // As ansiosas se apresentam ao registro para que a barra, o teclado e o menu tenham UM
    // caminho só (`ensureControl`), em vez de um para as tardias e outro para estas.
    seedControl('pointControl', pointControl);
    seedControl('lineControl', lineControl);
    seedControl('polygonControl', polygonControl);
    seedControl('textControl', textControl);
    seedControl('imageControl', imageControl);
    seedControl('brushControl', brushControl);

    // ===== UI MANAGERS =====

    const uiManager = new UIManager(map, selectionManager, toolManager);
    selectionManager.setUIManager(uiManager);
    toolManager.setUiManager(uiManager);

    const featureSearchControl = new FeatureSearchControl(uiManager);
    uiManager.setFeatureSearchControl(featureSearchControl);

    const moveHandler = new MoveHandler(map, selectionManager, uiManager);

    const vectorTileInfoControl = new VectorTileInfoControl(toolManager, uiManager);

    selectionManager.setvectorTileInfoControl(vectorTileInfoControl);
    seedControl('vectorTileInfoControl', vectorTileInfoControl);
    const baseLayerControl = new BaseLayerControl(uiManager, config.map2d.hillshade);

    const mapManager = new MapManager(baseLayerControl, selectionManager);
    const exportImportService = new ExportImportService(baseLayerControl, toolManager, mapManager, getEventBus());
    // Register so the account control can reach it for "Salvar atlas local no servidor" (item 2).
    registerControl('exportImport', exportImportService);

    baseLayerControl.setDependencies({
        selectionManager,
        toolManager,
        analysisLayersManager,
        dataLayersManager
    });

    importControl.setControls(pointControl, lineControl, polygonControl);

    const terrainControl = new TerrainControl(config.map2d);
    // As duas preferências de aparência do atlas, de uma vez: a leitura preenche o cache que os
    // pontos síncronos de projeção consultam depois (boot, troca de estilo, liga/desliga relevo).
    const { terrainExaggeration } = await refreshAtlasAppearance();
    terrainControl.initExaggeration(terrainExaggeration);

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
    seedControl('rectangleSelectionControl', rectangleSelectionControl);

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
        // `controls` NÃO carrega mais instância de ferramenta: as teclas de atalho guardam
        // `controlKey` e pedem a ferramenta ao registro (ver `keyboard/keyboard-shortcuts.js`).
        // O que sobra aqui é o que não é ferramenta de barra — a sobreposição de comentários,
        // que `map_sig.js` pendura logo abaixo, depois de criá-la.
        controls: {}
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
    //
    // Só as ANSIOSAS. Para as tardias, quem chama `onAdd(map)` é `ensureControl`, no mesmo
    // instante em que constrói a instância — e isso importa mais do que parece: é o `onAdd`
    // que instala o listener de zoom e a assinatura de regeneração remota de imagem de cada
    // ferramenta. Uma ferramenta construída sem `onAdd` existe e não funciona.
    const toolbarManagedControls = [
        pointControl,
        lineControl,
        polygonControl,
        textControl,
        imageControl,
        brushControl,
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

    // A barra NÃO recebe mais o mapa de instâncias. Ela já descrevia cada botão por
    // `controlKey` (uma string) em `toolbar.constants.js`; agora ela resolve essa string pelo
    // registro de ferramentas, no clique. Era este literal, gêmeo do de cima e mantido em
    // sincronia por nada, um dos quatro lugares que uma ferramenta nova tinha de entrar.
    const toolbarControl = new ToolbarControl({
        toolManager: toolManager,
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

    // ===== STREET VIEW 360 PREFLIGHT =====
    // Must run BEFORE map.addControl(addStreetViewControl) so onAdd() sees the correct flag
    // and avoids loading PMTiles sources for a service that is unreachable.
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

    // ===== BACKEND-INTEGRATION CONTROLS (account orchestrator + sync badge) =====
    // Additive: with no backend these render harmlessly (badge "Offline",
    // "Entrar" opens the login flow only on click). The anonymous/offline
    // path is unaffected.
    const accountControl = new AccountControl();
    const atlasNameControl = new AtlasNameControl();
    const syncStatusControl = new SyncStatusControl();
    map.addControl(accountControl, 'top-right');
    // Added between account and sync so the row-reverse bar reads: …sync · atlas name · avatar.
    map.addControl(atlasNameControl, 'top-right');
    map.addControl(syncStatusControl, 'top-right');

    // ===== PRESENCE / AWARENESS (Slice 2: online roster + live remote cursors) =====
    // Additive: with no backend the wsClient never fires presence events, so the
    // roster stays hidden (count 0) and no cursor markers are created. The
    // anonymous/offline path is unaffected.
    const onlineUsersControl = new OnlineUsersControl();
    map.addControl(onlineUsersControl, 'top-right');

    const remoteCursorsLayer = new RemoteCursorsLayer(map);
    // Remote-selection overlay: mirrors peers' 2D selections as colored outline
    // boxes (reuses the SelectionManager to resolve geometry + build boxes).
    const remoteSelectionsLayer = new RemoteSelectionsLayer(map, selectionManager);

    // Bridge the WS transport to the presence store (inbound presence/cursor and
    // throttled outbound cursor). Harmless offline — it only wires handlers.
    startPresence({ map });

    // Drive the presence overlays from the connection lifecycle: render remote
    // cursors + selections only while ONLINE; tear them down (and clear presence)
    // otherwise. CONNECTION_STATE_CHANGED is emitted on the event bus by the sync layer.
    getEventBus().on(EventTypes.CONNECTION_STATE_CHANGED, ({ currentState } = {}) => {
        if (currentState === ConnectionStates.ONLINE) {
            remoteCursorsLayer.start();
            remoteSelectionsLayer.start();
        } else {
            remoteCursorsLayer.stop();
            remoteSelectionsLayer.stop();
        }
    });

    // ===== SPATIAL COMMENTS (Fase 3): pin overlay. =====
    // Additive: comments render for both the local (offline) store and a connected remote atlas;
    // the overlay reloads on COMMENT_* events and on map switch. A Visualizador never receives
    // comments (server filter), so the overlay simply has nothing to render. Creation + management
    // live in the Maps panel (CommentsPanel) and via Shift+C — NOT in the on-map tool cluster.
    const commentOverlay = new CommentOverlay(map, toolManager);
    commentOverlay.start();
    // Expose the overlay to the keyboard manager (read lazily on keypress) so Shift+C toggles
    // comment placement — see keyboard-shortcuts.js.
    keyboardShortcuts.controls.commentOverlay = commentOverlay;

    // ===== MAP LOCK UX (Slice 3: on-map "Mapa bloqueado" banner + state controller) =====
    // O BANNER "Mapa bloqueado" SAIU DA TELA em 2026-08-16, por decisao do dono: ele ocupava o
    // topo do mapa o tempo todo em que o mapa estivesse bloqueado, que e um estado normal e
    // duradouro, nao um alerta. O cadeado da aba Mapas continua dizendo o mesmo, no lugar onde se
    // vai para mudar isso, e toda tentativa de desenhar num mapa bloqueado ja e recusada com
    // mensagem propria — a informacao nao se perde, so deixa de ocupar o mapa.
    //
    // O CONTROLADOR CONTINUA (`mapLockController.start()`), e a distincao importa: ele e quem
    // espelha o bloqueio remoto e gateia o botao por papel. Tirar o controlador junto teria
    // desligado o bloqueio, nao a faixa.
    mapLockController.start();

    // ===== REGISTER CONTROLS IN CONTROL REGISTRY (declarative) =====
    // This allows other modules (like layer_setup.js) to access controls by name

    // As ferramentas TARDIAS não estão aqui: `initToolRegistry` já registrou um stand-in sob o
    // nome de classe de cada uma, e `ensureControl` troca o stand-in pela instância de verdade
    // quando ela nasce. Registrá-las aqui exigiria construí-las, que é exatamente o custo que
    // esta onda tirou do boot.
    const CONTROL_REGISTRY = [
        // Draw tools (as ansiosas)
        ['AddPointControl', pointControl],
        ['AddLineControl', lineControl],
        ['AddPolygonControl', polygonControl],
        ['AddTextControl', textControl],
        ['AddImageControl', imageControl],
        ['AddBrushControl', brushControl],
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
        // Backend integration (account orchestrator + sync status badge)
        ['account', accountControl],
        ['syncStatus', syncStatusControl],
        ['atlasName', atlasNameControl],
        // Presence / awareness (online roster + live remote cursors + selections)
        ['onlineUsers', onlineUsersControl],
        ['remoteCursors', remoteCursorsLayer],
        ['remoteSelections', remoteSelectionsLayer],
        // Map lock UX (on-map "Mapa bloqueado" banner)
        // Spatial comments (pin overlay; managed from the Maps panel or via Shift+C)
        ['commentOverlay', commentOverlay],
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
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.pintarSlotLocal=true] - Se o manipulador de `load` deve DESENHAR o slot
 *   que o boot montou (camada base, feicoes, aparencia) e baixar a cortina. Passe false quando o
 *   boot ja sabe que vai abrir um atlas de SERVIDOR: ver `renderBootMap`.
 * @returns {{statePromise: Promise<string>, bootRendered: Promise<void>,
 *   renderBootMap: () => Promise<void>}}
 */
export function initializeApp(map, controlsPromise, { pintarSlotLocal = true } = {}) {
    // Start loading state from IndexedDB (fast, ~10-50ms).
    const statePromise = initializeWithLastActiveMap();

    // O MODULO DE DEEP LINK COMECA A CHEGAR AGORA, e nao la embaixo, dentro do manipulador de
    // `load`. Ele e importado dinamicamente de proposito (o boot que nao tem `#view=` na URL nao
    // precisa dele para pintar nada), mas o `await import(...)` estava no CAMINHO CRITICO: o
    // manipulador so terminava depois de o modulo chegar, e `bootRendered` so resolvia depois do
    // manipulador. Medido em 2026-08-25, nesta bancada de desenvolvimento (Vite servindo modulo a
    // modulo), num boot com `?atlas=`: de 201 a 328 ms de mediana entre esconder a cortina e o
    // modulo chegar, conforme a bateria, com `handleDeepLink()` custando ZERO em seguida (ele
    // retorna na primeira linha quando nao ha hash). Ou seja, um quinto de segundo de espera por
    // uma busca de rede, e nao por trabalho.
    //
    // A ORDEM NAO MUDA: o manipulador continua aguardando esta mesma promessa no mesmo ponto, e
    // `handleDeepLink()` continua rodando depois da pintura. O que muda e QUANDO a busca comeca.
    // O `catch` vazio esta aqui porque uma promessa rejeitada e ninguem olhando vira rejeicao nao
    // tratada; quem trata o erro de verdade continua sendo o `try` la embaixo, que aguarda esta
    // mesma promessa e ja rejeita por ela.
    const deepLinkPromise = import('./deep-link/deep-link.js');
    deepLinkPromise.catch(() => {});

    // Resolves once the boot 'load' handler has rendered the initial map AND removed the splash.
    // A remote open/reconnect (which clears + re-pulls the store) MUST await this so its
    // clearAllDataStore does NOT run CONCURRENTLY with the handler's switchMap() below — that race
    // hangs the handler before hideLoadingScreen(), leaving the splash stuck (the logged-in
    // `?atlas=&map=` deep-link symptom). Always resolves (even on a boot error) so it can't deadlock.
    //
    // COM `pintarSlotLocal: false` A CORRIDA DEIXA DE EXISTIR EM VEZ DE SER SERIALIZADA, e o
    // contrato desta promessa continua o mesmo: ela resolve quando o manipulador terminou o que
    // lhe cabia. Sem `switchMap` no manipulador nao ha `switchMap` para o wipe interlevar, e sem
    // pintura o wipe nao encontra escopo pintado para substituir.
    let resolveBootRendered;
    const bootRendered = new Promise((resolve) => { resolveBootRendered = resolve; });

    /**
     * DESENHA O SLOT LOCAL E BAIXA A CORTINA. Uma vez so, chamado por quem chegar primeiro.
     *
     * ELE E UMA FUNCAO, E NAO UM BLOCO, POR CAUSA DO BOOT COM `?atlas=`. Naquele boot o slot local
     * e montado, migrado, lido para a memoria e DESENHADO, e o `clearAllDataStore` de
     * `openRemoteAtlas` o apaga um segundo depois: a pintura inteira e trabalho jogado fora, e nao
     * so o tempo dela. O que ela deixa para tras e um MapLibre ocupado (estilo da camada base,
     * fontes de feicoes, pedidos de tile) que rouba a linha principal da abertura remota que vem
     * em seguida, e essa metade e a maior das duas.
     *
     * MEDIDO EM 2026-08-25, A/B pareado na mesma bancada e na mesma pagina, 5 boots de cada lado,
     * com `?atlas=` de um atlas de servidor com um mapa vazio. A pintura em si custava 125 ms
     * (`switchMap` 77, aparencia 48). A CONTENCAO que ela deixava custava mais: a leitura do
     * registro local dentro de `openRemoteAtlas` caiu de 426 ms para 2 ms, o `acquire` do tab-lock
     * de 440 para 314 (o assentamento e 300 ms, entao o resto era espera por linha principal), o
     * `connect` mais o primeiro pull de 412 para 226, e o `switchMap` final de 184 para 10.
     * Porta a porta: mediana de 2515 ms para 1370 ms, uma economia de 1145 ms (45%).
     *
     * ESTA BANCADA E DESENVOLVIMENTO, entao o numero ABSOLUTO nao e o do pacote de producao. O que
     * ela mede honestamente e a RAZAO entre os dois caminhos, medida no mesmo instrumento.
     *
     * ENTAO O BOOT QUE VAI ABRIR UM ATLAS DE SERVIDOR NAO PINTA, e a cortina fica de pe ate o
     * atlas de servidor estar montado — o que ela mostrava antes, durante um segundo e meio, era
     * o atlas ERRADO. Quem pinta naquele caminho e o proprio `openRemoteAtlas`, que ja termina com
     * `switchMap` e com a releitura de aparencia.
     *
     * E ELE CONTINUA EXISTINDO PARA OS DESFECHOS EM QUE A ABERTURA REMOTA NAO ACONTECE (outra aba
     * segura o atlas, o usuario recusou descartar um resgate, o servidor respondeu 403/404): ali
     * `index.js` o chama no `finally` do roteamento, e a cortina cai sobre o slot local pintado,
     * que e exatamente o que o boot antigo entregava.
     * @returns {Promise<void>}
     */
    let renderBootMapPromise = null;
    const renderBootMap = () => {
        renderBootMapPromise ??= (async () => {
            const controls = await controlsPromise;
            await controls.baseLayerControl.switchMap(true);

            // A APARÊNCIA É RELIDA AQUI, e não basta a leitura que alimentou o controle de
            // terreno lá em cima: aquela roda enquanto os controles são construídos, ANTES de
            // `activateBootAtlasScope` montar o namespace do atlas que o boot escolheu. Trocar de
            // atlas local é uma navegação, então o boot inteiro roda de novo — e com a leitura só
            // no ponto antigo o segundo slot herdava a projeção do primeiro, sem erro nenhum.
            await reapplyAtlasAppearance(controls.terrainControl, map);
            hideLoadingScreen();
        })();
        return renderBootMapPromise;
    };

    // Map load handler — fires when MapLibre finishes rendering tiles.
    // Must be registered synchronously to avoid race with async createControls().
    map.on('load', async () => {
        try {
            // boxZoom, dragRotate e doubleClickZoom sairam DAQUI e viraram opcoes do
            // construtor (ver `createMap`), ao lado do touchPitch, que ninguem desligava:
            // desligar no 'load' deixava uma janela em que os tres estavam vivos, porque a
            // pessoa ja consegue arrastar antes de o primeiro tile terminar de pintar.
            //
            // Disable sky/fog - universe background is set via CSS on #map-sig container. Esta
            // chamada FICA aqui, e continua sendo a primeira linha do manipulador pelo mesmo
            // motivo que subiu ate ele: e sincrona, nao depende do store, e no ponto antigo
            // (depois da pintura) ficava presa atras de `renderBootMap`, que hoje pode nao rodar
            // neste manipulador. O construtor nao a aceita como opcao.
            map.setSky(undefined);

            // Wait for both IndexedDB state and controls to be ready
            await Promise.all([statePromise, controlsPromise]);

            if (pintarSlotLocal) await renderBootMap();

            // Handle deep link from URL hash (opens 360/3D viewer if hash present)
            try {
                const { handleDeepLink, initDeepLinkListener } = await deepLinkPromise;
                // `deferSharedView`: um `#view=base` NAO e aplicado aqui. Este manipulador roda
                // antes de o roteamento de boot abrir o atlas, e `openRemoteAtlas` termina em
                // `switchMap`, que termina em `applyMapSavedPosition`: a camera compartilhada
                // seria sobrescrita pela salva, sem erro nenhum. Quem a aplica e o `finally` do
                // roteamento, em `index.js`, que roda em todo desfecho e depois da pintura.
                await handleDeepLink({ deferSharedView: true });
                // Start listening for future hash changes so pasting a shared URL
                // into an already-open tab also opens the correct viewer.
                initDeepLinkListener();
            } catch (error) {
                console.warn('[deep-link] Failed to handle deep link:', error);
            }
        } catch (error) {
            console.error('[boot] map load handler failed:', error);
            hideLoadingScreen(); // never leave the splash up on a boot error
        } finally {
            resolveBootRendered();
        }
    });

    return { statePromise, bootRendered, renderBootMap };
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
        mapLockController.stop();
        try {
            const { destroyDeepLinkListener } = await import('./deep-link/deep-link.js');
            destroyDeepLinkListener();
        } catch { /* ignore */ }
    });
}
