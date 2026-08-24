// Path: tests/unit/seus-atlas-sem-servidor.test.js

/**
 * @fileoverview O RELATÓRIO DO VISITANTE DESLOGADO, na parte que mora em `atlas.html` e na tela
 * de bloqueio: seis achados, e o que cada bloco aqui prende.
 *
 * A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA NÃO CAIR: asserir que o código CONSTRÓI um objeto não
 * prova que o objeto CHEGA À TELA. Por isso os três achados cujo alvo é um EFEITO
 * (a recusa que chega antes do diálogo, o estado de falha do registro, a voz do contador) são
 * exercidos MONTANDO `LocalAtlasSection` contra um `document` de mentira e disparando o clique
 * real, e não perguntando à função pura o que ela devolveria. O ambiente aqui é node puro, sem
 * jsdom, e o precedente do dublê mínimo é `tests/unit/import-progress-overlay.test.js`.
 *
 * Os dois achados que são FRASE (o texto do diálogo de exclusão e o eco do `?aviso=`) vivem em
 * `projects-page.js`, que boota no import e não pode ser carregado por um teste: deles se prende a
 * função pura MAIS a fiação, por leitura do arquivo, porque é a fiação que o controle negativo
 * precisa poder apagar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    showError: vi.fn(),
}));

const {
    BlockingCause, blockingScreenContent,
} = await import('../../src/js/ui/blocking-screen-phrases.js');
const {
    deleteAttempt, deleteConfirmMessage, NoticeKind,
} = await import('../../src/js/projects/local-atlas-notices.js');
const {
    LocalAtlasSection, localCountLabel, arrivalNotice, createServerOutage,
} = await import('../../src/js/projects/atlas-drive.js');
const toast = await import('@utils/toast_service.js');

const PAGE_SRC = readFileSync(
    fileURLToPath(new URL('../../src/js/projects/projects-page.js', import.meta.url)), 'utf8'
);

// ============================================================================
// O `document` de mentira. Só o que `LocalAtlasSection` toca de verdade.
// ============================================================================

function makeElement(tag) {
    const listeners = new Map();
    const attrs = new Map();
    const el = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        innerHTML: '',
        title: '',
        hidden: false,
        type: '',
        value: '',
        accept: '',
        files: null,
        style: {},
        dataset: {},
        parentNode: null,
        children: [],
        _listeners: listeners,
        classList: {
            add(...names) { for (const n of names) if (!el.className.split(' ').includes(n)) el.className = `${el.className} ${n}`.trim(); },
            remove(...names) { el.className = el.className.split(' ').filter((c) => c && !names.includes(c)).join(' '); },
            contains(name) { return el.className.split(' ').includes(name); },
        },
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
        removeAttribute(name) { attrs.delete(name); },
        hasAttribute(name) { return attrs.has(name); },
        appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
        append(...nodes) { for (const n of nodes) el.appendChild(n); },
        replaceChildren(...nodes) {
            for (const c of el.children) c.parentNode = null;
            el.children = [];
            for (const n of nodes) el.appendChild(n);
        },
        removeChild(child) {
            const i = el.children.indexOf(child);
            if (i >= 0) el.children.splice(i, 1);
            child.parentNode = null;
            return child;
        },
        remove() { el.parentNode?.removeChild(el); },
        contains(node) {
            if (node === el) return true;
            return el.children.some((c) => c.contains(node));
        },
        getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
        addEventListener(event, handler) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(handler);
        },
        removeEventListener(event, handler) {
            const bucket = listeners.get(event) || [];
            const i = bucket.indexOf(handler);
            if (i >= 0) bucket.splice(i, 1);
        },
        click() { fire(el, 'click'); },
    };
    return el;
}

/** Dispara um evento no dublê, com o mínimo de superfície que os handlers usam. */
function fire(el, event) {
    const evt = { target: el, stopPropagation() {}, preventDefault() {} };
    for (const handler of [...(el._listeners.get(event) || [])]) handler(evt);
}

/** Varre a árvore inteira do dublê procurando um `data-testid`. */
function byTestid(root, testid) {
    if (root?.dataset?.testid === testid) return root;
    for (const child of root?.children || []) {
        const found = byTestid(child, testid);
        if (found) return found;
    }
    return null;
}

