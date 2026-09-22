// Path: js/baselayers/base-layer.control.js

/**
 * @fileoverview Base layer control for switching map styles.
 * Delegates current layer state to StateManager.
 *
 * THE BASE LAYER ON SCREEN IS VIEW STATE OF THE PERSON, LIKE THE CAMERA (decision of the owner,
 * 2026-09-20, registered in docs/decisions/decisions-2026.md). NOTHING IN THIS FILE WRITES THE MAP
 * DOCUMENT: the selector, the fallback and every `switchMap` only DRAW. The base stored on the map
 * document is the SAVED one, written by exactly one gesture, "save view" (`saveMapView`,
 * `store/map-view.operations.js`), and READ here in two moments only: on entering a map that has
 * a saved view, and on the first paint after a boot or a wipe. Until then every base-layer
 * choice enqueued a `baseLayer` op, so the taste of one person in basemaps repainted the screen
 * of everyone in the atlas, a reader could not choose at all, and an editor WITHOUT access to a
 * private basemap overwrote it for everybody just by opening the map (the fallback persisted).
 *
 * THE CHOICE IS REMEMBERED ON THIS COMPUTER SINCE 2026-09-22 (owner's request), per map, and only
 * the SELECTOR remembers (`executeLayerChange`): `localStorage`, no op, no document
 * (`store/vista-da-pessoa.js`). On entering the map again (a map switch, an F5, reopening the
 * atlas) the remembered base outranks the saved one; a remembered base the catalogue of this person
 * no longer offers is skipped in silence, and the saved or default one takes over.
 */

import {
    getCurrentMapName,
    getCurrentBaseLayer,
    hasMapSavedPosition,
    getMapPosition,
    getCatalogLayers,
    getEventBus,
    getStateManager,
    getControl,
    applyMapEntryTemporalView
} from '../store';
// BY FILE: the remembered view of the person is read and written only by this control, the pin of
// `setCurrentMap` and the temporal switch, and it is not a store operation (no op, no document).
import { forgetRememberedMapView, personViewTarget, rememberMapView, rememberedMapView } from '../store/vista-da-pessoa.js';
import { EventTypes } from '../events/event_types.js';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { currentGlobeProjection } from '../store/atlas-appearance.service.js';
import cartaTopografica from './carta_topografica.js';
import cartaOrtoimagem from './carta_ortoimagem.js';
import osmLayer from './osm_layer.js';
import imagensLayer from './imagens_layer.js';
import bdgexLayer from './bdgex_layer.js';
import config from '../config.js';
import { resolveBasemapStyle, firstStyledBasemap } from './basemap-style.js';
import { faixaDeZoom, aplicarFaixaDeZoom } from './basemap-zoom.js';
import { baseStyleAlreadyOnMap, collectStyleIds, mergeApplicationStyle, withSwitchAppearance } from './style-transform.js';
import { applyTileLodParams } from '../map/tile-lod.js';
// DO ARQUIVO, e não do barrel `@js/terrain`: o barrel arrasta os dois gerentes de camada, e
// este controle é do caminho de boot do mapa.
import { getLayerFailureNotice } from '../terrain/layer-failure-notice.js';
import { setupMapFeatures } from '../layers';
// DO ARQUIVO, e não do barrel `../layers`: o barrel já é arrastado pela linha acima, mas o
// `clearFeatureSources` é do mesmo módulo e o caminho direto é o que o próprio barrel recomenda.
import { clearFeatureSources } from '../layers/layer_setup.js';
import { wireRemoteFeatureRender } from '../layers/remote-feature-render.js';
import { showError } from '../utilities';

const STYLE_MAP = {
    'carta-topografica': cartaTopografica,
    'carta-ortoimagem': cartaOrtoimagem,
    'osm': osmLayer,
    'imagens': imagensLayer,
    'bdgex': bdgexLayer
};

// A base com que o mapa NASCE, e este é o único lugar que diz qual é: `map_sig.js`
// cria o mapa com `initialBaseStyle()`, e o controle guarda os ids dessa mesma base
// para, na primeira troca, separar por exclusão o que é da base do que é da
// aplicação. Um mapa nascido com um estilo e um controle assumindo outro fazem a
// primeira troca manter a base velha INTEIRA por cima da nova, porque a exclusão é
// feita contra os ids errados.
export const DEFAULT_LAYER = 'carta-topografica';

