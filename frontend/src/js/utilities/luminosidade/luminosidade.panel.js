// Path: js/utilities/luminosidade/luminosidade.panel.js

/**
 * @fileoverview THE LIGHT PANEL: the PITCIC light matrix for one point of the map, opened from the
 * map's context menu ("Luminosidade neste ponto").
 *
 * It only COMPUTES and never writes (principles U5 and U6 of the proposal). It has NO link to the
 * map's timeline, by the owner's decision of 2026-09-23: day D is today or the date chosen in the
 * panel, and nothing is drawn under the bar.
 *
 * The card, the phone sheet, the pin, the day controls and the download are the SHELL's
 * (`utilities/painel-de-ponto/painel-de-ponto.js`), shared with the weather panel since the owner
 * made the two separate screens; what lives here is the subject: which rows, which blocks, which
 * file.
 */

import { showError, showSuccess } from '@utils/toast_service.js';
import { rotuloDoDia } from '@utils/hora-brasilia.js';
import { PainelDePonto, el, tabelaDoPainel } from '@utils/painel-de-ponto/painel-de-ponto.js';
import {
    cabecalhosDasColunas,
    linhaDaIluminacao,
    linhasDaFig410,
    linhasDoQuadro,
    nomeDoArquivoCsv,
    resumoDaEspiada,
    tabelaCsv,
} from './quadro-pitcic.js';
import {
    AVISO_FALHA_AO_SALVAR,
    AVISO_FALHA_NO_CALCULO,
    AVISO_SALVO,
    DICA_DA_ILUMINACAO,
    DICA_SALVAR,
    GRUPO_LUNAR,
    GRUPO_SOLAR,
    LEGENDA_DO_QUADRO,
    RESSALVA_DO_HORIZONTE,
    ROTULO_DA_ALCA,
    TITULO_DA_FIG_4_10,
    TITULO_DO_AUXILIAR,
    TITULO_DO_PAINEL,
    notaDoCriterioDaNoite,
} from './luminosidade-phrases.js';

/**
 * The light panel. One per map.
 */
export class PainelLuminosidade {
    /**
     * @param {Object} opcoes
     * @param {Object} opcoes.map - the MapLibre map
     * @param {(dataD: string, ponto: {lat: number, lng: number}) => Object} opcoes.calcular -
     *   `matrizPitcic` bound to the ephemerides
     * @param {() => number} [opcoes.agora] - test seam
     */
    constructor({ map, calcular, agora = () => Date.now() }) {
        this._calcular = calcular;
        this._matriz = null;
        this._casca = new PainelDePonto({
            map,
            id: 'luminosidade',
            titulo: TITULO_DO_PAINEL,
            rotuloDaAlca: ROTULO_DA_ALCA,
            ressalva: RESSALVA_DO_HORIZONTE,
            dicaSalvar: DICA_SALVAR,
            aoAtualizar: (contexto) => this._renderizar(contexto),
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

    /** Closes the panel and removes the pin. */
    fechar() {
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
    _renderizar({ dataD, ponto }) {
        let matriz;
        try {
            matriz = this._calcular(dataD, ponto);
        } catch (error) {
            console.error('[luminosidade] cálculo falhou:', error);
            showError(AVISO_FALHA_NO_CALCULO);
            // The shell already moved the header to the new point and day: a body left from the
            // previous ones would sit under it, and "Salvar tabela" would write them.
            this._matriz = null;
            this._casca.mostrar({ espiada: [], conteudo: [] });
            return;
        }
        this._matriz = matriz;
        const colunas = cabecalhosDasColunas(matriz);

        const resumo = resumoDaEspiada(matriz);
        const espiada = [
            el('span', 'painel-ponto__espiada-dia', `${rotuloDoDia(dataD)} (D)`),
            el('span', null, resumo.sol),
            el('span', null, resumo.lua),
        ];

        const doutrinarias = linhasDoQuadro(matriz);
        const conteudo = [tabelaDoPainel({
            colunas,
            grupos: [
                { titulo: GRUPO_SOLAR, linhas: doutrinarias.filter((l) => l.grupo === GRUPO_SOLAR) },
                { titulo: GRUPO_LUNAR, linhas: doutrinarias.filter((l) => l.grupo === GRUPO_LUNAR) },
            ],
            legenda: LEGENDA_DO_QUADRO,
        })];

        const notas = [...new Set(matriz.colunas.map((c) => notaDoCriterioDaNoite(c.noite?.criterio)).filter(Boolean))];
        for (const nota of notas) conteudo.push(el('p', 'painel-ponto__nota', nota));

        conteudo.push(this._casca.bloco('fig', TITULO_DA_FIG_4_10, tabelaDoPainel({
            colunas,
            grupos: [{ titulo: null, linhas: linhasDaFig410(matriz) }],
            legenda: TITULO_DA_FIG_4_10,
        })));

        const auxiliar = tabelaDoPainel({
            colunas,
            grupos: [{ titulo: null, linhas: [linhaDaIluminacao(matriz)] }],
            legenda: TITULO_DO_AUXILIAR,
        });
        auxiliar.title = DICA_DA_ILUMINACAO;
        conteudo.push(this._casca.bloco('auxiliar', TITULO_DO_AUXILIAR, auxiliar));

        this._casca.mostrar({ espiada, conteudo });
    }

    /**
     * "Salvar tabela": the matrix on screen as a CSV file. The point in the map's format goes in only
     * when that format is not decimal (see `tabelaCsv`).
     * @private
     */
    _salvar() {
        if (!this._matriz) return;
        try {
            const coordenada = this._casca.formato === 'latlong' ? null : this._casca.textoDaCoordenada();
            this._casca.baixarCsv(nomeDoArquivoCsv(this._matriz), tabelaCsv(this._matriz, { coordenada }));
            showSuccess(AVISO_SALVO);
        } catch (error) {
            console.error('[luminosidade] a tabela não foi salva:', error);
            showError(AVISO_FALHA_AO_SALVAR);
        }
    }
}
