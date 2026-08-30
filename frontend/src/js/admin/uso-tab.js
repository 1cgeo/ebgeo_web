// Path: js/admin/uso-tab.js

/**
 * @fileoverview Aba "Uso" — quem usa o EBGeo, o que se produz nele e quanto, em quatro seções sobre
 * o MESMO período: pessoas, atlas, produção (com a série diária) e os atlas mais ativos.
 *
 * SÓ O ADMINISTRADOR GLOBAL a recebe (`ABAS_DO_ADMINISTRADOR`, em `admin-audience.js`), e a rota
 * exige administração no servidor. O recorte no cliente não é a fronteira de segurança: ele existe
 * para que produtor e credenciado não batam em 403 na montagem, que é a pior forma de dizer não. É
 * a mesma razão de `users`, `config`, `personnel` e `diagnostico` serem recortadas.
 *
 * UMA ROTA SÓ, e por isso um desfecho só. A aba irmã (Diagnóstico) lê quatro rotas num `allSettled`
 * porque cada seção lá é independente; aqui os três blocos vêm juntos, e têm de vir juntos: um
 * pico de produção sem saber quantas pessoas entraram no mesmo período pode ser mil feições de uma
 * pessoa ou dez de cem. Metade desta tela não responde meia pergunta, responde errado.
 *
 * O AVISO DE HORIZONTE É DESENHADO À PARTE DOS TRÊS ESTADOS, e essa independência é a decisão que
 * mais custa se for tomada ao contrário. Uma instalação cujo histórico foi apagado por inteiro cai
 * no estado VAZIO, que é exatamente o caso em que a pessoa MAIS precisa ler que o dado foi embora:
 * pendurar o aviso dentro do ramo de "tem dados" o esconderia justamente ali. Ver o
 * `@fileoverview` de `uso-phrases.js` sobre as duas fontes e sobre a frase não afirmar causa.
 *
 * O GRÁFICO É DESENHADO À MÃO, com barras em CSS, e não com biblioteca. Um gráfico só não paga o
 * peso de uma dependência no bundle de `admin.html`, que hoje é uma das páginas leves do produto; e
 * a geometria inteira (altura, piso, raleamento de rótulo) é aritmética que cabe em funções puras
 * testáveis em node, o que uma biblioteca tornaria intestável. A altura de cada barra é o único
 * estilo posto por JS nesta aba, e é o caso que a convenção da casa admite: valor computado em
 * runtime.
 *
 * NADA AQUI MONTA HTML COM DADO. Nome de atlas e nome de dono são texto de usuário e saem por
 * `textContent`.
 */

import { apiClient } from '@store/sync/api-client.js';
// Do ARQUIVO, nunca dos barrels `@utils` / `@modals`: esta página não carrega a store, e os
// barrels a alcançam transitivamente.
import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
} from '@utils/event-cleanup.js';
import { sectionHeader, card, emptyState, failureState, ICON_USO } from './admin-dom.js';
import {
    ESTADO,
    HORIZONTE,
    JANELAS,
    JANELA_PADRAO,
    METRICAS_DE_ATLAS,
    METRICAS_DE_PESSOAS,
    REGIME,
    avisosDeHorizonte,
    dadosDoPayload,
    estadoDaTela,
    falhaNotice,
    geometriaDaSerie,
    graficoLegenda,
    janelaEmPalavras,
    janelaHint,
    janelaLabel,
    larguraDaBarra,
    lerMetricas,
    normalizarJanela,
    numeroLabel,
    ordenarTopAtlas,
    periodoLabel,
    periodoParadoHint,
    periodoParadoNotice,
    periodoSemMovimento,
    preencherDias,
    producaoPorEntidade,
    producaoVaziaNotice,
    resumoDaSerie,
    resumoDaSerieLabel,
    tabSubtitle,
    topHint,
    topVazioNotice,
    vazioHint,
    vazioNotice,
} from './uso-phrases.js';

/**
 * A rota, montada a partir da janela.
 * @param {string} janela
 * @returns {string}
 */
