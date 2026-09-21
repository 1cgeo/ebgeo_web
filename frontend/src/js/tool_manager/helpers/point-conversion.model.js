// Path: js/tool_manager/helpers/point-conversion.model.js

/**
 * @fileoverview CONVERTER UM PONTO em símbolo militar ou em medida de coordenação, como
 * montagem pura: o que atravessa a troca de tipo e o que morre nela. Sem DOM, sem store e
 * sem mapa, pelo mesmo motivo do irmão `linear-conversion.model.js`:
 * `feature-header.helpers.js` importa o barril da store, o despachante de GeoJSON e o
 * MapLibre, e portanto não carrega no ambiente node puro da suíte.
 *
 * ================= O DEFEITO QUE ELE FECHA (achado E1) ========================
 *
 * As duas conversões de ponto montavam a feição nova a partir dos padrões do destino mais
 * uma LISTA FIXA escrita à mão (`layerId`, `nome`, `descricao`, `visivel`, `bloqueado`,
 * `opacity`), e o ponto de origem era removido no MESMO lote. Tudo o que não estava na
 * lista morria sem aviso, e o que estava fora dela era justamente DADO DO USUÁRIO:
 *
 *   - `temporalInicio` / `temporalFim`: a janela de validade. A feição convertida nascia
 *     PERMANENTE, visível em qualquer posição do cursor, e não havia como saber qual
 *     janela ela tinha.
 *   - `trajetoria`: os keypoints do ponto móvel. Ponto, símbolo militar e medida de
 *     coordenação são EXATAMENTE os três tipos que suportam trajetória, então a travessia
 *     era entre dois tipos capazes de carregá-la e ela morria no meio.
 *   - `attributes` e `images`: os atributos digitados na tabela e as fotos anexadas.
 *
 * O irmão linear já preservava a janela e os atributos POR NOME (`PRESERVED_KEYS`); as
 * conversões de ponto ficaram fora daquela mudança, e a assimetria é o defeito.
 *
 * ================= `_temporalHome` VIAJA, E ISSO NÃO É DESCUIDO ================
 *
 * `_temporalHome` é propriedade de RUNTIME (o prefixo `_` faz `cleanFeature` descartá-la na
 * entrada do repositório), e mesmo assim ela precisa atravessar, porque `cleanFeature`
 * (`store/repository.utils.js`) a LÊ antes de descartá-la para reescrever a geometria de um
 * Point A PARTIR dela. É o mesmo motivo pelo qual a colagem a carrega
 * (`tool_manager/clipboard-offset.js`), e a falha é igualmente silenciosa:
 *
 *   - com a trajetória tocando, a feição na tela está na posição INTERPOLADA, e é essa a
 *     coordenada que a conversão lê de `geometry.coordinates`. Sem `_temporalHome`, é ela
 *     que o `addFeature` persiste, e o símbolo se MUDA para onde o cursor por acaso estava,
 *     de vez, sem erro e sem aviso;
 *   - re-derivar em vez de copiar (nascer com a geometria na casa e deixar a serviço de
 *     render recarimbar o `_temporalHome`) conserta o disco e estraga a tela: aquele
 *     recarimbo só acontece na PRÓXIMA passada de aplicação, e com o playback parado ela
 *     pode não vir, de modo que o símbolo novo apareceria na casa enquanto o ponto que ele
 *     substituiu estava deslocado.
 *
 * Copiar resolve os dois: a tela continua no ponto deslocado, o disco recebe a casa.
 * Diferente da colagem, NÃO há deslocamento a aplicar, porque converter não move a feição.
 *
 * ================= OS TRÊS INTERRUPTORES DE DERIVAÇÃO =========================
 *
 * `autoDirection`, `autoSpeed` e `autoDtg` são opt-in POR FEIÇÃO (a caixa em
 * `temporal/temporal-attributes-section.js`), e um ponto não tem nenhum deles para oferecer.
 * Os `DEFAULT_PROPERTIES` dos dois destinos hoje também não os trazem, então a feição
 * convertida já nasceria com os três desligados; o apagamento explícito aqui é o que mantém
 * a propriedade caso um padrão de destino ganhe um deles depois. Herdar um interruptor que
 * a pessoa nunca ligou faria o símbolo convertido começar a reescrever a própria direção, a
 * velocidade e o GDH a partir de uma trajetória que ela não pediu para derivar.
 */

import { deepClone } from '@utils/deep-utils.js';

