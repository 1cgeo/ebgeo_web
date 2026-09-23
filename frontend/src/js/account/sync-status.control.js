// Path: js/account/sync-status.control.js
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { connectionState, ConnectionStates } from '@store/sync/connection-state.js';
import { sessionContext } from '@store/sync/session-context.js';
import { aCaminhoDoCenso, lerPendenciasDoEscopoAtivo } from '@js/session/pendencias-monitoramento.js';
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
// Direct file, never the `@utils` barrel: the barrel drags the whole store back in through
// `feature_navigation_utils`, and this control is mounted inside the map bar.
import { showError } from '@utils/toast_service.js';
import { describeSyncWork, SYNC_TONE, SYNC_WORK_STATE } from './sync-phrases.js';

/**
 * O que a pessoa lê quando o clique em "Pendências" não consegue trazer o painel.
 *
 * SÃO DUAS FRASES E NÃO UMA porque o desfecho é outro em cada caso: sem conexão a carga NEM É
 * TENTADA, então o módulo chega sozinho quando a conexão voltar; com conexão de pé o que falhou foi
 * a carga em si, e aí a única providência que funciona é recarregar a página. Uma frase só teria
 * de mentir num dos dois. Elas moram aqui, e não no módulo de frases do painel, porque o painel é
 * justamente o que não carregou.
 *
 * "TENTE DE NOVO" ERA FALSO, e foi medido em 2026-09-20 no Chromium e no Firefox: um `import()`
 * cuja busca falha fica gravado como FALHO no mapa de módulos da página, e a tentativa seguinte do
 * mesmo módulo é recusada sem tocar a rede, nos três modos (pedido abortado, 404, rede desligada e
 * religada). Esquecer a promessa no `catch`, que este arquivo já fazia, não basta: quem lembra é o
 * navegador. Daí a frase nova e, mais importante, daí `_carregarPainel` NÃO TENTAR sem conexão,
 * que é o que mantém verdadeira a promessa da frase de cima.
 */
const PAINEL_SEM_REDE = 'Sem conexão para carregar o painel de pendências. Ele será carregado '
    + 'sozinho quando a rede voltar, e o seu trabalho continua guardado neste computador.';

/**
 * A carga foi TENTADA e a rede caiu no meio. O módulo já está envenenado, então a saída é
 * recarregar, mas NÃO AGORA: no mapa, recarregar sem rede troca esta tela pela de "EBGeo
 * indisponível", que é pior que ficar sem o painel.
 */
const PAINEL_CAIU_NO_MEIO = 'A conexão caiu enquanto o painel de pendências carregava. O seu '
    + 'trabalho continua guardado neste computador: quando a rede voltar, atualize a página para '
    + 'abrir o painel.';

/** O outro desfecho: a carga foi TENTADA e falhou, e nesta página ela não volta a dar certo. */
const PAINEL_NAO_CARREGOU = 'Não foi possível carregar o painel de pendências. O seu trabalho '
    + 'continua guardado neste computador: atualize a página para abrir o painel.';

/**
 * Whether fetching the panel module now would be a fetch that cannot succeed.
 *
 * `navigator.onLine === false` is the reliable half of that flag (the `true` half promises
 * nothing). The sync connection counts ONLY when it is explicitly OFFLINE, never "anything but
 * ONLINE": that machine is the collaboration socket, and CONNECTING (the whole of a boot, which
 * is exactly when the queue holds the previous session's work) and RECONNECTING both happen with
 * the network up and the server reachable. Refusing there skipped a load that would have
 * succeeded and told a connected person "Sem conexão". Found by review, 2026-09-20.
 * @returns {boolean}
 */
