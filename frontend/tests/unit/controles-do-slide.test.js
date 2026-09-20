// Path: tests/unit/controles-do-slide.test.js
//
// OS CONTROLES QUE UM SLIDE MOSTRA AO SER APRESENTADO (regra do dono, 2026-09-20).
//
// Uma apresentação é um palco limpo: seletor de mapa base, modelos 3D, imagens 360, terreno,
// controle de coordenadas e utilitários ficam ESCONDIDOS, e cada um só volta quando o autor marcou
// a caixa daquele slide. O padrão de todos é falso. A conta ("Entrar" ou a identidade de quem
// entrou) e o "compartilhar esta vista" não são escolha do autor: somem sempre.
//
// TRÊS COISAS QUE ESTE ARQUIVO PRENDE, e que erram em silêncio:
//
//   1. SÓ `true` É VERDADEIRO. O campo viaja como JSONB, e slide antigo não o tem: ausente, nulo,
//      `'true'`, `1` e array leem todos como ESCONDIDO, que é o lado que falha fechado;
//   2. O ESPELHO COM O SERVIDOR. A lista é fechada nos dois pacotes, e o servidor descarta chave
//      fora dela. Controle acrescentado de um lado só é jogado fora na entrada, sem erro nenhum;
//   3. O CSS E A LISTA ANDAM JUNTOS. Quem esconde e mostra é CSS sob classes do `body`, então uma
//      classe da lista sem regra correspondente é uma caixa que o autor marca e não faz nada.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import {
    SLIDE_CONTROLS,
    ALL_SLIDE_CONTROL_CLASSES,
    PRESENTING_BODY_CLASS,
    normalizeSlideControls,
    slideControlClasses,
} from '../../src/js/briefing/slide-controls.js';
import { SLIDE_CONTROL_KEYS, normalizeSlideControls as normalizarNoServidor }
    from '../../../backend/src/modules/sync/slide-controls.js';

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

describe('a lista fechada', () => {
    it('são os seis controles que o dono pediu, nesta ordem', () => {
        expect(SLIDE_CONTROLS.map((c) => c.key)).toEqual(
            ['basemap', 'models3d', 'views360', 'terrain', 'coordinates', 'utilities'],
        );
        // Rótulo é texto de interface: pt-BR, com acento.
        expect(SLIDE_CONTROLS.map((c) => c.label)).toEqual([
            'Seletor de mapa base', 'Modelos 3D', 'Imagens 360', 'Terreno',
            'Controle de coordenadas', 'Utilitários',
        ]);
    });

    it('ESPELHO: o servidor conhece exatamente as mesmas chaves', () => {
        expect([...SLIDE_CONTROL_KEYS]).toEqual(SLIDE_CONTROLS.map((c) => c.key));
    });

    it('cada controle tem uma classe de body própria, e nenhuma se repete', () => {
        expect(new Set(ALL_SLIDE_CONTROL_CLASSES).size).toBe(SLIDE_CONTROLS.length);
        expect(ALL_SLIDE_CONTROL_CLASSES).not.toContain(PRESENTING_BODY_CLASS);
    });
});

