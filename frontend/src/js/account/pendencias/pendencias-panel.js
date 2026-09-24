// Path: js/account/pendencias/pendencias-panel.js

/**
 * @fileoverview O painel de pendências: a superfície para onde a luz de sync aponta.
 *
 * POR QUE ELE EXISTE. Desde 2026-09-13 a fila guarda um resultado durável para toda operação que o
 * servidor não aplicou, com classe própria (`issue-classes.js`), a quarentena sobrevive ao logout
 * e a fila de bytes de figura registra o que não subiu. A luz da barra do mapa já contava as
 * cinco coisas e já dizia a palavra "Pendências", e não havia tela nenhuma atrás dela: a pessoa
 * era informada de que tinha trabalho parado e não tinha como ver qual, nem decidir nada sobre
 * ele. Item 6 do bloco B3 e item 5 do B5 do plano de lançamento.
 *
 * O QUE ESTE ARQUIVO FAZ, E O QUE ELE NÃO DECIDE. Ele monta DOM e ouve eventos. Quem decide o que
 * cada linha diz é `pendencias-rows.js` (puro), quem lê o disco é `pendencias-leitura.js`, e as
 * frases moram em `pendencias-phrases.js`. A divisão não é estética: a decisão de linha é a parte
 * que se verifica em node, e a camada que exercita DOM roda fora do `npm test`.
 *
 * O CONTRATO COM O CRACHÁ, desde 2026-09-15. O crachá conta o TRABALHO (inclusive o que está
 * saindo agora) e o painel lista o que EXIGE DECISÃO, que é um subconjunto: são recortes
 * diferentes da mesma fila, e por isso as duas telas podem mostrar números diferentes sem estarem
 * em desacordo. O que elas não podem é se CONTRADIZER, e era o que faziam: com a fila cheia e
 * nenhum problema, o crachá dizia "Enviando 2…" e o painel que ele abre dizia "Nenhuma pendência".
 * Agora o painel lê também o censo da fila e DIZ o que está a caminho, com o mesmo número e pela
 * mesma expressão (`pendentes + preparadas`), sem transformá-lo em linha: não há ação a oferecer
 * sobre uma alteração que sai sozinha, e uma linha sem ação numa tela de decisões é ruído.
 *
 * NUNCA `innerHTML`. Toda linha carrega nome de mapa, nome de feição e a frase de recusa do
 * SERVIDOR, e as três são conteúdo de usuário chegando por caminhos diferentes. O painel usa
 * `textContent` e `createElement` em todos os pontos, sem exceção, e um teste estrutural
 * (`frontend/tests/unit/pendencias-linhas.test.js`) reprova a volta de `innerHTML` neste arquivo.
 *
 * A ATUALIZAÇÃO AO VIVO TEM DUAS METADES, e a segunda é a que não se adivinha. Os eventos do
 * barramento cobrem o que chega do SERVIDOR (`REMOTE_OPERATION_APPLIED`) e a virada de conexão e
 * de sessão; o que eles NÃO cobrem é a edição LOCAL, que enfileira sem emitir evento nenhum (a
 * mesma razão pela qual a luz de sync tem uma batida periódica). Por isso há um intervalo enquanto
 * o painel está aberto, e ele para quando ele fecha: um painel que só se atualiza por evento fica
 * parado justamente enquanto a pessoa continua trabalhando com ele aberto.
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { setupCleanup, subscribe, addDomListener } from '@utils/event-cleanup.js';
import { ModalBase } from '@modals/modal.base.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showError, showSuccess, showToast, showWarning } from '@utils/toast_service.js';
import { connectionState, ConnectionStates } from '@store/sync/connection-state.js';
import { montarPendencias, PendenciaEstado } from './pendencias-rows.js';
import { lerMapasTravados, lerPendencias } from './pendencias-leitura.js';
import {
    aceitarOServidor,
    acoesDaLinha,
    conteudoDeExportacao,
    descartarTentativa,
    idsQueSaemJunto,
    linhasParaExportar,
    reaplicarComNovaBase,
} from './pendencias-acoes.js';
import {
    ACEITE_FALHOU,
    ESTADO_FALHA_DETALHE,
    ESTADO_FALHA_TITULO,
    EXPORTACAO_COPIADA,
    EXPORTACAO_FALHOU,
    PendenciaAcao,
    REAPLICACAO_FALHOU,
    acaoLabel,
    confirmacaoDeAceitar,
    confirmacaoDeDescartar,
    contadoresVisiveis,
    descricaoDoItem,
    estadoVazio,
    juntoResumo,
    levouJuntoFrase,
    mesmaAcaoFrase,
    mesmaAcaoResumo,
    reaplicacaoFeita,
    tituloDoPainel,
    transitoNota,
} from './pendencias-phrases.js';
import {
    COMPARACAO_ROTULO,
    COMPARACAO_SEM_SERVIDOR,
    comparacaoFrases,
} from './comparacao-phrases.js';

/**
 * Os eventos que PODEM significar pendência diferente.
 *
 * A lista é curta e a batida periódica cobre o resto, exatamente como em
 * `sync-status.control.js`. Ela não é importada de lá porque aquele arquivo é de outro assunto e
 * exporta uma classe, não a lista; a divergência custa, no pior caso, um atraso de um intervalo,
 * nunca uma resposta errada.
 */
