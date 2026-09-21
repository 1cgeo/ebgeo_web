// Path: tests/unit/barra-temporal-fiacao.test.js
//
// A FIAÇÃO DA BARRA DA LINHA DO TEMPO (C7, C8 e C9 da auditoria temporal de 2026-09-21).
//
// POR QUE ESTRUTURAL. A máquina de arraste e a tradução tecla → cursor são puras e estão presas
// caso a caso em `barra-temporal-arraste-e-teclas.repro.test.js`. O que aquele arquivo NÃO alcança
// é a metade que causou o defeito na tela: os ouvintes podem voltar para o `window` com a máquina
// intacta, e o teste puro continuaria verde enquanto o cursor volta a seguir a página depois de um
// gesto cancelado. Aqui não há DOM (o ambiente é node puro), então o que resta é ler o arquivo, e
// é o que se faz, com âncora em cada propriedade que já foi vista errada.
//
// C9, A ALTURA SEM CONSUMIDOR. `setVisible` media a própria altura e publicava
// `--temporal-bar-height` no `documentElement`. Nenhuma regra de CSS desta árvore lia essa
// propriedade: ela nasceu para a barra de edição de trajetória empilhar acima, e aquela barra foi
// para o TOPO da tela (o comentário de `.trajectory-edit-toolbar` em `css/temporal.css` diz isso
// por extenso); o único outro elemento centrado no rodapé, a leitura de coordenadas, é DOCADO
// dentro da própria barra (`getCoordsSlot`), não empilhado. O preço que a publicação cobrava era um
// reflow forçado a cada exibição. O caso abaixo não proíbe a propriedade: ele proíbe publicá-la sem
// ninguém do outro lado, que é a forma de código morto que se disfarça de fiação.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const raiz = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const fonte = (rel) => readFileSync(raiz(rel), 'utf8');

const BARRA = fonte('src/js/temporal/temporal-timeline-bar.js');

/** Todos os arquivos com uma das extensões, recursivamente. */
function arquivosSob(dir, extensoes) {
    const saida = [];
    for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) saida.push(...arquivosSob(caminho, extensoes));
        else if (extensoes.some((ext) => nome.endsWith(ext))) saida.push(caminho);
    }
    return saida;
}

describe('C7: o arraste do cursor tem as três saídas e não mora no window', () => {
    it('registra pointercancel e lostpointercapture, não só pointerup', () => {
        for (const saida of ["'pointerup'", "'pointercancel'", "'lostpointercapture'"]) {
            expect(BARRA).toContain(saida);
        }
    });

    it('NÃO pendura ouvinte de ponteiro no window', () => {
        // A forma exata do defeito: `addDomListener(this, window, 'pointermove', ...)`.
        expect(BARRA).not.toMatch(/addDomListener\s*\(\s*this\s*,\s*window\s*,\s*'pointer/);
        expect(BARRA).not.toMatch(/window\.addEventListener\s*\(\s*'pointer/);
    });

    it('os ouvintes do arrasto vivem num escopo que se limpa, não na vida do componente', () => {
        expect(BARRA).toContain('addScopedDomListener');
        expect(BARRA).toContain('clearScopedListeners');
        expect(BARRA).toContain('DRAG_SCOPE');
    });

    it('decide pela máquina pura e não por uma bandeira própria', () => {
        expect(BARRA).toContain("from './temporal-bar.model.js'");
        expect(BARRA).toContain('reduceDragEvent');
        // `_dragging` era a bandeira que ficava presa em verdadeiro no gesto cancelado.
        expect(BARRA).not.toContain('_dragging');
    });

    it('solta a captura de ponteiro, inclusive no destroy', () => {
        expect(BARRA).toContain('releasePointerCapture');
        expect(BARRA).toMatch(/destroy\(\)\s*\{[\s\S]*?_releaseDrag/);
    });
});

describe('C8: a régua é um slider completo e o clique lhe dá foco', () => {
    it('publica os quatro valores de ARIA', () => {
        for (const attr of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) {
            expect(BARRA).toContain(attr);
        }
    });

    it('dá foco à régua no pointerdown (as setas não podem depender do Tab)', () => {
        expect(BARRA).toMatch(/_track\.focus\?\.\(/);
    });

    it('traduz a tecla pela função pura, com as teclas que faltavam', () => {
        expect(BARRA).toContain('cursorForKey');
        // O aparo escrito à mão em cada ramo era a forma antiga.
        expect(BARRA).not.toContain("e.key === 'ArrowRight'");
    });
});

describe('C9: ninguém publica --temporal-bar-height sem alguém para ler', () => {
    const CSS = arquivosSob(raiz('src/css'), ['.css']);
    const JS = arquivosSob(raiz('src/js'), ['.js']);

    it('o inventário varrido não está vazio (senão este caso seria cobertura vazia)', () => {
        expect(CSS.length).toBeGreaterThan(20);
        expect(JS.length).toBeGreaterThan(100);
    });

    it('sem consumidor no CSS, não há publicador no JS', () => {
        const consumidores = CSS.filter((f) => readFileSync(f, 'utf8').includes('var(--temporal-bar-height'));
        const publicadores = JS.filter((f) => readFileSync(f, 'utf8').includes("'--temporal-bar-height'"));
        if (consumidores.length === 0) {
            expect(publicadores).toEqual([]);
        } else {
            // Se alguém der o consumidor que faltava, a publicação volta a ser legítima.
            expect(publicadores.length).toBeGreaterThan(0);
        }
    });

    it('setVisible não mede a própria altura (o reflow forçado que vinha junto)', () => {
        const setVisible = BARRA.match(/setVisible\(visible\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? '';
        expect(setVisible).not.toBe('');
        expect(setVisible).not.toContain('getBoundingClientRect');
        expect(setVisible).not.toContain('setProperty');
    });
});
