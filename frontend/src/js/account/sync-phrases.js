// Path: js/account/sync-phrases.js

/**
 * @fileoverview O que a barra do mapa DIZ sobre a pergunta "o meu trabalho está salvo?",
 * como funções puras: sem DOM, sem store, sem imports.
 *
 * POR QUE ISTO NASCEU SEPARADO DO CONTROLE. A luz de sync mapeava só os quatro estados do
 * SOCKET, e o usuário lia o resultado como estado do TRABALHO. As duas coisas divergem nos
 * dois sentidos, e cada sentido tem um custo próprio: socket ONLINE com fila cheia diz
 * "salvo" quando não está, e é o sinal que precede a perda de trabalho no logout; socket
 * OFFLINE com fila vazia diz "há um problema" quando não há, e treina a pessoa a ignorar o
 * vermelho, que é o custo que se paga depois. A decisão é sobre O QUE MOSTRAR, é aritmética
 * mais concordância de número, e nada disso pertence a dentro de um construtor de DOM.
 *
 * O TRANSPORTE CONTINUA EXISTINDO, e este módulo NÃO o substitui. O atributo `data-state`
 * do controle segue carregando o vocabulário de conexão (`online`/`connecting`/`offline`),
 * porque ele é contrato com cerca de vinte specs de Playwright que esperam por
 * `data-state="online"` para saber que a sessão conectou. O vocabulário novo entra por um
 * atributo NOVO (`data-work`), somando em vez de renomear: renomear teria deixado a única
 * camada que exercita a UI vermelha semanas depois, fora do `npm test`.
 *
 * TRÊS ENTRADAS, E A TERCEIRA TEM TRÊS AUSÊNCIAS DIFERENTES. `pending` é o número de
 * operações na fila de saída, e ele pode faltar por dois motivos que NÃO podem virar a
 * mesma frase: `undefined` é "esta tela ainda não leu a fila" (o instante do primeiro
 * desenho, antes de o IndexedDB responder) e `null` é "a leitura falhou". A primeira é
 * normal e passa em milissegundos; a segunda é um estado em que a tela não pode afirmar
 * nada. Colapsar as duas produziria ou um susto no boot de toda sessão, ou uma promessa de
 * progresso que não existe. Zero é a terceira, e é a única que autoriza dizer "tudo
 * enviado".
 *
 * NENHUM RAMO DE AUSÊNCIA CAI EM "ENVIADO". Fila ilegível, contagem não numérica e estado
 * de conexão não reconhecido caem todos em DESCONHECIDO, que é falhar FECHADO: a tela para
 * de afirmar que o trabalho chegou ao servidor, em vez de assumir o caso bom. Essa é a
 * propriedade que o teste `sync-status-frases.test.js` cobra como invariante sobre a grade
 * inteira, e não caso a caso, porque um ramo novo escrito por descuido passaria numa lista
 * de exemplos e reprova numa invariante.
 */

/**
 * Os estados de conexão que este módulo reconhece, ESPELHANDO `ConnectionStates`
 * (`@store/sync/connection-state.js`).
 *
 * A cópia existe porque o módulo tem zero imports (é o que o mantém carregável em node puro
 * e fora de qualquer barrel), e ela não fica solta: o teste importa os DOIS no mesmo
 * processo e compara. Um estado novo lá que não chegue aqui não vira "desconectado" em
 * silêncio, vira DESCONHECIDO, que é o ramo honesto.
 * @enum {string}
 */
export const SYNC_CONNECTION = Object.freeze({
    OFFLINE: 'offline',
    CONNECTING: 'connecting',
    ONLINE: 'online',
    RECONNECTING: 'reconnecting',
});

/**
 * O QUE A PESSOA PRECISA DISTINGUIR, que é mais do que "conectado ou não".
 *
 * Os nove valores saem de duas perguntas cruzadas (há para onde enviar? há o que enviar?)
 * mais os dois ramos de ausência. Nenhum deles é decorativo: cada um manda a pessoa fazer
 * uma coisa diferente antes de fechar o navegador.
 * @enum {string}
 */
