// Path: tests/unit/aviso-nao-cobre-modal.test.js
//
// O AVISO NASCE NO RODAPÉ ENQUANTO HOUVER MODAL ABERTO.
//
// CAUSA-RAIZ que este arquivo prende: `showToast` nascia sempre em `top-center`, a 80 px do topo e
// com 60 px por aviso empilhado, e `--z-toast` (220) está acima de `--z-modal` (60), então o aviso
// desenha POR CIMA do modal. Com o painel de pendências aberto, dois avisos do laço de envio
// (`sync-flush.js`, 8 s cada) cobriam a fileira de contadores e o cabeçalho dele. A captura de B5d
// fotografou os dois balões laranja. O painel havia contornado passando `position` explícito nas
// nove chamadas DELE, o que não alcançava justamente o módulo que o cobria.
//
// O QUE ESTE VERDE PROVA, em duas metades. A pura: quem pede lugar explícito é obedecido, e quem
// não pede recebe o rodapé só quando há modal. A de fiação: `showToast` de fato consulta o DOM e
// carimba o lugar resolvido no elemento (é `dataset.position` que `repositionActiveToasts` relê
// depois, então um carimbo errado reempilharia o aviso no lugar de onde ele saiu).
//
// O QUE ELE NÃO PROVA: que o rodapé seja o lugar certo na tela. Isso é a captura do Playwright, que
// roda fora do `npm test`.
//
// A SEGUNDA METADE DA MESMA CAUSA, medida em 2026-09-15 e prendida aqui desde então: decidir só no
// NASCIMENTO não alcançava o caso da captura. Com o painel aberto, a consulta ao DOM respondia SIM
// (o painel É `.modal-overlay[data-visible="true"]`) e os dois avisos continuavam em 80 px e
// 140 px, porque tinham nascido segundos ANTES, sem modal na tela, e vivem 8 s. Como a pessoa abre
// o painel pela luz de sync justamente PORQUE os avisos apareceram, o aviso que cobre é sempre o
// que antecede o painel: a ordem que uma regra de criação nunca alcança. Daí a revisão enquanto o
// aviso vive, e daí este arquivo ter um bloco por momento, o do nascimento e o da revisão.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveToastPosition, revisaoDePosicoes } from '@utils/toast_service.js';

const SELETOR_DE_MODAL = '.modal-overlay[data-visible="true"]';

/**
 * Dublê mínimo de `document`: o serviço só faz `createElement`, `body.appendChild` e o
 * `querySelector` que responde pela existência de modal aberto.
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.comModal] - Se a consulta pelo overlay visível encontra alguém.
 * @param {boolean} [opcoes.semQuerySelector] - Simula um `document` que não sabe consultar.
 */
function makeDocumentStub({ comModal = false, semQuerySelector = false } = {}) {
    // O modal ABRE E FECHA durante um caso, então o estado é mutável: a revisão só tem o que rever
    // quando a resposta do DOM muda DEPOIS de o aviso já estar na tela, que é o caso da captura.
    const estado = { comModal };
    const body = {
        children: [],
        appendChild(el) { el.parentNode = body; body.children.push(el); return el; },
    };
    const createElement = () => {
        const el = {
            style: {},
            className: '',
            textContent: '',
            dataset: {},
            parentNode: null,
            children: [],
            appendChild(child) { el.children.push(child); return child; },
            setAttribute() { /* role/aria-live: irrelevante aqui */ },
            addEventListener() { /* botão de fechar: idem */ },
            // `classList` de verdade, espelhado em `className`: é assim que o serviço troca o par
            // `toast--top`/`toast--bottom` ao mover um aviso, e um dublê no-op esconderia a troca.
            classList: {
                add(...classes) {
                    const atuais = new Set(el.className.split(' ').filter(Boolean));
                    for (const classe of classes) atuais.add(classe);
                    el.className = [...atuais].join(' ');
                },
                remove(...classes) {
                    const atuais = new Set(el.className.split(' ').filter(Boolean));
                    for (const classe of classes) atuais.delete(classe);
                    el.className = [...atuais].join(' ');
                },
            },
            remove() { el.parentNode = null; },
        };
        return el;
    };
    const doc = {
        body,
        createElement,
        /** Abre ou fecha o modal DEPOIS de o aviso ter nascido. */
        definirModalAberto(aberto) { estado.comModal = aberto; },
    };
    if (!semQuerySelector) {
        doc.querySelector = vi.fn(() => (estado.comModal ? { visivel: true } : null));
    }
    return doc;
}

