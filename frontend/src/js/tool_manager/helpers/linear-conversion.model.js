// Path: js/tool_manager/helpers/linear-conversion.model.js

/**
 * @fileoverview CONVERTER UMA FEIÇÃO LINEAR EM OUTRA, como decisão pura: quem pode, o que
 * sobrevive à travessia e o que se perde nela. Seis sentidos entre os três tipos que
 * compartilham um eixo (linha, seta e limite), sem DOM, sem store e sem mapa.
 *
 * Irmão de `sidebar/tabs/map-menu-actions.js` e de `context-menu/clipboard-menu-actions.js`,
 * e pelo mesmo motivo: `feature-header.helpers.js` importa o barril da store, o despachante
 * de GeoJSON e o MapLibre, e portanto não carrega no ambiente node puro desta suíte. A
 * decisão mora aqui e o desenho fica lá.
 *
 * ================= O DEFEITO QUE ELE FECHA ===================================
 *
 * Havia DUAS conversões, as duas saindo de linha (`convertLineToArrow` e
 * `convertLineToBoundary`), as duas escritas à mão dentro do arquivo do menu, e cada uma
 * carregava a mesma família de defeitos medidos:
 *
 *   1. NENHUM GATE. Elas chamavam `addFeature`, cujo `guardWrite` devolve `undefined` em
 *      silêncio para um Leitor e para um mapa travado, e SEGUIAM: o despachante ganhava a
 *      seta, a linha era removida da tela, e no F5 voltava a linha e sumia a seta. O
 *      fantasma era duplo, porque as duas metades falhavam separadamente.
 *   2. `||` COMENDO ZERO. `lineFeature.properties.opacity || defaultProps.fillOpacity`
 *      trocava uma opacidade de 0 (feição deliberadamente invisível) pela do padrão, e
 *      `layerId || 'default'` mandava para a camada implícita quem tivesse `layerId` 0 ou
 *      `''`. As conversões de PONTO, no mesmo arquivo, já usavam `??`.
 *   3. CÓPIA RASA. `[...baseCoordinates]` copia o array externo e compartilha cada par
 *      `[lng, lat]` com a feição de origem, e `symbol_instances` do padrão do limite ia por
 *      REFERÊNCIA: dois limites convertidos dividiam o mesmo array de instâncias.
 *   4. ARTEFATO ÓRFÃO. Sair de linha por `removeFeature` cru desvia do `deleteFeatures` do
 *      controle e deixa a etiqueta de medição na tela para sempre; sair de limite deixava os
 *      círculos e os rótulos, que são chaveados por `parent`.
 *
 * ================= A REGRA DE AFORDÂNCIA, QUE NÃO É UNIFORME ==================
 *
 * DOIS TIPOS DE BLOQUEIO, DOIS TRATAMENTOS (decisão do dono, 2026-08-24,
 * `.claude/rules/architecture.md` §UI Architecture):
 *
 *   - POSTO some. Converter é um CREATE mais um DELETE; quem não tem as duas capacidades
 *     não vira Editor a partir deste menu, e uma linha morta dizendo "exige Editor"
 *     transforma o menu num catálogo do que a pessoa não é.
 *   - ESTADO desenha e recusa o CLIQUE, nomeando o estado. Mapa travado, feição bloqueada,
 *     seta combinada e eixo curto demais são todos reversíveis, e um deles tem o desfaz no
 *     MESMO menu ("Separar Setas" está a duas linhas de distância). O clique é o único
 *     lugar por onde o motivo chega.
 *
 * FALHA FECHADA: `can` é consultado para as DUAS capacidades, e um predicado que lance ou
 * devolva qualquer coisa que não seja `true` esconde os comandos. Perder um clique custa
 * menos que oferecer trabalho que a store recusa.
 *
 * ================= POR QUE AS DUAS CAPACIDADES ===============================
 *
 * `CREATE_FEATURE` e `DELETE_FEATURE` resolvem para flags DIFERENTES
 * (`PermissionAction.EDIT` e `PermissionAction.DELETE`, `store/sync/permission-guard.js`),
 * e a separação é deliberada na tabela de papéis. Uma conversão precisa das duas, porque é
 * literalmente as duas operações: gatear só pela primeira ofereceria, a quem edita e não
 * apaga, uma travessia que morreria na metade, deixando as DUAS feições vivas.
 */

