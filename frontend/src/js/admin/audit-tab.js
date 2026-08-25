// Path: js/admin/audit-tab.js

/**
 * @fileoverview Aba "Auditoria" — a trilha de atos do servidor (`audit_trail`), lida por
 * `GET /api/v1/audit`.
 *
 * DUAS AUDIÊNCIAS, UMA TELA. O administrador global lê a trilha inteira e ganha UMA coluna
 * e UM filtro a mais (a OM do acervo); o PRODUTOR lê a trilha da OM dele e não vê nem a
 * coluna nem o filtro — porque para ele a resposta inteira já é de uma OM só, e oferecer o
 * filtro seria oferecer um controle sem efeito. Quem decide não é esta tela: o servidor
 * manda `administra` na resposta e a tela OBEDECE, em vez de deduzir o papel da sessão. O
 * credenciado não chega aqui (`admin-audience.js` não lhe dá a aba, e o gate do servidor
 * lhe daria 403).
 *
 * O REQUISITO PRINCIPAL É NÃO VIRAR DUMP, e ele governa quatro decisões:
 *
 *   1. **O padrão é 7 dias**, não "tudo". Abrir a trilha inteira de um sistema com meses
 *      de uso entrega uma parede de texto onde nada se acha.
 *   2. **Agrupamento por DIA**, com cabeçalho pegajoso. Cinquenta carimbos de data
 *      idênticos não se leem; "Hoje" e uma hora se leem.
 *   3. **Uma FRASE por linha** (`audit-phrases.js`), em vez de cinco colunas de código em
 *      maiúsculas. O código cru só aparece quando a ação não tem frase — de propósito,
 *      para que uma ação nova sem tradução seja visível em vez de virar "Desconhecido".
 *   4. **O `details` fica atrás de um botão.** Ele é o dado bruto, e dado bruto na linha
 *      é o que transforma a lista num log. Dentro da gaveta o DE-PARA vem primeiro e em
 *      frases (`linhasDoDePara`), com o regime dito por extenso: desde 2026-08-21 a trilha
 *      grava o que mudou em três regimes, e uma impressão de doze hexadecimais sem a
 *      palavra "impressão" ao lado lê-se como um valor gravado.
 *
 * ELA VIROU UMA `<table>` EM 2026-08-25, e isso é conserto, não gosto. A lista era a única
 * das sete abas sem tabela: `<section>` por dia e `<div>` com flex por linha, contra o
 * `admin-users__table` que as outras cinco reusam. O preço não era estético — sem `<th>`
 * nenhum, o leitor de tela anunciava cinco pedaços de texto por linha sem dizer o que cada
 * um era. Hora, ator, ação e alvo eram indistinguíveis de cor de fundo.
 *
 * O QUE A TABELA PRECISAVA CONCILIAR era o agrupamento por dia, que é bom e fica. A saída é
 * UM `<tbody>` POR DIA, com o cabeçalho do dia numa `<tr>` própria carregando um
 * `<th scope="colgroup">`: o agrupamento passa a ser estrutura da tabela em vez de um
 * `<section>` ao lado dela, e o `position: sticky` continua funcionando porque ele vive no
 * `<th>`, que é onde os navegadores o suportam (numa `<tr>` ou num `<thead>` ele é ignorado
 * por parte deles).
 *
 * A GAVETA VIROU UMA `<tr>` IRMÃ, logo abaixo da linha, com um `<td colspan>`. Isso conserta
 * de lado uma incoerência que ninguém tinha nomeado: o botão "Detalhes" entrava num pai e a
 * gaveta em OUTRO, então o botão saía à direita da sigla da OM e o painel abria embaixo, à
 * esquerda. Agora os dois pertencem à mesma linha lógica e a ordem do DOM é a ordem da tela.
 *
 * A DATA DE CORTE É DECLARADA, e isso não é adorno: o eixo de OM foi retroagido por um
 * backfill que atribuiu a história antiga à OM ATUAL do recurso — a única aproximação de
 * todo o desenho. Sem a frase, a primeira investigação séria trataria dado aproximado
 * como dado gravado.
 *
 * NÃO HÁ BUSCA EM TEXTO, e a ausência passa a ser declarada em vez de parecer esquecimento.
 * As outras seis abas têm `<input type="search">` porque cada uma segura a lista INTEIRA em
 * memória e filtra o que já tem. Aqui a lista é paginada NO SERVIDOR (a trilha cresce sem
 * teto, e é por isso que a paginação é a certa), então uma caixa de busca no cliente
 * filtraria as 50 linhas em mãos e diria "nada encontrado" sobre uma trilha de milhares —
 * um controle que mente, que é a coisa que este arquivo mais recusa. A rota também não tem
 * predicado de texto: dar-lhe um significaria um `ILIKE` sem índice numa tabela desenhada
 * para crescer para sempre. A afordância que substitui a busca é o CLIQUE: o nome do ator e
 * o nome do alvo são botões que preenchem o filtro de id exato, e é assim que se chega a
 * "tudo que fulano fez" sem digitar um UUID.
 *
 * Imports DIRETOS dos arquivos, nunca dos barrels `@utils`/`@modals`: `admin.html` boota
 * sem a store, e o barrel a arrasta pelo caminho transitivo.
 */

import { apiClient } from '@store/sync/api-client.js';
import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
} from '@utils/event-cleanup.js';
import config from '@js/config.js';
import { sectionHeader, card, avatar, emptyState, ICON_AUDIT, failureState } from './admin-dom.js';
import { buildDomainOptions } from './org-options.js';
import {
    acoesPorFamilia,
    agruparPorDia,
    alvoDoEvento,
    contarFiltrosDeApuracao,
    datasDoAtalho,
    familiaDeAcao,
    fraseDoEvento,
    horaDoEvento,
    janelaDoPeriodo,
    linhasDaResposta,
    linhasDeDetalhe,
    linhasDoDePara,
    linhasTecnicas,
    nomeDaOm,
    nomeDeOmNasLinhas,
    nomeDoAlvo,
    nomeDoAtor,
    resumoDaPagina,
    rotuloDeAcao,
    rotuloDeAlvo,
    escopoDaTrilhaNotice,
    rotuloDeFamilia,
    rotuloDoDia,
    temFiltroAtivo,
    tiposDeAlvoVisiveis,
} from './audit-phrases.js';

/**
 * Quantas linhas por página, e as escolhas que a tela oferece.
 *
 * O SERVIDOR ACEITA DE 1 A 200 (`listAuditSchema`) e a tela fixava 50 sem dizer, então
 * quem precisava varrer uma janela grande paginava de 50 em 50 sem alternativa. 200 é o
 * teto do schema, e oferecer mais faria a rota responder 422.
 */
const POR_PAGINA = 50;
const PAGINACOES = Object.freeze([25, 50, 100, 200]);

