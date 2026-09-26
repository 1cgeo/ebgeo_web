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
 * do controle segue carregando o vocabulário de conexão (`online`/`connecting`/`offline`, e
 * `sem-tempo-real` desde 2026-09-25),
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
 *
 * ─── AS TRÊS ENTRADAS VIRARAM SETE, E O VERDE PASSOU A EXIGIR AS SETE (F14) ───
 *
 * Enquanto a decisão lia só origem, conexão e UM número, "fila vazia e conectado" produzia
 * "Tudo enviado" incondicionalmente, e havia quatro maneiras de isso ser falso ao mesmo
 * tempo em que era literalmente verdade:
 *
 *   1. RECUPERAÇÃO EM CURSO. Um retrato ou um replay sendo aplicado reescreve os bancos por
 *      baixo da tela, e a fila lida naquele instante não é a fila: é o meio de uma
 *      reconstrução. Zero ali significa "ainda não li", nunca "o servidor tem tudo";
 *   2. QUARENTENA. Trabalho posto de lado à espera de uma decisão da pessoa não está na
 *      contagem de enviáveis (a fila o SALTA de propósito, senão ela trava atrás dele) e não
 *      sai sozinho. Ele sobrevive até ao fim da sessão, e é para isso que sobrevive;
 *   3. RECUSA. Operação que o servidor rejeitou, mais tudo que a fila bloqueia por causa
 *      dela, é `problemas` no censo: não é enviável, e reconectar não conserta;
 *   4. UPLOAD DE IMAGEM PENDENTE. O blob viaja por porta própria, sem operação incremental,
 *      então a fila pode estar vazia enquanto os bytes de uma figura nunca chegaram. Do lado
 *      do par isso é um buraco na tela, e do lado de cá era verde.
 *
 * QUARENTENA E RECUSA SÃO ESTADOS SEPARADOS, e a separação é pelo LUGAR, não pelo motivo:
 * `conflito` é o registro global preservado (trabalho que já atravessou o fim de uma sessão
 * esperando decisão) e `recusa` é o problema vivo na fila do atlas montado. A distinção FINA
 * entre conflito de conteúdo e recusa de permissão, dentro do motivo de cada item, é do
 * bloco de conflitos e não deste módulo: aqui os dois só não podem ser verde.
 *
 * A ORDEM ENTRE ELES É CONTRATO, e ela põe o que NÃO se resolve sozinho na frente do que se
 * resolve: recuperação (que explica todo o resto), depois quarentena e recusa (que esperam
 * uma pessoa), depois upload (que espera a rede), e só então o cruzamento antigo entre
 * conexão e contagem. Um estado que espera a rede anunciado na frente de um que espera a
 * pessoa ensinaria a esperar.
 *
 * E OS QUATRO NÚMEROS NOVOS TÊM A MESMA TERCEIRA AUSÊNCIA que a contagem da fila: `null`
 * neles é leitura que falhou, e cai em DESCONHECIDO junto com as outras. Não há ramo de
 * ausência que chegue ao verde.
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
    /** O servidor responde, mas a conexão em tempo real não abriu (`sem-tempo-real.js`). */
    HTTP_ONLY: 'http-only',
});

