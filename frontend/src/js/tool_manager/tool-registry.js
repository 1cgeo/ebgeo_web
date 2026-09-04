// Path: js/tool_manager/tool-registry.js

/**
 * @fileoverview O CATALOGO DAS FERRAMENTAS DO MAPA, e o unico lugar que sabe carregar uma.
 *
 * POR QUE ELE EXISTE. A pagina do mapa baixava e executava as ferramentas inteiras a cada
 * carga, sem clique nenhum: `military_tools` entrava com 47 modulos e 820 kB de fonte,
 * `draw_tools` com 36 modulos e 652 kB, tudo por import estatico de `map_sig.js`. O perfil de
 * CPU do boot media 1659 ms, dos quais 1096 ms so de compilar e executar script. Ferramenta e
 * gesto: ela so precisa existir quando alguem a aciona.
 *
 * O CORTE JA ESTAVA DESENHADO NO CODIGO, e este arquivo so o executa. `toolbar.constants.js`
 * descreve cada botao por `controlKey`, que e uma STRING, e nunca importou uma ferramenta. A
 * instancia so era usada de verdade no clique. O que faltava era um lugar que soubesse, SEM
 * carregar nada, o tipo de cada ferramenta (para pintar o botao ativo) e como carregar a que
 * o usuario pediu.
 *
 * OS TRES CONTRATOS DESTA TABELA, e cada um fecha um caminho que ACONTECE SEM CLIQUE:
 *
 *   1. `tipoDeUi` — o que `activeTool.type` vale quando a ferramenta esta ativa. Hoje o
 *      ToolManager o deriva de `tool.constructor.name`, o que so funciona porque o build usa
 *      `keepNames: true`. A coluna elimina essa fragilidade E responde sincrono, que e o que o
 *      pintor de botao precisa: ele nao pode esperar por rede.
 *
 *   2. `tipoDeFeicao` / `fontes` / `alcaDeEdicao` — o SelectionManager procura o controle por
 *      tipo ao CLICAR numa feicao ja desenhada, sem gesto de ferramenta nenhum. Ele recebe
 *      estes tres campos como descritor ansioso e resolve o modulo so quando a selecao de fato
 *      acontece (ver `registrarNoSelectionManager`).
 *
 *   3. `zoom` / `zoomModelo` / `regenImagem` — o boot desenha o que ja estava no mapa.
 *      `layers/styles/*.js` chama `applyZoomCorrections` de forma SINCRONA no setup das
 *      camadas, e `layer_setup.js` regenera o PNG local de simbolo militar quando um snapshot
 *      remoto chega. Os dois entram aqui como REGISTRO ANSIOSO de uma closure: o registro custa
 *      uma funcao, o modulo so vem na primeira feicao que precisar dele. `zoomModelo` e a
 *      variante do limite: a conta dele nao cabe na tripla `size`/`calculatedSize`, entao a
 *      tabela declara a FUNCAO PURA que a faz (`withBoundaryZoomSizes`), e o stand-in devolve
 *      so os numeros. A geometria, que e a outra metade do que o controle de verdade refaz,
 *      NAO pode ser sincrona aqui (ela le Turf), e por isso chega na primeira passada de zoom
 *      depois que o modulo sobe.
 *
 * TODO ESPECIFICADOR DE `import()` E UM LITERAL DE STRING, e isso nao e estilo. O guarda de
 * peso (`tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`) percorre o grafo por regex e so
 * enxerga literais; um template com variavel apagaria a aresta e o controle positivo do guarda
 * ficaria vermelho. O bundler tem a mesma limitacao, e faria um chunk por pasta inteira.
 *
 * @module tool_manager/tool-registry
 */

import { registerControl } from '../store/index.js';
import { registerImageRegenerator } from '../layers/image-regen-registry.js';
import { applyZoomCorrections as aplicarCorrecaoDeZoom } from './helpers/zoom-correction.helpers.js';
// Folha de zero imports, como a de cima, e no MESMO chunk (core): declarar a conta do limite
// aqui nao traz `military_tools` de volta para o payload do boot.
import { withBoundaryZoomSizes as comTamanhosDeZoomDoLimite } from './helpers/boundary-zoom.model.js';
// Pelo mesmo motivo, e por isso o modelo da linha de coordenacao mora aqui e nao na pasta da
// ferramenta: `layers/styles/` tambem le a expressao de largura dele.
import {
    withCoordinationLineZoomSizes as comTamanhosDeZoomDaLinhaDeCoordenacao
} from './helpers/coordination-line-zoom.model.js';
import { ensureTurf } from '@utils/turf-loader.js';

