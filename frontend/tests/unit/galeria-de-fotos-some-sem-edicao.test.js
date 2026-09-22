// Path: tests/unit/galeria-de-fotos-some-sem-edicao.test.js

/**
 * @fileoverview A GALERIA DE FOTOS DA FEIÇÃO NÃO OFERECE ESCRITA A QUEM NÃO PODE EDITAR.
 *
 * O RELATO DO DONO (2026-09-22): "mesmo no modo leitura ou comentário aparece na UI para o cara
 * adicionar imagem numa feição". A causa: `createPhotoGallery` perguntava só pela trava do mapa
 * (`isCurrentMapLockedSync`). Para o Leitor e o Comentarista num atlas de servidor ele desenhava o
 * botão "Adicionar", a lixeira de cada cartão e o cartão "+" da grade. O painel em volta sabia o
 * papel e se marcava `feature-panel--locked`, cujo CSS escondia o botão e a lixeira, mas NÃO o
 * cartão "+", e o cartão abria o seletor de arquivo: a pessoa escolhia a figura e a store a
 * recusava depois.
 *
 * O QUE ESTE ARQUIVO PRENDE:
 *   1. a regra, na folha `photo-gallery-affordance.js`, em forma positiva;
 *   2. a frase de uma resposta de `edicaoIndisponivelSync` (`unavailableEditNotice`), com os dois
 *      vocabulários separados;
 *   3. o COMPONENTE REAL, dirigido sobre um DOM mínimo: somente leitura não constrói nenhum dos
 *      três comandos nem o input de arquivo, e um painel desenhado livre que fica travado depois
 *      recusa o gesto NOMEANDO a trava, antes do seletor e antes da confirmação;
 *   4. a fiação: o painel passa a resposta dele, e o CSS esconde o cartão "+" das galerias do 3D e
 *      do 360, que ainda o constroem.
 *
 * O QUE ELE NÃO ALCANÇA: o pixel (o DOM daqui é um duplo, e a captura é do Playwright) e as
 * galerias do 3D e do 360 além da regra de CSS: elas constroem os comandos e dependem da classe do
 * painel, que `feature-3d-handlers.js` põe pela mesma conta.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    photoGalleryAffordances,
    COMPACT_MAX_VISIBLE,
    ADD_CARD_MAX_IMAGES,
} from '../../src/js/sidebar/components/photo-gallery-affordance.js';
import { unavailableEditNotice, UNKNOWN_DENIAL_TEXT } from '../../src/js/store/denial-phrases.js';

const { LIVRE, POSTO, TRAVA, estado } = vi.hoisted(() => {
    const LIVRE = Object.freeze({ bloqueado: false, motivo: null, required: null });
    const POSTO = Object.freeze({ bloqueado: true, motivo: 'permissao', required: 'canEdit' });
    const TRAVA = Object.freeze({ bloqueado: true, motivo: 'map_locked', required: null });
    // What the doubles answer; each case sets it.
    const estado = { edicao: LIVRE, imagens: [], confirmacoes: 0 };
    return { LIVRE, POSTO, TRAVA, estado };
});

vi.mock('@store/edicao-indisponivel.js', () => ({
    edicaoIndisponivelSync: vi.fn(() => estado.edicao),
    semEdicaoSync: vi.fn(() => estado.edicao.bloqueado),
}));
vi.mock('@store/index.js', () => ({
    getEventBus: () => ({ on: () => () => {} }),
}));
vi.mock('@js/user_data/user_data_manager.js', () => ({
    default: {
        getImages: vi.fn(async () => estado.imagens),
        addImage: vi.fn(async () => null),
        removeImage: vi.fn(async () => true),
        downloadImage: vi.fn(),
    },
}));
vi.mock('@modals/index.js', () => ({
    showConfirm: vi.fn(async () => { estado.confirmacoes++; return true; }),
}));
vi.mock('@utils/index.js', () => ({
    showError: vi.fn(),
    showWarning: vi.fn(),
}));
vi.mock('@utils/image_utils.js', () => ({
    validateImagePayload: vi.fn(async () => ({ valid: true })),
    IMAGE_CONFIG: { allowedTypes: ['image/png', 'image/jpeg'] },
}));

/** Lê um arquivo de `src/` pelo caminho relativo ao pacote. */
const fonte = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Remove comentários, para as asserções estruturais medirem CÓDIGO e não prosa. */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((linha) => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n');
}