function rotaDaJanela(janela) {
    return `/uso/resumo?desde=${encodeURIComponent(janela)}`;
}

/**
 * Uma leitura de `/uso`, com o envelope `{ data }` já desembrulhado pelo cliente.
 *
 * PASSA PELO MÉTODO INTERNO do cliente HTTP de propósito, e o motivo é de fronteira e não de gosto:
 * `frontend/src/js/store/sync/` é território de outra frente, e um método público novo lá seria
 * escrita fora do escopo desta aba. O embrulho fica AQUI, num lugar só, para que o dia em que
 * `apiClient` ganhar `getUsoResumo` a troca seja de duas linhas. É o mesmo arranjo de `diag-tab.js`.
 * @param {string} caminho
 * @returns {Promise<*>}
 */
async function pedirUso(caminho) {
    return apiClient._request('GET', caminho);
}

/**
 * Builds the "Uso" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createUsoTab() {
    const tab = new UsoTab();
    return {
        id: 'uso',
        label: 'Uso',
        testid: 'admin-tab-uso',
        icon: ICON_USO,
        mount: (container) => tab.mount(container),
    };
}

class UsoTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        this._janela = JANELA_PADRAO;
        // O CONTADOR DE GERAÇÃO é a proteção contra a troca rápida de período: duas leituras em voo
        // e a ÚLTIMA A RESPONDER pinta a tela, que pode ser a do período já abandonado. Mesma
        // correção das abas Auditoria e Diagnóstico, e pelo mesmo motivo de não haver costura de
        // `signal` no cliente HTTP compartilhado.
        this._geracao = 0;
        setupCleanup(this);
        this._render();
        return () => {
            this._alive = false;
            cleanup(this);
        };
    }

    /**
     * @private A moldura, desenhada UMA vez. Trocar o período repinta o corpo e deixa o cabeçalho
     * onde está: um seletor que se redesenha a cada uso perde o foco do teclado no meio do gesto.
     */
    _render() {
        clearScopedListeners(this, 'view');
        const c = this._container;
        c.replaceChildren();

        c.appendChild(sectionHeader('Uso', {
            subtitle: tabSubtitle(),
            actions: [this._seletorDeJanela()],
        }));

        const dica = document.createElement('p');
        dica.className = 'admin-uso__hint';
        dica.dataset.testid = 'admin-uso-hint';
        dica.textContent = janelaHint();
        c.appendChild(dica);

        // O AVISO DE HORIZONTE MORA FORA DO CORPO, e é por isso que ele sobrevive ao estado vazio:
        // ver o `@fileoverview`.
        this._avisos = document.createElement('div');
        this._avisos.className = 'admin-uso__avisos';
        this._avisos.dataset.testid = 'admin-uso-avisos';
        c.appendChild(this._avisos);

        this._corpo = document.createElement('div');
        this._corpo.className = 'admin-uso__corpo';
        c.appendChild(this._corpo);

        this._carregar();
    }

    /**
     * @private O seletor de período, um para a aba inteira.
     * @returns {HTMLElement}
     */
    _seletorDeJanela() {
        const box = document.createElement('div');
        box.className = 'admin-uso__janela';

        const id = 'admin-uso-janela-select';
        const label = document.createElement('label');
        label.className = 'admin-uso__janela-label';
        label.htmlFor = id;
        label.textContent = janelaLabel();
        box.appendChild(label);

        const select = document.createElement('select');
        select.id = id;
        select.className = 'admin-input admin-input--sm';
        select.dataset.testid = 'admin-uso-janela';
        for (const j of JANELAS) {
            const opt = document.createElement('option');
            opt.value = j.valor;
            opt.textContent = j.rotulo;
            if (j.valor === this._janela) opt.selected = true;
            select.appendChild(opt);
        }
        addScopedDomListener(this, 'view', select, 'change', () => {
            this._janela = normalizarJanela(select.value);
            this._carregar();
        });
        box.appendChild(select);
        this._select = select;
        return box;
    }

    /**
     * @private Lê a rota e pinta o corpo.
     */
    async _carregar() {
        const geracao = ++this._geracao;
        const janela = this._janela;

        this._avisos.replaceChildren();
        this._pintarCarregando();
        if (this._select) this._select.disabled = true;

        let resposta = null;
        let erro = null;
        try {
            resposta = await pedirUso(rotaDaJanela(janela));
        } catch (e) {
            erro = e;
        }
        if (!this._alive || geracao !== this._geracao) return;
        if (this._select) this._select.disabled = false;

        const dados = erro ? null : dadosDoPayload(resposta);
        const estado = estadoDaTela({ erro, dados });

        // OS AVISOS VÊM ANTES DO CORPO, e são desenhados mesmo no ramo vazio (nunca no de falha, em
        // que não há resposta de que lê-los).
        if (estado !== ESTADO.FALHA) this._pintarAvisos(dados, janela);

        if (estado === ESTADO.FALHA) {
            this._pintarFalha(erro);
            return;
        }
        if (estado === ESTADO.VAZIO) {
            this._pintarVazio();
            return;
        }
        this._pintarDados(dados, janela);
    }

    /** @private O terceiro estado de tela, distinto do vazio e da falha. */
    _pintarCarregando() {
        this._corpo.replaceChildren();
        const wrap = card();
        const p = document.createElement('p');
        p.className = 'admin-users__status';
        p.textContent = 'Carregando…';
        wrap.appendChild(p);
        this._corpo.appendChild(wrap);
    }

    /**
     * @private
     * @param {*} erro
     */
    _pintarFalha(erro) {
        this._corpo.replaceChildren();
        // A MENSAGEM DO SERVIDOR NÃO SE PERDE: "404" aqui significa rota ausente nesta implantação,
        // e "403" significa que o papel mudou no meio da sessão. A frase da casa entra antes, para
        // que a mensagem crua não fique sozinha.
        const bruta = typeof erro?.message === 'string' ? erro.message.trim() : '';
        const frase = bruta ? `${falhaNotice()} ${bruta}` : falhaNotice();
        this._corpo.appendChild(failureState(frase, {
            onRetry: () => { if (this._alive) this._carregar(); },
        }));
    }

    /** @private A instalação em que nada aconteceu ainda. */
    _pintarVazio() {
        this._corpo.replaceChildren();
        const wrap = card();
        wrap.dataset.testid = 'admin-uso-vazio';
        wrap.appendChild(emptyState(vazioNotice(), { hint: vazioHint() }));
        this._corpo.appendChild(wrap);
    }

    /**
     * @private Os avisos de horizonte, um por fonte que mereça frase.
     *
     * DOIS PESOS: encurtado e vazio são avisos (o dado da tela está incompleto e a pessoa precisa
     * saber ANTES de ler o gráfico); desconhecido é nota de voz baixa, porque servidor de versão
     * anterior não é incidente e alarmar a cada carga ensina a ignorar o alarme.
     * @param {*} dados @param {string} janela
     */
    _pintarAvisos(dados, janela) {
        this._avisos.replaceChildren();
        const avisos = avisosDeHorizonte({
            desde: dados?.desde,
            horizonte: dados?.horizonte,
            janela,
        });
        for (const aviso of avisos) {
            const p = document.createElement('p');
            const grave = aviso.estado === HORIZONTE.ENCURTADO || aviso.estado === HORIZONTE.VAZIO;
            p.className = grave ? 'admin-uso__aviso' : 'admin-uso__nota';
            p.dataset.testid = grave ? 'admin-uso-aviso' : 'admin-uso-nota';
            p.dataset.fonte = aviso.chave;
            p.dataset.estado = aviso.estado;
            p.textContent = aviso.texto;
            this._avisos.appendChild(p);
        }
    }

    /**
     * @private O corpo inteiro.
     * @param {*} dados @param {string} janela
     */
    _pintarDados(dados, janela) {
        this._corpo.replaceChildren();

        const periodo = periodoLabel(dados?.desde);
        if (periodo) {
            const p = document.createElement('p');
            p.className = 'admin-uso__nota';
            p.dataset.testid = 'admin-uso-periodo';
            p.textContent = periodo;
            this._corpo.appendChild(p);
        }

        this._corpo.appendChild(this._secaoDeMetricas('Pessoas',
            'Quem tem conta, quem entrou e quem produziu',
            lerMetricas(dados?.pessoas, METRICAS_DE_PESSOAS, janela), 'admin-uso-pessoas'));

        this._corpo.appendChild(this._secaoDeMetricas('Atlas',
            'Quantos existem, quantos nasceram, quantos foram excluídos e quantos se mexeram',
            lerMetricas(dados?.atlas, METRICAS_DE_ATLAS, janela), 'admin-uso-atlas'));

        // O PERÍODO PARADO NÃO ZERA A TELA: os dois estoques de hoje acima continuam sendo fato, e
        // são justamente eles que dizem que o silêncio abaixo é de uma janela, não do produto.
        if (periodoSemMovimento(dados)) {
            const parado = document.createElement('section');
            parado.className = 'admin-uso__section';
            parado.dataset.testid = 'admin-uso-parado';
            parado.appendChild(emptyState(periodoParadoNotice(janela), {
                hint: periodoParadoHint(),
            }));
            this._corpo.appendChild(parado);
            return;
        }

        this._corpo.appendChild(this._secaoDeProducao(dados?.producao, janela));
        this._corpo.appendChild(this._secaoDeTop(dados?.atlas?.top, janela));
    }

    /**
     * @private Uma seção de ladrilhos.
     *
     * O REGIME É DESENHADO A PARTIR DO CAMPO, e nunca escrito à mão por ladrilho: é o que impede
     * um número de hoje de ganhar a legenda do período. Ver o `@fileoverview` de `uso-phrases.js`.
     * @param {string} titulo @param {string} subtitulo @param {Array<Object>} metricas
     * @param {string} testid
     * @returns {HTMLElement}
     */
    _secaoDeMetricas(titulo, subtitulo, metricas, testid) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = testid;
        sec.appendChild(sectionHeader(titulo, { subtitle: subtitulo }));

        const wrap = card({ testid: `${testid}-card` });
        const grade = document.createElement('div');
        grade.className = 'admin-uso__tiles';
        for (const m of metricas) {
            grade.appendChild(ladrilho(m));
        }
        wrap.appendChild(grade);
        sec.appendChild(wrap);
        return sec;
    }

    /**
     * @private A seção de produção: o total, a série diária e a quebra por tipo.
     * @param {*} producao @param {string} janela
     * @returns {HTMLElement}
     */
    _secaoDeProducao(producao, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = 'admin-uso-producao';
        sec.appendChild(sectionHeader('Produção', {
            subtitle: 'Operações de sync recebidas pelo servidor no período',
        }));

        const wrap = card({ testid: 'admin-uso-producao-card' });
        sec.appendChild(wrap);

        const serie = preencherDias(producao?.porDia);
        const resumo = resumoDaSerie(serie);
        const tipos = producaoPorEntidade(producao?.porEntidade);

        const total = document.createElement('div');
        total.className = 'admin-uso__tiles';
        total.appendChild(ladrilho({
            chave: 'operacoes',
            rotulo: 'Operações',
            regime: REGIME.PERIODO,
            texto: numeroLabel(producao?.total),
            regimeTexto: janelaEmPalavras(janela),
            detalhe: `operações de sync recebidas pelo servidor ${janelaEmPalavras(janela)}`,
            destaque: true,
        }));
        wrap.appendChild(total);

        if (resumo.dias === 0) {
            wrap.appendChild(emptyState(producaoVaziaNotice(janela)));
        } else {
            wrap.appendChild(grafico(serie, resumo));
        }

        if (tipos.length) {
            wrap.appendChild(listaDeTipos(tipos));
        }
        return sec;
    }

    /**
     * @private Os atlas mais ativos.
     * @param {*} top @param {string} janela
     * @returns {HTMLElement}
     */
    _secaoDeTop(top, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = 'admin-uso-top';
        sec.appendChild(sectionHeader('Atlas mais ativos', {
            subtitle: 'Os dez que mais receberam operações no período',
        }));

        const wrap = card({ testid: 'admin-uso-top-card', padded: false });
        sec.appendChild(wrap);

        const linhas = ordenarTopAtlas(top);
        if (!linhas.length) {
            wrap.appendChild(emptyState(topVazioNotice(janela), { hint: topHint() }));
            return sec;
        }

        const table = document.createElement('table');
        table.className = 'admin-users__table admin-uso__table';
        table.dataset.testid = 'admin-uso-top-tabela';
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of ['Atlas', 'Dono', 'Operações']) {
            const th = document.createElement('th');
            th.textContent = h;
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const linha of linhas) {
            tbody.appendChild(linhaDeAtlas(linha));
        }
        table.appendChild(tbody);
        wrap.appendChild(table);

        const nota = document.createElement('p');
        nota.className = 'admin-uso__nota';
        nota.dataset.testid = 'admin-uso-top-nota';
        nota.textContent = topHint();
        sec.appendChild(nota);
        return sec;
    }
}