/**
 * O estilo com que o mapa é criado: a mesma base que o controle assume.
 *
 * PASSA PELA MESMA RESOLUÇÃO QUE A TROCA USA (`resolveBasemapStyle`), e não pelo
 * módulo direto, que era o que `map_sig.js` importava. Hoje as duas formas dão o
 * MESMO objeto, porque o embutido ganha do publicado para os cinco ids que o
 * cliente traz (`basemap-style.js`); ir pela resolução é o que mantém as duas em
 * passo no dia em que o padrão deixar de ser um embutido.
 * @returns {Object|string|null} Especificação de estilo de DEFAULT_LAYER
 */
export function initialBaseStyle() {
    return resolveBasemapStyle(DEFAULT_LAYER, STYLE_MAP, config.basemapStyles);
}

class BaseLayerControl {
    constructor(uiManager, hillshadeConfig) {
        this.container = null;
        this.uiManager = uiManager;
        this.hillshadeConfig = hillshadeConfig;
        this._selectionManager = null;
        this._toolManager = null;
        this._analysisLayersManager = null;
        this._dataLayersManager = null;

        this.isChanging = false;
        this.changeDebounceTimer = null;

        // False until the first `switchMap` paints, and again after every store wipe: the next
        // entry then reads the base SAVED on the map document even without a saved position,
        // because there is no "what is on screen" worth keeping yet (the map is born with
        // `DEFAULT_LAYER`, and after a wipe the screen belongs to the atlas that just left).
        this._viewPainted = false;

        config.validateBasemapsConfig();

        // Os ids que a base ATUAL possui. O mapa é criado com `initialBaseStyle()`
        // (`map_sig.js`), e cada `setStyle` abaixo grava os ids da próxima base dentro
        // do próprio `transformStyle`, de modo que o conteúdo da aplicação se conhece
        // por exclusão: é o que a base anterior não declarava.
        this._baseStyleIds = collectStyleIds(initialBaseStyle());
    }

    /**
     * The style a basemap id renders with: the built-in module when there is one, else the style the
     * server published for it (`config.basemapStyles`).
     *
     * RESOLVED ON DEMAND, NOT SNAPSHOTTED IN THE CONSTRUCTOR, and that is the whole point of the
     * method. The control is built once, at map boot; a PRIVATE basemap only reaches `config` later
     * — when the user logs in, receives a grant, or opens an atlas that lends it — and leaves it
     * again on logout. A table built in the constructor could only ever describe the anonymous boot,
     * so the granted basemap would be offered by the selector and switch to something else.
     * @private
     * @param {string} id
     * @returns {Object|string|null}
     */
    _styleFor(id) {
        return resolveBasemapStyle(id, STYLE_MAP, config.basemapStyles);
    }

    /**
     * Os ids que este controle consegue REALMENTE aplicar: habilitados no catálogo E
     * resolvendo para algum estilo, na ordem de prioridade que o seletor mostra.
     *
     * RESOLVIDO NA HORA, pelo mesmo motivo de `_styleFor`: um mapa base privado só
     * entra em `config` depois do login e sai de novo no logout, então uma tabela
     * montada no construtor descreveria para sempre o boot anônimo.
     *
     * EXISTE PARA QUEM PRECISA PERGUNTAR ANTES DE TROCAR (2026-09-05, a base preferida
     * do terreno). `applySharedBasemap` passa o id por `getValidBasemapFallback` antes
     * de trocar, então um id que ninguém oferece não vira "não faz nada": vira uma
     * troca para a PRIMEIRA base habilitada, calada. Quem decide automaticamente tem
     * de checar a lista antes, e checar por fora exigiria o `STYLE_MAP`, que é privado
     * deste módulo.
     * @returns {string[]} Ids aplicáveis, em ordem de prioridade
     */
    get availableBasemaps() {
        return config.getEnabledBasemaps()
            .map(([id]) => id)
            .filter((id) => !!this._styleFor(id));
    }

