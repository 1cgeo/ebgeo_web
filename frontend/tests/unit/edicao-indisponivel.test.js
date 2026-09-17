// Path: tests/unit/edicao-indisponivel.test.js
//
// A CONTA ÚNICA DE "NÃO DÁ PARA EDITAR AGORA" (2026-09-16).
//
// O produto respondia isso por dois caminhos separados — a trava do mapa e o papel no atlas — e
// quinze superfícies perguntavam só pelo primeiro. Este arquivo prende a conta somada: o que ela
// responde, em que ORDEM, e o que ela carrega junto para quem precisa falar.
//
// O que ele NÃO alcança: nenhuma superfície. Que o painel de feição, o menu de contexto e o teclado
// de fato consultem esta conta é o assunto de `somente-leitura-censo.test.js` e dos testes de cada
// superfície.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const estado = { travado: false, permissao: { allowed: true } };
const chamadas = { acoes: [] };

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: () => estado.travado,
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: (acao) => {
        chamadas.acoes.push(acao);
        return estado.permissao;
    },
}));

const { edicaoIndisponivelSync, semEdicaoSync } = await import('../../src/js/store/edicao-indisponivel.js');

beforeEach(() => {
    estado.travado = false;
    estado.permissao = { allowed: true };
    chamadas.acoes.length = 0;
});

describe('edicaoIndisponivelSync', () => {
    it('libera quando o papel permite e o mapa não está travado', () => {
        expect(edicaoIndisponivelSync()).toEqual({ bloqueado: false, motivo: null, required: null });
        expect(semEdicaoSync()).toBe(false);
    });

    it('bloqueia por POSTO, carregando a CAPACIDADE negada para a frase', () => {
        estado.permissao = { allowed: false, required: 'canEdit', reason: 'role_viewer' };
        expect(edicaoIndisponivelSync()).toEqual({
            bloqueado: true, motivo: 'permissao', required: 'canEdit',
        });
    });

    it('bloqueia por ESTADO quando o papel permite mas o mapa está travado', () => {
        estado.travado = true;
        expect(edicaoIndisponivelSync()).toEqual({
            bloqueado: true, motivo: 'map_locked', required: null,
        });
    });

    it('POSTO vence ESTADO quando os dois recusam', () => {
        // A ordem não é gosto: quem não tem nível nenhum não deve receber a frase que manda
        // destravar um mapa que ele não poderia editar de qualquer jeito. É a mesma ordem que
        // `guardWrite` segue e que `layer-operations.test.js` fixa pelo nome.
        estado.travado = true;
        estado.permissao = { allowed: false, required: 'canEdit' };
        expect(edicaoIndisponivelSync().motivo).toBe('permissao');
    });

    it('pergunta pela AÇÃO que a superfície exerce, e não sempre pela edição de feição', () => {
        // Um comando que apaga tem de citar a capacidade dele, senão a frase da recusa fala da
        // capacidade errada.
        estado.permissao = { allowed: false, required: 'canDelete' };
        expect(edicaoIndisponivelSync('DELETE_LAYER').required).toBe('canDelete');
        expect(chamadas.acoes).toEqual(['DELETE_LAYER']);
    });

    it('o padrão é a edição de feição', () => {
        edicaoIndisponivelSync();
        expect(chamadas.acoes).toEqual(['UPDATE_FEATURE']);
    });

    it('sem `required` no payload da recusa, devolve null em vez de undefined', () => {
        // O consumidor passa isto a `denialNotice`, que distingue chave ausente de chave herdada.
        estado.permissao = { allowed: false };
        expect(edicaoIndisponivelSync().required).toBeNull();
    });
});
