// Path: js/utilities/meteorologia/meteorologia.panel.js

/**
 * @fileoverview THE WEATHER PANEL: the forecast rows of the PITCIC weather matrix for one point of
 * the map, opened from the map's context menu ("Meteorologia neste ponto").
 *
 * It only READS: no feature, no layer, no calco (item 4.3.3.2.3 of the manual forbids a calco of
 * its own for weather, because an element changes in a short time), no sync op, no role gate. The
 * card, the phone sheet, the pin, the day controls and the download are the SHELL's, shared with
 * the light panel; the owner made the two separate screens on 2026-09-23.
 *
 * THE RACE THIS FILE GUARDS: a forecast is a network round trip, and the person can change the day
 * or the point while it travels. Every request carries a number (`_pedido`), and an answer that
 * arrives after a newer request, or after the panel closed, is dropped. Without it a slow answer
 * for yesterday's point would overwrite today's table.
 */

import { showError, showSuccess } from '@utils/toast_service.js';
import { rotuloDoDia, somarDias } from '@utils/hora-brasilia.js';
import { PainelDePonto, el, tabelaDoPainel } from '@utils/painel-de-ponto/painel-de-ponto.js';
import { FalhaDaFonte } from './fonte-meteorologica.js';
import {
    carimboDaFonte,
    montarQuadro,
    nomeDoArquivoCsv,
    resumoDaEspiada,
    tabelaCsv,
} from './quadro-meteorologico.js';
import {
    ACAO_FORA_DO_ALCANCE,
    ATRIBUICAO,
    AVISO_AINDA_CHEGANDO,
    AVISO_FALHA_AO_SALVAR,
    AVISO_SALVO,
    AVISO_SEM_PREVISAO_PARA_SALVAR,
    DICA_SALVAR,
    ESTADO_CONSULTANDO,
    ESTADO_FORA_DO_ALCANCE,
    ESTADO_INDISPONIVEL,
    LEGENDA_DO_QUADRO,
    RESSALVA_DO_MODELO,
    ROTULO_DA_ALCA,
    ROTULO_TENTAR_DE_NOVO,
    TITULO_DO_AUXILIAR,
    TITULO_DO_PAINEL,
    acaoIndisponivel,
} from './meteorologia-phrases.js';

/** Columns of the quadro: D, D+1 and D+2, as Quadro 4-5. */
const DIAS_NO_QUADRO = 3;

/**
 * The weather panel. One per map.
 */
export class PainelMeteorologia {
    /**
     * @param {Object} opcoes
     * @param {Object} opcoes.map - the MapLibre map
     * @param {(ponto: {lat: number, lng: number}, datas: string[]) => Promise<Object>} opcoes.consultar -
     *   the source's `consultar`
     * @param {() => number} [opcoes.agora] - test seam
     */
    constructor({ map, consultar, agora = () => Date.now() }) {
        this._consultar = consultar;
        this._pedido = 0;
        this._quadro = null;
        this._previsao = null;
        /** @type {boolean} a request is travelling; decides which "nothing to save" sentence is true */
        this._consultando = false;
        this._casca = new PainelDePonto({
            map,
            id: 'meteorologia',
            titulo: TITULO_DO_PAINEL,
            rotuloDaAlca: ROTULO_DA_ALCA,
            ressalva: RESSALVA_DO_MODELO,
            dicaSalvar: DICA_SALVAR,
            aoAtualizar: (contexto) => this._atualizar(contexto),
            aoSalvar: () => this._salvar(),
            agora,
        });
    }

    /** @returns {boolean} */
    estaAberto() {
        return this._casca.estaAberto();
    }

    /**
     * Opens the panel on a point, or moves an open panel to a new point.
     * @param {{ponto: {lat: number, lng: number}, formato?: string}} entrada
     */
    abrir(entrada) {
        this._casca.abrir(entrada);
    }

    /** Closes the panel and removes the pin; an answer still travelling is dropped. */
    fechar() {
        this._pedido++;
        this._casca.fechar();
    }

    /** Same as {@link fechar}; the name every destroyable of the map uses. */
    destroy() {
        this.fechar();
    }

    /**
     * @param {{dataD: string, ponto: {lat: number, lng: number}}} contexto
     * @private
     */
    async _atualizar({ dataD, ponto }) {
        const pedido = ++this._pedido;
        const datas = Array.from({ length: DIAS_NO_QUADRO }, (_, i) => somarDias(dataD, i));
        this._previsao = null;
        this._consultando = true;
        this._quadro = montarQuadro({ dataD, datas, previsao: null });
        this._mostrar({ dataD, estado: this._estado(ESTADO_CONSULTANDO, null, { carregando: true }) });

        let previsao;
        try {
            previsao = await this._consultar(ponto, datas);
        } catch (erro) {
            if (pedido !== this._pedido) return;
            this._consultando = false;
            // The message never carries the URL (it has the coordinate): see `FalhaDaFonte`.
            if (erro instanceof FalhaDaFonte) {
                console.warn(`[meteorologia] a previsão não chegou: ${erro.message}`);
            } else {
                // Not a source failure: a bug of this module, whose message carries no coordinate.
                console.error('[meteorologia] falha ao ler a previsão:', erro);
            }
            // No table under the failure: a table of "…" would say "still coming" next to a notice
            // that says it is not coming.
            this._mostrar({ dataD, estado: this._estadoDeFalha(erro instanceof FalhaDaFonte ? erro.status : null), semTabela: true });
            return;
        }
        if (pedido !== this._pedido || !this._casca.estaAberto()) return;

        this._consultando = false;
        this._previsao = previsao;
        this._quadro = montarQuadro({ dataD, datas, previsao });
        const estado = previsao.noAlcance.length === 0
            ? this._estado(ESTADO_FORA_DO_ALCANCE, ACAO_FORA_DO_ALCANCE)
            : null;
        this._mostrar({ dataD, estado });
    }

