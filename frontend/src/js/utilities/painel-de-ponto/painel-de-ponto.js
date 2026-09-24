// Path: js/utilities/painel-de-ponto/painel-de-ponto.js

/**
 * @fileoverview THE SHELL of the PITCIC point panels: the card that opens from the map's context menu
 * on a clicked point, shared by the light panel ("Luminosidade neste ponto") and the weather panel
 * ("Meteorologia neste ponto").
 *
 * The owner decided on 2026-09-23 that light and weather are SEPARATE screens with separate
 * entries; they are the two halves of one doctrinal table (EB70-MC-10.336, Quadro 4-5) and must
 * look like it. So the shell owns everything that is not the subject: the card and its position,
 * the phone sheet, the point and the day controls, the zone line, Esc, the pin and the file
 * download. A panel only fills the peek line and the body, through `aoAtualizar`, and writes its own
 * file through `aoSalvar`.
 *
 * THREE THINGS THAT DO NOT READ OFF THE CODE:
 *
 *   - ONE PANEL PER MAP AT A TIME. The two cards sit in the same place under the search bar, so
 *     opening one closes the other (`abertos`). Without that the second card covers the first and
 *     two pins mark two points with no way to tell which card is which.
 *   - THE PIN is an ephemeral map source that is not a feature and never reaches the store. Without
 *     it the panel shows numbers for a point the person lost sight of the moment the map moved. The
 *     basemap switch keeps it (`mergeApplicationStyle` preserves every application source), and the
 *     `styledata` guard below puts it back if anything else ever drops it.
 *   - ON A PHONE the same card is a bottom sheet with three heights, and the peek line answers the
 *     panel's question without opening anything.
 *
 * The panels only COMPUTE or READ and never write: no feature, no layer, no calco (item 4.3.3.2.3 of
 * the manual forbids a calco of its own for weather), no sync op, no role gate and no state refusal.
 */

import { getStateManager, getEventBus } from '@store';
import { EventTypes } from '@events';
import { formatCoordinates } from '@utils/coordinate_converter.js';
import { isPhoneLayout } from '@utils/tablet-mode.js';
import { addDomListener, cleanup, setupCleanup, subscribe } from '@utils/event-cleanup.js';
import {
    ROTULO_FUSO_BRASILIA,
    avisoDeFusoDoNavegador,
    dataIsoValida,
    diaDoPainel,
    meiaNoiteP,
    somarDias,
} from '@utils/hora-brasilia.js';
import {
    ORIGEM_DO_DIA_D,
    ROTULO_DATA_D,
    ROTULO_DIA_ANTERIOR,
    ROTULO_DIA_SEGUINTE,
    ROTULO_FECHAR,
    ROTULO_SALVAR,
} from './painel-de-ponto-phrases.js';

/** The three heights of the phone sheet, shortest first. */
const ESTADOS_DA_FOLHA = Object.freeze(['espiada', 'meia', 'inteira']);

/** UTF-8 byte order mark: a spreadsheet then opens the accents right (the attribute table does the same). */
const BOM_UTF8 = String.fromCharCode(0xfeff);

/** A drag shorter than this, in px, is a tap on the handle. */
const LIMIAR_DE_ARRASTO_PX = 40;

/** The open panel of each map: opening one closes the other. */
const abertos = new WeakMap();

/**
 * The ephemeral pin: ONE source and ONE layer for every point panel, because only one is open per
 * map. A literal on purpose: `tests/unit/despachante-sem-escrita-crua.test.js` must be able to prove
 * that the `setData` below does not write a dispatcher-migrated source, and it proves that only for
 * an id that resolves to a literal.
 */
const FONTE_DO_PINO = 'painel-ponto-pino';

/**
 * @typedef {Object} Celula
 * @property {string} texto - what the cell shows ("05:03h", "cheia", "não ocorre", "21 °C")
 * @property {string} marca - the day mark ("(+1)"), empty on the same day
 * @property {string} textoLido - what a screen reader says instead of texto + marca
 * @property {string|null} dica - the tooltip; for an empty cell, WHY it is empty
 * @property {boolean} vazia - there is no value (the phenomenon does not happen, or no data)
 */

/**
 * @typedef {Object} LinhaDoPainel
 * @property {string} rotulo
 * @property {string} expansao - the abbreviation expanded; equal to rotulo when there is none
 * @property {Celula[]} celulas - one per column
 * @property {boolean} [quebra] - cells may wrap (long words, like a weather description)
 */

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [texto]
 * @returns {HTMLElement}
 */
export function el(tag, className, texto) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (texto !== undefined) node.textContent = texto;
    return node;
}

