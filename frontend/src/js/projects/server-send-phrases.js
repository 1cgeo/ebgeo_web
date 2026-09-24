// Path: js/projects/server-send-phrases.js

/**
 * @fileoverview What the SERVER reported losing when a local atlas was sent to it, as pt-BR
 * sentences. ZERO imports, on purpose: two doors send an atlas (the card of `atlas.html` and the
 * account menu of the map) and both say these sentences, and the map page must not carry the
 * whole notice module of the atlas chooser to say them.
 */

/**
 * The pt-BR name of every surface the server's pruner reports, so the sentence says what the user
 * lost instead of echoing a key.
 *
 * The keys are the server's (`backend/src/modules/atlas/atlas-resource-prune.js`), and the four
 * 3D collectors are kept apart on purpose: they are four different things in the product, and
 * folding them into "3D" would tell somebody who lost two camera positions that they lost
 * "markers". A key that is NOT in this table is printed verbatim — see {@link frasePoda}.
 */
export const ROTULO_DE_PODA = Object.freeze({
    'cesium3d.cameraPositions': ['posição de câmera 3D', 'posições de câmera 3D'],
    'cesium3d.markers': ['marcador 3D', 'marcadores 3D'],
    'cesium3d.measurements': ['medição 3D', 'medições 3D'],
    'cesium3d.viewsheds': ['bacia de visada 3D', 'bacias de visada 3D'],
    'sv360.markers': ['marcador 360', 'marcadores 360'],
    'sv360.orientations': ['orientação 360', 'orientações 360'],
    'briefing.slide.modelId': ['slide com modelo 3D', 'slides com modelo 3D'],
    'briefing.slide.photoId': ['slide com foto 360', 'slides com foto 360'],
    'mapa.baseLayer': ['camada de base de mapa', 'camadas de base de mapa'],
    'mapa.catalogLayers': ['camada de catálogo', 'camadas de catálogo'],
    'settings.basemaps': ['camada de base do catálogo', 'camadas de base do catálogo'],
    'settings.available_data_layers': ['camada de dados do catálogo', 'camadas de dados do catálogo'],
    'settings.available_analysis_layers': ['camada de análise do catálogo', 'camadas de análise do catálogo'],
    'settings.available_3d_models': ['modelo 3D do catálogo', 'modelos 3D do catálogo'],
    'settings.available_360_views': ['projeto 360 do catálogo', 'projetos 360 do catálogo'],
    'settings.default_basemap': ['camada de base padrão', 'camadas de base padrão'],
});

/**
 * `n` mais o substantivo na forma que `n` pede.
 * @param {number} n
 * @param {string} singular
 * @param {string} [plural] - Sem ele, o singular mais `s`.
 * @returns {string}
 */
