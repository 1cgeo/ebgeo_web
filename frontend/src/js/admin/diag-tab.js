// Path: js/admin/diag-tab.js

/**
 * @fileoverview Aba "Diagnóstico" — a saúde do servidor e dos navegadores em TRÊS seções sobre a
 * MESMA janela de tempo: o pulso de requisições, os DEFEITOS (com ciclo de vida) e a latência por
 * rota.
 *
 * ERAM QUATRO ATÉ 2026-09-02, e a fusão é a mudança inteira. Havia uma lista de erros do SERVIDOR
 * (varredura do arquivo de log) e outra de erros do NAVEGADOR (tabela), lado a lado: o mesmo
 * defeito visto pelas duas portas aparecia duas vezes sem nada ligando as duas linhas, e NENHUMA
 * das duas tinha estado, de modo que um defeito consertado ficava na tela com a mesma cara de um
 * que ninguém olhou e a única forma de "resolver" era esperar a janela passar por cima dele. As
 * duas viraram a seção "Defeitos", sobre `GET /diag/defeitos`, que é uma tabela só (o 5xx do
 * próprio servidor entra nela com `origem = 'servidor'`) e carrega `estado`, quem resolveu, em que
 * release e em que commit.
 *
 * A VARREDURA DO LOG NÃO SUMIU, SAIU DA TELA. Os endereços agregados por assinatura (a resposta
 * para "este pico de 401 é um endereço ou trezentos?") continuam em `npm run diag -- erros`, no
 * servidor. Quem diz isso, em uma linha acima da lista, é `escopoNotice`: uma seção que desaparece
 * sem explicação se lê como capacidade perdida.
 *
 * SÓ O ADMINISTRADOR GLOBAL a recebe (`ABAS_DO_ADMINISTRADOR`, em `admin-audience.js`), e as
 * rotas exigem administração no servidor. O recorte no cliente não é a fronteira de segurança: ele
 * existe para que produtor e credenciado não batam em 403 na montagem, que é a pior forma de dizer
 * não. É a mesma razão de `users`, `config` e `personnel` serem recortadas.
 *
 * A JANELA É UMA SÓ PARA A ABA INTEIRA, e não uma por seção. Comparar o pico de 5xx da última
 * hora com a latência dos últimos sete dias não responde nada, e dois seletores convidam
 * exatamente a isso. O teto de sete dias é do servidor; o seletor não oferece além dele. OS
 * FILTROS DE DEFEITO, ao contrário, são só da seção deles, e é por isso que a barra deles mora lá
 * dentro: eles não recortam o pulso nem a latência.
 *
 * AS TRÊS CHAMADAS FALHAM SEPARADAS. Elas saem juntas num `allSettled` e cada seção pinta o
 * próprio desfecho: uma rota que ainda não exista (404) ou uma rede ruim que derrube a terceira
 * não pode esconder as outras duas, e cada falha tem o seu botão de tentar de novo. É o mesmo
 * arranjo da aba Concessões, inclusive o embrulho `settle`, que existe porque
 * `Promise.allSettled` só protege de promessa REJEITADA: um erro SÍNCRONO na montagem do
 * argumento (o método não existir no cliente HTTP) escapa por cima dele e deixa a aba em
 * "Carregando…" para sempre.
 *
 * A SEÇÃO DE DEFEITOS NÃO SE REPINTA INTEIRA, e essa é a diferença de forma para as outras duas.
 * A barra de filtros e o seletor de janela são construídos UMA vez: um controle que se redesenha a
 * cada carga perde o valor digitado e o foco do teclado no meio do gesto, e aqui há um campo de
 * texto (a release) que a pessoa digita. Então `_pintarDefeitos` mexe só nos três pedaços que ela
 * possui (o cartão de saúde, a nota do recorte e o corpo da tabela), em vez do `replaceChildren`
 * que as irmãs fazem no host inteiro.
 *
 * O DADO DESTA ABA É HOSTIL, e é a única do painel em que isso é literal. Mensagem, pilha, URL,
 * user agent e MIGALHA de um defeito são texto arbitrário escrito pela máquina de quem visitou a
 * página PÚBLICA: nada aqui monta HTML, tudo entra por `textContent`, e a pilha vai para um `<pre>`
 * cujo conteúdo também é `textContent`. `resumirTexto` (`diag-phrases.js`) corta por LAYOUT e nunca
 * por segurança.
 *
 * A CONTAGEM MANDA NA TELA. Ela é a segunda coluna de cada linha, com peso visual em escada
 * logarítmica (`pesoDaContagem`): quem abre esta aba está escolhendo o que consertar primeiro. Mas
 * ela é VITALÍCIA e conta RELATO, não ocorrência da janela, e é por isso que o crachá sai nomeado
 * (`contagemHistoricaUnidade`) e a lista é ordenada por RECÊNCIA, que é o critério pelo qual o
 * servidor a corta. Ver `ordenarDefeitos`, em `defeito-phrases.js`.
 *
 * O ATO DE CICLO DE VIDA NÃO USA `disabled`. Enquanto o `PATCH` está em voo o botão continua
 * desenhado e recusa o clique nomeando o estado (`aria-disabled` + `acaoEmVooNotice`), que é a
 * convenção da casa para bloqueio REVERSÍVEL: botão desabilitado não dispara clique, e o clique é
 * como o motivo chega à pessoa. Não há bloqueio por POSTO a desenhar aqui, porque a aba inteira já
 * é de um papel só.
 *
 * O CARTÃO DE SAÚDE POR RELEASE TEM DUAS CONTAS DESDE 2026-09-02, e a do SERVIDOR vence. Ela vem
 * de `releases`, no mesmo payload do pulso, e traz o denominador que a conta do cliente nunca teve
 * (quantas SESSÕES cada build rodou): "sete defeitos novos" não diz nada sem saber se a build
 * rodou em setenta sessões ou em sete mil. A conta derivada da lista carregada continua de pé como
 * reserva para o servidor de versão anterior, e `saudeFonteNotice` diz QUAL das duas está no ar —
 * sem essa linha os números mudariam de um dia para o outro sem nada explicar, e a leitura natural
 * é que a tela quebrou.
 */

import { apiClient } from '@store/sync/api-client.js';
import { sessionContext } from '@store/sync/session-context.js';
// Do ARQUIVO, nunca dos barrels `@utils` / `@modals`: esta página não carrega a store, e os
// barrels a alcançam transitivamente.
import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
} from '@utils/event-cleanup.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { sectionHeader, card, emptyState, failureState, ICON_DIAG } from './admin-dom.js';
import {
    JANELAS,
    JANELA_PADRAO,
    contagemDetalhe,
    contagemHistoricaDetalhe,
    contagemHistoricaUnidade,
    contagemLabel,
    cortadaNotice,
    estadoDaContagemDeErros,
    estadoDaLatencia,
    estadoDaSecao,
    ESTADO,
    faixasOrdenadas,
    horaLocal,
    horaLocalCompleta,
    intervaloDeOcorrencias,
    janelaEmPalavras,
    janelaHint,
    janelaLabel,
    latenciaLabel,
    leitorCego,
    leitorCegoNotice,
    listaDoPayload,
    mensagemLabel,
    normalizarJanela,
    ordenarRotas,
    paginaLabel,
    pesoDaContagem,
    pulsoEmptyHint,
    pulsoEmptyNotice,
    pulsoFailureNotice,
    resumirTexto,
    rotaLabel,
    serverErrorsScanNotice,
    slowEmptyHint,
    slowEmptyNotice,
    slowFailureNotice,
    slowScopeNotice,
    tabSubtitle,
    taxaDeErro,
    truncamentoNotice,
    usuarioLabel,
} from './diag-phrases.js';
import {
    ACAO,
    COLUNAS,
    ESTADOS,
    FILTRO_TODOS,
    NUMEROS_DA_SAUDE,
    NUMEROS_DA_SAUDE_DO_SERVIDOR,
    ORIGENS,
    PAGINAS,
    acaoEmVooLabel,
    acaoEmVooNotice,
    acaoFalhaNotice,
    acaoLabel,
    acaoSucessoNotice,
    acoesDoEstado,
    buildNoArLabel,
    cancelarLabel,
    commitHint,
    commitLabel,
    commitPlaceholder,
    confirmarLabel,
    contagemNotice,
    contarNovos,
    defeitosEmptyHint,
    defeitosEmptyNotice,
    defeitosFailureNotice,
    defeitosFiltradosEmptyHint,
    defeitosFiltradosEmptyNotice,
    ehNovo,
    escopoNotice,
    estadoAlvoDaAcao,
    estadoDescricao,
    estadoLabel,
    estadoTom,
    filtroEstadoLabel,
    filtroEstadoTodos,
    filtroNovosHint,
    filtroNovosLabel,
    filtroOrigemLabel,
    filtroOrigemTodas,
    filtroPaginaLabel,
    filtroPaginaTodas,
    filtroReleaseHint,
    filtroReleaseLabel,
    filtroReleasePlaceholder,
    gavetaAbrirLabel,
    gavetaFecharLabel,
    janelaEmVooNotice,
    limparFiltrosLabel,
    migalhasTitulo,
    migalhasVaziasNotice,
    navegadorLabel,
    novoChipLabel,
    novoChipTitulo,
    novosDesdeNotice,
    ocorrenciasCarregandoNotice,
    ocorrenciasEmptyHint,
    ocorrenciasEmptyNotice,
    ocorrenciasFailureNotice,
    ocorrenciasTitulo,
    ordenarDefeitos,
    origemLabel,
    pilhaBrutaResumo,
    primeiraVisitaNotice,
    releasesDetalhe,
    releasesDoDefeito,
    resolucaoNotice,
    rotaEStatusLabel,
    FONTE_DA_SAUDE,
    desfechoDaSaude,
    saudeDasReleases,
    saudeDoServidor,
    saudeFonteNotice,
    saudeNotice,
    saudeTitulo,
    saudeVaziaNotice,
    taxaDeErroLabel,
    secaoSubtitulo,
    secaoTitulo,
    sessaoCurta,
    temFiltroAtivo,
    tempoRelativo,
    textoDeMigalhaLabel,
    tipoDeMigalhaLabel,
} from './defeito-phrases.js';

/**
 * Os tetos de cada lista.
 *
 * DOIS NÚMEROS DIFERENTES, e a diferença é de propósito: a lista de rotas lentas serve para
 * escolher UMA para consertar, e a de defeitos é o inventário do que está quebrado, onde
 * cinquenta é o que o servidor já aceita como teto da consulta.
 */
const LIMITE_LENTO = 15;
const LIMITE_DEFEITOS = 50;

