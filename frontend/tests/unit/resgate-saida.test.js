// Path: tests/unit/resgate-saida.test.js
//
// QUANDO A SAÍDA "ENVIAR AS PENDÊNCIAS A ESTE ATLAS" APARECE (decisão do dono de 2026-09-26): só
// para a conta que escreveu a fila, só para o atlas de onde veio o resgate, e só enquanto a cópia
// não foi editada depois dele. O caminho inteiro (a pergunta, o envio sem apagar) é medido em
// `tests/integration/reabrir-projeto-resgatado.repro.test.js`; aqui fica a tabela.

import { describe, it, expect } from 'vitest';
import {
    SaidaDoResgate, perguntaDoResgate, podeEnviarPendencias, pendenciasDevolvidas,
} from '@js/account/resgate-saida.js';

const ATLAS = 'atlas-1';
const CONTA = 'conta-a';
const entrada = (resgate) => ({ id: 'slot', name: 'Alfa', resgate });

describe('podeEnviarPendencias', () => {
    it('a mesma conta, o mesmo atlas e a cópia intocada: sim', () => {
        expect(podeEnviarPendencias({ entrada: entrada({ atlasId: ATLAS, em: 1 }), atlasId: ATLAS, conta: CONTA, autor: CONTA })).toBe(true);
    });

    it.each([
        ['outra conta', { entrada: entrada({ atlasId: ATLAS, em: 1 }), atlasId: ATLAS, conta: CONTA, autor: 'conta-b' }],
        ['autor desconhecido', { entrada: entrada({ atlasId: ATLAS, em: 1 }), atlasId: ATLAS, conta: CONTA, autor: null }],
        ['sem conta', { entrada: entrada({ atlasId: ATLAS, em: 1 }), atlasId: ATLAS, conta: null, autor: null }],
        ['conta vazia igual a autor vazio', { entrada: entrada({ atlasId: ATLAS, em: 1 }), atlasId: ATLAS, conta: '', autor: '' }],
        ['editada depois do resgate', { entrada: entrada({ atlasId: ATLAS, em: 1, editadoEm: 2 }), atlasId: ATLAS, conta: CONTA, autor: CONTA }],
        ['resgate de outro atlas', { entrada: entrada({ atlasId: 'atlas-2', em: 1 }), atlasId: ATLAS, conta: CONTA, autor: CONTA }],
        ['slot resgatado antes de a origem ser gravada', { entrada: entrada(undefined), atlasId: ATLAS, conta: CONTA, autor: CONTA }],
        ['sem entrada', { entrada: null, atlasId: ATLAS, conta: CONTA, autor: CONTA }],
    ])('%s: não', (_, args) => {
        expect(podeEnviarPendencias(args)).toBe(false);
    });
});

describe('a pergunta', () => {
    it('com a saída nova, três escolhas e o nome do atlas local', () => {
        const p = perguntaDoResgate('Alfa', true);
        expect(p.escolhas.map((e) => e.id)).toEqual([SaidaDoResgate.CANCELAR, SaidaDoResgate.APAGAR, SaidaDoResgate.ENVIAR]);
        expect(p.mensagem).toContain('"Alfa"');
        expect(p.mensagem).toContain('apaga esse trabalho');
    });

    it('sem ela, as duas escolhas de sempre e o caminho do "Enviar ao servidor"', () => {
        const p = perguntaDoResgate('Alfa', false);
        expect(p.escolhas.map((e) => e.id)).toEqual([SaidaDoResgate.CANCELAR, SaidaDoResgate.APAGAR]);
        expect(p.mensagem).toContain('"Enviar ao servidor"');
    });

    it('o aviso de depois nomeia o atlas local', () => {
        expect(pendenciasDevolvidas('Alfa')).toContain('"Alfa"');
        expect(pendenciasDevolvidas('Alfa').endsWith('.')).toBe(true);
    });
});
