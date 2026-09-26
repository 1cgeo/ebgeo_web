// Path: tests/unit/figura-de-slide.test.js
//
// A FIGURA DE SLIDE POR REFERÊNCIA (decisão do dono de 2026-09-26): o HTML do slide carrega um src
// sentinela em https, e os bytes viajam uma vez pela fila de blob. Este arquivo prende a folha pura:
// o sentinela, a leitura dos ids no HTML e a reescrita de ids de quem copia o atlas.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    FIGURA_ORIGEM, srcDaFigura, idDaFigura, idsDeFigurasNoHtml, reescreverFigurasNoHtml, idsDeFigurasDoBriefing,
    marcarFigurasParaDesenho, htmlParaGuardar, PLACEHOLDER_DA_FIGURA, embutirFigurasNoHtml,
} from '@js/briefing/figura-de-slide.js';
import { idsDeFotosDaEntidade } from '@js/user_data/photo-refs.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('o sentinela', () => {
    it('ida e volta: o id sai como entrou', () => {
        expect(idDaFigura(srcDaFigura(A))).toBe(A);
        fc.assert(fc.property(fc.uuid(), (id) => idDaFigura(srcDaFigura(id)) === id));
    });

    it('recusa id que sairia do caminho', () => {
        for (const ruim of ['', '../x', 'a b', 'x'.repeat(65), null, 7]) {
            expect(() => srcDaFigura(ruim), String(ruim)).toThrow();
        }
    });

    it('um src que não é sentinela não tem figura', () => {
        for (const src of ['data:image/png;base64,AAA', 'https://outro.site/x', `${FIGURA_ORIGEM}../etc`, null, undefined]) {
            expect(idDaFigura(src), String(src)).toBeNull();
        }
    });
});

describe('os ids citados pelo HTML', () => {
    it('lê cada figura uma vez, em ordem', () => {
        const html = `<p>a</p><img src="${srcDaFigura(A)}"><p>b</p><img src="${srcDaFigura(B)}"><img src="${srcDaFigura(A)}">`;
        expect(idsDeFigurasNoHtml(html)).toEqual([A, B]);
    });

    it('slide antigo com data URL e HTML sem figura não citam nada', () => {
        expect(idsDeFigurasNoHtml('<img src="data:image/jpeg;base64,/9j/4AAQ">')).toEqual([]);
        expect(idsDeFigurasNoHtml('<p>só texto</p>')).toEqual([]);
        expect(idsDeFigurasNoHtml(null)).toEqual([]);
    });

    it('o briefing inteiro: o content de cada slide', () => {
        const briefing = {
            slides: [
                { content: `<img src="${srcDaFigura(A)}">` },
                { content: '<p>nada</p>' },
                { content: `<img src="${srcDaFigura(B)}"><img src="${srcDaFigura(A)}">` },
                null,
            ],
        };
        expect(idsDeFigurasDoBriefing(briefing)).toEqual([A, B]);
        expect(idsDeFigurasDoBriefing({ content: `<img src="${srcDaFigura(B)}">` })).toEqual([B]);
        expect(idsDeFigurasDoBriefing(undefined)).toEqual([]);
    });
});

describe('a reescrita de ids de quem copia o atlas', () => {
    it('troca pelo mapa, mantém o que ele não nomeia, e não toca no resto', () => {
        const html = `<p>x</p><img src="${srcDaFigura(A)}" alt="a"><img src="${srcDaFigura(B)}">`;
        const novo = '33333333-3333-4333-8333-333333333333';
        const saida = reescreverFigurasNoHtml(html, new Map([[A, novo]]));
        expect(idsDeFigurasNoHtml(saida)).toEqual([novo, B]);
        expect(saida).toContain('alt="a"');
        expect(reescreverFigurasNoHtml(html, { [B]: novo })).toContain(srcDaFigura(novo));
    });

    it('um id de destino inválido não é escrito', () => {
        const html = `<img src="${srcDaFigura(A)}">`;
        expect(reescreverFigurasNoHtml(html, { [A]: '../x' })).toBe(html);
    });

    it('não-string passa intacto', () => {
        expect(reescreverFigurasNoHtml(null, {})).toBeNull();
    });
});

