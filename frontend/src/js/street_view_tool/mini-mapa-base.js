// Path: js/street_view_tool/mini-mapa-base.js

/**
 * @fileoverview Qual mapa base o mini-mapa do 360 desenha, e em que faixa de zoom.
 *
 * O PROBLEMA QUE ELE EXISTE PARA RESOLVER. O mini-mapa carregava um estilo OSM escrito à mão
 * neste diretório (`street-view-mini-map-style.js`), com URL de tile e de glifo próprias, fora
 * do catálogo. Num deploy sem saída para a internet, o mapa principal vinha do tile server
 * interno e o mini-mapa ficava em branco, sem erro nenhum, porque o estilo dele não passava
 * por lugar nenhum que o administrador pudesse corrigir. Desde 2026-08-31 ele escolhe o mapa
 * base em `streetView360.miniMapBasemap` (decisão do dono).
 *
 * A ESCOLHA É SÓ O MAPA BASE. A faixa de zoom vem da linha de catálogo dele, e NÃO é um
 * segundo par configurável: o produto acabou de reduzir três níveis de zoom a um, e um par
 * próprio aqui seria o terceiro de volta.
 *
 * A CONSEQUÊNCIA QUE FICA REGISTRADA: o mini-mapa tinha `minZoom: 11` escrito à mão, um piso
 * que existia para ele continuar parecendo um mini-mapa. Ele SAI junto, porque a faixa passou
 * a ser a do mapa base. Um mapa base de piso 2 deixa o mini-mapa afastar até 2.
 */

import { resolveBasemapStyle, firstStyledBasemap } from '../baselayers/basemap-style.js';
import { faixaDeZoom } from '../baselayers/basemap-zoom.js';
import * as builtins from '../baselayers/index.js';

/** Os cinco estilos que o cliente traz, na mesma tabela que o seletor principal usa. */
const EMBUTIDOS = {
    'carta-topografica': builtins.cartaTopografica,
    'carta-ortoimagem': builtins.cartaOrtoimagem,
    osm: builtins.osmLayer,
    imagens: builtins.imagensLayer,
    bdgex: builtins.bdgexLayer,
};

/** Os mapas base HABILITADOS, em ordem de prioridade. A mesma ordem do seletor principal. */
function habilitadosPorPrioridade(config) {
    return Object.entries(config.basemaps ?? {})
        .filter(([, b]) => b?.enabled !== false)
        .sort((a, b) => (a[1]?.priority ?? 0) - (b[1]?.priority ?? 0))
        .map(([id]) => id);
}

/**
 * O id do mapa base que o mini-mapa vai realmente desenhar, depois do fallback.
 *
 * TRÊS DEGRAUS, e cada um responde a uma falha diferente: o id configurado; o primeiro mapa
 * base habilitado que resolve para estilo (o mesmo fallback do seletor principal, para o caso
 * de o configurado ter sido apagado do catálogo); e `null`, que o chamador traduz no estilo
 * local. O id é lido de novo pela faixa de zoom, e é por isso que ele é uma função exportada:
 * estilo e faixa TÊM de falar do mesmo mapa base, e resolver duas vezes por caminhos
 * diferentes é como as duas discordariam.
 *
 * @param {object} config - O `config` do cliente.
 * @returns {string|null}
 */
export function idDoMiniMapa(config) {
    const pedido = config.streetView360?.miniMapBasemap;
    if (pedido && resolveBasemapStyle(pedido, EMBUTIDOS, config.basemapStyles)) {
        return pedido;
    }
    return firstStyledBasemap(habilitadosPorPrioridade(config), EMBUTIDOS, config.basemapStyles);
}

/**
 * O estilo MapLibre do mini-mapa, com o estilo local como último recurso.
 *
 * @param {object} config
 * @param {object} estiloLocal - `STYLE_MINI_MAPA`, o OSM escrito à mão.
 * @returns {object|string}
 */
export function estiloDoMiniMapa(config, estiloLocal) {
    const id = idDoMiniMapa(config);
    return (id && resolveBasemapStyle(id, EMBUTIDOS, config.basemapStyles)) || estiloLocal;
}

/**
 * A faixa de zoom do mini-mapa, no shape que o construtor do MapLibre espera.
 *
 * Devolve um OBJETO para ser espalhado no construtor, e não duas chamadas de `setMinZoom`:
 * aqui o mapa ainda não existe, então não há guarda de ordem a respeitar (o construtor recusa
 * `minZoom > maxZoom` de uma vez, e a régua do catálogo já impede esse par).
 *
 * Sem mapa base resolvido (o caminho do estilo local), a faixa é a da aplicação.
 *
 * @param {object} config
 * @returns {{minZoom: number, maxZoom: number}}
 */
export function faixaDoMiniMapa(config) {
    const id = idDoMiniMapa(config);
    const { piso, teto } = faixaDeZoom(id ? config.basemaps?.[id] : null, config.map2d);
    return { minZoom: piso, maxZoom: teto };
}