/**
 * A marca da última visita, POR PESSOA e no armazenamento do navegador dela.
 *
 * POR QUE `localStorage` E NÃO O SERVIDOR: a pergunta que ela responde ("o que apareceu desde que
 * eu olhei?") é do leitor, não do sistema, e guardá-la no servidor exigiria uma coluna, uma rota e
 * uma decisão sobre o que fazer quando dois administradores leem a mesma lista. A chave leva o id
 * da pessoa porque duas contas no mesmo navegador não podem herdar a marca uma da outra.
 */
const CHAVE_DE_VISITA = 'ebgeo.diag.ultimaVisita';

/** @param {*} userId @returns {string} */
function chaveDeVisita(userId) {
    const quem = typeof userId === 'string' && userId.trim() ? userId.trim() : 'anonimo';
    return `${CHAVE_DE_VISITA}.${quem}`;
}

/**
 * A marca gravada, ou `null`.
 *
 * AUSENTE NÃO É ZERO, e a distinção decide a tela: com `null` NADA fica marcado como novo (ver
 * `ehNovo`), enquanto zero marcaria a lista inteira, que é o alarme que ensina a ignorar alarme. O
 * `try` cobre o navegador que recusa armazenamento (janela privativa, política de site), onde a
 * ausência é o desfecho normal e não um erro a relatar.
 * @param {*} userId
 * @returns {number|null}
 */
function lerMarcaDeVisita(userId) {
    try {
        const bruto = globalThis.localStorage?.getItem(chaveDeVisita(userId));
        const n = Number(bruto);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    }
}

/**
 * Grava a marca. Falha em SILÊNCIO de propósito: perder a marca custa um selo na próxima visita, e
 * um toast de erro sobre armazenamento no meio de um diagnóstico é ruído sobre ruído.
 * @param {*} userId @param {number} agora
 */
function escreverMarcaDeVisita(userId, agora) {
    try {
        globalThis.localStorage?.setItem(chaveDeVisita(userId), String(agora));
    } catch {
        // Sem armazenamento: a marca não sobrevive à sessão, e nada mais muda.
    }
}

/**
 * As três rotas, montadas a partir da janela e (só a de defeitos) dos filtros.
 * @param {string} janela
 * @param {Object} filtros
 * @returns {{status: string, lento: string, defeitos: string}}
 */
function rotasDaJanela(janela, filtros) {
    const desde = encodeURIComponent(janela);
    return {
        status: `/diag/status?desde=${desde}`,
        lento: `/diag/lento?desde=${desde}&limite=${LIMITE_LENTO}`,
        defeitos: rotaDeDefeitos(janela, filtros),
    };
}

/**
 * A rota de defeitos com os filtros aplicados.
 *
 * O FILTRO AUSENTE NÃO VIAJA, e isso não é economia de bytes: o servidor compara
 * `$n::text IS NULL OR coluna = $n`, então mandar `estado=` (string vazia) filtraria pelo valor
 * vazio e devolveria ZERO linhas, calado. `URLSearchParams` cuida da codificação da release e da
 * página, que são texto livre.
 * @param {string} janela @param {Object} [filtros]
 * @returns {string}
 */
function rotaDeDefeitos(janela, filtros = {}) {
    const q = new URLSearchParams();
    q.set('desde', janela);
    q.set('limite', String(LIMITE_DEFEITOS));
    if (filtros.estado) q.set('estado', filtros.estado);
    if (filtros.origem) q.set('origem', filtros.origem);
    const release = typeof filtros.release === 'string' ? filtros.release.trim() : '';
    if (release) q.set('release', release);
    if (filtros.pagina) q.set('pagina', filtros.pagina);
    if (filtros.novos) q.set('novos', '1');
    return `/diag/defeitos?${q.toString()}`;
}

/**
 * Uma leitura de `/diag`, com o envelope `{ data }` já desembrulhado.
 *
 * PASSA PELO MÉTODO INTERNO do cliente HTTP de propósito, e o motivo é de fronteira e não de
 * gosto: `frontend/src/js/store/sync/` é território de outra frente, e um método público novo lá
 * seria escrita fora do escopo desta aba. O embrulho fica AQUI, num lugar só, para que o dia em
 * que `apiClient` ganhar `getDiagStatus` e irmãos a troca seja de quatro linhas. Nada mais deste
 * arquivo sabe como a requisição é feita.
 * @param {string} caminho
 * @returns {Promise<*>}
 */
async function pedirDiag(caminho) {
    return apiClient._request('GET', caminho);
}

/**
 * O `PATCH` do ciclo de vida. Mesma fronteira do `pedirDiag`, e por isso o mesmo embrulho.
 * @param {string} id @param {{estado: string, commit?: string}} corpo
 * @returns {Promise<*>}
 */
async function mudarEstadoDoDefeito(id, corpo) {
    return apiClient._request('PATCH', `/diag/defeitos/${encodeURIComponent(id)}`, { body: corpo });
}

/**
 * Roda `fn` de modo que TODA falha vire promessa rejeitada, inclusive a síncrona. Ver o
 * `@fileoverview`.
 * @param {Function} fn
 * @returns {Promise<*>}
 */
async function settle(fn) {
    return fn();
}