import { deepClone } from '@utils/deep-utils.js';
import { computeBoundaryZoomSizes } from './boundary-zoom.model.js';

/**
 * Os três tipos que compartilham um eixo de coordenadas e por isso se convertem entre si,
 * na ordem em que o menu os desenha.
 *
 * O polígono NÃO entra: ele fecha, e reabrir um anel produz um eixo cujo primeiro e último
 * vértice coincidem, o que a geometria da seta lê como comprimento zero no último segmento.
 * @type {readonly string[]}
 */
export const LINEAR_SOURCES = Object.freeze(['line', 'arrow', 'boundary']);

/** O rótulo do comando que produz cada tipo. @type {Object<string, string>} */
export const LINEAR_CONVERSION_LABELS = Object.freeze({
    line: 'Converter para Linha',
    arrow: 'Converter para Seta',
    boundary: 'Converter para Linha de Limite',
});

/**
 * As chaves de `GuardAction` que uma conversão consome, as DUAS. Exportada para que o
 * chamador não escolha uma delas por engano, e para que um teste possa afirmar que são duas.
 * @type {readonly string[]}
 */
export const LINEAR_CONVERSION_CAPABILITIES = Object.freeze(['CREATE_FEATURE', 'DELETE_FEATURE']);

/**
 * A frase do mapa travado.
 *
 * ELA É CÓPIA, e a cópia é obrigatória, não descuido: o original mora em
 * `sidebar/tabs/map-menu-actions.js`, que o `vite.config.js` roteia para o chunk
 * `ui-components`, enquanto `tool_manager/` é `core`. Importar de lá criaria uma aresta
 * estática core -> ui-components, e ui-components já depende de core: é exatamente o ciclo
 * de chunk que produz "Cannot access 'X' before initialization" em runtime. As duas cópias
 * são presas por `tests/unit/conversao-linear.test.js`, que importa AS DUAS e compara, para
 * que o produto nunca diga uma frase numa tela e outra noutra sobre o mesmo cadeado.
 * @type {string}
 */
export const LOCKED_MAP_NOTICE = 'Este mapa está bloqueado. Destrave-o para fazer esta alteração.';

/** A frase da feição bloqueada (cadeado da própria feição, não do mapa). @type {string} */
export const LOCKED_FEATURE_NOTICE = 'Esta feição está bloqueada. Desbloqueie-a para convertê-la.';

/** A frase da seta combinada: reversível, e o desfaz está no MESMO menu. @type {string} */
export const MERGED_ARROW_NOTICE = 'Separe as setas combinadas antes de converter.';

/** A frase do eixo que não dá uma linha. @type {string} */
export const SHORT_SPINE_NOTICE = 'Esta feição não tem um eixo com dois vértices para converter.';

/**
 * As chaves que MORREM ao sair de cada tipo, porque só significam alguma coisa nele.
 *
 * ESTA TABELA É DECLARAÇÃO, e a força dela é de teste: `buildConvertedProperties` monta o
 * bloco a partir dos padrões do DESTINO mais uma lista explícita de preservados, então
 * nenhuma destas chaves atravessa por construção. O que a tabela impede é a próxima
 * reescrita "esperta" que resolva copiar as propriedades da origem e filtrar — a forma que
 * deixa `isMerged` e os ramos numa feição que não é mais seta, e a geometria da seta então
 * tenta gerar a união de ramos que não existem mais.
 *
 * `doubleHeaded` está na lista da seta desde que a segunda cabeça nasceu: ela é a chave que
 * uma lista escrita à mão perde, porque foi a última a entrar.
 * @type {Object<string, readonly string[]>}
 */
