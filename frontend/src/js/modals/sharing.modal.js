// Path: js/modals/sharing.modal.js

/**
 * @fileoverview O modal de compartilhamento COM presença: a versão do MAPA.
 *
 * A TELA INTEIRA MORA EM `modals/sharing.modal.core.js`. Este arquivo é só o ponto de entrada do
 * mapa, e existe para uma coisa: ligar a fonte de presença viva
 * (`presence/sharing-presence.source.js`) por default, de modo que `showSharingModal(atlasId)`
 * continue significando exatamente o que significava antes da separação, "Vendo agora" incluso.
 * Os dois chamadores do mapa (`account/account.control.js` e `sidebar/tabs/maps.tab.js`) não
 * mudaram uma linha.
 *
 * A SEPARAÇÃO É O PRODUTO, não arrumação. `atlas.html` (o seletor de atlas) é a tela onde a
 * pessoa administra os próprios atlas, e era justamente a que não administrava ACESSO: o modal
 * só abria do mapa, com o atlas conectado, embora as quatro rotas de `/atlas/:atlasId/sharing`
 * aceitem qualquer atlas com permissão `manage` e o modal já receba `atlasId` como parâmetro. O
 * que impedia eram três imports de sessão viva de colaboração e o barril `@modals`, e
 * `getEventBus()` LANÇAVA fora do mapa. Quem quer a tela fora do mapa importa `openSharingModal`
 * de `modals/sharing.modal.core.js` e não passa `presence`.
 *
 * ESTE ARQUIVO É PESADO DE PROPÓSITO (ele alcança a store pelo caminho da presença) e não pode
 * ser importado por página sem mapa. O guarda é
 * `frontend/tests/unit/compartilhar-sem-a-store.test.js`.
 *
 * Exports {@link showSharingModal}, mais o reexport de tudo que o núcleo exporta.
 */

import { SharingModal } from './sharing.modal.core.js';
import { livePresenceSource } from '@js/presence/sharing-presence.source.js';

export * from './sharing.modal.core.js';

/**
 * Shows the atlas sharing modal com a presença viva do mapa ligada.
 *
 * ASSINATURA CONGELADA: mesmos parâmetros, mesmo retorno e mesmo comportamento visto de dentro do
 * mapa que antes da separação. `options.presence` existe só para que um chamador possa passar
 * outra fonte (ou `null`); ausente, ele resolve para a fonte viva, que é o default que preserva o
 * comportamento anterior.
 *
 * The caller is responsible for deciding whether to offer sharing; the backend independently
 * enforces `manage` (co-Gestor) on every mutation, never owner-only. Gate por hierarquia, nunca
 * por igualdade a `owner`.
 *
 * @param {string} atlasId - Atlas to manage sharing for.
 * @param {Object} [options]
 * @param {string} [options.atlasName] - Display name shown in the header title.
 * @param {Object|null} [options.presence] - Fonte de presença; ausente = a fonte viva do mapa.
 * @returns {SharingModal} The modal instance.
 */
export function showSharingModal(atlasId, options = {}) {
    const modal = new SharingModal(atlasId, {
        ...options,
        // Compara com `undefined`, e não com `??`: um chamador que passe `null` está dizendo "sem
        // presença", e isso tem de ser respeitado. O que resolve para a fonte viva é a AUSÊNCIA.
        presence: options.presence === undefined ? livePresenceSource : options.presence,
    });
    modal.render();
    modal.show();
    return modal;
}
