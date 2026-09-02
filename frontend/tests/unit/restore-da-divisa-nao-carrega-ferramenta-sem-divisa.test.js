// Path: tests/unit/restore-da-divisa-nao-carrega-ferramenta-sem-divisa.test.js
/**
 * @fileoverview O RESTORE DOS DEPENDENTES DA DIVISA NÃO PODE CARREGAR A FERRAMENTA
 * NUM MAPA SEM DIVISA, e nenhuma suíte de execução consegue provar isso.
 *
 * `restoreBoundaryDependentFeatures` (`layers/layer_setup.js`) roda em TODO boot
 * do mapa, dentro do rAF de `setupMapFeatures`. Ela fala com o stand-in do
 * registro de ferramentas, e o método `rebuildAllDependentFeatures` é um
 * ENCAMINHADO: chamá-lo dispara `ensureControl`, que baixa o chunk da divisa e o
 * Turf (~619 kB). A primeira versão chamava o encaminhado incondicionalmente,
 * inclusive com a lista vazia, e desfazia em silêncio a decisão de carga tardia
 * de 2026-08-25 para cem por cento das sessões: nenhum teste ficou vermelho,
 * porque o teto de peso só enxerga import ESTÁTICO e o encaminhado é dinâmico.
 *
 * Esta varredura lê a função como texto e cobra a ORDEM que fecha os dois modos
 * de falha medidos na revisão de 2026-09-01:
 *
 *   1. as duas sources derivadas são esvaziadas de forma SÍNCRONA antes de
 *      qualquer consulta ao controle, senão trocar de mapa com o mesmo basemap
 *      mostra os rótulos e círculos do mapa anterior até o rebuild assíncrono;
 *   2. o encaminhado só é chamado atrás de uma guarda de lista vazia.
 *
 * Leitura de fonte prova que a linha existe, nunca que ela roda; o caso de
 * controle no fim prova que a própria varredura discrimina.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ARQUIVO = 'src/js/layers/layer_setup.js';

/** Strips line and block comments so a commented-out line cannot satisfy an assertion. */
function semComentarios(codigo) {
    return codigo
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

/** Extracts the body of `restoreBoundaryDependentFeatures` from the source text. */
function corpoDoRestore(fonte) {
    const normalizado = fonte.replace(/\r\n/g, '\n');
    const inicio = normalizado.indexOf('function restoreBoundaryDependentFeatures(');
    if (inicio === -1) return '';
    const fim = normalizado.indexOf('\n}\n', inicio);
    if (fim === -1) return '';
    return semComentarios(normalizado.slice(inicio, fim));
}

/**
 * The predicate under test, shared by the real source and the synthetic controls:
 * both derived sources are cleared before the control is consulted, and the
 * forwarded rebuild sits behind an empty-list guard.
 */
function respeitaAOrdem(corpo) {
    const limpaCirculos = corpo.indexOf("getSource('boundary-circles')?.setData(");
    const limpaTextos = corpo.indexOf("getSource('boundary-texts')?.setData(");
    const consultaControle = corpo.indexOf("getControl('AddBoundaryControl')");
    const guarda = corpo.indexOf('if (validBoundaries.length === 0) return;');
    const rebuild = corpo.indexOf('rebuildAllDependentFeatures(');

    const todosPresentes = [limpaCirculos, limpaTextos, consultaControle, guarda, rebuild]
        .every((indice) => indice !== -1);
    if (!todosPresentes) return false;

    return limpaCirculos < consultaControle
        && limpaTextos < consultaControle
        && guarda < rebuild;
}

describe('restoreBoundaryDependentFeatures não carrega a ferramenta sem divisa', () => {
    const fonte = readFileSync(path.join(RAIZ, ARQUIVO), 'utf8');
    const corpo = corpoDoRestore(fonte);

    it('a varredura acha a função com um corpo de verdade, senão passaria verde sobre nada', () => {
        expect(corpo.length).toBeGreaterThan(500);
        expect(corpo).toContain('validBoundaries');
    });

    it('esvazia as duas sources derivadas ANTES de consultar o controle, e sincronamente', () => {
        expect(corpo.indexOf("getSource('boundary-circles')?.setData(")).toBeGreaterThan(-1);
        expect(corpo.indexOf("getSource('boundary-texts')?.setData(")).toBeGreaterThan(-1);
        const consulta = corpo.indexOf("getControl('AddBoundaryControl')");
        expect(corpo.indexOf("getSource('boundary-circles')?.setData(")).toBeLessThan(consulta);
        expect(corpo.indexOf("getSource('boundary-texts')?.setData(")).toBeLessThan(consulta);
    });

    it('só chama o encaminhado rebuildAllDependentFeatures atrás da guarda de lista vazia', () => {
        const chamadas = corpo.match(/rebuildAllDependentFeatures\(/g) || [];
        expect(chamadas).toHaveLength(1);
        expect(corpo.indexOf('if (validBoundaries.length === 0) return;'))
            .toBeLessThan(corpo.indexOf('rebuildAllDependentFeatures('));
        expect(respeitaAOrdem(corpo)).toBe(true);
    });

    it('CONTROLE: a varredura reprova a forma que custava 619 kB por boot', () => {
        // The exact shape the review caught: forwarded call with no guard, and the
        // clearing hidden behind a dead `if (!boundaryControl)` branch.
        const semGuarda = [
            "const boundaryControl = getControl('AddBoundaryControl');",
            'if (!boundaryControl) {',
            "    mapInstance.getSource('boundary-circles')?.setData(emptyCollection);",
            "    mapInstance.getSource('boundary-texts')?.setData(emptyCollection);",
            '    return;',
            '}',
            'const validBoundaries = [];',
            'boundaryControl.rebuildAllDependentFeatures(validBoundaries);',
        ].join('\n');
        expect(respeitaAOrdem(semGuarda)).toBe(false);

        // And a commented-out guard must not count as a guard.
        const guardaComentada = corpo.replace(
            'if (validBoundaries.length === 0) return;',
            '// if (validBoundaries.length === 0) return;'
        );
        expect(respeitaAOrdem(semComentarios(guardaComentada))).toBe(false);
    });
});
