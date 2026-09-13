// Path: js/account/sync-status.control.js
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { connectionState, ConnectionStates } from '@store/sync/connection-state.js';
import { sessionContext } from '@store/sync/session-context.js';
import { lerPendenciasDoEscopoAtivo } from '@js/session/pendencias-monitoramento.js';
import { storeWritesPaused } from '@store/write-coordinator.js';
import { getActiveScope } from '@store/atlas-namespace.js';
import { isRemoteStoreSync } from '@store/store-origin.js';
import {
    isResourceAccessDegraded,
    onResourceAccessHealthChanged,
    retryVisibleResources
} from '@store/sync/resource-access.service.js';
import { resourceAccessNotice } from '@store/sync/resource-access-phrases.js';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    trackTimer,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { describeSyncWork } from './sync-phrases.js';

/**
 * O atributo de TRANSPORTE, que continua sendo o vocabulário de conexão.
 *
 * Cerca de vinte specs de Playwright esperam por `data-state="online"` neste elemento para
 * saber que a sessão conectou, e a camada de UI roda FORA do `npm test`. Renomear este
 * atributo para o vocabulário de TRABALHO teria deixado toda aquela camada vermelha semanas
 * depois, quando o vermelho já parece regressão em vez de envelhecimento. O estado do
 * trabalho entra por `data-work`, somando; este mapeamento não mudou de significado.
 * @param {string} state - One of ConnectionStates.
 * @returns {{ dataState: string }}
 */
function describeState(state) {
    switch (state) {
        case ConnectionStates.ONLINE:
            return { dataState: 'online' };
        case ConnectionStates.CONNECTING:
        case ConnectionStates.RECONNECTING:
            return { dataState: 'connecting' };
        case ConnectionStates.OFFLINE:
        default:
            return { dataState: 'offline' };
    }
}

/**
 * Eventos do barramento que PODEM significar fila diferente, e por isso agendam uma leitura.
 *
 * A lista é curta de propósito, e o que ela NÃO alcança é a razão de existir uma batida
 * periódica junto: o caminho de edição LOCAL não emite evento nenhum ao enfileirar. As
 * famílias FEATURE_*, LAYER_* e GROUP_* têm um único emissor em `src/`, que é
 * `remote-operation-handler.js`, ou seja, anunciam a operação de um PAR sendo aplicada aqui;
 * o desenho do próprio usuário escreve o store e chama `logXxxOperation` direto. Assinar
 * eventos e parar aí produziria um indicador cego justamente para o trabalho de quem está
 * olhando para ele.
 */
const QUEUE_SIGNAL_EVENTS = [
    EventTypes.REMOTE_OPERATION_APPLIED,
    EventTypes.MAP_CREATED,
    EventTypes.MAP_MODIFIED,
    EventTypes.BRIEFING_CREATED,
    EventTypes.BRIEFING_UPDATED,
    EventTypes.BRIEFING_DELETED,
];

/**
 * Janela de coalescência: N sinais dentro dela viram UMA leitura da fila.
 *
 * Um gesto do usuário vira várias operações, e cada evento chegaria como um pedido de
 * leitura próprio. 250 ms é curto o bastante para o número aparecer como resposta ao gesto
 * e longo o bastante para uma rajada de operações custar uma leitura só.
 */
const COALESCE_MS = 250;

/**
 * Batida periódica, e a cadência é medida contra o laço que já existe.
 *
 * `sync-flush.js` roda a cada 1500 ms e chama `operationQueue.count()` quando está ONLINE,
 * então essa é a leitura autoritativa e ela já paga o custo. Um mostrador batendo no dobro
 * do intervalo fica no máximo um ciclo de flush atrás do número real e acrescenta metade do
 * tráfego de IndexedDB daquele laço, em vez do dobro. Ela não roda com a aba escondida nem
 * em atlas local, que são os dois casos em que a leitura não teria leitor.
 */
const HEARTBEAT_MS = 3000;

