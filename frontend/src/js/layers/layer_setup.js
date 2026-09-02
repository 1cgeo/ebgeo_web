// Path: js/layers/layer_setup.js

/**
 * @fileoverview Main layer setup orchestrator for MapLibre.
 */

import { getCurrentMapFeatures, getImage, hasImage, getCurrentMapNameSync, getGridStyle, getCatalogLayers, getControl } from '../store';
import { getImageRegenerator } from './image-regen-registry.js';
import { ensureTurf } from '../utilities/turf-loader.js';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { catalogLayerReferenceId } from '../catalog/catalog-layer.ref.js';
import { initGridLayers } from '../grid/index.js';
import config from '../config.js';
import { EventTypes } from '../events';

import { generatePointImage, needsPerFeatureImage, pointImageSignature } from '../draw_tools/point_tool/point-marker-symbols.js';
import { parseCustomMarker, registerCustomFeatureImage } from '../draw_tools/point_tool/point-custom-icons.js';
import { updateAllLayerFilters, invalidateFilterCache, updateMeasurementLabelVisibility } from './visibility-filter.js';
import { applyLayerOpacities, invalidateOpacityCache } from './layer-opacity-applier.js';
import {
    setupPointLayers,
    setupLineLayers,
    setupBrushLayers,
    setupPolygonLayers,
    setupCircleLayers,
    setupRectangleLayers,
    setupEllipseLayers,
    setupSectorLayers,
    setupTextLayers,
    setupImageLayers,
    setupArrowLayers,
    setupMilitarySymbolsLayers,
    setupCoordinationMeasureLayers,
    setupDeclinationLayers,
    setupBoundaryLayers,
    setupOccupiedFrontLayers,
    setupLOSLayers,
    setupVisibilityLayers,
    setupLayerSeparators,
    setupAuxiliaryLayers,
} from './styles/index.js';
import { setupMeasurementLayers } from '../measurement_tool/measurement-labels.js';
// IMPORTADO, e não só reexportado no fim do arquivo: `export { X } from '...'` reencaminha o
// símbolo para quem importa DESTE módulo e NÃO traz o binding para o escopo local, então
// `clearFeatureSources` não enxergaria a lista sem esta linha.
import { FEATURE_SOURCES } from './layer.constants.js';
import { writeWholeCollection } from './geojson-dispatcher.js';

/**
 * Content signature of the per-feature point marker image last registered for a
 * feature id. Lets setImages() skip re-baking unchanged markers (perf) while
 * still regenerating when a marker's symbol/color actually changed. Keyed by
 * feature id; only consulted alongside map.hasImage(id), so a removed image
 * (deleted feature / cleared project) self-heals to a regeneration.
 * @type {Map<string, string>}
 */
const _pointImageSignatures = new Map();

/**
 * Creates an error placeholder image for failed image loads.
 * @returns {Promise<HTMLImageElement>} Error placeholder image
 */
function createErrorImage() {
    const errorSvg = `
        <svg width="64" height="64" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
            <rect x="4" y="4" width="56" height="56"
                  fill="#f8f9fa"
                  stroke="#dc3545"
                  stroke-width="2"
                  stroke-dasharray="4,4"
                  rx="4"/>
            <path d="M12 48 L20 36 L28 42 L36 30 L52 48 Z"
                  fill="#dee2e6"
                  stroke="#6c757d"
                  stroke-width="1"/>
            <line x1="16" y1="16" x2="48" y2="48"
                  stroke="#dc3545"
                  stroke-width="3"
                  stroke-linecap="round"/>
            <line x1="48" y1="16" x2="16" y2="48"
                  stroke="#dc3545"
                  stroke-width="3"
                  stroke-linecap="round"/>
            <text x="32" y="58"
                  text-anchor="middle"
                  font-family="Arial, sans-serif"
                  font-size="8"
                  fill="#6c757d">
                ERRO
            </text>
        </svg>
    `;

    const dataUrl = `data:image/svg+xml;base64,${btoa(errorSvg)}`;

    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to create error image'));
        image.src = dataUrl;
    });
}

/**
 * Adds an error placeholder image to the map if the image ID is not already registered.
 * @param {string} imageId - Image ID
 * @param {Object} mapInstance - MapLibre map instance
 */