/**
 * Builds the "Diagnóstico" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createDiagTab() {
    const tab = new DiagTab();
    return {
        id: 'diagnostico',
        label: 'Diagnóstico',
        testid: 'admin-tab-diagnostico',
        icon: ICON_DIAG,
        mount: (container) => tab.mount(container),
    };
}

class DiagTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        this._janela = JANELA_PADRAO;
        this._filtros = { estado: '', origem: '', release: '', pagina: '', novos: false };
        this._defeitos = [];
        this._release = null;
        this._releases = null;
        this._fonteDaSaude = FONTE_DA_SAUDE.AUSENTE;
        // TODO ESTADO DE TELA VIVE FORA DA ÁRVORE DO DOM, e a lista é fechada de propósito: a
        // tabela é repintada inteira a cada ato de ciclo de vida e a cada resposta de gaveta, e o
        // que não estiver aqui é PERDIDO nesse repinte, calado. Foi assim que se perderam o hash
        // digitado no campo de commit e a pilha que a pessoa tinha aberto, os dois no repinte que
        // a resposta das ocorrências provoca, ou seja, justamente enquanto ela lia.
        this._abertos = new Set();
        this._ocorrencias = new Map();
        this._buscando = new Set();
        this._selecionada = new Map();
        this._emVoo = new Set();
        this._pedindoCommit = new Set();
        this._commitDigitado = new Map();
        this._pilhasAbertas = new Set();
        this._carregando = false;
        // A MARCA É LIDA NA ENTRADA E REGRAVADA NA SAÍDA, e a segunda metade é o conserto: gravá-la
        // na MONTAGEM fazia ir à aba vizinha e voltar apagar todos os selos, porque o painel
        // desmonta e remonta a aba a cada troca. O evento de saída EXISTE e não precisou ser
        // inventado: é o `cleanup` que `mount` devolve, chamado por `_runTabCleanup`
        // (`admin-panel.js`). O preço, declarado: fechar o navegador não passa por ele, e a marca
        // fica com a data da visita ANTERIOR, o que erra para o lado de mostrar novidade a mais.
        this._userId = sessionContext.userId ?? null;
        this._marcaDeVisita = lerMarcaDeVisita(this._userId);
        // O CONTADOR DE GERAÇÃO é a proteção contra a troca rápida de janela ou de filtro: duas
        // leituras em voo e a ÚLTIMA A RESPONDER pinta a tela, que pode ser a do recorte já
        // abandonado. Mesma correção da aba Auditoria, e pelo mesmo motivo de não haver costura de
        // `signal` no cliente HTTP compartilhado.
        this._geracao = 0;
        setupCleanup(this);
        this._render();
        return () => {
            this._alive = false;
            escreverMarcaDeVisita(this._userId, Date.now());
            cleanup(this);
        };
    }

    /**
     * @private A moldura, desenhada UMA vez. Trocar a janela repinta as três seções e deixa o
     * cabeçalho onde está: um seletor que se redesenha a cada uso perde o foco do teclado no meio
     * do gesto.
     */
    _render() {
        clearScopedListeners(this, 'view');
        const c = this._container;
        c.replaceChildren();

        c.appendChild(sectionHeader('Diagnóstico', {
            subtitle: tabSubtitle(),
            actions: [this._seletorDeJanela()],
        }));

        const dica = document.createElement('p');
        dica.className = 'admin-diag__hint';
        dica.dataset.testid = 'admin-diag-hint';
        dica.textContent = janelaHint();
        c.appendChild(dica);

        this._secaoPulso = this._secao('admin-diag-pulso');
        this._secaoDefeitos = this._montarSecaoDefeitos();
        this._secaoLatencia = this._secao('admin-diag-latencia');
        c.append(this._secaoPulso, this._secaoDefeitos, this._secaoLatencia);

        this._carregar();
    }

    /**
     * @private Uma seção vazia da aba.
     * @param {string} testid
     * @returns {HTMLElement}
     */
    _secao(testid) {
        const el = document.createElement('section');
        el.className = 'admin-diag__section';
        el.dataset.testid = testid;
        return el;
    }

    /**
     * @private O seletor de janela, um para a aba inteira.
     * @returns {HTMLElement}
     */
    _seletorDeJanela() {
        const box = document.createElement('div');
        box.className = 'admin-diag__janela';

        const id = 'admin-diag-janela-select';
        const label = document.createElement('label');
        label.className = 'admin-diag__janela-label';
        label.htmlFor = id;
        label.textContent = janelaLabel();
        box.appendChild(label);

        const select = document.createElement('select');
        select.id = id;
        select.className = 'admin-input admin-input--sm';
        select.dataset.testid = 'admin-diag-janela';
        for (const j of JANELAS) {
            const opt = document.createElement('option');
            opt.value = j.valor;
            opt.textContent = j.rotulo;
            if (j.valor === this._janela) opt.selected = true;
            select.appendChild(opt);
        }
        addScopedDomListener(this, 'view', select, 'change', () => {
            // BLOQUEIO DE ESTADO, e não de posto: ele dura o tempo de uma requisição, então o
            // comando continua desenhado e o gesto é recusado NOMEANDO o estado. O `disabled` que
            // morava aqui não dispara evento nenhum, e um seletor que simplesmente não responde
            // durante um segundo se lê como tela travada. O valor volta ao que está na tela,
            // porque um `<select>` com `aria-disabled` muda de valor de verdade.
            if (this._carregando) {
                select.value = this._janela;
                showError(janelaEmVooNotice());
                return;
            }
            this._janela = normalizarJanela(select.value);
            this._carregar();
        });
        box.appendChild(select);
        this._select = select;
        return box;
    }

    /**
     * @private A seção de defeitos, com a parte ESTÁVEL construída uma vez só.
     *
     * O cabeçalho, a nota de escopo e a barra de filtros não são repintados pela carga: ver o
     * `@fileoverview`. O que `_pintarDefeitos` possui são os três elementos guardados em `this`.
     * @returns {HTMLElement}
     */
    _montarSecaoDefeitos() {
        const host = this._secao('admin-diag-defeitos');
        host.appendChild(sectionHeader(secaoTitulo(), { subtitle: secaoSubtitulo() }));

        const escopo = document.createElement('p');
        escopo.className = 'admin-diag__nota';
        escopo.dataset.testid = 'admin-diag-defeitos-escopo';
        escopo.textContent = escopoNotice();
        host.appendChild(escopo);

        this._saudeHost = document.createElement('div');
        this._saudeHost.className = 'admin-diag__saude';
        this._saudeHost.dataset.testid = 'admin-diag-saude';
        host.appendChild(this._saudeHost);

        host.appendChild(this._barraDeFiltros());

        this._notaDefeitos = document.createElement('p');
        this._notaDefeitos.className = 'admin-diag__nota';
        this._notaDefeitos.dataset.testid = 'admin-diag-defeitos-recorte';
        host.appendChild(this._notaDefeitos);

        this._corpoDefeitos = card({ testid: 'admin-diag-defeitos-card', padded: false });
        host.appendChild(this._corpoDefeitos);
        return host;
    }

    /**
     * @private A barra de filtros da seção de defeitos.
     *
     * ELA RECARREGA A ABA INTEIRA a cada mudança, e não só a seção: as três chamadas saem juntas e
     * o contador de geração já cobre a corrida. Recarregar só uma delas economizaria duas
     * requisições baratas ao custo de um segundo caminho de carga para manter.
     * @returns {HTMLElement}
     */
    _barraDeFiltros() {
        const barra = document.createElement('div');
        barra.className = 'admin-diag__filtros';
        barra.dataset.testid = 'admin-diag-filtros';

        barra.appendChild(this._seletorDeFiltro('estado', filtroEstadoLabel(), filtroEstadoTodos(),
            ESTADOS.map((e) => ({ valor: e.valor, rotulo: e.rotulo }))));
        barra.appendChild(this._seletorDeFiltro('origem', filtroOrigemLabel(), filtroOrigemTodas(),
            ORIGENS.map((o) => ({ valor: o.valor, rotulo: o.rotulo }))));
        barra.appendChild(this._seletorDeFiltro('pagina', filtroPaginaLabel(), filtroPaginaTodas(),
            PAGINAS.map((p) => ({ valor: p.valor, rotulo: p.rotulo }))));
        barra.appendChild(this._campoDeRelease());
        barra.appendChild(this._interruptorDeNovos());

        const limpar = document.createElement('button');
        limpar.type = 'button';
        limpar.className = 'admin-btn admin-btn--ghost';
        limpar.dataset.testid = 'admin-diag-limpar-filtros';
        limpar.textContent = limparFiltrosLabel();
        addScopedDomListener(this, 'view', limpar, 'click', () => {
            this._filtros = { estado: '', origem: '', release: '', pagina: '', novos: false };
            for (const el of barra.querySelectorAll('select')) el.value = FILTRO_TODOS;
            const texto = barra.querySelector('input[type="text"]');
            if (texto) texto.value = '';
            const caixa = barra.querySelector('input[type="checkbox"]');
            if (caixa) caixa.checked = false;
            this._carregar();
        });
        barra.appendChild(limpar);
        return barra;
    }

    /**
     * @private Um seletor de filtro com a opção "todos" na frente.
     * @param {string} campo @param {string} rotulo @param {string} todos
     * @param {Array<{valor: string, rotulo: string}>} opcoes
     * @returns {HTMLElement}
     */
    _seletorDeFiltro(campo, rotulo, todos, opcoes) {
        const box = document.createElement('div');
        box.className = 'admin-diag__filtro';

        const id = `admin-diag-filtro-${campo}`;
        const label = document.createElement('label');
        label.className = 'admin-diag__filtro-label';
        label.htmlFor = id;
        label.textContent = rotulo;
        box.appendChild(label);

        const select = document.createElement('select');
        select.id = id;
        select.className = 'admin-input admin-input--sm';
        select.dataset.testid = `admin-diag-filtro-${campo}`;
        const vazio = document.createElement('option');
        vazio.value = FILTRO_TODOS;
        vazio.textContent = todos;
        select.appendChild(vazio);
        for (const o of opcoes) {
            const opt = document.createElement('option');
            opt.value = o.valor;
            opt.textContent = o.rotulo;
            select.appendChild(opt);
        }
        select.value = this._filtros[campo] || FILTRO_TODOS;
        addScopedDomListener(this, 'view', select, 'change', () => {
            this._filtros[campo] = select.value;
            this._carregar();
        });
        box.appendChild(select);
        return box;
    }

    /**
     * @private O campo de release, com a dica de que a comparação é EXATA.
     * @returns {HTMLElement}
     */
    _campoDeRelease() {
        const box = document.createElement('div');
        box.className = 'admin-diag__filtro';

        const id = 'admin-diag-filtro-release';
        const label = document.createElement('label');
        label.className = 'admin-diag__filtro-label';
        label.htmlFor = id;
        label.textContent = filtroReleaseLabel();
        box.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.id = id;
        input.className = 'admin-input admin-input--sm';
        input.dataset.testid = 'admin-diag-filtro-release';
        input.placeholder = filtroReleasePlaceholder();
        input.title = filtroReleaseHint();
        input.value = this._filtros.release;
        // NO `change`, E NÃO NO `input`: uma requisição por tecla digitada faria a lista piscar e
        // gastaria a rota de diagnóstico justamente quando o servidor pode estar sofrendo.
        addScopedDomListener(this, 'view', input, 'change', () => {
            this._filtros.release = input.value;
            this._carregar();
        });
        box.appendChild(input);
        return box;
    }

    /**
     * @private O interruptor "só os que nasceram na janela".
     *
     * O `title` É O CONSERTO, e ele não é decoração: esta tela tem DUAS palavras "novo" (este
     * filtro, que é da JANELA, e o selo da linha, que é da última visita desta pessoa). Ver
     * `filtroNovosHint`.
     * @returns {HTMLElement}
     */
    _interruptorDeNovos() {
        const box = document.createElement('div');
        box.className = 'admin-diag__filtro admin-diag__filtro--caixa';
        box.title = filtroNovosHint();

        const id = 'admin-diag-filtro-novos';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.dataset.testid = 'admin-diag-filtro-novos';
        input.checked = this._filtros.novos === true;
        addScopedDomListener(this, 'view', input, 'change', () => {
            this._filtros.novos = input.checked;
            this._carregar();
        });

        const label = document.createElement('label');
        label.className = 'admin-diag__filtro-label';
        label.htmlFor = id;
        label.textContent = filtroNovosLabel();

        box.append(input, label);
        return box;
    }

    /**
     * @private Lê as três rotas e pinta as três seções.
     */
    async _carregar() {
        const geracao = ++this._geracao;
        const janela = this._janela;
        const rotas = rotasDaJanela(janela, this._filtros);

        this._pintarCarregando(this._secaoPulso, 'Pulso de requisições');
        this._defeitosCarregando();
        this._pintarCarregando(this._secaoLatencia, 'Latência por rota');
        this._carregando = true;
        if (this._select) {
            this._select.setAttribute('aria-disabled', 'true');
            this._select.title = janelaEmVooNotice();
        }

        const [status, defeitos, lento] = await Promise.allSettled([
            settle(() => pedirDiag(rotas.status)),
            settle(() => pedirDiag(rotas.defeitos)),
            settle(() => pedirDiag(rotas.lento)),
        ]);
        if (!this._alive || geracao !== this._geracao) return;
        this._carregando = false;
        if (this._select) {
            this._select.removeAttribute('aria-disabled');
            this._select.removeAttribute('title');
        }

        // A BUILD NO AR VEM DO PULSO, e é lida ANTES de a seção de defeitos pintar: o cartão de
        // saúde por release só significa alguma coisa ao lado dela ("duas regressões na v2" pede
        // providência se a v2 é a que está rodando). Falha do pulso degrada para `null`, que a
        // frase nomeia em voz alta.
        this._release = status.status === 'fulfilled' ? status.value?.release ?? null : null;
        // E O RESUMO POR RELEASE DO SERVIDOR, lido do MESMO payload e pelo mesmo motivo: ele é a
        // fonte PREFERIDA do cartão de saúde, e o cartão é desenhado por `_pintarDefeitos`, logo
        // abaixo.
        //
        // O DESFECHO VIAJA JUNTO, e não só o valor. Um `null` sozinho colapsa TRÊS coisas que a
        // frase do cartão precisa separar: o pulso recusado, o servidor que não manda o bloco, e
        // o servidor que o manda NULO porque o banco dele não respondeu. Só a do meio é "versão
        // anterior", e acusá-la nas três manda procurar o problema no lugar errado.
        const pulsoFalhou = status.status !== 'fulfilled';
        this._releases = pulsoFalhou ? null : status.value?.releases ?? null;
        this._fonteDaSaude = desfechoDaSaude({
            pulsoFalhou,
            releases: pulsoFalhou ? undefined : status.value?.releases,
        });

        this._pintarPulso(this._secaoPulso, status, janela);
        this._pintarDefeitos(this._secaoDefeitos, defeitos, janela);
        this._pintarLatencia(this._secaoLatencia, lento, janela);
    }

    /**
     * @private O terceiro estado de tela, distinto do vazio e da falha.
     * @param {HTMLElement} host @param {string} titulo
     */
    _pintarCarregando(host, titulo) {
        host.replaceChildren();
        host.appendChild(sectionHeader(titulo));
        const wrap = card({ padded: false });
        const p = document.createElement('p');
        p.className = 'admin-users__status';
        p.textContent = 'Carregando…';
        wrap.appendChild(p);
        host.appendChild(wrap);
    }

    /**
     * @private O "carregando" da seção de defeitos, que só toca o corpo.
     *
     * Ele é irmão de `_pintarCarregando` e existe separado porque aquela função repinta o host
     * inteiro, o que aqui apagaria a barra de filtros e o que a pessoa acabou de digitar nela.
     */
    _defeitosCarregando() {
        if (!this._corpoDefeitos) return;
        this._saudeHost.replaceChildren();
        this._notaDefeitos.textContent = '';
        this._corpoDefeitos.replaceChildren();
        const p = document.createElement('p');
        p.className = 'admin-users__status';
        p.textContent = 'Carregando…';
        this._corpoDefeitos.appendChild(p);
    }

    /**
     * @private O bloco de falha de uma seção, com a saída que ele precisa ter.
     * @param {HTMLElement} host @param {string} frase @param {*} erro
     * @returns {HTMLElement}
     */
    _falha(host, frase, erro) {
        // A MENSAGEM DO SERVIDOR NÃO SE PERDE, e ela é o dado mais útil desta aba inteira: "404"
        // aqui significa rota ausente nesta implantação, e "403" significa que o papel mudou no
        // meio da sessão. A frase da casa entra antes, para que a mensagem crua não fique sozinha.
        const detalhe = typeof erro?.message === 'string' && erro.message.trim()
            ? `${frase} ${resumirTexto(erro.message, 200)}`
            : frase;
        const el = failureState(detalhe, { onRetry: () => { if (this._alive) this._carregar(); } });
        host.appendChild(el);
        return el;
    }

    /**
     * @private Seção 1: o pulso. Total, erros, taxa e a distribuição por faixa de status.
     * @param {HTMLElement} host @param {PromiseSettledResult<*>} resultado @param {string} janela
     */
    _pintarPulso(host, resultado, janela) {
        host.replaceChildren();
        host.appendChild(sectionHeader('Pulso de requisições', {
            subtitle: 'Quanto o servidor respondeu no período, e com que faixa de status',
        }));
        const wrap = card({ testid: 'admin-diag-pulso-card' });
        host.appendChild(wrap);

        if (resultado.status === 'rejected') {
            this._falha(wrap, pulsoFailureNotice(), resultado.reason);
            return;
        }

        const dados = resultado.value;
        const total = typeof dados?.total === 'number' ? dados.total : null;
        const faixas = faixasOrdenadas(dados?.porFaixa);
        // O VAZIO AQUI NÃO É BOA NOTÍCIA, ao contrário do das outras duas: servidor que não
        // respondeu nada no período é ou reinício recente ou registro que parou de ser escrito.
        if (total === null && faixas.length === 0) {
            wrap.appendChild(failureState(pulsoFailureNotice(), {
                onRetry: () => { if (this._alive) this._carregar(); },
            }));
            return;
        }
        // A SEGUNDA SEÇÃO QUE LÊ O MESMO LOG, e a ordem é a mesma da outra: o leitor cego vem
        // ANTES do vazio. Sem o diretório de log a rota responde com SUCESSO e total zero, e
        // "nenhuma requisição registrada nas últimas 24 horas" seria a boa notícia desenhada a
        // partir de um instrumento desligado, ao lado de uma seção dizendo que está cega.
        if (leitorCego(dados)) {
            wrap.appendChild(failureState(leitorCegoNotice(), {
                onRetry: () => { if (this._alive) this._carregar(); },
            }));
            this._notasDaLeitura(host, dados);
            return;
        }
        if (total === 0) {
            wrap.appendChild(emptyState(pulsoEmptyNotice(janela), { hint: pulsoEmptyHint() }));
            this._notasDaLeitura(host, dados);
            return;
        }

        const tiras = document.createElement('div');
        tiras.className = 'admin-diag__pulso';
        tiras.appendChild(tile('Requisições', contagemLabel(total), 'admin-diag-pulso-total'));
        // O LADRILHO DE ERROS TEM TRÊS ESTADOS, e o terceiro é o conserto: `erros` ausente
        // desenhava travessão com a cor de zero erro. Ver `estadoDaContagemDeErros`.
        tiras.appendChild(tile('Erros', contagemLabel(dados?.erros), 'admin-diag-pulso-erros',
            { estado: estadoDaContagemDeErros(dados?.erros) }));
        const taxa = taxaDoPulso(dados);
        if (taxa) {
            tiras.appendChild(tile('Taxa de erro', taxa, 'admin-diag-pulso-taxa',
                { estado: taxa === '0%' ? 'ok' : 'erro' }));
        }
        wrap.appendChild(tiras);

        if (faixas.length) {
            const lista = document.createElement('ul');
            lista.className = 'admin-diag__faixas';
            lista.dataset.testid = 'admin-diag-faixas';
            for (const f of faixas) {
                const li = document.createElement('li');
                li.className = `admin-diag__faixa admin-diag__faixa--${f.estado}`;
                li.dataset.faixa = f.faixa;
                const nome = document.createElement('span');
                nome.className = 'admin-diag__faixa-nome';
                nome.textContent = f.faixa;
                const valor = document.createElement('span');
                valor.className = 'admin-diag__faixa-valor';
                valor.textContent = contagemLabel(f.total);
                valor.title = contagemDetalhe(f.total);
                li.append(nome, valor);
                lista.appendChild(li);
            }
            wrap.appendChild(lista);
        }
        // O TRUNCAMENTO PESA MAIS AQUI QUE EM QUALQUER OUTRA SEÇÃO, e é por isso que a nota não
        // podia faltar justo nesta: este é o único lugar da aba em que um NÚMERO sofre o corte do
        // anel de leitura. Sem a frase, o total DEPOIS do corte se lê como o total do período.
        this._notasDaLeitura(host, dados);
    }

    /**
     * @private O que a leitura de log alcançou, abaixo da seção.
     *
     * TRÊS FRASES, E AS TRÊS DESFAZEM UMA LEITURA ERRADA DO QUE ESTÁ NA TELA: quanto foi varrido
     * (senão "nenhum erro" é afirmação sobre o leitor), se a janela foi truncada (um pico no começo
     * dela some calado) e se a lista foi cortada pelo limite.
     * @param {HTMLElement} host @param {*} payload
     * @param {{mostrados?: *, total?: *, unidade?: string}} [corte]
     */
    _notasDaLeitura(host, payload, { mostrados, total, unidade = 'itens' } = {}) {
        const frases = [
            serverErrorsScanNotice(payload ?? {}),
            cortadaNotice(mostrados, total, unidade),
            truncamentoNotice(payload),
        ].filter(Boolean);
        if (!frases.length) return;
        const p = document.createElement('p');
        p.className = 'admin-diag__nota';
        p.dataset.testid = 'admin-diag-varredura';
        p.textContent = frases.join(' ');
        host.appendChild(p);
    }

    /**
     * @private Seção 2: os DEFEITOS, com o ciclo de vida.
     *
     * `@nao-le-log`: A ÚNICA DAS TRÊS QUE NÃO LÊ ARQUIVO DE LOG. Esta lista vem do BANCO (a tabela
     * `defeitos`, em `defeitos.service.js`), então `diretorioAusente` e `truncado` não existem no
     * payload dela e `leitorCego`/`_notasDaLeitura` não teriam o que dizer. A ressalva que ELA
     * precisa dar é outra, e está na tela acima da lista (`escopoNotice`): a varredura do arquivo
     * de log, com os endereços agregados por assinatura, saiu desta tela e continua no comando
     * `npm run diag -- erros`. A marca acima é lida por
     * `frontend/tests/unit/diagnostico-secoes-de-log.test.js`, que sem ela reprova esta seção;
     * seção nova só escapa da varredura declarando o mesmo, com o motivo.
     *
     * ELA NÃO REPINTA O HOST, e a razão está no `@fileoverview`: a barra de filtros tem um campo
     * de texto, e um `replaceChildren` aqui apagaria o que a pessoa digitou.
     * @param {HTMLElement} host @param {PromiseSettledResult<*>} resultado @param {string} janela
     */
    _pintarDefeitos(host, resultado, janela) {
        const erro = resultado.status === 'rejected' ? resultado.reason : null;
        const payload = erro ? null : resultado.value;
        const itens = erro ? null : listaDoPayload(payload, 'itens');
        const estado = estadoDaSecao({ erro, itens });
        host.dataset.estado = estado;

        this._saudeHost.replaceChildren();
        this._notaDefeitos.textContent = '';
        this._corpoDefeitos.replaceChildren();

        if (estado === ESTADO.FALHA) {
            this._defeitos = [];
            this._falha(this._corpoDefeitos, defeitosFailureNotice(), erro);
            return;
        }
        if (estado === ESTADO.VAZIO) {
            this._defeitos = [];
            // O VAZIO COM FILTRO É OUTRO VAZIO, e confundi-los é afirmar saúde quando o que está
            // estreito é a pergunta. Só o vazio SEM filtro ganha a cara verde de boa notícia.
            const quando = janelaEmPalavras(janela);
            this._corpoDefeitos.appendChild(temFiltroAtivo(this._filtros)
                ? emptyState(defeitosFiltradosEmptyNotice(quando), {
                    hint: defeitosFiltradosEmptyHint(),
                })
                : bomVazio(defeitosEmptyNotice(quando), defeitosEmptyHint()));
            return;
        }

        // A ORDEM É A DO SERVIDOR (recência), e não a contagem: ver `ordenarDefeitos`.
        this._defeitos = ordenarDefeitos(itens);
        this._totalDeDefeitos = payload?.totalDefeitos;
        this._corpoDefeitos.appendChild(this._tabelaDeDefeitos());
        this._repintarDerivados();
    }

    /**
     * @private O que se deriva da lista já carregada: o cartão de saúde e a nota do recorte.
     *
     * ELES SÃO REPINTADOS TAMBÉM DEPOIS DE CADA ATO, e é por isso que moram numa função própria:
     * resolver um defeito muda a contagem de regressões da release dele, e um cartão que só se
     * atualizasse na recarga mostraria o número de antes do clique ao lado da linha já mudada.
     */
    _repintarDerivados() {
        this._saudeHost.replaceChildren();
        this._saudeHost.appendChild(this._cartaoDeSaude());

        const novos = contarNovos(this._defeitos, this._marcaDeVisita);
        const frases = [
            cortadaNotice(this._defeitos.length, this._totalDeDefeitos, 'defeitos'),
            this._marcaDeVisita === null
                ? primeiraVisitaNotice()
                : novosDesdeNotice(novos, horaLocal(this._marcaDeVisita)),
            contagemNotice(),
        ].filter(Boolean);
        this._notaDefeitos.textContent = frases.join(' ');
    }

    /**
     * @private O cartão de saúde por release.
     *
     * DUAS FONTES, E A DO SERVIDOR VENCE. Ele conta SESSÕES por build, sobre o histórico dele, e
     * é o denominador que a conta do cliente nunca teve: "sete defeitos novos" não diz nada sem
     * saber se a build rodou em setenta sessões ou em sete mil. A conta do cliente
     * (`saudeDasReleases`, sobre a lista carregada) continua de pé como reserva, e a frase do
     * cartão diz QUAL das duas está no ar — sem ela, os números mudariam de um dia para o outro
     * sem nada explicar, e a leitura natural é que a tela quebrou.
     *
     * A RESERVA TEM DOIS MOTIVOS, e a frase os separa: o servidor pode não MANDAR o bloco (versão
     * anterior) ou não CONSEGUIR montá-lo agora (o pulso falhou, ou ele mandou `null` porque o
     * banco não respondeu). `desfechoDaSaude` é quem decide, e é ele que sai no `dataset`.
     * @returns {HTMLElement}
     */
    _cartaoDeSaude() {
        const box = document.createElement('div');
        box.className = 'admin-diag__saude-cartao';

        const cabeca = document.createElement('div');
        cabeca.className = 'admin-diag__saude-cabeca';
        const titulo = document.createElement('h4');
        titulo.className = 'admin-diag__saude-titulo';
        titulo.textContent = saudeTitulo();
        const build = document.createElement('span');
        build.className = 'admin-diag__saude-build';
        build.dataset.testid = 'admin-diag-build';
        build.textContent = buildNoArLabel(this._release);
        cabeca.append(titulo, build);
        box.appendChild(cabeca);

        const fonte = this._fonteDaSaude;
        const doServidor = fonte === FONTE_DA_SAUDE.SERVIDOR;
        const releases = doServidor
            ? saudeDoServidor(this._releases)
            : saudeDasReleases(this._defeitos);
        const definicoes = doServidor ? NUMEROS_DA_SAUDE_DO_SERVIDOR : NUMEROS_DA_SAUDE;
        // O DESFECHO SAI COMO DADO, e não só a metade booleana: é ele que uma captura de tela
        // consegue afirmar, e são três estados, não dois.
        box.dataset.fonte = fonte;

        if (releases.length === 0) {
            const vazio = document.createElement('p');
            vazio.className = 'admin-diag__saude-vazio';
            vazio.textContent = saudeVaziaNotice();
            box.appendChild(vazio);
        } else {
            const lista = document.createElement('ul');
            lista.className = 'admin-diag__saude-lista';
            lista.dataset.testid = 'admin-diag-saude-lista';
            for (const r of releases) {
                lista.appendChild(this._blocoDeRelease(r, definicoes));
            }
            box.appendChild(lista);
        }

        const rodape = document.createElement('p');
        rodape.className = 'admin-diag__saude-nota';
        rodape.dataset.testid = 'admin-diag-saude-fonte';
        rodape.textContent = saudeFonteNotice(fonte);
        box.appendChild(rodape);

        // A NOTA DE ALCANCE SÓ VALE PARA A CONTA DO CLIENTE: ela diz que a janela, os filtros e o
        // teto da consulta limitam o número, e nenhum dos três limita o resumo do servidor.
        // Repeti-la sob a conta do servidor seria uma ressalva falsa, que custa mais que ressalva
        // nenhuma.
        if (!doServidor) {
            const nota = document.createElement('p');
            nota.className = 'admin-diag__saude-nota';
            nota.textContent = saudeNotice();
            box.appendChild(nota);
        }
        return box;
    }

    /**
     * @private Um bloco do cartão de saúde.
     *
     * AS DEFINIÇÕES CHEGAM DE FORA, e é isso que faz o mesmo desenho servir as duas contas: quem
     * escolhe a fonte é `_cartaoDeSaude`, e uma segunda função de bloco divergiria da primeira no
     * primeiro ajuste de estilo.
     * @param {Object} r - Uma linha de `saudeDoServidor` ou de `saudeDasReleases`.
     * @param {ReadonlyArray<{campo: string, rotulo: string, titulo: string, formato?: string}>} definicoes
     * @returns {HTMLElement}
     */
    _blocoDeRelease(r, definicoes) {
        const li = document.createElement('li');
        li.className = 'admin-diag__saude-item';
        li.dataset.testid = 'admin-diag-saude-item';
        li.dataset.release = r.release;
        if (this._release && r.release === this._release) {
            li.classList.add('admin-diag__saude-item--no-ar');
        }

        const nome = document.createElement('span');
        nome.className = 'admin-diag__saude-release';
        nome.textContent = r.release;
        nome.title = r.release;
        li.appendChild(nome);

        const numeros = document.createElement('span');
        numeros.className = 'admin-diag__saude-numeros';
        for (const definicao of definicoes) {
            numeros.appendChild(numeroDaSaude(definicao, r[definicao.campo]));
        }
        li.appendChild(numeros);
        return li;
    }

    /**
     * @private A tabela de defeitos, com o corpo separado para poder ser repintado sozinho.
     * @returns {HTMLElement}
     */
    _tabelaDeDefeitos() {
        const table = document.createElement('table');
        table.className = 'admin-users__table admin-diag__table admin-diag__defeitos';
        table.dataset.testid = 'admin-diag-defeitos-tabela';

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of COLUNAS) {
            const th = document.createElement('th');
            th.textContent = h;
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        this._tbody = document.createElement('tbody');
        this._pintarLinhas();
        table.appendChild(this._tbody);
        return table;
    }

    /**
     * @private As linhas, a partir do que está em `this._defeitos`.
     *
     * O REPINTE É INTEIRO, e não por linha, porque o estado da tela (gaveta aberta, ocorrência
     * selecionada, pedido em voo) mora em `Set`/`Map` do objeto e não no DOM: reconstruir do
     * modelo é o que garante que a linha desenhada seja a que o servidor devolveu.
     */
    _pintarLinhas() {
        if (!this._tbody) return;
        // O ESCOPO É PRÓPRIO, e não o `'view'` do resto da aba. Este método roda de dez sítios
        // (todo ato de ciclo de vida, toda abertura de gaveta, toda resposta de ocorrência) e
        // registra vários ouvintes POR LINHA (o botão da gaveta, cada ato, os três do formulário
        // de commit, a pilha e cada ocorrência); com o escopo da aba, que só `_render` limpa, uma
        // tabela cheia deixaria centenas de entradas por repinte segurando nós já destacados da
        // árvore. Limpar aqui é o que faz o custo ser o da TELA, e não o do uso.
        clearScopedListeners(this, 'linhas');
        this._tbody.replaceChildren();
        const agora = Date.now();
        for (const item of this._defeitos) {
            this._tbody.appendChild(this._linhaDeDefeito(item, agora));
            this._tbody.appendChild(this._linhaDeGaveta(item));
        }
    }

    /**
     * @private Uma linha de defeito.
     * @param {Object} item @param {number} agora
     * @returns {HTMLTableRowElement}
     */
    _linhaDeDefeito(item, agora) {
        const tr = document.createElement('tr');
        tr.dataset.testid = 'admin-diag-defeito-linha';
        tr.dataset.id = String(item?.id ?? '');
        tr.dataset.estado = String(item?.estado ?? '');

        tr.appendChild(this._celulaDeEstado(item));

        const contagem = document.createElement('td');
        contagem.className = 'admin-diag__numero';
        // O CRACHÁ SAI NOMEADO PELO QUE ELE É: acumulado de relatos, com as duas pontas do
        // intervalo no `title`. Ver `contagemNotice`.
        contagem.appendChild(contagemBadge(item?.ocorrencias, {
            unidade: contagemHistoricaUnidade(),
            detalhe: contagemHistoricaDetalhe(item),
        }));
        tr.appendChild(contagem);

        tr.appendChild(celulaDeTexto(origemLabel(item?.origem), 'admin-diag__origem'));
        tr.appendChild(this._celulaDeMensagem(item));
        tr.appendChild(celulaDeTexto(paginaLabel(item), 'admin-diag__pagina',
            typeof item?.url === 'string' ? item.url : ''));

        const releases = celulaDeTexto(releasesDoDefeito(item) || '—', 'admin-diag__releases',
            releasesDetalhe(item));
        tr.appendChild(releases);

        const quando = celulaDeTexto(tempoRelativo(item?.ultimaEm, agora) || '—',
            'admin-diag__quando', intervaloDeOcorrencias(item?.primeiraEm, item?.ultimaEm));
        tr.appendChild(quando);

        tr.appendChild(this._celulaDeAcoes(item));
        return tr;
    }

    /**
     * @private A célula de estado: o chip do ciclo de vida, mais o selo "novo".
     * @param {Object} item
     * @returns {HTMLTableCellElement}
     */
    _celulaDeEstado(item) {
        const td = document.createElement('td');
        td.className = 'admin-diag__estado-celula';

        const chip = document.createElement('span');
        const tom = estadoTom(item?.estado);
        chip.className = `admin-diag__estado admin-diag__estado--${tom}`;
        chip.dataset.testid = 'admin-diag-estado';
        chip.dataset.estado = String(item?.estado ?? '');
        chip.textContent = estadoLabel(item?.estado);
        chip.title = estadoDescricao(item?.estado);
        td.appendChild(chip);

        if (ehNovo(item, this._marcaDeVisita)) {
            const novo = document.createElement('span');
            novo.className = 'admin-diag__novo';
            novo.dataset.testid = 'admin-diag-novo';
            novo.textContent = novoChipLabel();
            novo.title = novoChipTitulo(horaLocal(this._marcaDeVisita));
            td.appendChild(novo);
        }
        return td;
    }

    /**
     * @private A célula da mensagem, com o botão que abre a gaveta.
     * @param {Object} item
     * @returns {HTMLTableCellElement}
     */
    _celulaDeMensagem(item) {
        const td = document.createElement('td');
        td.className = 'admin-diag__mensagem';

        const texto = document.createElement('p');
        texto.className = 'admin-diag__assinatura';
        texto.textContent = mensagemLabel(item);
        // O texto INTEIRO no `title`: o corte de `resumirTexto` é de layout, e a mensagem completa
        // é o que se copia para procurar no código.
        if (typeof item?.mensagem === 'string' && item.mensagem.trim()) texto.title = item.mensagem;
        td.appendChild(texto);

        const aberto = this._abertos.has(item?.id);
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'admin-btn admin-btn--ghost admin-diag__gaveta-botao';
        botao.dataset.testid = 'admin-diag-gaveta-botao';
        botao.textContent = aberto ? gavetaFecharLabel() : gavetaAbrirLabel();
        botao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        addScopedDomListener(this, 'linhas', botao, 'click', () => this._alternarGaveta(item));
        td.appendChild(botao);

        const resolucao = resolucaoNotice(item, horaLocalCompleta(item?.resolvidoEm));
        if (resolucao) {
            const p = document.createElement('p');
            p.className = 'admin-diag__resolucao';
            p.dataset.testid = 'admin-diag-resolucao';
            p.textContent = resolucao;
            td.appendChild(p);
        }
        return td;
    }

    /**
     * @private A célula de ações, com o formulário de commit quando ele está aberto.
     * @param {Object} item
     * @returns {HTMLTableCellElement}
     */
    _celulaDeAcoes(item) {
        const td = document.createElement('td');
        td.className = 'admin-diag__acoes';

        const emVoo = this._emVoo.has(item?.id);
        for (const acao of acoesDoEstado(item?.estado)) {
            td.appendChild(this._botaoDeAcao(item, acao, emVoo));
        }
        if (this._pedindoCommit.has(item?.id)) {
            td.appendChild(this._formularioDeCommit(item));
        }
        return td;
    }

    /**
     * @private Um botão de ciclo de vida.
     *
     * `aria-disabled` E NUNCA A PROPRIEDADE `disabled`: o bloqueio aqui é de ESTADO (há um pedido
     * em voo, e ele termina), e um botão desabilitado não dispara clique, de modo que a pessoa não
     * receberia motivo nenhum. Ver a convenção da casa em `.claude/rules/architecture.md`.
     * @param {Object} item @param {string} acao @param {boolean} emVoo
     * @returns {HTMLButtonElement}
     */
    _botaoDeAcao(item, acao, emVoo) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'admin-btn admin-btn--ghost admin-diag__acao';
        btn.dataset.testid = 'admin-diag-acao';
        btn.dataset.acao = acao;
        if (emVoo) {
            btn.textContent = acaoEmVooLabel(acao);
            btn.setAttribute('aria-disabled', 'true');
            btn.title = acaoEmVooNotice();
        } else {
            btn.textContent = acaoLabel(acao);
        }
        addScopedDomListener(this, 'linhas', btn, 'click', () => {
            if (this._emVoo.has(item?.id)) {
                showError(acaoEmVooNotice());
                return;
            }
            if (acao === ACAO.RESOLVER && !this._pedindoCommit.has(item?.id)) {
                this._pedindoCommit.add(item?.id);
                this._pintarLinhas();
                return;
            }
            this._mudarEstado(item, acao);
        });
        return btn;
    }

    /**
     * @private O campo de commit, inline na própria linha.
     *
     * INLINE E NÃO MODAL, e sem confirmação: os três atos desta tela são reversíveis a partir da
     * mesma linha (reabrir desfaz os dois outros), e confirmar tudo treina a confirmar sem ler, o
     * que torna inútil a confirmação do ato que de fato destrói. O campo é OPCIONAL: resolver sem
     * saber o hash é desfecho legítimo, e exigi-lo faria a pessoa inventar um valor.
     * @param {Object} item
     * @returns {HTMLElement}
     */
    _formularioDeCommit(item) {
        const box = document.createElement('div');
        box.className = 'admin-diag__commit';
        box.dataset.testid = 'admin-diag-commit';

        const id = `admin-diag-commit-${item?.id}`;
        const label = document.createElement('label');
        label.className = 'admin-diag__filtro-label';
        label.htmlFor = id;
        label.textContent = commitLabel();
        box.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.id = id;
        input.className = 'admin-input admin-input--sm';
        input.dataset.testid = 'admin-diag-commit-input';
        input.placeholder = commitPlaceholder();
        input.title = commitHint();
        // O QUE FOI DIGITADO SOBREVIVE AO REPINTE: sem isto, uma resposta de gaveta chegando no
        // meio da digitação apagava o hash sem nada dizer.
        input.value = this._commitDigitado.get(item?.id) ?? '';
        addScopedDomListener(this, 'linhas', input, 'input', () => {
            this._commitDigitado.set(item?.id, input.value);
        });
        box.appendChild(input);

        const confirmar = document.createElement('button');
        confirmar.type = 'button';
        confirmar.className = 'admin-btn admin-btn--primary';
        confirmar.dataset.testid = 'admin-diag-commit-confirmar';
        confirmar.textContent = confirmarLabel();
        addScopedDomListener(this, 'linhas', confirmar, 'click', () => {
            // A MESMA RECUSA DOS BOTÕES DE AÇÃO, e não um `return` mudo: com um pedido em voo, o
            // clique aqui não fazia nada e não dizia nada.
            if (this._emVoo.has(item?.id)) {
                showError(acaoEmVooNotice());
                return;
            }
            this._mudarEstado(item, ACAO.RESOLVER, input.value);
        });
        box.appendChild(confirmar);

        const cancelar = document.createElement('button');
        cancelar.type = 'button';
        cancelar.className = 'admin-btn admin-btn--ghost';
        cancelar.dataset.testid = 'admin-diag-commit-cancelar';
        cancelar.textContent = cancelarLabel();
        addScopedDomListener(this, 'linhas', cancelar, 'click', () => {
            this._pedindoCommit.delete(item?.id);
            this._commitDigitado.delete(item?.id);
            this._pintarLinhas();
        });
        box.appendChild(cancelar);

        const dica = document.createElement('p');
        dica.className = 'admin-diag__commit-dica';
        dica.textContent = commitHint();
        box.appendChild(dica);
        return box;
    }

    /**
     * @private Manda o `PATCH` e RELÊ A LINHA DA RESPOSTA.
     *
     * O NÚMERO E O ESTADO QUE A LINHA MOSTRA SÃO OS QUE O SERVIDOR MANDOU, nunca os que o clique
     * pediu, e é a regra que atravessa os módulos de frase desta casa. Aqui ela tem dentes: o
     * servidor carimba `resolvido_na_release` sozinho, e é essa release (e não o commit digitado)
     * que decide se uma ocorrência futura vira regressão. Anunciar o pedido esconderia justamente
     * o campo que governa a transição seguinte.
     *
     * RESPOSTA SEM ITEM RECONHECÍVEL NÃO É TRATADA COMO SUCESSO SILENCIOSO: a tela recarrega, o
     * que é o único jeito honesto de mostrar o que ficou no servidor.
     * @param {Object} item @param {string} acao @param {string} [commit]
     */
    async _mudarEstado(item, acao, commit) {
        const id = item?.id;
        const estado = estadoAlvoDaAcao(acao);
        if (!id || !estado || this._emVoo.has(id)) return;

        const corpo = { estado };
        const hash = typeof commit === 'string' ? commit.trim() : '';
        if (hash) corpo.commit = hash;

        this._emVoo.add(id);
        this._pedindoCommit.delete(id);
        this._pintarLinhas();

        let atualizado = null;
        try {
            atualizado = await mudarEstadoDoDefeito(id, corpo);
            showSuccess(acaoSucessoNotice(atualizado));
        } catch (error) {
            // A ORDEM É A DE `_falha`, e invertê-la é o que fazia a tela mostrar "Failed to fetch"
            // cru, em inglês, como se fosse a frase do produto. A mensagem do servidor não se
            // perde (um 404 aqui significa que a poda passou por cima do defeito, e um 403 que o
            // papel mudou no meio da sessão), mas ela entra DEPOIS da frase da casa e cortada.
            const cru = typeof error?.message === 'string' ? error.message.trim() : '';
            showError(cru
                ? `${acaoFalhaNotice(acao)} ${resumirTexto(cru, 200)}`
                : acaoFalhaNotice(acao));
        } finally {
            this._emVoo.delete(id);
        }
        if (!this._alive) return;
        if (atualizado && atualizado.id === id && typeof atualizado.estado === 'string') {
            this._commitDigitado.delete(id);
            this._defeitos = this._defeitos.map((d) => (d.id === id ? atualizado : d));
            this._pintarLinhas();
            this._repintarDerivados();
            return;
        }
        this._carregar();
    }

    /**
     * @private Abre ou fecha a gaveta de ocorrências de um defeito.
     * @param {Object} item
     */
    _alternarGaveta(item) {
        const id = item?.id;
        if (!id) return;
        if (this._abertos.has(id)) {
            this._abertos.delete(id);
        } else {
            this._abertos.add(id);
            // A LEITURA É NA PRIMEIRA ABERTURA, e não na carga da lista: cinquenta defeitos vezes
            // vinte ocorrências seria mil linhas buscadas para mostrar zero. O cache por id
            // sobrevive ao fechar e reabrir, e some com a recarga da aba.
            if (!this._ocorrencias.has(id)) this._carregarOcorrencias(item);
        }
        this._pintarLinhas();
    }

    /**
     * @private Lê as ocorrências de um defeito, uma vez.
     * @param {Object} item
     */
    async _carregarOcorrencias(item) {
        const id = item?.id;
        if (!id || this._buscando.has(id)) return;
        this._buscando.add(id);
        try {
            const dados = await pedirDiag(`/diag/defeitos/${encodeURIComponent(id)}/ocorrencias`);
            const itens = listaDoPayload(dados, 'itens');
            // LISTA AUSENTE É FALHA, e nunca "nenhuma ocorrência": é a mesma decisão de
            // `estadoDaSecao`, e aqui ela importa igual, porque o vazio desta gaveta tem
            // significado próprio (a poda passou por cima das ocorrências).
            this._ocorrencias.set(id, Array.isArray(itens)
                ? { itens }
                : { erro: new Error('A resposta não trouxe a lista de ocorrências.') });
        } catch (error) {
            this._ocorrencias.set(id, { erro: error });
        } finally {
            this._buscando.delete(id);
        }
        if (this._alive) this._pintarLinhas();
    }

    /**
     * @private A linha oculta que carrega a gaveta.
     * @param {Object} item
     * @returns {HTMLTableRowElement}
     */
    _linhaDeGaveta(item) {
        const tr = document.createElement('tr');
        tr.className = 'admin-diag__gaveta-linha';
        tr.dataset.testid = 'admin-diag-gaveta';
        tr.dataset.id = String(item?.id ?? '');
        const aberta = this._abertos.has(item?.id);
        // `hidden` E NÃO REMOÇÃO DA LINHA: a tabela mantém a paridade de linhas, e o repinte não
        // precisa saber quantas gavetas existem.
        tr.hidden = !aberta;
        const td = document.createElement('td');
        td.colSpan = COLUNAS.length;
        if (aberta) td.appendChild(this._conteudoDaGaveta(item));
        tr.appendChild(td);
        return tr;
    }

    /**
     * @private O conteúdo da gaveta: as ocorrências, a trilha da selecionada e as pilhas.
     * @param {Object} item
     * @returns {HTMLElement}
     */
    _conteudoDaGaveta(item) {
        const box = document.createElement('div');
        box.className = 'admin-diag__gaveta';

        const assinatura = document.createElement('p');
        assinatura.className = 'admin-diag__gaveta-assinatura';
        assinatura.textContent = resumirTexto(item?.assinatura, 240) || '—';
        if (typeof item?.assinatura === 'string' && item.assinatura.trim()) {
            assinatura.title = item.assinatura;
        }
        box.appendChild(assinatura);

        const leitura = this._ocorrencias.get(item?.id);
        if (!leitura) {
            const p = document.createElement('p');
            p.className = 'admin-users__status';
            p.textContent = ocorrenciasCarregandoNotice();
            box.appendChild(p);
        } else if (leitura.erro) {
            const detalhe = typeof leitura.erro?.message === 'string' && leitura.erro.message.trim()
                ? `${ocorrenciasFailureNotice()} ${resumirTexto(leitura.erro.message, 200)}`
                : ocorrenciasFailureNotice();
            box.appendChild(failureState(detalhe, {
                onRetry: () => {
                    this._ocorrencias.delete(item?.id);
                    this._carregarOcorrencias(item);
                    this._pintarLinhas();
                },
            }));
        } else if (leitura.itens.length === 0) {
            box.appendChild(emptyState(ocorrenciasEmptyNotice(), { hint: ocorrenciasEmptyHint() }));
        } else {
            box.appendChild(this._blocoDeOcorrencias(item, leitura.itens));
        }

        const pilha = blocoDePilha(item?.stack, 'admin-diag-defeito-pilha', {
            extras: extrasDoDefeito(item),
            bruta: item?.stackBruta,
            aberta: this._pilhasAbertas.has(item?.id),
        });
        if (pilha) {
            // A PILHA ABERTA SOBREVIVE AO REPINTE pelo mesmo motivo do campo de commit: ela é a
            // coisa mais longa desta tela para se ler, e era fechada na cara de quem lia.
            addScopedDomListener(this, 'linhas', pilha, 'toggle', () => {
                if (pilha.open) this._pilhasAbertas.add(item?.id);
                else this._pilhasAbertas.delete(item?.id);
            });
            box.appendChild(pilha);
        }
        return box;
    }

    /**
     * @private As ocorrências e a trilha da que está selecionada.
     * @param {Object} item @param {Array<Object>} ocorrencias
     * @returns {HTMLElement}
     */
    _blocoDeOcorrencias(item, ocorrencias) {
        const box = document.createElement('div');
        box.className = 'admin-diag__ocorrencias';

        const titulo = document.createElement('p');
        titulo.className = 'admin-diag__ocorrencias-titulo';
        titulo.dataset.testid = 'admin-diag-ocorrencias-titulo';
        titulo.textContent = ocorrenciasTitulo(ocorrencias.length);
        box.appendChild(titulo);

        const escolhida = Math.min(this._selecionada.get(item?.id) ?? 0, ocorrencias.length - 1);
        const lista = document.createElement('ul');
        lista.className = 'admin-diag__ocorrencias-lista';
        lista.dataset.testid = 'admin-diag-ocorrencias-lista';
        ocorrencias.forEach((oc, indice) => {
            lista.appendChild(this._linhaDeOcorrencia(item, oc, indice, indice === escolhida));
        });
        box.appendChild(lista);

        box.appendChild(blocoDeMigalhas(ocorrencias[escolhida]));
        return box;
    }

    /**
     * @private Uma ocorrência, clicável para trocar a trilha exibida.
     * @param {Object} item @param {Object} oc @param {number} indice @param {boolean} ativa
     * @returns {HTMLElement}
     */
    _linhaDeOcorrencia(item, oc, indice, ativa) {
        const li = document.createElement('li');
        li.className = 'admin-diag__ocorrencia';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = ativa
            ? 'admin-diag__ocorrencia-botao admin-diag__ocorrencia-botao--ativa'
            : 'admin-diag__ocorrencia-botao';
        btn.dataset.testid = 'admin-diag-ocorrencia';
        btn.setAttribute('aria-pressed', ativa ? 'true' : 'false');

        const quando = horaLocalCompleta(oc?.em);
        if (quando) btn.appendChild(pedaco(quando, 'admin-diag__meta-quando'));
        const release = typeof oc?.release === 'string' ? oc.release.trim() : '';
        if (release) btn.appendChild(pedaco(release, 'admin-diag__meta-release'));
        btn.appendChild(pedaco(paginaLabel(oc), 'admin-diag__meta-alvo'));
        btn.appendChild(pedaco(usuarioLabel(oc), 'admin-diag__meta-usuario'));

        const navegador = pedaco(navegadorLabel(oc?.userAgent), 'admin-diag__meta-navegador');
        // O USER AGENT INTEIRO no `title`, e a família no texto: ver `navegadorLabel`.
        if (typeof oc?.userAgent === 'string' && oc.userAgent.trim()) {
            navegador.title = oc.userAgent;
        }
        btn.appendChild(navegador);

        const sessao = sessaoCurta(oc?.sessaoId);
        if (sessao) {
            const el = pedaco(sessao, 'admin-diag__meta-sessao');
            el.title = String(oc.sessaoId);
            btn.appendChild(el);
        }
        const rota = rotaEStatusLabel(oc);
        if (rota) btn.appendChild(pedaco(rota, 'admin-diag__meta-status'));

        addScopedDomListener(this, 'linhas', btn, 'click', () => {
            this._selecionada.set(item?.id, indice);
            this._pintarLinhas();
        });
        li.appendChild(btn);
        return li;
    }

    /**
     * @private Seção 3: a latência por rota, com o p95 em evidência.
     * @param {HTMLElement} host @param {PromiseSettledResult<*>} resultado @param {string} janela
     */
    _pintarLatencia(host, resultado, janela) {
        host.replaceChildren();
        host.appendChild(sectionHeader('Latência por rota', {
            subtitle: 'Da mais lenta para a mais rápida, medida pelo p95',
        }));

        const nota = document.createElement('p');
        nota.className = 'admin-diag__nota';
        nota.dataset.testid = 'admin-diag-latencia-escopo';
        nota.textContent = slowScopeNotice();
        host.appendChild(nota);

        const wrap = card({ testid: 'admin-diag-latencia-card', padded: false });
        host.appendChild(wrap);

        const erro = resultado.status === 'rejected' ? resultado.reason : null;
        const payload = erro ? null : resultado.value;
        const rotas = erro ? null : listaDoPayload(payload, 'rotas');
        const estado = estadoDaSecao({ erro, itens: rotas });

        if (estado === ESTADO.FALHA) {
            this._falha(wrap, slowFailureNotice(), erro);
            return;
        }
        // A OUTRA SEÇÃO QUE LÊ O MESMO LOG, e portanto a outra que fica cega do mesmo jeito.
        // "Nenhuma rota medida" sem diretório de log é afirmação sobre o leitor.
        if (leitorCego(payload)) {
            wrap.appendChild(failureState(leitorCegoNotice(), {
                onRetry: () => { if (this._alive) this._carregar(); },
            }));
            this._notasDaLeitura(host, payload);
            return;
        }
        // A NOTA VAI NOS TRÊS DESFECHOS INFORMATIVOS, e não só no da tabela. Ela morava apenas no
        // ramo da lista, de modo que "nenhuma rota com latência medida" saía sem dizer o que foi
        // varrido e sem acusar truncamento: o vazio que a seção mais precisa qualificar era o
        // único que não vinha qualificado.
        if (estado === ESTADO.VAZIO) {
            wrap.appendChild(emptyState(slowEmptyNotice(janela), { hint: slowEmptyHint() }));
            this._notasDaLeitura(host, payload);
            return;
        }

        const table = document.createElement('table');
        table.className = 'admin-users__table admin-diag__table';
        table.dataset.testid = 'admin-diag-latencia-tabela';
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of ['Rota', 'Chamadas', 'p50', 'p95', 'Máx']) {
            const th = document.createElement('th');
            th.textContent = h;
            if (h === 'p95') {
                th.className = 'admin-diag__p95';
                th.title = 'Em vinte chamadas, uma passa deste tempo.';
            }
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const linhas = ordenarRotas(rotas);
        const tbody = document.createElement('tbody');
        for (const linha of linhas) {
            tbody.appendChild(linhaDeLatencia(linha));
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        // O CORTE DITO EM VOZ ALTA: quinze rotas de duzentas é outra tela que quinze de quinze, e
        // sem a frase quem lê conclui que o serviço tem quinze rotas.
        this._notasDaLeitura(host, payload, {
            mostrados: linhas.length,
            total: payload?.total,
            unidade: 'rotas',
        });
    }
}