    /**
     * The base this person remembers for a map on this computer, when it is still APPLICABLE.
     *
     * "Applicable" is `availableBasemaps`, the same list the selector offers: a base that left the
     * catalogue, or a private one this person lost access to (or that only arrives with a grant
     * still on its way), answers null and the saved view decides. The remembered entry is KEPT,
     * because a grant that arrives later makes it valid again on the next entry.
     * @private
     * @param {string} mapName
     * @returns {string|null}
     */
    _rememberedBaseLayer(mapName) {
        const id = rememberedMapView(mapName).baseLayer;
        return typeof id === 'string' && this.availableBasemaps.includes(id) ? id : null;
    }

    get currentLayer() {
        try {
            return getStateManager().get('baseLayer.activeLayer') || DEFAULT_LAYER;
        } catch {
            return DEFAULT_LAYER;
        }
    }

    set currentLayer(value) {
        try {
            getStateManager().set('baseLayer.activeLayer', value);
        } catch {
            // StateManager not available
        }
    }

    /**
     * Injects runtime dependencies needed by switchMap().
     * Called once during initialization in map_sig.js.
     */
    setDependencies({ selectionManager, toolManager, analysisLayersManager, dataLayersManager }) {
        this._selectionManager = selectionManager;
        this._toolManager = toolManager;
        this._analysisLayersManager = analysisLayersManager;
        this._dataLayersManager = dataLayersManager;

        // Repopulate the 2D map sources when a PEER's feature op arrives, then rebuild
        // the features tree (which reads from the sources). The remote-op handler only
        // updated the store, leaving the MapLibre sources — and thus the live map and
        // the tree — stale until a base-layer/map switch.
        if (this._unwireRemoteRender) this._unwireRemoteRender();
        this._unwireRemoteRender = wireRemoteFeatureRender(async () => {
            await setupMapFeatures(this.map, this._analysisLayersManager, this._dataLayersManager, getEventBus());
            getEventBus().emit(EventTypes.LAYERS_CHANGED, {});
        });

        // A full store wipe (logout / "Limpar Tudo" / non-additive import) resets the store + loads a
        // BLANK map, but nothing repopulated the MapLibre feature sources — so the OLD map's features
        // stayed drawn on the canvas after logout. Sem um ouvinte AQUI o defeito relatado volta
        // (`tests/e2e-ui/browser-logout-clears-map.repro.spec.js`), porque depois do wipe nada mais
        // repinta o mapa.
        //
        // E A RESPOSTA É PROPORCIONAL AO WIPE, que é o que `rebuild` diz. Com `rebuild` verdadeiro o
        // escopo que o wipe deixou vai ser USADO (trocar de atlas, "Limpar Tudo", importar), e a
        // remontagem inteira é o certo: ela restaura terreno, camadas de catálogo e filtros a partir
        // do mapa em branco. Com `rebuild` falso o escopo morre em seguida (a saída da conta destrói
        // o namespace), e remontá-lo é pintar um mapa para jogá-lo fora. Só o traço visual precisa
        // sumir, e é isso que `clearFeatureSources` faz.
        //
        // O PADRÃO É `true` porque o evento tem oito outros ouvintes que não passam argumento nenhum,
        // e um wipe sem opinião sobre isto é o wipe que quer o comportamento antigo.
        if (this._unsubAllCleared) this._unsubAllCleared();
        this._unsubAllCleared = getEventBus().on(EventTypes.ALL_DATA_CLEARED, async ({ rebuild = true } = {}) => {
            // The screen no longer belongs to any map of the scope that comes next.
            this._viewPainted = false;
            if (!rebuild) {
                clearFeatureSources(this.map);
                return;
            }
            await setupMapFeatures(this.map, this._analysisLayersManager, this._dataLayersManager, getEventBus());
        });
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');

        const enabledBasemaps = config.getEnabledBasemaps();
        const layoutClass = config.getBasemapLayoutClass(enabledBasemaps.length);

        this.container.className = `mapboxgl-ctrl base-layer-control ${layoutClass}`;

        // Built node by node instead of by innerHTML: the basemap id, name and image
        // come from the server catalog (free-form strings, admin-authored), and both
        // the id and the image landed inside quoted attributes.
        enabledBasemaps.forEach(([id, basemapConfig], index) => {
            const label = document.createElement('label');
            label.className = 'layer-switch';

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'base-layer';
            input.value = id;
            input.checked = index === 0;

            const span = document.createElement('span');
            if (basemapConfig.image) {
                const img = document.createElement('img');
                img.className = 'layer-icon';
                img.src = basemapConfig.image;
                span.appendChild(img);
            }
            span.appendChild(document.createTextNode(basemapConfig.name ?? ''));

            label.appendChild(input);
            label.appendChild(span);
            this.container.appendChild(label);
        });

        this.container.querySelectorAll('input[name="base-layer"]').forEach((input) => {
            input.addEventListener('change', this.handleLayerChange);
        });

        return this.container;
    }