// ===== small DOM builders =====

/**
 * Um ladrilho: número grande, rótulo, e o REGIME embaixo.
 *
 * O REGIME É PARTE DO LADRILHO E NÃO DECORAÇÃO: sem ele, "42" sob "Contas ativas" numa tela cujo
 * cabeçalho diz "últimos 30 dias" lê como crescimento e é estoque. Ver o `@fileoverview` de
 * `uso-phrases.js`.
 * @param {{rotulo?: string, texto?: string, regimeTexto?: string, detalhe?: string, chave?: string, regime?: string, destaque?: boolean}} m
 * @returns {HTMLElement}
 */
function ladrilho(m) {
    const el = document.createElement('div');
    el.className = m.destaque ? 'admin-uso__tile admin-uso__tile--destaque' : 'admin-uso__tile';
    if (m.chave) el.dataset.testid = `admin-uso-tile-${m.chave}`;
    if (m.regime) el.dataset.regime = m.regime;

    const v = document.createElement('span');
    v.className = 'admin-uso__tile-valor';
    v.textContent = m.texto ?? '—';
    if (m.detalhe) v.title = m.detalhe;

    const r = document.createElement('span');
    r.className = 'admin-uso__tile-rotulo';
    r.textContent = m.rotulo ?? '';

    const g = document.createElement('span');
    g.className = 'admin-uso__tile-regime';
    g.textContent = m.regimeTexto ?? '';

    el.append(v, r, g);
    return el;
}

