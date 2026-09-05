// Path: js/tool_manager/managers/selection-highlight.manager.js

/**
 * @fileoverview Gerenciador de destaque visual de seleção.
 * Renderiza selection boxes ao redor de features selecionadas.
 * Extraído de ui_manager.js para separação de responsabilidades.
 *
 * O PASSE DE ZOOM RODA POR QUADRO, E ATÉ 2026-09-05 NÃO RODAVA. A caixa é
 * geometria em PIXELS ao redor da feição, então as coordenadas geográficas dela
 * mudam a cada passo de zoom; sem redesenhar, a caixa cresce ou encolhe na tela
 * junto com o mapa. O `_handleZoomChange` cancelava e reagendava o próprio quadro,
 * e o cancelamento matava a callback antes de ela rodar. O porquê está no
 * comentário daquele método, com a medida.
 *
 * O que o passe por quadro custa, medido na linha `integracao_backend`, que tem
 * este mesmo gerente, sobre `npm run dev`, Chromium com ANGLE, num gesto de
 * `easeTo` de 1,5 nível em 1,5 s (92 quadros), com 50 feições selecionadas num
 * mapa de 350:
 *
 *   | passe                        | passadas | caixas montadas | soma  | cadência p95 |
 *   |------------------------------|---------:|----------------:|------:|-------------:|
 *   | como estava (com a fome)     |        2 |              50 | 0,7 ms|      16,8 ms |
 *   | por quadro, cache como está  |       47 |             100 |10,9 ms|      16,8 ms |
 *   | por quadro, caixa exata      |       47 |            2300 |10,0 ms|      16,8 ms |
 *
 * A CHAVE DE CACHE QUANTIZADA EM 0,5 NÍVEL FICA, e a razão é a terceira linha:
 * tirar a quantização multiplica por 23 as montagens de caixa e não move a
 * cadência (a diferença está dentro do ruído das duas medidas).
 *
 * COM TERRENO LIGADO A CAIXA EXATA MOVE A CADÊNCIA, e é o segundo motivo, mais forte,
 * para a quantização ficar. Medido em 2026-09-05 pela bancada de terreno da
 * `integracao_backend` (`desempenho-terreno.mjs --selecionadas 0,50 --passes`, 50
 * selecionadas, cenário de zoom, três rodadas com a primeira descartada): sem a
 * quantização a guarda de identidade deixa de pegar, as escritas na fonte da caixa vão
 * de 4 por gesto (uma por faixa de 0,5 nível) para 88,5, e as draw calls por quadro
 * dobram (227 para 459), com p95 da cadência de 26,1..26,6 ms contra 25,2..25,6 sem
 * sobreposição. E `zoomend` em vez de por quadro NÃO compensa: com CPU livre e com CPU
 * quatro vezes mais lenta as amplitudes de render p50 e de cadência p95 se sobrepõem;
 * o que ele economiza são 19 ms de JavaScript espalhados por cerca de 90 quadros.
 *
 * E A ESCRITA SAI DO QUADRO. É consequência da mesma quantização: entre duas
 * faixas o cache devolve o MESMO objeto de caixa, então a coleção montada é
 * idêntica, feição a feição, à que já está na fonte. A guarda de identidade em
 * `updateSelectionHighlight` derruba as 47 escritas por gesto para uma por faixa
 * cruzada, sem mudar um pixel.
 *
 * O QUE ESTE PASSE NÃO FAZ, e é bom saber antes de medir a caixa na tela: para as
 * SEIS ferramentas de tamanho em pixels (ponto, texto, imagem, símbolo militar,
 * medida de coordenação, declinação) o `createSelectionBox` do controle devolve a
 * caixa GUARDADA em `properties.selectionBox`, e quem a reescreve é o passe do
 * próprio controle (por quadro para a feição com correção de zoom desligada, em
 * `zoomend` para as demais; ver `tests/unit/zoom-pass-events.test.js`). Este passe
 * é o CONSUMIDOR dessa reescrita, não o autor dela: com a fome, uma caixa
 * recalculada pelo controle podia não chegar à fonte. Um ponto com correção de
 * zoom LIGADA tem a caixa fixa em graus durante o gesto e ela cresce 2,83x na tela
 * num zoom de 1,5 nível, antes e depois deste conserto, porque essa é a decisão do
 * lote de zoom de 2026-09-03, não deste arquivo.
 *
 * @module tool_manager/managers/selection-highlight.manager
 */