const SINAIS = [
    EventTypes.REMOTE_OPERATION_APPLIED,
    EventTypes.CONNECTION_STATE_CHANGED,
    EventTypes.SESSION_CHANGED,
];

/**
 * ONDE OS AVISOS DESTE PAINEL APARECEM, e por que não é o padrão da casa.
 *
 * O aviso da casa nasce no TOPO do viewport (`toast_service.js`, `top-center`, com 80 px de base e
 * 60 px por aviso empilhado) e é `position: fixed` acima de todo modal. Este painel é alto e fica
 * centrado, então o topo dele encosta na faixa de avisos: um aviso ali cobre a própria fileira de
 * contadores do painel, e dois avisos cobrem o cabeçalho junto. Foi o que a captura de B5d
 * fotografou. Como TODO aviso deste painel fala sobre a lista que está na tela, cobri-la é o pior
 * lugar possível, e o rodapé é o único que nunca disputa com ela.
 *
 * O AVISO DE OUTRO MÓDULO PASSOU A DESCER TAMBÉM, e não foi este arquivo que o fez. Os dois balões
 * laranja daquela imagem vinham do laço de envio (`sync-flush.js`, 8 s), que não sabe que existe
 * painel nenhum: enquanto a decisão morasse aqui, ela consertava as nove chamadas DESTE painel e
 * nenhuma das que de fato o cobriam. Desde 2026-09-13 quem decide é o serviço de aviso
 * (`resolveToastPosition`, `toast_service.js`), que nasce no rodapé enquanto houver modal aberto,
 * lendo o overlay do próprio modal.
 *
 * ESTA CONSTANTE SOBREVIVE A ISSO, e é redundante de propósito. O painel é um modal, então o
 * serviço já o levaria ao rodapé; o que o pedido explícito acrescenta é que a escolha não depende
 * de o painel continuar sendo montado sobre `.modal-overlay`, e um teste estrutural
 * (`frontend/tests/unit/pendencias-linhas.test.js`) cobra que toda chamada daqui o carregue.
 */
const AVISO_DO_PAINEL = Object.freeze({ position: 'bottom-center' });

/** Janela de coalescência: N sinais dentro dela viram UMA leitura. */
const COALESCE_MS = 250;

/** Batida enquanto o painel está aberto, para alcançar a edição local, que não emite evento. */
const HEARTBEAT_MS = 3000;

/**
 * O painel. Uma instância por abertura (`destroyOnHide`), porque ele assina o barramento e mantém
 * um intervalo: reaproveitar a instância é como uma assinatura sobrevive a um fechamento.
 */