/**
 * A luz de sync da barra do mapa, que responde "o meu trabalho está salvo?" e não "o socket
 * está de pé?".
 *
 * ELA MEDE SETE SINAIS, não um: a origem do store (`isRemoteStoreSync`), o estado da conexão,
 * os TRÊS números do censo da fila, o registro global de quarentena, as pendências de upload
 * de figura e a recuperação em curso (`storeWritesPaused`). Os quatro últimos entraram em
 * 2026-09-13 (achado F14): a fila vazia com conexão de pé produzia verde incondicional, e cada
 * um deles é um jeito de isso ser falso. A regra de quem decide o que mostrar continua em
 * `sync-phrases.js`, e as CINCO contagens vêm de `lerPendenciasDoEscopoAtivo`
 * (`@js/session/pendencias-monitoramento.js`), o mesmo leitor que alimenta o pulso de presença
 * do painel do administrador: duas contas para o mesmo trabalho é como o número do
 * administrador e o do usuário divergem sem que nada acuse. As duas primeiras sozinhas mentem nos
 * dois sentidos, e as duas mentiras já estavam no produto: verde com fila cheia dizia
 * "salvo" antes de o logout descartar o trabalho, e vermelho permanente em atlas local
 * (onde não há socket a conectar, nem nunca haverá) dizia "avaria" no caminho normal do
 * produto. A segunda é a mais cara das duas, porque ensina a ignorar o vermelho.
 *
 * O ATLAS LOCAL APARECE, E APARECE CALMO. A alternativa era esconder o controle ali, e ela
 * foi recusada: para quem ENTROU na conta, a ausência de qualquer sinal é indistinguível de
 * uma barra quebrada, e a leitura natural de silêncio é "está sincronizando". O crachá de
 * nome do atlas (`AtlasNameControl`) também se esconde no store local, então esconder esta
 * luz deixaria a barra sem dizer coisa alguma sobre onde o trabalho está. O que aparece é
 * um átomo neutro, "Local", com a frase inteira no `title`: nada de errado, e nada a
 * enviar. Anônimo continua sem luz nenhuma, porque nunca houve relação com servidor a
 * relatar e um crachá permanente ali seria ruído.
 *
 * O RÓTULO É VISÍVEL. Ele morava só no `title`, que não existe no toque e exige parar o
 * ponteiro em cima; agora o `title` é reforço da frase longa, e o rótulo curto (duas
 * palavras) fica no elemento, com largura máxima e reticências para não empurrar o resto da
 * barra.
 *
 * ELE CARREGA UM SEGUNDO ASSUNTO DESDE 2026-08-24, e o motivo de ser aqui é o mesmo que faz
 * a luz existir: o AVISO de que o acervo privado desta conta não carregou. A soma dos
 * recursos privados é best-effort e engolia o próprio erro, então uma conta `credenciado`
 * que perdesse a primeira soma via um catálogo idêntico ao de um visitante anônimo, com o
 * papel intacto e sem uma linha na tela. O aviso é não modal, não bloqueante, some sozinho
 * quando o reparo dá certo, e nunca aparece para quem não entrou. A frase mora em
 * `@store/sync/resource-access-phrases.js`; o sinal, em `resource-access.service.js`.
 *
 * MapLibre IControl. Bound to CONNECTION_STATE_CHANGED + SESSION_CHANGED + os sinais de
 * fila, mais a batida periódica, `visibilitychange` e o sinal de saúde do acervo privado.
 */
export class SyncStatusControl {
    constructor() {
        /** @type {import('maplibre-gl').Map|null} */
        this._map = null;
        /** @type {HTMLDivElement|null} */
        this._container = null;
        /** @type {HTMLSpanElement|null} The colored dot itself. */
        this._dot = null;
        /** @type {HTMLSpanElement|null} The visible short label. */
        this._label = null;
        /** @type {HTMLButtonElement|null} The private-collection notice, with its retry. */
        this._notice = null;

        /** @type {boolean} Whether a repair of the private-resource sum is in flight. */
        this._repairing = false;
        /** @type {(function(): void)|null} Unsubscribes from the resource-access health signal. */
        this._unsubscribeHealth = null;

        /**
         * Last known queue size. `undefined` = never read; `null` = the read failed. The
         * three-way value is the whole point: see `sync-phrases.js`.
         * @type {number|null|undefined}
         */
        this._pending = undefined;

        /**
         * The pendencies that are NOT a number of envelopes waiting their turn, and each one is a
         * way "queue empty and connected" used to be a lie (F14). `null` is a failed read and never
         * zero, by the same rule as {@link _pending}.
         * @type {number|null}
         */
        this._problemas = 0;
        /** @type {number|null} Operations in the global quarantine, awaiting an explicit decision. */
        this._quarentena = 0;
        /** @type {number|null} Open image-upload pendencies, pending and definitively refused. */
        this._uploads = 0;
        /** @type {number|null} How many of those the server refused for good. Subset of the above. */
        this._uploadsRecusados = 0;

        /** @type {ReturnType<typeof setTimeout>|null} Coalescing timer. */
        this._coalesceTimer = null;
        /** @type {boolean} Whether a queue read is in flight. */
        this._reading = false;
        /** @type {boolean} Whether a signal arrived while a read was in flight. */
        this._readAgain = false;

        // Initialize cleanup tracking.
        setupCleanup(this);
    }

