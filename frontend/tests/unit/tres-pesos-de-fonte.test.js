// Path: tests/unit/tres-pesos-de-fonte.test.js

/**
 * TRÊS PESOS DE FONTE: 400, 600 e 700, e nenhum 500.
 *
 * A Segoe UI, que é a face que todo Windows desenha para a pilha `--font-family-base`, só tem os
 * cortes 400 (Regular), 600 (Semibold) e 700 (Bold). Pedir 500 cai no Semibold: medido em
 * 2026-09-24 por comparação de pixels no Chromium, o 500 e o 600 saem IDÊNTICOS. Com cerca de
 * duzentas regras em "medium", uns 70% do texto da tela saíam em semibold, e a diferença entre
 * rótulo e título, que era o motivo de o 500 existir, não chegava a ninguém.
 *
 * A correção levou cada regra a um dos três: controle, nome e título para semibold (que é como
 * elas já apareciam no Windows), rótulo e texto corrido para normal. Este teste impede o 500 de
 * voltar por qualquer das três grafias.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('três pesos de fonte', () => {
    it('nenhuma folha de `src/css` pede peso 500, nem pelo número, nem pelo token, nem pelo atalho `font:`', () => {
        const folhas = execSync('git ls-files src/css', { cwd: FRONT, encoding: 'utf8' })
            .split(/\r?\n/).filter((f) => f.endsWith('.css'));
        // Piso do inventário: um `git ls-files` que devolvesse pouco faria o laço verificar nada.
        expect(folhas.length).toBeGreaterThan(40);

        const PESO_500 = /font-weight:\s*(500|medium)\b|--font-weight-medium|\bfont:\s*500\b/;
        const achados = [];
        for (const folha of folhas) {
            // O comentário de `design-tokens.css` CONTA por que o 500 saiu, e é para contar.
            const texto = readFileSync(join(FRONT, folha), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            texto.split('\n').forEach((linha, i) => {
                if (PESO_500.test(linha)) achados.push(`${folha}:${i + 1}: ${linha.trim()}`);
            });
        }
        expect(achados).toEqual([]);
    });

    it('o token de peso médio não existe, e os três que ficam existem', () => {
        const tokens = readFileSync(join(FRONT, 'src/css/design-tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(tokens).not.toMatch(/--font-weight-medium\s*:/);
        expect(tokens).toMatch(/--font-weight-normal:\s*400;/);
        expect(tokens).toMatch(/--font-weight-semibold:\s*600;/);
        expect(tokens).toMatch(/--font-weight-bold:\s*700;/);
    });
});