// ===== small DOM builders =====

/**
 * A taxa de erro do pulso. A aritmética (e as duas saídas que não são o número) mora em
 * `diag-phrases.js`.
 * @param {*} dados
 * @returns {string|null}
 */
function taxaDoPulso(dados) {
    return taxaDeErro({ total: dados?.total, erros: dados?.erros });
}

/**
 * Um ladrilho de número grande com rótulo.
 * @param {string} rotulo @param {string} valor @param {string} testid
 * @param {{estado?: string}} [opts]
 * @returns {HTMLElement}
 */
function tile(rotulo, valor, testid, { estado } = {}) {
    const el = document.createElement('div');
    el.className = estado ? `admin-diag__tile admin-diag__tile--${estado}` : 'admin-diag__tile';
    el.dataset.testid = testid;
    // O estado também sai como dado, como no p95 da tabela de latência: a cor é o que a pessoa lê,
    // e o atributo é o que uma captura de tela consegue afirmar.
    if (estado) el.dataset.estado = estado;
    const v = document.createElement('span');
    v.className = 'admin-diag__tile-valor';
    v.textContent = valor;
    const r = document.createElement('span');
    r.className = 'admin-diag__tile-rotulo';
    r.textContent = rotulo;
    el.append(v, r);
    return el;
}