export class PendenciasPanel extends ModalBase {
    constructor() {
        super({
            id: 'pendencias-panel',
            title: tituloDoPainel(0),
            destroyOnHide: true,
        });

        /** @type {HTMLElement|null} */
        this._resumo = null;
        /** @type {HTMLElement|null} */
        this._lista = null;
        /** @type {ReturnType<typeof setTimeout>|null} */
        this._coalesceTimer = null;
        /** @type {ReturnType<typeof setInterval>|null} */
        this._heartbeat = null;
        /** @type {boolean} */
        this._lendo = false;
        /** @type {boolean} */
        this._lerDeNovo = false;
        /** @type {Object|null} O último modelo desenhado, para as ações. */
        this._modelo = null;
        /** @type {Set<string>} Ids de mapa travados na última leitura. */
        this._travados = new Set();
        /** @type {boolean} Se uma ação está em curso, para não deixar duas rodarem juntas. */
        this._agindo = false;
        /** @type {(function(): void)|null} Chamado ao fechar, para soltar a instância única. */
        this._aoFechar = null;

        setupCleanup(this);
    }

    /**
     * Monta a estrutura, assina os sinais e faz a primeira leitura.
     * @returns {HTMLElement} O overlay, já no documento.
     */
    montar() {
        const overlay = this.render();
        const body = this.getBody();

        const raiz = document.createElement('div');
        raiz.className = 'pendencias';
        raiz.setAttribute('data-testid', 'pendencias-painel');

        this._resumo = document.createElement('div');
        this._resumo.className = 'pendencias__resumo';
        raiz.appendChild(this._resumo);

        this._lista = document.createElement('div');
        this._lista.className = 'pendencias__lista';
        this._lista.setAttribute('data-testid', 'pendencias-lista');
        raiz.appendChild(this._lista);

        body.appendChild(raiz);
        document.body.appendChild(overlay);

        const eventBus = getEventBus();
        for (const tipo of SINAIS) {
            subscribe(this, eventBus, tipo, () => this._agendarLeitura());
        }

        this._heartbeat = setInterval(() => this._agendarLeitura(), HEARTBEAT_MS);

        this._desenharCarregando();
        this._ler();
        return overlay;
    }

    /**
     * Coalesce toda razão de reler numa leitura por janela.
     *
     * O timer NÃO vai para `trackTimer`: aquela lista só cresce, e um timer que se rearma a cada
     * gesto empilharia ids mortos. Um id vivo por vez, limpo à mão em {@link hide}.
     * @private
     */
    _agendarLeitura() {
        if (!this._lista) return;
        if (this._coalesceTimer !== null) return;
        this._coalesceTimer = setTimeout(() => {
            this._coalesceTimer = null;
            this._ler();
        }, COALESCE_MS);
    }

    /**
     * Lê as três fontes e repinta.
     * @private
     */
    async _ler() {
        if (!this._lista) return;
        if (this._lendo) {
            this._lerDeNovo = true;
            return;
        }
        this._lendo = true;
        let leitura;
        try {
            leitura = await lerPendencias();
        } finally {
            this._lendo = false;
        }
        // O painel pode ter sido fechado enquanto a leitura estava no ar.
        if (!this._lista) return;

        // O RESOLVEDOR DE NOME VEM DENTRO DA LEITURA, porque é ela que tem disco: o painel não
        // escolhe mais entre memória e disco, e as duas perguntas sobre mapa (o nome da linha e a
        // trava do comando) passam a ser respondidas pela MESMA tabela.
        this._modelo = montarPendencias(leitura);
        // A TRAVA É LIDA DEPOIS DAS LINHAS, e só dos mapas que elas citam: ela decide apenas se um
        // comando recusa o clique, então lê-la antes custaria uma varredura de mapas que talvez
        // não apareçam em pendência nenhuma.
        this._travados = await lerMapasTravados(
            this._modelo.linhas.map((linha) => linha.mapa?.id).filter(Boolean),
            leitura.nomeDoMapa
        );
        if (!this._lista) return;
        this._desenhar(this._modelo);

        if (this._lerDeNovo) {
            this._lerDeNovo = false;
            this._agendarLeitura();
        }
    }

