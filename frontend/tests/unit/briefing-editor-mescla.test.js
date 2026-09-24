// Path: tests/unit/briefing-editor-mescla.test.js

/**
 * @fileoverview A MESCLA DE TRES VIAS DO EDITOR DE BRIEFING, em node.
 *
 * O editor segura uma copia do briefing em memoria e a gravava INTEIRA; a store derivava as ops de
 * slide pela diferenca contra o disco, e o slide que um colega criou depois da abertura virava um
 * DELETE no servidor (medido com duas browsers em
 * `frontend/tests/e2e-ui/briefing-editor-copia-velha.repro.spec.js`). Aqui se prendem as duas
 * metades puras do conserto: o que o editor manda gravar (`diffBriefingEdits`, so o que a pessoa
 * mudou) e como a copia dele absorve o disco (`rebaseBriefingEdits`, sem perder a edicao ainda nao
 * gravada nem trocar o OBJETO de slide que o formulario segura).
 *
 * O caso que a captura de navegador nao alcanca e o da JANELA do autosave: a op do colega chega
 * enquanto a edicao da pessoa ainda esta so em memoria. E ele que exige a diferenca campo a campo, e
 * nao so a releitura.
 */

import { describe, it, expect } from 'vitest';
import { diffBriefingEdits, rebaseBriefingEdits } from '../../src/js/store/briefing.operations.js';
import { deepClone } from '../../src/js/utilities/deep-utils.js';

const slide = (id, extra = {}) => ({
    id, order: 0, title: '', content: '', mode: '2d', mapId: null,
    position: { longitude: null, latitude: null, zoom: null, altitude: null },
    sync: { version: 1 }, ...extra,
});

const briefing = (slides, extra = {}) => ({
    id: 'b1', name: 'Plano', description: '', settings: { panelPosition: 'left', panelWidth: 350 },
    slides: slides.map((s, i) => ({ ...s, order: i })), sync: { version: 1 }, createdAt: 1, updatedAt: 1, ...extra,
});

describe('diffBriefingEdits', () => {
    it('sem edicao, o patch e vazio', () => {
        const base = briefing([slide('s1', { title: 'Um' })]);
        expect(diffBriefingEdits(deepClone(base), base)).toEqual({ fields: {}, slides: {}, empty: true });
    });

    it('so o campo mudado viaja, nunca a lista de slides inteira', () => {
        const base = briefing([slide('s1', { title: 'Um', content: '<p>a</p>' }), slide('s2', { title: 'Dois' })]);
        const memory = deepClone(base);
        memory.name = 'Plano B';
        memory.slides[1].title = 'Dois (B)';
        const patch = diffBriefingEdits(memory, base);
        expect(patch.empty).toBe(false);
        expect(patch.fields).toEqual({ name: 'Plano B' });
        expect(patch.slides).toEqual({ s2: { title: 'Dois (B)' } });
    });

    it('settings viaja chave por chave', () => {
        const base = briefing([]);
        const memory = deepClone(base);
        memory.settings.panelWidth = 400;
        expect(diffBriefingEdits(memory, base).fields).toEqual({ settings: { panelWidth: 400 } });
    });

    it('identidade, ordem e sincronia nunca sao patch', () => {
        const base = briefing([slide('s1')]);
        const memory = deepClone(base);
        memory.slides[0].order = 7;
        memory.slides[0].sync = { version: 9 };
        memory.sync = { version: 9 };
        memory.updatedAt = 99;
        expect(diffBriefingEdits(memory, base).empty).toBe(true);
    });

    it('um objeto aninhado mudado viaja inteiro sob a chave dele', () => {
        const base = briefing([slide('s1')]);
        const memory = deepClone(base);
        memory.slides[0].position.zoom = 12;
        expect(diffBriefingEdits(memory, base).slides.s1.position).toEqual({ longitude: null, latitude: null, zoom: 12, altitude: null });
    });

    it('um valor que passa a undefined e reportado (e nao some da comparacao)', () => {
        const base = briefing([slide('s1', { photoId: 'p' })]);
        const memory = deepClone(base);
        delete memory.slides[0].photoId;
        expect(diffBriefingEdits(memory, base).slides).toEqual({ s1: { photoId: undefined } });
    });

    it('entradas nulas nao quebram', () => {
        expect(diffBriefingEdits({ slides: [] }, null).empty).toBe(true);
        expect(diffBriefingEdits(null, null).empty).toBe(true);
    });
});

