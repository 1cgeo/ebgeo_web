// Path: tests/unit/fila-de-relatos.test.js

import { describe, it, expect } from 'vitest';
import { criarFilaDeRelatos, filaDeRelatos, CHAVE_DA_FILA, TETO_DA_FILA } from '@js/session/fila-de-relatos.js';

// A FILA DO QUE NÃO CONSEGUIU SAIR, e o caso em que a telemetria falhava justamente quando era
// mais necessária: o servidor fora do ar. O boot do mapa é fail-fast em `GET /api/config`, então a
// pessoa vê a tela de indisponibilidade e o relato daquele fato é o único que não tem para onde ir.
// Sem fila, um dia inteiro de servidor fora é indistinguível, no banco, de um dia em que ninguém
// abriu o produto.
//
// CONTROLE NEGATIVO — o que fica vermelho ao reverter cada peça:
//
//   - tire o `while (lista.length > teto) lista.shift()` e "o teto corta pelo MAIS VELHO" reprova:
//     um defeito em laço encheria o `localStorage` de todo mundo.
//   - troque o `shift` por `pop` e o mesmo caso reprova pelo outro lado: o que se guarda é o
//     último estado, que é o que explica o desfecho.
//   - tire qualquer `try` e os três casos de armazenamento hostil passam a LANÇAR, dentro do
//     caminho de tratamento de um erro, que é o pior lugar possível para levantar um segundo.
//   - tire o `Array.isArray` e "JSON corrompido" reprova com um erro de tipo mais adiante.
//   - tire o `removeItem` de `drenar` e "drenar esvazia" reprova: o próximo boot reenviaria tudo,
//     e relato duplicado é contagem falsa.

/** Um armazenamento de mentira. */
function criarArmazenamento(inicial = {}) {
    const dados = new Map(Object.entries(inicial));
    return {
        dados,
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: (k) => { dados.delete(k); },
    };
}

/** Um armazenamento cheio: `setItem` estoura, como o de uma cota esgotada. */
function criarArmazenamentoCheio() {
    const dados = new Map();
    return {
        dados,
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem() { throw new Error('QuotaExceededError'); },
        removeItem: (k) => { dados.delete(k); },
    };
}

/** Um armazenamento que recusa até a leitura, como o de uma aba em modo privado. */
function criarArmazenamentoHostil() {
    return {
        getItem() { throw new Error('SecurityError'); },
        setItem() { throw new Error('SecurityError'); },
        removeItem() { throw new Error('SecurityError'); },
    };
}

/** @returns {Object} Um corpo de relato reconhecível. */
function corpo(n) {
    return { assinatura: `s${n}@a.js:1`, mensagem: `erro ${n}`, pagina: 'mapa' };
}

describe('fila: guardar e devolver', () => {
    it('enfileira, conta e devolve na ordem em que entrou', () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        expect(fila.tamanho()).toBe(0);
        expect(fila.enfileirar(corpo(1))).toBe(true);
        fila.enfileirar(corpo(2));
        expect(fila.tamanho()).toBe(2);
        expect(fila.drenar().map((c) => c.mensagem)).toEqual(['erro 1', 'erro 2']);
    });

    it('drenar ESVAZIA (senão o próximo boot reenviaria tudo)', () => {
        const armazenamento = criarArmazenamento();
        const fila = criarFilaDeRelatos({ storage: armazenamento });
        fila.enfileirar(corpo(1));
        fila.drenar();
        expect(fila.tamanho()).toBe(0);
        expect(fila.drenar()).toEqual([]);
        expect(armazenamento.dados.has(CHAVE_DA_FILA)).toBe(false);
    });

    it('grava sob a chave prefixada, e como JSON', () => {
        const armazenamento = criarArmazenamento();
        criarFilaDeRelatos({ storage: armazenamento }).enfileirar(corpo(1));
        const cru = armazenamento.dados.get(CHAVE_DA_FILA);
        expect(typeof cru).toBe('string');
        expect(JSON.parse(cru)).toHaveLength(1);
    });

    it('só objeto entra: o que não é corpo é recusado sem lançar', () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        for (const lixo of [null, undefined, 'texto', 42, true]) {
            expect(fila.enfileirar(lixo)).toBe(false);
        }
        expect(fila.tamanho()).toBe(0);
    });
});

