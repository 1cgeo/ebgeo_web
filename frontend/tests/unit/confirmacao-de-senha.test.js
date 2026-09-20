// Path: tests/unit/confirmacao-de-senha.test.js

/**
 * @fileoverview O VEREDICTO AO VIVO DA CONFIRMAÇÃO DE SENHA (`js/ui/password-match.model.js`).
 *
 * Três propriedades, e cada uma é um jeito diferente de a mesma tela mentir:
 *
 * 1. A CONFIRMAÇÃO VAZIA NÃO É UM ERRO. Campo ainda não digitado que já aparece em vermelho ensina
 *    a pessoa a ignorar o vermelho, e aí o aviso que importa também passa despercebido. O estado
 *    VAZIO é o único sem frase, e essa equivalência ("estado vazio se, e só se, mensagem vazia") é
 *    asserida nos dois sentidos.
 * 2. A ORDEM DAS DUAS RECUSAS É A MESMA DO SUBMIT: primeiro o desencontro, depois o tamanho.
 *    `_handleSubmit` do cadastro checa nessa ordem, e um aviso ao vivo que ranqueasse ao contrário
 *    nomearia um problema diferente do que o botão nomeia quando a pessoa insistisse.
 * 3. O LIMITE É EM BYTES, E É POR ISSO QUE ELE EXISTE. O bcrypt trunca em 72 BYTES e em pt-BR um
 *    caractere acentuado custa dois: 37 "á" já passam do limite com `length` ainda marcando 37.
 *    Um teste escrito com senha ASCII passaria verde sobre uma implementação que contasse
 *    caracteres, que é justamente a implementação errada.
 *
 * O QUE ELE NÃO PRENDE: a cor, o `aria-live` e o momento em que o modal chama a função. Isso é do
 * `signup.modal.js`, e um veredicto certo pintado em cinza-claro passa verde aqui.
 */

import { describe, it, expect } from 'vitest';
import {
    PASSWORD_HEAVY_TEXT,
    MAX_PASSWORD_BYTES as TETO_DA_RECUPERACAO,
} from '../../src/js/modals/password-recovery.model.js';
import { MAX_PASSWORD_BYTES as TETO_DA_CONTA } from '../../src/js/admin/account-model.js';
import {
    avaliarConfirmacao,
    bytesDaSenha,
    ConfirmacaoSenha,
    MAX_SENHA_BYTES,
} from '@ui/password-match.model.js';

describe('bytesDaSenha', () => {
    it('conta BYTES em UTF-8, não caracteres', () => {
        expect(bytesDaSenha('abc')).toBe(3);
        expect(bytesDaSenha('á')).toBe(2);
        expect(bytesDaSenha('ção')).toBe(5);
        // Emoji fora do BMP: 4 bytes, e `length` diria 2.
        expect(bytesDaSenha('🛰')).toBe(4);
    });

    it('vazio e não-texto custam zero, em vez de lançar', () => {
        expect(bytesDaSenha('')).toBe(0);
        for (const entrada of [null, undefined, 42, {}, []]) {
            expect(bytesDaSenha(entrada), String(entrada)).toBe(0);
        }
    });
});

describe('avaliarConfirmacao: o campo ainda vazio não acusa nada', () => {
    it('confirmação vazia é VAZIO e não tem frase, mesmo com a senha preenchida', () => {
        const r = avaliarConfirmacao('Sup3r-Secret!', '');
        expect(r.estado).toBe(ConfirmacaoSenha.VAZIO);
        expect(r.mensagem).toBe('');
    });

    it('os dois vazios também', () => {
        expect(avaliarConfirmacao('', '').estado).toBe(ConfirmacaoSenha.VAZIO);
    });

    it('não-texto na confirmação conta como vazio', () => {
        for (const entrada of [null, undefined]) {
            expect(avaliarConfirmacao('abc', entrada).estado, String(entrada))
                .toBe(ConfirmacaoSenha.VAZIO);
        }
    });

    it('VAZIO é o único estado mudo, nos dois sentidos', () => {
        const casos = [
            ['abc', ''],
            ['abc', 'abc'],
            ['abc', 'abd'],
            ['á'.repeat(37), 'á'.repeat(37)],
        ];
        for (const [a, b] of casos) {
            const r = avaliarConfirmacao(a, b);
            expect(r.mensagem === '', `${r.estado} deveria falar`)
                .toBe(r.estado === ConfirmacaoSenha.VAZIO);
        }
    });
});

