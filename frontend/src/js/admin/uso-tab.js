// Path: js/admin/uso-tab.js

/**
 * @fileoverview Aba "Uso": quem usa o EBGeo, o que se produz nele e quanto, em seções sobre o
 * MESMO período: pessoas, atlas, produção (com a série diária), os atlas mais ativos, o funil de
 * entrada e a coorte de retenção. (A contagem de seções morava nesta linha e envelheceu no dia em
 * que duas nasceram; a lista viva são as chamadas de `_pintarDados`.)
 *
 * AS DUAS ÚLTIMAS SEÇÕES LEEM O PERÍODO DE OUTRO JEITO, e isso não é detalhe de apresentação: nas
 * quatro primeiras o período recorta o FATO medido, e nelas o período recorta a COORTE, com a
 * contagem seguindo até hoje. O `@fileoverview` de `uso-phrases.js` diz por quê; o que importa
 * aqui é que as duas trazem a ressalva junto (`funilHint`, `retencaoHint`), porque um número que
 * responde a outra pergunta ao lado de sete que respondem à mesma é o tipo de coisa que ninguém
 * nota.
 *
 * SÓ O ADMINISTRADOR GLOBAL a recebe (`ABAS_DO_ADMINISTRADOR`, em `admin-audience.js`), e a rota
 * exige administração no servidor. O recorte no cliente não é a fronteira de segurança: ele existe
 * para que produtor e credenciado não batam em 403 na montagem, que é a pior forma de dizer não. É
 * a mesma razão de `users`, `config`, `personnel` e `diagnostico` serem recortadas.
 *
 * DUAS METADES, DUAS FONTES, e a linha divisória é desenhada (`_cabecalhoDeUso`). As seções acima
 * contam o que o SERVIDOR registrou; as quatro de uso do produto contam o que NAVEGADORES
 * relataram, por um lote sem fila. Comparar um número de uma metade com um da outra é comparar
 * duas perguntas, e é por isso que a divisória é visível em vez de implícita: o `@fileoverview` de
 * `uso-phrases.js` diz o resto.
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
    COLUNAS_DE_DESEMPENHO,
    COLUNAS_DE_RETENCAO,
    ESTADO,
    FONTE_DO_HORIZONTE_DE_USO,
    FONTE_DO_PISO_DO_FUNIL,
    HORIZONTE,
    JANELAS,
    JANELA_PADRAO,
    METRICAS_DE_ATLAS,
    METRICAS_DE_PESSOAS,
    REGIME,
    avisosDeHorizonte,
    dadosDoPayload,
    desempenhoHint,
    desempenhoNaoInformadoNotice,
    desempenhoSubtitulo,
    desempenhoTitulo,
    desempenhoVaziaHint,
    desempenhoVaziaNotice,
    disponibilidadeGraficoLegenda,
    disponibilidadeHint,
    disponibilidadeNaoInformadoNotice,
    disponibilidadeSubtitulo,
    disponibilidadeTitulo,
    disponibilidadeVaziaNotice,
    estadoDaFonte,
    estadoDaTela,
    falhaNotice,
    ferramentasHint,
    ferramentasNaoInformadoNotice,
    ferramentasSubtitulo,
    ferramentasTitulo,
    ferramentasVaziaNotice,
    funilEscopoHint,
    funilHint,
    funilInformado,
    funilNaoInformadoNotice,
    funilPassos,
    funilPisoNotice,
    funilSubtitulo,
    funilTemPiso,
    funilTitulo,
    funilVazioHint,
    funilVazioNotice,
    geometriaDaSerie,
    graficoLegenda,
    janelaEmPalavras,
    janelaHint,
    janelaLabel,
    larguraDaBarra,
    lerMetricas,
    lerMetricasDeSessoes,
    linhasDeDesempenho,
    linhasDeFerramentas,
    linhasDeRetencao,
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
    regimeLabel,
    resumoDaSerie,
    resumoDaSerieLabel,
    retencaoColunaCoorte,
    retencaoColunaTamanho,
    retencaoHint,
    retencaoInformada,
    retencaoNaoInformadaNotice,
    retencaoSubtitulo,
    retencaoTitulo,
    retencaoVaziaHint,
    retencaoVaziaNotice,
    serieDeDisponibilidade,
    serieDeSessoes,
    sessoesGraficoLegenda,
    sessoesNaoInformadoNotice,
    sessoesSubtitulo,
    sessoesTitulo,
    sessoesVaziaHint,
    sessoesVaziaNotice,
    sessoesInformado,
    sessoesRetidasNotice,
    tabSubtitle,
    tituloDeBarraDeIndisponibilidade,
    tituloDeBarraDeSessao,
    topHint,
    topVazioNotice,
    usoDoProdutoHint,
    usoHorizonteNotice,
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

        // AS QUATRO SEÇÕES DE USO DO PRODUTO VÊM AQUI, entre o "quanto se produziu" e as duas de
        // coorte, e a posição é de leitura: elas ainda respondem "quanto", mas medem o USO (o que
        // o navegador de quem trabalha relatou) e não a PRODUÇÃO (o que o servidor recebeu). Os
        // dois conjuntos não se somam nem se conferem: são fontes diferentes, com falhas
        // diferentes, e é por isso que elas entram com cabeçalho próprio dizendo isso.
        this._corpo.appendChild(this._cabecalhoDeUso(dados, janela));
        this._corpo.appendChild(this._secaoDeSessoes(dados?.sessoes, janela));
        this._corpo.appendChild(this._secaoDeFerramentas(dados?.ferramentas, janela));
        this._corpo.appendChild(this._secaoDeDesempenho(dados?.desempenho, janela));
        this._corpo.appendChild(this._secaoDeDisponibilidade(dados?.disponibilidade, janela));

        // AS DUAS SEÇÕES DE COORTE VÊM DEPOIS DO "QUANTO", e a ordem é de leitura: as quatro
        // primeiras respondem o tamanho do uso, e estas duas o que acontece DEPOIS de alguém
        // chegar. Elas ficam abaixo do ramo de período parado de propósito, porque uma janela
        // sem movimento também não tem coorte para acompanhar, e desenhar duas tabelas vazias
        // ali repetiria com números o que a frase acima já disse.
        this._corpo.appendChild(this._secaoDeFunil(dados, janela));
        this._corpo.appendChild(this._secaoDeRetencao(dados?.retencao, janela));
    }

    /**
     * @private O funil de entrada: cadastro, primeiro atlas, primeira edição.
     *
     * O ESTADO DO HORIZONTE É LIDO UMA VEZ AQUI e desce para as frases, em vez de cada peça
     * consultar o bloco de novo: é a mesma leitura que os avisos do topo já fizeram, e duas
     * leituras da mesma chave divergem no dia em que alguém corrigir uma delas.
     * @param {*} dados @param {string} janela
     * @returns {HTMLElement}
     */
    _secaoDeFunil(dados, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = 'admin-uso-funil';
        sec.appendChild(sectionHeader(funilTitulo(), { subtitle: funilSubtitulo(janela) }));

        const estado = estadoDaFonte({
            desde: dados?.desde,
            horizonte: dados?.horizonte,
            chave: FONTE_DO_PISO_DO_FUNIL,
        });
        const piso = funilTemPiso(estado);
        const passos = funilPassos(dados?.funil, { piso });

        const wrap = card({ testid: 'admin-uso-funil-card' });
        sec.appendChild(wrap);

        // O BLOCO AUSENTE VEM ANTES DO ZERO, e a ordem é o contrato. Sem este ramo, um servidor
        // de versão anterior desenha "Nenhuma conta foi criada no período" ao lado do ladrilho
        // "Contas novas" dizendo outra coisa, na mesma tela: duas afirmações opostas custam mais
        // que uma seção que não aparece. É a mesma distinção que `HORIZONTE.DESCONHECIDO` faz.
        if (!funilInformado(dados?.funil)) {
            wrap.appendChild(notaDeSecao(funilNaoInformadoNotice(), 'admin-uso-funil-ausente'));
            return sec;
        }
        if (passos[0].total === 0) {
            wrap.appendChild(emptyState(funilVazioNotice(janela), { hint: funilVazioHint() }));
            return sec;
        }

        const lista = document.createElement('ol');
        lista.className = 'admin-uso__funil';
        lista.dataset.testid = 'admin-uso-funil-passos';
        for (const passo of passos) {
            lista.appendChild(degrauDoFunil(passo, janela));
        }
        wrap.appendChild(lista);

        // A RESSALVA DE PISO MORA DENTRO DA SEÇÃO, e não junto dos avisos do topo, porque ela
        // fala de UM passo desta lista. O aviso de cima já disse que a produção está curta; este
        // diz o que isso faz com o número que está logo acima dele.
        const ressalva = funilPisoNotice(estado);
        if (ressalva) {
            const p = document.createElement('p');
            p.className = 'admin-uso__aviso';
            p.dataset.testid = 'admin-uso-funil-piso';
            p.dataset.estado = estado;
            p.textContent = ressalva;
            sec.appendChild(p);
        }

        for (const [testid, texto] of [
            ['admin-uso-funil-hint', funilHint()],
            ['admin-uso-funil-escopo', funilEscopoHint()],
        ]) {
            const p = document.createElement('p');
            p.className = 'admin-uso__nota';
            p.dataset.testid = testid;
            p.textContent = texto;
            sec.appendChild(p);
        }
        return sec;
    }

    /**
     * @private A coorte de retenção por semana de cadastro.
     * @param {*} retencao @param {string} janela
     * @returns {HTMLElement}
     */
    _secaoDeRetencao(retencao, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = 'admin-uso-retencao';
        sec.appendChild(sectionHeader(retencaoTitulo(), { subtitle: retencaoSubtitulo(janela) }));

        // O bloco AUSENTE antes da lista vazia, pela mesma razão do funil.
        if (!retencaoInformada(retencao)) {
            const wrap = card({ testid: 'admin-uso-retencao-card' });
            wrap.appendChild(
                notaDeSecao(retencaoNaoInformadaNotice(), 'admin-uso-retencao-ausente')
            );
            sec.appendChild(wrap);
            return sec;
        }

        const linhas = linhasDeRetencao(retencao?.semanas);
        if (!linhas.length) {
            const wrap = card({ testid: 'admin-uso-retencao-card' });
            wrap.appendChild(emptyState(retencaoVaziaNotice(janela), {
                hint: retencaoVaziaHint(),
            }));
            sec.appendChild(wrap);
            return sec;
        }

        const wrap = card({ testid: 'admin-uso-retencao-card', padded: false });
        wrap.appendChild(tabelaDeRetencao(linhas));
        sec.appendChild(wrap);

        const nota = document.createElement('p');
        nota.className = 'admin-uso__nota';
        nota.dataset.testid = 'admin-uso-retencao-hint';
        nota.textContent = retencaoHint();
        sec.appendChild(nota);
        return sec;
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

    /**
     * @private O cabeçalho das quatro seções de uso: de onde elas vêm, e até onde alcançam.
     *
     * ELE EXISTE PORQUE A FONTE MUDA AQUI, e essa é a única coisa que a pessoa precisa saber antes
     * de ler os próximos quatro blocos: tudo acima é o que o SERVIDOR registrou, e tudo abaixo é o
     * que NAVEGADORES relataram. Sem a linha, um administrador compara "1.200 operações" com "40
     * sessões" e conclui que alguém produziu trinta operações por sessão — quando os dois números
     * têm denominadores diferentes e falhas diferentes.
     *
     * O HORIZONTE DAQUI NÃO ENTRA NOS AVISOS DO TOPO, e o motivo está em
     * `FONTE_DO_HORIZONTE_DE_USO`: aqueles falam de PODA, e este fala de IDADE da medição.
     * @param {*} dados @param {string} janela
     * @returns {HTMLElement}
     */
    _cabecalhoDeUso(dados, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section admin-uso__section--uso';
        sec.dataset.testid = 'admin-uso-cabecalho';

        const estado = estadoDaFonte({
            desde: dados?.desde,
            horizonte: dados?.horizonte,
            chave: FONTE_DO_HORIZONTE_DE_USO,
        });
        const aviso = usoHorizonteNotice(estado, {
            alcance: dados?.horizonte?.[FONTE_DO_HORIZONTE_DE_USO],
            janela,
        });
        if (aviso) {
            const p = document.createElement('p');
            // ENCURTADO e VAZIO são aviso (o trecho abaixo está incompleto); DESCONHECIDO é nota
            // de voz baixa, pela mesma régua dos avisos do topo: versão anterior não é incidente.
            const grave = estado === HORIZONTE.ENCURTADO || estado === HORIZONTE.VAZIO;
            p.className = grave ? 'admin-uso__aviso' : 'admin-uso__nota';
            p.dataset.testid = 'admin-uso-horizonte-uso';
            p.dataset.estado = estado;
            p.textContent = aviso;
            sec.appendChild(p);
        }

        sec.appendChild(notaDeSecao(usoDoProdutoHint(), 'admin-uso-produto-hint'));
        return sec;
    }

    /**
     * @private As sessões: cinco ladrilhos e a série diária.
     * @param {*} sessoes @param {string} janela
     * @returns {HTMLElement}
     */
    _secaoDeSessoes(sessoes, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = 'admin-uso-sessoes';
        sec.appendChild(sectionHeader(sessoesTitulo(), { subtitle: sessoesSubtitulo(janela) }));

        const wrap = card({ testid: 'admin-uso-sessoes-card' });
        sec.appendChild(wrap);

        // O BLOCO AUSENTE VEM ANTES DO ZERO, como no funil e na retenção: um servidor de versão
        // anterior não manda `sessoes`, e "nenhuma sessão" ali seria uma afirmação inventada.
        if (!sessoesInformado(sessoes)) {
            wrap.appendChild(notaDeSecao(sessoesNaoInformadoNotice(), 'admin-uso-sessoes-ausente'));
            return sec;
        }

        const grade = document.createElement('div');
        grade.className = 'admin-uso__tiles';
        for (const m of lerMetricasDeSessoes(sessoes, janela)) {
            grade.appendChild(ladrilho(m));
        }
        wrap.appendChild(grade);

        // A RESSALVA DE RETENÇÃO FICA COLADA NOS LADRILHOS, e não no fim da seção: ela fala de
        // DOIS deles, e um aviso depois do gráfico é lido depois de a leitura errada acontecer.
        const retidas = sessoesRetidasNotice(sessoes);
        if (retidas) {
            const p = document.createElement('p');
            p.className = 'admin-uso__aviso';
            p.dataset.testid = 'admin-uso-sessoes-retidas';
            p.textContent = retidas;
            wrap.appendChild(p);
        }

        const serie = serieDeSessoes(sessoes?.porDia);
        const resumo = resumoDaSerie(serie);
        if (resumo.dias === 0) {
            wrap.appendChild(emptyState(sessoesVaziaNotice(janela), { hint: sessoesVaziaHint() }));
        } else {
            wrap.appendChild(grafico(serie, resumo, {
                testid: 'admin-uso-sessoes-grafico',
                legenda: sessoesGraficoLegenda(),
                tituloDe: tituloDeBarraDeSessao,
            }));
        }
        return sec;
    }

    /**
     * @private O que foi mais acionado no período.
     * @param {*} ferramentas @param {string} janela
     * @returns {HTMLElement}
     */
    _secaoDeFerramentas(ferramentas, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = 'admin-uso-ferramentas';
        sec.appendChild(sectionHeader(ferramentasTitulo(), {
            subtitle: ferramentasSubtitulo(janela),
        }));

        if (!Array.isArray(ferramentas)) {
            const ausente = card({ testid: 'admin-uso-ferramentas-card' });
            ausente.appendChild(
                notaDeSecao(ferramentasNaoInformadoNotice(), 'admin-uso-ferramentas-ausente')
            );
            sec.appendChild(ausente);
            return sec;
        }

        const linhas = linhasDeFerramentas(ferramentas);
        if (!linhas.length) {
            const vazio = card({ testid: 'admin-uso-ferramentas-card' });
            vazio.appendChild(emptyState(ferramentasVaziaNotice(janela)));
            sec.appendChild(vazio);
            return sec;
        }

        const wrap = card({ testid: 'admin-uso-ferramentas-card', padded: false });
        const table = document.createElement('table');
        table.className = 'admin-users__table admin-uso__table';
        table.dataset.testid = 'admin-uso-ferramentas-tabela';

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of ['Ação', 'Alvo', 'Vezes', 'Fatia']) {
            const th = document.createElement('th');
            th.textContent = h;
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const linha of linhas) {
            tbody.appendChild(linhaDeFerramenta(linha));
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        sec.appendChild(wrap);

        sec.appendChild(notaDeSecao(ferramentasHint(), 'admin-uso-ferramentas-hint'));
        return sec;
    }

    /**
     * @private O desempenho no navegador, uma linha por página.
     * @param {*} desempenho @param {string} janela
     * @returns {HTMLElement}
     */
    _secaoDeDesempenho(desempenho, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = 'admin-uso-desempenho';
        sec.appendChild(sectionHeader(desempenhoTitulo(), {
            subtitle: desempenhoSubtitulo(janela),
        }));

        if (!Array.isArray(desempenho)) {
            const ausente = card({ testid: 'admin-uso-desempenho-card' });
            ausente.appendChild(
                notaDeSecao(desempenhoNaoInformadoNotice(), 'admin-uso-desempenho-ausente')
            );
            sec.appendChild(ausente);
            return sec;
        }

        const linhas = linhasDeDesempenho(desempenho);
        if (!linhas.length) {
            const vazio = card({ testid: 'admin-uso-desempenho-card' });
            vazio.appendChild(emptyState(desempenhoVaziaNotice(janela), {
                hint: desempenhoVaziaHint(),
            }));
            sec.appendChild(vazio);
            return sec;
        }

        const wrap = card({ testid: 'admin-uso-desempenho-card', padded: false });
        const table = document.createElement('table');
        table.className = 'admin-users__table admin-uso__table admin-uso__desempenho-tabela';
        table.dataset.testid = 'admin-uso-desempenho-tabela';

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        const th0 = document.createElement('th');
        th0.textContent = 'Página';
        hrow.appendChild(th0);
        // OS CABEÇALHOS VÊM DA TABELA, e não de literais aqui: é a mesma amarração de
        // `NUMEROS_DA_SAUDE` na aba irmã, e ela existe para que trocar duas colunas de lugar não
        // passe despercebido.
        for (const coluna of COLUNAS_DE_DESEMPENHO) {
            const th = document.createElement('th');
            th.className = 'admin-uso__numero';
            th.textContent = coluna.rotulo;
            th.title = coluna.detalhe;
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const linha of linhas) {
            tbody.appendChild(linhaDeDesempenho(linha));
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        sec.appendChild(wrap);

        sec.appendChild(notaDeSecao(desempenhoHint(), 'admin-uso-desempenho-hint'));
        return sec;
    }

    /**
     * @private As telas de indisponibilidade que o cliente relatou.
     * @param {*} disponibilidade @param {string} janela
     * @returns {HTMLElement}
     */
    _secaoDeDisponibilidade(disponibilidade, janela) {
        const sec = document.createElement('section');
        sec.className = 'admin-uso__section';
        sec.dataset.testid = 'admin-uso-disponibilidade';
        sec.appendChild(sectionHeader(disponibilidadeTitulo(), {
            subtitle: disponibilidadeSubtitulo(janela),
        }));

        const wrap = card({ testid: 'admin-uso-disponibilidade-card' });
        sec.appendChild(wrap);

        if (!Array.isArray(disponibilidade)) {
            wrap.appendChild(notaDeSecao(
                disponibilidadeNaoInformadoNotice(), 'admin-uso-disponibilidade-ausente'
            ));
            return sec;
        }

        const serie = serieDeDisponibilidade(disponibilidade);
        const resumo = resumoDaSerie(serie);
        if (resumo.dias === 0) {
            wrap.appendChild(emptyState(disponibilidadeVaziaNotice(janela)));
        } else {
            wrap.appendChild(grafico(serie, resumo, {
                testid: 'admin-uso-disponibilidade-grafico',
                legenda: disponibilidadeGraficoLegenda(),
                tituloDe: tituloDeBarraDeIndisponibilidade,
            }));
        }

        // A RESSALVA FICA FORA DO RAMO DE VAZIO, e é justamente ali que ela mais vale: um gráfico
        // vazio de indisponibilidade se lê como "não houve queda", e o que ele de fato diz é
        // "nenhum relato chegou", que é outra coisa quando a causa é o servidor fora.
        sec.appendChild(notaDeSecao(disponibilidadeHint(), 'admin-uso-disponibilidade-hint'));
        return sec;
    }
}

// ===== small DOM builders =====

/**
 * Uma nota de voz baixa dentro de uma seção.
 *
 * NÃO É `emptyState`, e a diferença é de PESO: o vazio afirma um fato sobre o período ("ninguém
 * criou conta"), e esta nota afirma um fato sobre o SERVIDOR ("ele não mandou este bloco"). Dar
 * ao segundo a moldura do primeiro é o que faz uma versão anterior do servidor parecer uma
 * instalação sem uso.
 * @param {string} texto
 * @param {string} testid
 * @returns {HTMLElement}
 */
function notaDeSecao(texto, testid) {
    const p = document.createElement('p');
    p.className = 'admin-uso__nota';
    p.dataset.testid = testid;
    p.textContent = texto;
    return p;
}

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
 * TRÊS SÉRIES USAM ESTA FUNÇÃO (produção, sessões e indisponibilidade), e o que varia entre elas é
 * só o `testid`, a legenda e o substantivo do `title` de cada barra. Copiá-la três vezes por causa
 * disso é o que produz, meses depois, um gráfico de sessões cuja barra diz "operações".
 * @param {Array<{dia: string, total: number}>} serie
 * @param {{dias: number, total: number, media: number|null, pico: *}} resumo
 * @param {{testid?: string, legenda?: string, tituloDe?: Function}} [opcoes]
 * @returns {HTMLElement}
 */
function grafico(serie, resumo, { testid, legenda, tituloDe } = {}) {
    const { maximo, barras } = geometriaDaSerie(serie, tituloDe ? { tituloDe } : {});

    const fig = document.createElement('figure');
    fig.className = 'admin-uso__grafico';
    fig.dataset.testid = testid ?? 'admin-uso-grafico';

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

    const rodape = document.createElement('figcaption');
    rodape.className = 'admin-uso__grafico-legenda';
    rodape.dataset.testid = `${testid ?? 'admin-uso-grafico'}-legenda`;
    rodape.textContent = `${resumoDaSerieLabel(resumo)} ${legenda ?? graficoLegenda()}`;
    fig.appendChild(rodape);
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

/**
 * Uma linha da tabela "mais usados".
 *
 * O ID CRU VAI PARA O `title` E PARA O `dataset`, e não some da tela: o rótulo em pt-BR é para
 * quem lê, e o `evento prop` é o que se procura no código quando a pergunta vira "de onde veio
 * esta contagem". Uma tabela que só mostrasse o rótulo bonito obrigaria a adivinhar o mapeamento.
 * @param {{evento: string, prop: string, rotulo: string, alvo: string, bruto: string, contagem: number, fatia: string|null}} linha
 * @returns {HTMLTableRowElement}
 */
function linhaDeFerramenta(linha) {
    const tr = document.createElement('tr');
    tr.dataset.testid = 'admin-uso-ferramenta-linha';
    tr.dataset.evento = linha.evento;
    if (linha.prop) tr.dataset.prop = linha.prop;

    const acao = document.createElement('td');
    acao.className = 'admin-uso__atlas-nome';
    acao.textContent = linha.rotulo;
    acao.title = linha.bruto;
    tr.appendChild(acao);

    const alvo = document.createElement('td');
    alvo.textContent = linha.alvo;
    tr.appendChild(alvo);

    const vezes = document.createElement('td');
    vezes.className = 'admin-uso__numero';
    vezes.textContent = numeroLabel(linha.contagem);
    tr.appendChild(vezes);

    const fatia = document.createElement('td');
    fatia.className = 'admin-uso__numero admin-uso__tipo-fatia';
    fatia.textContent = linha.fatia ?? '';
    tr.appendChild(fatia);
    return tr;
}

/**
 * Uma linha da tabela de desempenho.
 *
 * A CÉLULA SEM AMOSTRA LEVA MARCA, e não só texto diferente: ela ocupa o lugar de um número e não
 * é um, então a folha de estilo precisa tirar o peso dela. Sem isso, "sem amostra" numa coluna de
 * p75 se lê com a mesma autoridade de "1.240 ms".
 * @param {{pagina: string, rotulo: string, celulas: Array<Object>}} linha
 * @returns {HTMLTableRowElement}
 */
function linhaDeDesempenho(linha) {
    const tr = document.createElement('tr');
    tr.dataset.testid = 'admin-uso-desempenho-linha';
    tr.dataset.pagina = linha.pagina;
    // A FONTE SAI COMO DADO, como o `estado` dos ladrilhos da aba irmã: a unidade da coluna de
    // amostras depende dela, e uma captura de tela precisa poder afirmar qual delas respondeu.
    if (linha.origem) tr.dataset.origem = linha.origem;

    const pagina = document.createElement('td');
    pagina.className = 'admin-uso__atlas-nome';
    pagina.textContent = linha.rotulo;
    tr.appendChild(pagina);

    for (const celula of linha.celulas) {
        const td = document.createElement('td');
        td.className = celula.vazia
            ? 'admin-uso__numero admin-uso__sem-amostra'
            : 'admin-uso__numero';
        td.dataset.campo = celula.campo;
        if (celula.vazia) td.dataset.vazia = 'true';
        td.title = celula.detalhe;
        td.textContent = celula.texto;
        tr.appendChild(td);
    }
    return tr;
}

/**
 * Um degrau do funil: a barra proporcional ao topo, a contagem, a conversão do degrau de cima e
 * a mediana de tempo até ele.
 *
 * A BARRA É O ÚNICO ESTILO POSTO POR JS AQUI, como a altura da coluna do gráfico: valor computado
 * em runtime, a exceção declarada da convenção.
 *
 * O PISO ENTRA COMO MARCA NO DEGRAU, e não só como parágrafo no fim da seção: a ressalva é sobre
 * ESTE número, e um aviso três parágrafos abaixo é lido depois do número, quando a leitura errada
 * já aconteceu. A marca não repete a frase, ela aponta para ela.
 * @param {{chave: string, rotulo: string, regime: string, detalhe: string, total: number, texto: string, largura: number, conversao: string|null, mediana: string|null, piso: boolean}} passo
 * @param {string} janela
 * @returns {HTMLElement}
 */
function degrauDoFunil(passo, janela) {
    const li = document.createElement('li');
    li.className = 'admin-uso__degrau';
    li.dataset.testid = `admin-uso-degrau-${passo.chave}`;
    li.dataset.regime = passo.regime;
    if (passo.piso) li.dataset.piso = 'true';

    const cabeca = document.createElement('div');
    cabeca.className = 'admin-uso__degrau-cabeca';

    const rotulo = document.createElement('span');
    rotulo.className = 'admin-uso__degrau-rotulo';
    rotulo.textContent = passo.rotulo;
    rotulo.title = passo.detalhe;

    const valor = document.createElement('span');
    valor.className = 'admin-uso__degrau-valor';
    valor.textContent = passo.texto;
    cabeca.append(rotulo, valor);
    li.appendChild(cabeca);

    const trilho = document.createElement('span');
    trilho.className = 'admin-uso__degrau-trilho';
    const barra = document.createElement('span');
    barra.className = 'admin-uso__degrau-barra';
    // Valor computado em runtime, como as outras duas barras desta aba.
    barra.style.width = `${passo.largura}%`;
    trilho.appendChild(barra);
    li.appendChild(trilho);

    const pe = document.createElement('div');
    pe.className = 'admin-uso__degrau-pe';
    for (const [classe, texto] of [
        ['admin-uso__degrau-conversao', passo.conversao],
        ['admin-uso__degrau-mediana', passo.mediana],
        ['admin-uso__degrau-piso', passo.piso ? 'piso' : null],
        ['admin-uso__degrau-regime', regimeLabel(passo.regime, janela)],
    ]) {
        if (!texto) continue;
        const span = document.createElement('span');
        span.className = classe;
        span.textContent = texto;
        pe.appendChild(span);
    }
    li.appendChild(pe);
    return li;
}

/**
 * A tabela de retenção: uma linha por coorte, uma coluna por semana acompanhada.
 *
 * `tabular-nums` VEM DO CSS e não daqui, mas a razão vale escrita perto do desenho: são cinco
 * colunas de números que se comparam VERTICALMENTE, e com largura de dígito variável as casas não
 * se alinham, que é justamente a leitura que a tabela existe para permitir.
 *
 * A CÉLULA ABERTA NÃO É UM VAZIO, e é por isso que ela leva texto e não uma célula em branco:
 * branco se lê como "zero" ou como coluna quebrada, e o que se quer dizer é "esta semana ainda não
 * terminou".
 * @param {Array<Object>} linhas
 * @returns {HTMLTableElement}
 */
function tabelaDeRetencao(linhas) {
    const table = document.createElement('table');
    table.className = 'admin-users__table admin-uso__table admin-uso__retencao-tabela';
    table.dataset.testid = 'admin-uso-retencao-tabela';

    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    for (const [texto, titulo] of [
        [retencaoColunaCoorte(), 'a semana em que aquelas contas foram criadas'],
        [retencaoColunaTamanho(), 'quantas contas nasceram naquela semana'],
    ]) {
        const th = document.createElement('th');
        th.textContent = texto;
        th.title = titulo;
        hrow.appendChild(th);
    }
    for (const coluna of COLUNAS_DE_RETENCAO) {
        const th = document.createElement('th');
        th.className = 'admin-uso__retencao-celula';
        th.textContent = coluna.rotulo;
        th.title = coluna.detalhe;
        hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const linha of linhas) {
        tbody.appendChild(linhaDeRetencao(linha));
    }
    table.appendChild(tbody);
    return table;
}

/**
 * Uma linha da tabela de retenção.
 * @param {{semana: string, rotulo: string, cadastradosTexto: string, celulas: Array<Object>}} linha
 * @returns {HTMLTableRowElement}
 */
function linhaDeRetencao(linha) {
    const tr = document.createElement('tr');
    tr.dataset.testid = 'admin-uso-retencao-linha';
    tr.dataset.semana = linha.semana;

    const coorte = document.createElement('td');
    coorte.className = 'admin-uso__retencao-coorte';
    coorte.textContent = linha.rotulo;
    tr.appendChild(coorte);

    const tamanho = document.createElement('td');
    tamanho.className = 'admin-uso__numero';
    tamanho.textContent = linha.cadastradosTexto;
    tr.appendChild(tamanho);

    for (const celula of linha.celulas) {
        tr.appendChild(celulaDeRetencaoTd(celula));
    }
    return tr;
}

/**
 * Uma célula de retenção, nos três estados dela.
 * @param {{semana: number, texto: string, percentual: string|null, aberta: boolean, desconhecida: boolean, titulo: string}} celula
 * @returns {HTMLTableCellElement}
 */
function celulaDeRetencaoTd(celula) {
    const td = document.createElement('td');
    td.className = 'admin-uso__retencao-celula';
    td.dataset.testid = 'admin-uso-retencao-celula';
    td.dataset.semana = String(celula.semana);
    if (celula.aberta) td.dataset.aberta = 'true';
    if (celula.desconhecida) td.dataset.desconhecida = 'true';
    td.title = celula.titulo;

    const valor = document.createElement('span');
    valor.className = celula.aberta
        ? 'admin-uso__retencao-valor admin-uso__retencao-valor--aberta'
        : 'admin-uso__retencao-valor';
    valor.textContent = celula.texto;
    td.appendChild(valor);

    if (celula.percentual) {
        const pct = document.createElement('span');
        pct.className = 'admin-uso__retencao-pct';
        pct.textContent = celula.percentual;
        td.appendChild(pct);
    }
    return td;
}
