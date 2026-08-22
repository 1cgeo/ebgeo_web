/**
 * Path: js/3d_models_viewer_tool/services/models-api.service.js
 *
 * Catálogo de modelos 3D vindo do serviço ebgeo_3d.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Antes o array `config.tilesets` era escrito à
 * mão, entrada por entrada, no `config.js` de cada instância: URL, nome,
 * descrição, palavras-chave, ponto de navegação, offset de altura e miniatura.
 * Publicar um modelo novo exigia editar esse arquivo, e o mapa só enxergava o
 * modelo depois de um redeploy do frontend. É o mesmo defeito que o 360 já
 * pagou com os PMTiles, e a solução aqui é a mesma: um endereço só a trocar, e
 * o catálogo sai do serviço que tem o dado.
 *
 * O PREENCHIMENTO É EM `config.tilesets`, DE PROPÓSITO. Sete lugares do
 * aplicativo leem esse array hoje (map_3d, o controle do visualizador, o editor
 * de briefing, o validador de referência, o catálogo e a busca). Publicar uma
 * API nova obrigaria a reescrever os sete, e cada um é uma chance de esquecer um
 * caso. Preenchendo o array que eles já leem, a troca fica no lugar onde ela
 * cabe.
 *
 * NENHUM ENDEREÇO NASCE NO SERVIDOR. A URL do tileset e a da miniatura são
 * montadas aqui, a partir da base que só o config conhece. O serviço publica um
 * `url` já montado, útil para gerar config estático, e este cliente o ignora: em
 * produção o serviço vive atrás de um prefixo que ele não enxerga, e a URL que
 * ele montaria responderia 404. Ver o comentário da base do 360 em config.js.
 */

import config from '../../config.js';

/** Cache do catálogo do serviço. Preenchido pelo preflight, lido pelo resto. */
let _modelos = null;

/**
 * Os modelos que o `config.js` declara à mão, guardados ANTES do primeiro
 * preenchimento.
 *
 * Sem esta cópia, um segundo preflight (recarga, ou o mesmo módulo importado
 * duas vezes) leria o array já concatenado como se fosse a lista local, e os
 * modelos do serviço se multiplicariam a cada chamada.
 */
let _locaisOriginais = null;

/** Base da API, sem barra final. Vazia significa serviço não configurado. */
function base() {
    return (config.models3d?.serviceUrl || '').replace(/\/+$/, '');
}

/**
 * Converte a entrada do serviço na entrada que `config.tilesets` espera.
 *
 * O contrato é campo a campo o do `config.tilesets` escrito à mão, o que
 * mantém os sete consumidores intactos. As duas exceções são endereços, e
 * as duas se montam aqui.
 *
 * @param {object} m Entrada de /api/v1/models
 * @returns {object}
 */
function paraTileset(m) {
    const b = base();
    const saida = {
        url: `${b}/models/${m.id}/tileset.json`,
        id: m.id,
        name: m.name,
        type: m.type || '3dtiles',
        heightOffset: m.heightOffset ?? 0
    };

    if (m.description) saida.description = m.description;
    if (m.local) saida.local = m.local;
    if (m.data_captura) saida.data_captura = m.data_captura;
    if (Array.isArray(m.keywords)) saida.keywords = m.keywords;
    if (m.locate) saida.locate = m.locate;
    if (m.maximumScreenSpaceError != null) {
        saida.maximumScreenSpaceError = m.maximumScreenSpaceError;
    }
    if (m.previewThumbnail) saida.previewThumbnail = `${b}${m.previewThumbnail}`;
    if (m.previewVideo) saida.previewVideo = `${b}${m.previewVideo}`;

    // `formato` e `groundHeight` não entram: são metadado de proveniência, e
    // nenhum consumidor os lê. Ficam disponíveis na ficha do modelo.
    return saida;
}

/**
 * Busca o catálogo e preenche `config.tilesets`.
 *
 * @returns {Promise<boolean>} true quando há ao menos um modelo servido.
 */
export async function preflightCheck() {
    const b = base();
    if (!b) return false;

    if (_locaisOriginais === null) {
        _locaisOriginais = Array.isArray(config.tilesets) ? [...config.tilesets] : [];
    }

    try {
        // O TEMPO LIMITE NÃO É LUXO. Sem ele, um serviço que aceita a conexão e
        // não responde pendura a partida inteira do aplicativo, sem erro no
        // console. É exatamente o modo de falha que o `load` do MapLibre já
        // produziu aqui: falhar é ruidoso e verdadeiro, pendurar é silencioso e
        // mentiroso.
        const controle = new AbortController();
        const relogio = setTimeout(() => controle.abort(), 5000);

        let resposta;
        try {
            resposta = await fetch(`${b}/models`, { signal: controle.signal });
        } finally {
            clearTimeout(relogio);
        }

        if (!resposta.ok) return false;

        const corpo = await resposta.json();
        const lista = Array.isArray(corpo?.tilesets) ? corpo.tilesets : [];
        if (lista.length === 0) return false;

        _modelos = lista.map(paraTileset);

        // CONCATENA, e nao substitui. O que estava declarado a mao no config e
        // modelo servido como ARQUIVO ESTATICO (o `type: 'glb'`), que o
        // ebgeo_3d nao cobre. Substituir apagaria esses modelos do mapa sem um
        // erro no console.
        //
        // O SERVICO GANHA em caso de id repetido: se alguem deixou no config a
        // entrada a mao de um modelo que ja migrou para o servico, o dado vivo
        // manda. `map_3d.js` e os outros seis consumidores usam `find`, que para
        // no PRIMEIRO, entao o do servico tem de vir antes.
        const idsDoServico = new Set(_modelos.map((m) => m.id));
        const locais = (_locaisOriginais || []).filter((t) => !idsDoServico.has(t.id));
        config.tilesets = [..._modelos, ...locais];
        return true;
    } catch (erro) {
        console.error('[models-api] preflightCheck falhou:', erro);
        return false;
    }
}

/**
 * Catálogo já buscado. NUNCA faz pedido de rede.
 * @returns {object[]|null}
 */
export function getCachedModels() {
    return _modelos;
}

/**
 * Ficha completa de um modelo, com proveniência e histórico de importação.
 * Só o painel de detalhe precisa disso, então ela não entra no preflight.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function fetchModelDetail(id) {
    const b = base();
    if (!b) return null;
    try {
        const r = await fetch(`${b}/models/${encodeURIComponent(id)}.json`);
        return r.ok ? await r.json() : null;
    } catch {
        return null;
    }
}
