// Path: tests/unit/temporal-settings-modal-fechamento.test.js
//
// DEFEITO C12 — O ESCAPE DERRUBAVA O MODAL POR BAIXO DE UM AWAIT.
//
// O ouvinte de Escape é registrado em `document` e só sai dentro do `setTimeout(200)` de
// `_close()`, que zerava `this._overlay` LÁ DENTRO. Duas consequências, as duas medidas na
// auditoria temporal de 2026-09-21: um Escape durante um "Reagendar" demorado fechava o modal e o
// fim do await batia em `this._overlay.dataset` já nulo, lançando; e com o `showConfirm` do
// Reagendar aberto, um Escape fechava OS DOIS diálogos, porque a confirmação também escuta
// `document` e nada freava o ouvinte do modal.
//
// O CONSERTO SÃO DUAS PEÇAS INDEPENDENTES, e este arquivo prende as duas separadamente:
//   1. `_requestClose()` (o caminho de todo gesto: Escape, fundo, X, Cancelar) recusa enquanto
//      `_busy`, isto é, enquanto há confirmação filha ou escrita em voo;
//   2. `_close()` é idempotente e à prova de nulo: ele captura o overlay e zera o campo na hora,
//      não dentro do timer.
//
// DEFEITOS C4 e S2, a metade que mora no modal: `_save` fechava a tela mesmo quando
// `setMapTemporalConfig` devolvia `null` (recusa esperada por papel, e agora também por mapa
// travado), de modo que uma recusa era indistinguível de um salvamento; e `_rescheduleFeatures`
// gravava a origem por conta própria, ignorando o retorno do deslocamento. A composição foi para
// `rescheduleMapTemporal` e o modal não grava mais nada sozinho.
//
// O AMBIENTE É `node`, sem jsdom (ver `frontend/vitest.config.js`), então o DOM aqui é um duplo
// mínimo: ele guarda ouvintes, filhos e `dataset`, que é tudo o que estes caminhos tocam.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// DOM mínimo
// ============================================================================

function criarElemento(tag) {
    return {
        tagName: tag,
        className: '',
        textContent: '',
        innerHTML: '',
        value: '',
        dataset: {},
        attributes: {},
        children: [],
        _ouvintes: [],
        focado: false,
        appendChild(filho) { this.children.push(filho); return filho; },
        setAttribute(nome, valor) { this.attributes[nome] = valor; },
        addEventListener(evento, handler) { this._ouvintes.push({ evento, handler }); },
        removeEventListener(evento, handler) {
            this._ouvintes = this._ouvintes.filter((o) => !(o.evento === evento && o.handler === handler));
        },
        remocoes: 0,
        remove() { this.removido = true; this.remocoes += 1; },
        focus() { this.focado = true; },
    };
}

function disparar(elemento, evento, payload = {}) {
    const alvo = { target: elemento, ...payload };
    for (const o of [...elemento._ouvintes]) {
        if (o.evento === evento) o.handler(alvo);
    }
}

function procurar(raiz, predicado) {
    if (predicado(raiz)) return raiz;
    for (const filho of raiz.children) {
        const achado = procurar(filho, predicado);
        if (achado) return achado;
    }
    return null;
}

const botao = (raiz, texto) => procurar(raiz, (e) => e.tagName === 'button' && e.textContent === texto);

// ============================================================================
// Mocks dos vizinhos pesados
// ============================================================================

let instancia = null;
const desmontes = { contagem: 0 };
vi.mock('../../src/js/utilities/event-cleanup.js', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        // O único jeito de alcançar a instância sem alargar a API do módulo: ela se anuncia ao
        // preparar a limpeza, no construtor.
        setupCleanup: (alvo) => { instancia = alvo; return real.setupCleanup(alvo); },
        // E o contador de desmontes: `cleanup` é idempotente, então chamá-lo duas vezes não deixa
        // rastro nenhum no estado final. Sem contar aqui, um desmonte duplicado passa verde.
        cleanup: (alvo) => { desmontes.contagem += 1; return real.cleanup(alvo); },
    };
});

const getMapTemporalConfig = vi.fn();
const setMapTemporalConfig = vi.fn();
const getControl = vi.fn();
vi.mock('../../src/js/store/index.js', () => ({
    getMapTemporalConfig: (...a) => getMapTemporalConfig(...a),
    setMapTemporalConfig: (...a) => setMapTemporalConfig(...a),
    getControl: (...a) => getControl(...a),
}));

const rescheduleMapTemporal = vi.fn();
vi.mock('../../src/js/store/temporal.operations.js', () => ({
    rescheduleMapTemporal: (...a) => rescheduleMapTemporal(...a),
}));

const showConfirm = vi.fn();
vi.mock('../../src/js/modals/index.js', () => ({
    showConfirm: (...a) => showConfirm(...a),
}));

