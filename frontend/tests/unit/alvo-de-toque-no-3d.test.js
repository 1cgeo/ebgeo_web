// Path: tests/unit/alvo-de-toque-no-3d.test.js

/**
 * @fileoverview O RETÂNGULO DE ACERTO DA CENA 3D, que era de três pixels para todo mundo.
 *
 * `scene.pick` do Cesium aceita a largura e a altura do retângulo em que procurar, e sem elas usa
 * TRÊS pixels, que é a régua de um mouse. Os três sítios que escolhem um ALVO (o marcador, a
 * seleção fora da ferramenta e o balão de comentário) chamavam com um argumento só: num tablet,
 * acertar um marcador exigia o dedo a menos de um pixel e meio do centro.
 *
 * O CENSO É A METADE QUE IMPORTA, e ele separa duas famílias que se parecem no código e não são a
 * mesma coisa. `scene.pick` procura um ALVO numa vizinhança, e ali o retângulo é o conserto;
 * `scene.pickPosition` lê a profundidade do pixel EXATO para descobrir ONDE no mundo o gesto
 * caiu, e ali um retângulo não significa nada. Por isso o censo mira só a primeira, e carrega por
 * extenso as duas chamadas de um argumento que são legítimas.
 *
 * O QUE ELE NÃO PROVA: que o dedo acerte. Isso é o visualizador 3D com um modelo de verdade, e é
 * do Playwright.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    larguraDeAcerto,
    escolherAlvo,
    LARGURA_DE_ACERTO_PX,
    LARGURA_DE_ACERTO_PX_TOQUE,
} from '../../src/js/3d_models_viewer_tool/services/pick-de-alvo.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('a folga do retângulo de busca', () => {
    it('no mouse é o padrão do Cesium, e sob um dedo é a régua do dedo', () => {
        expect(larguraDeAcerto(false)).toBe(LARGURA_DE_ACERTO_PX);
        expect(larguraDeAcerto(true)).toBe(LARGURA_DE_ACERTO_PX_TOQUE);
        expect(LARGURA_DE_ACERTO_PX).toBe(3);
        expect(LARGURA_DE_ACERTO_PX_TOQUE).toBeGreaterThan(LARGURA_DE_ACERTO_PX);
    });

    it('é um QUADRADO: o Cesium recebe o mesmo número duas vezes', () => {
        // Passar só a largura deixa a altura no padrão de três, e o alvo fica uma fita horizontal:
        // fácil de acertar de lado, impossível de acertar por cima.
        const chamadas = [];
        const scene = { pick: (...args) => { chamadas.push(args); return 'alvo'; } };

        expect(escolherAlvo(scene, { x: 10, y: 20 })).toBe('alvo');
        expect(chamadas).toHaveLength(1);
        const [posicao, largura, altura] = chamadas[0];
        expect(posicao).toEqual({ x: 10, y: 20 });
        expect(largura).toBe(altura);
        expect(Number.isFinite(largura)).toBe(true);
    });

    it('cena ausente não estoura o gesto', () => {
        // O clique chega de um `ScreenSpaceEventHandler` que pode sobreviver ao viewer por um
        // quadro; explodir ali derruba o handler inteiro e o 3D deixa de responder a clique.
        expect(escolherAlvo(null, { x: 0, y: 0 })).toBeUndefined();
        expect(escolherAlvo({}, { x: 0, y: 0 })).toBeUndefined();
    });
});

describe('censo: nenhum alvo da cena volta a ser procurado em três pixels', () => {
    /**
     * As chamadas de UM argumento que são legítimas, com o motivo.
     *
     * As duas estão no caminho de POSIÇÃO e não no de alvo: a primeira aquece o buffer de
     * profundidade antes do `pickPosition` da linha seguinte (idioma conhecido do Cesium, e o
     * retorno dela é jogado fora), e a segunda pergunta apenas se existe QUALQUER coisa sob o
     * cursor antes de ler a profundidade daquele pixel. Alargar as duas faria a pergunta falar de
     * uma vizinhança enquanto a leitura seguinte fala de um pixel, que é pior que ficar como está.
     */
    const EXCECOES = Object.freeze([
        'src/js/3d_models_viewer_tool/services/cesium-measure.js',
        'src/js/3d_models_viewer_tool/services/viewshed-3d.js',
    ]);

    const arquivos = execSync('git ls-files "frontend/src/js/**/*.js"', {
        cwd: resolve(FRONT, '..'),
        encoding: 'utf8',
    }).split('\n').filter(Boolean);

    it('piso: a varredura achou os arquivos', () => {
        expect(arquivos.length).toBeGreaterThan(300);
    });

    it('toda busca de ALVO passa por `escolherAlvo`', () => {
        const infratores = [];
        for (const rel of arquivos) {
            const caminho = rel.replace(/^frontend\//, '');
            if (EXCECOES.includes(caminho)) continue;
            const fonte = readFileSync(join(FRONT, '..', rel), 'utf8');
            // `scene.pick(` com UM argumento: sem vírgula antes do fecho do parêntese. A
            // fronteira é de PALAVRA e não um ponto, porque em `viewshed-3d.js` a cena é uma variável
            // local e a chamada não tem prefixo nenhum: com o ponto obrigatório a varredura
            // passava ao largo dela, e o teto das exceções teria ficado guardando o vazio.
            for (const m of fonte.matchAll(/\bscene\.pick\(([^),]*)\)/g)) {
                infratores.push(`${caminho} :: scene.pick(${m[1].trim()})`);
            }
        }
        expect(infratores, 'alvo da cena procurado no padrão de três pixels').toEqual([]);
    });

    it('e as exceções declaradas ainda EXISTEM, senão o censo afrouxou sozinho', () => {
        // Sem isto, apagar uma das duas chamadas deixaria uma permissão pendurada e o próximo
        // `scene.pick` daquele arquivo entraria sem ninguém notar.
        for (const caminho of EXCECOES) {
            const fonte = readFileSync(join(FRONT, caminho), 'utf8');
            expect(fonte, `${caminho} não tem mais a chamada que a exceção cobre`)
                .toMatch(/\bscene\.pick\([^),]*\)/);
        }
    });
});