    onRemove() {
        if (this.changeDebounceTimer) {
            clearTimeout(this.changeDebounceTimer);
            this.changeDebounceTimer = null;
        }

        this.container?.remove();
        this.map = null;
    }

    handleLayerChange = async (event) => {
        const layer = event.target.value;
        this.syncVisualState(layer);

        if (this.isChanging) {
            return;
        }

        if (this.changeDebounceTimer) {
            clearTimeout(this.changeDebounceTimer);
        }

        this.changeDebounceTimer = setTimeout(async () => {
            await this.executeLayerChange(layer);
        }, 50);
    }

    /**
     * The person picked a base layer. It DRAWS and it is REMEMBERED on this computer for this map;
     * nothing is written to the map document and nothing is enqueued, so the gesture cannot be
     * refused by role, by map lock or by a recovery in progress.
     * @param {string} newLayer - Base layer id picked in the selector (desktop or phone).
     */
    async executeLayerChange(newLayer) {
        this.isChanging = true;
        const previousLayer = this.currentLayer;
        // Resolved BEFORE the switch: the choice belongs to the atlas and the map it was made on.
        const alvoDaVistaLembrada = personViewTarget();

        try {
            // MESMO mapa do atlas, base nova: o que está desenhado sobrevive ao
            // `setStyle` pelo `transformStyle` e NÃO pode ser reescrito. Ver
            // `layers/setup-mode.js` sobre por que reescrever aqui apaga o traço
            // que o despachante de diff ainda não entregou.
            await this.switchMap(false, { sameMap: true, baseLayer: newLayer });
            // ONLY WHAT WAS ASKED AND DRAWN is remembered. When `switchLayer` fell back to another
            // base, the person did not choose that one, and remembering it would pin a fallback.
            if (this.currentLayer === newLayer) rememberMapView(alvoDaVistaLembrada, { baseLayer: newLayer });
        } catch (error) {
            console.error('Error changing base layer:', error);
            this.syncVisualState(previousLayer);
            showError('Erro ao trocar camada base');
        } finally {
            this.isChanging = false;
        }
    }

