// Path: js/admin/diag-tab.js

/**
 * @fileoverview Aba "Diagnóstico" — a saúde do servidor e dos navegadores em quatro seções sobre a
 * MESMA janela de tempo: o pulso de requisições, os erros do servidor agrupados, os erros
 * relatados pelos navegadores e a latência por rota.
 *
 * SÓ O ADMINISTRADOR GLOBAL a recebe (`ABAS_DO_ADMINISTRADOR`, em `admin-audience.js`), e as
 * quatro rotas exigem administração no servidor. O recorte no cliente não é a fronteira de
 * segurança: ele existe para que produtor e credenciado não batam em 403 na montagem, que é a
 * pior forma de dizer não. É a mesma razão de `users`, `config` e `personnel` serem recortadas.
 *
 * A JANELA É UMA SÓ PARA A ABA INTEIRA, e não uma por seção. Comparar o pico de 5xx da última
 * hora com a latência dos últimos sete dias não responde nada, e dois seletores convidam
 * exatamente a isso. O teto de sete dias é do servidor; o seletor não oferece além dele.
 *
 * AS QUATRO CHAMADAS FALHAM SEPARADAS. Elas saem juntas num `allSettled` e cada seção pinta o
 * próprio desfecho: uma rota que ainda não exista (404) ou uma rede ruim que derrube a terceira
 * não pode esconder as outras três, e cada falha tem o seu botão de tentar de novo. É o mesmo
 * arranjo da aba Concessões, inclusive o embrulho `settle`, que existe porque
 * `Promise.allSettled` só protege de promessa REJEITADA: um erro SÍNCRONO na montagem do
 * argumento (o método não existir no cliente HTTP) escapa por cima dele e deixa a aba em
 * "Carregando…" para sempre.
 *
 * O DADO DESTA ABA É HOSTIL, e é a única do painel em que isso é literal. Mensagem, pilha, URL e
 * user agent de um erro de navegador são texto arbitrário escrito pela máquina de quem visitou a
 * página PÚBLICA: nada aqui monta HTML, tudo entra por `textContent`, e a pilha vai para um
 * `<pre>` cujo conteúdo também é `textContent`. `resumirTexto` (`diag-phrases.js`) corta por
 * LAYOUT e nunca por segurança. O ENDEREÇO DO CLIENTE ENTRA NESSA MESMA CONTA: com um proxy à
 * frente ele sai do `X-Forwarded-For`, escrito por quem chamou.
 *
 * E ELE É DADO PESSOAL NUMA TELA, então entra AGREGADO e nunca como lista de ocorrências: quantos
 * endereços distintos, e os poucos mais frequentes com contagem (`blocoDeEnderecos`). A pergunta
 * que a coluna existe para responder ("este pico de 401 é um endereço ou trezentos?") é de
 * contagem, e a lista longa acrescentaria exposição sem acrescentar resposta.
 *
 * A CONTAGEM MANDA NA TELA. Ela é o primeiro elemento de cada linha, com peso visual em escada
 * logarítmica (`pesoDaContagem`): quem abre esta aba está escolhendo o que consertar primeiro.
 *
 * MAS SÓ A LISTA DO SERVIDOR É ORDENADA POR ELA, e a exceção é o conserto de 2026-09-01. A
 * contagem do lado do NAVEGADOR é um acumulado vitalício de relatos, e o servidor corta aquela
 * lista pelas mais RECENTES: ordenar por contagem produzia um pódio sobre uma amostra escolhida
 * por outro critério, sem nada na tela dizendo isso. Aquela lista agora sai por recência, com a
 * legenda do número acima dela. Ver `ordenarItensCliente` e `clientErrorsListaNotice`.
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
import { sectionHeader, card, emptyState, failureState, ICON_DIAG } from './admin-dom.js';
import {
    JANELAS,
    JANELA_PADRAO,
    assinaturaLabel,
    clientErrorsEmptyHint,
    clientErrorsEmptyNotice,
    clientErrorsFailureNotice,
    clientErrorsListaNotice,
    clientErrorsScopeNotice,
    contagemDetalhe,
    contagemHistoricaDetalhe,
    contagemHistoricaUnidade,
    contagemLabel,
    cortadaNotice,
    enderecoLabel,
    ENDERECOS,
    enderecosAusentesNotice,
    enderecosNotice,
    estadoDaContagemDeErros,
    estadoDaLatencia,
    estadoDaSecao,
    estadoDosEnderecos,
    ESTADO,
    faixasOrdenadas,
    horaLocal,
    horaLocalCompleta,
    intervaloDeOcorrencias,
    janelaHint,
    janelaLabel,
    latenciaLabel,
    leitorCego,
    leitorCegoNotice,
    listaDoPayload,
    mensagemLabel,
    metodoEUrl,
    normalizarJanela,
    ordenarGrupos,
    ordenarItensCliente,
    ordenarRotas,
    paginaLabel,
    pesoDaContagem,
    principaisDeEnderecos,
    pulsoEmptyHint,
    pulsoEmptyNotice,
    pulsoFailureNotice,
    resumirTexto,
    rotaLabel,
    serverErrorsEmptyHint,
    serverErrorsEmptyNotice,
    serverErrorsFailureNotice,
    serverErrorsScanNotice,
    slowEmptyHint,
    slowEmptyNotice,
    slowFailureNotice,
    slowScopeNotice,
    statusLabel,
    tabSubtitle,
    taxaDeErro,
    truncamentoNotice,
    usuarioLabel,
} from './diag-phrases.js';

/**
 * Os tetos de cada lista.
 *
 * TRÊS NÚMEROS DIFERENTES, e a diferença é de propósito: um grupo de erro de servidor já é um
 * agregado de muitas ocorrências (vinte grupos é uma tela cheia de defeitos distintos), a lista
 * de rotas lentas serve para escolher UMA para consertar, e o erro de navegador chega item a
 * item, sem agrupamento tão agressivo do outro lado.
 */