async function addErrorImageIfNeeded(imageId, mapInstance) {
    try {
        const errorImage = await createErrorImage();
        if (!mapInstance.hasImage(imageId)) {
            mapInstance.addImage(imageId, errorImage);
        }
    } catch (err) {
        console.error(`Erro ao criar imagem de erro para ${imageId}:`, err);
    }
}

/**
 * Loads a single image to the map.
 * @param {string} imageId - Image ID
 * @param {Object} mapInstance - MapLibre map instance
 */
async function loadSingleImage(imageId, mapInstance) {
    try {
        const blob = await getImage(imageId);

        if (!blob) {
            console.warn(`Imagem ${imageId} não encontrada no store, usando imagem de erro`);
            await addErrorImageIfNeeded(imageId, mapInstance);
            return;
        }

        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const image = new Image();
            let settled = false;

            function settle(fn) {
                if (settled) return;
                settled = true;
                URL.revokeObjectURL(url);
                fn();
            }

            image.onload = () => settle(() => {
                if (!mapInstance.hasImage(imageId)) {
                    mapInstance.addImage(imageId, image);
                }
                resolve();
            });

            image.onerror = () => settle(() => {
                console.warn(`Falha ao carregar imagem ${imageId}, usando imagem de erro`);
                addErrorImageIfNeeded(imageId, mapInstance).then(resolve, reject);
            });

            setTimeout(() => settle(() => {
                addErrorImageIfNeeded(imageId, mapInstance).then(resolve, reject);
            }), 10000);

            image.src = url;
        });

    } catch (error) {
        console.warn(`Erro ao processar imagem ${imageId}:`, error);
        await addErrorImageIfNeeded(imageId, mapInstance);
    }
}

/**
 * Loads all images required by features.
 * @param {Object} features - Feature collection
 * @param {Object} mapInstance - MapLibre map instance
 */
async function setImages(features, mapInstance) {
    const allImageFeatures = [
        ...features.images,
        ...features.military_symbols,
        ...(features.coordination_measures || []),
        ...(features.magnetic_declinations || [])
    ];

    const imagePromises = [];

    for (const feature of allImageFeatures) {
        const imageId = feature.properties.id;
        if (!imageId || mapInstance.hasImage(imageId)) continue;

        // Military symbols / coordination measures / declinations render a client-generated
        // PNG that is NEVER uploaded (it's deterministically rebuildable from props). On a
        // remote snapshot / map switch the local blob is absent, and fetching it from the
        // backend 404s → error icon. Rebuild from props instead when no local blob exists.
        const regenerate = getImageRegenerator(feature.properties.source);
        if (regenerate) {
            imagePromises.push((async () => {
                if (await hasImage(imageId)) {
                    await loadSingleImage(imageId, mapInstance);
                    return;
                }
                try {
                    await regenerate(feature); // rebuilds + stores + installs the image on the map
                } catch (err) {
                    console.warn(`Falha ao regenerar imagem ${imageId} (${feature.properties.source}):`, err);
                    await addErrorImageIfNeeded(imageId, mapInstance);
                }
            })());
            continue;
        }

        imagePromises.push(loadSingleImage(imageId, mapInstance));
    }

    await Promise.allSettled(imagePromises);

    // Generate per-feature canvas images for non-circle point markers.
    // Custom icons (uploaded images) register asynchronously from stored blobs;
    // built-in shapes/icons bake a per-feature canvas image synchronously.
    //
    // Per-feature images are keyed by feature id, but their pixels depend on the
    // markerSymbol + baked colors/border. A bare `hasImage(id)` skip can't tell a
    // stale icon from a current one, so when a point's symbol/color changed and
    // this re-ran (peer op via wireRemoteFeatureRender, or a base-layer/map switch)
    // the OLD image kept rendering. Skip only when the cached content signature
    // still matches; otherwise regenerate (cheap built-in draw / cached custom blob).
    const customIconPromises = [];
    for (const feature of (features.points || [])) {
        const props = feature.properties;
        if (!needsPerFeatureImage(props.markerSymbol)) continue;

        const signature = pointImageSignature(props);
        if (mapInstance.hasImage(props.id) && _pointImageSignatures.get(props.id) === signature) continue;

        const iconId = parseCustomMarker(props.markerSymbol);
        if (iconId) {
            customIconPromises.push(
                registerCustomFeatureImage(mapInstance, props.id, iconId).then((ok) => {
                    if (ok) _pointImageSignatures.set(props.id, signature);
                })
            );
            continue;
        }

        if (mapInstance.hasImage(props.id)) mapInstance.removeImage(props.id);
        const imageData = generatePointImage(
            props.markerSymbol,
            props.fillColor || '#3f4fb5',
            props.lineColor || '#000000',
            props.lineWidth || 0,
        );
        mapInstance.addImage(props.id, imageData, { pixelRatio: 2 });
        _pointImageSignatures.set(props.id, signature);
    }
    await Promise.allSettled(customIconPromises);
}