/**
 * O QUE A PESSOA PRECISA DISTINGUIR, que é mais do que "conectado ou não".
 *
 * Os valores saem de duas perguntas cruzadas (há para onde enviar? há o que enviar?), mais os
 * dois ramos de ausência, mais os quatro estados de trabalho que existem FORA do cruzamento
 * (ver o `fileoverview`). Nenhum deles é decorativo: cada um manda a pessoa fazer uma coisa
 * diferente antes de fechar o navegador, e é por isso que a contagem deles não fica escrita
 * nesta frase, que já envelheceu uma vez dizendo nove.
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
    /** Um retrato ou um replay está sendo aplicado: a fila lida agora não é a fila. */
    RECOVERING: 'recuperando',
    /** Há trabalho guardado à espera de uma decisão da pessoa, e ele não sai sozinho. */
    CONFLICT: 'conflito',
    /** O servidor rejeitou alterações, e há trabalho parado atrás delas. */
    REFUSED: 'recusa',
    /** Os bytes de uma ou mais figuras não chegaram ao servidor. */
    BLOB_PENDING: 'upload-pendente',
    /** Há trabalho na fila e o nível atual da pessoa neste atlas não permite enviá-lo (403). */
    NO_PERMISSION: 'sem-permissao',
    /**
     * Nada espera envio e o servidor responde, mas SEM TEMPO REAL: as alterações dos colegas
     * chegam com alguns segundos de atraso e ninguém aparece como presente (2026-09-25).
     */
    NO_REAL_TIME: 'sem-tempo-real',
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
 *   3. RECUPERAÇÃO vem antes da fila, e não depois, porque é ela que explica por que a fila
 *      não pode ser lida como resposta agora: os bancos estão sendo reescritos. Posta depois,
 *      ela só apareceria quando a leitura já tivesse dado um número, e o número seria o do
 *      meio da reconstrução;
 *   4. fila não medida e fila ilegível vêm antes do cruzamento, e caem em estados
 *      diferentes (ver o `fileoverview`);
 *   5. quarentena, recusa e upload pendente vêm antes do cruzamento porque nenhum dos três é
 *      consertado por conexão: dizer "pendente, sem conexão" sobre uma recusa mandaria a
 *      pessoa esperar a rede por uma coisa que a rede não resolve. O tom deles é de alarme,
 *      então a gravidade do caso sem conexão não se perde, e a frase cita a contagem da fila
 *      quando há trabalho comum esperando junto;
 *   6. só então o cruzamento entre "há conexão" e "há trabalho".
 *
 * @param {Object} entrada
 * @param {boolean} [entrada.remote] - `isRemoteStoreSync()`. Qualquer coisa que não seja
 *   `true` conta como atlas local: a pergunta é "existe servidor de destino", e a resposta
 *   incerta é NÃO, senão a tela prometeria envio para lugar nenhum.
 * @param {string} [entrada.connection] - um valor de {@link SYNC_CONNECTION}.
 * @param {number|null} [entrada.pending] - a soma de `pendentes` e `preparadas` do censo da
 *   fila, isto é, o trabalho comum que ainda não chegou; `undefined` quando ainda não foi
 *   lida, `null` quando a leitura falhou.
 * @param {number|null} [entrada.problemas] - `problemas` do censo: o que o servidor recusou
 *   mais o que está bloqueado atrás disso.
 * @param {number|null} [entrada.quarentena] - operações no registro global de quarentena, à
 *   espera de decisão explícita.
 * @param {number|null} [entrada.uploads] - pendências de upload de figura ABERTAS, pendentes
 *   e recusadas somadas.
 * @param {number|null} [entrada.uploadsRecusados] - quantas dessas o servidor recusou em
 *   definitivo. Está CONTIDO em `uploads`, e só decide o tom: recusa não se resolve
 *   esperando a rede.
 * @param {boolean} [entrada.recuperando] - um retrato ou replay sendo aplicado agora.
 * @param {string|null} [entrada.recusaDoEnvio] - o tipo da última falha do envio
 *   (`ultimaFalhaDeEnvio`, `store/sync/sync-flush.js`). Só `'permission'` muda a resposta: com
 *   trabalho na fila, a promessa de envio vira a frase de que o nível atual não permite enviar.
 * @returns {{ state: string, tone: string, label: string, resumo: string, detail: string,
 *   pending: number|null }} `resumo` é a frase CURTA do mouseover; `detail` é a longa, que o
 *   painel de pendências mostra. Foram separadas em 2026-09-17, a pedido do dono: o `title`
 *   carregava três linhas e ninguém lê um parágrafo pairando o ponteiro.
 */