import { getStateManager } from '@store';
import { pixelsToDegrees } from '@utils/geometry-utils.js';
import { deepClone } from '@utils/deep-utils.js';

// ============================================================================
// SELECTION HIGHLIGHT MANAGER
// ============================================================================

export class SelectionHighlightManager {
    /**
     * @param {maplibregl.Map} map - MapLibre map instance
     * @param {Object} selectionManager - Selection manager instance
     */
    constructor(map, selectionManager) {
        this.map = map;
        this.selectionManager = selectionManager;

        /** @type {Array<Object>} Current selection box features */
        this.selectionBoxes = [];

        /** @type {Map<string, Object>} Cache for selection box calculations */
        this.selectionBoxCache = new Map();

        /** @type {Map<string, string>} Geometry hashes for cache invalidation */
        this.geometryHashes = new Map();

        /** @type {number|null} RAF ID for debounced zoom handling */
        this.rafId = null;

        /**
         * A coleção que foi escrita na fonte por último, guardada por REFERÊNCIA para a
         * comparação de identidade do passe por quadro. `null` significa "não sei o que
         * está lá", e a próxima passada escreve. Ver `_mesmaColecao`.
         * @type {Array<Object>|null}
         */
        this._ultimaColecaoEscrita = null;

        /**
         * A fonte em que aquela coleção foi escrita. Um `setStyle` recria o objeto de
         * fonte, e no modo de reconstrução completa ele volta VAZIO (`ensureSource` em
         * `layers/styles/auxiliary.layers.js`): sem esta referência a guarda compararia
         * com uma coleção que já não está em lugar nenhum e engoliria a escrita, deixando
         * a caixa fora da tela até a próxima faixa de zoom.
         * @type {Object|null}
         */
        this._ultimaFonteEscrita = null;

        this._setupEventHandlers();
    }

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    /**
     * Setup map event handlers.
     * @private
     */
    _setupEventHandlers() {
        this.map.on('zoom', this._handleZoomChange);
    }

    /**
     * Handle map zoom changes with debouncing.
     * Recalculates selection boxes on zoom since pixel sizes change.
     *
     * NAO CANCELE E REAGENDE AQUI, e a razao e uma medida. Ate 2026-09-05 este
     * metodo abria com `cancelAnimationFrame(this.rafId)`, e o efeito era o oposto
     * do pretendido: num gesto de `easeTo` de 1,5 nivel em 1,5 s, o mapa emitiu 92
     * eventos `zoom`, este handler rodou 92 vezes e `updateSelectionHighlight` rodou
     * DUAS, as duas depois do gesto.
     *
     * A causa e a ordem dentro do quadro. O MapLibre pede o quadro seguinte
     * (`Map._requestRenderFrame`, que passa por `_update` -> `triggerRepaint`) ANTES
     * de a callback de animacao aplicar o zoom e emitir o evento. Entao, na lista do
     * quadro N, a entrada do MapLibre vem na frente da nossa: ele roda primeiro,
     * emite `zoom`, e o nosso handler cancela a callback que ainda estava na fila do
     * MESMO quadro. Repete-se a cada quadro, e a callback nunca chega a rodar. A
     * caixa ficava congelada no gesto inteiro e so saltava no fim, o que num zoom de
     * 1,5 nivel a deixa 2,83x fora de escala na tela.
     *
     * Agendar UMA vez e deixar rodar coalesce igual (k eventos dentro de um quadro
     * dao uma passada) e nao pode passar fome. O custo do passe por quadro esta na
     * tabela do cabecalho deste arquivo: a cadencia do quadro nao se move.
     *
     * @private
     */
    _handleZoomChange = () => {
        if (this.rafId) return;

        this.rafId = requestAnimationFrame(() => {
            // Zerado ANTES da passada: um `zoom` emitido durante ela agenda o proximo
            // quadro em vez de ser engolido.
            this.rafId = null;
            if (this.selectionManager.hasSelectedFeatures()) {
                this.updateSelectionHighlight();
            }
        });
    }