/**
 * O gráfico da série diária: uma coluna por dia, altura em percentual da maior.
 *
 * DESENHADO À MÃO, sem biblioteca, e a aritmética inteira está em `geometriaDaSerie`. A altura é o
 * único estilo posto por JS nesta aba, e é o caso que a convenção admite (valor computado em
 * runtime). O dia sem produção NÃO some: ele fica com a coluna dele, altura zero, sobre a linha de
 * base — buraco no eixo se lê como dado que não chegou, que é a afirmação oposta.
 * @param {Array<{dia: string, total: number}>} serie
 * @param {{dias: number, total: number, media: number|null, pico: *}} resumo
 * @returns {HTMLElement}
 */
function grafico(serie, resumo) {
    const { maximo, barras } = geometriaDaSerie(serie);

    const fig = document.createElement('figure');
    fig.className = 'admin-uso__grafico';
    fig.dataset.testid = 'admin-uso-grafico';

    const moldura = document.createElement('div');
    moldura.className = 'admin-uso__grafico-moldura';

    const eixoY = document.createElement('div');
    eixoY.className = 'admin-uso__eixo-y';
    const topo = document.createElement('span');
    topo.textContent = numeroLabel(maximo);
    const base = document.createElement('span');
    base.textContent = '0';
    eixoY.append(topo, base);
    moldura.appendChild(eixoY);

    const colunas = document.createElement('ol');
    colunas.className = 'admin-uso__colunas';
    colunas.dataset.testid = 'admin-uso-colunas';
    for (const b of barras) {
        colunas.appendChild(coluna(b));
    }
    moldura.appendChild(colunas);
    fig.appendChild(moldura);

    const legenda = document.createElement('figcaption');
    legenda.className = 'admin-uso__grafico-legenda';
    legenda.dataset.testid = 'admin-uso-grafico-legenda';
    legenda.textContent = `${resumoDaSerieLabel(resumo)} ${graficoLegenda()}`;
    fig.appendChild(legenda);
    return fig;
}