describe('desenhar e guardar', () => {
    it('para desenhar, o sentinela vira o pixel transparente mais o id: nada pede a rede', () => {
        const html = `<p>x</p><img src="${srcDaFigura(A)}" width="200" height="100">`;
        const desenho = marcarFigurasParaDesenho(html);
        expect(desenho).not.toContain(FIGURA_ORIGEM);
        expect(desenho).toContain(`src="${PLACEHOLDER_DA_FIGURA}" data-figura-id="${A}"`);
        expect(desenho).toContain('width="200"');
    });

    it('para guardar, volta o sentinela, com qualquer src que a aba tenha posto (pixel ou blob:)', () => {
        const noEditor = `<p>x</p><img src="blob:http://localhost/abc" data-figura-id="${A}" width="200"><img src="${PLACEHOLDER_DA_FIGURA}" data-figura-id="${B}">`;
        const guardado = htmlParaGuardar(noEditor);
        expect(guardado).toBe(`<p>x</p><img src="${srcDaFigura(A)}" width="200"><img src="${srcDaFigura(B)}">`);
    });

    it('ida e volta: guardar o que se desenhou devolve o HTML guardado', () => {
        fc.assert(fc.property(fc.uuid(), fc.uuid(), (a, b) => {
            const html = `<p>t</p><img src="${srcDaFigura(a)}" alt="x"><img src="data:image/jpeg;base64,AA"><img src="${srcDaFigura(b)}">`;
            return htmlParaGuardar(marcarFigurasParaDesenho(html)) === html;
        }));
    });

    it('figura inline antiga e imagem sem o id passam intactas nos dois sentidos', () => {
        const html = '<img src="data:image/jpeg;base64,/9j/4AAQ" width="10">';
        expect(marcarFigurasParaDesenho(html)).toBe(html);
        expect(htmlParaGuardar(html)).toBe(html);
    });
});

describe('a cópia que sai do app leva os bytes dentro', () => {
    it('troca o marcador pelo data URL e tira o id; o que não tem bytes fica marcado', () => {
        const desenho = marcarFigurasParaDesenho(`<p>x</p><img src="${srcDaFigura(A)}" width="9"><img src="${srcDaFigura(B)}">`);
        const bytes = 'data:image/jpeg;base64,/9j/4AAQ';
        const saida = embutirFigurasNoHtml(desenho, new Map([[A, bytes]]));
        expect(saida).toBe(`<p>x</p><img src="${bytes}" width="9"><img src="${PLACEHOLDER_DA_FIGURA}" data-figura-id="${B}">`);
    });

    it('recusa o que não é imagem embutida e passa intacto o HTML sem figura', () => {
        const desenho = marcarFigurasParaDesenho(`<img src="${srcDaFigura(A)}">`);
        expect(embutirFigurasNoHtml(desenho, new Map([[A, 'javascript:alert(1)']]))).toBe(desenho);
        expect(embutirFigurasNoHtml('<p>nada</p>', new Map())).toBe('<p>nada</p>');
        expect(embutirFigurasNoHtml(null, new Map())).toBeNull();
    });
});

describe('a op que cita uma figura espera os bytes dela (a regra mora em `idsDeFotosDaEntidade`)', () => {
    it('slide, briefing e notas do mapa citam a figura; a foto anexa continua citada', () => {
        expect(idsDeFotosDaEntidade({ content: `<img src="${srcDaFigura(A)}">` })).toEqual([A]);
        expect(idsDeFotosDaEntidade({ slides: [{ content: `<img src="${srcDaFigura(B)}">` }] })).toEqual([B]);
        expect(idsDeFotosDaEntidade({ description: `<img src="${srcDaFigura(A)}">` })).toEqual([A]);
        expect(idsDeFotosDaEntidade({ images: [{ id: B }], content: `<img src="${srcDaFigura(A)}">` })).toEqual([B, A]);
    });

    it('a figura inline antiga não é citada: ela leva os próprios bytes', () => {
        expect(idsDeFotosDaEntidade({ content: '<img src="data:image/jpeg;base64,/9j/4AAQ">' })).toEqual([]);
    });
});
