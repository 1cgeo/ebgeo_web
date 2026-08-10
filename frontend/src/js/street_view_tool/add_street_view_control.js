// Path: js/street_view_tool/add_street_view_control.js

/**
 * @fileoverview MapLibre control for Street View 360 functionality.
 * Manages the 2D map integration: photo markers, line layers, popup preview,
 * and activation/deactivation of the Street View feature.
 *
 * NOTE: Three.js viewer logic has been moved to street_view_viewer.js
 */

/* global PMTiles */

import config from '../config.js';
import { getEventBus, registerControl } from '@store';
import { EventTypes } from '@events/event_types.js';
import StreetviewMarkers from './streetview_markers.js';
import SavedPhotosMarkers from './saved_photos_markers.js';
import { withAbsoluteTiles } from './streetview-api.service.js';
import { STYLE_MINI_MAPA } from './street-view-mini-map-style.js';

// Property carrying the photo id on the 360 photo features.
//
// It is `id`, the name the backend's MVT tile emits (alongside `projectSlug`,
// `img`, `sequence_number`). It was `photo_uuid` — the LEGACY PMTiles name, which
// no longer exists on any feature the map receives. The lookup therefore never
// matched and every click on a 360 photo fell through to "No photo found near
// clicked point": opening the viewer from the 2D map was completely dead, and
// silently, because a missing property is undefined rather than an error.
const PHOTO_PROPERTY = 'id';

class AddStreetViewControl {

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.queryMobile = window.matchMedia("(max-width: 650px)");
        this.isActive = false;
        this.isOpen = false;

        // Mini-map for street view navigation (lazy — created in setupMiniMapWithPMTiles)
        this.miniMap = null;

        // Ultimo ponto do minimapa sob o mouse, para so avisar o 360 na mudanca
        this._minimapHoveredUuid = null;

        // Andar em exibicao nos dois mapas, ou null para "mostrar tudo".
        this._floorLevel = null;
        this._handleFloorChanged = this._handleFloorChanged.bind(this);
        this._unsubFloorChanged = null;

        // Camada de planta baixa do minimapa. Ids proprios porque ela e criada
        // e destruida a cada troca de andar, junto com a fonte.
        this.floorPlanSourceId = 'sv360-floor-plan';
        this.floorPlanLayerId = 'sv360-floor-plan-line';

        // Planta que chegou antes de o estilo do minimapa carregar, e a trava
        // que impede empilhar um listener por troca de andar.
        this._floorPlanPendente = null;
        this._floorPlanAguardando = false;

        // PMTiles nearby features cache
        this.nearbyFeaturesCache = new Map();
        this.cacheRadius = 1000;

        // Streetview markers manager (initialized in onAdd)
        this.streetviewMarkers = null;

        // Saved photos markers manager (photos with orientations/markers saved)
        this.savedPhotosMarkers = null;

        // Bind event handlers
        this._handleBaseLayerChanged = this._handleBaseLayerChanged.bind(this);
        this._unsubBaseLayerChanged = null;