/**
 * Um par número/rótulo do cartão de saúde.
 *
 * O RÓTULO E O QUE ELE SIGNIFICA vêm de `NUMEROS_DA_SAUDE` / `NUMEROS_DA_SAUDE_DO_SERVIDOR`
 * (`defeito-phrases.js`), e o `campo` amarra os dois ao número: com os literais escritos aqui,
 * trocar dois deles de lugar não ficaria vermelho em lugar nenhum. É lá também que mora a razão de
 * "nascidos aqui" não se chamar "novos", que é a terceira palavra "novo" desta tela.
 *
 * O `formato` DESPACHA A FUNÇÃO DE TEXTO aqui, e não no módulo de frases: `taxaDeErroLabel` mora
 * em `defeito-phrases.js` (que é zero imports) e `contagemLabel` em `diag-phrases.js`, então este
 * é o único ponto que tem as duas à mão sem quebrar o contrato de nenhum dos dois.
 * @param {{campo: string, rotulo: string, titulo: string, formato?: string}} definicao
 * @param {number} valor
 * @returns {HTMLElement}
 */
function numeroDaSaude(definicao, valor) {
    const el = document.createElement('span');
    el.className = 'admin-diag__saude-numero';
    el.dataset.testid = `admin-diag-saude-${definicao.campo}`;
    el.title = definicao.titulo;
    const n = document.createElement('strong');
    n.textContent = definicao.formato === 'percentual'
        ? taxaDeErroLabel(valor)
        : contagemLabel(valor);
    const r = document.createElement('span');
    r.textContent = ` ${definicao.rotulo}`;
    el.append(n, r);
    return el;
}

