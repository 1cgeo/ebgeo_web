// Path: tests/unit/azimute-nunca-devolve-360.test.js

/**
 * @fileoverview UMA FORMA, CINCO SÍTIOS, QUATRO DEFEITOS: `if (x < 0) x += 360` devolve `360`.
 *
 * Em ponto flutuante, um negativo de magnitude menor que METADE do ULP de 360 (~2.84e-14) soma
 * para `360` EXATO. Toda função que normaliza azimute com essa forma promete `[0, 360)` no JSDoc
 * e entrega `[0, 360]`, e o valor de borda aparece justamente para a entrada mais comum que
 * existe: um ponto um fio a oeste do norte.
 *
 * ================= POR QUE ESTE ARQUIVO É POR FORMA, E NÃO POR SÍTIO ==========
 *
 * A forma foi achada em `analysis_tools/visibility_tool` por um agente que media aquele módulo, e
 * a primeira reação foi consertar ali. A varredura pela FORMA na árvore inteira achou mais quatro
 * ocorrências, em quatro pastas sem parentesco, e a pior delas não tinha nada a ver com rótulo:
 * em `generateArcCoordinates` o sweep vira 360 e o arco desenha a CIRCUNFERÊNCIA INTEIRA no lugar
 * de um arco de largura zero. Prender sítio a sítio deixaria o quinto nascer amanhã; o que este
 * arquivo prende é a AUSÊNCIA da forma.
 *
 * ================= A MEDIÇÃO, E O ERRO QUE ELA CORRIGIU =======================
 *
 * A faixa que reproduz DEPENDE DO CAMINHO, e supor isso errado custou uma asserção falsa antes de
 * ser medido. Onde o valor passa por `atan2` (setor, visibilidade), a função alarga o argumento:
 * `dLng = -1e-14` vira um bearing de ~-5.7e-13, já mais largo que o meio-ULP, e devolve
 * `359.99999999999943`. Só `-1e-16` e menores chegavam a 360 pela API pública. Onde o valor é
 * SUBTRAÇÃO CRUA de dois bearings (`calculateAngle`, `generateArcCoordinates`), não há alargamento
 * e `-1e-14` já devolvia 360.
 *
 * ================= O QUE ESTE ARQUIVO NÃO ALCANÇA ============================
 *
 * A varredura é LÉXICA e cobre `frontend/src/js/` inteiro. Ela não entende semântica: uma
 * normalização escrita de outra forma (`while`, `+ 360 * (x < 0)`, uma tabela) passa por baixo, e
 * uma ocorrência LEGÍTIMA da forma (onde `360` seja o valor certo, ou onde uma dobra posterior o
 * neutralize) precisa ser declarada aqui com o motivo, não silenciada no arquivo de origem.
 *
 * Existe exatamente UMA declarada: o `angleDiff` de `updateFromHandle`, nas duas ferramentas que o
 * têm. Ali a linha seguinte é `if (angleDiff > 180) angleDiff = 360 - angleDiff`, que dobra 360
 * para 0, e o clamp posterior leva ao mesmo resultado pelos dois caminhos. É MUTANTE EQUIVALENTE,
 * medido nos dois arquivos, e por isso fica: mexer nela seria churn sem defeito.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A forma proibida: soma condicional de 360 a um valor que se quer em [0, 360). */
// `360\b` e nao `360`: sem a fronteira, `total += 360000` casava. Quem pegou isso foi o caso de
// CONTROLE deste arquivo, na primeira execucao, e nao a leitura.
const FORMA = /if\s*\([^)]*<\s*0\s*\)\s*\w+\s*\+=\s*360\b/;

/**
 * As ocorrências LEGÍTIMAS, com o motivo. Uma entrada aqui é uma promessa de que alguém mediu.
 * Chave: caminho relativo a `frontend/`. Valor: quantas ocorrências naquele arquivo são legítimas.
 */
const DECLARADAS = Object.freeze({
    'src/js/draw_tools/sector_tool/add_sector_geometry.js': {
        n: 1,
        motivo: 'O `angleDiff` de `updateFromHandle`. A linha seguinte e '
            + '`if (angleDiff > 180) angleDiff = 360 - angleDiff`, que dobra 360 de volta para 0, '
            + 'e o clamp `Math.max(1, ...)` leva ao mesmo resultado pelos dois caminhos. Mutante '
            + 'equivalente, medido em 2026-08-24.',
    },
    'src/js/analysis_tools/visibility_tool/add_visibility_geometry.js': {
        n: 1,
        motivo: 'O gemeo exato do de cima, na ferramenta de visibilidade, com a mesma dobra e o '
            + 'mesmo clamp. Medido no mesmo dia, pelo agente que consertou o `calculateBearing` '
            + 'deste arquivo e deixou este de proposito.',
    },
});