    /**
     * O estado inicial, entre abrir e a primeira resposta do IndexedDB.
     *
     * Ele não é a lista vazia, pela mesma razão que o `undefined` da luz de sync não é zero: entre
     * os dois estados existe uma afirmação, e nesse instante ela ainda não pode ser feita.
     * @private
     */
    _desenharCarregando() {
        this._lista.replaceChildren(this._aviso(
            'pendencias__carregando',
            'Lendo as pendências…',
            'Verificando o que ficou por enviar neste computador.'
        ));
    }

    /**
     * @param {Object} modelo - Saída de `montarPendencias`.
     * @private
     */
    _desenhar(modelo) {
        this._titulo(tituloDoPainel(modelo.total));
        this._desenharResumo(modelo);

        if (modelo.estado === PendenciaEstado.FALHA) {
            const aviso = this._aviso('pendencias__falha', ESTADO_FALHA_TITULO, ESTADO_FALHA_DETALHE);
            aviso.appendChild(this._botaoDeRecarregar());
            this._lista.replaceChildren(aviso);
            return;
        }
        if (modelo.estado === PendenciaEstado.VAZIO) {
            // A LISTA VAZIA NÃO É UMA FRASE SÓ. "Nenhuma pendência" contradizia o crachá que abriu
            // esta tela sempre que havia trabalho na fila, e duas telas do mesmo produto dizendo o
            // contrário uma da outra sobre a MESMA fila se leem como uma delas quebrada.
            const vazio = estadoVazio(modelo.aCaminho);
            this._lista.replaceChildren(
                this._aviso('pendencias__vazio', vazio.titulo, vazio.detalhe)
            );
            return;
        }
        this._lista.replaceChildren(...modelo.linhas.map((linha) => this._desenharLinha(linha)));
    }

    /**
     * @param {string} texto - O novo título do painel.
     * @private
     */
    _titulo(texto) {
        const titulo = this.getContainer()?.querySelector('.modal-title');
        if (titulo) titulo.textContent = texto;
    }

    /**
     * O topo do painel: a fileira de contadores e, ABAIXO dela, o comando que vale para a lista
     * inteira.
     *
     * SÃO DUAS LINHAS E NÃO UMA, e a captura de B5d é o motivo. Contador e comando dividiam a mesma
     * fileira, então o que a pessoa lê como "os filtros desta tela" tinha um botão no meio e
     * encolhia a cada contador novo; com seis classes possíveis, a fileira única passa a competir
     * com o comando pela mesma largura. Separá-las custa uma linha de altura e devolve a leitura de
     * varredura, que é como uma lista de pendências se lê.
     * @param {Object} modelo - Saída de `montarPendencias`.
     * @private
     */
    _desenharResumo(modelo) {
        const contadores = contadoresVisiveis(modelo.contadores);
        // A NOTA DO QUE ESTÁ A CAMINHO SÓ APARECE AQUI QUANDO HÁ LISTA: com a lista vazia ela É o
        // estado vazio, e dizer o mesmo número duas vezes na mesma tela sugere duas quantidades.
        const nota = transitoNota(modelo.aCaminho);
        this._resumo.replaceChildren();
        this._resumo.hidden = contadores.length === 0;
        if (contadores.length === 0) return;

        const fileira = document.createElement('div');
        fileira.className = 'pendencias__contadores';
        fileira.setAttribute('data-testid', 'pendencias-contadores');
        for (const { classe, label, quantidade } of contadores) {
            const item = document.createElement('span');
            item.className = 'pendencias__contador';
            item.setAttribute('data-classe', classe);

            const valor = document.createElement('strong');
            valor.className = 'pendencias__contador-valor';
            valor.textContent = String(quantidade);
            item.appendChild(valor);

            const nome = document.createElement('span');
            nome.textContent = label;
            item.appendChild(nome);
            fileira.appendChild(item);
        }
        this._resumo.appendChild(fileira);

        // QUANTAS VOLTARAM POR CAUSA DE UMA SÓ, que os contadores sozinhos não dizem: eles contam
        // as classes, não quem derrubou quem.
        const junto = juntoResumo(modelo.juntos);
        if (junto) {
            const grupo = document.createElement('p');
            grupo.className = 'pendencias__transito';
            grupo.setAttribute('data-testid', 'pendencias-junto');
            grupo.textContent = junto;
            this._resumo.appendChild(grupo);
        }
        for (const frase of mesmaAcaoResumo(modelo.mesmaAcao)) {
            const grupo = document.createElement('p');
            grupo.className = 'pendencias__transito';
            grupo.setAttribute('data-testid', 'pendencias-mesma-acao');
            grupo.textContent = frase;
            this._resumo.appendChild(grupo);
        }

        if (nota) {
            const transito = document.createElement('p');
            transito.className = 'pendencias__transito';
            transito.setAttribute('data-testid', 'pendencias-transito');
            transito.textContent = nota;
            this._resumo.appendChild(transito);
        }

        // EXPORTAR TUDO fica no topo e não na linha: é a saída de quem vai limpar a lista inteira,
        // e pedir uma cópia linha a linha antes de descartar meia dúzia é como uma pessoa desiste
        // de guardar o próprio trabalho.
        const acoes = document.createElement('div');
        acoes.className = 'pendencias__resumo-acoes';
        const tudo = document.createElement('button');
        tudo.type = 'button';
        tudo.className = 'pendencias__acao';
        tudo.setAttribute('data-acao', 'exportar-tudo');
        tudo.textContent = `${acaoLabel(PendenciaAcao.EXPORTAR)} tudo`;
        addDomListener(this, tudo, 'click', () => this._exportar(modelo.linhas));
        acoes.appendChild(tudo);
        this._resumo.appendChild(acoes);
    }