/**
 * Dublê de `MutationObserver` que guarda a última instância, para o caso disparar o retorno de
 * chamada na hora em que o modal muda de estado (no navegador quem dispara é o DOM).
 */
class ObservadorDeMutacaoFalso {
    /** @type {ObservadorDeMutacaoFalso|null} */
    static ultimo = null;

    constructor(retorno) {
        this.retorno = retorno;
        this.observando = [];
        this.desligado = false;
        ObservadorDeMutacaoFalso.ultimo = this;
    }

    observe(alvo, opcoes) { this.observando.push({ alvo, opcoes }); }

    disconnect() { this.desligado = true; }
}

/**
 * Importa o serviço com estado zerado.
 *
 * A pilha de avisos (`activeToasts`) é módulo-privada e o deslocamento vertical DEPENDE do tamanho
 * dela: sem zerar, o segundo caso deste arquivo mediria 140 px em vez de 80 e o vermelho apontaria
 * para o código em vez de para o teste.
 * @returns {Promise<{showToast: Function}>}
 */
async function carregarServico() {
    vi.resetModules();
    return import('@utils/toast_service.js');
}

let documentoOriginal;
let rafOriginal;
let observadorOriginal;

beforeEach(() => {
    documentoOriginal = globalThis.document;
    rafOriginal = globalThis.requestAnimationFrame;
    observadorOriginal = globalThis.MutationObserver;
    // Sem rAF o serviço nunca marca `toast--visible`; a animação não é o sujeito aqui.
    globalThis.requestAnimationFrame = () => {};
    globalThis.MutationObserver = ObservadorDeMutacaoFalso;
    ObservadorDeMutacaoFalso.ultimo = null;
});

afterEach(() => {
    globalThis.document = documentoOriginal;
    globalThis.requestAnimationFrame = rafOriginal;
    globalThis.MutationObserver = observadorOriginal;
    vi.restoreAllMocks();
});

describe('a decisão pura de onde o aviso nasce', () => {
    it('sem modal aberto o padrão da casa continua sendo o topo', () => {
        expect(resolveToastPosition(undefined, false)).toBe('top-center');
    });

    it('com modal aberto o padrão vira o rodapé', () => {
        expect(resolveToastPosition(undefined, true)).toBe('bottom-center');
    });

    it('pedido explícito vence nos DOIS sentidos, o `top-center` inclusive', () => {
        // Este é o caso que impede a função de virar a segunda autora de todo lugar: quem nomeou um
        // lugar tinha razão para nomeá-lo, e o modal aberto não a revoga.
        expect(resolveToastPosition('top-center', true)).toBe('top-center');
        expect(resolveToastPosition('bottom-right', true)).toBe('bottom-right');
        expect(resolveToastPosition('bottom-center', false)).toBe('bottom-center');
        expect(resolveToastPosition('top-right', false)).toBe('top-right');
    });

    it('borda: valor vazio ou nulo conta como pedido nenhum, não como lugar chamado ""', () => {
        for (const vazio of [undefined, null, '']) {
            expect(resolveToastPosition(vazio, false)).toBe('top-center');
            expect(resolveToastPosition(vazio, true)).toBe('bottom-center');
        }
    });
});

