// Path: tests/unit/carga-dos-visualizadores-cobre-a-trilha.test.js

/**
 * A tela de carga do 3D e a da primeira pessoa cobrem a VIEWPORT INTEIRA, trilha lateral inclusive.
 *
 * Decisão do dono em 2026-09-20. Com a trilha no mesmo verde primário da carga, a carga presa ao
 * contêiner do visualizador (que começa depois da trilha) deixava dois retângulos do mesmo verde
 * encostados, com os ícones da trilha boiando ao lado do logotipo. A primeira ideia foi uma linha
 * separadora; o dono preferiu cobrir tudo, que é também o que a abertura do produto já faz.
 *
 * São DUAS metades, e uma sem a outra não funciona, que é o motivo de este guarda existir:
 *  - a carga é `fixed` com `inset: 0`, senão ela herda o recuo do contêiner;
 *  - a trilha NÃO sobe a 300 enquanto a carga está na tela, porque a carga mora num contexto de
 *    empilhamento que vale 200 e de lá nunca passaria por cima.
 * Medido em navegador na mesma data: `elementFromPoint` sobre a trilha devolve a carga enquanto ela
 * está visível e devolve a trilha depois. O 360 fica de fora porque não tem tela de carga.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'css');
const semComentario = (arquivo) => readFileSync(resolve(CSS, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const P3D = semComentario('panels-3d.css');
const FP = semComentario('first-person-3d.css');

describe('a carga dos visualizadores cobre a trilha lateral', () => {
    it.each([
        ['3D', P3D, /#loading-screen-3d\s*\{[^}]*\}/],
        ['primeira pessoa', FP, /\.fp3d-loading\s*\{[^}]*\}/],
    ])('a carga do %s é `fixed` com `inset: 0`', (_nome, folha, re) => {
        const regra = folha.match(re);
        expect(regra, 'a regra da tela de carga sumiu').not.toBeNull();
        expect(regra[0]).toMatch(/position:\s*fixed;/);
        expect(regra[0]).toMatch(/inset:\s*0;/);
    });

    it('a trilha sobe a 300 com o visualizador aberto (a premissa que a exceção abaixo contorna)', () => {
        expect(P3D).toMatch(/body\.cesium-active \.sidebar-container\s*\{\s*z-index:\s*300/);
        expect(FP).toMatch(/body\.first-person-active \.sidebar-container\s*\{\s*z-index:\s*300/);
    });

    it('enquanto a carga do 3D está visível OU esmaecendo, a trilha fica no z-index de repouso', () => {
        const regra = P3D.match(/body:has\(#loading-screen-3d:is\(([^)]*)\)\) \.sidebar-container\s*\{([^}]*)\}/);
        expect(regra, 'a exceção da trilha durante a carga do 3D sumiu').not.toBeNull();
        expect(regra[1]).toContain('.loading-3d-visible');
        // O estado do fade: sem ele a trilha SALTA por cima da carga no primeiro quadro do esmaecer.
        expect(regra[1]).toContain('.loading-3d-hidden');
        // `!important` porque a regra que ela vence também é.
        expect(regra[2]).toMatch(/z-index:\s*var\(--z-sidebar\)\s*!important/);
    });

    it('na primeira pessoa a condição é a carga SEM a classe de oculto, com o visualizador aberto', () => {
        // O elemento de carga vive no DOM o tempo todo, então `:has(.fp3d-loading)` sozinho casaria
        // sempre e a trilha nunca mais subiria por cima do visualizador.
        const regra = FP.match(/body\.first-person-active:has\(\.fp3d-loading:not\(\.fp3d-hidden\)\) \.sidebar-container\s*\{([^}]*)\}/);
        expect(regra, 'a exceção da trilha durante a carga da primeira pessoa sumiu').not.toBeNull();
        expect(regra[1]).toMatch(/z-index:\s*var\(--z-sidebar\)/);
    });
});