function semConexaoParaCarregar() {
    if (globalThis.navigator?.onLine === false) return true;
    return connectionState.getState() === ConnectionStates.OFFLINE;
}

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
        /**
         * The clickable half of the badge: dot plus label, and the element that carries every
         * painted attribute. It is NOT the container; {@link onAdd} says why.
         * @type {HTMLDivElement|null}
         */
        this._command = null;
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

        /**
         * The panel module, once it started loading. The promise is the cache: a second reason to
         * preload while the first is still in flight must not start a second download.
         * @type {Promise<{abrirPainelDePendencias: function(): void}>|null}
         */
        this._painelModulo = null;
        /**
         * Whether the last automatic preload failed. It stops the 3 s heartbeat from retrying a
         * download that cannot succeed (both preload triggers are read at paint time, and the
         * paint repeats), and it is cleared when the connection comes back, which is the only news
         * that changes the answer.
         * @type {boolean}
         */
        this._painelIndisponivel = false;

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
        this._container.setAttribute('data-testid', 'sync-status-cluster');

        // O CRACHÁ É O CAMINHO ATÉ AS PENDÊNCIAS, e ele é o único: a luz já nomeia o que ficou
        // para trás ("Revisão: 3", "Recusa: 1") e apontava para uma tela que não existia. Ele vira
        // comando com `role="button"` mais teclado, e não um `<button>` de verdade, porque o
        // aviso do acervo privado, ao lado dele, É um botão, e botão dentro de botão não é HTML
        // válido.
        //
        // O COMANDO É UM ELEMENTO PRÓPRIO, E NÃO O CONTAINER, e essa é a correção de P6: enquanto
        // o container inteiro foi o comando, o aviso do acervo privado era FILHO da área clicável,
        // e ele nasce justamente sem rede, que é quando a soma de recursos privados falha. O aviso
        // é o átomo mais largo da tira (200 px de frase contra um rótulo de duas palavras), então
        // o CENTRO geométrico do crachá cai dentro dele: o clique dirigido ao crachá acionava o
        // reparo e o painel não abria. `stopPropagation` no filho não resolve isso, porque o
        // problema não é borbulhamento, é ALVO. Agora são dois irmãos com caixas próprias, e o
        // container só os alinha. O `data-testid` do crachá acompanha o comando, porque é ele que
        // se clica e é nele que as ~20 esperas por `data-state="online"` da camada de Playwright
        // precisam continuar caindo.
        this._command = document.createElement('div');
        this._command.className = 'sync-status-badge__command';
        this._command.setAttribute('data-testid', 'sync-status-badge');
        this._command.setAttribute('role', 'button');
        this._command.setAttribute('tabindex', '0');
        this._command.setAttribute('aria-haspopup', 'dialog');
        this._command.setAttribute('data-abre-pendencias', 'true');
        this._container.appendChild(this._command);
        addDomListener(this, this._command, 'click', () => this._abrirPendencias());
        addDomListener(this, this._command, 'keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this._abrirPendencias();
        });

        this._dot = document.createElement('span');
        this._dot.className = 'sync-status-badge__dot';
        this._dot.setAttribute('aria-hidden', 'true');
        this._command.appendChild(this._dot);

        this._label = document.createElement('span');
        this._label.className = 'sync-status-badge__label';
        this._label.setAttribute('data-testid', 'sync-status-label');
        this._command.appendChild(this._label);

        // O AVISO DO ACERVO PRIVADO MORA AQUI, e não numa superfície própria, porque este é
        // o eixo em que a pessoa já procura estado de sessão, e porque este controle já se
        // esconde inteiro para o visitante anônimo, que é exatamente quem não pode ver o
        // aviso (ele não perdeu nada). É um BOTÃO e não um átomo passivo: o gesto de reparo
        // é a metade que faltava, e um aviso sem saída ensina a ignorar avisos. Ele é IRMÃO do
        // comando, nunca filho: ver o comentário do comando, acima.
        this._notice = document.createElement('button');
        this._notice.type = 'button';
        this._notice.className = 'resource-access-notice';
        this._notice.setAttribute('data-testid', 'resource-access-notice');
        this._notice.hidden = true;
        this._container.appendChild(this._notice);
        addDomListener(this, this._notice, 'click', (event) => {
            // Irmãos não borbulham um para o outro, mas o container é ancestral dos dois e pode
            // ganhar um ouvinte amanhã; parar aqui mantém o reparo como assunto só dele.
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
        // periódica. Pela batida chegaria até 3 s atrasado, e até 2026-09-23 chegava CEGO em
        // atlas local, porque `_readQueue` voltava antes de repintar ali; hoje aquele ramo repinta
        // (a origem vira local sem evento, e a luz congelava), mas o observador continua sendo a
        // via certa: `onResourceAccessHealthChanged` avisa na virada, sem esperar batida nenhuma.
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
     * Loads the panel module, or hands back the load already in flight.
     *
     * A FAILED LOAD IS FORGOTTEN, not cached: the cached promise would answer "no" forever to a
     * person who came back online and clicked again, which is the exact case this whole preload
     * exists for.
     * @returns {Promise<{abrirPainelDePendencias: function(): void}>}
     * @private
     */
    _carregarPainel() {
        // WITHOUT A CONNECTION THE IMPORT IS NOT ATTEMPTED, and that is what keeps the offline
        // promise true. A failed fetch poisons the module for the life of the page (see the
        // sentences at the top), so trying while offline would turn "it loads by itself when the
        // network is back" into "it never loads until you reload". A module ALREADY loaded is
        // served from the cached promise below, connection or not: that is what the preload buys.
        if (!this._painelModulo && semConexaoParaCarregar()) {
            const erro = new Error('pendency panel: load not attempted while offline');
            erro.naoTentado = true;
            return Promise.reject(erro);
        }
        if (!this._painelModulo) {
            this._painelModulo = import('./pendencias/pendencias-panel.js').catch((error) => {
                this._painelModulo = null;
                throw error;
            });
        }
        return this._painelModulo;
    }

    /**
     * Fetches the panel module BEFORE the click, once and for the whole life of the control.
     *
     * THE CLICK IS TOO LATE, and that is the whole finding: the module travels over the network,
     * and the moment the person wants the panel is exactly the moment the network is likeliest to
     * be gone.
     *
     * A FAILED FETCH IS NOT RETRIED HERE, and `_painelIndisponivel` is what stops it: the light
     * repaints on every 3 s heartbeat, so retrying from the paint would be one download every
     * three seconds for as long as the cause lasts, and the cause is usually the network being
     * gone. Only {@link _onSignal} clears the flag, on the one piece of news that changes the
     * answer.
     * @private
     */
    _buscarPainel() {
        if (this._painelModulo || this._painelIndisponivel) return;
        this._carregarPainel().catch((error) => {
            // Not a failure of anything the person asked for: the click still tries again, and
            // says so out loud if it also fails.
            this._painelIndisponivel = true;
            console.warn('Sync status: the pendency panel could not be preloaded yet:', error);
        });
    }

    /**
     * THE DETERMINISTIC TRIGGER: a server atlas that reached ONLINE, whatever the queue says.
     *
     * UNTIL 2026-09-21 THE ONLY TRIGGER WAS THE TONE, AND IT WORKED BY ACCIDENT. Opening a server
     * atlas left the light amber for a few seconds because `performInitialColorAnalysis` enqueued
     * a `setting` operation of its own, so there was always "work waiting" to preload against. The
     * colour count stopped being synced (`c07d6dff`), nothing was pending at opening any more, and
     * the preload simply never ran: the first piece of work born ALREADY OFFLINE then found the
     * module still on the server, which is the one case this whole preload exists for. Guard:
     * `tests/e2e-ui/painel-de-pendencias-volta-com-a-rede.spec.js`.
     *
     * THE TONE TRIGGER STAYS as the second way in, and it is not redundant: CONNECTING and
     * RECONNECTING happen with the network up (see {@link semConexaoParaCarregar}), and work that
     * appears while the socket is being remade never reaches ONLINE to trip this one.
     *
     * THE THREE GUARDS ARE THE PAYLOAD BUDGET, not caution: the five files of
     * `account/pendencias/` are 76 kB of source, and `tests/e2e-ui/desempenho-do-boot-do-mapa.spec.js`
     * holds an anonymous local boot to 150 kB of script after boot. An anonymous visitor has no
     * badge at all and a local atlas has no outbound queue, so in both the download would never be
     * read; neither ever reaches ONLINE on this machine either, and the guards say so out loud
     * rather than relying on that.
     * @private
     */
    _precarregarPorConexao() {
        if (!sessionContext.isAuthenticated()) return;
        if (!isRemoteStoreSync()) return;
        if (connectionState.getState() !== ConnectionStates.ONLINE) return;
        this._buscarPainel();
    }

    /**
     * The second way in: the light stopped saying "all sent" while the connection is not ONLINE.
     *
     * Work waiting or trouble recorded means there is now something to show, and the queue can
     * fill up during CONNECTING or RECONNECTING, which {@link _precarregarPorConexao} does not
     * cover on purpose.
     * @param {string} tone - The tone `describeSyncWork` just produced.
     * @private
     */
    _precarregarPainel(tone) {
        if (tone !== SYNC_TONE.WARN && tone !== SYNC_TONE.BUSY) return;
        this._buscarPainel();
    }

    /**
     * Opens the pendency panel, which is where this light points.
     *
     * The badge is hidden for an anonymous visitor, so this cannot be reached without a session;
     * the guard is here anyway because a keyboard handler on a hidden element is still reachable
     * in some browsers, and opening a panel that reads a queue nobody owns would only confuse.
     *
     * THE PANEL IS LOADED BY `import()`, not imported at the top, and the reason is module graph
     * rather than payload: the panel reaches the permission guard, the confirm modal and the
     * toast service, and a static import would drag all three into every module that merely
     * mounts this light (which is what turned an unrelated unit test of this control red).
     *
     * A FAILED LOAD NOW SPEAKS. It used to write to the console and nothing else, so the click
     * that most needed an answer (offline, with work waiting) produced a badge that did nothing at
     * all. {@link _precarregarPainel} makes that rare; this makes it legible when it happens.
     * @private
     */
    async _abrirPendencias() {
        if (!sessionContext.isAuthenticated()) return;
        // NO ATLAS LOCAL NÃO HÁ PAINEL A ABRIR (2026-09-17): não existe fila de envio, então o
        // painel de pendências abriria vazio para dizer que não há o que dizer. O portão fica
        // AQUI, e não no ouvinte, porque clique e tecla chegam aos dois pelo mesmo caminho.
        if (this._ehComando === false) return;
        try {
            const { abrirPainelDePendencias } = await this._carregarPainel();
            abrirPainelDePendencias();
        } catch (error) {
            console.warn('Sync status: could not open the pendency panel:', error);
            // The sentence follows WHAT HAPPENED to the module, not the connection light: an
            // attempt that failed has poisoned it for this page, whatever the light says now.
            const semRede = error?.naoTentado === true;
            this._painelIndisponivel = semRede;
            if (semRede) showError(PAINEL_SEM_REDE);
            else if (globalThis.navigator?.onLine === false) showError(PAINEL_CAIU_NO_MEIO);
            else showError(PAINEL_NAO_CARREGOU);
        }
    }

    /**
     * A connection or session change: repaint at once with the count already known (the
     * transport half of the answer is news by itself) and re-read the queue behind it.
     * @private
     */
    _onSignal() {
        // A CONEXÃO DE VOLTA É A ÚNICA NOTÍCIA que muda a resposta de um pré-carregamento que
        // falhou; sem esta linha o painel ficaria irrecuperável até um F5 para quem clicou offline.
        if (connectionState.getState() === ConnectionStates.ONLINE) this._painelIndisponivel = false;
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
        if (!sessionContext.isAuthenticated() || !isRemoteStoreSync()) {
            // THE QUEUE IS NOT READ HERE, BUT THE LIGHT IS STILL REPAINTED, and the repaint is the
            // fix of 2026-09-23. The origin flips to LOCAL (`markStoreLocal`) without any event, and
            // the heartbeat that lands here was the only thing still looking: returning before
            // `_render()` froze the last paint, which was taken while the origin was still REMOTE.
            // Measured after an `?atlas=` open that failed on a tab with the "Mapa local" intent:
            // the tab was local and the light said `sem-conexao` forever. Painting costs no
            // IndexedDB traffic, which is what this branch exists to avoid.
            this._render();
            return;
        }
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
            // A SOMA NÃO É FEITA AQUI, e essa é a segunda metade da mesma lição (2026-09-15): o
            // painel de pendências mostra este mesmo número, e enquanto cada tela somava os
            // próprios baldes as duas podiam divergir sem nada acusar. A definição é uma só.
            this._pending = aCaminhoDoCenso(medido);
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
        if (!this._container || !this._command) return;

        this._container.hidden = !sessionContext.isAuthenticated();

        const connection = connectionState.getState();
        this._command.setAttribute('data-state', describeState(connection).dataState);

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
        this._command.setAttribute('data-work', work.state);
        this._command.setAttribute('data-tone', work.tone);
        // AS DUAS VIAS DE PRÉ-CARREGAMENTO SAEM DAQUI, e é a pintura que as dispara porque ela é o
        // único ponto por onde passam todas as notícias que mudam a resposta: a virada de conexão,
        // a troca de sessão, cada leitura da fila e a batida de 3 s. Ligá-las ao ouvinte de conexão
        // deixaria de fora o controle montado DEPOIS de a conexão já estar de pé, que é justamente
        // o caso em que não vem mais evento nenhum.
        this._precarregarPorConexao();
        this._precarregarPainel(work.tone);
        // O MOUSEOVER É CURTO (2026-09-17, a pedido do dono): o `title` carregava a frase inteira,
        // de três linhas, e ninguém lê um parágrafo pairando o ponteiro. A frase longa continua
        // inteira no `detail`, que é o que o painel de pendências mostra quando a pessoa clica.
        // O `aria-label` fica com a longa de propósito: quem usa leitor de tela não tem o painel
        // como segunda chance barata, e ali o parágrafo é a única descrição.
        this._command.setAttribute('title', work.resumo ?? work.detail);
        this._command.setAttribute('aria-label', work.detail);
        if (this._label) this._label.textContent = work.label;

        // NO ATLAS LOCAL O SELO NÃO É COMANDO (2026-09-17, a pedido do dono): não há fila de
        // envio, então o painel de pendências abriria vazio para dizer que não há nada a dizer.
        // O atributo `data-abre-pendencias` é o que a suíte e o CSS leem, e ele acompanha.
        // Sem a propriedade `disabled`: ela pintaria de comando morto o que aqui é um INDICADOR,
        // e o CSS já governa o cursor por `data-abre-pendencias` (`pendencias.css`). O portão do
        // gesto é o próprio `_abrirPendencias`, que é onde o clique e a tecla se encontram.
        this._ehComando = work.state !== SYNC_WORK_STATE.LOCAL;
        this._command.setAttribute('data-abre-pendencias', String(this._ehComando));
        this._command.setAttribute('aria-haspopup', this._ehComando ? 'dialog' : 'false');
        this._command.setAttribute('tabindex', this._ehComando ? '0' : '-1');

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
        this._painelModulo = null;
        this._container = null;
        this._command = null;
        this._dot = null;
        this._label = null;
        this._notice = null;
        this._map = undefined;
    }
}