export function contado(n, singular, plural = `${singular}s`) {
    return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Une uma lista em português: `a`, `a e b`, `a, b e c`.
 * @param {string[]} itens
 * @returns {string}
 */
export function comEs(itens) {
    if (itens.length <= 1) return itens[0] ?? '';
    return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * Um inteiro positivo de um campo que pode chegar como qualquer coisa.
 * @param {*} value
 * @returns {number}
 */
export function numero(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * O AVISO DE QUE O SERVIDOR GRAVOU MENOS DO QUE SUBIU.
 *
 * DUAS MEDIDAS DO MESMO NÚMERO, POR CAMINHOS INDEPENDENTES: a contagem do payload é do cliente, e
 * `summary.mapsImported`/`featuresImported` é o que o servidor diz ter gravado. Duas medidas do
 * mesmo parâmetro que discordam indicam DEFEITO, e a resposta é dizer, nunca escolher uma das
 * duas. Descartar a do servidor porque a do cliente já existe é literalmente o gesto que jogou
 * fora o `prunedResourceRefs` durante toda a fase.
 *
 * SÓ COMPARA O QUE VEIO. Campo ausente é "o servidor não disse", e não zero: um `summary` sem
 * contagem (uma versão anterior do backend, uma resposta truncada) não pode virar um aviso de que
 * nada foi gravado sobre um envio que deu certo. `remappedIds` NÃO entra aqui: recunhar um id já
 * ocupado é o servidor fazendo o certo, não uma perda.
 *
 * @param {Object} [result]
 * @returns {string|null}
 */
export function fraseDoServidor(result) {
    const summary = result?.summary;
    const sent = result?.sent;
    if (!summary || typeof summary !== 'object' || !sent) return null;

    const eixos = [
        ['mapa', 'mapas', summary.mapsImported, numero(sent.maps)],
        ['feição', 'feições', summary.featuresImported, numero(sent.features)],
    ].filter(([, , gravou, subiu]) => Number.isFinite(Number(gravou)) && Number(gravou) < subiu);
    if (eixos.length === 0) return null;

    const clausulas = eixos.map(([singular, plural, gravou, subiu]) =>
        `${contado(Math.trunc(Number(gravou)), singular, plural)} dos ${subiu} que subiram`);
    return `O servidor gravou só ${comEs(clausulas)}.`;
}

/**
 * O QUE O SERVIDOR RELATOU DE PERDA num envio, para a porta que monta a própria frase de desfecho.
 *
 * O "Salvar no servidor" do menu da conta, no MAPA, é a segunda porta do mesmo envio e escreve a
 * própria frase (ele fica no atlas novo em vez de voltar a uma lista). Até 2026-09-23 ele jogava
 * fora o `summary` que `atlas.html` lê desde 2026-09-07, e dizia "Atlas salvo no servidor" em verde
 * sobre um atlas de que o servidor tinha descartado todo item 3D e 360. As duas frases saem das
 * MESMAS funções, para que as duas portas não voltem a divergir.
 *
 * @param {{summary?: Object, sent?: {maps: number, features: number}}} result - A resposta do
 *   servidor e a contagem do que subiu.
 * @returns {string[]} Uma frase por perda relatada; vazio quando o servidor gravou tudo.
 */
export function avisosDoServidor(result) {
    return [fraseDoServidor(result), frasePoda(result?.summary?.prunedResourceRefs)].filter(Boolean);
}

/**
 * O AVISO DA PODA DO SERVIDOR (`summary.prunedResourceRefs`), com o motivo dela.
 *
 * O ACHADO: com o catálogo do servidor no estado de fábrica (0 tilesets, 0 projetos 360), os 10
 * itens 3D e os 6 itens 360 do atlas medido foram descartados no import, e a frase da tela saiu
 * IDÊNTICA à do caso em que eles entraram. O servidor sempre relatou; o cliente é que jogava a
 * resposta fora.
 *
 * FALHA ABERTO EM SUPERFÍCIE DESCONHECIDA: uma superfície que o servidor passe a relatar e que
 * esta tabela não conheça sai com a chave crua. Uma perda dita com nome feio continua sendo uma
 * perda dita; calá-la por falta de rótulo seria o defeito de volta.
 *
 * @param {Object} [prunedResourceRefs] - `{superfície: contagem}`.
 * @returns {string|null}
 */
export function frasePoda(prunedResourceRefs) {
    if (!prunedResourceRefs || typeof prunedResourceRefs !== 'object') return null;
    const itens = Object.entries(prunedResourceRefs)
        .map(([superficie, bruto]) => [superficie, numero(bruto)])
        .filter(([, n]) => n > 0)
        .map(([superficie, n]) => {
            const rotulo = ROTULO_DE_PODA[superficie];
            return rotulo ? contado(n, rotulo[0], rotulo[1]) : `${n} ${superficie}`;
        });
    if (itens.length === 0) return null;

    return `O servidor descartou ${comEs(itens)}, porque o modelo 3D ou o projeto 360 usado não `
        + 'está no catálogo dele. Peça ao administrador para cadastrá-los e envie de novo.';
}

/**
 * O ENVIO GRANDE DEMAIS (HTTP 413), nas duas portas do envio.
 *
 * NÃO MANDA TENTAR DE NOVO, e é o ponto: a frase genérica da falha na preparação diz "tente de novo
 * sem alterar o atlas", que é verdade para a rede que caiu e mentira para o 413, que se repete a
 * cada tentativa. O que pesa num atlas herdado são as FOTOS ANEXAS às feições, que as duas linhas do
 * produto guardam como data URL dentro de `properties.images`, e elas vão no documento do envio.
 *
 * @param {number|null|undefined} bytes - O tamanho do documento que subiria, quando medido.
 * @returns {string}
 */
export function fraseDeEnvioGrandeDemais(bytes) {
    const tamanho = Number.isFinite(bytes) && bytes > 0 ? ` (cerca de ${Math.ceil(bytes / (1024 * 1024))} MB)` : '';
    return `Este atlas é grande demais para enviar ao servidor de uma vez${tamanho}. Remova fotos anexas `
        + 'grandes das feições ou divida-o em atlas menores; se precisar dele inteiro no servidor, avise o '
        + 'administrador.';
}

/**
 * @param {Object} payload - O documento que o envio sobe.
 * @returns {number|null} O tamanho dele em bytes UTF-8, ou null se não der para medir.
 */
export function tamanhoDoEnvio(payload) {
    try {
        return new TextEncoder().encode(JSON.stringify(payload)).length;
    } catch {
        return null;
    }
}