    /**
     * @param {string} classe - Classe BEM do bloco de aviso.
     * @param {string} titulo - Título curto.
     * @param {string} detalhe - A frase inteira.
     * @returns {HTMLElement}
     * @private
     */
    _aviso(classe, titulo, detalhe) {
        const bloco = document.createElement('div');
        bloco.className = `pendencias__aviso ${classe}`;

        const cabecalho = document.createElement('p');
        cabecalho.className = 'pendencias__aviso-titulo';
        cabecalho.textContent = titulo;
        bloco.appendChild(cabecalho);

        const texto = document.createElement('p');
        texto.className = 'pendencias__aviso-detalhe';
        texto.textContent = detalhe;
        bloco.appendChild(texto);
        return bloco;
    }

    /**
     * @returns {HTMLButtonElement}
     * @private
     */
    _botaoDeRecarregar() {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'pendencias__acao';
        botao.setAttribute('data-acao', 'recarregar');
        botao.textContent = 'Tentar de novo';
        addDomListener(this, botao, 'click', () => this._ler());
        return botao;
    }

    /**
     * Uma linha da lista.
     * @param {Object} linha - Modelo de linha.
     * @returns {HTMLElement}
     * @private
     */
    _desenharLinha(linha) {
        const item = document.createElement('article');
        item.className = 'pendencias__linha';
        item.setAttribute('data-classe', linha.classe);
        item.setAttribute('data-testid', 'pendencias-linha');

        const cabecalho = document.createElement('div');
        cabecalho.className = 'pendencias__linha-cabecalho';

        const classe = document.createElement('span');
        classe.className = 'pendencias__classe';
        classe.setAttribute('data-classe', linha.classe);
        classe.textContent = linha.classeLabel;
        cabecalho.appendChild(classe);

        if (linha.origemLabel) {
            const origem = document.createElement('span');
            origem.className = 'pendencias__origem';
            origem.textContent = linha.origemLabel;
            cabecalho.appendChild(origem);
        }

        if (linha.quandoLabel) {
            const data = document.createElement('time');
            data.className = 'pendencias__data';
            data.textContent = linha.quandoLabel;
            cabecalho.appendChild(data);
        }
        item.appendChild(cabecalho);

        const titulo = document.createElement('p');
        titulo.className = 'pendencias__titulo';
        titulo.textContent = this._descreverItem(linha);
        item.appendChild(titulo);

        if (linha.motivo) {
            const motivo = document.createElement('p');
            motivo.className = 'pendencias__motivo';
            motivo.textContent = linha.motivo;
            item.appendChild(motivo);
        }

        const levou = levouJuntoFrase(linha.levouJunto) ?? mesmaAcaoFrase(linha.mesmaAcao?.total);
        if (levou) {
            const junto = document.createElement('p');
            junto.className = 'pendencias__motivo';
            junto.setAttribute('data-testid', 'pendencias-levou-junto');
            junto.textContent = levou;
            item.appendChild(junto);
        }

        if (linha.unidades.length > 0) {
            item.appendChild(this._desenharUnidades(linha.unidades));
        }

        const comparacao = this._desenharComparacao(linha);
        if (comparacao) item.appendChild(comparacao);

        if (linha.bloqueio) {
            const bloqueio = document.createElement('p');
            bloqueio.className = 'pendencias__bloqueio';
            bloqueio.textContent = linha.bloqueio;
            item.appendChild(bloqueio);
        }

        const explicacao = document.createElement('p');
        explicacao.className = 'pendencias__explicacao';
        explicacao.textContent = linha.classeExplicacao;
        item.appendChild(explicacao);

        item.appendChild(this._desenharAcoes(linha));
        return item;
    }

