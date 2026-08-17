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

/**
 * O escopo da última soma, para não repetir a chamada à toa.
 * `undefined` = nunca somou; `null` = somou sem atlas em foco.
 * @type {string|null|undefined}
 */
let _escopo;

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
    _escopo = undefined;
}

/** O escopo da última soma bem-sucedida. Só para teste e diagnóstico. @returns {string|null|undefined} */
export function _grantedScope() {
    return _escopo;
}