/**
 * A contagem em destaque, o segundo elemento de toda linha de defeito.
 *
 * O PESO É CLASSE, e não só texto. Mil ocorrências de um defeito e uma de outro não podem ter o
 * mesmo peso visual, e o valor da escada (`pesoDaContagem`) é o que permite à folha de estilo
 * separá-los sem que esta função saiba de cor nenhuma.
 * @param {*} n
 * @param {{detalhe?: string, unidade?: string}} [opts]
 * @returns {HTMLElement}
 */
function contagemBadge(n, { detalhe, unidade } = {}) {
    const el = document.createElement('span');
    const peso = pesoDaContagem(n);
    el.className = `admin-diag__contagem admin-diag__contagem--${peso}`;
    el.dataset.testid = 'admin-diag-contagem';
    el.dataset.peso = peso;
    if (unidade) {
        const valor = document.createElement('span');
        valor.className = 'admin-diag__contagem-valor';
        valor.textContent = contagemLabel(n);
        const u = document.createElement('span');
        u.className = 'admin-diag__contagem-unidade';
        u.textContent = unidade;
        el.append(valor, u);
    } else {
        el.textContent = contagemLabel(n);
    }
    el.title = detalhe ?? contagemDetalhe(n);
    return el;
}

/**
 * Uma célula de texto simples, com o valor inteiro no `title` quando ele existe.
 * @param {string} texto @param {string} className @param {string} [titulo]
 * @returns {HTMLTableCellElement}
 */