/**
 * Uma coluna do gráfico.
 * @param {{dia: string, total: number, alturaPct: number, zero: boolean, rotulo: string, titulo: string, mostrarRotulo: boolean}} b
 * @returns {HTMLElement}
 */
function coluna(b) {
    const li = document.createElement('li');
    li.className = 'admin-uso__coluna';
    li.dataset.testid = 'admin-uso-coluna';
    li.dataset.dia = b.dia;
    li.title = b.titulo;

    const caixa = document.createElement('span');
    caixa.className = 'admin-uso__barra-caixa';
    const barra = document.createElement('span');
    barra.className = b.zero ? 'admin-uso__barra admin-uso__barra--zero' : 'admin-uso__barra';
    barra.dataset.zero = String(b.zero);
    // Valor computado em runtime: a exceção declarada da convenção "sem estilo inline em JS".
    barra.style.height = `${b.alturaPct}%`;
    caixa.appendChild(barra);
    li.appendChild(caixa);

    const rotulo = document.createElement('span');
    rotulo.className = 'admin-uso__coluna-rotulo';
    rotulo.textContent = b.mostrarRotulo ? b.rotulo : '';
    li.appendChild(rotulo);
    return li;
}

/**
 * A produção por tipo de entidade, com barra de comparação.
 * @param {Array<{entidade: string, rotulo: string, total: number, fatia: string|null}>} tipos
 * @returns {HTMLElement}
 */
