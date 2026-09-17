// Path: tests/unit/copiar-ao-clicar.test.js
/**
 * @fileoverview CLICAR NA COORDENADA E JÁ COPIAR, num gesto só para as três telas.
 *
 * O PEDIDO (dono, 2026-09-17): "vamos botar no painel do ponto do 360 clicar na coordenada e já
 * copiar". O gesto já existia em DOIS lugares, a seção "Localização" do painel de feição (2D) e o
 * painel do ponto 3D, cada um com a sua cópia das mesmas duas funções, idênticas linha a linha. O
 * 360 seria a terceira, então o gesto virou módulo e as duas cópias foram apagadas.
 *
 * O AMBIENTE AQUI É NODE PURO, sem jsdom, que é o arranjo da suíte: o DOM é um duplo mínimo que
 * registra ouvintes de verdade, para o clique e a tecla poderem ser disparados. O que ele NÃO
 * mede é pintura, e isso está dito onde importa.
 *
 * OS TRÊS DEFEITOS QUE AS CÓPIAS TINHAM, e que cada bloco abaixo prende:
 *   1. o teclado não alcançava o valor (só havia ouvinte de clique, e nem `tabindex` havia);
 *   2. o clique duplo dentro da janela de 1500 ms deixava a palavra "Copiado!" na linha PARA
 *      SEMPRE, porque o segundo feedback guardava a palavra como se fosse o valor;
 *   3. o desfecho da escrita era engolido: as duas vias podiam falhar e a tela dizia "Copiado!"
 *      do mesmo jeito.
 * O terceiro tem o controle explícito: o caso "as duas vias falham" exige que a linha NÃO minta.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// O DOM mínimo: só o que o módulo toca, com ouvintes de verdade.
// ---------------------------------------------------------------------------

function makeElement(tagName) {
    const classes = new Set();
    const el = {
        tagName,
        textContent: '',
        title: '',
        value: '',
        style: {},
        attributes: {},
        __ouvintes: [],
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
        },
        setAttribute(nome, valor) { el.attributes[nome] = String(valor); },
        getAttribute(nome) { return el.attributes[nome]; },
        addEventListener(tipo, fn) { el.__ouvintes.push({ tipo, fn }); },
        removeEventListener(tipo, fn) {
            el.__ouvintes = el.__ouvintes.filter((o) => !(o.tipo === tipo && o.fn === fn));
        },
        select() { el.__selecionado = true; },
    };
    return el;
}

const corpo = { filhos: [], appendChild(f) { corpo.filhos.push(f); return f; }, removeChild(f) { corpo.filhos = corpo.filhos.filter((x) => x !== f); } };

const documentoOriginal = globalThis.document;
const navegadorOriginal = globalThis.navigator;

globalThis.document = {
    createElement: makeElement,
    body: corpo,
    execCommand: () => true,
};

/**
 * Troca o `navigator` do ambiente.
 *
 * ATRIBUIR NÃO FUNCIONA: no Node ele é uma propriedade só de leitura do `globalThis`, e
 * `globalThis.navigator = X` morre em "Cannot set property navigator of #<Object> which has only a
 * getter". Redefinir é o caminho, e é por isso que o duplo passa por aqui.
 * @param {Object|undefined} valor
 */
function porNavegador(valor) {
    Object.defineProperty(globalThis, 'navigator', { value: valor, configurable: true, writable: true });
}

afterAll(() => {
    if (documentoOriginal === undefined) delete globalThis.document;
    else globalThis.document = documentoOriginal;
    porNavegador(navegadorOriginal);
});

const { copiarTexto, mostrarCopiado, copiarAoClicar } = await import('../../src/js/utilities/copiar-ao-clicar.js');

/** Dispara os ouvintes daquele tipo, e devolve o evento para conferir o que foi feito com ele. */
function disparar(el, tipo, dados = {}) {
    let rolagemImpedida = false;
    const evento = { preventDefault() { rolagemImpedida = true; }, stopPropagation() {}, ...dados };
    const promessas = [];
    for (const { tipo: t, fn } of el.__ouvintes) if (t === tipo) promessas.push(fn(evento));
    return { rolagemImpedida, pronto: Promise.all(promessas) };
}