const LIMITE_ERROS_SERVIDOR = 20;
const LIMITE_LENTO = 15;
const LIMITE_ERROS_CLIENTE = 50;

/**
 * As quatro rotas, montadas a partir da janela.
 * @param {string} janela
 * @returns {{status: string, erros: string, lento: string, errosCliente: string}}
 */
function rotasDaJanela(janela) {
    const desde = encodeURIComponent(janela);
    return {
        status: `/diag/status?desde=${desde}`,
        erros: `/diag/erros?desde=${desde}&limite=${LIMITE_ERROS_SERVIDOR}`,
        lento: `/diag/lento?desde=${desde}&limite=${LIMITE_LENTO}`,
        errosCliente: `/diag/erros-cliente?desde=${desde}&limite=${LIMITE_ERROS_CLIENTE}`,
    };
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
        // O CONTADOR DE GERAÇÃO é a proteção contra a troca rápida de janela: duas leituras em voo
        // e a ÚLTIMA A RESPONDER pinta a tela, que pode ser a da janela já abandonada. Mesma
        // correção da aba Auditoria, e pelo mesmo motivo de não haver costura de `signal` no
        // cliente HTTP compartilhado.
        this._geracao = 0;
        setupCleanup(this);
        this._render();
        return () => {
            this._alive = false;
            cleanup(this);
        };
    }

    /**
     * @private A moldura, desenhada UMA vez. Trocar a janela repinta as quatro seções e deixa o
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
        this._secaoServidor = this._secao('admin-diag-servidor');
        this._secaoCliente = this._secao('admin-diag-cliente');
        this._secaoLatencia = this._secao('admin-diag-latencia');
        c.append(this._secaoPulso, this._secaoServidor, this._secaoCliente, this._secaoLatencia);

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
            this._janela = normalizarJanela(select.value);
            this._carregar();
        });
        box.appendChild(select);
        this._select = select;
        return box;
    }

    /**
     * @private Lê as quatro rotas e pinta as quatro seções.
     */
    async _carregar() {
        const geracao = ++this._geracao;
        const janela = this._janela;
        const rotas = rotasDaJanela(janela);

        this._pintarCarregando(this._secaoPulso, 'Pulso de requisições');
        this._pintarCarregando(this._secaoServidor, 'Erros do servidor');
        this._pintarCarregando(this._secaoCliente, 'Erros do navegador');
        this._pintarCarregando(this._secaoLatencia, 'Latência por rota');
        if (this._select) this._select.disabled = true;

        const [status, erros, cliente, lento] = await Promise.allSettled([
            settle(() => pedirDiag(rotas.status)),
            settle(() => pedirDiag(rotas.erros)),
            settle(() => pedirDiag(rotas.errosCliente)),
            settle(() => pedirDiag(rotas.lento)),
        ]);
        if (!this._alive || geracao !== this._geracao) return;
        if (this._select) this._select.disabled = false;

        this._pintarPulso(this._secaoPulso, status, janela);
        this._pintarErrosServidor(this._secaoServidor, erros, janela);
        this._pintarErrosCliente(this._secaoCliente, cliente, janela);
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
        // O VAZIO AQUI NÃO É BOA NOTÍCIA, ao contrário do das outras três: servidor que não
        // respondeu nada no período é ou reinício recente ou registro que parou de ser escrito.
        if (total === null && faixas.length === 0) {
            wrap.appendChild(failureState(pulsoFailureNotice(), {
                onRetry: () => { if (this._alive) this._carregar(); },
            }));
            return;
        }
        // A TERCEIRA SEÇÃO QUE LÊ O MESMO LOG, e a ordem é a mesma das outras duas: o leitor cego
        // vem ANTES do vazio. Sem o diretório de log a rota responde com SUCESSO e total zero, e
        // "nenhuma requisição registrada nas últimas 24 horas" seria a boa notícia desenhada a
        // partir de um instrumento desligado, ao lado de duas seções dizendo que estão cegas.
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
     * @private Seção 2: os erros do servidor, agrupados por assinatura.
     * @param {HTMLElement} host @param {PromiseSettledResult<*>} resultado @param {string} janela
     */
    _pintarErrosServidor(host, resultado, janela) {
        host.replaceChildren();
        host.appendChild(sectionHeader('Erros do servidor', {
            subtitle: 'Agrupados pela assinatura da falha, do mais frequente para o menos',
        }));
        const wrap = card({ testid: 'admin-diag-servidor-card', padded: false });
        host.appendChild(wrap);

        const erro = resultado.status === 'rejected' ? resultado.reason : null;
        const payload = erro ? null : resultado.value;
        const grupos = erro ? null : listaDoPayload(payload, 'grupos');
        const estado = estadoDaSecao({ erro, itens: grupos });

        if (estado === ESTADO.FALHA) {
            this._falha(wrap, serverErrorsFailureNotice(), erro);
            return;
        }
        // O LEITOR CEGO VEM ANTES DO VAZIO, e a ordem é o conserto: a rota responde com SUCESSO e
        // lista vazia quando o diretório de log não existe, então a boa notícia desenhada aqui
        // afirmaria saúde a partir de um instrumento desligado.
        if (leitorCego(payload)) {
            wrap.appendChild(failureState(leitorCegoNotice(), {
                onRetry: () => { if (this._alive) this._carregar(); },
            }));
            this._notasDaLeitura(host, payload);
            return;
        }
        if (estado === ESTADO.VAZIO) {
            wrap.appendChild(bomVazio(serverErrorsEmptyNotice(janela), serverErrorsEmptyHint()));
            this._notasDaLeitura(host, payload);
            return;
        }

        const linhas = ordenarGrupos(grupos);
        // A AUSÊNCIA DO ENDEREÇO É DITA UMA VEZ, ACIMA DA LISTA, e não vinte vezes dentro dela:
        // ela é propriedade do SERVIDOR (uma versão anterior à agregação por endereço não manda o
        // campo), igual em toda linha, e repetida por linha vira o alarme que ensina a ignorar
        // alarme. Só quando NENHUM grupo traz o campo, porque um payload em que só alguns trazem é
        // afirmação sobre aqueles grupos, e aí quem fala é a linha.
        if (linhas.every((g) => estadoDosEnderecos(g) === ENDERECOS.AUSENTE)) {
            const semEnderecos = document.createElement('p');
            semEnderecos.className = 'admin-diag__nota';
            semEnderecos.dataset.testid = 'admin-diag-servidor-sem-enderecos';
            semEnderecos.textContent = enderecosAusentesNotice();
            host.insertBefore(semEnderecos, wrap);
        }
        const lista = document.createElement('ul');
        lista.className = 'admin-diag__lista';
        lista.dataset.testid = 'admin-diag-servidor-lista';
        for (const grupo of linhas) {
            lista.appendChild(this._linhaDeGrupo(grupo));
        }
        wrap.appendChild(lista);
        this._notasDaLeitura(host, payload, {
            mostrados: linhas.length,
            total: payload?.assinaturas,
            unidade: 'assinaturas',
        });
    }

    /**
     * @private O que a leitura de log alcançou, abaixo da seção.
     *
     * TRÊS FRASES, E AS TRÊS DESFAZEM UMA LEITURA ERRADA DO QUE ESTÁ NA TELA: quanto foi varrido
     * (senão "nenhum erro" é afirmação sobre o leitor), se a janela foi truncada (um pico no começo
     * dela some calado) e se a lista foi cortada pelo limite (vinte é indistinguível de vinte que
     * eram quatrocentos).
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
     * @private Uma linha de grupo de erro do servidor.
     * @param {Object} grupo
     * @returns {HTMLElement}
     */
    _linhaDeGrupo(grupo) {
        const li = document.createElement('li');
        li.className = 'admin-diag__item';
        li.dataset.testid = 'admin-diag-servidor-item';

        const cabeca = document.createElement('div');
        cabeca.className = 'admin-diag__item-cabeca';
        cabeca.appendChild(contagemBadge(grupo?.total));

        const texto = document.createElement('div');
        texto.className = 'admin-diag__item-texto';
        const titulo = document.createElement('p');
        titulo.className = 'admin-diag__assinatura';
        titulo.textContent = assinaturaLabel(grupo);
        // O texto INTEIRO no `title`: o corte de `resumirTexto` é de layout, e a assinatura
        // completa é o que se copia para procurar no código.
        if (typeof grupo?.assinatura === 'string' && grupo.assinatura.trim()) {
            titulo.title = grupo.assinatura;
        }
        texto.appendChild(titulo);
        texto.appendChild(metaDeGrupo(grupo));
        const enderecos = blocoDeEnderecos(grupo);
        if (enderecos) texto.appendChild(enderecos);
        cabeca.appendChild(texto);
        li.appendChild(cabeca);

        const pilha = blocoDePilha(grupo?.exemplo?.stack, 'admin-diag-servidor-pilha');
        if (pilha) li.appendChild(pilha);
        return li;
    }

    /**
     * @private Seção 3: os erros relatados pelos navegadores.
     *
     * `@nao-le-log`: A ÚNICA DAS QUATRO QUE NÃO LÊ ARQUIVO DE LOG. Esta lista vem do BANCO
     * (`client_errors`, em `client-errors.service.js`), então `diretorioAusente` e `truncado` não
     * existem no payload dela e `leitorCego`/`_notasDaLeitura` não teriam o que dizer. A ressalva
     * que ELA precisa dar é outra, e já está na tela acima da lista (`clientErrorsScopeNotice`):
     * quem ficou sem rede, fechou a aba ou usa bloqueador não deixa rastro aqui. A marca acima é
     * lida por `frontend/tests/unit/diagnostico-secoes-de-log.test.js`, que sem ela reprova esta
     * seção; seção nova só escapa da varredura declarando o mesmo, com o motivo.
     * @param {HTMLElement} host @param {PromiseSettledResult<*>} resultado @param {string} janela
     */
    _pintarErrosCliente(host, resultado, janela) {
        host.replaceChildren();
        host.appendChild(sectionHeader('Erros do navegador', {
            subtitle: 'O que quebrou na tela de quem estava usando o produto, das mais recentes '
                + 'para as mais antigas',
        }));

        const escopo = document.createElement('p');
        escopo.className = 'admin-diag__nota';
        escopo.dataset.testid = 'admin-diag-cliente-escopo';
        escopo.textContent = clientErrorsScopeNotice();
        host.appendChild(escopo);

        const wrap = card({ testid: 'admin-diag-cliente-card', padded: false });
        host.appendChild(wrap);

        const erro = resultado.status === 'rejected' ? resultado.reason : null;
        const itens = erro ? null : listaDoPayload(resultado.value, 'itens');
        const estado = estadoDaSecao({ erro, itens });

        if (estado === ESTADO.FALHA) {
            this._falha(wrap, clientErrorsFailureNotice(), erro);
            return;
        }
        if (estado === ESTADO.VAZIO) {
            wrap.appendChild(bomVazio(clientErrorsEmptyNotice(janela), clientErrorsEmptyHint()));
            return;
        }

        const linhas = ordenarItensCliente(itens);
        // A NOTA VEM ANTES DA LISTA, e não depois como o corte das outras seções: aqui ela não é
        // uma ressalva sobre a leitura, é a legenda da coluna de números. Lida depois, ela chega
        // quando a pessoa já escolheu no que clicar a partir do número que ela desmente.
        const nota = document.createElement('p');
        nota.className = 'admin-diag__nota';
        nota.dataset.testid = 'admin-diag-cliente-recorte';
        nota.textContent = clientErrorsListaNotice({
            mostrados: linhas.length,
            // `totalAssinaturas` é o total ANTES do corte de 50. Servidor de versão anterior não o
            // manda, e `estadoDoCorte` degrada sem inventar número: ver `clientErrorsListaNotice`.
            total: resultado.value?.totalAssinaturas,
            limite: LIMITE_ERROS_CLIENTE,
            janela,
        });
        host.insertBefore(nota, wrap);

        const lista = document.createElement('ul');
        lista.className = 'admin-diag__lista';
        lista.dataset.testid = 'admin-diag-cliente-lista';
        for (const item of linhas) {
            lista.appendChild(linhaDeErroDeCliente(item));
        }
        wrap.appendChild(lista);
    }

    /**
     * @private Seção 4: a latência por rota, com o p95 em evidência.
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
        // A SEGUNDA SEÇÃO QUE LÊ O MESMO LOG, e portanto a segunda que fica cega do mesmo jeito.
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
 * A contagem em destaque: o primeiro elemento de toda linha das duas listas de erro.
 *
 * O PESO É CLASSE, e não só texto. Mil ocorrências de um defeito e uma de outro não podem ter o
 * mesmo peso visual, e o valor da escada (`pesoDaContagem`) é o que permite à folha de estilo
 * separá-los sem que esta função saiba de cor nenhuma.
 *
 * A UNIDADE É OPCIONAL PORQUE AS DUAS LISTAS CONTAM COISAS DIFERENTES, e o crachá é o único lugar
 * em que isso cabe em duas palavras: o `total` de um grupo do servidor é da janela, e o número do
 * lado do navegador é um acumulado vitalício de relatos. Ver `clientErrorsCountNotice`.
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
 * A linha de metadados de um grupo de erro do servidor: onde aconteceu e quando foi a última vez.
 * @param {Object} grupo
 * @returns {HTMLElement}
 */
function metaDeGrupo(grupo) {
    const p = document.createElement('p');
    p.className = 'admin-diag__meta';

    const alvo = metodoEUrl(grupo?.exemplo);
    if (alvo) p.appendChild(pedaco(alvo, 'admin-diag__meta-alvo'));

    const status = statusLabel(grupo?.exemplo?.statusCode);
    if (status) p.appendChild(pedaco(status, 'admin-diag__meta-status'));

    const quando = horaLocal(grupo?.ultima);
    if (quando) {
        const el = pedaco(quando, 'admin-diag__meta-quando');
        el.title = intervaloDeOcorrencias(grupo?.primeira, grupo?.ultima);
        p.appendChild(el);
    }
    return p;
}

/**
 * De quais endereços veio um grupo de erros do servidor.
 *
 * A PERGUNTA QUE ESTE BLOCO RESPONDE é "este pico de 401 é UM endereço ou trezentos?", e até ele
 * existir ela só se respondia no terminal, com `npm run diag -- linhas`. A resposta é a CONTAGEM, e
 * é por isso que a frase vem primeiro e a lista depois: os endereços mais frequentes ilustram a
 * forma da distribuição, a frase é que a afirma.
 *
 * O ESTADO SAI COMO DADO (`data-estado`), como no ladrilho do pulso e no p95 da tabela: a cor é o
 * que a pessoa lê, e o atributo é o que uma captura de tela consegue afirmar.
 *
 * NADA AQUI MONTA HTML. Com um proxy à frente, `req.ip` sai do `X-Forwarded-For`, que é texto
 * escrito por quem chamou: é dado de fora por definição, e sai por `textContent` como a pilha e a
 * mensagem. O valor inteiro fica no `title`, que é propriedade e não markup.
 *
 * DEVOLVE `null` NO ESTADO AUSENTE, porque quem fala por ele é a nota da SEÇÃO: um bloco por linha
 * repetiria vinte vezes um fato do servidor. Ver `enderecosAusentesNotice`.
 * @param {Object} grupo
 * @returns {HTMLElement|null}
 */
function blocoDeEnderecos(grupo) {
    const estado = estadoDosEnderecos(grupo);
    if (estado === ENDERECOS.AUSENTE) return null;

    const box = document.createElement('div');
    box.className = `admin-diag__enderecos admin-diag__enderecos--${estado}`;
    box.dataset.testid = 'admin-diag-enderecos';
    box.dataset.estado = estado;

    const frase = document.createElement('p');
    frase.className = 'admin-diag__enderecos-frase';
    frase.textContent = enderecosNotice(grupo);
    box.appendChild(frase);

    const principais = principaisDeEnderecos(grupo);
    if (principais.length) {
        const lista = document.createElement('ul');
        lista.className = 'admin-diag__enderecos-lista';
        lista.dataset.testid = 'admin-diag-enderecos-lista';
        for (const entrada of principais) {
            const li = document.createElement('li');
            li.className = 'admin-diag__endereco';
            const ip = document.createElement('span');
            ip.className = 'admin-diag__endereco-ip';
            ip.textContent = enderecoLabel(entrada.ip);
            // O corte de `enderecoLabel` é de LAYOUT: o valor inteiro continua alcançável, porque
            // é ele que se copia para procurar noutro lugar.
            ip.title = entrada.ip;
            const total = document.createElement('span');
            total.className = 'admin-diag__endereco-total';
            total.textContent = contagemLabel(entrada.total);
            total.title = contagemDetalhe(entrada.total);
            li.append(ip, total);
            lista.appendChild(li);
        }
        box.appendChild(lista);
    }
    return box;
}

/**
 * Uma linha de erro de navegador.
 * @param {Object} item
 * @returns {HTMLElement}
 */
function linhaDeErroDeCliente(item) {
    const li = document.createElement('li');
    li.className = 'admin-diag__item';
    li.dataset.testid = 'admin-diag-cliente-item';

    const cabeca = document.createElement('div');
    cabeca.className = 'admin-diag__item-cabeca';
    // O NÚMERO SAI NOMEADO PELO QUE ELE É: acumulado de relatos, com as duas pontas do intervalo no
    // `title`. O crachá sem unidade (o do servidor) fica como está, porque aquele total É da janela.
    cabeca.appendChild(contagemBadge(item?.ocorrencias, {
        unidade: contagemHistoricaUnidade(),
        detalhe: contagemHistoricaDetalhe(item),
    }));

    const texto = document.createElement('div');
    texto.className = 'admin-diag__item-texto';
    const titulo = document.createElement('p');
    titulo.className = 'admin-diag__assinatura';
    titulo.textContent = mensagemLabel(item);
    if (typeof item?.mensagem === 'string' && item.mensagem.trim()) titulo.title = item.mensagem;
    texto.appendChild(titulo);

    const meta = document.createElement('p');
    meta.className = 'admin-diag__meta';
    meta.appendChild(pedaco(usuarioLabel(item), 'admin-diag__meta-usuario'));
    meta.appendChild(pedaco(paginaLabel(item), 'admin-diag__meta-alvo'));
    const quando = horaLocal(item?.ultimaEm);
    if (quando) {
        const el = pedaco(quando, 'admin-diag__meta-quando');
        el.title = intervaloDeOcorrencias(item?.primeiraEm, item?.ultimaEm);
        meta.appendChild(el);
    }
    texto.appendChild(meta);
    cabeca.appendChild(texto);
    li.appendChild(cabeca);

    const pilha = blocoDePilha(item?.stack, 'admin-diag-cliente-pilha', {
        extras: extrasDoCliente(item),
    });
    if (pilha) li.appendChild(pilha);
    return li;
}

/**
 * Os campos técnicos de um erro de navegador que só fazem sentido abertos: a URL inteira, o user
 * agent, a versão do build e o atlas em foco.
 *
 * TODOS SÃO TEXTO DE TERCEIRO (o user agent inclusive: ele é o que o navegador declarar), e todos
 * saem por `textContent` na montagem do bloco.
 * @param {Object} item
 * @returns {Array<{rotulo: string, valor: string}>}
 */
function extrasDoCliente(item) {
    const campos = [
        { rotulo: 'URL', valor: item?.url },
        { rotulo: 'Navegador', valor: item?.userAgent },
        { rotulo: 'Versão', valor: item?.release },
        { rotulo: 'Atlas', valor: item?.atlasId },
        { rotulo: 'Primeira', valor: horaLocalCompleta(item?.primeiraEm) },
        { rotulo: 'Última', valor: horaLocalCompleta(item?.ultimaEm) },
    ];
    return campos
        .map((c) => ({ rotulo: c.rotulo, valor: typeof c.valor === 'string' ? c.valor.trim() : '' }))
        .filter((c) => c.valor);
}

/**
 * O bloco expansível com a pilha.
 *
 * `<details>` FECHADO, e não um painel sempre aberto: uma pilha ocupa a tela inteira e a lista
 * existe para comparar defeitos. A pilha entra num `<pre>` por `textContent`, porque é texto
 * arbitrário vindo do navegador de quem visitou a página pública.
 *
 * Sem pilha e sem extras não nasce bloco nenhum: um `<details>` que abre para o vazio é pior que a
 * ausência dele, porque promete conteúdo.
 * @param {*} stack @param {string} testid
 * @param {{extras?: Array<{rotulo: string, valor: string}>}} [opts]
 * @returns {HTMLElement|null}
 */
function blocoDePilha(stack, testid, { extras = [] } = {}) {
    const texto = typeof stack === 'string' ? stack.trim() : '';
    if (!texto && extras.length === 0) return null;

    const det = document.createElement('details');
    det.className = 'admin-diag__pilha';
    det.dataset.testid = testid;
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
 * a que as outras abas usam, e o que muda é só o sinal. "Nenhum erro nas últimas 24 horas" é o
 * melhor desfecho possível desta tela, e desenhá-lo com a mesma cara cinzenta de "nenhum resultado
 * para o seu filtro" ensina a pessoa a ler saúde como defeito.
 * @param {string} mensagem @param {string} dica
 * @returns {HTMLElement}
 */
function bomVazio(mensagem, dica) {
    const el = emptyState(mensagem, { hint: dica });
    el.classList.add('admin-diag__ok');
    el.dataset.testid = 'admin-diag-ok';
    return el;
}