    /**
     * Os comandos de uma linha.
     *
     * O COMANDO BLOQUEADO POR ESTADO LEVA `aria-disabled` E NUNCA A PROPRIEDADE `disabled`: um
     * botão desabilitado não dispara clique, e o clique É como o motivo chega à pessoa. Quem não
     * pode por POSTO não chega aqui, porque `acoesDaLinha` nem devolve o comando.
     * @param {Object} linha - Modelo de linha.
     * @returns {HTMLElement}
     * @private
     */
    _desenharAcoes(linha) {
        const barra = document.createElement('div');
        barra.className = 'pendencias__acoes';

        const contexto = {
            online: connectionState.getState() === ConnectionStates.ONLINE,
            mapaTravado: (mapId) => this._travados.has(mapId),
        };

        for (const { acao, label, detalhe, bloqueio, recusa } of acoesDaLinha(linha, contexto)) {
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'pendencias__acao';
            botao.setAttribute('data-acao', acao);
            botao.setAttribute('title', bloqueio ? recusa : detalhe);
            botao.textContent = label;
            if (bloqueio) botao.setAttribute('aria-disabled', 'true');
            addDomListener(this, botao, 'click', () => {
                if (bloqueio) {
                    showWarning(recusa, AVISO_DO_PAINEL);
                    return;
                }
                this._executar(acao, linha);
            });
            barra.appendChild(botao);
        }
        return barra;
    }

    /**
     * Executa um comando de linha, com a confirmação que ele exigir.
     *
     * UMA AÇÃO POR VEZ: as três que escrevem mexem na mesma fila, e duas em paralelo produziriam
     * uma segunda decisão tomada sobre uma lista que a primeira já mudou.
     * @param {string} acao - Valor de `PendenciaAcao`.
     * @param {Object} linha - Modelo de linha.
     * @private
     */
    async _executar(acao, linha) {
        if (this._agindo) return;
        this._agindo = true;
        try {
            if (acao === PendenciaAcao.EXPORTAR) await this._exportar(linhasParaExportar(linha, this._modelo?.linhas ?? []));
            else if (acao === PendenciaAcao.ACEITAR) await this._aceitar(linha);
            else if (acao === PendenciaAcao.DESCARTAR) await this._descartar(linha);
            else if (acao === PendenciaAcao.REAPLICAR) await this._reaplicar(linha);
        } finally {
            this._agindo = false;
        }
    }