/**
 * Restores terrain state (terrain 3D sources only, not hillshade).
 * Hillshade is restored via catalog layers.
 * @param {Object} mapInstance - MapLibre map instance
 */
async function restoreTerrainState() {
    try {
        const terrainControl = getControl('TerrainControl');

        if (terrainControl?.terrainConfig) {
            await terrainControl._setupTerrainSources();
        }
    } catch (error) {
        console.warn('Error restoring terrain state:', error);
    }
}

/**
 * Restores catalog layers (hillshade, analysis layers, data layers) from saved state.
 * Only activates layers that were explicitly added via the catalog.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} analysisLayersManager - Analysis layers manager
 * @param {Object} dataLayersManager - Data layers manager
 */
async function restoreCatalogLayer(layer, terrainControl, analysisLayersManager, dataLayersManager) {
    // The stored entry is a reference; the manager resolves the definition from `/api/config`.
    const innerId = catalogLayerReferenceId(layer);

    if (layer.type === CATALOG_ITEM_TYPES.HILLSHADE) {
        terrainControl?.setHillshadeVisibility?.(true);
        return;
    }

    const manager = layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER ? analysisLayersManager
        : layer.type === CATALOG_ITEM_TYPES.DATA_LAYER ? dataLayersManager
        : null;
    if (!manager || !innerId) return;

    await manager.toggleLayer(innerId, true);
    if (layer.styleOverrides) {
        manager.applyStyleOverrides(innerId, layer.styleOverrides);
    }
}

async function restoreCatalogLayers(mapInstance, analysisLayersManager, dataLayersManager) {
    try {
        const catalogLayers = await getCatalogLayers();

        if (!catalogLayers?.length) return;

        const terrainControl = getControl('TerrainControl');

        const restorations = catalogLayers
            .filter(layer => layer.status !== 'unavailable' && layer.visible)
            .map(layer => restoreCatalogLayer(layer, terrainControl, analysisLayersManager, dataLayersManager));

        await Promise.all(restorations);
    } catch (error) {
        console.warn('Error restoring catalog layers:', error);
    }
}

/**
 * Clears all measurement labels from the map.
 */
function clearAllMeasurements() {
    const measurementLabels = document.querySelectorAll('.measurement-label');
    measurementLabels.forEach(label => {
        const parentMarker = label.closest('.maplibregl-marker');
        if (parentMarker) {
            parentMarker.remove();
        } else {
            label.remove();
        }
    });
}

/**
 * Restores measurements for features.
 *
 * O UNICO CAMINHO DE BOOT QUE LE TURF SEM GESTO NENHUM, e por isso ele e o unico ponto de
 * `layer_setup.js` que espera o carregador. `updateFeatureMeasurement` de linha e de poligono
 * cai em `measurement_tool/measurement-geometry.js` (`turf.length`, `turf.area`,
 * `turf.centroid`), e a visada de LOS em `add_los_geometry.js`.
 *
 * O `await` FICA DEPOIS DA VARREDURA, e nao antes: um mapa sem nenhuma feicao com
 * `properties.measure` (que e o mapa novo, e a maioria dos mapas) nao baixa 619 kB para
 * descobrir que nao tinha nada a remedir. Carga estritamente sob demanda quer dizer isto.
 *
 * @param {Object} features - Feature collection
 * @returns {Promise<void>}
 */
async function restoreMeasurements(features) {
    try {
        const controlFeaturePairs = [
            ['AddLineControl', features.lines],
            ['AddPolygonControl', features.polygons],
            ['AddLOSControl', features.los],
        ];

        const aRemedir = [];
        for (const [controlName, featureList] of controlFeaturePairs) {
            const control = getControl(controlName);
            if (!control || !featureList) continue;

            for (const feature of featureList) {
                if (feature.properties?.measure) {
                    aRemedir.push([control, feature]);
                }
            }
        }
        if (aRemedir.length === 0) return;

        await ensureTurf();
        for (const [control, feature] of aRemedir) {
            control.updateFeatureMeasurement(feature);
        }
    } catch (error) {
        console.warn('Error restoring measurements:', error);
    }
}