// ============================================================================================
// A TABELA
// ============================================================================================

/**
 * @typedef {Object} EntradaDeFerramenta
 * @property {string} tipoDeUi - O valor de `activeTool.type` quando ativa (pinta o botao).
 * @property {string} classe - Nome da classe do controle, como o ToolManager o derivaria.
 * @property {string|null} tipoDeFeicao - O `properties.source` que ela possui, ou null.
 * @property {string[]} fontes - Fontes MapLibre que ela possui (`getSourceNames`).
 * @property {string|null} alcaDeEdicao - Fonte das alcas de edicao (`getEditHandleSource`).
 * @property {boolean} [ansiosa] - Instanciada no boot por `map_sig.js` e semeada aqui.
 * @property {Object} [zoom] - Config de `applyZoomCorrections`, quando a camada a chama no boot.
 * @property {(props: Object, zoom: number) => Object} [zoomModelo] - Alternativa a `zoom` para a
 *   ferramenta cuja correcao nao cabe na tripla `size`/`calculatedSize`: funcao PURA que devolve
 *   as propriedades com os derivados daquele zoom.
 * @property {string} [regenImagem] - `properties.source` cujo PNG local ela sabe regenerar.
 * @property {string[]} [encaminhados] - Metodos que o stand-in encaminha de forma assincrona.
 * @property {() => Promise<Object>} carregar - `import()` do modulo do controle.
 */

/** Config compartilhada: simbolo, medida e declinacao corrigem `size` do mesmo jeito. */
const ZOOM_DE_SIMBOLO = Object.freeze({
    sourceProperty: 'size',
    calculatedProperty: 'calculatedSize',
    maxValue: 10
});

/**
 * O catalogo, por `controlKey` de `toolbar.constants.js`.
 *
 * ESTA TABELA CARREGA TODO TIPO DE FEICAO SELECIONAVEL, e o guarda
 * `registro-tipos-cobertura.test.js` cobra isso: ate esta onda a lista morava em `map_sig.js`,
 * repetida em quatro lugares soltos (SELECTION_CONTROLS, CONTROL_REGISTRY e os DOIS literais
 * `controls:` da barra e do teclado). Os quatro viraram este.
 */
