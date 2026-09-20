// Path: js/first_person_3d_tool/progresso-de-carga.js

/**
 * @fileoverview A CONTA DO PROGRESSO DE CARGA, separada de quem a desenha.
 *
 * A cena caminhável baixa um splat que passa de 20 MB, e a tela de carregamento dela tinha uma
 * barra que ANIMAVA DE ZERO A CEM EM DOIS SEGUNDOS por `@keyframes`, sem relação nenhuma com o
 * que estava acontecendo: ela terminava cheia enquanto faltavam 18 MB, o que num enlace de campo
 * se lê como travamento, e é pior que barra nenhuma porque ensina a desconfiar da próxima.
 *
 * ESTE ARQUIVO NÃO TOCA NO DOM e não busca nada: ele traduz bytes em frase e em fração, que é a
 * parte que se exercita em node. Quem lê o corpo da resposta é `first_person_viewer.js`, e quem
 * pinta é a folha de estilo.
 *
 * O TOTAL PODE NÃO EXISTIR, e esse é o caso que decide a forma. `Content-Length` some quando a
 * resposta vem em pedaços ou quando o CORS não expõe o cabeçalho, e aí não há percentual
 * possível. Em vez de inventar um (um teto chutado, uma barra que anda sozinha), a frase passa a
 * dizer quanto JÁ VEIO, que é um fato, e a fração devolve `null` para a barra ficar
 * indeterminada. Número inventado numa barra é a mesma mentira da animação de dois segundos.
 */

/** Acima disto a cena é grande o bastante para a espera merecer aviso, em bytes. */
export const PESO_QUE_MERECE_AVISO = 15 * 1024 * 1024;

/**
 * Formata bytes na unidade que cabe, em pt-BR.
 * @param {number} bytes
 * @returns {string}
 */
export function emMegabytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    const mb = bytes / (1024 * 1024);
    // Abaixo de 1 MB a casa decimal vira ruído e a barra já vai mudar antes de alguém ler.
    if (mb < 1) return `${Math.round(bytes / 1024)} kB`;
    return `${mb.toFixed(1).replace('.', ',')} MB`;
}

/**
 * A fração já baixada, de 0 a 1, ou `null` quando não há total.
 * @param {number} recebidos
 * @param {number|null} total
 * @returns {number|null}
 */
export function fracaoBaixada(recebidos, total) {
    if (!Number.isFinite(total) || total <= 0) return null;
    if (!Number.isFinite(recebidos) || recebidos < 0) return 0;
    // SATURA EM 1: uma resposta comprimida pode entregar mais bytes decodificados que o
    // `Content-Length` do fio, e uma barra passando de cem por cento desmente a si mesma.
    return Math.min(1, recebidos / total);
}

/**
 * A linha de estado da tela de carregamento.
 *
 * @param {number} recebidos - Bytes já lidos.
 * @param {number|null} total - Bytes que o servidor anunciou, ou null.
 * @returns {string}
 */
export function fraseDeProgresso(recebidos, total) {
    const fracao = fracaoBaixada(recebidos, total);
    if (fracao === null) {
        return `Carregando o modelo 3D... ${emMegabytes(recebidos)}`;
    }
    const pesada = total > PESO_QUE_MERECE_AVISO ? ', cena pesada' : '';
    return `Carregando o modelo 3D... ${emMegabytes(recebidos)} de ${emMegabytes(total)}${pesada}`;
}

/**
 * O total que o servidor anunciou, em bytes, ou `null`.
 *
 * O cabeçalho é lido com `Number` e conferido: um `Content-Length` ausente vira `NaN`, e um
 * `NaN` como denominador espalharia `NaN` pela largura da barra, que o CSS ignora em silêncio.
 * @param {Response} resposta
 * @returns {number|null}
 */
export function totalAnunciado(resposta) {
    const bruto = Number(resposta?.headers?.get?.('content-length'));
    return Number.isFinite(bruto) && bruto > 0 ? bruto : null;
}