    // ========================================================================
    // CACHE MANAGEMENT
    // ========================================================================

    /**
     * Get cache key for feature at current zoom level.
     * Zoom level is quantized to 0.5 increments for cache efficiency.
     * @param {string} featureId
     * @returns {string}
     */
    getCacheKey(featureId) {
        const zoom = this.map.getZoom();
        const zoomLevel = Math.round(zoom * 2) / 2;
        return `${featureId}-${zoomLevel}`;
    }

    /**
     * Calculate geometry hash for cache invalidation.
     * Hash includes coordinates and relevant properties that affect selection box.
     * @param {Object} feature - GeoJSON feature
     * @returns {string}
     */
    calculateGeometryHash(feature) {
        const coords = JSON.stringify(feature.geometry.coordinates);
        const props = JSON.stringify({
            center: feature.properties.center,
            radius: feature.properties.radius,
            majorRadius: feature.properties.majorRadius,
            minorRadius: feature.properties.minorRadius,
            bearing: feature.properties.bearing,
            text: feature.properties.text,
            size: feature.properties.size,
            rotation: feature.properties.rotation,
            width: feature.properties.width,
            height: feature.properties.height,
            anchor: feature.properties.anchor,
            selectionBox: feature.properties.selectionBox
                ? JSON.stringify(feature.properties.selectionBox)
                : null
        });

        // Simple hash function for cache invalidation
        let hash = 0;
        const str = coords + props;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    /**
     * Invalidate cache for specific feature.
     * @param {string} featureId
     */
    invalidateCache(featureId) {
        if (featureId) {
            const keysToDelete = [];
            for (const key of this.selectionBoxCache.keys()) {
                if (key.startsWith(`${featureId}-`)) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => this.selectionBoxCache.delete(key));
            this.geometryHashes.delete(featureId);
        }
    }

    /**
     * Invalidate entire selection box cache.
     */
    invalidateAllCache() {
        this.selectionBoxCache.clear();
        this.geometryHashes.clear();
    }

    /**
     * Notify geometry change for cache invalidation.
     * Called by controls when feature geometry is modified.
     * @param {string} featureId
     */
    notifyGeometryChange(featureId) {
        this.invalidateCache(featureId);
    }

    // ========================================================================
    // SELECTION HIGHLIGHTING
    // ========================================================================

    /**
     * Update selection highlight using tool-centric approach.
     * Each tool is responsible for creating its own selection boxes.
     */
    updateSelectionHighlight = () => {
        // Skip during drag to avoid visual lag
        if (this._isDragging()) return;

        const selectionBoxesSource = this.map.getSource('selection-boxes');
        if (!selectionBoxesSource) return;

        const featuresByType = this._groupSelectedFeaturesByType();
        const allSelectionBoxes = [];

        for (const [type, features] of featuresByType.entries()) {
            const selectionBoxes = this._createSelectionBoxesForType(type, features);
            allSelectionBoxes.push(...selectionBoxes);
        }

        this.selectionBoxes = allSelectionBoxes;

        // A ESCRITA SAI DO QUADRO QUANDO NADA MUDOU, e a comparação é de IDENTIDADE, não
        // de conteúdo. Dentro de uma faixa de 0,5 nível o cache devolve o MESMO objeto de
        // caixa, então um quadro que só andou o zoom monta uma coleção com as mesmas
        // referências, e reenviá-la custaria um `setData` (isto é, um clone estruturado da
        // coleção e uma nova ladrilhagem no worker) para desenhar o pixel que já está lá.
        // Medido com 50 feições selecionadas num gesto de 1,5 s: 47 escritas por gesto sem
        // esta guarda, uma por faixa cruzada com ela.
        //
        // A comparação por referência é EXATA aqui, e a alternativa por conteúdo custaria
        // um `JSON.stringify` de cada caixa por quadro, que é justamente o gasto que a
        // guarda existe para evitar. Ela vale porque esta classe é a única que escreve
        // `selection-boxes` (`layers/styles/auxiliary.layers.js` só cria a fonte vazia; o
        // arrasto passa por `shiftSelectionBoxes`, aqui embaixo, que atualiza o registro),
        // e porque uma caixa recalculada é sempre um objeto NOVO: qualquer mudança real de
        // geometria, de seleção ou de cache reprova a comparação e a escrita sai.
        if (this._mesmaColecao(selectionBoxesSource, allSelectionBoxes)) return;

        this._registrarEscrita(selectionBoxesSource, allSelectionBoxes);
        selectionBoxesSource.setData({
            type: 'FeatureCollection',
            features: allSelectionBoxes
        });
    }

    /**
     * Se a coleção a escrever é, feição a feição e na mesma ordem, a MESMA que já está na
     * fonte, e na MESMA fonte. Comparação por referência de propósito: ver o comentário em
     * `updateSelectionHighlight`.
     * @private
     * @param {Object} fonte - Fonte GeoJSON de destino
     * @param {Array<Object>} colecao - Coleção montada nesta passada
     * @returns {boolean}
     */
    _mesmaColecao(fonte, colecao) {
        if (fonte !== this._ultimaFonteEscrita) return false;
        const anterior = this._ultimaColecaoEscrita;
        if (anterior === null || anterior.length !== colecao.length) return false;
        for (let i = 0; i < colecao.length; i++) {
            if (anterior[i] !== colecao[i]) return false;
        }
        return true;
    }

    /**
     * Guarda o que foi escrito e onde, para a comparação da próxima passada.
     * @private
     * @param {Object} fonte - Fonte GeoJSON escrita
     * @param {Array<Object>} colecao - Coleção escrita
     */
    _registrarEscrita(fonte, colecao) {
        this._ultimaFonteEscrita = fonte;
        this._ultimaColecaoEscrita = colecao;
    }

    /**
     * Check if currently dragging via StateManager.
     * @private
     * @returns {boolean}
     */
    _isDragging() {
        try {
            return getStateManager().getUnsafe('ui.isDragging') || false;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Group selected features by type for efficient processing.
     * Uses StateManager as source of truth.
     * @private
     * @returns {Map<string, Array<Object>>}
     */
    _groupSelectedFeaturesByType() {
        const featuresByType = new Map();

        try {
            const selectedFeatures = getStateManager().getUnsafe('selection.features') || [];

            for (const item of selectedFeatures) {
                if (!featuresByType.has(item.type)) {
                    featuresByType.set(item.type, []);
                }
                featuresByType.get(item.type).push(item.feature);
            }
        } catch (_e) {
            // StateManager not available
        }

        return featuresByType;
    }

    /**
     * Create selection boxes for features of a specific type.
     * @private
     * @param {string} type - Feature type
     * @param {Array<Object>} features - GeoJSON features
     * @returns {Array<Object>} Selection box features
     */
    _createSelectionBoxesForType(type, features) {
        if (features.length === 0) return [];

        const control = this.selectionManager.controls.get(type);

        if (!this._supportsToolCentricSelectionBoxes(control)) {
            console.warn(`Tool ${type} does not implement selection box interface`);
            return [];
        }

        return this._createSelectionBoxesWithCache(features, control);
    }

    /**
     * Check if control supports tool-centric selection box interface.
     * @private
     * @param {Object} control
     * @returns {boolean}
     */
    _supportsToolCentricSelectionBoxes(control) {
        return control &&
            typeof control.createSelectionBox === 'function' &&
            typeof control.getSelectionBoxStrategy === 'function';
    }

    /**
     * Create selection boxes using tool-centric approach with caching.
     * @private
     * @param {Array<Object>} features
     * @param {Object} control
     * @returns {Array<Object>}
     */
    _createSelectionBoxesWithCache(features, control) {
        const selectionBoxes = [];

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                const currentHash = this.calculateGeometryHash(feature);
                const cacheKey = this.getCacheKey(featureId);
                const cached = this.selectionBoxCache.get(cacheKey);

                let selectionBox;

                if (cached && cached.geometryHash === currentHash) {
                    selectionBox = cached.selectionBox;
                } else {
                    const boxGeometry = control.createSelectionBox(feature);

                    if (boxGeometry) {
                        selectionBox = {
                            type: 'Feature',
                            geometry: boxGeometry.geometry || boxGeometry,
                            properties: {
                                type: 'selection-box',
                                source: feature.properties.source,
                                featureId: featureId
                            }
                        };

                        this.selectionBoxCache.set(cacheKey, {
                            geometryHash: currentHash,
                            selectionBox: selectionBox
                        });
                        this.geometryHashes.set(featureId, currentHash);
                    }
                }

                if (selectionBox) {
                    selectionBoxes.push(selectionBox);
                }
            } catch (error) {
                console.warn(`Error creating selection box for ${feature.properties.source}:`, error);
            }
        }

        return selectionBoxes;
    }

    // ========================================================================
    // DRAG OPERATIONS
    // ========================================================================

    /**
     * Shift selection boxes by delta for visual feedback during drag.
     * @param {number} dx - Delta longitude
     * @param {number} dy - Delta latitude
     * @param {boolean} [save=false] - Whether to persist the shifted positions
     */
    shiftSelectionBoxes(dx, dy, save = false) {
        const shiftedFeatures = this.selectionBoxes.map(feature => {
            return this._translateFeature(feature, dx, dy);
        });

        const selectionBoxesSource = this.map.getSource('selection-boxes');
        if (selectionBoxesSource) {
            // O registro acompanha a escrita: sem isto a guarda de identidade de
            // `updateSelectionHighlight` compararia com uma coleção que não é a que está
            // na fonte, e a caixa ficaria deslocada onde o arrasto a deixou.
            this._registrarEscrita(selectionBoxesSource, shiftedFeatures);
            selectionBoxesSource.setData({
                type: 'FeatureCollection',
                features: shiftedFeatures
            });
        }

        if (save) {
            this.selectionBoxes = shiftedFeatures;
        }
    }

    /**
     * Translate feature geometry by delta.
     * @private
     * @param {Object} feature - GeoJSON feature
     * @param {number} dx - Delta X (longitude)
     * @param {number} dy - Delta Y (latitude)
     * @returns {Object} Translated feature (deep cloned)
     */
    _translateFeature(feature, dx, dy) {
        const translatedFeature = deepClone(feature);

        const translateCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                return [coords[0] + dx, coords[1] + dy];
            }
            return coords.map(translateCoords);
        };