// ============================================================================
// 1. A regra
// ============================================================================

describe('1. a regra da galeria', () => {
    it('somente leitura sem figura: a seção inteira some', () => {
        expect(photoGalleryAffordances({ readOnly: true, imageCount: 0 })).toEqual({
            hidden: true, canAdd: false, canRemove: false, showAddCard: false, visibleCount: 0,
        });
    });

    it('somente leitura com figuras: mostra as figuras e nada que escreve', () => {
        expect(photoGalleryAffordances({ readOnly: true, imageCount: 2 })).toEqual({
            hidden: false, canAdd: false, canRemove: false, showAddCard: false, visibleCount: 2,
        });
    });

    it('livre: adicionar, remover e o cartão "+" até o teto', () => {
        for (let n = 0; n <= ADD_CARD_MAX_IMAGES; n++) {
            expect(photoGalleryAffordances({ readOnly: false, imageCount: n }).showAddCard, `n=${n}`).toBe(true);
        }
        const cheia = photoGalleryAffordances({ readOnly: false, imageCount: ADD_CARD_MAX_IMAGES + 1 });
        expect(cheia).toMatchObject({ hidden: false, canAdd: true, canRemove: true, showAddCard: false });
    });

    it('o modo compacto limita as visíveis; o completo mostra todas', () => {
        expect(photoGalleryAffordances({ readOnly: false, imageCount: 9 }).visibleCount).toBe(COMPACT_MAX_VISIBLE);
        expect(photoGalleryAffordances({ readOnly: false, imageCount: 9, compact: false }).visibleCount).toBe(9);
    });

    it('FORMA POSITIVA: bandeira ausente ou malformada conta como somente leitura', () => {
        for (const readOnly of [undefined, null, 'false', 0, {}]) {
            const r = photoGalleryAffordances({ readOnly, imageCount: 1 });
            expect(r.canAdd, String(readOnly)).toBe(false);
            expect(r.canRemove, String(readOnly)).toBe(false);
            expect(r.showAddCard, String(readOnly)).toBe(false);
        }
        expect(photoGalleryAffordances().hidden).toBe(true);
    });

    it('BORDA: contagem que não é número finito positivo vale zero', () => {
        for (const imageCount of [NaN, -3, Infinity, undefined, null, '2']) {
            expect(photoGalleryAffordances({ readOnly: true, imageCount }).hidden, String(imageCount)).toBe(true);
        }
        expect(photoGalleryAffordances({ readOnly: false, imageCount: 2.7 }).visibleCount).toBe(2);
    });
});

// ============================================================================
// 2. A frase
// ============================================================================

describe('2. a frase de uma resposta de edicaoIndisponivelSync', () => {
    it('livre: nenhuma frase', () => {
        expect(unavailableEditNotice(LIVRE)).toBeNull();
    });

    it('POSTO: a frase da CAPACIDADE, nunca a da trava', () => {
        expect(unavailableEditNotice(POSTO)).toBe('Seu nível neste atlas não permite editar.');
    });

    it('ESTADO: a frase que NOMEIA a trava e diz o passo seguinte', () => {
        expect(unavailableEditNotice(TRAVA)).toBe('Mapa bloqueado. Desbloqueie para editar.');
    });

    it('BORDA: resposta ausente ou sem `bloqueado: true` não produz frase', () => {
        for (const r of [undefined, null, {}, { bloqueado: 'true', motivo: 'map_locked' }]) {
            expect(unavailableEditNotice(r), JSON.stringify(r)).toBeNull();
        }
    });

    it('BORDA: estado sem frase, ou chave herdada, cai no texto genérico e nunca numa função', () => {
        expect(unavailableEditNotice({ bloqueado: true, motivo: 'toString', required: null })).toBe(UNKNOWN_DENIAL_TEXT);
        expect(unavailableEditNotice({ bloqueado: true, motivo: 'inventado', required: null })).toBe(UNKNOWN_DENIAL_TEXT);
    });
});