/** Deixa a cadeia de promessas do acionamento chegar ao fim. */
const assentar = () => new Promise((resolve) => { setTimeout(resolve, 0); });

let escritas;
beforeEach(() => {
    escritas = [];
    corpo.filhos = [];
    porNavegador({ clipboard: { writeText: async (t) => { escritas.push(t); } } });
    globalThis.document.execCommand = () => { escritas.push('(execCommand)'); return true; };
});

afterEach(() => {
    vi.useRealTimers();
});

describe('copiarTexto: as duas vias, e o desfecho dito em voz alta', () => {
    it('usa a área de transferência quando ela existe', async () => {
        expect(await copiarTexto('-30.031805, -51.235408')).toBe(true);
        expect(escritas).toEqual(['-30.031805, -51.235408']);
    });

    it('cai para o textarea quando o contexto não é seguro (sem `navigator.clipboard`)', async () => {
        // É o caso do app servido por `http://<ip>` na rede do quartel: a API simplesmente não
        // está lá, e é por isso que a via obsoleta continua no código.
        porNavegador({});
        expect(await copiarTexto('abc')).toBe(true);
        expect(escritas).toEqual(['(execCommand)']);
        // E não deixa lixo no corpo do documento.
        expect(corpo.filhos).toHaveLength(0);
    });

    it('cai para o textarea quando a escrita é RECUSADA (permissão, aba sem foco)', async () => {
        porNavegador({ clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } });
        expect(await copiarTexto('abc')).toBe(true);
        expect(escritas).toEqual(['(execCommand)']);
    });

    it('devolve false quando as DUAS vias falham', async () => {
        porNavegador({ clipboard: { writeText: async () => { throw new Error('não'); } } });
        globalThis.document.execCommand = () => false;
        expect(await copiarTexto('abc')).toBe(false);
    });

    it('recusa o que não é texto, em vez de copiar vazio', async () => {
        expect(await copiarTexto('')).toBe(false);
        expect(await copiarTexto(null)).toBe(false);
        expect(escritas).toEqual([]);
    });
});

describe('o feedback devolve o valor, e o clique duplo não o congela', () => {
    it('mostra "Copiado!" e devolve o texto original depois', () => {
        vi.useFakeTimers();
        const el = makeElement('span');
        el.textContent = '-30.031805, -51.235408';

        mostrarCopiado(el);
        expect(el.textContent).toBe('Copiado!');
        expect(el.classList.contains('copied')).toBe(true);

        vi.advanceTimersByTime(1500);
        expect(el.textContent).toBe('-30.031805, -51.235408');
        expect(el.classList.contains('copied')).toBe(false);
    });

    it('O DEFEITO DAS CÓPIAS: dois cliques seguidos não deixam "Copiado!" para sempre', () => {
        // A implementação antiga guardava `element.textContent` a cada chamada, então a segunda
        // guardava a própria palavra de feedback e a devolvia 1500 ms depois. A linha ficava com
        // "Copiado!" no lugar da coordenada, sem erro nenhum.
        vi.useFakeTimers();
        const el = makeElement('span');
        el.textContent = '-30.031805, -51.235408';

        mostrarCopiado(el);
        vi.advanceTimersByTime(300);
        mostrarCopiado(el);

        vi.advanceTimersByTime(1500);
        expect(el.textContent).toBe('-30.031805, -51.235408');
        expect(el.classList.contains('copied')).toBe(false);
    });

    it('CONTROLE: a implementação ANTIGA, rodada aqui, congela a linha', () => {
        // O pior caso que a régua acima existe para pegar, escrito como ele era. Sem este caso,
        // ninguém sabe se o de cima estaria passando também sobre o código velho.
        vi.useFakeTimers();
        const antiga = (element) => {
            const originalText = element.textContent;
            element.textContent = 'Copiado!';
            setTimeout(() => { element.textContent = originalText; }, 1500);
        };
        const el = makeElement('span');
        el.textContent = '-30.031805, -51.235408';

        antiga(el);
        vi.advanceTimersByTime(300);
        antiga(el);
        vi.advanceTimersByTime(1500);

        expect(el.textContent).toBe('Copiado!');
    });
});

