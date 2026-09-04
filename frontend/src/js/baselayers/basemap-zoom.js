// Path: js/baselayers/basemap-zoom.js

/**
 * @fileoverview A faixa de zoom de um mapa base, e como aplicá-la à câmera sem estourar.
 *
 * O PROBLEMA QUE ELE EXISTE PARA RESOLVER. A faixa de zoom passou a ter um nível configurável
 * só, e ele é o MAPA BASE (decisão do dono, 2026-08-31): a aplicação é fixa em [2, 21] e o atlas
 * não tem zoom nenhum. Cada linha de `basemaps` declara `config.minzoom`/`maxzoom`, servidos em
 * `config.basemaps[id]`, e a troca de camada base tem de reapertar a câmera.
 *
 * POR QUE ISTO É UM MÓDULO À PARTE, e não três linhas dentro do controle: a ordem em que as duas
 * propriedades do MapLibre são escritas DECIDE se a troca funciona ou levanta exceção, e essa
 * ordem é a única coisa aqui que não é óbvia. Um módulo puro pode ser dirigido por um mapa falso
 * que imponha as guardas REAIS, e é assim que a régua se prova contra o pior caso em vez de ser
 * vista passar no caso fácil.
 *
 * AS GUARDAS, medidas no código do MapLibre em uso e não deduzidas da documentação.
 * Medidas primeiro no bundle vendorizado 5.18; RECONFERIDAS na 6.7.0 vinda do npm
 * (`node_modules/maplibre-gl/src/ui/map.ts`, `setMinZoom`/`setMaxZoom`), onde as duas são
 * as mesmas, com `defaultMinZoom = -2` e `defaultMaxZoom = 22` nomeados em constante:
 *   - `Map.setMinZoom(e)` só age se `e >= -2 && e <= transform.maxZoom`; fora disso LEVANTA.
 *   - `Map.setMaxZoom(e)` só age se `e >= transform.minZoom`; fora disso LEVANTA.
 * As duas comparações são INCLUSIVAS, então uma faixa degenerada e legítima como [2, 2] passa.
 *
 * A CONSEQUÊNCIA que morde: sair de um mapa base de teto BAIXO para um de piso ALTO
 * (de [2, 10] para [15, 21]) estoura na ordem ingênua, porque `setMinZoom(15)` encontra o teto
 * ainda em 10. Baixar primeiro o piso ao chão da aplicação torna as três escritas válidas em
 * QUALQUER ordem de troca, sem um ramo condicional que alguém teria de manter correto.
 */

/**
 * A faixa efetiva daquele mapa base.
 *
 * A OMISSÃO É VALOR, não lacuna: mapa base sem as chaves vale a faixa inteira da aplicação, que
 * é o padrão que o servidor documenta e o formulário do painel mostra. O teste é
 * `Number.isFinite` e não um truthy, por duas razões medidas: `0` é um número (ainda que o
 * servidor o recuse) e um `??` sozinho deixaria passar o `null` de um payload antigo, que viraria
 * `setMinZoom(null)` e, pelo `null == e ? -2 : e` do MapLibre, um piso de -2 fora da faixa fixa.
 *
 * @param {{minzoom?: number, maxzoom?: number}|null|undefined} cfg - `config.basemaps[id]`.
 * @param {{minZoom: number, maxZoom: number}} aplicacao - A faixa fixa (`config.map2d`).
 * @returns {{piso: number, teto: number}}
 */
export function faixaDeZoom(cfg, aplicacao) {
    return {
        piso: Number.isFinite(cfg?.minzoom) ? cfg.minzoom : aplicacao.minZoom,
        teto: Number.isFinite(cfg?.maxzoom) ? cfg.maxzoom : aplicacao.maxZoom,
    };
}

/**
 * Escreve a faixa na câmera, na única ordem que nunca levanta.
 *
 * SÃO TRÊS ESCRITAS PARA DUAS PROPRIEDADES, e a primeira não é redundância: ela abre espaço para
 * as outras duas (ver o cabeçalho). O curto-circuito na igualdade evita o passeio quando nada
 * muda, que é o caso comum de um `switchLayer` que só reafirma a camada corrente.
 *
 * A CÂMERA SE MOVE, e é o comportamento pretendido: o MapLibre reconstrange o zoom corrente e
 * emite `zoomstart`/`zoom`/`zoomend`. Quem estava em z17 num mapa base de teto 14 desce para 14
 * ao trocar, e NÃO volta sozinho ao trocar de volta.
 *
 * @param {{getMinZoom: Function, getMaxZoom: Function, setMinZoom: Function, setMaxZoom: Function}} map
 * @param {{piso: number, teto: number}} faixa
 * @param {number} chao - O piso da aplicação, o valor mais baixo que a câmera pode assumir.
 * @returns {boolean} Se alguma escrita aconteceu.
 */
export function aplicarFaixaDeZoom(map, { piso, teto }, chao) {
    if (map.getMinZoom() === piso && map.getMaxZoom() === teto) {
        return false;
    }
    map.setMinZoom(chao);
    map.setMaxZoom(teto);
    map.setMinZoom(piso);
    return true;
}