    async switchLayer(layer) {
        // config.basemaps and the style lists are separate: a basemap can be enabled
        // in config (so getValidBasemapFallback accepts it) and still have no style
        // anywhere. setStyle(undefined) never completes, so fall back to a layer that
        // actually has one — and look for it among the OFFERED basemaps, in priority
        // order, so the fallback is one the selector also shows as selected.
        if (!this._styleFor(layer)) {
            const offered = config.getEnabledBasemaps().map(([id]) => id);
            const fallback = firstStyledBasemap(offered, STYLE_MAP, config.basemapStyles);
            console.warn(`Base layer "${layer}" has no registered style. Using "${fallback}".`);
            // O SILÊNCIO ERA O DEFEITO, e ele não chegava por evento nenhum: nenhum `error` do
            // MapLibre, nenhum tile falho, nada que o painel de camadas indisponíveis pudesse
            // pegar. A pessoa escolhia um mapa base, o produto trocava para OUTRO, e a única
            // pista era um `console.warn`. Quem sente isto primeiro é quem enxerga acervo
            // privado que não resolve para estilo, porque para ele o cartão diz "Privado" e a
            // base simplesmente é outra.
            //
            // O NOME É CONHECIDO AQUI, ao contrário do caso da falha de TILE: quem pediu ainda
            // está na variável, antes da reatribuição. É a única forma deste aviso que pode
            // nomear a camada sem mentir.
            getLayerFailureNotice(this.map).reportBasemapFailure({
                name: config.basemaps?.[layer]?.name || layer,
            });
            // No basemap at all resolves to a style (an empty catalog): return without
            // touching the map, exactly as before. Switching to nothing would blank it.
            if (!fallback) {
                return;
            }
            layer = fallback;
        } else {
            // O PEDIDO RESOLVEU: retirar a acusação vale tanto quanto levantá-la, e um aviso
            // que fica depois de resolvido treina a ignorar aviso.
            getLayerFailureNotice(this.map).clearBasemapFailure();
        }

        this.uiManager?.saveChangesAndClosePanel?.();

        const styleUrl = this._styleFor(layer);
        // DECIDE PELO QUE ESTÁ NO MAPA, nunca pelo que o controle acredita. A crença
        // é um id guardado no StateManager, e um id não determina mais um estilo neste
        // ramo: o de uma base NÃO embutida resolve por `config.basemapStyles`, tabela
        // que `store/sync/atlas-settings.service.js` grava e apaga em tempo de execução
        // conforme a concessão chega ou é retirada. Comparar id deixaria a base velha
        // desenhada com o seletor marcando a nova.
        //
        // A decisão pelo mapa também DISPENSA a espera pelo `styledata` que nunca vem:
        // `carta_topografica` e `osm_layer` são o mesmo estilo (ver
        // `baselayer-style-uniqueness.repro.test.js`), o diff do MapLibre resolve em
        // zero operações e não emite evento, e a espera cobrava os 10 s inteiros do
        // temporizador abaixo.
        if (!baseStyleAlreadyOnMap(this._styleOnMap(), styleUrl, (id) => !!this.map.getLayer(id))) {
            const styleLoadPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Timeout loading style for layer: ${layer}`));
                }, 10000);

                function cleanup() {
                    clearTimeout(timeout);
                    map.off('styledata', handleStyleData);
                }

                function handleStyleData() {
                    cleanup();
                    resolve();
                }

                const { map } = this;
                map.on('styledata', handleStyleData);
            });

            // `transformStyle` PRESERVA as sources e as layers da aplicação (pelas
            // MESMAS referências, de modo que o diff do MapLibre não vê mudança nelas)
            // e troca só o mapa base.
            //
            // SEM ELE, NESTA ÁRVORE, NÃO HAVIA SEQUER DIFF, e isso foi medido no
            // Chromium em 2026-09-04, não deduzido do relatório de origem: o
            // `diffStyles` do MapLibre 5.18 levantava sobre o estilo do app
            // ("Unable to perform style diff: Cannot read properties of undefined
            // (reading 'type'). Rebuilding the style from scratch"), e TODA troca de
            // base caía na remontagem do estilo do zero, com as 74 sources e as 87
            // layers do mapa destruídas e recriadas. Com o hook: uma source e uma
            // layer removidas, que são exatamente as da base anterior.
            //
            // E AQUI ESTÁ A METADE QUE ESTE RAMO ACRESCENTA: dezesseis dessas sources
            // são escritas pelo despachante de diff (`layers/geojson-dispatcher.js`),
            // que guarda uma fila POR source. Recriar a source deixa a fila apontando
            // para outro objeto, e a coleção inteira que a remontagem escreve em
            // seguida é um `replaceAll` que DESCARTA o que estava na fila.
            //
            // A PROJEÇÃO E O CÉU VÃO DENTRO DO ESTILO (`withSwitchAppearance`), lidos no instante
            // em que o MapLibre aplica este estilo. Eles eram escritos no mapa DEPOIS do primeiro
            // `styledata`, que não quer dizer "carregado", e `setProjection` num estilo ainda em
            // remontagem lança "Style is not done loading." (release 1c3c19c9, na troca de mapa).
            this.map.setStyle(styleUrl, {
                transformStyle: (previous, next) => {
                    const merged = mergeApplicationStyle(previous, next, this._baseStyleIds);
                    this._baseStyleIds = collectStyleIds(next);
                    // A escolha do ATLAS, com o globo como padrão, nunca a do deploy direto,
                    // senão trocar de mapa base desfaria a projeção que o projeto pediu.
                    return withSwitchAppearance(merged, {
                        globe: currentGlobeProjection(),
                        terrainActive: Boolean(getControl('TerrainControl')?._wasTerrainActive),
                    });
                },
            });
            // MapLibre diffs the incoming style against the current one and,
            // when the diff yields no operations, returns without ever firing
            // 'styledata' (Style.setState). That happens whenever two entries
            // of STYLE_MAP hold the same style, and waiting for the event would
            // stall the boot for the full timeout. A missed event must not be
            // fatal: the style is either already correct or MapLibre finishes
            // applying it on its own.
            await styleLoadPromise.catch((error) => console.warn(`[base-layer] ${error.message}`));

            // O `calculateTileZoom` é estado por OBJETO de source, e o mapa base que acabou
            // de entrar traz sources NOVAS, que nascem com o padrão do MapLibre. Antes do
            // `transformStyle` o estilo inteiro era remontado e as 74 perdiam o parâmetro
            // juntas; hoje só as da base nova, e esta linha é o que fecha os dois casos.
            // Fica DENTRO do `if`: quando o portão decide "já está no mapa" não houve
            // `setStyle`, logo não houve source nova.
            applyTileLodParams(this.map, config.map2d.sourceTileLodParams);
            // Nenhum `setProjection` nem `setSky` aqui DEPOIS da espera: os dois foram para dentro
            // do estilo, no `transformStyle` acima. Escritos neste ponto eles lançavam sobre um
            // estilo em remontagem, e numa troca dupla rápida aplicariam a projeção da primeira.
        }
        // FORA do `if`, ao contrário de antes, e a razão é o próprio portão acima. Quando ele
        // decide "já está no mapa", o estilo pedido ESTÁ desenhado, então a crença tem de dizer
        // isso; deixada dentro do bloco ela ficaria presa no id anterior enquanto o seletor e o
        // registro do mapa já mostram o novo. Quem paga isso é `applySharedBasemap`, que devolve
        // `this.currentLayer` como a única resposta honesta sobre o que está na tela.
        this.currentLayer = layer;
        // FORA do `if` acima, e essa é a metade que importa. O getter de `currentLayer` devolve
        // `carta-topografica` quando não há estado, e o mapa NASCE com esse estilo
        // (`map_sig.js`), então no boot mais comum o bloco inteiro é pulado, e a faixa do mapa
        // base inicial nunca seria aplicada. O mesmo vale para uma troca que o MapLibre resolve
        // como diff vazio.
        this._applyBasemapZoom(layer);
        await this._updateHillshadeVisibility();
        this.syncVisualState(layer);
    }

    /**
     * O estilo que o mapa tem AGORA, ou `null` quando ele ainda não tem nenhum.
     *
     * O `try` não é decoração. `Map.getStyle()` chama `Style.serialize()`, que lê
     * `this.stylesheet` sem guarda, e essa propriedade é `null` desde o construtor até o
     * primeiro estilo terminar de carregar (medido no bundle em uso: o vendorizado 5.18
     * quando isto foi escrito, hoje `node_modules/maplibre-gl`, 6.7.0 pelo npm).
     * `switchMap` é alcançável antes disso pelo caminho de
     * boot que não passa pelo `load` do mapa, e o portão de `switchLayer` é a primeira linha
     * deste arquivo a consultar o estilo.
     *
     * `null` é a resposta CERTA nesse caso, e não uma degradação: um mapa que ainda não tem
     * estilo certamente não tem a base pedida, então o portão manda aplicar, que é o que o
     * código fazia antes deste lote.
     * @private
     * @returns {Object|null}
     */
    _styleOnMap() {
        try {
            return this.map?.getStyle() || null;
        } catch {
            return null;
        }
    }

    /**
     * Aperta a câmera na faixa de zoom DAQUELE mapa base.
     *
     * É o único nível de zoom configurável do produto (decisão do dono, 2026-08-31): a
     * aplicação é fixa em [2, 21] (`config.map2d`) e o atlas não tem zoom nenhum. O mapa base
     * aperta dentro da faixa fixa, declarado em `config.minzoom`/`maxzoom` da linha de catálogo
     * e servido em `config.basemaps[id]`.
     *
     * A DECISÃO E A ORDEM DE ESCRITA moram em `basemap-zoom.js`, puras e dirigíveis por um mapa
     * falso que impõe as guardas reais do MapLibre. O que fica aqui é a leitura do catálogo,
     * que é o que este controle já faz para estilo e para nome.
     *
     * @private
     * @param {string} id - Id do mapa base já resolvido (depois do fallback).
     */
    _applyBasemapZoom(id) {
        aplicarFaixaDeZoom(this.map, faixaDeZoom(config.basemaps?.[id], config.map2d), config.map2d.minZoom);
    }

    syncVisualState(layer = null) {
        const targetLayer = layer || this.currentLayer;

        this.container.querySelectorAll('input[name="base-layer"]').forEach(input => {
            input.checked = (input.value === targetLayer);
        });

        this.updateActiveState(targetLayer);
    }

    /**
     * WHICH BASE THIS PAINT DRAWS, in order, and the order is the rule of the product:
     *
     *   1. `options.baseLayer`: someone asked for a base by name (the selector, a briefing slide).
     *   2. ENTERING a map (`applyPosition`, or the first paint after a boot or a wipe, which is how
     *      an atlas opens): the base THIS PERSON REMEMBERS for this map on this computer
     *      (`store/vista-da-pessoa.js`), when their catalogue still offers it. Skipped in silence
     *      otherwise: the notice of a base that does not resolve belongs to `switchLayer`, and a
     *      remembered base that is simply not offered today is not a failure of anything.
     *   3. ENTERING a map that has a SAVED VIEW: the saved base, together with the saved camera and
     *      the saved temporal switch. The three are one thing.
     *   4. The first paint after a boot or a wipe: the base on the map document, because there is
     *      nothing on screen worth keeping yet.
     *   5. Everything else (entering a map with no saved view, undo/redo, import, search): what
     *      is ON SCREEN stays. The base is view state of the person, like the camera, which also
     *      stays where it is when the map has no saved position.
     *
     * `options.restoreSavedView` is the way back to the saved view ("Restaurar posição"): the
     * remembered view of this person for this map is FORGOTTEN first, so 3 decides, and from then
     * on the person follows the saved view like anybody who never chose.
     *
     * The fallback for an id the catalog of this person does not offer is DRAW-ONLY. It used to
     * be written back to the map document, and that is how an editor without a grant to a private
     * basemap replaced it for everyone by opening the map
     * (`tests/integration/mapa-base-e-vista-da-pessoa.repro.test.js`). It is not remembered either.
     *
     * @param {boolean} [applyPosition=true] - Entrada num mapa: restaura a VISTA salva dele.
     * @param {{ sameMap?: boolean, baseLayer?: string, restoreSavedView?: boolean }} [options] -
     *   `sameMap` quando o mapa do atlas NÃO mudou (troca só do mapa base), único caso em que o
     *   conteúdo desenhado pode ser mantido. Ausente é o padrão certo: os outros chamadores
     *   (desfazer/refazer, troca de mapa, import, briefing, busca) mudaram o CONTEÚDO, e ali
     *   remontar é a obrigação. `baseLayer` pede uma base pelo nome, sem gravar nada.
     *   `restoreSavedView` é o gesto de voltar à vista salva: esquece a vista lembrada da pessoa.
     */
    async switchMap(applyPosition = true, options = {}) {
        const currentMapName = await getCurrentMapName();
        const hasSavedView = applyPosition && await hasMapSavedPosition(currentMapName);
        if (options.restoreSavedView && hasSavedView) {
            forgetRememberedMapView(personViewTarget(currentMapName));
        }
        const entering = applyPosition || !this._viewPainted;
        const remembered = entering ? this._rememberedBaseLayer(currentMapName) : null;

        let baseLayer;
        if (options.baseLayer) {
            baseLayer = options.baseLayer;
        } else if (remembered) {
            baseLayer = remembered;
        } else if (hasSavedView || !this._viewPainted) {
            baseLayer = await getCurrentBaseLayer();
        } else {
            baseLayer = this.currentLayer;
        }

        const validFallback = config.getValidBasemapFallback(baseLayer);
        if (baseLayer !== validFallback) {
            console.warn(`Base layer "${baseLayer}" not available. Using "${validFallback}".`);
            baseLayer = validFallback;
        }

        this._toolManager.deactivateCurrentTool();
        this._selectionManager.deselectAllFeatures();

        await this.switchLayer(baseLayer);
        this._viewPainted = true;

        // The saved position comes FIRST, and the order is the point: every tool
        // that re-anchors its features to the zoom (military symbol, brush,
        // label, boundary) does so inside `setupMapFeatures`, reading
        // `map.getZoom()`. Restoring the view afterwards meant that pass ran at
        // the map's initial zoom and the features were only fixed by the next
        // zoom EVENT, which on a `jumpTo` may land in the same frame as the
        // dependent-feature restore. `applyMapSavedPosition` reads persisted
        // position and calls `jumpTo`; it needs nothing `setupMapFeatures`
        // produces, so it can move ahead of it.
        if (applyPosition) {
            await this.applyMapSavedPosition(currentMapName);
        }
        // The temporal third of the saved view. Only with a saved view: a map without one keeps
        // the switch this session pinned for it (`store/temporal.operations.js`), and the pin
        // already read what this person remembers. With one, the remembered switch still outranks
        // the saved one, like the base above.
        if (hasSavedView) {
            await applyMapEntryTemporalView(currentMapName);
        }

        await setupMapFeatures(this.map, this._analysisLayersManager, this._dataLayersManager, getEventBus(), {
            contentPreserved: options.sameMap === true,
        });

        getEventBus().emit(EventTypes.BASE_LAYER_CHANGED, { layer: this.currentLayer });
    }

    /**
     * Applies a base layer asked for from OUTSIDE the selector (a shared link, the preferred base
     * of the terrain), keeping the drawn content.
     *
     * It never wrote anything, and since 2026-09-20 neither does any other path of this control,
     * so what is left of its reason to exist is the second half:
     *
     * `setupMapFeatures` IS NOT OPTIONAL AFTER A STYLE SWAP, and forgetting it is
     * the trap this method exists to close: `setStyle` drops every source and layer
     * the app added, so the drawn features vanish and nothing reports an error. It
     * is the same pairing `switchMap` does, which is why this lives next to it
     * rather than in the deep-link module.
     *
     * The position is deliberately NOT touched here: the link carries its own
     * camera, and `applyMapSavedPosition` would overwrite it with the stored one.
     *
     * @param {string} basemapId - Base layer id asked for.
     * @returns {Promise<string>} The id actually applied, which differs from the
     *   argument when the requested layer is unavailable and a fallback took over.
     */
    async applySharedBasemap(basemapId) {
        await this.switchLayer(config.getValidBasemapFallback(basemapId));
        this._viewPainted = true;
        // `contentPreserved`: o link chega DEPOIS de o atlas estar montado e pintado (ver
        // `deep-link/deep-link.js`, `applySharedView`), então o que está desenhado é o do
        // mapa certo e o `transformStyle` acabou de mantê-lo. Se o MapLibre tiver caído na
        // remontagem do estilo do zero, `resolveSetupMode` percebe pela source ausente e
        // remonta assim mesmo.
        await setupMapFeatures(this.map, this._analysisLayersManager, this._dataLayersManager, getEventBus(), {
            contentPreserved: true,
        });

        // READ BACK, never echo the argument: `switchLayer` has a SECOND fallback of
        // its own (a basemap enabled in config can still have no registered style),
        // so the only honest answer about what is on screen is the field it sets.
        getEventBus().emit(EventTypes.BASE_LAYER_CHANGED, { layer: this.currentLayer });
        return this.currentLayer;
    }

    async applyMapSavedPosition(mapName = null) {
        try {
            const targetMapName = mapName || await getCurrentMapName();
            const hasSavedPosition = await hasMapSavedPosition(targetMapName);

            if (!hasSavedPosition) {
                return false;
            }

            const position = await getMapPosition(targetMapName);
            this.map.jumpTo({
                center: [position.center_long, position.center_lat],
                bearing: position.bearing,
                pitch: position.pitch,
                zoom: position.zoom
            });

            return true;
        } catch (error) {
            console.error('Error applying saved position:', error);
            return false;
        }
    }

    async _updateHillshadeVisibility() {
        if (!this.hillshadeConfig?.enabled) {
            return;
        }

        try {
            const catalogLayers = await getCatalogLayers();
            const hillshadeLayer = catalogLayers?.find(l => l.type === CATALOG_ITEM_TYPES.HILLSHADE);

            if (hillshadeLayer?.visible && hillshadeLayer.status !== 'unavailable') {
                const terrainControl = getControl('TerrainControl');
                terrainControl?.setHillshadeVisibility?.(true);
            }
        } catch (error) {
            console.warn('Could not update hillshade visibility:', error);
        }
    }

    updateActiveState(activeLayer) {
        this.container.querySelectorAll('.layer-switch span').forEach(span => {
            span.classList.remove('active-layer');
        });

        const activeSpan = this.container.querySelector(`input[value="${activeLayer}"]`)?.nextElementSibling;
        activeSpan?.classList.add('active-layer');
    }
}

export default BaseLayerControl;