export const SYNC_WORK_STATE = Object.freeze({
    /** Atlas só deste computador: enviar não se aplica. */
    LOCAL: 'local',
    /** Conectado, fila vazia: o servidor tem tudo. */
    SYNCED: 'enviado',
    /** Conectado, fila com trabalho: está saindo agora. */
    SENDING: 'enviando',
    /** Conexão sendo refeita, com trabalho parado na fila. */
    PENDING_RETRY: 'pendente-reconectando',
    /** Conexão sendo feita, sem nada na fila. */
    CONNECTING: 'conectando',
    /** Sem conexão, com trabalho parado na fila. É o estado que precede a perda. */
    PENDING_OFFLINE: 'pendente-sem-conexao',
    /** Sem conexão, e nada ficou para trás. */
    OFFLINE_CLEAN: 'sem-conexao',
    /** A fila ainda não foi lida nesta tela. */
    CHECKING: 'verificando',
    /** A fila não pôde ser lida, ou a conexão está num estado não reconhecido. */
    UNKNOWN: 'desconhecido',
});

/**
 * A cor, como PAPEL e não como cor. O CSS resolve o token; aqui só se decide a gravidade,
 * porque "vermelho" num arquivo de frases é a decisão de design vazando para dentro da
 * lógica testável.
 * @enum {string}
 */
export const SYNC_TONE = Object.freeze({
    /** Verde: o servidor tem o trabalho. */
    OK: 'ok',
    /** Âmbar: há trabalho em movimento, ou uma conexão em curso. */
    BUSY: 'busy',
    /** Vermelho: há trabalho parado e nenhum caminho até o servidor agora. */
    WARN: 'warn',
    /** Neutro: nada de errado, e nada a enviar. O atlas local mora aqui. */
    IDLE: 'idle',
    /** Neutro, mas sem afirmação: a tela não sabe. */
    UNKNOWN: 'unknown',
});

/**
 * A contagem da fila como inteiro não negativo, ou `null` quando o valor NÃO é uma
 * contagem.
 *
 * O `null` é o produto principal, e não o caso degenerado: é ele que impede um `NaN` ou um
 * `-1` de escorregar para o ramo do zero e virar "Tudo enviado", que é a única frase deste
 * módulo que a pessoa pode usar para decidir fechar o navegador. Repare que `x ?? 0` NÃO
 * serviria aqui, porque não guarda `NaN`.
 *
 * @param {*} value
 * @returns {number|null}
 */
export function toPendingCount(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.trunc(n);
}

/**
 * "1 alteração" / "3 alterações", para a frase longa.
 * @param {*} value
 * @returns {string}
 */
export function pendingLabel(value) {
    const n = toPendingCount(value) ?? 0;
    return `${n} ${n === 1 ? 'alteração' : 'alterações'}`;
}

/**
 * "1 pendente" / "3 pendentes", para o rótulo VISÍVEL na barra.
 *
 * Duas palavras é o orçamento de espaço da barra superior do mapa, que é uma tira de
 * átomos pequenos ao lado do avatar. A frase inteira mora no `title`, como reforço, nunca
 * como portadora única.
 * @param {*} value
 * @returns {string}
 */
export function pendingShortLabel(value) {
    const n = toPendingCount(value) ?? 0;
    return `${n} ${n === 1 ? 'pendente' : 'pendentes'}`;
}

/**
 * O ESTADO DO TRABALHO, a partir do que a tela consegue medir.
 *
 * A ordem dos ramos é o contrato, e cada degrau existe por um motivo:
 *   1. atlas local vem PRIMEIRO, porque ali não há fila que importe nem conexão a esperar,
 *      e qualquer outro ramo daria a essa pessoa uma frase sobre um servidor que não existe
 *      para ela;
 *   2. conexão não reconhecida vem antes da fila, porque sem saber se há caminho até o
 *      servidor a contagem não decide nada;
 *   3. fila não medida e fila ilegível vêm antes do cruzamento, e caem em estados
 *      diferentes (ver o `fileoverview`);
 *   4. só então o cruzamento entre "há conexão" e "há trabalho".
 *
 * @param {Object} entrada
 * @param {boolean} [entrada.remote] - `isRemoteStoreSync()`. Qualquer coisa que não seja
 *   `true` conta como atlas local: a pergunta é "existe servidor de destino", e a resposta
 *   incerta é NÃO, senão a tela prometeria envio para lugar nenhum.
 * @param {string} [entrada.connection] - um valor de {@link SYNC_CONNECTION}.
 * @param {number|null} [entrada.pending] - a contagem da fila de saída; `undefined` quando
 *   ainda não foi lida, `null` quando a leitura falhou.
 * @returns {{ state: string, tone: string, label: string, detail: string, pending: number|null }}
 */