const showWarning = vi.fn();
const showSuccess = vi.fn();
const showToast = vi.fn();
vi.mock('../../src/js/utilities/index.js', () => ({
    showWarning: (...a) => showWarning(...a),
    showSuccess: (...a) => showSuccess(...a),
    showToast: (...a) => showToast(...a),
}));

import { showTemporalSettingsModal } from '../../src/js/temporal/temporal-settings.modal.js';
import { MOTIVO_REAGENDAMENTO, avisoDoReagendamento } from '../../src/js/temporal/temporal-settings.model.js';

const MAPA = 'Principal';
const D = Date.UTC(2026, 0, 10);
const DIA_MS = 86400000;

/** Um `Promise` cuja resolução o caso controla, para segurar o modal num await. */
function adiado() {
    let resolver;
    const promessa = new Promise((r) => { resolver = r; });
    return { promessa, resolver };
}

let overlay;

async function abrir(config = {}) {
    getMapTemporalConfig.mockResolvedValue({
        ativo: false, unidade: 'DIA', inicio: null, fim: null, modo: 'absoluto', origem: D, ...config,
    });
    await showTemporalSettingsModal(MAPA);
    overlay = globalThis.document.body.children.at(-1);
    return overlay;
}

/** O Escape chega pelo `document`, que é onde o modal o registra. */
function escape() {
    disparar(globalThis.document, 'keydown', { key: 'Escape' });
}

const aberto = () => overlay.dataset.visible === 'true' && overlay.removido !== true;

beforeEach(() => {
    vi.useFakeTimers();
    instancia = null;
    desmontes.contagem = 0;
    vi.clearAllMocks();
    const body = criarElemento('body');
    globalThis.document = {
        body,
        activeElement: null,
        createElement: (tag) => criarElemento(tag),
        _ouvintes: [],
        addEventListener(evento, handler) { this._ouvintes.push({ evento, handler }); },
        removeEventListener(evento, handler) {
            this._ouvintes = this._ouvintes.filter((o) => !(o.evento === evento && o.handler === handler));
        },
    };
    globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
    setMapTemporalConfig.mockResolvedValue({ unidade: 'DIA' });
    getControl.mockReturnValue({
        getBounds: () => ({ inicio: D, fim: D + 30 * DIA_MS }),
        shiftFeatureTimes: vi.fn(async () => ({ changed: 2, hadCandidates: true })),
    });
});

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.document;
    delete globalThis.requestAnimationFrame;
});

// ============================================================================
// C12
// ============================================================================

describe('C12 — o Escape não age enquanto há confirmação filha ou escrita em voo', () => {
    async function comecarReagendamento() {
        await abrir({ modo: 'relativo' });
        // A linha do Reagendar: a entrada de data é a irmã anterior do botão.
        const btn = botao(overlay, 'Reagendar');
        const linha = procurar(overlay, (e) => e.children.includes(btn));
        linha.children[0].value = '2026-03-01T00:00';
        disparar(btn, 'click');
        await Promise.resolve();
        return btn;
    }

    it('com a confirmação ABERTA, o Escape não fecha o modal', async () => {
        const confirmacao = adiado();
        showConfirm.mockReturnValue(confirmacao.promessa);

        await comecarReagendamento();
        expect(showConfirm).toHaveBeenCalled();

        escape();
        vi.advanceTimersByTime(500);

        // O modal continua de pé: o Escape era da confirmação, não dele.
        expect(aberto()).toBe(true);

        confirmacao.resolver(false);
        await vi.runAllTimersAsync();
    });

    it('com o reagendamento EM VOO, o Escape não fecha e o fim do await não lança', async () => {
        showConfirm.mockResolvedValue(true);
        const escrita = adiado();
        rescheduleMapTemporal.mockReturnValue(escrita.promessa);

        await comecarReagendamento();
        await Promise.resolve();
        await Promise.resolve();
        expect(rescheduleMapTemporal).toHaveBeenCalled();

        escape();
        vi.advanceTimersByTime(500);
        expect(aberto()).toBe(true);

        // O fim da operação: é aqui que a versão anterior desreferenciava um overlay já nulo.
        escrita.resolver({
            decisao: { gravarOrigem: true, motivo: MOTIVO_REAGENDAMENTO.DESLOCADAS, reagendadas: 2 },
            gravou: true,
        });
        await vi.runAllTimersAsync();

        expect(showSuccess).toHaveBeenCalled();
        expect(aberto()).toBe(false);
    });

    it('terminada a operação, o Escape volta a fechar', async () => {
        showConfirm.mockResolvedValue(false);
        await comecarReagendamento();
        await vi.runAllTimersAsync();

        expect(aberto()).toBe(true);
        escape();
        await vi.runAllTimersAsync();
        expect(aberto()).toBe(false);
    });
});