describe('avaliarConfirmacao: coincidir e divergir', () => {
    it('iguais coincidem', () => {
        const r = avaliarConfirmacao('Sup3r-Secret!', 'Sup3r-Secret!');
        expect(r.estado).toBe(ConfirmacaoSenha.COINCIDE);
        expect(r.mensagem).toContain('coincidem');
    });

    it('diferentes divergem, e a frase é a mesma do submit', () => {
        const r = avaliarConfirmacao('abc123XYZ!', 'different456!');
        expect(r.estado).toBe(ConfirmacaoSenha.DIFERE);
        expect(r.mensagem).toBe('As senhas não coincidem.');
    });

    it('a comparação é exata: espaço, caixa e acento contam', () => {
        expect(avaliarConfirmacao('abc', 'abc ').estado).toBe(ConfirmacaoSenha.DIFERE);
        expect(avaliarConfirmacao('abc', 'ABC').estado).toBe(ConfirmacaoSenha.DIFERE);
        expect(avaliarConfirmacao('senhá', 'senha').estado).toBe(ConfirmacaoSenha.DIFERE);
        // Normalização Unicode NÃO é aplicada de propósito: o servidor compara os bytes que
        // recebeu, então "coincide" aqui tem de significar a mesma coisa que lá.
        expect(avaliarConfirmacao('á', 'á').estado).toBe(ConfirmacaoSenha.DIFERE);
    });

    it('senha vazia com confirmação preenchida diverge', () => {
        expect(avaliarConfirmacao('', 'algo').estado).toBe(ConfirmacaoSenha.DIFERE);
        expect(avaliarConfirmacao(null, 'algo').estado).toBe(ConfirmacaoSenha.DIFERE);
    });
});

describe('avaliarConfirmacao: o limite de 72 BYTES', () => {
    it('exatamente no limite ainda coincide', () => {
        const no_limite = 'a'.repeat(MAX_SENHA_BYTES);
        expect(bytesDaSenha(no_limite)).toBe(72);
        expect(avaliarConfirmacao(no_limite, no_limite).estado).toBe(ConfirmacaoSenha.COINCIDE);
    });

    it('um byte além do limite acusa', () => {
        const passou = 'a'.repeat(MAX_SENHA_BYTES + 1);
        const r = avaliarConfirmacao(passou, passou);
        expect(r.estado).toBe(ConfirmacaoSenha.LONGA_DEMAIS);
        // Plain words: the person never reads "bytes", and the sentence is the recovery screen's.
        expect(r.mensagem).toBe(PASSWORD_HEAVY_TEXT);
        expect(r.mensagem).not.toMatch(/byte/i);
    });

    it('37 caracteres acentuados JÁ passam, e é esse o caso que separa byte de caractere', () => {
        const acentuada = 'á'.repeat(37);
        expect(acentuada.length, 'a contagem de caracteres ainda está confortável').toBe(37);
        expect(bytesDaSenha(acentuada), 'a de bytes já estourou').toBe(74);
        expect(avaliarConfirmacao(acentuada, acentuada).estado)
            .toBe(ConfirmacaoSenha.LONGA_DEMAIS);
    });

    it('longa E diferente acusa a DIFERENÇA, na ordem do submit', () => {
        const r = avaliarConfirmacao('á'.repeat(37), 'á'.repeat(38));
        expect(r.estado).toBe(ConfirmacaoSenha.DIFERE);
    });
});

describe('o teto de bytes do bcrypt tem TRÊS cópias no cliente, e elas andam juntas', () => {
    it('cadastro, recuperação e Minha conta recusam no mesmo byte', () => {
        // Só a cópia de `admin/account-model.js` é conferida contra o SERVIDOR
        // (`conta-regra-de-senha-espelha-servidor.test.js`). As outras duas se prendem a ela aqui:
        // sem isto, subir o teto no servidor deixava o cadastro recusando no valor velho, verde.
        expect(MAX_SENHA_BYTES).toBe(TETO_DA_CONTA);
        expect(TETO_DA_RECUPERACAO).toBe(TETO_DA_CONTA);
    });
});
