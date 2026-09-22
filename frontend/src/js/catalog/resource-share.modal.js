// Path: js/catalog/resource-share.modal.js

/**
 * @fileoverview O modal de compartilhar recurso privado COM o efeito do mapa: a versão do MAPA.
 *
 * A TELA INTEIRA MORA EM `catalog/resource-share.modal.core.js` desde 2026-09-22 (decisão do
 * dono, item 19b), no molde de `modals/sharing.modal.js`. Este arquivo é só o ponto de entrada
 * do mapa, e existe para uma coisa: depois de uma REVOGAÇÃO, re-somar o catálogo privado de quem
 * revogou no escopo do atlas em foco, porque quem revoga pode ter derrubado a si mesmo de um
 * caminho, e o catálogo dele precisa refletir isso sem um F5. Os dois chamadores do mapa (o
 * cartão do catálogo, por `catalog/catalog.modal.js`, e o seletor de mapa base) não mudaram uma
 * linha.
 *
 * QUEM RECEBE a revogação tem DOIS alcances, e eles não se confundem. Quem está numa sala de
 * atlas que EMPRESTA o recurso é avisado ao vivo (o servidor emite `atlas_resources_updated` para
 * essas salas) e re-soma na hora. O beneficiário pessoal ou de grupo fora de um atlas que empresta
 * continua sem push: ele percebe no próximo pedido do payload aditivo (troca de atlas ou F5).
 *
 * ESTE ARQUIVO É PESADO DE PROPÓSITO (o motor de sync alcança a store) e não pode ser importado
 * por página sem mapa: quem abre o modal fora do mapa importa `openResourceShareModal` do núcleo.
 * O guarda é `frontend/tests/unit/compartilhar-sem-a-store.test.js`.
 *
 * Exporta {@link showResourceShareModal}, mais o reexport de tudo que o núcleo exporta.
 */

import { ResourceShareModal } from './resource-share.modal.core.js';
import { refreshVisibleResources } from '@store/sync/resource-access.service.js';
import { syncEngine } from '@store/sync/sync-engine.js';

export * from './resource-share.modal.core.js';

/**
 * Re-soma o payload aditivo de quem acabou de revogar, no atlas em foco. Só a revogação pede.
 * @param {{kind: string}} change
 * @returns {Promise<void>}
 */
async function refreshAfterRevoke({ kind }) {
    if (kind !== 'revoke') return;
    try {
        await refreshVisibleResources(syncEngine.atlasId ?? null);
    } catch {
        // Best-effort: o pior caso é o catálogo mostrar o recurso até o próximo pedido.
    }
}

/**
 * Abre o modal de compartilhamento de um recurso privado, com o efeito do mapa ligado.
 *
 * ASSINATURA CONGELADA: mesmos parâmetros e mesmo comportamento visto de dentro do mapa que antes
 * da separação. O chamador decide se OFERECE a ação (o cartão do catálogo consulta
 * `canShareResource`); o servidor reimpõe o gate em toda escrita.
 *
 * @param {{resourceType: string, resourceId: string, resourceName?: string}} params
 * @returns {ResourceShareModal}
 */
export function showResourceShareModal(params) {
    const modal = new ResourceShareModal({ ...params, onAccessChanged: refreshAfterRevoke });
    modal.render();
    modal.show();
    return modal;
}