export const FERRAMENTAS = Object.freeze({
    // ---------- Desenho: ANSIOSAS ----------
    // As seis primeiras ficam no payload do boot de proposito, e o motivo NAO e comodidade.
    // `layers/styles/point.layers.js`, `content.layers.js` e `line.layers.js` chamam
    // `applyZoomCorrections` do controle de forma SINCRONA no setup das camadas, e o de ponto
    // tem logica propria (rotulo) que nenhum stand-in reproduz sem copiar. `line` e `polygon`
    // ainda respondem por `updateFeatureMeasurement` no `layer_setup.js` e pelo
    // `DEFAULT_PROPERTIES` que `import.control.js` le na importacao. Esses arquivos estao fora
    // da superficie desta onda. Custo medido do que ficou: 24 modulos, 355 kB de fonte.
    pointControl: {
        tipoDeUi: 'point', classe: 'AddPointControl',
        tipoDeFeicao: 'point', fontes: ['points'], alcaDeEdicao: null, ansiosa: true,
        carregar: () => import('../draw_tools/point_tool/add_point_control.js')
    },
    lineControl: {
        tipoDeUi: 'line', classe: 'AddLineControl',
        tipoDeFeicao: 'line', fontes: ['lines'], alcaDeEdicao: 'line-edit-handles', ansiosa: true,
        carregar: () => import('../draw_tools/line_tool/add_line_control.js')
    },
    polygonControl: {
        tipoDeUi: 'polygon', classe: 'AddPolygonControl',
        tipoDeFeicao: 'polygon', fontes: ['polygons'], alcaDeEdicao: 'polygon-edit-handles', ansiosa: true,
        carregar: () => import('../draw_tools/polygon_tool/add_polygon_control.js')
    },
    textControl: {
        tipoDeUi: 'text', classe: 'AddTextControl',
        tipoDeFeicao: 'text', fontes: ['texts'], alcaDeEdicao: 'text-edit-handles', ansiosa: true,
        carregar: () => import('../draw_tools/text_tool/add_text_control.js')
    },
    imageControl: {
        tipoDeUi: 'image', classe: 'AddImageControl',
        tipoDeFeicao: 'image', fontes: ['images'], alcaDeEdicao: null, ansiosa: true,
        carregar: () => import('../draw_tools/image_tool/add_image_control.js')
    },
    brushControl: {
        tipoDeUi: 'brush', classe: 'AddBrushControl',
        tipoDeFeicao: 'brush', fontes: ['brushes'], alcaDeEdicao: null, ansiosa: true,
        carregar: () => import('../draw_tools/brush_tool/add_brush_control.js')
    },

    // ---------- Desenho: TARDIAS ----------
    rectangleControl: {
        tipoDeUi: 'rectangle', classe: 'AddRectangleControl',
        tipoDeFeicao: 'rectangle', fontes: ['rectangles'], alcaDeEdicao: 'rectangle-edit-handles',
        carregar: () => import('../draw_tools/rectangle_tool/add_rectangle_control.js')
    },
    circleControl: {
        tipoDeUi: 'circle', classe: 'AddCircleControl',
        tipoDeFeicao: 'circle', fontes: ['circles'], alcaDeEdicao: 'circle-edit-handles',
        carregar: () => import('../draw_tools/circle_tool/add_circle_control.js')
    },
    ellipseControl: {
        tipoDeUi: 'ellipse', classe: 'AddEllipseControl',
        tipoDeFeicao: 'ellipse', fontes: ['ellipses'], alcaDeEdicao: 'ellipse-edit-handles',
        carregar: () => import('../draw_tools/ellipse_tool/add_ellipse_control.js')
    },
    sectorControl: {
        tipoDeUi: 'sector', classe: 'AddSectorControl',
        tipoDeFeicao: 'sector', fontes: ['setores'], alcaDeEdicao: 'sector-edit-handles',
        carregar: () => import('../draw_tools/sector_tool/add_sector_control.js')
    },
    azimuthDistanceControl: {
        // O unico controle com `type` proprio na classe; a tabela repete o valor DELE, nao a
        // formula do nome, senao o botao nunca acenderia.
        tipoDeUi: 'azimuth_distance', classe: 'AddAzimuthDistanceControl',
        // Ela NAO tem fonte propria: grava nas fontes de ponto, linha e poligono, marcando as
        // feicoes com `properties.source = 'azimuth_distance'`. E assim que a varredura de
        // clique as separa das feicoes de desenho que dividem a mesma fonte.
        tipoDeFeicao: 'azimuth_distance', fontes: ['points', 'lines', 'polygons'], alcaDeEdicao: null,
        carregar: () => import('../azimuth_distance_tool/add_azimuth_distance_control.js')
    },

    // ---------- Militar: TARDIAS ----------
    militarySymbolControl: {
        tipoDeUi: 'militarysymbol', classe: 'AddMilitarySymbolControl',
        tipoDeFeicao: 'military_symbol', fontes: ['military_symbols'], alcaDeEdicao: null,
        zoom: ZOOM_DE_SIMBOLO, regenImagem: 'military_symbol',
        carregar: () => import('../military_tools/military_symbol_tool/add_military_symbol_control.js')
    },
    coordinationMeasureControl: {
        tipoDeUi: 'coordinationmeasure', classe: 'AddCoordinationMeasureControl',
        tipoDeFeicao: 'coordination_measure', fontes: ['coordination_measures'], alcaDeEdicao: null,
        zoom: ZOOM_DE_SIMBOLO, regenImagem: 'coordination_measure',
        carregar: () => import('../military_tools/coordination_measure_tool/add_coordination_measure_control.js')
    },
    declinationControl: {
        tipoDeUi: 'declination', classe: 'AddDeclinationControl',
        tipoDeFeicao: 'magnetic_declination', fontes: ['magnetic_declinations'], alcaDeEdicao: null,
        zoom: ZOOM_DE_SIMBOLO, regenImagem: 'magnetic_declination',
        carregar: () => import('../military_tools/declination_tool/add_declination_control.js')
    },
    arrowControl: {
        tipoDeUi: 'arrow', classe: 'AddArrowControl',
        tipoDeFeicao: 'arrow', fontes: ['arrows'], alcaDeEdicao: 'arrow-edit-handles',
        carregar: () => import('../military_tools/arrow_tool/add_arrow_control.js')
    },
    boundaryControl: {
        tipoDeUi: 'boundary', classe: 'AddBoundaryControl',
        tipoDeFeicao: 'boundary', fontes: ['boundarys'], alcaDeEdicao: 'boundary-edit-handles',
        // `layers/styles/tactical.layers.js` reancora o limite ao zoom corrente de forma
        // SINCRONA no setup das camadas, como o simbolo militar, so que com uma conta propria.
        zoomModelo: comTamanhosDeZoomDoLimite,
        // `layer_setup.js` redesenha circulos e rotulos de limite no boot chamando estes
        // metodos. Nenhum devolve valor, entao o stand-in pode encaminha-los depois do `await`.
        // O segundo e o que o restore usa: UMA reconstrucao para o mapa inteiro, porque a
        // chamada por feicao lia N vezes a mesma colecao vazia.
        encaminhados: ['updateDependentFeatures', 'rebuildAllDependentFeatures'],
        carregar: () => import('../military_tools/boundary_tool/add_boundary_control.js')
    },
    occupiedFrontControl: {
        tipoDeUi: 'occupiedfront', classe: 'AddOccupiedFrontControl',
        tipoDeFeicao: 'occupied_front', fontes: ['occupied_fronts'], alcaDeEdicao: 'occupied-front-edit-handles',
        carregar: () => import('../military_tools/occupied_front_tool/add_occupied_front_control.js')
    },
    coordinationLineControl: {
        tipoDeUi: 'coordinationline', classe: 'AddCoordinationLineControl',
        tipoDeFeicao: 'coordination_line', fontes: ['coordination_lines'],
        alcaDeEdicao: 'coordination-line-edit-handles',
        // Mesmo caso do limite: `layers/styles/tactical.layers.js` reancora a linha ao zoom
        // corrente de forma SINCRONA no setup das camadas, e a conta nao cabe na tripla
        // `size`/`calculatedSize` (sao tres derivados, dois deles em km). O stand-in devolve
        // so os NUMEROS; a geometria, que le Turf, chega na primeira passada de zoom depois
        // que o modulo sobe. Nao ha metodo encaminhado, porque esta ferramenta desenha numa
        // fonte so e nao tem feicao dependente para reconstruir no boot.
        zoomModelo: comTamanhosDeZoomDaLinhaDeCoordenacao,
        carregar: () => import('../military_tools/coordination_line_tool/add_coordination_line_control.js')
    },

    // ---------- Analise: TARDIAS ----------
    losControl: {
        tipoDeUi: 'los', classe: 'AddLOSControl',
        tipoDeFeicao: 'los', fontes: ['los'], alcaDeEdicao: null,
        // `restoreMeasurements` do `layer_setup.js` remede as visadas no boot. Void, encaminhavel.
        encaminhados: ['updateFeatureMeasurement'],
        carregar: () => import('../analysis_tools/los_tool/add_los_control.js')
    },
    visibilityControl: {
        tipoDeUi: 'visibility', classe: 'AddVisibilityControl',
        tipoDeFeicao: 'visibility', fontes: ['visibility'], alcaDeEdicao: 'visibility-edit-handles',
        carregar: () => import('../analysis_tools/visibility_tool/add_visibility_control.js')
    },

    // ---------- Medicao: TARDIAS (efemeras, sem feicao persistida) ----------
    measureDistanceControl: {
        tipoDeUi: 'measurementdistance', classe: 'MeasurementDistanceControl',
        tipoDeFeicao: null, fontes: [], alcaDeEdicao: null,
        carregar: () => import('../measurement_tool/measurement-distance.control.js')
    },
    measureAreaControl: {
        tipoDeUi: 'measurementarea', classe: 'MeasurementAreaControl',
        tipoDeFeicao: null, fontes: [], alcaDeEdicao: null,
        carregar: () => import('../measurement_tool/measurement-area.control.js')
    },
    measureAngleControl: {
        tipoDeUi: 'measurementangle', classe: 'MeasurementAngleControl',
        tipoDeFeicao: null, fontes: [], alcaDeEdicao: null,
        carregar: () => import('../measurement_tool/measurement-angle.control.js')
    },

    // ---------- Utilitarios: ANSIOSOS ----------
    // Os dois estao cravados no SelectionManager por setter proprio no boot
    // (`setvectorTileInfoControl`, `setRectangleSelectionControl`), e `_handleMapClick` le
    // `.isActive` deles de forma sincrona antes de qualquer selecao. Custam 4 modulos, 16 kB.
    vectorTileInfoControl: {
        tipoDeUi: 'vectortileinfo', classe: 'VectorTileInfoControl',
        tipoDeFeicao: null, fontes: [], alcaDeEdicao: null, ansiosa: true,
        carregar: () => import('../vector_info/vector-info.control.js')
    },
    rectangleSelectionControl: {
        tipoDeUi: 'rectangleselection', classe: 'RectangleSelectionControl',
        tipoDeFeicao: null, fontes: [], alcaDeEdicao: null, ansiosa: true,
        carregar: () => import('../selection_tools/rectangle_selection_control.js')
    }
});