    /**
     * @param {Object} linha - Modelo de linha.
     * @private
     */
    async _aceitar(linha) {
        const quantas = idsQueSaemJunto(linha, this._modelo?.linhas ?? []).length;
        const doGrupo = Boolean(linha.recusadaJuntoCom) || linha.levouJunto > 0;
        const pergunta = confirmacaoDeAceitar(quantas, { doGrupo, mesmoMotivo: Boolean(linha.mesmaAcao) });
        const confirmado = await showConfirm(pergunta.titulo, {
            message: pergunta.mensagem,
            confirmText: pergunta.confirmar,
            cancelText: 'Manter',
            destructive: true,
        });
        if (!confirmado) return;

        try {
            const { removidas } = await aceitarOServidor(linha, this._modelo?.linhas ?? []);
            if (removidas === 0) {
                showError(ACEITE_FALHOU, AVISO_DO_PAINEL);
                return;
            }
            showSuccess(removidas === 1
                ? 'Uma alteração descartada. Buscando o estado atual no servidor.'
                : `${removidas} alterações descartadas. Buscando o estado atual no servidor.`,
            AVISO_DO_PAINEL);
        } catch (error) {
            console.warn('[pendencias] aceitar o servidor falhou:', error);
            showError(ACEITE_FALHOU, AVISO_DO_PAINEL);
        }
        await this._ler();
    }

    /**
     * @param {Object} linha - Modelo de linha.
     * @private
     */
    async _descartar(linha) {
        const quantas = Math.max(1, idsQueSaemJunto(linha, this._modelo?.linhas ?? []).length);
        const pergunta = confirmacaoDeDescartar(quantas);
        const confirmado = await showConfirm(pergunta.titulo, {
            message: pergunta.mensagem,
            confirmText: pergunta.confirmar,
            cancelText: 'Manter',
            destructive: true,
        });
        if (!confirmado) return;

        try {
            const { removidas } = await descartarTentativa(linha, this._modelo?.linhas ?? []);
            if (removidas === 0) showError(ACEITE_FALHOU, AVISO_DO_PAINEL);
            else showToast('Alteração esquecida neste computador.', 'info', AVISO_DO_PAINEL);
        } catch (error) {
            console.warn('[pendencias] descartar falhou:', error);
            showError(ACEITE_FALHOU, AVISO_DO_PAINEL);
        }
        await this._ler();
    }

    /**
     * @param {Object} linha - Modelo de linha.
     * @private
     */
    async _reaplicar(linha) {
        const online = connectionState.getState() === ConnectionStates.ONLINE;
        try {
            await reaplicarComNovaBase(linha, { online });
            showSuccess(reaplicacaoFeita(online), AVISO_DO_PAINEL);
        } catch (error) {
            console.warn('[pendencias] reaplicar falhou:', error);
            showError(REAPLICACAO_FALHOU, AVISO_DO_PAINEL);
        }
        await this._ler();
    }

    /**
     * Copia o JSON das tentativas escolhidas para a área de transferência.
     *
     * ÁREA DE TRANSFERÊNCIA E NÃO DOWNLOAD porque a casa não tem porta de download compartilhada:
     * cada saída (KMZ, PDF, QAN, `.ebgeo`) monta a sua com `URL.createObjectURL`, e inventar aqui
     * a quinta cópia daquele trecho para um JSON de diagnóstico é custo sem dono. Se um dia
     * existir a porta única, este é o ponto que a chama.
     * @param {Array<Object>} linhas - Linhas a exportar.
     * @private
     */
    async _exportar(linhas) {
        const texto = JSON.stringify(conteudoDeExportacao(linhas), null, 2);
        try {
            const area = globalThis.navigator?.clipboard;
            if (!area?.writeText) throw new Error('sem área de transferência');
            await area.writeText(texto);
            showSuccess(EXPORTACAO_COPIADA, AVISO_DO_PAINEL);
        } catch (error) {
            console.warn('[pendencias] a exportação não pôde ser copiada:', error);
            showError(EXPORTACAO_FALHOU, AVISO_DO_PAINEL);
        }
    }

    /**
     * "Camada «Talhão 3», no mapa «Principal»", com o id no lugar do nome que não resolveu.
     *
     * A METADE DO MAPA É `localDoItem`, folha pura, porque ela tem três desfechos e não dois: o
     * nome, a declaração de que aquele mapa não está mais no atlas, e o id de quando não se pôde
     * afirmar nem uma coisa nem outra.
     * @param {Object} linha - Modelo de linha.
     * @returns {string}
     * @private
     */
    _descreverItem(linha) {
        return descricaoDoItem(linha.entidade, linha.mapa);
    }