/**
 * A table cell with its day mark and the text a screen reader should hear.
 * @param {Celula} celula
 * @param {boolean} quebra
 * @returns {HTMLTableCellElement}
 */
function celulaDom(celula, quebra) {
    const classes = ['painel-ponto-quadro__celula'];
    if (celula.vazia) classes.push('painel-ponto-quadro__celula--vazia');
    if (quebra) classes.push('painel-ponto-quadro__celula--quebra');
    const td = el('td', classes.join(' '));
    if (celula.dica) td.title = celula.dica;
    const visivel = el('span', null, celula.texto);
    visivel.setAttribute('aria-hidden', celula.marca ? 'true' : 'false');
    td.appendChild(visivel);
    if (celula.marca) {
        const marca = el('span', 'painel-ponto-quadro__marca', ` ${celula.marca}`);
        marca.setAttribute('aria-hidden', 'true');
        td.appendChild(marca);
        td.appendChild(el('span', 'painel-ponto-sr', celula.textoLido));
    }
    if (celula.vazia && celula.dica) td.appendChild(el('span', 'painel-ponto-sr', `. ${celula.dica}`));
    return td;
}

/**
 * A row header with the abbreviation expanded.
 * @param {{rotulo: string, expansao: string}} linha
 * @returns {HTMLTableCellElement}
 */