export const DROPPED_BY_SOURCE = Object.freeze({
    line: Object.freeze(['lineStyle', 'measure', 'profile', 'profileData', 'observations']),
    arrow: Object.freeze([
        'width', 'headLengthRatio', 'showArrowHead', 'doubleHeaded',
        'airmobile', 'airmobilePosition', 'isMerged', 'branches', 'geometryType',
    ]),
    boundary: Object.freeze([
        'echelon', 'symbol_instances', 'symbol_size', 'text_size', 'text_top', 'text_bottom',
        'text_distance_ratio', 'text_north_facing', 'createdAtZoom', 'zoomCorrectionEnabled',
        'calculatedLineWidth', 'calculatedTextSize', 'calculatedStrokeWidth', 'calculatedSymbolSize',
    ]),
});

/**
 * O que ATRAVESSA toda conversão: identidade, texto do usuário e a janela temporal.
 *
 * `attributes` está aqui e NÃO estava nas conversões antigas (nem está nas de ponto, que
 * ficam fora desta mudança): são os atributos que a pessoa digitou na tabela de atributos, e
 * perdê-los numa troca de tipo é perda de dado do usuário sem aviso nenhum.
 * @type {readonly string[]}
 */
export const PRESERVED_KEYS = Object.freeze([
    'layerId', 'nome', 'descricao', 'visivel', 'bloqueado',
    'attributes', 'temporalInicio', 'temporalFim',
]);

/**
 * A faixa que o painel de atributos de cada tipo oferece para `lineWidth`, em pixels.
 *
 * ELA EXISTE PORQUE AS TRÊS DIVERGEM: a linha vai a 15, a seta e o limite param em 10
 * (`line_attributes_panel.js`, `arrow_attributes_panel.js`, `boundary_attributes_panel.js`).
 * Escrever 14 numa seta produz um controle que mostra um valor que ele mesmo não reproduz:
 * o primeiro toque no cursor salta para 10 e a pessoa não pediu isso. Grampear na travessia
 * é a única hora em que o salto é explicável.
 * @type {Object<string, {min: number, max: number}>}
 */
export const LINE_WIDTH_RANGE = Object.freeze({
    line: Object.freeze({ min: 1, max: 15 }),
    arrow: Object.freeze({ min: 1, max: 10 }),
    boundary: Object.freeze({ min: 1, max: 10 }),
});

/**
 * O que a travessia descarta, dito em português, por tipo de ORIGEM.
 * @type {Object<string, string>}
 */
const LOSS_PHRASE = Object.freeze({
    line: 'a medição, o perfil do terreno e o estilo do traço',
    arrow: 'a largura, a cabeça, a ponta dupla e o traçado aeromóvel',
    boundary: 'o escalão, os rótulos e o tamanho do símbolo',
});

/**
 * Uma posição utilizável.
 * @param {*} p - Candidato a par de coordenadas
 * @returns {boolean} True quando é um par finito
 */