describe('C12 — `_close` é idempotente e à prova de nulo', () => {
    it('fechar de novo DEPOIS do timer não lança, e não desmonta duas vezes', async () => {
        await abrir();
        const alvo = instancia;
        expect(alvo).toBeTruthy();

        alvo._close();
        await vi.runAllTimersAsync();
        expect(overlay.removido).toBe(true);
        overlay.removido = false;

        // A chamada tardia: exatamente a que vinha do fim de um await depois de um Escape.
        expect(() => alvo._close()).not.toThrow();
        vi.advanceTimersByTime(500);
        expect(overlay.removido).toBe(false);
    });

    it('dois gestos de fechar no MESMO tique agendam um desmonte só', async () => {
        await abrir();
        const alvo = instancia;

        alvo._close();
        alvo._close();
        await vi.runAllTimersAsync();

        // UM desmonte, não dois: a versão anterior agendava um timer POR chamada, porque o campo
        // só era zerado lá dentro. `cleanup` rodando duas vezes ainda deixa o ouvinte fora, então
        // contar ouvinte não discrimina; contar remoções discrimina.
        expect(overlay.remocoes).toBe(1);
        expect(desmontes.contagem).toBe(1);
        expect(globalThis.document._ouvintes).toHaveLength(0);
    });
});

// ============================================================================
// C4 e S2, a metade do modal
// ============================================================================

describe('C4 — salvar não fecha a tela quando a escrita é recusada nem quando a janela é inválida', () => {
    it('janela invertida no modo ABSOLUTO: avisa nomeando o campo, não grava e não fecha', async () => {
        await abrir({ inicio: D + DIA_MS, fim: D });

        disparar(botao(overlay, 'Salvar'), 'click');
        await vi.runAllTimersAsync();

        expect(setMapTemporalConfig).not.toHaveBeenCalled();
        expect(showWarning).toHaveBeenCalledWith(expect.stringContaining('Fim do mapa'));
        expect(aberto()).toBe(true);
    });

    it('recusa da store (`null`): a tela CONTINUA aberta, porque nada foi salvo', async () => {
        // `null` é a recusa esperada por papel e, desde 2026-09-21, por mapa travado. Ela não
        // lança, então o `_save` anterior fechava exatamente como num salvamento bem-sucedido.
        await abrir({ inicio: D, fim: D + DIA_MS });
        setMapTemporalConfig.mockResolvedValue(null);

        disparar(botao(overlay, 'Salvar'), 'click');
        await vi.runAllTimersAsync();

        expect(setMapTemporalConfig).toHaveBeenCalledTimes(1);
        expect(aberto()).toBe(true);
    });

    it('CONTROLE: janela válida e escrita aceita fecham a tela', async () => {
        await abrir({ inicio: D, fim: D + DIA_MS });

        disparar(botao(overlay, 'Salvar'), 'click');
        await vi.runAllTimersAsync();

        expect(setMapTemporalConfig).toHaveBeenCalledWith(MAPA, expect.objectContaining({
            modo: 'absoluto', inicio: D, fim: D + DIA_MS,
        }));
        expect(aberto()).toBe(false);
    });
});

describe('S2 — o modal não grava mais a origem por conta própria', () => {
    it('Reagendar delega a composição e NÃO chama `setMapTemporalConfig`', async () => {
        showConfirm.mockResolvedValue(true);
        rescheduleMapTemporal.mockResolvedValue({
            decisao: { gravarOrigem: false, motivo: MOTIVO_REAGENDAMENTO.RECUSADO, reagendadas: 0 },
            gravou: null,
        });

        await abrir({ modo: 'relativo' });
        const btn = botao(overlay, 'Reagendar');
        const linha = procurar(overlay, (e) => e.children.includes(btn));
        linha.children[0].value = '2026-03-01T00:00';
        disparar(btn, 'click');
        await vi.runAllTimersAsync();

        expect(rescheduleMapTemporal).toHaveBeenCalledWith(MAPA, expect.objectContaining({
            delta: expect.any(Number),
            novaOrigem: new Date('2026-03-01T00:00').getTime(),
        }));
        // A gravação da origem era a linha incondicional do defeito.
        expect(setMapTemporalConfig).not.toHaveBeenCalled();
        // Recusado: avisa e mantém a tela aberta, em vez de fechar como se tivesse reagendado.
        // O aviso é o do ramo RECUSADO do modelo, pela frase inteira, e não mais pela palavra
        // 'recusada', que saiu do texto na reescrita de 2026-09-22. O que a frase tem de dizer
        // continua cobrado: nada andou, nem as feições nem o Dia D, e por quê.
        const recusa = avisoDoReagendamento({
            gravarOrigem: false, motivo: MOTIVO_REAGENDAMENTO.RECUSADO, reagendadas: 0,
        });
        expect(recusa.texto).toContain('Nenhuma feição foi reagendada');
        expect(recusa.texto).toContain('Dia D não mudou');
        expect(recusa.texto).toMatch(/bloqueado|permissão/);
        expect(showWarning).toHaveBeenCalledWith(recusa.texto);
        expect(aberto()).toBe(true);
    });
});
