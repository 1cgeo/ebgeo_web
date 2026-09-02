// Path: js/tool_manager/clipboard_manager.js

/**
 * @fileoverview Clipboard manager for copy/paste operations on features.
 * Delegates clipboard state to StateManager.
 *
 * ================= PASTE REFUSES OUT LOUD, AND BEFORE THE WORK ================
 *
 * `paste()` used to open with `if (isCurrentMapLockedSync()) return;` - a MUTE refusal - and
 * it consulted no permission at all. The second half was the expensive one: a Leitor on a
 * remote atlas reached `addFeatures`, whose `guardWrite` returns `undefined` in silence, and
 * nothing here read that return. The paste went on to update the map sources, auto-select
 * the "pasted" features and toast SUCCESS, right beside the refusal toast the store's own
 * listener was showing. On F5 the features were gone.
 *
 * Both gates now run BEFORE any work, and they speak through DIFFERENT channels on purpose:
 *
 *   - RANK is said here, with `denialNotice(perm.required)`, which is keyed by the
 *     capability the gate consulted and is therefore true for whoever reads it.
 *   - THE LOCK is said by `store/store-error-listener.js`, reached by emitting
 *     `STORE_OPERATION_BLOCKED` with `reason: 'map_locked'` - the same event every store op
 *     emits for the same state. This module lives in the `core` chunk and the toast channel
 *     that owns the lock sentence lives with the listener; emitting is how core says
 *     something without importing the layer that says it, and it costs zero new phrases.
 *
 * `paste()` returns a COUNT, and so does `copy()`, because "it worked" is a fact only the
 * caller can announce honestly: the context menu says how many were copied, and a zero from
 * either means the refusal has already been shown.
 *
 * ================= A PASTED BLOB EITHER TRAVELS OR IS REBUILT ==================
 *
 * `IDUtils.duplicateImageResource` is `getImage` + `storeImage`, both IndexedDB: copying a
 * feature that owns a picture writes the copy to THIS machine and to nowhere else, and there
 * is no incremental sync op for an image. So in a SERVER atlas every id this method mints has
 * to be answered on the peer's side by one of exactly two mechanisms, and which one applies is
 * a property of the TYPE:
 *
 *   - REBUILT. Military symbol, coordination measure and magnetic declination draw a raster
 *     generated on the client from their own synced properties, and the peer regenerates it
 *     through `layers/image-regen-registry.js`. Their bytes are never uploaded, by design.
 *   - UPLOADED. Everything else (today: the image feature) carries bytes nothing can
 *     reconstruct, so the copy goes up the bulk route, which is the only one that preserves a
 *     client-chosen id, through `uploadCopiedBlobsIfRemote` (`store/upload-copied-blobs.js`)
 *     and BEFORE `addFeatures` logs the feature ops.
 *
 * The registry is what tells the two apart here: it is filled eagerly at map boot by
 * `initToolRegistry` (`tool_manager/tool-registry.js`), so `paste` can ask by type instead of
 * carrying a list of its own. This file already paid for a hand-written list of image types
 * once, in `loadPastedImages`, and it was two families behind its twin.
 *
 * Until 2026-09-02 the upload half simply did not happen, and the failure was mute on both
 * sides: the collaborator got the feature and an empty frame, because `getImage` misses
 * locally, falls back to the backend, and takes a 404 that the loader turns into the error
 * placeholder. Guards: `frontend/tests/integration/colar-imagem-sobe-ao-servidor.repro.test.js`
 * and `frontend/tests/e2e-ui/browser-collab-colar-imagem.spec.js`.
 */

import {
    addFeatures,
    getImage,
    getCurrentMapNameSync,
    getStorageTypeFromSource,
    getSourceTypeFromStorage,
    isUncopyableFeatureType,
    hasImageResource,
    getStateManager,
    isCurrentMapLockedSync,
    buildLayerMappingForMove,
    emitStoreError,
    StoreErrorEvents
} from '../store';
import { checkPermission, GuardAction } from '@store/sync/permission-guard.js';
import { denialNotice } from '@store/denial-phrases.js';
import { uploadCopiedBlobsIfRemote } from '@store/upload-copied-blobs.js';
import { IDUtils, ToastService } from '../utilities';
import { pasteAnchor, offsetToTarget, translatePositionProperties } from './clipboard-offset.js';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { collectImageResourceIds } from '@layers/feature-images.js';
import { getImageRegenerator } from '@layers/image-regen-registry.js';
import { generatePointImage, needsPerFeatureImage } from '../draw_tools/point_tool/point-marker-symbols.js';
import { parseCustomMarker, registerCustomFeatureImage } from '../draw_tools/point_tool/point-custom-icons.js';