        const { type, coordinates } = feature.geometry;

        switch (type) {
            case 'Point':
                translatedFeature.geometry.coordinates = translateCoords(coordinates);
                break;
            case 'LineString':
                translatedFeature.geometry.coordinates = coordinates.map(translateCoords);
                break;
            case 'Polygon':
                translatedFeature.geometry.coordinates = coordinates.map(ring => ring.map(translateCoords));
                break;
            case 'MultiLineString':
                translatedFeature.geometry.coordinates = coordinates.map(line => line.map(translateCoords));
                break;
            case 'MultiPolygon':
                translatedFeature.geometry.coordinates = coordinates.map(polygon => polygon.map(ring => ring.map(translateCoords)));
                break;
            default:
                throw new Error(`Unsupported geometry type: ${type}`);
        }

        return translatedFeature;
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Expand bounding box with padding in pixels.
     * Converts pixel padding to geographic degrees based on zoom and latitude.
     * @param {Array<number>} bbox - [minX, minY, maxX, maxY]
     * @param {number} paddingPixels
     * @returns {Array<number>} Expanded bbox
     */
    expandBboxWithPadding(bbox, paddingPixels) {
        const centerLat = (bbox[1] + bbox[3]) / 2;
        const mapCenter = this.map.getCenter();
        const latitude = isNaN(centerLat) ? mapCenter.lat : centerLat;

        const zoom = this.map.getZoom();
        const paddingDegrees = pixelsToDegrees(paddingPixels, latitude, zoom);

        return [
            bbox[0] - paddingDegrees,
            bbox[1] - paddingDegrees,
            bbox[2] + paddingDegrees,
            bbox[3] + paddingDegrees
        ];
    }

