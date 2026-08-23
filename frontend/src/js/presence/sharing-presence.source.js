// Path: js/presence/sharing-presence.source.js

/**
 * @fileoverview A fonte de presença do modal de compartilhamento: a metade que exige sessão viva
 * de colaboração.
 *
 * POR QUE ELE É UM ARQUIVO SEPARADO. O modal de compartilhamento (`modals/sharing.modal.core.js`)
 * é REST mais DOM e precisa carregar em `atlas.html`, que boota sem `initServices()`. Os três
 * imports que impediam isso (`presence-store.js`, `store/sync/sync-engine.js` e
 * `store/services.js`) serviam UM bloco só, o "Vendo agora", e `getEventBus()` LANÇA
 * `Services not initialized` fora do mapa. Concentrá-los aqui é o que permite que a tela exista
 * nos dois lugares sem duas implementações.
 *
 * ESTE MÓDULO SÓ É IMPORTADO PELO MAPA, por `modals/sharing.modal.js`. Importá-lo de qualquer
 * arquivo alcançável por `projects/`, `admin/` ou `calibration/` desfaz a separação inteira, e
 * quem reprova é `frontend/tests/unit/compartilhar-sem-a-store.test.js`.
 *
 * `getEventBus()` é chamado DENTRO de {@link onChange}, nunca no load do módulo: quem assina é
 * quem já está no mapa, com os serviços de pé. Não há `try/catch` em volta dele de propósito;
 * um barramento ausente aqui é bug de ordem de boot e tem de estourar.
 *
 * Exports {@link livePresenceSource}, que implementa o typedef `SharingPresenceSource` declarado
 * em `modals/sharing.modal.core.js`.
 */

import { presenceStore } from '@js/presence/presence-store.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { sessionContext } from '@store/sync/session-context.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';

/**
 * A implementação viva do contrato de presença do modal de compartilhamento.
 *
 * Congelada porque ela é um singleton de leitura: não há estado próprio aqui, só as duas
 * perguntas encaminhadas a `presenceStore` e ao barramento.
 *
 * @type {{usersIn: (atlasId: string) => Array<Object>, onChange: (cb: () => void) => (() => void)}}
 */
export const livePresenceSource = Object.freeze({
    /**
     * Os OUTROS usuários conectados AO atlas pedido, já sem quem está `away`.
     *
     * A COMPARAÇÃO COM `syncEngine.atlasId` É O GATE, e não uma otimização: presença é POR ATLAS
     * CONECTADO, e o modal de compartilhamento pode ser aberto para um atlas que não é o
     * conectado (é o caso inteiro do seletor de atlas). Sem ela, a tela mostraria como "vendo
     * agora" gente que está em outro projeto.
     *
     * O EU SAI DA LISTA, por paridade com toda outra superfície de presença
     * (`online-users.control.js`).
     *
     * @param {string} atlasId - O atlas que o modal está administrando.
     * @returns {Array<Object>} Vazio quando o atlas conectado é outro (ou quando não há nenhum).
     */
    usersIn(atlasId) {
        if (syncEngine.atlasId !== atlasId) return [];
        const myId = String(sessionContext.userId ?? '');
        return presenceStore.getUsers()
            .filter((u) => !u.away && u.userId && String(u.userId) !== myId);
    },

    /**
     * Assina a mudança de COMPOSIÇÃO da presença e devolve o desfazer.
     *
     * `PRESENCE_CHANGED` é o evento de entrada/saída/`away`, não o de movimento de cursor, então
     * um re-render de corpo por evento é barato. O desfazer é o que `eventBus.on` já devolve;
     * quem o guarda e o chama é o modal, em `hide()`.
     *
     * @param {() => void} onChange - Chamado a cada mudança de composição.
     * @returns {() => void} O desfazer da assinatura.
     */
    onChange(onChange) {
        return getEventBus().on(EventTypes.PRESENCE_CHANGED, () => onChange());
    },
});