export function describeSyncWork({ remote, connection, pending } = {}) {
    if (remote !== true) {
        return {
            state: SYNC_WORK_STATE.LOCAL,
            tone: SYNC_TONE.IDLE,
            label: 'Local',
            detail: 'Este atlas existe só neste computador. O seu trabalho está salvo aqui e '
                + 'não vai para servidor nenhum, então não há nada para enviar nem nada a '
                + 'esperar. Limpar os dados deste navegador apaga o atlas.',
            pending: null,
        };
    }

    const conhecido = Object.values(SYNC_CONNECTION).includes(connection);
    if (!conhecido) {
        return {
            state: SYNC_WORK_STATE.UNKNOWN,
            tone: SYNC_TONE.UNKNOWN,
            label: 'Sem confirmação',
            detail: 'Esta tela não reconheceu o estado da conexão com o servidor, então não '
                + 'sabe dizer se o seu trabalho está sendo enviado. Não a tome como prova de '
                + 'que tudo foi salvo.',
            pending: toPendingCount(pending),
        };
    }

    if (pending === undefined) {
        return {
            state: SYNC_WORK_STATE.CHECKING,
            tone: SYNC_TONE.UNKNOWN,
            label: 'Verificando…',
            detail: 'Lendo a fila de envio deste atlas. Enquanto isso, esta luz não afirma '
                + 'que tudo já foi enviado.',
            pending: null,
        };
    }

    const n = toPendingCount(pending);
    if (n === null) {
        return {
            state: SYNC_WORK_STATE.UNKNOWN,
            tone: SYNC_TONE.UNKNOWN,
            label: 'Sem confirmação',
            detail: 'Não foi possível ler a fila de envio deste atlas, então esta tela não '
                + 'sabe se há trabalho esperando. Não a tome como prova de que tudo foi '
                + 'salvo no servidor.',
            pending: null,
        };
    }

    const online = connection === SYNC_CONNECTION.ONLINE;
    const ligando = connection === SYNC_CONNECTION.CONNECTING
        || connection === SYNC_CONNECTION.RECONNECTING;

    if (n === 0) {
        if (online) {
            return {
                state: SYNC_WORK_STATE.SYNCED,
                tone: SYNC_TONE.OK,
                label: 'Tudo enviado',
                detail: 'Nada espera envio: tudo o que você fez neste atlas já foi aceito '
                    + 'pelo servidor.',
                pending: 0,
            };
        }
        if (ligando) {
            return {
                state: SYNC_WORK_STATE.CONNECTING,
                tone: SYNC_TONE.BUSY,
                label: 'Conectando…',
                detail: 'Ligando ao servidor. Nada espera envio.',
                pending: 0,
            };
        }
        return {
            state: SYNC_WORK_STATE.OFFLINE_CLEAN,
            tone: SYNC_TONE.IDLE,
            label: 'Sem conexão',
            detail: 'Sem conexão com o servidor agora. Nada espera envio: o que você fez '
                + 'antes já tinha sido aceito.',
            pending: 0,
        };
    }

    if (online) {
        return {
            state: SYNC_WORK_STATE.SENDING,
            tone: SYNC_TONE.BUSY,
            label: `Enviando ${n}…`,
            detail: `${pendingLabel(n)} à espera de confirmação do servidor, saindo agora. `
                + 'O trabalho continua guardado neste computador até o servidor aceitar.',
            pending: n,
        };
    }
    if (ligando) {
        return {
            state: SYNC_WORK_STATE.PENDING_RETRY,
            tone: SYNC_TONE.BUSY,
            label: pendingShortLabel(n),
            detail: `${pendingLabel(n)} à espera de envio. A conexão com o servidor está `
                + 'sendo refeita, e o trabalho continua guardado neste computador.',
            pending: n,
        };
    }
    return {
        state: SYNC_WORK_STATE.PENDING_OFFLINE,
        tone: SYNC_TONE.WARN,
        label: pendingShortLabel(n),
        detail: `${pendingLabel(n)} à espera de envio, e não há conexão com o servidor `
            + 'agora. O trabalho continua guardado neste computador e sai quando a conexão '
            + 'voltar. Sair da conta antes disso põe esse trabalho em risco.',
        pending: n,
    };
}