/**
 * Restores boundary dependent features.
 * @param {Object} features - Feature collection
 * @param {Object} mapInstance - MapLibre map instance
 */
function restoreBoundaryDependentFeatures(features, mapInstance) {
    try {
        // THE CLEARING IS UNCONDITIONAL AND SYNCHRONOUS, and it is a separate step from the
        // rebuild. It used to sit inside an `if (!boundaryControl)` branch that is DEAD:
        // `getControl('AddBoundaryControl')` answers with the tool-registry stand-in, which
        // always exists. So switching maps onto the same basemap left the previous map's
        // circles and labels on screen until an asynchronous rebuild landed - and on a map
        // with no boundary at all, nothing ever landed.
        //
        // These two sources keep their raw `setData` on purpose: they are BLOCKED from the
        // GeoJSON dispatcher (their derived features carry a top-level id and no
        // `properties.id`), which is written out in the fileoverview of
        // `military_tools/boundary_tool/add_boundary_control.js`.
        const emptyCollection = { type: 'FeatureCollection', features: [] };
        mapInstance.getSource('boundary-circles')?.setData(emptyCollection);
        mapInstance.getSource('boundary-texts')?.setData(emptyCollection);

        const boundaryControl = getControl('AddBoundaryControl');
        if (!boundaryControl) return;

        const validBoundaries = [];

        (features.boundarys || []).forEach((boundaryFeature, index) => {
            try {
                if (!boundaryFeature?.properties) {
                    console.warn(`Invalid boundary feature ${index}:`, boundaryFeature);
                    return;
                }

                let coords = boundaryFeature.properties.baseCoordinates;

                if (typeof coords === 'string') {
                    try {
                        coords = JSON.parse(coords);
                    } catch (_parseError) {
                        console.warn(`Failed to parse coordinates for boundary ${boundaryFeature.properties.id}`);
                        return;
                    }
                }

                if (!Array.isArray(coords) || coords.length < 2) {
                    console.warn(`Invalid coordinates for boundary ${boundaryFeature.properties.id}`);
                    return;
                }

                const validCoords = coords.filter(coord =>
                    Array.isArray(coord) &&
                    coord.length >= 2 &&
                    typeof coord[0] === 'number' &&
                    typeof coord[1] === 'number' &&
                    !isNaN(coord[0]) &&
                    !isNaN(coord[1])
                );

                if (validCoords.length < 2) {
                    console.warn(`Insufficient valid coordinates for boundary ${boundaryFeature.properties.id}`);
                    return;
                }

                boundaryFeature.properties.baseCoordinates = validCoords;
                validBoundaries.push(boundaryFeature);

            } catch (featureError) {
                console.error(`Error processing boundary ${index}:`, featureError);
            }
        });

        // ONE rebuild for the whole map: the per-boundary call this used to make read the
        // same (empty) collection N times without awaiting, so only the last boundary's
        // labels and circles survived. That is why a reloaded map showed the labels of a
        // single boundary until something else touched the others.
        //
        // AND ONLY WHEN THERE IS SOMETHING TO REBUILD. `rebuildAllDependentFeatures` is one of
        // the stand-in's FORWARDED methods (`tool_manager/tool-registry.js`), so calling it
        // awaits `ensureControl`, which downloads the boundary chunk AND the 619 kB of Turf.
        // Called with an empty list it did that on EVERY boot, of every map, including the
        // ones that have never had a boundary - undoing the lazy-load decision of 2026-08-25.
        // An empty list needs the clearing above and nothing else.
        if (validBoundaries.length === 0) return;
        boundaryControl.rebuildAllDependentFeatures(validBoundaries);

    } catch (error) {
        console.error('Error restoring boundary dependent features:', error);
    }
}

/**
 * Sets up grid layers on the map.
 * @param {Object} mapInstance - MapLibre map instance
 */
async function setupGridLayers(mapInstance) {
    initGridLayers(mapInstance);
    try {
        const mouseCoordinatesControl = getControl('MouseCoordinatesControl');
        const gridControl = mouseCoordinatesControl?.gridControl;

        if (!gridControl) {
            console.warn('Grid control not found');
            return;
        }

        const mapName = getCurrentMapNameSync();
        const savedGrid = await getGridStyle(mapName);
        const format = savedGrid?.format ?? 'latlong';
        const visible = savedGrid?.visible ?? false;

        gridControl.syncState(format, visible);
        gridControl._getGrid(format, visible, false);
        gridControl._updateButtonState(visible);

    } catch (error) {
        console.warn('Error restoring grid:', error);
    }
}

