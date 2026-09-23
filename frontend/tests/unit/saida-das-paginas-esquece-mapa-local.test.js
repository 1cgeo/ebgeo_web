// Path: tests/unit/saida-das-paginas-esquece-mapa-local.test.js

/**
 * @fileoverview A SAIDA DA CONTA EM QUALQUER PAGINA ESQUECE A INTENCAO "MAPA LOCAL" (2026-09-23).
 *
 * A intencao mora em `sessionStorage` e e da sessao que a escolheu. O mapa sempre a limpou ao sair
 * (`AccountControl._handleLogout`); as tres paginas sem mapa nao, e a intencao viva levava a PROXIMA
 * conta daquela aba, na primeira abertura de atlas que falhasse, ao ramo do mapa local em vez do
 * seletor. Foi a outra metade da falha da matriz de 2026-09-22: a cadeia medida por
 * `tests/e2e-ui/abertura-remota-que-falha.repro.spec.js` (caso 4) le `"1"` em `ebgeo_local_intent`
 * depois da saida por `atlas.html`, sem este passo.
 *
 * O RECORTE E ESTRUTURAL porque as tres paginas bootam no import (nao ha como chamar `endSession`
 * de fora), e o comportamento da de `atlas.html` e medido pelo caso 4 daquele spec. A regra cobra a
 * CHAMADA dentro de `endSession`, e nao o import: um import sem chamada passaria.
 *
 * CONTROLE NEGATIVO, feito ao escrever: tirar a chamada de qualquer uma das tres deixa o caso dela
 * vermelho, e o caso do recorte prova que a funcao foi lida ate o fim.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js');

const PAGINAS = Object.freeze([
    'projects/projects-page.js',
    'admin/admin-page.js',
    'calibration/calibracao-page.js',
]);

/**
 * O corpo de `endSession`, sem comentarios, do cabecalho ate o `}` que fecha na coluna zero.
 * @param {string} rel
 * @returns {string}
 */
function corpoDeEndSession(rel) {
    // CRLF NORMALIZADO: a arvore de trabalho no Windows tem os fontes em CRLF, e um `\n}\n` cru
    // nao acharia o fecho de funcao nenhuma.
    const fonte = readFileSync(resolve(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
    const inicio = fonte.indexOf('async function endSession(');
    expect(inicio, `${rel} nao tem endSession`).toBeGreaterThan(-1);
    const fim = fonte.indexOf('\n}\n', inicio);
    expect(fim, `${rel}: endSession sem fechamento`).toBeGreaterThan(inicio);
    return fonte.slice(inicio, fim + 2)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

describe('a saida da conta nas paginas sem mapa esquece a intencao "Mapa local"', () => {
    for (const rel of PAGINAS) {
        it(`${rel}: endSession chama clearLocalMapIntent()`, () => {
            const corpo = corpoDeEndSession(rel);
            expect(corpo).toMatch(/\bclearLocalMapIntent\(\)/);
            // Controle do recorte: a funcao foi lida ate a navegacao final, que e a ultima linha.
            expect(corpo).toMatch(/window\.location\.replace\(/);
        });

        it(`${rel}: o import vem da folha, pelo arquivo e nunca por barril`, () => {
            // A FORMA DO CAMINHO NAO E O ASSUNTO: o alias (`@js/deep-link/local-intent.js`) e a
            // forma da casa para codigo novo, e `projects-page.js` ja importava a folha pelo caminho
            // relativo antes deste passo. O que importa e que seja a FOLHA, porque as tres paginas
            // bootam sem a store e um barril a arrastaria de volta.
            const fonte = readFileSync(resolve(SRC, rel), 'utf8');
            expect(fonte).toMatch(
                /import \{[^}]*\bclearLocalMapIntent\b[^}]*\} from '(?:@js|\.\.)\/deep-link\/local-intent\.js';/);
        });
    }
});