    /**
     * Calculate expanded dimensions after rotation.
     * Used for rotated features like text and images.
     * @param {number} originalWidth
     * @param {number} originalHeight
     * @param {number} rotationDegrees
     * @returns {{width: number, height: number}}
     */
    calculateExpandedDimensions(originalWidth, originalHeight, rotationDegrees) {
        if (rotationDegrees === 0) {
            return { width: originalWidth, height: originalHeight };
        }

        const radians = rotationDegrees * (Math.PI / 180);

        const corners = [
            { x: -originalWidth / 2, y: -originalHeight / 2 },
            { x: originalWidth / 2, y: -originalHeight / 2 },
            { x: originalWidth / 2, y: originalHeight / 2 },
            { x: -originalWidth / 2, y: originalHeight / 2 }
        ];

        const rotatedCorners = corners.map(corner => ({
            x: corner.x * Math.cos(radians) - corner.y * Math.sin(radians),
            y: corner.x * Math.sin(radians) + corner.y * Math.cos(radians)
        }));

        const minX = Math.min(...rotatedCorners.map(c => c.x));
        const maxX = Math.max(...rotatedCorners.map(c => c.x));
        const minY = Math.min(...rotatedCorners.map(c => c.y));
        const maxY = Math.max(...rotatedCorners.map(c => c.y));

        return {
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Create selection box polygon.
     * @param {Array<number>} coordinates - [lng, lat]
     * @param {number} width - Width in pixels
     * @param {number} height - Height in pixels
     * @param {number} rotation - Rotation in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    createSelectionBox(coordinates, width, height, rotation) {
        const radians = rotation * (Math.PI / 180);
        const point = this.map.project(coordinates);
        const points = [
            [-width / 2, -height / 2],
            [width / 2, -height / 2],
            [width / 2, height / 2],
            [-width / 2, height / 2]
        ];

        const rotatedPoints = points.map(([x, y]) => {
            const nx = x * Math.cos(radians) - y * Math.sin(radians);
            const ny = x * Math.sin(radians) + y * Math.cos(radians);
            return this.map.unproject([point.x + nx, point.y + ny]);
        });

        return {
            type: 'Polygon',
            coordinates: [[
                ...rotatedPoints.map(p => [p.lng, p.lat]),
                [rotatedPoints[0].lng, rotatedPoints[0].lat]
            ]]
        };
    }

    /**
     * Calculate buffer around feature.
     * @param {Object} feature - GeoJSON feature
     * @param {number} bufferSize
     * @returns {Object}
     */
    calculateBuffer(feature, bufferSize) {
        return turf.buffer(feature, bufferSize, { units: 'degrees' });
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Cleanup resources.
     */
    destroy() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }
        this.map.off('zoom', this._handleZoomChange);
        this.selectionBoxCache.clear();
        this.geometryHashes.clear();
        this._ultimaColecaoEscrita = null;
        this._ultimaFonteEscrita = null;
    }
}