// ============================================================================================
// ESTADO
// ============================================================================================

/** @type {{toolManager: Object, selectionManager: Object, map: Object}|null} */
let dependencias = null;

/** @type {Map<string, Object>} Instancias ja construidas, por `controlKey`. */
const instancias = new Map();

/** @type {Map<string, Promise<Object>>} Cargas EM VOO, compartilhadas entre chamadores. */
const emVoo = new Map();

// ============================================================================================
// LEITURA SINCRONA
// ============================================================================================

/**
 * O tipo que `activeTool.type` vale para esta ferramenta, SEM carregar nada.
 *
 * E o que o pintor de botao ativo consome, e ele roda numa assinatura do StateManager: nao
 * pode esperar por rede, e nao pode depender de a ferramenta ja existir.
 *
 * @param {string} controlKey
 * @returns {string|null}
 */
export function controlType(controlKey) {
    return FERRAMENTAS[controlKey]?.tipoDeUi ?? null;
}

/**
 * A instancia, se ela JA existir. Sincrono e sem efeito nenhum.
 * @param {string} controlKey
 * @returns {Object|null}
 */
export function peekControl(controlKey) {
    return instancias.get(controlKey) ?? null;
}

/**
 * O `controlKey` que possui um `properties.source`, ou null.
 * @param {string} tipoDeFeicao
 * @returns {string|null}
 */