/**
 * Sets up listener for layer visibility changes via EventBus.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus instance
 * @returns {Function} Unsubscribe function
 */
// Holds the active LAYERS_CHANGED unsubscribe so it can be detached before a
// re-subscribe. setupMapFeatures() runs on every map/base-layer switch; without
// this, the anonymous listener accumulated unbounded on the session-lived eventBus.
let layerVisibilityUnsub = null;

function setupLayerVisibilityListener(mapInstance, eventBus) {
    return eventBus.on(EventTypes.LAYERS_CHANGED, () => {
        invalidateFilterCache();
        updateAllLayerFilters(mapInstance);
        updateMeasurementLabelVisibility();
        applyLayerOpacities(mapInstance);
    });
}

/**
 * Sets up all map feature layers and visibility system.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} analysisLayersManager - Analysis layers manager
 * @param {Object} dataLayersManager - Data layers manager
 * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus instance
 */
export async function setupMapFeatures(mapInstance, analysisLayersManager, dataLayersManager, eventBus) {
    try {
        invalidateFilterCache();
        invalidateOpacityCache();

        setupLayerSeparators(mapInstance);

        // OS TRES `await` ABAIXO NAO SAO CONCORRENCIA DESPERDICADA, e por isso nao viram
        // `Promise.all`. Medido em 2026-08-25, pacote de producao, boot de visitante com
        // IndexedDB vazio: `_setupTerrainSources()` nem sequer e `async` (um `addSource`), e
        // `setupAnalysisLayers` / `setupDataLayers` sao `async` na assinatura com ZERO `await`
        // no corpo. Os tres correm ate o fim sincronamente, entao nao ha E/S para sobrepor e
        // `Promise.all` economizaria tres saltos de microtarefa.
        //
        // Ele COBRARIA um preco real, porem: os tres chamam `addLayer`, e a ordem das camadas
        // no mapa e semantica (e o motivo de `setupLayerSeparators` existir). Sequencial, a
        // ordem de insercao e fixa; concorrente, ela passa a depender do escalonador.
        //
        // `restoreCatalogLayers` e o unico genuinamente assincrono (le o catalogo do IndexedDB)
        // e DEPENDE dos tres, porque religa camada por camada pelos dois gerentes e pelo
        // controle de terreno. Ele fica onde esta.
        await restoreTerrainState();

        await analysisLayersManager.setupAnalysisLayers();
        await dataLayersManager.setupDataLayers();

        await restoreCatalogLayers(mapInstance, analysisLayersManager, dataLayersManager);

        const features = await getCurrentMapFeatures();
        await setImages(features, mapInstance);

        setupImageLayers(features, mapInstance);
        setupPolygonLayers(features, mapInstance);
        setupEllipseLayers(features, mapInstance);
        setupCircleLayers(features, mapInstance);
        setupRectangleLayers(features, mapInstance);
        setupSectorLayers(features, mapInstance);
        setupArrowLayers(features, mapInstance);
        setupVisibilityLayers(features, mapInstance);
        setupOccupiedFrontLayers(features, mapInstance);
        setupBoundaryLayers(features, mapInstance);
        setupLineLayers(features, mapInstance);
        setupBrushLayers(features, mapInstance);
        setupLOSLayers(features, mapInstance);
        setupPointLayers(features, mapInstance);
        setupMilitarySymbolsLayers(features, mapInstance);
        setupCoordinationMeasureLayers(features, mapInstance);
        setupDeclinationLayers(features, mapInstance);
        setupTextLayers(features, mapInstance);
        setupAuxiliaryLayers(mapInstance);
        setupMeasurementLayers(mapInstance);

        if (config.features.grid) {
            await setupGridLayers(mapInstance);
        }

        if (layerVisibilityUnsub) layerVisibilityUnsub();
        layerVisibilityUnsub = setupLayerVisibilityListener(mapInstance, eventBus);
        updateAllLayerFilters(mapInstance);
        applyLayerOpacities(mapInstance);

        requestAnimationFrame(() => {
            clearAllMeasurements();
            restoreMeasurements(features);
            restoreBoundaryDependentFeatures(features, mapInstance);
        });
    } catch (error) {
        console.error('Error setting up map features:', error);
    }
}