function celulaDeTexto(texto, className, titulo) {
    const td = document.createElement('td');
    td.className = className;
    td.textContent = texto;
    if (titulo) td.title = titulo;
    return td;
}

/**
 * Os campos técnicos de um defeito que só fazem sentido abertos: a URL inteira, o user agent, a
 * versão do build, o atlas em foco e a aba.
 *
 * TODOS SÃO TEXTO DE TERCEIRO (o user agent inclusive: ele é o que o navegador declarar), e todos
 * saem por `textContent` na montagem do bloco.
 * @param {Object} item
 * @returns {Array<{rotulo: string, valor: string}>}
 */
function extrasDoDefeito(item) {
    const campos = [
        { rotulo: 'URL', valor: item?.url },
        { rotulo: 'Navegador', valor: item?.userAgent },
        { rotulo: 'Versão', valor: item?.release },
        { rotulo: 'Atlas', valor: item?.atlasId },
        { rotulo: 'Sessão', valor: item?.sessaoId },
        { rotulo: 'Primeira', valor: horaLocalCompleta(item?.primeiraEm) },
        { rotulo: 'Última', valor: horaLocalCompleta(item?.ultimaEm) },
    ];
    return campos
        .map((c) => ({ rotulo: c.rotulo, valor: typeof c.valor === 'string' ? c.valor.trim() : '' }))
        .filter((c) => c.valor);
}