describe('rebaseBriefingEdits', () => {
    it('o slide que o colega CRIOU entra, e o que ele APAGOU sai', () => {
        const base = briefing([slide('s1', { title: 'Um' }), slide('s2', { title: 'Dois' })]);
        const memory = deepClone(base);
        const fresh = briefing([slide('s1', { title: 'Um' }), slide('s3', { title: 'Tres' })]);
        const out = rebaseBriefingEdits(memory, base, fresh);
        expect(memory.slides.map((s) => s.id)).toEqual(['s1', 's3']);
        expect(out.addedSlideIds).toEqual(['s3']);
        expect(out.removedSlideIds).toEqual(['s2']);
        expect(out.changed).toBe(true);
    });

    it('A JANELA DO AUTOSAVE: a edicao ainda nao gravada sobrevive, e o que o colega fez entra', () => {
        const base = briefing([slide('s1', { title: 'Um', content: '<p>velho</p>' }), slide('s2', { title: 'Dois' })]);
        const memory = deepClone(base);
        memory.slides[0].content = '<p>digitando</p>'; // a pessoa, ainda so em memoria
        // O colega mexeu no TITULO do mesmo slide, no outro slide e criou um terceiro.
        const fresh = briefing([
            slide('s1', { title: 'Um (colega)', content: '<p>velho</p>' }),
            slide('s2', { title: 'Dois (colega)' }),
            slide('s3', { title: 'Tres' }),
        ]);
        const s1Antes = memory.slides[0];
        rebaseBriefingEdits(memory, base, fresh);
        const newBase = deepClone(fresh);

        expect(memory.slides[0]).toBe(s1Antes); // o objeto que o formulario segura continua vivo
        expect(memory.slides.map((s) => [s.id, s.title, s.content])).toEqual([
            ['s1', 'Um (colega)', '<p>digitando</p>'],
            ['s2', 'Dois (colega)', ''],
            ['s3', 'Tres', ''],
        ]);
        // E o que o autosave vai gravar agora e so o conteudo da pessoa.
        expect(diffBriefingEdits(memory, newBase)).toEqual({ fields: {}, slides: { s1: { content: '<p>digitando</p>' } }, empty: false });
    });

    it('a ordem vem do disco, sem recriar os slides', () => {
        const base = briefing([slide('s1'), slide('s2')]);
        const memory = deepClone(base);
        const [a, b] = memory.slides;
        const out = rebaseBriefingEdits(memory, base, briefing([slide('s2'), slide('s1')]));
        expect(memory.slides[0]).toBe(b);
        expect(memory.slides[1]).toBe(a);
        expect(memory.slides.map((s) => s.order)).toEqual([0, 1]);
        expect(out.changed).toBe(true);
        expect(out.updatedSlideIds).toEqual([]); // a ordem nao e edicao do slide
    });

    it('nome sujo fica, nome limpo e adotado; settings adota so a chave nao tocada', () => {
        const base = briefing([]);
        const memory = deepClone(base);
        memory.settings.panelWidth = 400;
        const fresh = briefing([], { name: 'Plano do colega', settings: { panelPosition: 'right', panelWidth: 350 } });
        const out = rebaseBriefingEdits(memory, base, fresh);
        expect(memory.name).toBe('Plano do colega');
        expect(memory.settings).toEqual({ panelPosition: 'right', panelWidth: 400 });
        expect(out.updatedFields).toEqual(expect.arrayContaining(['name', 'settings']));
    });

    it('nada mudou no disco: nada muda na memoria', () => {
        const base = briefing([slide('s1', { title: 'Um' })]);
        const memory = deepClone(base);
        memory.slides[0].title = 'Um (meu)';
        const out = rebaseBriefingEdits(memory, base, deepClone(base));
        expect(out).toEqual({ changed: false, removedSlideIds: [], addedSlideIds: [], updatedSlideIds: [], updatedFields: [] });
        expect(memory.slides[0].title).toBe('Um (meu)');
    });

    it('o proprio save refletido: o que foi gravado volta igual e nada se perde', () => {
        const base = briefing([slide('s1', { title: 'Um' })]);
        const memory = deepClone(base);
        memory.slides[0].title = 'Um (meu)';
        const stored = deepClone(memory);
        stored.slides[0].sync = { version: 2 };
        rebaseBriefingEdits(memory, base, stored);
        expect(memory.slides[0].title).toBe('Um (meu)');
        expect(memory.slides[0].sync).toEqual({ version: 2 });
        expect(diffBriefingEdits(memory, deepClone(stored)).empty).toBe(true);
    });
});