describe('a fiação: `showToast` lê o DOM e carimba o lugar resolvido', () => {
    it('sem modal aberto o aviso nasce no topo, a 80 px', async () => {
        const doc = makeDocumentStub({ comModal: false });
        globalThis.document = doc;
        const { showToast } = await carregarServico();

        const toast = showToast('mensagem', 'info', { duration: 0 });

        expect(doc.querySelector).toHaveBeenCalledWith(SELETOR_DE_MODAL);
        expect(toast.dataset.position).toBe('top-center');
        expect(toast.style.top).toBe('80px');
        expect(toast.className).toContain('toast--top');
    });

    it('com modal aberto o MESMO chamador nasce no rodapé, a 20 px', async () => {
        globalThis.document = makeDocumentStub({ comModal: true });
        const { showToast } = await carregarServico();

        const toast = showToast('mensagem', 'warning', { duration: 0 });

        expect(toast.dataset.position).toBe('bottom-center');
        expect(toast.style.bottom).toBe('20px');
        expect(toast.style.top).toBeUndefined();
        expect(toast.className).toContain('toast--bottom');
        expect(toast.className).toContain('toast--center');
    });

    it('com modal aberto, o lugar explícito do chamador continua valendo', async () => {
        globalThis.document = makeDocumentStub({ comModal: true });
        const { showToast } = await carregarServico();

        const toast = showToast('mensagem', 'info', { duration: 0, position: 'top-center' });

        expect(toast.dataset.position).toBe('top-center');
        expect(toast.style.top).toBe('80px');
    });

    it('`document` que não sabe consultar não impede o aviso: cai no padrão', async () => {
        // A consulta de modal é uma conveniência; ela nunca pode ser a razão de uma mensagem não
        // sair. Vários dublês de `document` deste repositório só têm `createElement` e `body`.
        globalThis.document = makeDocumentStub({ semQuerySelector: true });
        const { showToast } = await carregarServico();

        const toast = showToast('mensagem', 'info', { duration: 0 });

        expect(toast.dataset.position).toBe('top-center');
        expect(toast.style.top).toBe('80px');
    });
});

describe('a decisão pura de rever o aviso JÁ na tela', () => {
    it('quem recebeu o padrão desce quando um modal abre depois dele', () => {
        expect(revisaoDePosicoes([{ pedida: undefined, atual: 'top-center' }], true))
            .toEqual(['bottom-center']);
    });

    it('e volta ao topo quando o modal fecha: a revisão vale nos dois sentidos', () => {
        expect(revisaoDePosicoes([{ pedida: undefined, atual: 'bottom-center' }], false))
            .toEqual(['top-center']);
    });

    it('quem já está no lugar certo devolve `null`, e não a posição atual', () => {
        // O `null` não é estilo: o observador dispara a cada mutação do corpo do documento, e
        // reescrever classe e estilo de todo aviso a cada uma delas é trabalho por nada.
        expect(revisaoDePosicoes([
            { pedida: undefined, atual: 'top-center' },
            { pedida: undefined, atual: 'bottom-center' },
        ], false)).toEqual([null, 'top-center']);
    });

    it('quem pediu lugar NUNCA se move, nem para o rodapé nem de volta', () => {
        const pedidos = [
            { pedida: 'top-center', atual: 'top-center' },
            { pedida: 'bottom-right', atual: 'bottom-right' },
            { pedida: 'top-right', atual: 'top-right' },
        ];
        expect(revisaoDePosicoes(pedidos, true)).toEqual([null, null, null]);
        expect(revisaoDePosicoes(pedidos, false)).toEqual([null, null, null]);
    });

    it('bordas: lista vazia, entrada que não é lista e item sem forma', () => {
        expect(revisaoDePosicoes([], true)).toEqual([]);
        expect(revisaoDePosicoes(undefined, true)).toEqual([]);
        expect(revisaoDePosicoes(null, false)).toEqual([]);
        // Item sem `atual` nenhum: qualquer posição é diferente de `undefined`, então ele é
        // reposicionado em vez de ficar num lugar que ninguém sabe qual é.
        expect(revisaoDePosicoes([{}], true)).toEqual(['bottom-center']);
    });
});

