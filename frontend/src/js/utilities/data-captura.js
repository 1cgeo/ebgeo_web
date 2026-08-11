// Path: js/utilities/data-captura.js

/**
 * @fileoverview Formatacao da data de captura do 360, em um lugar so.
 *
 * Existe como utilitario, e nao como funcao privada do visualizador, porque duas
 * telas mostram a mesma medida: a faixa acima do minimapa e o popup do marcador
 * no mapa 2D. Duas copias da mesma regra divergem em silencio, e ja divergiram:
 * uma quebrava no instante ISO e a outra mostrava a data crua em ordem
 * americana.
 */

/**
 * Formata a data de captura para leitura, em portugues.
 *
 * Aceita as DUAS formas que a API entrega hoje:
 *   - o instante da FOTO, ISO completo ('2025-12-05T14:40:57.000Z');
 *   - a data da CAMPANHA do projeto, seca ('2025-06-02').
 *
 * A data seca e tratada por expressao regular, nunca por `new Date`: sem fuso na
 * string, o construtor a le como UTC, e em fuso negativo, que e o nosso, ela
 * retrocede um dia na exibicao. Foi assim que "02/06" viraria "01/06".
 *
 * O instante sai no fuso de QUEM OLHA. No caso comum e o mesmo do levantamento;
 * um acervo de outro fuso visto daqui desloca o relogio, e quem precisa do
 * instante exato tem o campo cru na API.
 *
 * @param {string|null|undefined} valor - instante ISO, ou data seca AAAA-MM-DD
 * @returns {string} '05/12/2025 11:40', '02/06/2025', ou o valor cru se nao for data
 */
export function formatarDataCaptura(valor) {
    if (!valor) return '';

    const seca = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    if (seca) return `${seca[3]}/${seca[2]}/${seca[1]}`;

    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return valor;

    const data = d.toLocaleDateString('pt-BR');
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${data} ${hora}`;
}