export function controlKeyForFeatureType(tipoDeFeicao) {
    for (const [chave, f] of Object.entries(FERRAMENTAS)) {
        if (f.tipoDeFeicao === tipoDeFeicao) return chave;
    }
    return null;
}

// ============================================================================================
// CARGA
// ============================================================================================

/**
 * Garante a ferramenta: carrega o modulo, instancia UMA vez, registra e chama `onAdd`.
 *
 * MEMOIZADA COMO `ensureMilsymbol`, e pelo mesmo motivo medido la: dois cliques rapidos (ou o
 * autorepeat de uma tecla) chegam antes de a primeira carga terminar, e sem o memo cada um
 * construiria seu proprio controle. A promessa EM VOO e compartilhada, e uma falha limpa o
 * memo para a tentativa seguinte nao herdar uma promessa rejeitada para sempre.
 *
 * ELA TAMBEM GARANTE O TURF, e este e o funil da onda de 2026-08-25 que tirou os 619 kB de
 * `turf.min.js` do `index.html`. O `await` fica ANTES do memo de instancia, e nao dentro da
 * cadeia de carga, e a diferenca e o que faz a linha valer: as SEIS ferramentas ansiosas
 * (ponto, linha, poligono, texto, imagem, pincel) ja estao instanciadas quando o primeiro
 * clique chega, entao um `ensureTurf()` dentro do `.then()` do `import()` nunca rodaria para
 * elas — e sao justamente elas que desenham a maior parte das feicoes. Aqui, TODO gesto que
 * ativa uma ferramenta (barra, grupo da barra, atalho de teclado, selecao de feicao) passa
 * pelo mesmo ponto, tardia ou ansiosa.
 *
 * @param {string} controlKey
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.comTurf=true] - Esperar o Turf antes de devolver o controle.
 *   Desligar SO no caminho que prova nao ler Turf nenhum: ver o `applyZoomCorrections` do
 *   stand-in, que dispara no BOOT e cuja conta e aritmetica pura sobre `size`.
 * @returns {Promise<Object>} a instancia do controle
 */
