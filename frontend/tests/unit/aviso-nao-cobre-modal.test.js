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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveToastPosition } from '@utils/toast_service.js';

const SELETOR_DE_MODAL = '.modal-overlay[data-visible="true"]';

/**
 * Dublê mínimo de `document`: o serviço só faz `createElement`, `body.appendChild` e o
 * `querySelector` que responde pela existência de modal aberto.
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.comModal] - Se a consulta pelo overlay visível encontra alguém.
 * @param {boolean} [opcoes.semQuerySelector] - Simula um `document` que não sabe consultar.
 */
function makeDocumentStub({ comModal = false, semQuerySelector = false } = {}) {
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
            classList: { add() {}, remove() {} },
            remove() { el.parentNode = null; },
        };
        return el;
    };
    const doc = { body, createElement };
    if (!semQuerySelector) doc.querySelector = vi.fn(() => (comModal ? { visivel: true } : null));
    return doc;
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

beforeEach(() => {
    documentoOriginal = globalThis.document;
    rafOriginal = globalThis.requestAnimationFrame;
    // Sem rAF o serviço nunca marca `toast--visible`; a animação não é o sujeito aqui.
    globalThis.requestAnimationFrame = () => {};
});

afterEach(() => {
    globalThis.document = documentoOriginal;
    globalThis.requestAnimationFrame = rafOriginal;
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