/**
 * O EIXO DE TEMPO, NUM SELETOR SÓ.
 *
 * ERAM DOIS CONTROLES PARA O MESMO EIXO até 2026-08-25: quatro botões de atalho (7/30/90/Tudo)
 * e, ao lado deles, dois campos "De" e "Até", sem relação declarada entre uns e outros. Isso
 * custava duas coisas. A primeira era altura: seis controles para uma pergunta só. A segunda
 * era pior, e era um DEFEITO: preencher só o "Até" fazia `janelaDoPeriodo` descartar o atalho
 * inteiro e mandar a consulta SEM `from`, isto é, a trilha desde sempre — enquanto a barra
 * não acendia botão nenhum, nem o "Tudo", que era o recorte em vigor. Apertar o filtro
 * alargava a janela, em silêncio.
 *
 * A FORMA ESCOLHIDA MATA O DEFEITO POR CONSTRUÇÃO, e não por remendo: um `<select>` com cinco
 * valores mutuamente exclusivos. Os quatro primeiros são atalhos; o quinto abre as duas datas,
 * e é o ÚNICO estado em que elas existem. Não há como ter atalho e data ao mesmo tempo, logo
 * não há como os dois discordarem. `janelaDoPeriodo` ganhou a mesma regra do lado de dentro,
 * para o próximo chamador não reinventar o buraco.
 *
 * `valor` é string porque é o `value` de um `<option>`; `dias` é o que a consulta usa.
 */
const MODO_DATAS = 'datas';
const PERIODOS = [
    { valor: '7', dias: 7, rotulo: 'Últimos 7 dias' },
    { valor: '30', dias: 30, rotulo: 'Últimos 30 dias' },
    { valor: '90', dias: 90, rotulo: 'Últimos 90 dias' },
    { valor: 'tudo', dias: null, rotulo: 'Tudo' },
    { valor: MODO_DATAS, dias: null, rotulo: 'Datas exatas…' },
];