    /**
     * @param {Array<{unidade: string, label: string}>} unidades - Unidades em disputa.
     * @returns {HTMLElement}
     * @private
     */
    _desenharUnidades(unidades) {
        const bloco = document.createElement('p');
        bloco.className = 'pendencias__campos';

        const rotulo = document.createElement('span');
        rotulo.className = 'pendencias__campos-rotulo';
        rotulo.textContent = 'Em disputa:';
        bloco.appendChild(rotulo);

        for (const { unidade, label } of unidades) {
            const chip = document.createElement('span');
            chip.className = 'pendencias__campo';
            chip.setAttribute('data-unidade', unidade);
            chip.textContent = label;
            bloco.appendChild(chip);
        }
        return bloco;
    }

    /**
     * A comparação entre a cópia local e a do servidor: TEXTO, nunca desenho.
     *
     * O bloco tem duas formas e uma ausência. Com as duas metades do par, ele lista as frases que
     * têm o que dizer (a geometria, as propriedades); sem a metade do servidor, ele DIZ isso, em
     * vez de sumir, porque um bloco que some é indistinguível de "não há diferença". Quando não é
     * conflito de feição, não há bloco nenhum e nada é anunciado.
     * @param {Object} linha - Modelo de linha.
     * @returns {HTMLElement|null}
     * @private
     */
    _desenharComparacao(linha) {
        const frases = comparacaoFrases(linha.comparacao);
        if (frases.length === 0 && !linha.comparacaoIndisponivel) return null;

        const bloco = document.createElement('div');
        bloco.className = 'pendencias__comparacao';
        bloco.setAttribute('data-testid', 'pendencias-comparacao');

        const rotulo = document.createElement('span');
        rotulo.className = 'pendencias__comparacao-rotulo';
        rotulo.textContent = COMPARACAO_ROTULO;
        bloco.appendChild(rotulo);

        if (frases.length === 0) {
            const ausente = document.createElement('p');
            ausente.className = 'pendencias__comparacao-linha pendencias__comparacao-linha--ausente';
            ausente.textContent = COMPARACAO_SEM_SERVIDOR;
            bloco.appendChild(ausente);
            return bloco;
        }

        for (const frase of frases) {
            const linhaDeTexto = document.createElement('p');
            linhaDeTexto.className = 'pendencias__comparacao-linha';
            linhaDeTexto.textContent = frase;
            bloco.appendChild(linhaDeTexto);
        }
        return bloco;
    }

    /** @override */
    hide() {
        if (this._coalesceTimer !== null) {
            clearTimeout(this._coalesceTimer);
            this._coalesceTimer = null;
        }
        if (this._heartbeat !== null) {
            clearInterval(this._heartbeat);
            this._heartbeat = null;
        }
        this._lista = null;
        this._resumo = null;
        super.hide();
        const aoFechar = this._aoFechar;
        this._aoFechar = null;
        if (aoFechar) aoFechar();
    }
}

/** @type {PendenciasPanel|null} A instância aberta, se houver. */
let aberto = null;

/**
 * Abre o painel, ou traz o que já está aberto.
 *
 * UMA INSTÂNCIA POR VEZ, e o guarda é necessário porque a luz de sync é clicável e um duplo clique
 * empilharia dois overlays, o segundo por cima do primeiro, com o de baixo assinando o barramento
 * para sempre.
 * @returns {PendenciasPanel} O painel aberto.
 */
export function abrirPainelDePendencias() {
    if (aberto?.isOpen()) return aberto;
    const painel = new PendenciasPanel();
    painel.montar();
    painel._aoFechar = () => {
        if (aberto === painel) aberto = null;
    };
    painel.show();
    aberto = painel;
    return painel;
}

/**
 * Fecha o painel aberto, se houver. Para o teardown da página e para teste.
 * @returns {void}
 */
export function fecharPainelDePendencias() {
    aberto?.hide();
    aberto = null;
}
