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
import { montarPendencias, PendenciaEstado } from './pendencias-rows.js';
import { lerPendencias, nomeDoMapa } from './pendencias-leitura.js';
import {
    ESTADO_FALHA_DETALHE,
    ESTADO_FALHA_TITULO,
    ESTADO_VAZIO_DETALHE,
    ESTADO_VAZIO_TITULO,
    contadoresVisiveis,
    tituloDoPainel,
} from './pendencias-phrases.js';

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

        this._modelo = montarPendencias({ ...leitura, nomeDoMapa });
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
            'Esta tela ainda não afirma nada sobre o que ficou para trás.'
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
            this._lista.replaceChildren(
                this._aviso('pendencias__vazio', ESTADO_VAZIO_TITULO, ESTADO_VAZIO_DETALHE)
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
     * @param {Object} modelo - Saída de `montarPendencias`.
     * @private
     */
    _desenharResumo(modelo) {
        const contadores = contadoresVisiveis(modelo.contadores);
        this._resumo.replaceChildren(...contadores.map(({ classe, label, quantidade }) => {
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
            return item;
        }));
        this._resumo.hidden = contadores.length === 0;
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

        if (linha.unidades.length > 0) {
            item.appendChild(this._desenharUnidades(linha.unidades));
        }

        if (linha.bloqueadaPor) {
            const bloqueio = document.createElement('p');
            bloqueio.className = 'pendencias__bloqueio';
            bloqueio.textContent = `Parada atrás da alteração ${linha.bloqueadaPor}.`;
            item.appendChild(bloqueio);
        }

        const explicacao = document.createElement('p');
        explicacao.className = 'pendencias__explicacao';
        explicacao.textContent = linha.classeExplicacao;
        item.appendChild(explicacao);

        return item;
    }

    /**
     * "Camada «Talhão 3» no mapa «Principal»", com o id no lugar do nome que não resolveu.
     * @param {Object} linha - Modelo de linha.
     * @returns {string}
     * @private
     */
    _descreverItem(linha) {
        const nome = linha.entidade.nome ?? linha.entidade.id;
        const alvo = nome ? `${linha.entidade.tipoLabel} «${nome}»` : linha.entidade.tipoLabel;
        if (!linha.mapa) return alvo;
        return `${alvo}, no mapa «${linha.mapa.nome ?? linha.mapa.id}»`;
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
