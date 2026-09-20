// Path: tests/unit/caixa-de-acerto-de-alca.test.js

/**
 * @fileoverview A FOLGA DE ACERTO DA ALÇA DE EDIÇÃO, que não existia.
 *
 * A alça tem 16px de diâmetro (`circle-radius: 8`) e era consultada por UM PONTO: acertar
 * exigia que o toque caísse dentro de oito pixels de raio, contra uma ponta de dedo de cerca de
 * 34px. A tolerância dobrada para toque já morava em `feature-hit-test.helpers.js` e era usada
 * só na seleção de FEIÇÃO, nunca nas alças — dezesseis sítios em doze ferramentas passavam o
 * ponto cru.
 *
 * O QUE ESTE ARQUIVO PRENDE é a matemática da caixa, que é pura e roda em node. Quem garante
 * que as dezesseis chamadas passaram a usá-la é o censo no fim do arquivo, estrutural e varrido
 * por `git ls-files`: ferramenta nova que consulte alça com ponto cru reprova aqui.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleHitBox } from '../../src/js/tool_manager/helpers/feature-hit-test.helpers.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('handleHitBox — a caixa que o MapLibre recebe', () => {
    it('centra no ponto e abre a tolerância para os dois lados', () => {
        expect(handleHitBox({ x: 100, y: 50 }, 12)).toEqual([[88, 38], [112, 62]]);
    });

    it('aceita o ponto como PAR, que é a forma que metade dos chamadores usa', () => {
        expect(handleHitBox([100, 50], 12)).toEqual([[88, 38], [112, 62]]);
    });

    it('coordenada negativa continua válida: a borda esquerda da tela é zero', () => {
        // Um toque a 5px da borda produz canto negativo, e isso é correto: o MapLibre recorta
        // sozinho. Zerar o canto aqui deslocaria o CENTRO da caixa, que é o defeito sutil.
        expect(handleHitBox({ x: 5, y: 5 }, 12)).toEqual([[-7, -7], [17, 17]]);
    });

    it('tolerância zero devolve a caixa degenerada, que é o ponto de antes', () => {
        expect(handleHitBox({ x: 10, y: 20 }, 0)).toEqual([[10, 20], [10, 20]]);
    });

    it('tolerância negativa ou não numérica NÃO inverte a caixa', () => {
        // Uma caixa invertida (`x1 > x2`) é aceita pelo MapLibre e devolve resultado
        // imprevisível; degenerar é o desfecho seguro.
        expect(handleHitBox({ x: 10, y: 20 }, -5)).toEqual([[10, 20], [10, 20]]);
        expect(handleHitBox({ x: 10, y: 20 }, Number.NaN)).toEqual([[10, 20], [10, 20]]);
        expect(handleHitBox({ x: 10, y: 20 }, undefined)).not.toBeUndefined();
    });

    it('ponto não finito vira caixa no ZERO, e não uma caixa de NaN', () => {
        // `NaN` num canto faz o MapLibre devolver lista vazia EM SILÊNCIO, que é
        // indistinguível de "não há alça ali". Um zero também não acha nada, e se lê.
        for (const ruim of [{ x: Number.NaN, y: 5 }, { x: 5, y: undefined }, null, undefined]) {
            const caixa = handleHitBox(ruim, 10);
            for (const canto of caixa) {
                for (const n of canto) expect(Number.isFinite(n)).toBe(true);
            }
        }
    });
});

describe('censo: nenhuma consulta de alça passa mais um ponto cru', () => {
    /** Os arquivos versionados de `src/js`, para o censo não depender de lista à mão. */
    const arquivos = execSync('git ls-files "frontend/src/js/**/*.js"', {
        cwd: resolve(FRONT, '..'),
        encoding: 'utf8',
    }).split('\n').filter(Boolean);

    it('piso: a varredura achou os arquivos', () => {
        // Sem isto, um `git ls-files` que devolvesse vazio faria o caso abaixo passar sobre
        // nada, para sempre.
        expect(arquivos.length).toBeGreaterThan(300);
    });

    it('toda consulta a uma camada de alça usa `handleHitBox`', () => {
        const infratores = [];
        for (const rel of arquivos) {
            const fonte = readFileSync(join(FRONT, '..', rel), 'utf8');
            if (!fonte.includes('edit-handles-layer')) continue;
            // A chamada e as três linhas seguintes: a camada aparece no objeto de opções, logo
            // abaixo do argumento de posição.
            const chamadas = fonte.matchAll(
                /queryRenderedFeatures\(([^,]+),[\s\S]{0,120}?edit-handles-layer/g,
            );
            for (const m of chamadas) {
                if (!m[1].includes('handleHitBox')) {
                    infratores.push(`${rel} :: queryRenderedFeatures(${m[1].trim()}`);
                }
            }
        }
        expect(infratores, 'consulta de alça com ponto cru: o alvo volta a ter 16px')
            .toEqual([]);
    });
});