/** Todo o texto visível da árvore, concatenado. */
function allText(root) {
    let out = root?.textContent ?? '';
    for (const child of root?.children || []) out += ` ${allText(child)}`;
    return out;
}

function makeDocumentStub() {
    const body = makeElement('body');
    return {
        body,
        createElement: (tag) => makeElement(tag),
        addEventListener() {},
        removeEventListener() {},
    };
}

let originalDocument;
let host;
let mounted;

beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = makeDocumentStub();
    host = globalThis.document.body;
    mounted = [];
    vi.clearAllMocks();
});

afterEach(() => {
    // O menu do cartão arma um `setTimeout` que, disparando depois do teste, leria o `document`
    // real (ou nenhum) e derrubaria a rodada por fora de toda asserção. `destroy` o limpa.
    for (const section of mounted) section.destroy();
    globalThis.document = originalDocument;
});

/** Monta a seção local com callbacks espiões. */
function mountSection(options = {}) {
    const spies = {
        onOpen: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(), onDuplicate: vi.fn(),
        onDelete: vi.fn(), onRetry: vi.fn(),
    };
    const section = new LocalAtlasSection({ max: 10, ...spies, ...options });
    section.mount(host);
    mounted.push(section);
    return { section, spies };
}

const atlasN = (n) => Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`, name: `Atlas ${i}`, createdAt: i, updatedAt: i,
}));

// ============================================================================
// A1, metade 1 — a tela de bloqueio não dizia que o trabalho local está a salvo
// ============================================================================

describe('A1 — a tela de rede tranquiliza sobre o que é deste navegador', () => {
    it('SERVER_UNREACHABLE diz que os atlas deste navegador continuam intactos', () => {
        const { message } = blockingScreenContent(BlockingCause.SERVER_UNREACHABLE);
        expect(message).toMatch(/neste navegador/i);
        expect(message).toMatch(/intactos/i);
    });

    it('e continua dizendo o que sempre disse, que é o que a causa dela exige', () => {
        // O texto antigo é PREFIXO do novo: o e2e procura "EBGeo indisponível" e este arquivo
        // procurava "Verifique sua conexão". Acrescentar não pode ter custado nenhum dos dois.
        const { message, title } = blockingScreenContent(BlockingCause.SERVER_UNREACHABLE);
        expect(title).toBe('EBGeo indisponível');
        expect(message).toMatch(/Não foi possível conectar ao servidor\. Verifique sua conexão/);
    });

    it('CONTROLE NEGATIVO: a frase é da causa de REDE, não uma linha colada em toda tela', () => {
        // Sem esta asserção, uma implementação que concatenasse a garantia no fim de TODA tela
        // passaria verde, e a tela de erro de aplicação passaria a falar de servidor fora quando
        // o servidor respondeu.
        const { message } = blockingScreenContent(BlockingCause.APP_ERROR);
        expect(message).not.toMatch(/neste navegador/i);
        expect(message).not.toMatch(/intactos/i);
    });
});

// ============================================================================
// A1, metade 2 — sem servidor, atlas.html desenha a metade local
// ============================================================================

describe('A1 — sem `/api/config`, a página não vira a tela de bloqueio', () => {
    it('o ramo de config falhada chama `renderWithoutServer`, não `showUnavailableScreen`', () => {
        const inicio = PAGE_SRC.indexOf('if (!(await bootConfig()))');
        expect(inicio, 'o ramo de config falhada sumiu do arquivo').toBeGreaterThan(-1);
        const ramo = PAGE_SRC.slice(inicio, inicio + 200);
        expect(ramo).toContain('renderWithoutServer()');
        expect(ramo).not.toContain('showUnavailableScreen');
    });

    it('`renderWithoutServer` monta o aviso de servidor E a seção local', () => {
        const corpo = PAGE_SRC.slice(
            PAGE_SRC.indexOf('async function renderWithoutServer()'),
            PAGE_SRC.indexOf('Boots the "Seus atlas" page')
        );
        expect(corpo).toContain('createServerOutage(');
        expect(corpo).toContain('buildLocalSection(');
        expect(corpo).toContain('localSection.mount(');
        // O que ele NÃO pode fazer: encenar contra um servidor que não responde.
        expect(corpo).not.toContain('restoreSession(');
        expect(corpo).not.toContain('createServerInvite(');
        expect(corpo).not.toContain('startIdleWatch(');
        expect(corpo).not.toContain('startPresenceRefresh(');
    });

    it('`showUnavailableScreen` continua sendo o caminho do ERRO DE APLICAÇÃO', () => {
        // A distinção é o achado anterior desta mesma tela, e desfazê-la aqui seria pagar A1
        // com o defeito que a tela de duas causas fechou.
        expect(PAGE_SRC).toContain('showUnavailableScreen(BlockingCause.APP_ERROR)');
    });

    it('o bloco de servidor fora nomeia o que caiu e NÃO oferece "Entrar"', () => {
        const onRetry = vi.fn();
        const node = createServerOutage({ onRetry });
        const texto = allText(node);
        expect(texto).toMatch(/servidor não respondeu/i);
        expect(texto).toMatch(/neste navegador/i);
        // O convite de sessão (`createServerInvite`) oferece "Entrar", e é exatamente o que aqui
        // não funciona: oferecê-lo seria prometer o que a página não pode cumprir.
        expect(texto).not.toMatch(/\bEntrar\b/);
        const retry = byTestid(node, 'server-outage-retry');
        expect(retry).not.toBeNull();
        fire(retry, 'click');
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

// ============================================================================
// M7 — falha ao ler o registro local era indistinguível de "você não tem nada"
// ============================================================================

describe('M7 — o registro ilegível tem estado próprio, não a grade vazia', () => {
    it('EFEITO: com `atlases: null` a grade desenha o erro e NÃO a peça de criação', () => {
        const { section } = mountSection({ atlases: null });
        const grid = byTestid(section._root, 'local-atlas-list');
        expect(byTestid(grid, 'local-atlas-load-error')).not.toBeNull();
        // A metade que prende: o convite a criar por cima de um registro não lido tem de sumir.
        expect(byTestid(grid, 'local-atlas-create')).toBeNull();
        expect(allText(grid)).toMatch(/continuam/i);
    });

    it('EFEITO: o botão de tentar de novo está na tela e chama de volta a página', () => {
        const { section, spies } = mountSection({ atlases: null });
        const retry = byTestid(section._root, 'local-atlas-retry');
        expect(retry).not.toBeNull();
        fire(retry, 'click');
        expect(spies.onRetry).toHaveBeenCalledTimes(1);
    });

    it('o contador CALA no estado de falha, em vez de dizer "0 de 10"', () => {
        const { section } = mountSection({ atlases: null });
        const count = byTestid(section._root, 'local-atlas-count');
        expect(count.textContent).toBe('');
        expect(count.hidden).toBe(true);
    });

    it('CONTROLE NEGATIVO: a lista VAZIA continua desenhando a peça de criação', () => {
        // Sem este caso, um `_render` que caísse no estado de falha para toda lista curta
        // passaria verde e trocaria um defeito pelo oposto.
        const { section } = mountSection({ atlases: [] });
        const grid = byTestid(section._root, 'local-atlas-list');
        expect(byTestid(grid, 'local-atlas-create')).not.toBeNull();
        expect(byTestid(grid, 'local-atlas-load-error')).toBeNull();
    });

    it('uma nova tentativa que falha VOLTA ao estado de falha, não à lista vazia', () => {
        const { section } = mountSection({ atlases: [] });
        section.setAtlases(null, null);
        expect(byTestid(section._root, 'local-atlas-load-error')).not.toBeNull();
        expect(byTestid(section._root, 'local-atlas-create')).toBeNull();
    });

    it('a página trata o registro ilegível como `null` e liga o botão a uma nova leitura', () => {
        expect(PAGE_SRC).toContain('let local = { atlases: null, currentId: null };');
        expect(PAGE_SRC).toContain('onRetry: () => retryLocalAtlases()');
        expect(PAGE_SRC).toContain('localSection?.setAtlases(null, null)');
    });
});

// ============================================================================
// M10 — excluir o único atlas encenava uma confirmação destrutiva já recusada
// ============================================================================

describe('M10 — a recusa do único atlas chega ANTES do diálogo destrutivo', () => {
    /** Abre o menu do primeiro cartão e devolve o item "Excluir". */
    function openDeleteItem(section) {
        const menuBtn = byTestid(section._root, 'local-atlas-menu');
        fire(menuBtn, 'click');
        return byTestid(section._root, 'local-atlas-delete');
    }

    it('EFEITO: com UM atlas, o clique recusa e a página nunca é chamada', () => {
        const { section, spies } = mountSection({ atlases: atlasN(1) });
        const item = openDeleteItem(section);
        expect(item).not.toBeNull();
        fire(item, 'click');
        expect(spies.onDelete).not.toHaveBeenCalled();
        expect(toast.showWarning).toHaveBeenCalledTimes(1);
        expect(toast.showWarning.mock.calls[0][0]).toMatch(/único atlas local/i);
    });

    it('EFEITO: o item CONTINUA desenhado e clicável, com `aria-disabled` e sem `disabled`', () => {
        // O contrato de afordância da casa: bloqueio por ESTADO desenha o comando e recusa o
        // clique nomeando o estado; a propriedade `disabled` mataria o clique, que é o portador.
        const { section } = mountSection({ atlases: atlasN(1) });
        const item = openDeleteItem(section);
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.disabled).toBeUndefined();
        expect(item.textContent).toBe('Excluir');
    });

    it('CONTROLE NEGATIVO: com DOIS atlas, o clique passa direto para a página', () => {
        // Sem este caso, um gate que recusasse sempre passaria verde e quebraria a exclusão.
        const { section, spies } = mountSection({ atlases: atlasN(2) });
        const item = openDeleteItem(section);
        expect(item.getAttribute('aria-disabled')).toBeNull();
        fire(item, 'click');
        expect(spies.onDelete).toHaveBeenCalledTimes(1);
        expect(toast.showWarning).not.toHaveBeenCalled();
    });

    it('a decisão é pura e falha ABERTO quando não sabe contar', () => {
        expect(deleteAttempt(1).allowed).toBe(false);
        expect(deleteAttempt(1).notice.kind).toBe(NoticeKind.WARNING);
        expect(deleteAttempt(0).allowed).toBe(false);
        expect(deleteAttempt(2)).toEqual({ allowed: true, notice: null });
        // A autoridade é a API, que refaz a checagem: travar por não saber contar tiraria da
        // pessoa uma operação legítima para proteger uma que já está protegida.
        for (const lixo of [undefined, null, NaN, Infinity, '3', {}]) {
            expect(deleteAttempt(lixo).allowed, String(lixo)).toBe(true);
        }
    });
});

// ============================================================================
// B2 — o teto de dez só se anunciava depois de digitar o nome
// ============================================================================

describe('B2 — o contador ganhou voz perto do teto', () => {
    it('EFEITO: no teto, o contador da tela diz que é o limite e carrega o reforço', () => {
        const { section } = mountSection({ atlases: atlasN(10) });
        const count = byTestid(section._root, 'local-atlas-count');
        expect(count.textContent).toMatch(/limite atingido/i);
        expect(count.title).toMatch(/Exclua um atlas/i);
        expect(count.className).toContain('local-atlas__count--full');
    });

    it('EFEITO: a um passo do teto, ele diz quanto resta', () => {
        const { section } = mountSection({ atlases: atlasN(9) });
        expect(byTestid(section._root, 'local-atlas-count').textContent).toMatch(/resta 1/);
    });

    it('EFEITO: a peça de criação CONTINUA viva no teto, e nunca desabilitada', () => {
        // O argumento de `_createTile` não se desfaz: a recusa da API explica o que fazer, e um
        // botão morto não explica nada.
        const { section, spies } = mountSection({ atlases: atlasN(10) });
        const tile = byTestid(section._root, 'local-atlas-create');
        expect(tile).not.toBeNull();
        expect(tile.disabled).toBeUndefined();
        expect(tile.getAttribute('aria-disabled')).toBeNull();
        fire(tile, 'click');
        expect(spies.onCreate).toHaveBeenCalledTimes(1);
    });

    it('CONTROLE NEGATIVO: longe do teto o contador NÃO grita, e é o mesmo par de números', () => {
        // Sem isto, um contador que dissesse "limite atingido" sempre passaria verde.
        const { section } = mountSection({ atlases: atlasN(3) });
        const count = byTestid(section._root, 'local-atlas-count');
        expect(count.textContent).toBe('3 de 10');
        expect(count.className).toBe('local-atlas__count');
    });

    it('a tabela pura, incluindo o teto desconhecido', () => {
        expect(localCountLabel({ count: 0, max: 10 }).text).toBe('0 de 10');
        expect(localCountLabel({ count: 8, max: 10 }).text).toMatch(/restam 2/);
        expect(localCountLabel({ count: 8, max: 10 }).nearCeiling).toBe(true);
        expect(localCountLabel({ count: 7, max: 10 }).nearCeiling).toBe(false);
        expect(localCountLabel({ count: 10, max: 10 }).atCeiling).toBe(true);
        // Teto que não é número: volta a ser só a contagem, SEM voz, porque um limite que
        // ninguém mediu não se anuncia.
        expect(localCountLabel({ count: 4 })).toEqual({
            text: '4', title: '', nearCeiling: false, atCeiling: false,
        });
        expect(localCountLabel()).toEqual({
            text: '0', title: '', nearCeiling: false, atCeiling: false,
        });
    });
});

// ============================================================================
// B4 — a confirmação falava de servidor a quem não tem conta
// ============================================================================

describe('B4 — o diálogo de exclusão só cita o servidor a quem tem conta', () => {
    it('o anônimo não ouve falar de servidor, e ouve a mesma perda', () => {
        const anonimo = deleteConfirmMessage({ signedIn: false });
        expect(anonimo).not.toMatch(/servidor/i);
        expect(anonimo).toMatch(/apagados deste navegador/);
        expect(anonimo).toMatch(/Não há como desfazer/);
    });

    it('CONTROLE NEGATIVO: quem tem sessão CONTINUA ouvindo, porque para ele é fato', () => {
        // A fila de saída de um atlas morre com os bancos dele, e ninguém suspeita disso.
        const logado = deleteConfirmMessage({ signedIn: true });
        expect(logado).toMatch(/ainda não enviado ao servidor/);
    });

    it('sem argumento nenhum, cai no lado do anônimo', () => {
        expect(deleteConfirmMessage()).toBe(deleteConfirmMessage({ signedIn: false }));
    });

    it('a página usa a função e não guarda mais o texto', () => {
        // O CAMINHO, e não a construção: se alguém reescrever a frase inline no `showConfirm`,
        // a função pura continua certa e este bloco é o único que fica vermelho.
        expect(PAGE_SRC).toContain('deleteConfirmMessage({ signedIn: sessionContext.isAuthenticated() })');
        expect(PAGE_SRC).not.toContain('ainda não enviado ao servidor. Não há como desfazer');
    });
});

// ============================================================================
// B6 — o `?aviso=` era ecoado sem checar sessão
// ============================================================================

describe('B6 — a frase de chegada exige sessão', () => {
    it('o anônimo não é informado sobre o proprietário de um atlas que nunca teve', () => {
        expect(arrivalNotice('excluido-por-outro', { signedIn: false })).toBeNull();
        expect(arrivalNotice('excluido', { signedIn: false })).toBeNull();
        expect(arrivalNotice('excluido-por-outro')).toBeNull();
    });

    it('CONTROLE NEGATIVO: com sessão as duas frases continuam chegando', () => {
        // Sem isto, um `return null` incondicional passaria verde e engoliria o aviso que o
        // mapa manda quando o atlas aberto é excluído debaixo da pessoa.
        expect(arrivalNotice('excluido', { signedIn: true })).toBe('Atlas excluído.');
        expect(arrivalNotice('excluido-por-outro', { signedIn: true }))
            .toBe('Este atlas foi excluído pelo proprietário.');
    });

    it('código desconhecido nunca é ecoado, com sessão ou sem', () => {
        for (const codigo of ['<script>', 'inventado', '', null, undefined, 7]) {
            expect(arrivalNotice(codigo, { signedIn: true }), String(codigo)).toBeNull();
        }
    });

    it('a página passa a sessão e não guarda mais a tabela', () => {
        // A CHAMADA, não a declaração. `explainArrivalFromUrl(signedIn)` sem o ponto e vírgula
        // casa com `function explainArrivalFromUrl(signedIn) {`, e uma asserção que a assinatura
        // satisfaz sozinha é cobertura vazia: ela passava verde com o chamador passando `true`.
        expect(PAGE_SRC).toContain('\n    explainArrivalFromUrl(signedIn);');
        expect(PAGE_SRC).toContain('arrivalNotice(notice, { signedIn })');
        expect(PAGE_SRC).not.toContain('ARRIVAL_NOTICES');
        expect(PAGE_SRC).not.toContain('excluído pelo proprietário');
    });
});
