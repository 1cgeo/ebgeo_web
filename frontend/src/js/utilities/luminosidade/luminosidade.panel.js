// Path: js/utilities/luminosidade/luminosidade.panel.js

/**
 * @fileoverview THE LIGHT PANEL: the PITCIC light matrix for one point of the map, opened from the
 * map's context menu ("Luminosidade neste ponto").
 *
 * It only COMPUTES and never writes (principles U5 and U6 of the proposal): no feature, no layer,
 * no calco (item 4.3.3.2.3 of the manual forbids a calco of its own for weather), no sync op, no
 * role gate and no state refusal. A Leitor, a public-link visitor, a local atlas and a locked map
 * all see the same panel. It has NO link to the map's timeline, by the owner's decision of
 * 2026-09-23: day D is today or the date chosen in the panel, and nothing is drawn under the bar.
 *
 * TWO THINGS THAT DO NOT READ OFF THE CODE:
 *
 *   - THE PIN is an ephemeral map source that is not a feature and never reaches the store. Without
 *     it the panel shows numbers for a point the person lost sight of the moment the map moved. The
 *     basemap switch keeps it (`mergeApplicationStyle` preserves every application source), and the
 *     `styledata` guard below puts it back if anything else ever drops it.
 *   - ON A PHONE the same panel is a bottom sheet with three heights. The peek line answers "when
 *     does it get dark here today, and will there be a Moon?" without opening anything.
 */

import { getStateManager, getEventBus } from '@store';
import { EventTypes } from '@events';
import { formatCoordinates } from '@utils/coordinate_converter.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import { isPhoneLayout } from '@utils/tablet-mode.js';
import { addDomListener, cleanup, setupCleanup, subscribe } from '@utils/event-cleanup.js';
import {
    ROTULO_FUSO_BRASILIA,
    avisoDeFusoDoNavegador,
    dataIsoValida,
    meiaNoiteP,
    rotuloDoDia,
    somarDias,
} from './hora-brasilia.js';
import {
    cabecalhosDasColunas,
    diaDoPainel,
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
    ORIGEM_DO_DIA_D,
    RESSALVA_DO_HORIZONTE,
    ROTULO_DATA_D,
    ROTULO_DIA_ANTERIOR,
    ROTULO_DIA_SEGUINTE,
    ROTULO_FECHAR,
    ROTULO_SALVAR,
    TITULO_DA_FIG_4_10,
    TITULO_DO_AUXILIAR,
    TITULO_DO_PAINEL,
    notaDoCriterioDaNoite,
} from './luminosidade-phrases.js';

/** The ephemeral pin: one source, one layer, both removed with the panel. */
const FONTE_DO_PINO = 'luminosidade-ponto';
const CAMADA_DO_PINO = 'luminosidade-ponto';

/** The three heights of the phone sheet, shortest first. */
const ESTADOS_DA_FOLHA = Object.freeze(['espiada', 'meia', 'inteira']);

/** UTF-8 byte order mark: a spreadsheet then opens the accents right (the attribute table does the same). */
const BOM_UTF8 = String.fromCharCode(0xfeff);

/** A drag shorter than this, in px, is a tap on the handle. */
const LIMIAR_DE_ARRASTO_PX = 40;

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [texto]
 * @returns {HTMLElement}
 */
function el(tag, className, texto) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (texto !== undefined) node.textContent = texto;
    return node;
}

/**
 * A table cell with its day mark and the text a screen reader should hear.
 * @param {import('./quadro-pitcic.js').Celula} celula
 * @returns {HTMLTableCellElement}
 */
function celulaDom(celula) {
    const td = el('td', `luminosidade-quadro__celula${celula.vazia ? ' luminosidade-quadro__celula--vazia' : ''}`);
    if (celula.dica) td.title = celula.dica;
    const visivel = el('span', null, celula.texto);
    visivel.setAttribute('aria-hidden', celula.marca ? 'true' : 'false');
    td.appendChild(visivel);
    if (celula.marca) {
        const marca = el('span', 'luminosidade-quadro__marca', ` ${celula.marca}`);
        marca.setAttribute('aria-hidden', 'true');
        td.appendChild(marca);
        td.appendChild(el('span', 'luminosidade-sr', celula.textoLido));
    }
    if (celula.vazia && celula.dica) td.appendChild(el('span', 'luminosidade-sr', `. ${celula.dica}`));
    return td;
}

/**
 * A row header with the abbreviation expanded (principle U1).
 * @param {{rotulo: string, expansao: string}} linha
 * @returns {HTMLTableCellElement}
 */