// ============================================================================
// 3. O componente real
// ============================================================================

/** Um elemento de DOM mínimo: o que a galeria usa, e nada mais. */
function elementoFalso(tag) {
    const classes = new Set();
    const el = {
        tagName: String(tag).toUpperCase(),
        children: [],
        className: '',
        listeners: {},
        cliques: 0,
        _html: '',
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
        appendChild(filho) { this.children.push(filho); return filho; },
        addEventListener(tipo, fn) { (this.listeners[tipo] ??= []).push(fn); },
        click() { this.cliques++; },
        remove() {},
    };
    el.classList = {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, force) => {
            const liga = force === undefined ? !classes.has(c) : !!force;
            if (liga) classes.add(c); else classes.delete(c);
            return liga;
        },
        contains: (c) => classes.has(c),
    };
    return el;
}

/** Todo descendente, em profundidade. */
function descendentes(el) {
    return el.children.flatMap((f) => [f, ...descendentes(f)]);
}
const comClasse = (raiz, classe) => descendentes(raiz).filter((e) => e.className.split(/\s+/).includes(classe));
const inputs = (raiz) => descendentes(raiz).filter((e) => e.tagName === 'INPUT');

/** Dispara os ouvintes de um tipo, esperando os assíncronos. */
async function disparar(el, tipo, evento = {}) {
    for (const fn of el.listeners[tipo] ?? []) {
        await fn({ stopPropagation() {}, target: el, ...evento });
    }
}

const figura = (id) => ({ id, name: `${id}.png`, data: `data:image/png;base64,${id}`, thumbnail: null });

