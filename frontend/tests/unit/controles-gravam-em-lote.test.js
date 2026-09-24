// Path: tests/unit/controles-gravam-em-lote.test.js

/**
 * @fileoverview Census: the controls' MASS methods write the store with the PLURAL operations.
 *
 * `deleteFeatures`, `saveFeatures` and `updateFeatures` of a drawing control are what the Delete
 * key, the panel's "Salvar" over a multi-selection and the drag of many features end in
 * (`selectionManager.deleteSelectedFeatures` and `updateSelectedFeatures`, the panel buttons). They
 * called `removeFeature` / `updateFeature` once per feature, and each of those reads and writes the
 * WHOLE map document: on a 1 000-point map that was 19 s to delete and 28.6 s to restyle
 * (2026-09-24). They now collect and call `removeFeatures` / `updateFeatures` once, which read and
 * write the document once (`tests/store/gesto-local-em-massa-um-documento.repro.test.js` counts it).
 *
 * WHAT IS FORBIDDEN, mechanically: a call to the SINGULAR `removeFeature(` or `updateFeature(`
 * anywhere in the body of one of those methods (comments stripped), in any file of `src/js/`. A
 * control added tomorrow with the old loop fails here, by name.
 *
 * THE DECLARED EXCEPTIONS are the two terrain analyses, whose save writes the input AND its derived
 * output per feature through `batchUpdateLOSFeatures` / `batchUpdateVisibilityFeatures`, with a
 * fallback that still names `updateFeature`. They are few by nature (an analysis costs seconds of
 * terrain sampling each) and outside the mass gestures this census exists for. Each exception must
 * still be a violation, so the list cannot outlive the code it excuses.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const METODOS = ['deleteFeatures', '_deleteFeaturesUnlocked', 'saveFeatures', '_saveFeaturesUnlocked',
    'updateFeatures', '_updateFeaturesUnlocked'];
const SINGULAR = /\b(removeFeature|updateFeature)\(/;

/** `arquivo#metodo` -> motivo. */
const EXCECOES = new Map([
    ['src/js/analysis_tools/los_tool/add_los_control.js#saveFeatures',
        'grava entrada e saída derivada por análise (batchUpdateLOSFeatures), com recuo por updateFeature'],
    ['src/js/analysis_tools/los_tool/add_los_control.js#updateFeatures',
        'idem: batchUpdateLOSFeatures por análise, com recuo por updateFeature'],
]);

function inventario() {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src/js'],
        { cwd: FRONTEND, encoding: 'utf8' })
        .split('\n').filter(f => f.endsWith('.js'));
}

function semComentarios(codigo) {
    return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** The bodies of the census methods declared in a file, by brace counting from the header. */
function corpos(codigo) {
    const linhas = codigo.split(/\r?\n/);
    const achados = [];
    const cabecalho = new RegExp(
        `^\\s*(?:async\\s+(${METODOS.join('|')})\\s*\\(|(${METODOS.join('|')})\\s*=\\s*async\\b)`);
    for (let i = 0; i < linhas.length; i++) {
        const m = linhas[i].match(cabecalho);
        if (!m) continue;
        let profundidade = 0;
        let abriu = false;
        const corpo = [];
        for (let k = i; k < linhas.length; k++) {
            const semTexto = linhas[k].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');
            for (const ch of semTexto) {
                if (ch === '{') {
                    profundidade++;
                    abriu = true;
                } else if (ch === '}') {
                    profundidade--;
                }
            }
            corpo.push(linhas[k]);
            // A one-line arrow that delegates (`=> this._sourceQueue(...)`) never opens a brace of
            // its own on the header line: it ends at the first line that closes its parenthesis.
            if (abriu && profundidade === 0) break;
            if (!abriu && k > i && /\)\s*;?\s*$/.test(linhas[k])) break;
        }
        achados.push({ metodo: m[1] ?? m[2], corpo: corpo.join('\n') });
    }
    return achados;
}

describe('Censo: os métodos de massa dos controles gravam em lote', () => {
    const arquivos = inventario();
    const varridos = [];
    const violacoes = [];
    for (const arquivo of arquivos) {
        const codigo = semComentarios(readFileSync(path.join(FRONTEND, arquivo), 'utf8'));
        for (const { metodo, corpo } of corpos(codigo)) {
            varridos.push(`${arquivo}#${metodo}`);
            if (SINGULAR.test(corpo)) violacoes.push(`${arquivo}#${metodo}`);
        }
    }

    it('piso: a varredura alcança os controles', () => {
        expect(arquivos.length).toBeGreaterThanOrEqual(400);
        // Twenty-one controls carry at least one of the methods; the floor is below that on purpose.
        expect(varridos.length).toBeGreaterThanOrEqual(40);
        expect(varridos).toContain('src/js/draw_tools/point_tool/add_point_control.js#deleteFeatures');
        expect(varridos).toContain('src/js/draw_tools/point_tool/add_point_control.js#saveFeatures');
        expect(varridos).toContain('src/js/draw_tools/point_tool/add_point_control.js#updateFeatures');
        expect(varridos).toContain('src/js/military_tools/boundary_tool/add_boundary_control.js#_saveFeaturesUnlocked');
    });

    it('nenhum método de massa chama a operação SINGULAR, fora das exceções declaradas', () => {
        expect(violacoes.filter(v => !EXCECOES.has(v))).toEqual([]);
    });

    it('toda exceção declarada ainda é violação (a lista não sobrevive ao código que ela desculpa)', () => {
        for (const chave of EXCECOES.keys()) expect(violacoes).toContain(chave);
    });
});