describe('normalizeSlideControls', () => {
    const TUDO_ESCONDIDO = {
        basemap: false, models3d: false, views360: false, terrain: false, coordinates: false, utilities: false,
    };

    it.each([undefined, null, {}, [], 'basemap', 42, true])('%j: tudo escondido, que é o padrão do dono', (bruto) => {
        expect(normalizeSlideControls(bruto)).toEqual(TUDO_ESCONDIDO);
    });

    it('só `true` liga: string, número e objeto leem como escondido', () => {
        expect(normalizeSlideControls({ basemap: 'true', models3d: 1, views360: {}, terrain: true }))
            .toEqual({ ...TUDO_ESCONDIDO, terrain: true });
    });

    it('chave fora da lista não atravessa, nem pela cadeia de protótipo', () => {
        const saida = normalizeSlideControls({ terrain: true, segredo: true, constructor: true, __proto__: { basemap: true } });
        expect(Object.keys(saida)).toEqual(SLIDE_CONTROLS.map((c) => c.key));
        expect(saida.basemap).toBe(false);
        expect(saida.terrain).toBe(true);
    });

    it('PROPRIEDADE: a saída tem sempre as seis chaves booleanas, e os dois pacotes concordam', () => {
        fc.assert(fc.property(fc.anything(), (bruto) => {
            const cliente = normalizeSlideControls(bruto);
            expect(Object.keys(cliente)).toEqual(SLIDE_CONTROLS.map((c) => c.key));
            expect(Object.values(cliente).every((v) => typeof v === 'boolean')).toBe(true);
            // O servidor devolve nulo para o que não é objeto; para objeto, o mesmo resultado.
            const servidor = normalizarNoServidor(bruto);
            if (servidor !== null) expect(servidor).toEqual(cliente);
        }));
    });

    it('IDEMPOTENTE: normalizar o que já está normalizado não muda nada', () => {
        fc.assert(fc.property(fc.dictionary(fc.string(), fc.anything()), (bruto) => {
            const uma = normalizeSlideControls(bruto);
            expect(normalizeSlideControls(uma)).toEqual(uma);
        }));
    });
});

describe('slideControlClasses', () => {
    it('slide sem nada marcado não pede classe nenhuma', () => {
        expect(slideControlClasses(undefined)).toEqual([]);
        expect(slideControlClasses({})).toEqual([]);
    });

    it('devolve só as classes dos controles marcados, na ordem da lista', () => {
        expect(slideControlClasses({ utilities: true, basemap: true, terrain: false }))
            .toEqual(['briefing-show-basemap', 'briefing-show-utilities']);
    });
});

describe('a fiação: CSS, apresentador e editor', () => {
    const css = ler('../../src/css/briefing/briefing-presentation.css');

    it('toda classe da lista tem regra no CSS da apresentação, sob a classe de apresentação', () => {
        for (const classe of ALL_SLIDE_CONTROL_CLASSES) {
            expect(css, `falta a regra de ${classe}`).toContain(`body.${PRESENTING_BODY_CLASS}:not(.${classe})`);
        }
    });

    it('a conta e o compartilhar vista somem SEMPRE na apresentação, sem classe que os traga de volta', () => {
        expect(css).toMatch(/body\.briefing-presenting \.account-control,/);
        expect(css).toMatch(/body\.briefing-presenting \.toolbar-standalone-btn\[data-tool-id="share-view"\]/);
        expect(css).not.toMatch(/briefing-show-account|briefing-show-share/);
    });

    it('o CSS da apresentação chega ao navegador pelo manifesto', () => {
        expect(ler('../../src/css/style.css')).toContain('./briefing/briefing-presentation.css');
    });

    it('só o APRESENTADOR liga a classe de apresentação: o editor precisa dos controles para montar o slide', () => {
        const apresentador = ler('../../src/js/briefing/presentation/briefing-presenter.control.js');
        expect(apresentador).toContain('classList.add(PRESENTING_BODY_CLASS)');
        expect(apresentador).toContain('classList.remove(PRESENTING_BODY_CLASS, ...ALL_SLIDE_CONTROL_CLASSES)');
        expect(apresentador).toContain('this._applySlideControls(slide)');
        const editor = ler('../../src/js/briefing/editor/briefing-editor.control.js');
        expect(editor).not.toContain('PRESENTING_BODY_CLASS');
    });

    it('as caixas ficam ABAIXO do conteúdo no editor, como o dono pediu', () => {
        const editor = ler('../../src/js/briefing/editor/briefing-editor.control.js');
        const conteudo = editor.indexOf('this._slideEditorEl.appendChild(contentGroup)');
        const controles = editor.indexOf('this._slideEditorEl.appendChild(this._createSlideControlsGroup(slide))');
        expect(conteudo).toBeGreaterThan(-1);
        expect(controles).toBeGreaterThan(conteudo);
    });
});