describe('fila: o teto corta pelo MAIS VELHO', () => {
    it('o teto padrão é trinta', () => {
        expect(TETO_DA_FILA).toBe(30);
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        for (let i = 0; i < 40; i++) fila.enfileirar(corpo(i));
        expect(fila.tamanho()).toBe(30);
    });

    it('quem cai é o MAIS VELHO, e o mais novo sobrevive', () => {
        // Numa sessão que degrada é o ÚLTIMO estado que explica o desfecho.
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento(), teto: 3 });
        for (let i = 1; i <= 5; i++) fila.enfileirar(corpo(i));
        expect(fila.drenar().map((c) => c.mensagem)).toEqual(['erro 3', 'erro 4', 'erro 5']);
    });

    it('uma fila MAIOR que o teto (teto reduzido entre versões) é aparada até caber', () => {
        const guardados = JSON.stringify(Array.from({ length: 9 }, (_, i) => corpo(i)));
        const armazenamento = criarArmazenamento({ [CHAVE_DA_FILA]: guardados });
        const fila = criarFilaDeRelatos({ storage: armazenamento, teto: 3 });
        fila.enfileirar(corpo(99));
        expect(fila.tamanho()).toBe(3);
        expect(fila.drenar().at(-1).mensagem).toBe('erro 99');
    });
});

describe('fila: toda falha degrada para "não enfileira", nunca para exceção', () => {
    it('armazenamento AUSENTE', () => {
        const fila = criarFilaDeRelatos({ storage: null });
        expect(() => fila.enfileirar(corpo(1))).not.toThrow();
        expect(fila.enfileirar(corpo(1))).toBe(false);
        expect(fila.tamanho()).toBe(0);
        expect(fila.drenar()).toEqual([]);
    });

    it('armazenamento CHEIO (cota estourada no `setItem`)', () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamentoCheio() });
        expect(fila.enfileirar(corpo(1))).toBe(false);
        expect(fila.tamanho()).toBe(0);
    });

    it('armazenamento HOSTIL (lança até na leitura)', () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamentoHostil() });
        expect(() => fila.enfileirar(corpo(1))).not.toThrow();
        expect(() => fila.drenar()).not.toThrow();
        expect(fila.tamanho()).toBe(0);
    });

    it('JSON CORROMPIDO vira fila vazia, e a escrita seguinte recomeça', () => {
        for (const lixo of ['{{{', 'null', '"texto"', '42', '{"a":1}']) {
            const armazenamento = criarArmazenamento({ [CHAVE_DA_FILA]: lixo });
            const fila = criarFilaDeRelatos({ storage: armazenamento });
            expect(fila.tamanho()).toBe(0);
            expect(fila.drenar()).toEqual([]);
            expect(fila.enfileirar(corpo(1))).toBe(true);
            expect(fila.tamanho()).toBe(1);
        }
    });

    it('itens que não são objeto DENTRO do array guardado são descartados na leitura', () => {
        const armazenamento = criarArmazenamento({
            [CHAVE_DA_FILA]: JSON.stringify([corpo(1), null, 'texto', 42, corpo(2)]),
        });
        const fila = criarFilaDeRelatos({ storage: armazenamento });
        expect(fila.drenar().map((c) => c.mensagem)).toEqual(['erro 1', 'erro 2']);
    });
});

describe('o singleton do produto', () => {
    it('existe e é inerte em node, onde não há `localStorage`', () => {
        expect(() => filaDeRelatos.enfileirar(corpo(1))).not.toThrow();
        expect(typeof filaDeRelatos.tamanho()).toBe('number');
        expect(Array.isArray(filaDeRelatos.drenar())).toBe(true);
    });
});