        // Layer definitions for PMTiles
        if (config.features.imagens_panoramicas) {
            this.streetViewPointsLayer = {
                'id': 'street-view',
                'type': 'circle',
                'source': 'streetViewPointsSource',
                'source-layer': config.streetView360.pointsSourceLayer,
                'visibility': 'none',
                'paint': {
                    'circle-radius': 0,
                    'circle-color': '#0d6efd',
                    'circle-stroke-width': 0,
                    'circle-stroke-color': '#0d6efd'
                }
            };

            this.streetViewLinesLayer = {
                'id': 'street-view-lines',
                'type': 'line',
                'source': config.streetView360.linesSourceLayer,
                'source-layer': config.streetView360.linesSourceLayer,
                'paint': {
                    'line-color': '#0d6efd',
                    'line-width': 3
                }
            };

            // Invisible wider layer for easier click/hover hit testing
            this.streetViewLinesHitLayer = {
                'id': 'street-view-lines-hit',
                'type': 'line',
                'source': config.streetView360.linesSourceLayer,
                'source-layer': config.streetView360.linesSourceLayer,
                'paint': {
                    'line-color': 'transparent',
                    'line-width': 10
                }
            };
        }
    }

    onAdd(map) {
        this.map = map;

        // Initialize streetview markers manager
        this.streetviewMarkers = new StreetviewMarkers(map, this);

        // Initialize saved photos markers manager
        this.savedPhotosMarkers = new SavedPhotosMarkers(map, this);

        // Register in control registry for search integration
        registerControl('streetView', this);

        // Register PMTiles protocol
        if (typeof PMTiles !== 'undefined' && !this.map._pmtilesRegistered) {
            const protocol = new PMTiles.Protocol();
            maplibregl.addProtocol("pmtiles", protocol.tile);
            this.map._pmtilesRegistered = true;
        }

        // UI is handled by BottomControlsControl - return empty container
        this.container = document.createElement('div');
        this.container.style.display = 'none';

        if (config.features.imagens_panoramicas) {
            this.setupMiniMapWithPMTiles();
        }

        // Listen for base layer changes to reload layers if active
        this._unsubBaseLayerChanged = getEventBus().on(EventTypes.BASE_LAYER_CHANGED, this._handleBaseLayerChanged);
        this._unsubFloorChanged = getEventBus().on(EventTypes.STREETVIEW_360_FLOOR_CHANGED, this._handleFloorChanged);

        return this.container;
    }

    /**
     * Handles base layer change event.
     * Reloads photo layers if the viewer is active.
     * @private
     */
    async _handleBaseLayerChanged() {
        if (this.isActive) {
            // Layers were removed by setStyle, need to reload
            await this.reload();

            // Also reload streetview markers if they exist
            if (this.streetviewMarkers) {
                await this.streetviewMarkers.loadMarkers();
                this.streetviewMarkers.show();
            }

            // Reload saved photos markers
            if (this.savedPhotosMarkers) {
                await this.savedPhotosMarkers.loadMarkers();
                this.savedPhotosMarkers.show();
            }

            // Fix z-order after async layer recreation — line layers may have
            // been added before marker layers due to sourcedata event timing
            this._ensureLayerOrder();
        }
    }

    setupMiniMapWithPMTiles = async () => {
        // Lazy-create miniMap only when street view feature is actually enabled
        if (!this.miniMap) {
            this.miniMap = new maplibregl.Map({
                container: 'mini-map-street-view',
                style: STYLE_MINI_MAPA,
                attributionControl: false,
                zoom: 12.5,
                minZoom: 11,
                maxZoom: 17.9,
                validateStyle: false
            });
        }

        this.miniMap.on('load', async () => {
            try {
                // Register PMTiles protocol
                if (typeof PMTiles !== 'undefined') {
                    const protocol = new PMTiles.Protocol();
                    maplibregl.addProtocol("pmtiles", protocol.tile);
                }

                this.miniMap.addSource(this.streetViewPointsLayer['source'], withAbsoluteTiles(config.streetView360.pointsSource));

                const pointImage = await this.miniMap.loadImage('./street_view/point.png');
                await this.miniMap.addImage('point', pointImage.data);

                const pointSelectedImage = await this.miniMap.loadImage('./street_view/point-selected-v2.png');
                this.miniMap.addImage('point-selected', pointSelectedImage.data);

                this.miniMap.addLayer({
                    'id': 'points',
                    'type': 'symbol',
                    'source': this.streetViewPointsLayer['source'],
                    'source-layer': config.streetView360.pointsSourceLayer,
                    'layout': {
                        'icon-image': 'point',
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true
                    }
                });

                // Click on minimap point to navigate
                this.miniMap.on('click', 'points', async (e) => {
                    const uuid = e.features?.[0]?.properties?.[PHOTO_PROPERTY];
                    if (!uuid) return;
                    try {
                        const { navigateToTarget } = await import('./street_view_viewer.js');
                        await navigateToTarget(uuid);
                    } catch (error) {
                        console.error('Error navigating from minimap click:', error);
                    }
                });

                // Vinculo minimapa -> 360: apontar um ponto na planta acende o
                // marcador correspondente na foto. O par do onHoverChange do
                // navigator, para que o realce valha nos dois sentidos.
                this.miniMap.on('mousemove', 'points', async (e) => {
                    this.miniMap.getCanvas().style.cursor = 'pointer';
                    const uuid = e.features?.[0]?.properties?.[PHOTO_PROPERTY] ?? null;
                    if (uuid === this._minimapHoveredUuid) return;
                    this._minimapHoveredUuid = uuid;
                    const { setHoveredFromMinimap } = await import('./street_view_viewer.js');
                    setHoveredFromMinimap(uuid);
                });

                this.miniMap.on('mouseleave', 'points', async () => {
                    this.miniMap.getCanvas().style.cursor = '';
                    if (this._minimapHoveredUuid === null) return;
                    this._minimapHoveredUuid = null;
                    const { setHoveredFromMinimap } = await import('./street_view_viewer.js');
                    setHoveredFromMinimap(null);
                });

                // Sair do minimapa inteiro tambem limpa. O mouseleave da CAMADA
                // nao basta: saindo rapido pela borda ele nem sempre dispara, e
                // a esfera ficava acesa no 360 sem nada apontando para ela.
                this.miniMap.getCanvas().addEventListener('mouseleave', async () => {
                    if (this._minimapHoveredUuid === null) return;
                    this._minimapHoveredUuid = null;
                    const { setHoveredFromMinimap } = await import('./street_view_viewer.js');
                    setHoveredFromMinimap(null);
                });

                // O andar pode ter sido escolhido antes do minimapa carregar:
                // reaplica o estado corrente em vez de esperar o proximo evento.
                this._applyFloorFilter();

                // O andar pode ter sido escolhido enquanto este minimapa ainda
                // nascia (este callback e assincrono). Redesenha o que ficou
                // guardado, senao a planta do primeiro andar aberto nunca
                // apareceria, sem erro nenhum no console.
                if (this._floorPlanPendente) this._renderFloorPlan(this._floorPlanPendente);

            } catch (error) {
                console.error('Error setting up minimap:', error);
            }
        });
    }

    /**
     * Reage a troca de andar, vinda do seletor do visualizador.
     * @param {Object} payload - { level, plan, hasFloors }
     * @private
     */
    _handleFloorChanged(payload) {
        this._floorLevel = payload?.hasFloors ? (payload.level ?? null) : null;
        this._applyFloorFilter();
        this._renderFloorPlan(payload?.hasFloors ? payload.plan : null);
    }

    /**
     * Esconde de AMBOS os mapas as fotos que nao sao do andar em exibicao.
     *
     * O filtro roda sobre `floor_level`, atributo que a camada `fotos` do tile
     * MVT emite por foto. Nivel null tira o filtro, que e o estado de todo
     * projeto externo, e tambem o estado correto depois de fechar um projeto
     * indoor: senao o filtro do levantamento anterior apagaria o proximo mapa
     * inteiro.
     * @private
     */
    _applyFloorFilter() {
        const filtro = this._floorLevel === null
            ? null
            : ['==', ['get', 'floor_level'], this._floorLevel];

        for (const [mapa, camada] of [
            [this.miniMap, 'points'],
            [this.map, this.streetViewPointsLayer?.id]
        ]) {
            if (!mapa || !camada) continue;
            // getLayer antes de setFilter: a camada do mapa principal so entra
            // quando a fonte de tiles termina de carregar (ver loadData).
            try {
                if (mapa.getLayer(camada)) mapa.setFilter(camada, filtro);
            } catch (error) {
                console.warn(`[street-view] could not filter "${camada}" by floor:`, error);
            }
        }
    }

    /**
     * Desenha a planta baixa do andar no minimapa, como linha simples.
     *
     * A planta ENTRA E SAI com o andar, fonte junto: guardar uma fonte vazia
     * entre trocas economizaria pouco e deixaria o minimapa de um projeto
     * externo carregando uma camada que nunca desenha nada.
     * @param {Object|null} plan - FeatureCollection de linhas, ou null
     * @private
     */
    _renderFloorPlan(plan) {
        // Guarda SEMPRE o ultimo pedido, antes de qualquer desistencia. A
        // primeira troca de andar chega cedo demais por dois caminhos: o
        // minimapa e criado em setupMiniMapWithPMTiles, que e assincrona, e
        // mesmo depois de criado o estilo dele ainda leva um tempo para
        // carregar. Desistir sem guardar perdia a planta para sempre, porque o
        // evento de andar nao se repete e nada reagendava o desenho.
        this._floorPlanPendente = plan;

        if (!this.miniMap || !this.miniMap.isStyleLoaded()) {
            // Sem minimapa ainda nao ha em que pendurar o listener: quem
            // redesenha e o proprio setupMiniMapWithPMTiles, ao terminar.
            if (this.miniMap && !this._floorPlanAguardando) {
                this._floorPlanAguardando = true;
                this.miniMap.once('styledata', () => {
                    this._floorPlanAguardando = false;
                    this._renderFloorPlan(this._floorPlanPendente);
                });
            }
            return;
        }

        try {
            if (!plan || !Array.isArray(plan.features) || plan.features.length === 0) {
                if (this.miniMap.getLayer(this.floorPlanLayerId)) {
                    this.miniMap.removeLayer(this.floorPlanLayerId);
                }
                if (this.miniMap.getSource(this.floorPlanSourceId)) {
                    this.miniMap.removeSource(this.floorPlanSourceId);
                }
                return;
            }

            if (this.miniMap.getSource(this.floorPlanSourceId)) {
                this.miniMap.getSource(this.floorPlanSourceId).setData(plan);
            } else {
                this.miniMap.addSource(this.floorPlanSourceId, { type: 'geojson', data: plan });
            }

            if (!this.miniMap.getLayer(this.floorPlanLayerId)) {
                // Abaixo de 'points': a planta e fundo, e cobrir os pontos
                // tiraria do operador o alvo de clique.
                const abaixoDe = this.miniMap.getLayer('points') ? 'points' : undefined;
                this.miniMap.addLayer({
                    id: this.floorPlanLayerId,
                    type: 'line',
                    source: this.floorPlanSourceId,
                    paint: {
                        'line-color': '#5b6b7f',
                        'line-width': 1.5,
                        'line-opacity': 0.9
                    }
                }, abaixoDe);
            }
        } catch (error) {
            console.warn('[street-view] could not draw the floor plan:', error);
        }
    }

    loadData = async () => {
        try {
            if (!this.map.getSource(this.streetViewPointsLayer['source'])) {
                this.map.addSource(this.streetViewPointsLayer['source'], withAbsoluteTiles(config.streetView360.pointsSource));
                const onPhotosSourceData = (e) => {
                    if (e.sourceId === this.streetViewPointsLayer['source'] && this.map.isSourceLoaded(this.streetViewPointsLayer['source'])) {
                        if (!this.map.getLayer(this.streetViewPointsLayer['id'])) {
                            this.map.addLayer(this.streetViewPointsLayer);
                        }
                        this.showLayers();
                        this.map.off('sourcedata', onPhotosSourceData);
                    }
                };
                this.map.on('sourcedata', onPhotosSourceData);
            } else {
                this.showLayers();
            }

            if (!this.map.getSource(this.streetViewLinesLayer['source'])) {
                this.map.addSource(this.streetViewLinesLayer['source'], withAbsoluteTiles(config.streetView360.linesSource));

                const onLinesSourceData = (e) => {
                    if (e.sourceId === this.streetViewLinesLayer['source'] && this.map.isSourceLoaded(this.streetViewLinesLayer['source'])) {
                        if (!this.map.getLayer(this.streetViewLinesLayer['id'])) {
                            this.map.addLayer(this.streetViewLinesLayer);
                        }
                        if (!this.map.getLayer(this.streetViewLinesHitLayer['id'])) {
                            this.map.addLayer(this.streetViewLinesHitLayer);
                        }
                        this.showLayers();
                        this.map.off('sourcedata', onLinesSourceData);
                    }
                };
                this.map.on('sourcedata', onLinesSourceData);
            } else {
                this.showLayers();
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    reload = async () => {
        if (this.isActive) {
            await this.loadData();
            this.showPhotos();
        }
    }

    onRemove() {
        if (this._unsubBaseLayerChanged) {
            this._unsubBaseLayerChanged();
            this._unsubBaseLayerChanged = null;
        }
        if (this._unsubFloorChanged) {
            this._unsubFloorChanged();
            this._unsubFloorChanged = null;
        }

        // Cleanup streetview viewer if open
        if (this.isOpen) {
            this.closeStreetView();
        }

        if (this.container?.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }

    async activate() {
        const isEnabled = config.features?.imagens_panoramicas ?? true;
        if (!isEnabled) {
            return false;
        }

        const closeBtn = document.getElementById('close-street-view-button');
        if (closeBtn) closeBtn.addEventListener('click', this.closeStreetView);
        this.isActive = true;
        await this.loadData();
        this.showPhotos();

        // Load and show streetview markers
        if (this.streetviewMarkers) {
            await this.streetviewMarkers.loadMarkers();
            this.streetviewMarkers.show();
        }

        // Load and show saved photos markers
        if (this.savedPhotosMarkers) {
            await this.savedPhotosMarkers.loadMarkers();
            this.savedPhotosMarkers.show();
        }
    }

    /**
     * Toggle Street View tool on/off.
     * Delegates to toolManager for consistent state management.
     */
    toggleStreetView() {
        this.toolManager.toggleViewer(this);
    }

    showPhotos = async () => {
        // Bind click/hover to the wider invisible hit layer for easier interaction.
        const hitLayerId = this.streetViewLinesHitLayer['id'];
        // Remove first (idempotent): reload() on a base-layer change calls showPhotos
        // again without hidePhotos(), and MapLibre's .on() does not dedupe, so the
        // same loadPoint would fire multiple times per click (double viewer open).
        this.map.off('click', hitLayerId, this.loadPoint);
        this.map.off('mouseenter', hitLayerId, this.showHoverCursor);
        this.map.off('mouseleave', hitLayerId, this.hideHoverCursor);
        this.map.on('click', hitLayerId, this.loadPoint);
        this.map.on('mouseenter', hitLayerId, this.showHoverCursor);
        this.map.on('mouseleave', hitLayerId, this.hideHoverCursor);

        if (this.miniMap.getLayer('selected')) {
            this.miniMap.removeLayer('selected');
        }

        this.miniMap.addLayer({
            'id': 'selected',
            'type': 'symbol',
            'source': this.streetViewPointsLayer['source'],
            'source-layer': config.streetView360.pointsSourceLayer,
            "filter": ["==", PHOTO_PROPERTY, ""],
            'layout': {
                'icon-image': 'point-selected'
            }
        });
    }

    /**
     * Finds the nearest photo point to a given coordinate.
     * Uses querySourceFeatures (vector tile data) since the points layer
     * has circle-radius: 0 and queryRenderedFeatures would return nothing.
     * @param {Object} point - {lng, lat} coordinate
     * @returns {Promise<Object|null>} Nearest feature or null
     */
    getNearestPhoto = async (point) => {
        try {
            const cacheKey = `${Math.round(point.lng * 1000)}_${Math.round(point.lat * 1000)}`;

            if (this.nearbyFeaturesCache.has(cacheKey)) {
                return this.nearbyFeaturesCache.get(cacheKey);
            }

            // ~33m buffer — tight enough to avoid adjacent tracks
            const bufferDistance = 0.0003;
            const bbox = [
                point.lng - bufferDistance,
                point.lat - bufferDistance,
                point.lng + bufferDistance,
                point.lat + bufferDistance
            ];

            let features = this.map.querySourceFeatures(this.streetViewPointsLayer['source'], {
                bbox,
                sourceLayer: config.streetView360.pointsSourceLayer
            });

            // Widen search if nothing found nearby
            if (features.length === 0) {
                const widerBuffer = 0.001;
                const widerBbox = [
                    point.lng - widerBuffer,
                    point.lat - widerBuffer,
                    point.lng + widerBuffer,
                    point.lat + widerBuffer
                ];
                features = this.map.querySourceFeatures(this.streetViewPointsLayer['source'], {
                    bbox: widerBbox,
                    sourceLayer: config.streetView360.pointsSourceLayer
                });
            }

            if (features.length === 0) {
                return null;
            }

            const from = turf.point([point.lng, point.lat]);
            let minDistance = Infinity;
            let target = null;

            for (const feature of features) {
                const coords = feature.geometry.coordinates;
                const to = turf.point(coords);
                const distance = turf.distance(from, to);

                if (distance < minDistance) {
                    minDistance = distance;
                    target = feature;
                }
            }

            if (target) {
                this.nearbyFeaturesCache.set(cacheKey, target);
            }

            return target;

        } catch (error) {
            console.error('Error finding nearest photo:', error);
            return null;
        }
    }

    /**
     * Handles click on street view line to open the viewer.
     * Delegates to street_view_viewer.js for actual viewer management.
     */
    loadPoint = async (e) => {
        // Ignore if tool is not active
        if (!this.isActive) return;

        // Skip if click was already consumed by a marker handler
        if (window._markerClickConsumed) {
            return;
        }

        // Prevent event from propagating to other map handlers
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent.preventDefault();
        }

        try {
            const feature = await this.getNearestPhoto(e.lngLat);

            if (feature && feature.properties && feature.properties[PHOTO_PROPERTY]) {
                this.isOpen = true;

                // Import and open viewer dynamically
                const { openViewer360WithPhoto, isStreetView360Open } = await import('./street_view_viewer.js');

                // If already open, just navigate to new photo
                if (isStreetView360Open()) {
                    const { navigateToTarget } = await import('./street_view_viewer.js');
                    await navigateToTarget(feature.properties[PHOTO_PROPERTY]);
                } else {
                    await openViewer360WithPhoto(feature.properties[PHOTO_PROPERTY], {
                        miniMap: this.miniMap,
                        controlInstance: this
                    });
                }
            } else {
                console.warn('No photo found near clicked point');
            }

        } catch (error) {
            console.error('Error loading point:', error);
        }
    }

    showHoverCursor = () => {
        if (!this.isActive) return;
        if (this.map?.getCanvas()) {
            this.map.getCanvas().style.cursor = 'pointer';
        }
    }

    hideHoverCursor = () => {
        if (!this.isActive) return;
        if (this.map?.getCanvas()) {
            this.map.getCanvas().style.cursor = '';
        }
    }

    deactivate = () => {
        this.isActive = false;

        // Safe cursor reset with null check
        if (this.map?.getCanvas()) {
            this.map.getCanvas().style.cursor = '';
        }

        // Safe hidePhotos call
        try {
            this.hidePhotos();
        } catch (error) {
            console.warn('Error hiding photos:', error);
        }

        // Hide streetview markers
        if (this.streetviewMarkers) {
            this.streetviewMarkers.hide();
        }

        // Hide saved photos markers
        if (this.savedPhotosMarkers) {
            this.savedPhotosMarkers.hide();
        }

        const closeBtn = document.getElementById('close-street-view-button');
        if (closeBtn) closeBtn.removeEventListener('click', this.closeStreetView);

        if (this.isOpen) {
            this.closeStreetView();
        }
    }

    closeStreetView = async () => {
        if (!this.isOpen) return;

        this.isOpen = false;

        // Delegate to viewer for cleanup
        try {
            const { closeViewer360 } = await import('./street_view_viewer.js');
            await closeViewer360();
        } catch (error) {
            console.warn('Error closing viewer:', error);
        }
    }

    hidePhotos = () => {
        const hitLayerId = this.streetViewLinesHitLayer['id'];
        this.map.off('click', hitLayerId, this.loadPoint);
        this.map.off('mouseenter', hitLayerId, this.showHoverCursor);
        this.map.off('mouseleave', hitLayerId, this.hideHoverCursor);

        if (this.map.getLayer(this.streetViewPointsLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewPointsLayer['id'], 'visibility', 'none');
        }
        if (this.map.getLayer(this.streetViewLinesLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'none');
        }
        if (this.map.getLayer(hitLayerId)) {
            this.map.setLayoutProperty(hitLayerId, 'visibility', 'none');
        }
    }

    /**
     * Finds the first streetview marker layer to use as beforeId for line layers.
     * Lines must render below markers, so they are inserted before the first marker layer.
     * @returns {string|undefined} Layer ID or undefined if no marker layers exist
     * @private
     */
    _getFirstMarkerLayerId() {
        // Check streetview project markers first, then saved photo markers
        const candidateIds = [
            this.streetviewMarkers?.clustersLayer,
            this.streetviewMarkers?.markersLayer,
            this.savedPhotosMarkers?.markersLayer
        ];
        for (const id of candidateIds) {
            if (id && this.map.getLayer(id)) return id;
        }
        return undefined;
    }

    /**
     * Ensures line layers are always below marker layers.
     * Moves line layers if they ended up above markers due to async loading race conditions
     * (e.g., after base layer change when all layers are recreated).
     * @private
     */
    _ensureLayerOrder() {
        const firstMarkerId = this._getFirstMarkerLayerId();
        if (!firstMarkerId) return;

        // Move line layers below the first marker layer
        const lineLayers = [
            this.streetViewLinesLayer?.['id'],
            this.streetViewLinesHitLayer?.['id'],
            this.streetViewPointsLayer?.['id']
        ];

        for (const layerId of lineLayers) {
            if (layerId && this.map.getLayer(layerId)) {
                this.map.moveLayer(layerId, firstMarkerId);
            }
        }
    }

    showLayers = () => {
        // Find first marker layer so lines are inserted below markers
        const beforeId = this._getFirstMarkerLayerId();

        if (this.map.getLayer(this.streetViewPointsLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewPointsLayer['id'], 'visibility', 'visible');
        }

        // Add line layers before marker layers so markers render above them
        if (this.map.getLayer(this.streetViewLinesLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'visible');
        } else {
            this.map.addLayer(this.streetViewLinesLayer, beforeId);
            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'visible');
        }

        // Hit layer (invisible wider line for click/hover) — also before markers
        const hitLayerId = this.streetViewLinesHitLayer['id'];
        if (this.map.getLayer(hitLayerId)) {
            this.map.setLayoutProperty(hitLayerId, 'visibility', 'visible');
        } else if (this.map.getSource(this.streetViewLinesHitLayer['source'])) {
            this.map.addLayer(this.streetViewLinesHitLayer, beforeId);
            this.map.setLayoutProperty(hitLayerId, 'visibility', 'visible');
        }

        // Ensure correct z-order after all layers are set visible
        this._ensureLayerOrder();
    }

    clearCache = () => {
        this.nearbyFeaturesCache.clear();
    }

    /**
     * Navigate to a specific streetview marker and open its preview popup.
     * Used by external components like search.
     * Delegates to the StreetviewMarkers module.
     * @param {string} markerId - ID of the marker to navigate to
     * @returns {Promise<boolean>} True if navigation successful
     */
    async navigateToStreetViewMarker(markerId) {
        if (this.streetviewMarkers) {
            return this.streetviewMarkers.navigateToMarker(markerId);
        }
        return false;
    }
}

export default AddStreetViewControl;