function cabecalhoDeLinha(linha) {
    const th = el('th', 'painel-ponto-quadro__rotulo');
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
 * A table of a point panel: the day columns and groups of rows.
 * @param {Object} entrada
 * @param {Array<{relativo: string, dia: string}>} entrada.colunas - "D" over "qui 24/09"
 * @param {Array<{titulo: string|null, linhas: LinhaDoPainel[]}>} entrada.grupos
 * @param {string} entrada.legenda - the caption, read by screen readers only
 * @returns {HTMLTableElement}
 */
export function tabelaDoPainel({ colunas, grupos, legenda }) {
    const table = el('table', 'painel-ponto-quadro');
    table.appendChild(el('caption', 'painel-ponto-sr', legenda));

    const thead = el('thead');
    const tr = el('tr');
    tr.appendChild(el('td', 'painel-ponto-quadro__canto'));
    for (const c of colunas) {
        const th = el('th', 'painel-ponto-quadro__coluna');
        th.scope = 'col';
        th.appendChild(el('span', 'painel-ponto-quadro__relativo', c.relativo));
        th.appendChild(el('span', 'painel-ponto-quadro__dia', c.dia));
        tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);

    for (const { titulo, linhas } of grupos) {
        const tbody = el('tbody');
        if (titulo) {
            const trGrupo = el('tr', 'painel-ponto-quadro__grupo');
            const th = el('th', null, titulo);
            th.scope = 'rowgroup';
            th.colSpan = colunas.length + 1;
            trGrupo.appendChild(th);
            tbody.appendChild(trGrupo);
        }
        for (const linha of linhas) {
            const trLinha = el('tr');
            trLinha.appendChild(cabecalhoDeLinha(linha));
            for (const celula of linha.celulas) trLinha.appendChild(celulaDom(celula, !!linha.quebra));
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
 * The shell of a point panel. A panel owns one per map.
 */
export class PainelDePonto {
    /**
     * @param {Object} opcoes
     * @param {Object} opcoes.map - the MapLibre map
     * @param {string} opcoes.id - `luminosidade` or `meteorologia`: names the title and the CSS
     *   modifier (the pin is one for every panel, {@link FONTE_DO_PINO})
     * @param {string} opcoes.titulo
     * @param {string} opcoes.rotuloDaAlca - the phone handle's accessible name
     * @param {string} opcoes.ressalva - the validity condition of every number, as a visible footer
     * @param {string} opcoes.dicaSalvar - what "Salvar tabela" writes
     * @param {(contexto: {dataD: string, origem: string, ponto: {lat: number, lng: number}}) => void} opcoes.aoAtualizar -
     *   called whenever the point or day D changes, after the header is up to date
     * @param {() => void} opcoes.aoSalvar
     * @param {() => number} [opcoes.agora] - test seam
     */
    constructor({ map, id, titulo, rotuloDaAlca, ressalva, dicaSalvar, aoAtualizar, aoSalvar, agora = () => Date.now() }) {
        setupCleanup(this);
        this._map = map;
        this._id = id;
        this._textos = { titulo, rotuloDaAlca, ressalva, dicaSalvar };
        this._aoAtualizar = aoAtualizar;
        this._aoSalvar = aoSalvar;
        this._agora = agora;

        this._ponto = null;
        this._formato = 'latlong';
        this._escolhidoNoPainel = null;
        this._estadoDaFolha = 'espiada';
        this._raiz = null;
        this._dataD = null;
        this._blocosAbertos = new Set();

        this._aoTeclar = this._aoTeclar.bind(this);
        this._aoMudarEstilo = this._aoMudarEstilo.bind(this);
    }

    /** @returns {boolean} */
    estaAberto() {
        return this._raiz !== null && this._raiz.isConnected;
    }

    /** @returns {{lat: number, lng: number}|null} */
    get ponto() {
        return this._ponto ? { ...this._ponto } : null;
    }

    /** @returns {string} the map's coordinate format id at the time of opening */
    get formato() {
        return this._formato;
    }

    /** @returns {string|null} */
    get dataD() {
        return this._dataD;
    }

    /**
     * Opens the panel on a point, or moves an open panel to a new point. Day D chosen in the panel
     * survives the move. Any OTHER point panel open on the same map is closed first.
     * @param {{ponto: {lat: number, lng: number}, formato?: string}} entrada
     */
    abrir({ ponto, formato = 'latlong' }) {
        const outro = abertos.get(this._map);
        if (outro && outro !== this) outro.fechar();
        abertos.set(this._map, this);

        this._ponto = { lat: ponto.lat, lng: ponto.lng };
        this._formato = formato || 'latlong';
        if (!this.estaAberto()) this._montar();
        this._atualizarPino();
        this.atualizar();
        this._titulo?.focus();
    }

    /** Closes the panel, removes the pin, and gives focus back to the map. */
    fechar() {
        if (abertos.get(this._map) === this) abertos.delete(this._map);
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

    /**
     * Brings the header up to date (point, day D, zone) and asks the panel for its body.
     */
    atualizar() {
        if (!this._raiz || !this._ponto) return;
        const { dataD, origem } = diaDoPainel({ escolhidoNoPainel: this._escolhidoNoPainel, agoraMs: this._agora() });
        this._dataD = dataD;

        this._coordenada.textContent = this.textoDaCoordenada();
        this._campoData.value = dataD;
        this._origem.textContent = `${ORIGEM_DO_DIA_D[origem]} · ${ROTULO_FUSO_BRASILIA}`;

        const aviso = avisoDeFusoDoNavegador(deslocamentoDoNavegador(dataD));
        this._avisoDeFuso.textContent = aviso ?? '';
        this._avisoDeFuso.hidden = aviso === null;

        this._aoAtualizar({ dataD, origem, ponto: { ...this._ponto } });
    }

    /**
     * Replaces the peek line (phone) and the body.
     * @param {{espiada?: Node[], conteudo?: Node[]}} partes
     */
    mostrar({ espiada = [], conteudo = [] }) {
        if (!this._raiz) return;
        this._espiada.replaceChildren(...espiada);
        this._conteudo.replaceChildren(...conteudo);
    }

    /**
     * A collapsible block that remembers whether it was open across re-renders.
     * @param {string} chave
     * @param {string} titulo
     * @param {Node} corpo
     * @returns {HTMLDetailsElement}
     */
    bloco(chave, titulo, corpo) {
        const details = el('details', 'painel-ponto__bloco');
        details.open = this._blocosAbertos.has(chave);
        details.appendChild(el('summary', 'painel-ponto__bloco-titulo', titulo));
        details.appendChild(corpo);
        details.addEventListener('toggle', () => {
            if (details.open) this._blocosAbertos.add(chave);
            else this._blocosAbertos.delete(chave);
        });
        return details;
    }

    /** @returns {string} the point in the map's coordinate format */
    textoDaCoordenada() {
        return formatCoordinates(this._ponto.lat, this._ponto.lng, this._formato);
    }

    /**
     * Downloads a CSV with the house's convention (UTF-8 BOM, the same one the attribute table
     * uses, so a spreadsheet opens the accents right).
     * @param {string} nomeDoArquivo
     * @param {string} texto - the CSV without the BOM
     * @throws when the browser refuses the download; the caller says so
     */
    baixarCsv(nomeDoArquivo, texto) {
        const blob = new Blob([`${BOM_UTF8}${texto}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nomeDoArquivo;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // ----------------------------------------------------------------------------------------
    // BUILD
    // ----------------------------------------------------------------------------------------

    /** @private */
    _montar() {
        const folha = isPhoneLayout();
        const classes = ['painel-ponto', `painel-ponto--${this._id}`];
        if (folha) classes.push('painel-ponto--folha');
        const raiz = el('section', classes.join(' '));
        const idDoTitulo = `${this._id}-painel-titulo`;
        raiz.setAttribute('role', 'dialog');
        raiz.setAttribute('aria-modal', 'false');
        raiz.setAttribute('aria-labelledby', idDoTitulo);
        if (folha) raiz.dataset.estado = this._estadoDaFolha;

        if (folha) {
            const alca = el('button', 'painel-ponto__alca');
            alca.type = 'button';
            alca.setAttribute('aria-label', this._textos.rotuloDaAlca);
            addDomListener(this, alca, 'click', () => this._ciclarFolha());
            addDomListener(this, alca, 'pointerdown', (e) => this._iniciarArrasto(e));
            raiz.appendChild(alca);
        }

        const cabecalho = el('header', 'painel-ponto__cabecalho');
        this._titulo = el('h2', 'painel-ponto__titulo', this._textos.titulo);
        this._titulo.id = idDoTitulo;
        this._titulo.tabIndex = -1;
        const fechar = el('button', 'painel-ponto__fechar', '✕');
        fechar.type = 'button';
        fechar.setAttribute('aria-label', ROTULO_FECHAR);
        fechar.title = ROTULO_FECHAR;
        addDomListener(this, fechar, 'click', () => this.fechar());
        cabecalho.append(this._titulo, fechar);
        raiz.appendChild(cabecalho);

        this._espiada = el('div', 'painel-ponto__espiada');
        this._espiada.setAttribute('aria-hidden', 'true');
        raiz.appendChild(this._espiada);

        const pontoEData = el('div', 'painel-ponto__ponto-e-data');
        this._coordenada = el('span', 'painel-ponto__coordenada');
        const data = el('div', 'painel-ponto__data');
        const anterior = el('button', 'painel-ponto__seta', '◀');
        anterior.type = 'button';
        anterior.setAttribute('aria-label', ROTULO_DIA_ANTERIOR);
        anterior.title = ROTULO_DIA_ANTERIOR;
        this._campoData = el('input', 'painel-ponto__campo-data');
        this._campoData.type = 'date';
        this._campoData.setAttribute('aria-label', ROTULO_DATA_D);
        const seguinte = el('button', 'painel-ponto__seta', '▶');
        seguinte.type = 'button';
        seguinte.setAttribute('aria-label', ROTULO_DIA_SEGUINTE);
        seguinte.title = ROTULO_DIA_SEGUINTE;
        addDomListener(this, anterior, 'click', () => this._moverDia(-1));
        addDomListener(this, seguinte, 'click', () => this._moverDia(1));
        addDomListener(this, this._campoData, 'change', () => {
            if (dataIsoValida(this._campoData.value)) {
                this._escolhidoNoPainel = this._campoData.value;
                this.atualizar();
            }
        });
        data.append(anterior, this._campoData, seguinte);
        pontoEData.append(this._coordenada, data);
        raiz.appendChild(pontoEData);

        this._origem = el('p', 'painel-ponto__origem');
        raiz.appendChild(this._origem);

        this._avisoDeFuso = el('p', 'painel-ponto__aviso-fuso');
        this._avisoDeFuso.setAttribute('role', 'note');
        raiz.appendChild(this._avisoDeFuso);

        this._conteudo = el('div', 'painel-ponto__conteudo');
        raiz.appendChild(this._conteudo);

        const rodape = el('footer', 'painel-ponto__rodape');
        rodape.appendChild(el('p', 'painel-ponto__ressalva', this._textos.ressalva));
        const acoes = el('div', 'painel-ponto__acoes');
        const salvar = el('button', 'painel-ponto__botao', ROTULO_SALVAR);
        salvar.type = 'button';
        salvar.title = this._textos.dicaSalvar;
        addDomListener(this, salvar, 'click', () => this._aoSalvar());
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

    /** @private */
    _moverDia(n) {
        this._escolhidoNoPainel = somarDias(this._dataD, n);
        this.atualizar();
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
            raiz.style.setProperty('--painel-ponto-arrasto', `${ev.clientY - inicioY}px`);
            raiz.classList.add('painel-ponto--arrastando');
        };
        const soltar = (ev) => {
            document.removeEventListener('pointermove', mover);
            document.removeEventListener('pointerup', soltar);
            document.removeEventListener('pointercancel', soltar);
            raiz.classList.remove('painel-ponto--arrastando');
            raiz.style.removeProperty('--painel-ponto-arrasto');
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
        if (!map.getLayer(FONTE_DO_PINO)) {
            map.addLayer({
                id: FONTE_DO_PINO,
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
        if (!this._map.getSource(FONTE_DO_PINO) || !this._map.getLayer(FONTE_DO_PINO)) this._atualizarPino();
    }

    /** @private */
    _removerPino() {
        const map = this._map;
        if (!map?.getStyle?.()) return;
        if (map.getLayer(FONTE_DO_PINO)) map.removeLayer(FONTE_DO_PINO);
        if (map.getSource(FONTE_DO_PINO)) map.removeSource(FONTE_DO_PINO);
    }
}