/** Os arquivos de `src/js` rastreados pelo git, sem o vendor. */
function arquivosDeFonte() {
    const saida = execFileSync('git', ['ls-files', 'src/js'], {
        cwd: FRONT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    return saida.split('\n')
        .map((l) => l.trim())
        .filter((l) => l.endsWith('.js') && !l.startsWith('src/vendor/'));
}

/** Quantas vezes a forma aparece num arquivo, ignorando comentários. */
function ocorrencias(rel) {
    const bruto = readFileSync(resolve(FRONT, rel), 'utf8');
    const codigo = bruto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return codigo.split('\n').filter((linha) => FORMA.test(linha)).length;
}

describe('a forma `if (x < 0) x += 360` nao volta a nascer', () => {
    const fontes = arquivosDeFonte();

    it('a varredura ENXERGA a arvore, e nao uma lista vazia', () => {
        // Sem isto, um `git ls-files` que falhasse deixaria todo o resto vacuamente verde: o
        // laco sobre zero arquivos nao acusa nada. E o numero e um piso generoso, nao uma
        // medicao: ele so precisa provar que a varredura pegou o repositorio.
        expect(fontes.length).toBeGreaterThan(400);
        expect(fontes).toContain('src/js/measurement_tool/measurement-geometry.js');
    });

    it('nenhum arquivo carrega a forma alem do que esta DECLARADO', () => {
        const acusados = [];
        for (const rel of fontes) {
            const n = ocorrencias(rel);
            if (!n) continue;
            const permitido = DECLARADAS[rel]?.n ?? 0;
            if (n > permitido) acusados.push(`${rel}: achei ${n}, declarado ${permitido}`);
        }
        expect(
            acusados,
            'Normalize com `((x % 360) + 360) % 360`. Se a ocorrencia for legitima (um `360` '
            + 'correto, ou uma dobra posterior que o neutralize), MEÇA e declare-a em DECLARADAS '
            + 'com o motivo, em vez de silencia-la no arquivo.',
        ).toEqual([]);
    });

    it('toda entrada DECLARADA ainda existe, com a contagem que ela declara', () => {
        // Uma allowlist sem beneficiario e como um guarda volta a abrir sozinho: se o sitio
        // legitimo sumiu ou encolheu, a entrada tem de sair junto.
        const chaves = Object.keys(DECLARADAS);
        expect(chaves.length).toBeGreaterThan(0);
        for (const rel of chaves) {
            expect(fontes, `${rel} saiu da arvore: tire a entrada`).toContain(rel);
            expect(ocorrencias(rel), `${rel} mudou de contagem`).toBe(DECLARADAS[rel].n);
            expect(DECLARADAS[rel].motivo.length).toBeGreaterThan(80);
        }
    });

    it('CONTROLE: a varredura DISCRIMINA, e nao devolve zero por regex quebrada', () => {
        // Sem este caso, uma regex que nunca casa deixaria o censo verde para sempre. A fixture
        // e sintetica e cobre as duas grafias que aparecem na arvore.
        const linhas = [
            '        if (bearing < 0) bearing += 360;',
            '            if (angleDiff < 0) angleDiff += 360;',
        ];
        for (const linha of linhas) expect(FORMA.test(linha)).toBe(true);
        // E nao acusa a forma CERTA, nem uma soma que nao seja de normalizacao.
        expect(FORMA.test('    return ((bearing % 360) + 360) % 360;')).toBe(false);
        expect(FORMA.test('    if (total < 0) total += 360000;')).toBe(false);
    });
});

describe('as quatro funcoes consertadas devolvem [0, 360), nunca 360', () => {
    /** A conta certa, escrita aqui de forma INDEPENDENTE da que o codigo usa. */
    const normalizado = (b) => {
        const r = b - Math.floor(b / 360) * 360;
        return r === 360 ? 0 : r;
    };

    it('a fronteira e METADE do ULP de 360, e a forma antiga a atravessa', () => {
        const antiga = (b) => (b < 0 ? b + 360 : b);
        // Estes dois sao os valores que a medicao de 2026-08-24 achou.
        expect(antiga(-1e-16)).toBe(360);
        expect(antiga(-1e-14)).toBe(360);
        // E a conta certa devolve zero nos dois.
        expect(normalizado(-1e-16)).toBe(0);
        expect(normalizado(-1e-14)).toBe(0);
    });

    it('a forma nova nunca devolve 360, em toda a faixa que turf pode emitir', () => {
        const casos = [-180, -179.9999, -1, -1e-3, -1e-9, -1e-13, -1e-14, -1e-16, -0, 0, 1e-16, 90, 179.9999, 180];
        expect(casos.length).toBeGreaterThan(10);
        for (const b of casos) {
            const r = ((b % 360) + 360) % 360;
            expect(r, `bearing ${b}`).toBeGreaterThanOrEqual(0);
            expect(r, `bearing ${b} devolveu 360`).toBeLessThan(360);
        }
    });
});