describe('copiarAoClicar: o ponteiro, o teclado e o que se copia', () => {
    it('o clique copia o valor e a linha confirma', async () => {
        const el = makeElement('span');
        el.textContent = 'Foto: -30.031805, -51.235408';
        copiarAoClicar(el, '-30.031805, -51.235408');

        disparar(el, 'click');
        await assentar();

        // O QUE SE COPIA NÃO É O QUE SE MOSTRA: a linha do 360 traz o rótulo "Foto:", e o que
        // serve para colar é só o par de números.
        expect(escritas).toEqual(['-30.031805, -51.235408']);
        expect(el.textContent).toBe('Copiado!');
    });

    it('anuncia-se como comando e entra na ordem de tabulação', () => {
        const el = makeElement('span');
        el.textContent = '-30.0, -51.2';
        copiarAoClicar(el, '-30.0, -51.2');

        expect(el.getAttribute('role')).toBe('button');
        expect(el.getAttribute('tabindex')).toBe('0');
        expect(el.title).toBe('Clique para copiar');
        expect(el.classList.contains('feature-location-text--clickable')).toBe(true);
        expect(el.getAttribute('aria-label')).toContain('-30.0, -51.2');
    });

    it('Enter e Espaço copiam, e a barra de espaço não rola a página', async () => {
        const el = makeElement('span');
        copiarAoClicar(el, 'valor');

        const comEnter = disparar(el, 'keydown', { key: 'Enter' });
        await assentar();
        expect(escritas).toEqual(['valor']);
        expect(comEnter.rolagemImpedida).toBe(true);

        const comEspaco = disparar(el, 'keydown', { key: ' ' });
        await assentar();
        expect(escritas).toEqual(['valor', 'valor']);
        expect(comEspaco.rolagemImpedida).toBe(true);
    });

    it('as outras teclas passam adiante, e a tabulação continua tabulando', async () => {
        const el = makeElement('span');
        copiarAoClicar(el, 'valor');

        const comTab = disparar(el, 'keydown', { key: 'Tab' });
        await assentar();
        expect(escritas).toEqual([]);
        expect(comTab.rolagemImpedida).toBe(false);
    });

    it('o valor pode ser uma FUNÇÃO, para o que muda com o tempo', async () => {
        const el = makeElement('span');
        let atual = 'primeiro';
        copiarAoClicar(el, () => atual);

        disparar(el, 'click');
        await assentar();
        atual = 'segundo';
        disparar(el, 'click');
        await assentar();

        expect(escritas).toEqual(['primeiro', 'segundo']);
    });

    it('A LINHA NÃO MENTE: falhando as duas vias, nada de "Copiado!"', async () => {
        porNavegador({ clipboard: { writeText: async () => { throw new Error('não'); } } });
        globalThis.document.execCommand = () => false;
        const el = makeElement('span');
        el.textContent = '-30.0, -51.2';
        const desfechos = [];
        copiarAoClicar(el, '-30.0, -51.2', { aoCopiar: (ok) => desfechos.push(ok) });

        disparar(el, 'click');
        await assentar();

        expect(desfechos).toEqual([false]);
        expect(el.textContent).toBe('-30.0, -51.2');
        expect(el.classList.contains('copied')).toBe(false);
    });

    it('o desfazer solta os dois ouvintes', async () => {
        const el = makeElement('span');
        const desfazer = copiarAoClicar(el, 'valor');
        expect(el.__ouvintes).toHaveLength(2);

        desfazer();
        expect(el.__ouvintes).toHaveLength(0);
        disparar(el, 'click');
        await assentar();
        expect(escritas).toEqual([]);
    });
});
