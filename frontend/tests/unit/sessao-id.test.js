// Path: tests/unit/sessao-id.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
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
//   - tire o `sessionStorage` do SINGLETON e "o singleton do produto" reprova nos dois casos
//     novos: a sessão passaria a ser a CARGA da página e não a ABA, e o id se partiria a cada F5,
//     que é o gesto mais comum de quem está com um defeito na tela. Foi o que aconteceu em
//     `fa0f0218` e o que a decisão D5 de 2026-09-13 reverteu.

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
    afterEach(() => {
        delete globalThis.sessionStorage;
        vi.resetModules();
    });

    it('existe, é UUID e é estável (sem `sessionStorage` no processo: é o caso degradado)', () => {
        expect(sessaoId()).toMatch(RE_UUID);
        expect(sessaoId()).toBe(sessaoId());
    });

    it('LIGA-SE ao `sessionStorage` da página, e não à memória', async () => {
        // O PONTO DESTE CASO é a fiação do singleton, que os casos da fábrica não alcançam:
        // eles injetam o armazenamento, então passariam verdes com o singleton só de memória,
        // que foi exatamente o estado que embarcou em `fa0f0218`.
        const armazenamento = criarArmazenamento();
        globalThis.sessionStorage = armazenamento;
        vi.resetModules();

        const modulo = await import('@js/session/sessao-id.js');
        const id = modulo.sessaoId();

        expect(id).toMatch(RE_UUID);
        expect(armazenamento.dados.get(CHAVE_DA_SESSAO)).toBe(id);
        expect(armazenamento.chamadas.set).toBe(1);
    });

    it('SOBREVIVE AO F5: o mesmo armazenamento devolve o mesmo id a uma carga nova', async () => {
        // Uma recarga é um módulo novo sobre o MESMO `sessionStorage`, que é o que
        // `vi.resetModules()` reproduz. Com o singleton só de memória, o id mudaria aqui e a
        // correlação de erro se partiria justamente no gesto de quem está com defeito na tela.
        const armazenamento = criarArmazenamento();
        globalThis.sessionStorage = armazenamento;

        vi.resetModules();
        const primeiraCarga = (await import('@js/session/sessao-id.js')).sessaoId();

        vi.resetModules();
        const segundaCarga = (await import('@js/session/sessao-id.js')).sessaoId();

        expect(segundaCarga).toBe(primeiraCarga);
        // E a segunda carga NÃO cunhou nada: só a primeira gravou.
        expect(armazenamento.chamadas.set).toBe(1);
    });

    it('`sessionStorage` que EXPLODE ao ser lido não derruba o import do módulo', async () => {
        // O acesso à PROPRIEDADE é o que lança com o armazenamento bloqueado, e ele acontece no
        // corpo do módulo, ou seja, na primeira linha do boot das quatro páginas.
        Object.defineProperty(globalThis, 'sessionStorage', {
            configurable: true,
            get() { throw new Error('SecurityError'); },
        });
        vi.resetModules();

        const modulo = await import('@js/session/sessao-id.js');
        expect(modulo.sessaoId()).toMatch(RE_UUID);
        expect(modulo.sessaoId()).toBe(modulo.sessaoId());
    });
});