export function ensureControl(controlKey, { comTurf = true } = {}) {
    if (comTurf) {
        // O Turf primeiro, a ferramenta depois. As duas cargas poderiam correr em paralelo,
        // e correm de fato: `ensureTurf()` e `ferramenta.carregar()` sao duas tags/chunks
        // independentes, e o `.then` abaixo so serializa a ENTREGA, nunca o download.
        return ensureTurf()
            .catch((erro) => {
                // Turf indisponivel nao pode impedir a ferramenta de existir: quase toda
                // ferramenta tem caminhos que nao leem Turf, e um controle ausente degrada
                // pior (botao morto) do que uma medida ausente. O aviso e alto de proposito.
                console.warn(`Turf nao carregou antes de ${controlKey}:`, erro);
            })
            .then(() => ensureControl(controlKey, { comTurf: false }));
    }

    const pronta = instancias.get(controlKey);
    if (pronta) return Promise.resolve(pronta);

    const voando = emVoo.get(controlKey);
    if (voando) return voando;

    const ferramenta = FERRAMENTAS[controlKey];
    if (!ferramenta) {
        return Promise.reject(new Error(`Ferramenta desconhecida no registro: ${controlKey}`));
    }
    if (!dependencias) {
        return Promise.reject(new Error('tool-registry usado antes de initToolRegistry()'));
    }

    const carga = ferramenta.carregar()
        .then((modulo) => {
            const Classe = modulo.default ?? modulo[ferramenta.classe];
            if (typeof Classe !== 'function') {
                throw new Error(`${controlKey}: o modulo nao exporta ${ferramenta.classe}`);
            }
            // Uma segunda carga concorrente pode ter vencido a corrida enquanto o `import()`
            // resolvia. Devolver a instancia que ja esta registrada, nunca uma segunda.
            const jaExiste = instancias.get(controlKey);
            if (jaExiste) return jaExiste;

            const controle = new Classe(dependencias.toolManager);
            instancias.set(controlKey, controle);
            registrarInstancia(controlKey, ferramenta, controle);
            return controle;
        })
        .catch((erro) => {
            emVoo.delete(controlKey);
            throw erro;
        });

    emVoo.set(controlKey, carga);
    return carga;
}

/**
 * Fecha o registro de uma instancia recem-nascida: selecao, registro global e `onAdd`.
 * @param {string} controlKey
 * @param {EntradaDeFerramenta} ferramenta
 * @param {Object} controle
 * @private
 */
function registrarInstancia(controlKey, ferramenta, controle) {
    if (ferramenta.tipoDeFeicao) {
        dependencias.selectionManager?.registerControl(ferramenta.tipoDeFeicao, controle);
    }
    // Substitui o stand-in no registro global: a partir daqui `getControl('AddXControl')`
    // devolve o controle de verdade.
    registerControl(ferramenta.classe, controle);
    // `onAdd` e o que da o mapa ao controle E o que reinstala as assinaturas dele (listener de
    // zoom, regeneracao remota de imagem). Sem ele o controle existe e nao funciona.
    if (typeof controle.onAdd === 'function') controle.onAdd(dependencias.map);
}

/**
 * Adota uma instancia que `map_sig.js` ja construiu (as ferramentas ANSIOSAS).
 *
 * Sem isto, `_handleToolClick` teria dois caminhos: um para as tardias e outro para as
 * ansiosas. Um caminho so, e a diferenca fica escondida na tabela, que e onde ela pertence.
 *
 * @param {string} controlKey
 * @param {Object} instancia
 */