describe('3. o componente real, sobre um DOM mínimo', () => {
    let createPhotoGallery;
    let showWarning;
    let userDataManager;

    beforeEach(async () => {
        globalThis.document = {
            createElement: elementoFalso,
            body: elementoFalso('body'),
            addEventListener() {},
            removeEventListener() {},
        };
        estado.edicao = LIVRE;
        estado.imagens = [];
        estado.confirmacoes = 0;
        ({ createPhotoGallery } = await import('../../src/js/sidebar/components/feature-photo-gallery.js'));
        ({ showWarning } = await import('@utils/index.js'));
        ({ default: userDataManager } = await import('@js/user_data/user_data_manager.js'));
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete globalThis.document;
    });

    const montar = (opcoes = {}) => createPhotoGallery({ featureId: 'f1', featureType: 'polygon', compact: true, ...opcoes });

    it('SOMENTE LEITURA com figuras: cartões de leitura, e nenhum comando nem input', async () => {
        estado.imagens = [figura('a'), figura('b')];
        const { element } = await montar({ readOnly: true });
        expect(element.classList.contains('feature-photo-gallery--hidden')).toBe(false);
        expect(comClasse(element, 'feature-photo-gallery-card')).toHaveLength(2);
        expect(comClasse(element, 'feature-photo-gallery-add-btn')).toHaveLength(0);
        expect(comClasse(element, 'feature-photo-gallery-add-card')).toHaveLength(0);
        expect(comClasse(element, 'feature-photo-gallery-delete')).toHaveLength(0);
        expect(inputs(element)).toHaveLength(0);
    });

    it('SOMENTE LEITURA sem figura: a seção some', async () => {
        const { element } = await montar({ readOnly: true });
        expect(element.classList.contains('feature-photo-gallery--hidden')).toBe(true);
        expect(inputs(element)).toHaveLength(0);
    });

    it('CONTROLE: livre, os três comandos e o input existem', async () => {
        estado.imagens = [figura('a')];
        const { element } = await montar({ readOnly: false });
        expect(comClasse(element, 'feature-photo-gallery-add-btn')).toHaveLength(1);
        expect(comClasse(element, 'feature-photo-gallery-add-card')).toHaveLength(1);
        expect(comClasse(element, 'feature-photo-gallery-delete')).toHaveLength(1);
        const [input] = inputs(element);
        expect(input?.className).toBe('feature-photo-gallery__file-input');
    });

    it('sem a bandeira, a galeria pergunta à conta única dos dois eixos', async () => {
        estado.edicao = POSTO;
        estado.imagens = [figura('a')];
        const { element } = await montar();
        expect(comClasse(element, 'feature-photo-gallery-add-card')).toHaveLength(0);
        expect(inputs(element)).toHaveLength(0);
    });

    it('desenhada livre e TRAVADA depois: o "+" recusa nomeando a trava, e o seletor não abre', async () => {
        const { element } = await montar({ readOnly: false });
        const [cartao] = comClasse(element, 'feature-photo-gallery-add-card');
        const [input] = inputs(element);
        estado.edicao = TRAVA;
        await disparar(cartao, 'click');
        expect(showWarning).toHaveBeenCalledWith('Mapa bloqueado. Desbloqueie para editar.');
        expect(input.cliques).toBe(0);
        // CONTROLE: destravado, o mesmo cartão abre o seletor.
        estado.edicao = LIVRE;
        await disparar(cartao, 'click');
        expect(input.cliques).toBe(1);
    });

    it('papel rebaixado depois: a lixeira recusa pela CAPACIDADE, antes da confirmação', async () => {
        estado.imagens = [figura('a')];
        const { element } = await montar({ readOnly: false });
        const [lixeira] = comClasse(element, 'feature-photo-gallery-delete');
        estado.edicao = POSTO;
        await disparar(lixeira, 'click');
        expect(showWarning).toHaveBeenCalledWith('Seu nível neste atlas não permite editar.');
        expect(estado.confirmacoes).toBe(0);
        expect(userDataManager.removeImage).not.toHaveBeenCalled();
    });

    it('a trava que chega com o seletor ABERTO descarta a figura escolhida sem processá-la', async () => {
        const { element } = await montar({ readOnly: false });
        const [input] = inputs(element);
        input.value = 'C:\\fakepath\\foto.png';
        estado.edicao = TRAVA;
        await disparar(input, 'change', { target: { files: [{ name: 'foto.png' }] } });
        expect(userDataManager.addImage).not.toHaveBeenCalled();
        expect(input.value).toBe('');
        expect(showWarning).toHaveBeenCalledWith('Mapa bloqueado. Desbloqueie para editar.');
    });
});

// ============================================================================
// 4. A fiação
// ============================================================================

describe('4. a fiação', () => {
    const galeria = semComentarios(fonte('src/js/sidebar/components/feature-photo-gallery.js'));

    it('a galeria não pergunta mais só pela trava', () => {
        expect(galeria).not.toContain('isCurrentMapLockedSync');
        expect(galeria).toContain("from '@store/edicao-indisponivel.js'");
        expect(galeria).toContain('photoGalleryAffordances(');
    });

    it('o painel entrega à galeria a MESMA resposta que usou para si', () => {
        const painel = semComentarios(fonte('src/js/sidebar/panels/feature-panel-content.js'));
        expect(painel).toContain('const mapLocked = semEdicaoSync();');
        expect(painel).toMatch(/createPhotoGallery\(\{[^}]*readOnly: mapLocked[^}]*\}\)/);
    });

    it('o CSS do painel travado esconde o cartão "+" (as galerias do 3D e do 360 ainda o constroem)', () => {
        const css = fonte('src/css/sidebar.css');
        expect(css).toMatch(/\.feature-panel--locked \.feature-photo-gallery-add-card[\s\S]*?\{\s*display:\s*none;/);
    });
});
