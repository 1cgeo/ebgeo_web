// Path: tests/unit/temporal-engrenagem-rebase.test.js

/**
 * @fileoverview A ENGRENAGEM TEMPORAL GRAVA SO' O QUE A PESSOA MUDOU, SOBRE A CONFIG DE AGORA.
 *
 * `pendenteSobreAAtual` e `patchSoDoQueMudou` (`temporal/temporal-settings.model.js`) sao a regra do
 * conserto medido em `frontend/tests/e2e-ui/temporal-engrenagem-copia-velha.repro.spec.js`: com a
 * engrenagem aberta, a unidade que o colega trocou voltava a antiga no Salvar de quem so' corrigiu o
 * inicio.
 */

import { describe, it, expect } from 'vitest';
import { pendenteSobreAAtual, patchSoDoQueMudou, resolverPatchDaConfig } from '../../src/js/temporal/temporal-settings.model.js';

const aberta = { modo: 'absoluto', unidade: 'HORA', inicio: 100, fim: 900, origem: null };

describe('pendenteSobreAAtual', () => {
    it('campo que a pessoa nao tocou vem da config atual (a do colega)', () => {
        const tela = { modo: 'absoluto', unidade: 'HORA', inicio: 200, fim: 900, dDate: null };
        const atual = { ...aberta, unidade: 'SEMANA' };
        expect(pendenteSobreAAtual(tela, aberta, atual)).toEqual({ modo: 'absoluto', unidade: 'SEMANA', inicio: 200, fim: 900, dDate: null });
    });

    it('campo que a pessoa mudou vence, mesmo que o colega tambem tenha mudado', () => {
        const tela = { modo: 'absoluto', unidade: 'DIA', inicio: 100, fim: 900, dDate: null };
        const atual = { ...aberta, unidade: 'SEMANA' };
        expect(pendenteSobreAAtual(tela, aberta, atual).unidade).toBe('DIA');
    });

    it('a "Data de D" da tela corresponde a origem da config', () => {
        const tela = { modo: 'relativo', unidade: 'HORA', inicio: 100, fim: 900, dDate: 50 };
        expect(pendenteSobreAAtual(tela, { ...aberta, modo: 'relativo' }, { ...aberta, modo: 'relativo', origem: 7 }).dDate).toBe(50);
        const intocada = { ...tela, dDate: null };
        expect(pendenteSobreAAtual(intocada, { ...aberta, modo: 'relativo' }, { ...aberta, modo: 'relativo', origem: 7 }).dDate).toBe(7);
    });

    it('undefined e null sao o mesmo valor (campo em branco nao e mudanca)', () => {
        const tela = { modo: 'absoluto', unidade: 'HORA', inicio: 100, fim: undefined, dDate: undefined };
        const atual = { ...aberta, fim: 1200 };
        expect(pendenteSobreAAtual(tela, { ...aberta, fim: null }, atual).fim).toBe(1200);
    });
});

describe('patchSoDoQueMudou', () => {
    it('so as chaves com valor diferente do atual', () => {
        const atual = { ...aberta, unidade: 'SEMANA' };
        const veredito = resolverPatchDaConfig({ modo: 'absoluto', unidade: 'SEMANA', inicio: 200, fim: 900 });
        expect(veredito.ok).toBe(true);
        expect(patchSoDoQueMudou(veredito.patch, atual)).toEqual({ inicio: 200 });
    });

    it('nada mudou: patch vazio', () => {
        expect(patchSoDoQueMudou({ modo: 'absoluto', unidade: 'HORA', inicio: 100, fim: 900 }, aberta)).toEqual({});
    });
});