export function seedControl(controlKey, instancia) {
    if (!FERRAMENTAS[controlKey]) {
        throw new Error(`Ferramenta desconhecida no registro: ${controlKey}`);
    }
    instancias.set(controlKey, instancia);
}

// ============================================================================================
// O REGISTRO ANSIOSO: o que acontece SEM CLIQUE
// ============================================================================================

/**
 * O stand-in de uma ferramenta tardia, registrado no boot sob o nome da classe.
 *
 * NAO E UM PROXY, de proposito. Um Proxy responderia a `then` e viraria "thenable", quebraria
 * `typeof x.metodo === 'function'` em quem checa antes de chamar, e transformaria todo erro de
 * digitacao num encaminhamento silencioso. O stand-in expoe uma lista FECHADA: o que as
 * camadas leem no boot, mais o que a tabela declarar em `encaminhados`.
 *
 * @param {string} controlKey
 * @returns {Object}
 * @private
 */
function criarStandIn(controlKey) {
    const ferramenta = FERRAMENTAS[controlKey];

    const standIn = {
        /** Marca de diagnostico: quem inspecionar o registro ve que a ferramenta nao veio ainda. */
        ehStandInDeFerramenta: true,
        getSourceNames: () => [...ferramenta.fontes],
        getEditHandleSource: () => ferramenta.alcaDeEdicao ?? null
    };

    if (ferramenta.zoom) {
        // O setup das camadas chama isto de forma SINCRONA e USA o valor de volta, entao nao ha
        // await possivel aqui. A conta e a mesma funcao pura que o controle de verdade usa
        // (`helpers/zoom-correction.helpers.js`), so que sem arrastar a ferramenta junto.
        //
        // E ele tambem e o gatilho: se o mapa TEM feicoes deste tipo, a ferramenta e pedida
        // agora, em segundo plano. Nao e zelo, e o listener de zoom: quem redimensiona o
        // simbolo a cada passo de zoom e o `onAdd` do controle, e sem esta linha um simbolo
        // ja desenhado ficaria congelado no tamanho do ultimo salvamento.
        standIn.applyZoomCorrections = (features) => {
            const lista = Array.isArray(features) ? features : [];
            if (lista.length > 0) {
                // `comTurf: false` E O UNICO OPT-OUT DA CASA, e ele existe porque esta linha
                // roda NO BOOT, sem clique nenhum, sempre que o mapa ja tem simbolo militar,
                // medida de coordenacao ou declinacao. Com o Turf ligado aqui, um mapa com um
                // simbolo salvo baixaria 619 kB no boot em segundo plano — exatamente o modo
                // de falha que `utilities/turf-loader.js` foi desenhado para nao ter. E o
                // opt-out e seguro por medida, nao por otimismo: os tres controles de simbolo
                // nao tem UM sitio de `turf.` (varredura de 2026-08-25), e a unica leitura de
                // Turf que eles herdam e o `createSelectionBox` da base, que so roda por
                // SELECAO — e a selecao tem funil proprio em `selection_manager.js`.
                ensureControl(controlKey, { comTurf: false }).catch((erro) => {
                    console.warn(`Falha ao carregar ${controlKey} para corrigir zoom:`, erro);
                });
            }
            return aplicarCorrecaoDeZoom(lista, dependencias.map.getZoom(), ferramenta.zoom);
        };
    }

    if (ferramenta.zoomModelo) {
        // Irmao do ramo acima: mesma chamada SINCRONA vinda do setup das camadas, mesma
        // resposta imediata, so que pela conta propria da ferramenta.
        //
        // DUAS diferencas, e as duas sao decisao:
        //
        // 1. SEM `comTurf: false`. O opt-out de cima vale porque a conta do simbolo e
        //    aritmetica pura sobre `size` e o controle de verdade nao tem sitio de `turf.`.
        //    Aqui o controle de verdade refaz TAMBEM a geometria (escalao em km, vao da
        //    linha), e cada passo disso le Turf. Pedir a ferramenta sem Turf entregaria um
        //    controle que falha na primeira passada de zoom.
        // 2. O stand-in devolve so os NUMEROS. Ele nao tem `geometry`, entao a geometria
        //    fica com a que estava salva ate o modulo subir; a primeira passada de zoom
        //    depois disso a refaz. Regenerar aqui exigiria carregar a ferramenta de forma
        //    sincrona no boot, que e exatamente o que esta tabela existe para nao fazer.
        standIn.applyZoomCorrections = (features) => {
            const lista = Array.isArray(features) ? features : [];
            if (lista.length > 0) {
                ensureControl(controlKey).catch((erro) => {
                    console.warn(`Falha ao carregar ${controlKey} para corrigir zoom:`, erro);
                });
            }
            const zoom = dependencias.map.getZoom();
            return lista.map((feature) => ({
                ...feature,
                properties: ferramenta.zoomModelo(feature.properties, zoom)
            }));
        };
    }

    for (const metodo of ferramenta.encaminhados ?? []) {
        standIn[metodo] = (...args) => ensureControl(controlKey)
            .then((controle) => controle[metodo]?.(...args))
            .catch((erro) => {
                console.warn(`Falha ao carregar ${controlKey} para ${metodo}:`, erro);
            });
    }

    return standIn;
}

