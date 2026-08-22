/**
 * Path: js/3d_models_viewer_tool/services/models-api.service.js
 *
 * Catálogo 3D vindo do serviço ebgeo_3d: os modelos e as cenas navegáveis a pé.
 *
 * OS DOIS NO MESMO PREFLIGHT, e não em dois. Eles saem do mesmo serviço, são
 * pedidos no mesmo instante da partida e caem juntos quando ele não responde.
 * Dois preflights seriam dois pontos de espera na inicialização, dois tempos
 * limite a acertar e duas chances de alguém ligar um e esquecer o outro.
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

/** Cache das cenas navegáveis a pé. */
let _cenas = null;

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
    const tipo = m.type || '3dtiles';
    // O TIPO DECIDE O ARQUIVO E O CARREGADOR. O 3dtiles abre por
    // `Cesium3DTileset.fromUrl` e aponta o tileset.json; o glb abre por
    // `Model.fromGltfAsync` e aponta o proprio arquivo. O serviço serve o
    // segundo sempre com o mesmo nome, então o cliente não precisa saber o
    // nome que o arquivo tinha na origem.
    const arquivo = tipo === 'glb' ? 'model.glb' : 'tileset.json';
    const saida = {
        url: `${b}/models/${m.id}/${arquivo}`,
        id: m.id,
        name: m.name,
        type: tipo,
        heightOffset: m.heightOffset ?? 0
    };

    // ONDE PLANTAR, e como orientar. Só o glb usa, e sem `position` o Cesium o
    // põe no centro da Terra.
    if (m.position) saida.position = m.position;
    if (m.rotation) saida.rotation = m.rotation;
    if (m.scale != null) saida.scale = m.scale;

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
 * Converte a entrada de cena do serviço na que `config.firstPerson3d.scenes`
 * espera.
 *
 * SÓ O `basePath` MUDA, e ele é o campo inteiro. O
 * `scene-config.service.js` deriva dele os sete endereços da cena (o splat, o
 * octree em duas partes, os marcadores, as fotos e as duas prévias). Publicar
 * um caminho em vez de sete fecha sete chances de errar, e o erro não seria
 * barulhento: o splat carrega, o `voxel-meta.json` volta 404, e a cena abre
 * bonita com a colisão desligada.
 *
 * @param {object} c Entrada de /api/v1/scenes.json
 * @returns {object}
 */
function paraCena(c) {
    const saida = { ...c, basePath: `${base()}${c.basePath}` };
    // O serviço publica `data_captura`; o resto do objeto já vem no formato do
    // config, então ele atravessa como está.
    return saida;
}

/**
 * Busca o catálogo e preenche `config.tilesets` e `config.firstPerson3d.scenes`.
 *
 * @returns {Promise<boolean>} true quando há ao menos um modelo ou cena servida.
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

        // AS DUAS BUSCAS EM PARALELO, sob o MESMO tempo limite. Em série a
        // partida esperaria a soma das duas, e a segunda nem começaria enquanto
        // a primeira não voltasse.
        let respModelos;
        let respCenas;
        try {
            [respModelos, respCenas] = await Promise.all([
                fetch(`${b}/models`, { signal: controle.signal }),
                fetch(`${b}/scenes.json`, { signal: controle.signal }),
            ]);
        } finally {
            clearTimeout(relogio);
        }

        const corpoModelos = respModelos.ok ? await respModelos.json() : null;
        const corpoCenas = respCenas.ok ? await respCenas.json() : null;

        const modelos = Array.isArray(corpoModelos?.tilesets) ? corpoModelos.tilesets : [];
        const cenas = Array.isArray(corpoCenas?.scenes) ? corpoCenas.scenes : [];

        // UMA CENA SERVIDA JÁ VALE, mesmo sem nenhum modelo, e vice-versa.
        // Exigir os dois apagaria do mapa o que está funcionando por causa do
        // que não está.
        if (modelos.length === 0 && cenas.length === 0) return false;

        _modelos = modelos.map(paraTileset);

        // CONCATENA, e não substitui. O que estava declarado à mão no config é
        // modelo servido como ARQUIVO ESTÁTICO (o `type: 'glb'`), que o
        // ebgeo_3d não cobre. Substituir apagaria esses modelos do mapa sem um
        // erro no console.
        //
        // O SERVIÇO GANHA em caso de id repetido: se alguém deixou no config a
        // entrada à mão de um modelo que já migrou para o serviço, o dado vivo
        // manda. `map_3d.js` e os outros seis consumidores usam `find`, que para
        // no PRIMEIRO, então o do serviço tem de vir antes.
        const idsDoServico = new Set(_modelos.map((m) => m.id));
        const locais = (_locaisOriginais || []).filter((t) => !idsDoServico.has(t.id));
        config.tilesets = [..._modelos, ...locais];

        _cenas = cenas.map(paraCena);
        // As cenas NÃO concatenam com o config: diferente do glb, não há cena
        // servida como arquivo estático fora do serviço. Se houver uma declarada
        // à mão, ela é resquício da configuração que este preflight aposenta.
        if (!config.firstPerson3d) config.firstPerson3d = { enabled: true, scenes: [] };
        config.firstPerson3d.scenes = _cenas;
        if (_cenas.length > 0) config.firstPerson3d.enabled = true;

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
 * Cenas já buscadas. NUNCA faz pedido de rede.
 * @returns {object[]|null}
 */
export function getCachedScenes() {
    return _cenas;
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