/**
 * ESVAZIA as sources de feição do mapa vivo, sem remontar camada nenhuma.
 *
 * POR QUE ELA EXISTE. Apagar o traço do mapa antigo da tela e RECONSTRUIR o mapa são coisas
 * diferentes, e até aqui só havia `setupMapFeatures`, que faz as duas. Na saída da conta a segunda
 * metade é desperdício puro: ela restaura terreno, camadas de catálogo, imagens e filtros de um
 * escopo que é destruído em seguida. A primeira metade não é desperdício nenhum, é o defeito
 * relatado pelo usuário (`tests/e2e-ui/browser-logout-clears-map.repro.spec.js`): depois do wipe
 * nada mais repovoa as sources, então quem não as esvaziar deixa as feições desenhadas no canvas.
 *
 * AS ETIQUETAS DE MEDIÇÃO NÃO SÃO SOURCE. Elas são nós DOM pendurados em marcadores do MapLibre,
 * então `setData` não as alcança e `clearAllMeasurements()` é obrigatório aqui. Sem ele o mapa
 * fica sem feições e com os rótulos das feições que sumiram.
 *
 * O QUE ELA DELIBERADAMENTE NÃO FAZ: remover camadas, imagens registradas ou o terreno. Esvaziar
 * é reversível por um `setupMapFeatures` seguinte; remover exigiria remontar tudo.
 *
 * A ESCRITA PASSA PELO DESPACHANTE (`writeWholeCollection`), nunca por um `setData` cru. Quase
 * toda source desta lista foi migrada para o despachante de diff, e um `setData` direto substitui
 * o slot de pending-update do MapLibre: o diff que uma ferramenta acabou de enfileirar some sem
 * erro nenhum. A semântica de coleção inteira é a certa aqui, e é `replaceAll`: descartar o que
 * estava na fila é exatamente o que um wipe quer, porque o dado que aquela fila descrevia acabou
 * de ser apagado.
 *
 * @param {Object} mapInstance - MapLibre map instance.
 */
export function clearFeatureSources(mapInstance) {
    if (!mapInstance) return;

    const emptyCollection = { type: 'FeatureCollection', features: [] };

    for (const sourceId of Object.values(FEATURE_SOURCES)) {
        const source = mapInstance.getSource(sourceId);
        // A source pode não existir (o estilo ainda não montou esta camada), e `setData` é testado
        // porque nem toda source do estilo é GeoJSON: uma raster que tenha caído com um destes ids
        // responderia ao `getSource` e não a este método.
        if (!source || typeof source.setData !== 'function') continue;
        writeWholeCollection(mapInstance, sourceId, emptyCollection);
    }

    // AS DUAS SOURCES DERIVADAS DO LIMITE NAO ESTAO EM `FEATURE_SOURCES`, e por isso
    // escapariam desta varredura. Quem as esvazia no caminho normal e
    // `restoreBoundaryDependentFeatures`, que so roda dentro de `setupMapFeatures` (a linha
    // la diz, com todas as letras, que limpa-las conserta um bug de persistencia na troca de
    // mapa). O caminho `rebuild: false` nao passa por `setupMapFeatures`, entao sem estas duas
    // linhas o limite de um atlas de SERVIDOR continuaria desenhado depois do logout.
    //
    // O SPEC NAO PEGOU ISSO, e vale registrar por que: `browser-logout-clears-map.repro` fecha
    // em zero porque o cenario dele nao desenha limite nenhum. Uma verificacao que passa por
    // ausencia do caso nao e verificacao dele.
    //
    // `setData` CRU AQUI, e nao `writeWholeCollection`, porque estas duas NAO foram migradas
    // para o despachante de diff: e o mesmo gesto que `restoreBoundaryDependentFeatures` ja
    // faz, e o guarda `despachante-sem-escrita-crua` so proibe a escrita crua sobre source
    // migrada.
    for (const derivada of ['boundary-circles', 'boundary-texts']) {
        mapInstance.getSource(derivada)?.setData(emptyCollection);
    }

    clearAllMeasurements();
}

export { updateAllLayerFilters, invalidateFilterCache } from './visibility-filter.js';
export { applyLayerOpacities, invalidateOpacityCache } from './layer-opacity-applier.js';
export { FEATURE_LAYER_IDS, HATCH_PATTERN_LAYERS, FEATURE_SOURCES } from './layer.constants.js';
