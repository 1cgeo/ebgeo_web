// Path: js/store/sync/resource-access.service.js

/**
 * @fileoverview A soma dos recursos PRIVADOS concedidos, no cliente.
 *
 * `GET /api/config` é o documento PÚBLICO e não varia por chamador — é o que
 * permite memoizá-lo como UM só no servidor, e a razão de o boot poder ser
 * fail-fast nele. O que este usuário ganha por papel global, por concessão pessoal
 * ou por empréstimo do atlas chega por um SEGUNDO endpoint, autenticado, e é
 * somado aqui, no singleton `config`, sem que aquele documento mude de forma.
 *
 * ESTE ARQUIVO NÃO SABE INTERSECTAR. A ordem é D1 — somar primeiro, intersectar
 * depois — e quem intersecta é `atlas-settings.service.js`, que é também onde a
 * soma entra no `_baseline` (senão `revertAtlasSettings` apagaria os concedidos).
 * A função que faz isso é `mergeGrantedIntoBaseline`, e é de propósito que ela
 * more lá e não aqui: mexer no `config` por fora do dono do baseline é exatamente
 * o defeito que a armadilha descreve.
 *
 * BEST-EFFORT POR DESENHO. Uma falha aqui não pode derrubar o login nem a abertura
 * do atlas: o pior caso é o usuário ver só o catálogo público, que é o estado de
 * antes desta fase. Fechar por padrão é a direção certa quando a checagem falha.
 */

import { apiClient } from './api-client.js';
import { mergeGrantedIntoBaseline, revertGrantedResources } from './atlas-settings.service.js';
import { sessionContext } from './session-context.js';

/**
 * O escopo da última soma, para não repetir a chamada à toa.
 * `undefined` = nunca somou; `null` = somou sem atlas em foco.
 * @type {string|null|undefined}
 */
let _escopo;

/** Os quatro grupos do payload aditivo, na ordem em que o servidor os nomeia. */
const GRUPOS = Object.freeze(['tilesets', 'dataLayers', 'analysisLayers', 'views360']);

/** @returns {Object<string, Set<string>>} Um mapa de conjuntos vazios, um por grupo. */
function conjuntosVazios() {
    return Object.fromEntries(GRUPOS.map((g) => [g, new Set()]));
}

/**
 * Os ids PRIVADOS que o servidor entregou na última soma, por grupo.
 *
 * É a única resposta que o cliente tem para "este item do catálogo é privado?", e
 * ela é EXATA por construção: o payload aditivo devolve só o privado, então um id
 * que veio por ele é privado, e um que não veio é público (ou invisível, que dá no
 * mesmo para quem desenha o cartão). Não há campo `access_level` nos itens de
 * `config`, e não deveria haver: aquele documento é o público.
 * @type {Object<string, Set<string>>}
 */
let _privados = conjuntosVazios();

/**
 * Os ids que este usuário pode REPASSAR (concessão viva de `view_share`), por grupo.
 * Papel global fica de FORA daqui de propósito — quem é administrador ou curador
 * concede de raiz, e quem sabe disso é `sessionContext`.
 * @type {Object<string, Set<string>>}
 */
let _repassaveis = conjuntosVazios();

/** @private Reconstrói os dois índices a partir do payload que acabou de chegar. */
function indexarPayload(payload) {
    _privados = conjuntosVazios();
    _repassaveis = conjuntosVazios();
    for (const grupo of GRUPOS) {
        for (const item of (Array.isArray(payload?.[grupo]) ? payload[grupo] : [])) {
            if (item?.id != null) _privados[grupo].add(String(item.id));
        }
        for (const id of (Array.isArray(payload?.shareable?.[grupo]) ? payload.shareable[grupo] : [])) {
            _repassaveis[grupo].add(String(id));
        }
    }
}

/**
 * Busca os recursos privados visíveis e os SOMA ao baseline do `config`.
 *
 * Chamar com um `atlasId` diferente RE-SOMA do zero (a soma anterior é desfeita
 * pela própria `mergeGrantedIntoBaseline`), porque sair de um atlas que empresta
 * e entrar noutro que não empresta precisa tirar o que o primeiro deu.
 *
 * @param {string|null} [atlasId] - O atlas em foco, ou null.
 * @returns {Promise<boolean>} true se a soma aconteceu.
 */
export async function refreshVisibleResources(atlasId = null) {
    const escopo = atlasId ?? null;
    try {
        const payload = await apiClient.getVisibleResources(escopo);
        mergeGrantedIntoBaseline(payload);
        indexarPayload(payload);
        _escopo = escopo;
        return true;
    } catch {
        // Sem alcance ao servidor, ou sem sessão: fica só o público. Não propaga —
        // o chamador é o caminho de login e de abertura de atlas.
        return false;
    }
}

/**
 * Desfaz a soma (logout, desconexão, volta ao store local).
 * @returns {void}
 */
export function clearVisibleResources() {
    revertGrantedResources();
    indexarPayload(null);
    _escopo = undefined;
}

/**
 * Se este item do catálogo é um recurso PRIVADO que o servidor entregou a este
 * usuário (por papel global, por concessão pessoal ou por empréstimo do atlas).
 *
 * @param {string} grupo - Um de `tilesets`, `dataLayers`, `analysisLayers`, `views360`.
 * @param {string} id - O id CRU do recurso (o do catálogo, não o prefixado do cartão).
 * @returns {boolean}
 */
export function isPrivateResource(grupo, id) {
    if (!grupo || id == null) return false;
    return _privados[grupo]?.has(String(id)) === true;
}

/**
 * Se este usuário pode CONCEDER acesso a este recurso.
 *
 * DUAS ORIGENS, e a soma delas é a regra inteira: papel global (administrador ou
 * curador concedem de raiz, sem concessão nenhuma) OU uma concessão viva de
 * `view_share`. Quem só tem `view` recebe `false`, e é o que tira a ação
 * "Compartilhar" do cartão em vez de oferecê-la para o servidor recusar.
 *
 * ISTO É SÓ PARA A INTERFACE DECIDIR O QUE MOSTRAR. Quem decide o que ENTREGAR é
 * o servidor: `requireResourceShare` protege a rota e `grantResource` reafirma a
 * regra no serviço. Um erro aqui esconde um botão; nunca abre nada.
 *
 * @param {string} grupo
 * @param {string} id
 * @returns {boolean}
 */
export function canShareResource(grupo, id) {
    if (!grupo || id == null) return false;
    if (sessionContext.hasGlobalDataAccess()) return true;
    return _repassaveis[grupo]?.has(String(id)) === true;
}

/** O escopo da última soma bem-sucedida. Só para teste e diagnóstico. @returns {string|null|undefined} */
export function _grantedScope() {
    return _escopo;
}
