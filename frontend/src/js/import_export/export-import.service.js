// Path: js/import_export/export-import.service.js
import {
    getAllMapNamesStore,
    getCurrentMapName,
    getCurrentMapFeatures,
    getCurrentBaseLayer,
    setBaseLayer,
    MIN_SCHEMA_VERSION,
    compareVersions,
    addMap,
    setCurrentMap,
    clearAllDataStore,
    discardMapsForReplacingImport,
    isRemoteStoreSync,
    getImage,
    storeImage,
    setSchemaVersion,
    setGridStyle,
    getMapGroups,
    getLayers,
    setMapLayers,
    flushPendingLayerWrites,
    getMapPosition,
    getMapOrder,
    setMapOrder,
    processCatalogLayersOnImport,
    getCatalogLayers,
    setCesium3dDataForImport,
    setStreetview360DataForImport,
    setMapTemporalConfig,
    setMapComments,
    getBriefingsForExport,
    importBriefings,
    getCustomIconsForExport,
    restoreCustomIconsFromImport,
    getGroupManager,
} from '@store';
import { optionalSectionTasks } from './export-optional-sections.js';

import { IDUtils } from '@utils/id_utils.js';
import { showToast, showSuccess, showError, showWarning } from '@utils/toast_service.js';
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';
// Normalization/migration of imported data lives in its own module so it can be
// tested in node (this file pulls in JSZip, the @store barrel and modal UI).
import { migrateImportDataToV2, normalizeMapDataForCurrentVersion } from './import-normalize.js';
import { EventTypes } from '@events/event_types.js';
import { showExportModal } from '@modals/export.modal.js';
import { showConfirm } from '@modals/confirm.modal.js';
// A PODA DE SAÍDA. Módulos diretos, não o barrel de `@catalog`: este arquivo já é pesado e
// o podador é puro de propósito.
import { podarDocumentoDeExportacao } from '@catalog/private-reference-pruner.js';
import { construirResolverDeSaida, descreverPerdas } from '@catalog/resource-reference.resolver.js';
// The ONE entry into a brand-new local atlas (see `switchToNewLocalAtlas`). Importing a `.ebgeo`
// with a server project open is not a wipe-in-place, it is a change of atlas, and the pipeline that
// owns "which atlas this tab holds" owns it too — spreading a sixth improvised entry through this
// file is exactly the defect phase E3 exists to prevent.
import { switchToNewLocalAtlas } from '@js/account/open-atlas.service.js';
// WHICH namespace this tab has mounted, which is what the import actually writes into. See
// `_prepareNonAdditiveTarget` for why the origin marker alone is not enough to answer it.
import { getActiveScope, StoreScopeKind } from '@store/atlas-namespace.js';
// SHARED with the chooser page's "Importar .ebgeo" (which creates a SERVER atlas from the same
// file), so both surfaces derive the same project name from the same filename. A second copy of
// this rule would drift, and the name is the only thing the user sees before opening the project.
import { atlasNameFromFilename } from '@js/projects/import-ebgeo.service.js';
import JSZip from 'jszip';
import config from '@js/config.js';
import { pruneCatalogLayerDefinitions } from '@catalog/catalog-layer.ref.js';

/**
 * Whether an import right now would be writing into a SERVER atlas's databases.
 *
 * BOTH HALVES ARE ASKED, and the scope is the one that answers the question the import actually
 * cares about. `isRemoteStoreSync()` reads the origin MARKER, which speaks for the INSTALLATION;
 * the import writes into the namespace THIS TAB has MOUNTED. The product has an ordinary route to
 * making the two disagree: an `openRemoteAtlas` whose `connect` fails (403, atlas deleted on the
 * server, a backend hiccup) has already mounted `ebgeo_*__remote-<id>` and, in its catch, reverts
 * the marker to LOCAL without unmounting anything. Asking only the marker there reads back
 * "local atlas, replace in place", and the imported project is born inside a server namespace
 * that the next logged-out load sweeps away, with no error at any point.
 *
 * The marker is kept as the second half rather than dropped: it is what a REMOTE origin says
 * before this tab has mounted anything (the boot reads it to decide what to mount), and a
 * disagreement in that direction must also land on the safe branch. Either one saying REMOTE
 * sends the import to a brand-new local atlas, which is never destructive.
 *
 * @returns {boolean} True when the mounted namespace, or the persisted origin, is a server atlas.
 */
function writingIntoServerAtlas() {
    return getActiveScope()?.kind === StoreScopeKind.REMOTE || isRemoteStoreSync();
}

/**
 * Checks if import data is in v1.x format (pre-v2.0).
 * @param {Object} data - Import data
 * @returns {boolean} True if v1.x format
 */
function isV1Format(data) {
    if (data.atlas) return false;
    if (data.schemaVersion && compareVersions(data.schemaVersion, '2.0') >= 0) return false;
    return data.version && compareVersions(data.version, '2.0') < 0;
}

export class ExportImportService {
    constructor(baseLayerControl, toolManager, mapManager, eventBus = null) {
        this.baseLayerControl = baseLayerControl;
        this._toolManager = toolManager;
        this.mapManager = mapManager;
        this._eventBus = eventBus;
    }