function listaDeTipos(tipos) {
    const maximo = tipos.reduce((acc, t) => Math.max(acc, t.total), 0);
    const lista = document.createElement('ul');
    lista.className = 'admin-uso__tipos';
    lista.dataset.testid = 'admin-uso-tipos';
    for (const t of tipos) {
        const li = document.createElement('li');
        li.className = 'admin-uso__tipo';
        li.dataset.testid = 'admin-uso-tipo';
        li.dataset.entidade = t.entidade;

        const nome = document.createElement('span');
        nome.className = 'admin-uso__tipo-nome';
        nome.textContent = t.rotulo;

        const trilho = document.createElement('span');
        trilho.className = 'admin-uso__tipo-trilho';
        const preenchimento = document.createElement('span');
        preenchimento.className = 'admin-uso__tipo-barra';
        // Valor computado em runtime, como a altura da coluna do gráfico.
        preenchimento.style.width = `${larguraDaBarra(t.total, maximo)}%`;
        trilho.appendChild(preenchimento);

        const valor = document.createElement('span');
        valor.className = 'admin-uso__tipo-valor';
        valor.textContent = numeroLabel(t.total);

        const fatia = document.createElement('span');
        fatia.className = 'admin-uso__tipo-fatia';
        fatia.textContent = t.fatia ?? '';

        li.append(nome, trilho, valor, fatia);
        lista.appendChild(li);
    }
    return lista;
}

/**
 * Uma linha da tabela de atlas mais ativos.
 * @param {{id: string, nome: string, dono: string, operacoes: number}} linha
 * @returns {HTMLTableRowElement}
 */
function linhaDeAtlas(linha) {
    const tr = document.createElement('tr');
    tr.dataset.testid = 'admin-uso-top-linha';
    if (linha.id) tr.dataset.atlasId = linha.id;

    const nome = document.createElement('td');
    nome.className = 'admin-uso__atlas-nome';
    nome.textContent = linha.nome;
    tr.appendChild(nome);

    const dono = document.createElement('td');
    dono.textContent = linha.dono;
    tr.appendChild(dono);

    const ops = document.createElement('td');
    ops.className = 'admin-uso__numero';
    ops.textContent = numeroLabel(linha.operacoes);
    tr.appendChild(ops);
    return tr;
}