describe('a fiação: o aviso que já estava na tela desce quando o painel abre', () => {
    it('o caso da captura: nasce no topo sem modal e desce quando o modal aparece', async () => {
        const doc = makeDocumentStub({ comModal: false });
        globalThis.document = doc;
        const { showToast } = await carregarServico();

        // O aviso do laço de envio, que nasce ANTES de a pessoa abrir o painel.
        const toast = showToast('Os mesmos campos foram alterados no servidor.', 'warning', { duration: 0 });
        expect(toast.style.top).toBe('80px');
        expect(toast.className).toContain('toast--top');

        // O painel abre: no navegador é o `data-visible` do overlay que dispara o observador.
        doc.definirModalAberto(true);
        ObservadorDeMutacaoFalso.ultimo.retorno();

        expect(toast.dataset.position).toBe('bottom-center');
        expect(toast.style.bottom).toBe('20px');
        expect(toast.style.top).toBe('');
        expect(toast.className).toContain('toast--bottom');
        expect(toast.className).not.toContain('toast--top');
        expect(toast.className).toContain('toast--center');
    });

    it('fechado o modal, o mesmo aviso volta para o topo', async () => {
        const doc = makeDocumentStub({ comModal: false });
        globalThis.document = doc;
        const { showToast } = await carregarServico();
        const toast = showToast('mensagem', 'warning', { duration: 0 });

        doc.definirModalAberto(true);
        ObservadorDeMutacaoFalso.ultimo.retorno();
        doc.definirModalAberto(false);
        ObservadorDeMutacaoFalso.ultimo.retorno();

        expect(toast.dataset.position).toBe('top-center');
        expect(toast.style.top).toBe('80px');
        expect(toast.style.bottom).toBe('');
        expect(toast.className).toContain('toast--top');
    });

    it('o aviso com lugar pedido fica onde o chamador o pôs, com o modal aberto', async () => {
        // É o caso do próprio painel de pendências, que pede o rodapé nas nove chamadas dele: a
        // revisão não pode ser a segunda autora do lugar de ninguém.
        const doc = makeDocumentStub({ comModal: false });
        globalThis.document = doc;
        const { showToast } = await carregarServico();
        const toast = showToast('mensagem', 'info', { duration: 0, position: 'top-center' });

        doc.definirModalAberto(true);
        ObservadorDeMutacaoFalso.ultimo.retorno();

        expect(toast.dataset.position).toBe('top-center');
        expect(toast.style.top).toBe('80px');
    });

    it('a pilha é refeita depois de mover: dois avisos descem sem se sobrepor', async () => {
        const doc = makeDocumentStub({ comModal: false });
        globalThis.document = doc;
        const { showToast } = await carregarServico();
        const primeiro = showToast('primeiro', 'warning', { duration: 0 });
        const segundo = showToast('segundo', 'warning', { duration: 0 });
        expect(primeiro.style.top).toBe('80px');
        expect(segundo.style.top).toBe('140px');

        doc.definirModalAberto(true);
        ObservadorDeMutacaoFalso.ultimo.retorno();

        expect(primeiro.style.bottom).toBe('20px');
        expect(segundo.style.bottom).toBe('80px');
    });

    it('o observador nasce com o aviso, olha o corpo do documento e filtra o atributo do overlay',
        async () => {
            globalThis.document = makeDocumentStub({ comModal: false });
            const { showToast } = await carregarServico();
            expect(ObservadorDeMutacaoFalso.ultimo).toBeNull();

            showToast('mensagem', 'info', { duration: 0 });

            const observador = ObservadorDeMutacaoFalso.ultimo;
            expect(observador).not.toBeNull();
            expect(observador.observando).toHaveLength(1);
            expect(observador.observando[0].alvo).toBe(globalThis.document.body);
            expect(observador.observando[0].opcoes.attributeFilter).toEqual(['data-visible']);
            expect(observador.observando[0].opcoes.subtree).toBe(true);
        });

    it('sem `MutationObserver` o aviso continua nascendo, só não é revisto', async () => {
        // O serviço é importado por costuras que rodam sem DOM: a revisão é um ganho, nunca uma
        // condição para a mensagem sair.
        globalThis.MutationObserver = undefined;
        globalThis.document = makeDocumentStub({ comModal: true });
        const { showToast } = await carregarServico();

        const toast = showToast('mensagem', 'info', { duration: 0 });

        expect(toast.dataset.position).toBe('bottom-center');
        expect(toast.style.bottom).toBe('20px');
    });
});