    /**
     * @param {import('maplibre-gl').Map} map
     * @returns {HTMLDivElement}
     */
    onAdd(map) {
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group sync-status-badge';
        this._container.setAttribute('data-testid', 'sync-status-badge');

        // O CRACHÁ É O CAMINHO ATÉ AS PENDÊNCIAS, e ele é o único: a luz já nomeia o que ficou
        // para trás ("Revisão: 3", "Recusa: 1") e apontava para uma tela que não existia. Ele vira
        // comando com `role="button"` mais teclado, e não um `<button>` de verdade, porque o
        // elemento é o container do IControl do MapLibre e já carrega o aviso do acervo privado,
        // que É um botão: botão dentro de botão não é HTML válido e o clique do de dentro
        // borbulharia para o de fora, abrindo o painel a cada tentativa de reparo.
        this._container.setAttribute('role', 'button');
        this._container.setAttribute('tabindex', '0');
        this._container.setAttribute('aria-haspopup', 'dialog');
        this._container.setAttribute('data-abre-pendencias', 'true');
        addDomListener(this, this._container, 'click', () => this._abrirPendencias());
        addDomListener(this, this._container, 'keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this._abrirPendencias();
        });

        this._dot = document.createElement('span');
        this._dot.className = 'sync-status-badge__dot';
        this._dot.setAttribute('aria-hidden', 'true');
        this._container.appendChild(this._dot);

        this._label = document.createElement('span');
        this._label.className = 'sync-status-badge__label';
        this._label.setAttribute('data-testid', 'sync-status-label');
        this._container.appendChild(this._label);

        // O AVISO DO ACERVO PRIVADO MORA AQUI, e não numa superfície própria, porque este é
        // o eixo em que a pessoa já procura estado de sessão, e porque este controle já se
        // esconde inteiro para o visitante anônimo, que é exatamente quem não pode ver o
        // aviso (ele não perdeu nada). É um BOTÃO e não um átomo passivo: o gesto de reparo
        // é a metade que faltava, e um aviso sem saída ensina a ignorar avisos.
        this._notice = document.createElement('button');
        this._notice.type = 'button';
        this._notice.className = 'resource-access-notice';
        this._notice.setAttribute('data-testid', 'resource-access-notice');
        this._notice.hidden = true;
        this._container.appendChild(this._notice);
        addDomListener(this, this._notice, 'click', (event) => {
            // O container inteiro abre o painel de pendências; este botão é outro assunto.
            event.stopPropagation();
            this._repairResourceAccess();
        });

        // Seed from what is known synchronously, so the light is never blank.
        this._render();

        const eventBus = getEventBus();
        subscribe(this, eventBus, EventTypes.CONNECTION_STATE_CHANGED, () => this._onSignal());
        // Show only when authenticated; hide on logout / anonymous.
        subscribe(this, eventBus, EventTypes.SESSION_CHANGED, () => this._onSignal());
        for (const type of QUEUE_SIGNAL_EVENTS) {
            subscribe(this, eventBus, type, () => this._scheduleQueueRead());
        }

        // A hidden tab has no reader: catch up when it comes back instead of polling behind.
        if (typeof document !== 'undefined' && document.addEventListener) {
            addDomListener(this, document, 'visibilitychange', () => {
                if (!document.hidden) this._scheduleQueueRead();
            });
        }

        trackTimer(
            this,
            setInterval(() => {
                if (typeof document !== 'undefined' && document.hidden) return;
                this._scheduleQueueRead();
            }, HEARTBEAT_MS),
            'interval'
        );