    /**
     * @param {{dataD: string, estado: HTMLElement|null, semTabela?: boolean}} partes
     * @private
     */
    _mostrar({ dataD, estado, semTabela = false }) {
        const quadro = this._quadro;
        const resumo = resumoDaEspiada(quadro);
        const espiada = [el('span', 'painel-ponto__espiada-dia', `${rotuloDoDia(dataD)} (D)`)];
        if (resumo) espiada.push(el('span', null, resumo.tempo), el('span', null, resumo.vento));
        else if (estado) espiada.push(el('span', null, estado.querySelector('.painel-ponto__estado-titulo').textContent));

        const conteudo = [];
        if (estado) conteudo.push(estado);
        if (semTabela) {
            this._casca.mostrar({ espiada, conteudo });
            return;
        }
        conteudo.push(tabelaDoPainel({
            colunas: quadro.colunas,
            grupos: [{ titulo: null, linhas: quadro.principais }],
            legenda: LEGENDA_DO_QUADRO,
        }));
        conteudo.push(this._casca.bloco('auxiliar', TITULO_DO_AUXILIAR, tabelaDoPainel({
            colunas: quadro.colunas,
            grupos: [{ titulo: null, linhas: quadro.auxiliares }],
            legenda: TITULO_DO_AUXILIAR,
        })));
        if (this._previsao?.serie) {
            conteudo.push(el('p', 'painel-ponto__nota', carimboDaFonte(this._previsao)));
            conteudo.push(el('p', 'painel-ponto__nota', ATRIBUICAO));
        }
        this._casca.mostrar({ espiada, conteudo });
    }

    /**
     * A state box: a title and, optionally, the action.
     * @param {string} titulo
     * @param {string|null} texto
     * @param {{erro?: boolean, tentarDeNovo?: boolean, carregando?: boolean}} [opcoes] - `carregando`
     *   puts the spinner before the title, while the forecast travels
     * @returns {HTMLElement}
     * @private
     */
    _estado(titulo, texto, { erro = false, tentarDeNovo = false, carregando = false } = {}) {
        const classes = ['painel-ponto__estado'];
        if (erro) classes.push('painel-ponto__estado--erro');
        if (carregando) classes.push('painel-ponto__estado--carregando');
        const caixa = el('div', classes.join(' '));
        caixa.setAttribute('role', erro ? 'alert' : 'status');
        if (carregando) {
            const spinner = el('span', 'painel-ponto__spinner');
            spinner.setAttribute('aria-hidden', 'true');
            caixa.appendChild(spinner);
        }
        caixa.appendChild(el('p', 'painel-ponto__estado-titulo', titulo));
        if (texto) caixa.appendChild(el('p', 'painel-ponto__estado-texto', texto));
        if (tentarDeNovo) {
            const botao = el('button', 'painel-ponto__botao painel-ponto__botao--secundario', ROTULO_TENTAR_DE_NOVO);
            botao.type = 'button';
            // The node is replaced on every render, so the listener dies with it.
            botao.addEventListener('click', () => this._casca.atualizar());
            caixa.appendChild(botao);
        }
        return caixa;
    }

    /**
     * @param {number|null} status
     * @returns {HTMLElement}
     * @private
     */
    _estadoDeFalha(status) {
        return this._estado(ESTADO_INDISPONIVEL, acaoIndisponivel(status), { erro: true, tentarDeNovo: true });
    }

    /**
     * "Salvar tabela": the quadro on screen as a CSV file, with the point, the zone, the model, the
     * run and the licence inside it.
     * @private
     */
    _salvar() {
        if (!this._previsao?.serie || !this._quadro) {
            showError(this._consultando ? AVISO_AINDA_CHEGANDO : AVISO_SEM_PREVISAO_PARA_SALVAR);
            return;
        }
        try {
            const ponto = this._casca.ponto;
            const coordenada = this._casca.formato === 'latlong' ? null : this._casca.textoDaCoordenada();
            this._casca.baixarCsv(
                nomeDoArquivoCsv(this._quadro.dataD, ponto),
                tabelaCsv(this._quadro, { ponto, previsao: this._previsao, coordenada }),
            );
            showSuccess(AVISO_SALVO);
        } catch (error) {
            console.error('[meteorologia] a tabela não foi salva:', error);
            showError(AVISO_FALHA_AO_SALVAR);
        }
    }
}