function isFinitePosition(p) {
    return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * O EIXO da feição, como array novo de pares novos, ou `null`.
 *
 * `properties.baseCoordinates` é a fonte canônica dos três tipos, e ela pode chegar como
 * STRING: `properties` viaja como JSONB e caminhos antigos serializavam o array. Os
 * normalizadores das três geometrias já toleram isso, e este toleraria por omissão se não
 * fosse explícito.
 *
 * A GEOMETRIA SÓ SERVE DE RESERVA PARA `LineString`, e essa restrição é o ponto: a seta é um
 * `Polygon` (o contorno, não o eixo) e o limite é um `MultiLineString` (os segmentos com os
 * vãos do escalão já recortados). Ler qualquer um dos dois como eixo produziria uma feição
 * convertida com a forma DESENHADA no lugar da forma AUTORAL, e o erro seria discreto na
 * linha e grotesco no limite.
 *
 * A cópia é PROFUNDA porque a rasa compartilha cada par com a origem, e a origem está
 * prestes a ser apagada: mover um vértice da nova feição mexia na antiga enquanto ela ainda
 * existisse.
 *
 * @param {Object} [feature] - Feição GeoJSON
 * @returns {Array<Array<number>>|null} Eixo com dois ou mais vértices finitos, ou null
 */
export function resolveSpineCoordinates(feature) {
    let coords = feature?.properties?.baseCoordinates;

    if (typeof coords === 'string') {
        try {
            coords = JSON.parse(coords);
        } catch {
            coords = null;
        }
    }

    if (!Array.isArray(coords) || coords.length < 2 || !coords.every(isFinitePosition)) {
        const geometry = feature?.geometry;
        if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return null;
        coords = geometry.coordinates;
        if (coords.length < 2 || !coords.every(isFinitePosition)) return null;
    }

    return coords.map((p) => [...p]);
}

/**
 * Uma seta COMBINADA, isto é, uma seta cuja geometria é a união de vários ramos.
 *
 * TERCEIRO SÍTIO DESTE PREDICADO, e é para deixar de ser três: `canSplitArrows`
 * (`feature-header.helpers.js`) passou a derivar daqui, e a geometria da seta tem a própria
 * cópia dentro de `generate`. As três condições andam juntas porque `isMerged` sozinho já
 * apareceu verdadeiro sem os ramos (uma separação interrompida), e nesse estado a feição é
 * uma seta comum com um sinalizador mentiroso.
 *
 * @param {Object} [properties] - Propriedades da feição
 * @returns {boolean} True quando a seta carrega dois ou mais ramos
 */
export function isMergedArrow(properties) {
    return properties?.isMerged === true
        && Array.isArray(properties?.branches)
        && properties.branches.length > 1;
}

/**
 * A travessia é estruturalmente possível? Só a FORMA; posto e estado ficam fora.
 *
 * @param {Object} [feature] - Feição de origem
 * @param {string} [target] - Tipo de destino
 * @returns {boolean} True quando há eixo, os dois tipos são lineares e são diferentes
 */
export function canConvertLinear(feature, target) {
    const source = feature?.properties?.source;
    if (!LINEAR_SOURCES.includes(source)) return false;
    if (!LINEAR_SOURCES.includes(target)) return false;
    if (source === target) return false;
    if (isMergedArrow(feature?.properties)) return false;
    return resolveSpineCoordinates(feature) !== null;
}

/**
 * O trio canônico de estilo que os três tipos sabem falar, lido da feição de origem.
 *
 * A seta é lida pelo PREENCHIMENTO e não pelo contorno, porque o corpo é o que a pessoa vê.
 * O ida-e-volta continua fiel mesmo assim: ao virar seta, a cor e a opacidade únicas da
 * origem são duplicadas nas duas metades, então voltar por qualquer uma devolve o mesmo
 * valor.
 *
 * @param {Object} [properties] - Propriedades da origem
 * @param {string} source - Tipo de origem
 * @returns {{color: *, lineWidth: *, opacity: *}} Valores crus (podem ser undefined)
 */
function readLinearStyle(properties, source) {
    const p = properties || {};
    if (source === 'arrow') return { color: p.fillColor, lineWidth: p.lineWidth, opacity: p.fillOpacity };
    if (source === 'boundary') return { color: p.color, lineWidth: p.lineWidth, opacity: p.opacity };
    return { color: p.lineColor, lineWidth: p.lineWidth, opacity: p.opacity };
}

/**
 * `lineWidth` dentro da faixa do painel do destino, ou o padrão do destino.
 * @param {*} value - Valor autoral
 * @param {string} target - Tipo de destino
 * @param {*} fallback - `lineWidth` dos padrões do destino
 * @returns {number} Um número dentro da faixa
 */
function clampLineWidth(value, target, fallback) {
    const range = LINE_WIDTH_RANGE[target];
    // `Number.isFinite`, nunca `??`: `NaN` é um valor PRESENTE, e `NaN ?? x` devolve `NaN`,
    // que o MapLibre aceita como largura e desenha como nada.
    const base = Number.isFinite(value) ? value : fallback;
    if (!Number.isFinite(base)) return range.min;
    return Math.min(range.max, Math.max(range.min, base));
}

/**
 * Opacidade dentro de `[0, 1]`, ou o padrão do destino.
 * @param {*} value - Valor autoral
 * @param {*} fallback - Opacidade dos padrões do destino
 * @returns {number} Um número entre 0 e 1
 */
function clampOpacity(value, fallback) {
    const base = Number.isFinite(value) ? value : fallback;
    if (!Number.isFinite(base)) return 1;
    return Math.min(1, Math.max(0, base));
}

/**
 * O BLOCO DE PROPRIEDADES da feição convertida, pronto para virar `feature.properties`.
 *
 * Ele nasce dos padrões do DESTINO (clonados em profundidade, porque as instâncias de
 * símbolo do limite são um array compartilhado por referência no objeto estático da classe)
 * e recebe, por cima, o que atravessa: identidade, o trio de estilo e o eixo.
 *
 * @param {Object} config - Entradas da montagem
 * @param {Object} config.feature - Feição de origem
 * @param {string} config.target - Tipo de destino
 * @param {Object} config.defaults - `DEFAULT_PROPERTIES` do controle de destino
 * @param {string} config.id - Id novo da feição
 * @param {string} [config.nome] - Nome gerado, usado só se a origem não tiver um
 * @param {number} [config.currentZoom] - Zoom do mapa no instante da conversão
 * @param {number} [config.adaptiveWidth] - Largura da seta para este zoom, em metros
 * @param {number} [config.adaptiveSymbolSize] - Tamanho do símbolo do limite, em km
 * @returns {Object|null} Propriedades novas, ou null quando a origem não tem eixo
 */
export function buildConvertedProperties({
    feature,
    target,
    defaults,
    id,
    nome,
    currentZoom,
    adaptiveWidth,
    adaptiveSymbolSize,
} = {}) {
    const spine = resolveSpineCoordinates(feature);
    if (!spine) return null;

    const src = feature?.properties || {};
    const source = src.source;
    const props = deepClone(defaults || {});

    props.source = target;
    props.id = id;
    props.baseCoordinates = spine;

    // Preservados. `??` em toda parte, NUNCA `||`: um `layerId` de 0 ou `''` é valor de
    // domínio (foi o `||` que mandou feições dessas camadas para a camada implícita), e uma
    // `descricao` vazia é uma escolha tão explícita quanto uma preenchida.
    props.layerId = src.layerId ?? props.layerId;
    props.nome = (typeof src.nome === 'string' && src.nome !== '') ? src.nome : (nome ?? props.nome);
    props.descricao = src.descricao ?? '';
    props.visivel = src.visivel !== false;
    props.bloqueado = src.bloqueado === true;
    if (src.attributes !== undefined) props.attributes = deepClone(src.attributes);
    if (src.temporalInicio !== undefined) props.temporalInicio = src.temporalInicio;
    if (src.temporalFim !== undefined) props.temporalFim = src.temporalFim;

    const style = readLinearStyle(src, source);
    const width = clampLineWidth(style.lineWidth, target, defaults?.lineWidth);
    const opacity = clampOpacity(style.opacity, target === 'arrow' ? defaults?.fillOpacity : defaults?.opacity);

    if (target === 'line') {
        props.lineColor = style.color ?? props.lineColor;
        props.lineWidth = width;
        props.opacity = opacity;
    } else if (target === 'arrow') {
        // A cor e a opacidade únicas da origem viram DUAS de cada: o corpo e o contorno da
        // seta são propriedades separadas, e deixar o contorno no padrão produzia uma seta
        // colorida com borda de outra cor sem que ninguém tivesse pedido.
        props.fillColor = style.color ?? props.fillColor;
        props.lineColor = style.color ?? props.lineColor;
        props.fillOpacity = opacity;
        props.lineOpacity = opacity;
        props.lineWidth = width;
        if (Number.isFinite(adaptiveWidth)) props.width = adaptiveWidth;
    } else {
        props.color = style.color ?? props.color;
        props.lineWidth = width;
        props.opacity = opacity;
        if (Number.isFinite(adaptiveSymbolSize)) props.symbol_size = adaptiveSymbolSize;

        // A ÂNCORA DE ZOOM DO LIMITE, gravada aqui e não herdada dos padrões. Os padrões
        // carregam o sentinela de "nunca ancorado", e um limite que nasce assim desenha como
        // as feições legadas: sem correção nenhuma. O par de interruptores é escrito por
        // extenso porque `setDefaultProperties` deixa o usuário mover os dois, e uma
        // conversão não pode herdar o estado de um limite anterior.
        props.createdAtZoom = Number.isFinite(currentZoom)
            ? Math.round(currentZoom * 10) / 10
            : props.createdAtZoom;
        props.zoomCorrectionEnabled = true;
        props.text_north_facing = false;

        // DEPOIS de o objeto estar inteiro, nunca antes: os derivados são função de
        // `lineWidth`, do tamanho do texto, do tamanho do símbolo e da âncora acima, e
        // calculá-los antes deixaria os quatro valores do PADRÃO por cima dos reais.
        Object.assign(props, computeBoundaryZoomSizes(props, currentZoom));
    }

    return props;
}

/**
 * O que esta travessia descarta, como frase, ou `null` quando não descarta nada.
 *
 * A SAÍDA DO GRUPO É PERDA DECLARADA, não buraco esquecido: `removeFeature` chama
 * `removeFeatureFromAllGroups`, e não existe operação de store que ACRESCENTE uma feição a
 * um grupo existente (`group.operations.js` tem `createGroup` e `combineGroups` e mais
 * nada), então a feição nova não pode ser recolocada no grupo da antiga. Dizer isso na hora
 * custa uma frase; descobrir depois custa a organização do mapa.
 *
 * @param {Object} config - Contexto da travessia
 * @param {string} config.source - Tipo de origem
 * @param {string} [config.target] - Tipo de destino
 * @param {boolean} [config.inGroup] - A feição de origem pertence a um grupo?
 * @returns {string|null} A frase, ou null
 */
export function describeConversionLoss({ source, target, inGroup = false } = {}) {
    const partes = [];
    const phrase = LOSS_PHRASE[source];
    if (phrase && LINEAR_SOURCES.includes(target) && source !== target) partes.push(phrase);
    if (inGroup) partes.push('a participação no grupo');
    if (partes.length === 0) return null;
    return `A conversão descarta ${partes.join(' e ')}.`;
}

/**
 * OS COMANDOS DE CONVERSÃO QUE ESTA PESSOA VÊ PARA ESTA FEIÇÃO, na ordem do menu.
 *
 * @param {Object} context - Entradas da decisão
 * @param {string} context.source - `properties.source` da feição selecionada
 * @param {function(string): boolean} context.can - Predicado de capacidade, dada uma chave de
 *   `GuardAction`. Injete `(k) => checkPermission(k).allowed`.
 * @param {boolean} [context.mapLocked] - O mapa corrente está travado?
 * @param {boolean} [context.featureLocked] - A feição está bloqueada?
 * @param {Object} [context.feature] - A feição, para as duas recusas de forma
 * @returns {Array<{target: string, blocked: string|null}>} Array novo. `blocked` é null
 *   quando o comando está vivo, ou a frase que o clique tem de mostrar.
 */
export function linearConversionActions({
    source,
    can,
    mapLocked = false,
    featureLocked = false,
    feature,
} = {}) {
    if (!LINEAR_SOURCES.includes(source)) return [];

    // POSTO: as DUAS capacidades, e o comando some se qualquer uma faltar. Falha fechada
    // também quando o predicado lança ou devolve um truthy que não é `true`.
    for (const key of LINEAR_CONVERSION_CAPABILITIES) {
        let ok = false;
        try {
            ok = can(key) === true;
        } catch {
            ok = false;
        }
        if (!ok) return [];
    }

    // ESTADO: desenhado, e o clique carrega o motivo. A ordem é a da gravidade percebida — o
    // cadeado do mapa é o que a pessoa tem mais chance de não saber que está ligado.
    let blocked = null;
    if (mapLocked) blocked = LOCKED_MAP_NOTICE;
    else if (featureLocked) blocked = LOCKED_FEATURE_NOTICE;
    else if (isMergedArrow(feature?.properties)) blocked = MERGED_ARROW_NOTICE;
    else if (resolveSpineCoordinates(feature) === null) blocked = SHORT_SPINE_NOTICE;

    return LINEAR_SOURCES.filter((t) => t !== source).map((target) => ({ target, blocked }));
}