    /**
     * Rounds coordinates to 1 meter precision (6 decimal places).
     * @param {Array} coords - Coordinate array to round
     * @returns {Array} Rounded coordinates
     */
    roundCoordinates(coords) {
        if (Array.isArray(coords[0])) {
            return coords.map(coord => this.roundCoordinates(coord));
        }
        // NAO-FINITO NAO E ARREDONDAVEL, e passava intacto para dentro do `.ebgeo`: `NaN` e
        // `+-Infinity` sobreviviam, e `null` virava 0 (porque `null * 1e6 === 0`), gravando uma
        // coordenada INVENTADA no arquivo que circula por e-mail e pendrive. Preservar a entrada
        // e a resposta certa aqui: quem valida geometria e o import do outro lado, e trocar lixo
        // por um zero plausivel e o que faz o defeito chegar longe da causa.
        return coords.map(coord => (Number.isFinite(coord) ? Math.round(coord * 1e6) / 1e6 : coord));
    }

    /**
     * Optimizes individual feature by rounding coordinates
     * @param {Object} feature - Feature to optimize
     * @returns {Object} Optimized feature
     */
    optimizeFeature(feature) {
        const optimized = { ...feature };

        if (optimized.geometry && optimized.geometry.coordinates) {
            optimized.geometry.coordinates = this.roundCoordinates(optimized.geometry.coordinates);
        }

        return optimized;
    }

    /**
     * Optimizes map data by processing all features
     * @param {Object} mapData - Map data to optimize
     * @returns {Object} Optimized map data
     */
    optimizeMapData(mapData) {
        const optimized = { ...mapData };

        if (optimized.features) {
            for (const [category, features] of Object.entries(optimized.features)) {
                if (Array.isArray(features)) {
                    optimized.features[category] = features.map(feature =>
                        this.optimizeFeature(feature)
                    );
                }
            }
        }

        return optimized;
    }

    /**
     * Detects correct file extension based on blob MIME type
     * @param {Blob} blob - Blob to analyze
     * @returns {string} File extension
     */
    getBlobExtension(blob) {
        // NORMALIZA ANTES DO SWITCH: um `Blob` real carrega o tipo em minusculas, mas o valor vem
        // de fora (canvas, arquivo escolhido pela pessoa, sync) e as duas formas legitimas do
        // cabecalho MIME quebravam o casamento exato. Medido em 2026-08-24: `IMAGE/JPEG` e
        // `image/jpeg; charset=binary` caiam no `default` e a foto era gravada como `.png`. O
        // parametro sai no `;`, e o resto vira minusculo.
        const mimeType = String(blob.type || 'image/png').split(';')[0].trim().toLowerCase();
        switch (mimeType) {
            case 'image/svg+xml': return 'svg';
            case 'image/jpeg': return 'jpg';
            case 'image/webp': return 'webp';
            case 'image/png':
            default: return 'png';
        }
    }