/**
 * A trilha de migalhas de UMA ocorrência.
 *
 * ELA É DA OCORRÊNCIA E NUNCA DO DEFEITO, e a distinção é do schema: agregá-las na linha do
 * defeito guardaria as do último relato e jogaria fora as das outras dezenove, que é justamente a
 * informação. O `t` é epoch ms absoluto, o mesmo relógio das linhas do `.jsonl`, e é isso que
 * permite pôr a migalha lado a lado com o que o servidor escreveu naquele instante.
 * @param {Object} [ocorrencia]
 * @returns {HTMLElement}
 */
function blocoDeMigalhas(ocorrencia) {
    const box = document.createElement('div');
    box.className = 'admin-diag__migalhas';
    box.dataset.testid = 'admin-diag-migalhas';

    const titulo = document.createElement('p');
    titulo.className = 'admin-diag__migalhas-titulo';
    titulo.textContent = migalhasTitulo();
    box.appendChild(titulo);

    const migalhas = Array.isArray(ocorrencia?.migalhas) ? ocorrencia.migalhas : [];
    if (migalhas.length === 0) {
        const p = document.createElement('p');
        p.className = 'admin-diag__migalhas-vazia';
        p.textContent = migalhasVaziasNotice();
        box.appendChild(p);
        return box;
    }

    const lista = document.createElement('ol');
    lista.className = 'admin-diag__migalhas-lista';
    lista.dataset.testid = 'admin-diag-migalhas-lista';
    for (const m of migalhas) {
        const li = document.createElement('li');
        li.className = 'admin-diag__migalha';
        li.dataset.testid = 'admin-diag-migalha';
        const quando = horaLocalCompleta(m?.t);
        if (quando) li.appendChild(pedaco(quando, 'admin-diag__migalha-quando'));
        li.appendChild(pedaco(tipoDeMigalhaLabel(m), 'admin-diag__migalha-tipo'));
        // O TEXTO É DE TERCEIRO, como a mensagem e a pilha: `textContent`, sempre.
        li.appendChild(pedaco(textoDeMigalhaLabel(m), 'admin-diag__migalha-texto'));
        lista.appendChild(li);
    }
    box.appendChild(lista);
    return box;
}

/**
 * O bloco expansível com a pilha.
 *
 * `<details>` FECHADO, e não um painel sempre aberto: uma pilha ocupa a tela inteira e a lista
 * existe para comparar defeitos. A pilha entra num `<pre>` por `textContent`, porque é texto
 * arbitrário vindo do navegador de quem visitou a página pública.
 *
 * A PILHA BRUTA VAI DENTRO, e não ao lado: a normalizada é a que casa com a assinatura e é a que
 * se lê; a bruta é a que ainda tem o hash do bundle e serve para `npm run diag -- pilha`, que é um
 * gesto de terminal, não de tela.
 *
 * Sem pilha e sem extras não nasce bloco nenhum: um `<details>` que abre para o vazio é pior que a
 * ausência dele, porque promete conteúdo.
 * @param {*} stack @param {string} testid
 * @param {{extras?: Array<{rotulo: string, valor: string}>, bruta?: *, aberta?: boolean}} [opts]
 * @returns {HTMLElement|null}
 */
function blocoDePilha(stack, testid, { extras = [], bruta, aberta = false } = {}) {
    const texto = typeof stack === 'string' ? stack.trim() : '';
    const crua = typeof bruta === 'string' ? bruta.trim() : '';
    if (!texto && !crua && extras.length === 0) return null;

    const det = document.createElement('details');
    det.className = 'admin-diag__pilha';
    det.dataset.testid = testid;
    det.open = aberta === true;
    const sum = document.createElement('summary');
    sum.className = 'admin-diag__pilha-resumo';
    sum.textContent = texto ? 'Ver a pilha e os detalhes' : 'Ver os detalhes';
    det.appendChild(sum);

    if (extras.length) {
        const dl = document.createElement('dl');
        dl.className = 'admin-diag__extras';
        for (const campo of extras) {
            const dt = document.createElement('dt');
            dt.textContent = campo.rotulo;
            const dd = document.createElement('dd');
            dd.textContent = campo.valor;
            dl.append(dt, dd);
        }
        det.appendChild(dl);
    }

    if (texto) {
        const pre = document.createElement('pre');
        pre.className = 'admin-diag__pilha-corpo';
        pre.textContent = texto;
        det.appendChild(pre);
    }

    if (crua && crua !== texto) {
        const interno = document.createElement('details');
        interno.className = 'admin-diag__pilha-bruta';
        interno.dataset.testid = 'admin-diag-pilha-bruta';
        const resumo = document.createElement('summary');
        resumo.className = 'admin-diag__pilha-resumo';
        resumo.textContent = pilhaBrutaResumo();
        const pre = document.createElement('pre');
        pre.className = 'admin-diag__pilha-corpo';
        pre.textContent = crua;
        interno.append(resumo, pre);
        det.appendChild(interno);
    }
    return det;
}

/**
 * Uma linha da tabela de latência. O p95 é a única célula com peso e cor: ver `slowScopeNotice`.
 * @param {Object} linha
 * @returns {HTMLTableRowElement}
 */
function linhaDeLatencia(linha) {
    const tr = document.createElement('tr');
    tr.dataset.testid = 'admin-diag-latencia-linha';

    const rota = document.createElement('td');
    rota.className = 'admin-diag__rota';
    rota.textContent = rotaLabel(linha);
    if (typeof linha?.rota === 'string' && linha.rota.trim()) rota.title = linha.rota;
    tr.appendChild(rota);

    tr.appendChild(celulaNumerica(contagemLabel(linha?.n), contagemDetalhe(linha?.n)));
    tr.appendChild(celulaNumerica(latenciaLabel(linha?.p50)));

    const estado = estadoDaLatencia(linha?.p95);
    const p95 = celulaNumerica(latenciaLabel(linha?.p95));
    p95.className = `admin-diag__numero admin-diag__p95 admin-diag__p95--${estado}`;
    p95.dataset.testid = 'admin-diag-p95';
    p95.dataset.estado = estado;
    tr.appendChild(p95);

    tr.appendChild(celulaNumerica(latenciaLabel(linha?.max)));
    return tr;
}

/**
 * @param {string} texto @param {string} [titulo]
 * @returns {HTMLTableCellElement}
 */
function celulaNumerica(texto, titulo) {
    const td = document.createElement('td');
    td.className = 'admin-diag__numero';
    td.textContent = texto;
    if (titulo) td.title = titulo;
    return td;
}

/**
 * @param {string} texto @param {string} className
 * @returns {HTMLElement}
 */
function pedaco(texto, className) {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = texto;
    return el;
}

/**
 * O vazio que é BOA NOTÍCIA.
 *
 * Ele é o `emptyState` da casa com uma classe a mais, e não um bloco novo: a forma continua sendo
 * a que as outras abas usam, e o que muda é só o sinal. "Nenhum defeito nas últimas 24 horas" é o
 * melhor desfecho possível desta tela, e desenhá-lo com a mesma cara cinzenta de "nenhum resultado
 * para o seu filtro" ensina a pessoa a ler saúde como defeito. É por isso que o vazio COM filtro
 * não passa por aqui.
 * @param {string} mensagem @param {string} dica
 * @returns {HTMLElement}
 */
function bomVazio(mensagem, dica) {
    const el = emptyState(mensagem, { hint: dica });
    el.classList.add('admin-diag__ok');
    el.dataset.testid = 'admin-diag-ok';
    return el;
}
