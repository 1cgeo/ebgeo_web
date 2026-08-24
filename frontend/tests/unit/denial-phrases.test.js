// Path: tests/unit/denial-phrases.test.js
//
// A FRASE DA RECUSA, E A MENTIRA QUE ELA SUBSTITUI.
//
// Até 2026-08-24 toda recusa por papel chegava ao usuário como UMA sentença:
// "Acesso somente leitura, você não pode editar este projeto." Ela é verdadeira para o
// Visualizador e FALSA para todo degrau acima dele. O caso medido: um Editor que tenta
// apagar um mapa é recusado por `canDeleteMap` (apagar mapa é ato de gestão, `manage` para
// cima) e era informado de que não podia editar o projeto, que ele acabara de editar.
//
// O que este arquivo prende não é a redação das frases, é a PROPRIEDADE que a redação
// precisa ter: nenhuma recusa pode afirmar uma limitação que o leitor não tem. Por isso o
// caso mais importante daqui é o do RAMO PADRÃO, e não o das entradas conhecidas: foi o
// ramo padrão que produziu a mentira, e é ele que a reintroduz se alguém acrescentar uma
// capacidade e esquecer da tabela.

import { describe, it, expect } from 'vitest';
import { denialNotice, phrasedCapabilities, UNKNOWN_DENIAL_TEXT } from '../../src/js/store/denial-phrases.js';
import { PermissionAction } from '../../src/js/store/sync/session-context.js';

describe('denialNotice', () => {
    it('tem frase própria para cada capacidade que o guarda sabe recusar', () => {
        // COBERTURA DERIVADA DO PRODUTO, não de uma lista escrita aqui: `PermissionAction` é a
        // fonte, então uma capacidade nova reprova este caso em vez de cair calada no genérico.
        const semFrase = Object.values(PermissionAction)
            .filter((cap) => denialNotice(cap) === UNKNOWN_DENIAL_TEXT);
        expect(semFrase, `capacidades sem frase própria: ${semFrase.join(', ')}`).toEqual([]);
    });

    it('CONTROLE DE VÁCUO: a tabela não é maior que o vocabulário que ela serve', () => {
        // Sem isto, o caso acima passaria com uma tabela cheia de chaves inventadas, e passaria
        // igual se `PermissionAction` tivesse encolhido para um valor só.
        const vocabulario = Object.values(PermissionAction).sort();
        expect(phrasedCapabilities().sort()).toEqual(vocabulario);
        expect(vocabulario.length).toBeGreaterThanOrEqual(6);
    });

    it('cada capacidade tem uma frase DISTINTA', () => {
        // Duas capacidades com a mesma frase é a mentira antiga em escala menor: quem for
        // recusado por uma lê a explicação da outra.
        const frases = Object.values(PermissionAction).map((cap) => denialNotice(cap));
        expect(new Set(frases).size).toBe(frases.length);
    });

    it('A MENTIRA ESPECÍFICA: recusar apagar mapa NÃO diz que a pessoa não edita', () => {
        // Este é o caso que existia em produção. O Editor edita; o que ele não faz é gerir.
        const frase = denialNotice(PermissionAction.DELETE_MAP);
        expect(frase).not.toMatch(/somente leitura/i);
        expect(frase).not.toMatch(/não pode editar/i);
        expect(frase).toMatch(/Gestor/);
    });

    it('travar o mapa aponta o DONO, não o Gestor, porque o servidor é owner estrito', () => {
        expect(denialNotice(PermissionAction.LOCK_MAPS)).toMatch(/dono/i);
    });

    it('o ramo padrão não afirma limitação nenhuma', () => {
        // A propriedade que o ramo padrão precisa ter. Um texto genérico que dissesse "somente
        // leitura" recriaria o defeito para toda capacidade futura que ninguém tabelou.
        expect(UNKNOWN_DENIAL_TEXT).not.toMatch(/somente leitura/i);
        expect(UNKNOWN_DENIAL_TEXT).not.toMatch(/não pode editar/i);
        expect(UNKNOWN_DENIAL_TEXT).not.toMatch(/comentar|apagar|travar/i);
    });

    it('entrada ausente, vazia ou de outro tipo cai no padrão sem lançar', () => {
        // O payload do evento pode chegar sem `required` (uma recusa antiga, um emissor novo que
        // esqueceu do campo), e um `throw` aqui derrubaria o listener de toast do store inteiro.
        for (const entrada of [undefined, null, '', 'canVoar', 0, 42, {}, [], true]) {
            expect(denialNotice(entrada), String(entrada)).toBe(UNKNOWN_DENIAL_TEXT);
        }
    });

    it('toda frase é pt-BR de tela: termina em ponto e não vaza jargão do guarda', () => {
        for (const cap of phrasedCapabilities()) {
            const frase = denialNotice(cap);
            expect(frase, cap).toMatch(/\.$/);
            expect(frase, cap).not.toMatch(/can[A-Z]|GuardAction|PermissionAction|role atual/);
        }
    });
});