    /**
     * Simple XOR operation to mask data
     * @param {Uint8Array} data - Data to mask
     * @param {number} key - XOR key (default 0xAA)
     * @returns {Uint8Array} Masked data
     */
    xorData(data, key = 0xAA) {
        const result = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            result[i] = data[i] ^ key;
        }
        return result;
    }

    /**
     * Creates save/export button
     * @returns {HTMLElement} Save button element
     */
    createSaveButton() {
        const saveButton = document.createElement('button');
        saveButton.className = 'map-action-button save-action';
        saveButton.innerHTML = `<img src="./images/icon_save_black.svg" alt="Exportar atlas" />`;
        saveButton.title = 'Exportar atlas';

        saveButton.onclick = () => {
            this.showExportModal();
        };

        return saveButton;
    }

    /**
     * Shows the export modal for map selection
     */
    showExportModal() {
        showExportModal(async (selectedMaps) => {
            await this.handleExport(selectedMaps);
        });
    }

    /**
     * Creates load/import button (replaces current)
     * @returns {HTMLElement} Load button element
     */
    createLoadButton() {
        const loadButton = document.createElement('button');
        loadButton.className = 'map-action-button load-action';
        loadButton.innerHTML = `<img src="./images/icon_load_black.svg" alt="Importar atlas" />`;
        loadButton.title = 'Importar atlas (substitui atual)';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.ebgeo';
        fileInput.className = 'hidden-file-input';
        fileInput.onchange = async (event) => {
            await this.handleImport(event, false);
        };

        loadButton.onclick = () => {
            fileInput.click();
        };

        loadButton.appendChild(fileInput);
        return loadButton;
    }

    /**
     * Creates additive load button (adds to current project)
     * @returns {HTMLElement} Additive load button element
     */
    createLoadAdditiveButton() {
        const loadAdditiveButton = document.createElement('button');
        loadAdditiveButton.className = 'map-action-button load-action';
        loadAdditiveButton.innerHTML = `<img src="./images/icon_folder_plus_black.svg" alt="Adicionar ao atlas" />`;
        loadAdditiveButton.title = 'Adicionar ao atlas atual';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.ebgeo';
        fileInput.className = 'hidden-file-input';
        fileInput.onchange = async (event) => {
            await this.handleImport(event, true);
        };

        loadAdditiveButton.onclick = () => {
            fileInput.click();
        };

        loadAdditiveButton.appendChild(fileInput);
        return loadAdditiveButton;
    }

    /**
     * Handles project export to .ebgeo file
     * @param {string[]|null} selectedMaps - Optional array of map names to export. If null, exports all maps.
     */
    /**
     * Builds the in-memory `.ebgeo` data object (the same structure `handleExport` serializes into
     * `data.json`) WITHOUT zipping — used by "Salvar atlas local no servidor" to feed the
     * server-import transform (`local-atlas-to-server.js`). This MIRRORS handleExport's data-building
     * block; keep the two in sync (a field added to the export must be added here too — P9/P11).
     * @param {string[]} mapsToExport - Map names to include.
     * @returns {Promise<Object>} The export data object.
     */
    async buildExportDataObject(mapsToExport) {
        // ANTES DE QUALQUER LEITURA, e uma vez so para o documento inteiro. As secoes de camada
        // e de grupo leem o REPOSITORIO (ver o cabecalho de `export-optional-sections.js`: ler
        // memoria entregava as camadas de todo mapa nao visitado como uma `default` inventada,
        // e a secao de grupos vazia). A escrita de camada e adiada em 300 ms, entao sem este
        // descarregamento o documento sairia com o estado anterior a ultima edicao, que e trocar
        // uma perda grande por uma pequena. Nao ha o que descarregar para grupos: eles
        // persistem por `setTimeout(..., 0)`, sem represa.
        await flushPendingLayerWrites();

        const currentMapName = await getCurrentMapName();
        const exportCurrentMap = mapsToExport.includes(currentMapName) ? currentMapName : mapsToExport[0];
        const fullMapOrder = await getMapOrder();
        const filteredMapOrder = fullMapOrder.filter((name) => mapsToExport.includes(name));

        const data = {
            version: ATLAS_SCHEMA_VERSION,
            currentMap: exportCurrentMap,
            mapOrder: filteredMapOrder,
            maps: {}, colorUsage: {}, mapNotes: {}, groups: {}, layers: {},
            cesium3d: {}, streetview360: {}, temporal: {}, gridStyle: {}, comments: {}, briefings: [],
        };

        for (const mapName of mapsToExport) {
            const mapData = await getCurrentMapFeatures(mapName);
            if (mapData) {
                const position = await getMapPosition(mapName);
                // The `.ebgeo` carries the REFERENCE, never the catalog row: an exported file
                // used to travel with `source.url` of every private layer in clear text.
                const catalogLayers = pruneCatalogLayerDefinitions(await getCatalogLayers(mapName));
                const fullMapData = {
                    baseLayer: await getCurrentBaseLayer(mapName),
                    hillshadeEnabled: true,
                    analysisLayers: {},
                    features: mapData,
                    catalogLayers: catalogLayers.length > 0 ? catalogLayers : undefined,
                    zoom: position.zoom,
                    center_lat: position.center_lat,
                    center_long: position.center_long,
                    bearing: position.bearing,
                    pitch: position.pitch,
                };
                data.maps[mapName] = this.optimizeMapData(fullMapData);
            }
            await this._exportOptionalMapData(data, mapName);
        }

        try {
            const briefings = await getBriefingsForExport();
            if (briefings?.length > 0) data.briefings = briefings;
        } catch (error) {
            console.warn('Could not export briefings:', error);
        }

        const customIcons = await getCustomIconsForExport();
        if (customIcons.length > 0) data.customIcons = customIcons;

        return data;
    }

    /**
     * O MESMO documento de `buildExportDataObject`, com toda referência a recurso de
     * catálogo que não seja comprovadamente PÚBLICA retirada.
     *
     * A poda vale para TODO `.ebgeo`, inclusive o de atlas local e inclusive quando quem
     * exporta é o dono: fora do servidor não existe ponto de imposição, e o arquivo
     * circula por e-mail e pendrive independentemente da origem. Dois comportamentos
     * seriam a segunda regra a divergir.
     *
     * @param {string[]} mapsToExport
     * @returns {Promise<{data: Object, relatorio: Object}>}
     * @throws {ResourceSumMissingError} Quando há sessão viva e a soma de recursos
     *   privados nunca aconteceu: podar às cegas apagaria o acervo legítimo do usuário.
     */
    async buildPrunedExportData(mapsToExport) {
        const resolver = await construirResolverDeSaida();
        const bruto = await this.buildExportDataObject(mapsToExport);
        const { documento, relatorio } = podarDocumentoDeExportacao(bruto, resolver);
        return { data: documento, relatorio };
    }

    /**
     * Os ids de imagem que o `.ebgeo` precisa carregar: as feições de imagem de cada mapa
     * mais os ícones personalizados.
     *
     * Derivado do documento JÁ MONTADO, e não colhido no mesmo laço que o monta: as duas
     * cópias do bloco de montagem divergiram uma vez (o bug dos grupos anotado neste
     * arquivo) e a poda é justamente a regra que não pode ter duas versões.
     * @param {Object} data - O documento de exportação.
     * @returns {Set<string>}
     */
    collectUsedImageIds(data) {
        const usedImages = new Set();
        for (const mapa of Object.values(data.maps || {})) {
            for (const features of Object.values(mapa?.features || {})) {
                if (!Array.isArray(features)) continue;
                for (const feature of features) {
                    if (feature?.properties?.id) usedImages.add(feature.properties.id);
                }
            }
        }
        for (const icon of (data.customIcons || [])) {
            if (icon?.id) usedImages.add(icon.id);
        }
        return usedImages;
    }

    async handleExport(selectedMaps = null) {
        try {
            this._toolManager.deactivateCurrentTool();

            const zip = new JSZip();

            // Use selected maps or fall back to all maps
            const allMaps = await getAllMapNamesStore();
            const mapsToExport = selectedMaps || allMaps;

            if (mapsToExport.length === 0) {
                showWarning('Nenhum mapa para exportar');
                return;
            }

            let data;
            let relatorio;
            try {
                ({ data, relatorio } = await this.buildPrunedExportData(mapsToExport));
            } catch (error) {
                if (error?.name === 'ResourceSumMissingError') {
                    showError(error.message);
                    return;
                }
                throw error;
            }

            const perdas = descreverPerdas(relatorio);
            if (perdas) {
                // O TÍTULO NÃO AFIRMA "RESTRITO", e a mudança é por um perfil inteiro. Sem
                // sessão nada é privado para este cliente, então o visitante ANÔNIMO perdia só
                // referência não classificável (todo o 360, por decisão registrada) e lia um
                // aviso dizendo que perdia recurso restrito. Quem separa as duas naturezas é
                // `descreverPerdas`; aqui fica a moldura, que passou a nomear a REGRA (só o
                // comprovadamente público viaja) em vez de nomear uma das duas perdas.
                // Sem crase: `ConfirmModal` desenha a mensagem como texto puro.
                const seguir = await showConfirm('Este arquivo sai sem parte do catálogo', {
                    message: 'Um arquivo .ebgeo circula por e-mail e pendrive, e fora do '
                        + 'servidor não há como conferir quem pode ver o quê: só o recurso de '
                        + 'catálogo comprovadamente público viaja nele. Sai desta cópia:\n\n'
                        + perdas
                        + '\n\nO conteúdo desenhado por você (feições, camadas, textos) vai inteiro.',
                    confirmText: 'Exportar assim',
                    cancelText: 'Cancelar',
                });
                if (!seguir) return;
            }

            const usedImages = this.collectUsedImageIds(data);

            zip.file('data.json', JSON.stringify(data), {
                compression: 'DEFLATE',
                compressionOptions: { level: 9 }
            });

            // Add images to ZIP with correct extension based on MIME type
            for (const imageId of usedImages) {
                try {
                    const blob = await getImage(imageId);
                    if (blob) {
                        const extension = this.getBlobExtension(blob);
                        zip.file(`images/${imageId}.${extension}`, blob, {
                            compression: 'DEFLATE',
                            compressionOptions: { level: 9 }
                        });
                    }
                } catch (_error) {
                    console.warn('Image not found:', imageId);
                }
            }

            // Generate ZIP file
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 9 },
                streamFiles: true
            });

            // Apply XOR to ZIP data for masking
            const zipArray = new Uint8Array(await zipBlob.arrayBuffer());
            const maskedData = this.xorData(zipArray);

            // Add identifier at the beginning to detect XOR file
            const identifier = new TextEncoder().encode('EBGXOR');
            const finalArray = new Uint8Array(identifier.length + maskedData.length);
            finalArray.set(identifier, 0);
            finalArray.set(maskedData, identifier.length);

            // Create final blob
            const finalBlob = new Blob([finalArray], {
                type: 'application/vnd.ebgeo'
            });

            const url = URL.createObjectURL(finalBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `atlas-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.ebgeo`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showSaveSuccess(mapsToExport.length);

        } catch (error) {
            console.error('Erro ao exportar dados:', error);
            showError('Erro ao exportar arquivo .ebgeo');
        }
    }

    /**
     * Handles project import from .ebgeo file
     * @param {Event} event - File input change event
     * @param {boolean} isAdditiveImport - Whether to add to current project or replace
     */
    async handleImport(event, isAdditiveImport) {
        this._toolManager.deactivateCurrentTool();

        const file = event.target.files[0];
        if (!file) return;

        // O IMPORT ADITIVO NÃO ENTRA EM ATLAS DE SERVIDOR, e este é o caso que "criar um atlas
        // local novo" não resolve: aditivo significa SOMAR ao projeto que está aberto, e um atlas
        // novo não tem a que somar. Somar de verdade seria criar mapas, camadas e feições DENTRO
        // do atlas do servidor, o que exige permissão de escrita (o guard nem é consultado aqui) e
        // uma rodada de sync por entidade. A recusa nomeia a saída, que existe logo ao lado.
        if (isAdditiveImport && writingIntoServerAtlas()) {
            showError(
                'Não é possível adicionar um arquivo ao atlas do servidor que está aberto. '
                + 'Use "Importar .ebgeo", que abre o arquivo em um atlas local novo.',
                { duration: 10000 }
            );
            event.target.value = '';
            return;
        }

        // Preenchido só quando o import trocou de atlas, para a frase que explica isso ao usuário.
        let newLocalAtlasName = null;

        try {
            const fileBuffer = await file.arrayBuffer();
            const fileArray = new Uint8Array(fileBuffer);

            let zipData;
            const identifier = new TextDecoder().decode(fileArray.slice(0, 6));

            if (identifier === 'EBGXOR') {
                const maskedData = fileArray.slice(6);
                zipData = this.xorData(maskedData);
            } else {
                zipData = fileArray;
            }

            const zip = await JSZip.loadAsync(zipData);

            const dataFile = zip.file('data.json');
            if (!dataFile) {
                throw new Error('Arquivo data.json não encontrado no .ebgeo');
            }

            const dataJson = await dataFile.async('string');
            let data = JSON.parse(dataJson);

            if (!data.version) {
                throw new Error('Arquivo .ebgeo sem informação de versão. Use a versão mais recente da aplicação para gerar o arquivo.');
            }

            // Migrate v1.x data to v2.0 format if needed
            if (isV1Format(data)) {
                console.log(`Migrating import data from v${data.version} to v${ATLAS_SCHEMA_VERSION}`);
                data = migrateImportDataToV2(data);
            }

            // Check version compatibility (after potential migration)
            if (compareVersions(data.version, MIN_SCHEMA_VERSION) < 0) {
                throw new Error(`Arquivo .ebgeo incompatível. Versão do arquivo: ${data.version}, versão mínima aceita: ${MIN_SCHEMA_VERSION}`);
            }
            if (compareVersions(data.version, ATLAS_SCHEMA_VERSION) > 0) {
                throw new Error(`Arquivo .ebgeo incompatível - versão muito recente. Versão do arquivo: ${data.version}, versão máxima aceita: ${ATLAS_SCHEMA_VERSION}. Atualize a aplicação para usar este arquivo.`);
            }

            // Non-additive import replaces the whole project. Decided (and executed) ONLY after
            // the archive has been parsed and the version validated above, so a corrupt or
            // incompatible file can no longer wipe the current project — nor spend a local atlas
            // slot — before we know it is loadable.
            if (!isAdditiveImport) {
                const target = await this._prepareNonAdditiveTarget(file);
                if (!target.ok) {
                    showError(target.message, { duration: 10000 });
                    event.target.value = '';
                    return;
                }
                newLocalAtlasName = target.atlasName;
            }

            await setSchemaVersion(ATLAS_SCHEMA_VERSION);

            let importedMapsCount = 0;
            let totalUnavailableCatalogLayers = 0;

            if (isAdditiveImport) {
                await this.loadImagesFromZip(zip);

                const existingMapNames = await getAllMapNamesStore();
                const mapsToImport = Object.keys(data.maps).length;

                if (existingMapNames.length + mapsToImport > 100) {
                    throw new Error(`Limite de mapas excedido. Você tem ${existingMapNames.length} mapas, tentando importar ${mapsToImport}. Limite: 100 mapas.`);
                }

                const mapNameMapping = new Map();
                const newlyCreatedMaps = new Set();

                for (const [originalMapName, mapData] of Object.entries(data.maps)) {
                    // Find unique name
                    let finalMapName = originalMapName;
                    let counter = 1;
                    while (existingMapNames.includes(finalMapName)) {
                        finalMapName = `${originalMapName}_${counter}`;
                        counter++;
                    }

                    newlyCreatedMaps.add(finalMapName);

                    // Create layer ID mapping BEFORE regenerating feature IDs
                    // This ensures features get the correct new layer IDs
                    const layerIdMapping = new Map();
                    const originalLayers = data.layers?.[originalMapName] || [];
                    for (const layer of originalLayers) {
                        if (layer.id === 'default') {
                            layerIdMapping.set('default', 'default');
                        } else {
                            layerIdMapping.set(layer.id, IDUtils.generateUniqueId());
                        }
                    }

                    // Regenerate feature IDs with layer ID mapping.
                    // `idMapping` (oldFeatureId -> newFeatureId) must be kept: the groups of this
                    // map still reference the OLD feature ids and would import empty without it.
                    const { newMapData, idMapping } = await IDUtils.regenerateMapIds(mapData, finalMapName, layerIdMapping);

                    // Normalizar estrutura para versão atual
                    const { unavailableCatalogLayersCount } = normalizeMapDataForCurrentVersion(newMapData, processCatalogLayersOnImport);
                    totalUnavailableCatalogLayers += unavailableCatalogLayersCount;

                    // Get original data from file to preserve colors and notes
                    const originalColorUsage = data.colorUsage?.[originalMapName] || null;
                    const originalNotes = data.mapNotes?.[originalMapName] || null;

                    // Pass colors and notes to preserve original data
                    await addMap(finalMapName, newMapData, originalColorUsage, originalNotes);
                    existingMapNames.push(finalMapName);
                    importedMapsCount++;

                    // Store mapping with layer ID mapping for importLayersAdditively
                    // and feature ID mapping for importGroupsAdditively
                    mapNameMapping.set(originalMapName, { finalMapName, layerIdMapping, idMapping });
                }

                // Import groups with updated map names
                await this.importGroupsAdditively(data.groups, mapNameMapping);

                // Import layers with updated map names (pass newlyCreatedMaps to avoid creating extra default layers)
                await this.importLayersAdditively(data.layers, mapNameMapping, newlyCreatedMaps);

                // Import cesium 3D data additively
                await this._importMappedData(data.cesium3d, setCesium3dDataForImport, mapNameMapping, 'cesium 3D data');

                // Import street view 360 data additively
                await this._importMappedData(data.streetview360, setStreetview360DataForImport, mapNameMapping, '360 data');

                // Import per-map temporal config additively
                await this._importMappedData(data.temporal, setMapTemporalConfig, mapNameMapping, 'temporal config');

                // Import per-map grid style additively
                await this._importMappedData(data.gridStyle, setGridStyle, mapNameMapping, 'grid style');

                // Import per-map spatial comments additively
                await this._importMappedData(data.comments, setMapComments, mapNameMapping, 'comments');

                // Import briefings (additive import - no overwrite)
                await this._importBriefings(data.briefings, false);

            } else {
                // O ESCOPO PRECISA ESTAR VAZIO DE MAPAS ANTES DA PRIMEIRA ESCRITA. O wipe acima
                // (ou o slot local recém-criado, no ramo do servidor) deixa um "Principal" em
                // branco chaveado pelo NOME, e `addMap` grava os do arquivo chaveados por UUID:
                // os dois coexistiriam sob o mesmo nome, a lista mostraria um cartão só e a
                // leitura por nome acertaria o em branco, escondendo as feições do arquivo.
                // Guardado pelo caso vazio: um arquivo sem mapa nenhum deixaria o app sem mapa.
                if (Object.keys(data.maps).length > 0) {
                    await discardMapsForReplacingImport();
                }

                for (const [mapName, mapData] of Object.entries(data.maps)) {
                    // Normalizar estrutura para versão atual
                    const { unavailableCatalogLayersCount } = normalizeMapDataForCurrentVersion(mapData, processCatalogLayersOnImport);
                    totalUnavailableCatalogLayers += unavailableCatalogLayersCount;

                    const colorUsageData = data.colorUsage?.[mapName] || null;
                    const notesData = data.mapNotes?.[mapName] || null;
                    await addMap(mapName, mapData, colorUsageData, notesData);
                    importedMapsCount++;
                }

                await setCurrentMap(data.currentMap);

                // Import groups directly (normal import)
                await this.importGroupsDirectly(data.groups);

                // Import layers directly (normal import)
                await this.importLayersDirectly(data.layers);

                // Import cesium 3D data directly (normal import)
                await this._importMappedData(data.cesium3d, setCesium3dDataForImport, null, 'cesium 3D data');

                // Import street view 360 data directly (normal import)
                await this._importMappedData(data.streetview360, setStreetview360DataForImport, null, '360 data');

                // Import per-map temporal config directly (normal import)
                await this._importMappedData(data.temporal, setMapTemporalConfig, null, 'temporal config');

                // Import per-map grid style directly (normal import)
                await this._importMappedData(data.gridStyle, setGridStyle, null, 'grid style');

                // Import per-map spatial comments directly (normal import)
                await this._importMappedData(data.comments, setMapComments, null, 'comments');

                // Import briefings (normal import - overwrite if same ID)
                await this._importBriefings(data.briefings, true);

                // Restore map order if available
                if (data.mapOrder && Array.isArray(data.mapOrder) && data.mapOrder.length > 0) {
                    await setMapOrder(data.mapOrder);
                }

                // Load images after processing maps (normal import)
                await this.loadImagesFromZip(zip);
            }

            // Restore custom point-icon registry (blobs already restored above).
            // Non-additive import replaces the project, so replace the registry;
            // additive import merges into the existing one.
            await restoreCustomIconsFromImport(data.customIcons, { replace: !isAdditiveImport });

            // Notify about unavailable catalog layers
            if (totalUnavailableCatalogLayers > 0) {
                this._notifyUnavailableCatalogLayers(totalUnavailableCatalogLayers);
            }

            const currentBaseLayer = isAdditiveImport ?
                await getCurrentBaseLayer() :
                data.maps[await getCurrentMapName()]?.baseLayer;

            const validBaseLayer = config.getValidBasemapFallback(currentBaseLayer);

            await setBaseLayer(validBaseLayer);

            await this.baseLayerControl.switchMap();

            // Notify sidebar to refresh map list
            if (this._eventBus) {
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            }

            const importType = isAdditiveImport ? 'adicionados' : 'carregados';
            this.showLoadSuccess(importedMapsCount, importType);

            if (newLocalAtlasName) {
                showToast(
                    `Importado em um atlas local novo, "${newLocalAtlasName}". `
                    + 'O atlas do servidor foi fechado e continua intacto em "Seus atlas".',
                    'info',
                    8000
                );
            }

        } catch (error) {
            console.error('Erro ao importar arquivo:', error);
            showError('Erro ao carregar arquivo .ebgeo: ' + error.message);
        }

        event.target.value = '';
    }

    /**
     * Decides WHERE a non-additive import lands, and puts the store there.
     *
     * TWO TARGETS, and the difference is whose data is at stake.
     *
     * On a LOCAL atlas the import replaces it IN PLACE, which is literally what the button says
     * ("Importar atlas (substitui atual)") and what it has always done. Minting a slot per
     * import instead would burn the cap of 10 in ten imports, for a wipe the user asked for on
     * their own workspace.
     *
     * On a SERVER atlas replacing in place is not an option: the wipe would land on
     * `ebgeo_*__remote-<id>`, i.e. the databases another tab may be writing to, and the imported
     * project would be born inside a namespace the next logout destroys — which is how it lost
     * projects silently before this branch existed. So the import LEAVES the server atlas for a
     * brand-new local one (`switchToNewLocalAtlas`, which owns the order and the tab-lock claim).
     *
     * THE CAP DEGRADES TO A REFUSAL, NEVER TO AN EXCEPTION AND NEVER TO A WIPE. `createLocalAtlas`
     * runs first inside the switch precisely so a full registry costs the user nothing: the socket
     * is still up and the server project still open when this returns `ok: false`.
     *
     * WHICH QUESTION DECIDES is `writingIntoServerAtlas()`, and the reason it is not
     * `isRemoteStoreSync()` alone is written there.
     *
     * @param {File} file - The `.ebgeo` being imported; its name becomes the new atlas's name.
     * @returns {Promise<{ok: boolean, message?: string, atlasName?: string}>} `atlasName` is set
     *   only when the store changed atlas, so the caller can say so.
     * @private
     */
    async _prepareNonAdditiveTarget(file) {
        if (!writingIntoServerAtlas()) {
            await clearAllDataStore();
            return { ok: true };
        }

        let result;
        try {
            result = await switchToNewLocalAtlas(atlasNameFromFilename(file?.name));
        } catch (error) {
            // Past the refusal there is nothing left that destroys data (the wipe targets the new,
            // empty slot), so this is a persistence failure. The server project may already be
            // closed, so the message must not promise that nothing changed.
            console.error('[import] failed to switch to a new local atlas:', error);
            return {
                ok: false,
                message: 'Não foi possível preparar um atlas local para receber a importação. '
                    + 'Nada foi importado; reabra o atlas em "Seus atlas" e tente de novo.'
            };
        }

        if (!result.ok) {
            return {
                ok: false,
                message: `${result.message} O atlas do servidor continua aberto e nada foi alterado.`
            };
        }
        return { ok: true, atlasName: result.atlas.name };
    }

    /**
     * Imports groups directly (normal import - replaces everything)
     * @param {Object} groupsData - Groups data to import
     */
    async importGroupsDirectly(groupsData) {
        if (!groupsData || Object.keys(groupsData).length === 0) {
            return;
        }

        try {
            for (const [mapName, mapGroups] of Object.entries(groupsData)) {
                if (mapGroups && Object.keys(mapGroups).length > 0) {
                    await getGroupManager().importMapGroups(mapName, mapGroups, { replace: true });
                }
            }
        } catch (error) {
            console.error('Error importing groups directly:', error);
        }
    }

    /**
     * Imports groups additively (additive import - with conflict resolution)
     * @param {Object} groupsData - Groups data to import
     * @param {Map} mapNameMapping - Mapping of original to final map names
     */
    async importGroupsAdditively(groupsData, mapNameMapping) {
        if (!groupsData || Object.keys(groupsData).length === 0) {
            return;
        }

        try {
            for (const [originalMapName, mapGroups] of Object.entries(groupsData)) {
                const mappingEntry = mapNameMapping.get(originalMapName);
                const finalMapName = mappingEntry?.finalMapName || mappingEntry;

                if (!finalMapName || !mapGroups || Object.keys(mapGroups).length === 0) {
                    continue;
                }

                const processedGroups = await this.processGroupsForAdditiveImport(
                    mapGroups, finalMapName, mappingEntry?.idMapping || null,
                );
                await getGroupManager().importMapGroups(finalMapName, processedGroups);
            }
        } catch (error) {
            console.error('Error importing groups additively:', error);
        }
    }

    /**
     * Processes groups for additive import (new IDs and unique names)
     * @param {Object} mapGroups - Groups to process
     * @param {string} mapName - Target map name
     * @param {Map<string, string>} [idMapping=null] - oldFeatureId -> newFeatureId from regenerateMapIds
     * @returns {Object} Processed groups
     */
    async processGroupsForAdditiveImport(mapGroups, mapName, idMapping = null) {
        const processedGroups = {};
        // getMapGroups is SYNCHRONOUS and returns a PLAIN OBJECT keyed by group id
        // (memoryStore.groups[map]) — never a Map. Calling `.values()` on it threw a
        // TypeError that aborted the group import for EVERY map of the archive.
        const existingGroups = getMapGroups(mapName);
        const existingNames = new Set();

        for (const group of Object.values(existingGroups || {})) {
            existingNames.add(group.name);
        }

        Object.values(mapGroups).forEach(group => {
            const newGroupId = IDUtils.generateUniqueId();

            let finalName = group.name;
            let counter = 1;
            while (existingNames.has(finalName)) {
                finalName = `${group.name}_${counter}`;
                counter++;
            }
            existingNames.add(finalName);

            const processed = {
                ...group,
                id: newGroupId,
                name: finalName
            };

            // Feature ids were regenerated before the map was added, so group members
            // must follow the mapping or the imported group points at ids that no
            // longer exist (group looks empty).
            if (Array.isArray(group.features)) {
                processed.features = group.features.map(featureRef => ({
                    type: featureRef.type,
                    id: idMapping?.get(featureRef.id) || featureRef.id
                }));
            }

            processedGroups[newGroupId] = processed;
        });

        return processedGroups;
    }

    /**
     * Imports layers directly (normal import - replaces everything)
     * @param {Object} layersData - Layers data to import
     */
    async importLayersDirectly(layersData) {
        if (!layersData || Object.keys(layersData).length === 0) {
            return;
        }

        try {
            for (const [mapName, layers] of Object.entries(layersData)) {
                if (layers && Array.isArray(layers) && layers.length > 0) {
                    await setMapLayers(mapName, { layers });
                }
            }
        } catch (error) {
            console.error('Error importing layers directly:', error);
        }
    }

    /**
     * Imports layers additively (additive import - with conflict resolution)
     * @param {Object} layersData - Layers data to import
     * @param {Map} mapNameMapping - Mapping of original to final map names (with layerIdMapping)
     * @param {Set} newlyCreatedMaps - Set of map names that were just created during import
     */
    async importLayersAdditively(layersData, mapNameMapping, newlyCreatedMaps) {
        if (!layersData || Object.keys(layersData).length === 0) {
            return;
        }

        try {
            for (const [originalMapName, layers] of Object.entries(layersData)) {
                const mappingEntry = mapNameMapping.get(originalMapName);
                const finalMapName = mappingEntry?.finalMapName || mappingEntry;
                const layerIdMapping = mappingEntry?.layerIdMapping || null;

                if (!finalMapName || !layers || !Array.isArray(layers) || layers.length === 0) {
                    continue;
                }

                // If this map was just created during import, set layers directly
                // (don't try to merge with the auto-created default layer)
                if (newlyCreatedMaps.has(finalMapName)) {
                    const processedLayers = layers.map(layer => {
                        // Use the pre-generated layer ID from layerIdMapping if available
                        // This ensures features already have the correct layerId
                        const newId = layerIdMapping?.get(layer.id) || (layer.id === 'default' ? 'default' : IDUtils.generateUniqueId());
                        return {
                            ...layer,
                            id: newId
                        };
                    });
                    await setMapLayers(finalMapName, { layers: processedLayers });
                    continue;
                }

                // For existing maps, merge with existing layers
                const existingLayers = await getLayers(finalMapName) || [];
                const existingNames = new Set(existingLayers.map(l => l.name));
                const existingIds = new Set(existingLayers.map(l => l.id));

                const processedLayers = layers.map(layer => {
                    // Use pre-generated ID from mapping if available, otherwise generate new one
                    let newId = layerIdMapping?.get(layer.id) || layer.id;
                    if (existingIds.has(newId) || (newId === 'default' && !layerIdMapping)) {
                        newId = IDUtils.generateUniqueId();
                    }

                    let finalName = layer.name;
                    let counter = 1;
                    while (existingNames.has(finalName)) {
                        finalName = `${layer.name}_${counter}`;
                        counter++;
                    }
                    existingNames.add(finalName);
                    existingIds.add(newId);

                    return {
                        ...layer,
                        id: newId,
                        name: finalName
                    };
                });

                const mergedLayers = [...existingLayers];
                processedLayers.forEach(layer => {
                    if (layer.id !== 'default' || !mergedLayers.some(l => l.id === 'default')) {
                        mergedLayers.push(layer);
                    }
                });

                await setMapLayers(finalMapName, { layers: mergedLayers });
            }
        } catch (error) {
            console.error('Error importing layers additively:', error);
        }
    }

    /**
     * Imports per-map data using a setter function.
     * Handles both direct (no mapping) and additive (with map name mapping) modes.
     * @param {Object} dataByMap - Data keyed by original map name
     * @param {Function} setter - Async function(mapName, data) to persist each entry
     * @param {Map|null} mapNameMapping - If provided, resolves original → final map names
     * @param {string} label - Human-readable label for error logging
     * @private
     */
    async _importMappedData(dataByMap, setter, mapNameMapping, label) {
        if (!dataByMap || Object.keys(dataByMap).length === 0) return;

        try {
            for (const [originalMapName, data] of Object.entries(dataByMap)) {
                if (!data) continue;

                let mapName = originalMapName;
                if (mapNameMapping) {
                    const entry = mapNameMapping.get(originalMapName);
                    mapName = entry?.finalMapName || entry;
                    if (!mapName) continue;
                }

                await setter(mapName, data);
            }
        } catch (error) {
            console.error(`Error importing ${label}:`, error);
        }
    }

    /**
     * Loads images from ZIP file into IndexedDB
     * @param {JSZip} zip - ZIP file object
     */
    async loadImagesFromZip(zip) {
        const imageFiles = Object.keys(zip.files).filter(name =>
            name.startsWith('images/') &&
            /\.(png|jpe?g|svg|webp)$/i.test(name)
        );

        for (const fileName of imageFiles) {
            try {
                const imageId = fileName.replace('images/', '').replace(/\.(png|jpe?g|svg|webp)$/i, '');
                const blob = await zip.file(fileName).async('blob');
                await storeImage(imageId, blob);
            } catch (imgError) {
                console.warn('Error loading image:', fileName, imgError);
            }
        }
    }

    /**
     * Flashes a success indicator on a button and shows a toast.
     * @param {string} btnSelector - CSS selector for the button to flash
     * @param {string} message - Success toast message
     * @private
     */
    _showButtonSuccess(btnSelector, message) {
        const btn = document.querySelector(btnSelector);
        if (btn) {
            const originalContent = btn.innerHTML;
            btn.classList.add('success');
            btn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';

            setTimeout(() => {
                btn.classList.remove('success');
                btn.innerHTML = originalContent;
            }, 1500);
        }

        showSuccess(message);
    }

    /**
     * Shows save success feedback
     * @param {number} mapCount - Number of maps saved
     */
    showSaveSuccess(mapCount) {
        const message = mapCount === 1 ? '1 mapa exportado!' : `${mapCount} mapas exportados!`;
        this._showButtonSuccess('.save-action', message);
    }

    /**
     * Shows load success feedback
     * @param {number} mapCount - Number of maps loaded
     * @param {string} importType - Type of import ('adicionados' or 'carregados')
     */
    showLoadSuccess(mapCount, importType) {
        const message = mapCount === 1 ? `1 mapa ${importType}!` : `${mapCount} mapas ${importType}!`;
        this._showButtonSuccess('.load-action', message);
    }

    /**
     * Notifies user about unavailable catalog layers during import.
     * @param {number} count - Number of unavailable catalog layers
     * @private
     */
    _notifyUnavailableCatalogLayers(count) {
        const layerWord = count === 1 ? 'camada' : 'camadas';
        showToast(
            `${count} ${layerWord} do catálogo não ${count === 1 ? 'está' : 'estão'} disponível nesta instância.`,
            'warning',
            5000
        );
    }

    /**
     * Imports briefings with the given overwrite strategy.
     * @param {Array} briefingsData - Briefings data to import
     * @param {boolean} overwrite - Whether to overwrite existing briefings with the same ID
     * @private
     */
    async _importBriefings(briefingsData, overwrite) {
        if (!Array.isArray(briefingsData) || briefingsData.length === 0) return;

        try {
            const result = await importBriefings(briefingsData, { overwrite });
            if (result.imported > 0) {
                const mode = overwrite ? '' : ' additively';
                console.log(`Imported ${result.imported} briefing(s)${mode}, skipped ${result.skipped}`);
            }
        } catch (error) {
            console.error('Error importing briefings:', error);
        }
    }

    /**
     * Exports optional per-map data (colors, notes, groups, layers, 3D, 360).
     * Each getter is wrapped in try/catch so one failure does not abort the export.
     * @param {Object} data - The export data object being built
     * @param {string} mapName - Map name to export
     * @private
     */
    async _exportOptionalMapData(data, mapName) {
        const tasks = optionalSectionTasks(mapName);

        for (const { key, fn, check, transform } of tasks) {
            try {
                const value = await fn();
                if (check(value)) {
                    data[key][mapName] = transform ? transform(value) : value;
                }
            } catch (error) {
                console.warn(`Could not export ${key} from map ${mapName}:`, error);
            }
        }
    }

    /**
     * Processes .ebgeo file directly (for drag & drop).
     * @param {File} file - .ebgeo file to process
     * @param {boolean} isAdditiveImport - Whether to add to current project
     */
    async processFileDirectly(file, isAdditiveImport = false) {
        const fakeEvent = {
            target: {
                files: [file],
                value: ''
            }
        };

        await this.handleImport(fakeEvent, isAdditiveImport);
    }
}
