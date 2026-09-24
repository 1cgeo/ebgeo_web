// Path: tests/unit/escala-de-tipografia.test.js

/**
 * TAMANHO DE TEXTO VEM DA ESCALA: `var(--font-size-*)`, nunca um número escrito à mão.
 *
 * Até 2026-09-24 cerca de 190 declarações escreviam o tamanho em px ou rem soltos, e 44 delas
 * eram 13px, um degrau que a escala não tem, entre o `xs` (12) e o `sm` (14). Cada literal era
 * uma decisão tomada uma vez e nunca mais revista, e o resultado era a tela com oito tamanhos
 * de texto onde a escala previa cinco. A revisão levou cada um a um degrau: no painel lateral,
 * rótulo em `xs` e valor ou controle em `sm`; em modal, rótulo em `sm`.
 *
 * O que fica DE FORA, de propósito: tamanho de 24px para cima, que é GLIFO (o "×" de fechar, a
 * seta, o ícone grande de estado vazio) e não texto; tamanho relativo (`em`), que acompanha o
 * pai; e a exceção declarada abaixo.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A captura do painel de texto para o PDF do briefing mede em PIXEL de propósito: o html2canvas
// fotografa uma caixa de 420px, e o tamanho do texto decide a paginação do documento impresso.
const EXCECOES = new Set(['src/css/briefing/briefing-pdf-export.css']);

/** Tamanho em px de um literal `12px` / `0.75rem`, ou null para o que não é literal absoluto. */
function emPx(valor) {
    const m = valor.trim().match(/^([0-9.]+)(px|rem)$/);
    if (!m) return null;
    return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
}

describe('escala de tipografia', () => {
    it('nenhum texto abaixo de 24px tem tamanho literal em `src/css`', () => {
        const folhas = execSync('git ls-files src/css', { cwd: FRONT, encoding: 'utf8' })
            .split(/\r?\n/).filter((f) => f.endsWith('.css') && !EXCECOES.has(f));
        expect(folhas.length).toBeGreaterThan(40);

        const achados = [];
        let declaracoes = 0;
        for (const folha of folhas) {
            const texto = readFileSync(join(FRONT, folha), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            texto.split('\n').forEach((linha, i) => {
                const tamanho = linha.match(/font-size:\s*([^;!]+)/);
                // No atalho `font:` o tamanho é o termo com unidade antes da família.
                const atalho = linha.match(/\bfont:\s*([^;]+)/);
                const candidatos = [
                    ...(tamanho ? [tamanho[1]] : []),
                    ...(atalho ? atalho[1].split(/\s+/).filter((t) => /^[0-9.]+(px|rem)$/.test(t)) : []),
                ];
                for (const c of candidatos) {
                    declaracoes++;
                    const px = emPx(c);
                    if (px !== null && px < 24) achados.push(`${folha}:${i + 1}: ${linha.trim()}`);
                }
            });
        }
        // Controle do instrumento: o laço tem de ter lido centenas de declarações de tamanho.
        expect(declaracoes).toBeGreaterThan(500);
        expect(achados).toEqual([]);
    });

    it('controle de formulário herda a fonte nas quatro páginas que ligam CSS da casa', () => {
        // Sem isto o navegador desenha botão, campo e lista na fonte de interface DELE, que no
        // Windows é Arial a 13,33px: medido em 2026-09-24, eram 273 de 637 textos da tela do
        // mapa, ao lado da Segoe UI do resto. `base.css` serve mapa, atlas e administração;
        // a calibração não carrega `base.css` e repete a regra na folha dela.
        const RESET = /button,\s*input,\s*select,\s*textarea\s*\{[^}]*font-family:\s*inherit;/;
        for (const folha of ['src/css/base.css', 'src/css/calibracao.css']) {
            const texto = readFileSync(join(FRONT, folha), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            expect(texto, `${folha} perdeu o reset de fonte dos controles`).toMatch(RESET);
        }
        for (const manifesto of ['src/css/style.css', 'src/css/projects-page.css', 'src/css/admin-page.css']) {
            expect(readFileSync(join(FRONT, manifesto), 'utf8'), `${manifesto} não importa base.css`)
                .toMatch(/@import url\('\.\/base\.css'\)/);
        }
    });
});
