// Path: js/admin/shareable-resources.js

/**
 * @fileoverview QUAIS recursos esta pessoa pode compartilhar, lidos do payload que o SERVIDOR já
 * manda (`GET /resource-access/visible`), numa função pura.
 *
 * EXISTE PARA O COMANDO "Conceder acesso" da aba Concessões (decisão do dono, 2026-09-22, item
 * 19b). O modal de compartilhar recebe UM recurso; o que faltava no painel era a lista de onde
 * escolhê-lo, e ela tinha de ser a do servidor, nunca uma reconstrução por papel no cliente.
 *
 * A REGRA É A DO GATE DE REPASSE, termo a termo (`requireResourceShare`,
 * `backend/src/middleware/resource-access.js`): papel global de dado, PRODUÇÃO daquele recurso,
 * ou uma concessão viva de `view_share`. O payload já carrega as três respostas, em dois campos:
 *
 *   - `shareable[grupo]`: produção e `view_share` (`LIST_SHAREABLE_OF_ACTOR`);
 *   - `origins[grupo][id] === 'papel'`: papel global OU produção (a procedência de acesso).
 *
 * A UNIÃO DOS DOIS É O GATE, e é por isso que esta função não pergunta pela sessão. O papel global
 * (administrador, credenciado) fica FORA de `shareable` de propósito no servidor, porque quem o tem
 * concede de raiz sem concessão nenhuma; o que o delata aqui é a procedência `papel` de cada item.
 * Perguntar `hasGlobalDataAccess()` daria a mesma resposta por um segundo caminho, e dois caminhos
 * para a mesma pergunta divergem no dia em que um deles mudar.
 *
 * SÓ O PRIVADO, e é o que o payload traz: conceder um recurso público não dá a ninguém nada que
 * ele não tenha, e é também por isso que o cartão do mapa só oferece "Compartilhar" em item
 * privado. O EMPRÉSTIMO não entra: a chamada é SEM atlas em foco, e emprestado nunca foi repasse.
 *
 * ZERO IMPORTS, como as frases do painel: `admin.html` boota sem a store. E o acesso aos grupos é
 * por colchete sobre uma lista de chaves, nunca por `.tilesets`: quem lê o catálogo por
 * propriedade é o que o censo de superfícies do cliente vigia, e isto aqui recebe o documento por
 * argumento, não guarda cópia de nada.
 */

/**
 * Os cinco grupos do payload aditivo e o tipo de concessão de cada um, na ORDEM em que a lista os
 * mostra. É a mesma relação de `PAYLOAD_KEY_BY_TYPE`
 * (`backend/src/modules/resource-access/resource-access.types.js`), lida no sentido inverso.
 * @type {ReadonlyArray<{grupo: string, tipo: string}>}
 */
export const SHAREABLE_GROUPS = Object.freeze([
    Object.freeze({ grupo: 'tilesets', tipo: 'tileset' }),
    Object.freeze({ grupo: 'views360', tipo: 'sv360_project' }),
    Object.freeze({ grupo: 'dataLayers', tipo: 'data_layer' }),
    Object.freeze({ grupo: 'analysisLayers', tipo: 'analysis_layer' }),
    Object.freeze({ grupo: 'basemaps', tipo: 'basemap' }),
]);

/** A procedência que diz "vê por papel global ou por produção", o que também é repassar de raiz. */
const ORIGEM_DE_RAIZ = 'papel';

/**
 * @typedef {Object} ShareableResource
 * @property {string} resourceType - O tipo de concessão (`tileset`, `sv360_project`, ...).
 * @property {string} resourceId - O id CRU do recurso.
 * @property {string} name - O nome de exibição, ou o id quando o item não trouxe nome.
 */

/**
 * Os recursos privados que esta pessoa pode compartilhar, por tipo e depois por nome.
 *
 * Entrada suja degrada para lista vazia, nunca para exceção: um payload sem um grupo, com o grupo
 * que não é lista, com item sem id ou com `shareable` ausente (servidor antigo) só tira da lista o
 * que não se pôde confirmar. A direção do erro é ESCONDER um recurso que talvez pudesse ser
 * compartilhado, e não oferecer um que o servidor vai recusar.
 *
 * @param {*} payload - O corpo de `GET /resource-access/visible` sem atlas em foco.
 * @returns {ShareableResource[]}
 */
export function shareableResources(payload) {
    const saida = [];
    for (const { grupo, tipo } of SHAREABLE_GROUPS) {
        const itens = Array.isArray(payload?.[grupo]) ? payload[grupo] : [];
        const repassaveis = new Set(
            (Array.isArray(payload?.shareable?.[grupo]) ? payload.shareable[grupo] : []).map(String),
        );
        const origens = payload?.origins?.[grupo];
        const doTipo = [];
        const vistos = new Set();
        for (const item of itens) {
            if (item?.id == null || item.id === '') continue;
            const id = String(item.id);
            if (vistos.has(id)) continue;
            const deRaiz = origens && typeof origens === 'object'
                && Object.hasOwn(origens, id) && origens[id] === ORIGEM_DE_RAIZ;
            if (!repassaveis.has(id) && !deRaiz) continue;
            vistos.add(id);
            const nome = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id;
            doTipo.push({ resourceType: tipo, resourceId: id, name: nome });
        }
        doTipo.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
        saida.push(...doTipo);
    }
    return saida;
}

/**
 * A chave de UM recurso na lista de escolha: tipo e id juntos, porque dois tipos podem ter o
 * mesmo id textual (um slug de camada de dados e um de modelo 3D não são vigiados um contra o
 * outro). O separador é um caractere que nenhum dos dois vocabulários usa.
 * @param {{resourceType: string, resourceId: string}} recurso
 * @returns {string}
 */
export function shareableKey(recurso) {
    return `${recurso?.resourceType ?? ''}|${recurso?.resourceId ?? ''}`;
}