/**
 * Builds the "Auditoria" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createAuditTab() {
    const tab = new AuditTab();
    return {
        id: 'audit',
        label: 'Auditoria',
        testid: 'admin-tab-audit',
        icon: ICON_AUDIT,
        mount: (container) => tab.mount(container),
    };
}

class AuditTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        this._filtros = { action: '', targetType: '', targetId: '', targetOrgId: '', actorId: '' };
        // O EIXO DE TEMPO É UM VALOR SÓ (o `value` do seletor), e não um par de estados que
        // pudessem discordar. Ver `PERIODOS`.
        this._periodo = '7';
        // A JANELA ABSOLUTA (`YYYY-MM-DD`), que SÓ existe no modo "Datas exatas". Fora dele as
        // duas são vazias por invariante, mantida em `_trocarPeriodo`.
        this._de = '';
        this._ate = '';
        // O RECOLHIMENTO DA APURAÇÃO. Nasce fechado, e a primeira resposta pode abri-lo: com
        // filtro de apuração ativo ele abre sozinho, para o recorte nunca ficar invisível.
        this._apuracaoAberta = false;
        this._porPagina = POR_PAGINA;
        this._page = 1;
        // NASCE FECHADO: enquanto a primeira resposta não chega, a tela assume que NÃO
        // administra. Um `true` provisório desenharia a coluna de OM e o filtro dela para
        // um produtor, por uma fração de segundo, e depois os tiraria.
        this._administra = false;
        this._escopoOrgId = null;
        this._ultimasLinhas = [];
        // O CONTADOR DE GERAÇÃO, que é a proteção contra o clique duplo. Ver `_render`.
        this._geracao = 0;
        // Os controles da barra, para que uma busca em voo possa desligá-los. Ver `_ocupado`.
        this._controles = [];
        setupCleanup(this);
        this._render();
        return () => {
            this._alive = false;
            cleanup(this);
        };
    }

    /** @private Começa uma vista: solta os listeners da anterior e esvazia o container. */
    _beginView() {
        clearScopedListeners(this, 'view');
        this._controles = [];
        this._container.replaceChildren();
        return this._container;
    }

    /**
     * @private Os parâmetros da consulta, já com o período resolvido.
     * @returns {Object}
     */
    _params() {
        const p = { page: this._page, limit: this._porPagina, ...this._filtros };
        const { from, to } = janelaDoPeriodo({ dias: this._diasDoPeriodo(), de: this._de, ate: this._ate });
        if (from) p.from = from;
        if (to) p.to = to;
        // O filtro de OM é do administrador. Mandá-lo como produtor não faria mal (o
        // servidor o ignora), mas a tela não deve pedir o que não pode: um parâmetro que
        // o servidor descarta é uma afordância que mente.
        if (!this._administra) delete p.targetOrgId;
        return p;
    }

    /**
     * @private Troca um filtro e recomeça na primeira página.
     *
     * TODA MUDANÇA DE FILTRO VOLTA PARA A PÁGINA 1, e sempre voltou: estar na página 5 de
     * uma consulta e apertar outra consulta na mesma página é como se pede uma lista vazia
     * sobre um resultado que tem linhas.
     * @param {Function} mudar
     */
    _aplicar(mudar) {
        mudar();
        this._page = 1;
        this._render();
    }

    /**
     * @private Liga ou desliga os controles da barra enquanto uma busca está em voo.
     *
     * É METADE DA PROTEÇÃO CONTRA O CLIQUE DUPLO (a outra é o contador de geração, em
     * `_render`), e é a metade que a pessoa vê: com os controles desligados, o segundo
     * clique não chega a existir.
     * @param {boolean} ocupado
     */
    _ocupado(ocupado) {
        // O `aria-busy` VAI NA BARRA, e não no container da aba: é a barra que fica
        // temporariamente inerte, e é o seletor dela que o CSS apaga. Marcar o container
        // anunciaria a aba inteira como ocupada, inclusive a lista antiga, que continua
        // legível enquanto a nova não chega.
        this._barra?.setAttribute('aria-busy', String(ocupado));
        for (const c of this._controles) c.disabled = ocupado;
    }

    /**
     * @private Monta o esqueleto da vista (cabeçalho + barra + cartão da lista).
     * @returns {HTMLElement} O cartão que hospeda a lista.
     */
    _esqueleto() {
        const c = this._beginView();
        c.appendChild(sectionHeader('Auditoria', {
            subtitle: 'O que foi feito no servidor: quem, quando, sobre o quê',
        }));
        c.appendChild(this._toolbar());
        const wrap = card({ testid: 'admin-audit-list', padded: false });
        wrap.className += ' admin-audit';
        c.appendChild(wrap);
        return wrap;
    }

    /**
     * @private Busca e redesenha.
     *
     * O CONTADOR DE GERAÇÃO É A CORREÇÃO DE UMA CORRIDA REAL. Dois cliques seguidos (dois
     * períodos, ou o "Próxima" apertado duas vezes) disparavam duas buscas, e a ÚLTIMA A
     * RESPONDER pintava a tela: com a rede fora de ordem, a lista mostrada podia ser a do
     * filtro que a pessoa já tinha abandonado, sem nada na tela dizendo isso.
     *
     * POR QUE NÃO UM `AbortController`: `apiClient._request` não tem costura de `signal`
     * (só o caminho de `timeoutMs` monta um controlador, internamente), então abortar de
     * fora exigiria alargar o cliente HTTP compartilhado, que serve outras seis abas.
     * O que decide a correção é o CONSUMIDOR ignorar a resposta velha, e é o que este
     * contador faz; cancelar a requisição pouparia rede e não mudaria o que se vê.
     */
    async _render() {
        const geracao = ++this._geracao;
        const wrap = this._esqueleto();
        this._ocupado(true);
        const carregando = document.createElement('p');
        carregando.className = 'admin-users__status';
        carregando.textContent = 'Carregando a trilha…';
        wrap.appendChild(carregando);

        let resposta;
        try {
            resposta = await apiClient.listAudit(this._params());
        } catch (err) {
            if (!this._alive || geracao !== this._geracao) return;
            this._ocupado(false);
            // UMA SUPERFÍCIE SÓ PARA O MESMO ERRO. Até 2026-08-25 esta falha aparecia
            // DUAS vezes: o estado inline (que fica, e tem o botão de tentar de novo) e um
            // toast (que some sozinho). Dizer a mesma coisa em dois lugares não informa em
            // dobro; ensina a pessoa a fechar avisos sem ler, e o toast é justamente o que
            // rouba a atenção do único dos dois que oferece a saída.
            //
            // A MENSAGEM DO SERVIDOR NÃO SE PERDE: ela entra no estado inline, que é onde a
            // pessoa está olhando. Ver `failureState` em `admin-dom.js`.
            carregando.replaceChildren(failureState(
                err?.message || 'Falha ao carregar a trilha de auditoria.',
                { onRetry: () => { if (this._alive) this._render(); } },
            ));
            return;
        }
        if (!this._alive || geracao !== this._geracao) return;
        this._ocupado(false);

        const administravaAntes = this._administra;
        const escopoAntes = this._escopoOrgId;
        this._administra = resposta?.administra === true;
        // O RECORTE, guardado para a tela poder dize-lo (M9). Ate agora este campo chegava na
        // resposta e era descartado no cliente inteiro.
        this._escopoOrgId = resposta?.escopoOrgId ?? null;
        // AS LINHAS FICAM GUARDADAS para o rótulo do filtro de OM poder achar o nome de uma OM
        // que já saiu da lista de ativas. Ver `nomeDeOmNasLinhas`.
        //
        // O LEITOR DO ENVELOPE É UM SÓ (`linhasDaResposta`) e é assim desde 2026-08-25, porque
        // aqui morava um `resposta?.items` que NÃO existe na resposta: o campo é `data`. A
        // lista desenhava (ela lia `data` no outro sítio), então nada parecia quebrado, e o que
        // se perdia era o nome da OM desativada no filtro, que voltava a sair como UUID cru.
        this._ultimasLinhas = linhasDaResposta(resposta);
        // O ESCOPO SÓ SE DESCOBRE NA PRIMEIRA RESPOSTA, então a barra de filtros precisa
        // ser redesenhada UMA vez quando ele muda. Redesenhar sempre piscaria a tela a
        // cada busca; nunca redesenhar deixaria o administrador sem os filtros dele.
        //
        // E A REDESENHA REAPROVEITA A RESPOSTA que já chegou, em vez de chamar `_render()`
        // de novo: a resposta NÃO depende de `administra` (o recorte é do servidor, não da
        // tela), então a segunda consulta seria idêntica à primeira — uma requisição a
        // mais e um segundo "Carregando…" em TODA montagem de administrador.
        //
        // O GATILHO SÃO OS DOIS CAMPOS, e não só `administra`. MEDIDO NO NAVEGADOR em
        // 2026-08-25: para o PRODUTOR, `administra` chega `false` e a tela já nascia `false`,
        // então a condição nunca disparava e a barra ficava com a que foi montada ANTES da
        // resposta — isto é, com `_escopoOrgId` ainda nulo. O efeito era a nota do recorte
        // não existir na prática: `escopoDaTrilhaNotice(null)` devolve a frase genérica, e o
        // produtor continuava sem saber de qual OM era a lista que estava lendo. Era o
        // defeito que a própria nota tinha sido escrita para fechar, vivo atrás dela.
        const escopoMudou = administravaAntes !== this._administra || escopoAntes !== this._escopoOrgId;
        this._renderLista(escopoMudou ? this._esqueleto() : wrap, resposta);
    }

    /** @private Os dias do atalho em vigor. `null` em "Tudo" e em "Datas exatas". */
    _diasDoPeriodo() {
        return PERIODOS.find((p) => p.valor === this._periodo)?.dias ?? null;
    }

    /**
     * @private Troca o eixo de tempo, mantendo o invariante dos dois modos.
     *
     * FORA DO MODO "DATAS EXATAS" AS DUAS DATAS SÃO VAZIAS, sempre, e é isso que impede o
     * atalho e o intervalo de discordarem: só um dos dois existe de cada vez.
     *
     * A ENTRADA NO MODO É CONTÍNUA, e não em branco: os campos nascem com a janela que
     * ESTAVA em vigor (`datasDoAtalho`), então trocar de forma não troca a lista debaixo do
     * nariz de quem estava lendo. É o que faz as duas formas serem um eixo só em vez de dois
     * controles que competem.
     * @param {string} valor - O `value` do seletor. Ver `PERIODOS`.
     */
    _trocarPeriodo(valor) {
        const diasAntes = this._diasDoPeriodo();
        this._periodo = valor;
        if (valor !== MODO_DATAS) {
            this._de = '';
            this._ate = '';
            return;
        }
        const { de, ate } = datasDoAtalho(diasAntes);
        this._de = de;
        this._ate = ate;
    }

    /**
     * @private A barra de filtros.
     *
     * ELA FOI REFEITA EM 2026-08-25, e o motivo é medido: com oito controles num `flex-wrap`,
     * ela ocupava 293px de altura num navegador de 720px, e a lista — que é o assunto da tela —
     * começava a 479px, isto é, sob a dobra. Numa tela de consulta, a barra estava entre a
     * pergunta e a resposta. Depois do redesenho ela ocupa uma linha só. As quatro decisões:
     *
     *   1. **O EIXO DE TEMPO VIROU UM SELETOR** (ver `PERIODOS`). Seis controles viram um, e o
     *      defeito do atalho contra o intervalo morre por construção.
     *   2. **A APURAÇÃO RECOLHE.** Alvo por id, ator por id e OM do acervo são de investigação,
     *      não do dia a dia. Ficam atrás de um botão que DIZ QUANTOS estão ativos e que abre
     *      sozinho quando há algum: recolhimento mudo viraria filtro invisível, que é pior que
     *      filtro feio.
     *   3. **"POR PÁGINA" FOI PARA O RODAPÉ**, junto da paginação, que é do que ele trata. Ele
     *      não é um recorte da consulta, e estar entre os recortes era o que fazia a segunda
     *      fileira da barra ter um toco no fim e um rasgo no meio.
     *   4. **A NOTA DE ESCOPO RECOLHEU.** Ela responde "esta lista é a trilha inteira ou só a da
     *      minha OM?", e essa resposta cabe numa linha; a ressalva longa (o backfill, o que não
     *      entra na trilha) fica atrás do mesmo recolhimento, visível a um clique.
     */
    _toolbar() {
        const barra = document.createElement('div');
        barra.className = 'admin-audit__toolbar';
        barra.dataset.testid = 'admin-audit-toolbar';

        const linha = document.createElement('div');
        linha.className = 'admin-audit__linha';
        barra.appendChild(linha);

        // --- o eixo de tempo, num seletor só ---------------------------------
        const periodo = this._select('admin-audit-periodo', 'Período',
            (v) => this._aplicar(() => this._trocarPeriodo(v)));
        for (const opt of PERIODOS) periodo.control.appendChild(this._option(opt.valor, opt.rotulo));
        periodo.control.value = this._periodo;
        linha.appendChild(periodo.wrap);

        // AS DUAS DATAS SÓ EXISTEM NO MODO DELAS. A rota aceita `to` desde sempre
        // (`audit.schemas.js`), e é o que torna "o que aconteceu no dia 12" formulável.
        if (this._periodo === MODO_DATAS) {
            linha.appendChild(this._campoData('admin-audit-de', 'De', this._de, (v) => this._aplicar(() => {
                this._de = v;
            })));
            linha.appendChild(this._campoData('admin-audit-ate', 'Até', this._ate, (v) => this._aplicar(() => {
                this._ate = v;
            })));
        }

        // --- ação, agrupada por família --------------------------------------
        const acao = this._select('admin-audit-acao', 'Ação', (v) => this._aplicar(() => {
            this._filtros.action = v;
        }));
        acao.control.appendChild(this._option('', 'Todas as ações'));
        for (const grupo of acoesPorFamilia()) {
            const og = document.createElement('optgroup');
            og.label = rotuloDeFamilia(grupo.familia);
            for (const a of grupo.acoes) og.appendChild(this._option(a.valor, a.rotulo));
            acao.control.appendChild(og);
        }
        acao.control.value = this._filtros.action;
        linha.appendChild(acao.wrap);

        // --- tipo de alvo -----------------------------------------------------
        const tipo = this._select('admin-audit-tipo', 'Tipo de alvo', (v) => this._aplicar(() => {
            this._filtros.targetType = v;
        }));
        tipo.control.appendChild(this._option('', 'Todos os tipos'));
        // A LISTA E O RECORTE POR AUDIÊNCIA MORAM EM `audit-phrases.js` desde 2026-08-25, e a
        // mudança de casa é o conserto: aqui dentro nenhum teste os alcançava, e foi assim que
        // `RANK` ganhou emissor no servidor e ficou de fora do filtro.
        for (const t of tiposDeAlvoVisiveis(this._administra)) {
            tipo.control.appendChild(this._option(t, rotuloDeAlvo(t)));
        }
        tipo.control.value = this._filtros.targetType;
        linha.appendChild(tipo.wrap);

        linha.appendChild(this._botaoDaApuracao());

        // --- limpar -----------------------------------------------------------
        // SÓ APARECE COM FILTRO APLICADO. Um botão de limpar numa tela sem filtro é ruído, e
        // pior: sugere que existe um recorte escondido. O período fica de fora da conta porque
        // ele nunca está vazio (ver `temFiltroAtivo`).
        if (temFiltroAtivo(this._filtros)) {
            const limpar = document.createElement('button');
            limpar.type = 'button';
            limpar.className = 'admin-btn admin-btn--sm admin-btn--ghost admin-audit__limpar';
            limpar.dataset.testid = 'admin-audit-limpar';
            limpar.textContent = 'Limpar filtros';
            addScopedDomListener(this, 'view', limpar, 'click', () => this._aplicar(() => {
                this._filtros = {
                    action: '', targetType: '', targetId: '', targetOrgId: '', actorId: '',
                };
            }));
            this._controles.push(limpar);
            linha.appendChild(limpar);
        }

        linha.appendChild(this._nota());
        barra.appendChild(this._painelDaApuracao());

        this._barra = barra;
        return barra;
    }

    /**
     * @private O botão que abre a apuração, com a CONTAGEM do que está ativo lá dentro.
     *
     * O SELO NÃO É ENFEITE, é a condição para o recolhimento ser legítimo: uma lista recortada
     * por um id que ninguém vê lê-se como "não aconteceu", e numa trilha essa é a leitura mais
     * cara que existe. Por isso o painel também ABRE SOZINHO quando há algum filtro ativo.
     * @returns {HTMLElement}
     */
    _botaoDaApuracao() {
        const ativos = contarFiltrosDeApuracao(this._filtros);
        if (ativos > 0) this._apuracaoAberta = true;

        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'admin-btn admin-btn--sm admin-btn--ghost admin-audit__apuracao-btn';
        b.dataset.testid = 'admin-audit-apuracao';
        b.setAttribute('aria-expanded', String(this._apuracaoAberta));
        b.setAttribute('aria-controls', 'admin-audit-apuracao-painel');
        b.appendChild(this._texto('Apuração', 'admin-audit__apuracao-rotulo'));
        if (ativos > 0) {
            const selo = document.createElement('span');
            selo.className = 'admin-chip admin-audit__apuracao-selo';
            selo.dataset.testid = 'admin-audit-apuracao-contagem';
            selo.textContent = String(ativos);
            // O NÚMERO SOZINHO NÃO SE LÊ EM VOZ ALTA. "2" ao lado de "Apuração" é claro para
            // quem vê e é um dígito solto para quem ouve.
            selo.setAttribute('aria-label', `${ativos} ${ativos === 1 ? 'filtro ativo' : 'filtros ativos'}`);
            b.appendChild(selo);
        }
        addScopedDomListener(this, 'view', b, 'click', () => {
            this._apuracaoAberta = !this._apuracaoAberta;
            // SEM IDA AO SERVIDOR: abrir uma gaveta de filtros não muda a consulta. Um
            // `_render()` aqui pagaria uma requisição e um "Carregando…" por clique de
            // divulgação, e ainda faria a lista piscar sem ter mudado.
            this._painel.hidden = !this._apuracaoAberta;
            b.setAttribute('aria-expanded', String(this._apuracaoAberta));
        });
        this._controles.push(b);
        return b;
    }

    /**
     * @private A segunda fileira, com os três filtros de apuração.
     *
     * ALVO POR ID, ATOR POR ID E OM SÃO DE INVESTIGAÇÃO, e não da consulta do dia a dia. Eles
     * eram a segunda fileira esfarrapada da barra antiga, e o que os prendia lá era só a ordem
     * em que foram escritos.
     *
     * O ATOR VALE PARA AS DUAS AUDIÊNCIAS desde 2026-08-25, e o gate que o escondia do produtor
     * era engano de leitura do servidor: `listAudit` repassa `actorId` nos DOIS ramos
     * (`audit.service.js`), então o produtor sempre pôde perguntar "o que fulano fez no meu
     * acervo". O gate por `administra` existe para o que o servidor IGNORA (a OM alvo).
     * @returns {HTMLElement}
     */
    _painelDaApuracao() {
        const painel = document.createElement('div');
        painel.className = 'admin-audit__apuracao-painel';
        painel.id = 'admin-audit-apuracao-painel';
        painel.dataset.testid = 'admin-audit-apuracao-painel';
        painel.hidden = !this._apuracaoAberta;

        painel.appendChild(this._campo('admin-audit-alvo', 'Alvo (id exato)', this._filtros.targetId,
            (v) => this._aplicar(() => { this._filtros.targetId = v; })));
        painel.appendChild(this._campo('admin-audit-ator', 'Ator (id exato)', this._filtros.actorId,
            (v) => this._aplicar(() => { this._filtros.actorId = v; })));

        if (this._administra) {
            const om = this._select('admin-audit-om', 'OM do acervo', (v) => this._aplicar(() => {
                this._filtros.targetOrgId = v;
            }));
            // A RESOLUÇÃO id → nome MORA EM `org-options.js`, e não aqui: o `@fileoverview`
            // daquele arquivo conta que ele nasceu porque a mesma resolução tinha ido parar
            // em DUAS abas, já divergentes. O terceiro argumento é o que mantém LEGÍVEL a OM
            // DESATIVADA, que `buildDomainOptions` preserva de propósito porque é justamente o
            // estado que dispara investigação: sem ele, ela saía como UUID cru mais "(atual)".
            //
            // O nome vem das linhas JÁ CARREGADAS: a resposta da trilha traz a OM de cada
            // evento, então quando o filtro aponta para uma OM que sumiu da lista de ativas, o
            // nome dela costuma estar ali na página que está na tela.
            const nomeDaOmFiltrada = nomeDeOmNasLinhas(this._ultimasLinhas, this._filtros.targetOrgId);
            for (const opt of buildDomainOptions(
                config.organizacoesMilitares,
                this._filtros.targetOrgId,
                nomeDaOmFiltrada,
                'Todas as OM',
            )) {
                om.control.appendChild(this._option(opt.value, opt.label));
            }
            om.control.value = this._filtros.targetOrgId;
            painel.appendChild(om.wrap);
        }

        this._painel = painel;
        return painel;
    }

    /**
     * @private A ressalva de ESCOPO, recolhida.
     *
     * ELA FICA, e não é negociável: responde "esta lista é a trilha inteira ou só a da minha
     * OM?", e é o que impede o produtor de ler ausência como "não aconteceu" e o administrador
     * de não saber que a lista dele não tem recorte. O que mudou em 2026-08-25 foi a FORMA:
     * eram três linhas em corpo cheio ocupando a largura toda da barra, antes de qualquer dado
     * aparecer. Agora a resposta cabe no `<summary>`, numa linha, e a ressalva longa (o
     * backfill do eixo de OM, o que não entra na trilha) fica a um clique.
     *
     * O `<details>` É NATIVO de propósito: teclado, `aria-expanded` e o estado aberto vêm de
     * graça, e o texto continua no DOM fechado, então quem procura por texto o acha.
     * @returns {HTMLElement}
     */
    _nota() {
        const nota = document.createElement('details');
        nota.className = 'admin-audit__nota';
        nota.dataset.testid = 'admin-audit-nota';
        const resumo = document.createElement('summary');
        resumo.textContent = this._administra
            ? 'Escopo: a trilha inteira do sistema'
            : 'Escopo: só a OM para a qual você produz';
        const corpo = document.createElement('p');
        corpo.className = 'admin-audit__nota-corpo';
        corpo.textContent = this._administra
            // O ADMINISTRADOR TAMBÉM RECEBE FRASE, e até 2026-08-25 era o único que não recebia
            // nenhuma. A nota do backfill saía só para ele e a nota do recorte saía só para quem
            // NÃO administra, então a lista mais larga do produto era a única sem legenda dizendo
            // qual era o recorte. Dizer "você vê tudo" é informação: sem ela, a ausência de uma
            // linha esperada se lê como recorte, e não como ausência.
            ? 'Você vê a trilha inteira do sistema, sem recorte por OM, porque administra o '
              + 'sistema. A OM de cada linha é a OM dona do recurso na época do ato. '
                + 'Para atos anteriores à criação deste eixo, ela foi deduzida da OM atual do '
                + 'recurso, e o que já havia sido destruído ficou sem OM.'
            // M9: O RECORTE, DITO. `escopoOrgId` chega na resposta desde que o eixo nasceu e não
            // tinha leitor nenhum no cliente, então o produtor nunca soube de qual OM era a
            // lista que estava lendo, nem que ela era recortada.
            : escopoDaTrilhaNotice(this._escopoOrgId);
        nota.append(resumo, corpo);
        return nota;
    }

    /** @private Um `<option>`. */
    _option(valor, rotulo) {
        const o = document.createElement('option');
        o.value = valor;
        o.textContent = rotulo;
        return o;
    }

    /**
     * @private Um `<select>` rotulado, com o listener no escopo da vista.
     *
     * A CLASSE É `admin-input`, a mesma das outras seis abas. `admin-audit__select` e
     * `admin-audit__input` existiam e redeclaravam altura, borda, raio e foco que
     * `.admin-input` já resolvia: uma segunda cópia do mesmo desenho, que divergiria no dia
     * em que alguém mexesse numa só.
     */
    _select(testid, rotulo, onChange) {
        const wrap = document.createElement('label');
        wrap.className = 'admin-audit__filtro';
        const span = document.createElement('span');
        span.className = 'admin-audit__filtro-rotulo';
        span.textContent = rotulo;
        const control = document.createElement('select');
        control.className = 'admin-input admin-audit__controle';
        control.dataset.testid = testid;
        addScopedDomListener(this, 'view', control, 'change', () => onChange(control.value));
        this._controles.push(control);
        wrap.append(span, control);
        return { wrap, control };
    }

    /**
     * @private Um campo de texto que aplica no Enter e ao sair do campo.
     *
     * O `change` ENTROU EM 2026-08-25 porque só-Enter é uma regra invisível: quem digitava um
     * id e clicava fora ficava com o campo preenchido e a lista inalterada, o que se lê como
     * "o filtro não achou nada". A guarda de igualdade é o que impede o Enter de disparar
     * duas buscas (o `change` do navegador vem logo atrás dele).
     */
    _campo(testid, rotulo, valor, onAplicar) {
        const wrap = document.createElement('label');
        wrap.className = 'admin-audit__filtro';
        const span = document.createElement('span');
        span.className = 'admin-audit__filtro-rotulo';
        span.textContent = rotulo;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'admin-input admin-audit__controle';
        input.dataset.testid = testid;
        input.value = valor || '';
        input.placeholder = 'Enter para filtrar';
        const aplicar = () => {
            const novo = input.value.trim();
            if (novo === String(valor || '')) return;
            onAplicar(novo);
        };
        addScopedDomListener(this, 'view', input, 'keydown', (e) => {
            if (e.key === 'Enter') aplicar();
        });
        addScopedDomListener(this, 'view', input, 'change', aplicar);
        this._controles.push(input);
        wrap.append(span, input);
        return wrap;
    }

    /** @private Uma das duas pontas da janela absoluta. */
    _campoData(testid, rotulo, valor, onAplicar) {
        const wrap = document.createElement('label');
        wrap.className = 'admin-audit__filtro';
        const span = document.createElement('span');
        span.className = 'admin-audit__filtro-rotulo';
        span.textContent = rotulo;
        const input = document.createElement('input');
        input.type = 'date';
        input.className = 'admin-input admin-audit__controle';
        input.dataset.testid = testid;
        input.value = valor || '';
        addScopedDomListener(this, 'view', input, 'change', () => onAplicar(input.value));
        this._controles.push(input);
        wrap.append(span, input);
        return wrap;
    }

    /** @private Quantas colunas a tabela tem para esta audiência. */
    _colunas() {
        return this._administra ? 6 : 5;
    }

    /**
     * @private A lista, agrupada por dia, dentro de uma tabela de verdade.
     * @param {HTMLElement} host
     * @param {Object} resposta
     */
    _renderLista(host, resposta) {
        host.replaceChildren();
        const linhas = linhasDaResposta(resposta);

        if (linhas.length === 0) {
            // A FRASE DO VAZIO FICA COMO ESTÁ, e ela é a coisa certa: "nada casou o filtro"
            // nunca é a mesma afirmação que "nada aconteceu", e numa trilha confundir as duas
            // é o pior erro possível.
            host.appendChild(emptyState('Nenhum evento no período.', {
                hint: 'Amplie o período ou limpe os filtros. Lista vazia aqui significa '
                    + '"nada casou o filtro", nunca "nada aconteceu".',
            }));
            host.appendChild(this._rodape(resposta));
            return;
        }

        const tabela = document.createElement('table');
        // AS DUAS CLASSES: a da casa carrega o desenho de tabela que as outras cinco abas já
        // usam, e a própria carrega só o que é desta tela (a coluna da hora, o dia pegajoso).
        tabela.className = 'admin-users__table admin-audit__table';
        tabela.appendChild(this._cabecalho());

        for (const grupo of agruparPorDia(linhas)) {
            // UM `<tbody>` POR DIA: é o que concilia o agrupamento com a tabela. Ele é grupo
            // de linhas de verdade, então o leitor de tela o percorre como grupo em vez de
            // topar com um cabeçalho solto no meio das linhas.
            const corpo = document.createElement('tbody');
            corpo.className = 'admin-audit__day';
            corpo.dataset.testid = 'admin-audit-day';

            const trDia = document.createElement('tr');
            trDia.className = 'admin-audit__day-row';
            const thDia = document.createElement('th');
            thDia.className = 'admin-audit__day-header';
            thDia.setAttribute('scope', 'colgroup');
            thDia.colSpan = this._colunas();
            thDia.textContent = rotuloDoDia(grupo.dia);
            trDia.appendChild(thDia);
            corpo.appendChild(trDia);

            for (const linha of grupo.linhas) this._linha(corpo, linha);
            tabela.appendChild(corpo);
        }
        host.appendChild(tabela);
        host.appendChild(this._rodape(resposta));
    }

    /** @private O `<thead>`, que é o que faltava para a lista ser legível sem enxergar. */
    _cabecalho() {
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        const colunas = ['Hora', 'Ator', 'Ação', 'Alvo'];
        if (this._administra) colunas.push('OM do acervo');
        for (const rotulo of colunas) {
            const th = document.createElement('th');
            th.setAttribute('scope', 'col');
            th.textContent = rotulo;
            tr.appendChild(th);
        }
        // A COLUNA DO BOTÃO tem cabeçalho invisível em vez de vazio: um `<th>` vazio é lido
        // como coluna sem nome, e o botão dentro dela é o único controle da linha.
        const acoes = document.createElement('th');
        acoes.setAttribute('scope', 'col');
        const oculto = document.createElement('span');
        oculto.className = 'admin-audit__oculto';
        oculto.textContent = 'Detalhes';
        acoes.appendChild(oculto);
        tr.appendChild(acoes);
        thead.appendChild(tr);
        return thead;
    }

    /**
     * @private Uma linha e a gaveta dela, as duas dentro do `<tbody>` do dia.
     * @param {HTMLElement} corpo - O `<tbody>` do dia.
     * @param {Object} linha
     */
    _linha(corpo, linha) {
        const tr = document.createElement('tr');
        tr.className = 'admin-audit__row';
        tr.dataset.testid = 'admin-audit-row';

        // --- hora --------------------------------------------------------------
        const tdHora = document.createElement('td');
        tdHora.className = 'admin-audit__time';
        // `<time>` COM `datetime`: o instante completo deixa de morar só no `title` (que não
        // existe no toque nem no teclado). Ele é máquina-legível aqui e humano-legível na
        // gaveta, por `linhasTecnicas`.
        const hora = document.createElement('time');
        hora.textContent = horaDoEvento(linha.created_at);
        if (linha.created_at) hora.dateTime = String(linha.created_at);
        tdHora.appendChild(hora);
        tr.appendChild(tdHora);

        // --- ator ---------------------------------------------------------------
        const tdAtor = document.createElement('td');
        const ator = document.createElement('div');
        ator.className = 'admin-audit__ator';
        ator.appendChild(avatar(nomeDoAtor(linha), linha.actor_id || linha.actor_username));
        // O NOME DO ATOR É UM BOTÃO quando há id, e é a substituta da busca em texto: chegar a
        // "tudo que fulano fez" deixa de exigir que alguém copie um UUID de um tooltip.
        ator.appendChild(linha.actor_id
            ? this._botaoDeFiltro(nomeDoAtor(linha), `Filtrar pelos atos de ${nomeDoAtor(linha)}`,
                () => this._aplicar(() => { this._filtros.actorId = String(linha.actor_id); }))
            : this._texto(nomeDoAtor(linha), 'admin-audit__ator-nome'));
        tdAtor.appendChild(ator);
        tr.appendChild(tdAtor);

        // --- ação ---------------------------------------------------------------
        const tdAcao = document.createElement('td');
        const chip = document.createElement('span');
        chip.className = `admin-chip admin-audit__chip admin-audit__chip--${familiaDeAcao(linha.action)}`;
        chip.textContent = rotuloDeAcao(linha.action);
        tdAcao.appendChild(chip);
        tr.appendChild(tdAcao);

        // --- alvo ---------------------------------------------------------------
        //
        // O TIPO E O NOME SÃO DOIS NÓS, e não uma frase concatenada: com a coluna de ator ao
        // lado, repetir o ator dentro do texto do alvo seria dizer a mesma coisa duas vezes na
        // mesma linha. O nome é o botão; o tipo é a legenda dele.
        const tdAlvo = document.createElement('td');
        // A FRASE INTEIRA sobrevive no `title`, e é conveniência de mouse, nunca o portador
        // único de coisa nenhuma: cada pedaço dela já está visível numa célula. O que ela
        // acrescenta é poder copiar o evento em uma linha para dentro de um relatório.
        tdAlvo.title = fraseDoEvento(linha);
        if (!linha.target_type && !linha.target_id) {
            // Sem alvo nenhum (um `LOGIN`), a célula fica com o travessão em vez de inventar
            // um alvo: "no sistema" diria mais do que a linha sabe.
            tdAlvo.appendChild(this._texto('—', 'admin-audit__vazio'));
        } else {
            const alvo = document.createElement('div');
            alvo.className = 'admin-audit__alvo';
            alvo.appendChild(this._texto(rotuloDeAlvo(linha.target_type), 'admin-audit__alvo-tipo'));
            alvo.appendChild(linha.target_id
                ? this._botaoDeFiltro(nomeDoAlvo(linha),
                    `Filtrar por tudo que foi feito com ${nomeDoAlvo(linha)}`,
                    () => this._aplicar(() => { this._filtros.targetId = String(linha.target_id); }))
                : this._texto(nomeDoAlvo(linha), 'admin-audit__alvo-nome'));
            tdAlvo.appendChild(alvo);
        }
        tr.appendChild(tdAlvo);

        // --- OM: só quem administra --------------------------------------------
        if (this._administra) {
            const tdOm = document.createElement('td');
            tdOm.className = 'admin-audit__om';
            tdOm.dataset.testid = 'admin-audit-om';
            // A SIGLA na célula e o nome longo na GAVETA (`linhasTecnicas`). O `title` fica
            // como conveniência do mouse, e não como o único portador do dado.
            tdOm.textContent = nomeDaOm(linha);
            tdOm.title = linha.target_org_nome || 'Sem OM dona (conta, atlas, configuração '
                + 'ou acervo institucional)';
            tr.appendChild(tdOm);
        }

        // --- a gaveta -----------------------------------------------------------
        //
        // TODA LINHA TEM GAVETA desde 2026-08-25, e antes só tinham as que traziam `details`
        // não vazio. O que mudou é o que a gaveta carrega: `id`, `ip`, `user_agent` e o
        // carimbo completo chegam em TODA linha (`audit.queries.js`) e não tinham leitor
        // nenhum no cliente. Uma linha de `LOGIN`, que não tem `details`, era exatamente a
        // que mais precisava do endereço de origem.
        const tdBotao = document.createElement('td');
        tdBotao.className = 'admin-audit__acoes';
        const gaveta = document.createElement('tr');
        gaveta.className = 'admin-audit__details-row';
        gaveta.hidden = true;
        const tdGaveta = document.createElement('td');
        tdGaveta.colSpan = this._colunas();
        const caixa = document.createElement('div');
        caixa.className = 'admin-audit__details';
        tdGaveta.appendChild(caixa);
        gaveta.appendChild(tdGaveta);

        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'admin-btn admin-btn--sm admin-btn--ghost';
        botao.dataset.testid = 'admin-audit-details';
        botao.textContent = 'Detalhes';
        botao.setAttribute('aria-expanded', 'false');
        // O NOME ACESSÍVEL DIZ DE QUAL LINHA É. Cinquenta botões chamados "Detalhes" são
        // cinquenta controles indistinguíveis para quem navega por lista de controles.
        botao.setAttribute('aria-label', `Detalhes: ${alvoDoEvento(linha)}`);
        if (linha.id) {
            const alvoId = `admin-audit-gaveta-${linha.id}`;
            gaveta.id = alvoId;
            botao.setAttribute('aria-controls', alvoId);
        }
        addScopedDomListener(this, 'view', botao, 'click', () => {
            // CONSTRUÇÃO PREGUIÇOSA: a gaveta só vira DOM quando alguém a abre. Enquanto ela
            // era montada junto com a linha, uma página de 200 eventos pagava 200 gavetas que
            // ninguém tinha pedido, e `details` é JSONB sem teto no servidor
            // (`backend/src/utils/audit.js`), então o custo não tem limite conhecido.
            if (!caixa.hasChildNodes()) caixa.appendChild(this._detalhes(linha));
            gaveta.hidden = !gaveta.hidden;
            botao.setAttribute('aria-expanded', String(!gaveta.hidden));
        });
        tdBotao.appendChild(botao);
        tr.appendChild(tdBotao);

        corpo.appendChild(tr);
        corpo.appendChild(gaveta);
    }

    /** @private Um `<span>` de texto simples. */
    _texto(texto, classe) {
        const el = document.createElement('span');
        el.className = classe;
        el.textContent = texto;
        return el;
    }

    /**
     * @private Um nome CLICÁVEL que preenche um filtro.
     *
     * É UM `<button>` DE VERDADE, e não um `<span role="button" tabindex="0">`. O desenho
     * anterior era um controle INVISÍVEL: a classe que o marcava (`admin-audit__alvo--clicavel`)
     * não tinha uma única regra em `frontend/src/css/`, então ele não tinha cursor, nem estado
     * de passagem, nem foco visível; e como o `keydown` nunca foi ligado, o Enter e o espaço não
     * o acionavam, apesar do `role="button"` prometer que sim. Um botão nativo resolve os
     * quatro de graça, e a promessa deixa de ser feita à mão.
     */
    _botaoDeFiltro(rotulo, descricao, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'admin-audit__filtro-rapido';
        b.textContent = rotulo;
        b.title = descricao;
        b.setAttribute('aria-label', descricao);
        addScopedDomListener(this, 'view', b, 'click', onClick);
        return b;
    }

    /**
     * @private O conteúdo da gaveta, em TRÊS seções.
     *
     * TUDO POR `textContent`, inclusive as chaves: `details` é escrito pelo servidor, mas
     * carrega nome de grupo e de recurso digitados por outra pessoa.
     *
     * A PRIMEIRA SEÇÃO É O DE-PARA, e ela é o motivo desta gaveta existir. Desde
     * 2026-08-21 `CATALOG_UPDATE` grava o que mudou em três regimes (valor literal para
     * uma allowlist de campos pequenos, IMPRESSÃO para endereço e mídia, nome-só para o
     * resto), e ler `mudou`/`outros` como JSON cru desperdiçaria a informação que eles
     * carregam. Quem decide a frase de cada regime é `linhasDoDePara`, módulo puro.
     *
     * A REGRA ANTIGA ("`details` nunca carrega valor de campo") virou o PISO e não sumiu:
     * o que não está classificado continua entrando só pelo nome. Esta tela mostra o que
     * chegar, então quem afrouxar a classificação do servidor precisa voltar aqui.
     *
     * A SEGUNDA SEÇÃO é o resto do `details` (`table`, `slug`, `resurrected`, `self`…), com
     * as chaves do de-para retiradas para não repetir o que a primeira já disse. `fields`
     * entra nessa retirada SÓ quando há frases (a decisão é `chavesJaDitasPeloDePara`, no
     * módulo puro): numa linha antiga, sem de-para, ela é a única informação de campo que
     * existe.
     *
     * ELA DEIXOU DE SER CHAVE/VALOR CRU em 2026-08-23, e o defeito que isso fecha era
     * concreto: `origem: USER_DEMOTION` saía em inglês e em maiúsculas num painel em
     * português, exatamente onde o leitor precisava entender por que uma concessão que
     * ninguém revogou aparecia revogada. Quem decide a frase é `linhasDeDetalhe`, no
     * módulo puro, e ele devolve DUAS bandeiras: o que não tem verbete continua
     * aparecendo, e aparece com a classe de CÓDIGO. Esconder é pior que mostrar; mostrar
     * um enum com cara de frase é pior que mostrá-lo como código.
     *
     * A TERCEIRA SEÇÃO É NOVA (2026-08-25) e é o resgate do que o servidor mandava e a tela
     * jogava fora: `id`, `ip`, `user_agent`, o carimbo completo, o id do alvo e o nome longo
     * da OM. Ver `linhasTecnicas`.
     * @param {Object} linha - A linha inteira, e não só o `details`.
     * @returns {HTMLElement}
     */
    _detalhes(linha) {
        const dl = document.createElement('dl');
        dl.className = 'admin-audit__details-list';
        const detalhes = linha?.details && typeof linha.details === 'object' ? linha.details : {};

        const frases = linhasDoDePara(detalhes);
        for (const { campo, texto } of frases) {
            const dt = document.createElement('dt');
            dt.className = 'admin-audit__details-campo';
            dt.textContent = campo;
            const dd = document.createElement('dd');
            dd.className = 'admin-audit__details-depara';
            dd.textContent = texto;
            dl.append(dt, dd);
        }

        for (const item of linhasDeDetalhe(detalhes)) {
            const dt = document.createElement('dt');
            dt.textContent = item.chave;
            if (item.chaveEhCodigo) dt.classList.add('admin-audit__details-codigo');
            const dd = document.createElement('dd');
            dd.textContent = item.texto;
            if (item.textoEhCodigo) dd.classList.add('admin-audit__details-codigo');
            dl.append(dt, dd);
        }

        for (const item of linhasTecnicas(linha)) {
            const dt = document.createElement('dt');
            dt.className = 'admin-audit__details-tecnico';
            dt.textContent = item.chave;
            const dd = document.createElement('dd');
            dd.textContent = item.texto;
            if (item.ehCodigo) dd.classList.add('admin-audit__details-codigo');
            dl.append(dt, dd);
        }
        return dl;
    }

    /**
     * @private O rodapé: o intervalo, a página e os quatro saltos.
     *
     * "PRIMEIRA" E "ÚLTIMA" ENTRARAM porque a trilha é ordenada do mais novo para o mais
     * velho: sem elas, chegar ao começo de uma janela de 200 eventos custava quatro cliques,
     * e voltar ao topo depois de investigar custava outros quatro.
     * @param {Object} resposta
     * @returns {HTMLElement}
     */
    _rodape(resposta) {
        const { pagina, paginas, texto } = resumoDaPagina(resposta, this._porPagina);

        const rodape = document.createElement('div');
        rodape.className = 'admin-audit__pager';
        rodape.dataset.testid = 'admin-audit-pager';

        const resumo = document.createElement('span');
        resumo.className = 'admin-audit__pager-resumo';
        resumo.textContent = texto;
        rodape.appendChild(resumo);

        // "POR PÁGINA" MORA AQUI DESDE 2026-08-25, e não na barra de filtros. Ele não recorta a
        // consulta, ele dimensiona a PÁGINA, e estar entre os recortes era metade do que fazia a
        // barra ter duas fileiras. Ao lado do "1 a 50 de 213" ele fica junto do número que muda.
        const tamanho = this._select('admin-audit-limite', 'Por página', (v) => this._aplicar(() => {
            this._porPagina = Number(v) || POR_PAGINA;
        }));
        tamanho.wrap.classList.add('admin-audit__filtro--inline');
        for (const n of PAGINACOES) tamanho.control.appendChild(this._option(String(n), String(n)));
        tamanho.control.value = String(this._porPagina);
        rodape.appendChild(tamanho.wrap);

        const botao = (rotulo, testid, destino, ativo) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'admin-btn admin-btn--sm admin-btn--ghost';
            b.dataset.testid = testid;
            b.textContent = rotulo;
            b.disabled = !ativo;
            if (ativo) {
                addScopedDomListener(this, 'view', b, 'click', () => {
                    this._page = destino;
                    this._render();
                });
            }
            return b;
        };
        rodape.appendChild(botao('Primeira', 'admin-audit-first', 1, pagina > 1));
        rodape.appendChild(botao('Anterior', 'admin-audit-prev', pagina - 1, pagina > 1));
        rodape.appendChild(botao('Próxima', 'admin-audit-next', pagina + 1, pagina < paginas));
        rodape.appendChild(botao('Última', 'admin-audit-last', paginas, pagina < paginas));
        return rodape;
    }
}
