// Path: tests/unit/progresso-de-carga-da-cena.test.js

/**
 * @fileoverview A BARRA DE CARGA DA CENA CAMINHÁVEL, que ia a cem por cento em dois segundos.
 *
 * A cena baixa um splat de mais de 20 MB, e a tela de carregamento tinha uma barra animada por
 * `@keyframes` de zero a cem em dois segundos, sem relação com a rede: ela terminava cheia com
 * 18 MB ainda por vir. Isso é pior que barra nenhuma, porque ensina a pessoa a desconfiar da
 * próxima, e num enlace de campo a espera com a barra cheia se lê como travamento.
 *
 * O QUE ESTE ARQUIVO PRENDE é a tradução de bytes em fração e em frase, que é pura. O leitor de
 * fluxo e a pintura da barra ficam de fora: o primeiro precisa de `Response`, a segunda de DOM.
 *
 * O CASO QUE DECIDE A FORMA É O SEM TOTAL. `Content-Length` some com resposta em pedaços e com
 * CORS que não expõe o cabeçalho, e ali não existe percentual possível. A escolha foi dizer
 * quanto JÁ VEIO, que é fato, e devolver `null` para a barra ficar indeterminada, em vez de
 * inventar um teto: número inventado numa barra é a mesma mentira da animação de dois segundos,
 * só que mais difícil de perceber.
 */

import { describe, it, expect } from 'vitest';
import {
    emMegabytes,
    fracaoBaixada,
    fraseDeProgresso,
    totalAnunciado,
    PESO_QUE_MERECE_AVISO,
} from '../../src/js/first_person_3d_tool/progresso-de-carga.js';

const MB = 1024 * 1024;

describe('fracaoBaixada', () => {
    it('a fração é a razão simples quando há total', () => {
        expect(fracaoBaixada(5 * MB, 20 * MB)).toBeCloseTo(0.25, 10);
    });

    it('SEM TOTAL devolve null, e não zero', () => {
        // Zero seria uma posição, e posição é uma afirmação: a barra ficaria parada no começo
        // dizendo que nada veio, enquanto os bytes chegam. `null` é a ausência de afirmação.
        for (const total of [null, undefined, 0, -1, Number.NaN]) {
            expect(fracaoBaixada(5 * MB, total), `total ${total}`).toBeNull();
        }
    });

    it('SATURA EM 1: um corpo comprimido entrega mais bytes que o cabeçalho anunciou', () => {
        // Sem o teto a barra passaria de cem por cento e desmentiria a si mesma na última tela
        // que a pessoa olha antes de a cena abrir.
        expect(fracaoBaixada(30 * MB, 20 * MB)).toBe(1);
    });

    it('recebido inválido degrada para zero, e não para NaN', () => {
        // Um `NaN` na largura é ignorado pelo CSS em silêncio, e a barra congela onde estava.
        for (const recebidos of [Number.NaN, -5, undefined]) {
            expect(fracaoBaixada(recebidos, 20 * MB), `recebidos ${recebidos}`).toBe(0);
        }
    });
});

describe('emMegabytes', () => {
    it('usa kB abaixo de um megabyte, onde a casa decimal seria ruído', () => {
        expect(emMegabytes(512 * 1024)).toBe('512 kB');
    });

    it('usa MB com uma casa e vírgula, que é a escrita da casa', () => {
        expect(emMegabytes(21.5 * MB)).toBe('21,5 MB');
        expect(emMegabytes(1 * MB)).toBe('1,0 MB');
    });

    it('valor inválido some da frase em vez de escrever `NaN` na tela', () => {
        for (const ruim of [Number.NaN, -1, undefined, null]) {
            expect(emMegabytes(ruim), `entrada ${ruim}`).toBe('');
        }
    });
});

describe('fraseDeProgresso', () => {
    it('com total, diz quanto veio de quanto', () => {
        expect(fraseDeProgresso(5 * MB, 20 * MB))
            .toBe('Carregando o modelo 3D... 5,0 MB de 20,0 MB, cena pesada');
    });

    it('a CENA PESADA só é anunciada acima do limiar', () => {
        // O aviso existe para justificar a espera; numa cena pequena ele seria alarme falso.
        const leve = fraseDeProgresso(1 * MB, PESO_QUE_MERECE_AVISO - MB);
        expect(leve).not.toContain('pesada');
        const pesada = fraseDeProgresso(1 * MB, PESO_QUE_MERECE_AVISO + MB);
        expect(pesada).toContain('cena pesada');
    });

    it('SEM total, diz o fato que existe: quanto já veio', () => {
        const frase = fraseDeProgresso(7 * MB, null);
        expect(frase).toBe('Carregando o modelo 3D... 7,0 MB');
        expect(frase).not.toContain('de ');
        expect(frase).not.toContain('%');
    });
});

describe('totalAnunciado', () => {
    it('lê o cabeçalho quando ele existe', () => {
        const resposta = { headers: { get: (k) => (k === 'content-length' ? '2048' : null) } };
        expect(totalAnunciado(resposta)).toBe(2048);
    });

    it('cabeçalho ausente, vazio ou absurdo vira null', () => {
        // `Number(null)` é 0 e `Number('')` é 0, e um zero como denominador espalharia `Infinity`
        // pela fração: as três formas precisam cair no mesmo lugar.
        for (const valor of [null, '', 'abc', '0', '-10']) {
            const resposta = { headers: { get: () => valor } };
            expect(totalAnunciado(resposta), `valor ${JSON.stringify(valor)}`).toBeNull();
        }
    });

    it('resposta sem cabeçalhos não estoura o carregamento', () => {
        // O duplo de um teste, e um navegador antigo, entregam resposta sem `headers`.
        expect(totalAnunciado({})).toBeNull();
        expect(totalAnunciado(null)).toBeNull();
    });
});
