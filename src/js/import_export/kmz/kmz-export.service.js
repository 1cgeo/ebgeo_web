// Path: js/import_export/kmz/kmz-export.service.js

/**
 * @fileoverview Orchestrates a vector KMZ export: reads a map's layers and
 * features, builds the KML document, packages assets with JSZip and triggers
 * the download.
 *
 * @module import_export/kmz/kmz-export.service
 */

import JSZip from 'jszip';
import { getCurrentMapFeatures, getLayersRepo, getSourceTypeFromStorage } from '@store';
import { showError, showSuccess } from '@utils/index.js';
import { createExportProgressModal } from '../export-utils.js';
import { StyleRegistry, buildFolder, buildKmlDocument, ORPHAN_FOLDER_NAME } from './kml-document.js';
import { AssetRegistry } from './kmz-assets.js';
import { mapFeatureToKml } from './kmz-feature-mapper.js';

/** Feature types that are analysis artefacts rather than drawn map content. */
const SKIPPED_TYPES = new Set(['los', 'visibility']);

/**
 * Flattens the per-type feature collection into a single list, tagging each
 * feature with its SOURCE (singular) type.
 *
 * The store keys this collection by storage type, which is plural and
 * irregular (`sector` -> `setores`, `boundary` -> `boundarys`), so the mapping
 * has to come from the store's own table rather than from string munging.
 *
 * @param {Object} collection - Feature collection keyed by storage type
 * @returns {Array<{feature: Object, featureType: string}>} Flattened features
 */
function flattenFeatures(collection) {
    const flattened = [];
    if (!collection || typeof collection !== 'object') return flattened;

    for (const [storageType, features] of Object.entries(collection)) {
        if (!Array.isArray(features)) continue;

        const featureType = getSourceTypeFromStorage(storageType);
        if (SKIPPED_TYPES.has(featureType)) continue;

        for (const feature of features) {
            if (feature?.properties?.deleted) continue;
            flattened.push({ feature, featureType });
        }
    }

    return flattened;
}

/**
 * Groups mapped KML elements by the layer their feature belongs to.
 *
 * @param {Array<{layerId: string, xml: string}>} entries - Mapped elements
 * @param {Array<Object>} layers - Layer definitions in display order
 * @returns {Array<string>} `<Folder>` elements, one per non-empty layer
 */
function buildFolders(entries, layers) {
    const byLayer = new Map();
    for (const entry of entries) {
        const key = entry.layerId || '';
        if (!byLayer.has(key)) byLayer.set(key, []);
        byLayer.get(key).push(entry.xml);
    }

    const folders = [];
    const consumed = new Set();

    for (const layer of layers) {
        const children = byLayer.get(layer.id);
        if (!children?.length) continue;
        consumed.add(layer.id);

        folders.push(buildFolder({
            name: layer.name || 'Camada',
            children,
            visible: layer.visible !== false,
            open: true,
        }));
    }

    // Features whose layer no longer exists must still reach the export.
    const orphans = [];
    for (const [layerId, children] of byLayer) {
        if (consumed.has(layerId)) continue;
        orphans.push(...children);
    }
    if (orphans.length > 0) {
        folders.push(buildFolder({ name: ORPHAN_FOLDER_NAME, children: orphans, open: true }));
    }

    return folders.filter(Boolean);
}

/**
 * Loads the layers of a map, tolerating maps whose layers are not in memory.
 *
 * @param {string} mapName - Target map name
 * @returns {Promise<Array<Object>>} Layers sorted by display order
 */
async function loadLayers(mapName) {
    try {
        const layers = await getLayersRepo(mapName);
        if (!Array.isArray(layers)) return [];
        return [...layers].sort((a, b) => (a.order || 0) - (b.order || 0));
    } catch (error) {
        // Without layers the export still works — everything lands in one folder.
        console.warn('KMZ export: could not load layers, grouping into a single folder', error);
        return [];
    }
}

/**
 * Triggers a browser download for the generated archive.
 *
 * @param {Blob} blob - KMZ payload
 * @param {string} fileName - Suggested file name
 */
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

/**
 * Exports a map as a vector KMZ file.
 *
 * @param {Object} params - Export parameters
 * @param {string} params.mapName - Name of the map to export
 * @param {Object} [params.options={}] - Export options
 * @param {boolean} [params.options.includePhotos=true] - Embed attachment photos
 * @param {boolean} [params.options.simulateDash=true] - Slice dashed lines geometrically
 * @returns {Promise<boolean>} Whether the export completed
 */
export async function exportMapAsKmz({ mapName, options = {} } = {}) {
    if (!mapName) {
        showError('Selecione um mapa para exportar');
        return false;
    }

    let cancelled = false;
    const progress = createExportProgressModal({
        title: 'Exportando KMZ...',
        onCancel: () => { cancelled = true; },
    });

    try {
        progress.updateProgress(5, 'Carregando feições...');

        const [collection, layers] = await Promise.all([
            getCurrentMapFeatures(mapName),
            loadLayers(mapName),
        ]);
        if (cancelled) return false;

        const features = flattenFeatures(collection);
        if (features.length === 0) {
            showError('O mapa selecionado não possui feições para exportar');
            progress.remove();
            return false;
        }

        const zip = new JSZip();
        const styles = new StyleRegistry();
        const assets = new AssetRegistry(zip);
        const entries = [];

        for (let i = 0; i < features.length; i++) {
            if (cancelled) return false;

            const { feature, featureType } = features[i];

            // Progress spans 10-85% across the feature pass.
            if (i % 25 === 0) {
                const pct = 10 + Math.round((i / features.length) * 75);
                progress.updateProgress(pct, `Convertendo feição ${i + 1} de ${features.length}...`);
                // Yield so the progress modal can repaint on large maps.
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            try {
                const xml = await mapFeatureToKml({ feature, featureType, styles, assets, options });
                if (xml) {
                    entries.push({ layerId: feature.properties?.layerId, xml });
                }
            } catch (error) {
                // One bad feature must not abort the whole export.
                console.warn(`KMZ export: skipped a ${featureType} feature`, error);
            }
        }

        if (cancelled) return false;

        if (entries.length === 0) {
            showError('Nenhuma feição pôde ser convertida para KMZ');
            progress.remove();
            return false;
        }

        progress.updateProgress(88, 'Gerando KML...');

        const kml = buildKmlDocument({
            name: mapName,
            description: `Exportado pelo EBGeo Web em ${new Date().toLocaleDateString('pt-BR')}`,
            styles,
            folders: buildFolders(entries, layers),
        });
        zip.file('doc.kml', kml);

        progress.updateProgress(93, 'Compactando KMZ...');

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        if (cancelled) return false;

        progress.updateProgress(100, 'Fazendo download...');

        const timestamp = new Date().toISOString().slice(0, 10);
        downloadBlob(blob, `ebgeo-${mapName}-${timestamp}.kmz`);

        setTimeout(() => progress.remove(), 800);
        showSuccess(`KMZ exportado com ${entries.length} feições`);
        return true;

    } catch (error) {
        console.error('Error exporting KMZ:', error);
        showError('Erro ao exportar KMZ: ' + error.message);
        progress.remove();
        return false;
    }
}
