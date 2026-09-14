// Path: js/account/pendencias/comparacao-phrases.js

/**
 * @fileoverview O que a comparação entre a sua cópia e a do servidor DIZ, em pt-BR.
 *
 * ZERO IMPORTS por contrato, como os outros folhas desta pasta, e SEPARADO de
 * `comparacao-de-conflito.js` pela mesma razão que a casa separa `grant-tree.js` de
 * `*-phrases.js`: a aritmética se testa com números e a frase se testa com texto, e um arquivo que
 * misturasse os dois teria de ser lido inteiro para se conferir qualquer metade.
 *
 * O RÓTULO DO TIPO DE GEOMETRIA É TRADUZIDO, e o tipo desconhecido aparece CRU, pela mesma decisão
 * que `pendencias-phrases.js` tomou para unidade em disputa: uma tabela que esconde o que não
 * conhece faz a tela dizer menos do que sabe. `MultiPolygon` na tela é feio; "" é mentira.
 *
 * A PRECISÃO DA DISTÂNCIA MUDA COM A ESCALA, e isso não é enfeite. Um item que andou 40 cm e um que
 * andou 4 km são a mesma linha de texto se as duas saírem com o mesmo número de casas: abaixo de um
 * metro a frase diz centímetros, abaixo de mil metros diz metros inteiros, e acima disso diz
 * quilômetros com uma casa. O que a pessoa precisa distinguir é ordem de grandeza.
 */

/** Tipo de geometria GeoJSON → como se chama na tela. */
const TIPO_LABEL = Object.freeze({
    Point: 'ponto',
    MultiPoint: 'conjunto de pontos',
    LineString: 'linha',
    MultiLineString: 'conjunto de linhas',
    Polygon: 'polígono',
    MultiPolygon: 'conjunto de polígonos',
    GeometryCollection: 'geometria composta',
});

/** O rótulo do bloco inteiro. */
export const COMPARACAO_ROTULO = 'Sua cópia e a do servidor:';

/** O que se diz quando não há o outro lado do par para comparar. */
export const COMPARACAO_SEM_SERVIDOR =
    'O servidor não devolveu o conteúdo atual deste item, então esta tela não tem com o que '
    + 'comparar a sua cópia.';

/**
 * @param {string|null|undefined} tipo - Tipo GeoJSON.
 * @returns {string} O nome na tela, ou o tipo cru, ou "sem geometria".
 */
export function tipoDeGeometriaLabel(tipo) {
    if (typeof tipo !== 'string' || tipo === '') return 'sem geometria';
    return TIPO_LABEL[tipo] ?? tipo;
}

/**
 * Uma distância em metros, na escala que a torna legível.
 * @param {number|null|undefined} metros
 * @returns {string|null} null quando não há distância a dizer.
 */
export function distanciaLabel(metros) {
    if (!Number.isFinite(metros) || metros < 0) return null;
    if (metros < 1) return `${Math.round(metros * 100)} cm`;
    if (metros < 1000) return `${Math.round(metros)} m`;
    return `${(metros / 1000).toFixed(1).replace('.', ',')} km`;
}

/**
 * A frase da GEOMETRIA, a partir do modelo de {@link compararFeicao}.
 *
 * ELA NOMEIA OS DOIS LADOS SEMPRE QUE ELES DIFEREM, e nunca só o delta: "3 vértices contra 5" diz
 * qual é qual, enquanto "2 vértices a mais" obriga a pessoa a lembrar de que lado ela está. Quando
 * nada difere visivelmente, a frase é uma só, porque um bloco com três linhas dizendo "igual, igual
 * e igual" ensina a não ler o bloco.
 *
 * @param {Object|null|undefined} geometria - O sub-objeto `geometria` do modelo.
 * @returns {string} Uma frase, ou vazio quando não há geometria dos dois lados.
 */
export function geometriaFrase(geometria) {
    if (!geometria) return '';
    const { igual, tipoLocal, tipoServidor, verticesLocal, verticesServidor, deslocamentoM } = geometria;
    if (verticesLocal === null && verticesServidor === null) return '';
    if (igual === true) return 'Mesma geometria: nada mudou de forma nem de lugar.';

    const partes = [];
    if (tipoLocal !== tipoServidor) {
        partes.push(`${tipoDeGeometriaLabel(tipoLocal)} aqui, `
            + `${tipoDeGeometriaLabel(tipoServidor)} no servidor`);
    } else {
        partes.push(tipoDeGeometriaLabel(tipoLocal));
    }

    if (verticesLocal !== verticesServidor) {
        partes.push(`${verticesLabel(verticesLocal)} aqui, ${verticesLabel(verticesServidor)} no servidor`);
    }

    const distancia = distanciaLabel(deslocamentoM);
    // Meio metro é a mesma fronteira que o modelo usa para chamar duas geometrias de iguais; abaixo
    // dela a frase omite o deslocamento em vez de anunciar "0 cm", que se lê como "não mediu".
    if (distancia !== null && deslocamentoM >= 0.5) {
        partes.push(`o centro está ${distancia} distante`);
    }
    return `${partes.join('; ')}.`;
}

/**
 * @param {number|null} n - Contagem de vértices.
 * @returns {string}
 */
function verticesLabel(n) {
    if (!Number.isFinite(n)) return 'sem vértices';
    return n === 1 ? '1 vértice' : `${n} vértices`;
}

/**
 * A frase das PROPRIEDADES, que nomeia os campos em vez de contá-los.
 *
 * O NÚMERO SOZINHO NÃO SERVE ("4 campos diferentes" não diz se um deles é o nome que a pessoa
 * acabou de escrever), então a lista vem inteira até um teto, e acima dele o resto vira contagem,
 * porque uma linha com quarenta nomes deixa de ser legível pelo mesmo motivo.
 * @param {string[]|null|undefined} campos - Nomes dos campos que diferem.
 * @param {number} [teto=6] - Quantos nomes cabem antes de virar contagem.
 * @returns {string} Uma frase, ou vazio quando nenhum campo difere.
 */
export function propriedadesFrase(campos, teto = 6) {
    const lista = Array.isArray(campos) ? campos.filter((c) => typeof c === 'string' && c !== '') : [];
    if (lista.length === 0) return '';
    if (lista.length <= teto) {
        return lista.length === 1
            ? `Uma propriedade difere: ${lista[0]}.`
            : `${lista.length} propriedades diferem: ${lista.join(', ')}.`;
    }
    const restantes = lista.length - teto;
    return `${lista.length} propriedades diferem: ${lista.slice(0, teto).join(', ')} `
        + `e mais ${restantes}.`;
}

/**
 * As duas frases do bloco, já filtradas: só entra o que tem o que dizer.
 * @param {Object|null|undefined} comparacao - A saída de `compararFeicao`.
 * @returns {string[]}
 */
export function comparacaoFrases(comparacao) {
    if (!comparacao) return [];
    return [geometriaFrase(comparacao.geometria), propriedadesFrase(comparacao.propriedades)]
        .filter((frase) => frase !== '');
}