class ClipboardManager {
    constructor(selectionManager, map) {
        this.selectionManager = selectionManager;
        this.map = map;

        // Pixel offset is local config, not state
        this._pixelOffset = 30;

        // The copy() currently loading its lazy tool, if any. `paste()` awaits it so that a
        // paste issued right behind a copy sees THAT copy and not the previous clipboard.
        this._copyInFlight = null;
    }

    // =========================================================================
    // STATE MANAGER INTEGRATION
    // =========================================================================

    /**
     * Get clipboard data from StateManager.
     * @returns {Object}
     */
    get clipboard() {
        try {
            const data = getStateManager().getClipboard();
            return {
                features: data.features || [],
                copiedAt: data.copiedAt,
                sourceMapName: data.sourceMapName,
                pixelOffset: this._pixelOffset
            };
        } catch (_e) {
            return {
                features: [],
                copiedAt: null,
                sourceMapName: null,
                pixelOffset: this._pixelOffset
            };
        }
    }

    // =========================================================================
    // CORE METHODS
    // =========================================================================

    /**
     * Copy features to the clipboard.
     *
     * ASYNC BECAUSE OF LAZY TOOLS, not because copying is slow. Since 2026-08-25 only six
     * controls are eager; every other tool becomes an instance on first use. Both
     * `filterCopiableFeatures` and `cleanFeatureForCopy` read `selectionManager.controls`
     * DIRECTLY, so a feature drawn by a tool this session never loaded found no control,
     * failed `canCopy` and was dropped with a `console.warn` - the user got "Nenhuma feição
     * válida para copiar" and no way to tell that from a real refusal. It is reachable most
     * easily by the gesture this change adds, copying the feature under the cursor WITHOUT
     * selecting it, because selecting is what used to load the tool.
     *
     * @param {Array<Object>|null} [features] - Features to copy; defaults to the current
     *   selection. The context menu passes the feature under the cursor so copying does not
     *   have to change the selection.
     * @returns {Promise<number>} How many features actually landed on the clipboard. Zero
     *   means the refusal has already been shown.
     */
    async copy(features = null) {
        // Record the promise BEFORE awaiting it: a caller that fires copy() and paste() in the
        // same tick (Ctrl+C then Ctrl+V while the tool is still loading, or the Playwright
        // driver of "Duplicar Seleção", which did exactly that and duplicated the PREVIOUS
        // clipboard) must find it already set when paste() starts.
        this._copyInFlight = this._copyNow(features);
        try {
            return await this._copyInFlight;
        } finally {
            this._copyInFlight = null;
        }
    }

    /**
     * The copy proper. See `copy` for the in-flight promise around it.
     * @param {Array<Object>|null} features - As in `copy`
     * @returns {Promise<number>} As in `copy`
     * @private
     */
    async _copyNow(features) {
        const sourceFeatures = Array.isArray(features)
            ? features
            : this.selectionManager.getAllSelectedFeatures();

        if (sourceFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição selecionada para copiar');
            return 0;
        }

        await this.ensureControlsFor(sourceFeatures.map(f => f?.properties?.source));

        const copyableFeatures = this.filterCopiableFeatures(sourceFeatures);

        if (copyableFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição válida para copiar');
            return 0;
        }

        // `cleanFeatureForCopy` returns null when the tool has no `prepareForCopy`, and the
        // nulls used to reach the clipboard as `{type, feature: null}` items that failed one
        // by one at paste time, far from here.
        const clipboardItems = copyableFeatures
            .map(feature => ({
                type: feature.properties.source,
                feature: this.cleanFeatureForCopy(feature)
            }))
            .filter(item => item.feature);

        if (clipboardItems.length === 0) {
            ToastService.showWarning('Nenhuma feição válida para copiar');
            return 0;
        }

        try {
            getStateManager().setClipboard(clipboardItems, getCurrentMapNameSync());
        } catch (_e) {
            console.warn('StateManager not available for clipboard');
            return 0;
        }

        return clipboardItems.length;
    }

