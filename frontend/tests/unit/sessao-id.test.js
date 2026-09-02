// Path: tests/unit/sessao-id.test.js

import { describe, it, expect } from 'vitest';
import { criarSessaoId, sessaoId, CHAVE_DA_SESSAO } from '@js/session/sessao-id.js';

// O ID DESTA ABA, e as três propriedades que ele tem de ter.
//
// Ele existe para separar "cinco pessoas com o mesmo defeito" de "uma pessoa cinco vezes" — duas
// leituras que pedem respostas opostas e que eram indistinguíveis no relato de erro. O mesmo valor
// viaja no cabeçalho `X-EBGeo-Sessao` de todo pedido REST, e é ele que costura o relato do
// navegador com a linha que o servidor escreveu no mesmo instante.
//
// CONTROLE NEGATIVO — o que fica vermelho ao reverter cada peça:
//
//   - tire a memorização e "cunha UMA vez" reprova: cada chamada sortearia um id novo, e um
//     relato deixaria de casar com o pedido que o produziu.
//   - tire o `getItem` (ou a persistência) e "duas fábricas sobre o MESMO armazenamento" reprova:
//     um `import()` repetido do módulo daria dois ids na mesma aba.
//   - tire qualquer `try` e "armazenamento que EXPLODE" reprova lançando, e um `throw` daqui cai
//     na primeira linha do boot das quatro páginas.
//   - tire a validação de forma e "id guardado com forma errada" reprova: o valor iria ao servidor
//     e o 422 derrubaria o relato INTEIRO por causa do campo mais dispensável dele.

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Um armazenamento de mentira, com contadores. */
function criarArmazenamento(inicial = {}) {
    const dados = new Map(Object.entries(inicial));
    const chamadas = { get: 0, set: 0 };
    return {
        dados,
        chamadas,
        getItem(k) { chamadas.get++; return dados.has(k) ? dados.get(k) : null; },
        setItem(k, v) { chamadas.set++; dados.set(k, String(v)); },
        removeItem(k) { dados.delete(k); },
    };
}

/** Um armazenamento que recusa tudo, como o de uma aba em modo privado. */
function criarArmazenamentoHostil() {
    return {
        getItem() { throw new Error('SecurityError'); },
        setItem() { throw new Error('QuotaExceededError'); },
        removeItem() { throw new Error('SecurityError'); },
    };
}

describe('sessaoId: cunha uma vez, reusa sempre', () => {
    it('devolve um UUID', () => {
        const id = criarSessaoId({ storage: criarArmazenamento() })();
        expect(id).toMatch(RE_UUID);
    });

    it('CUNHA UMA VEZ SÓ: dez chamadas, um sorteio', () => {
        let sorteios = 0;
        const gerar = criarSessaoId({
            storage: criarArmazenamento(),
            uuid: () => { sorteios++; return `0000000${sorteios}-0000-4000-8000-000000000000`; },
        });
        const ids = Array.from({ length: 10 }, () => gerar());
        expect(sorteios).toBe(1);
        expect(new Set(ids).size).toBe(1);
    });

    it('GRAVA no armazenamento, sob a chave prefixada', () => {
        const armazenamento = criarArmazenamento();
        const id = criarSessaoId({ storage: armazenamento })();
        expect(armazenamento.dados.get(CHAVE_DA_SESSAO)).toBe(id);
    });

    it('duas fábricas sobre o MESMO armazenamento devolvem o MESMO id', () => {
        // É o caso real de um segundo `import()` do módulo na mesma aba (HMR, chunk lazy): sem a
        // persistência, a mesma aba teria dois ids e o relato deixaria de casar com o pedido.
        const armazenamento = criarArmazenamento();
        const primeiro = criarSessaoId({ storage: armazenamento })();
        const segundo = criarSessaoId({ storage: armazenamento })();
        expect(segundo).toBe(primeiro);
    });

    it('reusando, ele NÃO sorteia de novo', () => {
        const armazenamento = criarArmazenamento({
            [CHAVE_DA_SESSAO]: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        });
        let sorteios = 0;
        const id = criarSessaoId({ storage: armazenamento, uuid: () => { sorteios++; return 'x'; } })();
        expect(id).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
        expect(sorteios).toBe(0);
    });
});

describe('sessaoId: degrada, e nunca lança', () => {
    it('armazenamento AUSENTE devolve id de memória, estável na vida da página', () => {
        const gerar = criarSessaoId({ storage: null });
        const id = gerar();
        expect(id).toMatch(RE_UUID);
        expect(gerar()).toBe(id);
    });

    it('armazenamento que EXPLODE nas duas pontas não lança e ainda dá id', () => {
        const gerar = criarSessaoId({ storage: criarArmazenamentoHostil() });
        let id;
        expect(() => { id = gerar(); }).not.toThrow();
        expect(id).toMatch(RE_UUID);
        expect(gerar()).toBe(id);
    });

    it('id guardado com FORMA ERRADA é descartado e recunhado', () => {
        for (const lixo of ['', 'nao-e-uuid', '{}', '3f2504e0-4f89-11d3-9a0c', '   ']) {
            const armazenamento = criarArmazenamento({ [CHAVE_DA_SESSAO]: lixo });
            const id = criarSessaoId({ storage: armazenamento })();
            expect(id).toMatch(RE_UUID);
            expect(armazenamento.dados.get(CHAVE_DA_SESSAO)).toBe(id);
        }
    });

    it('cunhador que devolve lixo, ou que EXPLODE, cai no sorteio de reserva', () => {
        expect(criarSessaoId({ storage: null, uuid: () => 'nada disso' })()).toMatch(RE_UUID);
        expect(criarSessaoId({ storage: null, uuid: () => { throw new Error('sem crypto'); } })())
            .toMatch(RE_UUID);
    });

    it('o sorteio de reserva produz UUIDs distintos', () => {
        const ids = new Set(
            Array.from({ length: 50 }, () => criarSessaoId({
                storage: null,
                uuid: () => { throw new Error('sem randomUUID'); },
            })()),
        );
        expect(ids.size).toBe(50);
    });
});

describe('o singleton do produto', () => {
    it('existe, é UUID e é estável (em node não há `sessionStorage`: é o caso degradado)', () => {
        expect(sessaoId()).toMatch(RE_UUID);
        expect(sessaoId()).toBe(sessaoId());
    });
});