        // O SINAL DE SAÚDE VEM POR OBSERVADOR PRÓPRIO, e não pelo barramento nem pela batida
        // periódica. Pela batida seria tarde e, pior, CEGO em atlas local: `_readQueue`
        // devolve antes de repintar ali, então a única pessoa que veria o aviso seria a que
        // está num atlas de servidor. `onResourceAccessHealthChanged` avisa só na virada.
        this._unsubscribeHealth = onResourceAccessHealthChanged(() => {
            this._render();
        });

        this._scheduleQueueRead();

        return this._container;
    }

    /**
     * Redoes the private-resource sum after it failed, from the person's own gesture.
     *
     * `force: true` is load-bearing: without it `retryVisibleResources` short-circuits on
     * "some sum succeeded at some point", which is true right after a LATER sum failed (an
     * atlas switch is the common case). That is the exact state this button exists for, so
     * the plain call would make it a button that does nothing.
     * @private
     */
    async _repairResourceAccess() {
        if (this._repairing) return;
        this._repairing = true;
        this._render();
        try {
            await retryVisibleResources({ force: true });
        } catch (error) {
            // The service swallows its own failure; this only guards a broken import chain.
            console.warn('Sync status: could not redo the private-resource sum:', error);
        } finally {
            this._repairing = false;
            // Success flips the health signal and repaints through the subscription; this
            // repaint is what clears the "Recuperando…" state when it did NOT succeed.
            if (this._container) this._render();
        }
    }

    /**
     * Opens the pendency panel, which is where this light points.
     *
     * The badge is hidden for an anonymous visitor, so this cannot be reached without a session;
     * the guard is here anyway because a keyboard handler on a hidden element is still reachable
     * in some browsers, and opening a panel that reads a queue nobody owns would only confuse.
     *
     * THE PANEL IS LOADED ON THE CLICK, not imported at the top, and the reason is module graph
     * rather than payload: the panel reaches the permission guard, the confirm modal and the
     * toast service, and a static import would drag all three into every module that merely
     * mounts this light (which is what turned an unrelated unit test of this control red). It
     * also happens to be the right shape: nobody who never clicks pays for the panel.
     * @private
     */
    async _abrirPendencias() {
        if (!sessionContext.isAuthenticated()) return;
        try {
            const { abrirPainelDePendencias } = await import('./pendencias/pendencias-panel.js');
            abrirPainelDePendencias();
        } catch (error) {
            console.warn('Sync status: could not open the pendency panel:', error);
        }
    }

    /**
     * A connection or session change: repaint at once with the count already known (the
     * transport half of the answer is news by itself) and re-read the queue behind it.
     * @private
     */
    _onSignal() {
        this._render();
        this._scheduleQueueRead();
    }

    /**
     * Coalesces every reason to re-read into a single read per {@link COALESCE_MS} window.
     *
     * This one is NOT handed to `trackTimer`: that list only grows (`cleanup` empties it at
     * the end), and a timer that re-arms every few seconds for the whole session would push
     * thousands of dead ids into it. A single live id is kept on the instance and cleared by
     * hand in {@link onRemove}, which is the pairing the convention asks for.
     * @private
     */
    _scheduleQueueRead() {
        if (!this._container) return;
        if (this._coalesceTimer !== null) return;
        this._coalesceTimer = setTimeout(() => {
            this._coalesceTimer = null;
            this._readQueue();
        }, COALESCE_MS);
    }

    /**
     * Reads the outbound queue of the ACTIVE scope and repaints.
     *
     * Skipped entirely for a local atlas and for an anonymous visitor: there is no server
     * destination, so the count answers no question anybody is asking and would be pure
     * IndexedDB traffic. A failed read becomes `null`, never `0`: assuming the good case is
     * exactly how a green light comes to lie.
     * @private
     */
    async _readQueue() {
        if (!this._container) return;
        if (!sessionContext.isAuthenticated() || !isRemoteStoreSync()) return;
        if (this._reading) {
            this._readAgain = true;
            return;
        }

        this._reading = true;
        try {
            // THE READER IS SHARED WITH THE PRESENCE PULSE, on purpose (F23). The census of the
            // queue, the global quarantine and the image-upload pendencies are ONE question, and
            // this control used to answer it with its own arithmetic while the pulse that feeds
            // the administrator's panel answered it with another. Two counts of the same work,
            // each right by its own rule, is a disagreement nobody can see.
            const medido = await lerPendenciasDoEscopoAtivo();
            if (medido === null) return;
            this._pending = medido.pendentes + medido.preparadas;
            this._problemas = medido.problemas;
            this._quarentena = medido.quarentena;
            this._uploads = medido.uploads;
            this._uploadsRecusados = medido.uploadsRecusados;
        } catch (error) {
            // ALL OF THEM GO UNKNOWN TOGETHER, not just the one that threw: the reader gathers in
            // one `Promise.all`, so a failure leaves the others unmeasured, and a stale number next
            // to an unknown one would be a census nobody took. `null` is what keeps the light off
            // the green branch.
            console.warn('Sync status: could not read the outbound pendencies:', error);
            this._pending = null;
            this._problemas = null;
            this._quarentena = null;
            this._uploads = null;
            this._uploadsRecusados = null;
        } finally {
            this._reading = false;
        }

        // The control may have been removed while the read was in flight.
        if (!this._container) return;
        this._render();

        if (this._readAgain) {
            this._readAgain = false;
            this._scheduleQueueRead();
        }
    }

    /**
     * Paints the whole answer: transport attribute (frozen contract), work state, tone,
     * visible label and the long sentence as reinforcement in `title`.
     * @private
     */
    _render() {
        if (!this._container) return;

        this._container.hidden = !sessionContext.isAuthenticated();

        const connection = connectionState.getState();
        this._container.setAttribute('data-state', describeState(connection).dataState);

        const work = describeSyncWork({
            remote: isRemoteStoreSync(),
            connection,
            pending: this._pending,
            problemas: this._problemas,
            quarentena: this._quarentena,
            uploads: this._uploads,
            uploadsRecusados: this._uploadsRecusados,
            // READ AT PAINT TIME, NOT CACHED BY THE QUEUE READ, because it is synchronous and
            // because it is the one signal that MUST be current: a recovery starts and ends between
            // two heartbeats, and a stale `false` here is the green light over a rebuild in
            // progress, which is the exact defect. The scope has to be the same OBJECT the pauser
            // used, which is why it comes from `getActiveScope()`.
            recuperando: storeWritesPaused(getActiveScope()),
        });
        this._container.setAttribute('data-work', work.state);
        this._container.setAttribute('data-tone', work.tone);
        this._container.setAttribute('title', work.detail);
        this._container.setAttribute('aria-label', work.detail);
        if (this._label) this._label.textContent = work.label;

        this._renderResourceNotice();
    }

    /**
     * Paints the private-collection notice, or hides it.
     *
     * `textContent`, never `innerHTML`: the sentence is a literal from a leaf module, but the
     * node next to it carries the atlas name in this same bar and the habit is the guard.
     * `aria-busy` rather than the `disabled` property while repairing, because a disabled
     * button fires no click and the click is how the reason reaches the person; the re-entry
     * guard lives in {@link _repairResourceAccess}.
     * @private
     */
    _renderResourceNotice() {
        if (!this._notice) return;
        const notice = resourceAccessNotice({
            authenticated: sessionContext.isAuthenticated(),
            degraded: isResourceAccessDegraded(),
            repairing: this._repairing,
        });

        this._notice.hidden = notice === null;
        if (!notice) return;

        this._notice.textContent = notice.label;
        this._notice.setAttribute('data-tone', notice.tone);
        this._notice.setAttribute('title', notice.detail);
        this._notice.setAttribute('aria-label', notice.detail);
        this._notice.setAttribute('aria-busy', notice.actionLabel === null ? 'true' : 'false');
    }

    onRemove() {
        if (this._coalesceTimer !== null) {
            clearTimeout(this._coalesceTimer);
            this._coalesceTimer = null;
        }
        if (this._unsubscribeHealth) {
            this._unsubscribeHealth();
            this._unsubscribeHealth = null;
        }
        // Removes EventBus subscriptions, DOM listeners and the heartbeat interval.
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._dot = null;
        this._label = null;
        this._notice = null;
        this._map = undefined;
    }
}