    /**
     * Loads the lazy control of every distinct feature type in `types`, so the SYNCHRONOUS
     * `controls.get` lookups downstream find an instance instead of falling through to a
     * `console.warn`.
     * @param {Array<string|undefined>} types - Feature types (`properties.source`)
     * @returns {Promise<void>}
     */
    async ensureControlsFor(types) {
        if (typeof this.selectionManager?.ensureControlFor !== 'function') return;

        const distinct = [...new Set(types.filter(Boolean))];
        await Promise.all(distinct.map(type => this.selectionManager.ensureControlFor(type)));
    }

    /**
     * Paste features from the clipboard.
     *
     * WITHOUT a target the legacy behaviour applies: a 30 px nudge when pasting onto the same
     * map, no offset across maps. WITH `targetLngLat` (the context menu's "Colar Aqui") the
     * copied set is anchored so the centre of its bounding box lands on that position.
     *
     * THE TWO REFUSALS COME FIRST, before a single id is minted or a single image blob is
     * duplicated. See this file's fileoverview for why they speak through different channels.
     *
     * @param {Object} [options]
     * @param {{lng: number, lat: number}|Array<number>|null} [options.targetLngLat] - Where
     *   the centre of the copied set should land.
     * @returns {Promise<number>} Features actually pasted. Zero means nothing was written and
     *   the reason has already been shown.
     */
    async paste({ targetLngLat = null } = {}) {
        // RANK. Said here, keyed by the capability the gate consulted. `addFeatures` would
        // refuse this too, but silently and only AFTER the ids, the names and the duplicated
        // image blobs had been produced - and the old code went on to toast success over it.
        const perm = checkPermission(GuardAction.CREATE_FEATURE);
        if (!perm.allowed) {
            ToastService.showWarning(denialNotice(perm.required));
            return 0;
        }

        // STATE. Emitted, not spoken: `store-error-listener.js` owns the lock sentence and
        // the toast channel that keeps a burst of them to one line.
        if (isCurrentMapLockedSync()) {
            emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
                operation: 'paste',
                reason: 'map_locked'
            });
            return 0;
        }

        // A copy still loading its lazy tool has not reached the clipboard yet: without this
        // wait, the paste right behind it read the PREVIOUS clipboard and duplicated that.
        if (this._copyInFlight) await this._copyInFlight;

        if (!this.hasClipboardData()) {
            ToastService.showWarning('Nenhuma feição copiada');
            return 0;
        }

        try {
            const currentMapName = getCurrentMapNameSync();
            const clipboardData = this.clipboard;
            const isSameMap = clipboardData.sourceMapName === currentMapName;
            const offset = this._resolvePasteOffset(clipboardData, isSameMap, targetLngLat);

            // The lazy tools have to be present before the loop below: `prepareFeatureForPaste`
            // reads `controls.get` synchronously, and a missing control drops the feature with
            // a `console.warn` while the toast still counts the ones that survived.
            await this.ensureControlsFor(clipboardData.features.map(item => item.type));

            // Build layer ID mapping for cross-map paste
            let layerIdMapping = null;
            if (!isSameMap) {
                const allFeatures = clipboardData.features.map(item => item.feature);
                layerIdMapping = await buildLayerMappingForMove(
                    allFeatures, clipboardData.sourceMapName, currentMapName
                );
            }

            const idMapping = new Map();
            const resourceDuplicationTasks = [];
            const blobsToUpload = [];

            for (const clipboardItem of clipboardData.features) {
                const { type, feature } = clipboardItem;
                const oldId = feature.properties.id;
                const newId = IDUtils.generateUniqueId();

                idMapping.set(oldId, newId);

                if (this.hasImageResource(type)) {
                    resourceDuplicationTasks.push(
                        IDUtils.duplicateImageResource(oldId, newId, this.getFeatureStorageType(type))
                    );
                    // Only the blob NOBODY can rebuild has to travel. Asking the regeneration
                    // registry (which the tool registry fills eagerly at map boot) is what
                    // keeps this from becoming a fourth hand-written list of types.
                    if (!getImageRegenerator(type)) blobsToUpload.push(newId);
                }
            }

            if (resourceDuplicationTasks.length > 0) {
                await Promise.allSettled(resourceDuplicationTasks);
            }

            // The duplication above only wrote to IndexedDB, so in a SERVER atlas the blob has
            // to reach the backend before the feature op does. No-op in a local atlas; never
            // throws (see `store/upload-copied-blobs.js`).
            await uploadCopiedBlobsIfRemote(blobsToUpload, { context: 'paste' });

            const newFeaturesByType = {};

            for (const clipboardItem of clipboardData.features) {
                const { type, feature } = clipboardItem;
                const oldId = feature.properties.id;
                const newId = idMapping.get(oldId);
                const newGeoJSONId = IDUtils.generateGeoJSONId();

                const pastedFeature = this.prepareFeatureForPaste(feature, offset, type);

                if (!pastedFeature) {
                    console.warn(`Failed to prepare feature for paste: ${type}`);
                    continue;
                }

                pastedFeature.id = newGeoJSONId;
                pastedFeature.properties.id = newId;

                // Remap layerId for cross-map paste
                if (layerIdMapping && pastedFeature.properties.layerId) {
                    const mappedLayerId = layerIdMapping.get(pastedFeature.properties.layerId);
                    if (mappedLayerId) {
                        pastedFeature.properties.layerId = mappedLayerId;
                    }
                }

                pastedFeature.properties.nome = await this.generateUniqueFeatureName(
                    feature.properties.nome,
                    type
                );

                const storageType = this.getFeatureStorageType(type);
                if (!newFeaturesByType[storageType]) {
                    newFeaturesByType[storageType] = [];
                }
                newFeaturesByType[storageType].push(pastedFeature);
            }

            await this.loadPastedImages(newFeaturesByType);

            await addFeatures(newFeaturesByType);

            await this.updateMapSources(newFeaturesByType);
            await this.autoSelectPastedFeatures(newFeaturesByType);

            const totalFeatures = Object.values(newFeaturesByType)
                .reduce((sum, features) => sum + features.length, 0);

            ToastService.showSuccess(`${totalFeatures} feição(ões) colada(s) com sucesso`);

            return totalFeatures;

        } catch (error) {
            console.error('Erro ao colar feições:', error);
            ToastService.showError('Erro ao colar feições');
            return 0;
        }
    }

    /**
     * Check if clipboard has data.
     * @returns {boolean}
     */
    hasClipboardData() {
        try {
            return getStateManager().hasClipboardData();
        } catch (_e) {
            return false;
        }
    }

    /**
     * Clear clipboard data.
     */
    clearClipboard() {
        try {
            getStateManager().clearClipboard();
        } catch (_e) {
            // StateManager not available
        }
    }

    // =========================================================================
    // TOOL-CENTRIC FEATURE PROCESSING
    // =========================================================================

    /**
     * Filter features that can be copied using tool-centric approach.
     * @param {Array<Object>} features
     * @returns {Array<Object>}
     */
    filterCopiableFeatures(features) {
        return features.filter(feature => {
            const featureType = feature.properties?.source;
            if (!featureType || isUncopyableFeatureType(featureType)) {
                return false;
            }

            const control = this.selectionManager.controls.get(featureType);
            if (control && typeof control.canCopy === 'function') {
                return control.canCopy(feature);
            }

            console.warn(`Tool ${featureType} does not implement canCopy interface`);
            return false;
        });
    }

    /**
     * Clean feature for copying using tool-centric approach.
     * @param {Object} feature
     * @returns {Object|null}
     */
    cleanFeatureForCopy(feature) {
        const control = this.selectionManager.controls.get(feature.properties.source);

        if (control && typeof control.prepareForCopy === 'function') {
            return control.prepareForCopy(feature);
        }

        console.warn(`Tool ${feature.properties.source} does not implement prepareForCopy interface`);
        return null;
    }

    /**
     * Prepare feature for pasting using tool-centric approach.
     *
     * THE PROPERTY PATCH IS APPLIED HERE, in ONE place, and not inside each control's
     * `prepareForPaste`. Every control translates its own GEOMETRY (and whatever it
     * regenerates from it, like `center` or the selection box), but `trajetoria` and
     * `_temporalHome` are common properties that no control owns; spreading the same three
     * lines through seventeen tools is how the three that got it end up disagreeing with the
     * fourteen that did not.
     *
     * `_temporalHome` is the one that fails silently: `cleanFeature` rewrites a Point's
     * geometry FROM it on the way into the repository, so a copy taken during playback would
     * land on top of the original with a success toast over it.
     *
     * @param {Object} feature
     * @param {Object} offset - `{dx, dy}` in degrees
     * @param {string} type - Feature type (`properties.source`)
     * @returns {Object|null}
     */
    prepareFeatureForPaste(feature, offset, type) {
        const control = this.selectionManager.controls.get(type);

        if (!control || typeof control.prepareForPaste !== 'function') {
            console.warn(`Tool ${type} does not implement prepareForPaste interface`);
            return null;
        }

        const pasted = control.prepareForPaste(feature, offset);
        if (!pasted) return null;

        const patch = translatePositionProperties(pasted.properties, offset.dx, offset.dy);
        if (Object.keys(patch).length === 0) return pasted;

        return { ...pasted, properties: { ...pasted.properties, ...patch } };
    }

    // =========================================================================
    // OFFSET CALCULATION
    // =========================================================================

    /**
     * The `{dx, dy}` in degrees applied to every pasted feature.
     *
     * Falls back to the legacy offset when no target was given, AND when the clipboard set
     * carries no usable coordinate to anchor on. That second fallback is the one worth
     * spelling out: a set of features whose geometries are all unreadable would otherwise
     * anchor at NaN, and every tool would happily add NaN to its coordinates and persist a
     * feature that draws nowhere.
     *
     * @param {Object} clipboardData
     * @param {boolean} isSameMap
     * @param {{lng: number, lat: number}|Array<number>|null} targetLngLat
     * @returns {{dx: number, dy: number}}
     * @private
     */
    _resolvePasteOffset(clipboardData, isSameMap, targetLngLat) {
        if (targetLngLat) {
            const anchor = pasteAnchor(clipboardData.features.map(item => item.feature));
            const anchored = anchor ? offsetToTarget(anchor, targetLngLat) : null;
            if (anchored) return anchored;
        }

        return isSameMap
            ? this.calculatePixelToMetersOffset(clipboardData.pixelOffset)
            : { dx: 0, dy: 0 };
    }

    /**
     * Convert pixel offset to geographic coordinate offset.
     * @param {number} pixelOffset
     * @returns {{dx: number, dy: number}}
     */
    calculatePixelToMetersOffset(pixelOffset = 30) {
        const zoom = this.map.getZoom();
        const center = this.map.getCenter();

        const metersPerPixel = 156543.03392 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
        const offsetMeters = pixelOffset * metersPerPixel;

        return {
            dx: offsetMeters / 111320 / Math.cos(center.lat * Math.PI / 180),
            dy: offsetMeters / 111320
        };
    }

    // =========================================================================
    // FEATURE NAME GENERATION
    // =========================================================================

    /**
     * Generate unique feature name.
     * @param {string} originalName
     * @param {string} featureType
     * @returns {Promise<string>}
     */
    async generateUniqueFeatureName(originalName, featureType) {
        if (!originalName || !originalName.trim()) {
            return await IDUtils.generateFeatureName(featureType, this.map);
        }

        if (!originalName.includes('- Cópia')) {
            return `${originalName} - Cópia`;
        }

        const match = originalName.match(/^(.+) - Cópia( (\d+))?$/);
        if (match) {
            const baseName = match[1];
            const currentNum = parseInt(match[3] || '1', 10);
            return `${baseName} - Cópia ${currentNum + 1}`;
        }

        return `${originalName} - Cópia`;
    }

    // =========================================================================
    // IMAGE HANDLING
    // =========================================================================

    /**
     * Check if feature type has image resources.
     * @param {string} featureType
     * @returns {boolean}
     */
    hasImageResource(featureType) {
        return hasImageResource(featureType);
    }

    /**
     * Load pasted images into MapLibre for immediate rendering.
     *
     * THE BUCKETS ARE DERIVED, never written out here. This loop used to name `images` and
     * `military_symbols` by hand, and it was two families behind the identical sweep in
     * `layers/layer_setup.js`: a pasted coordination measure or magnetic declination got a
     * fresh id and a duplicated blob, and nobody registered that blob on the map, so it drew
     * nothing until a reload. Both sweeps now read `collectImageResourceIds`.
     *
     * @param {Object} newFeaturesByType
     */
    async loadPastedImages(newFeaturesByType) {
        const imagePromises = [];

        for (const imageId of collectImageResourceIds(newFeaturesByType)) {
            if (this.map.hasImage(imageId)) continue;

            const imagePromise = this.loadSingleImageForPaste(imageId);
            imagePromises.push(imagePromise);
        }

        await Promise.allSettled(imagePromises);

        // Register per-feature images for non-circle point markers.
        // Custom icons register asynchronously from their stored blob; built-in
        // shapes/icons bake a per-feature canvas image synchronously.
        const customPromises = [];
        for (const feature of (newFeaturesByType.points || [])) {
            const props = feature.properties;
            if (!needsPerFeatureImage(props.markerSymbol)) continue;

            const iconId = parseCustomMarker(props.markerSymbol);
            if (iconId) {
                customPromises.push(registerCustomFeatureImage(this.map, props.id, iconId));
                continue;
            }

            const imageData = generatePointImage(
                props.markerSymbol,
                props.fillColor || '#3f4fb5',
                props.lineColor || '#000000',
                props.lineWidth || 0,
            );
            if (this.map.hasImage(props.id)) {
                this.map.removeImage(props.id);
            }
            this.map.addImage(props.id, imageData, { pixelRatio: 2 });
        }
        await Promise.allSettled(customPromises);
    }

    /**
     * Load single image into MapLibre.
     * @param {string} imageId
     */
    async loadSingleImageForPaste(imageId) {
        try {
            const blob = await getImage(imageId);
            if (!blob) {
                console.warn(`Imagem ${imageId} não encontrada no store`);
                return;
            }

            const url = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const image = new Image();

                image.onload = () => {
                    try {
                        if (!this.map.hasImage(imageId)) {
                            this.map.addImage(imageId, image);
                        }
                        URL.revokeObjectURL(url);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };

                image.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error(`Falha ao carregar imagem ${imageId}`));
                };

                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    reject(new Error(`Timeout ao carregar imagem ${imageId}`));
                }, 10000);

                image.src = url;
            });

        } catch (error) {
            console.warn(`Erro ao processar imagem ${imageId}:`, error);
        }
    }

    // =========================================================================
    // MAP SOURCE UPDATES
    // =========================================================================

    /**
     * Update map sources with pasted features.
     * @param {Object} newFeaturesByType
     */
    async updateMapSources(newFeaturesByType) {
        for (const [storageType, features] of Object.entries(newFeaturesByType)) {
            if (this.map.getSource(storageType)) {
                // Queued as one batch: the paste targets are dispatcher-owned sources, and a raw
                // `setData` replaces MapLibre's pending-update slot, dropping a queued diff with
                // no error. A paste is a pure append, so there is nothing to read back first.
                getGeoJsonDispatcher(this.map, storageType).add(features);

                const sourceType = this.getSourceTypeFromStorage(storageType);
                this.updateSpecialFeaturesToolCentric(sourceType, features);
            }
        }
    }

    /**
     * Update special features using tool-centric approach.
     * @param {string} sourceType
     * @param {Array<Object>} features
     */
    updateSpecialFeaturesToolCentric(sourceType, features) {
        const control = this.selectionManager.controls.get(sourceType);

        if (control) {
            if (typeof control.updateDependentFeatures === 'function' && sourceType === 'boundary') {
                features.forEach(feature => {
                    requestAnimationFrame(() => {
                        control.updateDependentFeatures(feature);
                    });
                });
            }
        }
    }

    /**
     * Auto-select pasted features.
     * @param {Object} newFeaturesByType
     */
    async autoSelectPastedFeatures(newFeaturesByType) {
        this.selectionManager.deselectAllFeatures();

        for (const [storageType, features] of Object.entries(newFeaturesByType)) {
            const sourceType = this.getSourceTypeFromStorage(storageType);

            for (const feature of features) {
                await this.selectionManager.toggleFeatureSelection(
                    sourceType,
                    feature.properties.id,
                    feature,
                    false
                );
            }
        }

        this.selectionManager.updateUI();
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    /**
     * Get storage type from source type.
     * @param {string} sourceType
     * @returns {string}
     */
    getFeatureStorageType(sourceType) {
        return getStorageTypeFromSource(sourceType);
    }

    /**
     * Get source type from storage type (reverse mapping).
     * @param {string} storageType
     * @returns {string}
     */
    getSourceTypeFromStorage(storageType) {
        return getSourceTypeFromStorage(storageType);
    }
}

export default ClipboardManager;