function cabecalhoDeLinha(linha) {
    const th = el('th', 'luminosidade-quadro__rotulo');
    th.scope = 'row';
    if (linha.expansao && linha.expansao !== linha.rotulo) {
        const abbr = el('abbr', null, linha.rotulo);
        abbr.title = linha.expansao;
        th.appendChild(abbr);
    } else {
        th.textContent = linha.rotulo;
    }
    return th;
}

/**
 * A table for a list of row groups, with the column headers of the matrix.
 * @param {Object} matriz
 * @param {Array<{titulo: string|null, linhas: Array<Object>}>} grupos
 * @param {string} legenda - the caption, read by screen readers only
 * @returns {HTMLTableElement}
 */
function tabela(matriz, grupos, legenda) {
    const table = el('table', 'luminosidade-quadro');
    table.appendChild(el('caption', 'luminosidade-sr', legenda));

    const thead = el('thead');
    const tr = el('tr');
    tr.appendChild(el('td', 'luminosidade-quadro__canto'));
    for (const c of cabecalhosDasColunas(matriz)) {
        const th = el('th', 'luminosidade-quadro__coluna');
        th.scope = 'col';
        th.appendChild(el('span', 'luminosidade-quadro__relativo', c.relativo));
        th.appendChild(el('span', 'luminosidade-quadro__dia', c.dia));
        tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);

    for (const { titulo, linhas } of grupos) {
        const tbody = el('tbody');
        if (titulo) {
            const trGrupo = el('tr', 'luminosidade-quadro__grupo');
            const th = el('th', null, titulo);
            th.scope = 'rowgroup';
            th.colSpan = matriz.colunas.length + 1;
            trGrupo.appendChild(th);
            tbody.appendChild(trGrupo);
        }
        for (const linha of linhas) {
            const trLinha = el('tr');
            trLinha.appendChild(cabecalhoDeLinha(linha));
            for (const celula of linha.celulas) trLinha.appendChild(celulaDom(celula));
            tbody.appendChild(trLinha);
        }
        table.appendChild(tbody);
    }
    return table;
}

/**
 * The browser's offset from UTC on the queried date, in minutes (positive east).
 * @param {string} dataIso
 * @returns {number}
 */