/**
 * O que ATRAVESSA a conversão de ponto: identidade, texto do usuário, os anexos e o tempo.
 *
 * ESTA LISTA É A DECLARAÇÃO, e a força dela é de teste: quem acrescentar uma propriedade de
 * usuário ao ponto acrescenta o nome aqui, e não numa cópia à mão dentro do arquivo do menu.
 * `opacity` está nela porque a lista antiga a preservava e continua certo preservá-la.
 * @type {readonly string[]}
 */
export const POINT_PRESERVED_KEYS = Object.freeze([
    'layerId', 'nome', 'descricao', 'visivel', 'bloqueado', 'opacity',
    'attributes', 'images', 'temporalInicio', 'temporalFim', 'trajetoria', '_temporalHome',
]);

/**
 * Os interruptores de derivação automática, que NUNCA são herdados numa conversão.
 * @type {readonly string[]}
 */
export const POINT_AUTO_DERIVATION_KEYS = Object.freeze(['autoDirection', 'autoSpeed', 'autoDtg']);

/**
 * Um par `[lng, lat]` utilizável, ou null.
 * @param {*} value - Candidato a par de coordenadas
 * @returns {Array<number>|null} Par novo, ou null
 */
function toLngLatPair(value) {
    if (!Array.isArray(value) || value.length < 2) return null;
    const [lng, lat] = value;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat];
}

/**
 * Uma trajetória utilizável, copiada em profundidade, ou null.
 *
 * A cópia é PROFUNDA porque a rasa compartilharia cada keypoint com a feição de origem, e a
 * origem está prestes a ser apagada: arrastar um vértice da trajetória nova mexeria na
 * antiga enquanto ela ainda existisse.
 *
 * @param {*} value - Candidata a trajetória
 * @returns {Array<Object>|null} Cópia nova, ou null quando não há o que copiar
 */
function copyTrajectory(value) {
    if (!Array.isArray(value) || value.length === 0) return null;
    return deepClone(value);
}

/**
 * O BLOCO DE PROPRIEDADES da feição convertida, pronto para receber por cima o que é
 * específico do destino (`sidc` ou `pointCode`, `createdAtZoom`, `calculatedSize`,
 * `selectionBox`).
 *
 * Ele nasce dos padrões do DESTINO, clonados em profundidade porque objeto estático de
 * classe é compartilhado por referência entre todas as feições que o usarem, e recebe por
 * cima o que atravessa.
 *
 * `??` em toda parte, NUNCA `||`: um `layerId` de `0` ou `''` é valor de domínio, e foi o
 * `||` que mandou feições dessas camadas para a camada implícita nas conversões lineares.
 * `descricao` vazia é escolha tão explícita quanto uma preenchida.
 *
 * @param {Object} config - Entradas da montagem
 * @param {Object} config.feature - Feição de ponto de origem
 * @param {Object} config.defaults - `DEFAULT_PROPERTIES` do controle de destino
 * @param {string} config.id - Id novo da feição
 * @param {string} [config.nome] - Nome gerado, usado só se a origem não tiver um
 * @returns {Object} Propriedades novas
 */
export function buildConvertedPointProperties({ feature, defaults, id, nome } = {}) {
    const src = feature?.properties || {};
    const props = deepClone(defaults || {});

    props.id = id;

    props.layerId = src.layerId ?? props.layerId ?? 'default';
    props.nome = (typeof src.nome === 'string' && src.nome !== '') ? src.nome : (nome ?? props.nome);
    props.descricao = src.descricao ?? '';
    props.visivel = src.visivel !== false;
    props.bloqueado = src.bloqueado === true;

    // `Number.isFinite`, nunca `??`: `NaN` é um valor PRESENTE, e `NaN ?? x` devolve `NaN`,
    // que o MapLibre aceita como opacidade e desenha como nada.
    props.opacity = Number.isFinite(src.opacity) ? src.opacity : props.opacity;

    if (src.attributes !== undefined) props.attributes = deepClone(src.attributes);
    if (src.images !== undefined) props.images = deepClone(src.images);

    // O TEMPO. Ausente continua ausente: uma feição sem janela é PERMANENTE, e escrever
    // `undefined` na chave seria dizer a mesma coisa com uma chave a mais no JSONB.
    if (src.temporalInicio !== undefined) props.temporalInicio = src.temporalInicio;
    if (src.temporalFim !== undefined) props.temporalFim = src.temporalFim;

    const trajetoria = copyTrajectory(src.trajetoria);
    if (trajetoria) props.trajetoria = trajetoria;

    const home = toLngLatPair(src._temporalHome);
    if (home) props._temporalHome = home;

    // Nunca herdados: ver o cabeçalho.
    for (const key of POINT_AUTO_DERIVATION_KEYS) delete props[key];

    return props;
}