/**
 * Inicializa o registro e instala TUDO que precisa existir antes do primeiro clique.
 *
 * @param {Object} deps
 * @param {Object} deps.toolManager
 * @param {Object} deps.selectionManager
 * @param {Object} deps.map
 */
export function initToolRegistry(deps) {
    dependencias = deps;

    for (const [controlKey, ferramenta] of Object.entries(FERRAMENTAS)) {
        if (ferramenta.ansiosa) continue;

        // (1) O nome da classe passa a responder no registro global. `layers/styles/*.js` e
        //     `layer_setup.js` procuram o controle por ai no boot, e um `undefined` deles nao
        //     da erro: ele degrada em silencio (simbolo no tamanho errado, circulo de limite
        //     que some). Silencio e o que este registro impede.
        registerControl(ferramenta.classe, criarStandIn(controlKey));

        // (2) O SelectionManager recebe o DESCRITOR, nao a instancia. Clicar numa feicao ja
        //     desenhada num mapa recem carregado procura o controle por tipo, sem gesto de
        //     ferramenta nenhum: e o caminho mais delicado desta onda. O descritor responde
        //     sincrono o que a varredura de clique precisa (fontes, alca de edicao) e so
        //     resolve o modulo quando a selecao de fato acontece.
        if (ferramenta.tipoDeFeicao) {
            deps.selectionManager.registerControlFactory(ferramenta.tipoDeFeicao, {
                getSourceNames: () => [...ferramenta.fontes],
                getEditHandleSource: () => ferramenta.alcaDeEdicao ?? null,
                ensure: () => ensureControl(controlKey)
            });
        }

        // (3) A regeneracao de imagem, que e o unico ponto que NAO pode virar preguicoso.
        //     `layer_setup.js` regenera o PNG local de simbolo militar, medida de coordenacao e
        //     declinacao quando um snapshot remoto chega, SEM clique nenhum: sem isto, simbolo
        //     de atlas remoto vira icone de erro. O REGISTRO e ansioso (uma closure), o MODULO
        //     nao. Quando o controle de verdade sobe, o `onAdd` dele reinscreve a funcao real
        //     por cima desta.
        if (ferramenta.regenImagem) {
            registerImageRegenerator(ferramenta.regenImagem, async (feature) => {
                // `comTurf: false` pelo mesmo motivo do `applyZoomCorrections` acima: isto
                // dispara SEM CLIQUE quando um snapshot de atlas remoto chega, e regenerar um
                // PNG de simbolo e trabalho do milsymbol, nao do Turf. As tres ferramentas que
                // registram regeneracao (simbolo militar, medida de coordenacao, declinacao)
                // nao tem sitio de `turf.` nenhum.
                const controle = await ensureControl(controlKey, { comTurf: false });
                return controle.regenerateImageFromProps(feature);
            });
        }
    }
}

/**
 * Costura de teste: esquece tudo o que o registro aprendeu.
 * @returns {void}
 */
export function resetToolRegistry() {
    dependencias = null;
    instancias.clear();
    emVoo.clear();
}
