// Path: tests/unit/valor-escolhido.test.js

/**
 * @fileoverview O comparador dos specs de cobertura de desenho (`tests/e2e-ui/helpers/valor-escolhido.js`)
 * ignora o que o cliente deriva do zoom e continua enxergando o valor escolhido.
 *
 * As duas metades são obrigatórias. Só a primeira ("a quarta casa decimal não reprova") passaria
 * igual com um comparador que não compara nada; só a segunda não prova que o flake saiu.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
    derivadaDoZoom, valorEscolhido, chavesMudadas, semEscrituracao,
} from '../e2e-ui/helpers/valor-escolhido.js';

/** O retrato do autor e o do servidor, que diferem só na derivação do zoom (medido em integracao_backend). */
const doServidor = {
    lineWidth: 4, zoomCorrection: true, color: '#ff0000',
    calculatedLineWidth: 3.1748, selectionBox: [[0, 0], [1, 1.0001]],
    version: 3, sync: { dirty: false },
};
const doAutor = {
    ...doServidor,
    calculatedLineWidth: 3.1749, selectionBox: [[0, 0], [1, 1.0002]],
    version: 4, sync: { dirty: true },
};

describe('derivadaDoZoom', () => {
    it.each(['calculatedSize', 'calculatedLineWidth', 'calculatedSymbolSize', 'labelCalculatedSize', 'selectionBox'])(
        '%s é derivada', (chave) => expect(derivadaDoZoom(chave)).toBe(true));

    it.each(['size', 'lineWidth', 'labelSize', 'zoomCorrection', 'sizeCreatedAtZoom', 'calculated', 'recalculatedSize', 'nome'])(
        '%s é escolha da pessoa (ou dado), e não derivada', (chave) => expect(derivadaDoZoom(chave)).toBe(false));

    it('todo alvo de correção de zoom que o produto declara cai no filtro', () => {
        // O filtro é por NOME, e o nome é escolhido pela ferramenta (`calculatedProperty` da
        // correção de zoom). Uma ferramenta que derive para um nome fora do padrão voltaria a
        // comparar a derivação calada; este caso a acusa. A lista vem do código, não daqui.
        const raiz = fileURLToPath(new URL('../../', import.meta.url));
        const arquivos = execFileSync('git', ['ls-files', 'src/js'], { cwd: raiz, encoding: 'utf8' })
            .split('\n').filter((f) => f.endsWith('.js'));
        const alvos = new Set();
        for (const f of arquivos) {
            for (const m of readFileSync(`${raiz}${f}`, 'utf8').matchAll(/calculatedProperty:\s*'([A-Za-z]+)'/g)) alvos.add(m[1]);
        }
        expect(alvos.size, 'o censo não achou nenhum alvo: a regex ficou velha').toBeGreaterThan(0);
        expect([...alvos].filter((a) => !derivadaDoZoom(a))).toEqual([]);
    });
});

describe('valorEscolhido e chavesMudadas', () => {
    it('REPRO: autor e servidor que só diferem na derivação do zoom são iguais', () => {
        expect(valorEscolhido(doAutor)).toEqual(valorEscolhido(doServidor));
        expect(chavesMudadas(doServidor, doAutor)).toEqual([]);
        // O controle do instrumento: sem o filtro, a mesma dupla diverge.
        expect(semEscrituracao(doAutor)).not.toEqual(semEscrituracao(doServidor));
    });

    it('o valor escolhido que não chegou continua reprovando', () => {
        const perdido = { ...doAutor, lineWidth: 6 };
        expect(valorEscolhido(perdido)).not.toEqual(valorEscolhido(doServidor));
        expect(chavesMudadas(doServidor, perdido)).toEqual(['lineWidth']);
    });

    it('um campo que só mexe na derivação conta como campo que não grava nada', () => {
        expect(chavesMudadas(doServidor, { ...doServidor, calculatedLineWidth: 9 })).toEqual([]);
    });

    it('tira escrituração e derivação sem tocar o resto, e aceita retrato ausente', () => {
        expect(valorEscolhido(doAutor)).toEqual({ lineWidth: 4, zoomCorrection: true, color: '#ff0000' });
        expect(valorEscolhido(undefined)).toEqual({});
        expect(chavesMudadas(null, { size: 2 })).toEqual(['size']);
    });
});
