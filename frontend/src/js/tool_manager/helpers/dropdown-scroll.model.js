// Path: js/tool_manager/helpers/dropdown-scroll.model.js

/**
 * @fileoverview Decide o que um evento de `scroll` faz com o menu de opções da feição
 * (a engrenagem do painel): reposicionar, ou fechar.
 *
 * O MENU FECHAVA NO CLIQUE QUE O ABRIA, e a causa foi medida no navegador em 2026-09-05
 * (sonda no spec `browser-collab-conversao-linear`): o clique na engrenagem anexa o menu
 * ao `body` e, 1 a 11 ms depois, o FOCO que o clique deu ao botão rola o contêiner do
 * painel (`.feature-panel-content`) para trazer o botão inteiro à vista. O ouvinte global de
 * `scroll` do menu, registrado no documento em fase de captura, via qualquer rolagem de
 * qualquer elemento e fechava tudo. Em cerca de metade das rodadas o botão estava na borda
 * do contêiner e o menu sumia antes de o usuário ver; no resto, não.
 *
 * A REGRA: rolagem de um elemento que CONTÉM o botão ativo (o painel que segura a
 * engrenagem) move o botão, e o menu, que é filho do `body` posicionado pelo
 * `getBoundingClientRect()` do botão, tem de ACOMPANHAR, não sumir. Rolagem de qualquer
 * outra coisa (a página, o mapa, outra lista) continua fechando, porque o menu não tem como
 * saber para onde o botão foi.
 *
 * Pura de propósito: recebe o alvo do evento e o botão e devolve a decisão, sem tocar em
 * `document`, para ser provada em node com objetos falsos.
 */

/**
 * @param {*} target - `event.target` do `scroll` (elemento, `document` ou `window`)
 * @param {*} button - O botão de opções que está com o menu aberto
 * @param {*} [documento] - O `document` da página, para reconhecer a rolagem da página inteira
 * @returns {boolean} `true` quando o menu deve ser REPOSICIONADO em vez de fechado
 */
export function scrollKeepsFeatureDropdown(target, button, documento) {
    if (!target || !button) return false;
    if (documento && (target === documento || target === documento.documentElement || target === documento.body)) {
        return false;
    }
    if (typeof target.contains !== 'function') return false;
    return target !== button && target.contains(button) === true;
}