function deslocamentoDoNavegador(dataIso) {
    return -new Date(meiaNoiteP(dataIso) + 12 * 3600000).getTimezoneOffset();
}

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
        setupCleanup(this);
        this._map = map;
        this._calcular = calcular;
        this._agora = agora;

        this._ponto = null;
        this._formato = 'latlong';
        this._escolhidoNoPainel = null;
        this._estadoDaFolha = 'espiada';
        this._raiz = null;
        this._matriz = null;
        this._dataD = null;
        this._blocosAbertos = new Set();

        this._aoTeclar = this._aoTeclar.bind(this);
        this._aoMudarEstilo = this._aoMudarEstilo.bind(this);
    }

    /** @returns {boolean} */
    estaAberto() {
        return this._raiz !== null && this._raiz.isConnected;
    }

    /**
     * Opens the panel on a point, or moves an open panel to a new point. Day D chosen in the panel
     * survives the move.
     * @param {{ponto: {lat: number, lng: number}, formato?: string}} entrada
     */
    abrir({ ponto, formato = 'latlong' }) {
        this._ponto = { lat: ponto.lat, lng: ponto.lng };
        this._formato = formato || 'latlong';
        if (!this.estaAberto()) this._montar();
        this._atualizarPino();
        this._renderizar();
        this._titulo?.focus();
    }

    /** Closes the panel, removes the pin, and gives focus back to the map. */
    fechar() {
        if (!this._raiz) return;
        cleanup(this);
        setupCleanup(this);
        this._map.off('styledata', this._aoMudarEstilo);
        document.removeEventListener('keydown', this._aoTeclar);
        this._removerPino();
        this._raiz.remove();
        this._raiz = null;
        this._escolhidoNoPainel = null;
        this._map.getCanvas?.()?.focus?.();
    }

    /** Same as {@link fechar}; the name every destroyable of the map uses. */
    destroy() {
        this.fechar();
    }

    // ----------------------------------------------------------------------------------------
    // BUILD
    // ----------------------------------------------------------------------------------------

    /** @private */
    _montar() {
        const folha = isPhoneLayout();
        const raiz = el('section', `luminosidade-painel${folha ? ' luminosidade-painel--folha' : ''}`);
        raiz.setAttribute('role', 'dialog');
        raiz.setAttribute('aria-modal', 'false');
        raiz.setAttribute('aria-labelledby', 'luminosidade-painel-titulo');
        if (folha) raiz.dataset.estado = this._estadoDaFolha;

        if (folha) {
            const alca = el('button', 'luminosidade-painel__alca');
            alca.type = 'button';
            alca.setAttribute('aria-label', 'Expandir ou recolher o painel de luminosidade');
            addDomListener(this, alca, 'click', () => this._ciclarFolha());
            addDomListener(this, alca, 'pointerdown', (e) => this._iniciarArrasto(e));
            raiz.appendChild(alca);
        }

        const cabecalho = el('header', 'luminosidade-painel__cabecalho');
        this._titulo = el('h2', 'luminosidade-painel__titulo', TITULO_DO_PAINEL);
        this._titulo.id = 'luminosidade-painel-titulo';
        this._titulo.tabIndex = -1;
        const fechar = el('button', 'luminosidade-painel__fechar', '✕');
        fechar.type = 'button';
        fechar.setAttribute('aria-label', ROTULO_FECHAR);
        fechar.title = ROTULO_FECHAR;
        addDomListener(this, fechar, 'click', () => this.fechar());
        cabecalho.append(this._titulo, fechar);
        raiz.appendChild(cabecalho);

        this._espiada = el('div', 'luminosidade-painel__espiada');
        this._espiada.setAttribute('aria-hidden', 'true');
        raiz.appendChild(this._espiada);

        const pontoEData = el('div', 'luminosidade-painel__ponto-e-data');
        this._coordenada = el('span', 'luminosidade-painel__coordenada');
        const data = el('div', 'luminosidade-painel__data');
        const anterior = el('button', 'luminosidade-painel__seta', '◀');
        anterior.type = 'button';
        anterior.setAttribute('aria-label', ROTULO_DIA_ANTERIOR);
        anterior.title = ROTULO_DIA_ANTERIOR;
        this._campoData = el('input', 'luminosidade-painel__campo-data');
        this._campoData.type = 'date';
        this._campoData.setAttribute('aria-label', ROTULO_DATA_D);
        const seguinte = el('button', 'luminosidade-painel__seta', '▶');
        seguinte.type = 'button';
        seguinte.setAttribute('aria-label', ROTULO_DIA_SEGUINTE);
        seguinte.title = ROTULO_DIA_SEGUINTE;
        addDomListener(this, anterior, 'click', () => this._moverDia(-1));
        addDomListener(this, seguinte, 'click', () => this._moverDia(1));
        addDomListener(this, this._campoData, 'change', () => {
            if (dataIsoValida(this._campoData.value)) {
                this._escolhidoNoPainel = this._campoData.value;
                this._renderizar();
            }
        });
        data.append(anterior, this._campoData, seguinte);
        pontoEData.append(this._coordenada, data);
        raiz.appendChild(pontoEData);

        this._origem = el('p', 'luminosidade-painel__origem');
        raiz.appendChild(this._origem);

        this._avisoDeFuso = el('p', 'luminosidade-painel__aviso-fuso');
        this._avisoDeFuso.setAttribute('role', 'note');
        raiz.appendChild(this._avisoDeFuso);

        this._conteudo = el('div', 'luminosidade-painel__conteudo');
        raiz.appendChild(this._conteudo);

        const rodape = el('footer', 'luminosidade-painel__rodape');
        rodape.appendChild(el('p', 'luminosidade-painel__ressalva', RESSALVA_DO_HORIZONTE));
        const acoes = el('div', 'luminosidade-painel__acoes');
        const salvar = el('button', 'luminosidade-painel__botao', ROTULO_SALVAR);
        salvar.type = 'button';
        salvar.title = DICA_SALVAR;
        addDomListener(this, salvar, 'click', () => this._salvar());
        acoes.appendChild(salvar);
        rodape.appendChild(acoes);
        raiz.appendChild(rodape);

        document.body.appendChild(raiz);
        this._raiz = raiz;

        document.addEventListener('keydown', this._aoTeclar);
        this._map.on('styledata', this._aoMudarEstilo);
        const bus = getEventBus?.();
        if (bus) subscribe(this, bus, EventTypes.UI_LAYOUT_CHANGED, () => this._atualizarPosicao());
        this._atualizarPosicao();
    }

    // ----------------------------------------------------------------------------------------
    // RENDER
    // ----------------------------------------------------------------------------------------

    /** @private */
    _renderizar() {
        if (!this._raiz || !this._ponto) return;
        const { dataD, origem } = diaDoPainel({ escolhidoNoPainel: this._escolhidoNoPainel, agoraMs: this._agora() });

        let matriz;
        try {
            matriz = this._calcular(dataD, this._ponto);
        } catch (error) {
            console.error('[luminosidade] cálculo falhou:', error);
            showError(AVISO_FALHA_NO_CALCULO);
            return;
        }
        this._matriz = matriz;
        this._dataD = dataD;

        this._coordenada.textContent = this._textoDaCoordenada();
        this._campoData.value = dataD;
        this._origem.textContent = `${ORIGEM_DO_DIA_D[origem]} · ${ROTULO_FUSO_BRASILIA}`;

        const aviso = avisoDeFusoDoNavegador(deslocamentoDoNavegador(dataD));
        this._avisoDeFuso.textContent = aviso ?? '';
        this._avisoDeFuso.hidden = aviso === null;

        const resumo = resumoDaEspiada(matriz);
        this._espiada.replaceChildren(
            el('span', 'luminosidade-painel__espiada-dia', `${rotuloDoDia(dataD)} (D)`),
            el('span', null, resumo.sol),
            el('span', null, resumo.lua),
        );

        const doutrinarias = linhasDoQuadro(matriz);
        const conteudo = [tabela(matriz, [
            { titulo: GRUPO_SOLAR, linhas: doutrinarias.filter((l) => l.grupo === GRUPO_SOLAR) },
            { titulo: GRUPO_LUNAR, linhas: doutrinarias.filter((l) => l.grupo === GRUPO_LUNAR) },
        ], LEGENDA_DO_QUADRO)];

        const notas = [...new Set(matriz.colunas.map((c) => notaDoCriterioDaNoite(c.noite?.criterio)).filter(Boolean))];
        for (const nota of notas) conteudo.push(el('p', 'luminosidade-painel__nota', nota));

        conteudo.push(this._bloco('fig', TITULO_DA_FIG_4_10,
            tabela(matriz, [{ titulo: null, linhas: linhasDaFig410(matriz) }], TITULO_DA_FIG_4_10)));

        const auxiliar = tabela(matriz, [{ titulo: null, linhas: [linhaDaIluminacao(matriz)] }], TITULO_DO_AUXILIAR);
        auxiliar.title = DICA_DA_ILUMINACAO;
        conteudo.push(this._bloco('auxiliar', TITULO_DO_AUXILIAR, auxiliar));

        this._conteudo.replaceChildren(...conteudo);
    }

    /**
     * A collapsible block that remembers whether it was open across re-renders.
     * @private
     */
    _bloco(chave, titulo, corpo) {
        const details = el('details', 'luminosidade-painel__bloco');
        details.open = this._blocosAbertos.has(chave);
        details.appendChild(el('summary', 'luminosidade-painel__bloco-titulo', titulo));
        details.appendChild(corpo);
        details.addEventListener('toggle', () => {
            if (details.open) this._blocosAbertos.add(chave);
            else this._blocosAbertos.delete(chave);
        });
        return details;
    }

    /** @private */
    _textoDaCoordenada() {
        return formatCoordinates(this._ponto.lat, this._ponto.lng, this._formato);
    }

    /** @private */
    _moverDia(n) {
        this._escolhidoNoPainel = somarDias(this._dataD, n);
        this._renderizar();
    }

    /** @private */
    _atualizarPosicao() {
        if (!this._raiz) return;
        const estado = getStateManager?.();
        const expandida = estado?.getUnsafe?.('sidebar.expanded') || false;
        const painelDeFeicao = estado?.getUnsafe?.('ui.featurePanelOpen') || false;
        this._raiz.dataset.sidebarState = (expandida || painelDeFeicao) ? 'expanded' : 'collapsed';
    }

    // ----------------------------------------------------------------------------------------
    // SAVE
    // ----------------------------------------------------------------------------------------

    /**
     * "Salvar tabela": the matrix on screen as a CSV file, with the house's convention (UTF-8 BOM,
     * the same one the attribute table uses, so a spreadsheet opens the accents right). The point
     * in the map's format goes in only when that format is not decimal (see `tabelaCsv`).
     * @private
     */
    _salvar() {
        if (!this._matriz) return;
        try {
            const coordenada = this._formato === 'latlong' ? null : this._textoDaCoordenada();
            const csv = `${BOM_UTF8}${tabelaCsv(this._matriz, { coordenada })}`;
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = nomeDoArquivoCsv(this._matriz);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            showSuccess(AVISO_SALVO);
        } catch (error) {
            console.error('[luminosidade] a tabela não foi salva:', error);
            showError(AVISO_FALHA_AO_SALVAR);
        }
    }

    // ----------------------------------------------------------------------------------------
    // KEYBOARD AND PHONE SHEET
    // ----------------------------------------------------------------------------------------

    /**
     * Esc closes the panel when the key is not meant for something else: focus inside the panel,
     * on the map, or nowhere in particular. A modal or a text field elsewhere keeps its Esc.
     * @private
     */
    _aoTeclar(e) {
        if (e.key !== 'Escape' || e.defaultPrevented || !this._raiz) return;
        const alvo = e.target;
        const noPainel = this._raiz.contains(alvo);
        const noMapa = this._map.getCanvasContainer?.()?.contains?.(alvo);
        const semFoco = alvo === document.body || alvo === document.documentElement;
        if (noPainel || noMapa || semFoco) {
            e.preventDefault();
            this.fechar();
        }
    }

    /** @private */
    _ciclarFolha() {
        if (this._arrastoConsumiuClique) {
            this._arrastoConsumiuClique = false;
            return;
        }
        const i = ESTADOS_DA_FOLHA.indexOf(this._estadoDaFolha);
        this._definirFolha(ESTADOS_DA_FOLHA[(i + 1) % ESTADOS_DA_FOLHA.length]);
    }

    /** @private */
    _definirFolha(estado) {
        this._estadoDaFolha = estado;
        if (this._raiz) this._raiz.dataset.estado = estado;
    }

    /**
     * A vertical drag on the handle moves the sheet one height up or down. The live offset is a
     * runtime-computed position, the one inline style the house allows.
     * @private
     */
    _iniciarArrasto(e) {
        if (!this._raiz) return;
        const inicioY = e.clientY;
        const raiz = this._raiz;
        const mover = (ev) => {
            raiz.style.setProperty('--luminosidade-arrasto', `${ev.clientY - inicioY}px`);
            raiz.classList.add('luminosidade-painel--arrastando');
        };
        const soltar = (ev) => {
            document.removeEventListener('pointermove', mover);
            document.removeEventListener('pointerup', soltar);
            document.removeEventListener('pointercancel', soltar);
            raiz.classList.remove('luminosidade-painel--arrastando');
            raiz.style.removeProperty('--luminosidade-arrasto');
            const dy = ev.clientY - inicioY;
            if (Math.abs(dy) < LIMIAR_DE_ARRASTO_PX) return;
            this._arrastoConsumiuClique = true;
            const i = ESTADOS_DA_FOLHA.indexOf(this._estadoDaFolha);
            const proximo = Math.max(0, Math.min(ESTADOS_DA_FOLHA.length - 1, i + (dy < 0 ? 1 : -1)));
            this._definirFolha(ESTADOS_DA_FOLHA[proximo]);
        };
        document.addEventListener('pointermove', mover);
        document.addEventListener('pointerup', soltar);
        document.addEventListener('pointercancel', soltar);
    }

    // ----------------------------------------------------------------------------------------
    // THE PIN
    // ----------------------------------------------------------------------------------------

    /** @private */
    _dadosDoPino() {
        return {
            type: 'FeatureCollection',
            features: this._ponto ? [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [this._ponto.lng, this._ponto.lat] },
                properties: {},
            }] : [],
        };
    }

    /** @private */
    _atualizarPino() {
        const map = this._map;
        if (!map?.getStyle?.()) return;
        const fonte = map.getSource(FONTE_DO_PINO);
        if (fonte) {
            fonte.setData(this._dadosDoPino());
        } else {
            map.addSource(FONTE_DO_PINO, { type: 'geojson', data: this._dadosDoPino() });
        }
        if (!map.getLayer(CAMADA_DO_PINO)) {
            map.addLayer({
                id: CAMADA_DO_PINO,
                type: 'circle',
                source: FONTE_DO_PINO,
                paint: {
                    'circle-radius': 7,
                    'circle-color': '#b45309',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 3,
                },
            });
        }
    }

    /**
     * A style rebuild that drops application sources (none does today) must not lose the pin.
     * @private
     */
    _aoMudarEstilo() {
        if (!this._raiz || !this._map.isStyleLoaded?.()) return;
        if (!this._map.getSource(FONTE_DO_PINO) || !this._map.getLayer(CAMADA_DO_PINO)) this._atualizarPino();
    }

    /** @private */
    _removerPino() {
        const map = this._map;
        if (!map?.getStyle?.()) return;
        if (map.getLayer(CAMADA_DO_PINO)) map.removeLayer(CAMADA_DO_PINO);
        if (map.getSource(FONTE_DO_PINO)) map.removeSource(FONTE_DO_PINO);
    }
}
