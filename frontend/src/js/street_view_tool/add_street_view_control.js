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
import { fetchNearestPhoto, sv360AtlasScope, sv360TileSource } from './streetview-api.service.js';
// O mesmo carimbo do mapa principal, e nao o do 360 sozinho: o minimapa desenha camada de
// dados tambem, e ela pode ser privada emprestada.
import { credencialDeTile } from '../map/credencial-de-tile.js';
import { rebuildScopedSource } from './tile-scope.js';
import { STYLE_MINI_MAPA } from './street-view-mini-map-style.js';
import { estiloDoMiniMapa, faixaDoMiniMapa } from './mini-mapa-base.js';
import { photo360Failures } from './photo360-failure.js';

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

        // Cache da foto mais proxima, por coordenada de clique arredondada.
        this.nearbyFeaturesCache = new Map();

        // Streetview markers manager (initialized in onAdd)
        this.streetviewMarkers = null;

        // Saved photos markers manager (photos with orientations/markers saved)
        this.savedPhotosMarkers = null;

        // Bind event handlers
        this._handleBaseLayerChanged = this._handleBaseLayerChanged.bind(this);
        this._unsubBaseLayerChanged = null;

        // O atlas sob o qual CADA fonte de tile do 360 foi criada, um por mapa porque as
        // duas nascem em momentos diferentes (a trajetoria na ativacao, os pontos quando o
        // minimapa carrega) e o atlas pode trocar entre uma e outra. `null` tambem e o valor
        // legitimo de "sem atlas em foco"; quem distingue "ainda nao existe" e o `getSource`
        // la dentro de `rebuildScopedSource`.
        this._linesAtlasId = null;
        this._pointsAtlasId = null;
        this._unsubAtlasScope = null;

        // Layer definitions
        if (config.features.imagens_panoramicas) {
            // A FONTE DE PONTOS SO EXISTE NO MINIMAPA. O mapa principal carregava
            // os mesmos tiles numa camada `street-view` de circle-radius 0, isto
            // e, invisivel. Ela nao era decorativa: o clique na linha descobria a
            // foto mais proxima por querySourceFeatures sobre ela. Esse caminho
            // passou a perguntar ao servico (/photos/nearest), e a camada ficou
            // sem um unico leitor, ainda baixando tile para desenhar nada.
            //
            // O que sobrou e a referencia da fonte, que o minimapa usa para
            // desenhar os pontos, o realce de selecionado e o de hover.
            this.pointsSourceRef = {
                id: 'streetViewPointsSource',
                sourceLayer: config.streetView360.pointsSourceLayer
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

        // THE 360 VIEWER SPEAKS THROUGH THE MAP'S PANEL, and this is where it learns which map.
        // What discovers that a photo did not load is `street_view_viewer.js`, lazily imported
        // and holding no map at all: see `photo360-failure.js`.
        photo360Failures.attach(map);

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
        // O ATLAS EM FOCO MUDOU. `ATLAS_SETTINGS_CHANGED` e o anuncio que ja existe para
        // isso e nao um segundo: o sync o emite depois de `refreshVisibleResources(atlasId)`
        // ao montar o atlas, e de novo com `settings: null` no `disconnect`, que e a saida.
        // Como ele sai DEPOIS da re-soma, `sv360AtlasScope()` ja responde o atlas novo
        // quando este ouvinte roda. Ele tambem sai por outros motivos (concessao alterada
        // no MESMO atlas), e por isso o gatilho aqui e a COMPARACAO do carimbo, nao o
        // evento: sem troca de atlas nao se derruba fonte nenhuma.
        this._unsubAtlasScope = getEventBus().on(EventTypes.ATLAS_SETTINGS_CHANGED, this._handleAtlasScopeChanged);

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

    /**
     * Rebuilds the 360 tile sources when the atlas in focus changes.
     *
     * WHY THE SOURCE IS DEMOLISHED AND NOT RETUNED. MapLibre keys its tile cache by
     * `OverscaledTileID.key` (z/x/y/wrap), never by the URL, so a tile fetched inside a lending
     * atlas is handed back outside it with no request at all — that is the cross-scope reuse the
     * decision of 2026-08-18 refused. And `setTiles()` does not fix it for a VECTOR source: it
     * reloads the tiles as `"reloading"`, which sends `"RT"` to the worker and re-parses the
     * bytes already there. Only removing the source drops the cache. The measurement is written
     * out in `tile-scope.js`.
     *
     * BEST-EFFORT, AND FAILING HERE MEANS SHOWING LESS, NEVER MORE: the scope stamp is only
     * advanced when the rebuild actually happened, so a source that could not be rebuilt is
     * tried again on the next announcement instead of being recorded as already scoped.
     * @private
     */
    _handleAtlasScopeChanged = () => {
        if (!(config.features?.imagens_panoramicas ?? true)) return;
        const atual = sv360AtlasScope();

        if (this.map && this._linesAtlasId !== atual && this.streetViewLinesLayer) {
            try {
                const fonte = this.streetViewLinesLayer['source'];
                if (rebuildScopedSource(this.map, fonte, sv360TileSource(config.streetView360.linesSource, atual))) {
                    this._linesAtlasId = atual;
                }
            } catch (error) {
                console.error('[street-view] could not rescope the trajectory source:', error);
            }
        }

        if (this.miniMap && this._pointsAtlasId !== atual && this.pointsSourceRef) {
            try {
                const fonte = this.pointsSourceRef.id;
                if (rebuildScopedSource(this.miniMap, fonte, sv360TileSource(config.streetView360.pointsSource, atual))) {
                    this._pointsAtlasId = atual;
                }
            } catch (error) {
                console.error('[street-view] could not rescope the points source:', error);
            }
        }
    }

    setupMiniMapWithPMTiles = async () => {
        // Lazy-create miniMap only when street view feature is actually enabled
        if (!this.miniMap) {
            this.miniMap = new maplibregl.Map({
                container: 'mini-map-street-view',
                // O MAPA BASE DO MINI-MAPA VEM DO CATÁLOGO desde 2026-08-31 (decisão do dono),
                // escolhido pelo administrador em `streetView360.miniMapBasemap`. O
                // `STYLE_MINI_MAPA` escrito à mão vira o ÚLTIMO fallback, e não some: se o id
                // configurado não resolver e nenhum mapa base do catálogo resolver, um estilo
                // local ainda desenha alguma coisa, e `setStyle(undefined)` deixaria o
                // mini-mapa em branco sem erro nenhum.
                style: estiloDoMiniMapa(config, STYLE_MINI_MAPA),
                attributionControl: false,
                zoom: 12.5,
                // A FAIXA VEM DO MAPA BASE ESCOLHIDO, e não é mais um par escrito aqui. O
                // `maxZoom: 17.9` que morava nesta linha era uma CÓPIA à mão do teto antigo da
                // aplicação, e ficou órfã quando o teto virou 21: o mini-mapa desenhava um
                // limite que nenhuma outra tela tinha.
                ...faixaDoMiniMapa(config),
                validateStyle: false,
                // O minimapa carrega a fonte de PONTOS do 360, os mesmos tiles
                // flexibleAuth do mapa principal, e por isso precisa do mesmo
                // carimbo. Sem ele, servindo o 360 de outra origem, o minimapa
                // mostraria menos fotos que a trajetoria do mapa principal.
                transformRequest: credencialDeTile
            });
        }

        this.miniMap.on('load', async () => {
            try {
                // Register PMTiles protocol
                if (typeof PMTiles !== 'undefined') {
                    const protocol = new PMTiles.Protocol();
                    maplibregl.addProtocol("pmtiles", protocol.tile);
                }

                // O escopo e lido UMA vez e serve para os dois: a URL que vai para o mapa e o
                // carimbo que diz sob qual atlas ela foi montada. Ler duas vezes deixaria os
                // dois discordarem se o atlas trocasse no meio.
                const escopoPontos = sv360AtlasScope();
                this.miniMap.addSource(this.pointsSourceRef.id, sv360TileSource(config.streetView360.pointsSource, escopoPontos));
                this._pointsAtlasId = escopoPontos;

                const pointImage = await this.miniMap.loadImage('./street_view/point.png');
                await this.miniMap.addImage('point', pointImage.data);

                const pointSelectedImage = await this.miniMap.loadImage('./street_view/point-selected-v2.png');
                this.miniMap.addImage('point-selected', pointSelectedImage.data);

                this.miniMap.addLayer({
                    'id': 'points',
                    'type': 'symbol',
                    'source': this.pointsSourceRef.id,
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
     * Esconde do minimapa as fotos que nao sao do andar em exibicao.
     *
     * O filtro roda sobre `floor_level`, atributo que a camada `fotos` do tile
     * MVT emite por foto. Nivel null tira o filtro, que e o estado de todo
     * projeto externo, e tambem o estado correto depois de fechar um projeto
     * indoor: senao o filtro do levantamento anterior apagaria o proximo mapa
     * inteiro.
     *
     * SO O MINIMAPA, porque so ele desenha foto. O mapa principal mostra a linha
     * de tracado, que nao tem andar, e os marcadores de projeto, que sao um por
     * levantamento.
     * @private
     */
    _applyFloorFilter() {
        if (!this.miniMap) return;

        const filtro = this._floorLevel === null
            ? null
            : ['==', ['get', 'floor_level'], this._floorLevel];

        // getLayer antes de setFilter: a camada so entra quando o minimapa
        // termina de carregar (ver setupMiniMapWithPMTiles).
        try {
            if (this.miniMap.getLayer('points')) this.miniMap.setFilter('points', filtro);
        } catch (error) {
            console.warn('[street-view] could not filter "points" by floor:', error);
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
                // 'idle', e nao 'styledata'. O styledata dispara varias vezes
                // DURANTE a carga, com isStyleLoaded() ainda falso, e cada
                // disparo so reagendava. O 'idle' do MapLibre significa "estilo
                // pronto e nada mais em voo", que e exatamente a condicao que
                // faltava para desenhar.
                this.miniMap.once('idle', () => {
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

    // O mapa principal carrega SO a linha de tracado. A fonte de pontos, que
    // antes vinha junto, era lida apenas pelo clique na linha, e esse caminho
    // passou a perguntar ao servico (ver getNearestPhoto).
    loadData = async () => {
        try {
            if (!this.map.getSource(this.streetViewLinesLayer['source'])) {
                // Uma leitura do escopo para a URL e para o carimbo (ver o minimapa acima).
                const escopoLinhas = sv360AtlasScope();
                this.map.addSource(this.streetViewLinesLayer['source'], sv360TileSource(config.streetView360.linesSource, escopoLinhas));
                this._linesAtlasId = escopoLinhas;

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
        // Paired with the attach in onAdd: a surface left registered keeps the shared notice
        // calling into a control that is gone.
        photo360Failures.detach();

        if (this._unsubBaseLayerChanged) {
            this._unsubBaseLayerChanged();
            this._unsubBaseLayerChanged = null;
        }
        if (this._unsubFloorChanged) {
            this._unsubFloorChanged();
            this._unsubFloorChanged = null;
        }
        if (this._unsubAtlasScope) {
            this._unsubAtlasScope();
            this._unsubAtlasScope = null;
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
            'source': this.pointsSourceRef.id,
            'source-layer': config.streetView360.pointsSourceLayer,
            "filter": ["==", PHOTO_PROPERTY, ""],
            'layout': {
                'icon-image': 'point-selected'
            }
        });
    }

    /**
     * Finds the nearest photo to a given coordinate.
     *
     * PERGUNTA-SE AO SERVICO, e nao ao mapa. Antes isto era um
     * querySourceFeatures sobre os tiles JA CARREGADOS, o que amarrava a
     * resposta ao que estava desenhado: abaixo do zoom minimo da fonte de pontos
     * nao existe tile, entao clicar na linha de tracado nao abria nada. O
     * servico responde pelo indice espacial, entao a resposta vale em qualquer
     * zoom e e a foto REALMENTE mais proxima.
     *
     * O cache por coordenada arredondada continua, agora poupando requisicao em
     * vez de varredura: cliques repetidos no mesmo trecho nao voltam ao servico.
     *
     * @param {Object} point - {lng, lat} coordinate
     * @returns {Promise<Object|null>} Photo with at least an id, or null
     */
    getNearestPhoto = async (point) => {
        const cacheKey = `${Math.round(point.lng * 1000)}_${Math.round(point.lat * 1000)}`;

        if (this.nearbyFeaturesCache.has(cacheKey)) {
            return this.nearbyFeaturesCache.get(cacheKey);
        }

        const photo = await fetchNearestPhoto(point.lng, point.lat);

        if (photo) {
            this.nearbyFeaturesCache.set(cacheKey, photo);
        }

        return photo;
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
            const photo = await this.getNearestPhoto(e.lngLat);

            if (photo?.[PHOTO_PROPERTY]) {
                this.isOpen = true;

                // Import and open viewer dynamically
                const { openViewer360WithPhoto, isStreetView360Open } = await import('./street_view_viewer.js');

                // If already open, just navigate to new photo
                if (isStreetView360Open()) {
                    const { navigateToTarget } = await import('./street_view_viewer.js');
                    await navigateToTarget(photo[PHOTO_PROPERTY]);
                } else {
                    await openViewer360WithPhoto(photo[PHOTO_PROPERTY], {
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
            this.streetViewLinesHitLayer?.['id']
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