export function describeSyncWork({
    remote,
    connection,
    pending,
    problemas = 0,
    quarentena = 0,
    uploads = 0,
    uploadsRecusados = 0,
    recuperando = false,
    recusaDoEnvio = null,
} = {}) {
    if (remote !== true) {
        return {
            state: SYNC_WORK_STATE.LOCAL,
            tone: SYNC_TONE.IDLE,
            label: 'Local',
            resumo: 'Atlas só deste computador.',
            detail: 'Este atlas fica só neste computador e não é enviado a nenhum servidor. '
                + 'Limpar os dados deste navegador apaga o atlas.',
            pending: null,
        };
    }

    const conhecido = Object.values(SYNC_CONNECTION).includes(connection);
    if (!conhecido) {
        return {
            state: SYNC_WORK_STATE.UNKNOWN,
            tone: SYNC_TONE.UNKNOWN,
            label: 'Sem confirmação',
            resumo: 'Estado da conexão desconhecido.',
            detail: 'Não foi possível confirmar a conexão com o servidor, então não dá para '
                + 'garantir que o seu trabalho foi enviado. Aguarde antes de fechar a aba.',
            pending: toPendingCount(pending),
        };
    }

    if (recuperando === true) {
        return {
            state: SYNC_WORK_STATE.RECOVERING,
            tone: SYNC_TONE.BUSY,
            label: 'Recuperando…',
            resumo: 'Atualizando este atlas; não feche a aba.',
            detail: 'O EBGeo está aplicando as alterações recebidas do servidor. Não feche a '
                + 'aba até terminar.',
            pending: toPendingCount(pending),
        };
    }

    if (pending === undefined) {
        return {
            state: SYNC_WORK_STATE.CHECKING,
            tone: SYNC_TONE.UNKNOWN,
            label: 'Verificando…',
            resumo: 'Verificando o que falta enviar.',
            detail: 'Verificando se há alterações deste atlas à espera de envio.',
            pending: null,
        };
    }

    const n = toPendingCount(pending);
    if (n === null) {
        return {
            state: SYNC_WORK_STATE.UNKNOWN,
            tone: SYNC_TONE.UNKNOWN,
            label: 'Sem confirmação',
            resumo: 'Não foi possível verificar os envios.',
            detail: 'Não foi possível verificar se há alterações à espera de envio, então não '
                + 'dá para garantir que tudo foi salvo no servidor.',
            pending: null,
        };
    }

    // OS TRÊS NÚMEROS NOVOS, COM A MESMA REGRA DE AUSÊNCIA DA FILA. `null` em qualquer um é
    // leitura que falhou, e o desfecho é DESCONHECIDO e não zero: o verde é a única frase
    // desta tela sobre a qual alguém decide fechar o navegador, então ele não se dá por falta
    // de medição. `uploadsRecusados` fica de fora desta guarda porque é um RECORTE de
    // `uploads` e só decide tom: sem ele, a única coisa que se perde é a cor.
    const emRevisao = toPendingCount(quarentena);
    const recusadas = toPendingCount(problemas);
    const figuras = toPendingCount(uploads);
    if (emRevisao === null || recusadas === null || figuras === null) {
        return {
            state: SYNC_WORK_STATE.UNKNOWN,
            tone: SYNC_TONE.UNKNOWN,
            label: 'Sem confirmação',
            resumo: 'Não foi possível verificar as pendências.',
            detail: 'Não foi possível verificar todas as pendências deste atlas, então não dá '
                + 'para garantir que o seu trabalho chegou ao servidor.',
            pending: n,
        };
    }

    // Verb agreement for a count: "1 alteração continua", "3 alterações continuam".
    const conforme = (quantas, um, varios) => (quantas === 1 ? um : varios);

    const restante = n > 0
        ? ` Além disso, ${pendingLabel(n)} ${conforme(n, 'continua', 'continuam')} à espera de envio.`
        : '';

    if (emRevisao > 0) {
        return {
            state: SYNC_WORK_STATE.CONFLICT,
            tone: SYNC_TONE.WARN,
            label: `Revisão: ${emRevisao}`,
            resumo: `${pendingLabel(emRevisao)} ${conforme(emRevisao, 'espera', 'esperam')} uma decisão sua.`,
            detail: `O servidor não aceitou ${pendingLabel(emRevisao)} como `
                + `${conforme(emRevisao, 'estava', 'estavam')}. Até você decidir, `
                + `${conforme(emRevisao, 'ela continua guardada', 'elas continuam guardadas')} neste `
                + `computador, mesmo se você sair da conta.${restante}`,
            pending: n,
        };
    }

    if (recusadas > 0) {
        return {
            state: SYNC_WORK_STATE.REFUSED,
            tone: SYNC_TONE.WARN,
            label: `Recusas: ${recusadas}`,
            resumo: `O servidor recusou ${pendingLabel(recusadas)}.`,
            detail: `O servidor recusou alterações deste atlas, e ${pendingLabel(recusadas)} `
                + `${conforme(recusadas, 'está parada', 'estão paradas')} neste computador à espera `
                + `de uma decisão sua. Se a recusa não fizer sentido, fale com quem administra o `
                + `atlas.${restante}`,
            pending: n,
        };
    }

    // O NÍVEL ATUAL NÃO PERMITE ENVIAR (403 em todo envio: um Leitor). Não é problema de rede, e
    // "Enviando" seria uma promessa que o servidor recusa a cada tentativa. O trabalho continua
    // neste computador; quem resolve é o gestor do atlas.
    if (recusaDoEnvio === 'permission' && (n > 0 || figuras > 0)) {
        const quantas = n > 0 ? n : figuras;
        return {
            state: SYNC_WORK_STATE.NO_PERMISSION,
            tone: SYNC_TONE.WARN,
            label: 'Sem permissão',
            resumo: 'Seu nível neste atlas não permite enviar alterações.',
            detail: `${pendingLabel(quantas)} ${conforme(quantas, 'continua', 'continuam')} neste `
                + `computador e não ${conforme(quantas, 'pode ser enviada', 'podem ser enviadas')} com o `
                + 'seu nível atual neste atlas. Peça permissão de edição ao gestor do atlas.',
            pending: n,
        };
    }

    if (figuras > 0) {
        const definitivas = toPendingCount(uploadsRecusados) ?? 0;
        let cauda = ' O envio é retomado sozinho quando a conexão permitir.';
        if (definitivas > 0) {
            cauda = figuras === 1
                ? ' O servidor a recusou: insira a figura de novo.'
                : ` O servidor recusou ${conforme(definitivas, 'uma delas', `${definitivas} delas`)}: `
                    + 'insira de novo as figuras recusadas.';
        }
        return {
            state: SYNC_WORK_STATE.BLOB_PENDING,
            tone: definitivas > 0 ? SYNC_TONE.WARN : SYNC_TONE.BUSY,
            label: `Imagens: ${figuras}`,
            resumo: figuras === 1
                ? 'Uma figura ainda não foi enviada.'
                : `${figuras} figuras ainda não foram enviadas.`,
            detail: `${figuras === 1 ? 'Uma figura ainda não chegou' : `${figuras} figuras ainda não chegaram`} `
                + 'ao servidor, e quem abrir este atlas em outro computador vê um espaço vazio no '
                + `lugar.${cauda}${restante}`,
            pending: n,
        };
    }

    const online = connection === SYNC_CONNECTION.ONLINE;
    // SEM TEMPO REAL O ENVIO CONTINUA (ele sempre foi HTTP), então a fila se lê como no ONLINE: o
    // que muda é só o estado calmo, que precisa dizer a outra metade, a de quem recebe. Um "Tudo
    // enviado" verde ali seria verdade sobre o trabalho da pessoa e esconderia que o dos colegas
    // chega atrasado e que ninguém aparece como presente.
    const semTempoReal = connection === SYNC_CONNECTION.HTTP_ONLY;
    const ligando = connection === SYNC_CONNECTION.CONNECTING
        || connection === SYNC_CONNECTION.RECONNECTING;

    if (n === 0) {
        if (online) {
            return {
                state: SYNC_WORK_STATE.SYNCED,
                tone: SYNC_TONE.OK,
                label: 'Tudo enviado',
                resumo: 'Nada espera envio.',
                detail: 'Tudo o que você fez neste atlas já foi salvo no servidor.',
                pending: 0,
            };
        }
        if (semTempoReal) {
            return {
                state: SYNC_WORK_STATE.NO_REAL_TIME,
                tone: SYNC_TONE.BUSY,
                label: 'Sem tempo real',
                resumo: 'Tudo salvo; as alterações dos colegas chegam em alguns segundos.',
                detail: 'A conexão em tempo real não abriu. Tudo o que você fez já foi salvo no '
                    + 'servidor, e as alterações dos colegas chegam em alguns segundos; quem está no '
                    + 'atlas e os cursores não aparecem. Se continuar, avise o administrador.',
                pending: 0,
            };
        }
        if (ligando) {
            return {
                state: SYNC_WORK_STATE.CONNECTING,
                tone: SYNC_TONE.BUSY,
                label: 'Conectando…',
                resumo: 'Conectando ao servidor.',
                detail: 'Conectando ao servidor. Nada espera envio.',
                pending: 0,
            };
        }
        return {
            state: SYNC_WORK_STATE.OFFLINE_CLEAN,
            tone: SYNC_TONE.IDLE,
            label: 'Sem conexão',
            resumo: 'Sem conexão; nada espera envio.',
            detail: 'Sem conexão com o servidor. Nada espera envio: o que você fez já foi salvo.',
            pending: 0,
        };
    }

    if (online || semTempoReal) {
        return {
            state: SYNC_WORK_STATE.SENDING,
            tone: SYNC_TONE.BUSY,
            label: `Enviando ${n}…`,
            resumo: `Enviando ${pendingLabel(n)}.`,
            detail: `Enviando ${pendingLabel(n)} ao servidor. Até a confirmação, o trabalho fica `
                + 'guardado neste computador.',
            pending: n,
        };
    }
    if (ligando) {
        return {
            state: SYNC_WORK_STATE.PENDING_RETRY,
            tone: SYNC_TONE.BUSY,
            label: pendingShortLabel(n),
            resumo: `${pendingLabel(n)} à espera; reconectando.`,
            detail: `${pendingLabel(n)} à espera de envio. Reconectando ao servidor; o trabalho `
                + 'fica guardado neste computador.',
            pending: n,
        };
    }
    return {
        state: SYNC_WORK_STATE.PENDING_OFFLINE,
        tone: SYNC_TONE.WARN,
        label: pendingShortLabel(n),
        resumo: `${pendingLabel(n)} à espera; sem conexão.`,
        detail: `${pendingLabel(n)} à espera de envio, sem conexão com o servidor. O trabalho `
            + 'é enviado quando a conexão voltar. Sair da conta antes disso põe esse trabalho em '
            + 'risco.',
        pending: n,
    };
}
